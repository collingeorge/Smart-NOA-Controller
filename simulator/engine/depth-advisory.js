// Advisory: processed-EEG depth index below the GA band — TEXT ONLY (owner-approved feature, 2026-11).
// Pure; no DOM; deterministic. EDUCATIONAL SIMULATION — fictional patients — not a medical device,
// not clinical decision support.
//
// The illustrative depth model reads ~34–39 at label-default maintenance doses; the owner chose a
// "lighten anaesthetic" advisory over recalibrating the model. The advisory:
//   - suggests NO drug, dose, rate or concentration (teaching checklist only);
//   - is NOT an alarm: it adds nothing to the alarm list, guided/automatic modes never pause for it,
//     it never acknowledges an alarm, never releases a hold and never changes a dose or rate;
//   - reuses the GA band (engine/timing.js TIMING_CONFIG.GA_DEPTH_BAND, B-Unaware [S52] / BAG-RECALL [S53]);
//     the sustain time and the clearing hysteresis are simulator conventions
//     (TIMING_CONFIG.DEPTH_LOW_ADVISORY_SUSTAIN_SEC, DEPTH_LOW_ADVISORY_CLEAR).
// It applies during maintenance AFTER incision; before incision the pre-incision item ("acknowledge an
// index below the GA band", engine/timing.js preIncisionItems) remains the gate and is not touched here.
// createDepthAdvisor(sim) records what was shown / dismissed (debrief, session JSON); sim.step() calls
// update() after every step; sim._refreshDepthAdvisor() calls update({ refreshOnly: true }) after an action.

import { TIMING_CONFIG } from './timing.js';
import { isFiniteNumber } from './units.js';

const cfg = (k) => TIMING_CONFIG[k].value;
export const DEPTH_BAND_SOURCES = Object.freeze([...TIMING_CONFIG.GA_DEPTH_BAND.sourceIds]);

export const DEPTH_LOW_DISCLAIMER = 'Advisory only — the simulator never changes a dose by itself.';

/** Footnote under the card (text; the source tags are rendered from DEPTH_BAND_SOURCES). */
export function depthLowFootnote() {
  const [lo, hi] = cfg('GA_DEPTH_BAND');
  return `${DEPTH_LOW_DISCLAIMER} Simulated index (illustrative); the ${lo}–${hi} band is the protocol target used in B-Unaware/BAG-RECALL`;
}

/** Teaching checklist (no drug, no dose, no rate, no percentage). */
export const DEPTH_LOW_CHECKLIST = Object.freeze([
  'Review the volatile concentration (end-tidal / MAC) or the propofol infusion rate against the plan.',
  'Consider haemodynamics: if the patient is hypotensive, anaesthetic depth may be contributing.',
  'Confirm the planned depth target and the current surgical stimulus.',
  'Check for sensor artefact (electrode contact, signal quality) before acting on a number.',
]);

/**
 * Is the depth-low advisory armed now? GA plan, airway secured, loss of consciousness reached (the
 * depth-high alarm's LOC marker), maintenance phase after incision, not "agents off" after the end of
 * surgery, usable index. Pure read of the simulation.
 * -> { armed, reason }
 */
export function depthLowArmed(sim) {
  const S = sim.state;
  const no = (reason) => ({ armed: false, reason });
  if (!sim.plan || sim.plan.mode === 'MAC') return no('not general anaesthesia');
  if (S.phase !== 'maintenance') return no(`phase ${S.phase}`);
  if (!S.airway.secured) return no('airway not secured');
  if (sim._locAt === null || sim._locAt === undefined) return no('before loss of consciousness');
  if (!sim.stim || sim.stim.surgeryStartAt === null) return no('before incision (pre-incision verification applies)');
  if ((S.sensors && S.sensors.depth === 'fault') || !isFiniteNumber(S.vitals.depthIndex)) return no('depth reading unusable');
  if (sim.stim.surgeryEndAt !== null && sim._hypnoticSeenRunning && typeof sim._maintenanceHypnoticRunning === 'function' && !sim._maintenanceHypnoticRunning()) return no('maintenance hypnotics stopped after surgery');
  return { armed: true, reason: null };
}

const mmss = (sec) => { const s = Math.max(0, Math.round(sec)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

class DepthLowAdvisor {
  constructor(sim) {
    this.sim = sim;
    this.entries = []; this.seq = 0;
    this.open = null;          // entry of the current episode (also after Dismiss, until the episode ends)
    this.active = false;       // episode in progress (sustained below the band; until the clearing value)
    this.dismissed = false;    // the clinician dismissed this episode's card
    this.runSec = 0;           // consecutive time below the band (before activation)
    this.episodeSec = 0;       // time since the episode started counting
    this.totalBelowSec = 0;    // time below the band while armed (whole case)
    this.lastT = null;
    sim.depthAdvisor = this;
  }

  _t() { return this.sim.state.tSec; }
  _log(msg) { this.sim.logNote('advisory', msg); }
  _end(note) {
    const x = this.open;
    if (x) {
      x.endedAtSec = this._t(); x.episodeSec = Math.round(this.episodeSec);
      if (x.status === 'shown') { x.status = 'expired'; x.resolvedAtSec = this._t(); x.note = note; this._log(`ADVISORY ${x.status}: ${x.id} — ${note}`); }
    }
    this.open = null; this.active = false; this.dismissed = false; this.runSec = 0; this.episodeSec = 0;
  }

  /**
   * Re-evaluates after a step. Records only: never doses, never touches alarms, holds or the runner.
   * `{ refreshOnly: true }` (sim._refreshDepthAdvisor, after an action / drug change / phase change, audit
   * 05l): zero elapsed time — it never accumulates time, never moves lastT, never starts an episode; it only
   * ends an active episode that is now disarmed or recovered. Time is counted only by the post-step update().
   */
  update({ refreshOnly = false } = {}) {
    if (refreshOnly) {
      if (this.active) {
        const { armed, reason } = depthLowArmed(this.sim); const idx = this.sim.state.vitals.depthIndex;
        if (!armed) this._end(`advisory disarmed (${reason})`);
        else if (idx >= cfg('DEPTH_LOW_ADVISORY_CLEAR')) this._end(`index recovered to ${idx} (≥ ${cfg('DEPTH_LOW_ADVISORY_CLEAR')})`);
      }
      return this.view();
    }
    const t = this._t(); const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT); this.lastT = t;
    const [lo, hi] = cfg('GA_DEPTH_BAND');
    const N = cfg('DEPTH_LOW_ADVISORY_SUSTAIN_SEC'); const clr = cfg('DEPTH_LOW_ADVISORY_CLEAR');
    const { armed, reason } = depthLowArmed(this.sim);
    const idx = this.sim.state.vitals.depthIndex;
    if (armed && idx < lo) this.totalBelowSec += dt;
    if (this.active) {
      if (!armed) this._end(`advisory disarmed (${reason})`);
      else if (idx >= clr) this._end(`index recovered to ${idx} (≥ ${clr})`);
      else this.episodeSec += dt;
      return this.view();
    }
    this.runSec = armed && idx < lo ? this.runSec + dt : 0;
    if (armed && this.runSec >= N - 1e-9) {
      this.active = true; this.dismissed = false; this.episodeSec = this.runSec;
      const x = { id: `DEPTH-${++this.seq}`, kind: 'depth_low', shownAtSec: t, index: idx, status: 'shown', resolvedAtSec: null, endedAtSec: null, episodeSec: null, note: null, sources: [...DEPTH_BAND_SOURCES] };
      this.entries.push(x); this.open = x;
      this._log(`ADVISORY shown: ${x.id} — processed-EEG depth index ${idx} below the GA target band (${lo}–${hi}) for ≥ ${N} s: the anaesthetic may be deeper than needed (text only; no dose changed) [${DEPTH_BAND_SOURCES.join(', ')}].`);
    }
    return this.view();
  }

  /** What the card shows (plain data). */
  view() {
    const [lo, hi] = cfg('GA_DEPTH_BAND'); const N = cfg('DEPTH_LOW_ADVISORY_SUSTAIN_SEC');
    const x = this.open; const idx = this.sim.state.vitals.depthIndex;
    const visible = this.active && !this.dismissed && !!x;
    return {
      kind: this.active ? 'depth_low' : 'none', visible, dismissed: this.dismissed,
      headline: x ? `Depth index ${x.index} below the GA target band (${lo}–${hi}) for ≥ ${N} s — the anaesthetic may be deeper than needed.` : '',
      current: isFiniteNumber(idx) ? `Current index ${idx} (simulated) · below the band for ${mmss(this.episodeSec)} in this episode · ${mmss(this.totalBelowSec)} in this case.` : '',
      checklist: [...DEPTH_LOW_CHECKLIST], footnote: depthLowFootnote(), sources: [...DEPTH_BAND_SOURCES], disclaimer: DEPTH_LOW_DISCLAIMER,
      entry: x ? { ...x, sources: [...x.sources] } : null,
      canDismiss: !!(x && x.status === 'shown' && !this.dismissed),
    };
  }

  /** The clinician dismissed the card (logged); hidden for the rest of this episode. */
  dismiss(id) {
    const x = this.open;
    if (!x || x.id !== id || x.status !== 'shown') return { ok: false, message: `Advisory ${id} is not open.` };
    x.status = 'dismissed'; x.resolvedAtSec = this._t(); x.note = 'dismissed by the clinician';
    this.dismissed = true;
    const msg = `ADVISORY dismissed by the clinician: ${x.id} (depth index below the GA band; text only, no dose changed).`;
    this._log(msg);
    return { ok: true, message: msg };
  }

  /** For sim.summary().depthAdvisories, the debrief and the session JSON. */
  record() {
    const [lo, hi] = cfg('GA_DEPTH_BAND');
    return {
      used: true, shown: this.entries.length, dismissed: this.entries.filter((x) => x.status === 'dismissed').length,
      entries: this.entries.map((x) => ({ ...x, sources: [...x.sources], episodeSec: x.episodeSec === null && x === this.open ? Math.round(this.episodeSec) : x.episodeSec })),
      totalBelowBandSec: Math.round(this.totalBelowSec), band: [lo, hi],
      sustainSec: cfg('DEPTH_LOW_ADVISORY_SUSTAIN_SEC'), clearAt: cfg('DEPTH_LOW_ADVISORY_CLEAR'),
      note: `${DEPTH_LOW_DISCLAIMER} Text-only advisory (no drug, dose or rate suggested); not an alarm. Time below the band counts GA maintenance after incision with the airway secured (simulated index; illustrative).`,
    };
  }
}

export { DepthLowAdvisor };

/** Creates (or returns the existing) depth-low advisor for `sim`; sim.step() then updates it every step. */
export function createDepthAdvisor(sim) {
  if (sim.depthAdvisor instanceof DepthLowAdvisor) return sim.depthAdvisor;
  const a = new DepthLowAdvisor(sim);
  a.update();
  return a;
}
