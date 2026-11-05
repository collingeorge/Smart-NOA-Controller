// Technique templates -> engine plan (2026-11 additions). Pure; no DOM.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device.
//
// buildTemplatePlan() expands a template from data/templates.js and fills EVERY dose and rate with
// recommend() through buildPlan() (data/scenarios.js); this module adds no numbers of its own. It
// only (1) picks the template's optional steps, (2) swaps a locked primary drug for the template's
// fallback, (3) drops lidocaine pretreatment when an IV lidocaine analgesic regimen is planned, and
// (4) with interlocks on, pre-fills the Smart NOA simulation ceiling (config.yaml) when a label
// default is above it — the same rule as the plan editor.

import { resolveLibrary, getDrug } from './library.js';
import { recommend, regimenKeyForPhase, convertRateSafe } from './dosing.js';
import { scalarWeight } from './patient.js';
import { NOA_CONFIG, SIM_TO_PY_ID, CONTROLLED, PY_RATE_UNITS, aboveCeiling } from './interlocks.js';
import { FLUID_MODEL } from './sim.js';
import { TECHNIQUE_TEMPLATES } from '../data/templates.js';
import { buildPlan } from '../data/scenarios.js';
import { roundSig } from './units.js';

export { TECHNIQUE_TEMPLATES };
export function getTemplate(id) { return TECHNIQUE_TEMPLATES.find((t) => t.id === id) || null; }

/** Optional steps of a template: [{ id, label, default }]. */
export function templateOptions(template) {
  const seen = new Map();
  for (const s of template.steps) if (s.optional && !seen.has(s.optional.id)) seen.set(s.optional.id, { ...s.optional });
  return [...seen.values()];
}

const isLidoAnalgesic = (s) => s.drugId === 'lidocaine' && s.kind !== 'stop' && s.regimenKey !== 'pretreatment';

function rateWeight(drug, p) {
  const regs = drug.regimens || {};
  for (const k of ['maintenance', 'sedation_moderate', 'sedation_deep', 'sedation_minimal', ...Object.keys(regs)]) if (regs[k] && regs[k].rate && regs[k].scalar) return scalarWeight(p, regs[k].scalar).weightKg;
  return p.weightKg;
}

/**
 * buildTemplatePlan(templateId, patientDerived, { library, interlocks = true, sedationTarget, include, prefillCeilings = interlocks })
 * (the plan editor passes prefillCeilings:false and applies the same ceiling itself, with its note)
 *  -> { plan, skipped, notes:[{ key, text, sources }], substitutions:[…], omitted:[…], prefilled:[…], template }
 * include: { [optionalId]: boolean } (absent → the option's default).
 */
export function buildTemplatePlan(templateId, patient, { library = null, interlocks = true, sedationTarget = null, include = {}, prefillCeilings = interlocks } = {}) {
  const lib = resolveLibrary(library);
  const tpl = getTemplate(templateId);
  if (!tpl) throw new Error(`Unknown template '${templateId}'`);
  const target = tpl.mode === 'MAC' ? (sedationTarget || tpl.sedationTarget || 'moderate') : null;
  const want = (s) => !s.optional || (Object.prototype.hasOwnProperty.call(include, s.optional.id) ? !!include[s.optional.id] : !!s.optional.default);
  const substitutions = []; const omitted = []; const swap = new Map();
  let steps = tpl.steps.filter(want).map((s) => ({ ...s, regimenKey: s.regimenKey === 'sedation' ? regimenKeyForPhase('sedation', target) : s.regimenKey }));
  // fallback when the primary drug is locked (e.g. sevoflurane for an MH-susceptible patient)
  steps = steps.map((s) => {
    if (!s.fallback || !getDrug(lib, s.drugId)) return s;
    const rec = recommend(patient, s.regimenKey, s.drugId, lib);
    if (!rec.locked) return s;
    swap.set(s.drugId, s.fallback.drugId);
    substitutions.push({ from: s.drugId, to: s.fallback.drugId, reason: rec.lockReasons.join('; ') });
    return { phase: s.phase, atSec: s.atSec, ...s.fallback };
  });
  steps = steps.map((s) => (s.kind === 'stop' && swap.has(s.drugId) ? { ...s, drugId: swap.get(s.drugId) } : s));
  // lidocaine pretreatment omitted when an IV lidocaine analgesic regimen is planned (Foo 2021 note)
  const lidoAnalgesic = steps.some(isLidoAnalgesic) && !!getDrug(lib, 'lidocaine') && !recommend(patient, 'induction', 'lidocaine', lib).locked;
  steps = steps.filter((s) => { if (s.omitIf === 'lidocaineAnalgesic' && lidoAnalgesic) { omitted.push({ drugId: s.drugId, regimenKey: s.regimenKey, reason: 'IV lidocaine analgesic regimen planned (Foo 2021: every lidocaine dose counts toward the cumulative total)' }); return false; } return true; });
  // de-duplicate stops (e.g. two stops for propofol after a fallback swap)
  const seenStop = new Set();
  steps = steps.filter((s) => { if (s.kind !== 'stop') return true; const k = `${s.phase}|${s.drugId}`; if (seenStop.has(k)) return false; seenStop.add(k); return true; });
  // a stop for a drug that is not started in the plan does nothing: drop it
  steps = steps.filter((s) => s.kind !== 'stop' || steps.some((x) => x.drugId === s.drugId && (x.kind === 'infusion' || x.kind === 'inhaled')));

  const built = buildPlan({ mode: tpl.mode, sedationTarget: target, steps }, patient, lib, { fluidDefaultMlH: FLUID_MODEL.MAINTENANCE_DEFAULT_ML_H });
  // remove stops whose drug was skipped (locked) by buildPlan
  const started = new Set(built.plan.steps.filter((s) => s.kind === 'infusion' || s.kind === 'inhaled').map((s) => s.drugId));
  built.plan.steps = built.plan.steps.filter((s) => s.kind !== 'stop' || started.has(s.drugId));
  // interlock ceiling pre-fill (same rule as the plan editor)
  const prefilled = [];
  if (interlocks && prefillCeilings) {
    for (const s of built.plan.steps) {
      if (s.kind !== 'infusion') continue;
      const py = SIM_TO_PY_ID[s.drugId];
      if (!py || !CONTROLLED.includes(py)) continue;
      const drug = getDrug(lib, s.drugId); const w = rateWeight(drug, patient);
      const pyRate = convertRateSafe(s.rate, s.rateUnit, PY_RATE_UNITS[py], w);
      const ceil = NOA_CONFIG.simulation_rate_ceilings[py];
      if (pyRate === null || aboveCeiling(pyRate, ceil)) {
        const v = s.rateUnit === PY_RATE_UNITS[py] ? ceil : convertRateSafe(ceil, PY_RATE_UNITS[py], s.rateUnit, w);
        prefilled.push({ drugId: s.drugId, from: s.rate, to: v === null ? 0 : roundSig(v, 12), unit: s.rateUnit });
        s.rate = v === null ? 0 : (s.rateUnit === PY_RATE_UNITS[py] ? ceil : Math.floor(v * 1e6) / 1e6);
      }
    }
  }
  const N = lib.TEMPLATE_NOTES || {};
  const notes = (tpl.notes || []).filter((k) => N[k] && (k !== 'lidocaineOverlap' || omitted.length) && (k !== 'dexInterlock' || interlocks)).map((k) => ({ key: k, text: N[k].text, sources: [...N[k].sources] }));
  built.plan.template = { id: tpl.id, label: tpl.label };
  return { ...built, notes, substitutions, omitted, prefilled, template: tpl };
}
