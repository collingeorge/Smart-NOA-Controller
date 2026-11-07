"""Regression tests for the 05t code audit (findings 1, 2, 4 and 5; Python side).

Software checks only; passing them is not clinical validation. Educational simulation.
"""
import contextlib
import io
import shutil
import tempfile
import unittest
from pathlib import Path

import yaml

from smart_noa_controller import ConfigLoader, Patient, SmartNOAController, _is_finite_number, _num_text

CONFIG = str(Path(__file__).with_name("config.yaml"))
UNSAFE = ["ok\nforged line", "tab\there", "x\u202eevil", "a\u2028b", "\ufeffbom",
          "del\x7f", "c1\x85", "lrm\u200e", "iso\u2066x"]


def make():
    with contextlib.redirect_stdout(io.StringIO()):
        c = SmartNOAController(Patient(40, 70, 2, 90, [], []), CONFIG)
        c.generate_starting_rates()
    return c


def run(c, readings):
    with contextlib.redirect_stdout(io.StringIO()):
        c.monitor_and_control(len(readings), vitals=readings, sleep_sec=0)


class HugeIntegers(unittest.TestCase):
    """Finding 1: an int too large for a float fails safe instead of raising OverflowError."""

    def test_helper(self):
        self.assertFalse(_is_finite_number(10 ** 400))
        self.assertFalse(_is_finite_number(-(10 ** 400)))
        self.assertTrue(_is_finite_number(10 ** 300))

    def test_huge_reading_latches(self):
        for reading in ((10 ** 400, 80), (80, 10 ** 400)):
            c = make()
            run(c, [reading])
            self.assertTrue(c.hold_latched)
            self.assertEqual(c.status, "RED")
            self.assertTrue(all(rate == 0 for rate in c.infusions.values()))
            self.assertEqual(c.events[-1]["code"], "sensor_fault")
            self.assertIn("unusable", c.events[-1]["message"])

    def test_huge_rate_latches(self):
        c = make()
        c.infusions["Ketamine"] = 10 ** 400
        run(c, [(80, 80)])
        self.assertTrue(c.hold_latched)
        self.assertEqual(c.infusions["Ketamine"], 0)
        self.assertIn("rate_fault", [e["code"] for e in c.events])

    def test_huge_config_value_refused(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            data = yaml.safe_load(Path(CONFIG).read_text(encoding="utf-8"))
            data["interlock_suspension_max_sec"] = 10 ** 400
            path = tmp / "config.yaml"
            path.write_text(yaml.safe_dump(data), encoding="utf-8")
            with self.assertRaises(ValueError):
                ConfigLoader(str(path))
        finally:
            shutil.rmtree(tmp)


class ReleaseKeepsZero(unittest.TestCase):
    """Finding 2: a rate written while the hold is latched does not take effect after the release."""

    def test_write_while_held_is_discarded(self):
        c = make()
        run(c, [(80, 55)])
        self.assertEqual(sorted(c.held_drugs), ["Dexmedetomidine", "Lidocaine"])
        c.infusions["Lidocaine"] = 1.0
        with contextlib.redirect_stdout(io.StringIO()):
            c.acknowledge_hold("clinician")
            c.resume_hold("clinician")
        self.assertEqual(c.infusions["Lidocaine"], 0.0)
        run(c, [(80, 80)])
        self.assertEqual(c.infusions["Lidocaine"], 0.0)
        self.assertEqual(c.infusions["Dexmedetomidine"], 0.0)
        self.assertEqual(c.infusions["Ketamine"], 0.2)


class LogText(unittest.TestCase):
    """Finding 4: control, separator and bidi characters cannot enter the event log."""

    def test_reason_and_by_refused(self):
        for bad in UNSAFE:
            c = make()
            n = len(c.events)
            with self.assertRaises(ValueError):
                c.suspend_interlocks(60, "clinician", bad)
            with self.assertRaises(ValueError):
                c.suspend_interlocks(60, bad, "reason")
            self.assertEqual(len(c.events), n)
            self.assertFalse(c.suspended)

    def test_note_refused(self):
        for bad in UNSAFE:
            c = make()
            run(c, [(40, 80)])
            with self.assertRaises(ValueError):
                c.acknowledge_hold("clinician", bad)
            self.assertIsNone(c.hold["acknowledged_by"])

    def test_ordinary_text_kept_verbatim(self):
        c = make()
        reason = "  Surgeon request — transient bradycardia (vagal), ‘reviewed’  "
        with contextlib.redirect_stdout(io.StringIO()):
            c.suspend_interlocks(60, "clinician", reason)
        self.assertIn(f"(reason: {reason})", c.events[-1]["message"])


class NumberText(unittest.TestCase):
    """Finding 5: numbers in messages print exactly as JavaScript String(n) prints them."""

    def test_cases(self):
        cases = {46.0: "46", 46.5: "46.5", 1e-05: "0.00001", 1e-07: "1e-7", 10 ** 22: "1e+22", 1e21: "1e+21",
                 123456789012345680000.0: "123456789012345680000", -0.0: "0", 0.1 + 0.2: "0.30000000000000004",
                 -1.5e-10: "-1.5e-10", 2 ** 53 + 1: "9007199254740992", 300: "300"}
        for value, text in cases.items():
            self.assertEqual(_num_text(value), text, value)

    def test_message_uses_js_form(self):
        c = make()
        run(c, [(10 ** 22 * 1.0, 80)])
        self.assertIn("HR 1e+22 outside simulation plausibility limits", c.events[-1]["message"])


if __name__ == "__main__":
    unittest.main()
