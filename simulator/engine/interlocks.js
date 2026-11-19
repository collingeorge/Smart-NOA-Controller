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
//  * ketamine is NOT part of the HR/MAP holds (documented Python behaviour);
//  * a reading outside config.yaml sensor_plausibility, or a 1-s DROP above its *_max_drop_per_sec, is
//    unusable (same fail-safe; simulation limits, not clinical standards; a sudden rise is not checked);
//  * explicit two-step release: acknowledgeHold(by, note) then resumeHold(by); the acknowledgment
//    belongs to the current hold, any new latch event (new trigger or newly held agent) invalidates
//    it and the release consumes it; held infusions stay at zero (no rate is restored);
//  * explicit, time-limited suspension of the HR/MAP threshold rules only (suspendInterlocks /
//    endSuspension): breaches are logged 'breach_suppressed'; sensor fail-safe, rate faults, lockouts
//    and an existing hold are never suspended; expiry is automatic and logged;
//  * an auditable event log (this.events: { tSec, code, status, drugs, message }) whose codes and
//    messages are identical to the Python controller's (parity test against EXAMPLE_RESULTS.json);
//  * a non-blocking long-hold advisory ('hold_long') every interlock_long_hold_advisory_sec.
// Nothing here increases a rate.

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
  // Simulation limits, NOT clinical standards (config.yaml comments).
  sensor_plausibility: { hr_min: 0, hr_max: 300, map_min: 0, map_max: 300, hr_max_drop_per_sec: 40, map_max_drop_per_sec: 30 },
  interlock_suspension_max_sec: 300,
  interlock_long_hold_advisory_sec: 600,
  age_adjustments: { geriatric: { age_threshold: 65 } },
});

export const CONTROLLED = ['Dexmedetomidine', 'Ketamine', 'Lidocaine'];
/** Shown with every explicit hold release (Python CLINICIAN_RESPONSIBILITY; same text). */
export const CLINICIAN_RESPONSIBILITY = 'Releasing this hold is a clinician decision. The simulation does not assess whether restart is appropriate.';
/** Event codes that latch (or extend) a hold (Python LATCH_CODES). */
export const LATCH_CODES = Object.freeze(['sensor_fault', 'rate_fault', 'hr_low', 'map_low']);
/** Agents in CONTROLLED order (others after them, sorted) — Python _drug_list. */
export function drugList(drugs) { const s = new Set(drugs); return [...CONTROLLED.filter((d) => s.has(d)), ...[...s].filter((d) => !CONTROLLED.includes(d)).sort()]; }
/** Whole seconds as mm:ss — Python _clock_text. */
export function clockText(sec) { const s = Math.max(0, Math.round(sec)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
/**
 * Characters refused in free text written to the event log (by, reason, note): C0/DEL/C1 controls
 * (newline, tab ...), line/paragraph separators, bidirectional controls and the byte-order mark, any of
 * which could make one log entry look like two or reorder its displayed text (05t audit, finding 4).
 * Mirrors _UNSAFE_TEXT in smart_noa_controller.py.
 */
export function hasUnsafeText(v) {
  for (const ch of v) {
    const c = ch.codePointAt(0);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x061c || c === 0x200e || c === 0x200f
      || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff) return true;
  }
  return false;
}
/** Throws if `v` contains such a character — Python _check_safe_text. */
export function checkSafeText(v, name) { if (hasUnsafeText(v)) throw new Error(`${name} must not contain control, line-separator or bidirectional-control characters`); return v; }
/** A non-blank string (whitespace-only rejected; no control or bidi characters), returned verbatim — Python _require_text. */
export function requireText(v, name) { if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} must be a non-empty string`); return checkSafeText(v, name); }
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
/** Display text of a reading in log/alarm messages: an unusable value (NaN, missing, non-finite, non-number) reads "unusable", never "NaN" (Python _reading_text; the parity tests compare the messages). */
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

/** Shared decision core used by both the Python port and the simulator (Python SmartNOAController rules). */
export class InterlockCore {
  constructor({ hardLockouts = [], config = NOA_CONFIG, infusions = null } = {}) {
    this.config = config;
    this.hardLockouts = [...hardLockouts];
    this.infusions = infusions || { Dexmedetomidine: 0, Ketamine: 0, Lidocaine: 0 };
    this.status = 'INITIALIZING';
    this.holdLatched = false;
    this.heldDrugs = new Set();
    /** Current hold instance (null when none): { id, latchedAtSec, reasons:[{tSec, reason}], triggers, drugs, acknowledgedBy, acknowledgedAtSec, acknowledgmentNote, longHoldNotices }. */
    this.hold = null;
    this.holdSeq = 0;
    /** Auditable event log { tSec, code, status, drugs, message } (Python self.events). */
    this.events = [];
    /** Simulated seconds; set by evaluate(…, tSec) and by the caller before an explicit action. */
    this.clockSec = 0;
    /** Active suspension { by, reason, startedAtSec, durationSec, untilSec } or null (never suspended at start). */
    this.suspension = null;
    this.prevReading = null; // last fully usable [hr, map] (sudden-drop baseline; reset by an unusable reading)
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
    return drugList(out);
  }
  _record(code, drugs, message, status = null) {
    const e = { tSec: this.clockSec, code, status: status === null ? this.status : status, drugs: drugList(drugs), message };
    this.events.push(e);
    return e;
  }
  get holdReasons() { return this.hold ? this.hold.reasons.map((r) => r.reason) : []; }
  _reasonsText() { return this.holdReasons.join('; ') || 'not recorded'; }
  _newHold(drugs = []) {
    this.holdSeq += 1;
    this.hold = { id: this.holdSeq, latchedAtSec: this.clockSec, reasons: [], triggers: [], drugs: drugList(drugs), acknowledgedBy: null, acknowledgedAtSec: null, acknowledgmentNote: null, longHoldNotices: 0 };
  }
  /** Latch/extend the hold for one trigger; true if an outstanding acknowledgment was invalidated (Python _trip). */
  _trip(trigger, reason, drugs) {
    drugs = drugList(drugs);
    if (this.hold === null) this._newHold();
    const newAgent = drugs.some((d) => !this.heldDrugs.has(d));
    const newTrigger = !this.hold.triggers.includes(trigger);
    this.latchHold(drugs);
    if (newTrigger) { this.hold.triggers.push(trigger); this.hold.reasons.push({ tSec: this.clockSec, reason }); }
    this.hold.drugs = drugList(this.heldDrugs);
    if ((newTrigger || newAgent) && this.hold.acknowledgedBy !== null) {
      this.hold.acknowledgedBy = null; this.hold.acknowledgedAtSec = null; this.hold.acknowledgmentNote = null;
      return true;
    }
    return false;
  }
  get suspended() { return this.suspension !== null && this.clockSec < this.suspension.untilSec; }
  get suspensionRemainingSec() { return this.suspended ? this.suspension.untilSec - this.clockSec : 0; }
  _expireSuspension() {
    if (this.suspension === null || this.clockSec < this.suspension.untilSec) return [];
    const d = this.suspension.durationSec; this.suspension = null;
    return [this._record('suspension_expired', [], `Suspension expired after ${d} s → HR/MAP interlocks active`)];
  }
  /** Explicit acknowledgment of the current hold (step 1 of 2). Simulated action; throws if no hold or `by` blank. */
  acknowledgeHold(by, note = '') {
    requireText(by, 'by');
    if (typeof note !== 'string') throw new Error('note must be a string');
    checkSafeText(note, 'note');
    if (!this.holdLatched) throw new Error('No hold is latched');
    if (this.hold === null) this._newHold(this.heldDrugs);
    Object.assign(this.hold, { acknowledgedBy: by, acknowledgedAtSec: this.clockSec, acknowledgmentNote: note });
    const msg = `Hold #${this.hold.id} acknowledged by ${by} (reasons: ${this._reasonsText()}; held: ${this.hold.drugs.join(', ') || 'none'})${note ? `; note: ${note}` : ''}`;
    return this._record('hold_acknowledged', this.hold.drugs, msg);
  }
  /** Explicit release (step 2 of 2): needs an acknowledgment of THIS hold since its latest latch event, consumes it; held infusions stay at zero. Returns the released agents. */
  resumeHold(by) {
    requireText(by, 'by');
    if (!this.holdLatched) throw new Error('No hold is latched');
    if (this.hold === null || this.hold.acknowledgedBy === null) throw new Error(`Acknowledge the hold first: review the cause (${this._reasonsText()}), then resume`);
    const held = drugList(this.heldDrugs);
    const msg = `Hold #${this.hold.id} released by ${by} (held: ${held.join(', ') || 'none'}; reasons: ${this._reasonsText()}) → held infusions stay at zero; no automatic restart`;
    // Re-zero the held agents at the release itself, so a value written to infusions while latched cannot
    // take effect afterwards (05t audit, finding 2; Python resume_hold).
    for (const d of held) this.infusions[d] = 0;
    this.holdLatched = false; this.heldDrugs.clear(); this.hold = null;
    this._record('hold_released', held, msg);
    return held;
  }
  /** Time-limited suspension of the HR/MAP threshold interlocks only (refused while one is active). */
  suspendInterlocks(durationSec, by, reason) {
    const max = this.config.interlock_suspension_max_sec;
    if (!(typeof durationSec === 'number' && Number.isInteger(durationSec) && durationSec >= 1 && durationSec <= max)) throw new Error(`Suspension duration must be a whole number of seconds from 1 to ${max}`);
    requireText(by, 'by'); requireText(reason, 'reason');
    if (this.suspended) throw new Error('Interlocks are already suspended; end the suspension first');
    this.suspension = { by, reason, startedAtSec: this.clockSec, durationSec, untilSec: this.clockSec + durationSec };
    return this._record('suspension_started', [], `Interlocks SUSPENDED by ${by} for ${durationSec} s (reason: ${reason}): HR/MAP holds will not latch; sensor fail-safe, rate faults, hard lockouts and any latched hold stay active`);
  }
  endSuspension(by) {
    requireText(by, 'by');
    if (!this.suspended) throw new Error('No interlock suspension is active');
    const left = this.suspensionRemainingSec; this.suspension = null;
    return this._record('suspension_ended', [], `Suspension ended by ${by} (${clockText(left)} left) → HR/MAP interlocks active`);
  }
  /** Python _sensor_problems: [[trigger, hold reason, message part]] (empty when the reading is usable). */
  sensorProblems(hr, map) {
    const L = this.config.sensor_plausibility; const out = [];
    const R = [['HR', hr, L.hr_min, L.hr_max, L.hr_max_drop_per_sec, '/min', 0], ['MAP', map, L.map_min, L.map_max, L.map_max_drop_per_sec, 'mmHg', 1]];
    const invalid = R.filter(([, v]) => !isValidReading(v)).map(([n]) => n);
    if (invalid.length) out.push([`invalid:${invalid.join('+')}`, `invalid sensor (${invalid.map((n) => `${n}=unusable`).join(', ')})`, `Invalid sensor reading (HR=${readingText(hr)}, MAP=${readingText(map)})`]);
    for (const [name, v, lo, hi, maxDrop, unit, i] of R) {
      if (invalid.includes(name)) continue;
      if (!(lo <= v && v <= hi)) out.push([`implausible:${name}`, `implausible ${name} ${v} (limits ${lo}–${hi})`, `${name} ${v} outside simulation plausibility limits ${lo}–${hi}: unusable`]);
      else if (this.prevReading !== null && this.prevReading[i] - v > maxDrop) {
        const drop = this.prevReading[i] - v;
        out.push([`drop:${name}`, `implausible ${name} jump −${drop} ${unit} in 1 s`, `${name} drop −${drop} ${unit} in 1 s (${this.prevReading[i]} → ${v}) above the simulation rate-of-change limit ${maxDrop}: unusable`]);
      }
    }
    return out;
  }
  /**
   * One 1-s control iteration (Python monitor_and_control loop body), at simulated time `tSec`
   * (default: this.clockSec). `modelUpdate` is called where Python updates the dexmedetomidine PK model.
   * Returns { status, invalid, rateFaults, events:[{tSec, code, status, drugs, message}] } — the events
   * recorded in this iteration (also appended to this.events).
   */
  evaluate(hr, map, modelUpdate = null, tSec = null) {
    if (tSec !== null) this.clockSec = tSec;
    const thr = this.config.hemodynamic_thresholds;
    const step = []; let invalidated = false; let faults = [];
    this.enforceConstraints();
    const expired = this._expireSuspension();
    const problems = this.sensorProblems(hr, map);
    if (problems.length) {
      this.prevReading = null;
      const all = Object.keys(this.infusions);
      for (const [trigger, reason] of problems) invalidated = this._trip(trigger, reason, all) || invalidated;
      this.status = 'RED';
      step.push(['sensor_fault', all, `${problems.map((p) => p[2]).join('; ')} → all controlled infusions set to zero; hold latched`]);
    } else {
      this.prevReading = [hr, map];
      faults = this.rateFaults();
      if (faults.length) {
        for (const d of faults) invalidated = this._trip(`rate:${d}`, `rate outside simulation ceiling (${d})`, [d]) || invalidated;
        this.status = 'RED';
        step.push(['rate_fault', faults, `Rate outside simulation ceiling (${faults.join(', ')}) → set to zero; hold latched`]);
      }
      if (modelUpdate) modelUpdate();
      const left = `(${clockText(this.suspensionRemainingSec)} left)`; const by = this.suspension ? this.suspension.by : '';
      let hrTrip = false; let mapTrip = false;
      if (hr < thr.hr_critical_low) {
        const breach = `HR ${hr} < ${thr.hr_critical_low}`;
        if (this.suspended) step.push(['breach_suppressed', ['Dexmedetomidine'], `${breach} → interlock SUSPENDED by ${by} ${left}: no hold latched`]);
        else {
          hrTrip = true; invalidated = this._trip('hr_low', breach, ['Dexmedetomidine']) || invalidated; this.status = 'RED';
          step.push(['hr_low', ['Dexmedetomidine'], `${breach} → Dexmedetomidine set to zero; hold latched`]);
        }
      }
      if (map < thr.map_critical_low) {
        const breach = `MAP ${map} < ${thr.map_critical_low}`;
        if (this.suspended) step.push(['breach_suppressed', ['Dexmedetomidine', 'Lidocaine'], `${breach} → interlock SUSPENDED by ${by} ${left}: no hold latched`]);
        else {
          mapTrip = true; invalidated = this._trip('map_low', breach, ['Dexmedetomidine', 'Lidocaine']) || invalidated; this.status = 'RED';
          step.push(['map_low', ['Dexmedetomidine', 'Lidocaine'], `${breach} → Dexmedetomidine, Lidocaine set to zero; hold latched`]);
        }
      }
      if (mapTrip) { /* RED */ } else if (this.holdLatched && !hrTrip && !faults.length) this.status = 'HOLD';
      else if (!this.holdLatched && !faults.length) this.status = 'GREEN';
    }
    if (invalidated) step.push(['acknowledgment_invalidated', [...this.heldDrugs], `Acknowledgment of hold #${this.hold ? this.hold.id : '?'} invalidated by a new latch event (reasons: ${this._reasonsText()}); acknowledge again before release`]);
    const longSec = this.config.interlock_long_hold_advisory_sec;
    if (this.holdLatched && this.hold !== null) {
      const n = this.hold.longHoldNotices;
      if (this.clockSec - this.hold.latchedAtSec >= longSec * (n + 1)) {
        this.hold.longHoldNotices = n + 1;
        step.push(['hold_long', this.hold.drugs, `Hold has been active for ${longSec * (n + 1) / 60} min (reasons: ${this._reasonsText()})`]);
      }
    }
    for (const e of expired) e.status = this.status;
    const events = [...expired, ...step.map(([code, drugs, message]) => this._record(code, drugs, message))];
    return { status: this.status, invalid: problems.length > 0, rateFaults: faults, events };
  }
  /** Python-side expiry check after the last iteration of a monitor_and_control call. */
  expireSuspension() { return this._expireSuspension(); }
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
  get events() { return this.core.events; }
  get clockSec() { return this.core.clockSec; }
  get suspended() { return this.core.suspended; }
  get holdReasons() { return this.core.holdReasons; }
  acknowledgeHold(by, note = '') { return this.core.acknowledgeHold(by, note); }
  resumeHold(by) { return this.core.resumeHold(by); }
  suspendInterlocks(durationSec, by, reason) { return this.core.suspendInterlocks(durationSec, by, reason); }
  endSuspension(by) { return this.core.endSuspension(by); }
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
      this.core.clockSec += 1; // Python running clock
    }
    this.core.expireSuspension();
    return trace;
  }
}
