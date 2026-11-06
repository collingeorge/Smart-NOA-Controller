// Safety layer (SPEC §5.2). Behaviour ported from the Python reference
// implementation smart_noa_controller.py with the thresholds of config.yaml.
// Educational simulation only; not a medical device. Pure; no DOM.
//
// Ported behaviour (strict '<' comparisons throughout):
//  * hard lockouts from free-text profile entries, case-insensitive substring match;
//  * every step: re-enforce lockouts and latched holds (direct writes cannot bypass);
//  * unusable sensor reading (missing / non-number / NaN / ±Inf / boolean / string)
//    → zero ALL controlled infusions, latch hold, status RED, skip the rest of the step;
//  * rate fault (negative, non-finite, or above simulation_rate_ceilings) → zero that
//    agent, latch hold, status RED;
//  * HR < 48 → zero dexmedetomidine, latch, RED; MAP < 60 → zero dexmedetomidine and
//    lidocaine, latch, RED; a latched hold never auto-restarts (status HOLD);
//  * ketamine is NOT part of the HR/MAP holds (documented Python behaviour).
// The simulator adds an explicit, logged `resume_hold` user action (not in Python).

/** Mirror of /config.yaml (version 2026.10-rc1). A parity test checks these against the YAML. */
export const NOA_CONFIG = Object.freeze({
  version: '2026.10-rc1',
  hemodynamic_thresholds: { hr_critical_low: 48, map_critical_low: 60 },
  pharmacokinetics: { dexmedetomidine: { central_volume_L_per_kg: 0.8, elimination_rate_constant_k10: 0.04, effect_site_transfer_k1e: 0.1 } },
  drug_dosing: { dexmedetomidine: { standard_dose: 0.5, geriatric_dose: 0.25, geriatric_age_threshold: 65 }, ketamine: { standard_dose: 0.2 }, lidocaine: { standard_dose: 1.5 } },
  contraindications: {
    dexmedetomidine: { cardiac_conditions: ['Heart Block', 'AV Block', 'Mobitz', 'Sick Sinus Syndrome', 'Severe Bradycardia'] },
    ketorolac: { egfr_minimum: 30, allergy_triggers: ['NSAID', 'Ketorolac', 'Aspirin'] },
  },
  simulation_rate_ceilings: { Dexmedetomidine: 0.5, Ketamine: 0.2, Lidocaine: 1.5 },
  age_adjustments: { geriatric: { age_threshold: 65 } },
});

export const CONTROLLED = ['Dexmedetomidine', 'Ketamine', 'Lidocaine'];
/**
 * Absolute tolerance for "rate above the simulation ceiling", in the ceiling's own (Python) unit.
 * Mirrors RATE_CEILING_TOLERANCE in smart_noa_controller.py (a parity test keeps them equal).
 * A rate exactly at the ceiling (or within float noise of it) is allowed; admission in sim.js and
 * the per-step check here use the same unit and the same tolerance (2026-11 audit, finding 1).
 */
export const RATE_CEILING_EPS = 1e-9;
/** True if `rate` (already in the Python unit) is above `ceiling` beyond the shared tolerance. */
export function aboveCeiling(rate, ceiling) { return rate > ceiling + RATE_CEILING_EPS; }
export const PY_TO_SIM_ID = Object.freeze({ Dexmedetomidine: 'dexmedetomidine', Ketamine: 'ketamine', Lidocaine: 'lidocaine', Ketorolac: 'ketorolac' });
export const SIM_TO_PY_ID = Object.freeze(Object.fromEntries(Object.entries(PY_TO_SIM_ID).map(([k, v]) => [v, k])));
/** Units of drug_dosing / simulation_rate_ceilings (EXAMPLE_RESULTS.json rate_units). */
export const PY_RATE_UNITS = Object.freeze({ Dexmedetomidine: 'mcg/kg/h', Ketamine: 'mg/kg/h', Lidocaine: 'mg/kg/h' });

/** Python _is_valid_reading: a finite, non-boolean number. */
export function isValidReading(v) { return typeof v === 'number' && Number.isFinite(v); }
/** Display text of a reading in log/alarm messages: an unusable value (NaN, missing, non-finite, non-number) reads "unusable", never "NaN" (final-check fixes; display only — the decision is unchanged and the Python message is not compared by the parity tests). */
export function readingText(v) { return isValidReading(v) ? String(v) : 'unusable'; }

/** Python _matches: case-insensitive substring of any trigger in any entry. */
export function matchesFreeText(entries, triggers) {
  const norm = (entries || []).map((e) => String(e).toLowerCase().trim());
  return triggers.some((t) => norm.some((e) => e.includes(t.toLowerCase())));
}

/** Python _calculate_initial_lockouts (same order). */
export function pythonLockouts({ egfr, allergies = [], comorbidities = [] }, config = NOA_CONFIG) {
  const locks = [];
  if (egfr < config.contraindications.ketorolac.egfr_minimum) locks.push('Ketorolac');
  if (matchesFreeText(comorbidities, config.contraindications.dexmedetomidine.cardiac_conditions)) locks.push('Dexmedetomidine');
  if (matchesFreeText(allergies, config.contraindications.ketorolac.allergy_triggers) && !locks.includes('Ketorolac')) locks.push('Ketorolac');
  return locks;
}

/** Shared decision core used by both the Python port and the simulator. */
export class InterlockCore {
  constructor({ hardLockouts = [], config = NOA_CONFIG, infusions = null } = {}) {
    this.config = config;
    this.hardLockouts = [...hardLockouts];
    this.infusions = infusions || { Dexmedetomidine: 0, Ketamine: 0, Lidocaine: 0 };
    this.status = 'INITIALIZING';
    this.holdLatched = false;
    this.heldDrugs = new Set();
  }
  latchHold(drugs) {
    this.holdLatched = true;
    for (const d of drugs) { this.heldDrugs.add(d); this.infusions[d] = 0; }
  }
  enforceConstraints() {
    for (const d of Object.keys(this.infusions)) if (this.hardLockouts.includes(d) || (this.holdLatched && this.heldDrugs.has(d))) this.infusions[d] = 0;
  }
  rateFaults() {
    const out = [];
    for (const [d, r] of Object.entries(this.infusions)) {
      const ceiling = this.config.simulation_rate_ceilings[d];
      const valid = typeof r === 'number' && Number.isFinite(r) && r >= 0;
      if (!valid || ceiling === undefined || ceiling === null || aboveCeiling(r, ceiling)) out.push(d);
    }
    return out;
  }
  /**
   * One 1-s control iteration (Python monitor_and_control loop body).
   * `modelUpdate` is called where Python updates the dexmedetomidine PK model.
   * Returns { status, invalid, rateFaults, events:[{code, drugs, message}] }.
   */
  evaluate(hr, map, modelUpdate = null) {
    const thr = this.config.hemodynamic_thresholds;
    const events = [];
    this.enforceConstraints();
    if (!(isValidReading(hr) && isValidReading(map))) {
      this.latchHold(Object.keys(this.infusions));
      this.status = 'RED';
      events.push({ code: 'sensor_fault', drugs: Object.keys(this.infusions), message: `Invalid sensor reading (HR=${readingText(hr)}, MAP=${readingText(map)}): all controlled infusions set to zero; hold latched.` });
      return { status: this.status, invalid: true, rateFaults: [], events };
    }
    const faults = this.rateFaults();
    if (faults.length) {
      this.latchHold(faults);
      this.status = 'RED';
      events.push({ code: 'rate_fault', drugs: faults, message: `Rate outside simulation ceiling (${faults.join(', ')}): set to zero; hold latched.` });
    }
    if (modelUpdate) modelUpdate();
    if (hr < thr.hr_critical_low) {
      this.latchHold(['Dexmedetomidine']);
      this.status = 'RED';
      events.push({ code: 'hr_low', drugs: ['Dexmedetomidine'], message: `HR ${hr} < ${thr.hr_critical_low}: dexmedetomidine set to zero; hold latched.` });
    }
    if (map < thr.map_critical_low) {
      this.latchHold(['Dexmedetomidine', 'Lidocaine']);
      this.status = 'RED';
      events.push({ code: 'map_low', drugs: ['Dexmedetomidine', 'Lidocaine'], message: `MAP ${map} < ${thr.map_critical_low}: dexmedetomidine and lidocaine set to zero; hold latched.` });
    } else if (this.holdLatched && hr >= thr.hr_critical_low && !faults.length) {
      this.status = 'HOLD';
    } else if (!this.holdLatched && !faults.length) {
      this.status = 'GREEN';
    }
    return { status: this.status, invalid: false, rateFaults: faults, events };
  }
  /** Simulator-only explicit user action. */
  resumeHold() {
    const was = [...this.heldDrugs];
    this.holdLatched = false; this.heldDrugs.clear();
    return was;
  }
}

// ---------------------------------------------------------------------------
// Faithful port of the Python classes, used by the parity tests.

const finitePos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const finiteNonNeg = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export class PyPharmacokinetics {
  constructor(weightKg, centralVol, k10, k1e) {
    if (!finitePos(weightKg) || !finitePos(centralVol)) throw new Error('weight_kg and central_vol must be finite and positive');
    if (!finiteNonNeg(k10) || !finiteNonNeg(k1e)) throw new Error('k10 and k1e must be finite and nonnegative');
    this.Vc = centralVol * weightKg;
    if (!Number.isFinite(this.Vc) || this.Vc <= 0) throw new Error('Derived central volume must be finite and positive');
    this.k10 = k10; this.k1e = k1e; this.Cp = 0; this.Ce = 0;
  }
  updateConcentration(rateMcgPerMin, dtMin = 1) {
    if (!finiteNonNeg(rateMcgPerMin)) throw new Error('Infusion input must be finite and nonnegative');
    if (!finitePos(dtMin)) throw new Error('Time step must be finite and positive');
    if (Math.max(this.k10, this.k1e) * dtMin > 1) throw new Error('Time step exceeds this explicit Euler model stability bound');
    const infusionMass = rateMcgPerMin * dtMin;
    const eliminationMass = this.Cp * this.k10 * this.Vc * dtMin;
    const newMass = this.Cp * this.Vc + infusionMass - eliminationMass;
    const cp = Math.max(0, newMass / this.Vc);
    const ce = this.Ce + this.k1e * (cp - this.Ce) * dtMin;
    if (![infusionMass, eliminationMass, newMass, cp, ce].every(Number.isFinite)) throw new Error('Model arithmetic exceeded the finite input domain');
    this.Cp = cp; this.Ce = Math.max(0, ce);
    return [this.Cp, this.Ce];
  }
}

export function validatePyPatient(p) {
  const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
  if (!isInt(p.age) || p.age < 0 || p.age > 120) throw new Error('Simulated age must be an integer from 0 to 120');
  if (!isInt(p.asa_class) || p.asa_class < 1 || p.asa_class > 6) throw new Error('Simulated ASA class must be an integer from 1 to 6');
  if (!finitePos(p.weight_kg)) throw new Error('weight_kg must be finite and within the simulation input domain');
  if (!finiteNonNeg(p.egfr)) throw new Error('egfr must be finite and within the simulation input domain');
  for (const v of [p.allergies, p.comorbidities]) if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error('Simulated allergies and comorbidities must be lists of strings');
  return p;
}

export class SmartNoaControllerPort {
  constructor(patient, config = NOA_CONFIG) {
    this.patient = validatePyPatient(patient);
    this.config = config;
    this.core = new InterlockCore({ hardLockouts: pythonLockouts(patient, config), config });
    const pk = config.pharmacokinetics.dexmedetomidine;
    this.dexPk = new PyPharmacokinetics(patient.weight_kg, pk.central_volume_L_per_kg, pk.elimination_rate_constant_k10, pk.effect_site_transfer_k1e);
  }
  get infusions() { return this.core.infusions; }
  get hardLockouts() { return this.core.hardLockouts; }
  get status() { return this.core.status; }
  get holdLatched() { return this.core.holdLatched; }
  checkContraindication(drug) {
    if (!['Dexmedetomidine', 'Ketamine', 'Lidocaine', 'Ketorolac'].includes(drug)) return [false, 'UNASSESSED: no simulation rule for this drug'];
    if (this.core.hardLockouts.includes(drug)) {
      const reason = { Dexmedetomidine: 'Configured cardiac-condition example; incomplete clinical assessment', Ketorolac: 'Configured renal-threshold or allergy example; incomplete clinical assessment' }[drug] || 'Profile-specific contraindication';
      return [false, `HARD LOCK: ${reason}`];
    }
    const age = this.config.age_adjustments.geriatric.age_threshold;
    if (drug === 'Dexmedetomidine' && this.patient.age > age) return [true, `SOFT WARNING: Geriatric patient (>${age}yo). Illustrative age-adjusted configuration applies; no clinical dose recommendation.`];
    return [true, 'No configured lockout triggered; clinical safety is unassessed'];
  }
  generateStartingRates() {
    const d = this.config.drug_dosing;
    const rates = { Lidocaine: d.lidocaine.standard_dose, Ketamine: d.ketamine.standard_dose, Dexmedetomidine: d.dexmedetomidine.standard_dose };
    if (this.core.hardLockouts.includes('Dexmedetomidine')) rates.Dexmedetomidine = 0;
    else if (this.patient.age > d.dexmedetomidine.geriatric_age_threshold) rates.Dexmedetomidine = d.dexmedetomidine.geriatric_dose;
    rates['Ketorolac Adjunct'] = this.core.hardLockouts.includes('Ketorolac') ? 'LOCKED OUT (CI)' : 'No configured lockout; administration is not modeled';
    if (this.core.holdLatched) for (const k of Object.keys(this.core.infusions)) rates[k] = 0;
    this.core.infusions = Object.fromEntries(Object.entries(rates).filter(([, v]) => typeof v === 'number'));
    return rates;
  }
  /** Python monitor_and_control with scripted [hr, map] readings instead of random.randint. */
  monitorAndControl(readings) {
    if (!Array.isArray(readings)) throw new Error('readings must be an array of [hr, map]');
    const trace = [];
    for (let i = 0; i < readings.length; i++) {
      // A malformed reading (missing, not a pair) fails safe like an unusable value (Python parity).
      const pair = readings[i];
      const [hr, map] = Array.isArray(pair) && pair.length === 2 ? pair : [null, null];
      const before = { ...this.core.infusions };
      const r = this.core.evaluate(hr, map, () => {
        const rate = (this.core.infusions.Dexmedetomidine || 0) * this.patient.weight_kg / 60;
        this.dexPk.updateConcentration(rate, 1 / 60);
      });
      trace.push({ step: i + 1, hr, map, rates_before: before, rates_after: { ...this.core.infusions }, status: r.status, hold_latched: this.core.holdLatched, Cp: this.dexPk.Cp, Ce: this.dexPk.Ce, events: r.events });
    }
    return trace;
  }
}
