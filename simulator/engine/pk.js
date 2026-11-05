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

const FIT_CACHE = new Map();

/** Fit (k10, k12, k21, ke0) to drug.timing. Returns params + achieved metrics + provenance. */
export function fitCalibrated(timing, drugId = null) {
  const tg = timingTargets(timing, drugId);
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
  for (const ke0 of logspace(0.02, 12, 16)) for (const kf of logspace(0.002, 6, 16)) for (const fr of [1, 0.6, 0.35, 0.2, 0.1, 0.05]) {
    const p = paramsFrom(ke0, kf, fr); const c = cost(p);
    if (!best || c < best.c) best = { c, x: [ke0, kf, fr] };
  }
  // coordinate refinement in log space
  let step = 1.4;
  for (let it = 0; it < 60 && step > 1.005; it++) {
    let improved = false;
    for (let d = 0; d < 3; d++) for (const dir of [step, 1 / step]) {
      const x = best.x.slice(); x[d] *= dir; if (d === 2) x[2] = Math.min(1, Math.max(0.01, x[2]));
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
  const order = [...prefs, ...REF_ORDER, ...Object.keys(regs)];
  for (const k of order) { const r = regs[k]; if (r && r.kind === 'bolus' && (r.fixed || r.perKg)) return { key: k, reg: r, mode: 'bolus' }; }
  for (const k of order) { const r = regs[k]; if (r && r.kind === 'infusion' && r.rate && isFiniteNumber(r.rate.default)) return { key: k, reg: r, mode: 'infusion' }; }
  return null;
}

function buildCompartment(drug, weightKg, opts = {}) {
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
  const b = buildCompartment(drug, patient.weightKg);
  if (opts.k10Mult && opts.k10Mult !== 1) b.model.k10 *= opts.k10Mult;
  return { ...b, ref: referenceConcentration(drug, opts.refPrefs || []) };
}

// Used ONLY if the drug library supplies no MAC40 for a volatile agent. Engine
// author's recollection of the sevoflurane age-40 MAC in Mapleson 1996 (BJA
// 76:179-185); NOT verified in this build. Treat any output using it as illustrative.
export const FALLBACK_SEVO_MAC40 = 1.8;
