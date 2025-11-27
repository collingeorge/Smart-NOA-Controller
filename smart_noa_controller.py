# =============================================================================
# Smart NOA Controller – Closed-Loop System Prototype
# A deterministic, safety-focused system for Non-Opioid Anesthesia (NOA) delivery.
# Features: Initial constraint-based protocol generation and dynamic PK/PD-informed control.
# =============================================================================

import time
import random
from dataclasses import dataclass
from typing import Dict, Tuple, List

# --- Data Structures ---

@dataclass
class Patient:
    """Stores static patient data used for calculating initial constraints and doses."""
    age: int
    weight_kg: float
    asa_class: int
    egfr: float # Estimated Glomerular Filtration Rate (mL/min)
    allergies: List[str]
    comorbidities: List[str]

# --- Core TCI Logic (Pharmacokinetics) ---

class Pharmacokinetics:
    """
    Implements a simplified three-compartment model to estimate the drug 
    concentration at the effect-site (Ce) over time, a crucial element for TCI.
    NOTE: Constants Vc, k10, k1e are placeholders for literature-derived values.
    """
    def __init__(self, weight_kg: float, central_vol: float, k10: float, k1e: float):
        # Vc: Central Compartment Volume (L) - normalized by weight
        self.Vc = central_vol * weight_kg
        self.k10 = k10  # Elimination rate constant (1/min)
        self.k1e = k1e  # Effect-site transfer rate constant (1/min)

        # Initial concentrations (ng/mL)
        self.Cp = 0.0  # Plasma Concentration
        self.Ce = 0.0  # Effect-Site Concentration

    def update_concentration(self, infusion_rate_mcg_per_min: float, time_delta_min: float = 1.0):
        """
        Updates the estimated concentrations based on current infusion and time elapsed.
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

# --- The Smart Controller (The Core Logic Engine) ---

class SmartNOAController:
    """
    Manages static constraints and dynamic physiological control (the "brain").
    """
    def __init__(self, patient: Patient):
        self.patient = patient
        # Infusion rates are stored in mcg/kg/h
        self.infusions: Dict[str, float] = {"Dexmedetomidine": 0.0, "Ketamine": 0.0, "Lidocaine": 0.0}
        self.hard_lockouts: List[str] = self._calculate_initial_lockouts()
        self.status: str = "INITIALIZING"

        # Initialize PK model for Dexmedetomidine (The most common cause of hypotension/bradycardia)
        self.dex_pk = Pharmacokinetics(
            weight_kg=patient.weight_kg, 
            central_vol=0.8, # Placeholder: 0.8 L/kg 
            k10=0.04,        # Placeholder: 0.04 1/min (elimination)
            k1e=0.1          # Placeholder: 0.1 1/min (effect site transfer)
        )
        print(f"Controller Initialized for {self.patient.age}yo, {self.patient.weight_kg}kg.")
        print(f"Hard Lockouts Enabled: {self.hard_lockouts}")


    def _calculate_initial_lockouts(self) -> List[str]:
        """Phase 1: Generates the list of drugs that are absolutely contraindicated."""
        locks = []
        # Renal Failure: Contraindicates NSAIDs (Ketorolac)
        if self.patient.egfr < 30:
            locks.append("Ketorolac")
        # Cardiac Risk: Contraindicates alpha-2 agonists (Dexmedetomidine)
        if any(x in self.patient.comorbidities for x in ["Heart Block", "AV Block", "Severe Bradycardia"]):
            locks.append("Dexmedetomidine")
        # Allergy Check
        if "NSAID" in self.patient.allergies or "Ketorolac" in self.patient.allergies:
            locks.append("Ketorolac")
        return locks

    def check_contraindication(self, drug: str) -> Tuple[bool, str]:
        """Verifies if a specific drug is allowed by the safety logic."""
        if drug in self.hard_lockouts:
            reason = { 
                "Dexmedetomidine": "3rd-degree heart block or severe bradycardia risk (ASA/ESRA Guideline)",
                "Ketorolac": "Severe renal impairment (eGFR < 30) or known allergy"
            }.get(drug, "Patient-specific contraindication")
            return False, f"HARD LOCK: {reason}"

        # Soft Ceiling (Warning, but clinician override is possible)
        if drug == "Dexmedetomidine" and self.patient.age > 65:
            return True, "SOFT WARNING: Geriatric patient (>65yo). Suggest 50% max dose reduction."

        return True, "Safe within protocol limits"

    def generate_starting_rates(self) -> Dict[str, float]:
        """Phase 2: Calculates the evidence-based starting protocol."""
        # Standard starting rates (mcg/kg/h or mg/kg/h)
        rates = {"Lidocaine": 1.5, "Ketamine": 0.2, "Dexmedetomidine": 0.5}

        # Apply calculated constraints from the NOA Master Protocol
        if "Dexmedetomidine" in self.hard_lockouts:
            rates["Dexmedetomidine"] = 0.0
        elif self.patient.age > 65:
            # Apply soft warning reduction
            rates["Dexmedetomidine"] = 0.25 # 50% reduction for geriatric population

        # Check Ketorolac (Postoperative adjunct)
        ketorolac_status = "Available (30mg IV)"
        if "Ketorolac" in self.hard_lockouts:
             ketorolac_status = "LOCKED OUT (CI)"
        rates["Ketorolac Adjunct"] = ketorolac_status

        self.infusions = {k: v for k, v in rates.items() if isinstance(v, float)}
        return rates

    # --- Real-Time Control Loop Methods ---

    def _rate_to_mcg_per_min(self, drug: str) -> float:
        """Helper to convert infusion rate (mcg/kg/h) to PK model input (mcg/min)."""
        rate_mcg_per_hour = self.infusions.get(drug, 0.0)
        # Assuming the rate is in mcg/kg/h
        rate_mcg_per_min = (rate_mcg_per_hour * self.patient.weight_kg) / 60.0
        return rate_mcg_per_min

    def monitor_and_control(self, duration_sec: int = 30):
        """
        Phase 3: Simulates the closed-loop feedback system.
        Reads simulated hemodynamics, updates PK model, and adjusts pump rates.
        """
        print("\n=== Smart NOA Closed-Loop Supervision Active (TCI Mode) ===")
        print("Monitoring Dexmedetomidine Concentration and Hemodynamics.")
        
        time_step_min = 1/60.0 # Each loop iteration represents 1 second (1/60th of a minute)
        
        for t in range(duration_sec):
            # 1. Simulate data feed from Patient Monitor
            hr = random.randint(40, 95)
            map_val = random.randint(50, 105)
            
            # 2. Update PK Model (How much drug is hitting the effect site?)
            dex_rate_mcg_min = self._rate_to_mcg_per_min("Dexmedetomidine")
            self.dex_pk.update_concentration(dex_rate_mcg_min, time_delta_min=time_step_min)
            
            dex_ce = self.dex_pk.Ce
            
            # 3. Dynamic Safety Interlocks (The Patentable Logic)
            
            # Interlock A: Severe Bradycardia
            # ONLY intervene if HR is critically low AND drug effect (Ce) is significant.
            if hr < 48 and dex_ce > 0.1: # Threshold Ce > 0.1 ng/mL
                # Hard lock: Immediately set pump rate to zero
                self.infusions["Dexmedetomidine"] = 0.0
                self.status = "RED"
                print(f"T+{t:2d}s | HR {hr} | Ce: {dex_ce:.2f} → BRADYCARDIA & HIGH Ce → DEX STOPPED")
            
            # Interlock B: Critical Hypotension
            elif map_val < 60:
                # This affects all drugs known to cause vasodilation
                for drug in ["Dexmedetomidine", "Lidocaine"]:
                    self.infusions[drug] = 0.0
                self.status = "RED"
                print(f"T+{t:2d}s | MAP {map_val} | Ce: {dex_ce:.2f} → HYPOTENSION → PAUSING KEY INFUSIONS")
            
            # Stable State: Maintain the calculated protocol rates
            else:
                # When stable, ensure pumps are running at the target rate (re-engage pumps if paused)
                if self.status != "GREEN":
                    print(f"T+{t:2d}s | Vitals Stabilized. Resuming Protocol.")
                    self.infusions = {k: v for k, v in self.generate_starting_rates().items() if isinstance(v, float)}

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
    patient_a = Patient(age=78, weight_kg=72, asa_class=3, egfr=24,
                      allergies=[], comorbidities=["Heart Block", "History of Renal Failure"])

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
    patient_b = Patient(age=30, weight_kg=85, asa_class=2, egfr=95,
                      allergies=[], comorbidities=[])
    
    controller_b = SmartNOAController(patient_b)
    
    # Display Calculated Protocol (full rate for Dex)
    print("\nCalculated Starting Protocol:")
    rates_b = controller_b.generate_starting_rates()
    print(rates_b)
    
    # Set the Dex infusion rate for the dynamic loop
    controller_b.infusions["Dexmedetomidine"] = rates_b.get("Dexmedetomidine", 0.0)

    # Run the simulation loop (it should run normally and then potentially trigger safety lockouts)
    print("\n--- Starting Simulation for Case 2 (Full Dex rate running) ---")
    controller_b.monitor_and_control(duration_sec=20)
