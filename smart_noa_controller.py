# =============================================================================
# Smart NOA Controller – Educational Simulation Prototype
# A deterministic, rule-based educational simulation exploring safety interlock
# concepts for non-opioid anesthesia (NOA) protocols.
# NOT for clinical use. Educational portfolio project only.
# Author: Collin B. George (pre-medical student)
# =============================================================================

import math
import random
import time
from dataclasses import dataclass
from pathlib import Path

import yaml

# Absolute tolerance for "rate above the simulation ceiling", in the ceiling's own unit
# (mcg/kg/h or mg/kg/h). A rate equal to the ceiling, or within float noise of it, is allowed.
# The web simulator uses the same value (simulator/engine/interlocks.js RATE_CEILING_EPS; a parity
# test keeps them equal).
RATE_CEILING_TOLERANCE = 1e-9

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
    allergies: list[str]
    comorbidities: list[str]

    def __post_init__(self):
        if isinstance(self.age, bool) or not isinstance(self.age, int) or not 0 <= self.age <= 120:
            raise ValueError("Simulated age must be an integer from 0 to 120")
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
        self.config: dict = self._load_config()
        self._validate_config()

    def _load_config(self) -> dict:
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

        with open(self.config_path, encoding='utf-8') as f:
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
            'contraindications',
            'simulation_rate_ceilings'
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
            ('simulation_rate_ceilings', 'Dexmedetomidine'): False,
            ('simulation_rate_ceilings', 'Ketamine'): False,
            ('simulation_rate_ceilings', 'Lidocaine'): False,
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
        # A configured starting value may never exceed the simulation ceiling for that agent.
        for drug, key in (('Dexmedetomidine', 'dexmedetomidine'), ('Ketamine', 'ketamine'), ('Lidocaine', 'lidocaine')):
            ceiling = self.get('simulation_rate_ceilings', drug)
            for field in ('standard_dose', 'geriatric_dose'):
                value = self.get('drug_dosing', key, field)
                if value is not None and value > ceiling:
                    raise ValueError(f"drug_dosing.{key}.{field} ({value}) exceeds simulation_rate_ceilings.{drug} ({ceiling})")

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
                           time_delta_min: float = 1.0) -> tuple[float, float]:
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
        self.infusions: dict[str, float] = {
            "Dexmedetomidine": 0.0,
            "Ketamine": 0.0,
            "Lidocaine": 0.0
        }

        self.hard_lockouts: list[str] = self._calculate_initial_lockouts()
        self.status: str = "INITIALIZING"
        self.hold_latched = False
        # Agents zeroed by a hold stay at zero for as long as the hold is latched.
        self.held_drugs: set = set()

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

    def _calculate_initial_lockouts(self) -> list[str]:
        """
        Phase 1: Generates example lockouts; not a complete clinical assessment.

        Returns:
            List of drug names that are hard-locked for this simulated profile
        """
        locks: list[str] = []

        # Load contraindication criteria from config
        ci_dex = self.config.get('contraindications', 'dexmedetomidine')
        ci_keto = self.config.get('contraindications', 'ketorolac')

        # Renal Failure: Contraindicates NSAIDs (Ketorolac)
        egfr_min = ci_keto['egfr_minimum']
        if self.patient.egfr < egfr_min:
            locks.append("Ketorolac")

        # Cardiac Risk: Contraindicates alpha-2 agonists (Dexmedetomidine)
        cardiac_conditions = ci_dex['cardiac_conditions']
        if self._matches(self.patient.comorbidities, cardiac_conditions):
            locks.append("Dexmedetomidine")

        # Allergy Check
        allergy_triggers = ci_keto['allergy_triggers']
        if self._matches(self.patient.allergies, allergy_triggers) and "Ketorolac" not in locks:
            locks.append("Ketorolac")

        return locks

    @staticmethod
    def _matches(entries: list[str], triggers: list[str]) -> bool:
        """Case-insensitive substring match ("complete heart block" matches "Heart Block").

        Still an incomplete illustrative matcher: free text that names a condition
        differently (e.g., an abbreviation not in the trigger list) is not recognized.
        """
        normalized = [entry.casefold().strip() for entry in entries]
        return any(trigger.casefold() in entry for trigger in triggers for entry in normalized)

    def check_contraindication(self, drug: str) -> tuple[bool, str]:
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

    def generate_starting_rates(self) -> dict[str, float]:
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
        rates: dict[str, float] = {
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
            rates.update(dict.fromkeys(self.infusions, 0.0))
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

    @staticmethod
    def _is_valid_reading(value) -> bool:
        """A usable reading is a finite, non-boolean number. Physiologic plausibility is not assessed."""
        return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)

    def _latch_hold(self, drugs) -> None:
        drugs = list(drugs)
        self.hold_latched = True
        self.held_drugs.update(drugs)
        for drug in drugs:
            self.infusions[drug] = 0.0

    def _enforce_constraints(self) -> None:
        for drug in list(self.infusions):
            if drug in self.hard_lockouts or (self.hold_latched and drug in self.held_drugs):
                self.infusions[drug] = 0.0

    def _rate_faults(self) -> list[str]:
        faults = []
        for drug, rate in self.infusions.items():
            ceiling = self.config.get('simulation_rate_ceilings', drug)
            valid = not isinstance(rate, bool) and isinstance(rate, (int, float)) and math.isfinite(rate) and rate >= 0
            if not valid or ceiling is None or rate > ceiling + RATE_CEILING_TOLERANCE:
                faults.append(drug)
        return faults

    def monitor_and_control(self, duration_sec: int = 30, vitals=None,
                            sleep_sec: float = 1.0, log_every: int = 1) -> None:
        """
        Phase 3: Runs the rule-checking loop over synthetic values (educational; not a controller).
        Reads synthetic values, updates an unvalidated model, and changes in-memory values.
        A missing or malformed reading (not an (hr, map) pair) fails safe: all simulated values are
        set to zero and the hold latches, exactly as for an unusable number.

        Args:
            duration_sec: Duration of monitoring simulation in seconds
            vitals: Optional iterable of (hr, map) pairs, one per simulated second, used instead of
                random values (scripted, reproducible demonstrations). Defaults to random values.
            sleep_sec: Real-time pause per simulated second (default 1.0; 0 runs instantly).
            log_every: Print routine GREEN/HOLD lines every N seconds (alerts always print).
        """
        if isinstance(duration_sec, bool) or not isinstance(duration_sec, int) or duration_sec < 0:
            raise ValueError("Simulation duration must be a nonnegative integer")
        if isinstance(sleep_sec, bool) or not isinstance(sleep_sec, (int, float)) or not math.isfinite(sleep_sec) or sleep_sec < 0:
            raise ValueError("sleep_sec must be finite and nonnegative")
        if isinstance(log_every, bool) or not isinstance(log_every, int) or log_every < 1:
            raise ValueError("log_every must be a positive integer")
        readings = iter(vitals) if vitals is not None else None
        print("\n=== Smart NOA educational simulation (unvalidated model) ===")
        print("Monitoring Dexmedetomidine Concentration and Hemodynamics.")

        # Load thresholds from config
        hr_threshold = self.config.get('hemodynamic_thresholds', 'hr_critical_low')
        map_threshold = self.config.get('hemodynamic_thresholds', 'map_critical_low')
        # Alerts do not depend on an unvalidated concentration threshold.

        time_step_min = 1/60.0  # Each loop iteration represents 1 second (1/60th of a minute)

        for t in range(duration_sec):
            # 1. Simulate data feed from vital signs monitor (educational simulation)
            if readings is None:
                hr = random.randint(40, 95)  # nosec B311 - fictional demo reading, not security-relevant
                map_val = random.randint(50, 105)  # nosec B311 - fictional demo reading, not security-relevant
            else:
                try:
                    reading = next(readings)
                except StopIteration:
                    raise ValueError("Scripted vitals ended before duration_sec") from None
                # A malformed scripted reading (None, a 1-tuple, a string, ...) is treated as an
                # unusable reading below, so it fails safe instead of raising out of the loop.
                try:
                    hr, map_val = reading
                except (TypeError, ValueError):
                    hr = map_val = None

            # 1a. Enforce configured lockouts and any latched hold before every model update,
            #     so a rate written directly into self.infusions cannot bypass them.
            self._enforce_constraints()

            # 1b. Fail safe on an unusable reading (missing, non-numeric, NaN/inf).
            #     NaN fails every '<' comparison and would otherwise read as normal.
            if not (self._is_valid_reading(hr) and self._is_valid_reading(map_val)):
                self._latch_hold(self.infusions.keys())
                self.status = "RED"
                print(f"T+{t:2d}s | INVALID SENSOR READING (HR={hr!r}, MAP={map_val!r}) → ALL SIMULATED VALUES SET TO ZERO")
                time.sleep(sleep_sec)
                continue

            # 1c. Reject out-of-range rates (negative, non-finite, or above the configured ceiling).
            rate_fault = self._rate_faults()
            if rate_fault:
                self._latch_hold(rate_fault)
                self.status = "RED"
                print(f"T+{t:2d}s | RATE OUTSIDE SIMULATION CEILING {rate_fault} → SET TO ZERO")

            # 2. Update PK Model (How much drug is hitting the effect site?)
            dex_rate_mcg_min = self._rate_to_mcg_per_min("Dexmedetomidine")
            self.dex_pk.update_concentration(dex_rate_mcg_min, time_delta_min=time_step_min)

            dex_ce = self.dex_pk.Ce

            # 3. Dynamic Safety Interlocks (Educational Simulation Logic)

            # Example rule A: low simulated heart rate, independent of model concentration
            if hr < hr_threshold:
                self._latch_hold(["Dexmedetomidine"])
                self.status = "RED"
                print(f"T+{t:2d}s | HR {hr} | Ce: {dex_ce:.2f} → SIMULATED LOW HR → DEX VALUE SET TO ZERO")

            # Interlock B: Critical Hypotension
            if map_val < map_threshold:
                self._latch_hold(["Dexmedetomidine", "Lidocaine"])
                self.status = "RED"
                print(f"T+{t:2d}s | MAP {map_val} | Ce: {dex_ce:.2f} → HYPOTENSION → PAUSING KEY INFUSIONS")

            # A latched hold persists; there is no automatic restart policy.
            elif self.hold_latched and hr >= hr_threshold and not rate_fault:
                self.status = "HOLD"
                if t % log_every == 0:
                    print(f"T+{t:2d}s | SIMULATION HOLD remains latched; no automatic restart.")
            elif not self.hold_latched and not rate_fault:
                self.status = "GREEN"
                if t % log_every == 0:
                    print(f"T+{t:2d}s | HR {hr} | MAP {map_val} | Model Ce: {dex_ce:.2f} | No configured alert.")

            time.sleep(sleep_sec)


# ============================== DEMO EXECUTION ==============================
# Scripted, reproducible scenarios: every vital sign below is a fictional, hand-written
# value (no randomness), so each run shows the same story. Educational simulation only.

def _steady(seconds, hr, map_val):
    """Fictional stable readings with a small deterministic wobble (±2)."""
    return [(hr + (t % 5) - 2, map_val + ((t * 3) % 5) - 2) for t in range(seconds)]


def _ramp(seconds, hr_from, hr_to, map_from, map_to):
    """Fictional readings that drift linearly from one value to another."""
    return [(round(hr_from + (hr_to - hr_from) * t / max(seconds - 1, 1)),
             round(map_from + (map_to - map_from) * t / max(seconds - 1, 1))) for t in range(seconds)]


if __name__ == "__main__":
    import sys
    fast = "--realtime" not in sys.argv      # default: run instantly; pass --realtime for 1 s per step
    pause = 0.0 if fast else 1.0

    # ----------------------------------------------------
    # Scenario 1: High-risk geriatric profile (78 y, heart block, eGFR 24).
    # Expected: dexmedetomidine and ketorolac hard-locked at start; stable readings stay GREEN;
    # a gradual fall in MAP below 60 pauses lidocaine and latches a hold; recovery does NOT restart.
    # ----------------------------------------------------
    print("\n--- SCENARIO 1: HIGH-RISK GERIATRIC PROFILE (scripted) ---")
    controller_a = SmartNOAController(Patient(age=78, weight_kg=72, asa_class=3, egfr=24, allergies=[],
                                              comorbidities=["Heart Block", "History of Renal Failure"]))
    print("Dex check: ", controller_a.check_contraindication("Dexmedetomidine")[1])
    print("Keto check:", controller_a.check_contraindication("Ketorolac")[1])
    print("Starting values:", controller_a.generate_starting_rates())
    vitals_a = _steady(60, 72, 82) + _ramp(30, 72, 70, 82, 57) + _steady(30, 74, 80)
    controller_a.monitor_and_control(len(vitals_a), vitals=vitals_a, sleep_sec=pause, log_every=15)
    print("Final:", controller_a.status, controller_a.infusions)

    # ----------------------------------------------------
    # Scenario 2: Healthy young adult (30 y, 85 kg).
    # Expected: dexmedetomidine runs and the model concentration rises over 10 minutes of stable
    # readings; a gradual vagal-type fall in HR below 48 stops dexmedetomidine and latches a hold.
    # ----------------------------------------------------
    print("\n--- SCENARIO 2: HEALTHY ADULT, DEXMEDETOMIDINE RUNNING (scripted) ---")
    controller_b = SmartNOAController(Patient(age=30, weight_kg=85, asa_class=2, egfr=95, allergies=[], comorbidities=[]))
    print("Starting values:", controller_b.generate_starting_rates())
    vitals_b = _steady(600, 70, 85) + _ramp(60, 70, 44, 85, 78) + _steady(60, 62, 80)
    controller_b.monitor_and_control(len(vitals_b), vitals=vitals_b, sleep_sec=pause, log_every=120)
    print("Final:", controller_b.status, controller_b.infusions)

    # ----------------------------------------------------
    # Scenario 3: Sensor fault (heart-rate lead off, value missing).
    # Expected: the unusable reading fails safe — all simulated values set to zero and the hold latches.
    # ----------------------------------------------------
    print("\n--- SCENARIO 3: HEART-RATE SENSOR FAULT (scripted) ---")
    controller_c = SmartNOAController(Patient(age=45, weight_kg=70, asa_class=2, egfr=90, allergies=[], comorbidities=[]))
    controller_c.generate_starting_rates()
    vitals_c = _steady(30, 76, 84) + [(None, 84)] + _steady(29, 76, 84)
    controller_c.monitor_and_control(len(vitals_c), vitals=vitals_c, sleep_sec=pause, log_every=15)
    print("Final:", controller_c.status, controller_c.infusions)
