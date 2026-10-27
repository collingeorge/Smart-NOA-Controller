# =============================================================================
# Smart NOA Controller – Educational Simulation Prototype
# A deterministic, rule-based educational simulation exploring safety interlock
# concepts for non-opioid anesthesia (NOA) protocols.
# NOT for clinical use. Educational portfolio project only.
# Author: Collin B. George (pre-medical student)
# =============================================================================

import time
import random
import math
import yaml
from dataclasses import dataclass
from typing import Dict, Tuple, List, Optional
from pathlib import Path

# --- Data Structures ---

@dataclass
class Patient:
    """
    Stores static simulated subject profile data for constraint and dose calculations.

    This is an educational simulation data structure — not real patient data.

    Attributes:
        age: Subject age in years (simulated)
        weight_kg: Subject weight in kilograms (simulated)
        asa_class: ASA Physical Status Classification (I-VI) (simulated)
        egfr: Estimated Glomerular Filtration Rate in mL/min/1.73m² (simulated)
        allergies: List of known drug allergies (simulated)
        comorbidities: List of relevant medical conditions (simulated)
    """
    age: int
    weight_kg: float
    asa_class: int
    egfr: float
    allergies: List[str]
    comorbidities: List[str]

    def __post_init__(self):
        if isinstance(self.age, bool) or not isinstance(self.age, int) or self.age < 0:
            raise ValueError("Simulated age must be a nonnegative integer")
        if isinstance(self.asa_class, bool) or not isinstance(self.asa_class, int) or not 1 <= self.asa_class <= 6:
            raise ValueError("Simulated ASA class must be an integer from 1 to 6")
        for name, value, positive in (("weight_kg", self.weight_kg, True), ("egfr", self.egfr, False)):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or (value <= 0 if positive else value < 0):
                raise ValueError(f"{name} must be finite and within the simulation input domain")
        for value in (self.allergies, self.comorbidities):
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                raise ValueError("Simulated allergies and comorbidities must be lists of strings")


# --- Configuration Loader ---

class ConfigLoader:
    """Loads and validates simulation configuration from YAML file."""
    
    def __init__(self, config_path: str = "config.yaml") -> None:
        """
        Initialize configuration loader.
        
        Args:
            config_path: Path to YAML configuration file
        """
        self.config_path = Path(config_path)
        self.config: Dict = self._load_config()
        self._validate_config()
    
    def _load_config(self) -> Dict:
        """
        Load configuration from YAML file.
        
        Returns:
            Dictionary containing all configuration parameters
            
        Raises:
            FileNotFoundError: If config file doesn't exist
            yaml.YAMLError: If config file is malformed
        """
        if not self.config_path.exists():
            raise FileNotFoundError(f"Configuration file not found: {self.config_path}")
        
        with open(self.config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        return config
    
    def _validate_config(self) -> None:
        """
        Validate that all required configuration sections exist.
        
        Raises:
            ValueError: If critical configuration sections are missing
        """
        if not isinstance(self.config, dict):
            raise ValueError("Configuration must be a mapping")
        required_sections = [
            'hemodynamic_thresholds',
            'pharmacokinetics',
            'drug_dosing',
            'contraindications'
        ]
        
        missing_sections = []
        for section in required_sections:
            if section not in self.config:
                missing_sections.append(section)
        
        if missing_sections:
            raise ValueError(
                f"Configuration missing required sections: {', '.join(missing_sections)}"
            )
    
        numeric_paths = {
            ('hemodynamic_thresholds', 'hr_critical_low'): True,
            ('hemodynamic_thresholds', 'map_critical_low'): True,
            ('pharmacokinetics', 'dexmedetomidine', 'central_volume_L_per_kg'): True,
            ('pharmacokinetics', 'dexmedetomidine', 'elimination_rate_constant_k10'): False,
            ('pharmacokinetics', 'dexmedetomidine', 'effect_site_transfer_k1e'): False,
            ('drug_dosing', 'dexmedetomidine', 'standard_dose'): False,
            ('drug_dosing', 'dexmedetomidine', 'geriatric_dose'): False,
            ('drug_dosing', 'dexmedetomidine', 'geriatric_age_threshold'): False,
            ('drug_dosing', 'ketamine', 'standard_dose'): False,
            ('drug_dosing', 'lidocaine', 'standard_dose'): False,
            ('contraindications', 'ketorolac', 'egfr_minimum'): False,
            ('age_adjustments', 'geriatric', 'age_threshold'): False,
        }
        for keys, positive in numeric_paths.items():
            value = self.get(*keys)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or (value <= 0 if positive else value < 0):
                raise ValueError("Invalid or missing simulation parameter: " + '.'.join(keys))
        for keys in [('contraindications', 'dexmedetomidine', 'cardiac_conditions'), ('contraindications', 'ketorolac', 'allergy_triggers')]:
            value = self.get(*keys)
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                raise ValueError("Expected a list of strings: " + '.'.join(keys))
        if self.get('age_adjustments', 'geriatric', 'age_threshold') != self.get('drug_dosing', 'dexmedetomidine', 'geriatric_age_threshold'):
            raise ValueError("Simulation age thresholds must agree")

    def get(self, *keys: str, default=None):
        """
        Get nested configuration value.
        
        Args:
            *keys: Nested keys to traverse (e.g., 'hemodynamic_thresholds', 'hr_critical_low')
            default: Default value if key not found
            
        Returns:
            Configuration value or default
        """
        value = self.config
        for key in keys:
            if isinstance(value, dict):
                value = value.get(key, default)
            else:
                return default
        return value


# --- Illustrative Pharmacokinetics ---

class Pharmacokinetics:
    """
    Implements an unvalidated one-compartment model with an effect site for the drug 
    concentration at the effect-site (Ce) over time, a crucial element for TCI.
    
    The model uses first-order kinetics with discrete-time updates suitable
    for educational discrete-time simulation only; this is not a TCI controller.
    """
    
    def __init__(self, 
                 weight_kg: float, 
                 central_vol: float, 
                 k10: float, 
                 k1e: float) -> None:
        """
        Initialize pharmacokinetic model.
        
        Args:
            weight_kg: Subject weight in kg (simulated)
            central_vol: Central compartment volume in L/kg
            k10: Elimination rate constant in 1/min
            k1e: Effect-site transfer rate constant in 1/min
        """
        for name, value in (("weight_kg", weight_kg), ("central_vol", central_vol)):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be finite and positive")
        for name, value in (("k10", k10), ("k1e", k1e)):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be finite and nonnegative")
        # Vc: Central Compartment Volume (L) - normalized by weight
        self.Vc: float = central_vol * weight_kg
        if not math.isfinite(self.Vc) or self.Vc <= 0:
            raise ValueError("Derived central volume must be finite and positive")
        self.k10: float = k10  # Elimination rate constant (1/min)
        self.k1e: float = k1e  # Effect-site transfer rate constant (1/min)

        # Initial concentrations (ng/mL)
        self.Cp: float = 0.0  # Plasma Concentration
        self.Ce: float = 0.0  # Effect-Site Concentration

    def update_concentration(self, 
                           infusion_rate_mcg_per_min: float, 
                           time_delta_min: float = 1.0) -> Tuple[float, float]:
        """
        Updates the estimated concentrations based on current infusion and time elapsed.
        
        Args:
            infusion_rate_mcg_per_min: Current infusion rate in mcg/min
            time_delta_min: Time step in minutes (default: 1.0)
            
        Returns:
            Tuple of (plasma_concentration, effect_site_concentration) in ng/mL
        """
        if isinstance(infusion_rate_mcg_per_min, bool) or not isinstance(infusion_rate_mcg_per_min, (int, float)) or not math.isfinite(infusion_rate_mcg_per_min) or infusion_rate_mcg_per_min < 0:
            raise ValueError("Infusion input must be finite and nonnegative")
        if isinstance(time_delta_min, bool) or not isinstance(time_delta_min, (int, float)) or not math.isfinite(time_delta_min) or time_delta_min <= 0:
            raise ValueError("Time step must be finite and positive")
        if max(self.k10, self.k1e) * time_delta_min > 1:
            raise ValueError("Time step exceeds this explicit Euler model stability bound")
        # 1 mcg/L equals 1 ng/mL. Compute into local candidates so invalid
        # arithmetic cannot partially mutate the model.
        for value in (self.Cp, self.Ce):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError("Model state must be finite and nonnegative")
        try:
            infusion_mass = infusion_rate_mcg_per_min * time_delta_min
            elimination_mass = self.Cp * self.k10 * self.Vc * time_delta_min
            new_mass = self.Cp * self.Vc + infusion_mass - elimination_mass
            cp_candidate = max(0.0, new_mass / self.Vc)
            # Sequential first-order update: the effect-site step uses new Cp.
            ce_candidate = self.Ce + self.k1e * (cp_candidate - self.Ce) * time_delta_min
        except (OverflowError, ZeroDivisionError) as error:
            raise ValueError("Model arithmetic exceeded the finite input domain") from error
        if not all(math.isfinite(value) for value in (infusion_mass, elimination_mass, new_mass, cp_candidate, ce_candidate)):
            raise ValueError("Model arithmetic exceeded the finite input domain")
        self.Cp, self.Ce = cp_candidate, max(0.0, ce_candidate)

        return (self.Cp, self.Ce)


# --- The Smart Controller (The Core Logic Engine) ---

class SmartNOAController:
    """
    Manages static constraints and dynamic physiological control simulation.

    Educational prototype: multi-variable dynamic interlock system that
    demonstrates incomplete configured rule checks.
    NOT for clinical use.
    """
    
    def __init__(self, patient: Patient, config_path: str = "config.yaml") -> None:
        """
        Initialize Smart NOA Controller.
        
        Args:
            patient: Patient object with simulated demographic and profile data
            config_path: Path to configuration YAML file
        """
        if not math.isfinite(patient.weight_kg) or patient.weight_kg <= 0:
            raise ValueError("Simulated weight must be finite and positive")
        self.patient: Patient = patient
        self.config: ConfigLoader = ConfigLoader(config_path)
        
        # Infusion rates are stored in mcg/kg/h or mg/kg/h
        self.infusions: Dict[str, float] = {
            "Dexmedetomidine": 0.0, 
            "Ketamine": 0.0, 
            "Lidocaine": 0.0
        }
        
        self.hard_lockouts: List[str] = self._calculate_initial_lockouts()
        self.status: str = "INITIALIZING"
        self.hold_latched = False

        # Initialize PK model for Dexmedetomidine
        self.dex_pk: Pharmacokinetics = self._initialize_pk_model()
        
        print(f"Controller Initialized for {self.patient.age}yo, {self.patient.weight_kg}kg.")
        print(f"Hard Lockouts Enabled: {self.hard_lockouts}")

    def _initialize_pk_model(self) -> Pharmacokinetics:
        """
        Initialize pharmacokinetic model with parameters from config.
        
        Returns:
            Configured Pharmacokinetics instance for dexmedetomidine
        """
        pk_params = self.config.get('pharmacokinetics', 'dexmedetomidine')
        
        return Pharmacokinetics(
            weight_kg=self.patient.weight_kg,
            central_vol=pk_params['central_volume_L_per_kg'],
            k10=pk_params['elimination_rate_constant_k10'],
            k1e=pk_params['effect_site_transfer_k1e']
        )

    def _calculate_initial_lockouts(self) -> List[str]:
        """
        Phase 1: Generates example lockouts; not a complete clinical assessment.
        
        Returns:
            List of drug names that are hard-locked for this simulated profile
        """
        locks: List[str] = []
        
        # Load contraindication criteria from config
        ci_dex = self.config.get('contraindications', 'dexmedetomidine')
        ci_keto = self.config.get('contraindications', 'ketorolac')
        
        # Renal Failure: Contraindicates NSAIDs (Ketorolac)
        egfr_min = ci_keto['egfr_minimum']
        if self.patient.egfr < egfr_min:
            locks.append("Ketorolac")
        
        # Cardiac Risk: Contraindicates alpha-2 agonists (Dexmedetomidine)
        cardiac_conditions = ci_dex['cardiac_conditions']
        if any(x in self.patient.comorbidities for x in cardiac_conditions):
            locks.append("Dexmedetomidine")
        
        # Allergy Check
        allergy_triggers = ci_keto['allergy_triggers']
        if any(allergen in self.patient.allergies for allergen in allergy_triggers):
            locks.append("Ketorolac")
        
        return locks

    def check_contraindication(self, drug: str) -> Tuple[bool, str]:
        """
        Verifies if a specific drug is allowed by the safety logic.
        
        Args:
            drug: Drug name to check
            
        Returns:
            Tuple of (is_allowed, reason_message)
        """
        supported = {"Dexmedetomidine", "Ketamine", "Lidocaine", "Ketorolac"}
        if drug not in supported:
            return False, "UNASSESSED: no simulation rule for this drug"
        if drug in self.hard_lockouts:
            reason = { 
                "Dexmedetomidine": "Configured cardiac-condition example; incomplete clinical assessment",
                "Ketorolac": "Configured renal-threshold or allergy example; incomplete clinical assessment"
            }.get(drug, "Profile-specific contraindication")
            return False, f"HARD LOCK: {reason}"

        # Soft Ceiling (Warning — in a real system, licensed clinician override would be possible)
        age_threshold = self.config.get('age_adjustments', 'geriatric', 'age_threshold')
        if drug == "Dexmedetomidine" and self.patient.age > age_threshold:
            return True, f"SOFT WARNING: Geriatric patient (>{age_threshold}yo). Illustrative age-adjusted configuration applies; no clinical dose recommendation."

        return True, "No configured lockout triggered; clinical safety is unassessed"

    def generate_starting_rates(self) -> Dict[str, float]:
        """
        Phase 2: Returns illustrative simulation rates, not clinical doses.
        
        Returns:
            Dictionary of drug names to starting infusion rates
        """
        # Load standard doses from config
        dex_config = self.config.get('drug_dosing', 'dexmedetomidine')
        keto_config = self.config.get('drug_dosing', 'ketamine')
        lido_config = self.config.get('drug_dosing', 'lidocaine')
        
        # Standard starting rates (mcg/kg/h or mg/kg/h)
        rates: Dict[str, float] = {
            "Lidocaine": lido_config['standard_dose'],
            "Ketamine": keto_config['standard_dose'],
            "Dexmedetomidine": dex_config['standard_dose']
        }

        # Apply configured simulation constraints
        if "Dexmedetomidine" in self.hard_lockouts:
            rates["Dexmedetomidine"] = 0.0
        elif self.patient.age > dex_config['geriatric_age_threshold']:
            # Apply soft warning reduction
            rates["Dexmedetomidine"] = dex_config['geriatric_dose']

        # Check Ketorolac (Postoperative adjunct)
        ketorolac_status = "No configured lockout; administration is not modeled"
        if "Ketorolac" in self.hard_lockouts:
            ketorolac_status = "LOCKED OUT (CI)"
        rates["Ketorolac Adjunct"] = ketorolac_status  # type: ignore

        if self.hold_latched:
            rates.update({drug: 0.0 for drug in self.infusions})
        self.infusions = {k: v for k, v in rates.items() if isinstance(v, (int, float))}
        return rates

    # --- Real-Time Control Loop Methods ---

    def _rate_to_mcg_per_min(self, drug: str) -> float:
        """
        Helper to convert infusion rate (mcg/kg/h) to PK model input (mcg/min).
        
        Args:
            drug: Drug name
            
        Returns:
            Infusion rate in mcg/min
        """
        if drug != "Dexmedetomidine":
            raise ValueError("This conversion is implemented only for the dexmedetomidine simulation")
        rate_mcg_per_hour = self.infusions.get(drug, 0.0)
        # Assuming the rate is in mcg/kg/h
        rate_mcg_per_min = (rate_mcg_per_hour * self.patient.weight_kg) / 60.0
        return rate_mcg_per_min

    def monitor_and_control(self, duration_sec: int = 30) -> None:
        """
        Phase 3: Simulates the closed-loop feedback system.
        Reads synthetic values, updates an unvalidated model, and changes in-memory values.
        
        Args:
            duration_sec: Duration of monitoring simulation in seconds
        """
        if isinstance(duration_sec, bool) or not isinstance(duration_sec, int) or duration_sec < 0:
            raise ValueError("Simulation duration must be a nonnegative integer")
        print("\n=== Smart NOA educational simulation (unvalidated model) ===")
        print("Monitoring Dexmedetomidine Concentration and Hemodynamics.")
        
        # Load thresholds from config
        hr_threshold = self.config.get('hemodynamic_thresholds', 'hr_critical_low')
        map_threshold = self.config.get('hemodynamic_thresholds', 'map_critical_low')
        # Alerts do not depend on an unvalidated concentration threshold.
        
        time_step_min = 1/60.0  # Each loop iteration represents 1 second (1/60th of a minute)
        
        for t in range(duration_sec):
            # 1. Simulate data feed from vital signs monitor (educational simulation)
            hr = random.randint(40, 95)
            map_val = random.randint(50, 105)
            
            # 2. Update PK Model (How much drug is hitting the effect site?)
            dex_rate_mcg_min = self._rate_to_mcg_per_min("Dexmedetomidine")
            self.dex_pk.update_concentration(dex_rate_mcg_min, time_delta_min=time_step_min)
            
            dex_ce = self.dex_pk.Ce
            
            # 3. Dynamic Safety Interlocks (Educational Simulation Logic)
            
            # Example rule A: low simulated heart rate, independent of model concentration
            if hr < hr_threshold:
                self.hold_latched = True
                self.infusions["Dexmedetomidine"] = 0.0
                self.status = "RED"
                print(f"T+{t:2d}s | HR {hr} | Ce: {dex_ce:.2f} → SIMULATED LOW HR → DEX VALUE SET TO ZERO")
            
            # Interlock B: Critical Hypotension
            if map_val < map_threshold:
                self.hold_latched = True
                for drug in ["Dexmedetomidine", "Lidocaine"]:
                    self.infusions[drug] = 0.0
                self.status = "RED"
                print(f"T+{t:2d}s | MAP {map_val} | Ce: {dex_ce:.2f} → HYPOTENSION → PAUSING KEY INFUSIONS")
            
            # A latched hold persists; there is no automatic restart policy.
            elif self.hold_latched and hr >= hr_threshold:
                self.status = "HOLD"
                print(f"T+{t:2d}s | SIMULATION HOLD remains latched; no automatic restart.")
            elif not self.hold_latched:
                self.status = "GREEN"
                print(f"T+{t:2d}s | HR {hr} | MAP {map_val} | Model Ce: {dex_ce:.2f} | No configured alert.")

            time.sleep(1)


# ============================== DEMO EXECUTION ==============================
if __name__ == "__main__":
    # ----------------------------------------------------
    # Scenario 1: High-Risk Geriatric Profile (78yo, Renal + Heart Block)
    # The system should LOCK OUT Dexmedetomidine and Ketorolac instantly.
    # ----------------------------------------------------
    print("\n--- RUNNING SCENARIO 1: HIGH-RISK GERIATRIC PROFILE ---")
    patient_a = Patient(
        age=78, 
        weight_kg=72, 
        asa_class=3, 
        egfr=24,
        allergies=[], 
        comorbidities=["Heart Block", "History of Renal Failure"]
    )

    controller_a = SmartNOAController(patient_a)

    # Check simulated pre-operative constraints
    allowed_dex, msg_dex = controller_a.check_contraindication("Dexmedetomidine")
    allowed_keto, msg_keto = controller_a.check_contraindication("Ketorolac")
    print(f"Dex Check: {msg_dex}")
    print(f"Keto Check: {msg_keto}")

    # Display Calculated Protocol
    print("\nCalculated Starting Protocol:")
    print(controller_a.generate_starting_rates())
    
    # Run the simulation loop (it will try to run without Dex)
    print("\n--- Starting Simulation for Scenario 1 (No Dex running) ---")
    controller_a.monitor_and_control(duration_sec=15)

    # ----------------------------------------------------
    # Scenario 2: Healthy Young Adult Profile (30yo)
    # The system should allow full protocol rates and respond dynamically.
    # ----------------------------------------------------
    print("\n\n--- RUNNING SCENARIO 2: HEALTHY YOUNG ADULT PROFILE ---")
    patient_b = Patient(
        age=30, 
        weight_kg=85, 
        asa_class=2, 
        egfr=95,
        allergies=[], 
        comorbidities=[]
    )
    
    controller_b = SmartNOAController(patient_b)
    
    # Display Calculated Protocol (full rate for Dex)
    print("\nCalculated Starting Protocol:")
    rates_b = controller_b.generate_starting_rates()
    print(rates_b)
    
    # Set the Dex infusion rate for the dynamic loop
    controller_b.infusions["Dexmedetomidine"] = rates_b.get("Dexmedetomidine", 0.0)

    # Run the simulation loop
    print("\n--- Starting Simulation for Scenario 2 (Full Dex rate running) ---")
    controller_b.monitor_and_control(duration_sec=20)
