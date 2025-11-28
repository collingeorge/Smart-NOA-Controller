# =============================================================================
# Smart NOA Controller – Closed-Loop System Prototype
# A deterministic, safety-focused system for Non-Opioid Anesthesia (NOA) delivery.
# Features: Initial constraint-based protocol generation and dynamic PK/PD-informed control.
# =============================================================================

import time
import random
import yaml
from dataclasses import dataclass
from typing import Dict, Tuple, List, Optional
from pathlib import Path

# --- Data Structures ---

@dataclass
class Patient:
    """
    Stores static patient data used for calculating initial constraints and doses.
    
    Attributes:
        age: Patient age in years
        weight_kg: Patient weight in kilograms
        asa_class: ASA Physical Status Classification (I-VI)
        egfr: Estimated Glomerular Filtration Rate in mL/min/1.73m²
        allergies: List of known drug allergies
        comorbidities: List of relevant medical conditions
    """
    age: int
    weight_kg: float
    asa_class: int
    egfr: float
    allergies: List[str]
    comorbidities: List[str]


# --- Configuration Loader ---

class ConfigLoader:
    """Loads and validates clinical configuration from YAML file."""
    
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
        
        with open(self.config_path, 'r') as f:
            config = yaml.safe_load(f)
        
        return config
    
    def _validate_config(self) -> None:
        """
        Validate that all required configuration sections exist.
        
        Raises:
            ValueError: If critical configuration sections are missing
        """
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


# --- Core TCI Logic (Pharmacokinetics) ---

class Pharmacokinetics:
    """
    Implements a simplified three-compartment model to estimate the drug 
    concentration at the effect-site (Ce) over time, a crucial element for TCI.
    
    The model uses first-order kinetics with discrete-time updates suitable
    for real-time monitoring at 1-second intervals.
    """
    
    def __init__(self, 
                 weight_kg: float, 
                 central_vol: float, 
                 k10: float, 
                 k1e: float) -> None:
        """
        Initialize pharmacokinetic model.
        
        Args:
            weight_kg: Patient weight in kg
            central_vol: Central compartment volume in L/kg
            k10: Elimination rate constant in 1/min
            k1e: Effect-site transfer rate constant in 1/min
        """
        # Vc: Central Compartment Volume (L) - normalized by weight
        self.Vc: float = central_vol * weight_kg
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
        # --- 1. Plasma (Cp) Update ---
        # Mass of drug infused over the time period
        infusion_mass_mcg = infusion_rate_mcg_per_min * time_delta_min

        # Mass of drug eliminated from the central compartment
        elim_mass_mcg = self.Cp * self.k10 * self.Vc * time_delta_min

        # Calculate new mass and concentration in central compartment
        mass_change = infusion_mass_mcg - elim_mass_mcg
        new_mass = (self.Cp * self.Vc) + mass_change

        # Prevent negative concentrations
        if new_mass < 0:
            self.Cp = 0.0
        else:
            self.Cp = new_mass / self.Vc

        # --- 2. Effect-Site (Ce) Update ---
        # Rate of change in Ce is proportional to the concentration gradient (Cp - Ce)
        dCe_dt = self.k1e * (self.Cp - self.Ce)
        self.Ce += dCe_dt * time_delta_min
        
        # Ce must also not be negative
        if self.Ce < 0:
            self.Ce = 0.0
        
        return (self.Cp, self.Ce)


# --- The Smart Controller (The Core Logic Engine) ---

class SmartNOAController:
    """
    Manages static constraints and dynamic physiological control (the "brain").
    
    This is the patentable core: multi-variable dynamic interlock system that
    enforces evidence-based constraints before and during infusion pump operation.
    """
    
    def __init__(self, patient: Patient, config_path: str = "config.yaml") -> None:
        """
        Initialize Smart NOA Controller.
        
        Args:
            patient: Patient object with demographic and clinical data
            config_path: Path to configuration YAML file
        """
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
        Phase 1: Generates the list of drugs that are absolutely contraindicated.
        
        Returns:
            List of drug names that are hard-locked for this patient
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
        if drug in self.hard_lockouts:
            reason = { 
                "Dexmedetomidine": "3rd-degree heart block or severe bradycardia risk (ASA/ESRA Guideline)",
                "Ketorolac": "Severe renal impairment (eGFR < 30) or known allergy"
            }.get(drug, "Patient-specific contraindication")
            return False, f"HARD LOCK: {reason}"

        # Soft Ceiling (Warning, but clinician override is possible)
        age_threshold = self.config.get('age_adjustments', 'geriatric', 'age_threshold')
        if drug == "Dexmedetomidine" and self.patient.age > age_threshold:
            return True, f"SOFT WARNING: Geriatric patient (>{age_threshold}yo). Suggest 50% max dose reduction."

        return True, "Safe within protocol limits"

    def generate_starting_rates(self) -> Dict[str, float]:
        """
        Phase 2: Calculates the evidence-based starting protocol.
        
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

        # Apply calculated constraints from the NOA Master Protocol
        if "Dexmedetomidine" in self.hard_lockouts:
            rates["Dexmedetomidine"] = 0.0
        elif self.patient.age > dex_config['geriatric_age_threshold']:
            # Apply soft warning reduction
            rates["Dexmedetomidine"] = dex_config['geriatric_dose']

        # Check Ketorolac (Postoperative adjunct)
        ketorolac_status = "Available (30mg IV)"
        if "Ketorolac" in self.hard_lockouts:
            ketorolac_status = "LOCKED OUT (CI)"
        rates["Ketorolac Adjunct"] = ketorolac_status  # type: ignore

        self.infusions = {k: v for k, v in rates.items() if isinstance(v, float)}
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
        rate_mcg_per_hour = self.infusions.get(drug, 0.0)
        # Assuming the rate is in mcg/kg/h
        rate_mcg_per_min = (rate_mcg_per_hour * self.patient.weight_kg) / 60.0
        return rate_mcg_per_min

    def monitor_and_control(self, duration_sec: int = 30) -> None:
        """
        Phase 3: Simulates the closed-loop feedback system.
        Reads simulated hemodynamics, updates PK model, and adjusts pump rates.
        
        Args:
            duration_sec: Duration of monitoring simulation in seconds
        """
        print("\n=== Smart NOA Closed-Loop Supervision Active (TCI Mode) ===")
        print("Monitoring Dexmedetomidine Concentration and Hemodynamics.")
        
        # Load thresholds from config
        hr_threshold = self.config.get('hemodynamic_thresholds', 'hr_critical_low')
        map_threshold = self.config.get('hemodynamic_thresholds', 'map_critical_low')
        ce_threshold = self.config.get('pharmacokinetics', 'dexmedetomidine', 
                                      'ce_intervention_threshold')
        
        time_step_min = 1/60.0  # Each loop iteration represents 1 second (1/60th of a minute)
        
        for t in range(duration_sec):
            # 1. Simulate data feed from Patient Monitor
            hr = random.randint(40, 95)
            map_val = random.randint(50, 105)
            
            # 2. Update PK Model (How much drug is hitting the effect site?)
            dex_rate_mcg_min = self._rate_to_mcg_per_min("Dexmedetomidine")
            self.dex_pk.update_concentration(dex_rate_mcg_min, time_delta_min=time_step_min)
            
            dex_ce = self.dex_pk.Ce
            
            # 3. Dynamic Safety Interlocks (The Patentable Logic)
            
            # Interlock A: Severe Bradycardia with high drug concentration
            if hr < hr_threshold and dex_ce > ce_threshold:
                self.infusions["Dexmedetomidine"] = 0.0
                self.status = "RED"
                print(f"T+{t:2d}s | HR {hr} | Ce: {dex_ce:.2f} → BRADYCARDIA & HIGH Ce → DEX STOPPED")
            
            # Interlock B: Critical Hypotension
            elif map_val < map_threshold:
                for drug in ["Dexmedetomidine", "Lidocaine"]:
                    self.infusions[drug] = 0.0
                self.status = "RED"
                print(f"T+{t:2d}s | MAP {map_val} | Ce: {dex_ce:.2f} → HYPOTENSION → PAUSING KEY INFUSIONS")
            
            # Stable State: Maintain the calculated protocol rates
            else:
                if self.status != "GREEN":
                    print(f"T+{t:2d}s | Vitals Stabilized. Resuming Protocol.")
                    self.infusions = {k: v for k, v in self.generate_starting_rates().items() 
                                    if isinstance(v, float)}

                self.status = "GREEN"
                print(f"T+{t:2d}s | HR {hr} | MAP {map_val} | Dex Ce: {dex_ce:.2f} → Stable. Protocol Active.")

            time.sleep(1)


# ============================== DEMO EXECUTION ==============================
if __name__ == "__main__":
    # ----------------------------------------------------
    # Case 1: High-Risk Geriatric Patient (78yo, Renal + Heart Block)
    # The system should LOCK OUT Dexmedetomidine and Ketorolac instantly.
    # ----------------------------------------------------
    print("\n--- RUNNING CASE 1: HIGH-RISK GERIATRIC PATIENT ---")
    patient_a = Patient(
        age=78, 
        weight_kg=72, 
        asa_class=3, 
        egfr=24,
        allergies=[], 
        comorbidities=["Heart Block", "History of Renal Failure"]
    )

    controller_a = SmartNOAController(patient_a)

    # Check Pre-Operative Constraints
    allowed_dex, msg_dex = controller_a.check_contraindication("Dexmedetomidine")
    allowed_keto, msg_keto = controller_a.check_contraindication("Ketorolac")
    print(f"Dex Check: {msg_dex}")
    print(f"Keto Check: {msg_keto}")

    # Display Calculated Protocol
    print("\nCalculated Starting Protocol:")
    print(controller_a.generate_starting_rates())
    
    # Run the simulation loop (it will try to run without Dex)
    print("\n--- Starting Simulation for Case 1 (No Dex running) ---")
    controller_a.monitor_and_control(duration_sec=15)

    # ----------------------------------------------------
    # Case 2: Healthy Young Adult (30yo)
    # The system should allow full protocol rates and respond dynamically.
    # ----------------------------------------------------
    print("\n\n--- RUNNING CASE 2: HEALTHY YOUNG ADULT ---")
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
    print("\n--- Starting Simulation for Case 2 (Full Dex rate running) ---")
    controller_b.monitor_and_control(duration_sec=20)
