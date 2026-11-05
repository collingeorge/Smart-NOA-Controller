// Plan-level safety checks (final-check fixes, 2026-11). Pure; no DOM; deterministic.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device, not clinical advice.
//
// computeLockouts(): the SAME lockout set the simulation enforces (drug-library LOCK rules + the
//   Python controller's configured free-text lockouts, config.yaml). sim.js uses it at case start.
// maintenanceHypnoticGap(): a GENERIC check over plan steps × lockouts. When a lockout removes the
//   only maintenance hypnotic from a GA plan (e.g. a volatile locked for an MH-susceptible patient,
//   propofol locked for a propofol allergy), the plan editor and the guided "Approve & start
//   induction" gate show a blocking warning and the full demonstration refuses to start. It never
//   changes the plan.
// tivaMaintenanceSteps(): the optional one-click "Add propofol TIVA maintenance" — the propofol
//   maintenance regimen filled by recommend() through buildPlan() (no number of its own), applied
//   only when the clinician presses the button (the caller logs it).

import { resolveLibrary, getDrug, listDrugs } from './library.js';
import { evaluateContraindications } from './dosing.js';
import { pythonLockouts, PY_TO_SIM_ID } from './interlocks.js';
import { buildPlan } from '../data/scenarios.js';
import { TIVA_RATIONALE } from '../data/templates.js';

/** Drug classes that can carry GA maintenance hypnosis on their own in this simulator (N2O, dexmedetomidine, ketamine do not). */
export const MAINTENANCE_HYPNOTIC_CLASSES = Object.freeze(['volatile', 'hypnotic']);
const MAINT_PHASES = ['induction', 'maintenance'];

/**
 * computeLockouts(patientDerived, library) -> { lockouts: { [drugId]: [reason…] }, pyLocks: [Python drug names] }
 * Library LOCK contraindications + Python free-text lockouts (case-insensitive substring match on ids/labels).
 */
export function computeLockouts(p, library = null) {
  const lib = resolveLibrary(library);
  const lockouts = {};
  for (const d of listDrugs(lib)) {
    const locks = evaluateContraindications(p, d.id, lib).filter((c) => c.severity === 'lock').map((c) => c.message);
    if (locks.length) lockouts[d.id] = locks;
  }
  const labelOf = (list, id) => { const x = (lib[list] || []).find((e) => e.id === id); return x ? x.label : ''; };
  const freeText = (ids, list) => (ids || []).flatMap((id) => [id.replace(/_/g, ' '), labelOf(list, id)]).filter(Boolean);
  const pyLocks = pythonLockouts({ egfr: p.egfr, allergies: freeText(p.allergies, 'ALLERGIES'), comorbidities: freeText(p.conditions, 'CONDITIONS') });
  const pySrc = (lib.SOURCE_IDS_ENGINE && lib.SOURCE_IDS_ENGINE.pythonConfig) || null;
  for (const py of pyLocks) {
    const id = PY_TO_SIM_ID[py];
    if (!getDrug(lib, id)) continue;
    (lockouts[id] = lockouts[id] || []).push(`Python controller configured lockout (config.yaml${pySrc ? ` [${pySrc}]` : ''}; case-insensitive free-text match)`);
  }
  return { lockouts, pyLocks };
}

/** Is this (plan or removed) step a GA maintenance hypnotic: a running infusion / vaporizer setting of a hypnotic class, started in induction or maintenance? */
export function isMaintenanceHypnoticStep(lib, s) {
  if (!s || s.invalid || !MAINT_PHASES.includes(s.phase) || !['infusion', 'inhaled'].includes(s.kind)) return false;
  const d = getDrug(lib, s.drugId);
  return !!d && MAINTENANCE_HYPNOTIC_CLASSES.includes(d.cls);
}

/**
 * maintenanceHypnoticGap(plan, patientDerived, { library, lockouts })
 *  plan.steps                — steps still in the plan (a locked one stays listed but is blocked at run time)
 *  plan.lockoutRemoved       — steps the plan builder dropped because the drug is locked (buildPlan)
 * -> { blocking, message, locked:[{ drugId, name, reason }], usable:[drugId], tivaAvailable }
 * blocking = GA plan, at least one maintenance hypnotic was planned but every one is locked out.
 */
export function maintenanceHypnoticGap(plan, patient, { library = null, lockouts = null } = {}) {
  const lib = resolveLibrary(library);
  const L = lockouts || computeLockouts(patient, lib).lockouts;
  const none = { blocking: false, message: null, locked: [], usable: [], tivaAvailable: false };
  if (!plan || plan.mode === 'MAC') return none;
  const present = (plan.steps || []).filter((s) => isMaintenanceHypnoticStep(lib, s));
  const removed = (plan.lockoutRemoved || []).filter((s) => isMaintenanceHypnoticStep(lib, s));
  const usable = [...new Set(present.filter((s) => !L[s.drugId]).map((s) => s.drugId))];
  const locked = [];
  for (const s of [...present.filter((x) => L[x.drugId]), ...removed]) {
    if (locked.some((x) => x.drugId === s.drugId)) continue;
    const d = getDrug(lib, s.drugId);
    locked.push({ drugId: s.drugId, name: d ? d.name : s.drugId, reason: (L[s.drugId] || [s.reason || 'locked for this patient']).join('; ') });
  }
  const tivaAvailable = !L.propofol && !!getDrug(lib, 'propofol');
  if (usable.length || !locked.length) return { ...none, locked, usable, tivaAvailable };
  const what = locked.map((x) => `${x.name} is contraindicated (${x.reason.replace(/[.\s]+$/, '')})`).join('; ');
  return {
    blocking: true, locked, usable, tivaAvailable,
    message: `No maintenance hypnotic after lockout: ${what}. Add an alternative (e.g. propofol infusion — TIVA) before approving.`,
  };
}

/**
 * Engine-plan steps for "Add propofol TIVA maintenance": the propofol maintenance regimen at maintenance
 * +0:00 (and its loading dose, if the regimen has one), stopped at the start of emergence. Every value comes
 * from recommend() via buildPlan(). -> { steps, skipped }
 */
export function tivaMaintenanceSteps(patient, library = null) {
  const lib = resolveLibrary(library);
  const { plan, skipped } = buildPlan({ mode: 'GA', sedationTarget: null, steps: [
    { phase: 'maintenance', atSec: 0, kind: 'infusion', drugId: 'propofol', regimenKey: 'maintenance', timingRationale: TIVA_RATIONALE.start },
    { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'propofol', timingRationale: TIVA_RATIONALE.stop },
  ] }, patient, lib);
  const started = plan.steps.some((s) => s.kind === 'infusion');
  return { steps: started ? plan.steps.map((s) => ({ ...s, addedBy: 'clinician_tiva' })) : [], skipped };
}
