// Emergency-rescue stress matrix — shared deterministic driver (not a test file itself: it is imported by
// tests/emergency-stress-2026-11.test.mjs, which runs a representative subset in `npm test`, and by
// tools/emergency-stress-report.mjs, which runs the full matrix and writes EMERGENCY_STRESS.md).
// EDUCATIONAL SIMULATION — fictional patients — not a medical device, not clinical decision support.
// Every vital sign here is ILLUSTRATIVE MODEL OUTPUT (engine/physiology.js, engine/pd.js).
//
// Question answered: do the rescue interventions the engine offers work in its scripted emergencies,
// across extreme (fictional) patients, and do the safety rules hold in every run — including deliberately
// abusive dosing?
//
// Rules this driver follows (SPEC §0/§7):
//  * Every dose comes from the drug library through recommend() (data/drugs.js regimens) or is a value
//    read from the library limits (interpretCeilings) to PROBE a cap. No dose number is written here.
//  * Patients are fictional and built through derivePatient (validation applies); plans are built from the
//    technique templates (engine/templates.js buildTemplatePlan) and must pass the plan-safety check.
//  * Driver timings (when the simulated clinician reacts, how often a rescue is repeated where no label
//    interval exists, how many fluid boluses) are DRIVER CONVENTIONS listed in DRIVER_CONVENTIONS, not
//    clinical recommendations. Label repeat intervals are read from engine/timing.js TIMING_CONFIG.
//  * Nothing here changes the physiology or the doses to make an outcome look better.

import { getDefaultLibrary, getDrug, listDrugs } from '../engine/library.js';
import { derivePatient } from '../engine/patient.js';
import { createSimulation, ALARM_THRESHOLDS } from '../engine/sim.js';
import { GAINS } from '../engine/physiology.js';
import { recommend, interpretCeilings, convertRateSafe } from '../engine/dosing.js';
import { buildTemplatePlan } from '../engine/templates.js';
import { maintenanceHypnoticGap } from '../engine/plan-safety.js';
import { createRescueAdvisor } from '../engine/rescue.js';
import { RESCUE_CONFIG } from '../engine/rescue-config.js';
import { TIMING_CONFIG, LABEL_REPEAT_INTERVALS } from '../engine/timing.js';
import { createAutoRunner } from '../engine/autorun.js';
import { SIM_TO_PY_ID, CONTROLLED, PY_RATE_UNITS, NOA_CONFIG, aboveCeiling } from '../engine/interlocks.js';
import { SCENARIOS, EXAMPLE_PATIENTS } from '../data/scenarios.js';
import { convertAmount } from '../engine/units.js';

export const LIB = getDefaultLibrary();

// ------------------------------------------------------------------------------------------------ matrix
/** Every scripted complication that is not a pure sensor fault (data/scenarios.js). */
export const EMERGENCIES = SCENARIOS.filter((s) => !s.perturbation.sensor).map((s) => s.id);
export const SENSOR_FAULTS = SCENARIOS.filter((s) => s.perturbation.sensor).map((s) => s.id);

/** Arms. 'rescue_im' only for anaphylaxis (label IM epinephrine instead of the guideline IV bolus). */
export const ARMS = Object.freeze(['control', 'rescue', 'aggressive']);
export const armsFor = (emergency) => (emergency === 'anaphylaxis_hypotension' ? [...ARMS, 'rescue_im'] : [...ARMS]);
export const TIMINGS = Object.freeze(['early', 'late']);
export const SEEDS = Object.freeze([1, 2, 3]);

/** Driver timeline and decision conventions (simulated clinician; NOT clinical recommendations). */
export const DRIVER_CONVENTIONS = Object.freeze({
  PREMED_SEC: 300, INDUCTION_SEC: 360, PRE_INCISION_SEC: 300,
  FIO2_MAINTENANCE: 0.5, FIO2_INDUCTION: 1,
  // FiO2 is left at the maintenance value through emergence and extubation (no pre-extubation 100 % O2): a stress
  // condition — with FiO2 1.0 before extubation no patient desaturated during the scripted laryngospasm (EMERGENCY_STRESS.md).
  FIO2_EMERGENCE: 0.5,
  // Variant 'lightened' (light anaesthesia only, reported separately): the maintenance hypnotic is turned down to the
  // bottom of its label regimen range (recommend() range.min) LIGHTEN_BEFORE_SEC before the stimulus, in every arm —
  // at the default maintenance the scripted stimulus is blunted completely (EMERGENCY_STRESS.md).
  LIGHTEN_BEFORE_SEC: 300,
  ONSET_AFTER_INCISION_SEC: Object.freeze({ early: 300, late: 1200 }),
  OBSERVE_SEC: 1500, OBSERVE_LARYNGOSPASM_SEC: 900,
  SURGERY_SEC_BEFORE_EMERGENCE: 1500, READINESS_TIMEOUT_SEC: 1500,
  EXTUBATE_AFTER_READY_SEC: Object.freeze({ early: 0, late: 180 }),
  RECOVERY_SUSTAIN_SEC: 60,
  RECOGNITION_SEC: 30,     // time until the simulated clinician recognises bronchospasm / anaphylaxis
  ETCO2_HIGH_MMHG: 45,     // bronchospasm: EtCO2 above this → IV epinephrine (driver convention, not a sourced threshold)
  FLUID_BOLUS_ML: 500, FLUID_MAX_BOLUSES: 4, // crystalloid: no label dose exists; 4 × 500 mL is a driver cap
  NO_LABEL_INTERVAL_REPEAT_SEC: RESCUE_CONFIG.OTHER_VASOPRESSOR_REASSESS_SEC.value, // reused simulator convention (120 s)
  FENTANYL_REPEAT_SEC: 180, FENTANYL_MAX_DOSES: 4,
  DEEPEN_VOLATILE_STEP_PCT: 0.5, DEEPEN_PROPOFOL_STEP: 50, // stays inside the regimen range (recommend())
  EPI_INFUSION_AFTER_BOLUSES: 3, EPI_INFUSION_STEP_SEC: 600, // label titration text: adjust every 10–15 min [S40, S41]
  AGGRESSIVE_EVERY_SEC: 5, AGGRESSIVE_FOR_SEC: 600,
});

/** Plausible bounds for illustrative vitals (justification in EMERGENCY_STRESS.md): the physiology clamps
 * MAP and HR to 25–200 and SpO2 to 40–100 (engine/physiology.js); the bounds are a little wider than the
 * clamps so a clamp failure would show, and every value outside them is non-physiological. */
export const BOUNDS = Object.freeze({ map: [20, 220], sbp: [20, 300], dbp: [0, 220], hr: [20, 250], spo2: [0, 100], rr: [0, 60], etco2: [0, 150], depthIndex: [0, 100] });
export const MODEL_CLAMPS = Object.freeze({ map: [25, 200], hr: [25, 200], spo2: [40, 100] });

const noSB = { snoring: false, tired: false, observedApnea: false, pressure: false };
const air = { mallampati: 1, difficultHistory: false, limitedMouthOpening: false, limitedNeck: false };
const base = (over) => ({ sex: 'male', ageYears: 45, heightCm: 175, weightKg: 75, asa: 2, emergency: false,
  baseline: { hr: 72, sbp: 125, dbp: 78, spo2: 98, rr: 14 }, egfr: 90, airway: air, conditions: [], allergies: [], medications: [],
  ponvHistory: false, smoker: false, postopOpioidsExpected: true, stopBang: { ...noSB }, ...over });
const ex = (id) => EXAMPLE_PATIENTS.find((x) => x.id === id).patient;

/** Fictional extreme patients (inputs to derivePatient). */
export const STRESS_PATIENTS = Object.freeze([
  { id: 'age18_asa1', label: '18 y, ASA 1, eGFR 120', input: base({ sex: 'female', ageYears: 18, heightCm: 165, weightKg: 60, asa: 1, egfr: 120, baseline: { hr: 70, sbp: 115, dbp: 70, spo2: 99, rr: 14 } }) },
  { id: 'age90', label: '90 y, ASA 3, eGFR 45', input: base({ ageYears: 90, heightCm: 170, weightKg: 65, asa: 3, egfr: 45, baseline: { hr: 68, sbp: 150, dbp: 75, spo2: 95, rr: 16 } }) },
  { id: 'wt40_bmi15', label: '40 kg, BMI 14.7', input: base({ sex: 'female', ageYears: 30, heightCm: 165, weightKg: 40, egfr: 100, baseline: { hr: 78, sbp: 108, dbp: 66, spo2: 99, rr: 14 } }) },
  { id: 'wt200_bmi65_osa', label: '200 kg, BMI 65, OSA, ASA 3', input: base({ ageYears: 45, heightCm: 175, weightKg: 200, asa: 3, conditions: ['osa'], baseline: { hr: 88, sbp: 142, dbp: 88, spo2: 94, rr: 18 }, airway: { ...air, mallampati: 3 }, stopBang: { snoring: true, tired: true, observedApnea: true, pressure: true, neckCm: 52 } }) },
  { id: 'egfr10_asa4', label: 'eGFR 10, ASA 4', input: base({ ageYears: 60, weightKg: 80, asa: 4, egfr: 10, conditions: ['diabetes'], baseline: { hr: 80, sbp: 150, dbp: 85, spo2: 96, rr: 16 } }) },
  { id: 'asa4_hfref_cad', label: 'ASA 4, HFrEF + CAD, 72 y', input: base({ ageYears: 72, weightKg: 80, asa: 4, egfr: 55, conditions: ['hf_reduced_ef', 'cad'], baseline: { hr: 76, sbp: 118, dbp: 70, spo2: 95, rr: 16 } }) },
  { id: 'beta_blocker_brady', label: 'Beta-blocker, baseline HR 52, 68 y', input: base({ sex: 'female', ageYears: 68, heightCm: 160, weightKg: 70, asa: 3, medications: ['beta_blocker'], conditions: ['cad'], baseline: { hr: 52, sbp: 135, dbp: 80, spo2: 97, rr: 14 } }) },
  { id: 'elderly_cad_ckd', label: 'Example: elderly CAD/CKD, beta-blocker', input: ex('elderly_cad_ckd') },
  { id: 'obese_osa', label: 'Example: obese OSA', input: ex('obese_osa') },
  { id: 'mh_susceptible', label: 'Example: MH-susceptible (TIVA)', input: ex('mh_susceptible') },
  { id: 'hypovolaemia', label: 'Hypovolaemia, ASA 3', input: base({ sex: 'female', ageYears: 50, heightCm: 165, weightKg: 65, asa: 3, conditions: ['hypovolemia'], baseline: { hr: 96, sbp: 102, dbp: 62, spo2: 98, rr: 16 } }) },
  { id: 'sepsis_emergency', label: 'Sepsis, emergency, ASA 4', input: base({ ageYears: 55, heightCm: 178, weightKg: 85, asa: 4, emergency: true, conditions: ['sepsis'], baseline: { hr: 106, sbp: 100, dbp: 56, spo2: 95, rr: 22 } }) },
]);

/**
 * Documented findings the efficacy assertions allow (EMERGENCY_STRESS.md "Findings"); anything else that fails the
 * directional check fails the test. Reported, not tuned:
 *  - notRecovered: emergency → patients in whom the rescue arm does not recover in every run (hemorrhage never stops).
 *  - neverDeranged: emergencies where the control arm never deranges the primary sign for most patients, so
 *    "rescue vs control" is "no derangement" (light anaesthesia at the default maintenance; laryngospasm in
 *    non-obese patients at FiO2 0.5).
 */
export const KNOWN_FINDINGS = Object.freeze({
  notRecovered: Object.freeze({ hemorrhage: Object.freeze(['asa4_hfref_cad', 'sepsis_emergency']) }),
  neverDeranged: Object.freeze(['light_anesthesia_stimulus', 'laryngospasm_on_extubation']),
});

/** Representative deterministic subset for `npm test` (the full matrix runs in tools/emergency-stress-report.mjs). */
export const SUBSET_PATIENTS = Object.freeze(['age90', 'wt200_bmi65_osa', 'mh_susceptible', 'sepsis_emergency']);

const patCache = new Map();
export function stressPatient(id) {
  if (!patCache.has(id)) patCache.set(id, derivePatient(STRESS_PATIENTS.find((x) => x.id === id).input, { library: LIB }));
  return patCache.get(id);
}

/** GA plan from a technique template; must pass plan safety (no maintenance-hypnotic gap after lockouts). */
export function stressPlan(p, templateId = 'ga_opioid') {
  const { plan, skipped, substitutions } = buildTemplatePlan(templateId, p, { library: LIB });
  const gap = maintenanceHypnoticGap(plan, p, { library: LIB });
  return { plan, skipped, substitutions, gap };
}

// ------------------------------------------------------------------------------------------------ helpers
const rec = (p, key, id) => recommend(p, key, id, LIB);
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
/** Label repeat interval (s) for a bolus of drugId by route, from TIMING_CONFIG via engine/timing.js. */
function labelInterval(drugId, route, phase) {
  const r = LABEL_REPEAT_INTERVALS.find((x) => x.drugId === drugId && x.routes.includes(route) && (!x.exceptPhases || !x.exceptPhases.includes(phase)));
  return r ? r : null;
}

/** Bolus ranges of every regimen of the drug for this patient, route-aware: [{ key, min, max, route }]. */
function bolusRanges(p, drug) {
  const out = [];
  for (const [key, reg] of Object.entries(drug.regimens || {})) {
    if (!reg) continue;
    const r = rec(p, key, drug.id);
    const route = reg.route || 'IV';
    for (const d of [reg.kind === 'bolus' ? r.dose : null, r.loading]) if (d && fin(d.range.min) && fin(d.range.max)) out.push({ key, min: convertAmount(d.range.min, d.unit, drug.amountUnit), max: convertAmount(d.range.max, d.unit, drug.amountUnit), route });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ context + monitor
function makeContext(sim, adv, p, record, V_) {
  const ctx = { sim, adv, p, record, V_, doses: [], mem: {}, onset: null, faultInjected: null, resumeCalls: 0, actions: [] };
  ctx.drug = (id) => getDrug(LIB, id);
  ctx.rec = (key, id) => rec(p, key, id);
  ctx.act = (id) => { const r = sim.action(id); ctx.actions.push({ tSec: sim.state.tSec, id, ok: r.ok }); if (id === 'resume_hold') ctx.resumeCalls++; return r; };
  ctx.inject = (id) => { const r = sim.inject(id); if (!r.ok) V_(`inject ${id} failed: ${r.message}`); return r; };
  // Every administration through the public API (driver, advisory accept) is checked; the plan scheduler uses the
  // engine-internal path and is checked by the per-second monitor (cumulative, rates) instead.
  const administer = sim.administer.bind(sim);
  ctx.administer = administer;
  sim.administer = (cmd, meta) => giveChecked(ctx, cmd, meta);
  ctx.give = (cmd, meta) => sim.administer(cmd, meta);
  ctx.monitor = makeMonitor(ctx);
  return ctx;
}

/**
 * Administer through sim.administer and check the result independently of the engine:
 * accepted → within every hard limit (per dose, per route, cumulative) and given exactly as ordered (no silent
 * clamping); outside the sourced regimen range or the label repeat interval → must carry a warning;
 * blocked → logged as BLOCKED and nothing given.
 */
function giveChecked(ctx, cmd, meta = undefined) {
  const { sim, p } = ctx; const t = sim.state.tSec; const drug = getDrug(LIB, cmd.drugId);
  const before = { cum: sim.state.drugs[drug.id].cumulative, bolus: (sim.bolusGiven[drug.id] || 0), pending: sim.timed.filter((x) => x.drugId === drug.id).reduce((a, x) => a + x.remaining, 0), doseLog: sim.doseLog.length, log: sim.state.log.length };
  const lastSameRoute = [...sim.doseLog].reverse().find((d) => d.drugId === drug.id && d.kind === 'bolus' && (d.route || 'IV') === (cmd.route || defaultRoute(drug)));
  const r = meta ? ctx.administer(cmd, meta) : ctx.administer(cmd);
  const entry = { tSec: t, drugId: drug.id, kind: cmd.kind, amount: cmd.amount ?? null, rate: cmd.rate ?? null, unit: cmd.amountUnit || cmd.rateUnit || null, route: cmd.kind === 'bolus' ? (cmd.route || defaultRoute(drug)) : null, source: (meta && meta.source) || 'user', ok: r.ok, blocked: r.blocked, reason: r.blocked ? r.reasons[0] : null, warned: (r.warnings || []).length > 0, flags: [] };
  if (r.blocked) {
    if (sim.doseLog.length !== before.doseLog) ctx.V_(`${drug.id}: blocked but a dose was recorded`);
    if (Math.abs(sim.state.drugs[drug.id].cumulative - before.cum) > 1e-9 || (sim.bolusGiven[drug.id] || 0) !== before.bolus) ctx.V_(`${drug.id}: blocked but the cumulative amount changed`);
    if (!sim.state.log.slice(before.log).some((l) => /^BLOCKED /.test(l.message))) ctx.V_(`${drug.id}: blocked without a BLOCKED log line`);
  } else if (r.ok && cmd.kind === 'bolus') {
    const amt = convertAmount(cmd.amount, cmd.amountUnit || drug.amountUnit, drug.amountUnit);
    const dl = sim.doseLog[sim.doseLog.length - 1];
    if (!dl || dl.drugId !== drug.id || Math.abs(dl.amount - amt) > 1e-9) ctx.V_(`${drug.id}: accepted bolus recorded as ${dl && dl.amount} instead of the ordered ${amt} (clamped?)`);
    const route = entry.route;
    for (const L of interpretCeilings(drug, p)) {
      if (L.route && L.route !== route) continue;
      if (L.type === 'bolus' && amt > L.absolute + 1e-9) ctx.V_(`${drug.id}: accepted ${amt} ${drug.amountUnit} above ${L.label}`);
      if (L.type === 'cumulative' && L.bolusOnly && before.bolus + amt > L.absolute + 1e-9) ctx.V_(`${drug.id}: accepted bolus total ${before.bolus + amt} above ${L.label}`);
      if (L.type === 'cumulative' && !L.bolusOnly && before.cum + before.pending + amt > L.absolute + 1e-9) ctx.V_(`${drug.id}: accepted cumulative ${before.cum + amt} above ${L.label}`);
    }
    const ranges = bolusRanges(p, drug).filter((x) => x.route === route);
    const inRange = !ranges.length || ranges.some((x) => amt >= x.min - 1e-9 && amt <= x.max + 1e-9);
    if (!inRange) { entry.flags.push('outside_regimen_range'); if (!entry.warned) ctx.V_(`${drug.id}: ${amt} ${drug.amountUnit} ${route} outside every sourced ${route} regimen range, accepted WITHOUT a warning`); }
    const iv = labelInterval(drug.id, route, sim.state.phase);
    if (iv && lastSameRoute && t - lastSameRoute.tSec < iv.minSec - 1e-9) { entry.flags.push('inside_label_repeat_interval'); if (!entry.warned) ctx.V_(`${drug.id}: repeat ${route} bolus ${Math.round(t - lastSameRoute.tSec)} s after the previous one (label ≥ ${iv.minSec} s [${iv.sourceIds.join(', ')}]) accepted WITHOUT a warning`); }
    entry.amount = amt; entry.unit = drug.amountUnit;
  } else if (r.ok && (cmd.kind === 'infusion' || cmd.kind === 'inhaled')) {
    if (!sim._withinLabelRate(drug, cmd.rate, cmd.rateUnit || sim.state.drugs[drug.id].rateUnit)) ctx.V_(`${drug.id}: accepted rate ${cmd.rate} ${cmd.rateUnit} above the label rate ceiling`);
    if (sim.state.drugs[drug.id].infusionRate !== cmd.rate) ctx.V_(`${drug.id}: accepted rate ${cmd.rate} but running ${sim.state.drugs[drug.id].infusionRate} (clamped?)`);
  }
  ctx.doses.push(entry);
  return r;
}
function defaultRoute(drug) { return Array.isArray(drug.bolusRoutes) && drug.bolusRoutes.length ? drug.bolusRoutes[0] : 'IV'; }

function makeMonitor(ctx) {
  const { sim } = ctx; const V_ = ctx.V_;
  const S = []; // per-second samples after onset
  const M = { holdEver: false, clampSec: { map: 0, hr: 0, spo2: 0 } };
  let prev = { latched: sim.core.holdLatched, resume: 0, critical: false };
  const controlledHeld = () => (sim.state.interlocks.enabled ? sim.state.interlocks.heldDrugs : []);
  M.run = (n) => {
    for (let i = 0; i < n; i++) {
      sim.step(1);
      const st = sim.state; const v = st.vitals; const t = st.tSec;
      // 1. finite vitals (NaN only on a faulted channel; never Infinity)
      for (const k of ['hr', 'map', 'sbp', 'dbp', 'spo2', 'rr', 'depthIndex', 'tofRatio', 'tofCount']) {
        const x = v[k]; const ch = k === 'sbp' || k === 'dbp' ? 'map' : k;
        if (x === Infinity || x === -Infinity) V_(`t=${t}: ${k} is ${x}`);
        else if (Number.isNaN(x) && st.sensors[ch] !== 'fault') V_(`t=${t}: ${k} NaN without a sensor fault`);
        else if (typeof x !== 'number') V_(`t=${t}: ${k} is ${typeof x}`);
        if (BOUNDS[k] && fin(x) && (x < BOUNDS[k][0] || x > BOUNDS[k][1])) V_(`t=${t}: ${k} ${x} outside plausible bounds ${BOUNDS[k].join('–')}`);
      }
      if (v.etco2 !== null && !(fin(v.etco2) && v.etco2 >= BOUNDS.etco2[0] && v.etco2 <= BOUNDS.etco2[1])) V_(`t=${t}: EtCO2 ${v.etco2}`);
      const tr = sim.phys.out._true;
      for (const k of ['hr', 'map', 'spo2', 'sao2', 'pao2', 'paco2', 'veff']) if (!fin(tr[k])) V_(`t=${t}: internal ${k} = ${tr[k]}`);
      for (const [id, ds] of Object.entries(st.drugs)) if (!fin(ds.cumulative) || !fin(ds.infusionRate) || !fin(ds.ce) || !fin(ds.cp)) V_(`t=${t}: ${id} state not finite`);
      if (ctx.onset !== null) for (const k of ['map', 'hr', 'spo2']) if (fin(tr[k]) && (tr[k] <= MODEL_CLAMPS[k][0] + 1e-9 || (k !== 'spo2' && tr[k] >= MODEL_CLAMPS[k][1] - 1e-9))) M.clampSec[k]++;
      // 2. interlocks: latch within one control iteration of MAP < 60 / HR < 48 / unusable reading; never auto-release
      if (st.interlocks.enabled) {
        const latched = sim.core.holdLatched;
        if (prev.latched && !latched && ctx.resumeCalls === prev.resume) V_(`t=${t}: hold released without resume_hold`);
        if (prev.critical && !latched) V_(`t=${t}: previous reading critical (MAP<60 / HR<48 / unusable) but the hold is not latched`);
        if (latched) M.holdEver = true;
        for (const id of controlledHeld()) if (st.drugs[id] && st.drugs[id].infusionRate !== 0) V_(`t=${t}: held ${id} running at ${st.drugs[id].infusionRate}`);
        const thr = NOA_CONFIG.hemodynamic_thresholds;
        prev = { latched, resume: ctx.resumeCalls, critical: !fin(v.map) || !fin(v.hr) || v.map < thr.map_critical_low || v.hr < thr.hr_critical_low };
      }
      // 3. lockouts and rate ceilings re-checked every second
      for (const id of Object.keys(st.interlocks.lockouts)) if (st.drugs[id] && st.drugs[id].infusionRate !== 0) V_(`t=${t}: locked-out ${id} running`);
      for (const d of listDrugs(LIB)) {
        const ds = st.drugs[d.id];
        if (!(ds.infusionRate > 0)) continue;
        if (!sim._withinLabelRate(d, ds.infusionRate, ds.rateUnit)) V_(`t=${t}: ${d.id} ${ds.infusionRate} ${ds.rateUnit} above the label rate ceiling`);
        const py = SIM_TO_PY_ID[d.id];
        if (st.interlocks.enabled && py && CONTROLLED.includes(py)) { const r = convertRateSafe(ds.infusionRate, ds.rateUnit, PY_RATE_UNITS[py], sim.rateWeight[d.id]); if (r === null || aboveCeiling(r, NOA_CONFIG.simulation_rate_ceilings[py])) V_(`t=${t}: ${d.id} above the Python simulation ceiling`); }
        for (const L of sim.ceilings[d.id]) if (L.type === 'cumulative' && !L.bolusOnly && ds.cumulative > L.absolute + 1e-6) V_(`t=${t}: ${d.id} cumulative ${ds.cumulative} above ${L.label}`);
      }
      if (ctx.onset !== null) S.push({ t, map: v.map, hr: v.hr, spo2: v.spo2, paco2: tr.paco2, depth: v.depthIndex });
    }
  };
  M.metrics = (emergency, onset) => metricsFrom(S, emergency, onset, M.clampSec);
  return M;
}

/** Recovery criteria: low-side (MAP ≥ 65, HR ≥ 50, SpO2 ≥ 92) for every emergency; high-side (MAP ≤ 120, HR ≤ 120:
 * the map_high / hr_high alarm thresholds) for light anaesthesia. All thresholds are reused simulator values. */
export const RECOVERY = Object.freeze({
  MAP_MIN: ALARM_THRESHOLDS.MAP_LOW, HR_MIN: ALARM_THRESHOLDS.HR_CRITICAL_CLEAR, SPO2_MIN: ALARM_THRESHOLDS.SPO2_LOW_CLEAR,
  MAP_MAX: ALARM_THRESHOLDS.MAP_HIGH, HR_MAX: ALARM_THRESHOLDS.HR_HIGH, SUSTAIN_SEC: DRIVER_CONVENTIONS.RECOVERY_SUSTAIN_SEC,
});

/** Primary (emergency-specific) recovery criterion: the vital sign(s) the emergency perturbs. */
export const PRIMARY = Object.freeze({
  hemorrhage: Object.freeze(['map']), vagal_bradycardia: Object.freeze(['hr']), bronchospasm: Object.freeze(['spo2', 'paco2']),
  laryngospasm_on_extubation: Object.freeze(['spo2']), light_anesthesia_stimulus: Object.freeze(['map_high', 'hr_high', 'depth_high']),
  anaphylaxis_hypotension: Object.freeze(['map', 'spo2']),
});
// Bronchospasm: also ventilation — internal PaCO2 below the model's hypercapnia threshold (engine/physiology.js
// GAINS.HYPERCAPNIA_PACO2_MMHG, reused): ventilated at FiO2 0.5 the scenario raises CO2 but SpO2 stays ≥ 92.
export const PACO2_MAX = GAINS.HYPERCAPNIA_PACO2_MMHG;
const DEPTH_HI = TIMING_CONFIG.GA_DEPTH_BAND.value[1];
const CRIT = {
  map: { ok: (s) => fin(s.map) && s.map >= RECOVERY.MAP_MIN, bad: (s) => fin(s.map) && s.map < RECOVERY.MAP_MIN },
  hr: { ok: (s) => fin(s.hr) && s.hr >= RECOVERY.HR_MIN, bad: (s) => fin(s.hr) && s.hr < RECOVERY.HR_MIN },
  spo2: { ok: (s) => fin(s.spo2) && s.spo2 >= RECOVERY.SPO2_MIN, bad: (s) => fin(s.spo2) && s.spo2 < RECOVERY.SPO2_MIN },
  map_high: { ok: (s) => fin(s.map) && s.map <= RECOVERY.MAP_MAX, bad: (s) => fin(s.map) && s.map > RECOVERY.MAP_MAX },
  hr_high: { ok: (s) => fin(s.hr) && s.hr <= RECOVERY.HR_MAX, bad: (s) => fin(s.hr) && s.hr > RECOVERY.HR_MAX },
  // light anaesthesia: processed-EEG index above the GA band upper bound (TIMING_CONFIG.GA_DEPTH_BAND, reused)
  depth_high: { ok: (s) => fin(s.depth) && s.depth <= DEPTH_HI, bad: (s) => fin(s.depth) && s.depth > DEPTH_HI },
  paco2: { ok: (s) => fin(s.paco2) && s.paco2 < PACO2_MAX, bad: (s) => fin(s.paco2) && s.paco2 >= PACO2_MAX },
};
/** Shortfall beyond each criterion's limit (units of that sign); summed over the window = the deficit (unit·s). */
const SHORT = {
  map: (s) => (fin(s.map) ? Math.max(0, RECOVERY.MAP_MIN - s.map) : 0), hr: (s) => (fin(s.hr) ? Math.max(0, RECOVERY.HR_MIN - s.hr) : 0),
  spo2: (s) => (fin(s.spo2) ? Math.max(0, RECOVERY.SPO2_MIN - s.spo2) : 0), paco2: (s) => (fin(s.paco2) ? Math.max(0, s.paco2 - PACO2_MAX) : 0),
  map_high: (s) => (fin(s.map) ? Math.max(0, s.map - RECOVERY.MAP_MAX) : 0), hr_high: (s) => (fin(s.hr) ? Math.max(0, s.hr - RECOVERY.HR_MAX) : 0),
  depth_high: (s) => (fin(s.depth) ? Math.max(0, s.depth - DEPTH_HI) : 0),
};

/** Time to recovery: from the onset to the start of the first ≥ SUSTAIN_SEC run meeting every criterion, counted only
 * after the first sample that fails one (no derangement → recovered at 0 s); unusable readings never confirm. */
function recovery(S, keys, onset) {
  const ok = (s) => keys.every((k) => CRIT[k].ok(s)); const bad = (s) => keys.some((k) => CRIT[k].bad(s));
  let derangedAt = null; let recoveredAt = null; let run = 0;
  for (const s of S) {
    if (derangedAt === null) { if (bad(s)) derangedAt = s.t; else continue; }
    if (ok(s)) { run++; if (run >= RECOVERY.SUSTAIN_SEC) { recoveredAt = s.t - RECOVERY.SUSTAIN_SEC + 1; break; } } else run = 0;
  }
  return { deranged: derangedAt !== null, derangedAfterSec: derangedAt === null ? null : derangedAt - onset,
    recovered: derangedAt === null || recoveredAt !== null, timeToRecoverySec: derangedAt === null ? 0 : recoveredAt === null ? null : recoveredAt - onset };
}

function metricsFrom(S, emergency, onset, clampSec) {
  const vals = (k) => S.map((s) => s[k]).filter(fin);
  const count = (f) => S.filter(f).length;
  const mn = (a) => (a.length ? Math.min(...a) : null); const mx = (a) => (a.length ? Math.max(...a) : null);
  const composite = recovery(S, emergency === 'light_anesthesia_stimulus' ? ['map_high', 'hr_high', 'depth_high', 'spo2'] : ['map', 'hr', 'spo2'], onset);
  return {
    minMap: mn(vals('map')), maxMap: mx(vals('map')), minHr: mn(vals('hr')), maxHr: mx(vals('hr')), minSpo2: mn(vals('spo2')), maxSpo2: mx(vals('spo2')), maxPaco2: Math.round(mx(vals('paco2'))),
    secPaco2Above60: count((s) => fin(s.paco2) && s.paco2 >= PACO2_MAX), secDepthAbove60: count((s) => fin(s.depth) && s.depth > DEPTH_HI), maxDepth: mx(vals('depth')), secMapBelow65: count((s) => fin(s.map) && s.map < 65), secMapBelow60: count((s) => fin(s.map) && s.map < 60), secHrBelow48: count((s) => fin(s.hr) && s.hr < 48),
    secSpo2Below90: count((s) => fin(s.spo2) && s.spo2 < 90), secMapAbove120: count((s) => fin(s.map) && s.map > 120), secHrAbove120: count((s) => fin(s.hr) && s.hr > 120),
    ...recovery(S, PRIMARY[emergency], onset), primary: [...PRIMARY[emergency]],
    secPrimaryDeranged: count((s) => PRIMARY[emergency].some((k) => CRIT[k].bad(s))),
    primaryDeficit: Math.round(S.reduce((a, s) => a + PRIMARY[emergency].reduce((b, k) => b + SHORT[k](s), 0), 0)),
    composite, clampSec: { ...clampSec }, samples: S.length,
  };
}

function summarizeDoses(doses) {
  const by = {};
  for (const d of doses) {
    const k = `${d.drugId}:${d.kind}${d.route ? `:${d.route}` : ''}`;
    const x = (by[k] = by[k] || { given: 0, blocked: 0, total: 0, unit: d.unit, flagged: 0 });
    if (d.ok) { x.given++; if (d.kind === 'bolus') x.total += d.amount; if (d.flags.length) x.flagged++; } else x.blocked++;
  }
  return by;
}

function finalChecks(ctx, record, V_) {
  const { sim, adv } = ctx;
  // Vasopressors: never without an explicit accept in advisory runs; the advisor never doses by itself.
  const vaso = sim.doseLog.filter((d) => d.kind === 'bolus' && (getDrug(LIB, d.drugId) || {}).cls === 'vasopressor');
  const fromAdvisory = vaso.filter((d) => d.source === 'advisory');
  const r = adv.record();
  if (fromAdvisory.length !== r.accepted) V_(`advisory vasopressor doses ${fromAdvisory.length} ≠ accepted advisories ${r.accepted}`);
  const accLog = sim.state.log.filter((l) => /^ADVISORY accepted by the clinician/.test(l.message)).length;
  if (accLog !== r.accepted) V_(`ADVISORY accepted log lines ${accLog} ≠ accepted ${r.accepted}`);
  if (vaso.some((d) => !['advisory', 'user', 'plan'].includes(d.source))) V_('vasopressor dose from an unexpected source');
  if (record.arm === 'control' && vaso.length) V_(`control arm: ${vaso.length} vasopressor dose(s) given (advisor must never dose)`);
  if (record.arm === 'control' && r.accepted) V_('control arm: an advisory was accepted');
  // Every accepted dose is in doseLog and every doseLog entry after the onset was ordered by this driver or the plan.
  const ordered = ctx.doses.filter((d) => d.ok).length;
  const first = ctx.doses.length ? ctx.doses[0].tSec : Infinity;
  const logged = sim.doseLog.filter((d) => d.source !== 'plan' && d.tSec >= first - 1e-9).length;
  if (logged < ordered) V_(`dose log has ${logged} user/advisory entries but ${ordered} were accepted`);
}

// ------------------------------------------------------------------------------------------------ fault / hold probes
const bolusRec = (ctx, key, id) => { const r = ctx.rec(key, id); return r.dose ? { drugId: id, kind: 'bolus', amount: r.dose.value, amountUnit: r.dose.unit, regimenKey: key, ...(r.route ? { route: r.route } : {}) } : null; };
const PRIMARY_RESCUE = {
  hemorrhage: (c) => [{ action: `fluid_bolus:${DRIVER_CONVENTIONS.FLUID_BOLUS_ML}:lactated_ringers` }, bolusRec(c, 'rescue', 'phenylephrine')],
  vagal_bradycardia: (c) => [bolusRec(c, 'rescue', 'glycopyrrolate')],
  bronchospasm: (c) => [{ action: 'set_fio2:1' }, bolusRec(c, 'rescue_iv', 'epinephrine')],
  laryngospasm_on_extubation: () => [{ action: 'set_fio2:1' }],
  light_anesthesia_stimulus: (c) => [bolusRec(c, 'maintenance', 'fentanyl')],
  anaphylaxis_hypotension: (c) => [{ action: 'set_fio2:1' }, bolusRec(c, 'rescue_iv', 'epinephrine'), { action: `fluid_bolus:${DRIVER_CONVENTIONS.FLUID_BOLUS_ML}:lactated_ringers` }],
};

/** During a sensor fault or a latched hold: the emergency's primary rescue (and FiO2 / fluids) must remain available. */
function probeRescuePath(ctx, o, during) {
  const out = { during, tSec: ctx.sim.state.tSec, results: [] };
  const primary = PRIMARY_RESCUE[o.emergency];
  for (const cmd of primary(ctx)) {
    if (cmd.action) { const r = ctx.act(cmd.action); out.results.push({ what: cmd.action, ok: r.ok }); if (!r.ok && !/already|not possible|No tracheal/.test(r.message)) ctx.V_(`${during}: rescue action ${cmd.action} refused: ${r.message}`); continue; }
    const r = ctx.give(cmd);
    out.results.push({ what: `${cmd.drugId} ${cmd.kind}`, ok: r.ok, reason: r.ok ? null : r.reasons[0] });
    if (!r.ok && !/Cumulative|cumulative|label maximum|Total bolus/.test(r.reasons.join(' '))) ctx.V_(`${during}: rescue ${cmd.drugId} refused: ${r.reasons.join('; ')}`);
  }
  if (ctx.sim.state.interlocks.enabled && ctx.sim.core.holdLatched) {
    // held infusions stay held: a restart attempt is refused
    for (const id of ctx.sim.state.interlocks.heldDrugs) {
      const d = getDrug(LIB, id); const rr = ctx.rec('maintenance', id);
      if (!rr.rate) continue;
      const r = ctx.give({ drugId: id, kind: 'infusion', rate: rr.rate.value, rateUnit: rr.rate.unit });
      out.results.push({ what: `${id} restart while held`, ok: r.ok });
      if (r.ok) ctx.V_(`${during}: held ${d.name} restarted without resume_hold`);
    }
  }
  return out;
}


// ------------------------------------------------------------------------------------------------ automatic mode (continue with hold)
function driveAutoToOnset(ctx, runner, o) {
  const { sim } = ctx; const C = DRIVER_CONVENTIONS;
  runner.start();
  // Clinician-resolved gates; stop at the onset time after incision.
  for (let i = 0; i < 8000; i++) {
    if (sim.stim.surgeryStartAt !== null && sim.state.tSec - sim.stim.surgeryStartAt >= C.ONSET_AFTER_INCISION_SEC[o.timing] - 120 && !ctx.mem.faultForHold) {
      ctx.inject('hr_sensor_fault'); ctx.mem.faultForHold = sim.state.tSec; // latch a hold before the emergency
    }
    if (ctx.mem.faultForHold && sim.state.tSec - ctx.mem.faultForHold >= 120) break;
    stepAutoRunner(ctx, runner);
    ctx.monitor.run(1); runner.tick();
  }
  if (!sim.core.holdLatched) ctx.V_('continue_with_hold combo: no latched hold before onset');
}

/** Clinician behaviour around the automatic runner: resolve gates, acknowledge HIGH alarms, choose "Continue with hold latched". */
function stepAutoRunner(ctx, runner) {
  const { sim } = ctx;
  for (let guard = 0; guard < 4 && runner.state === 'paused'; guard++) {
    for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) ctx.act(`acknowledge:${a.id}`);
    if (runner.pauseReasons.some((r) => r.kind === 'interlock_hold')) { const r = runner.clinicianAction('continue_with_hold'); if (r.ok) ctx.continuedHold = (ctx.continuedHold || 0) + 1; }
    const st = runner.status(); const items = st.current && st.current.items ? st.current.items : [];
    const map = { time_out: 'confirm_time_out', depth: 'acknowledge_depth_below_band', antibiotic: 'give_prophylaxis' };
    for (const it of items) if (!it.met && (it.clinician || it.id === 'antibiotic') && map[it.id]) runner.clinicianAction(map[it.id]);
    runner.resume();
  }
}

// ------------------------------------------------------------------------------------------------ policies
const since = (ctx, key) => ctx.sim.state.tSec - (ctx.mem[key] ?? -Infinity);
const acceptAdvisory = (ctx) => { const v = ctx.adv.view(); if (v.canAccept && v.entry) ctx.adv.accept(v.entry.id); };
function fluid(ctx) {
  const C = DRIVER_CONVENTIONS;
  if ((ctx.mem.fluids || 0) >= C.FLUID_MAX_BOLUSES || ctx.sim.fluid.pendingMl > 0) return;
  const r = ctx.act(`fluid_bolus:${C.FLUID_BOLUS_ML}:lactated_ringers`);
  if (r.ok) ctx.mem.fluids = (ctx.mem.fluids || 0) + 1;
}
/** Maintenance hypnotic to the bottom of its label regimen range (light-anaesthesia set-up, every arm). */
function lighten(ctx) {
  const S = ctx.sim.state;
  for (const [id, kind] of [['sevoflurane', 'inhaled'], ['propofol', 'infusion']]) {
    if (!(S.drugs[id] && S.drugs[id].infusionRate > 0)) continue;
    const r = ctx.rec('maintenance', id).rate;
    ctx.give({ drugId: id, kind, rate: r.range.min, rateUnit: r.unit });
    ctx.record.lightened = { drugId: id, rate: r.range.min, unit: r.unit };
  }
}
function deepenOnce(ctx) {
  if (ctx.mem.deepened) return; ctx.mem.deepened = true;
  const C = DRIVER_CONVENTIONS; const S = ctx.sim.state;
  if (S.drugs.sevoflurane && S.drugs.sevoflurane.infusionRate > 0) {
    const r = ctx.rec('maintenance', 'sevoflurane').rate;
    ctx.give({ drugId: 'sevoflurane', kind: 'inhaled', rate: Math.min(r.range.max, Math.round((S.drugs.sevoflurane.infusionRate + C.DEEPEN_VOLATILE_STEP_PCT) * 10) / 10), rateUnit: '%' });
  } else if (S.drugs.propofol && S.drugs.propofol.infusionRate > 0) {
    const r = ctx.rec('maintenance', 'propofol').rate;
    ctx.give({ drugId: 'propofol', kind: 'infusion', rate: Math.min(r.range.max, S.drugs.propofol.infusionRate + C.DEEPEN_PROPOFOL_STEP), rateUnit: S.drugs.propofol.rateUnit });
  }
}
const V = (ctx) => ctx.sim.state.vitals;
const low = (x, thr) => fin(x) && x < thr;

const RESCUE = {
  hemorrhage(ctx) {
    if (low(V(ctx).map, RECOVERY.MAP_MIN)) fluid(ctx);
    acceptAdvisory(ctx);
  },
  vagal_bradycardia(ctx) {
    const iv = labelInterval('glycopyrrolate', 'IV', ctx.sim.state.phase);
    if (low(V(ctx).hr, RECOVERY.HR_MIN) && since(ctx, 'glyco') >= iv.minSec) { const c = bolusRec(ctx, 'rescue', 'glycopyrrolate'); if (ctx.give(c).ok) ctx.mem.glyco = ctx.sim.state.tSec; }
    acceptAdvisory(ctx);
  },
  bronchospasm(ctx) {
    const C = DRIVER_CONVENTIONS;
    if (ctx.sim.state.tSec - ctx.onset >= C.RECOGNITION_SEC && !ctx.mem.recognised) { ctx.mem.recognised = true; ctx.act('set_fio2:1'); deepenOnce(ctx); }
    const v = V(ctx); const hypercapnic = v.etco2 !== null && fin(v.etco2) && v.etco2 > C.ETCO2_HIGH_MMHG;
    if (ctx.mem.recognised && (low(v.spo2, ALARM_THRESHOLDS.SPO2_LOW) || hypercapnic) && since(ctx, 'epi') >= C.NO_LABEL_INTERVAL_REPEAT_SEC) { if (ctx.give(bolusRec(ctx, 'rescue_iv', 'epinephrine')).ok) ctx.mem.epi = ctx.sim.state.tSec; }
    acceptAdvisory(ctx);
  },
  laryngospasm_on_extubation(ctx) {
    const S = ctx.sim.state; const a = S.airway;
    if (!ctx.mem.started && S.tSec - ctx.onset >= 5) { ctx.mem.started = true; ctx.act('set_fio2:1'); if (!a.jawThrust) ctx.act('jaw_thrust'); if (!a.maskVentilation) ctx.act('mask_ventilate'); }
    const ev = ctx.sim.events.find((e) => e.def.id === 'laryngospasm_on_extubation');
    if (ctx.mem.started && !ctx.mem.stopped && ev && ev.resolved && fin(V(ctx).spo2) && V(ctx).spo2 >= ALARM_THRESHOLDS.SPO2_LOW_CLEAR + 2) {
      ctx.mem.okFor = (ctx.mem.okFor || 0) + 1;
      if (ctx.mem.okFor >= 30) { ctx.mem.stopped = true; if (a.maskVentilation) ctx.act('stop_mask_ventilation'); if (a.jawThrust) ctx.act('release_jaw_thrust'); }
    }
    acceptAdvisory(ctx);
  },
  light_anesthesia_stimulus(ctx) {
    const C = DRIVER_CONVENTIONS; const v = V(ctx);
    const high = (fin(v.map) && v.map > RECOVERY.MAP_MAX) || (fin(v.hr) && v.hr > RECOVERY.HR_MAX) || v.depthIndex > TIMING_CONFIG.GA_DEPTH_BAND.value[1];
    if (high) {
      if ((ctx.mem.fent || 0) < C.FENTANYL_MAX_DOSES && since(ctx, 'fentT') >= C.FENTANYL_REPEAT_SEC) { if (ctx.give(bolusRec(ctx, 'maintenance', 'fentanyl')).ok) { ctx.mem.fent = (ctx.mem.fent || 0) + 1; ctx.mem.fentT = ctx.sim.state.tSec; } }
      deepenOnce(ctx);
    }
    acceptAdvisory(ctx);
  },
  anaphylaxis_hypotension(ctx, im = false) {
    const C = DRIVER_CONVENTIONS; const S = ctx.sim.state; const v = V(ctx);
    if (!ctx.mem.recognised && (S.tSec - ctx.onset >= C.RECOGNITION_SEC || low(v.map, RECOVERY.MAP_MIN))) { ctx.mem.recognised = true; ctx.act('set_fio2:1'); }
    if (!ctx.mem.recognised) return;
    const hypo = low(v.map, RECOVERY.MAP_MIN);
    if (hypo) fluid(ctx);
    if (im) {
      const iv = labelInterval('epinephrine', 'IM', S.phase);
      if (hypo && since(ctx, 'epi') >= iv.minSec) { if (ctx.give(bolusRec(ctx, 'rescue', 'epinephrine')).ok) ctx.mem.epi = S.tSec; }
      return;
    }
    if (hypo && since(ctx, 'epi') >= C.NO_LABEL_INTERVAL_REPEAT_SEC) { if (ctx.give(bolusRec(ctx, 'rescue_iv', 'epinephrine')).ok) { ctx.mem.epi = S.tSec; ctx.mem.epiN = (ctx.mem.epiN || 0) + 1; } }
    // several doses needed → epinephrine infusion (guideline text [S44, S45]); label rate range and titration step [S40, S41]
    const reg = ctx.rec('maintenance', 'epinephrine').rate;
    if ((ctx.mem.epiN || 0) >= C.EPI_INFUSION_AFTER_BOLUSES && hypo && since(ctx, 'epiInf') >= C.EPI_INFUSION_STEP_SEC) {
      const cur = S.drugs.epinephrine.infusionRate || 0;
      const next = cur > 0 ? Math.min(reg.range.max, Math.round((cur + reg.range.min) * 1000) / 1000) : reg.value;
      if (next > cur && ctx.give({ drugId: 'epinephrine', kind: 'infusion', rate: next, rateUnit: reg.unit }).ok) ctx.mem.epiInf = S.tSec;
    }
  },
};

/** Aggressive / abusive probing: every few seconds, repeated maximum boluses of every rescue agent, too-close repeats,
 * mixed vasopressors, above-cap orders, maximum infusion rates, a direct state write. All values come from the
 * library (regimen maxima, ceilings ×2) — the engine must refuse what is over a hard limit and flag the rest. */
function aggressive(ctx) {
  const C = DRIVER_CONVENTIONS; const S = ctx.sim.state; const el = S.tSec - ctx.onset;
  if (el > C.AGGRESSIVE_FOR_SEC || Math.round(el) % C.AGGRESSIVE_EVERY_SEC !== 0) return;
  const p = ctx.p;
  const regMax = (key, id) => { const r = ctx.rec(key, id); return r.dose ? { drugId: id, kind: 'bolus', amount: r.dose.range.max, amountUnit: r.dose.unit, ...(r.route ? { route: r.route } : {}) } : null; };
  const lim = (id, type, route) => interpretCeilings(getDrug(LIB, id), p).find((L) => L.type === type && (route === undefined || L.route === route));
  const cmds = [
    regMax('rescue', 'phenylephrine'), regMax('rescue', 'ephedrine'), regMax('rescue_iv', 'epinephrine'), regMax('rescue', 'epinephrine'), regMax('rescue', 'glycopyrrolate'),
  ];
  if (Math.round(el) % 30 === 0) {
    // over-cap probes (twice a hard limit read from the library) and an over-range probe (twice the regimen maximum)
    const phe = lim('phenylephrine', 'cumulative'); if (phe) cmds.push({ drugId: 'phenylephrine', kind: 'bolus', amount: phe.absolute * 2, amountUnit: 'mcg' });
    const epiIv = lim('epinephrine', 'bolus', 'IV'); if (epiIv) cmds.push({ drugId: 'epinephrine', kind: 'bolus', amount: epiIv.absolute * 2, amountUnit: 'mg', route: 'IV' });
    const epiIm = interpretCeilings(getDrug(LIB, 'epinephrine'), p).find((L) => L.type === 'bolus' && !L.route); if (epiIm) cmds.push({ drugId: 'epinephrine', kind: 'bolus', amount: epiIm.absolute * 2, amountUnit: 'mg', route: 'IM' });
    const eph = lim('ephedrine', 'cumulative'); if (eph) cmds.push({ drugId: 'ephedrine', kind: 'bolus', amount: eph.absolute * 2, amountUnit: 'mg' });
    const ephR = ctx.rec('rescue', 'ephedrine').dose; cmds.push({ drugId: 'ephedrine', kind: 'bolus', amount: ephR.range.max * 2, amountUnit: ephR.unit });
  }
  if (Math.round(el) === 0) {
    for (const id of ['epinephrine', 'phenylephrine', 'propofol', 'dexmedetomidine']) {
      const r = ctx.rec('maintenance', id).rate; if (!r) continue;
      const cap = interpretCeilings(getDrug(LIB, id), p).filter((L) => L.type === 'rate').map((L) => convertRateSafe(L.value, L.rateUnit, r.unit, L.weightKg ?? ctx.sim.rateWeight[id])).filter((x) => x !== null);
      const top = cap.length ? Math.min(...cap) : r.range.max;
      cmds.push({ drugId: id, kind: 'infusion', rate: top * 2, rateUnit: r.unit }); // refused (above the label / Python ceiling)
      if (id !== 'propofol' || S.drugs.propofol.infusionRate > 0) cmds.push({ drugId: id, kind: 'infusion', rate: id === 'dexmedetomidine' ? 0 : top, rateUnit: r.unit }); // at the ceiling: accepted
    }
    const sevo = S.drugs.sevoflurane; if (sevo && sevo.infusionRate > 0) { const L = lim('sevoflurane', 'dial'); cmds.push({ drugId: 'sevoflurane', kind: 'inhaled', rate: L.value * 2, rateUnit: '%' }); }
  }
  for (const c of cmds) if (c) ctx.give(c);
  ctx.act(`fluid_bolus:${C.FLUID_BOLUS_ML}:lactated_ringers`); // no cumulative crystalloid limit exists in the engine (finding)
  ctx.act('fluid_bolus:1000'); // refused: only 250 / 500 mL boluses
  ctx.act('set_fio2:1');
  if (Math.round(el) === 60) {
    // direct state write (bypass attempt): re-validated by the safety layer on the next step
    const ds = S.drugs.epinephrine; ctx.mem.directWrite = { before: ds.infusionRate };
    ds.infusionRate = 1e6;
  }
  if (Math.round(el) === 61 && ctx.mem.directWrite && S.drugs.epinephrine.infusionRate >= 1e6) ctx.V_('direct state write of an epinephrine rate was not re-validated');
}

export const POLICIES = Object.freeze({
  control: () => {},
  rescue: (ctx, em) => RESCUE[em](ctx),
  rescue_im: (ctx, em) => RESCUE[em](ctx, true),
  aggressive: (ctx) => aggressive(ctx),
});

// ------------------------------------------------------------------------------------------------ run
/**
 * runCase({ patientId, emergency, arm, timing, seed, combo, templateId }) -> record (plain data)
 * combo: null | 'map_sensor_fault' | 'hr_sensor_fault' | 'spo2_probe_off' | 'hold_latched' | 'continue_with_hold'
 */
export function runCase(opts) {
  const o = { combo: null, templateId: null, variant: null, ...opts };
  const C = DRIVER_CONVENTIONS;
  const record = { ...o, id: caseId(o), ok: false, exception: null, violations: [], notes: [] };
  const V_ = (msg) => { if (record.violations.length < 40) record.violations.push(msg); };
  let sim = null;
  try {
    const p = stressPatient(o.patientId);
    const templateId = o.templateId || (o.combo === 'hold_latched' || o.combo === 'continue_with_hold' ? 'ga_opioid_free' : 'ga_opioid');
    const built = stressPlan(p, templateId);
    record.plan = { templateId, steps: built.plan.steps.map((s) => `${s.phase}:${s.drugId}:${s.kind}`), substitutions: built.substitutions.map((s) => `${s.from}→${s.to}`), planSafetyBlocking: built.gap.blocking };
    if (built.gap.blocking) V_(`plan-safety failed: ${built.gap.message}`);
    sim = createSimulation({ patient: p, plan: built.plan, seed: o.seed, library: LIB });
    const adv = createRescueAdvisor(sim);
    const runner = o.combo === 'continue_with_hold' ? createAutoRunner({ sim, mode: 'full' }) : null;
    const ctx = makeContext(sim, adv, p, record, V_);
    const M = ctx.monitor;

    // ---------- timeline up to the emergency onset
    if (runner) driveAutoToOnset(ctx, runner, o);
    else {
      M.run(C.PREMED_SEC);
      ctx.act(`set_fio2:${C.FIO2_INDUCTION}`); sim.setPhase('induction'); M.run(C.INDUCTION_SEC);
      ctx.act('secure_airway'); ctx.act('start_ventilation'); ctx.act(`set_fio2:${C.FIO2_MAINTENANCE}`); sim.setPhase('maintenance');
      M.run(C.PRE_INCISION_SEC);
      ctx.act('start_surgery');
      if (o.combo === 'hold_latched') {
        // A latched hold BEFORE the emergency: an HR sensor fault (60 s) fails safe and latches the hold.
        M.run(C.ONSET_AFTER_INCISION_SEC[o.timing] - 120); sim.inject('hr_sensor_fault'); M.run(120);
        if (!sim.core.holdLatched) V_('hold_latched combo: the hold did not latch on the HR sensor fault');
        record.holdBeforeOnset = { latched: sim.core.holdLatched, heldDrugs: [...sim.state.interlocks.heldDrugs] };
      } else if (o.variant === 'lightened') {
        M.run(C.ONSET_AFTER_INCISION_SEC[o.timing] - C.LIGHTEN_BEFORE_SEC); lighten(ctx); M.run(C.LIGHTEN_BEFORE_SEC);
      } else M.run(C.ONSET_AFTER_INCISION_SEC[o.timing]);
    }
    record.preOnset = { tSec: sim.state.tSec, map: sim.state.vitals.map, hr: sim.state.vitals.hr, spo2: sim.state.vitals.spo2, depth: sim.state.vitals.depthIndex };

    // ---------- emergency onset (laryngospasm: armed, starts at extubation)
    let onset; let obs = C.OBSERVE_SEC;
    if (o.emergency === 'laryngospasm_on_extubation') {
      ctx.inject(o.emergency);
      M.run(C.SURGERY_SEC_BEFORE_EMERGENCE - C.ONSET_AFTER_INCISION_SEC[o.timing] > 0 ? C.SURGERY_SEC_BEFORE_EMERGENCE - C.ONSET_AFTER_INCISION_SEC[o.timing] : 60);
      ctx.act('end_surgery'); ctx.act(`set_fio2:${C.FIO2_EMERGENCE}`); sim.setPhase('emergence');
      let readyAt = null;
      for (let i = 0; i < C.READINESS_TIMEOUT_SEC; i++) { M.run(1); if (sim.extubationReadiness().ready) { readyAt = sim.state.tSec; break; } }
      if (readyAt === null) record.notes.push(`not extubation-ready within ${C.READINESS_TIMEOUT_SEC} s: extubated anyway (driver)`);
      M.run(C.EXTUBATE_AFTER_READY_SEC[o.timing]);
      ctx.act('stop_ventilation');
      const ex1 = ctx.act('extubate');
      if (!ex1.ok) V_(`extubate refused: ${ex1.message}`);
      onset = sim.state.tSec; obs = C.OBSERVE_LARYNGOSPASM_SEC;
      if (!sim.events.some((e) => e.def.id === 'laryngospasm_on_extubation')) V_('laryngospasm did not start at extubation');
    } else {
      ctx.inject(o.emergency); onset = sim.state.tSec;
    }
    record.onsetSec = onset;
    ctx.onset = onset;

    // ---------- observation window with the arm's policy
    const policy = POLICIES[o.arm] ? POLICIES[o.arm] : null;
    if (!policy) throw new Error(`unknown arm ${o.arm}`);
    const faultAt = onset + 30;
    for (let k = 0; k < obs; k++) {
      if (['map_sensor_fault', 'hr_sensor_fault', 'spo2_probe_off'].includes(o.combo) && sim.state.tSec >= faultAt && !ctx.faultInjected) {
        ctx.inject(o.combo); ctx.faultInjected = sim.state.tSec;
      }
      if (ctx.faultInjected && !ctx.faultProbe && sim.state.tSec >= ctx.faultInjected + 10) ctx.faultProbe = probeRescuePath(ctx, o, 'sensor fault');
      if ((o.combo === 'hold_latched' || o.combo === 'continue_with_hold') && !ctx.holdProbe && sim.state.tSec >= onset + 10) ctx.holdProbe = probeRescuePath(ctx, o, 'latched hold');
      if (runner) stepAutoRunner(ctx, runner);
      policy(ctx, o.emergency);
      M.run(1);
      if (runner) runner.tick();
    }
    if (runner) { record.runner = { state: runner.state, holdContinue: !!runner.holdContinue, history: runner.history.length }; if (!ctx.continuedHold) V_('continue_with_hold combo: the runner never paused for a hold / continue was never chosen'); if (!ctx.holdProbe) ctx.holdProbe = probeRescuePath(ctx, o, 'continue with hold latched'); }

    finalChecks(ctx, record, V_);
    record.metrics = M.metrics(o.emergency, onset);
    record.doses = ctx.doses.filter((d) => d.tSec >= onset - 1e-9);
    record.doseSummary = summarizeDoses(record.doses);
    record.advisory = (({ shown, accepted, dismissed }) => ({ shown, accepted, dismissed }))(adv.record());
    record.alarms = [...new Set(sim.alarmMgr.history.filter((a) => a.sinceSec >= onset - 1e-9).map((a) => a.id))].sort();
    record.interlock = { holdLatchedEver: M.holdEver, holdLatchedAtEnd: sim.core.holdLatched, events: sim.stats.interlockEvents.filter((e) => e.tSec >= onset - 1e-9).length, resumeCalls: ctx.resumeCalls };
    record.probes = { fault: ctx.faultProbe || null, hold: ctx.holdProbe || null };
    record.ok = record.violations.length === 0;
  } catch (e) {
    record.exception = String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
    V_(`exception: ${record.exception}`);
  }
  return record;
}

export function caseId(o) { return [o.patientId, o.emergency, o.arm, o.timing, `s${o.seed}`, o.combo || '-', ...(o.variant ? [o.variant] : [])].join('|'); }

// ------------------------------------------------------------------------------------------------ matrix enumeration + summary
export function matrixCases({ patients = STRESS_PATIENTS.map((x) => x.id), emergencies = EMERGENCIES, timings = TIMINGS, seeds = SEEDS } = {}) {
  const out = [];
  for (const patientId of patients) for (const emergency of emergencies) for (const arm of armsFor(emergency)) for (const timing of timings) for (const seed of seeds) out.push({ patientId, emergency, arm, timing, seed, combo: null });
  return out;
}

/** Emergencies combined with faults / holds (rescue arm). */
export const COMBOS = Object.freeze(['map_sensor_fault', 'hr_sensor_fault', 'spo2_probe_off', 'hold_latched', 'continue_with_hold']);
export function comboCases({ patients = STRESS_PATIENTS.map((x) => x.id), emergencies = EMERGENCIES, seeds = [1] } = {}) {
  const out = [];
  for (const patientId of patients) for (const emergency of emergencies) for (const combo of COMBOS) for (const seed of seeds) {
    if (emergency === 'laryngospasm_on_extubation' && (combo === 'hold_latched' || combo === 'continue_with_hold')) continue; // hold before onset vs onset at extubation: covered by the fault combos
    out.push({ patientId, emergency, arm: 'rescue', timing: 'early', seed, combo });
  }
  return out;
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export { median };

/** Efficacy per emergency × patient × arm: recovery rate, median time to recovery (recovered runs), deranged runs. */
export function efficacy(records) {
  const cells = new Map();
  for (const r of records) {
    if (r.combo || !r.metrics) continue;
    const em = r.variant ? `${r.emergency}:${r.variant}` : r.emergency;
    const k = `${em}|${r.patientId}|${r.arm}`;
    const c = cells.get(k) || { emergency: em, patientId: r.patientId, arm: r.arm, n: 0, recovered: 0, deranged: 0, times: [], minMap: [], minSpo2: [], minHr: [], maxMap: [], maxHr: [], secMapBelow65: [], secSpo2Below90: [], secHrBelow48: [], secPrimary: [], deficit: [], maxPaco2: [], maxDepth: [] };
    c.n++; if (r.metrics.recovered) c.recovered++; if (r.metrics.deranged) c.deranged++;
    if (r.metrics.timeToRecoverySec !== null) c.times.push(r.metrics.timeToRecoverySec);
    for (const k2 of ['minMap', 'minSpo2', 'minHr', 'maxMap', 'maxHr', 'secMapBelow65', 'secSpo2Below90', 'secHrBelow48']) c[k2].push(r.metrics[k2]);
    c.secPrimary.push(r.metrics.secPrimaryDeranged); c.deficit.push(r.metrics.primaryDeficit); c.maxPaco2.push(r.metrics.maxPaco2); c.maxDepth.push(r.metrics.maxDepth);
    cells.set(k, c);
  }
  return [...cells.values()].map((c) => ({ ...c, rate: c.recovered / c.n, medianTime: median(c.times),
    medianSecMapBelow65: median(c.secMapBelow65), medianSecSpo2Below90: median(c.secSpo2Below90), medianSecHrBelow48: median(c.secHrBelow48), medianSecPrimary: median(c.secPrimary), medianDeficit: median(c.deficit), worstMaxPaco2: Math.max(...c.maxPaco2.filter(fin)), worstMaxDepth: Math.max(...c.maxDepth.filter(fin)),
    worstMinMap: Math.min(...c.minMap.filter(fin)), worstMinSpo2: Math.min(...c.minSpo2.filter(fin)), worstMinHr: Math.min(...c.minHr.filter(fin)), worstMaxMap: Math.max(...c.maxMap.filter(fin)), worstMaxHr: Math.max(...c.maxHr.filter(fin)) }));
}

/**
 * Directional comparison, rescue vs control, per emergency × patient. A cell "improves" when the rescue arm recovers
 * more often, or as often and faster (median), or spends less time deranged, or has a smaller median deficit (summed
 * shortfall beyond the primary limit, e.g. mmHg·s below MAP 65). Returns rows with the verdict.
 */
export function compareArms(eff, rescueArm = 'rescue') {
  const get = (em, pid, arm) => eff.find((c) => c.emergency === em && c.patientId === pid && c.arm === arm);
  const rows = [];
  for (const c of eff.filter((x) => x.arm === 'control')) {
    const r = get(c.emergency, c.patientId, rescueArm); if (!r) continue;
    const derangedSec = (x) => x.medianSecPrimary;
    const tC = c.medianTime ?? Infinity; const tR = r.medianTime ?? Infinity;
    let verdict;
    if (c.deranged === 0 && r.deranged === 0) verdict = 'no_derangement';
    else if (r.rate > c.rate) verdict = 'better';
    else if (r.rate === c.rate && tR < tC) verdict = 'better';
    else if (derangedSec(r) < derangedSec(c)) verdict = 'better_time_deranged';
    else if (r.medianDeficit < c.medianDeficit) verdict = 'better_deficit';
    else if (r.rate === c.rate && tR === tC && derangedSec(r) === derangedSec(c) && r.medianDeficit === c.medianDeficit) verdict = 'no_difference';
    else verdict = 'worse';
    rows.push({ emergency: c.emergency, patientId: c.patientId, arm: rescueArm, control: c, rescue: r, verdict, derangedSecControl: derangedSec(c), derangedSecRescue: derangedSec(r) });
  }
  return rows;
}

