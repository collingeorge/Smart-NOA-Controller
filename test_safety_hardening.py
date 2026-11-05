"""Regression tests for the November 2026 safety-hardening pass.

Software checks only; passing them is not clinical validation.
Each test corresponds to a defect found by adversarial simulation.
"""
import contextlib
import io
import math
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from smart_noa_controller import ConfigLoader, Patient, SmartNOAController

CONFIG = str(Path(__file__).with_name("config.yaml"))


def make(age=40, weight=70, egfr=90, allergies=None, comorbidities=None):
    with contextlib.redirect_stdout(io.StringIO()):
        c = SmartNOAController(Patient(age, weight, 2, egfr, allergies or [], comorbidities or []), CONFIG)
        c.generate_starting_rates()
    return c


def run(c, readings):
    flat = [v for pair in readings for v in pair]
    with patch("smart_noa_controller.random.randint", side_effect=flat), \
            patch("smart_noa_controller.time.sleep"), contextlib.redirect_stdout(io.StringIO()):
        c.monitor_and_control(len(readings))


class SensorFaults(unittest.TestCase):
    def test_invalid_readings_fail_safe(self):
        for hr, map_value in [(math.nan, 80), (80, math.nan), (None, 80), (80, None),
                              (math.inf, 80), ("80", 80), (True, 80)]:
            with self.subTest(hr=hr, map_value=map_value):
                c = make()
                run(c, [(hr, map_value)])
                self.assertEqual(c.status, "RED")
                self.assertTrue(c.hold_latched)
                self.assertTrue(all(rate == 0 for rate in c.infusions.values()))

    def test_valid_reading_after_fault_does_not_restart(self):
        c = make()
        run(c, [(math.nan, 80), (80, 80), (80, 80)])
        self.assertEqual(c.status, "HOLD")
        self.assertTrue(all(rate == 0 for rate in c.infusions.values()))


class Enforcement(unittest.TestCase):
    def test_locked_drug_cannot_be_infused_by_direct_write(self):
        c = make(age=72, comorbidities=["Heart Block"])
        c.infusions["Dexmedetomidine"] = 0.5
        run(c, [(80, 80)] * 120)
        self.assertEqual(c.infusions["Dexmedetomidine"], 0)
        self.assertEqual(c.dex_pk.Cp, 0)

    def test_held_drug_cannot_be_restarted_while_latched(self):
        c = make()
        run(c, [(40, 80)])
        c.infusions["Dexmedetomidine"] = 0.5
        run(c, [(80, 80)] * 120)
        self.assertEqual(c.infusions["Dexmedetomidine"], 0)
        self.assertEqual(c.status, "HOLD")

    def test_hypotension_hold_scope_is_unchanged(self):
        # Documented behaviour retained: ketamine is not part of the hypotension hold.
        c = make()
        run(c, [(80, 50)])
        self.assertEqual(c.infusions["Dexmedetomidine"], 0)
        self.assertEqual(c.infusions["Lidocaine"], 0)
        self.assertEqual(c.infusions["Ketamine"], 0.2)


class RateCeilings(unittest.TestCase):
    def test_runtime_rate_above_ceiling_is_zeroed_and_latched(self):
        for drug, rate in [("Dexmedetomidine", 1e6), ("Ketamine", 999), ("Lidocaine", 2.0),
                           ("Lidocaine", -1), ("Ketamine", math.nan)]:
            with self.subTest(drug=drug, rate=rate):
                c = make()
                c.infusions[drug] = rate
                run(c, [(80, 80)])
                self.assertEqual(c.infusions[drug], 0)
                self.assertEqual(c.status, "RED")
                self.assertTrue(c.hold_latched)
                self.assertLess(c.dex_pk.Cp, 1)

    def test_config_dose_above_ceiling_is_rejected(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            text = Path(CONFIG).read_text().replace("standard_dose: 0.5", "standard_dose: 50", 1)
            (tmp / "config.yaml").write_text(text)
            with self.assertRaises(ValueError):
                ConfigLoader(str(tmp / "config.yaml"))
        finally:
            shutil.rmtree(tmp)

    def test_missing_ceiling_section_is_rejected(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            text = Path(CONFIG).read_text().split("simulation_rate_ceilings:")[0] + "age_adjustments:\n  geriatric:\n    age_threshold: 65\n"
            (tmp / "config.yaml").write_text(text)
            with self.assertRaises(ValueError):
                ConfigLoader(str(tmp / "config.yaml"))
        finally:
            shutil.rmtree(tmp)


class Matching(unittest.TestCase):
    def test_cardiac_matching_is_case_insensitive_substring(self):
        for condition in ["heart block", "HEART BLOCK", "Complete heart block",
                          "Second-degree AV block", "Mobitz II"]:
            with self.subTest(condition=condition):
                self.assertIn("Dexmedetomidine", make(comorbidities=[condition]).hard_lockouts)

    def test_allergy_matching_is_case_insensitive_substring(self):
        for allergy in ["nsaid", "NSAIDs", "aspirin"]:
            with self.subTest(allergy=allergy):
                self.assertIn("Ketorolac", make(allergies=[allergy]).hard_lockouts)

    def test_unlisted_free_text_is_still_not_recognized(self):
        # Documented limit: the matcher is illustrative, not a terminology service.
        self.assertNotIn("Ketorolac", make(allergies=["Ibuprofen"]).hard_lockouts)

    def test_ketorolac_listed_once_when_both_rules_fire(self):
        c = make(egfr=20, allergies=["NSAID"])
        self.assertEqual(c.hard_lockouts.count("Ketorolac"), 1)


class Inputs(unittest.TestCase):
    def test_implausible_age_rejected(self):
        with self.assertRaises(ValueError):
            Patient(250, 70, 2, 90, [], [])


if __name__ == "__main__":
    unittest.main()
