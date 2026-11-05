// Contraindications and dose recommendations (SPEC §5). Pure; no DOM.
// Every number returned comes from the drug library (data/drugs.js); this
// module only selects a regimen/adjustment and multiplies by a weight scalar.

import { resolveLibrary, getDrug } from './library.js';
import { scalarWeight } from './patient.js';
import { convertAmount, parseDoseUnit, parseRateUnit, rateToAmountPerMin, round3, isFiniteNumber } from './units.js';

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
  let a = atom.trim();
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

const defaultOf = (x) => (x && isFiniteNumber(x.default) ? x.default : Infinity);

function pickAdjustment(adjs) {
  // When several adjustments match, the most conservative dosing override
  // (lowest default) is applied; notes/sources of all matches are reported.
  let best = null;
  for (const a of adjs) {
    if (!a.perKg && !a.fixed && !a.rate && !a.scalar) continue;
    if (!best) { best = a; continue; }
    const score = (x) => Math.min(defaultOf(x.perKg), defaultOf(x.fixed), defaultOf(x.rate));
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
    dose: null, rate: null, sources: [], notes: [], warnings: cis.filter((c) => c.severity === 'warn').map((c) => c.message),
    locked: locks.length > 0, lockReasons: locks.map((c) => c.message), available: !!reg, timing: reg ? reg.timing || null : null,
    adjustmentsApplied: [],
    contraindications: cis,
  };
  const addSources = (s) => { for (const x of s || []) if (!result.sources.includes(x)) result.sources.push(x); };
  for (const c of cis) addSources(c.sources);
  if (!reg) { result.warnings.push(`No sourced ${regimenKey} regimen for ${drug.name}.`); return result; }

  addSources(reg.sources);
  if (reg.note) result.notes.push(reg.note);
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
    result.adjustmentsApplied.push({ when: a.when, applied: a === chosen });
  }
  const eff = { ...reg, ...(chosen ? Object.fromEntries(Object.entries(chosen).filter(([k]) => ['perKg', 'fixed', 'rate', 'scalar', 'unit'].includes(k))) : {}) };
  if (chosen && chosen.perKg && !chosen.fixed) delete eff.fixed;
  if (chosen && chosen.fixed && !chosen.perKg) delete eff.perKg;

  const sw = scalarWeight(patient, eff.scalar || 'TBW');
  result.scalar = sw.scalar; result.weightUsedKg = round3(sw.weightKg);
  if (sw.capped) result.notes.push(`${sw.scalar} exceeds total body weight; total body weight used.`);

  if (!result.locked) {
    if (eff.fixed) {
      const u = eff.fixed.unit || drug.amountUnit;
      const cv = (x) => (isFiniteNumber(x) ? round3(convertAmount(x, u, drug.amountUnit)) : null);
      result.dose = { value: cv(eff.fixed.default), unit: drug.amountUnit, perKg: null, range: { min: cv(eff.fixed.min), max: cv(eff.fixed.max) } };
    } else if (eff.perKg) {
      const du = parseDoseUnit(eff.unit || `${drug.amountUnit}/kg`);
      const per = du ? du.amount : drug.amountUnit;
      const cv = (x) => (isFiniteNumber(x) ? round3(convertAmount(x * sw.weightKg, per, drug.amountUnit)) : null);
      result.dose = { value: cv(eff.perKg.default), unit: drug.amountUnit, perKg: { value: eff.perKg.default, unit: eff.unit || `${drug.amountUnit}/kg`, min: eff.perKg.min ?? null, max: eff.perKg.max ?? null }, range: { min: cv(eff.perKg.min), max: cv(eff.perKg.max) } };
    }
    if (eff.rate) {
      const r = { value: eff.rate.default, unit: eff.rate.unit, range: { min: eff.rate.min ?? null, max: eff.rate.max ?? null }, absolute: null };
      const pr = parseRateUnit(eff.rate.unit);
      if (pr && !pr.dial && drug.amountUnit !== '%') {
        try {
          const perH = rateToAmountPerMin(eff.rate.default, eff.rate.unit, drug.amountUnit, sw.weightKg) * 60;
          r.absolute = { value: round3(perH), unit: `${drug.amountUnit}/h` };
        } catch { /* incompatible units: leave absolute null */ }
      }
      result.rate = r;
    }
    applyCeilingToRecommendation(drug, patient, result, sw.weightKg);
  }
  return result;
}

/** Interpret drug.ceiling. Returns { type:'cumulative'|'rate'|'dial', ... } or null. */
export function interpretCeiling(drug, patient) {
  const c = drug && drug.ceiling;
  if (!c || !isFiniteNumber(c.value) || typeof c.unit !== 'string') return null;
  const unit = c.unit.trim();
  const base = { value: c.value, unit, basis: c.basis || '', sources: c.sources || [] };
  if (unit === '%') return { ...base, type: 'dial' };
  const daily = /(\/\s*(day|24\s*h)|per\s*day)$/i.test(unit);
  const u = unit.replace(/(\/\s*(day|24\s*h)|per\s*day)$/i, '');
  if (!daily) {
    const pr = parseRateUnit(u);
    if (pr && !pr.dial) return { ...base, type: 'rate', rateUnit: u };
  }
  const du = parseDoseUnit(u);
  if (du) {
    let weightKg = null;
    if (du.perKg) {
      const scalar = c.scalar || Object.values(drug.regimens || {}).find((r) => r && r.perKg && r.scalar)?.scalar || 'TBW';
      weightKg = scalarWeight(patient, scalar).weightKg;
    }
    try {
      const absolute = convertAmount(du.perKg ? c.value * weightKg : c.value, du.amount, drug.amountUnit);
      return { ...base, type: 'cumulative', absolute, absoluteUnit: drug.amountUnit, daily };
    } catch { return null; }
  }
  return null;
}

function applyCeilingToRecommendation(drug, patient, result, weightKg) {
  const c = interpretCeiling(drug, patient);
  if (!c) return;
  for (const s of c.sources) if (!result.sources.includes(s)) result.sources.push(s);
  if (c.type === 'cumulative' && result.dose && result.dose.value > c.absolute) {
    result.warnings.push(`Computed dose exceeds the ${c.basis || 'ceiling'} (${c.value} ${c.unit}); capped.`);
    result.dose.value = round3(c.absolute);
  }
  if (c.type === 'rate' && result.rate) {
    try {
      const pr = parseRateUnit(result.rate.unit);
      if (pr && !pr.dial) {
        const capInRegUnit = convertRateSafe(c.value, c.rateUnit, result.rate.unit, weightKg);
        if (capInRegUnit !== null && result.rate.value > capInRegUnit + 1e-9) {
          result.warnings.push(`Computed rate exceeds the ${c.basis || 'ceiling'} (${c.value} ${c.unit}); capped.`);
          result.rate.value = round3(capInRegUnit);
          if (result.rate.absolute) result.rate.absolute.value = round3(rateToAmountPerMin(result.rate.value, result.rate.unit, drug.amountUnit, weightKg) * 60);
        }
        result.rate.ceiling = { value: c.value, unit: c.unit, inRegimenUnit: capInRegUnit === null ? null : round3(capInRegUnit) };
      }
    } catch { /* ignore */ }
  }
  if (c.type === 'dial' && result.rate && result.rate.value > c.value) {
    result.warnings.push(`Dial setting exceeds the ${c.basis || 'ceiling'} (${c.value}%); capped.`);
    result.rate.value = c.value;
  }
}

function convertRateSafe(value, from, to, weightKg) {
  try {
    const a = parseRateUnit(from), b = parseRateUnit(to);
    if (!a || !b || a.dial || b.dial) return null;
    // via mg/min absolute
    const absPerMin = rateToAmountPerMin(value, from, b.amount, weightKg);
    let v = absPerMin; if (b.perKg) v /= weightKg; if (b.time === 'h') v *= 60;
    return v;
  } catch { return null; }
}

export { convertRateSafe };

/** Regimens of a drug with a given kind (or all), as [key, regimen] pairs. */
export function regimensOfKind(drug, kind) {
  return Object.entries(drug.regimens || {}).filter(([, r]) => r && (!kind || r.kind === kind));
}
