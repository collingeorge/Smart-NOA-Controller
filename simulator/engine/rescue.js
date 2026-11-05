// Advisory haemodynamic rescue (owner-approved feature, 2026-11). Pure; no DOM; deterministic.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device, not clinical decision support.
//
// evaluateRescue(sim) reads the simulation state and returns an ADVISORY: on MAP < MAP_LOW it suggests a
// label-sourced rescue bolus (agent by HR, dose from the drug library regimen via recommend(), limited by
// the per-bolus and cumulative label maxima and the repeat interval), with rationale, sources and a
// non-drug checklist; on MAP > MAP_HIGH it shows teaching text only (no drug, no dose).
// createRescueAdvisor(sim) records what was shown / accepted / dismissed (for the debrief) and is the
// ONLY path from an advisory to a dose: accept(id), called when the clinician presses
// "Give suggested bolus". Nothing here is called by the guided/automatic runner, nothing here
// acknowledges alarms or releases interlock holds, and update() (run after every sim.step) never doses.
// Every rule and timing: engine/rescue-config.js (RESCUE_CONFIG).

import { ALARM_THRESHOLDS } from './sim.js';
import { RESCUE_CONFIG, ADVISORY_DISCLAIMER, HYPOTENSION_CHECKLIST, HYPERTENSION_CHECKLIST } from './rescue-config.js';
import { recommend } from './dosing.js';
import { getDrug } from './library.js';
import { convertAmount, isFiniteNumber, roundSig } from './units.js';

export { RESCUE_CONFIG, ADVISORY_DISCLAIMER };

const mmss = (sec) => { const s = Math.max(0, Math.ceil(sec - 1e-9)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** Threshold value of a config entry: resolved from sim.js ALARM_THRESHOLDS when the entry has `ref` (reused, not redefined). */
export function rescueValue(key, config = RESCUE_CONFIG) {
  const x = config[key];
  if (!x) throw new Error(`RESCUE_CONFIG: unknown entry ${key}`);
  return x.ref ? ALARM_THRESHOLDS[x.ref] : x.value;
}

/** Repeat interval (s) after a bolus of `drugId`. */
function repeatIntervalSec(drugId, config) {
  const hit = Object.values(config).find((x) => x.drugId === drugId);
  return hit ? hit.value : config.OTHER_VASOPRESSOR_REASSESS_SEC.value;
}

/** Most recent vasopressor bolus (any source) from the dose log, or null. */
function lastVasopressorBolus(sim) {
  const log = sim.doseLog || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const d = log[i];
    if (d.kind !== 'bolus') continue;
    const drug = getDrug(sim.lib, d.drugId);
    if (drug && drug.cls === 'vasopressor') return { ...d, name: drug.name };
  }
  return null;
}

/** Remaining amount allowed by the label ceilings (per bolus and cumulative), in the drug's amount unit. */
function allowance(sim, drug) {
  const limits = (sim.ceilings && sim.ceilings[drug.id]) || [];
  const ds = sim.state.drugs[drug.id];
  const pendingTimed = (sim.timed || []).filter((x) => x.drugId === drug.id).reduce((a, x) => a + x.remaining, 0);
  let perBolus = Infinity; let remaining = Infinity; let label = null; let given = 0;
  for (const L of limits) {
    if (L.route && L.route !== 'IV') continue;
    if (L.type === 'bolus') perBolus = Math.min(perBolus, L.absolute);
    if (L.type === 'cumulative') {
      const used = L.bolusOnly ? (sim.bolusGiven && sim.bolusGiven[drug.id]) || 0 : (ds ? ds.cumulative : 0) + pendingTimed;
      if (L.absolute - used < remaining) { remaining = L.absolute - used; label = L.label; given = used; }
    }
  }
  return { perBolus, remaining: Math.max(0, remaining), label, given };
}

function activeAnaphylaxis(sim) {
  const t = sim.state.tSec;
  return (sim.events || []).some((e) => e.def && e.def.id === 'anaphylaxis_hypotension' && (typeof sim._eventIntensity !== 'function' || sim._eventIntensity(e, t) > 0));
}

/**
 * The advisory for the current state (pure read; never changes the simulation).
 * -> { kind: 'none'|'hypotension'|'hypertension'|'sensor', tSec, map, hr, headline, rationale:[…], checklist:[…],
 *      sources:[…], suggestion: { drugId, name, amount, unit, regimenKey, range, timing, sources, selection } | null,
 *      suppressed: { reason, message, remainingSec? } | null, disclaimer }
 */
export function evaluateRescue(sim, config = RESCUE_CONFIG) {
  const S = sim.state; const V = S.vitals; const t = S.tSec;
  const map = V.map; const hr = V.hr;
  const mapOk = isFiniteNumber(map) && S.sensors.map !== 'fault';
  const hrOk = isFiniteNumber(hr) && S.sensors.hr !== 'fault';
  const low = rescueValue('TRIGGER_MAP_BELOW', config); const high = rescueValue('HIGH_MAP_ADVICE_ABOVE', config);
  const base = { tSec: t, map: mapOk ? map : null, hr: hrOk ? hr : null, rationale: [], checklist: [], sources: [], suggestion: null, suppressed: null, disclaimer: ADVISORY_DISCLAIMER };
  if (!mapOk) {
    return { ...base, kind: 'sensor', headline: 'MAP reading unusable — check the cuff / transducer.',
      rationale: ['No dose is suggested while the blood-pressure reading is unusable (simulator convention).'],
      checklist: [HYPOTENSION_CHECKLIST[3]], suppressed: { reason: 'sensor', message: 'MAP sensor fault — no suggestion until the reading is usable.' } };
  }
  if (map > high) {
    return { ...base, kind: 'hypertension', headline: `MAP ${map} > ${high} mmHg — review depth and analgesia; check the sensor.`,
      rationale: ['Teaching text only: no drug and no dose is suggested (no verified dosing source).'], checklist: [...HYPERTENSION_CHECKLIST] };
  }
  if (!(map < low)) return { ...base, kind: 'none', headline: '' };

  const out = { ...base, kind: 'hypotension', headline: `MAP ${map} < ${low} mmHg — hypotension.`, checklist: [...HYPOTENSION_CHECKLIST] };
  const sup = (reason, message, extra = {}) => ({ ...out, suppressed: { reason, message, ...extra } });
  if (config.SUPPRESS_DURING_ANAPHYLAXIS.value && activeAnaphylaxis(sim)) {
    return sup('anaphylaxis', 'Anaphylaxis scenario active: no phenylephrine/ephedrine suggestion. Epinephrine is the scenario agent and stays a manual choice — see the scenario teaching point and the Sources panel.');
  }
  if (!hrOk) return sup('sensor', 'HR reading unusable — agent selection needs HR; no suggestion until the reading is usable.');

  // Agent selection (simulator convention).
  const hrBelow = config.AGENT_SELECTION_HR_BELOW.value;
  const [phen, ephed] = config.RESCUE_AGENTS.value;
  const drugId = hr < hrBelow ? ephed : phen;
  const selection = `HR ${hr} ${hr < hrBelow ? `< ${hrBelow}` : `≥ ${hrBelow}`} /min → ${drugId} (simulator convention: ephedrine when HR is low, phenylephrine when HR is normal or high)`;
  const drug = getDrug(sim.lib, drugId);
  if (!drug) return sup('unavailable', `${drugId} is not in the drug library — no suggestion.`);
  out.rationale.push(selection);

  // Repeat interval since the last vasopressor bolus (any source).
  const last = lastVasopressorBolus(sim);
  if (last) {
    const need = repeatIntervalSec(last.drugId, config);
    const remainingSec = last.tSec + need - t;
    if (remainingSec > 1e-9) {
      const src = Object.values(config).find((x) => x.drugId === last.drugId);
      return sup('interval', `Reassess — next dose allowed in ${mmss(remainingSec)} (last vasopressor bolus: ${last.name} at ${mmss(last.tSec)}; interval ${need} s, ${src && src.provenance === 'fda_label' ? `label [${src.sourceIds.join(', ')}]` : 'simulator convention'}).`, { remainingSec: Math.ceil(remainingSec - 1e-9) });
    }
  }

  const lock = S.interlocks.lockouts && S.interlocks.lockouts[drugId];
  const rec = recommend(sim.patient, config.REGIMEN_KEY.value, drugId, sim.lib);
  if (lock || rec.locked) return sup('locked', `${drug.name} is locked out for this patient (${(lock || rec.lockReasons || []).join('; ')}) — no suggestion.`);
  if (!rec.dose || rec.kind !== 'bolus') return sup('unavailable', `${drug.name}: no label rescue bolus in the drug library — no suggestion.`);

  // Dose: regimen default, capped by the regimen max, per-bolus and cumulative label maxima.
  const unit = drug.amountUnit;
  const toUnit = (v) => convertAmount(v, rec.dose.unit, unit);
  const def = toUnit(rec.dose.value); const min = toUnit(rec.dose.range.min); const max = toUnit(rec.dose.range.max);
  const A = allowance(sim, drug);
  const amount = Math.min(def, max, A.perBolus, A.remaining);
  if (amount < min - 1e-9) {
    return sup('cumulative', `${drug.name}: label maximum reached (${A.label || 'cumulative label maximum'}; given ${roundSig(A.given)} ${unit}) — consider other causes / escalate; not simulated.`);
  }
  out.sources = [...rec.sources];
  out.suggestion = {
    drugId, name: drug.name, amount: roundSig(amount), unit, regimenKey: config.REGIMEN_KEY.value, route: 'IV',
    range: { min: roundSig(min), max: roundSig(max) }, timing: rec.timing || '', sources: [...rec.sources], selection,
    capped: amount < def - 1e-9 ? `reduced from the regimen default ${roundSig(def)} ${unit} to stay within ${A.label}` : null,
    cumulativeLeft: Number.isFinite(A.remaining) ? roundSig(A.remaining - amount) : null, cumulativeLabel: A.label,
  };
  out.rationale.push(`Dose: ${drug.name} ${roundSig(amount)} ${unit} IV bolus — label rescue regimen ${roundSig(min)}–${roundSig(max)} ${unit} [${rec.sources.join(', ')}]${out.suggestion.capped ? `, ${out.suggestion.capped}` : ' (regimen default)'}.`);
  if (rec.timing) out.rationale.push(`Label timing: ${rec.timing}`);
  return out;
}

class RescueAdvisor {
  constructor(sim, config) {
    this.sim = sim; this.config = config;
    this.entries = []; this.seq = 0;
    this.open = { hypotension: null, hypertension: null };
    this.episode = { hypotension: false, hypertension: false };
    this.dismissed = { hypotension: false, hypertension: false };
    this.lastView = null;
    sim.rescueAdvisor = this;
  }

  _t() { return this.sim.state.tSec; }
  _log(msg) { this.sim.logNote('advisory', msg); }
  _close(kind, status, note) {
    const x = this.open[kind]; if (!x) return;
    if (x.status === 'shown') { x.status = status; x.resolvedAtSec = this._t(); x.note = note; this._log(`ADVISORY ${status}: ${x.id} — ${note}`); }
    this.open[kind] = null;
  }
  _openEntry(kind, v) {
    const s = v.suggestion;
    const x = { id: `ADV-${++this.seq}`, kind, shownAtSec: this._t(), map: v.map, hr: v.hr, status: 'shown', resolvedAtSec: null, note: null,
      drugId: s ? s.drugId : null, name: s ? s.name : null, amount: s ? s.amount : null, unit: s ? s.unit : null, sources: s ? [...s.sources] : [],
      key: s ? `${s.drugId}|${s.amount}` : kind, selection: s ? s.selection : null };
    this.entries.push(x); this.open[kind] = x;
    this._log(kind === 'hypotension'
      ? `ADVISORY shown: ${x.id} — MAP ${v.map}, HR ${v.hr}: suggested ${s.name} ${s.amount} ${s.unit} IV bolus [${s.sources.join(', ')}] (${s.selection}). Not given unless the clinician accepts it.`
      : `ADVISORY shown: ${x.id} — MAP ${v.map} > ${rescueValue('HIGH_MAP_ADVICE_ABOVE', this.config)} mmHg: review depth/analgesia, check the sensor (text only; no drug suggested).`);
    return x;
  }

  /** Re-evaluates and updates the record. Called after every sim.step; NEVER gives a drug. */
  update() {
    const v = evaluateRescue(this.sim, this.config); this.lastView = v;
    const map = v.map;
    // Hypotension episode: starts on MAP < trigger, ends on MAP ≥ the alarm clearing value.
    if (v.kind === 'hypotension') this.episode.hypotension = true;
    else if (this.episode.hypotension && map !== null && map >= rescueValue('EPISODE_CLEAR_MAP_AT_OR_ABOVE', this.config)) {
      this._close('hypotension', 'expired', `MAP recovered to ${map} mmHg`);
      this.episode.hypotension = false; this.dismissed.hypotension = false;
    }
    const cur = this.open.hypotension;
    if (v.suggestion && !this.dismissed.hypotension) {
      const key = `${v.suggestion.drugId}|${v.suggestion.amount}`;
      if (cur && cur.key !== key) this._close('hypotension', 'superseded', `suggestion changed to ${v.suggestion.name} ${v.suggestion.amount} ${v.suggestion.unit}`);
      if (!this.open.hypotension) this._openEntry('hypotension', v);
    } else if (cur && v.suppressed && v.suppressed.reason !== 'sensor') {
      this._close('hypotension', 'withdrawn', v.suppressed.message);
    }
    // High-MAP advisory (text only).
    if (v.kind === 'hypertension') {
      this.episode.hypertension = true;
      if (!this.open.hypertension && !this.dismissed.hypertension) this._openEntry('hypertension', v);
    } else if (this.episode.hypertension && map !== null && map <= rescueValue('HIGH_MAP_EPISODE_CLEAR_AT_OR_BELOW', this.config)) {
      this._close('hypertension', 'expired', `MAP ${map} mmHg`);
      this.episode.hypertension = false; this.dismissed.hypertension = false;
    }
    return this.view();
  }

  /** What the advisory card shows (plain data). */
  view() {
    const v = this.lastView || evaluateRescue(this.sim, this.config);
    const kind = v.kind === 'none' && this.episode.hypotension ? 'hypotension_recovering' : v.kind;
    const entry = v.kind === 'hypertension' ? this.open.hypertension : this.open.hypotension;
    const dismissed = v.kind === 'hypertension' ? this.dismissed.hypertension : (v.kind === 'hypotension' || kind === 'hypotension_recovering') && this.dismissed.hypotension;
    const lastDismissed = [...this.entries].reverse().find((x) => x.status === 'dismissed' && x.kind === (v.kind === 'hypertension' ? 'hypertension' : 'hypotension')) || null;
    return {
      ...v, kind, visible: kind !== 'none', dismissed, dismissedAtSec: dismissed && lastDismissed ? lastDismissed.resolvedAtSec : null,
      entry: entry ? { ...entry, sources: [...entry.sources] } : null,
      canAccept: !!(entry && entry.kind === 'hypotension' && entry.status === 'shown' && v.suggestion && !dismissed),
      canDismiss: !!(entry && entry.status === 'shown' && !dismissed),
    };
  }

  /** The clinician accepted the suggestion: gives exactly the suggested bolus through sim.administer(). */
  accept(id) {
    const v = evaluateRescue(this.sim, this.config); this.lastView = v;
    const x = this.open.hypotension;
    if (!x || x.id !== id || x.status !== 'shown' || this.dismissed.hypotension) return { ok: false, message: `Advisory ${id} is not open.` };
    const s = v.suggestion;
    if (!s || `${s.drugId}|${s.amount}` !== x.key) return { ok: false, message: `Advisory ${id} no longer applies${v.suppressed ? `: ${v.suppressed.message}` : ' (MAP is not below the trigger now)'} — nothing given.` };
    this._log(`ADVISORY accepted by the clinician: ${x.id} — ${s.name} ${s.amount} ${s.unit} IV bolus (clinician-approved) [${s.sources.join(', ')}]`);
    const r = this.sim.administer({ drugId: s.drugId, kind: 'bolus', amount: s.amount, amountUnit: s.unit, route: 'IV', regimenKey: s.regimenKey }, { source: 'advisory' });
    x.status = r.ok ? 'accepted' : 'accept_blocked'; x.resolvedAtSec = this._t(); x.note = r.ok ? 'clinician-approved bolus given' : r.reasons.join('; ');
    this.open.hypotension = null;
    if (!r.ok) this._log(`ADVISORY ${x.id}: bolus blocked — ${r.reasons.join('; ')}`);
    this.lastView = evaluateRescue(this.sim, this.config);
    return { ok: r.ok, message: r.ok ? `ADVISORY accepted: ${s.name} ${s.amount} ${s.unit} IV bolus given (clinician-approved) [${s.sources.join(', ')}].` : `Not given: ${r.reasons.join('; ')}`, warnings: r.warnings || [] };
  }

  /** The clinician dismissed the advisory (logged); it stays hidden for the rest of this episode. */
  dismiss(id) {
    const x = this.entries.find((e) => e.id === id);
    if (!x || x.status !== 'shown' || this.open[x.kind] !== x) return { ok: false, message: `Advisory ${id} is not open.` };
    x.status = 'dismissed'; x.resolvedAtSec = this._t(); x.note = 'dismissed by the clinician';
    this.dismissed[x.kind] = true; this.open[x.kind] = null;
    const msg = `ADVISORY dismissed by the clinician: ${x.id}${x.drugId ? ` (${x.name} ${x.amount} ${x.unit} not given)` : ''}.`;
    this._log(msg);
    return { ok: true, message: msg };
  }

  /** For sim.summary().advisories, the debrief and the session JSON. */
  record() {
    const n = (st) => this.entries.filter((x) => x.status === st).length;
    return {
      used: true, shown: this.entries.length, accepted: n('accepted'), dismissed: n('dismissed'),
      entries: this.entries.map(({ key: _k, ...x }) => ({ ...x, sources: [...x.sources] })),
      note: `${ADVISORY_DISCLAIMER} Suggestions are given only when the clinician accepts them (logged "ADVISORY accepted").`,
    };
  }
}

export { RescueAdvisor };

/** Creates (or returns the existing) advisor for `sim`; sim.step() then updates it every step. */
export function createRescueAdvisor(sim, { config = RESCUE_CONFIG } = {}) {
  if (sim.rescueAdvisor instanceof RescueAdvisor) return sim.rescueAdvisor;
  const a = new RescueAdvisor(sim, config);
  a.update();
  return a;
}
