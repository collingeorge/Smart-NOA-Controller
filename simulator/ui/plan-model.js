// Plan model helpers for the plan editor: step creation from recommend(), validation
// against sourced ranges, label ceilings and (when enabled) Smart NOA simulation ceilings.
// No DOM.
import { recommend, interpretCeilings, convertRateSafe, regimenKeyForPhase, evaluateWhen } from '../engine/dosing.js';
import { NOA_CONFIG, SIM_TO_PY_ID, CONTROLLED, PY_RATE_UNITS, aboveCeiling } from '../engine/interlocks.js';
import { scalarWeight } from '../engine/patient.js';
import { MIN_FIO2_WITH_N2O, FLUID_MODEL, LIDOCAINE_RULES } from '../engine/sim.js';
import { selectProphylaxis } from '../engine/prophylaxis.js';
import { overSecFromTiming } from '../data/scenarios.js';
import { roundSig } from '../engine/units.js';

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function phasesFor(mode) { return mode === 'MAC' ? ['premed', 'sedation', 'emergence'] : ['premed', 'induction', 'maintenance', 'emergence']; }
export function keyForPhase(phase, target) { return regimenKeyForPhase(phase, target); }

let UID = 0;
export const newUid = () => `st${++UID}`;

/** A drug, a prophylaxis antibiotic or an IV fluid (all have id + name). */
export function getDrugById(lib, id) { return lib.DRUGS.find((d) => d.id === id) || (lib.ANTIBIOTICS || []).find((d) => d.id === id) || (lib.FLUIDS || []).find((f) => f.id === id) || null; }
export const isFluidStep = (s) => s.kind === 'fluid' || s.kind === 'fluid_bolus';
/** Antibiotic prophylaxis is indicated: explicit plan flag, else GA by default (simulator convention, PROPHYLAXIS_CONFIG.INDICATED_DEFAULT_GA). */
export function prophylaxisIndicated(plan) { const v = plan.prophylaxisByMode && plan.prophylaxisByMode[plan.mode]; return typeof v === 'boolean' ? v : plan.mode === 'GA'; }
export function setProphylaxisIndicated(plan, v) { plan.prophylaxisByMode = { ...(plan.prophylaxisByMode || {}), [plan.mode]: !!v }; }

/** Fluid step for the plan editor: maintenance (rate mL/h; 0 stops it) or a bolus (250/500 mL). */
export function makeFluidStep(c, fluidId, kind, value, phase, atSec = 0) {
  const f = (c.lib.FLUIDS || []).find((x) => x.id === fluidId);
  if (!f) return { steps: [], reason: `Unknown fluid ${fluidId}` };
  const base = { uid: newUid(), phase, atSec, drugId: f.id, fluidId: f.id, regimenKey: null, filledFor: c.patientVersion, addWarnings: [] };
  if (kind === 'fluid') return { steps: [{ ...base, kind: 'fluid', rate: isNum(value) ? value : FLUID_MODEL.MAINTENANCE_DEFAULT_ML_H, rateUnit: 'mL/h' }], reason: null };
  return { steps: [{ ...base, kind: 'fluid_bolus', amount: isNum(value) ? value : FLUID_MODEL.DEFAULT_ML, amountUnit: 'mL' }], reason: null };
}

/** Antibiotic prophylaxis step ('auto' = guideline selection for this patient). */
export function makeAntibioticStep(c, drugId, phase, atSec = 0) {
  const id = drugId === 'auto' ? selectProphylaxis(c.patient, c.lib).drugId : drugId;
  if (!id) return { steps: [], reason: 'No prophylaxis agent available for this patient.' };
  const rec = recommend(c.patient, 'prophylaxis', id, c.lib);
  if (rec.locked) return { steps: [], reason: `${getDrugById(c.lib, id).name} is locked: ${rec.lockReasons.join('; ')}` };
  return { steps: [{ uid: newUid(), phase, atSec, drugId: id, regimenKey: 'prophylaxis', kind: 'antibiotic', amount: rec.dose.value, amountUnit: rec.dose.unit, filledFor: c.patientVersion, addWarnings: rec.warnings.slice() }], reason: null };
}
export function isInhaledDrug(drug) { return !!drug && (drug.cls === 'volatile' || drug.cls === 'gas' || drug.amountUnit === '%'); }
export function isNitrousDrug(drug) { return !!drug && drug.id === 'nitrous_oxide'; }

/** Same weight the engine uses for rate conversions (first rate regimen with a scalar). */
export function rateWeightFor(drug, p) {
  const regs = drug.regimens || {};
  for (const k of ['maintenance', 'sedation_moderate', 'sedation_deep', 'sedation_minimal', ...Object.keys(regs)]) if (regs[k] && regs[k].rate && regs[k].scalar) return scalarWeight(p, regs[k].scalar).weightKg;
  return p.weightKg;
}

/** Smart NOA (Python config.yaml) simulation rate ceiling expressed in `unit`, or null if the drug is not controlled. */
export function interlockCeiling(drug, unit, patient) {
  const py = SIM_TO_PY_ID[drug.id];
  if (!py || !CONTROLLED.includes(py)) return null;
  const ceil = NOA_CONFIG.simulation_rate_ceilings[py]; const pyUnit = PY_RATE_UNITS[py];
  const w = rateWeightFor(drug, patient);
  const v = unit === pyUnit ? ceil : convertRateSafe(ceil, pyUnit, unit, w);
  if (!isNum(v)) return null;
  // Display value: 4 significant figures, but never above the ceiling once converted back.
  let shown = unit === pyUnit ? ceil : roundSig(v);
  if (unit !== pyUnit && aboveCeiling(convertRateSafe(shown, unit, pyUnit, w), ceil)) { const p = Math.pow(10, 3 - Math.floor(Math.log10(Math.abs(v)))); shown = Math.floor(v * p) / p; }
  return { value: shown, unit, pyValue: ceil, pyUnit, weightKg: w };
}

/** Same comparison as the engine (sim.js admission and InterlockCore.rateFaults): in the Python unit, shared tolerance. */
export function exceedsInterlockCeiling(drug, rate, unit, patient) {
  const ic = interlockCeiling(drug, unit, patient);
  if (!ic || !isNum(rate)) return false;
  const pyRate = convertRateSafe(rate, unit, ic.pyUnit, ic.weightKg);
  return pyRate === null || aboveCeiling(pyRate, ic.pyValue);
}

export function interlockNote(rec, ic) {
  const r = rec.rate.range;
  return `Label range ${r.min ?? 0}–${r.max ?? '?'} ${rec.rate.unit} (default ${rec.rate.value}); Smart NOA simulation ceiling ${ic.pyValue} ${ic.pyUnit} applies while interlocks are on, so the ceiling was pre-filled.`;
}

/** Steps for a drug + regimen (an infusion with a loading dose gives two steps). Returns { steps, reason }. */
export function makeSteps({ lib, patient, interlocks, patientVersion }, drugId, regimenKey, phase, atSec = 0) {
  const drug = getDrugById(lib, drugId);
  const rec = recommend(patient, regimenKey, drugId, lib);
  if (rec.locked) return { steps: [], reason: `${drug.name} is locked: ${rec.lockReasons.join('; ')}` };
  if (!rec.available) return { steps: [], reason: rec.warnings.join('; ') };
  const base = { phase, atSec, drugId, regimenKey, filledFor: patientVersion, addWarnings: rec.warnings.slice() };
  const out = [];
  if (rec.kind === 'bolus' && rec.dose) {
    out.push({ ...base, uid: newUid(), kind: 'bolus', amount: rec.dose.value, amountUnit: rec.dose.unit, overSec: rec.route && rec.route !== 'IV' ? null : overSecFromTiming(rec.timing), route: rec.route || null });
  } else if (rec.kind === 'infusion' && rec.rate) {
    if (rec.loading && isNum(rec.loading.value)) out.push({ ...base, uid: newUid(), kind: 'bolus', loading: true, amount: rec.loading.value, amountUnit: rec.loading.unit, overSec: rec.loading.overSec || null });
    const st = { ...base, uid: newUid(), kind: 'infusion', rate: rec.rate.value, rateUnit: rec.rate.unit, labelDefault: rec.rate.value };
    const ic = interlockCeiling(drug, rec.rate.unit, patient);
    if (interlocks && ic && exceedsInterlockCeiling(drug, rec.rate.value, rec.rate.unit, patient)) { st.rate = ic.value; st.prefillNote = interlockNote(rec, ic); }
    out.push(st);
  } else if (rec.kind === 'inhaled' && rec.rate) {
    out.push({ ...base, uid: newUid(), kind: 'inhaled', rate: rec.rate.value, rateUnit: '%' });
  } else {
    return { steps: [], reason: `No sourced value for ${drug.name} (${regimenKey}).` };
  }
  return { steps: out, reason: null };
}

/** Re-fill an existing step's dose/rate from recommend() (keeps timing/order). */
export function refillStep(c, step) {
  if (step.kind === 'stop') return step;
  if (isFluidStep(step)) { step.filledFor = c.patientVersion; return step; }
  if (step.kind === 'antibiotic') {
    const r = recommend(c.patient, 'prophylaxis', step.drugId, c.lib);
    step.filledFor = c.patientVersion; step.addWarnings = r.warnings.slice();
    if (!r.locked && r.dose) { step.amount = r.dose.value; step.amountUnit = r.dose.unit; }
    return step;
  }
  const rec = recommend(c.patient, step.regimenKey, step.drugId, c.lib);
  const drug = getDrugById(c.lib, step.drugId);
  step.filledFor = c.patientVersion; step.addWarnings = rec.warnings.slice(); delete step.prefillNote;
  if (!rec.available || rec.locked) return step;
  if (step.kind === 'bolus') {
    const d = step.loading ? rec.loading : rec.dose;
    if (d && isNum(d.value)) { step.amount = d.value; step.amountUnit = d.unit; step.overSec = step.loading ? (d.overSec || null) : rec.route && rec.route !== 'IV' ? null : overSecFromTiming(rec.timing); step.route = step.loading ? null : rec.route || null; }
  } else if (rec.rate) {
    step.rate = step.kind === 'inhaled' ? rec.rate.value : rec.rate.value; step.rateUnit = rec.rate.unit; step.labelDefault = rec.rate.value;
    if (step.kind === 'infusion') {
      const ic = interlockCeiling(drug, rec.rate.unit, c.patient);
      if (c.interlocks && ic && exceedsInterlockCeiling(drug, rec.rate.value, rec.rate.unit, c.patient)) { step.rate = ic.value; step.prefillNote = interlockNote(rec, ic); }
    }
  }
  return step;
}

/** Convert an engine plan (from buildPlan) into editor steps. */
export function stepsFromBuiltPlan(c, plan) {
  return plan.steps.map((s) => {
    const st = { uid: newUid(), phase: s.phase, atSec: s.atSec || 0, drugId: s.drugId, regimenKey: s.regimenKey || null, kind: s.kind, filledFor: c.patientVersion, addWarnings: [] };
    if (s.kind === 'fluid') return { ...st, fluidId: s.fluidId, rate: s.rate, rateUnit: 'mL/h' };
    if (s.kind === 'fluid_bolus') return { ...st, fluidId: s.fluidId, amount: s.amount, amountUnit: 'mL' };
    if (s.kind === 'antibiotic') return { ...st, amount: s.amount, amountUnit: s.amountUnit, addWarnings: recommend(c.patient, 'prophylaxis', s.drugId, c.lib).warnings.slice() };
    if (s.kind === 'bolus') Object.assign(st, { amount: s.amount, amountUnit: s.amountUnit, overSec: s.overSec || null, loading: !!s.loading, route: s.route || null });
    if (s.kind === 'infusion' || s.kind === 'inhaled') Object.assign(st, { rate: s.rate, rateUnit: s.rateUnit, labelDefault: s.rate });
    if (s.kind !== 'stop') {
      const rec = recommend(c.patient, st.regimenKey, st.drugId, c.lib);
      st.addWarnings = rec.warnings.slice();
      if (s.kind === 'infusion') {
        const ic = interlockCeiling(getDrugById(c.lib, s.drugId), s.rateUnit, c.patient);
        if (c.interlocks && ic && exceedsInterlockCeiling(getDrugById(c.lib, s.drugId), s.rate, s.rateUnit, c.patient) && rec.rate) { st.rate = ic.value; st.prefillNote = interlockNote(rec, ic); }
      }
      if (s.kind === 'inhaled' && rec.rate && rec.rate.ageAdjustedMac && Math.abs(s.rate - rec.rate.ageAdjustedMac.value) < 1e-9) st.dialNote = `Example plan dial = 1.0 × age-adjusted MAC (${rec.rate.ageAdjustedMac.value} %), clamped to the label range.`;
    }
    return st;
  });
}

/**
 * Validate one step. Returns { errors:[{text, fix?}], warnings:[text], rec }.
 * fix: { label, apply(step) } quick-fix offered next to an error.
 */
export function checkStep(c, step, allSteps) {
  const errors = []; const warnings = []; const info = {};
  const drug = getDrugById(c.lib, step.drugId);
  if (!drug) return { errors: [{ text: `Unknown drug ${step.drugId}` }], warnings, rec: null };
  if (step.atSec === null || !isNum(step.atSec) || step.atSec < 0) errors.push({ text: 'Time offset must be mm:ss or h:mm:ss (e.g. 01:30).' });
  if (isFluidStep(step)) {
    if (step.kind === 'fluid' && (!isNum(step.rate) || step.rate < 0 || step.rate > FLUID_MODEL.MAINTENANCE_MAX_ML_H)) errors.push({ text: `Maintenance rate must be 0–${FLUID_MODEL.MAINTENANCE_MAX_ML_H} mL/h (0 stops the infusion).` });
    if (step.kind === 'fluid_bolus' && !FLUID_MODEL.ALLOWED_ML.includes(step.amount)) errors.push({ text: `Fluid bolus must be ${FLUID_MODEL.ALLOWED_ML.join(' or ')} mL.` });
    for (const ci of drug.cautions || []) if (evaluateWhenSafe(ci.when, c.patient)) warnings.push(ci.message);
    return { errors, warnings, rec: null };
  }
  if (step.kind === 'antibiotic') {
    const rec = recommend(c.patient, 'prophylaxis', step.drugId, c.lib);
    if (rec.locked) errors.push({ text: `Locked for this patient: ${rec.lockReasons.join('; ')}` });
    else if (!isNum(step.amount) || step.amount <= 0) errors.push({ text: 'Dose must be a positive number.' });
    else if (rec.dose && (step.amount < rec.dose.range.min - 1e-9 || step.amount > rec.dose.range.max + 1e-9)) warnings.push(`Dose ${step.amount} ${drug.amountUnit} differs from the guideline dose ${rec.dose.range.min === rec.dose.range.max ? rec.dose.range.min : `${rec.dose.range.min}–${rec.dose.range.max}`} ${rec.dose.unit} for this patient.`);
    return { errors, warnings, rec };
  }
  if (step.kind === 'stop') {
    const started = allSteps.some((s) => s.drugId === step.drugId && (s.kind === 'infusion' || s.kind === 'inhaled'));
    if (!started) warnings.push(`No ${drug.name} infusion or dial setting earlier in the plan; this stop does nothing.`);
    return { errors, warnings, rec: null };
  }
  const rec = recommend(c.patient, step.regimenKey, step.drugId, c.lib);
  info.rec = rec;
  if (rec.locked) { errors.push({ text: `Locked for this patient: ${rec.lockReasons.join('; ')}` }); return { errors, warnings, rec }; }
  if (!rec.available) { errors.push({ text: `No sourced ${step.regimenKey} regimen for ${drug.name}. Remove this step.` }); return { errors, warnings, rec }; }
  const limits = interpretCeilings(drug, c.patient).filter((L) => !L.route || L.route === (step.route || rec.route || 'IV'));
  // Surgery-timing runtime rules (e.g. ketorolac) shown at plan time for the phases they concern.
  for (const r of drug.runtimeRules || []) if (Array.isArray(r.planPhases) && r.planPhases.includes(step.phase)) warnings.push(r.message);
  if (step.drugId === 'lidocaine') { const w = lidocaineOverlapWarning(c, allSteps); if (w) warnings.push(w); }
  if (step.kind === 'bolus') {
    if (!isNum(step.amount) || step.amount <= 0) errors.push({ text: 'Dose must be a positive number.' });
    else {
      const d = step.loading ? rec.loading : rec.dose;
      if (d && isNum(d.range.min) && isNum(d.range.max) && (step.amount < d.range.min - 1e-9 || step.amount > d.range.max + 1e-9)) warnings.push(`Dose ${step.amount} ${drug.amountUnit} is outside the sourced range ${d.range.min}–${d.range.max} ${d.unit}.`);
      for (const L of limits) {
        if (L.type === 'bolus' && step.amount > L.absolute + 1e-9) errors.push({ text: `Blocked: single dose above ${L.label} (${roundSig(L.absolute)} ${drug.amountUnit} for this patient).`, fix: { label: `Use ${roundSig(L.absolute)} ${drug.amountUnit}`, apply: (s) => { s.amount = roundSig(L.absolute); } } });
        if (L.type === 'cumulative') {
          const total = allSteps.filter((s) => s.drugId === step.drugId && s.kind === 'bolus' && isNum(s.amount)).reduce((a, s) => a + s.amount, 0); // boluses only (also correct for 'cumulative boluses' limits)
          if (total > L.absolute + 1e-9) errors.push({ text: `Blocked: planned total ${roundSig(total)} ${drug.amountUnit} exceeds ${L.label} (${roundSig(L.absolute)} ${drug.amountUnit} for this patient${L.daily ? '; daily limit applied to the session' : ''}).` });
        }
      }
    }
    if (step.overSec !== null && step.overSec !== undefined && (!isNum(step.overSec) || step.overSec < 0)) errors.push({ text: '“Give over” must be a number of minutes (blank or 0 = push).' });
    else if (isNum(step.overSec) && step.overSec > 0 && step.overSec < 60) errors.push({ text: '“Give over” under 1 min is not modelled: leave it blank for a push, or use 1 min or more.', fix: { label: 'Make it a push', apply: (s) => { s.overSec = null; } } });
  } else {
    if (!isNum(step.rate) || step.rate < 0) errors.push({ text: 'Rate must be zero or a positive number.' });
    else if (rec.rate) {
      const r = rec.rate.range;
      if (isNum(r.min) && isNum(r.max) && (step.rate < r.min - 1e-9 || step.rate > r.max + 1e-9)) warnings.push(`${step.rate} ${step.rateUnit} is outside the sourced range ${r.min}–${r.max} ${rec.rate.unit}.`);
      for (const L of limits) {
        if (L.type === 'rate' && step.kind === 'infusion') {
          const cap = convertRateSafe(L.value, L.rateUnit, step.rateUnit, L.weightKg ?? rateWeightFor(drug, c.patient));
          if (cap !== null && step.rate > cap + 1e-9) errors.push({ text: `Blocked: rate above ${L.label} (${roundSig(cap)} ${step.rateUnit} for this patient).`, fix: { label: `Use ${roundSig(cap)}`, apply: (s) => { s.rate = roundSig(cap); } } });
        }
        if (L.type === 'dial' && step.kind === 'inhaled' && step.rate > L.value + 1e-9) errors.push({ text: `Blocked: dial above ${L.label}.`, fix: { label: `Use ${L.value} %`, apply: (s) => { s.rate = L.value; } } });
      }
      if (step.kind === 'infusion') {
        const ic = interlockCeiling(drug, step.rateUnit, c.patient);
        if (ic) {
          info.interlockCeiling = ic;
          if (c.interlocks && exceedsInterlockCeiling(drug, step.rate, step.rateUnit, c.patient)) errors.push({ text: `Blocked while interlocks are on: above the Smart NOA simulation ceiling ${ic.pyValue} ${ic.pyUnit} (config.yaml). Label range ${rec.rate.range.min ?? 0}–${rec.rate.range.max} ${rec.rate.unit}.`, fix: { label: `Use ceiling ${ic.value}`, apply: (s) => { s.rate = ic.value; s.prefillNote = interlockNote(rec, ic); } } });
        }
      }
      if (step.kind === 'inhaled' && isNitrousDrug(drug)) {
        const maxO2 = 1 - step.rate / 100;
        if (maxO2 < MIN_FIO2_WITH_N2O - 1e-9) errors.push({ text: `Blocked: N2O ${step.rate} % would leave FiO2 ${maxO2.toFixed(2)} < ${MIN_FIO2_WITH_N2O}.` });
        else warnings.push(`N2O ${step.rate} % caps FiO2 at ${maxO2.toFixed(2)} (O2 + N2O ≤ 1).`);
      }
    }
  }
  return { errors, warnings, rec };
}

function evaluateWhenSafe(when, patient) { try { return evaluateWhen(when, patient).value; } catch { return false; } }

/**
 * Foo 2021 overlap check at plan time (simulator mapping, LIDOCAINE_RULES): lidocaine pretreatment
 * and an IV lidocaine analgesic regimen in the same plan (a case is shorter than the 4-h window).
 * Also flags pretreatment + loading boluses above the Foo loading limit (perKg max × IBW).
 */
export function lidocaineOverlapWarning(c, allSteps) {
  const lido = allSteps.filter((s) => s.drugId === 'lidocaine' && s.kind !== 'stop');
  const pre = lido.filter((s) => s.regimenKey === LIDOCAINE_RULES.PRETREATMENT_REGIMEN);
  const ana = lido.filter((s) => s.regimenKey !== LIDOCAINE_RULES.PRETREATMENT_REGIMEN);
  if (!pre.length || !ana.length) return null;
  const rec = recommend(c.patient, 'induction', 'lidocaine', c.lib);
  const bol = lido.filter((s) => s.kind === 'bolus' && isNum(s.amount)).reduce((a, s) => a + s.amount, 0);
  const lim = rec.dose && isNum(rec.dose.range.max) ? rec.dose.range.max : null;
  return `Lidocaine pretreatment and an IV lidocaine analgesic regimen are both planned (within ${LIDOCAINE_RULES.OVERLAP_WINDOW_SEC / 3600} h): every dose counts toward the cumulative lidocaine total (Foo 2021: loading ≤ 1.5 mg/kg IBW, infusion ≤ 1.5 mg/kg/h IBW, ≤ 120 mg/h) [S1]. Planned lidocaine boluses ${roundSig(bol)} mg${lim !== null ? `${bol > lim + 1e-9 ? ' EXCEED' : ' vs'} the loading limit ${lim} mg for this patient` : ''}. Consider omitting the pretreatment.`;
}

/** Engine plan (SPEC §5) from the editor model. */
export function exportPlan(plan) {
  const phases = phasesFor(plan.mode);
  const steps = []; let order = 0;
  for (const ph of phases) {
    for (const s of plan.steps.filter((x) => x.phase === ph)) {
      const o = { id: s.uid, phase: s.phase, atSec: s.atSec || 0, order: order++, drugId: s.drugId, kind: s.kind, regimenKey: s.regimenKey };
      if (s.kind === 'bolus') Object.assign(o, { amount: s.amount, amountUnit: s.amountUnit, overSec: isNum(s.overSec) && s.overSec > 0 ? s.overSec : null, loading: !!s.loading, ...(s.route ? { route: s.route } : {}) });
      if (s.kind === 'infusion' || s.kind === 'inhaled') Object.assign(o, { rate: s.rate, rateUnit: s.rateUnit });
      if (s.kind === 'fluid') Object.assign(o, { fluidId: s.fluidId, rate: s.rate, rateUnit: 'mL/h' });
      if (s.kind === 'fluid_bolus') Object.assign(o, { fluidId: s.fluidId, amount: s.amount, amountUnit: 'mL' });
      if (s.kind === 'antibiotic') Object.assign(o, { amount: s.amount, amountUnit: s.amountUnit });
      steps.push(o);
    }
  }
  return { mode: plan.mode, sedationTarget: plan.mode === 'MAC' ? plan.sedationTarget : null, steps, prophylaxisIndicated: prophylaxisIndicated(plan), ...(plan.template ? { template: { ...plan.template } } : {}) };
}

export function planIssues(c, plan) {
  let errors = 0, warnings = 0; const firstError = { uid: null };
  for (const s of plan.steps) {
    const r = checkStep(c, s, plan.steps);
    if (r.errors.length && !firstError.uid) firstError.uid = s.uid;
    errors += r.errors.length; warnings += r.warnings.length;
  }
  return { errors, warnings, firstError: firstError.uid };
}
