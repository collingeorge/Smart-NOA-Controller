// Palliative pain management and end-of-life care modules — engine (pure; no DOM; deterministic).
// EDUCATIONAL SIMULATION — fictional patients — not a medical device, not medical advice.
//
// Time scale: minutes (1-min internal step), run for hours to days. Symptom and PK/PD behaviour is
// an ILLUSTRATIVE MODEL (author estimates, MODEL constants below, listed in the parameter
// inventory as author_estimate_unvalidated). Doses, ratios, percentages and thresholds come from
// data/palliative.js (sourced or labelled simulator conventions). No survival or mortality is
// modelled, and the model makes no claim about effects on the length of life.
//
// Safety rules built into the engine (tests/palliative.test.mjs):
//   * nothing changes the regimen or a sedation infusion without an explicit clinician approval;
//   * the engine never acknowledges an alarm and never escalates sedation on its own;
//   * palliative sedation actions are blocked until all six documentation items are complete;
//   * opioids are never used to produce sedation; the comfort opioid regimen continues.
import { createRng } from './rng.js';
import { PALLIATIVE_OPIOIDS, PALLIATIVE_RULES as R, SEDATION_MIDAZOLAM as SM, SEDATION_DOC_ITEMS, PALLIATIVE_SOURCES } from '../data/palliative.js';

export const MODEL = Object.freeze({
  KA_ORAL_PER_MIN: 0.02, KE_PER_MIN: 0.0058, KE0_PER_MIN: 0.033,
  RENAL_KE_FACTOR: { morphine: { lt30: 0.5, lt60: 0.75 }, hydromorphone: { lt30: 0.5, lt60: 0.75 }, oxycodone: { lt30: 0.7, lt60: 0.8 } },
  HEPATIC_KE_FACTOR: 0.75,
  IV_EFFECT_FACTOR: { morphine: 2.5, hydromorphone: 12.5 },
  EC50_BASE_OME: 6, EC50_PER_OME_DAY: 0.05,
  ANALGESIA_EMAX: 0.85, ANALGESIA_GAMMA: 1.5,
  SED_OPIOID_X50: 5, SED_OPIOID_GAMMA: 2.5, RR_OPIOID_X50: 6, RR_OPIOID_MAX: 0.7,
  MIDAZ_KA_SC_PER_MIN: 0.06, MIDAZ_KE_PER_MIN: 0.0067, MIDAZ_EC50_MG: 4.4, MIDAZ_GAMMA: 1.5, MIDAZ_AGITATION_MAX: 0.9, MIDAZ_RR_MAX: 2,
  NALOX_KE_PER_MIN: 0.017, NALOX_HALF_MG: 0.15,
  DYSPNOEA_OPIOID_MAX: 0.5, NONPHARM_RELIEF: 1, OXYGEN_RELIEF_HYPOXAEMIC: 1.5, POSITIONING_SECRETION_RELIEF: 1,
  CONSTIPATION_PER_H: 0.15, CONSTIPATION_WITH_BOWEL_PER_H: 0.03, NAUSEA_START: 3, NAUSEA_DECAY_DAYS: 2,
  AGITATION_TO_RASS: 0.45, NOISE_SD: 0.15, TREND_EVERY_MIN: 5,
});

export const ROUNDING = Object.freeze({ 'morphine:oral': 0.5, 'oxycodone:oral': 0.5, 'hydromorphone:oral': 0.25, 'morphine:iv': 0.5, 'hydromorphone:iv': 0.05 });
const roundTo = (v, step) => Math.round(v / step) * step;
const fix = (v) => Number(Number(v).toFixed(3));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hill = (x, x50, g) => (x <= 0 ? 0 : x ** g / (x ** g + x50 ** g));

// ------------------------------------------------------------------------------------------- patient
export function validatePalliative(p) {
  const errors = {};
  const num = (k, lo, hi, label) => { const v = p[k]; if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) errors[k] = `${label} must be ${lo}–${hi}.`; };
  num('ageYears', 18, 90, 'Age'); num('weightKg', 35, 250, 'Weight'); num('egfr', 5, 150, 'eGFR'); num('baselineRr', 8, 30, 'Respiratory rate'); num('medicationCount', 0, 30, 'Number of medicines');
  if (p.opioidStatus === 'tolerant') {
    const r = p.currentRegimen;
    if (!r || !PALLIATIVE_OPIOIDS[r.drugId] || !PALLIATIVE_OPIOIDS[r.drugId].routes[r.route]) errors.currentRegimen = 'Choose the current opioid and route.';
    else if (!(r.dose > 0) || !(r.intervalH >= 1 && r.intervalH <= 24)) errors.currentRegimen = 'Enter the current dose (mg) and interval (1–24 h).';
  }
  if (!['comfort', 'life_prolonging', 'mixed'].includes(p.goals)) errors.goals = 'Choose goals of care.';
  if (!['weeks_months', 'days_weeks', 'hours_days', 'not_applicable'].includes(p.prognosis)) errors.prognosis = 'Choose a prognosis category.';
  return { ok: Object.keys(errors).length === 0, errors };
}

const factorFor = (drugId) => R.CDC_MME_FACTORS.value[drugId];
/** CDC 2022 oral MME/day (risk estimate only). IV regimens return null. */
export function mmePerDay(reg) {
  if (!reg || reg.route !== 'oral' || !factorFor(reg.drugId)) return null;
  return fix((reg.dose * 24 / reg.intervalH) * factorFor(reg.drugId));
}

export function cdcApplies(p) {
  return ['noncancer_chronic', 'noncancer_acute'].includes(p.diagnosis) && !['home_hospice', 'hospice_inpatient'].includes(p.setting) && p.goals !== 'comfort';
}

export function deliriumRisk(p, dynamic = {}) {
  const factors = [];
  if (p.ageYears >= 70) factors.push('age ≥70');
  if (p.egfr < 30) factors.push('eGFR <30');
  if (p.medicationCount >= 5) factors.push('≥5 medicines (polypharmacy)');
  if (p.prognosis === 'hours_days') factors.push('last hours–days of life');
  if (dynamic.opioidExcess) factors.push('high opioid effect');
  const level = factors.length >= 3 ? 'high' : factors.length >= 1 ? 'moderate' : 'low';
  return { score: factors.length, level, factors, provenance: 'author_estimate_unvalidated', note: 'Illustrative count of factors (ESMO 2018 delirium guideline names advanced disease and the last hours–days as common settings; the count itself is not a validated tool).', sources: ['S119'] };
}

export function derivePalliative(input) {
  const p = { ...input };
  const flags = [];
  if (p.ageYears >= 65) flags.push('elderly');
  if (p.egfr < 60) flags.push('ckd');
  if (p.egfr < 30) flags.push('severeCkd');
  if (p.liverDisease) flags.push('liverDisease');
  if (p.severeHepatic) flags.push('severeHepatic');
  if (p.opioidStatus === 'tolerant') flags.push('opioidTolerant');
  const cur = p.opioidStatus === 'tolerant' ? p.currentRegimen : null;
  const mme = cur ? mmePerDay(cur) : null;
  return { ...p, flags, currentMmeDay: mme, cdcApplies: cdcApplies(p), delirium: deliriumRisk(p),
    mmeNote: cur && cur.route !== 'oral' ? 'MME not computed: the CDC factors used here are for oral opioids.' : 'MME (CDC 2022) estimates daily exposure for risk; it is not a conversion table.' };
}

// ------------------------------------------------------------------------------------------- dosing
function renalFraction(p) {
  const f = PALLIATIVE_OPIOIDS.hydromorphone.renalFraction;
  if (p.egfr < 30 || p.severeHepatic) return { value: f.severe, why: p.egfr < 30 ? 'eGFR <30' : 'severe hepatic impairment' };
  if (p.egfr < 60 || p.liverDisease) return { value: f.moderate, why: p.egfr < 60 ? 'eGFR 30–59' : 'hepatic impairment' };
  return null;
}

/** Label starting dose for an opioid-naïve adult. */
export function recommendStart(p, drugId, route) {
  const d = PALLIATIVE_OPIOIDS[drugId]; const r = d && d.routes[route];
  if (!r) return { ok: false, reason: `${drugId} ${route}: not simulated — specialist decision.` };
  const notes = []; const warnings = []; let min, max;
  if (typeof r.start.perKgMin === 'number') { min = r.start.perKgMin * p.weightKg; max = r.start.perKgMax * p.weightKg; notes.push(`${r.start.perKgMin}–${r.start.perKgMax} mg/kg × ${p.weightKg} kg (total body weight; simulator convention — the label gives mg/kg without naming the scalar).`); }
  else { min = r.start.min; max = r.start.max; }
  let adjusted = null;
  if (drugId === 'hydromorphone') {
    const f = renalFraction(p);
    if (f) { min *= f.value; max *= f.value; adjusted = f; notes.push(`${f.why}: ${f.value === 0.25 ? 'one-fourth' : 'one-half'} of the usual starting dose (label range one-fourth to one-half; degree mapping is a simulator mapping).`); }
    if (route === 'iv' && p.ageYears >= 65) notes.push('Elderly/debilitated: label — reduce the initial dose (may be lowered to 0.2 mg).');
  }
  if (r.adjustText && (p.flags.includes('ckd') || p.flags.includes('elderly') || p.liverDisease || p.severeHepatic)) notes.push(r.adjustText);
  if (drugId === 'morphine' && p.egfr < d.renal.severeEgfr) warnings.push({ id: 'morphine_severe_ckd', severity: d.renal.severity, message: d.renal.message, sources: d.renal.sources });
  if (drugId === 'oxycodone' && p.egfr < d.renal.moderateEgfr) warnings.push({ id: 'oxycodone_ckd', severity: d.renal.severity, message: d.renal.message, sources: d.renal.sources });
  const step = ROUNDING[`${drugId}:${route}`];
  const value = fix(Math.max(step, roundTo(min, step)));
  return { ok: true, drugId, route, form: r.form, dose: { value, min: fix(min), max: fix(max), unit: 'mg' }, intervalH: { value: r.intervalH.min, min: r.intervalH.min, max: r.intervalH.max },
    sources: [...r.sources, ...(adjusted || notes.length ? r.adjustSources : [])], notes, warnings, adjusted: !!adjusted,
    defaultRule: 'Default = lower bound of the label range (simulator convention), rounded to a measurable increment.' };
}

/** Breakthrough dose: 10–20% of the 24-h scheduled dose (NCCN; ESMO 10–15%). */
export function breakthroughDose(total24h, drugId, route, pct = R.BREAKTHROUGH_PCT.default) {
  const [lo, hi] = R.BREAKTHROUGH_PCT.value;
  if (!(pct >= lo && pct <= hi)) return { ok: false, reason: `Breakthrough percentage must be ${lo}–${hi}% (NCCN).` };
  const step = ROUNDING[`${drugId}:${route}`] || 0.5;
  return { ok: true, pct, dose: fix(Math.max(step, roundTo(total24h * pct / 100, step))), range: { min: fix(total24h * lo / 100), max: fix(total24h * hi / 100) }, unit: 'mg', sources: [...R.BREAKTHROUGH_PCT.sourceIds] };
}

/** Oral-morphine-equivalent factor for conversion (sourced ratios only). */
function conversionFactor(drugId, route, ivRatio) {
  if (drugId === 'morphine' && route === 'oral') return { f: 1, sources: [] };
  if (drugId === 'oxycodone' && route === 'oral') return { f: R.CONVERSION_ORAL_MORPHINE_TO_ORAL_OXYCODONE.value, sources: ['S109'] };
  if (drugId === 'hydromorphone' && route === 'oral') return { f: R.CONVERSION_ORAL_MORPHINE_TO_ORAL_HYDROMORPHONE.value, sources: ['S109'] };
  if (drugId === 'morphine' && route === 'iv') return { f: ivRatio, sources: ['S107'] };
  return null;
}

/**
 * Opioid rotation using sourced ratios: oral morphine ↔ oral oxycodone (1.5:1), oral morphine →
 * oral hydromorphone (5:1), oral ↔ IV morphine (2:1–3:1). Anything else (including from
 * hydromorphone, to IV hydromorphone, methadone, fentanyl patches): specialist conversion; not simulated.
 * `reductionPct` is REQUIRED (0–50): the panel reached no consensus on a routine reduction.
 */
export function convertOpioid({ fromDrug, fromRoute, total24h, toDrug, toRoute, reductionPct, ivRatio = R.CONVERSION_ORAL_TO_IV_MORPHINE.default, intervalH }) {
  const [rlo, rhi] = R.CROSS_TOLERANCE_REDUCTION_PCT.value;
  if (typeof reductionPct !== 'number' || !Number.isFinite(reductionPct) || reductionPct < rlo || reductionPct > rhi) return { ok: false, reason: `Enter the cross-tolerance reduction yourself (${rlo}–${rhi}%). MASCC-ASCO 2025: no consensus on a routine reduction; there is no default.` };
  const [ilo, ihi] = R.CONVERSION_ORAL_TO_IV_MORPHINE.value;
  if (!(ivRatio >= ilo && ivRatio <= ihi)) return { ok: false, reason: `Oral:IV morphine ratio must be ${ilo}:1–${ihi}:1 (ESMO 2018).` };
  if (fromDrug === 'hydromorphone') return { ok: false, reason: 'Conversion from hydromorphone: specialist conversion; not simulated (reverse ratio not verified).' };
  if (fromDrug === toDrug && fromRoute === toRoute) return { ok: false, reason: 'Same opioid and route: no conversion.' };
  const a = conversionFactor(fromDrug, fromRoute, ivRatio); const b = conversionFactor(toDrug, toRoute, ivRatio);
  if (!a || !b) return { ok: false, reason: 'Specialist conversion; not simulated (no verified ratio for this pair; methadone and fentanyl patches are never simulated).' };
  const ome = total24h * a.f; const raw = ome / b.f; const reduced = raw * (1 - reductionPct / 100);
  const step = ROUNDING[`${toDrug}:${toRoute}`] || 0.5;
  const ih = intervalH || PALLIATIVE_OPIOIDS[toDrug].routes[toRoute].intervalH.min;
  const perDose = fix(Math.max(step, roundTo(reduced / (24 / ih), step)));
  const notes = ['Conversion ratios are consensus/average values; individual response varies; monitor closely after conversion (MASCC-ASCO 2025).'];
  if (fromDrug === 'oxycodone' && toDrug === 'morphine') notes.push('Oxycodone → morphine: the panel gives between 1:1 and 1:2; the simulator uses 1.5 (within that range).');
  return { ok: true, oralMorphineEquivalent24h: fix(ome), converted24h: fix(raw), reduced24h: fix(reduced), reductionPct, perDose, intervalH: ih, unit: 'mg', sources: [...new Set([...a.sources, ...b.sources, 'S109'])], notes };
}

// ------------------------------------------------------------------------------------------- simulation
const DAY = 1440;
const ALARM_TEXT = {
  resp_depression: { msg: 'Respiratory rate below 8/min — possible opioid-induced respiratory depression. Assess; naloxone only if life-threatening, in small increments titrated to respiratory rate (S116).', src: ['S116'] },
  excess_sedation: { msg: 'Unintended sedation (RASS ≤ −3) without a documented palliative-sedation target at this depth — possible opioid excess. Assess; consider holding/reducing (clinician decision).', src: ['S120'] },
  not_proportional: { msg: 'Sedation deeper than the documented target for ≥30 min — not proportional. Review and consider reducing (clinician-approved titration only).', src: ['S101'] },
  comfort_not_achieved: { msg: 'Comfort not achieved: the documented target symptom has stayed ≥4/10 for 60 min. Review with the team; the simulator never escalates on its own.', src: [] },
  bowel_missing: { msg: 'Scheduled opioid without a bowel regimen — ESMO 2018: laxatives routinely prescribed for prophylaxis of opioid-induced constipation [I, A].', src: ['S107'] },
  naloxone_reversal: { msg: 'Marked opioid antagonism in an opioid-tolerant patient — risk of pain crisis or withdrawal. Naloxone aims to reverse life-threatening respiratory depression without losing symptom control (S116).', src: ['S116'] },
  uncontrolled_pain: { msg: 'Pain ≥7/10 for 2 h — review the regimen (daily review or clinician decision).', src: [] },
};
const PRIORITY = { resp_depression: 'high', excess_sedation: 'high', not_proportional: 'medium', comfort_not_achieved: 'medium', bowel_missing: 'low', naloxone_reversal: 'medium', uncontrolled_pain: 'low' };

export function createPalliativeSim({ patient, caseDef = {}, module = 'pain', seed = 1 }) {
  const p = patient.flags ? patient : derivePalliative(patient);
  const gen = { baseline: 5, progressionPerDay: 0, incidentPerHour: 0.05, incidentSize: 2, incidentMin: 40, dyspnoea: 0, agitation: 0, secretions: null, ...(caseDef.generator || {}) };
  const rng = createRng(seed);
  const st = {
    tMin: 0, module, paused: null, regimen: null, bowelRegimen: false, nonPharm: { fan: false, positioning: false, oxygen: false }, comfortMonitoring: false,
    symptoms: { pain: gen.baseline, dyspnoea: gen.dyspnoea, agitation: gen.agitation, secretions: gen.secretions ? gen.secretions.start : 0, nausea: 0, constipation: 0 },
    rass: 0, rr: p.baselineRr, deliriumRisk: p.delirium, mar: [], alarms: [], alarmHistory: [], log: [], reviews: [], pendingReview: null, trend: [],
    sedation: { active: false, targetRass: null, symptom: null, infusionMgH: 0, lastBolus: null, titrations: [] },
    doc: { refractory: null, goals: null, consent: null, interdisciplinary: null, prognosis: null, jurisdiction: null },
    hydration: { discussed: false, decision: '', note: '' }, familyNotes: '',
  };
  // PK state (amounts). Opioid in oral-morphine-equivalent units (illustrative effect model only).
  const pk = { gut: 0, central: 0, effect: 0, midDepot: 0, midCentral: 0, nalox: 0 };
  let incidentLeft = 0; let lastScheduledMin = null; let lastPrnMin = -1e9; let lastNaloxMin = -1e9; let regimenStartMin = null;
  const timers = { notProp: 0, comfort: 0, pain7: 0 };
  const tolOme = (() => { const r = p.opioidStatus === 'tolerant' ? p.currentRegimen : null; if (!r) return 0; const per = r.route === 'oral' ? (factorFor(r.drugId) || 1) : (MODEL.IV_EFFECT_FACTOR[r.drugId] || 1); return r.dose * (24 / r.intervalH) * per; })();
  const ec50 = MODEL.EC50_BASE_OME + MODEL.EC50_PER_OME_DAY * tolOme;
  const keFor = (drugId) => {
    let k = MODEL.KE_PER_MIN; const f = MODEL.RENAL_KE_FACTOR[drugId];
    if (f) { if (p.egfr < 30) k *= f.lt30; else if (p.egfr < 60) k *= f.lt60; }
    if (p.liverDisease || p.severeHepatic) k *= MODEL.HEPATIC_KE_FACTOR;
    return k;
  };
  const log = (kind, message) => { st.log.push({ tMin: st.tMin, kind, message }); };

  // Prime steady state for an opioid-tolerant patient (they arrive on their current regimen).
  if (tolOme > 0) { const amt = (tolOme / DAY) / keFor(p.currentRegimen.drugId); pk.central = amt; pk.effect = amt; }

  function dose(drugId, route, mg, kind, by) {
    const per = route === 'oral' ? (factorFor(drugId) || 1) : (MODEL.IV_EFFECT_FACTOR[drugId] || 1);
    if (route === 'oral') pk.gut += mg * per; else pk.central += mg * per;
    st.mar.push({ tMin: st.tMin, drugId, route, dose: fix(mg), unit: 'mg', kind, by });
    log('dose', `${kind === 'prn' ? 'PRN' : 'Scheduled'} ${drugId} ${fix(mg)} mg ${route.toUpperCase()} (${by}).`);
  }
  const x = () => (pk.effect / ec50) * (1 - pk.nalox / (pk.nalox + MODEL.NALOX_HALF_MG));
  const antag = () => pk.nalox / (pk.nalox + MODEL.NALOX_HALF_MG);

  function raise(id, active) {
    let a = st.alarms.find((y) => y.id === id);
    const pr = id === 'resp_depression' && st.comfortMonitoring ? 'low' : PRIORITY[id];
    if (active && !a) {
      a = { id, priority: pr, message: ALARM_TEXT[id].msg + (pr !== PRIORITY[id] ? ' [Comfort-focused monitoring on: shown as LOW — teaching convention.]' : ''), sources: ALARM_TEXT[id].src, active: true, acknowledged: false, sinceMin: st.tMin };
      st.alarms.push(a); st.alarmHistory.push({ id, priority: pr, tMin: st.tMin }); log('alarm', `${pr.toUpperCase()}: ${a.message}`);
      if (pr === 'high' && !st.paused) st.paused = { reason: 'alarm', message: `Paused: HIGH alarm — ${a.message}` };
    } else if (a) { a.active = !!active; if (active) a.priority = pr; }
    st.alarms = st.alarms.filter((y) => y.active || !y.acknowledged);
  }

  function computeSymptoms() {
    const xv = Math.max(0, x()); const days = st.tMin / DAY; const m = pk.midCentral;
    const g = clamp(gen.baseline + gen.progressionPerDay * days + (incidentLeft > 0 ? gen.incidentSize : 0) + rng.normal() * MODEL.NOISE_SD, 1, 10);
    let pain = g * (1 - MODEL.ANALGESIA_EMAX * hill(xv, 1, MODEL.ANALGESIA_GAMMA));
    const ant = antag();
    if (p.opioidStatus === 'tolerant' && ant > 0.5) pain += 6 * (ant - 0.5);
    let dys = gen.dyspnoea ? clamp(gen.dyspnoea + 0.3 * days, 0, 10) : 0;
    if (dys) {
      dys *= 1 - MODEL.DYSPNOEA_OPIOID_MAX * hill(xv, 1.5, 1);
      if (st.nonPharm.fan) dys -= MODEL.NONPHARM_RELIEF;
      if (st.nonPharm.positioning) dys -= MODEL.NONPHARM_RELIEF * 0.5;
      if (st.nonPharm.oxygen && p.hypoxaemic) dys -= MODEL.OXYGEN_RELIEF_HYPOXAEMIC;
    }
    let agi = gen.agitation ? gen.agitation * (1 - MODEL.MIDAZ_AGITATION_MAX * hill(m, 3, 1.5)) : 0;
    if (p.opioidStatus === 'tolerant' && ant > 0.5) agi += 3 * (ant - 0.5);
    let sec = gen.secretions ? clamp(gen.secretions.start + gen.secretions.perHour * (st.tMin / 60), 0, 10) : 0;
    if (sec && st.nonPharm.positioning) sec -= MODEL.POSITIONING_SECRETION_RELIEF;
    const sinceStart = regimenStartMin === null ? null : (st.tMin - regimenStartMin) / DAY;
    const nausea = sinceStart === null ? 0 : MODEL.NAUSEA_START * Math.exp(-sinceStart / MODEL.NAUSEA_DECAY_DAYS) * Math.min(1, xv) * (p.opioidStatus === 'tolerant' ? 0.3 : 1);
    const consRate = (st.regimen ? (st.bowelRegimen ? MODEL.CONSTIPATION_WITH_BOWEL_PER_H : MODEL.CONSTIPATION_PER_H) * Math.min(1, xv) : 0) / 60;
    const s = st.symptoms;
    s.pain = fix(clamp(pain, 0, 10)); s.dyspnoea = fix(clamp(dys, 0, 10)); s.agitation = fix(clamp(agi, 0, 10)); s.secretions = fix(clamp(sec, 0, 10)); s.nausea = fix(clamp(nausea, 0, 10));
    s.constipation = fix(clamp(s.constipation + consRate - (st.bowelRegimen ? 0.02 / 60 : 0), 0, 10));
    const sedOp = 5 * hill(xv, MODEL.SED_OPIOID_X50, MODEL.SED_OPIOID_GAMMA); const sedMid = 5 * hill(m, MODEL.MIDAZ_EC50_MG, MODEL.MIDAZ_GAMMA);
    st.rassCont = clamp(Math.min(4, s.agitation * MODEL.AGITATION_TO_RASS) - sedOp - sedMid, -5, 4);
    st.rass = Math.round(st.rassCont);
    st.rr = fix(clamp(p.baselineRr * (1 - MODEL.RR_OPIOID_MAX * hill(xv, MODEL.RR_OPIOID_X50, MODEL.SED_OPIOID_GAMMA)) - MODEL.MIDAZ_RR_MAX * (m / (m + 10)) + rng.normal() * 0.3, 2, 40));
    st.deliriumRisk = deliriumRisk(p, { opioidExcess: xv > 2 });
  }

  function evaluateAlarms() {
    raise('resp_depression', st.rr < R.RR_ALARM.value);
    // During documented palliative sedation, depth beyond the target is a proportionality alarm (below), not "unintended".
    const documented = st.sedation.active && st.sedation.targetRass !== null;
    raise('excess_sedation', st.rass <= R.RASS_EXCESS.value && !documented);
    if (st.sedation.active && st.sedation.targetRass !== null && st.rass < st.sedation.targetRass) timers.notProp += 1; else timers.notProp = 0;
    raise('not_proportional', timers.notProp >= R.PROPORTIONALITY_ALARM_MIN.value);
    const sym = st.sedation.symptom ? st.symptoms[st.sedation.symptom] : null;
    if (st.sedation.active && sym !== null && sym >= R.COMFORT_NOT_ACHIEVED_SCORE.value) timers.comfort += 1; else timers.comfort = 0;
    raise('comfort_not_achieved', timers.comfort >= 60);
    raise('bowel_missing', !!(st.regimen && st.regimen.scheduled && !st.bowelRegimen));
    raise('naloxone_reversal', p.opioidStatus === 'tolerant' && antag() > 0.5);
    if (st.symptoms.pain >= 7) timers.pain7 += 1; else timers.pain7 = 0;
    raise('uncontrolled_pain', timers.pain7 >= 120);
  }

  function stepOne() {
    // Scheduled opioid (comfort regimen continues during palliative sedation).
    const reg = st.regimen;
    if (reg && reg.scheduled && (lastScheduledMin === null || st.tMin - lastScheduledMin >= reg.intervalH * 60)) { dose(reg.drugId, reg.route, reg.dose, 'scheduled', 'schedule (approved regimen)'); lastScheduledMin = st.tMin; }
    // PRN breakthrough on (simulated) request.
    if (reg && reg.prn && st.symptoms.pain >= R.PRN_GIVE_PAIN_THRESHOLD.value && st.rass > -2) {
      const minInt = reg.route === 'oral' ? R.PRN_MIN_INTERVAL_ORAL_MIN.value : R.PRN_MIN_INTERVAL_IV_MIN.value;
      if (st.tMin - lastPrnMin >= minInt) { dose(reg.drugId, reg.route, reg.prn.dose, 'prn', 'PRN on request (approved)'); lastPrnMin = st.tMin; }
    }
    // Pain generator incident episodes (seeded).
    if (incidentLeft > 0) incidentLeft -= 1; else if (rng.uniform() < gen.incidentPerHour / 60) incidentLeft = gen.incidentMin;
    // PK (1-min Euler step).
    const ke = keFor(reg ? reg.drugId : (p.currentRegimen && p.currentRegimen.drugId) || 'morphine');
    const abs = pk.gut * MODEL.KA_ORAL_PER_MIN; pk.gut -= abs; pk.central += abs - pk.central * ke;
    pk.effect += (pk.central - pk.effect) * MODEL.KE0_PER_MIN;
    const mabs = pk.midDepot * MODEL.MIDAZ_KA_SC_PER_MIN; pk.midDepot -= mabs;
    pk.midCentral += mabs + st.sedation.infusionMgH / 60 - pk.midCentral * MODEL.MIDAZ_KE_PER_MIN;
    pk.nalox -= pk.nalox * MODEL.NALOX_KE_PER_MIN;
    st.tMin += 1;
    computeSymptoms();
    evaluateAlarms();
    if (st.tMin % MODEL.TREND_EVERY_MIN === 0) st.trend.push({ t: st.tMin, pain: st.symptoms.pain, dyspnoea: st.symptoms.dyspnoea, agitation: st.symptoms.agitation, secretions: st.symptoms.secretions, rass: st.rass, rr: st.rr, target: st.sedation.active ? st.sedation.targetRass : null, infusion: st.sedation.infusionMgH });
    if (st.regimen && st.tMin % (R.REVIEW_INTERVAL_H.value * 60) === 0 && !st.pendingReview) openReview();
  }

  // ----------------------------------------------------------------- daily review gate
  function windowStats(fromMin) {
    const tr = st.trend.filter((y) => y.t > fromMin);
    const mean = (k) => (tr.length ? Number((tr.reduce((a, y) => a + y[k], 0) / tr.length).toFixed(1)) : null);
    const mar = st.mar.filter((y) => y.tMin >= fromMin && ['scheduled', 'prn'].includes(y.kind));
    const sum = (k) => fix(mar.filter((y) => y.kind === k).reduce((a, y) => a + y.dose, 0));
    const hi = st.alarmHistory.filter((y) => y.tMin >= fromMin && ['resp_depression', 'excess_sedation'].includes(y.id)).length;
    return { meanPain: mean('pain'), maxPain: tr.length ? Math.max(...tr.map((y) => y.pain)) : null, prnCount: mar.filter((y) => y.kind === 'prn').length, scheduled24h: sum('scheduled'), prn24h: sum('prn'), total24h: fix(sum('scheduled') + sum('prn')), opioidSafetyAlarms: hi };
  }

  function openReview() {
    const reg = st.regimen; const stats = windowStats(st.tMin - DAY); const prev = st.reviews.length ? st.reviews[st.reviews.length - 1].stats : null;
    const sug = []; const add = (o) => sug.push({ status: 'pending', ...o, id: `r${st.reviews.length + 1}-${sug.length + 1}` });
    const mmeNow = mmePerDay(reg);
    if (stats.opioidSafetyAlarms > 0) add({ kind: 'info', text: 'Opioid-related sedation or respiratory alarm in the last 24 h: no dose increase is suggested. A dose reduction or opioid rotation is a clinician / specialist decision (no number is simulated).', sources: ['S116', 'S120'] });
    else if (stats.meanPain !== null && stats.meanPain >= R.TITRATION_PAIN_THRESHOLD.value && (!prev || stats.meanPain >= prev.meanPain - 0.5)) {
      const inc = R.TITRATION_INCREASE_PCT.default; const incStep = ROUNDING[`${reg.drugId}:${reg.route}`];
      if (reg.scheduled) {
        const newDose = fix(Math.max(incStep, roundTo(reg.dose * (1 + inc / 100), incStep)));
        const new24 = newDose * 24 / reg.intervalH; const bt = breakthroughDose(new24, reg.drugId, reg.route);
        const newMme = mmePerDay({ ...reg, dose: newDose });
        const cdc = p.cdcApplies && newMme !== null && newMme >= R.CDC_PAUSE_MME.value && (mmeNow === null || mmeNow < R.CDC_PAUSE_MME.value);
        add({ kind: 'increase', text: `Mean pain ${stats.meanPain}/10 (moderate–severe, not improved): increase the scheduled dose by ${inc}% (NCCN 50–100%; lower bound shown): ${reg.dose} → ${newDose} mg every ${reg.intervalH} h; breakthrough ${bt.dose} mg (${bt.pct}% of ${fix(new24)} mg/24 h).${newMme !== null ? ` New MME/day ${newMme} (risk estimate).` : ''}`,
          change: { dose: newDose, prnDose: bt.dose }, sources: ['S108', ...(cdc ? ['S105'] : [])], needsAck: cdc ? 'CDC 2022 Rec. 4: I have paused and carefully reassessed individual benefits and risks before increasing to ≥50 MME/day.' : null });
      } else {
        const lab = PALLIATIVE_OPIOIDS[reg.drugId].routes[reg.route]; const maxD = lab.start.max || reg.prn.dose;
        const newPrn = fix(Math.min(maxD, roundTo(reg.prn.dose * (1 + inc / 100), incStep)));
        if (newPrn > reg.prn.dose) add({ kind: 'increase', text: `Mean pain ${stats.meanPain}/10 on as-needed dosing: increase the as-needed dose ${reg.prn.dose} → ${newPrn} mg (within the label starting range; NCCN 50–100% titration, capped at the label maximum).`, change: { prnDose: newPrn }, sources: ['S108', ...lab.sources] });
        else add({ kind: 'info', text: 'As-needed dose is at the top of the label starting range: further changes are a clinician decision (not simulated).', sources: lab.sources });
      }
      if (st.deliriumRisk.level === 'high' || stats.opioidSafetyAlarms > 0) add({ kind: 'rotation', text: 'Adverse effects with ongoing pain: an opioid rotation can be computed (sourced ratios only; you must enter the cross-tolerance reduction).', sources: ['S109', 'S108'] });
    } else add({ kind: 'info', text: `Mean pain ${stats.meanPain}/10: no titration suggested — continue and reassess.`, sources: [] });
    if (reg.scheduled && !st.bowelRegimen) add({ kind: 'bowel', text: 'Start a bowel regimen (ESMO 2018: laxatives routinely prescribed with opioids [I, A]; agent choice not simulated).', change: { bowel: true }, sources: ['S107'] });
    if (p.cdcApplies) {
      if (mmeNow !== null && mmeNow >= R.CDC_PAUSE_MME.value) add({ kind: 'info', text: `CDC 2022 Rec. 8: offer naloxone (≥50 MME/day — ${mmeNow}). Rec. 9: review PDMP data (teaching note; not simulated).`, sources: ['S105'] });
      if (p.diagnosis === 'noncancer_acute') add({ kind: 'info', text: 'CDC 2022 Rec. 6 (acute pain): prescribe no greater quantity than needed for the expected duration of pain severe enough to require opioids; reassess and taper as pain resolves.', sources: ['S105'] });
    }
    st.pendingReview = { id: `review-${st.reviews.length + 1}`, tMin: st.tMin, stats, suggestions: sug };
    st.paused = { reason: 'review', message: `Paused: daily review at ${fmtDay(st.tMin)} — decide each suggestion (nothing changes without your approval).` };
    log('review', `Daily review opened (${sug.length} item(s)).`);
  }

  function decide(id, decision, opts = {}) {
    const r = st.pendingReview; if (!r) return { ok: false, reason: 'No review open.' };
    const s = r.suggestions.find((y) => y.id === id); if (!s) return { ok: false, reason: 'Unknown suggestion.' };
    if (s.status !== 'pending') return { ok: false, reason: 'Already decided.' };
    if (decision === 'approve') {
      if (s.needsAck && opts.ack !== true) return { ok: false, blocked: true, reason: s.needsAck };
      if (s.kind === 'rotation') {
        const reg = st.regimen; const c = convertOpioid({ fromDrug: reg.drugId, fromRoute: reg.route, total24h: reg.dose * 24 / reg.intervalH, toDrug: opts.toDrug, toRoute: opts.toRoute, reductionPct: opts.reductionPct });
        if (!c.ok) return { ok: false, blocked: true, reason: c.reason };
        const bt = breakthroughDose(c.perDose * 24 / c.intervalH, opts.toDrug, opts.toRoute);
        st.regimen = { ...reg, drugId: opts.toDrug, route: opts.toRoute, dose: c.perDose, intervalH: c.intervalH, prn: reg.prn ? { dose: bt.dose } : null };
        log('action', `Clinician approved rotation → ${opts.toDrug} ${c.perDose} mg ${opts.toRoute.toUpperCase()} every ${c.intervalH} h (reduction ${opts.reductionPct}%).`);
      } else if (s.change) {
        if (typeof s.change.dose === 'number') st.regimen = { ...st.regimen, dose: s.change.dose };
        if (typeof s.change.prnDose === 'number' && st.regimen.prn) st.regimen = { ...st.regimen, prn: { dose: s.change.prnDose } };
        if (s.change.bowel) st.bowelRegimen = true;
        log('action', `Clinician approved: ${s.text}`);
      } else log('action', `Clinician acknowledged: ${s.text}`);
      s.status = s.kind === 'info' ? 'acknowledged' : 'approved';
    } else { s.status = s.kind === 'info' ? 'acknowledged' : 'declined'; log('action', `Clinician ${s.status}: ${s.text}`); }
    if (r.suggestions.every((y) => y.status !== 'pending')) {
      st.reviews.push({ ...r, closedMin: st.tMin }); st.pendingReview = null;
      if (st.paused && st.paused.reason === 'review') st.paused = null;
      log('review', 'Daily review completed by the clinician.');
      blockIfHigh();
    }
    return { ok: true };
  }
  function blockIfHigh() { const a = st.alarms.find((y) => y.priority === 'high' && y.active && !y.acknowledged); if (a && !st.paused) st.paused = { reason: 'alarm', message: `Paused: HIGH alarm — ${a.message}` }; }

  // ----------------------------------------------------------------- public actions
  function approveRegimen(reg, { approved } = {}) {
    if (approved !== true) return { ok: false, blocked: true, reason: 'Clinician approval required.' };
    const d = PALLIATIVE_OPIOIDS[reg.drugId]; const r = d && d.routes[reg.route];
    if (!r) return { ok: false, blocked: true, reason: 'Not simulated — specialist decision.' };
    if (!(reg.dose > 0)) return { ok: false, blocked: true, reason: 'Enter a dose.' };
    if (!(reg.intervalH >= r.intervalH.min && reg.intervalH <= r.intervalH.max)) return { ok: false, blocked: true, reason: `Interval must be ${r.intervalH.min}–${r.intervalH.max} h (label).` };
    if (st.regimen) return { ok: false, blocked: true, reason: 'A regimen is already running; changes go through the daily review.' };
    st.regimen = { drugId: reg.drugId, route: reg.route, dose: fix(reg.dose), intervalH: reg.intervalH, scheduled: !!reg.scheduled, prn: reg.prnDose > 0 ? { dose: fix(reg.prnDose) } : null };
    st.bowelRegimen = !!reg.bowel; regimenStartMin = st.tMin;
    if (p.opioidStatus === 'tolerant' && reg.scheduled) lastScheduledMin = null;
    log('action', `Clinician approved regimen: ${reg.scheduled ? 'scheduled' : 'as-needed'} ${reg.drugId} ${fix(reg.dose)} mg ${reg.route.toUpperCase()} every ${reg.intervalH} h${st.regimen.prn ? `; PRN ${st.regimen.prn.dose} mg` : ''}; bowel regimen ${st.bowelRegimen ? 'yes' : 'no'}.`);
    evaluateAlarms();
    return { ok: true };
  }

  function step(n = 1) { for (let i = 0; i < n; i++) { if (st.paused) break; stepOne(); } return st; }
  function acknowledge(id) { const a = st.alarms.find((y) => y.id === id); if (!a) return { ok: false }; a.acknowledged = true; log('action', `Alarm acknowledged by clinician: ${id}.`); st.alarms = st.alarms.filter((y) => y.active || !y.acknowledged); return { ok: true }; }
  function resume() {
    if (st.pendingReview) return { ok: false, reason: 'Decide every review item first.' };
    const a = st.alarms.find((y) => y.priority === 'high' && y.active && !y.acknowledged);
    if (a) return { ok: false, reason: 'Acknowledge the HIGH alarm first.' };
    if (st.paused) log('action', 'Clinician resumed the simulation.');
    st.paused = null; return { ok: true };
  }
  function naloxone() {
    if (st.tMin - lastNaloxMin < R.NALOXONE_MIN_INTERVAL_MIN.value) return { ok: false, blocked: true, reason: `Repeat no sooner than every ${R.NALOXONE_MIN_INTERVAL_MIN.value} min (S116).` };
    pk.nalox += R.NALOXONE_DOSE_MG.value; lastNaloxMin = st.tMin;
    st.mar.push({ tMin: st.tMin, drugId: 'naloxone', route: 'iv', dose: R.NALOXONE_DOSE_MG.value, unit: 'mg', kind: 'naloxone', by: 'clinician' });
    log('dose', `Naloxone ${R.NALOXONE_DOSE_MG.value} mg IV slow bolus (titrate to respiratory rate; S116/S14).`);
    return { ok: true };
  }
  function givePrnNow() {
    const reg = st.regimen; if (!reg || !reg.prn) return { ok: false, reason: 'No approved PRN dose.' };
    const minInt = reg.route === 'oral' ? R.PRN_MIN_INTERVAL_ORAL_MIN.value : R.PRN_MIN_INTERVAL_IV_MIN.value;
    if (st.tMin - lastPrnMin < minInt) return { ok: false, blocked: true, reason: `Minimum interval ${minInt} min (NCCN).` };
    dose(reg.drugId, reg.route, reg.prn.dose, 'prn', 'clinician'); lastPrnMin = st.tMin; return { ok: true };
  }
  function adjustOpioid({ reason }) {
    if (reason === 'sedation') return { ok: false, blocked: true, reason: 'Opioids are not used to produce sedation (EAPC framework): continue the comfort regimen at its current dose; use the sedation pathway.', sources: ['S101', 'S100'] };
    return { ok: false, blocked: true, reason: 'Opioid changes go through the daily review (clinician approval).' };
  }
  function setBowel(on) { st.bowelRegimen = !!on; log('action', `Bowel regimen ${on ? 'documented' : 'removed'} by clinician.`); evaluateAlarms(); }
  function setNonPharm(k, on) {
    if (!(k in st.nonPharm)) return { ok: false };
    st.nonPharm[k] = !!on; log('action', `${k} ${on ? 'on' : 'off'}.`);
    const note = k === 'oxygen' && on && !p.hypoxaemic ? 'ASCO 2021: supplemental oxygen is not recommended when SpO2 >90%; no effect simulated for this non-hypoxaemic patient.' : null;
    return { ok: true, note };
  }
  function setComfortMonitoring(on) { st.comfortMonitoring = !!on; log('action', `Comfort-focused monitoring ${on ? 'on' : 'off'} (teaching toggle: respiratory-rate alarm shown as LOW; documented as a goals-of-care decision).`); return { ok: true }; }
  function setDoc(id, data) { if (!(id in st.doc)) return { ok: false }; st.doc[id] = data ? { ...data, tMin: st.tMin } : null; log('doc', `Documentation ${data ? 'recorded' : 'cleared'}: ${id}.`); return { ok: true }; }
  function setHydration(h) { st.hydration = { discussed: !!h.discussed, decision: String(h.decision || ''), note: String(h.note || '') }; log('doc', 'Hydration/nutrition decision documented (separate decision).'); }
  function setFamilyNotes(t) { st.familyNotes = String(t || '').slice(0, 4000); }

  function gateStatus() {
    const d = st.doc; const missing = [];
    const filled = (s) => typeof s === 'string' && s.trim().length > 0;
    const ok = {
      refractory: !!(d.refractory && filled(d.refractory.symptom) && Array.isArray(d.refractory.tried) && d.refractory.tried.length > 0 && filled(d.refractory.why)),
      goals: !!(d.goals && ['patient', 'surrogate'].includes(d.goals.with) && filled(d.goals.summary)),
      consent: !!(d.consent && ['patient_consent', 'surrogate_consent', 'assent'].includes(d.consent.type) && d.consent.depthDiscussed === true),
      interdisciplinary: !!(d.interdisciplinary && d.interdisciplinary.specialist === true && filled(d.interdisciplinary.note)),
      prognosis: !!(d.prognosis && d.prognosis.confirmed === true && ['weeks_months', 'days_weeks', 'hours_days'].includes(p.prognosis)),
      jurisdiction: !!(d.jurisdiction && d.jurisdiction.acknowledged === true),
    };
    for (const it of SEDATION_DOC_ITEMS) if (!ok[it.id]) missing.push(it.label);
    return { complete: missing.length === 0, items: SEDATION_DOC_ITEMS.map((it) => ({ ...it, done: ok[it.id] })), missing };
  }

  function sedationAction(a, { approved } = {}) {
    if (approved !== true) return { ok: false, blocked: true, reasons: ['Clinician approval is required for every titration.'] };
    if (module !== 'eol') return { ok: false, blocked: true, reasons: ['Palliative sedation is only available in the end-of-life module.'] };
    const g = gateStatus(); if (!g.complete) return { ok: false, blocked: true, reasons: g.missing.map((m) => `Missing: ${m}`) };
    const sd = st.sedation; const rec = (text) => { sd.titrations.push({ tMin: st.tMin, action: a.type, text, rass: st.rass, target: sd.targetRass, symptomScore: sd.symptom ? st.symptoms[sd.symptom] : null }); log('sedation', `Clinician-approved: ${text}`); };
    if (a.type === 'set_target') {
      if (!(Number.isInteger(a.targetRass) && a.targetRass >= -5 && a.targetRass <= -1)) return { ok: false, blocked: true, reasons: ['Target RASS must be −1 to −5.'] };
      if (!['agitation', 'dyspnoea', 'pain'].includes(a.symptom)) return { ok: false, blocked: true, reasons: ['Choose the symptom the sedation is meant to relieve.'] };
      if (a.targetRass <= -4 && p.prognosis !== 'hours_days') return { ok: false, blocked: true, reasons: ['Continuous deep sedation is only considered in the last hours–days (prognosis category). Choose a lighter, proportionate target.'] };
      sd.targetRass = a.targetRass; sd.symptom = a.symptom; rec(`target RASS ${a.targetRass} for ${a.symptom} (lowest level that relieves the symptom)`); return { ok: true };
    }
    if (sd.targetRass === null) return { ok: false, blocked: true, reasons: ['Document the target RASS and symptom first.'] };
    const level = sd.targetRass <= -4 ? 'deep' : 'light';
    if (a.type === 'bolus') {
      if (!['sc', 'iv'].includes(a.route)) return { ok: false, blocked: true, reasons: ['Route SC or IV.'] };
      const spec = SM.bolus[level][a.route]; let mg = spec.value;
      if (typeof a.dose === 'number') { const lo = spec.min ?? spec.value; const hi = spec.max ?? spec.value; if (a.dose < lo || a.dose > hi) return { ok: false, blocked: true, reasons: [`Framework ${level} ${a.route.toUpperCase()} bolus: ${lo === hi ? lo : `${lo}–${hi}`} mg.`] }; mg = a.dose; }
      if (a.route === 'sc') pk.midDepot += mg; else pk.midCentral += mg;
      sd.active = true; sd.lastBolus = { tMin: st.tMin, route: a.route, dose: mg, starting: mg };
      st.mar.push({ tMin: st.tMin, drugId: 'midazolam', route: a.route, dose: mg, unit: 'mg', kind: 'sedation', by: 'clinician (approved)' });
      rec(`midazolam ${mg} mg ${a.route.toUpperCase()} (${level} palliative sedation starting bolus, S101)`); return { ok: true };
    }
    if (a.type === 'repeat') {
      const lb = sd.lastBolus; if (!lb) return { ok: false, blocked: true, reasons: ['No starting bolus to repeat.'] };
      const wait = SM.repeatAfterMin[lb.route]; if (st.tMin - lb.tMin < wait) return { ok: false, blocked: true, reasons: [`Repeat no sooner than ${wait} min after the last ${lb.route.toUpperCase()} bolus (S101).`] };
      const mg = fix(lb.starting * SM.repeatFraction);
      if (lb.route === 'sc') pk.midDepot += mg; else pk.midCentral += mg;
      sd.lastBolus = { ...lb, tMin: st.tMin };
      st.mar.push({ tMin: st.tMin, drugId: 'midazolam', route: lb.route, dose: mg, unit: 'mg', kind: 'sedation', by: 'clinician (approved)' });
      rec(`midazolam repeat ${mg} mg ${lb.route.toUpperCase()} (half the starting bolus, S101)`); return { ok: true };
    }
    if (a.type === 'infusion') {
      const rate = a.rateMgH;
      if (!(typeof rate === 'number' && rate >= 0)) return { ok: false, blocked: true, reasons: ['Enter a rate (mg/h).'] };
      if (rate > R.MIDAZOLAM_MAX_SIM_MG_H.value) return { ok: false, blocked: true, reasons: [`Above ${R.MIDAZOLAM_MAX_SIM_MG_H.value} mg/h the framework advises considering adding or changing medication; second-line agents are not simulated — specialist decision.`] };
      if (sd.infusionMgH === 0 && rate > 0 && rate !== SM.infusionStartMgH) return { ok: false, blocked: true, reasons: [`Start the infusion at ${SM.infusionStartMgH} mg/h, then adjust as needed (S101).`] };
      const old = sd.infusionMgH; sd.infusionMgH = rate; sd.active = sd.active || rate > 0;
      rec(`midazolam infusion ${old} → ${rate} mg/h`); return { ok: true };
    }
    if (a.type === 'stop') { sd.infusionMgH = 0; sd.active = false; rec('sedation stopped (infusion 0 mg/h)'); return { ok: true }; }
    return { ok: false, blocked: true, reasons: ['Unknown action.'] };
  }

  function summary() {
    const totals = {};
    for (const m of st.mar) { const k = `${m.drugId} ${m.route.toUpperCase()} (${m.kind})`; totals[k] = fix((totals[k] || 0) + m.dose); }
    const days = [];
    for (let d = 0; d * DAY < st.tMin; d++) { const w = st.mar.filter((m) => m.tMin >= d * DAY && m.tMin < (d + 1) * DAY && ['scheduled', 'prn'].includes(m.kind)); const tot = fix(w.reduce((a, m) => a + m.dose, 0)); days.push({ day: d + 1, total: tot, doses: w.length }); }
    return { durationMin: st.tMin, module, regimen: st.regimen, mmeDayNow: mmePerDay(st.regimen), cdcApplies: p.cdcApplies, totals, perDay: days, alarms: st.alarmHistory, reviews: st.reviews.map((r) => ({ tMin: r.tMin, stats: r.stats, suggestions: r.suggestions.map((s) => ({ kind: s.kind, text: s.text, status: s.status })) })),
      documentation: gateStatus(), sedation: st.sedation, hydration: st.hydration, familyNotes: st.familyNotes, timeline: st.trend.filter((y) => y.t % 15 === 0), bowelRegimen: st.bowelRegimen };
  }

  computeSymptoms();
  return {
    get state() { return st; }, patient: p, seed,
    approveRegimen, step, acknowledge, resume, naloxone, givePrnNow, adjustOpioid, setBowel, setNonPharm, setComfortMonitoring, setDoc, setHydration, setFamilyNotes,
    gateStatus, sedationAction, decide, summary, windowStats,
  };
}

export function fmtDay(min) { const d = Math.floor(min / DAY) + 1; const h = Math.floor((min % DAY) / 60); const m = min % 60; return `day ${d} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

/** Parameter inventory for the palliative modules (MODEL_CARD section; same provenance vocabulary). */
export function palliativeParameterInventory() {
  const out = []; const add = (component, name, value, unit, provenance, sourceIds, note, drugId) => out.push({ component, drugId: drugId || '', name, value, unit, provenance, sourceIds, note });
  for (const d of Object.values(PALLIATIVE_OPIOIDS)) for (const [route, r] of Object.entries(d.routes)) {
    const s = r.start; const val = typeof s.perKgMin === 'number' ? `${s.perKgMin}–${s.perKgMax}` : `${s.min}–${s.max}`;
    add('palliative_dose', `${route} starting dose (opioid-naïve)`, val, s.unit, 'fda_label', [...r.sources], r.form, d.id);
    add('palliative_dose', `${route} interval`, `${r.intervalH.min}–${r.intervalH.max}`, 'h', 'fda_label', [...r.sources], 'Default = lower bound (simulator convention).', d.id);
  }
  add('palliative_dose', 'hydromorphone renal/hepatic fraction', '0.25–0.5', '× usual starting dose', 'fda_label', ['S114', 'S115'], 'Label range; moderate → 0.5, severe → 0.25 is a simulator mapping.', 'hydromorphone');
  add('palliative_dose', 'morphine severe-CKD warning threshold', 30, 'mL/min/1.73m² (eGFR)', 'guideline', ['S107', 'S111'], 'ESMO 2018 eGFR <30 statement; label: start lower in renal failure.', 'morphine');
  for (const [k, v] of Object.entries(ROUNDING)) add('palliative_dose', `rounding increment ${k}`, v, 'mg', 'simulator_convention', [], 'Measurable increment for computed doses.');
  for (const [k, x] of Object.entries(R)) add('palliative_rule', k, typeof x.value === 'object' && !Array.isArray(x.value) ? JSON.stringify(x.value) : Array.isArray(x.value) ? x.value.join('–') : x.value, x.unit, x.provenance, [...x.sourceIds], x.rationale);
  add('palliative_sedation', 'midazolam light bolus SC / IV', `${SM.bolus.light.sc.value} / ${SM.bolus.light.iv.value}`, 'mg', 'guideline', [...SM.sources], 'Revised EAPC framework step 1.', 'midazolam');
  add('palliative_sedation', 'midazolam deep bolus SC / IV', `${SM.bolus.deep.sc.min}–${SM.bolus.deep.sc.max} / ${SM.bolus.deep.iv.min}–${SM.bolus.deep.iv.max}`, 'mg', 'guideline', [...SM.sources], 'Revised EAPC framework step 1; default = lower bound.', 'midazolam');
  add('palliative_sedation', 'midazolam repeat fraction / interval SC, IV', `${SM.repeatFraction} / ${SM.repeatAfterMin.sc}, ${SM.repeatAfterMin.iv}`, '× starting bolus / min', 'guideline', [...SM.sources], 'Half the starting bolus after 20 min SC or 5 min IV.', 'midazolam');
  add('palliative_sedation', 'midazolam infusion start', SM.infusionStartMgH, 'mg/h', 'guideline', [...SM.sources], 'Then adjust as needed (clinician-approved).', 'midazolam');
  add('palliative_sedation', 'light/deep ↔ RASS mapping', SM.depthMapping, '', 'simulator_convention', ['S120'], 'The framework does not use RASS; mapping chosen for the simulator.', 'midazolam');
  add('palliative_sedation', 'continuous deep sedation prognosis requirement', 'hours_days', 'prognosis category', 'guideline', ['S100', 'S117', 'S102'], '2009 EAPC: closeness to death relevant for continuous deep sedation; ASCO 2021: life expectancy of days; AMA 5.6: final stages. The 2024 revision specifies no period — the simulator keeps the conservative requirement.');
  add('palliative_model', 'delirium-risk factors (age ≥70, eGFR <30, ≥5 medicines, last hours–days, high opioid effect)', '≥3 high, ≥1 moderate', 'count', 'author_estimate_unvalidated', ['S119'], 'Illustrative count; not a validated tool.');
  for (const [k, v] of Object.entries(MODEL)) add('palliative_model', k, typeof v === 'object' ? JSON.stringify(v) : v, '', 'author_estimate_unvalidated', [], 'Illustrative symptom / PK-PD model constant (not validated).');
  return out;
}

export const PALLIATIVE_SOURCE_COUNT = Object.keys(PALLIATIVE_SOURCES).length;
