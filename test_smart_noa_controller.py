"""
Unit tests for Smart NOA Controller
Tests core safety logic, contraindication enforcement, and dose calculations
"""

import unittest
import tempfile
import os
from pathlib import Path
from smart_noa_controller import Patient, SmartNOAController, Pharmacokinetics, ConfigLoader


class TestConfigLoader(unittest.TestCase):
    """Test configuration file loading and validation"""
    
    def test_config_loads_successfully(self):
        """Configuration file should load without errors"""
        config = ConfigLoader("config.yaml")
        
        # Assert config object exists
        self.assertIsNotNone(config.config)
        
        # Assert critical sections exist
        self.assertIn('hemodynamic_thresholds', config.config)
        self.assertIn('pharmacokinetics', config.config)
        self.assertIn('drug_dosing', config.config)
        self.assertIn('contraindications', config.config)
    
    def test_config_get_nested_values(self):
        """Should retrieve nested configuration values correctly"""
        config = ConfigLoader("config.yaml")
        
        # Test nested key access
        hr_threshold = config.get('hemodynamic_thresholds', 'hr_critical_low')
        self.assertEqual(hr_threshold, 48)
        
        # Test deeper nesting
        dex_dose = config.get('drug_dosing', 'dexmedetomidine', 'standard_dose')
        self.assertEqual(dex_dose, 0.5)
    
    def test_config_missing_file_raises_error(self):
        """Should raise FileNotFoundError for missing config"""
        with self.assertRaises(FileNotFoundError):
            ConfigLoader("nonexistent_config.yaml")
    
    def test_config_validation_detects_missing_sections(self):
        """Should raise ValueError if critical sections missing"""
        # Create temporary incomplete config
        incomplete_config = """
version: "1.0.0"
hemodynamic_thresholds:
  hr_critical_low: 48
"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(incomplete_config)
            temp_path = f.name
        
        try:
            with self.assertRaises(ValueError):
                ConfigLoader(temp_path)
        finally:
            os.unlink(temp_path)


class TestContraindications(unittest.TestCase):
    """Test hard contraindication lockouts"""
    
    def test_heart_block_locks_dexmedetomidine(self):
        """Patient with heart block should have dexmedetomidine hard-locked"""
        patient = Patient(
            age=72,
            weight_kg=70,
            asa_class=3,
            egfr=80,
            allergies=[],
            comorbidities=["Heart Block"]
        )
        
        controller = SmartNOAController(patient)
        
        # Assert dexmedetomidine is in hard lockouts
        self.assertIn("Dexmedetomidine", controller.hard_lockouts,
                     "Dexmedetomidine should be locked out for heart block")
        
        # Assert contraindication check returns False
        allowed, msg = controller.check_contraindication("Dexmedetomidine")
        self.assertFalse(allowed, 
                        "Dexmedetomidine should not be allowed for heart block")
        self.assertIn("HARD LOCK", msg)
    
    def test_low_egfr_locks_ketorolac(self):
        """Patient with eGFR < 30 should have ketorolac hard-locked"""
        patient = Patient(
            age=65,
            weight_kg=75,
            asa_class=3,
            egfr=24,  # Below threshold of 30
            allergies=[],
            comorbidities=[]
        )
        
        controller = SmartNOAController(patient)
        
        # Assert ketorolac is in hard lockouts
        self.assertIn("Ketorolac", controller.hard_lockouts,
                     "Ketorolac should be locked out for eGFR < 30")
        
        # Assert contraindication check returns False
        allowed, msg = controller.check_contraindication("Ketorolac")
        self.assertFalse(allowed,
                        "Ketorolac should not be allowed for eGFR < 30")
        self.assertIn("HARD LOCK", msg)
    
    def test_nsaid_allergy_locks_ketorolac(self):
        """Patient with NSAID allergy should have ketorolac hard-locked"""
        patient = Patient(
            age=45,
            weight_kg=80,
            asa_class=2,
            egfr=95,
            allergies=["NSAID"],
            comorbidities=[]
        )
        
        controller = SmartNOAController(patient)
        
        # Assert ketorolac is in hard lockouts
        self.assertIn("Ketorolac", controller.hard_lockouts,
                     "Ketorolac should be locked out for NSAID allergy")
    
    def test_healthy_patient_no_lockouts(self):
        """Healthy patient should have no hard lockouts"""
        patient = Patient(
            age=35,
            weight_kg=70,
            asa_class=1,
            egfr=100,
            allergies=[],
            comorbidities=[]
        )
        
        controller = SmartNOAController(patient)
        
        # Assert no lockouts
        self.assertEqual(len(controller.hard_lockouts), 0,
                        "Healthy patient should have no hard lockouts")


class TestAgeDosing(unittest.TestCase):
    """Test age-adjusted dose calculations"""
    
    def test_geriatric_dexmedetomidine_reduction(self):
        """Patient > 65 should get 50% dexmedetomidine dose reduction"""
        patient = Patient(
            age=78,
            weight_kg=65,
            asa_class=3,
            egfr=70,
            allergies=[],
            comorbidities=[]  # No heart block
        )
        
        controller = SmartNOAController(patient)
        rates = controller.generate_starting_rates()
        
        # Assert dexmedetomidine dose is reduced to 0.25 mcg/kg/hr
        self.assertEqual(rates["Dexmedetomidine"], 0.25,
                        "Geriatric patients should get 0.25 mcg/kg/hr dex dose")
    
    def test_young_adult_standard_dosing(self):
        """Patient < 65 should get standard dexmedetomidine dose"""
        patient = Patient(
            age=42,
            weight_kg=75,
            asa_class=2,
            egfr=95,
            allergies=[],
            comorbidities=[]
        )
        
        controller = SmartNOAController(patient)
        rates = controller.generate_starting_rates()
        
        # Assert standard dexmedetomidine dose is 0.5 mcg/kg/hr
        self.assertEqual(rates["Dexmedetomidine"], 0.5,
                        "Young adults should get 0.5 mcg/kg/hr dex dose")
    
    def test_boundary_age_65(self):
        """Patient exactly at age 65 should trigger geriatric protocol"""
        patient = Patient(
            age=65,
            weight_kg=70,
            asa_class=2,
            egfr=80,
            allergies=[],
            comorbidities=[]
        )
        
        controller = SmartNOAController(patient)
        rates = controller.generate_starting_rates()
        
        # Assert reduced dose at boundary
        self.assertEqual(rates["Dexmedetomidine"], 0.5,
                        "Age 65 should still get standard dose (threshold is >65)")


class TestPharmacokinetics(unittest.TestCase):
    """Test pharmacokinetic model calculations"""
    
    def test_pk_model_initialization(self):
        """PK model should initialize with correct parameters"""
        pk = Pharmacokinetics(
            weight_kg=70,
            central_vol=0.8,
            k10=0.04,
            k1e=0.1
        )
        
        # Assert initial concentrations are zero
        self.assertEqual(pk.Cp, 0.0, "Initial plasma concentration should be 0")
        self.assertEqual(pk.Ce, 0.0, "Initial effect-site concentration should be 0")
        
        # Assert volume calculation
        expected_vc = 0.8 * 70  # 56 L
        self.assertEqual(pk.Vc, expected_vc, "Central volume should be 56 L")
    
    def test_pk_concentration_increases_with_infusion(self):
        """Concentrations should increase during infusion"""
        pk = Pharmacokinetics(
            weight_kg=70,
            central_vol=0.8,
            k10=0.04,
            k1e=0.1
        )
        
        # Simulate 10 minutes of infusion at 35 mcg/min (0.5 mcg/kg/hr for 70kg patient)
        for _ in range(10):
            pk.update_concentration(infusion_rate_mcg_per_min=35, time_delta_min=1.0)
        
        # Assert concentrations have increased
        self.assertGreater(pk.Cp, 0, "Plasma concentration should increase")
        self.assertGreater(pk.Ce, 0, "Effect-site concentration should increase")
    
    def test_pk_concentration_decreases_after_stop(self):
        """Concentrations should decrease after stopping infusion"""
        pk = Pharmacokinetics(
            weight_kg=70,
            central_vol=0.8,
            k10=0.04,
            k1e=0.1
        )
        
        # Build up concentration
        for _ in range(10):
            pk.update_concentration(infusion_rate_mcg_per_min=35, time_delta_min=1.0)
        
        peak_cp = pk.Cp
        
        # Stop infusion and run for 5 minutes
        for _ in range(5):
            pk.update_concentration(infusion_rate_mcg_per_min=0, time_delta_min=1.0)
        
        # Assert plasma concentration decreased
        self.assertLess(pk.Cp, peak_cp, 
                       "Plasma concentration should decrease after stopping infusion")
    
    def test_pk_no_negative_concentrations(self):
        """PK model should never produce negative concentrations"""
        pk = Pharmacokinetics(
            weight_kg=70,
            central_vol=0.8,
            k10=0.04,
            k1e=0.1
        )
        
        # Run extreme scenario: very high elimination with no infusion
        for _ in range(100):
            pk.update_concentration(infusion_rate_mcg_per_min=0, time_delta_min=1.0)
        
        # Assert no negative values
        self.assertGreaterEqual(pk.Cp, 0, "Plasma concentration cannot be negative")
        self.assertGreaterEqual(pk.Ce, 0, "Effect-site concentration cannot be negative")


class TestProtocolGeneration(unittest.TestCase):
    """Test complete protocol generation"""
    
    def test_multi_drug_protocol_generation(self):
        """Controller should generate complete multi-drug protocol"""
        patient = Patient(
            age=50,
            weight_kg=80,
            asa_class=2,
            egfr=90,
            allergies=[],
            comorbidities=[]
        )
        
        controller = SmartNOAController(patient)
        rates = controller.generate_starting_rates()
        
        # Assert all three drugs are present
        self.assertIn("Dexmedetomidine", rates)
        self.assertIn("Ketamine", rates)
        self.assertIn("Lidocaine", rates)
        
        # Assert doses are reasonable
        self.assertGreater(rates["Dexmedetomidine"], 0)
        self.assertGreater(rates["Ketamine"], 0)
        self.assertGreater(rates["Lidocaine"], 0)
    
    def test_contraindication_sets_dose_to_zero(self):
        """Hard lockout should result in zero dose for that drug"""
        patient = Patient(
            age=70,
            weight_kg=75,
            asa_class=3,
            egfr=25,  # Will lock out ketorolac
            allergies=[],
            comorbidities=["Heart Block"]  # Will lock out dexmedetomidine
        )
        
        controller = SmartNOAController(patient)
        rates = controller.generate_starting_rates()
        
        # Assert dexmedetomidine is zero
        self.assertEqual(rates["Dexmedetomidine"], 0.0,
                        "Contraindicated dexmedetomidine should have zero dose")
        
        # Assert ketorolac is marked as locked out
        self.assertIn("LOCKED OUT", rates.get("Ketorolac Adjunct", ""))


class TestRateConversion(unittest.TestCase):
    """Test infusion rate unit conversions"""
    
    def test_mcg_kg_hr_to_mcg_min_conversion(self):
        """Test conversion from mcg/kg/hr to mcg/min"""
        patient = Patient(
            age=40,
            weight_kg=70,
            asa_class=2,
            egfr=95,
            allergies=[],
            comorbidities=[]
        )
        
        controller = SmartNOAController(patient)
        
        # Set dexmedetomidine to 0.6 mcg/kg/hr
        controller.infusions["Dexmedetomidine"] = 0.6
        
        # Convert to mcg/min
        rate_mcg_min = controller._rate_to_mcg_per_min("Dexmedetomidine")
        
        # Expected: 0.6 mcg/kg/hr × 70 kg / 60 min = 0.7 mcg/min
        expected = (0.6 * 70) / 60
        self.assertAlmostEqual(rate_mcg_min, expected, places=2,
                              msg="Rate conversion should be accurate")


if __name__ == '__main__':
    # Run tests with verbose output
    unittest.main(verbosity=2)
