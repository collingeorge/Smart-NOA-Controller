// Simulation orchestrator (SPEC §5). Pure; no DOM; deterministic per seed.
// EDUCATIONAL SIMULATION with fictional patients. Not a medical device.
// All model outputs are illustrative (see pk.js / pd.js / physiology.js).

import { resolveLibrary, getDrug, listDrugs, findSourceId, getAntibiotic, getFluid, listFluids } from './library.js';
import { evaluateWindow, redoseStatus, PROPHYLAXIS_CONFIG } from './prophylaxis.js';
import { derivePatient, scalarWeight } from './patient.js';
import { evaluateContraindications, interpretCeilings, recommend, convertRateSafe, evaluateWhen } from './dosing.js';
import { createPkModel, isInhaled, isNitrous, referenceRegimen, ROUTE_KA_ILLUSTRATIVE, perfusionKaFactor } from './pk.js';
import { combineEffects, patientModifiers, tofFromTwitches, SEDATION_RANK, PROFILES, PATIENT_MODS } from './pd.js';
import { Physiology } from './physiology.js';
import { buildParameterInventory } from './inventory.js';
import { InterlockCore, CONTROLLED, PY_TO_SIM_ID, SIM_TO_PY_ID, PY_RATE_UNITS, NOA_CONFIG, aboveCeiling } from './interlocks.js';
import { AlarmManager } from './alarms.js';
import { convertAmount, rateToAmountPerMin, isFiniteNumber, roundSig } from './units.js';
import { getScenario } from '../data/scenarios.js';
import { createRng as createRngLocal } from './rng.js';
import { repeatBolusHold, labelRepeatHold, TIMING_CONFIG, liveTimingChecks } from './timing.js';
import { TEACHING_CEILINGS, TEACHING_GUARDS, teachingGuard } from './teaching-ceilings.js';
import { computeLockouts, MAINTENANCE_HYPNOTIC_CLASSES, maintenanceHypnoticGap } from './plan-safety.js';

export const PHASES = ['premed', 'sedation', 'induction', 'maintenance', 'emergence'];
export const MIN_FIO2_WITH_N2O = 0.30;
// Molecular weights for 1:1 sugammadex–rocuronium encapsulation, from the US labels (DESCRIPTION):
// rocuronium bromide 609.70 g/mol (S12); sugammadex sodium 2178.01 g/mol, and each mL holds
// 100 mg sugammadex = 108.8 mg sugammadex sodium (S6), so doses in mg sugammadex convert with
// SUGAMMADEX_SALT_PER_MG. Binding is instantaneous and stoichiometric (illustrative).
export const MW = Object.freeze({ rocuronium: 609.70, sugammadex: 2178.01, SUGAMMADEX_SALT_PER_MG: 1.088 });
/** mmol of rocuronium bromide / sugammadex per mg of the labelled dose amount. */
export const MMOL_PER_MG = Object.freeze({ rocuronium: 1 / MW.rocuronium, sugammadex: MW.SUGAMMADEX_SALT_PER_MG / MW.sugammadex });

// IV crystalloid bolus (non-drug action `fluid_bolus[:<mL>]`). ILLUSTRATIVE volume-restoration
// model — every constant is an author estimate (not sourced, not validated):
//  * the ordered volume runs in at RUN_ML_PER_MIN; the intravascularly retained volume R decays
//    first-order with RETENTION_TAU_MIN (redistribution of crystalloid out of the circulation);
//  * restoration r = 1 − exp(−R / RESTORE_SCALE_ML) gives diminishing returns (0 → 1);
//  * a volume-loss event (scenario perturbation `volumeLoss: true`, i.e. hemorrhage) has its
//    intensity multiplied by (1 − EVENT_COUNTER_MAX × r): fluids can offset at most 80 % of the
//    loss (ongoing bleeding needs surgical control) — this is the documented cap;
//  * a direct MAP effect + DIRECT_MAP_FRAC × r: small when euvolaemic, larger with the
//    hypovolemia or sepsis condition.
//  * 2026-11 additions: fluid TYPE (lactated Ringer's / 0.9% sodium chloride, data/drugs.js FLUIDS)
//    and a maintenance infusion in mL/h. A maintenance infusion adds its volume straight to R at its
//    rate; boluses still run in at RUN_ML_PER_MIN. Both types use the SAME constants (no
//    type-specific physiology). DEFAULT_FLUID, MAINTENANCE_DEFAULT_ML_H and MAINTENANCE_MAX_ML_H are
//    UI choices (simulator convention; the labels give no fixed dose).
export const FLUID_MODEL = Object.freeze({
  ALLOWED_ML: Object.freeze([250, 500]), DEFAULT_ML: 500,
  DEFAULT_FLUID: 'lactated_ringers', MAINTENANCE_DEFAULT_ML_H: 100, MAINTENANCE_MAX_ML_H: 1000,
  RUN_ML_PER_MIN: 50, RETENTION_TAU_MIN: 40, RESTORE_SCALE_ML: 750, EVENT_COUNTER_MAX: 0.8,
  DIRECT_MAP_FRAC: Object.freeze({ euvolaemic: 0.04, depleted: 0.10 }),
  DEPLETED_CONDITIONS: Object.freeze(['hypovolemia', 'sepsis']),
  SEPSIS_CONTEXT_ML_PER_KG: 30,
});

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Lidocaine pretreatment before propofol (2026-11 additions). Every lidocaine dose counts toward the
// cumulative lidocaine total. OVERLAP_WINDOW_SEC: an IV lidocaine analgesic dose (Foo loading
// bolus or infusion) within this time of a pretreatment dose gives a warning (LOW alarm + log).
// 4 h is the Foo 2021 separation between local-anaesthetic interventions and IV lidocaine (S1),
// applied here to pretreatment — a simulator mapping of the guideline rule.
export const LIDOCAINE_RULES = Object.freeze({ OVERLAP_WINDOW_SEC: 4 * 3600, OVERLAP_ALARM_PRIORITY: 'low', PRETREATMENT_REGIMEN: 'pretreatment' });

// Simulator alarm thresholds (SPEC §5.2 'Additional simulator alarms'; author/SPEC choices, not
// clinical standards) and extubation-readiness criteria. TOFR 0.9 is from Thilen 2023; the
// interlock thresholds (MAP 60, HR 48) come from config.yaml via interlocks.js.
export const ALARM_THRESHOLDS = Object.freeze({
  SPO2_LOW: 90, SPO2_LOW_CLEAR: 92, APNOEA_SEC: 30, MAP_LOW: 65, MAP_LOW_CLEAR: 67, MAP_HIGH: 120, MAP_HIGH_CLEAR: 118,
  HR_HIGH: 120, HR_HIGH_CLEAR: 118, MAP_CRITICAL_CLEAR: 62, HR_CRITICAL_CLEAR: 50, TOFR_EXTUBATION: 0.9,
});
// Nociceptive stimulus profile and other orchestrator constants (ILLUSTRATIVE author estimates).
export const STIMULUS = Object.freeze({
  INCISION: 0.9, INCISION_SEC: 120, MAINTENANCE: 0.55, CLOSING: 0.3, CLOSING_SEC: 300,
  LARYNGOSCOPY_SEC: 150, LARYNGOSCOPY_DECAY_SEC: 70, TUBE_IN_SITU: 0.25,
  EXTUBATION: 0.6, EXTUBATION_SEC: 60, EXTUBATION_DECAY_SEC: 25,
  SUGAMMADEX_KE0_MULT_MAX: 10, SUGAMMADEX_EXCESS_HALF: 1.5, SUGAMMADEX_EXCESS_HILL: 4, DES_RAPID_RISE_HR: 0.15, DES_RAPID_RISE_MAP: 0.1, DES_RAPID_RISE_START_MAC: 0.5,
});
export const EXTUBATION_CRITERIA = Object.freeze({ DEPTH_AWAKE: 80, RR_MIN: 8, CAPABILITY_MIN: 0.6, SPO2_MIN: 94, MAP_MIN: 65, MAP_MAX: 110, HR_MIN: 50, HR_MAX: 110 });

/**
 * Normalise a plan. Raw step fields are copied first and the validated fields are written after,
 * so a present-but-bad value never overrides the checks (2026-11 audit, finding 5):
 *  - id: a non-empty string, unique in the plan (else `step<n>`, suffixed if duplicated);
 *  - order: a finite number (else the list index);
 *  - atSec: must be a finite number ≥ 0 when present (absent → 0). A step with any other value
 *    (e.g. the string '30', NaN, undefined given explicitly) is marked `invalid` and never runs.
 */
function normalizePlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : { mode: 'GA', sedationTarget: null, steps: [] };
  const seen = new Set();
  const steps = (Array.isArray(p.steps) ? p.steps : []).map((raw, i) => {
    const s0 = raw && typeof raw === 'object' ? raw : {};
    let id = typeof s0.id === 'string' && s0.id ? s0.id : `step${i + 1}`;
    while (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    const hasAt = Object.prototype.hasOwnProperty.call(s0, 'atSec');
    const atOk = !hasAt || (isFiniteNumber(s0.atSec) && s0.atSec >= 0);
    const hasBe = Object.prototype.hasOwnProperty.call(s0, 'beforeEndSec') && s0.beforeEndSec !== null && s0.beforeEndSec !== undefined;
    const beOk = !hasBe || (isFiniteNumber(s0.beforeEndSec) && s0.beforeEndSec >= 0 && s0.kind === 'stop' && s0.phase === 'maintenance');
    const invalid = !raw || typeof raw !== 'object' ? 'step is not an object' : !atOk ? `atSec must be a finite number ≥ 0 (got ${JSON.stringify(s0.atSec) ?? String(s0.atSec)})`
      : !beOk ? 'beforeEndSec must be a finite number ≥ 0 on a maintenance-phase stop step' : null;
    return { ...s0, id, order: isFiniteNumber(s0.order) ? s0.order : i, atSec: atOk && hasAt ? s0.atSec : 0, ...(invalid ? { invalid } : {}) };
  });
  // Antibiotic prophylaxis is "indicated" when the plan says so; without the flag, only when the plan has an antibiotic step.
  const prophylaxisIndicated = typeof p.prophylaxisIndicated === 'boolean' ? p.prophylaxisIndicated : steps.some((s) => s.kind === 'antibiotic');
  // lockoutRemoved: plan steps the plan builder dropped because the drug is locked (data/scenarios.js buildPlan);
  // kept for the plan-safety check (engine/plan-safety.js maintenanceHypnoticGap). Never run.
  const lockoutRemoved = Array.isArray(p.lockoutRemoved) ? p.lockoutRemoved.filter((x) => x && typeof x === 'object').map((x) => ({ ...x })) : [];
  return { mode: p.mode === 'MAC' ? 'MAC' : 'GA', sedationTarget: typeof p.sedationTarget === 'string' ? p.sedationTarget : null, steps, prophylaxisIndicated, ...(lockoutRemoved.length ? { lockoutRemoved } : {}) };
}

class Simulation {
  constructor({ patient, plan, seed, interlocks, library }) {
    this.lib = resolveLibrary(library);
    this.patient = patient && patient.derived ? patient : derivePatient(patient, { library: this.lib });
    this.plan = normalizePlan(plan);
    this.seed = seed;
    this.mods = patientModifiers(this.patient);
    this.rng = null;
    this._init(seed, interlocks);
  }

  _init(seed, interlocksEnabled) {
    const p = this.patient;
    this.phys = new Physiology(p, this.mods, (this.rng = makeRng(seed)));
    this.alarmMgr = new AlarmManager((t, kind, msg) => this._log(kind, msg));
    const pulse = this.alarmMgr.pulse.bind(this.alarmMgr);
    this.alarmMgr.pulse = (...args) => { pulse(...args); if (this.state) this.state.alarms = this.alarmMgr.list(); };
    this.models = {};
    this.timed = [];
    this.events = [];
    this.armed = [];
    this.stim = { laryngoscopyAt: null, surgeryStartAt: null, surgeryEndAt: null, extubatedAt: null };
    this.phaseStart = { premed: 0 };
    this.executed = new Map();
    this.autoRun = null; // set by engine/autorun.js while/after an automatic or guided run
    this.rescueAdvisor = null; // set by engine/rescue.js createRescueAdvisor(); advisory only, never doses
    this.depthAdvisor = null; // set by engine/depth-advisory.js createDepthAdvisor(); text only, never doses, not an alarm
    this.stats = { depthOutOfBandSec: 0, timeMapBelow65Sec: 0, minSpo2: Infinity, maxHr: -Infinity, minHr: Infinity, maxMap: -Infinity, minMap: Infinity, interlockEvents: [], extubation: null };
    this.maskVentSec = 0;
    this.depots = [];
    this.fluid = { retainedMl: 0, pendingMl: 0, sepsisNoteLogged: false, cautionsLogged: new Set() };
    this.lido = { pretreatAt: [], analgesicAt: [], warned: false };
    // Simulator teaching ceilings (engine/teaching-ceilings.js): running totals, one-shot clinician confirmations, refusals.
    this.teaching = { given: Object.fromEntries(TEACHING_GUARDS.filter((g) => g.drugId).map((g) => [g.key, 0])), confirm: {}, confirmations: [], refusals: Object.fromEntries(TEACHING_GUARDS.map((g) => [g.key, 0])) };
    this.checklist = { antibiotic: null };
    // Timing review (engine/timing.js): every administered dose (for the live timing checks), planned
    // steps held by a state condition, and time outside the GA processed-EEG band during surgery.
    this.doseLog = []; this.timingHolds = []; this.waiting = new Map();
    this.sgxShownWarn = false; this.sgxExcess = 0; this.lastRocBolus = null; this.bolusGiven = {};
    this.lastEffects = null;
    this.recCache = new Map();
    this.ceilings = {};
    this.rateWeight = {};
    this._holdEp = null; this._locAt = null; this._hypnoticSeenRunning = false; this._depthHighSec = 0;
    this._ilLast = {}; this._ilLoggedStatus = null; this._ilStatusT = -Infinity; this._alarmOn = new Set();

    // Lockouts: library lock rules + Python free-text lockouts (config.yaml) on condition/allergy ids and labels
    // (engine/plan-safety.js computeLockouts — the same set the plan-level maintenance-hypnotic check uses).
    for (const d of listDrugs(this.lib)) {
      this.ceilings[d.id] = interpretCeilings(d, p);
      this.rateWeight[d.id] = rateWeightFor(d, p);
    }
    const { lockouts, pyLocks } = computeLockouts(p, this.lib);
    this.core = new InterlockCore({ hardLockouts: pyLocks });
    if (!interlocksEnabled) this.core.status = 'DISABLED';

    const drugs = {};
    for (const d of listDrugs(this.lib)) {
      const inh = isInhaled(d);
      drugs[d.id] = { cp: 0, ce: 0, unitConc: 0, infusionRate: 0, rateUnit: inh ? '%' : defaultRateUnit(d), cumulative: 0, amountUnit: inh ? '%·h' : d.amountUnit };
    }
    this._lastRate = Object.fromEntries(Object.keys(drugs).map((k) => [k, 0]));
    const b = p.baseline;
    this.state = {
      tSec: 0, phase: 'premed', running: false,
      vitals: { hr: b.hr, sbp: b.sbp, dbp: b.dbp, map: Math.round(p.map), spo2: b.spo2, rr: b.rr, etco2: 36, depthIndex: 97, sedationLevel: 'awake', tofCount: 4, tofRatio: 1 },
      sensors: { hr: 'ok', map: 'ok', spo2: 'ok' },
      drugs,
      airway: { secured: false, ventilated: false, maskVentilation: false, fio2: 0.21, jawThrust: false },
      fluids: { crystalloidMl: 0, infusingMl: 0, boluses: [], byType: Object.fromEntries(listFluids(this.lib).map((f) => [f.id, { bolusMl: 0, maintenanceMl: 0 }])), maintenance: { fluidId: null, rateMlH: 0, sinceSec: null } },
      prophylaxis: { indicated: this.plan.prophylaxisIndicated, doses: [], window: null, redose: { due: false, items: [] }, checklistAcknowledged: null },
      surgery: { stimulus: 'none' },
      // Pre-op holding → OR and pre-incision verification (timing review): transfer time, WHO time out
      // (clinician only), clinician acknowledgement of an index below the GA band, planned end of surgery.
      periop: { transferAt: null, timeOut: null, depthAck: null, sedationAck: null, plannedSurgeryEndSec: null },
      alarms: [],
      interlocks: { enabled: !!interlocksEnabled, status: interlocksEnabled ? 'INITIALIZING' : 'DISABLED', holdLatched: false, heldDrugs: [], lockouts, holdEpisode: null },
      log: [],
    };
    this._log('phase', 'Simulation created (premed). Educational simulation — fictional patient.');
    for (const st of this.plan.steps) if (st.invalid) this._log('dose', `Plan step ${st.id} (${String(st.drugId)}) is invalid and will not run: ${st.invalid}`);
    for (const [id, r] of Object.entries(lockouts)) this._log('interlock', `Lockout: ${getDrug(this.lib, id).name} — ${r.join('; ')}`);
    for (const st of this.plan.steps) if (st.addedBy === 'clinician_tiva') this._log('action', `Plan step ${st.id}: ${getDrug(this.lib, st.drugId) ? getDrug(this.lib, st.drugId).name : st.drugId} ${st.kind} (${st.phase}) was added by the clinician with "Add propofol TIVA maintenance" (dose from the propofol ${st.regimenKey || 'maintenance'} regimen; not added automatically).`);
    if (this.plan.mode !== 'MAC') { const g = this.maintenanceHypnoticGap(); if (g.blocking) this._log('interlock', g.message); }
  }

  _log(kind, message) { this.state.log.push({ tSec: Math.round(this.state.tSec * 10) / 10, kind, message }); }
  /** Public log entry for UI/automatic-runner notes (same format as engine entries). */
  logNote(kind, message) { this._log(String(kind), String(message)); }

  // ------------------------------------------------------------------ models
  _model(drugId) {
    if (!this.models[drugId]) {
      const drug = getDrug(this.lib, drugId);
      const k10Mult = this.mods.k10Mult[drugId] || 1;
      const rr = referenceRegimen(drug);
      const volumeWeightKg = rr && rr.reg.scalar ? scalarWeight(this.patient, rr.reg.scalar).weightKg : this.patient.weightKg;
      const concomitantOpioid = drug.pkModel === 'eleveld' ? this._concomitantForEleveld() : false;
      this.models[drugId] = createPkModel(drug, this.patient, { k10Mult, volumeWeightKg, concomitantOpioid });
      if (this.models[drugId].type === 'eleveld') this._log('event', `${drug.name} PK: Eleveld 2018 published model (arterial), concomitant-opioid covariate ${concomitantOpioid ? 'ON' : 'OFF'} (fixed for the case). Illustrative depth/haemodynamic effects.`);
    }
    return this.models[drugId];
  }

  /** Eleveld covariate (published: presence of opioids): an opioid in the plan (any phase) or already given. */
  _concomitantForEleveld() {
    const isCo = (id) => { const d = getDrug(this.lib, id); return !!d && d.cls === 'opioid'; };
    return this.plan.steps.some((s) => s.kind !== 'stop' && isCo(s.drugId)) || Object.keys(this.models).some(isCo);
  }

  _rec(drugId, key) {
    const k = `${drugId}|${key}`;
    if (!this.recCache.has(k)) this.recCache.set(k, recommend(this.patient, key, drugId, this.lib));
    return this.recCache.get(k);
  }

  _rangeCheck(drug, kind, value, unit) {
    // In range if inside the sourced range of ANY regimen of that kind (bolus also checks loading ranges).
    const ranges = [];
    for (const [key, reg] of Object.entries(drug.regimens || {})) {
      if (!reg) continue;
      const rec = this._rec(drug.id, key);
      if (kind === 'bolus') {
        for (const d of [reg.kind === 'bolus' ? rec.dose : null, rec.loading]) if (d && isFiniteNumber(d.range.min) && isFiniteNumber(d.range.max)) ranges.push({ key, min: d.range.min, max: d.range.max, unit: d.unit, v: value });
      } else if ((kind === 'infusion' || kind === 'inhaled') && rec.rate && reg.kind === kind) {
        const v = rec.rate.unit === unit ? value : convertRateSafe(value, unit, rec.rate.unit, this.rateWeight[drug.id]);
        if (v !== null && isFiniteNumber(rec.rate.range.min) && isFiniteNumber(rec.rate.range.max)) ranges.push({ key, min: rec.rate.range.min, max: rec.rate.range.max, unit: rec.rate.unit, v });
      }
    }
    if (!ranges.length) return null;
    if (ranges.some((r) => r.v >= r.min - 1e-9 && r.v <= r.max + 1e-9)) return null;
    const r = ranges[0];
    const far = r.v > r.max * 1.5 || r.v < r.min * 0.5;
    return { priority: far ? 'medium' : 'low', message: `${drug.name} ${roundSig(r.v)} ${r.unit} is outside the sourced ${r.key} range ${r.min}–${r.max} ${r.unit}` };
  }

  _tof() { return { count: this.state.vitals.tofCount, ratio: this.state.vitals.tofRatio }; }

  _runtimeWarnings(drug, cmd = null) {
    const out = [];
    const rules = Array.isArray(drug.runtimeRules) ? drug.runtimeRules : [];
    const tof = this._tof();
    const notMinimal = tof.count < 4 || tof.ratio < 0.4;
    for (const r of rules) {
      if (/tof/i.test(r.id || r.when || '') && notMinimal) out.push(`${r.message}${r.sources && r.sources.length ? ` [${r.sources.join(', ')}]` : ''} (current TOF count ${tof.count}, TOFR ${tof.ratio.toFixed(2)})`);
    }
    for (const r of rules) {
      if (/rapid/i.test(r.id || '') && cmd && isFiniteNumber(cmd.rate)) {
        const m = this._model(drug.id); const cur = this.state.drugs[drug.id].infusionRate || 0;
        if (m.type === 'volatile' && cmd.rate - cur > 0.5 * m.macAgeAdjusted) out.push(`${r.message}${r.sources && r.sources.length ? ` [${r.sources.join(', ')}]` : ''}`);
      }
    }
    // Surgery-timing rules (e.g. ketorolac): 'before' = surgery/procedure not yet started; 'during' = started, not ended.
    const sx = this.stim;
    const surgNow = sx.surgeryStartAt === null ? 'before' : sx.surgeryEndAt === null ? 'during' : 'after';
    for (const r of rules) if (r.surgery && r.surgery === surgNow && this.state.phase !== 'emergence') out.push(`${r.message}${r.sources && r.sources.length ? ` [${r.sources.join(', ')}]` : ''}`);
    for (const r of rules) {
      if (r.id !== 'dose_vs_block_depth' || !cmd || !isFiniteNumber(cmd.amount)) continue;
      const w = this.sugammadexTier(drug, cmd.amount);
      if (w) out.push(`${r.message}${r.sources && r.sources.length ? ` [${r.sources.join(', ')}]` : ''} — ${w}`);
    }
    if (!rules.length && drug.id === 'neostigmine' && notMinimal) out.push(`Neostigmine is effective only at minimal depth of block (TOFR ≥ 0.4); current TOF count ${tof.count}, TOFR ${tof.ratio.toFixed(2)}.`);
    return out;
  }

  /**
   * Sugammadex label dose tier for the current block depth (byDepth in the library) versus the
   * dose about to be given. Returns a warning string when the dose is below the tier, else null.
   * Depth: TOF count ≥ 2 → 'shallow' (T2 has reappeared); TOF count 0–1 → 'deep' (the label tier
   * is defined by 1–2 post-tetanic counts, which the simulator does not model); TOF count 0
   * within `withinMin` of a rocuronium bolus ≥ `afterRocuroniumPerKg` → 'immediate'.
   */
  sugammadexTier(drug, amount) {
    const reg = Object.values(drug.regimens || {}).find((x) => x && Array.isArray(x.byDepth));
    if (!reg) return null;
    const tiers = Object.fromEntries(reg.byDepth.map((b) => [b.depth, b]));
    const w = scalarWeight(this.patient, reg.scalar || 'TBW').weightKg;
    const perKg = amount / w;
    const tof = this._tof(); const t = this.state.tSec; const roc = this.lastRocBolus;
    const imm = tiers.immediate;
    let tier;
    if (imm && tof.count === 0 && roc && roc.perKg >= imm.afterRocuroniumPerKg - 1e-9 && t - roc.tSec <= imm.withinMin * 60 + 1e-9) tier = imm;
    else if (tof.count >= 2) tier = tiers.shallow;
    else tier = tiers.deep;
    if (!tier || perKg >= tier.perKg - 1e-6) return null;
    return `dose ${roundSig(perKg, 3)} mg/kg (${reg.scalar || 'TBW'} ${roundSig(w, 4)} kg) is below the label ${tier.perKg} mg/kg tier for the current block (TOF count ${tof.count}${tier === imm ? `, rocuronium ${roundSig(roc.perKg, 3)} mg/kg ${Math.round(t - roc.tSec)} s ago` : ''}; label criterion: ${tier.criterion}${tier.depth === 'deep' ? '; post-tetanic count is not modelled' : ''}). In this illustrative model the binding is 1:1 molar, so reversal may be slow or incomplete.`;
  }

  // ------------------------------------------------------------------ administration
  /** Gives/stops/sets a drug; then re-evaluates the depth-low advisor at once (no lag of one step). */
  administer(cmd, meta = {}) { const r = this._administerImpl(cmd, meta); this._refreshDepthAdvisor(); return r; }
  _administerImpl(cmd, meta = {}) {
    const res = (ok, blocked, reasons, warnings, extra = null) => {
      const r = { ok, blocked, reasons, warnings, ...(extra || {}) };
      const drug = getDrug(this.lib, cmd && cmd.drugId);
      const name = drug ? drug.name : String(cmd && cmd.drugId);
      if (blocked) {
        this._log('dose', `BLOCKED ${name} ${describe(cmd)}: ${reasons.join('; ')}`);
        this.alarmMgr.pulse(this.state.tSec, 'dose_blocked', 'medium', `${name} blocked: ${reasons[0]}`);
      }
      return r;
    };
    if (!cmd || typeof cmd !== 'object') return res(false, true, ['Invalid command'], []);
    if (getAntibiotic(this.lib, cmd.drugId)) return this._giveAntibiotic(cmd, meta);
    const drug = getDrug(this.lib, cmd.drugId);
    if (!drug) return res(false, true, [`Unknown drug '${cmd.drugId}'`], []);
    const ds = this.state.drugs[drug.id];
    const kind = cmd.kind;
    const warnings = [];
    if (kind === 'stop') {
      this._setRate(drug, 0, ds.rateUnit);
      this._doseLog(drug, { kind: 'stop', regimenKey: null }, meta);
      this._log('dose', `${drug.name} stopped${meta.source === 'plan' ? ' (plan)' : ''}`);
      return res(true, false, [], []);
    }
    if (this.state.interlocks.lockouts[drug.id]) return res(false, true, this.state.interlocks.lockouts[drug.id], []);
    for (const c of evaluateContraindications(this.patient, drug.id, this.lib)) if (c.severity === 'warn') warnings.push(c.message);
    const limits = this.ceilings[drug.id];

    if (kind === 'bolus') {
      if (!isFiniteNumber(cmd.amount) || cmd.amount <= 0) return res(false, true, ['Bolus amount must be a positive number'], []);
      const routes = Array.isArray(drug.bolusRoutes) && drug.bolusRoutes.length ? drug.bolusRoutes : ['IV'];
      const route = typeof cmd.route === 'string' && cmd.route ? cmd.route.toUpperCase() : routes[0];
      if (!routes.includes(route)) return res(false, true, [`${drug.name}: no sourced ${route} bolus dose; sourced bolus route(s): ${routes.join(', ')}`], []);
      let amt;
      try { amt = convertAmount(cmd.amount, cmd.amountUnit || drug.amountUnit, drug.amountUnit); } catch (e) { return res(false, true, [e.message], []); }
      if (!isFiniteNumber(amt) || amt <= 0) return res(false, true, [`Bolus amount is not a usable number after unit conversion (${String(cmd.amountUnit)})`], []);
      // "Give over" (IV only): blank/0 = push; ≥ 60 s = timed infusion of the bolus; anything else is rejected.
      const hasOver = cmd.overSec !== undefined && cmd.overSec !== null && cmd.overSec !== 0;
      if (hasOver && route === 'IV' && (!isFiniteNumber(cmd.overSec) || cmd.overSec < 60)) return res(false, true, [`"Give over" must be blank/0 (push) or at least 1 min (got ${String(cmd.overSec)} s); shorter timed injections are not modelled`], []);
      const pendingTimed = this.timed.filter((x) => x.drugId === drug.id).reduce((a, x) => a + x.remaining, 0);
      for (const L of limits) {
        if (L.route && L.route !== route) continue;
        if (L.type === 'bolus' && amt > L.absolute + 1e-9) return res(false, true, [`Single dose above ${L.label}`], warnings);
        if (L.type === 'cumulative' && L.bolusOnly && (this.bolusGiven[drug.id] || 0) + amt > L.absolute + 1e-9) return res(false, true, [`Total bolus dose would exceed ${L.label} (already given ${roundSig(this.bolusGiven[drug.id] || 0)} ${drug.amountUnit})`], warnings);
        if (L.type === 'cumulative' && !L.bolusOnly && ds.cumulative + pendingTimed + amt > L.absolute + 1e-9) return res(false, true, [`Cumulative dose would exceed ${L.label}${L.daily ? ' (daily limit applied to this session)' : ''}`], warnings);
      }
      // Label repeat interval of a rescue bolus (phenylephrine, glycopyrrolate, IM/SC epinephrine): a clinician-entered
      // repeat (manual or accepted advisory) sooner than the label interval is REFUSED; a planned repeat waits in the scheduler.
      const lrh = meta.source === 'plan' ? null : labelRepeatHold(this, drug.id, route);
      if (lrh) return res(false, true, [`Repeat bolus refused — ${lrh.reason} [${lrh.sources.join(', ')}]; ${lrh.remainingSec} s remaining`], warnings, { repeatRefused: { remainingSec: lrh.remainingSec, minSec: lrh.minSec, key: lrh.key } });
      // Simulator teaching ceiling (cumulative guard where no source states a maximum): needs a clinician confirmation.
      const tg = TEACHING_GUARDS.find((g) => g.drugId === drug.id && g.routes.includes(route));
      let tgUse = null;
      if (tg) {
        const after = this.teaching.given[tg.key] + amt;
        if (after > tg.value + 1e-9) {
          tgUse = this._teachingConfirmation(tg.key);
          if (!tgUse) { this.teaching.refusals[tg.key]++; return res(false, true, [`Above the simulator teaching ceiling (not a clinical limit): ${tg.label} ${roundSig(after)} ${tg.unit} > ${tg.value} ${tg.unit} — confirm with "Confirm dose above the simulator teaching ceiling" (action confirm_teaching_ceiling:${tg.key}) to give it`], warnings, { teachingCeiling: tg.key }); }
        }
      }
      const rtw = this._runtimeWarnings(drug, { amount: amt });
      warnings.push(...rtw);
      // State-gated repeat bolus (timing.js): a planned step never gets here while held; a manual dose is warned and recorded.
      const hold = meta.source === 'plan' ? null : repeatBolusHold(this, drug.id, route);
      if (hold) { warnings.push(`Repeat-bolus condition not met: ${hold.reason} [${hold.sources.join(', ')}]`); this.timingHolds.push({ tSec: this.state.tSec, drugId: drug.id, manual: true, reason: hold.reason, sources: hold.sources }); }
      if (drug.id === 'sugammadex' && rtw.some((x) => /tier for the current block/.test(x))) this.alarmMgr.pulse(this.state.tSec, 'sugammadex_dose', 'medium', `Sugammadex dose below the label tier for the current block depth (see log)`);
      const rc = this._rangeCheck(drug, 'bolus', amt, drug.amountUnit);
      if (rc) { warnings.push(rc.message); this.alarmMgr.pulse(this.state.tSec, 'dose_range', rc.priority, rc.message); }
      const model = this._model(drug.id);
      const overSec = route === 'IV' && isFiniteNumber(cmd.overSec) && cmd.overSec >= 60 ? cmd.overSec : null;
      this.bolusGiven[drug.id] = (this.bolusGiven[drug.id] || 0) + amt;
      if (tg) { this.teaching.given[tg.key] += amt; if (tgUse) { tgUse.used = { tSec: this.state.tSec, amount: amt, totalAfter: this.teaching.given[tg.key] }; warnings.push(`Given above the simulator teaching ceiling ${tg.value} ${tg.unit} (${tg.label}; total now ${roundSig(this.teaching.given[tg.key])} ${tg.unit}) after the clinician's confirmation`); } }
      if (route !== 'IV') { this.depots.push({ drugId: drug.id, remaining: amt, ka: ROUTE_KA_ILLUSTRATIVE[route] ?? ROUTE_KA_ILLUSTRATIVE.IM, route }); ds.cumulative += amt; }
      else if (overSec) this.timed.push({ drugId: drug.id, perMin: amt / (overSec / 60), remaining: amt });
      else { model.model.bolus(amt); ds.cumulative += amt; }
      if (drug.id === 'rocuronium') this.lastRocBolus = { tSec: this.state.tSec, perKg: amt / this.patient.weightKg };
      this._doseLog(drug, { kind: 'bolus', regimenKey: cmd.regimenKey || null, amount: amt, route, overSec, tierWarning: rtw.find((x) => /tier for the current block/.test(x)) || null }, meta);
      if (drug.id === 'lidocaine') { const w = this._lidocaineOverlap(cmd.regimenKey === LIDOCAINE_RULES.PRETREATMENT_REGIMEN ? 'pretreatment' : 'analgesic', amt); if (w) warnings.push(w); }
      this._onDrugGiven(drug);
      this._log('dose', `${drug.name} ${roundSig(amt)} ${drug.amountUnit} ${route === 'IV' ? 'bolus' : `${route} injection (illustrative absorption)`}${overSec ? ` over ${Math.round(overSec / 60)} min` : ''}${meta.source === 'plan' ? ' (plan)' : ''}${warnings.length ? ` — warnings: ${warnings.join('; ')}` : ''}`);
      return res(true, false, [], warnings);
    }

    if (kind === 'infusion' || kind === 'inhaled') {
      const rate = cmd.rate; const unit = cmd.rateUnit || ds.rateUnit;
      if (!isFiniteNumber(rate) || rate < 0) return res(false, true, ['Rate must be a non-negative number'], []);
      const inh = isInhaled(drug);
      if (inh !== (kind === 'inhaled')) return res(false, true, [`${drug.name} is ${inh ? 'an inhaled agent (use kind "inhaled", %)' : 'not an inhaled agent'}`], []);
      if (inh) {
        warnings.push(...this._runtimeWarnings(drug, cmd));
        if (unit !== '%') return res(false, true, ['Inhaled agents are set in % (dial)'], []);
        for (const L of limits) if (L.type === 'dial' && rate > L.value + 1e-9) return res(false, true, [`Dial above ${L.label}`], warnings);
        if (isNitrous(drug)) {
          const maxO2 = 1 - rate / 100;
          if (maxO2 < MIN_FIO2_WITH_N2O - 1e-9) {
            this.alarmMgr.pulse(this.state.tSec, 'fio2_n2o', 'medium', `N2O ${rate}% would leave FiO2 ${maxO2.toFixed(2)} < ${MIN_FIO2_WITH_N2O}`);
            return res(false, true, [`N2O ${rate}% would reduce FiO2 below ${MIN_FIO2_WITH_N2O} (O2 + N2O fractions cannot exceed 1)`], warnings);
          }
          if (this.state.airway.fio2 > maxO2 + 1e-9) { this.state.airway.fio2 = Math.round(maxO2 * 100) / 100; warnings.push(`FiO2 reduced to ${this.state.airway.fio2} to make room for N2O ${rate}%`); }
        }
      } else {
        let perMin;
        try { perMin = rateToAmountPerMin(rate, unit, drug.amountUnit, this.rateWeight[drug.id]); } catch (e) { return res(false, true, [e.message], []); }
        if (!isFiniteNumber(perMin)) return res(false, true, [`Rate is not a usable number after unit conversion (${String(unit)})`], []);
        for (const L of limits) {
          if (L.type !== 'rate') continue;
          const cap = convertRateSafe(L.value, L.rateUnit, unit, L.weightKg ?? this.rateWeight[drug.id]);
          if (cap !== null && rate > cap + 1e-9) return res(false, true, [`Rate above ${L.label}`], warnings);
        }
        for (const L of limits) if (L.type === 'cumulative' && !L.bolusOnly && rate > 0 && ds.cumulative >= L.absolute - 1e-9) return res(false, true, [`Cumulative ceiling already reached (${L.label})`], warnings);
        const py = SIM_TO_PY_ID[drug.id];
        if (this.state.interlocks.enabled && py && CONTROLLED.includes(py)) {
          if (this.core.holdLatched && this.core.heldDrugs.has(py) && rate > 0) return res(false, true, [`${drug.name} is held by a latched interlock; use resume_hold first`], warnings);
          const pyRate = convertRateSafe(rate, unit, PY_RATE_UNITS[py], this.rateWeight[drug.id]);
          const ceil = NOA_CONFIG.simulation_rate_ceilings[py];
          if (pyRate === null || aboveCeiling(pyRate, ceil)) return res(false, true, [`Rate above the Python simulation ceiling ${ceil} ${PY_RATE_UNITS[py]} (config.yaml simulation_rate_ceilings; applies while interlocks are on)`], warnings);
        }
      }
      const rc = this._rangeCheck(drug, kind, rate, unit);
      if (rc) { warnings.push(rc.message); this.alarmMgr.pulse(this.state.tSec, 'dose_range', rc.priority, rc.message); }
      this._setRate(drug, rate, unit);
      this._doseLog(drug, { kind, regimenKey: cmd.regimenKey || null, rate, rateUnit: unit }, meta);
      if (rate > 0 && drug.id === 'lidocaine') { const w = this._lidocaineOverlap('analgesic', null); if (w) warnings.push(w); }
      if (rate > 0) this._onDrugGiven(drug);
      this._log('dose', `${drug.name} ${kind === 'inhaled' ? 'dial' : 'infusion'} ${rate} ${unit}${meta.source === 'plan' ? ' (plan)' : ''}${warnings.length ? ` — warnings: ${warnings.join('; ')}` : ''}`);
      return res(true, false, [], warnings);
    }
    return res(false, true, [`Unknown administration kind '${kind}'`], []);
  }

  /** Record a dose for the live timing checks (engine/timing.js liveTimingChecks). */
  _doseLog(drug, x, meta) {
    const agentsOn = listDrugs(this.lib).filter((d) => ['volatile', 'gas', 'hypnotic'].includes(d.cls) && this.state.drugs[d.id].infusionRate > 0).map((d) => d.id);
    this.doseLog.push({ tSec: this.state.tSec, drugId: drug.id, phase: this.state.phase, source: meta.source || 'user', tofCount: this.state.vitals.tofCount, agentsOn, ...x });
  }

  /** Full demonstration: planned end of surgery (anchors "stop X min before the end of surgery" steps). */
  setPlannedSurgeryEnd(tSec) {
    if (tSec !== null && !isFiniteNumber(tSec)) return { ok: false, message: 'Planned end must be a number of seconds or null' };
    this.state.periop.plannedSurgeryEndSec = tSec;
    if (tSec !== null) this._log('action', `Planned end of surgery set to ${fmtSec(tSec)} (anchors stop-before-end plan steps)`);
    return { ok: true, message: 'Planned end of surgery set' };
  }

  /**
   * Lidocaine pretreatment vs IV lidocaine analgesic dosing (Foo 2021 overlap rule, simulator
   * mapping): records the dose type and returns a warning string (also logged as a LOW alarm) when a
   * pretreatment dose and an analgesic dose fall within LIDOCAINE_RULES.OVERLAP_WINDOW_SEC.
   */
  _lidocaineOverlap(type, amt) {
    const t = this.state.tSec; const L = this.lido;
    (type === 'pretreatment' ? L.pretreatAt : L.analgesicAt).push({ tSec: t, amount: amt });
    const other = type === 'pretreatment' ? L.analgesicAt : L.pretreatAt;
    if (!other.some((x) => Math.abs(t - x.tSec) <= LIDOCAINE_RULES.OVERLAP_WINDOW_SEC + 1e-9)) return null;
    const msg = `Lidocaine pretreatment and IV lidocaine analgesic dosing within ${LIDOCAINE_RULES.OVERLAP_WINDOW_SEC / 3600} h: every dose counts toward the cumulative lidocaine total (now ${roundSig(this.state.drugs.lidocaine.cumulative + (amt || 0))} mg incl. this dose; Foo 2021 loading ≤ 1.5 mg/kg IBW, infusion ≤ 1.5 mg/kg/h IBW, ≤ 120 mg/h) [S1]`;
    this.alarmMgr.pulse(t, 'lidocaine_overlap', LIDOCAINE_RULES.OVERLAP_ALARM_PRIORITY, 'Lidocaine pretreatment + IV lidocaine analgesic dosing overlap (Foo 2021): check the cumulative dose');
    L.warned = true;
    return msg;
  }

  /** Antibiotic prophylaxis dose: timing only (no PK). Lockouts and the library dose range apply. */
  _giveAntibiotic(cmd, meta = {}) {
    const ab = getAntibiotic(this.lib, cmd.drugId); const t = this.state.tSec;
    const blocked = (reasons) => { this._log('dose', `BLOCKED ${ab.name} (antibiotic prophylaxis): ${reasons.join('; ')}`); this.alarmMgr.pulse(t, 'dose_blocked', 'medium', `${ab.name} blocked: ${reasons[0]}`); return { ok: false, blocked: true, reasons, warnings: [] }; };
    const locks = evaluateContraindications(this.patient, ab.id, this.lib).filter((c) => c.severity === 'lock');
    if (locks.length) return blocked(locks.map((c) => c.message));
    if (!isFiniteNumber(cmd.amount) || cmd.amount <= 0) return blocked(['Dose must be a positive number']);
    let amt;
    try { amt = convertAmount(cmd.amount, cmd.amountUnit || ab.amountUnit, ab.amountUnit); } catch (e) { return blocked([e.message]); }
    if (!isFiniteNumber(amt) || amt <= 0) return blocked(['Dose is not a usable number after unit conversion']);
    const warnings = [];
    const rec = this._rec(ab.id, 'prophylaxis');
    if (rec.dose && isFiniteNumber(rec.dose.range.min) && isFiniteNumber(rec.dose.range.max) && (amt < rec.dose.range.min - 1e-9 || amt > rec.dose.range.max + 1e-9)) {
      const m = `${ab.name} ${roundSig(amt)} ${ab.amountUnit} differs from the guideline dose ${rec.dose.range.min === rec.dose.range.max ? rec.dose.range.min : `${rec.dose.range.min}–${rec.dose.range.max}`} ${ab.amountUnit} for this patient [${rec.sources.join(', ')}]`;
      warnings.push(m); this.alarmMgr.pulse(t, 'dose_range', 'low', m);
    }
    const P = this.state.prophylaxis;
    P.doses.push({ drugId: ab.id, tSec: t, amount: roundSig(amt), unit: ab.amountUnit, source: meta.source || 'user' });
    P.redose = redoseStatus(P.doses, t, this.lib);
    const sx = this.stim;
    if (sx.surgeryStartAt !== null && sx.surgeryEndAt === null && P.doses.filter((d) => d.drugId === ab.id).length === 1) warnings.push('given after incision: does not satisfy the pre-incision window');
    this._log('dose', `${ab.name} ${roundSig(amt)} ${ab.amountUnit} IV — antibiotic prophylaxis (timing only; pharmacology not modelled) [${(ab.prophylaxis.sources || []).join(', ')}]${meta.source === 'plan' ? ' (plan)' : ''}${warnings.length ? ` — warnings: ${warnings.join('; ')}` : ''}`);
    return { ok: true, blocked: false, reasons: [], warnings };
  }

  /** Antibiotic checklist item for the "Start surgery" gate: satisfied, not indicated, or acknowledged. */
  prophylaxisChecklist() {
    const P = this.state.prophylaxis; const t = this.state.tSec;
    if (!P.indicated) return { indicated: false, satisfied: true, acknowledged: false, message: 'Antibiotic prophylaxis not marked as indicated for this plan.', window: null };
    const w = evaluateWindow(P.doses, t, this.lib);
    const ack = this.checklist.antibiotic;
    return { indicated: true, satisfied: w.ok || !!ack, acknowledged: !!ack, window: w, sources: w.sources,
      message: w.ok ? `Antibiotic prophylaxis in window: ${w.message}.` : `Antibiotic prophylaxis not in the recommended window if surgery starts now: ${w.message}.${ack ? ' Warning acknowledged by the clinician.' : ' The clinician must acknowledge this warning (or give prophylaxis) before surgery starts.'}` };
  }

  _setRate(drug, rate, unit) {
    const ds = this.state.drugs[drug.id];
    ds.infusionRate = rate; ds.rateUnit = unit || ds.rateUnit;
    this._lastRate[drug.id] = rate;
    if (rate === 0 && !this.models[drug.id]) return;
    const m = this._model(drug.id);
    if (m.type === 'volatile') m.model.setDial(rate);
    else m.model.setInfusion(rate > 0 ? rateToAmountPerMin(rate, ds.rateUnit, drug.amountUnit, this.rateWeight[drug.id]) : 0);
  }

  _onDrugGiven(drug) {
    for (const e of this.events) {
      const rb = e.def.perturbation.resolvedBy;
      if (rb && Array.isArray(rb.drugs) && rb.drugs.includes(drug.id) && !e.resolved) { e.resolved = true; e.resolvedAt = this.state.tSec; this._log('event', `${e.def.label} resolving after ${drug.name}`); }
    }
  }

  // ------------------------------------------------------------------ phases, actions, events
  setPhase(phase) {
    if (!PHASES.includes(phase)) return { ok: false, message: `Unknown phase '${phase}'` };
    this.state.phase = phase;
    if (this.phaseStart[phase] === undefined) this.phaseStart[phase] = this.state.tSec;
    this._log('phase', `Phase: ${phase}`);
    this._refreshDepthAdvisor();
    return { ok: true, message: `Phase ${phase}` };
  }

  /**
   * Re-evaluates the text-only depth-low advisor immediately after a phase change, action or drug change,
   * so it disarms on the same simulated second (e.g. "Begin emergence") rather than on the next step.
   * Zero elapsed time: it uses the advisor's refresh-only path (update({ refreshOnly: true })), which never
   * accumulates time, never moves the advisor's clock and never starts an episode; it can only END an active
   * episode (disarmed or recovered). It records only and never doses. Called by the public action(),
   * administer() and setPhase() only — never from inside _substep (the plan scheduler uses the *Impl paths).
   */
  _refreshDepthAdvisor() { if (this.depthAdvisor && typeof this.depthAdvisor.update === 'function') this.depthAdvisor.update({ refreshOnly: true }); }

  play() { this.state.running = true; }
  pause() { this.state.running = false; }

  /** Runs a user/runner action; then re-evaluates the depth-low advisor at once (no lag of one step). */
  action(id) { const r = this._actionImpl(id); this._refreshDepthAdvisor(); return r; }
  _actionImpl(id) {
    const a = this.state.airway; const t = this.state.tSec;
    const ok = (message) => { this._log('action', message); return { ok: true, message }; };
    const no = (message) => ({ ok: false, message });
    if (typeof id !== 'string') return no('Invalid action');
    if (id.startsWith('set_fio2:')) {
      const v = Number(id.slice(9));
      if (!isFiniteNumber(v) || v < 0.21 || v > 1) return no('FiO2 must be between 0.21 and 1');
      const n2o = this._n2oPct();
      if (v > 1 - n2o / 100 + 1e-9) return no(`FiO2 ${v} not possible with N2O ${n2o}% (O2 + N2O ≤ 1)`);
      a.fio2 = v; return ok(`FiO2 set to ${v}`);
    }
    if (id === 'fluid_bolus' || id.startsWith('fluid_bolus:')) {
      const parts = id.split(':');
      const ml = parts.length < 2 ? FLUID_MODEL.DEFAULT_ML : Number(parts[1]);
      if (!FLUID_MODEL.ALLOWED_ML.includes(ml)) return no(`Fluid bolus must be ${FLUID_MODEL.ALLOWED_ML.join(' or ')} mL crystalloid`);
      const ft = this._fluidType(parts[2]);
      if (ft.error) return no(ft.error);
      const F = this.state.fluids;
      const cg = teachingGuard('crystalloid'); const cMax = cg.value * this.patient.weightKg;
      let cUse = null;
      if (F.crystalloidMl + ml > cMax + 1e-9) {
        cUse = this._teachingConfirmation('crystalloid');
        if (!cUse) { this.teaching.refusals.crystalloid++; this._log('dose', `BLOCKED fluid bolus ${ml} mL: above the simulator teaching ceiling (not a clinical limit) ${cg.value} ${cg.unit} = ${Math.round(cMax)} mL (total would be ${Math.round(F.crystalloidMl + ml)} mL)`); return { ok: false, message: `Fluid bolus ${ml} mL refused: total crystalloid would be ${Math.round(F.crystalloidMl + ml)} mL, above the simulator teaching ceiling ${cg.value} ${cg.unit} (${Math.round(cMax)} mL; not a clinical limit) — confirm with "Confirm dose above the simulator teaching ceiling" (action confirm_teaching_ceiling:crystalloid)`, teachingCeiling: 'crystalloid' }; }
        cUse.used = { tSec: t, amount: ml, totalAfter: F.crystalloidMl + ml };
      }
      F.crystalloidMl += ml; this.fluid.pendingMl += ml; F.infusingMl = Math.round(this.fluid.pendingMl);
      F.boluses.push({ tSec: t, ml, kind: 'crystalloid', fluidId: ft.id });
      if (ft.id && F.byType[ft.id]) F.byType[ft.id].bolusMl += ml;
      const perKg = F.crystalloidMl / this.patient.weightKg;
      let msg = `${ft.name} bolus ${ml} mL started (cumulative crystalloid ${roundSig(F.crystalloidMl)} mL, ${roundSig(perKg, 3)} mL/kg TBW; illustrative volume model)${ft.cautions}${cUse ? ` — given above the simulator teaching ceiling ${cg.value} ${cg.unit} after the clinician's confirmation` : ''}`;
      if ((this.patient.conditions || []).includes('sepsis') && perKg >= FLUID_MODEL.SEPSIS_CONTEXT_ML_PER_KG && !this.fluid.sepsisNoteLogged) {
        const src = (this.lib.SOURCE_IDS_ENGINE && this.lib.SOURCE_IDS_ENGINE.sepsisFluids) || null;
        this.fluid.sepsisNoteLogged = true;
        msg += ` — context: Surviving Sepsis Campaign 2021 suggests at least 30 mL/kg IV crystalloid within the first 3 h for sepsis-induced hypoperfusion or septic shock (weak recommendation)${src ? ` [${src}]` : ''}`;
      }
      return ok(msg);
    }
    if (id.startsWith('fluid_maintenance')) {
      // fluid_maintenance:<fluidId>:<mL/h> (0 = stop) | fluid_maintenance_stop
      const F = this.state.fluids; const M = F.maintenance;
      if (id === 'fluid_maintenance_stop') { if (!M.rateMlH) return no('No maintenance infusion running'); const was = M.fluidId; M.rateMlH = 0; M.sinceSec = null; return ok(`Maintenance infusion stopped (${this._fluidType(was).name})`); }
      const parts = id.split(':');
      if (parts.length !== 3) return no('Use fluid_maintenance:<fluidId>:<mL/h>');
      const ft = this._fluidType(parts[1]); if (ft.error) return no(ft.error);
      const r = Number(parts[2]);
      if (!isFiniteNumber(r) || r < 0 || r > FLUID_MODEL.MAINTENANCE_MAX_ML_H) return no(`Maintenance rate must be 0–${FLUID_MODEL.MAINTENANCE_MAX_ML_H} mL/h (simulator input limit)`);
      if (r === 0) { M.rateMlH = 0; M.sinceSec = null; return ok(`Maintenance infusion stopped (${ft.name})`); }
      const prev = M.rateMlH > 0 ? `${this._fluidType(M.fluidId).name} ${M.rateMlH} mL/h` : null;
      M.fluidId = ft.id; M.rateMlH = r; M.sinceSec = t;
      return ok(`Maintenance infusion ${ft.name} ${r} mL/h${prev ? ` (was ${prev})` : ''} — rate is a simulator choice, not a label dose; illustrative volume model${ft.cautions}`);
    }
    if (id.startsWith('confirm_teaching_ceiling:')) {
      const g = teachingGuard(id.slice(25));
      if (!g) return no(`Unknown teaching ceiling '${id.slice(25)}' (${TEACHING_GUARDS.map((x) => x.key).join(', ')})`);
      const c = { key: g.key, tSec: t, used: null };
      this.teaching.confirm[g.key] = c; this.teaching.confirmations.push(c);
      return ok(`Clinician confirmed ONE dose above the simulator teaching ceiling for ${g.label} (${g.value} ${g.unit}; a teaching guard, not a clinical limit; valid ${TEACHING_CEILINGS.CONFIRMATION_VALID_SEC.value} s)`);
    }
    if (id === 'acknowledge_checklist:antibiotic') {
      const c = this.prophylaxisChecklist();
      if (!c.indicated) return no('Antibiotic prophylaxis is not marked as indicated for this plan');
      if (c.window && c.window.ok) return no('Nothing to acknowledge: prophylaxis is in the window');
      this.checklist.antibiotic = { tSec: t, message: c.window ? c.window.message : '' };
      this.state.prophylaxis.checklistAcknowledged = { tSec: t, message: this.checklist.antibiotic.message };
      return ok(`Clinician acknowledged the antibiotic checklist warning: ${this.checklist.antibiotic.message}`);
    }
    if (id === 'transfer_to_or') {
      if (this.state.periop.transferAt !== null) return no('Patient already transferred to the OR');
      this.state.periop.transferAt = t;
      return ok('Patient transferred from pre-op holding to the OR (monitors applied next)');
    }
    if (id === 'confirm_time_out') {
      if (this.state.periop.timeOut) return no('Time out already confirmed');
      this.state.periop.timeOut = { tSec: t };
      return ok(`WHO Surgical Safety Checklist time out confirmed by the clinician (patient, site and procedure; antibiotic prophylaxis checked)${this.lib.SOURCE_IDS_ENGINE && this.lib.SOURCE_IDS_ENGINE.whoChecklist ? ` [${this.lib.SOURCE_IDS_ENGINE.whoChecklist}]` : ''}`);
    }
    if (id === 'acknowledge_depth_below_band') {
      const [lo] = TIMING_CONFIG.GA_DEPTH_BAND.value; const v = this.state.vitals.depthIndex;
      if (!(v < lo)) return no(`Processed-EEG depth index ${v} is not below the GA band (${lo})`);
      this.state.periop.depthAck = { tSec: t, index: v };
      return ok(`Clinician acknowledged a processed-EEG depth index of ${v} (below the GA band ${lo}–${TIMING_CONFIG.GA_DEPTH_BAND.value[1]}) before incision`);
    }
    if (id === 'acknowledge_sedation_below_target') {
      // MAC: the clinician accepts starting the procedure at a sedation level below the plan target
      // (never automatic; guided/automatic modes only offer it). Logged with the level and target.
      const tgt = this.plan.sedationTarget || 'moderate'; const lvl = this.state.vitals.sedationLevel;
      if (this.plan.mode !== 'MAC') return no('Only for a MAC / sedation plan');
      if (this.state.periop.sedationAck) return no('Sedation level already acknowledged');
      if (!(SEDATION_RANK[lvl] < SEDATION_RANK[tgt])) return no(`Sedation level ${lvl} is not below the plan target (${tgt})`);
      this.state.periop.sedationAck = { tSec: t, level: lvl, target: tgt };
      return ok(`Clinician acknowledged sedation below the planned target (${lvl} vs ${tgt}) and chose to start the procedure at the current level`);
    }
    if (id.startsWith('acknowledge:')) {
      const aid = id.slice(12);
      const r = this.alarmMgr.acknowledge(aid); this.state.alarms = this.alarmMgr.list();
      return r ? ok(`Alarm acknowledged: ${aid}`) : no(`No alarm '${aid}'`);
    }
    switch (id) {
      case 'secure_airway': {
        if (a.secured) return no('Airway already secured');
        a.secured = true; a.maskVentilation = false; a.jawThrust = false; this.stim.laryngoscopyAt = t; this.state.surgery.stimulus = 'laryngoscopy';
        const v = this.state.vitals; const notes = [];
        if (v.depthIndex > 70) notes.push('depth index > 70: light for laryngoscopy (illustrative)');
        if (v.tofCount > 0 && this.lastEffects && this.lastEffects.block < 0.9) notes.push('neuromuscular block incomplete');
        return ok(`Airway secured (tracheal tube)${notes.length ? ' — ' + notes.join('; ') : ''}`);
      }
      case 'mask_ventilate': if (a.secured) return no('Airway is secured; use the ventilator'); a.maskVentilation = !a.maskVentilation; this.maskVentSec = 0; return ok(a.maskVentilation ? 'Bag-mask ventilation started' : 'Bag-mask ventilation stopped');
      case 'stop_mask_ventilation': a.maskVentilation = false; return ok('Bag-mask ventilation stopped');
      case 'jaw_thrust': a.jawThrust = !a.jawThrust; return ok(a.jawThrust ? 'Jaw thrust applied' : 'Jaw thrust released');
      case 'release_jaw_thrust': a.jawThrust = false; return ok('Jaw thrust released');
      case 'start_ventilation': if (!a.secured) return no('Secure the airway before mechanical ventilation (or mask ventilate)'); a.ventilated = true; return ok('Mechanical ventilation started');
      case 'stop_ventilation': a.ventilated = false; return ok('Mechanical ventilation stopped');
      case 'start_surgery': {
        this.stim.surgeryStartAt = t; this.stim.surgeryEndAt = null; this.state.surgery.stimulus = 'incision';
        const P = this.state.prophylaxis; let extra = '';
        if (P.indicated) {
          P.window = { tSec: t, ...evaluateWindow(P.doses, t, this.lib) };
          if (!P.window.ok) {
            const src = P.window.sources && P.window.sources.length ? ` [${P.window.sources.join(', ')}]` : '';
            this.alarmMgr.pulse(t, 'abx_window', PROPHYLAXIS_CONFIG.WINDOW_ALARM_PRIORITY.value, `Surgery started without antibiotic prophylaxis in the recommended window: ${P.window.message}${src}`);
            extra = ` — antibiotic prophylaxis NOT in the recommended window (${P.window.message})${this.checklist.antibiotic ? '; checklist warning was acknowledged' : ''}`;
          } else extra = ` — antibiotic prophylaxis in window (${P.window.message})`;
        }
        return ok(`Surgery started (incision)${extra}`);
      }
      case 'end_surgery': this.stim.surgeryEndAt = t; this.state.surgery.stimulus = 'closing'; return ok('Surgery ended (closing)');
      case 'extubate': {
        if (!a.secured) return no('No tracheal tube to remove');
        const r = this.extubationReadiness();
        this.stats.extubation = { tSec: t, ...r };
        if (this.state.vitals.tofRatio < ALARM_THRESHOLDS.TOFR_EXTUBATION) this.alarmMgr.pulse(t, 'tofr_extubation', 'high', `Extubation with TOFR ${this.state.vitals.tofRatio.toFixed(2)} < 0.9`);
        a.secured = false; a.ventilated = false; this.stim.extubatedAt = t;
        for (const def of this.armed.splice(0)) this._startEvent(def);
        return ok(`Extubated — readiness ${r.ready ? 'met' : 'NOT met: ' + r.criteria.filter((c) => !c.met).map((c) => c.label).join(', ')}`);
      }
      case 'resume_hold': {
        if (!this.state.interlocks.enabled) return no('Interlocks are disabled');
        if (!this.core.holdLatched) return no('No latched hold');
        const was = this.core.resumeHold();
        this.stats.interlockEvents.push({ tSec: t, code: 'resume_hold', message: `Hold released by user (${was.join(', ') || 'none held'})` });
        this._log('interlock', `Hold released by explicit user action (resume_hold); held: ${was.join(', ') || 'none'}. Infusions do not restart automatically.`);
        return ok('Hold released');
      }
      default: return no(`Unknown action '${id}'`);
    }
  }

  /** A valid, unused clinician confirmation for a teaching ceiling (consumed by the caller), or null. */
  _teachingConfirmation(key) {
    const c = this.teaching.confirm[key];
    if (!c || c.used || this.state.tSec - c.tSec > TEACHING_CEILINGS.CONFIRMATION_VALID_SEC.value + 1e-9) return null;
    this.teaching.confirm[key] = null;
    return c;
  }

  /** Teaching ceilings for the UI and the debrief: [{ key, label, limit, unit, total, totalUnit, above, confirmations, refusals, pendingConfirmation }]. */
  teachingCeilingStatus() {
    return TEACHING_GUARDS.map((g) => {
      const fluid = g.key === 'crystalloid';
      const limit = fluid ? Math.round(g.value * this.patient.weightKg) : g.value;
      const total = fluid ? this.state.fluids.crystalloidMl : this.teaching.given[g.key];
      const c = this.teaching.confirm[g.key];
      return { key: g.key, label: g.label, limit, unit: fluid ? 'mL' : g.unit, ruleValue: g.value, ruleUnit: g.unit, total: roundSig(total), above: total > limit + 1e-9,
        confirmations: this.teaching.confirmations.filter((x) => x.key === g.key).map((x) => ({ ...x, used: x.used ? { ...x.used } : null })), refusals: this.teaching.refusals[g.key],
        pendingConfirmation: !!(c && !c.used && this.state.tSec - c.tSec <= TEACHING_CEILINGS.CONFIRMATION_VALID_SEC.value + 1e-9), provenance: g.provenance };
    });
  }

  /** Resolve a fluid id (default FLUID_MODEL.DEFAULT_FLUID); libraries without FLUIDS use a generic crystalloid. */
  _fluidType(id) {
    const fluids = listFluids(this.lib);
    if (!fluids.length) return { id: null, name: 'Crystalloid', cautions: '' };
    const fid = id || FLUID_MODEL.DEFAULT_FLUID;
    const f = getFluid(this.lib, fid);
    if (!f) return { error: `Unknown fluid '${fid}' (${fluids.map((x) => x.id).join(', ')})` };
    let cautions = '';
    for (const c of f.cautions || []) {
      const key = `${f.id}|${c.when}`;
      if (this.fluid.cautionsLogged.has(key) || !evaluateWhen(c.when, this.patient).value) continue;
      this.fluid.cautionsLogged.add(key); cautions += ` — caution: ${c.message} [${(c.sources || []).join(', ')}]`;
    }
    return { id: f.id, name: f.name, cautions };
  }

  _n2oPct() { let s = 0; for (const d of listDrugs(this.lib)) if (isNitrous(d)) s += this.state.drugs[d.id].infusionRate || 0; return s; }

  inject(eventId) {
    const def = getScenario(eventId);
    if (!def) return { ok: false, message: `Unknown event '${eventId}'` };
    if (def.perturbation.armOnExtubation && this.state.airway.secured) {
      this.armed.push(def); this._log('event', `${def.label} armed (occurs at extubation)`);
      return { ok: true, message: `${def.label} armed` };
    }
    this._startEvent(def);
    return { ok: true, message: def.label };
  }

  _startEvent(def) {
    this.events.push({ def, startSec: this.state.tSec, resolved: false, resolvedAt: null });
    this._log('event', `Event: ${def.label} — ${def.description}`);
  }

  _eventIntensity(e, t) {
    const p = e.def.perturbation; const dt = t - e.startSec;
    let I = p.rampSec > 0 ? clamp(dt / p.rampSec, 0, 1) : 1;
    const holdEnd = p.holdSec === null || p.holdSec === undefined ? Infinity : (p.rampSec || 0) + p.holdSec;
    const endAt = e.resolved ? e.resolvedAt - e.startSec : holdEnd;
    if (dt > endAt) I *= p.resolveSec > 0 ? clamp(1 - (dt - endAt) / p.resolveSec, 0, 1) : 0;
    return I;
  }

  /** A premedication bolus step is pending or still running (timed bolus) at time t. */
  _premedBolusBusy(t) {
    return this.plan.steps.some((x) => x.phase === 'premed' && x.kind === 'bolus' && !x.invalid && (!this.executed.has(x.id) || (!this.executed.get(x.id).blocked && this.executed.get(x.id).tSec + (isFiniteNumber(x.overSec) ? x.overSec : 0) > t + 1e-9)));
  }

  /** Simulated time at which a plan step becomes due, or null if it is not schedulable yet. */
  _dueAt(s) {
    const ps = this.phaseStart[s.phase];
    if (ps === undefined) return null;
    let at = ps + s.atSec;
    if (isFiniteNumber(s.beforeEndSec)) {
      const cands = [this.stim.surgeryEndAt, this.phaseStart.emergence, isFiniteNumber(this.state.periop.plannedSurgeryEndSec) ? this.state.periop.plannedSurgeryEndSec - s.beforeEndSec : null].filter((x) => isFiniteNumber(x));
      if (!cands.length) return null;
      at = Math.max(at, Math.min(...cands));
    }
    if (typeof s.afterLoadingOf === 'string') {
      const loads = this.plan.steps.filter((x) => x !== s && !x.invalid && x.drugId === s.afterLoadingOf && x.kind === 'bolus' && (x.loading || (isFiniteNumber(x.overSec) && x.overSec >= 60)));
      if (loads.some((x) => !this.executed.has(x.id))) return null;
      for (const x of loads) { const ex = this.executed.get(x.id); if (!ex.blocked) at = Math.max(at, ex.tSec + (x.overSec || 0)); }
    }
    return at;
  }

  // ------------------------------------------------------------------ stepping
  step(dtSec = 1) {
    if (!isFiniteNumber(dtSec) || dtSec <= 0) throw new Error('step(dtSec): dtSec must be a positive number');
    const n = Math.ceil(dtSec - 1e-9);
    const h = dtSec / n;
    for (let i = 0; i < n; i++) this._substep(h);
    // Advisory haemodynamic rescue (engine/rescue.js): re-evaluated after each step; it only records
    // what is shown — a dose is given only by the clinician's explicit accept().
    if (this.rescueAdvisor && typeof this.rescueAdvisor.update === 'function') this.rescueAdvisor.update();
    // Depth-low advisory (engine/depth-advisory.js): text only; records what is shown, changes nothing.
    if (this.depthAdvisor && typeof this.depthAdvisor.update === 'function') this.depthAdvisor.update();
    return this.state;
  }

  _substep(h) {
    const S = this.state; const lib = this.lib;
    S.tSec = Math.round((S.tSec + h) * 1e6) / 1e6;
    const t = S.tSec; const dtMin = h / 60;

    // 1. plan scheduler (phase-relative atSec, then order). Anchored steps (timing review): a stop
    //    `beforeEndSec` before the end of surgery, and an infusion `afterLoadingOf` a loading dose.
    //    State-gated repeat boluses (rocuronium top-up, repeat midazolam) wait until their label condition holds.
    const due = this.plan.steps.filter((s) => !s.invalid && !this.executed.has(s.id)).map((s) => ({ s, at: this._dueAt(s) }))
      .filter((x) => x.at !== null && t >= x.at - 1e-9).sort((a, b) => a.at - b.at || a.s.order - b.s.order).map((x) => x.s);
    const premedBusy = (s) => ['induction', 'sedation'].includes(s.phase) && ['bolus', 'infusion', 'inhaled'].includes(s.kind) && this._premedBolusBusy(t);
    for (const s of due) {
      if (premedBusy(s)) {
        // Never overlap premedication with induction/sedation drugs: wait until every premed bolus has run and ended.
        if (!this.waiting.has(s.id)) this._log('dose', `Plan step held: ${getDrug(lib, s.drugId) ? getDrug(lib, s.drugId).name : s.drugId} waits until the premedication bolus has finished (no overlap of premedication and ${s.phase})`);
        this.waiting.set(s.id, 'waits until the premedication bolus has finished (no overlap)');
        continue;
      }
      if (s.kind === 'bolus') {
        const d0 = getDrug(lib, s.drugId);
        const hold = repeatBolusHold(this, s.drugId, s.route || (d0 && Array.isArray(d0.bolusRoutes) && d0.bolusRoutes[0]) || 'IV');
        if (hold) {
          if (!this.waiting.has(s.id)) { this.waiting.set(s.id, hold.reason); this.timingHolds.push({ tSec: t, drugId: s.drugId, manual: false, reason: hold.reason, sources: hold.sources }); this._log('dose', `Plan step held: ${getDrug(lib, s.drugId) ? getDrug(lib, s.drugId).name : s.drugId} — ${hold.reason} [${hold.sources.join(', ')}]`); }
          else this.waiting.set(s.id, hold.reason);
          continue;
        }
        this.waiting.delete(s.id);
      }
      let r;
      if (s.kind === 'fluid' || s.kind === 'fluid_bolus') {
        // Internal paths (05l): the scheduler runs mid-substep (tSec already advanced, vitals not yet),
        // so it must not trigger the public action()/administer() depth-advisor refresh.
        const a = this._actionImpl(s.kind === 'fluid' ? `fluid_maintenance:${s.fluidId || s.drugId}:${s.rate}` : `fluid_bolus:${s.amount}:${s.fluidId || s.drugId}`);
        if (!a.ok) this._log('dose', `BLOCKED plan fluid step ${s.id}: ${a.message}`);
        r = { ok: a.ok, blocked: !a.ok, reasons: a.ok ? [] : [a.message], warnings: [] };
      } else {
        r = this._administerImpl({ drugId: s.drugId, kind: s.kind, amount: s.amount, amountUnit: s.amountUnit, rate: s.rate, rateUnit: s.rateUnit, overSec: s.overSec, route: s.route, regimenKey: s.regimenKey }, { source: 'plan' });
      }
      this.executed.set(s.id, { tSec: t, ...r });
    }

    // 2a. fluids (illustrative): run-in, then first-order loss of retained intravascular volume
    if (this.fluid.pendingMl > 0) {
      const run = Math.min(this.fluid.pendingMl, FLUID_MODEL.RUN_ML_PER_MIN * dtMin);
      this.fluid.pendingMl -= run; this.fluid.retainedMl += run;
      if (this.fluid.pendingMl <= 1e-9) { this.fluid.pendingMl = 0; this._log('action', `Crystalloid bolus run-in complete (cumulative ${S.fluids.crystalloidMl} mL)`); }
      S.fluids.infusingMl = Math.round(this.fluid.pendingMl);
    }
    const M = S.fluids.maintenance;
    if (M.rateMlH > 0) {
      const v = M.rateMlH * dtMin / 60;
      this.fluid.retainedMl += v; S.fluids.crystalloidMl += v;
      if (M.fluidId && S.fluids.byType[M.fluidId]) S.fluids.byType[M.fluidId].maintenanceMl += v;
    }
    this.fluid.retainedMl *= Math.exp(-dtMin / FLUID_MODEL.RETENTION_TAU_MIN);
    const fluidR = 1 - Math.exp(-this.fluid.retainedMl / FLUID_MODEL.RESTORE_SCALE_ML);
    const depleted = (this.patient.conditions || []).some((c) => FLUID_MODEL.DEPLETED_CONDITIONS.includes(c));

    // 2. events
    const ev = { mapFrac: 0, hrFrac: 0, hrMult: 1, ventFactor: 1, aaAdd: 0, etco2GapAdd: 0, stimulus: 0, laryngospasm: false, sensors: new Set(),
      fluidMapFrac: (depleted ? FLUID_MODEL.DIRECT_MAP_FRAC.depleted : FLUID_MODEL.DIRECT_MAP_FRAC.euvolaemic) * fluidR };
    const H0 = this.lastEffects ? this.lastEffects.H : 0;
    for (const e of this.events) {
      let I = this._eventIntensity(e, t);
      if (I <= 0) continue;
      const p = e.def.perturbation;
      for (const [k, f] of Object.entries(p.counteredBy || {})) {
        const E = k === '_hypnosis' ? H0 : k === 'glycopyrrolate' ? (this.lastEffects ? this.lastEffects.antimuscarinic : 0)
          : k === '_bronchodilation' ? (this.lastEffects ? this.lastEffects.bronchodilation || 0 : 0) : 0;
        I *= 1 - f * E;
      }
      if (p.volumeLoss) I *= 1 - FLUID_MODEL.EVENT_COUNTER_MAX * fluidR;
      if (p.laryngospasm && this.state.airway.maskVentilation && p.resolvedBy && this.maskVentSec >= (p.resolvedBy.maskVentilationSec || Infinity) && !e.resolved) { e.resolved = true; e.resolvedAt = t; this._log('event', `${e.def.label} broken by positive-pressure mask ventilation`); }
      ev.mapFrac += (p.mapFrac || 0) * I; ev.hrFrac += (p.hrFrac || 0) * I;
      if (p.hrMult) ev.hrMult *= 1 - (1 - p.hrMult) * I;
      if (p.ventFactor !== undefined) ev.ventFactor *= 1 - (1 - p.ventFactor) * I;
      ev.aaAdd += (p.aaAdd || 0) * I; ev.etco2GapAdd += (p.etco2GapAdd || 0) * I; ev.stimulus += (p.stimulus || 0) * I;
      if (p.laryngospasm && I > 0.5) ev.laryngospasm = true;
      if (p.sensor && I > 0) ev.sensors.add(p.sensor);
    }
    this.maskVentSec = this.state.airway.maskVentilation ? this.maskVentSec + h : 0;

    // 3. direct writes to state.drugs[*].infusionRate are re-validated (never trusted)
    for (const d of listDrugs(lib)) {
      const ds = S.drugs[d.id];
      if (ds.infusionRate !== this._lastRate[d.id] && !(Number.isNaN(ds.infusionRate) && Number.isNaN(this._lastRate[d.id]))) {
        const v = ds.infusionRate;
        this._log('interlock', `Direct write detected: ${d.name} rate ${String(v)} ${ds.rateUnit} — re-validated by safety layer`);
        const isPy = S.interlocks.enabled && SIM_TO_PY_ID[d.id] && CONTROLLED.includes(SIM_TO_PY_ID[d.id]);
        if (!(isFiniteNumber(v) && v >= 0)) { if (!isPy) this._setRate(d, 0, ds.rateUnit); else this._lastRate[d.id] = v; }
        else {
          try { this._setRate(d, v, ds.rateUnit); } catch { this._setRate(d, 0, ds.rateUnit); }
          if (!isPy) this._enforceLabelRate(d, t);
          else this._labelCheckAfterInterlock = [...(this._labelCheckAfterInterlock || []), d];
        }
      }
    }

    // 4. Python-derived interlocks (1 Hz control iteration), readings = displayed monitor values.
    //    KNOWN, ACCEPTED ORDERING (audit 05l, finding 5): interlocks evaluate BEFORE physiology (step 9), i.e.
    //    on the vitals displayed at the end of the previous second, so a hold latches one simulated second
    //    after the reading crosses the threshold. This mirrors the Python controller loop and the parity tests
    //    (tests/parity.test.mjs) and is deliberately not reordered. No extra drug is delivered during the lag:
    //    the infusions for this second are zeroed here, before PK (step 6) consumes them (AUDIT_2026-11.md).
    if (S.interlocks.enabled) {
      const inf = {};
      for (const py of CONTROLLED) {
        const id = PY_TO_SIM_ID[py]; const ds = S.drugs[id];
        if (!ds) { inf[py] = 0; continue; }
        const v = ds.infusionRate;
        inf[py] = v === 0 ? 0 : (isFiniteNumber(v) ? (convertRateSafe(v, ds.rateUnit, PY_RATE_UNITS[py], this.rateWeight[id]) ?? NaN) : NaN);
      }
      this.core.infusions = inf;
      const prevStatus = this.core.status; const prevHeld = new Set(this.core.heldDrugs);
      const r = this.core.evaluate(S.vitals.hr, S.vitals.map);
      for (const py of CONTROLLED) {
        const id = PY_TO_SIM_ID[py]; const ds = S.drugs[id];
        if (ds && this.core.infusions[py] === 0 && ds.infusionRate !== 0) { this._setRate(getDrug(lib, id), 0, ds.rateUnit); this._log('interlock', `${getDrug(lib, id).name} set to zero by interlock`); }
      }
      const newHeld = [...this.core.heldDrugs].filter((d) => !prevHeld.has(d));
      // Log/record decisions without flooding: each event code is recorded at most once per 60 s
      // while it persists (and immediately when a new drug is held).
      for (const e of r.events) {
        const last = this._ilLast[e.code];
        if (last === undefined || t - last >= 60 || newHeld.length) {
          this._log('interlock', e.message); this.stats.interlockEvents.push({ tSec: t, code: e.code, message: e.message });
          this._ilLast[e.code] = t;
        }
      }
      if (r.status !== prevStatus && (r.status !== this._ilLoggedStatus) && (t - this._ilStatusT >= 30 || newHeld.length || r.status === 'GREEN')) {
        this._log('interlock', `Interlock status ${r.status}${this.core.holdLatched ? ` (hold latched: ${[...this.core.heldDrugs].map((x) => PY_TO_SIM_ID[x]).join(', ')})` : ''}`);
        this._ilLoggedStatus = r.status; this._ilStatusT = t;
      }
      S.interlocks.status = this.core.status;
      S.interlocks.holdLatched = this.core.holdLatched;
      S.interlocks.heldDrugs = [...this.core.heldDrugs].map((x) => PY_TO_SIM_ID[x]);
      this._trackHoldEpisode(t, r.events, prevHeld);
    } else {
      for (const d of listDrugs(lib)) { const ds = S.drugs[d.id]; if (!(isFiniteNumber(ds.infusionRate) && ds.infusionRate >= 0)) this._setRate(d, 0, ds.rateUnit); }
    }

    for (const d of this._labelCheckAfterInterlock || []) this._enforceLabelRate(d, t);
    this._labelCheckAfterInterlock = null;

    // 5. lockouts (all drugs) re-enforced every step
    for (const id of Object.keys(S.interlocks.lockouts)) if (S.drugs[id] && S.drugs[id].infusionRate !== 0) { this._setRate(getDrug(lib, id), 0, S.drugs[id].rateUnit); this._log('interlock', `${getDrug(lib, id).name} is locked out — set to zero`); }

    // 6. timed boluses and cumulative ceilings, then PK
    for (const tb of this.timed) {
      const amt = Math.min(tb.remaining, tb.perMin * dtMin);
      const m = this._model(tb.drugId); m.model.bolus(amt); tb.remaining -= amt; S.drugs[tb.drugId].cumulative += amt;
    }
    this.timed = this.timed.filter((x) => x.remaining > 1e-12);
    // non-IV bolus depots (IM/SC): first-order absorption (illustrative ka, pk.js ROUTE_KA_ILLUSTRATIVE),
    // slowed when MAP is far below baseline (pk.js ROUTE_PERFUSION_ILLUSTRATIVE)
    const perf = perfusionKaFactor(this.phys.out ? this.phys.out._true.map / this.phys.map0 : 1);
    for (const dp of this.depots) {
      const amt = dp.remaining * (1 - Math.exp(-dp.ka * perf * dtMin));
      this._model(dp.drugId).model.bolus(amt); dp.remaining -= amt;
    }
    this.depots = this.depots.filter((x) => x.remaining > 1e-9);
    const veffPrev = this.phys.out ? this.phys.out._true.veff : 1;
    for (const [id, m] of Object.entries(this.models)) {
      const ds = S.drugs[id]; const drug = getDrug(lib, id);
      if (m.type === 'volatile') { m.model.step(dtMin, veffPrev); continue; }
      const add = m.model.infusionPerMin * dtMin;
      if (add > 0) {
        for (const L of this.ceilings[id]) if (L.type === 'cumulative' && !L.bolusOnly && ds.cumulative + add > L.absolute + 1e-9) {
          this._setRate(drug, 0, ds.rateUnit); this._log('dose', `${drug.name} infusion stopped: cumulative ceiling reached (${L.label})`);
          this.alarmMgr.pulse(t, 'ceiling_reached', 'medium', `${drug.name}: cumulative ceiling reached`);
        }
      }
      ds.cumulative += m.model.infusionPerMin * dtMin;
      // Effect-site rocuronium leaves faster while free sugammadex is in molar excess over the
      // rocuronium still in the body; the speed-up saturates (ILLUSTRATIVE; STIMULUS constants).
      const ke0Mult = id === 'rocuronium' ? sugammadexKe0Mult(this.sgxExcess) : 1;
      m.model.step(dtMin, { ke0Mult });
    }
    // sugammadex encapsulation of rocuronium: 1:1 molar, central compartment, label molecular
    // weights. An insufficient dose is used up, then rocuronium returning from the peripheral
    // compartment stays free, so reversal is slower or incomplete (illustrative).
    this.sgxExcess = 0;
    if (this.models.sugammadex && this.models.rocuronium) {
      const sg = this.models.sugammadex.model, ro = this.models.rocuronium.model;
      const bindMmol = Math.min(ro.a1 * MMOL_PER_MG.rocuronium, sg.a1 * MMOL_PER_MG.sugammadex);
      if (bindMmol > 0) { ro.removeCentral(bindMmol / MMOL_PER_MG.rocuronium); sg.removeCentral(bindMmol / MMOL_PER_MG.sugammadex); }
      const rocBodyMmol = (ro.a1 + ro.a2 + ro.a3 + ro.ce * ro.v1L) * MMOL_PER_MG.rocuronium;
      const freeSgxMmol = (sg.a1 + sg.a2 + sg.a3) * MMOL_PER_MG.sugammadex;
      this.sgxExcess = freeSgxMmol > 1e-12 ? freeSgxMmol / Math.max(rocBodyMmol, 1e-9) : 0;
    }

    // 7. PD
    const entries = []; let totalMac = 0, potentMac = 0;
    for (const [id, m] of Object.entries(this.models)) {
      const ds = S.drugs[id]; const drug = getDrug(lib, id);
      if (m.type === 'volatile') {
        ds.cp = m.model.et; ds.ce = m.model.ce; ds.unitConc = m.model.macFraction; ds.cumulative = m.model.dialPctMin / 60;
        totalMac += ds.unitConc; if (!isNitrous(drug)) potentMac += ds.unitConc;
        continue;
      }
      ds.cp = m.model.cp; ds.ce = m.model.ce;
      const ref = m.ref && m.ref.value;
      ds.unitConc = ref ? m.model.ce / ref : 0;
      entries.push({ drug, u: ds.unitConc, cpU: ref ? m.model.cp / ref : 0 });
    }
    if (totalMac > 0) {
      // Total MAC (sum of agents' age-adjusted MAC fractions) drives hypnosis/immobility/respiratory effect;
      // hypotension is driven by the potent (non-N2O) agents' share.
      // Hypnosis uses potent MAC + N2O MAC × N2O_HYPNOSIS_FRACTION (N2O is a weak hypnotic).
      const { map: mapSpec, hyp: hypSpec, ...rest } = PROFILES.sevoflurane;
      entries.push({ drug: { id: '_volatile_total', cls: '_volatile', _profile: rest }, u: totalMac });
      entries.push({ drug: { id: '_volatile_hyp', cls: '_volatile', _profile: { hyp: hypSpec } }, u: potentMac + PATIENT_MODS.N2O_HYPNOSIS_FRACTION * (totalMac - potentMac) });
      entries.push({ drug: { id: '_volatile_potent', cls: '_volatile', _profile: { map: mapSpec } }, u: potentMac });
    }
    const effects = combineEffects(entries, this.mods);
    this.lastEffects = effects;

    // 8. stimulus
    let stim = 0; let label = 'none'; const st = this.stim;
    if (st.surgeryStartAt !== null && st.surgeryEndAt === null) { const d = t - st.surgeryStartAt; if (d < STIMULUS.INCISION_SEC) { stim = STIMULUS.INCISION; label = 'incision'; } else { stim = STIMULUS.MAINTENANCE; label = 'maintenance'; } }
    else if (st.surgeryEndAt !== null && t - st.surgeryEndAt < STIMULUS.CLOSING_SEC) { stim = STIMULUS.CLOSING; label = 'closing'; }
    if (st.laryngoscopyAt !== null && t - st.laryngoscopyAt < STIMULUS.LARYNGOSCOPY_SEC) { const s = Math.exp(-(t - st.laryngoscopyAt) / STIMULUS.LARYNGOSCOPY_DECAY_SEC); if (s >= stim) { stim = Math.max(stim, s); label = 'laryngoscopy'; } }
    if (S.airway.secured) stim = Math.max(stim, STIMULUS.TUBE_IN_SITU);
    if (st.extubatedAt !== null && t - st.extubatedAt < STIMULUS.EXTUBATION_SEC) stim = Math.max(stim, STIMULUS.EXTUBATION * Math.exp(-(t - st.extubatedAt) / STIMULUS.EXTUBATION_DECAY_SEC));
    stim += ev.stimulus;
    S.surgery.stimulus = label;

    // desflurane: rapid increases may transiently raise HR/MAP — only if the library states it.
    for (const [id, m] of Object.entries(this.models)) {
      if (m.type !== 'volatile' || !libraryMentionsSympathetic(getDrug(lib, id))) continue;
      const rise = Math.max(0, (m.model.dial - m.model.et) / (m.macAgeAdjusted || 1));
      ev.hrFrac += STIMULUS.DES_RAPID_RISE_HR * clamp(rise - STIMULUS.DES_RAPID_RISE_START_MAC, 0, 1); ev.mapFrac += STIMULUS.DES_RAPID_RISE_MAP * clamp(rise - STIMULUS.DES_RAPID_RISE_START_MAC, 0, 1);
    }

    // 9. physiology
    const out = this.phys.step(h, { effects, airway: S.airway, stimulus: stim, ev });
    const tof = tofFromTwitches(effects.twitches);
    for (const k of ['hr', 'map', 'spo2']) S.sensors[k] = ev.sensors.has(k) ? 'fault' : 'ok';
    const V = S.vitals;
    V.hr = S.sensors.hr === 'fault' ? NaN : out.hr;
    V.map = S.sensors.map === 'fault' ? NaN : out.map;
    V.sbp = S.sensors.map === 'fault' ? NaN : out.sbp;
    V.dbp = S.sensors.map === 'fault' ? NaN : out.dbp;
    V.spo2 = S.sensors.spo2 === 'fault' ? NaN : out.spo2;
    V.rr = out.rr; V.etco2 = out.etco2; V.depthIndex = out.depthIndex; V.sedationLevel = out.sedationLevel;
    V.tofCount = tof.count; V.tofRatio = Math.round(tof.ratio * 100) / 100;

    // 10. statistics
    if (isFiniteNumber(V.map) && V.map < 65) this.stats.timeMapBelow65Sec += h;
    { const [lo, hi] = TIMING_CONFIG.GA_DEPTH_BAND.value; if (this.plan.mode !== 'MAC' && S.phase === 'maintenance' && S.airway.secured && this.stim.surgeryStartAt !== null && (V.depthIndex < lo || V.depthIndex > hi)) this.stats.depthOutOfBandSec += h; }
    if (isFiniteNumber(V.spo2)) this.stats.minSpo2 = Math.min(this.stats.minSpo2, V.spo2);
    if (isFiniteNumber(V.hr)) { this.stats.maxHr = Math.max(this.stats.maxHr, V.hr); this.stats.minHr = Math.min(this.stats.minHr, V.hr); }
    if (isFiniteNumber(V.map)) { this.stats.maxMap = Math.max(this.stats.maxMap, V.map); this.stats.minMap = Math.min(this.stats.minMap, V.map); } // sensor-fault gaps (NaN) are skipped

    // 10b. depth arming state (LOC marker, "a maintenance hypnotic has run"): updated explicitly, once per
    //      substep, before anything reads it (depth-high alarm below, depth-low advisory after the step).
    this._updateDepthArmingState(V);

    // 11. alarms
    const ok = (x) => isFiniteNumber(x);
    // Level alarms with hysteresis: once on, they stay on until the value is 2 units past the threshold.
    const hy = (id, on, stayOn) => { const a = on || (this._alarmOn.has(id) && stayOn); if (a) this._alarmOn.add(id); else this._alarmOn.delete(id); return a; };
    const target = this.plan.mode === 'MAC' ? this.plan.sedationTarget : null;
    const A = ALARM_THRESHOLDS;
    const R = (x) => (ok(x) ? x : 'unusable'); // display text: an unusable reading never prints as NaN
    const conds = [
      { id: 'spo2_low', priority: 'high', message: `SpO2 ${R(V.spo2)}% < ${A.SPO2_LOW}%`, active: hy('spo2_low', ok(V.spo2) && V.spo2 < A.SPO2_LOW, ok(V.spo2) && V.spo2 < A.SPO2_LOW_CLEAR) },
      { id: 'apnea', priority: 'high', message: `Apnoea > ${A.APNOEA_SEC} s without ventilation (${Math.round(out._true.apnoeaSec)} s)`, active: out._true.apnoeaSec > A.APNOEA_SEC },
      { id: 'map_critical', priority: 'high', message: `MAP ${R(V.map)} < ${NOA_CONFIG.hemodynamic_thresholds.map_critical_low} mmHg (interlock threshold)`, active: hy('map_critical', ok(V.map) && V.map < NOA_CONFIG.hemodynamic_thresholds.map_critical_low, ok(V.map) && V.map < A.MAP_CRITICAL_CLEAR) },
      { id: 'hr_critical', priority: 'high', message: `HR ${R(V.hr)} < ${NOA_CONFIG.hemodynamic_thresholds.hr_critical_low} /min (interlock threshold)`, active: hy('hr_critical', ok(V.hr) && V.hr < NOA_CONFIG.hemodynamic_thresholds.hr_critical_low, ok(V.hr) && V.hr < A.HR_CRITICAL_CLEAR) },
      { id: 'map_low', priority: 'medium', message: `MAP ${R(V.map)} < 65 mmHg`, active: hy('map_low', ok(V.map) && V.map < A.MAP_LOW, ok(V.map) && V.map < A.MAP_LOW_CLEAR) },
      { id: 'map_high', priority: 'medium', message: `MAP ${R(V.map)} > 120 mmHg`, active: hy('map_high', ok(V.map) && V.map > A.MAP_HIGH, ok(V.map) && V.map > A.MAP_HIGH_CLEAR) },
      { id: 'hr_high', priority: 'medium', message: `HR ${R(V.hr)} > 120 /min`, active: hy('hr_high', ok(V.hr) && V.hr > A.HR_HIGH, ok(V.hr) && V.hr > A.HR_HIGH_CLEAR) },
      { id: 'sensor_fault_hr', priority: 'high', message: 'HR sensor fault (unusable reading)', active: S.sensors.hr === 'fault' },
      { id: 'sensor_fault_map', priority: 'high', message: 'MAP sensor fault (unusable reading)', active: S.sensors.map === 'fault' },
      { id: 'sensor_fault_spo2', priority: 'high', message: 'SpO2 probe off / sensor fault', active: S.sensors.spo2 === 'fault' },
      this._depthHighAlarm(V, h, hy), // reads the arming state updated once above (_updateDepthArmingState)
      { id: 'depth_over_target', priority: 'medium', message: `Sedation deeper than ${target} target (${V.sedationLevel}): airway/ventilation risk`, active: !!target && SEDATION_RANK[V.sedationLevel] > SEDATION_RANK[target] },
      ...this._prophylaxisAlarm(t),
      { id: 'interlock_hold', priority: 'medium', message: `Interlock hold latched (${S.interlocks.heldDrugs.join(', ') || 'no infusions running'}); resume_hold required`, active: S.interlocks.enabled && S.interlocks.holdLatched },
    ];
    this.alarmMgr.update(t, conds);
    S.alarms = this.alarmMgr.list();
  }

  /**
   * Hold episode identity (final-check fixes, item A: "Continue with hold latched (this hold only)").
   * A new episode starts when the hold latches, when a further drug is held, when a trigger code not seen
   * in this episode fires, or when a trigger fires again after its condition had cleared (re-latch after
   * recovery; MAP/HR count as recovered only past the alarm clearing hysteresis, MAP ≥ 62 / HR ≥ 50). The episode ends when the hold is released (resume_hold). Read-only for the runner.
   */
  _trackHoldEpisode(t, events, prevHeld) {
    const S = this.state; const codes = events.map((e) => e.code);
    if (!this.core.holdLatched) { this._holdEp = null; S.interlocks.holdEpisode = null; return; }
    const ep = this._holdEp;
    const newDrug = [...this.core.heldDrugs].some((d) => !prevHeld.has(d));
    const newCode = !!ep && codes.some((c) => !ep.triggers.includes(c));
    const relatch = !!ep && !ep.triggerActive && codes.length > 0;
    // A trigger has "recovered" only past the alarm clearing hysteresis (MAP ≥ MAP_CRITICAL_CLEAR, HR ≥
    // HR_CRITICAL_CLEAR, reused), so seeded noise around the threshold does not count as a new latch.
    const V = S.vitals; const A = ALARM_THRESHOLDS;
    const recovered = (c) => (c === 'map_low' ? isFiniteNumber(V.map) && V.map >= A.MAP_CRITICAL_CLEAR : c === 'hr_low' ? isFiniteNumber(V.hr) && V.hr >= A.HR_CRITICAL_CLEAR : !codes.includes(c));
    const triggers = !ep || relatch ? [...codes] : [...new Set([...ep.triggers, ...codes])];
    const active = codes.length > 0 || triggers.some((c) => !recovered(c));
    if (!ep || newDrug || newCode || relatch) {
      this._holdSeq = (this._holdSeq || 0) + 1;
      this._holdEp = { id: this._holdSeq, latchedAtSec: t, triggers, triggerActive: active };
    } else this._holdEp = { ...ep, triggerActive: active };
    S.interlocks.holdEpisode = { ...this._holdEp, triggers: [...this._holdEp.triggers], heldDrugs: [...S.interlocks.heldDrugs] };
  }

  /** Is a GA maintenance hypnotic (volatile dial or hypnotic infusion) running now? */
  _maintenanceHypnoticRunning() {
    for (const d of listDrugs(this.lib)) {
      if (!MAINTENANCE_HYPNOTIC_CLASSES.includes(d.cls)) continue;
      const ds = this.state.drugs[d.id];
      if (ds && isFiniteNumber(ds.infusionRate) && ds.infusionRate > 0) return true;
    }
    return false;
  }

  /**
   * Arming of the depth-high (awareness-risk) alarm: GA plan, airway secured, loss of consciousness reached
   * (index at or below the GA band upper bound since induction started), phase induction or maintenance
   * (not emergence), and not "agents off" after the end of surgery (every maintenance hypnotic stopped once
   * surgery has ended). Stopping every hypnotic DURING surgery leaves it armed. There is no depth-sensor
   * fault in this simulator; a faulted depth reading (sensors.depth === 'fault') would disarm it.
   */
  _depthHighArmed(V) {
    if (!this._depthArmingPreconditions(V) || this._locAt === null || this._locAt === undefined) return false;
    if (this.stim.surgeryEndAt !== null && this._hypnoticSeenRunning && !this._maintenanceHypnoticRunning()) return false; // agents off after surgery
    return true;
  }

  /** Shared preconditions of the depth-high arming (pure read): GA, airway secured, induction/maintenance, usable index, induction started. */
  _depthArmingPreconditions(V) {
    const S = this.state;
    if (this.plan.mode === 'MAC' || !S.airway.secured || !['induction', 'maintenance'].includes(S.phase)) return false;
    if (S.sensors.depth === 'fault' || !isFiniteNumber(V.depthIndex)) return false;
    return this.phaseStart.induction !== undefined;
  }

  /**
   * The ONLY writer of the depth arming state (audit 05l, finding 3): the loss-of-consciousness marker
   * `_locAt` (first index ≤ GA band upper bound while the preconditions hold) and `_hypnoticSeenRunning`
   * (a maintenance hypnotic ran while the preconditions held and LOC had been reached). Called once per
   * substep before the alarms, so the depth-high alarm (_depthHighArmed) and the depth-low advisory
   * (engine/depth-advisory.js depthLowArmed) read the same state whatever order they are evaluated in.
   * Same gating as before (it used to be a side effect of _depthHighArmed), so behaviour is unchanged.
   */
  _updateDepthArmingState(V) {
    if (!this._depthArmingPreconditions(V)) return;
    if (this._locAt === null || this._locAt === undefined) { if (V.depthIndex <= TIMING_CONFIG.GA_DEPTH_BAND.value[1]) this._locAt = this.state.tSec; else return; }
    if (this._maintenanceHypnoticRunning()) this._hypnoticSeenRunning = true;
  }

  /** Depth-high alarm condition (HIGH): index > GA band upper bound for ≥ DEPTH_HIGH_ALARM_SUSTAIN_SEC while armed; clears at ≤ DEPTH_HIGH_ALARM_CLEAR. */
  _depthHighAlarm(V, h, hy) {
    const hi = TIMING_CONFIG.GA_DEPTH_BAND.value[1];
    const N = TIMING_CONFIG.DEPTH_HIGH_ALARM_SUSTAIN_SEC.value; const clr = TIMING_CONFIG.DEPTH_HIGH_ALARM_CLEAR.value;
    const armed = this._depthHighArmed(V);
    this._depthHighSec = armed && V.depthIndex > hi ? (this._depthHighSec || 0) + h : 0;
    const active = hy('depth_high', armed && this._depthHighSec >= N - 1e-9, armed && V.depthIndex > clr);
    return { id: 'depth_high', priority: TIMING_CONFIG.DEPTH_HIGH_ALARM_PRIORITY.value, active,
      message: `Processed-EEG index ${V.depthIndex} > ${hi} for ≥ ${N} s during general anaesthesia — risk of awareness; check hypnotic delivery (simulated index, illustrative)` };
  }

  /** Plan-level maintenance-hypnotic check for this case (engine/plan-safety.js), with the case's lockouts. */
  maintenanceHypnoticGap() { return maintenanceHypnoticGap(this.plan, this.patient, { library: this.lib, lockouts: this.state.interlocks.lockouts }); }

  _prophylaxisAlarm(t) {
    const P = this.state.prophylaxis;
    if (!P.doses.length) return [];
    P.redose = redoseStatus(P.doses, t, this.lib);
    const during = this.stim.surgeryStartAt !== null && this.stim.surgeryEndAt === null;
    const due = P.redose.items.filter((x) => x.due);
    return [{ id: 'abx_redose', priority: PROPHYLAXIS_CONFIG.REDOSE_ALARM_PRIORITY.value, active: during && due.length > 0,
      message: due.length ? `Prophylaxis redose due: ${due.map((x) => `${x.name} every ${x.intervalMin / 60} h, last dose started ${Math.round((t - x.lastSec) / 60)} min ago [${x.sources.join(', ')}]`).join('; ')}` : 'Prophylaxis redose due' }];
  }

  _enforceLabelRate(d, t) {
    const ds = this.state.drugs[d.id];
    if (ds.infusionRate > 0 && !this._withinLabelRate(d, ds.infusionRate, ds.rateUnit)) {
      this._setRate(d, 0, ds.rateUnit);
      this._log('interlock', `${d.name}: rate above label ceiling — set to zero`);
      this.alarmMgr.pulse(t, 'dose_blocked', 'medium', `${d.name} rate above label ceiling`);
    }
  }

  _withinLabelRate(drug, rate, unit) {
    for (const L of this.ceilings[drug.id]) {
      if (L.type === 'rate') { const cap = convertRateSafe(L.value, L.rateUnit, unit, L.weightKg ?? this.rateWeight[drug.id]); if (cap !== null && rate > cap + 1e-9) return false; }
      if (L.type === 'dial' && unit === '%' && rate > L.value + 1e-9) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ readouts
  extubationReadiness() {
    const V = this.state.vitals; const tr = this.phys.out ? this.phys.out._true : null;
    const tofSrc = (this.lib.SOURCE_IDS_ENGINE && this.lib.SOURCE_IDS_ENGINE.tofExtubation) || findSourceId(this.lib, 'Thilen') || null;
    const sRr = tr ? tr.spontaneousRr : this.patient.baseline.rr;
    const cap = tr ? tr.spontaneousCapability : 1;
    const X = EXTUBATION_CRITERIA;
    const criteria = [
      { id: 'awake', label: 'Awake (depth index ≥ 80, illustrative)', met: V.depthIndex >= X.DEPTH_AWAKE, value: V.depthIndex, source: 'illustrative' },
      { id: 'tofr', label: 'TOF ratio ≥ 0.9', met: V.tofRatio >= ALARM_THRESHOLDS.TOFR_EXTUBATION, value: V.tofRatio, source: tofSrc },
      { id: 'ventilation', label: 'Adequate spontaneous ventilation (RR ≥ 8, illustrative)', met: sRr >= X.RR_MIN && cap >= X.CAPABILITY_MIN, value: Math.round(sRr), source: 'illustrative' },
      { id: 'spo2', label: 'SpO2 ≥ 94 % (illustrative)', met: isFiniteNumber(V.spo2) && V.spo2 >= X.SPO2_MIN, value: V.spo2, source: 'illustrative' },
      { id: 'hemodynamics', label: 'Haemodynamically stable (MAP 65–110, HR 50–110; illustrative)', met: isFiniteNumber(V.map) && isFiniteNumber(V.hr) && V.map >= X.MAP_MIN && V.map <= X.MAP_MAX && V.hr >= X.HR_MIN && V.hr <= X.HR_MAX, value: { map: V.map, hr: V.hr }, source: 'illustrative' },
    ];
    return { ready: criteria.every((c) => c.met), criteria };
  }

  planStatus() {
    return this.plan.steps.map((s) => ({ id: s.id, phase: s.phase, drugId: s.drugId, kind: s.kind, status: s.invalid ? 'invalid' : this.executed.has(s.id) ? (this.executed.get(s.id).blocked ? 'blocked' : 'done') : 'pending', result: this.executed.get(s.id) || (s.invalid ? { invalid: s.invalid } : null),
      ...(!this.executed.has(s.id) && this.waiting.has(s.id) ? { waiting: this.waiting.get(s.id) } : {}) }));
  }

  summary() {
    const totals = {};
    for (const [id, ds] of Object.entries(this.state.drugs)) {
      if (ds.cumulative > 0) totals[id] = { amount: roundSig(ds.cumulative), unit: ds.amountUnit, perKg: ds.amountUnit === '%·h' ? null : roundSig(ds.cumulative / this.patient.weightKg), perKgBasis: 'TBW' };
    }
    return {
      durationSec: this.state.tSec, totals,
      timeMapBelow65Sec: Math.round(this.stats.timeMapBelow65Sec),
      minSpo2: isFiniteNumber(this.stats.minSpo2) ? this.stats.minSpo2 : null,
      maxHr: isFiniteNumber(this.stats.maxHr) ? this.stats.maxHr : null,
      minHr: isFiniteNumber(this.stats.minHr) ? this.stats.minHr : null,
      maxMap: isFiniteNumber(this.stats.maxMap) ? this.stats.maxMap : null,
      minMap: isFiniteNumber(this.stats.minMap) ? this.stats.minMap : null,
      alarms: this.alarmMgr.history.map((a) => ({ ...a })),
      extubation: this.stats.extubation || { tSec: null, ...this.extubationReadiness(), note: 'not extubated; current readiness' },
      interlockEvents: this.stats.interlockEvents.slice(),
      periop: { ...this.state.periop, timeOut: this.state.periop.timeOut ? { ...this.state.periop.timeOut } : null, depthAck: this.state.periop.depthAck ? { ...this.state.periop.depthAck } : null, sedationAck: this.state.periop.sedationAck ? { ...this.state.periop.sedationAck } : null },
      depthOutOfBandSec: Math.round(this.stats.depthOutOfBandSec),
      timingChecks: liveTimingChecks(this),
      fluids: { crystalloidMl: roundSig(this.state.fluids.crystalloidMl), perKg: roundSig(this.state.fluids.crystalloidMl / this.patient.weightKg, 3), perKgBasis: 'TBW', boluses: this.state.fluids.boluses.map((b) => ({ ...b })),
        byType: Object.fromEntries(Object.entries(this.state.fluids.byType).map(([id, v]) => [id, { name: (getFluid(this.lib, id) || {}).name || id, bolusMl: roundSig(v.bolusMl), maintenanceMl: roundSig(v.maintenanceMl), totalMl: roundSig(v.bolusMl + v.maintenanceMl) }])),
        maintenance: { ...this.state.fluids.maintenance }, model: 'illustrative volume-restoration model (author estimates); same model for every fluid type' },
      prophylaxis: { indicated: this.state.prophylaxis.indicated, doses: this.state.prophylaxis.doses.map((d) => ({ ...d })), window: this.state.prophylaxis.window ? { ...this.state.prophylaxis.window } : null,
        redose: redoseStatus(this.state.prophylaxis.doses, this.state.tSec, this.lib), checklistAcknowledged: this.state.prophylaxis.checklistAcknowledged, note: 'Timing only; antibiotic pharmacology is not modelled.' },
      lidocaine: this.state.drugs.lidocaine ? { totalMg: roundSig(this.state.drugs.lidocaine.cumulative), perKgIbw: roundSig(this.state.drugs.lidocaine.cumulative / scalarWeight(this.patient, 'IBW').weightKg, 3), pretreatmentMg: roundSig(this.lido.pretreatAt.reduce((a, x) => a + (x.amount || 0), 0)), pretreatmentDoses: this.lido.pretreatAt.length, overlapWarning: this.lido.warned } : null,
      automatic: this.autoRun && typeof this.autoRun.record === 'function' ? this.autoRun.record() : { used: false },
      teachingCeilings: this.teachingCeilingStatus(),
      advisories: this.rescueAdvisor && typeof this.rescueAdvisor.record === 'function' ? this.rescueAdvisor.record() : { used: false, shown: 0, accepted: 0, dismissed: 0, entries: [] },
      depthAdvisories: this.depthAdvisor && typeof this.depthAdvisor.record === 'function' ? this.depthAdvisor.record() : { used: false, shown: 0, dismissed: 0, entries: [] },
      modelNote: 'Illustrative model output — educational simulation, fictional patient; not a medical device.',
    };
  }

  /**
   * PK model provenance per drug used so far ({ [drugId]: { type, provenance, reference, parameters } }).
   * The complete parameter inventory (every model parameter with provenance and sourceIds) is
   * attached as the NON-ENUMERABLE property `inventory`, so Object.entries(modelInfo()) still
   * lists drugs only (backward compatible). Same data: sim.parameterInventory().
   */
  modelInfo() {
    const inv = this.parameterInventory();
    const out = Object.fromEntries(Object.entries(this.models).map(([id, m]) => [id, { type: m.type, provenance: m.provenance, reference: m.ref, parameters: inv.filter((x) => x.drugId === id && x.component === 'pk') }]));
    Object.defineProperty(out, 'inventory', { value: inv, enumerable: false });
    return out;
  }

  /** Every model parameter: { component, drugId?, name, value, unit, provenance, sourceIds, note }. */
  parameterInventory() {
    return buildParameterInventory({ lib: this.lib, patient: this.patient, mods: this.mods, models: this.models, fluidModel: FLUID_MODEL, lidocaineRules: LIDOCAINE_RULES, prophylaxisConfig: PROPHYLAXIS_CONFIG, mw: MW, minFio2WithN2O: MIN_FIO2_WITH_N2O, alarmThresholds: ALARM_THRESHOLDS, extubationCriteria: EXTUBATION_CRITERIA, stimulus: STIMULUS });
  }
}

// --------------------------------------------------------------------------
function makeRng(seed) {
  // local import-free wrapper (rng.js) — kept separate for clarity
  return createRngLocal(seed);
}

function defaultRateUnit(drug) {
  const regs = drug.regimens || {};
  for (const k of ['maintenance', 'sedation_moderate', 'sedation_deep', 'sedation_minimal', ...Object.keys(regs)]) if (regs[k] && regs[k].rate && regs[k].rate.unit) return regs[k].rate.unit;
  return null;
}

function rateWeightFor(drug, p) {
  const regs = drug.regimens || {};
  for (const k of ['maintenance', 'sedation_moderate', 'sedation_deep', 'sedation_minimal', ...Object.keys(regs)]) if (regs[k] && regs[k].rate && regs[k].scalar) return scalarWeight(p, regs[k].scalar).weightKg;
  return p.weightKg;
}

/** ke0 multiplier for rocuronium given the free-sugammadex : rocuronium molar ratio (illustrative). */
export function sugammadexKe0Mult(excess) {
  if (!(excess > 0)) return 1;
  const n = STIMULUS.SUGAMMADEX_EXCESS_HILL;
  const x = Math.pow(excess, n); const hh = Math.pow(STIMULUS.SUGAMMADEX_EXCESS_HALF, n);
  return 1 + (STIMULUS.SUGAMMADEX_KE0_MULT_MAX - 1) * x / (x + hh);
}

function libraryMentionsSympathetic(drug) {
  if (Array.isArray(drug.runtimeRules) && drug.runtimeRules.some((r) => /rapid_concentration_increase/.test(r.id || ''))) return true;
  return false;
}

function fmtSec(sec) { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function describe(cmd) {
  if (!cmd) return '';
  if (cmd.kind === 'bolus') return `${cmd.amount} ${cmd.amountUnit || ''} bolus`;
  if (cmd.kind === 'infusion' || cmd.kind === 'inhaled') return `${cmd.rate} ${cmd.rateUnit || ''}`;
  return cmd.kind || '';
}

export { Simulation };

export function createSimulation({ patient, plan = null, seed = 1, interlocks = true, library = null } = {}) {
  return new Simulation({ patient, plan, seed, interlocks, library });
}

