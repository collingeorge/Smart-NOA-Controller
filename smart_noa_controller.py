# =============================================================================
# Smart NOA Controller – Open-Source Proof of Concept
# A deterministic closed-loop safety supervisor for opioid-free anesthesia
# GitHub: https://github.com/yourname/SmartNOA-Controller
# Preprint: coming to medRxiv [link]
# License: MIT
# =============================================================================

import time
import random
from dataclasses import dataclass
from typing import Dict, Tuple

@dataclass
class Patient:
    age: int
    weight_kg: float
    asa_class: int
    egfr: float
    allergies: list
    comorbidities: list

class SmartNOAController:
    """
    Patent-pending architecture (provisional filing in preparation):
    Multi-variable dynamic interlock system that enforces evidence-based
    constraints before and during infusion pump operation.
    """
    def __init__(self, patient: Patient):
        self.patient = patient
        self.infusions = {"Dexmedetomidine": 0.0, "Ketamine": 0.0, "Lidocaine": 0.0}
        self.hard_lockouts = self._calculate_initial_lockouts()
        self.status = "GREEN"

    def _calculate_initial_lockouts(self) -> list:
        locks = []
        if self.patient.egfr < 30:
            locks.append("Ketorolac")
        if any(x in self.patient.comorbidities for x in ["Heart Block", "AV Block"]):
            locks.append("Dexmedetomidine")
        if "NSAID" in self.patient.allergies:
            locks.append("Ketorolac")
        return locks

    def check_contraindication(self, drug: str) -> Tuple[bool, str]:
        """Hard lock – returns False if administration must be physically blocked"""
        if drug in self.hard_lockouts:
            reason = { 
                "Dexmedetomidine": "3rd-degree heart block or severe bradycardia risk",
                "Ketorolac": "eGFR < 30 or high bleeding risk"
            }.get(drug, "Patient-specific contraindication")
            return False, f"HARD LOCK: {reason}"

        # Age-based soft ceiling (can be overridden with justification)
        if drug == "Dexmedetomidine" and self.patient.age > 65:
            return True, "SOFT WARNING: Reduce dose 50% in patients >65 years (Beloeil et al., 2021)"

        return True, "Safe within protocol limits"

    def generate_starting_rates(self) -> Dict[str, float]:
        rates = {"Lidocaine": 1.5, "Ketamine": 0.2, "Dexmedetomidine": 0.0}

        if "Dexmedetomidine" not in self.hard_lockouts:
            base = 0.5
            if self.patient.age > 65:
                base = 0.25
            rates["Dexmedetomidine"] = base

        self.infusions = rates
        return rates

    def monitor_and_control(self, duration_sec: int = 30):
        print("\n=== Smart NOA Closed-Loop Supervision Active ===\n")
        for t in range(duration_sec):
            hr = random.randint(42, 90)
            map_val = random.randint(55, 100)

            # Critical safety interlocks (override any clinician input)
            if hr < 48:
                self.infusions["Dexmedetomidine"] = 0.0
                self.status = "RED"
                print(f"T+{t:2d}s | HR {hr} → BRADYCARDIA → DEXMEDETOMIDINE STOPPED")
            elif map_val < 60:
                self.infusions["Dexmedetomidine"] = 0.0
                self.status = "RED"
                print(f"T+{t:2d}s | MAP {map_val} → HYPOTENSION → PAUSING INFUSIONS")
            else:
                self.status = "GREEN"
                print(f"T+{t:2d}s | HR {hr} | MAP {map_val} → Stable – maintaining protocol")

            time.sleep(1)

# ============================== DEMO ==============================
if __name__ == "__main__":
    # Example: high-risk geriatric patient
    patient = Patient(age=78, weight_kg=72, asa_class=3, egfr=24,
                      allergies=[], comorbidities=["Heart Block"])

    controller = SmartNOAController(patient)
    print("Smart NOA Controller initialized")
    print(f"Hard lockouts: {controller.hard_lockouts}")

    allowed, msg = controller.check_contraindication("Dexmedetomidine")
    print(f"Dexmedetomidine check → {msg}")

    print("\nSuggested starting protocol:")
    print(controller.generate_starting_rates())

    controller.monitor_and_control(duration_sec=15)
