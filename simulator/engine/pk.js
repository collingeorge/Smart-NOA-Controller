// Pharmacokinetic models (illustrative unless stated). Pure; no DOM.
//
// 1) MARSH propofol (pkModel:'marsh'). Parameters as widely reproduced from
//    Marsh B, White M, Morton N, Kenny GNC. Pharmacokinetic model driven infusion
//    of propofol in children. Br J Anaesth 1991;67:41-48 (adult form as used in the
//    Diprifusor TCI system): V1 = 0.228 L/kg (total body weight), k10 = 0.119,
//    k12 = 0.112, k13 = 0.0419, k21 = 0.055, k31 = 0.0033 min^-1. The effect-site
//    constant ke0 = 0.26 min^-1 is the Diprifusor implementation value and is NOT
//    from the 1991 paper. UNCERTAINTY: these values were transcribed from the
//    secondary literature from memory by the engine author and could not be
//    re-checked against the original paper in this build; treat outputs as
//    illustrative and verify before citing. The model is used only if the drug
//    library marks propofol pkModel:'marsh'.
//
// 1b) ELEVELD propofol (pkModel:'eleveld'). PUBLISHED population PK model:
//    Eleveld DJ, Colin P, Absalom AR, Struys MMRF. Pharmacokinetic-pharmacodynamic model
//    for propofol for broad application in anaesthesia and sedation. Br J Anaesth
//    2018;120(5):942-959 (Corrigendum Br J Anaesth 2018;121:519). Library source id: see
//    data/drugs.js propofol.pkModelInfo / SOURCES.md "Propofol PK model".
//    Fixed effects (Table 2 Θ1–Θ18) and effect-site constant (Table 3 Θ2 arterial, Θ8 venous)
//    in ELEVELD_2018 below; equations in eleveldPropofol(). Parameter values and equations
//    were taken from, and agree to the printed precision across, four independent open-source
//    implementations/readings: CRAN package `tci` 0.2.1 (R/poppk_mods.R, R. Jarrett),
//    PyPI `python-anesthesia-simulator` 1.0.0 (pk_models.py, B. Aubouin-Pairault),
//    vitaldb/tivatci (tivatci/__init__.py) and the stanpumpR paper digest of PMID 29661412
//    (StevenLShafer/stanpumpR papers/digests/PMID_29661412.md, which quotes Table 2/3 values
//    with CIs and page numbers). PD/ke0 values were also seen in a web-search record of the
//    BJA table. The primary PDF could not be opened from this build environment.
//    Simulator choices (NOT part of the published model): arterial-sampling form; the
//    concomitant-drug switch is set once, when the propofol model is created (true if an
//    opioid or IV local anaesthetic is in the plan or already given); the Eleveld BIS
//    PD model is NOT used — the depth index stays the illustrative PD in pd.js, driven by
//    Ce normalised to the peak Ce of a 2 mg/kg bolus in the Eleveld reference individual.
//
// 2) CALIBRATED (pkModel:'calibrated'): an ILLUSTRATIVE 2-compartment model with
//    an effect site. Constants are FITTED, not published: for a unit IV bolus the
//    closed-form effect-site curve Ce(t) is computed and (ke0, k10+k12, k10/(k10+k12))
//    are chosen (coarse log-grid search, then coordinate refinement) to minimise
//    the squared log-error between the model and drug.timing, where
//      onset    = first time Ce reaches 50 % of its peak,
//      peak     = time of peak Ce,
//      duration = last time Ce is still ≥ 50 % of its peak.
//    The peripheral volume is fixed at 5 × V1 (k21 = k12/5) and V1 = 0.25 L/kg TBW
//    (illustrative; concentrations are normalised before use so V1 cancels).
//    The 50 % threshold matches the PD convention (pd.js): a drug's normalised
//    concentration ("unitConc") is Ce divided by the peak Ce of its default
//    reference dose in a 70 kg reference adult, and the default EC50 is 0.5.
//    When drug.timing is null, GENERIC constants are used (illustrative only).
//
// 3) VOLATILE: first-order wash-in/out of the end-tidal fraction toward the dial
//    setting (tau 2.5 min while ventilated; illustrative), effect site lagging
//    end-tidal (ke0 0.3 min^-1; illustrative). Effect is expressed as a fraction of
//    age-adjusted MAC, Mapleson 1996: MAC(age) = MAC40 × 10^(−0.00269 × (age − 40)).

import { convertAmount, parseDoseUnit, rateToAmountPerMin, isFiniteNumber } from './units.js';

export const MARSH_1991 = Object.freeze({ v1PerKg: 0.228, k10: 0.119, k12: 0.112, k13: 0.0419, k21: 0.055, k31: 0.0033, ke0: 0.26 });
// (2026-11-05 cross-check: these Marsh constants agree with CRAN `tci` 0.2.1 pkmod_marsh and
// python-anesthesia-simulator 'Marsh_initial' (k13 given there as 0.042); both implementations,
// not the 1991 paper, so Marsh stays 'transcription unverified'. ke0 0.26 = 'Marsh_initial';
// tci and 'Marsh_modified' use 1.2.)

// Eleveld 2018 propofol fixed effects. THETA[i] = Table 2 Θi (PK); PD[i] = Table 3 Θi.
// Units: Θ1–Θ3 L; Θ4, Θ5, Θ6, Θ15 L/min; Θ8 weeks PMA; Θ10, Θ11, Θ13 1/yr; Θ12 kg; Θ14 weeks.
export const ELEVELD_2018 = Object.freeze({
  THETA: Object.freeze([null, 6.28, 25.5, 273, 1.79, 1.75, 1.11, 0.191, 42.3, 9.06, -0.0156, -0.00286, 33.6, -0.0138, 68.3, 2.10, 1.30, 1.42, 0.68]),
  PD: Object.freeze({ ce50: 3.08, ke0Arterial: 0.146, bis0: 93.0, gammaAbove: 1.47, ce50Age: -0.00635, ke0Venous: 1.24, gammaBelow: 1.89 }),
  REF: Object.freeze({ ageYears: 35, weightKg: 70, heightCm: 170, sex: 'male' }),
});

/** Al-Sallami 2015 fat-free mass as used in Eleveld 2018 (BMI in kg/m², age in years). */
export function alSallamiFfm(sex, weightKg, heightCm, ageYears) {
  const bmi = weightKg / Math.pow(heightCm / 100, 2);
  if (sex === 'female') return (1.11 + (1 - 1.11) / (1 + Math.pow(ageYears / 7.1, -1.1))) * (9270 * weightKg) / (8780 + 244 * bmi);
  return (0.88 + (1 - 0.88) / (1 + Math.pow(ageYears / 13.4, -12.7))) * (9270 * weightKg) / (6680 + 216 * bmi);
}

/**
 * Eleveld 2018 propofol PK (arterial by default) for one individual.
 * cov: { ageYears, weightKg, heightCm, sex:'male'|'female', opioids:boolean, venous?:boolean }
 * PMA (weeks) = age·52 + 40 (paper's assumption when PMA is not recorded).
 * Returns volumes (L), clearances (L/min), ke0 (1/min) and micro-constants (1/min).
 */
export function eleveldPropofol(cov) {
  const T = ELEVELD_2018.THETA, R = ELEVELD_2018.REF;
  const { ageYears: age, weightKg: wgt, heightCm: hgt, sex } = cov;
  for (const [k, v] of Object.entries({ age, wgt, hgt })) if (!isFiniteNumber(v) || v <= 0) throw new Error(`Eleveld covariate ${k} must be positive`);
  const sig = (x, e50, g) => Math.pow(x, g) / (Math.pow(x, g) + Math.pow(e50, g));
  const faging = (x) => Math.exp(x * (age - R.ageYears));
  const fcentral = (x) => sig(x, T[12], 1);
  const pma = age * 52 + 40, pmaRef = R.ageYears * 52 + 40;
  const fCLmat = sig(pma, T[8], T[9]) / sig(pmaRef, T[8], T[9]);
  const fQ3mat = sig(age * 52 + 40, T[14], 1), fQ3matRef = sig(R.ageYears * 52 + 40, T[14], 1);
  const fop = (x) => (cov.opioids ? Math.exp(x * age) : 1);
  const ffm = alSallamiFfm(sex, wgt, hgt, age), ffmRef = alSallamiFfm('male', R.weightKg, R.heightCm, R.ageYears);
  let v1 = T[1] * fcentral(wgt) / fcentral(R.weightKg);
  if (cov.venous) v1 *= 1 + T[17] * (1 - fcentral(wgt));
  const v2 = T[2] * (wgt / R.weightKg) * faging(T[10]);
  const v3 = T[3] * (ffm / ffmRef) * fop(T[13]);
  const cl = (sex === 'female' ? T[15] : T[4]) * Math.pow(wgt / R.weightKg, 0.75) * fCLmat * fop(T[11]);
  let q2 = T[5] * Math.pow(v2 / T[2], 0.75) * (1 + T[16] * (1 - fQ3mat));
  if (cov.venous) q2 *= T[18];
  const q3 = T[6] * Math.pow(v3 / T[3], 0.75) * (fQ3mat / fQ3matRef);
  const ke0 = (cov.venous ? ELEVELD_2018.PD.ke0Venous : ELEVELD_2018.PD.ke0Arterial) * Math.pow(wgt / 70, -0.25);
  return { v1, v2, v3, cl, q2, q3, ke0, ffm, k10: cl / v1, k12: q2 / v1, k21: q2 / v2, k13: q3 / v1, k31: q3 / v3, opioids: !!cov.opioids, venous: !!cov.venous };
}

// ILLUSTRATIVE (author-estimate) PK constants for drugs whose label timing is not stated but
// whose qualitative kinetics matter for teaching (min^-1). NOT published, NOT fitted.
//   epinephrine: short plasma half-life (k10 0.3 → t½ ≈ 2.3 min) so infusion effects fade within
//   minutes of stopping; fast effect-site equilibration (ke0 1.0).
//   sugammadex: slow elimination (k10 0.006 → t½ ≈ 2 h) so free drug persists on the time scale
//   of emergence and the 1:1 molar binding in sim.js decides whether the dose is sufficient
//   (added 2026-11 audit; the generic constants eliminated free sugammadex in ≈ 7 min).
export const ILLUSTRATIVE_PK = Object.freeze({
  epinephrine: Object.freeze({ k10: 0.3, k12: 0.05, k21: 0.01, ke0: 1.0, illustrative: true }),
  sugammadex: Object.freeze({ k10: 0.006, k12: 0.02, k21: 0.02, ke0: 0.3, illustrative: true }),
});
// ILLUSTRATIVE first-order absorption rate constants (min^-1) for non-IV bolus routes
// (author estimates; not from labels): IM epinephrine ka 0.15 (absorption t½ ≈ 4.6 min).
export const ROUTE_KA_ILLUSTRATIVE = Object.freeze({ IM: 0.15, SC: 0.07 });
// ILLUSTRATIVE (2026-11 audit): IM/SC absorption slows when tissue perfusion is poor. The
// absorption rate is multiplied by a factor that falls linearly from 1 (MAP ≥ MAP_FRAC_FULL × the
// patient's baseline MAP) to KA_FACTOR_MIN (MAP ≤ MAP_FRAC_MIN × baseline). Author estimates.
export const ROUTE_PERFUSION_ILLUSTRATIVE = Object.freeze({ MAP_FRAC_FULL: 0.8, MAP_FRAC_MIN: 0.4, KA_FACTOR_MIN: 0.3 });
export function perfusionKaFactor(mapFrac) {
  const P = ROUTE_PERFUSION_ILLUSTRATIVE;
  if (!Number.isFinite(mapFrac)) return 1;
  if (mapFrac >= P.MAP_FRAC_FULL) return 1;
  if (mapFrac <= P.MAP_FRAC_MIN) return P.KA_FACTOR_MIN;
  return P.KA_FACTOR_MIN + (1 - P.KA_FACTOR_MIN) * (mapFrac - P.MAP_FRAC_MIN) / (P.MAP_FRAC_FULL - P.MAP_FRAC_MIN);
}
export const GENERIC_ILLUSTRATIVE = Object.freeze({ k10: 0.1, k12: 0.1, k21: 0.02, ke0: 0.3, illustrative: true });
export const CALIBRATED_V1_PER_KG = 0.25;
export const PERIPHERAL_RATIO = 5;
export const VOLATILE_DEFAULTS = Object.freeze({ tauMin: 2.5, ke0: 0.3 });
// ILLUSTRATIVE wash-in/out time constants (min) of end-tidal toward the dial, ordered by
// blood/gas solubility (desflurane fastest; sevoflurane and N2O intermediate; isoflurane
// slowest). Engine assumptions, not fitted to data.
export const VOLATILE_TAU_MIN = Object.freeze({ desflurane: 1.5, nitrous_oxide: 2.0, n2o: 2.0, sevoflurane: 2.5, isoflurane: 4.0 });
export const isNitrous = (drug) => /nitrous|n2o/i.test(drug.id);
export const isInhaled = (drug) => drug.cls === 'volatile' || drug.amountUnit === '%' || Object.values(drug.regimens || {}).some((r) => r && r.kind === 'inhaled');
export const REFERENCE_WEIGHT_KG = 70;

export function macForAge(mac40, ageYears) {
  return mac40 * Math.pow(10, -0.00269 * (ageYears - 40));
}

// ---------------------------------------------------------------------------
export class CompartmentModel {
  constructor({ v1L, k10, k12 = 0, k21 = 0, k13 = 0, k31 = 0, ke0 }) {
    for (const [n, v] of Object.entries({ v1L, k10, k12, k21, k13, k31, ke0 })) {
      if (!isFiniteNumber(v) || v < 0 || (n === 'v1L' && v <= 0)) throw new Error(`PK parameter ${n} must be finite and ${n === 'v1L' ? 'positive' : 'non-negative'}`);
    }
    Object.assign(this, { v1L, k10, k12, k21, k13, k31, ke0 });
    this.a1 = 0; this.a2 = 0; this.a3 = 0; this.ce = 0;
    this.infusionPerMin = 0; this.totalIn = 0; this.eliminated = 0; this.bound = 0;
  }
  get cp() { return this.a1 / this.v1L; }
  bolus(amount) {
    if (!isFiniteNumber(amount) || amount < 0) throw new Error('Bolus amount must be finite and non-negative');
    this.a1 += amount; this.totalIn += amount;
  }
  setInfusion(amountPerMin) {
    if (!isFiniteNumber(amountPerMin) || amountPerMin < 0) throw new Error('Infusion rate must be finite and non-negative');
    this.infusionPerMin = amountPerMin;
  }
  /** Remove up to `amount` from the central compartment (e.g. sugammadex encapsulation). */
  removeCentral(amount) {
    const r = Math.max(0, Math.min(this.a1, amount));
    this.a1 -= r; this.bound += r; return r;
  }
  step(dtMin, { ke0Mult = 1, k10Mult = 1 } = {}) {
    if (!isFiniteNumber(dtMin) || dtMin <= 0) throw new Error('Time step must be finite and positive');
    const k10 = this.k10 * k10Mult, ke0 = this.ke0 * ke0Mult;
    const kmax = Math.max(k10 + this.k12 + this.k13, this.k21, this.k31, ke0, 1e-9);
    const n = Math.max(1, Math.ceil((dtMin * kmax) / 0.02));
    const h = dtMin / n;
    for (let i = 0; i < n; i++) {
      const inf = this.infusionPerMin * h;
      const el = k10 * this.a1 * h, f12 = this.k12 * this.a1 * h, f21 = this.k21 * this.a2 * h;
      const f13 = this.k13 * this.a1 * h, f31 = this.k31 * this.a3 * h;
      this.a1 = Math.max(0, this.a1 + inf - el - f12 + f21 - f13 + f31);
      this.a2 = Math.max(0, this.a2 + f12 - f21);
      this.a3 = Math.max(0, this.a3 + f13 - f31);
      this.totalIn += inf; this.eliminated += el;
      this.ce = Math.max(0, this.ce + (this.cp - this.ce) * (1 - Math.exp(-ke0 * h)));
    }
  }
  /** amount in body + eliminated + bound − administered (≈ 0). */
  massBalanceError() { return this.a1 + this.a2 + this.a3 + this.eliminated + this.bound - this.totalIn; }
}

export class VolatileModel {
  constructor({ macAge, tauMin = VOLATILE_DEFAULTS.tauMin, ke0 = VOLATILE_DEFAULTS.ke0 }) {
    this.macAge = macAge; this.tauMin = tauMin; this.ke0 = ke0;
    this.dial = 0; this.et = 0; this.ce = 0; this.dialPctMin = 0;
  }
  get cp() { return this.et; }
  setDial(pct) { if (!isFiniteNumber(pct) || pct < 0) throw new Error('Dial must be finite and non-negative'); this.dial = pct; }
  step(dtMin, ventFraction = 1) {
    const v = Math.max(0, Math.min(1, ventFraction));
    this.et += (this.dial - this.et) * (1 - Math.exp((-dtMin * v) / this.tauMin));
    this.ce += (this.et - this.ce) * (1 - Math.exp(-this.ke0 * dtMin));
    this.et = Math.max(0, this.et); this.ce = Math.max(0, this.ce);
    this.dialPctMin += this.dial * dtMin;
  }
  get macFraction() { return this.macAge > 0 ? this.ce / this.macAge : 0; }
}

// ---------------------------------------------------------------------------
// Calibration of the illustrative 2-compartment model from drug.timing

function midpoint(v) {
  if (isFiniteNumber(v)) return v;
  if (Array.isArray(v) && v.length && v.every(isFiniteNumber)) return (v[0] + v[v.length - 1]) / 2;
  if (v && typeof v === 'object' && isFiniteNumber(v.min) && isFiniteNumber(v.max)) return (v.min + v.max) / 2;
  if (v && typeof v === 'object' && isFiniteNumber(v.value)) return v.value;
  if (typeof v === 'string') { const m = v.match(/\d+(?:\.\d+)?/g); if (m) return m.map(Number).reduce((a, b) => a + b, 0) / m.length; }
  return null;
}

// ILLUSTRATIVE completions for timing metrics the label does not state (engine
// author's assumptions, NOT sourced; used only to shape the illustrative curve).
// Applied only when drug.timing gives at least one metric but not all three.
export const ILLUSTRATIVE_TIMING_FILL = Object.freeze({
  propofol: { peak: 1.5, duration: 7 },
  etomidate: { peak: 1.5 },
  ketamine: { peak: 1 },
  midazolam: { peak: 8, duration: 45 },
  fentanyl: { onset: 1.5, peak: 4 },
  rocuronium: { onset: 1.5 },
  succinylcholine: {},
  neostigmine: { onset: 4, duration: 60 },
  naloxone: { peak: 5, duration: 45 },
});

export function timingTargets(timing, drugId = null) {
  if (!timing) return null;
  const t = { onset: midpoint(timing.onsetMin), peak: midpoint(timing.peakMin), duration: midpoint(timing.durationMin) };
  for (const k of Object.keys(t)) if (!(t[k] > 0)) t[k] = null;
  if (!t.onset && !t.peak && !t.duration) return null;
  const fill = (drugId && ILLUSTRATIVE_TIMING_FILL[drugId]) || {};
  const filled = [];
  for (const k of Object.keys(t)) if (!t[k] && fill[k]) { t[k] = fill[k]; filled.push(k); }
  t.filled = filled;
  return t;
}

/** Closed-form effect-site concentration for a unit bolus into V1 = 1. */
export function unitBolusCe(p) {
  const { k10, k12, k21, ke0 } = p;
  let lambdas, coefs;
  if (k12 <= 0) { lambdas = [k10]; coefs = [1]; } else {
    const s = k10 + k12 + k21; const disc = Math.sqrt(Math.max(0, s * s - 4 * k10 * k21));
    const a = (s + disc) / 2, b = (s - disc) / 2;
    lambdas = [a, b]; coefs = [(a - k21) / (a - b), (k21 - b) / (a - b)];
  }
  return (t) => {
    let ce = 0;
    for (let i = 0; i < lambdas.length; i++) {
      const l = lambdas[i];
      const term = Math.abs(ke0 - l) < 1e-7 ? t * Math.exp(-l * t) : (Math.exp(-l * t) - Math.exp(-ke0 * t)) / (ke0 - l);
      ce += coefs[i] * term;
    }
    return ke0 * ce;
  };
}

export function curveMetrics(p, horizonMin) {
  const f = unitBolusCe(p);
  const N = 320, t0 = 0.005;
  const ratio = Math.pow(horizonMin / t0, 1 / (N - 1));
  const ts = new Array(N), cs = new Array(N);
  let peakI = 0;
  for (let i = 0; i < N; i++) { ts[i] = t0 * Math.pow(ratio, i); cs[i] = f(ts[i]); if (cs[i] > cs[peakI]) peakI = i; }
  const peakValue = cs[peakI], thr = 0.5 * peakValue;
  let onset = ts[0];
  for (let i = 1; i <= peakI; i++) if (cs[i] >= thr) { onset = ts[i - 1] + (ts[i] - ts[i - 1]) * (thr - cs[i - 1]) / (cs[i] - cs[i - 1] || 1); break; }
  let duration = horizonMin;
  for (let i = peakI + 1; i < N; i++) if (cs[i] < thr) { duration = ts[i - 1] + (ts[i] - ts[i - 1]) * (cs[i - 1] - thr) / (cs[i - 1] - cs[i] || 1); break; }
  return { onset, peak: ts[peakI], duration, peakValue };
}

function paramsFrom(ke0, kfast, frac) {
  const k10 = kfast * frac, k12 = kfast * (1 - frac);
  return { k10, k12, k21: k12 / PERIPHERAL_RATIO, ke0 };
}

// Regularisation: elimination must be ≥ 25 % of the initial central rate constant
// (k10 ≥ 0.25·(k10+k12)), which prevents fits in which redistribution alone explains the
// label duration and the drug then lingers for hours (illustrative choice).
export const MIN_ELIM_FRACTION = 0.25;
const FIT_CACHE = new Map();

/** Fit (k10, k12, k21, ke0) to drug.timing. Returns params + achieved metrics + provenance. */
export function fitCalibrated(timing, drugId = null) {
  const tg = timingTargets(timing, drugId);
  if (!tg && drugId && ILLUSTRATIVE_PK[drugId]) {
    const P = ILLUSTRATIVE_PK[drugId];
    return { ...P, metrics: curveMetrics(P, 600), targets: null, provenance: `illustrative author-estimate constants for ${drugId} (label timing not stated; not fitted, not published)` };
  }
  if (!tg) {
    const m = curveMetrics(GENERIC_ILLUSTRATIVE, 600);
    return { ...GENERIC_ILLUSTRATIVE, metrics: m, targets: null, provenance: 'generic illustrative constants (drug.timing missing)' };
  }
  const key = JSON.stringify([tg.onset, tg.peak, tg.duration]);
  if (FIT_CACHE.has(key)) return FIT_CACHE.get(key);
  const scale = Math.max(tg.duration || 0, (tg.peak || 0) * 4, (tg.onset || 0) * 8, 1);
  const horizon = scale * 6;
  const cost = (p) => {
    const m = curveMetrics(p, horizon);
    let c = 0;
    for (const k of ['onset', 'peak', 'duration']) if (tg[k]) c += Math.pow(Math.log(m[k] / tg[k]), 2);
    return c;
  };
  const logspace = (a, b, n) => Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1)));
  let best = null;
  for (const ke0 of logspace(0.02, 12, 16)) for (const kf of logspace(0.002, 6, 16)) for (const fr of [1, 0.75, 0.55, 0.4, 0.3, 0.25]) {
    const p = paramsFrom(ke0, kf, fr); const c = cost(p);
    if (!best || c < best.c) best = { c, x: [ke0, kf, fr] };
  }
  // coordinate refinement in log space
  let step = 1.4;
  for (let it = 0; it < 60 && step > 1.005; it++) {
    let improved = false;
    for (let d = 0; d < 3; d++) for (const dir of [step, 1 / step]) {
      const x = best.x.slice(); x[d] *= dir; if (d === 2) x[2] = Math.min(1, Math.max(MIN_ELIM_FRACTION, x[2]));
      const c = cost(paramsFrom(...x));
      if (c < best.c - 1e-12) { best = { c, x }; improved = true; }
    }
    if (!improved) step = Math.sqrt(step);
  }
  const p = paramsFrom(...best.x);
  const out = { ...p, metrics: curveMetrics(p, horizon), targets: tg, cost: best.c, provenance: 'illustrative 2-compartment model fitted to drug.timing' + (tg.filled.length ? ` (missing ${tg.filled.join(', ')} filled with illustrative assumptions)` : '') };
  FIT_CACHE.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Reference concentration used to normalise Ce ("unitConc").

const REF_ORDER = ['induction', 'sedation_moderate', 'sedation_deep', 'sedation_minimal', 'premed', 'emergence', 'rescue', 'maintenance'];

function regimenDefaultAmount(drug, reg, weightKg) {
  if (reg.fixed && isFiniteNumber(reg.fixed.default)) return convertAmount(reg.fixed.default, reg.fixed.unit || drug.amountUnit, drug.amountUnit);
  if (reg.perKg && isFiniteNumber(reg.perKg.default)) {
    const du = parseDoseUnit(reg.unit || `${drug.amountUnit}/kg`);
    return convertAmount(reg.perKg.default * weightKg, du ? du.amount : drug.amountUnit, drug.amountUnit);
  }
  return null;
}

/** Pick the regimen that defines the reference dose: first bolus in `prefs`/REF_ORDER, else infusion. */
export function referenceRegimen(drug, prefs = []) {
  const regs = drug.regimens || {};
  // A library may name the regimen that defines the normalisation reference (e.g. epinephrine:
  // the IV infusion, because its only bolus is intramuscular).
  const pr = drug.pkReferenceRegimen && regs[drug.pkReferenceRegimen];
  if (pr && pr.kind === 'bolus' && (pr.fixed || pr.perKg)) return { key: drug.pkReferenceRegimen, reg: pr, mode: 'bolus' };
  if (pr && pr.kind === 'infusion' && pr.rate && isFiniteNumber(pr.rate.default)) return { key: drug.pkReferenceRegimen, reg: pr, mode: 'infusion' };
  const order = [...prefs, ...REF_ORDER, ...Object.keys(regs)];
  for (const k of order) { const r = regs[k]; if (r && r.kind === 'bolus' && (r.fixed || r.perKg)) return { key: k, reg: r, mode: 'bolus' }; }
  for (const k of order) { const r = regs[k]; if (r && r.kind === 'infusion' && r.rate && isFiniteNumber(r.rate.default)) return { key: k, reg: r, mode: 'infusion' }; }
  return null;
}

function buildCompartment(drug, weightKg, opts = {}) {
  if (drug.pkModel === 'eleveld') {
    const cov = opts.covariates || { ...ELEVELD_2018.REF, weightKg: ELEVELD_2018.REF.weightKg, opioids: false };
    const e = eleveldPropofol(cov);
    return { type: 'eleveld', params: { ...e, covariates: { ...cov } }, model: new CompartmentModel({ v1L: e.v1, k10: e.k10, k12: e.k12, k21: e.k21, k13: e.k13, k31: e.k31, ke0: e.ke0 }), provenance: `Eleveld 2018 published population PK (arterial; concomitant opioid/local anaesthetic switch ${e.opioids ? 'ON' : 'OFF'}); ke0 Eleveld Table 3 arterial. Implementation verification only (reproduces published reference values); not validation of the simulator.` };
  }
  if (drug.pkModel === 'marsh') {
    const m = MARSH_1991;
    return { type: 'marsh', params: m, model: new CompartmentModel({ v1L: m.v1PerKg * weightKg, k10: m.k10, k12: m.k12, k21: m.k21, k13: m.k13, k31: m.k31, ke0: m.ke0 }), provenance: 'Marsh 1991 (as reproduced for Diprifusor; ke0 0.26 is the Diprifusor value; transcription unverified)' };
  }
  const fit = opts.fit || fitCalibrated(drug.timing, drug.id);
  return { type: 'calibrated', params: fit, model: new CompartmentModel({ v1L: CALIBRATED_V1_PER_KG * weightKg, k10: fit.k10, k12: fit.k12, k21: fit.k21, ke0: fit.ke0 }), provenance: fit.provenance };
}

const REF_CACHE = new WeakMap();
/** Reference Ce (drug amountUnit per L) for the 70 kg reference adult. */
export function referenceConcentration(drug, prefs = []) {
  let c = REF_CACHE.get(drug);
  if (c && c.prefsKey === prefs.join(',')) return c;
  const rr = referenceRegimen(drug, prefs);
  let value = null, basis = 'none';
  if (rr) {
    const b = buildCompartment(drug, REFERENCE_WEIGHT_KG);
    if (rr.mode === 'bolus') {
      const amt = regimenDefaultAmount(drug, rr.reg, REFERENCE_WEIGHT_KG);
      if (amt > 0) {
        if (b.type === 'calibrated') value = (amt / b.model.v1L) * b.params.metrics.peakValue;
        // 'marsh' / 'eleveld': numerical peak (Eleveld: reference individual, no concomitant drugs)
        else { b.model.bolus(amt); let peak = 0; for (let i = 0; i < 40 * 60; i++) { b.model.step(1 / 60); peak = Math.max(peak, b.model.ce); } value = peak; }
        basis = `peak Ce after default ${rr.key} bolus (70 kg reference)`;
      }
    } else {
      try {
        const perMin = rateToAmountPerMin(rr.reg.rate.default, rr.reg.rate.unit, drug.amountUnit, REFERENCE_WEIGHT_KG);
        value = perMin / (b.model.k10 * b.model.v1L);
        basis = `steady-state Ce at default ${rr.key} rate (70 kg reference)`;
      } catch { value = null; }
    }
  }
  c = { value: value > 0 ? value : null, basis, regimenKey: rr ? rr.key : null, prefsKey: prefs.join(',') };
  REF_CACHE.set(drug, c);
  return c;
}

/**
 * Create a PK model instance for a drug in a patient.
 * opts: { k10Mult } (patient modifiers), { mac40 } for volatiles, { refPrefs }.
 */
export function createPkModel(drug, patient, opts = {}) {
  if (isInhaled(drug)) {
    const mac40 = isFiniteNumber(drug.mac40) ? drug.mac40 : (drug.mac && isFiniteNumber(drug.mac.mac40Pct) ? drug.mac.mac40Pct : drug.mac && isFiniteNumber(drug.mac.mac40) ? drug.mac.mac40 : (drug.mac && isFiniteNumber(drug.mac.age40) ? drug.mac.age40 : (isFiniteNumber(opts.mac40) ? opts.mac40 : null)));
    if (mac40 === null && drug.id !== 'sevoflurane') throw new Error(`Inhaled agent '${drug.id}' has no MAC40 in the drug library`);
    const used = mac40 ?? FALLBACK_SEVO_MAC40;
    return {
      type: 'volatile', model: new VolatileModel({ macAge: macForAge(used, patient.ageYears), tauMin: VOLATILE_TAU_MIN[drug.id] ?? VOLATILE_DEFAULTS.tauMin, ke0: (VOLATILE_DEFAULTS.tauMin / (VOLATILE_TAU_MIN[drug.id] ?? VOLATILE_DEFAULTS.tauMin)) * VOLATILE_DEFAULTS.ke0 }),
      mac40: used, macAgeAdjusted: macForAge(used, patient.ageYears),
      provenance: mac40 !== null ? 'MAC40 from drug library; Mapleson 1996 age adjustment; wash-in/out illustrative' : 'MAC40 FALLBACK (see FALLBACK_SEVO_MAC40; unverified); Mapleson 1996 age adjustment; wash-in/out illustrative',
      ref: { value: null, basis: 'fraction of age-adjusted MAC' },
    };
  }
  // Calibrated models scale V1 on the weight scalar the drug is dosed on (opts.volumeWeightKg),
  // so a sourced per-kg dose gives comparable normalised exposure; Marsh uses TBW as published;
  // Eleveld uses the patient's own covariates (age, TBW, height, sex, concomitant opioid).
  const covariates = drug.pkModel === 'eleveld' ? { ageYears: patient.ageYears, weightKg: patient.weightKg, heightCm: patient.heightCm, sex: patient.sex === 'female' ? 'female' : 'male', opioids: !!opts.concomitantOpioid } : null;
  const b = buildCompartment(drug, (drug.pkModel === 'marsh' || drug.pkModel === 'eleveld') ? patient.weightKg : (opts.volumeWeightKg || patient.weightKg), { covariates });
  if (opts.k10Mult && opts.k10Mult !== 1) b.model.k10 *= opts.k10Mult;
  return { ...b, ref: referenceConcentration(drug, opts.refPrefs || []) };
}

// Used ONLY if the drug library supplies no MAC40 for a volatile agent. Engine
// author's recollection of the sevoflurane age-40 MAC in Mapleson 1996 (BJA
// 76:179-185); NOT verified in this build. Treat any output using it as illustrative.
export const FALLBACK_SEVO_MAC40 = 1.8;
