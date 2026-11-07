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
from typing import Any

import yaml

# Absolute tolerance for "rate above the simulation ceiling", in the ceiling's own unit
# (mcg/kg/h or mg/kg/h). A rate equal to the ceiling, or within float noise of it, is allowed.
# The web simulator uses the same value (simulator/engine/interlocks.js RATE_CEILING_EPS; a parity
# test keeps them equal).
RATE_CEILING_TOLERANCE = 1e-9


# The controlled agents, in the fixed order used in every event message and drug list
# (simulator/engine/interlocks.js CONTROLLED; the parity tests compare the messages verbatim).
CONTROLLED_AGENTS = ("Dexmedetomidine", "Ketamine", "Lidocaine")

# Shown with every explicit hold release (Python demo output, simulator resume panel; same text in
# simulator/engine/interlocks.js CLINICIAN_RESPONSIBILITY).
CLINICIAN_RESPONSIBILITY = ("Releasing this hold is a clinician decision. "
                            "The simulation does not assess whether restart is appropriate.")

# Event codes that latch (or extend) a hold. Other codes record suppressed breaches, acknowledgments,
# releases, suspensions and advisories; none of those changes an infusion rate.
LATCH_CODES = ("sensor_fault", "rate_fault", "hr_low", "map_low")


def _is_finite_number(value) -> bool:
    """A finite int/float that is not a bool."""
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _num_text(value) -> str:
    """Number as the web simulator prints it (JavaScript String(n)): 46.0 -> "46", 46.5 -> "46.5"."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _reading_text(value) -> str:
    """A reading in an event message; an unusable value reads "unusable" (never None/NaN)."""
    return _num_text(value) if _is_finite_number(value) else "unusable"


def _clock_text(seconds) -> str:
    """Whole simulated seconds as mm:ss (e.g. 83 -> "01:23")."""
    seconds = max(0, int(round(seconds)))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def _drug_list(drugs) -> list:
    """Agents in CONTROLLED_AGENTS order (any other name after them, sorted)."""
    drugs = set(drugs)
    return [d for d in CONTROLLED_AGENTS if d in drugs] + sorted(d for d in drugs if d not in CONTROLLED_AGENTS)


def _require_text(value, name: str) -> str:
    """A non-blank string (whitespace-only is rejected); returned verbatim, never trimmed."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value

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
            if not _is_finite_number(value) or (value <= 0 if positive else value < 0):
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
            'simulation_rate_ceilings',
            'sensor_plausibility',
            'interlock_suspension_max_sec',
            'interlock_long_hold_advisory_sec',
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
            ('sensor_plausibility', 'hr_min'): False,
            ('sensor_plausibility', 'hr_max'): True,
            ('sensor_plausibility', 'map_min'): False,
            ('sensor_plausibility', 'map_max'): True,
            ('sensor_plausibility', 'hr_max_drop_per_sec'): True,
            ('sensor_plausibility', 'map_max_drop_per_sec'): True,
            ('interlock_suspension_max_sec',): True,
            ('interlock_long_hold_advisory_sec',): True,
        }
        for keys, positive in numeric_paths.items():
            value = self.get(*keys)
            if not _is_finite_number(value) or (value <= 0 if positive else value < 0):
                raise ValueError("Invalid or missing simulation parameter: " + '.'.join(keys))
        for keys in [('contraindications', 'dexmedetomidine', 'cardiac_conditions'),
                     ('contraindications', 'ketorolac', 'allergy_triggers')]:
            value = self.get(*keys)
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                raise ValueError("Expected a list of strings: " + '.'.join(keys))
        for low, high in (('hr_min', 'hr_max'), ('map_min', 'map_max')):
            if self.get('sensor_plausibility', low) >= self.get('sensor_plausibility', high):
                raise ValueError(f"sensor_plausibility.{low} must be below sensor_plausibility.{high}")
        for key in ('interlock_suspension_max_sec', 'interlock_long_hold_advisory_sec'):
            if not isinstance(self.get(key), int) or isinstance(self.get(key), bool):
                raise ValueError(f"{key} must be a whole number of seconds")
        geriatric_threshold = self.get('age_adjustments', 'geriatric', 'age_threshold')
        if geriatric_threshold != self.get('drug_dosing', 'dexmedetomidine', 'geriatric_age_threshold'):
            raise ValueError("Simulation age thresholds must agree")
        # A configured starting value may never exceed the simulation ceiling for that agent.
        for drug, key in (('Dexmedetomidine', 'dexmedetomidine'), ('Ketamine', 'ketamine'), ('Lidocaine', 'lidocaine')):
            ceiling = self.get('simulation_rate_ceilings', drug)
            for field in ('standard_dose', 'geriatric_dose'):
                value = self.get('drug_dosing', key, field)
                if value is not None and value > ceiling:
                    raise ValueError(
                        f"drug_dosing.{key}.{field} ({value}) exceeds simulation_rate_ceilings.{drug} ({ceiling})")

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
        if not _is_finite_number(infusion_rate_mcg_per_min) or infusion_rate_mcg_per_min < 0:
            raise ValueError("Infusion input must be finite and nonnegative")
        if not _is_finite_number(time_delta_min) or time_delta_min <= 0:
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
        candidates = (infusion_mass, elimination_mass, new_mass, cp_candidate, ce_candidate)
        if not all(math.isfinite(value) for value in candidates):
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
        # The current hold instance (None when no hold is latched): id, latched_at_sec, reasons
        # [{t_sec, reason}], triggers, drugs, and the outstanding acknowledgment (acknowledged_by,
        # acknowledged_at_sec, acknowledgment_note), which any new latch event invalidates.
        self.hold: dict | None = None
        self._hold_seq = 0
        # Auditable event log: {t_sec, code, status, drugs, message}. t_sec is simulated seconds since
        # this controller was created (a running clock across monitor_and_control calls).
        self.events: list[dict] = []
        self.clock_sec = 0
        # Explicit, time-limited suspension of the HR/MAP threshold interlocks (None = not suspended;
        # a new controller is never suspended).
        self.suspension: dict | None = None
        # Last fully usable (hr, map) reading, the baseline of the sudden-drop check; reset by an
        # unusable reading.
        self._prev_reading: tuple | None = None

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
            return True, (f"SOFT WARNING: Geriatric patient (>{age_threshold}yo). Illustrative age-adjusted "
                          "configuration applies; no clinical dose recommendation.")

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
        """A usable reading is a finite, non-boolean number (plausibility is checked separately)."""
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
        return _drug_list(faults)

    # --- Hold, acknowledgment, suspension and event log ---

    def _record(self, code: str, drugs, message: str, status: str | None = None) -> dict:
        event = {"t_sec": self.clock_sec, "code": code, "status": self.status if status is None else status,
                 "drugs": _drug_list(drugs), "message": message}
        self.events.append(event)
        return event

    @property
    def hold_reasons(self) -> list[str]:
        """The trigger(s) of the current hold, in the order they latched (empty when no hold)."""
        return [r["reason"] for r in self.hold["reasons"]] if self.hold else []

    def _reasons_text(self) -> str:
        return "; ".join(self.hold_reasons) or "not recorded"

    def _trip(self, trigger: str, reason: str, drugs) -> bool:
        """Latch (or extend) the hold for one trigger. Returns True if this invalidated an acknowledgment.

        A new trigger or a newly held agent is a new latch event: the reason is appended (with its
        time) and any outstanding acknowledgment no longer applies. The same trigger firing again
        while latched only re-zeroes the agents.
        """
        drugs = _drug_list(drugs)
        if self.hold is None:
            self._hold_seq += 1
            self.hold = {"id": self._hold_seq, "latched_at_sec": self.clock_sec, "reasons": [], "triggers": [],
                         "drugs": [], "acknowledged_by": None, "acknowledged_at_sec": None,
                         "acknowledgment_note": None, "long_hold_notices": 0}
        new_agent = any(d not in self.held_drugs for d in drugs)
        new_trigger = trigger not in self.hold["triggers"]
        self._latch_hold(drugs)
        if new_trigger:
            self.hold["triggers"].append(trigger)
            self.hold["reasons"].append({"t_sec": self.clock_sec, "reason": reason})
        self.hold["drugs"] = _drug_list(self.held_drugs)
        if (new_trigger or new_agent) and self.hold["acknowledged_by"] is not None:
            self.hold["acknowledged_by"] = self.hold["acknowledged_at_sec"] = self.hold["acknowledgment_note"] = None
            return True
        return False

    @property
    def suspended(self) -> bool:
        """True while an explicit suspension of the HR/MAP threshold interlocks is active."""
        return self.suspension is not None and self.clock_sec < self.suspension["until_sec"]

    @property
    def suspension_remaining_sec(self) -> int:
        """Simulated seconds left in the active suspension (0 when not suspended)."""
        return self.suspension["until_sec"] - self.clock_sec if self.suspended and self.suspension else 0

    def _expire_suspension(self) -> list[dict]:
        if self.suspension is None or self.clock_sec < self.suspension["until_sec"]:
            return []
        duration = self.suspension["duration_sec"]
        self.suspension = None
        message = f"Suspension expired after {duration} s → HR/MAP interlocks active"
        print(f"T+{self.clock_sec:2d}s | {message}")
        return [self._record("suspension_expired", [], message)]

    def acknowledge_hold(self, by: str, note: str = "") -> dict:
        """
        Record that the cause of the latched hold has been reviewed (step 1 of 2 before a release).

        In a real supervisory system a licensed clinician would perform this; here it is a simulated
        action. The acknowledgment belongs to the current hold only: any new latch event (a new
        trigger or a newly held agent) invalidates it, and the release it enables consumes it.

        Args:
            by: Who acknowledged it (non-empty; a fictional role such as "clinician")
            note: Optional free-text note, stored verbatim

        Raises:
            ValueError: If no hold is latched, `by` is blank or `note` is not a string
        """
        _require_text(by, "by")
        if not isinstance(note, str):
            raise ValueError("note must be a string")
        if not self.hold_latched:
            raise ValueError("No hold is latched")
        if self.hold is None:  # a hold latched outside the rules (e.g. set directly): still auditable
            self._hold_seq += 1
            self.hold = {"id": self._hold_seq, "latched_at_sec": self.clock_sec, "reasons": [], "triggers": [],
                         "drugs": _drug_list(self.held_drugs), "acknowledged_by": None, "acknowledged_at_sec": None,
                         "acknowledgment_note": None, "long_hold_notices": 0}
        self.hold.update(acknowledged_by=by, acknowledged_at_sec=self.clock_sec, acknowledgment_note=note)
        message = (f"Hold #{self.hold['id']} acknowledged by {by} (reasons: {self._reasons_text()}; held: "
                   f"{', '.join(self.hold['drugs']) or 'none'})" + (f"; note: {note}" if note else ""))
        print(f"T+{self.clock_sec:2d}s | {message}")
        return self._record("hold_acknowledged", self.hold["drugs"], message)

    def resume_hold(self, by: str) -> list[str]:
        """
        Release the latched hold explicitly (step 2 of 2). Releasing this hold is a clinician decision.
        The simulation does not assess whether restart is appropriate.

        In a real supervisory system a licensed clinician would perform this; here it is a simulated
        action. It requires an acknowledgment of THIS hold made after its most recent latch event, and
        consumes it. Held infusions STAY AT ZERO (previous rates are not restored); a rate is set again
        only explicitly. The status becomes GREEN only at the next evaluation, if nothing trips.

        Args:
            by: Who released it (non-empty; a fictional role such as "clinician")

        Returns:
            The agents that were held (all still at zero)

        Raises:
            ValueError: If no hold is latched, `by` is blank, or the hold was not acknowledged since its
                most recent latch event
        """
        _require_text(by, "by")
        if not self.hold_latched:
            raise ValueError("No hold is latched")
        if self.hold is None or self.hold["acknowledged_by"] is None:
            raise ValueError(f"Acknowledge the hold first: review the cause ({self._reasons_text()}), then resume")
        held = _drug_list(self.held_drugs)
        message = (f"Hold #{self.hold['id']} released by {by} (held: {', '.join(held) or 'none'}; reasons: "
                   f"{self._reasons_text()}) → held infusions stay at zero; no automatic restart")
        self.hold_latched = False
        self.held_drugs.clear()
        self.hold = None
        print(f"T+{self.clock_sec:2d}s | {message}")
        print(f"T+{self.clock_sec:2d}s | {CLINICIAN_RESPONSIBILITY}")
        self._record("hold_released", held, message)
        return held

    def suspend_interlocks(self, duration_sec: int, by: str, reason: str) -> dict:
        """
        Explicitly suspend the HR/MAP threshold interlocks for a limited time (logged; visible).

        In a real supervisory system a licensed clinician would perform this; here it is a simulated
        action. While suspended, each HR/MAP breach is still evaluated and logged ('breach_suppressed')
        but latches no hold. NOT suspended: hard lockouts, the invalid/implausible/sudden-drop sensor
        fail-safe, rate faults and any hold already latched (a suspension never releases a hold or
        restores a rate; it may start while a hold is latched). A second suspension while one is active
        is refused (end it first). Expiry is automatic and logged.

        Args:
            duration_sec: Whole seconds, 1 to interlock_suspension_max_sec (config.yaml; a simulator
                convention, not a clinical standard)
            by: Who suspended them (non-empty)
            reason: Why (required, non-blank; stored and logged verbatim)

        Raises:
            ValueError: On an invalid duration, a blank `by` or `reason`, or an active suspension
        """
        max_sec = self.config.get('interlock_suspension_max_sec')
        if isinstance(duration_sec, bool) or not isinstance(duration_sec, int) or not 1 <= duration_sec <= max_sec:
            raise ValueError(f"Suspension duration must be a whole number of seconds from 1 to {max_sec}")
        _require_text(by, "by")
        _require_text(reason, "reason")
        if self.suspended:
            raise ValueError("Interlocks are already suspended; end the suspension first")
        self.suspension = {"by": by, "reason": reason, "started_at_sec": self.clock_sec,
                           "duration_sec": duration_sec, "until_sec": self.clock_sec + duration_sec}
        message = (f"Interlocks SUSPENDED by {by} for {duration_sec} s (reason: {reason}): HR/MAP holds will not "
                   "latch; sensor fail-safe, rate faults, hard lockouts and any latched hold stay active")
        print(f"T+{self.clock_sec:2d}s | {message}")
        return self._record("suspension_started", [], message)

    def end_suspension(self, by: str) -> dict:
        """End an active suspension now (the safe direction; logged). Raises ValueError if none is active."""
        _require_text(by, "by")
        if not self.suspended or self.suspension is None:
            raise ValueError("No interlock suspension is active")
        left = self.suspension_remaining_sec
        self.suspension = None
        message = f"Suspension ended by {by} ({_clock_text(left)} left) → HR/MAP interlocks active"
        print(f"T+{self.clock_sec:2d}s | {message}")
        return self._record("suspension_ended", [], message)

    def _sensor_problems(self, hr, map_val) -> list[tuple[str, str, str]]:
        """Why a reading is unusable: [(trigger, hold reason, message part)]; empty when usable.

        Unusable = missing / non-numeric / NaN / ±Inf / boolean, outside the simulation plausibility
        limits, or a sudden DROP between consecutive usable 1-s readings larger than the configured
        limit (a sudden rise is not treated as an artifact). These limits are simulation safeguards,
        NOT clinical standards.
        """
        lim = self.config.get('sensor_plausibility')
        out: list[tuple[str, str, str]] = []
        readings = (("HR", hr, lim['hr_min'], lim['hr_max'], lim['hr_max_drop_per_sec'], "/min", 0),
                    ("MAP", map_val, lim['map_min'], lim['map_max'], lim['map_max_drop_per_sec'], "mmHg", 1))
        invalid = [name for name, value, *_ in readings if not self._is_valid_reading(value)]
        if invalid:
            detail = ", ".join(f"{name}=unusable" for name in invalid)
            out.append(("invalid:" + "+".join(invalid), f"invalid sensor ({detail})",
                        f"Invalid sensor reading (HR={_reading_text(hr)}, MAP={_reading_text(map_val)})"))
        for name, value, low, high, max_drop, unit, index in readings:
            if name in invalid:
                continue
            if not low <= value <= high:
                out.append((f"implausible:{name}", f"implausible {name} {_num_text(value)} (limits {low}–{high})",
                            f"{name} {_num_text(value)} outside simulation plausibility limits {low}–{high}: unusable"))
            elif self._prev_reading is not None and self._prev_reading[index] - value > max_drop:
                drop = _num_text(self._prev_reading[index] - value)
                out.append((f"drop:{name}", f"implausible {name} jump −{drop} {unit} in 1 s",
                            f"{name} drop −{drop} {unit} in 1 s ({_num_text(self._prev_reading[index])} → "
                            f"{_num_text(value)}) above the simulation rate-of-change limit {max_drop}: unusable"))
        return out

    def monitor_and_control(self, duration_sec: int = 30, vitals=None,
                            sleep_sec: float = 1.0, log_every: int = 1) -> None:
        """
        Phase 3: Runs the rule-checking loop over synthetic values (educational; not a controller).
        Reads synthetic values, updates an unvalidated model, and changes in-memory values.
        A missing or malformed reading (not an (hr, map) pair) fails safe: all simulated values are
        set to zero and the hold latches, exactly as for an unusable number. Every automatic zeroing,
        latch, suppressed breach, suspension expiry and long-hold advisory is recorded in self.events.
        Nothing here ever increases a rate or releases a hold.

        Args:
            duration_sec: Duration of monitoring simulation in seconds
            vitals: Optional iterable of (hr, map) pairs, one per simulated second, used instead of
                random values (scripted, reproducible demonstrations). Defaults to random values.
            sleep_sec: Real-time pause per simulated second (default 1.0; 0 runs instantly).
            log_every: Print routine GREEN/HOLD lines every N seconds (alerts always print).
        """
        if isinstance(duration_sec, bool) or not isinstance(duration_sec, int) or duration_sec < 0:
            raise ValueError("Simulation duration must be a nonnegative integer")
        if not _is_finite_number(sleep_sec) or sleep_sec < 0:
            raise ValueError("sleep_sec must be finite and nonnegative")
        if isinstance(log_every, bool) or not isinstance(log_every, int) or log_every < 1:
            raise ValueError("log_every must be a positive integer")
        readings = iter(vitals) if vitals is not None else None
        print("\n=== Smart NOA educational simulation (unvalidated model) ===")
        print("Monitoring Dexmedetomidine Concentration and Hemodynamics.")

        # Load thresholds from config
        hr_threshold = self.config.get('hemodynamic_thresholds', 'hr_critical_low')
        map_threshold = self.config.get('hemodynamic_thresholds', 'map_critical_low')
        long_hold_sec = self.config.get('interlock_long_hold_advisory_sec')
        # Alerts do not depend on an unvalidated concentration threshold.

        time_step_min = 1/60.0  # Each loop iteration represents 1 second (1/60th of a minute)

        hr: Any
        map_val: Any
        for t in range(duration_sec):
            # 1. Simulate data feed from vital signs monitor (educational simulation)
            if readings is None:
                # Fictional demo readings; `random` is not used for any security purpose (bandit B311).
                hr = random.randint(40, 95)  # nosec B311
                map_val = random.randint(50, 105)  # nosec B311
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
            now = self.clock_sec
            step: list[tuple[str, list, str]] = []  # (code, drugs, message) recorded at the end of the step
            invalidated = False

            # 1a. Enforce configured lockouts and any latched hold before every model update,
            #     so a rate written directly into self.infusions cannot bypass them.
            self._enforce_constraints()
            expired = self._expire_suspension()

            # 1b. Fail safe on an unusable reading (missing, non-numeric, NaN/inf, outside the
            #     simulation plausibility limits, or a sudden drop). NaN fails every '<' comparison
            #     and would otherwise read as normal.
            problems = self._sensor_problems(hr, map_val)
            if problems:
                self._prev_reading = None
                everything = list(self.infusions.keys())
                for trigger, reason, _ in problems:
                    invalidated = self._trip(trigger, reason, everything) or invalidated
                self.status = "RED"
                message = "; ".join(part for *_, part in problems) + \
                    " → all controlled infusions set to zero; hold latched"
                step.append(("sensor_fault", everything, message))
                print(f"T+{now:2d}s | INVALID SENSOR READING | {message}")
            else:
                self._prev_reading = (hr, map_val)

                # 1c. Reject out-of-range rates (negative, non-finite, or above the configured ceiling).
                rate_fault = self._rate_faults()
                if rate_fault:
                    for drug in rate_fault:
                        invalidated = self._trip(f"rate:{drug}", f"rate outside simulation ceiling ({drug})",
                                                 [drug]) or invalidated
                    self.status = "RED"
                    message = f"Rate outside simulation ceiling ({', '.join(rate_fault)}) → set to zero; hold latched"
                    step.append(("rate_fault", rate_fault, message))
                    print(f"T+{now:2d}s | RATE OUTSIDE SIMULATION CEILING | {message}")

                # 2. Update PK Model (How much drug is hitting the effect site?)
                dex_rate_mcg_min = self._rate_to_mcg_per_min("Dexmedetomidine")
                self.dex_pk.update_concentration(dex_rate_mcg_min, time_delta_min=time_step_min)

                dex_ce = self.dex_pk.Ce

                # 3. Dynamic Safety Interlocks (Educational Simulation Logic). While an explicit
                #    suspension is active, a breach is evaluated and logged but latches nothing.
                left = f"({_clock_text(self.suspension_remaining_sec)} left)"
                by = self.suspension["by"] if self.suspension else ""

                # Example rule A: low simulated heart rate, independent of model concentration
                hr_trip = False
                if hr < hr_threshold:
                    breach = f"HR {_num_text(hr)} < {hr_threshold}"
                    if self.suspended:
                        message = f"{breach} → interlock SUSPENDED by {by} {left}: no hold latched"
                        step.append(("breach_suppressed", ["Dexmedetomidine"], message))
                        print(f"T+{now:2d}s | SIMULATED LOW HR (SUPPRESSED) | {message}")
                    else:
                        hr_trip = True
                        invalidated = self._trip("hr_low", breach, ["Dexmedetomidine"]) or invalidated
                        self.status = "RED"
                        message = f"{breach} → Dexmedetomidine set to zero; hold latched"
                        step.append(("hr_low", ["Dexmedetomidine"], message))
                        print(f"T+{now:2d}s | SIMULATED LOW HR | Ce: {dex_ce:.2f} | {message}")

                # Interlock B: Critical Hypotension
                map_trip = False
                if map_val < map_threshold:
                    breach = f"MAP {_num_text(map_val)} < {map_threshold}"
                    if self.suspended:
                        message = f"{breach} → interlock SUSPENDED by {by} {left}: no hold latched"
                        step.append(("breach_suppressed", ["Dexmedetomidine", "Lidocaine"], message))
                        print(f"T+{now:2d}s | HYPOTENSION (SUPPRESSED) | {message}")
                    else:
                        map_trip = True
                        invalidated = self._trip("map_low", breach, ["Dexmedetomidine", "Lidocaine"]) or invalidated
                        self.status = "RED"
                        message = f"{breach} → Dexmedetomidine, Lidocaine set to zero; hold latched"
                        step.append(("map_low", ["Dexmedetomidine", "Lidocaine"], message))
                        print(f"T+{now:2d}s | HYPOTENSION | Ce: {dex_ce:.2f} | {message}")

                # A latched hold persists; there is no automatic restart policy.
                if map_trip:
                    pass
                elif self.hold_latched and not hr_trip and not rate_fault:
                    self.status = "HOLD"
                    if t % log_every == 0:
                        print(f"T+{now:2d}s | SIMULATION HOLD remains latched ({self._reasons_text()}); "
                              "no automatic restart.")
                elif not self.hold_latched and not rate_fault:
                    self.status = "GREEN"
                    if t % log_every == 0:
                        suppressed = any(code == "breach_suppressed" for code, *_ in step)
                        note = "Breach logged; interlocks SUSPENDED." if suppressed else "No configured alert."
                        print(f"T+{now:2d}s | HR {hr} | MAP {map_val} | Model Ce: {dex_ce:.2f} | {note}")

            if invalidated:
                hold_id = self.hold["id"] if self.hold else "?"
                message = (f"Acknowledgment of hold #{hold_id} invalidated by a new latch event "
                           f"(reasons: {self._reasons_text()}); acknowledge again before release")
                step.append(("acknowledgment_invalidated", sorted(self.held_drugs), message))
                print(f"T+{now:2d}s | {message}")
            # Long-hold advisory (non-blocking; changes nothing): every interlock_long_hold_advisory_sec.
            if self.hold_latched and self.hold is not None:
                notices = self.hold["long_hold_notices"]
                if now - self.hold["latched_at_sec"] >= long_hold_sec * (notices + 1):
                    self.hold["long_hold_notices"] = notices + 1
                    message = (f"Hold has been active for {_num_text(long_hold_sec * (notices + 1) / 60)} min "
                               f"(reasons: {self._reasons_text()})")
                    step.append(("hold_long", self.hold["drugs"], message))
                    print(f"T+{now:2d}s | LONG HOLD (advisory; no action) | {message}")
            for event in expired:
                event["status"] = self.status
            for code, drugs, message in step:
                self._record(code, drugs, message)

            self.clock_sec += 1
            time.sleep(sleep_sec)
        self._expire_suspension()

    def event_summary(self) -> str:
        """Compact, printable event log (one line per event)."""
        if not self.events:
            return "  (no events)"
        return "\n".join(f"  {_clock_text(e['t_sec'])} {e['code']:<26} {e['status']:<5} {e['message']}"
                         for e in self.events)


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
    print("Event log:")
    print(controller_a.event_summary())

    # ----------------------------------------------------
    # Scenario 2: Healthy young adult (30 y, 85 kg).
    # Expected: dexmedetomidine runs and the model concentration rises over 10 minutes of stable
    # readings; a gradual vagal-type fall in HR below 48 stops dexmedetomidine and latches a hold.
    # ----------------------------------------------------
    print("\n--- SCENARIO 2: HEALTHY ADULT, DEXMEDETOMIDINE RUNNING (scripted) ---")
    controller_b = SmartNOAController(Patient(age=30, weight_kg=85, asa_class=2, egfr=95,
                                              allergies=[], comorbidities=[]))
    print("Starting values:", controller_b.generate_starting_rates())
    vitals_b = _steady(600, 70, 85) + _ramp(60, 70, 44, 85, 78) + _steady(60, 62, 80)
    controller_b.monitor_and_control(len(vitals_b), vitals=vitals_b, sleep_sec=pause, log_every=120)
    print("Final:", controller_b.status, controller_b.infusions)
    print("Event log:")
    print(controller_b.event_summary())

    # ----------------------------------------------------
    # Scenario 3: Sensor fault (heart-rate lead off, value missing).
    # Expected: the unusable reading fails safe — all simulated values set to zero and the hold latches.
    # ----------------------------------------------------
    print("\n--- SCENARIO 3: HEART-RATE SENSOR FAULT (scripted) ---")
    controller_c = SmartNOAController(Patient(age=45, weight_kg=70, asa_class=2, egfr=90,
                                              allergies=[], comorbidities=[]))
    controller_c.generate_starting_rates()
    vitals_c = _steady(30, 76, 84) + [(None, 84)] + _steady(29, 76, 84)
    controller_c.monitor_and_control(len(vitals_c), vitals=vitals_c, sleep_sec=pause, log_every=15)
    print("Final:", controller_c.status, controller_c.infusions)
    print("Event log:")
    print(controller_c.event_summary())

    # ----------------------------------------------------
    # Scenario 4: Explicit, acknowledged release and a short, logged suspension.
    # Expected: MAP < 60 latches a hold; a release without an acknowledgment is refused; after the
    # acknowledgment the release succeeds but the held agents STAY AT ZERO until set explicitly. Then a
    # 60 s suspension: an HR breach is logged as suppressed (no hold) and the suspension expires on its own.
    # ----------------------------------------------------
    print("\n--- SCENARIO 4: ACKNOWLEDGED RELEASE AND A TIME-LIMITED SUSPENSION (scripted) ---")
    controller_d = SmartNOAController(Patient(age=50, weight_kg=75, asa_class=2, egfr=90,
                                              allergies=[], comorbidities=[]))
    controller_d.generate_starting_rates()
    vitals_d = _steady(20, 72, 84) + _ramp(10, 72, 72, 84, 56) + _steady(20, 74, 82)
    controller_d.monitor_and_control(len(vitals_d), vitals=vitals_d, sleep_sec=pause, log_every=20)
    try:
        controller_d.resume_hold("clinician")
    except ValueError as refusal:
        print("Release refused:", refusal)
    controller_d.acknowledge_hold("clinician", note="cause reviewed (fictional)")
    controller_d.resume_hold("clinician")
    vitals_d2 = _steady(10, 74, 82)
    controller_d.monitor_and_control(len(vitals_d2), vitals=vitals_d2, sleep_sec=pause, log_every=10)
    print("After release (held agents stay at zero):", controller_d.status, controller_d.infusions)
    controller_d.infusions["Lidocaine"] = 1.0  # set explicitly by the (simulated) clinician
    controller_d.suspend_interlocks(60, "clinician", "planned vagal manoeuvre (fictional)")
    vitals_d3 = _steady(10, 72, 82) + _ramp(15, 72, 45, 82, 80) + _steady(10, 46, 80) + _ramp(15, 46, 70, 80, 82) \
        + _steady(20, 72, 82)
    controller_d.monitor_and_control(len(vitals_d3), vitals=vitals_d3, sleep_sec=pause, log_every=30)
    print("Final:", controller_d.status, controller_d.infusions, "| suspended:", controller_d.suspended)
    print("Event log:")
    print(controller_d.event_summary())
