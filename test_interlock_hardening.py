"""Interlock hardening: acknowledged release, hold reasons, plausibility / sudden-drop fail-safe,
time-limited suspension, long-hold advisory and the auditable event log.

Software checks only; passing them is not clinical validation. Educational simulation.
"""
import contextlib
import io
import math
import shutil
import tempfile
import unittest
from pathlib import Path

import yaml

from smart_noa_controller import CLINICIAN_RESPONSIBILITY, ConfigLoader, Patient, SmartNOAController

CONFIG = str(Path(__file__).with_name("config.yaml"))


def make():
    with contextlib.redirect_stdout(io.StringIO()):
        c = SmartNOAController(Patient(40, 70, 2, 90, [], []), CONFIG)
        c.generate_starting_rates()
    return c


def run(c, readings):
    with contextlib.redirect_stdout(io.StringIO()):
        c.monitor_and_control(len(readings), vitals=readings, sleep_sec=0)


def quiet(fn, *args):
    with contextlib.redirect_stdout(io.StringIO()) as out:
        result = fn(*args)
    return result, out.getvalue()


def codes(c):
    return [e["code"] for e in c.events]


class FailSafe(unittest.TestCase):
    def test_invalid_reading_zeroes_everything_and_is_logged(self):
        for hr, map_value in [(None, 84), (math.nan, 84), (math.inf, 84), (True, 84), ("84", 84)]:
            with self.subTest(hr=hr):
                c = make()
                run(c, [(hr, map_value)])
                self.assertEqual(c.status, "RED")
                self.assertTrue(c.hold_latched)
                self.assertTrue(all(v == 0 for v in c.infusions.values()))
                event = c.events[-1]
                self.assertEqual(event["code"], "sensor_fault")
                self.assertEqual(event["message"], "Invalid sensor reading (HR=unusable, MAP=84) → all controlled "
                                                   "infusions set to zero; hold latched")
                self.assertEqual(event["drugs"], ["Dexmedetomidine", "Ketamine", "Lidocaine"])
                self.assertEqual(event["status"], "RED")

    def test_implausible_reading_fails_safe(self):
        for reading, text in [((350, 80), "HR 350 outside simulation plausibility limits 0–300: unusable"),
                              ((80, -5), "MAP -5 outside simulation plausibility limits 0–300: unusable"),
                              ((80, 300.5), "MAP 300.5 outside simulation plausibility limits 0–300: unusable")]:
            with self.subTest(reading=reading):
                c = make()
                run(c, [reading])
                self.assertEqual(c.status, "RED")
                self.assertTrue(all(v == 0 for v in c.infusions.values()))
                self.assertTrue(c.events[-1]["message"].startswith(text))
        c = make()
        run(c, [(0, 0), (300, 300)])  # limits are inclusive
        self.assertNotIn("sensor_fault", codes(c))

    def test_sudden_drop_fails_safe_and_baseline_resets(self):
        c = make()
        run(c, [(80, 80), (39, 80)])
        self.assertEqual(c.status, "RED")
        self.assertTrue(all(v == 0 for v in c.infusions.values()))
        self.assertEqual(c.hold_reasons, ["implausible HR jump −41 /min in 1 s"])
        c = make()
        run(c, [(80, 80), (80, 49)])
        self.assertIn("MAP drop −31 mmHg in 1 s (80 → 49)", c.events[-1]["message"])
        c = make()  # exact limits and sudden rises are not artifacts
        run(c, [(80, 80), (40, 50), (120, 120)])
        self.assertNotIn("sensor_fault", codes(c))
        c = make()  # first valid reading after a fault is not compared with the pre-fault value
        run(c, [(100, 100), (None, 100), (55, 61)])
        self.assertEqual(codes(c), ["sensor_fault"])

    def test_rate_fault_zeroes_that_agent_and_logs(self):
        c = make()
        c.infusions["Ketamine"] = 999
        run(c, [(80, 80)])
        self.assertEqual(c.infusions["Ketamine"], 0)
        self.assertEqual(c.status, "RED")
        self.assertEqual(c.events[-1]["message"],
                         "Rate outside simulation ceiling (Ketamine) → set to zero; hold latched")
        self.assertEqual(c.hold_reasons, ["rate outside simulation ceiling (Ketamine)"])


class Breaches(unittest.TestCase):
    def test_hr_and_map_breach_messages_and_agents(self):
        c = make()
        run(c, [(46, 80)])
        self.assertEqual(c.events[-1]["message"], "HR 46 < 48 → Dexmedetomidine set to zero; hold latched")
        self.assertEqual(c.infusions, {"Lidocaine": 1.5, "Ketamine": 0.2, "Dexmedetomidine": 0.0})
        run(c, [(80, 55)])
        self.assertEqual(c.events[-1]["message"], "MAP 55 < 60 → Dexmedetomidine, Lidocaine set to zero; hold latched")
        self.assertEqual(c.infusions["Lidocaine"], 0)
        self.assertEqual(c.hold_reasons, ["HR 46 < 48", "MAP 55 < 60"])
        self.assertEqual([r["t_sec"] for r in c.hold["reasons"]], [0, 1])

    def test_no_automatic_restart_and_direct_write_rezeroed(self):
        c = make()
        run(c, [(46, 80)] + [(80, 80)] * 300)
        self.assertEqual(c.status, "HOLD")
        self.assertEqual(c.infusions["Dexmedetomidine"], 0)
        c.infusions["Dexmedetomidine"] = 0.5
        run(c, [(80, 80)])
        self.assertEqual(c.infusions["Dexmedetomidine"], 0)
        self.assertTrue(c.hold_latched)

    def test_running_clock_across_calls(self):
        c = make()
        run(c, [(80, 80)] * 5)
        run(c, [(46, 80)])
        self.assertEqual(c.events[-1]["t_sec"], 5)
        self.assertEqual(c.clock_sec, 6)


class Release(unittest.TestCase):
    def test_resume_without_acknowledgment_raises(self):
        c = make()
        run(c, [(46, 80)])
        refusal = r"^Acknowledge the hold first: review the cause \(HR 46 < 48\), then resume$"
        with self.assertRaisesRegex(ValueError, refusal):
            c.resume_hold("clinician")
        self.assertTrue(c.hold_latched)
        with self.assertRaisesRegex(ValueError, "No hold is latched"):
            make().acknowledge_hold("clinician")
        for who in ("", "  ", None):
            with self.subTest(who=who), self.assertRaises(ValueError):
                c.acknowledge_hold(who)

    def test_acknowledgment_invalidated_by_new_latch(self):
        c = make()
        run(c, [(46, 80)])
        quiet(c.acknowledge_hold, "clinician")
        run(c, [(46, 80)])  # same trigger again: not a new latch event
        self.assertEqual(c.hold["acknowledged_by"], "clinician")
        run(c, [(80, 55)])  # new trigger and new agent
        self.assertIsNone(c.hold["acknowledged_by"])
        self.assertIn("acknowledgment_invalidated", codes(c))
        with self.assertRaises(ValueError):
            c.resume_hold("clinician")

    def test_acknowledgment_single_use(self):
        c = make()
        run(c, [(46, 80)])
        quiet(c.acknowledge_hold, "clinician")
        quiet(c.resume_hold, "clinician")
        run(c, [(80, 80), (46, 80)])
        self.assertEqual(c.hold["id"], 2)
        with self.assertRaisesRegex(ValueError, "Acknowledge the hold first"):
            c.resume_hold("clinician")

    def test_release_is_logged_and_does_not_restore_rates(self):
        c = make()
        run(c, [(80, 55)])
        quiet(c.acknowledge_hold, "clinician", "cause reviewed")
        held, out = quiet(c.resume_hold, "clinician")
        self.assertEqual(held, ["Dexmedetomidine", "Lidocaine"])
        self.assertIn(CLINICIAN_RESPONSIBILITY, out)
        self.assertEqual(CLINICIAN_RESPONSIBILITY, "Releasing this hold is a clinician decision. "
                                                   "The simulation does not assess whether restart is appropriate.")
        self.assertIn(CLINICIAN_RESPONSIBILITY.split(". ")[0], c.resume_hold.__doc__)
        self.assertEqual(codes(c)[-2:], ["hold_acknowledged", "hold_released"])
        self.assertIn("note: cause reviewed", c.events[-2]["message"])
        self.assertTrue(c.events[-1]["message"].endswith("→ held infusions stay at zero; no automatic restart"))
        self.assertFalse(c.hold_latched)
        self.assertEqual(c.status, "RED")  # GREEN only at the next evaluation
        for _ in range(60):
            run(c, [(80, 80)])
            self.assertEqual((c.infusions["Dexmedetomidine"], c.infusions["Lidocaine"]), (0.0, 0.0))
        self.assertEqual(c.status, "GREEN")
        c.infusions["Lidocaine"] = 1.0  # explicit
        run(c, [(80, 80)])
        self.assertEqual(c.infusions["Lidocaine"], 1.0)


class Suspension(unittest.TestCase):
    def test_bounds_and_mandatory_verbatim_reason(self):
        c = make()
        for duration in (0, 301, 1.5, True, -1, None):
            with self.subTest(duration=duration), self.assertRaisesRegex(ValueError, "Suspension duration"):
                c.suspend_interlocks(duration, "clinician", "x")
        for reason in ("", "   ", "\n\t", None, 5):
            with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, "reason must be a non-empty string"):
                c.suspend_interlocks(60, "clinician", reason)
        verbatim = '  <b>"why"</b> — é ✓ \'q\'  '
        quiet(c.suspend_interlocks, 300, "clinician", verbatim)
        self.assertEqual(c.suspension["reason"], verbatim)
        self.assertIn(f"(reason: {verbatim})", c.events[-1]["message"])
        self.assertEqual(c.events[-1]["code"], "suspension_started")
        self.assertTrue(c.suspended)
        self.assertEqual(c.suspension_remaining_sec, 300)
        with self.assertRaisesRegex(ValueError, "already suspended"):
            c.suspend_interlocks(10, "clinician", "again")

    def test_suppresses_only_hr_map_breaches(self):
        c = make()
        quiet(c.suspend_interlocks, 30, "clinician", "test")
        run(c, [(46, 80), (80, 55)])
        self.assertEqual(codes(c)[-2:], ["breach_suppressed", "breach_suppressed"])
        self.assertEqual(c.events[-2]["message"],
                         "HR 46 < 48 → interlock SUSPENDED by clinician (00:30 left): no hold latched")
        self.assertFalse(c.hold_latched)
        self.assertEqual(c.status, "GREEN")
        self.assertEqual(c.infusions["Dexmedetomidine"], 0.5)
        c.infusions["Ketamine"] = 5  # rate faults are not suspended
        run(c, [(80, 80)])
        self.assertEqual(c.infusions["Ketamine"], 0)
        self.assertTrue(c.hold_latched)
        run(c, [(None, 80)])  # nor is the sensor fail-safe
        self.assertTrue(all(v == 0 for v in c.infusions.values()))
        self.assertTrue(c.suspended)

    def test_does_not_release_an_existing_hold(self):
        c = make()
        run(c, [(80, 55)])
        quiet(c.suspend_interlocks, 60, "clinician", "during a hold")
        run(c, [(80, 80)] * 10)
        self.assertTrue(c.hold_latched)
        self.assertEqual(c.status, "HOLD")
        self.assertEqual((c.infusions["Dexmedetomidine"], c.infusions["Lidocaine"]), (0.0, 0.0))

    def test_expiry_is_automatic_and_logged(self):
        c = make()
        quiet(c.suspend_interlocks, 3, "clinician", "short")
        run(c, [(80, 80)] * 3)
        self.assertFalse(c.suspended)
        self.assertEqual(c.events[-1]["code"], "suspension_expired")
        self.assertEqual(c.events[-1]["message"], "Suspension expired after 3 s → HR/MAP interlocks active")
        run(c, [(46, 80)])
        self.assertEqual(codes(c)[-1], "hr_low")
        quiet(c.suspend_interlocks, 60, "clinician", "again")
        run(c, [(80, 80)] * 5)
        quiet(c.end_suspension, "clinician")
        self.assertEqual(c.events[-1]["message"],
                         "Suspension ended by clinician (00:55 left) → HR/MAP interlocks active")
        with self.assertRaisesRegex(ValueError, "No interlock suspension is active"):
            c.end_suspension("clinician")
        self.assertFalse(make().suspended)


class LongHold(unittest.TestCase):
    def test_advisory_every_ten_minutes_changes_nothing(self):
        c = make()
        run(c, [(46, 80)] + [(80, 80)] * 1250)
        long_events = [e for e in c.events if e["code"] == "hold_long"]
        self.assertEqual([e["t_sec"] for e in long_events], [600, 1200])
        self.assertEqual(long_events[0]["message"], "Hold has been active for 10 min (reasons: HR 46 < 48)")
        self.assertEqual(c.status, "HOLD")
        self.assertTrue(c.hold_latched)
        self.assertEqual(c.infusions, {"Lidocaine": 1.5, "Ketamine": 0.2, "Dexmedetomidine": 0.0})


class ConfigValidation(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)
        with open(CONFIG, encoding="utf-8") as f:
            self.base = yaml.safe_load(f)

    def write(self, data):
        path = self.dir / "config.yaml"
        path.write_text(yaml.safe_dump(data), encoding="utf-8")
        return str(path)

    def test_new_keys_validated(self):
        ConfigLoader(self.write(self.base))
        bad = [("sensor_plausibility", None), ("interlock_suspension_max_sec", None),
               ("interlock_long_hold_advisory_sec", None), ("interlock_suspension_max_sec", 0),
               ("interlock_suspension_max_sec", 2.5), ("interlock_long_hold_advisory_sec", True)]
        for key, value in bad:
            with self.subTest(key=key, value=value):
                data = dict(self.base)
                if value is None:
                    data.pop(key)
                else:
                    data[key] = value
                with self.assertRaises(ValueError):
                    ConfigLoader(self.write(data))
        for field, value in [("hr_max", math.nan), ("map_max", -1), ("hr_min", 400), ("map_max_drop_per_sec", 0),
                             ("hr_max_drop_per_sec", "40"), ("hr_min", None)]:
            with self.subTest(field=field, value=value):
                data = dict(self.base, sensor_plausibility=dict(self.base["sensor_plausibility"]))
                data["sensor_plausibility"][field] = value
                with self.assertRaises(ValueError):
                    ConfigLoader(self.write(data))


if __name__ == "__main__":
    unittest.main()
