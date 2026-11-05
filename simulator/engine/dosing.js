// Contraindications and dose recommendations (SPEC §5). Pure; no DOM.
// Every number returned comes from the drug library (data/drugs.js); this
// module only selects a regimen/adjustment and multiplies by a weight scalar.

import { resolveLibrary, getDrug } from './library.js';
import { scalarWeight } from './patient.js';
import { convertAmount, parseDoseUnit, parseRateUnit, rateToAmountPerMin, roundSig, isFiniteNumber } from './units.js';

// ---------------------------------------------------------------------------
// `when` expressions
//   OR with '|', AND with '&' (or ','), NOT with leading '!'.
//   Atoms: condition:<id> allergy:<id> medication:<id> flag:<flag> sex:<male|female>
//          <field><op><number> for field in egfr|age|asa|bmi|weight (op: < <= > >= = == !=)
//          a bare word = a derived flag (e.g. 'elderly'), or 'emergency'.
//          runtime:<rule> or any atom mentioning 'tof' = runtime rule, evaluated by the
//          simulation (false at planning time).
// ---------------------------------------------------------------------------

const FIELD = { egfr: (p) => p.egfr, age: (p) => p.ageYears, ageyears: (p) => p.ageYears, asa: (p) => p.asa, bmi: (p) => p.bmi, weight: (p) => p.weightKg, weightkg: (p) => p.weightKg };
const OPS = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '=': (a, b) => a === b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };

export function isRuntimeAtom(atom) { return /^runtime:/i.test(atom) || /tof/i.test(atom); }

function evalAtom(atom, p, ctx, unknown) {
  const a = atom.trim();
  if (!a) return false;
  if (a.startsWith('!')) return !evalAtom(a.slice(1), p, ctx, unknown);
  if (isRuntimeAtom(a)) return ctx && typeof ctx.runtime === 'function' ? !!ctx.runtime(a) : false;
  const m = /^([a-z_]+)\s*(<=|>=|==|!=|<|>|=)\s*(-?\d+(?:\.\d+)?)$/i.exec(a);
  if (m) {
    const f = FIELD[m[1].toLowerCase()];
    if (!f) { unknown.push(atom); return false; }
    return OPS[m[2]](f(p), Number(m[3]));
  }
  const c = /^([a-z_]+):(.+)$/i.exec(a);
  if (c) {
    const kind = c[1].toLowerCase(); const id = c[2].trim();
    const inList = (list) => Array.isArray(list) && list.some((x) => String(x).toLowerCase() === id.toLowerCase());
    switch (kind) {
      case 'condition': return inList(p.conditions);
      case 'allergy': return inList(p.allergies);
      case 'medication': return inList(p.medications);
      case 'flag': return inList(p.flags);
      case 'sex': return p.sex === id.toLowerCase();
      default: unknown.push(atom); return false;
    }
  }
  if (a === 'emergency') return !!p.emergency;
  if (Array.isArray(p.flags) && p.flags.includes(a)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(a)) return false; // a flag the patient does not have
  unknown.push(atom);
  return false;
}

/** Evaluate a `when` expression. Returns { value, unknown:[atoms not understood] }. */
export function evaluateWhen(expr, patient, ctx = null) {
  const unknown = [];
  if (typeof expr !== 'string' || !expr.trim()) return { value: false, unknown: [String(expr)] };
  const value = expr.split('|').some((conj) => conj.split(/[&,]/).every((atom) => evalAtom(atom, patient, ctx, unknown)));
  return { value, unknown };
}

export function isRuntimeRule(expr) { return typeof expr === 'string' && expr.split(/[|&,]/).some((a) => isRuntimeAtom(a.trim().replace(/^!/, ''))); }

// ---------------------------------------------------------------------------

/**
 * evaluateContraindications(patientDerived, drugId[, library][, ctx])
 *  -> [{ severity:'lock'|'warn', message, sources, when }]
 * Runtime rules (TOF-depth etc.) are skipped unless ctx.runtime is supplied.
 */
export function evaluateContraindications(patient, drugId, library = null, ctx = null) {
  const drug = getDrug(library, drugId);
  if (!drug) throw new Error(`Unknown drug id '${drugId}'`);
  const out = [];
  for (const ci of drug.contraindications || []) {
    if (isRuntimeRule(ci.when) && !(ctx && ctx.runtime)) continue;
    const r = evaluateWhen(ci.when, patient, ctx);
    if (r.value) out.push({ severity: ci.severity === 'lock' ? 'lock' : 'warn', message: ci.message, sources: ci.sources || [], when: ci.when });
  }
  return out;
}

const KNOWN_REGIMEN_KEYS = new Set(['defaultRule', 'kind', 'perKg', 'fixed', 'rate', 'unit', 'scalar', 'scalarBasis', 'adjust', 'timing', 'sources', 'note', 'loading', 'notes', 'route', 'byDepth']);

const defaultOf = (x) => (x && isFiniteNumber(x.default) ? x.default : Infinity);

function pickAdjustment(adjs) {
  // When several adjustments match, the most conservative dosing override
  // (lowest default) is applied; notes/sources of all matches are reported.
  let best = null;
  for (const a of adjs) {
    if (!a.perKg && !a.fixed && !a.rate && !a.scalar && !a.loading) continue;
    if (!best) { best = a; continue; }
    const score = (x) => Math.min(defaultOf(x.perKg), defaultOf(x.fixed), defaultOf(x.rate), defaultOf(x.loading && (x.loading.perKg || x.loading.fixed)));
    if (score(a) < score(best)) best = a;
  }
  return best;
}

/** Phase -> regimen key (MAC sedation phase uses the sedation target). */
export function regimenKeyForPhase(phase, sedationTarget) {
  if (phase === 'sedation') return `sedation_${sedationTarget || 'moderate'}`;
  return phase;
}

/**
 * recommend(patientDerived, regimenKey, drugId[, library]) -> {
 *   drugId, regimenKey, kind, scalar, weightUsedKg,
 *   dose:{value, unit, perKg, range:{min,max}}|null, rate:{value, unit, range:{min,max}, absolute}|null,
 *   sources, notes, warnings, locked, lockReasons, available, timing, adjustmentsApplied }
 */
export function recommend(patient, regimenKey, drugId, library = null) {
  const lib = resolveLibrary(library);
  const drug = getDrug(lib, drugId);
  if (!drug) throw new Error(`Unknown drug id '${drugId}'`);
  const reg = drug.regimens ? drug.regimens[regimenKey] : undefined;
  const cis = evaluateContraindications(patient, drugId, lib);
  const locks = cis.filter((c) => c.severity === 'lock');
  const result = {
    drugId, regimenKey, kind: reg ? reg.kind : null, scalar: null, weightUsedKg: null,
    dose: null, rate: null, loading: null, sources: [], notes: [], warnings: cis.filter((c) => c.severity === 'warn').map((c) => c.message),
    locked: locks.length > 0, lockReasons: locks.map((c) => c.message), available: !!reg, timing: reg ? reg.timing || null : null,
    route: reg && reg.kind === 'bolus' ? (reg.route || (Array.isArray(drug.bolusRoutes) && drug.bolusRoutes[0]) || 'IV') : (reg ? 'IV' : null),
    adjustmentsApplied: [],
    contraindications: cis,
  };
  const addSources = (s) => { for (const x of s || []) if (!result.sources.includes(x)) result.sources.push(x); };
  for (const c of cis) addSources(c.sources);
  if (!reg) { result.warnings.push(`No sourced ${regimenKey} regimen for ${drug.name}.`); return result; }

  addSources(reg.sources);
  for (const k of Object.keys(reg)) if (!KNOWN_REGIMEN_KEYS.has(k)) devWarn(`${drugId}.${regimenKey}: unknown regimen field '${k}' ignored`);
  if (reg.note) result.notes.push(reg.note);
  if (reg.loading && reg.loading.alternative) result.notes.push(`Loading alternative: ${reg.loading.alternative}`);
  const matched = [];
  for (const a of reg.adjust || []) {
    const r = evaluateWhen(a.when, patient);
    if (r.unknown.length) result.warnings.push(`Unrecognised rule expression: ${r.unknown.join(', ')}`);
    if (r.value) matched.push(a);
  }
  const chosen = pickAdjustment(matched);
  for (const a of matched) {
    addSources(a.sources);
    if (a.note) result.notes.push(`Adjustment (${a.when}): ${a.note}`);
    if (a.warn && a.note) result.warnings.push(a.note);
    result.adjustmentsApplied.push({ when: a.when, applied: a === chosen });
  }
  const eff = { ...reg, ...(chosen ? Object.fromEntries(Object.entries(chosen).filter(([k]) => ['perKg', 'fixed', 'rate', 'scalar', 'unit', 'loading'].includes(k))) : {}) };
  if (chosen && chosen.perKg && !chosen.fixed) delete eff.fixed;
  if (chosen && chosen.fixed && !chosen.perKg) delete eff.perKg;

  const sw = scalarWeight(patient, eff.scalar || 'TBW');
  result.scalar = sw.scalar; result.weightUsedKg = roundSig(sw.weightKg);
  if (sw.capped) result.notes.push(`${sw.scalar} exceeds total body weight; total body weight used.`);

  if (!result.locked) {
    if (eff.fixed) {
      const u = eff.fixed.unit || drug.amountUnit;
      const cv = (x) => (isFiniteNumber(x) ? roundSig(convertAmount(x, u, drug.amountUnit)) : null);
      result.dose = { value: cv(eff.fixed.default), unit: drug.amountUnit, perKg: null, range: { min: cv(eff.fixed.min), max: cv(eff.fixed.max) } };
    } else if (eff.perKg) {
      const du = parseDoseUnit(eff.unit || `${drug.amountUnit}/kg`);
      const per = du ? du.amount : drug.amountUnit;
      const cv = (x) => (isFiniteNumber(x) ? roundSig(convertAmount(x * sw.weightKg, per, drug.amountUnit)) : null);
      result.dose = { value: cv(eff.perKg.default), unit: drug.amountUnit, perKg: { value: eff.perKg.default, unit: eff.unit || `${drug.amountUnit}/kg`, min: eff.perKg.min ?? null, max: eff.perKg.max ?? null }, range: { min: cv(eff.perKg.min), max: cv(eff.perKg.max) } };
    }
    if (eff.loading) {
      // Loading dose of an infusion regimen (e.g. dexmedetomidine 1 mcg/kg over 10 min).
      const L = { ...(reg.loading || {}), ...eff.loading };
      let src = null, unit = null;
      if (L.fixed) { src = L.fixed; unit = L.fixed.unit || drug.amountUnit; }
      else if (L.perKg) { src = L.perKg; const du = parseDoseUnit(L.unit || `${drug.amountUnit}/kg`); unit = du ? du.amount : drug.amountUnit; }
      if (src) {
        const w = L.fixed ? 1 : sw.weightKg;
        const cv = (x) => (isFiniteNumber(x) ? roundSig(convertAmount(x * w, unit, drug.amountUnit)) : null);
        const overMin = L.overMin && typeof L.overMin === 'object' ? (L.overMin.max ?? L.overMin.min ?? null) : (isFiniteNumber(L.overMin) ? L.overMin : null);
        result.loading = { value: cv(src.default), unit: drug.amountUnit, perKg: L.perKg ? { value: src.default, unit: L.unit || `${drug.amountUnit}/kg`, min: src.min ?? null, max: src.max ?? null } : null, range: { min: cv(src.min), max: cv(src.max) }, overSec: overMin ? overMin * 60 : null };
      }
    }
    if (eff.rate) {
      const r = { value: eff.rate.default, unit: eff.rate.unit, range: { min: eff.rate.min ?? null, max: eff.rate.max ?? null }, absolute: null, hardMax: isFiniteNumber(eff.rate.hardMax) ? eff.rate.hardMax : null };
      const pr = parseRateUnit(eff.rate.unit);
      if (pr && !pr.dial && drug.amountUnit !== '%') {
        try {
          const perH = rateToAmountPerMin(eff.rate.default, eff.rate.unit, drug.amountUnit, sw.weightKg) * 60;
          r.absolute = { value: roundSig(perH), unit: `${drug.amountUnit}/h` };
        } catch { /* incompatible units: leave absolute null */ }
      }
      if (reg.defaultRule === 'ageAdjustedMac') {
        // 1.0 × age-adjusted MAC (Mapleson 1996) offered alongside the label default; MAC40 from the library.
        const mac = drug.mac || {};
        const mac40 = isFiniteNumber(mac.mac40Pct) ? mac.mac40Pct : isFiniteNumber(drug.mac40) ? drug.mac40 : null;
        if (mac40 !== null) {
          const slope = isFiniteNumber(mac.slopePerYear) ? mac.slopePerYear : -0.00269;
          const v = mac40 * Math.pow(10, slope * (patient.ageYears - 40));
          r.ageAdjustedMac = { value: Math.round(v * 10) / 10, exact: v, mac40, sources: mac.sources || [], withinRange: (r.range.min === null || v >= r.range.min) && (r.range.max === null || v <= r.range.max), note: '1.0 × age-adjusted MAC (Mapleson 1996); a definitional reference point, not a recommendation.' };
          addSources(mac.sources);
        }
      }
      result.rate = r;
    }
    applyCeilingToRecommendation(drug, patient, result, sw.weightKg);
  }
  return result;
}

const KNOWN_CEILING_KEYS = new Set(['value', 'unit', 'basis', 'sources', 'note', 'scope', 'infusion', 'adjusted', 'perKg', 'rule', 'appliesTo', 'scalar', 'perDose']);
const DEV_WARNED = new Set();
function devWarn(msg) { if (!DEV_WARNED.has(msg)) DEV_WARNED.add(msg); }
export function devWarnings() { return [...DEV_WARNED]; }

function ceilingScalar(drug, explicit) {
  return explicit || Object.values(drug.regimens || {}).find((r) => r && r.perKg && r.scalar)?.scalar || 'TBW';
}

/** Build one limit from a {value, unit} (+ scope) description. */
function limitFrom(drug, patient, value, unit, { scope = null, scalar = null, basis = '', sources = [], label = '' } = {}) {
  if (!isFiniteNumber(value) || typeof unit !== 'string') return null;
  const u0 = unit.trim();
  const base = { value, unit: u0, basis, sources, label: label || `${value} ${u0}${basis ? ` (${basis})` : ''}` };
  if (u0 === '%') return { ...base, type: 'dial' };
  const daily = /(\/\s*(day|24\s*h)|per\s*day)$/i.test(u0);
  const u = u0.replace(/(\/\s*(day|24\s*h)|per\s*day)$/i, '');
  if (!daily) {
    const pr = parseRateUnit(u);
    if (pr && !pr.dial) {
      const weightKg = pr.perKg ? scalarWeight(patient, ceilingScalar(drug, scalar)).weightKg : null;
      return { ...base, type: 'rate', rateUnit: u, weightKg };
    }
  }
  const du = parseDoseUnit(u);
  if (!du) { devWarn(`${drug.id}: ceiling unit '${unit}' not understood; ignored`); return null; }
  const weightKg = du.perKg ? scalarWeight(patient, ceilingScalar(drug, scalar)).weightKg : null;
  try {
    const absolute = convertAmount(du.perKg ? value * weightKg : value, du.amount, drug.amountUnit);
    // scope 'cumulative boluses': total of all boluses in the session (infusions not counted).
    const bolusOnly = typeof scope === 'string' && /cumulative/i.test(scope) && /bolus/i.test(scope);
    const perBolus = !bolusOnly && typeof scope === 'string' && /bolus|dose/i.test(scope);
    return { ...base, type: perBolus ? 'bolus' : 'cumulative', bolusOnly, absolute, absoluteUnit: drug.amountUnit, daily, weightKg };
  } catch { devWarn(`${drug.id}: ceiling unit '${unit}' incompatible with amount unit`); return null; }
}

/**
 * interpretCeilings(drug, patient) -> [limit]
 *   limit.type: 'cumulative' (total in session; '/day' limits treated as session totals because
 *               sessions are < 24 h) | 'bolus' (per single dose, scope:'per bolus') |
 *               'rate' (infusion rate) | 'dial' (vaporizer %).
 * Handles drug.ceiling {value, unit, scope, perKg:{value,unit,scalar} ('lesser of'),
 * infusion:{value,unit}, adjusted:{when, value|perKg, unit}} and regimen rate.hardMax.
 */
export function interpretCeilings(drug, patient) {
  const out = [];
  const c = drug && drug.ceiling;
  if (c && typeof c === 'object') {
    for (const k of Object.keys(c)) if (!KNOWN_CEILING_KEYS.has(k)) devWarn(`${drug.id}: unknown ceiling field '${k}' ignored`);
    const meta = { basis: c.basis || '', sources: c.sources || [] };
    let primary = { value: c.value, unit: c.unit, scope: c.scope || null, scalar: c.scalar || null };
    let perDose = c.perDose && typeof c.perDose === 'object' ? c.perDose : null;
    let extra = null; // second adjusted limit when both perKg and an absolute value are given (lesser applies)
    if (c.adjusted && typeof c.adjusted === 'object' && c.adjusted.when) {
      const r = evaluateWhen(c.adjusted.when, patient);
      if (r.value) {
        const A = c.adjusted;
        if (isFiniteNumber(A.perKg)) {
          primary = { ...primary, value: A.perKg, unit: A.unit || `${drug.amountUnit}/kg`, scalar: A.scalar || null };
          if (isFiniteNumber(A.value)) extra = { value: A.value, unit: A.valueUnit || c.unit };
        } else if (isFiniteNumber(A.value)) primary = { ...primary, value: A.value, unit: A.unit || c.unit };
        if (A.perDose && typeof A.perDose === 'object') perDose = A.perDose;
        meta.basis = `${meta.basis}${meta.basis ? '; ' : ''}adjusted (${c.adjusted.when})`;
      }
    }
    const L = limitFrom(drug, patient, primary.value, primary.unit, { ...meta, scope: primary.scope, scalar: primary.scalar });
    if (L) out.push(L);
    if (extra) {
      const X = limitFrom(drug, patient, extra.value, extra.unit, { ...meta, scope: primary.scope, label: `${extra.value} ${extra.unit} (${meta.basis}; lesser applies)` });
      if (X) out.push(X);
    }
    if (perDose && isFiniteNumber(perDose.value)) {
      const D = limitFrom(drug, patient, perDose.value, perDose.unit || drug.amountUnit, { ...meta, scope: 'per dose', label: `${perDose.value} ${perDose.unit || drug.amountUnit} per dose (${meta.basis})` });
      if (D) out.push(D);
    }
    for (const [route, rl] of Object.entries((drug && drug.routeBolusMax) || {})) {
      const R = limitFrom(drug, patient, rl.value, rl.unit, { basis: rl.basis || '', sources: rl.sources || [], scope: 'per bolus', label: `${rl.value} ${rl.unit} per ${route} bolus (${rl.basis || ''})` });
      if (R) out.push({ ...R, route });
    }
    if (c.perKg && typeof c.perKg === 'object') {
      const P = limitFrom(drug, patient, c.perKg.value, c.perKg.unit, { ...meta, scope: primary.scope, scalar: c.perKg.scalar || null, label: `${c.perKg.value} ${c.perKg.unit}${c.perKg.scalar ? ` ${c.perKg.scalar}` : ''} (${meta.basis}; lesser applies)` });
      if (P) out.push(P);
    }
    if (c.infusion && typeof c.infusion === 'object') {
      const ib = c.infusion.basis || meta.basis;
      const I = limitFrom(drug, patient, c.infusion.value, c.infusion.unit, { ...meta, basis: ib, scalar: c.infusion.scalar || null, label: `infusion ${c.infusion.value} ${c.infusion.unit}${c.infusion.scalar ? ` ${c.infusion.scalar}` : ''} (${ib})` });
      if (I) out.push(I);
    }
  }
  for (const [key, r] of Object.entries((drug && drug.regimens) || {})) {
    if (r && r.rate && isFiniteNumber(r.rate.hardMax)) {
      const H = limitFrom(drug, patient, r.rate.hardMax, r.rate.unit, { basis: 'label hard maximum', sources: r.sources || [], label: `${r.rate.hardMax} ${r.rate.unit} hard maximum (${key})` });
      if (H) out.push(H);
    }
  }
  return out;
}

/** Back-compat: first limit or null. */
export function interpretCeiling(drug, patient) { return interpretCeilings(drug, patient)[0] || null; }

function applyCeilingToRecommendation(drug, patient, result, weightKg) {
  const limits = interpretCeilings(drug, patient);
  for (const c of limits) {
    for (const s of c.sources) if (!result.sources.includes(s)) result.sources.push(s);
    if (c.route && result.route !== c.route) continue; // route-specific limit (e.g. IV bolus) only for that route
    if ((c.type === 'cumulative' || c.type === 'bolus')) {
      for (const k of ['dose', 'loading']) {
        const d = result[k];
        if (d && isFiniteNumber(d.value) && d.value > c.absolute + 1e-9) {
          result.warnings.push(`Computed ${k === 'loading' ? 'loading dose' : 'dose'} exceeds ${c.label}; capped.`);
          d.value = roundSig(c.absolute);
        }
        if (d && d.range && isFiniteNumber(d.range.max) && d.range.max > c.absolute) d.range.max = roundSig(c.absolute);
      }
    }
    if (c.type === 'rate' && result.rate) {
      const cap = convertRateSafe(c.value, c.rateUnit, result.rate.unit, c.weightKg ?? weightKg);
      if (cap !== null) {
        if (result.rate.value > cap + 1e-9) {
          result.warnings.push(`Computed rate exceeds ${c.label}; capped.`);
          result.rate.value = roundSig(cap);
          if (result.rate.absolute) result.rate.absolute.value = roundSig(rateToAmountPerMin(result.rate.value, result.rate.unit, drug.amountUnit, weightKg) * 60);
        }
        if (!result.rate.ceiling || cap < result.rate.ceiling.inRegimenUnit) result.rate.ceiling = { value: c.value, unit: c.unit, inRegimenUnit: roundSig(cap), label: c.label };
      }
    }
    if (c.type === 'dial' && result.rate && result.rate.unit === '%' && result.rate.value > c.value) {
      result.warnings.push(`Dial setting exceeds ${c.label}; capped.`);
      result.rate.value = c.value;
    }
  }
}

/**
 * Convert a rate between units. Same unit → the value itself (no arithmetic, so a rate equal to
 * a ceiling stays exactly equal). Otherwise the result is rounded to 12 significant figures so
 * that a round trip (e.g. mcg/kg/h → mcg/min → mcg/kg/h) does not create float noise such as
 * 0.5000000000000001 (2026-11 audit, code finding 1).
 */
function convertRateSafe(value, from, to, weightKg) {
  try {
    if (!isFiniteNumber(value)) return null;
    if (typeof from === 'string' && from === to) return parseRateUnit(from) && !parseRateUnit(from).dial ? value : null;
    const a = parseRateUnit(from), b = parseRateUnit(to);
    if (!a || !b || a.dial || b.dial) return null;
    // via mg/min absolute
    const absPerMin = rateToAmountPerMin(value, from, b.amount, weightKg);
    if ((a.perKg || b.perKg) && !(weightKg > 0)) return null;
    let v = absPerMin; if (b.perKg) v /= weightKg; if (b.time === 'h') v *= 60;
    return roundSig(v, 12);
  } catch { return null; }
}

export { convertRateSafe };

/** Regimens of a drug with a given kind (or all), as [key, regimen] pairs. */
export function regimensOfKind(drug, kind) {
  return Object.entries(drug.regimens || {}).filter(([, r]) => r && (!kind || r.kind === kind));
}
