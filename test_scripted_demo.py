"""Scripted-vitals options and the reproducible demo. Software checks only; not clinical validation."""
import contextlib
import io
import math
import runpy
import unittest
from pathlib import Path
from unittest.mock import patch

from smart_noa_controller import Patient, SmartNOAController

CONFIG = str(Path(__file__).with_name("config.yaml"))


def make():
    with contextlib.redirect_stdout(io.StringIO()):
        c = SmartNOAController(Patient(40, 70, 2, 90, [], []), CONFIG)
        c.generate_starting_rates()
    return c


class ScriptedVitals(unittest.TestCase):
    def run_quiet(self, c, *args, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            c.monitor_and_control(*args, **kwargs)
        return out.getvalue()

    def test_scripted_readings_drive_the_same_rules(self):
        c = make()
        self.run_quiet(c, 3, vitals=[(80, 80), (40, 50), (80, 80)], sleep_sec=0)
        self.assertEqual(c.status, "HOLD")
        self.assertEqual(c.infusions["Dexmedetomidine"], 0)
        self.assertEqual(c.infusions["Lidocaine"], 0)
        self.assertEqual(c.infusions["Ketamine"], 0.2)

    def test_scripted_none_fails_safe(self):
        c = make()
        self.run_quiet(c, 2, vitals=[(80, 80), (None, 80)], sleep_sec=0)
        self.assertEqual(c.status, "RED")
        self.assertTrue(all(v == 0 for v in c.infusions.values()))

    def test_script_shorter_than_duration_raises(self):
        with self.assertRaises(ValueError):
            self.run_quiet(make(), 3, vitals=[(80, 80)], sleep_sec=0)

    def test_invalid_options_rejected(self):
        for kwargs in ({"sleep_sec": -1}, {"sleep_sec": math.nan}, {"log_every": 0}, {"log_every": 1.5}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.run_quiet(make(), 1, vitals=[(80, 80)], **kwargs)

    def test_log_every_suppresses_routine_lines_not_alerts(self):
        out = self.run_quiet(make(), 10, vitals=[(80, 80)] * 9 + [(40, 80)], sleep_sec=0, log_every=5)
        self.assertEqual(out.count("No configured alert"), 2)  # t=0 and t=5
        self.assertIn("SIMULATED LOW HR", out)

    def test_default_sleep_still_one_second(self):
        c = make()
        with patch("smart_noa_controller.time.sleep") as sleep, contextlib.redirect_stdout(io.StringIO()):
            c.monitor_and_control(1, vitals=[(80, 80)])
        sleep.assert_called_once_with(1.0)


class Demo(unittest.TestCase):
    def test_demo_is_reproducible_and_tells_each_story(self):
        runs = []
        for _ in range(2):
            with patch("sys.argv", ["smart_noa_controller.py"]), contextlib.redirect_stdout(io.StringIO()) as out:
                runpy.run_path(str(Path(__file__).with_name("smart_noa_controller.py")), run_name="__main__")
            runs.append(out.getvalue())
        self.assertEqual(runs[0], runs[1])
        text = runs[0]
        self.assertIn("Hard Lockouts Enabled: ['Ketorolac', 'Dexmedetomidine']", text)
        self.assertIn("HYPOTENSION | Ce: 0.00 | MAP 59 < 60 → Dexmedetomidine, Lidocaine set to zero; "
                      "hold latched", text)
        self.assertIn("SIMULATED LOW HR | Ce: 0.04 | HR 47 < 48 → Dexmedetomidine set to zero; hold latched", text)
        self.assertIn("INVALID SENSOR READING | Invalid sensor reading (HR=unusable, MAP=84) → all controlled "
                      "infusions set to zero; hold latched", text)
        self.assertEqual(text.count("Final: HOLD"), 3)
        # Scenario 4: refused release, acknowledged release (rates stay zero), suppressed breach, expiry.
        self.assertIn("Release refused: Acknowledge the hold first: review the cause (MAP 59 < 60), then resume", text)
        self.assertIn("Releasing this hold is a clinician decision. The simulation does not assess whether restart "
                      "is appropriate.", text)
        self.assertIn("After release (held agents stay at zero): GREEN {'Lidocaine': 0.0, 'Ketamine': 0.2, "
                      "'Dexmedetomidine': 0.0}", text)
        self.assertIn("breach_suppressed", text)
        self.assertIn("Suspension expired after 60 s → HR/MAP interlocks active", text)
        self.assertIn("Final: GREEN {'Lidocaine': 1.0, 'Ketamine': 0.2, 'Dexmedetomidine': 0.0} "
                      "| suspended: False", text)
        self.assertEqual(text.count("Event log:"), 4)


if __name__ == "__main__":
    unittest.main()
