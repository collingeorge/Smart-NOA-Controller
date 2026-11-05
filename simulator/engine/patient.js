// Patient derivations (SPEC §3). Pure; no DOM. Fictional patients only.
//
// Formulas (cited in SOURCES.md by the drug-library worker):
//  - MAP = DBP + (SBP − DBP)/3.
//  - BMI = kg / m².
//  - IBW, Devine 1974: male 50 kg, female 45.5 kg, + 2.3 kg per inch over 60 in.
//  - LBW, Janmahasatian et al. Clin Pharmacokinet 2005;44:1051-65:
//      male 9270·TBW/(6680 + 216·BMI); female 9270·TBW/(8780 + 244·BMI).
//  - Adjusted BW = IBW + 0.4 × (TBW − IBW).
//  - Apfel simplified score (Apfel et al. Anesthesiology 1999;91:693-700):
//      female, non-smoker, PONV/motion-sickness history, postoperative opioids;
//      risk 10/21/39/61/79 % for 0–4 factors.
//  - STOP-Bang (Chung et al. Anesthesiology 2008;108:812-21): 0–2 low, 3–4
//      intermediate, 5–8 high; intermediate re-classified high when STOP ≥2 plus
//      male sex, BMI >35 or neck >40 cm (Chung et al. Br J Anaesth 2012;108:768-75).

import { resolveLibrary } from './library.js';

export const LIMITS = {
  ageYears: [18, 90], heightCm: [140, 210], weightKg: [35, 250], asa: [1, 5], egfr: [5, 150],
  hr: [40, 140], sbp: [80, 220], dbp: [40, 130], spo2: [85, 100], rr: [8, 30], mallampati: [1, 4], neckCm: [20, 70],
};

export const APFEL_RISK_PERCENT = [10, 21, 39, 61, 79];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isBool = (v) => typeof v === 'boolean';

export class PatientValidationError extends Error {
  constructor(errors) {
    super('Invalid patient: ' + errors.map((e) => `${e.field}: ${e.message}`).join('; '));
    this.name = 'PatientValidationError';
    this.errors = errors;
  }
}

/**
 * Validate a patient input object. Returns { ok, errors:[{field, message}] }.
 * If a library is supplied (or the default one is loadable) condition/allergy/
 * medication ids are checked against it.
 */
export function validatePatient(p, { library = null, checkIds = true } = {}) {
  const errors = [];
  const err = (field, message) => errors.push({ field, message });
  if (!p || typeof p !== 'object') { err('patient', 'must be an object'); return { ok: false, errors }; }
  const range = (field, v, [lo, hi], integer = false) => {
    if (!isNum(v)) err(field, `must be a finite number (got ${JSON.stringify(v)})`);
    else if (v < lo || v > hi) err(field, `must be between ${lo} and ${hi} (got ${v})`);
    else if (integer && !Number.isInteger(v)) err(field, `must be a whole number (got ${v})`);
  };
  if (p.sex !== 'male' && p.sex !== 'female') err('sex', "must be 'male' or 'female'");
  range('ageYears', p.ageYears, LIMITS.ageYears);
  range('heightCm', p.heightCm, LIMITS.heightCm);
  range('weightKg', p.weightKg, LIMITS.weightKg);
  range('asa', p.asa, LIMITS.asa, true);
  if (!isBool(p.emergency)) err('emergency', 'must be true or false');
  range('egfr', p.egfr, LIMITS.egfr);
  const b = p.baseline;
  if (!b || typeof b !== 'object') err('baseline', 'baseline vitals are required');
  else {
    for (const k of ['hr', 'sbp', 'dbp', 'spo2', 'rr']) range(`baseline.${k}`, b[k], LIMITS[k]);
    if (isNum(b.sbp) && isNum(b.dbp) && b.dbp >= b.sbp) err('baseline.dbp', 'diastolic pressure must be lower than systolic');
  }
  const a = p.airway;
  if (!a || typeof a !== 'object') err('airway', 'airway assessment is required');
  else {
    range('airway.mallampati', a.mallampati, LIMITS.mallampati, true);
    for (const k of ['difficultHistory', 'limitedMouthOpening', 'limitedNeck']) if (!isBool(a[k])) err(`airway.${k}`, 'must be true or false');
  }
  for (const k of ['ponvHistory', 'smoker', 'postopOpioidsExpected']) if (!isBool(p[k])) err(k, 'must be true or false');
  const sb = p.stopBang;
  if (!sb || typeof sb !== 'object') err('stopBang', 'STOP-Bang items are required');
  else {
    for (const k of ['snoring', 'tired', 'observedApnea', 'pressure']) if (!isBool(sb[k])) err(`stopBang.${k}`, 'must be true or false');
    if (sb.neckCm !== undefined && sb.neckCm !== null) range('stopBang.neckCm', sb.neckCm, LIMITS.neckCm);
  }
  if (p.neckCm !== undefined && p.neckCm !== null) range('neckCm', p.neckCm, LIMITS.neckCm);

  let lib = null;
  if (checkIds) { try { lib = resolveLibrary(library); } catch { lib = null; } }
  const lists = [['conditions', 'CONDITIONS'], ['allergies', 'ALLERGIES'], ['medications', 'MEDICATIONS']];
  for (const [field, key] of lists) {
    const v = p[field];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) { err(field, 'must be a list of id strings'); continue; }
    if (lib && Array.isArray(lib[key])) {
      const known = new Set(lib[key].map((x) => x.id));
      for (const id of v) if (!known.has(id)) err(field, `unknown id '${id}'`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function devineIbw(sex, heightCm) {
  const inches = heightCm / 2.54;
  return (sex === 'male' ? 50 : 45.5) + 2.3 * (inches - 60);
}

export function janmahasatianLbw(sex, weightKg, bmi) {
  return sex === 'male' ? (9270 * weightKg) / (6680 + 216 * bmi) : (9270 * weightKg) / (8780 + 244 * bmi);
}

export function apfel({ sex, smoker, ponvHistory, postopOpioidsExpected }) {
  const factors = { female: sex === 'female', nonSmoker: !smoker, ponvHistory: !!ponvHistory, postopOpioids: !!postopOpioidsExpected };
  const score = Object.values(factors).filter(Boolean).length;
  return { score, riskPercent: APFEL_RISK_PERCENT[score], factors };
}

export function stopBangScore({ snoring, tired, observedApnea, pressure, bmi, ageYears, neckCm, sex }) {
  const items = {
    snoring: !!snoring, tired: !!tired, observedApnea: !!observedApnea, pressure: !!pressure,
    bmiOver35: bmi > 35, ageOver50: ageYears > 50,
    neckOver40: isNum(neckCm) ? neckCm > 40 : false,
    male: sex === 'male',
  };
  const score = Object.values(items).filter(Boolean).length;
  const stop = [items.snoring, items.tired, items.observedApnea, items.pressure].filter(Boolean).length;
  let risk = score >= 5 ? 'high' : score >= 3 ? 'intermediate' : 'low';
  let escalated = false;
  if (risk === 'intermediate' && stop >= 2 && (items.male || items.bmiOver35 || items.neckOver40)) { risk = 'high'; escalated = true; }
  return { score, risk, stopScore: stop, items, escalated, neckMeasured: isNum(neckCm) };
}

const ASPIRATION_IDS = ['gerd', 'hiatal', 'gastroparesis', 'bowel_obstruction', 'full_stomach', 'achalasia'];

export function derivePatient(input, opts = {}) {
  // Re-deriving an already derived patient uses the original STOP-Bang items.
  const p = input && input.derived && input.stopBangInput ? { ...input, stopBang: input.stopBangInput } : input;
  const v = validatePatient(p, opts);
  if (!v.ok) throw new PatientValidationError(v.errors);
  const map = p.baseline.dbp + (p.baseline.sbp - p.baseline.dbp) / 3;
  const bmi = p.weightKg / Math.pow(p.heightCm / 100, 2);
  const ibwKg = devineIbw(p.sex, p.heightCm);
  const lbwKg = janmahasatianLbw(p.sex, p.weightKg, bmi);
  const abwKg = ibwKg + 0.4 * (p.weightKg - ibwKg);
  const ap = apfel(p);
  const neckCm = isNum(p.stopBang.neckCm) ? p.stopBang.neckCm : (isNum(p.neckCm) ? p.neckCm : undefined);
  const pressure = p.stopBang.pressure || p.conditions.includes('hypertension');
  const sb = stopBangScore({ ...p.stopBang, pressure, bmi, ageYears: p.ageYears, neckCm, sex: p.sex });

  const has = (id) => p.conditions.includes(id);
  const flags = [];
  if (p.ageYears >= 65) flags.push('elderly');
  if (bmi < 18.5) flags.push('underweight');
  if (bmi >= 30) flags.push('obese');
  if (bmi >= 40) flags.push('morbidObese');
  if (p.egfr < 60) flags.push('ckd');
  if (p.egfr < 30) flags.push('severeCkd');
  if (p.asa >= 3) flags.push('asa3plus');
  if (p.emergency || p.conditions.some((c) => ASPIRATION_IDS.some((a) => c.includes(a))) || p.medications.some((m) => m.includes('glp1'))) flags.push('aspirationRisk');
  const aw = p.airway;
  if (aw.mallampati >= 3 || aw.difficultHistory || aw.limitedMouthOpening || aw.limitedNeck) flags.push('difficultAirwayPredicted');
  if (sb.risk === 'high' || has('osa')) flags.push('osaRisk');
  if (ap.score >= 3) flags.push('highPonvRisk');
  if (has('mh_susceptible')) flags.push('mhSusceptible');
  if (p.medications.includes('beta_blocker')) flags.push('betaBlocker');

  return {
    ...p,
    map, bmi, ibwKg, lbwKg, abwKg,
    apfel: { score: ap.score, riskPercent: ap.riskPercent, factors: ap.factors },
    stopBangInput: p.stopBang,
    stopBang: { score: sb.score, risk: sb.risk, items: sb.items, escalated: sb.escalated, neckMeasured: sb.neckMeasured },
    flags,
    derived: true,
  };
}

/** Weight (kg) for a dosing scalar. IBW/ABW/LBW are capped at TBW (never dose above actual weight). */
export function scalarWeight(pd, scalar) {
  const tbw = pd.weightKg;
  const w = { TBW: tbw, IBW: pd.ibwKg, LBW: pd.lbwKg, ABW: pd.abwKg }[scalar || 'TBW'];
  if (!isNum(w)) return { weightKg: tbw, capped: false, scalar: 'TBW' };
  return { weightKg: Math.min(w, tbw), capped: w > tbw, scalar: scalar || 'TBW' };
}
