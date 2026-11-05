// Guided (phase-gated) mode and the "Run full case automatically" demonstration.
// Pure; no DOM; deterministic. EDUCATIONAL SIMULATION — fictional patients — not a medical device.
//
// A scripted sequence of the SAME case actions the manual Run-screen buttons call
// (engine/case-actions.js). It is not a controller and not a clinical recommendation:
//  * it never gives, changes or stops a drug — only the user's plan steps do that, through the
//    engine's plan scheduler, at the offsets the user set;
//  * it never extubates unless sim.extubationReadiness() is met, and never uses the override;
//  * it pauses on a latched interlock hold or an unacknowledged HIGH-priority alarm and never
//    releases holds or acknowledges alarms itself;
//  * any manual control ends it (takeOver), and every step it takes is logged (kind 'auto').
// Modes:
//  'guided' — the clinician approves every transition (gate buttons); work inside a phase
//             (plan steps, start of surgery/procedure) runs automatically;
//  'full'   — demonstration: gates pass automatically on the timings in autorun-config.js.
// All conditions and timings: engine/autorun-config.js (AUTORUN_CONFIG).

import { AUTORUN_CONFIG } from './autorun-config.js';
import { CASE_ACTIONS } from './case-actions.js';
import { SEDATION_RANK } from './pd.js';
import { TIMING_CONFIG, PREMED_TO_INDUCTION_MIN_SEC, premedStatus, preIncisionItems, liveTimingChecks } from './timing.js';
import { selectProphylaxis } from './prophylaxis.js';
import { recommend } from './dosing.js';

export const AUTORUN_MODES = Object.freeze(['guided', 'full']);
export const MODE_LABELS = Object.freeze({ guided: 'Guided mode', full: 'Automatic demonstration' });
export const BANNERS = Object.freeze({
  full: 'Automatic demonstration: scripted sequence, not a closed-loop controller or a clinical recommendation',
  guided: 'Guided mode: each phase runs from your approved plan; you confirm every transition. Educational simulation — not a closed-loop controller or a clinical recommendation.',
});
const ACTIVE = new Set(['running', 'paused']);
const T = (k) => TIMING_CONFIG[k].value;
// Clinician-only actions the runner performs ONLY when the clinician presses the matching button
// (runner.clinicianAction); the runner never calls them on its own.
export const CLINICIAN_ACTIONS = Object.freeze(['confirm_time_out', 'acknowledge_depth_below_band', 'give_prophylaxis']);

/** The step sequence for a plan mode. Exported for documentation and tests. */
export function buildSequence(planMode, config = AUTORUN_CONFIG) {
  const v = (k) => config[k].value;
  if (planMode === 'MAC') {
    return [
      { id: 'transfer_to_or', label: 'Transfer to OR', gate: true, gateLabel: 'Transfer to OR', check: 'premedInterval', fullWaitSec: v('PRE_INDUCTION_DWELL_SEC'),
        actions: [['transfer_to_or']], describe: `pre-op holding: enabled ${T('PREMED_TO_TRANSFER_SEC') / 60} min after any premedication bolus has ended (countdown shown)` },
      { id: 'start_sedation', label: 'Start sedation', gate: true, gateLabel: 'Approve & start sedation', check: 'orSetup',
        actions: [['set_fio2', v('SEDATION_FIO2')], ['start_sedation']], describe: `after OR setup (${T('OR_SETUP_SEC') / 60} min, monitors): supplemental O2 FiO2 ${v('SEDATION_FIO2')}, then sedation plan steps run at their offsets` },
      { id: 'start_procedure', label: 'Start procedure', gate: true, gateLabel: 'Start procedure', check: 'preProcedure', holdSec: v('SEDATION_TARGET_HOLD_SEC'), timeoutSec: v('SEDATION_TARGET_TIMEOUT_SEC'), actions: [['start_procedure']],
        describe: `pre-procedure verification: plan sedation target held for ${v('SEDATION_TARGET_HOLD_SEC')} s with all sedation plan steps run, antibiotic in window if indicated, and the WHO time out confirmed by the clinician (the full demonstration pauses for it)` },
      { id: 'end_procedure', label: 'End procedure → recovery', gate: true, gateLabel: 'End procedure', fullWaitSec: v('PROCEDURE_DURATION_SEC'),
        actions: [['end_procedure'], ['end_sedation']], describe: 'ends the procedure and starts recovery (plan stop steps run)' },
      { id: 'recovery', label: 'Recovery', gate: false, check: 'recovery', holdSec: v('RECOVERY_HOLD_SEC'), timeoutSec: v('RECOVERY_TIMEOUT_SEC'), actions: [], final: true,
        describe: `complete when sedation level is ${v('RECOVERY_LEVEL_MAX')} or awake` },
    ];
  }
  return [
    { id: 'transfer_to_or', label: 'Transfer to OR', gate: true, gateLabel: 'Transfer to OR', check: 'premedInterval', fullWaitSec: v('PRE_INDUCTION_DWELL_SEC'),
      actions: [['transfer_to_or']], describe: `pre-op holding: enabled ${T('PREMED_TO_TRANSFER_SEC') / 60} min after any premedication bolus has ended (countdown shown)` },
    { id: 'preoxygenate', label: 'OR setup → preoxygenation', gate: false, check: 'orSetup',
      actions: [['set_fio2', v('INDUCTION_FIO2')]], describe: `after OR setup (${T('OR_SETUP_SEC') / 60} min, monitors applied): preoxygenation FiO2 ${v('INDUCTION_FIO2')}` },
    { id: 'start_induction', label: 'Start induction', gate: true, gateLabel: 'Approve & start induction', check: 'preoxygenation',
      actions: [['mask_ventilate'], ['start_induction']], describe: `enabled after ${T('PREOXYGENATION_SEC') / 60} min of preoxygenation and at least ${PREMED_TO_INDUCTION_MIN_SEC / 60} min after the premedication ended (countdown shown); bag-mask ventilation, then induction plan steps run at their offsets` },
    { id: 'secure_airway', label: 'Secure airway', gate: true, gateLabel: 'Intubate (secure airway)', check: 'intubating', timeoutSec: v('INTUBATION_TIMEOUT_SEC'),
      actions: [['secure_airway']], describe: 'enabled when intubating conditions are met; tube + mechanical ventilation' },
    { id: 'start_maintenance', label: 'Start maintenance', gate: true, gateLabel: 'Enter maintenance mode', fullWaitSec: v('MAINTENANCE_AFTER_AIRWAY_SEC'),
      actions: [['start_maintenance']], describe: 'maintenance plan steps run at their offsets' },
    { id: 'start_surgery', label: 'Start surgery', gate: true, gateLabel: 'Start surgery (incision)', check: 'preIncision', timeoutSec: v('SURGERY_START_TIMEOUT_SEC'),
      actions: [['start_surgery']], describe: 'pre-incision verification, no time-based start: airway + ventilation, processed-EEG index in the GA band, analgesia per plan, neuromuscular block adequate, antibiotic in window (required), WHO time out confirmed by the clinician (the full demonstration waits for the state items and pauses for the clinician items; it never confirms them)' },
    { id: 'end_surgery', label: 'End surgery', gate: true, gateLabel: 'End surgery', fullWaitSec: v('SURGERY_DURATION_SEC'), actions: [['end_surgery']], describe: 'clinician-chosen end of surgery' },
    { id: 'begin_emergence', label: 'Begin emergence', gate: true, gateLabel: 'Enter emergence / extubation mode', fullWaitSec: v('CLOSING_BEFORE_EMERGENCE_SEC'),
      actions: [['begin_emergence']], describe: 'emergence plan steps run (agents off, antiemetic, reversal)' },
    { id: 'extubate', label: 'Extubate', gate: true, gateLabel: 'Extubate', check: 'readiness', holdSec: v('READINESS_HOLD_SEC'), timeoutSec: v('EXTUBATION_TIMEOUT_SEC'),
      actions: [['extubate']], describe: 'enabled only when sim.extubationReadiness() is met' },
    { id: 'observe', label: 'Observe after extubation', gate: false, minSec: v('POST_EXTUBATION_OBSERVE_SEC'), actions: [], final: true, describe: 'observation, then complete' },
  ];
}

class AutoRunner {
  constructor({ sim, plan, mode, config, actions, onEvent }) {
    if (!sim) throw new Error('createAutoRunner: sim is required');
    if (!AUTORUN_MODES.includes(mode)) throw new Error(`createAutoRunner: unknown mode '${mode}'`);
    this.sim = sim; this.mode = mode; this.config = config; this.actions = actions; this.onEvent = onEvent;
    this.planMode = (plan || sim.plan).mode === 'MAC' ? 'MAC' : 'GA';
    this.sedationTarget = (plan || sim.plan).sedationTarget || null;
    this.seq = buildSequence(this.planMode, config);
    this.state = 'idle'; this.idx = 0; this.enteredAt = null; this.metSince = null;
    this.lastCheckT = 0; this.timeoutWarned = false;
    this.message = ''; this.pauseReasons = []; this.stopReason = null; this.unmetAtStop = [];
    this.history = []; this.pauses = []; this.startedAtSec = null; this.endedAtSec = null; this.manualControl = null;
  }

  get active() { return ACTIVE.has(this.state); }
  get current() { return this.seq[this.idx] || null; }
  _t() { return this.sim.state.tSec; }
  _v(k) { return this.config[k].value; }
  _log(msg) { this.sim.logNote('auto', `AUTO: ${msg}`); }
  _emit(type, extra = {}) { if (this.onEvent) this.onEvent({ type, message: this.message, status: this.status(), ...extra }); }

  start() {
    const S = this.sim.state;
    if (this.state !== 'idle') return { ok: false, message: 'Already started' };
    const prior = this.sim.autoRun && this.sim.autoRun !== this;
    if (S.phase !== 'premed' || S.airway.secured || prior || (S.periop && S.periop.transferAt !== null)) return { ok: false, message: 'Automatic and guided modes start from the beginning of a case; restart the case first.' };
    this.state = 'running'; this.startedAtSec = this._t(); this.enteredAt = this._t(); this.lastCheckT = this._t();
    this.sim.autoRun = this;
    this.message = `${MODE_LABELS[this.mode]} started (${this.planMode}${this.planMode === 'MAC' ? `, target ${this.sedationTarget}` : ''}). ${this.mode === 'guided' ? 'You confirm every transition.' : 'Scripted sequence; gates pass on fixed timings.'}`;
    this._log(`${this.message} Plan doses are not changed. Banner: "${BANNERS[this.mode]}"`);
    this._emit('started');
    return { ok: true, message: this.message };
  }

  // ---------------------------------------------------------------- conditions
  _planPhaseDone(phases) {
    return this.sim.planStatus().filter((s) => phases.includes(s.phase)).every((s) => s.status !== 'pending');
  }

  /** Countdown helper: seconds remaining until `readyAt` (0 when reached). */
  _remain(readyAt) { return readyAt === null ? null : Math.max(0, Math.ceil(readyAt - this._t() - 1e-9)); }

  _check(step) {
    const sim = this.sim; const V = sim.state.vitals; const unmet = []; let items = null; let countdownSec = null;
    const per = sim.state.periop || {};
    switch (step.check) {
      case 'premedInterval': {
        const pm = premedStatus(sim);
        if (pm.pending) unmet.push(`${pm.pending} premedication step(s) still pending`);
        else if (pm.lastEndSec !== null) {
          countdownSec = this._remain(pm.lastEndSec + T('PREMED_TO_TRANSFER_SEC'));
          if (countdownSec > 0) unmet.push(`Pre-op holding: transfer ${T('PREMED_TO_TRANSFER_SEC') / 60} min after the premedication ended — ${countdownSec} s to go (owner-stated practice; midazolam label: sedation within 3–5 min [S17])`);
        }
        break;
      }
      case 'orSetup': {
        if (per.transferAt === null || per.transferAt === undefined) { unmet.push('Patient not yet transferred to the OR'); break; }
        countdownSec = this._remain(per.transferAt + T('OR_SETUP_SEC'));
        if (countdownSec > 0) unmet.push(`OR setup (monitors) — ${countdownSec} s to go (simulator convention)`);
        break;
      }
      case 'preoxygenation': {
        const pre = this.history.find((h) => h.id === 'preoxygenate');
        const pm = premedStatus(sim);
        const readyAt = Math.max(pre ? pre.tSec + T('PREOXYGENATION_SEC') : Infinity, pm.lastEndSec !== null ? pm.lastEndSec + PREMED_TO_INDUCTION_MIN_SEC : -Infinity);
        if (!pre) { unmet.push('Preoxygenation not started'); break; }
        countdownSec = this._remain(readyAt);
        if (countdownSec > 0) unmet.push(`Preoxygenation ${T('PREOXYGENATION_SEC') / 60} min${pm.lastEndSec !== null ? ` and ≥ ${PREMED_TO_INDUCTION_MIN_SEC / 60} min after the premedication ended` : ''} — ${countdownSec} s to go (no overlap of premedication with induction)`);
        break;
      }
      case 'intubating': {
        if (!this._planPhaseDone(['premed', 'induction'])) unmet.push('Induction plan steps still pending');
        const dMax = this._v('INTUBATION_DEPTH_MAX'); const tMax = this._v('INTUBATION_TOF_COUNT_MAX');
        if (!(V.depthIndex <= dMax)) unmet.push(`Processed-EEG depth index ${V.depthIndex} (needs ≤ ${dMax}; BIS-style, simulated)`);
        if (!(V.tofCount <= tMax)) unmet.push(`TOF count ${V.tofCount} (needs ≤ ${tMax})`);
        break;
      }
      case 'preIncision': case 'preProcedure': {
        let sed = null;
        if (step.check === 'preProcedure') {
          const u = [];
          if (!this._planPhaseDone(['premed', 'sedation'])) u.push('sedation plan steps still pending');
          const tgt = this.sedationTarget || 'moderate';
          if (!(SEDATION_RANK[V.sedationLevel] >= SEDATION_RANK[tgt])) u.push(`sedation level ${V.sedationLevel} (target ${tgt}, ASA continuum; illustrative mapping)`);
          sed = { met: u.length === 0, detail: u.length ? u.join('; ') : `${V.sedationLevel} (target ${tgt})` };
        }
        items = preIncisionItems(sim, { planMode: this.planMode, sedationCheck: sed });
        // The GA band's lower edge: an index below it needs the clinician's acknowledgement (never automatic).
        const dep = items.find((x) => x.id === 'depth');
        if (dep && !dep.met) {
          const [, hi] = T('GA_DEPTH_BAND');
          if (V.depthIndex <= hi && per.depthAck) { dep.met = true; dep.detail += ' — below the band, acknowledged by the clinician'; }
          else if (V.depthIndex <= hi) { dep.clinician = true; dep.detail += ' — below the band: the clinician must acknowledge it (or lighten the anaesthetic)'; }
        }
        for (const it of items) if (!it.met) unmet.push(`${it.label}: ${it.detail}`);
        break;
      }
      case 'readiness': {
        const r = sim.extubationReadiness();
        for (const c of r.criteria) if (!c.met) unmet.push(c.label);
        break;
      }
      case 'recovery': {
        const mx = this._v('RECOVERY_LEVEL_MAX');
        if (!(SEDATION_RANK[V.sedationLevel] <= SEDATION_RANK[mx])) unmet.push(`Sedation level ${V.sedationLevel} (needs ${mx} or awake)`);
        break;
      }
      default: break;
    }
    const clinicianUnmet = items ? items.filter((x) => !x.met && (x.clinician || x.id === 'antibiotic')) : [];
    const otherMet = items ? items.filter((x) => !x.met).every((x) => x.clinician || x.id === 'antibiotic') : unmet.length === 0;
    const abx = items ? items.find((x) => x.id === 'antibiotic' && !x.met) : null;
    return { met: unmet.length === 0, unmet, checklist: abx ? abx.detail : null, otherMet, clinicianUnmet, items, countdownSec };
  }

  /** Reasons to pause: latched interlock hold; unacknowledged HIGH alarm active or raised since the last check. */
  blockers(sinceLast = true) {
    const S = this.sim.state; const out = [];
    // The engine core is read directly so a hold the user has just released (resume_hold) is not
    // reported as latched until the next step refreshes sim.state.interlocks.
    const latched = this.sim.core && typeof this.sim.core.holdLatched === 'boolean' ? this.sim.core.holdLatched : S.interlocks.holdLatched;
    if (this._v('PAUSE_ON_INTERLOCK_HOLD') && S.interlocks.enabled && latched) {
      out.push({ kind: 'interlock_hold', message: `Interlock hold latched (held: ${S.interlocks.heldDrugs.join(', ') || 'no infusions running'}). Automatic mode does not release holds — use "Resume hold" if appropriate, then Resume.` });
    }
    const pr = this._v('PAUSE_ALARM_PRIORITIES');
    for (const a of S.alarms) {
      if (!pr.includes(a.priority) || a.acknowledged) continue;
      if (a.active || (sinceLast && a.sinceSec >= this.lastCheckT - 1e-9)) out.push({ kind: 'alarm', alarmId: a.id, message: `${a.priority.toUpperCase()} alarm needs a decision: ${a.message}. Automatic mode does not acknowledge alarms.` });
    }
    return out;
  }

  // ---------------------------------------------------------------- driving
  /** Call after every simulated second (sim.step(1)). */
  tick() {
    if (this.state !== 'running') return this.status();
    const t = this._t();
    const blk = this.blockers(true);
    this.lastCheckT = t;
    if (blk.length) { this._pause(blk, 'auto'); return this.status(); }
    const step = this.current;
    if (!step) return this.status();
    if (this.enteredAt === null) this.enteredAt = t;
    const el = t - this.enteredAt;
    const c = this._check(step);
    if (c.met) { if (this.metSince === null) this.metSince = t; } else this.metSince = null;
    if (step.gate && this.mode === 'guided') {
      if (!c.met && step.timeoutSec && el >= step.timeoutSec && !this.timeoutWarned) {
        this.timeoutWarned = true;
        this.message = `${step.gateLabel}: conditions not met after ${Math.round(step.timeoutSec / 60)} min — ${c.unmet.join('; ')}. Still waiting; take over manually if needed.`;
        this._log(this.message); this._emit('timeout_warning', { unmet: c.unmet });
      }
      return this.status();
    }
    const holdSec = step.holdSec || 0;
    const metHeld = c.met && t - this.metSince >= holdSec - 1e-9;
    const waitSec = Math.max(step.minSec || 0, step.gate ? step.fullWaitSec || 0 : 0);
    // Full demonstration: clinician-only items (WHO time out, an index below the GA band, missing antibiotic
    // prophylaxis) pause the sequence once every state item is met; the runner never confirms them itself.
    if (this.mode === 'full' && c.items && c.otherMet && c.clinicianUnmet.length && el >= waitSec - 1e-9) { this._pause(this._clinicianReasons(c), 'auto'); return this.status(); }
    if (metHeld && el >= waitSec - 1e-9) this._execute(step, 'auto', c);
    else if (step.timeoutSec && el >= step.timeoutSec && !metHeld) this._stop(`${step.label}: conditions not met within ${Math.round(step.timeoutSec / 60)} min`, c.unmet.length ? c.unmet : ['condition did not hold long enough']);
    return this.status();
  }

  _clinicianReasons(c) {
    return c.clinicianUnmet.map((x) => ({ kind: x.id === 'antibiotic' ? 'checklist' : 'clinician_confirm', item: x.id,
      message: x.id === 'antibiotic' ? `Antibiotic checklist needs the clinician: ${x.detail}. Automatic mode does not give or acknowledge it — give prophylaxis now, then Resume.`
        : `${x.label} needs the clinician (${x.detail}). Automatic mode never confirms it — confirm it, then Resume.` }));
  }

  /**
   * A clinician action pressed in the guided/automatic panel (does NOT end the mode; logged as the
   * clinician's): 'confirm_time_out', 'acknowledge_depth_below_band', 'give_prophylaxis' (guideline agent and dose).
   */
  clinicianAction(id) {
    if (!CLINICIAN_ACTIONS.includes(id)) return { ok: false, message: `Unknown clinician action ${id}` };
    let r;
    if (id === 'give_prophylaxis') {
      const sel = selectProphylaxis(this.sim.patient, this.sim.lib);
      if (!sel.drugId) return { ok: false, message: sel.reason };
      const rec = recommend(this.sim.patient, 'prophylaxis', sel.drugId, this.sim.lib);
      if (rec.locked || !rec.dose) return { ok: false, message: `${sel.drugId}: no guideline dose for this patient` };
      const a = this.sim.administer({ drugId: sel.drugId, kind: 'antibiotic', amount: rec.dose.value, amountUnit: rec.dose.unit }, { source: 'clinician' });
      r = { ok: a.ok, message: a.ok ? `Guideline prophylaxis given by the clinician (${sel.drugId} ${rec.dose.value} ${rec.dose.unit}) [${rec.sources.join(', ')}]` : a.reasons.join('; ') };
    } else r = this.actions[id] ? this.actions[id](this.sim) : this.sim.action(id);
    this._log(`clinician: ${r.message}`);
    this._emit('clinician', { action: id });
    return r;
  }

  /** Live timing checks (engine/timing.js) for the panel and the debrief. */
  timingChecks() { return liveTimingChecks(this.sim); }

  /** Steps the simulation and ticks, until `sec` seconds pass or the runner stops running (tests/Node use). */
  advance(sec) { for (let i = 0; i < sec && this.state === 'running'; i++) { this.sim.step(1); this.tick(); } return this.status(); }

  /** Guided mode: the clinician approves the current gate. */
  approve(gateId) {
    const step = this.current;
    if (this.mode !== 'guided') return { ok: false, message: 'Gates are approved automatically in the full demonstration' };
    if (this.state === 'paused') return { ok: false, message: `Paused: ${this.pauseReasons.map((r) => r.message).join(' ')}` };
    if (this.state !== 'running' || !step) return { ok: false, message: `Guided mode is ${this.state}` };
    if (!step.gate || step.id !== gateId) return { ok: false, message: `Current step is "${step.label}", not ${gateId}` };
    const blk = this.blockers(false);
    if (blk.length) { this._pause(blk, 'auto'); return { ok: false, message: this.message }; }
    const c = this._check(step);
    if (!c.met) return { ok: false, message: `${step.gateLabel} is not available yet: ${c.unmet.join('; ')}`, unmet: c.unmet };
    return this._execute(step, 'clinician', c);
  }

  _execute(step, by, _conditions) {
    const t = this._t();
    const n = this.seq.length; const k = this.idx + 1;
    this._log(`step ${k}/${n} — ${step.label}${by === 'clinician' ? ' (approved by the clinician)' : this.mode === 'guided' ? ' (automatic within the approved phase)' : ' (automatic demonstration)'}${step.check ? ' — conditions met' : ''}`);
    const results = [];
    for (const [name, arg] of step.actions) {
      if (name === 'mask_ventilate' && (this.sim.state.airway.maskVentilation || this.sim.state.airway.secured)) continue; // toggle: only switch on
      const fn = this.actions[name];
      const r = fn ? fn(this.sim, arg) : { ok: false, message: `Unknown case action ${name}` };
      results.push({ action: name, ...r });
      if (!r.ok) { this._stop(`${step.label}: action ${name} did not complete — ${r.message}`, r.readiness ? r.readiness.criteria.filter((x) => !x.met).map((x) => x.label) : []); return { ok: false, message: r.message }; }
    }
    if (step.id === 'start_surgery' && this.mode === 'full' && typeof this.sim.setPlannedSurgeryEnd === 'function') this.sim.setPlannedSurgeryEnd(t + this._v('SURGERY_DURATION_SEC'));
    this.history.push({ id: step.id, label: step.label, tSec: t, by });
    this.idx += 1; this.enteredAt = t; this.metSince = null; this.timeoutWarned = false;
    this.message = `${step.label} done${results.length ? `: ${results.map((r) => String(r.message).replace(/\.+$/, '')).join(' · ')}` : ''}.`;
    this._emit('step', { stepId: step.id });
    if (step.final || this.idx >= this.seq.length) this._complete();
    return { ok: true, message: this.message };
  }

  _pause(reasons, by) {
    this.state = 'paused'; this.pauseReasons = reasons;
    this.pauses.push({ tSec: this._t(), by, reasons: reasons.map((r) => r.message), resumedAtSec: null });
    this.message = by === 'user' ? reasons[0].message : `Paused — ${reasons.map((r) => r.message).join(' ')}`;
    this._log(this.message);
    this._emit('paused', { reasons });
  }

  pause(message = 'Paused by the user.') {
    if (this.state !== 'running') return { ok: false, message: `Not running (${this.state})` };
    this._pause([{ kind: 'user', message }], 'user');
    return { ok: true, message: this.message };
  }

  resume() {
    if (this.state !== 'paused') return { ok: false, message: `Not paused (${this.state})` };
    const blk = this.blockers(false);
    const ck = this.current && this.mode === 'full' ? this._check(this.current) : null;
    if (ck && ck.items && ck.otherMet && ck.clinicianUnmet.length) blk.push(...this._clinicianReasons(ck).map((r) => ({ ...r, message: `Still needed: ${r.message}` })));
    if (blk.length) { this.pauseReasons = blk; this.message = `Still paused — ${blk.map((r) => r.message).join(' ')}`; this._emit('still_paused', { reasons: blk }); return { ok: false, message: this.message }; }
    this.state = 'running'; this.pauseReasons = [];
    const p = this.pauses[this.pauses.length - 1]; if (p) p.resumedAtSec = this._t();
    this.lastCheckT = this._t() + 1e-6;
    this.message = 'Resumed by the user.';
    this._log(this.message); this._emit('resumed');
    return { ok: true, message: this.message };
  }

  /** Any manual control ends automatic/guided mode; the case continues under manual control. */
  takeOver(control = 'manual control') {
    if (!this.active) return { ok: false, message: `Not active (${this.state})` };
    this.state = 'manual'; this.manualControl = control; this.endedAtSec = this._t();
    this.message = `${MODE_LABELS[this.mode]} ended — manual control used (${control}). The case continues under manual control.`;
    this._log(this.message); this._emit('ended');
    return { ok: true, message: this.message };
  }

  _stop(reason, unmet = []) {
    this.state = 'stopped'; this.stopReason = reason; this.unmetAtStop = unmet; this.endedAtSec = this._t();
    this.message = `${MODE_LABELS[this.mode]} stopped — ${reason}${unmet.length ? `. Unmet: ${unmet.join('; ')}` : ''}. Continue manually.`;
    this._log(this.message); this._emit('stopped', { unmet });
  }

  _complete() {
    this.state = 'completed'; this.endedAtSec = this._t();
    this.message = `${MODE_LABELS[this.mode]} complete — ${this.planMode === 'GA' ? 'extubated with readiness met and observed' : 'procedure finished and recovery level reached'}.`;
    this._log(this.message); this._emit('completed');
  }

  // ---------------------------------------------------------------- readouts
  status() {
    const step = this.current; const t = this._t();
    let cur = null;
    if (step) {
      const c = this._check(step);
      const el = this.enteredAt === null ? 0 : t - this.enteredAt;
      cur = { id: step.id, label: step.label, gate: !!step.gate, gateLabel: step.gateLabel || null, index: this.idx, total: this.seq.length, describe: step.describe,
        conditionsMet: c.met, unmet: c.unmet, checklist: c.checklist, countdownSec: c.countdownSec, items: c.items ? c.items.map((x) => ({ ...x })) : null, elapsedSec: el, timedOut: !!(step.timeoutSec && el >= step.timeoutSec && !c.met),
        enabled: this.mode === 'guided' && this.state === 'running' && !!step.gate && c.met };
    }
    return { mode: this.mode, modeLabel: MODE_LABELS[this.mode], banner: BANNERS[this.mode], planMode: this.planMode, state: this.state, active: this.active, message: this.message,
      pauseReasons: this.pauseReasons.map((r) => r.message), stopReason: this.stopReason, unmetAtStop: this.unmetAtStop.slice(), current: cur,
      sequence: this.seq.map((s, i) => ({ id: s.id, label: s.label, gate: !!s.gate, gateLabel: s.gateLabel || null, describe: s.describe, done: i < this.idx, current: i === this.idx && this.active })) };
  }

  /** For sim.summary().automatic, the debrief and the session JSON. */
  record() {
    return {
      used: true, mode: this.mode, modeLabel: MODE_LABELS[this.mode], banner: BANNERS[this.mode], planMode: this.planMode,
      outcome: this.state, startedAtSec: this.startedAtSec, endedAtSec: this.endedAtSec,
      stoppedAt: this.state === 'stopped' || this.state === 'manual' || this.state === 'paused' ? { step: this.current ? this.current.label : null, tSec: this.state === 'paused' ? this._t() : this.endedAtSec } : null,
      stopReason: this.stopReason, unmet: this.unmetAtStop.slice(), manualControl: this.manualControl,
      pauseReasons: this.state === 'paused' ? this.pauseReasons.map((r) => r.message) : [],
      steps: this.history.map((h) => ({ ...h })), pauses: this.pauses.map((p) => ({ ...p, reasons: p.reasons.slice() })),
      note: 'Scripted sequence of the manual case actions; plan doses unchanged. Not a controller and not a clinical recommendation.',
    };
  }
}

export { AutoRunner };

export function createAutoRunner({ sim, plan = null, mode = 'full', config = AUTORUN_CONFIG, actions = CASE_ACTIONS, onEvent = null } = {}) {
  return new AutoRunner({ sim, plan, mode, config, actions, onEvent });
}

