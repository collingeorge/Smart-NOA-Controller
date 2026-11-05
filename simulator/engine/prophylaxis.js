// Surgical antibiotic prophylaxis: agent selection, timing window and redosing (2026-11 additions).
// Pure; no DOM. EDUCATIONAL SIMULATION — fictional patients — not a medical device.
//
// TIMING ONLY: antibiotic pharmacology is not modelled (no PK/PD, no infection outcome). Every dose
// and timing value comes from the drug library (data/drugs.js ANTIBIOTICS, Bratzler 2013 = S46);
// this module only compares times. The checklist rule (manual: a warning the clinician must acknowledge;
// guided/automatic: a required pre-incision item) is a simulator convention; it never acknowledges itself.

import { listAntibiotics, getAntibiotic, resolveLibrary } from './library.js';
import { evaluateContraindications } from './dosing.js';

export const CONVENTION = 'simulator convention (unsourced)';
const e = (value, unit, rationale, provenance = CONVENTION, sourceIds = []) => Object.freeze({ value, unit, rationale, provenance, sourceIds: Object.freeze([...sourceIds]) });

/** Alarm and checklist settings (inventory component 'prophylaxis'). */
export const PROPHYLAXIS_CONFIG = Object.freeze({
  WINDOW_ALARM_PRIORITY: e('medium', 'alarm priority', 'Alarm "Surgery started without antibiotic prophylaxis in the recommended window" (owner-approved additions spec). Latched until acknowledged.'),
  REDOSE_ALARM_PRIORITY: e('medium', 'alarm priority', 'Alarm "Prophylaxis redose due" once the guideline redosing interval has elapsed since the start of the last dose, while surgery is in progress.'),
  CHECKLIST_REQUIRES_ACK: e(true, 'boolean', 'Manual mode: an antibiotic checklist warning before "Start surgery" can be acknowledged (the window alarm still sounds at incision). Guided and automatic modes (2026-11 timing review): a dose started within the window is a REQUIRED pre-incision item — acknowledgement does not satisfy it; the clinician gives prophylaxis (guided: the gate waits; full demonstration: it pauses). Neither mode ever acknowledges or gives it on its own.'),
  INDICATED_DEFAULT_GA: e(true, 'boolean', 'Plan screen: "Surgical antibiotic prophylaxis indicated" is ticked by default for GA plans and unticked for MAC plans (the simulator does not know the procedure). In the engine a plan without the flag counts as indicated only if it contains an antibiotic step.'),
});

const label = (lib, id) => { const a = getAntibiotic(lib, id); return a ? a.name : id; };
const minStr = (sec) => `${Math.round(sec / 60)} min`;

/**
 * Agent selection (Bratzler 2013, as encoded in PROPHYLAXIS_SELECTION): the first agent in the
 * library order that is not locked for this patient. Returns
 * { drugId|null, alternatives:[ids], locked:[{drugId, reasons}], sources, reason }.
 */
export function selectProphylaxis(patient, library = null) {
  const lib = resolveLibrary(library);
  const order = (lib.PROPHYLAXIS_SELECTION && lib.PROPHYLAXIS_SELECTION.order) || listAntibiotics(lib).map((a) => a.id);
  const sources = (lib.PROPHYLAXIS_SELECTION && [...lib.PROPHYLAXIS_SELECTION.sources]) || [];
  const locked = []; const open = [];
  for (const id of order) {
    if (!getAntibiotic(lib, id)) continue;
    const locks = evaluateContraindications(patient, id, lib).filter((c) => c.severity === 'lock');
    if (locks.length) locked.push({ drugId: id, reasons: locks.map((c) => c.message) }); else open.push(id);
  }
  const drugId = open[0] || null;
  const reason = !drugId ? 'No prophylaxis agent in the library is available for this patient.'
    : locked.length ? `${label(lib, drugId)} selected: ${locked.map((l) => `${label(lib, l.drugId)} locked (${l.reasons.join('; ')})`).join('; ')}.`
      : `${label(lib, drugId)} is the first-line agent.`;
  return { drugId, alternatives: open.slice(1), locked, sources, reason };
}

/** Doses started at or before `atSec` (incision), latest first. */
function dosesBefore(doses, atSec) { return doses.filter((d) => d.tSec <= atSec + 1e-9).sort((a, b) => b.tSec - a.tSec); }

/**
 * Was an antibiotic dose STARTED within its guideline window before incision (`incisionAtSec`)?
 * -> { ok, drugId, minutesBefore, windowMin, message, sources }
 */
export function evaluateWindow(doses, incisionAtSec, library = null) {
  const lib = resolveLibrary(library);
  const prior = dosesBefore(doses || [], incisionAtSec);
  if (!prior.length) {
    const sel = (lib.PROPHYLAXIS_SELECTION && lib.PROPHYLAXIS_SELECTION.sources) || [];
    return { ok: false, drugId: null, minutesBefore: null, windowMin: null, sources: [...sel], message: 'no antibiotic prophylaxis dose was started before incision (Bratzler 2013: begin within 60 min before incision; vancomycin within 120 min)' };
  }
  for (const d of prior) {
    const a = getAntibiotic(lib, d.drugId); if (!a || !a.prophylaxis) continue;
    const w = a.prophylaxis.windowBeforeIncisionMin; const before = incisionAtSec - d.tSec;
    if (before <= w * 60 + 1e-9) return { ok: true, drugId: d.drugId, minutesBefore: Math.round(before / 6) / 10, windowMin: w, sources: [...a.prophylaxis.sources], message: `${a.name} started ${minStr(before)} before incision (window ≤ ${w} min)` };
  }
  const d = prior[0]; const a = getAntibiotic(lib, d.drugId);
  const w = a && a.prophylaxis ? a.prophylaxis.windowBeforeIncisionMin : null; const before = incisionAtSec - d.tSec;
  return { ok: false, drugId: d.drugId, minutesBefore: Math.round(before / 6) / 10, windowMin: w, sources: a && a.prophylaxis ? [...a.prophylaxis.sources] : [], message: `${a ? a.name : d.drugId} was started ${minStr(before)} before incision, outside the ${w} min window` };
}

/**
 * Redosing: for each agent given, due when the guideline interval has elapsed since the start of
 * its last dose. -> { due:boolean, items:[{ drugId, lastSec, intervalMin, dueAtSec, overdueSec }] }
 */
export function redoseStatus(doses, tSec, library = null) {
  const lib = resolveLibrary(library);
  const last = new Map();
  for (const d of doses || []) if (!last.has(d.drugId) || d.tSec > last.get(d.drugId)) last.set(d.drugId, d.tSec);
  const items = [];
  for (const [drugId, lastSec] of last) {
    const a = getAntibiotic(lib, drugId);
    const iv = a && a.prophylaxis ? a.prophylaxis.redoseIntervalMin : null;
    if (!iv) continue;
    const dueAtSec = lastSec + iv * 60;
    items.push({ drugId, name: a.name, lastSec, intervalMin: iv, dueAtSec, overdueSec: tSec - dueAtSec, due: tSec >= dueAtSec - 1e-9, sources: [...a.prophylaxis.sources] });
  }
  return { due: items.some((x) => x.due), items };
}
