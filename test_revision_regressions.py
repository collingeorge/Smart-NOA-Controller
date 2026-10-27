"""Software checks, not clinical validation."""
import contextlib
import io
import math
import unittest
from unittest.mock import patch
from smart_noa_controller import Pharmacokinetics, Patient, SmartNOAController

class RevisionRegressionTests(unittest.TestCase):
    def controller(self):
        with contextlib.redirect_stdout(io.StringIO()):
            c = SmartNOAController(Patient(40, 70, 2, 90, [], []))
            c.generate_starting_rates()
        return c

    def test_unknown_drug_is_unassessed(self):
        allowed, message = self.controller().check_contraindication('unrecognized')
        self.assertFalse(allowed)
        self.assertIn('UNASSESSED', message)

    def test_invalid_model_inputs_fail(self):
        for weight in (0, -1, math.nan, math.inf):
            with self.assertRaises(ValueError):
                Pharmacokinetics(weight, 1, 0.1, 0.1)
        model = Pharmacokinetics(70, 1, 0.1, 0.1)
        for rate, dt in ((-1, 1), (math.nan, 1), (1, 0), (1, math.inf), (1, 20)):
            with self.assertRaises(ValueError):
                model.update_concentration(rate, dt)

    def test_mass_balance_without_elimination(self):
        model = Pharmacokinetics(10, 2, 0, 0)
        cp, ce = model.update_concentration(5, 2)
        self.assertAlmostEqual(cp, 0.5)  # 10 mcg / 20 L = 0.5 ng/mL
        self.assertEqual(ce, 0)

    def test_low_hr_triggers_hold_at_zero_concentration(self):
        c = self.controller()
        with patch('smart_noa_controller.random.randint', side_effect=[40, 80]), patch('smart_noa_controller.time.sleep'), contextlib.redirect_stdout(io.StringIO()):
            c.monitor_and_control(1)
        self.assertTrue(c.hold_latched)
        self.assertEqual(c.infusions['Dexmedetomidine'], 0)

    def test_hold_does_not_restart_after_one_normal_reading(self):
        c = self.controller()
        with patch('smart_noa_controller.random.randint', side_effect=[80, 50, 80, 90]), patch('smart_noa_controller.time.sleep'), contextlib.redirect_stdout(io.StringIO()):
            c.monitor_and_control(2)
        self.assertEqual(c.status, 'HOLD')
        self.assertEqual(c.infusions['Dexmedetomidine'], 0)
        self.assertEqual(c.infusions['Lidocaine'], 0)

if __name__ == '__main__':
    unittest.main()
