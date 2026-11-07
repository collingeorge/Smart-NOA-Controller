// Step 4 — Run: HMI monitor dashboard driving sim.step() from requestAnimationFrame.
import { h, clear, setText, fmtClock, fmtNum, isNum, announce, reconcileKeyed, setChildrenIf, fill, add } from './dom.js';
import { recommend, regimenKeyForPhase } from '../engine/dosing.js';
import { SCENARIOS } from '../data/scenarios.js';
import { drawChart, SERIES_COLORS, WINDOW_SEC } from './charts.js';
import { srcTags } from './sources.js';
import { CLASS_LABELS, CLASS_ORDER, PHASE_LABELS, PHASE_LABELS_MAC, PRIORITY_LABELS, PRIORITY_SHAPES, INTERLOCK_TEXT, KIND_LABELS, fluidCompositionText } from './labels.js';
import { getDrugById, isInhaledDrug, interlockCeiling, interlockNote, exceedsInterlockCeiling } from './plan-model.js';
import { interlockExplanation } from './plan-editor.js';
import { CASE_ACTIONS, surgeryState } from '../engine/case-actions.js';
import { createAutoRunner, BANNERS, MODE_LABELS } from '../engine/autorun.js';
import { FLUID_MODEL } from '../engine/sim.js';
import { selectProphylaxis } from '../engine/prophylaxis.js';
import { TIMING_CONFIG, PREMED_TO_INDUCTION_MIN_SEC, premedStatus } from '../engine/timing.js';
import { timingCheckItem, updateTimingCheckItem } from './timing-view.js';
import { createRescueAdvisor } from '../engine/rescue.js';
import { advisoryCard, depthAdvisoryCard } from './advisory.js';
import { createDepthAdvisor } from '../engine/depth-advisory.js';
import { TEACHING_GUARDS } from '../engine/teaching-ceilings.js';
import { CLINICIAN_RESPONSIBILITY, NOA_CONFIG } from '../engine/interlocks.js';

const GA_BAND = TIMING_CONFIG.GA_DEPTH_BAND.value;
const DEPTH_LABEL = 'Processed-EEG depth index (BIS-style, simulated)';

const SPEEDS = [1, 5, 20, 60];
const TILE_ALARMS = {
  hr: ['hr_critical', 'hr_high', 'sensor_fault_hr'], bp: ['map_critical', 'map_low', 'map_high', 'sensor_fault_map'],
  spo2: ['spo2_low', 'sensor_fault_spo2'], rr: ['apnea'], etco2: ['apnea'], depth: ['depth_high', 'depth_over_target'], tof: ['tofr_extubation'],
};
const RANK = { high: 3, medium: 2, low: 1 };
const SAMPLE_SEC = 2;
const GATE_COOLDOWN_MS = 600;

export function tofDepthText(count, ratio) {
  if (count === 0) return 'deep block (TOF count 0)';
  if (count < 4) return `moderate block (TOF count ${count})`;
  if (ratio < 0.4) return 'shallow block (TOFR < 0.4)';
  if (ratio < 0.9) return 'minimal block (TOFR 0.4 to < 0.9)';
  return 'TOFR ≥ 0.9 (adequate recovery)';
}

export function newRunState() {
  return { speed: 20, playing: false, hist: { t: [], hr: [], map: [], spo2: [], depth: [], mac: [], ce: {} }, lastSample: -Infinity, overrides: [], seenAlarms: new Set(), uiLog: [], auto: null, autoStart: null, autoListener: null };
}

export function renderMonitor(ctx, main) {
  const { store, lib } = ctx;
  const sim = ctx.ensureSim();
  const run = store.run;
  const patient = sim.patient;
  const isGA = sim.plan.mode === 'GA';
  const phaseLabel = (p) => (isGA ? PHASE_LABELS : PHASE_LABELS_MAC)[p] || p;
  const E = lib.SOURCE_IDS_ENGINE || {};
  let raf = null; let lastTs = null; let acc = 0; let lastRender = 0; let alive = true;

  // ---------------- toolbar
  const clock = h('span', { class: 'hmi-clock mono', id: 'mon-clock' }, '00:00');
  const phaseEl = h('span', { class: 'hmi-phase', id: 'mon-phase' });
  const playBtn = h('button', { type: 'button', class: 'btn btn--hmi btn--play', id: 'mon-play', 'aria-pressed': 'false' }, '▶ Play');
  playBtn.addEventListener('click', () => setPlaying(!run.playing));
  const stepBtns = [[1, '+1 s'], [10, '+10 s'], [60, '+1 min']].map(([s, l]) => {
    const b = h('button', { type: 'button', class: 'btn btn--hmi', dataset: { step: s }, 'aria-label': `Step ${l.slice(1)} of simulated time` }, l);
    b.addEventListener('click', () => { advance(s); render(true); });
    return b;
  });
  const speedBtns = SPEEDS.map((sp) => {
    const b = h('button', { type: 'button', class: 'btn btn--hmi btn--speed', dataset: { speed: sp }, 'data-auto-safe': 'speed', 'aria-pressed': String(run.speed === sp) }, `${sp}×`);
    b.addEventListener('click', () => { run.speed = sp; for (const x of speedBtns) x.setAttribute('aria-pressed', String(Number(x.dataset.speed) === sp)); announce(`Speed ${sp} times.`); });
    return b;
  });
  const ilBadge = h('span', { class: 'il-badge', id: 'mon-il-badge' });
  const restartBtn = h('button', { type: 'button', class: 'btn btn--hmi' }, 'Restart case');
  restartBtn.addEventListener('click', () => { ctx.restartSim(); ctx.rerender(); announce('Case restarted from time zero.'); });

  // ---------------- tiles
  const tiles = {};
  const tile = (key, label, unit, extraClass = '') => {
    const val = h('span', { class: 'tile__value mono' }, '—');
    const sub = h('span', { class: 'tile__sub' });
    const alarm = h('span', { class: 'tile__alarm' });
    const el = h('div', { class: `tile ${extraClass}`, id: `tile-${key}`, role: 'group', 'aria-label': label },
      h('span', { class: 'tile__label' }, label, unit ? h('span', { class: 'tile__unit' }, ` ${unit}`) : null), val, sub, alarm);
    tiles[key] = { el, val, sub, alarm };
    return el;
  };
  const tileGrid = h('div', { class: 'tiles', id: 'mon-tiles' },
    tile('hr', 'HR', '/min', 'tile--hr'), tile('bp', 'BP (MAP)', 'mmHg', 'tile--bp'), tile('spo2', 'SpO2', '%', 'tile--spo2'),
    tile('rr', 'RR', '/min'), tile('etco2', 'EtCO2', 'mmHg'), tile('depth', DEPTH_LABEL, '0–100', 'tile--depth'),
    tile('tof', 'TOF', ''), tile('mac', 'Total MAC', ''), tile('fio2', 'FiO2', ''));

  // ---------------- charts
  const charts = [
    { key: 'hr', title: 'HR (/min)', min: 30, max: 160, th: [{ v: 48, label: '48 interlock' }] },
    { key: 'map', title: 'MAP (mmHg)', min: 30, max: 140, th: [{ v: 65, label: '65' }, { v: 60, label: '60 interlock' }] },
    { key: 'spo2', title: 'SpO2 (%)', min: 50, max: 100, th: [{ v: 90, label: '90' }] },
    { key: 'depth', title: `${DEPTH_LABEL} — GA band ${GA_BAND[0]}–${GA_BAND[1]}`, min: 0, max: 100, th: [{ v: 80, label: '80 awake' }, { v: GA_BAND[1], label: `${GA_BAND[1]} GA band` }, { v: GA_BAND[0], label: `${GA_BAND[0]} GA band` }] },
    { key: 'ce', title: 'Total MAC / drug Ce (× reference peak, illustrative)', min: 0, max: 1.5, autoMax: true, th: [] },
  ].map((c) => {
    const canvas = h('canvas', { class: 'chart__canvas', id: `chart-${c.key}`, role: 'img', 'aria-label': c.title });
    const legend = h('ul', { class: 'chart__legend' });
    const el = h('figure', { class: 'chart' }, h('figcaption', {}, c.title), canvas, legend);
    return { ...c, canvas, legend, el };
  });
  const chartGrid = h('div', { class: 'charts', id: 'mon-charts' }, charts.map((c) => c.el),
    h('p', { class: 'hint hint--hmi' }, 'Last 15 simulated minutes · illustrative model output · dashed lines are alarm/interlock thresholds.'),
    h('p', { class: 'hint hint--hmi', id: 'mon-depth-band' }, `${DEPTH_LABEL}: an illustrative model output, not a BIS value (BIS is a trademark of its owner). GA target band ${GA_BAND[0]}–${GA_BAND[1]} = the protocol target of the B-Unaware and BAG-RECALL trials `, srcTags([...TIMING_CONFIG.GA_DEPTH_BAND.sourceIds]), ` (neither showed the BIS protocol superior for preventing awareness). No sedation bands are shown: none was verified. In this model, 1 MAC of a volatile agent often reads just below 40. During general anaesthesia (airway secured, before emergence) an index above ${GA_BAND[1]} for ≥ ${TIMING_CONFIG.DEPTH_HIGH_ALARM_SUSTAIN_SEC.value} s raises a HIGH alarm (risk of awareness; simulator convention).`));

  // ---------------- alarms
  const alarmList = h('ul', { class: 'alarm-list', id: 'mon-alarms' });
  const alarmPanel = h('section', { class: 'hmi-panel', 'aria-labelledby': 'mon-alarms-h' }, h('h3', { id: 'mon-alarms-h' }, 'Alarms'), alarmList);
  let alarmSig = '';

  // ---------------- interlocks
  const ilStatus = h('p', { class: 'il-status', id: 'mon-il-status' });
  const ilHeld = h('p', { class: 'il-held', id: 'mon-il-held' });
  // "Resume hold" opens a confirmation panel: the release takes two engine-enforced steps (acknowledge the
  // reviewed cause, then release). The panel is not manual control of the case (data-auto-safe).
  const resumeBtn = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'mon-resume', 'data-auto-safe': 'resume-hold', 'aria-expanded': 'false', 'aria-controls': 'mon-release' }, 'Resume hold');
  const relHeld = h('p', { id: 'mon-release-held' });
  const relReasons = h('p', { id: 'mon-release-reasons' });
  const relVitals = h('p', { id: 'mon-release-vitals', class: 'mono' });
  const relCheck = h('input', { type: 'checkbox', id: 'mon-release-check' });
  const relOk = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'mon-release-ok', disabled: true }, 'Release hold');
  const relCancel = h('button', { type: 'button', class: 'btn btn--hmi', id: 'mon-release-cancel' }, 'Cancel');
  const ilRelease = h('div', { class: 'il-confirm il-release', id: 'mon-release', role: 'group', 'aria-labelledby': 'mon-release-h', 'data-auto-safe': 'resume-hold', hidden: true },
    h('h4', { id: 'mon-release-h' }, 'Release the interlock hold?'), relHeld, relReasons, relVitals,
    h('p', { class: 'il-responsibility', id: 'mon-release-resp' }, CLINICIAN_RESPONSIBILITY),
    h('div', { class: 'check check--hmi' }, relCheck, h('label', { for: 'mon-release-check' }, 'I have reviewed the cause of this hold')),
    h('p', { class: 'hint hint--hmi' }, 'Releasing does not restart anything: held infusions stay at zero until you set a rate yourself. Both steps (acknowledgment and release) are logged.'),
    h('div', { class: 'il-confirm__actions' }, relOk, ' ', relCancel));
  const closeRelease = (focus = true) => { ilRelease.hidden = true; resumeBtn.setAttribute('aria-expanded', 'false'); relCheck.checked = false; relOk.disabled = true; if (focus && !resumeBtn.disabled) resumeBtn.focus(); };
  resumeBtn.addEventListener('click', () => { relCheck.checked = false; relOk.disabled = true; ilRelease.hidden = false; resumeBtn.setAttribute('aria-expanded', 'true'); renderRelease(); relCheck.focus(); });
  relCheck.addEventListener('change', () => { relOk.disabled = !relCheck.checked; });
  relCancel.addEventListener('click', () => closeRelease());
  relOk.addEventListener('click', () => {
    if (!relCheck.checked) return;
    const a = sim.action('acknowledge_hold');
    const r = a.ok ? sim.action('resume_hold') : a;
    feedback(r.ok ? `Hold acknowledged and released (both logged). Held infusions stay at zero (${(r.released || []).map((id) => getDrugById(lib, id)?.name || id).join(', ') || 'none'}) — restart them yourself if appropriate.` : r.message, !r.ok);
    announce(r.ok ? 'Hold released. Held infusions stay at zero.' : r.message);
    closeRelease(false); render(true);
  });
  function renderRelease() {
    if (ilRelease.hidden) return;
    const S = sim.state; const hd = S.interlocks.hold;
    if (!S.interlocks.holdLatched) { closeRelease(false); return; }
    const name = (id) => getDrugById(lib, id)?.name || id;
    setText(relHeld, `Held agents (stay at zero after release): ${(hd ? hd.drugs : S.interlocks.heldDrugs).map(name).join(', ') || 'none'}.`);
    setText(relReasons, `Triggering reason(s): ${hd && hd.reasons.length ? hd.reasons.map((x) => `${x.reason} (at ${fmtClock(x.tSec)})`).join('; ') : 'not recorded'}.`);
    const V = S.vitals;
    setText(relVitals, `Now: HR ${isNum(V.hr) ? V.hr : 'unusable'} /min · MAP ${isNum(V.map) ? V.map : 'unusable'} mmHg`);
  }

  // Explicit, time-limited suspension of the HR/MAP threshold holds (manual override; logged; visible).
  // The opener only shows the form; "Suspend" is manual control and ends guided/automatic mode.
  const SUSPEND_MAX = NOA_CONFIG.interlock_suspension_max_sec;
  const suspendBtn = h('button', { type: 'button', class: 'btn btn--hmi btn--override', id: 'mon-suspend', 'data-auto-safe': 'suspend-open', 'aria-expanded': 'false', 'aria-controls': 'mon-suspend-panel' }, 'Suspend interlocks…');
  const susDur = h('select', { id: 'mon-suspend-dur', class: 'input input--hmi' }, [60, 120, 300].filter((x) => x <= SUSPEND_MAX).map((x) => h('option', { value: x }, `${x} s (${fmtClock(x)})`)));
  const susReason = h('input', { type: 'text', id: 'mon-suspend-reason', class: 'input input--hmi', maxlength: '200', autocomplete: 'off', required: true, 'aria-describedby': 'mon-suspend-help' });
  const susOk = h('button', { type: 'button', class: 'btn btn--hmi btn--override', id: 'mon-suspend-ok', disabled: true }, 'Suspend');
  const susCancel = h('button', { type: 'button', class: 'btn btn--hmi', id: 'mon-suspend-cancel', 'data-auto-safe': 'suspend-cancel' }, 'Cancel');
  const ilSuspend = h('div', { class: 'il-confirm il-suspend-confirm', id: 'mon-suspend-panel', role: 'group', 'aria-labelledby': 'mon-suspend-h', hidden: true },
    h('h4', { id: 'mon-suspend-h' }, 'Suspend the HR/MAP interlocks?'),
    h('p', { id: 'mon-suspend-help', class: 'hint hint--hmi' }, `Only the HR < ${NOA_CONFIG.hemodynamic_thresholds.hr_critical_low} and MAP < ${NOA_CONFIG.hemodynamic_thresholds.map_critical_low} holds are suspended: each breach is still logged, but no hold latches. The sensor fail-safe, rate faults, lockouts and any hold already latched stay active, and nothing is restarted. Maximum ${SUSPEND_MAX} s (simulator convention); it expires on its own. Starting it ends guided/automatic mode. Logged with your reason.`),
    h('div', { class: 'inline-form' }, h('label', { for: 'mon-suspend-dur', class: 'label' }, 'Duration'), susDur),
    h('div', { class: 'field' }, h('label', { for: 'mon-suspend-reason', class: 'label' }, 'Reason (required)'), susReason),
    h('div', { class: 'il-confirm__actions' }, susOk, ' ', susCancel));
  const closeSuspend = (focus = true) => { ilSuspend.hidden = true; suspendBtn.setAttribute('aria-expanded', 'false'); susReason.value = ''; susOk.disabled = true; if (focus && !suspendBtn.disabled) suspendBtn.focus(); };
  suspendBtn.addEventListener('click', () => { ilSuspend.hidden = false; suspendBtn.setAttribute('aria-expanded', 'true'); susReason.focus(); });
  susReason.addEventListener('input', () => { susOk.disabled = !susReason.value.trim(); });
  susCancel.addEventListener('click', () => closeSuspend());
  susOk.addEventListener('click', () => {
    if (!susReason.value.trim()) return;
    const r = sim.action(`suspend_interlocks:${susDur.value}:${susReason.value}`);
    feedback(r.ok ? `Interlocks suspended for ${susDur.value} s (logged). HR/MAP holds will not latch until it ends.` : r.message, !r.ok, r.ok);
    announce(r.ok ? 'Interlocks suspended.' : r.message);
    if (r.ok) closeSuspend(false);
    render(true);
  });
  const susBannerText = h('span', { id: 'mon-suspended-text' });
  const susBannerTimer = h('span', { id: 'mon-suspended-timer', class: 'mono', role: 'timer', 'aria-live': 'off' });
  const susBannerWho = h('span', { id: 'mon-suspended-who' });
  const susEnd = h('button', { type: 'button', class: 'btn btn--hmi', id: 'mon-suspend-end', 'data-auto-safe': 'suspend-end' }, 'End suspension now');
  susEnd.addEventListener('click', () => { const r = sim.action('end_suspension'); feedback(r.ok ? 'Suspension ended (logged). HR/MAP interlocks are active again.' : r.message, !r.ok); announce(r.ok ? 'Suspension ended. Interlocks active.' : r.message); render(true); });
  const susBanner = h('div', { class: 'il-suspended-banner', id: 'mon-suspended', role: 'status', 'aria-live': 'polite', hidden: true },
    h('p', {}, h('strong', {}, 'INTERLOCKS SUSPENDED'), ' — HR/MAP holds will not latch · ', susBannerTimer, ' left · ', susBannerWho), susBannerText, susEnd);
  // Persistent hold banner: the exact trigger(s) stay visible until the hold is released.
  const holdBanner = h('p', { class: 'il-hold-banner', id: 'mon-hold-banner', role: 'status', 'aria-live': 'polite', hidden: true });
  function renderSuspension() {
    const S = sim.state; const sp = S.interlocks.suspension; const hd = S.interlocks.hold;
    const on = !!(sp && sp.active);
    susBanner.hidden = !on;
    if (on) { setText(susBannerTimer, fmtClock(sp.remainingSec)); setText(susBannerWho, `by ${sp.by}`); setText(susBannerText, `reason: ${sp.reason}`); }
    suspendBtn.disabled = !S.interlocks.enabled || on;
    if (suspendBtn.disabled && !ilSuspend.hidden) closeSuspend(false);
    holdBanner.hidden = !(S.interlocks.enabled && S.interlocks.holdLatched);
    if (!holdBanner.hidden) {
      const name = (id) => getDrugById(lib, id)?.name || id;
      const reasons = hd && hd.reasons.length ? hd.reasons.map((x) => `${x.reason} (${fmtClock(x.tSec)})`).join('; ') : 'not recorded';
      const long = hd && hd.longHoldNotices ? ` · Hold has been active for ${hd.longHoldNotices * NOA_CONFIG.interlock_long_hold_advisory_sec / 60} min (advisory; nothing changes)` : '';
      const ack = hd && hd.acknowledgedBy ? ` · acknowledged by ${hd.acknowledgedBy} at ${fmtClock(hd.acknowledgedAtSec)}` : '';
      setText(holdBanner, `HOLD${hd ? ` #${hd.id}` : ''} latched${hd ? ` since ${fmtClock(hd.latchedAtSec)}` : ''} — held: ${(hd ? hd.drugs : S.interlocks.heldDrugs).map(name).join(', ') || 'none'} — reason(s): ${reasons}${ack}${long}. Infusions do not restart automatically.`);
    }
  }
  const ilToggle = h('input', { type: 'checkbox', id: 'mon-il-toggle', checked: store.interlocks });
  const ilConfirm = h('div', { class: 'il-confirm', hidden: true });
  ilToggle.addEventListener('change', () => {
    const want = ilToggle.checked;
    if (sim.state.tSec <= 0) { store.interlocks = want; ctx.restartSim(); ctx.rerender(); announce(`Interlocks ${want ? 'on' : 'off'}.`); return; }
    ilToggle.checked = !want;
    fill(ilConfirm, h('p', {}, `Changing interlocks restarts the case from 00:00 with interlocks ${want ? 'ON' : 'OFF'}.`),
      h('button', { type: 'button', class: 'btn btn--hmi btn--warn', onclick: () => { store.interlocks = want; ctx.restartSim(); ctx.rerender(); announce(`Case restarted with interlocks ${want ? 'on' : 'off'}.`); } }, `Restart with interlocks ${want ? 'ON' : 'OFF'}`),
      ' ', h('button', { type: 'button', class: 'btn btn--hmi', onclick: () => { ilConfirm.hidden = true; ilToggle.focus(); } }, 'Cancel'));
    ilConfirm.hidden = false; ilConfirm.querySelector('button').focus();
  });
  const lockouts = Object.entries(sim.state.interlocks.lockouts);
  const ilPanel = h('section', { class: 'hmi-panel', 'aria-labelledby': 'mon-il-h' }, h('h3', { id: 'mon-il-h' }, 'Interlocks (Smart NOA rules)'),
    ilStatus, ilHeld, resumeBtn, ilRelease, ' ', suspendBtn, ilSuspend,
    h('div', { class: 'check check--hmi' }, ilToggle, h('label', { for: 'mon-il-toggle' }, 'Interlocks on')), ilConfirm,
    h('details', { class: 'hmi-details' }, h('summary', {}, 'What the interlocks do'), interlockExplanation(lib)),
    lockouts.length ? h('details', { class: 'hmi-details' }, h('summary', {}, `Lockouts (${lockouts.length}) — apply even with interlocks off`),
      h('ul', { class: 'list list--tight' }, lockouts.map(([id, rs]) => h('li', {}, h('strong', {}, getDrugById(lib, id)?.name || id), ': ', rs.join('; '))))) : null);

  // ---------------- phase controls
  const phaseBtns = {};
  const pbtn = (id, label, fn, hint = null) => { const b = h('button', { type: 'button', class: 'btn btn--hmi', id: `ph-${id}` }, label); b.addEventListener('click', () => { fn(); render(true); }); phaseBtns[id] = b; return hint ? h('span', { class: 'pbtn' }, b, h('span', { class: 'hint hint--hmi' }, hint)) : b; };
  const nextHint = h('p', { class: 'hint hint--hmi', id: 'mon-next' });
  const act = (id, okMsg = null) => { const r = sim.action(id); feedback(r.ok ? (okMsg || r.message) : r.message, !r.ok); return r; };
  // Phase controls call the shared case actions (engine/case-actions.js) — the same calls the
  // guided/automatic runner makes.
  const caseAct = (id) => {
    // Manual mode stays the clinician's choice, but starting induction/sedation inside the premedication
    // interval is flagged (plan drugs still never overlap a running premedication bolus; engine/sim.js).
    let warn = null;
    if (id === 'start_induction' || id === 'start_sedation') {
      const pm = premedStatus(sim); const min = id === 'start_induction' ? PREMED_TO_INDUCTION_MIN_SEC : PREMED_TO_INDUCTION_MIN_SEC - TIMING_CONFIG.PREOXYGENATION_SEC.value;
      if (pm.pending || (pm.lastEndSec !== null && sim.state.tSec < pm.lastEndSec + min)) warn = `Timing warning: ${pm.pending ? 'premedication still pending' : `only ${fmtClock(sim.state.tSec - pm.lastEndSec)} after the premedication ended`} — the recommended minimum is ${min / 60} min (pre-op holding ${TIMING_CONFIG.PREMED_TO_TRANSFER_SEC.value / 60} min, OR setup${id === 'start_induction' ? ', preoxygenation' : ''}). Induction drugs wait until the premedication bolus has finished.`;
    }
    const r = CASE_ACTIONS[id](sim); feedback(warn && r.ok ? `${r.message} ${warn}` : r.message, !r.ok, !!warn); if (warn) announce(warn); return r;
  };
  const phaseCtl = isGA ? [
    pbtn('induction', 'Start induction', () => caseAct('start_induction')),
    pbtn('secure', 'Secure airway', () => caseAct('secure_airway')),
    pbtn('maintenance', 'Start maintenance', () => caseAct('start_maintenance')),
    pbtn('surgery', 'Start surgery', () => caseAct('start_surgery')),
    pbtn('endsurgery', 'End surgery', () => caseAct('end_surgery')),
    pbtn('emergence', 'Begin emergence', () => caseAct('begin_emergence')),
    pbtn('extubate', 'Extubate…', () => {
      // The clock is paused while the dialog is open and restored when it closes (2026-11 audit, finding 3).
      let wasPlaying = false;
      ctx.openExtubation(sim, { pause: () => { wasPlaying = run.playing; if (run.playing) setPlaying(false, true); }, resume: () => { if (wasPlaying && alive) setPlaying(true, true); }, after: () => render(true) });
    }),
  ] : [
    pbtn('sedation', 'Start sedation', () => caseAct('start_sedation')),
    pbtn('surgery', 'Start procedure', () => caseAct('start_procedure')),
    pbtn('endsurgery', 'End procedure', () => caseAct('end_procedure')),
    pbtn('emergence', 'End sedation / recovery', () => caseAct('end_sedation')),
  ];
  const phasePanel = h('section', { class: 'hmi-panel', 'aria-labelledby': 'mon-ph-h' }, h('h3', { id: 'mon-ph-h' }, 'Phase'), h('div', { class: 'btn-row' }, phaseCtl), nextHint);

  // ---------------- airway
  const awState = h('p', { class: 'aw-state', id: 'mon-aw-state' });
  const maskBtn = h('button', { type: 'button', class: 'btn btn--hmi', id: 'aw-mask', 'aria-pressed': 'false' }, 'Mask ventilate');
  maskBtn.addEventListener('click', () => { act('mask_ventilate'); render(true); });
  const jawBtn = h('button', { type: 'button', class: 'btn btn--hmi', id: 'aw-jaw', 'aria-pressed': 'false' }, 'Jaw thrust');
  jawBtn.addEventListener('click', () => { act('jaw_thrust'); render(true); });
  const secBtn = h('button', { type: 'button', class: 'btn btn--hmi', id: 'aw-secure' }, 'Secure airway (tube)');
  secBtn.addEventListener('click', () => { act('secure_airway'); render(true); });
  const ventOn = h('button', { type: 'button', class: 'btn btn--hmi', id: 'aw-vent-on' }, 'Start ventilation');
  ventOn.addEventListener('click', () => { act('start_ventilation'); render(true); });
  const ventOff = h('button', { type: 'button', class: 'btn btn--hmi', id: 'aw-vent-off' }, 'Stop ventilation');
  ventOff.addEventListener('click', () => { act('stop_ventilation'); render(true); });
  const fio2Sel = h('select', { id: 'aw-fio2', class: 'input input--hmi' }, [0.21, 0.3, 0.4, 0.5, 0.6, 0.8, 1].map((v) => h('option', { value: v, selected: Math.abs(sim.state.airway.fio2 - v) < 1e-9 }, v.toFixed(2))));
  const fio2Btn = h('button', { type: 'button', class: 'btn btn--hmi', id: 'aw-fio2-set' }, 'Set FiO2');
  fio2Btn.addEventListener('click', () => { act(`set_fio2:${fio2Sel.value}`); render(true); });
  const airwayPanel = h('section', { class: 'hmi-panel', 'aria-labelledby': 'mon-aw-h' }, h('h3', { id: 'mon-aw-h' }, 'Airway & ventilation'), awState,
    h('div', { class: 'btn-row' }, maskBtn, jawBtn, secBtn, ventOn, ventOff),
    h('div', { class: 'inline-form' }, h('label', { for: 'aw-fio2', class: 'label' }, 'FiO2'), fio2Sel, fio2Btn));

  // ---------------- interventions: fluids, complications, sensor faults
  const fluids = ctx.fluidsSupported();
  const fluidOut = h('span', { id: 'mon-fluids' });
  const FL = lib.FLUIDS || [];
  const flType = h('select', { id: 'fl-type', class: 'input input--hmi', disabled: !fluids || !FL.length }, FL.map((f) => h('option', { value: f.id, selected: f.id === FLUID_MODEL.DEFAULT_FLUID }, f.name)));
  const flName = () => (FL.find((f) => f.id === flType.value) || { name: 'Crystalloid' }).name;
  // Simulator teaching ceiling (engine/teaching-ceilings.js): a refused dose/bolus above it can be given only after the
  // clinician presses the confirm button next to it (one dose; logged). Never pressed by guided/automatic modes.
  const teachText = (x) => (x ? `${x.label}: ${fmtNum(x.total, 3)} of ${fmtNum(x.limit, 3)} ${x.unit} — simulator teaching ceiling${x.unit !== x.ruleUnit ? ` (${x.ruleValue} ${x.ruleUnit})` : ''}, not a clinical limit${x.above ? ' (above: each further dose needs confirmation)' : ''}${x.pendingConfirmation ? ' · confirmation pending' : ''}` : '');
  const teachFor = (key) => (typeof sim.teachingCeilingStatus === 'function' ? sim.teachingCeilingStatus().find((x) => x.key === key) : null);
  const flTeach = h('p', { class: 'hint hint--hmi', id: 'fl-teach' });
  const flConfirm = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'fl-confirm', hidden: true }, 'Confirm dose above the simulator teaching ceiling');
  let flPending = null;
  const giveFluid = (cmdId, ml) => { const r = act(cmdId, `${flName()} ${ml} mL given`); flPending = r.teachingCeiling ? { cmdId, ml, key: r.teachingCeiling } : null; flConfirm.hidden = !flPending; if (flPending) flConfirm.setAttribute('aria-label', `Confirm ${ml} mL fluid bolus above the simulator teaching ceiling`); render(true); };
  flConfirm.addEventListener('click', () => { if (!flPending) return; const c = act(`confirm_teaching_ceiling:${flPending.key}`); const p0 = flPending; flPending = null; flConfirm.hidden = true; if (c.ok) giveFluid(p0.cmdId, p0.ml); });
  const fluidBtns = [250, 500].map((ml) => { const b = h('button', { type: 'button', class: 'btn btn--hmi', id: `fl-${ml}`, disabled: !fluids }, `Bolus ${ml} mL`); b.addEventListener('click', () => giveFluid(FL.length ? `fluid_bolus:${ml}:${flType.value}` : `fluid_bolus:${ml}`, ml)); return b; });
  const flRate = h('input', { type: 'number', min: 0, max: FLUID_MODEL.MAINTENANCE_MAX_ML_H, step: 'any', id: 'fl-rate', class: 'input input--hmi input--num', value: FLUID_MODEL.MAINTENANCE_DEFAULT_ML_H, disabled: !fluids || !FL.length });
  const flSet = h('button', { type: 'button', class: 'btn btn--hmi', id: 'fl-maint-set', disabled: !fluids || !FL.length }, 'Set maintenance');
  flSet.addEventListener('click', () => { act(`fluid_maintenance:${flType.value}:${flRate.value === '' ? 'x' : Number(flRate.value)}`); render(true); });
  const flStop = h('button', { type: 'button', class: 'btn btn--hmi btn--danger', id: 'fl-maint-stop', disabled: !fluids || !FL.length }, 'Stop maintenance');
  flStop.addEventListener('click', () => { act('fluid_maintenance_stop'); render(true); });
  const flMaint = h('p', { class: 'hint hint--hmi', id: 'fl-maint-state' });
  const flTotals = h('tbody', { id: 'mon-fluid-totals' });
  const flComp = h('p', { class: 'hint hint--hmi', id: 'fl-comp' });
  const renderComp = () => { const f = FL.find((x) => x.id === flType.value); clear(flComp); if (f) add(flComp, `${f.name} (${f.type}): ${fluidCompositionText(f)} (approx., label) `, srcTags(f.sources), `. ${f.labelNotes.join(' ')}`); };
  flType.addEventListener('change', renderComp); renderComp();
  const fluidPanel = h('section', { class: 'hmi-panel', id: 'mon-fluids-panel', 'aria-labelledby': 'mon-fl-h' }, h('h3', { id: 'mon-fl-h' }, 'IV fluids'),
    h('div', { class: 'inline-form' }, h('label', { for: 'fl-type', class: 'label' }, 'Fluid'), flType),
    h('div', { class: 'btn-row' }, fluidBtns, flConfirm), flTeach,
    h('div', { class: 'inline-form' }, h('label', { for: 'fl-rate', class: 'label' }, 'Maintenance (mL/h)'), flRate, flSet, flStop), flMaint,
    h('div', { class: 'table-wrap' }, h('table', { class: 'table table--hmi table--compact' }, h('caption', { class: 'sr-only' }, 'Fluid totals by type'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Fluid'), h('th', { scope: 'col' }, 'Boluses'), h('th', { scope: 'col' }, 'Maintenance'), h('th', { scope: 'col' }, 'Total'))), flTotals)),
    h('p', { class: 'hint hint--hmi' }, fluids ? ['Cumulative crystalloid: ', fluidOut, '. Rates and volumes are simulator choices (labels give no fixed dose); both fluids use the same illustrative volume model.'] : 'Fluids are not available in this engine version.'),
    flComp,
    lib.FLUID_EVIDENCE_NOTE ? h('p', { class: 'hint hint--hmi' }, lib.FLUID_EVIDENCE_NOTE.text, ' ', srcTags(lib.FLUID_EVIDENCE_NOTE.sources)) : null);

  // ---------------- antibiotic prophylaxis (timing only; engine/prophylaxis.js)
  const ABX = lib.ANTIBIOTICS || [];
  const abxBest = selectProphylaxis(patient, lib);
  const abxSel = h('select', { id: 'abx-drug', class: 'input input--hmi' }, ABX.map((a) => { const r = recommend(patient, 'prophylaxis', a.id, lib); return h('option', { value: a.id, disabled: r.locked, selected: a.id === abxBest.drugId }, `${a.name} ${r.locked ? '— LOCKED' : `${r.dose.value} ${r.dose.unit}`}`); }));
  const abxGive = h('button', { type: 'button', class: 'btn btn--hmi', id: 'abx-give' }, 'Give prophylaxis dose');
  abxGive.addEventListener('click', () => { const r0 = recommend(patient, 'prophylaxis', abxSel.value, lib); const r = sim.administer({ drugId: abxSel.value, kind: 'antibiotic', amount: r0.dose ? r0.dose.value : NaN, amountUnit: r0.dose ? r0.dose.unit : 'mg' }); const n = getDrugById(lib, abxSel.value).name; feedback(r.ok ? `${n} given (timing only).${r.warnings.length ? ` Warnings: ${r.warnings.join('; ')}` : ''}` : `BLOCKED: ${n} — ${r.reasons.join('; ')}`, !r.ok, r.warnings.length > 0); render(true); });
  const abxState = h('p', { class: 'hint hint--hmi', id: 'abx-state' });
  const abxCheck = h('div', { class: 'checklist', id: 'abx-checklist', role: 'group', 'aria-label': 'Antibiotic prophylaxis checklist', hidden: true });
  const abxCheckMsg = h('p', { class: 'checklist__msg', id: 'abx-checklist-msg' });
  const abxAck = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'abx-ack', 'data-auto-safe': 'acknowledge' }, 'Acknowledge: proceed without prophylaxis in window');
  abxAck.addEventListener('click', () => { const r = sim.action('acknowledge_checklist:antibiotic'); feedback(r.message, !r.ok); announce(r.message); render(true); });
  add(abxCheck, h('p', { class: 'checklist__title' }, '☐ Checklist before Start surgery: antibiotic prophylaxis'), abxCheckMsg, abxAck);
  const abxPanel = ABX.length ? h('section', { class: 'hmi-panel', id: 'abx-panel', 'aria-labelledby': 'abx-h' }, h('h3', { id: 'abx-h' }, 'Antibiotic prophylaxis'),
    abxCheck,
    h('div', { class: 'inline-form' }, h('label', { for: 'abx-drug', class: 'label' }, 'Agent'), abxSel, abxGive), abxState,
    h('p', { class: 'hint hint--hmi' }, `Guideline (Bratzler 2013): start within 60 min before incision (vancomycin 120 min); redose cefazolin every 4 h, clindamycin every 6 h. ${abxBest.reason} Timing only — antibiotic pharmacology is not modelled. `, srcTags(abxBest.sources))) : null;
  const nonSensor = SCENARIOS.filter((s) => !s.perturbation.sensor);
  const sensor = SCENARIOS.filter((s) => s.perturbation.sensor);
  const cxSel = h('select', { id: 'cx-select', class: 'input input--hmi' }, h('option', { value: '' }, 'Choose a complication…'), nonSensor.map((s) => h('option', { value: s.id }, s.label)));
  const cxBtn = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'cx-inject' }, 'Inject');
  const teach = h('div', { class: 'teach', id: 'cx-teach', 'aria-live': 'polite' });
  const inject = (id) => { const s = SCENARIOS.find((x) => x.id === id); const r = sim.inject(id); feedback(r.ok ? `${r.message} injected.` : r.message, !r.ok); if (r.ok) fill(teach, h('p', {}, h('strong', {}, `${s.label}: `), s.description), h('p', { class: 'hint hint--hmi' }, h('strong', {}, 'Teaching point: '), s.teachingPoint)); render(true); };
  cxBtn.addEventListener('click', () => { if (!cxSel.value) { cxSel.focus(); return; } inject(cxSel.value); });
  const sensorBtns = sensor.map((s) => { const b = h('button', { type: 'button', class: 'btn btn--hmi', id: `sf-${s.id}` }, s.label); b.addEventListener('click', () => inject(s.id)); return b; });
  const intPanel = h('section', { class: 'hmi-panel', 'aria-labelledby': 'mon-int-h' }, h('h3', { id: 'mon-int-h' }, 'Interventions & complications'),
    h('div', { class: 'inline-form' }, h('label', { for: 'cx-select', class: 'label' }, 'Complication'), cxSel, cxBtn),
    h('div', { class: 'btn-row' }, h('span', { class: 'label' }, 'Sensor faults:'), sensorBtns), teach);

  // ---------------- drugs
  const drugBody = h('tbody', { id: 'mon-drugs' });
  let drugSig = ''; const drugCells = {};
  const drugTable = h('div', { class: 'table-wrap' }, h('table', { class: 'table table--hmi' },
    h('caption', { class: 'sr-only' }, 'Active drugs'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Drug'), h('th', { scope: 'col' }, 'Rate / dial'), h('th', { scope: 'col' }, 'Ce (illustrative)'), h('th', { scope: 'col' }, 'Cumulative'), h('th', { scope: 'col' }, 'Controls'))),
    drugBody));
  const drugEmpty = h('p', { class: 'hint hint--hmi' }, 'No drugs given yet. Plan steps run when their phase starts; or give a drug below.');

  // administer form
  const adDrug = h('select', { id: 'ad-drug', class: 'input input--hmi' }, h('option', { value: '' }, 'Choose drug…'),
    groupDrugs(lib).map(([cl, ds]) => h('optgroup', { label: CLASS_LABELS[cl] || cl }, ds.map((d) => h('option', { value: d.id, disabled: !!sim.state.interlocks.lockouts[d.id] }, `${d.name}${sim.state.interlocks.lockouts[d.id] ? ' — LOCKED' : ''}`)))));
  const adKind = h('select', { id: 'ad-kind', class: 'input input--hmi' });
  const adRoute = h('select', { id: 'ad-route', class: 'input input--hmi' });
  const adRouteWrap = h('div', { class: 'field field--sm', hidden: true }, h('label', { for: 'ad-route', class: 'label' }, 'Route'), adRoute);
  const adVal = h('input', { type: 'number', step: 'any', min: 0, id: 'ad-value', class: 'input input--hmi input--num' });
  const adUnit = h('span', { class: 'unit', id: 'ad-unit' });
  const adOver = h('input', { type: 'number', step: 'any', min: 0, id: 'ad-over', class: 'input input--hmi input--num', placeholder: 'push' });
  const adOverWrap = h('div', { class: 'field field--sm' }, h('label', { for: 'ad-over', class: 'label' }, 'Over (min)'), adOver, h('p', { class: 'hint hint--hmi', id: 'ad-over-hint' }, 'blank = push; ≥ 1 min'));
  adOver.setAttribute('aria-describedby', 'ad-over-hint');
  const adInfo = h('div', { class: 'ad-info', id: 'ad-info' });
  const adGive = h('button', { type: 'button', class: 'btn btn--hmi btn--primary', id: 'ad-give' }, 'Give');
  const adTeach = h('p', { class: 'hint hint--hmi', id: 'ad-teach' });
  const adConfirm = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'ad-confirm', hidden: true }, 'Confirm dose above the simulator teaching ceiling');
  let adPending = null;
  const teachKeyFor = (drugId, route) => { const d = getDrugById(lib, drugId); const r = route || (d && Array.isArray(d.bolusRoutes) && d.bolusRoutes[0]) || 'IV'; const g = TEACHING_GUARDS.find((x) => x.drugId === drugId && x.routes.includes(r)); return g ? g.key : null; };
  let adCtx = null;
  adDrug.addEventListener('change', () => fillKinds());
  adKind.addEventListener('change', () => { syncRoutes(); prefill(); });
  adRoute.addEventListener('change', () => prefill());
  function syncRoutes() {
    const d = getDrugById(lib, adDrug.value);
    const routes = d && Array.isArray(d.bolusRoutes) && d.bolusRoutes.length > 1 ? d.bolusRoutes : null;
    const show = !!routes && adKind.value === 'bolus';
    adRouteWrap.hidden = !show; adRoute.hidden = !show;
    if (show && [...adRoute.options].map((o) => o.value).join() !== routes.join()) { fill(adRoute, ...routes.map((r) => h('option', { value: r }, r))); }
  }
  function fillKinds(kindWanted = null) {
    clear(adKind); const d = getDrugById(lib, adDrug.value); if (!d) { clear(adInfo); return; }
    const kinds = [...new Set(Object.values(d.regimens || {}).flatMap((r) => (r.kind === 'infusion' && r.loading ? ['bolus', 'infusion'] : [r.kind])))];
    for (const k of kinds) add(adKind, h('option', { value: k, selected: k === kindWanted }, KIND_LABELS[k]));
    syncRoutes();
    prefill();
  }
  function prefill() {
    const d = getDrugById(lib, adDrug.value); const kind = adKind.value; if (!d || !kind) return;
    const pk = regimenKeyForPhase(sim.state.phase, sim.plan.sedationTarget);
    const keys = [pk, 'rescue', ...Object.keys(d.regimens || {})];
    const route = adRoute.hidden ? null : adRoute.value;
    const key = keys.find((k) => d.regimens[k] && (d.regimens[k].kind === kind || (kind === 'bolus' && d.regimens[k].loading)) && (!route || kind !== 'bolus' || (d.regimens[k].route || 'IV') === route));
    const rec = key ? recommend(patient, key, d.id, lib) : null;
    adCtx = { drug: d, kind, key, rec };
    clear(adInfo);
    adOverWrap.hidden = kind !== 'bolus' || (route && route !== 'IV'); adOver.value = '';
    const ds = sim.state.drugs[d.id];
    if (kind === 'bolus') {
      const dz = rec && (rec.kind === 'bolus' ? rec.dose : rec.loading);
      adVal.value = dz ? dz.value : ''; adUnit.textContent = d.amountUnit;
      if (dz && dz.overSec) adOver.value = dz.overSec / 60;
      if (dz) add(adInfo, h('p', {}, `Sourced ${key} range ${dz.range.min ?? 0}–${dz.range.max} ${dz.unit}${dz.perKg ? ` (${dz.perKg.min ?? dz.perKg.value}–${dz.perKg.max ?? dz.perKg.value} ${dz.perKg.unit} × ${rec.weightUsedKg} kg ${rec.scalar})` : ''} `, srcTags(rec.sources)));
    } else {
      const r = rec && rec.rate;
      let v = ds.infusionRate > 0 ? ds.infusionRate : r ? r.value : '';
      const unit = r ? r.unit : ds.rateUnit;
      const ic = kind === 'infusion' ? interlockCeiling(d, unit, patient) : null;
      if (store.interlocks && ic && isNum(v) && exceedsInterlockCeiling(d, v, unit, patient)) { v = ic.value; add(adInfo, h('p', { class: 'note note--interlock' }, interlockNote(rec, ic), ' ', srcTags([E.pythonConfig]))); }
      adVal.value = v; adUnit.textContent = unit || '';
      if (r) add(adInfo, h('p', {}, `Sourced ${key} range ${r.range.min ?? 0}–${r.range.max} ${r.unit}${r.unit.includes('/kg') ? ` · ${rec.weightUsedKg} kg ${rec.scalar}` : ''} `, srcTags(rec.sources)));
      if (r && r.ageAdjustedMac) add(adInfo, h('p', { class: 'hint hint--hmi' }, `1.0 × age-adjusted MAC = ${r.ageAdjustedMac.value} % `, srcTags(r.ageAdjustedMac.sources)));
    }
    if (rec) for (const w of rec.warnings) add(adInfo, h('p', { class: 'warn-text' }, 'Warning: ', w));
  }
  adGive.addEventListener('click', () => {
    if (!adCtx || !adCtx.drug) { adDrug.focus(); feedback('Choose a drug first.', true); return; }
    const v = Number(adVal.value); const { drug, kind } = adCtx;
    const cmd = { drugId: drug.id, kind };
    if (kind === 'bolus') {
      cmd.amount = v; cmd.amountUnit = drug.amountUnit;
      if (!adRoute.hidden) cmd.route = adRoute.value;
      const o = Number(adOver.value);
      if (!adOverWrap.hidden && adOver.value !== '') {
        if (!isNum(o) || o < 0) { feedback('“Over” must be a number of minutes (blank or 0 = push).', true); adOver.focus(); return; }
        if (o > 0 && o < 1) { feedback('“Over” under 1 min is not modelled: leave it blank for a push, or use 1 min or more.', true); adOver.focus(); return; }
        if (o >= 1) cmd.overSec = o * 60;
      }
    }
    else { cmd.rate = v; cmd.rateUnit = adUnit.textContent || sim.state.drugs[drug.id].rateUnit; }
    giveCmd(drug, cmd, kind, v);
  });
  function giveCmd(drug, cmd, kind, v) {
    const r = sim.administer(cmd);
    const what = kind === 'bolus' ? `${v} ${drug.amountUnit}${cmd.route ? ` ${cmd.route}` : ''}` : `${v} ${cmd.rateUnit}`;
    feedback(r.ok ? `${drug.name} ${what} ${kind === 'bolus' ? 'given' : 'set'}.${r.warnings.length ? ` Warnings: ${r.warnings.join('; ')}` : ''}` : `BLOCKED: ${drug.name} ${what} — ${r.reasons.join('; ')}`, !r.ok, r.warnings.length > 0);
    adPending = r.teachingCeiling ? { drug, cmd, kind, v, key: r.teachingCeiling } : null;
    adConfirm.hidden = !adPending;
    if (adPending) adConfirm.setAttribute('aria-label', `Confirm ${drug.name} ${what} above the simulator teaching ceiling`);
    render(true);
  }
  adConfirm.addEventListener('click', () => { if (!adPending) return; const p0 = adPending; adPending = null; adConfirm.hidden = true; const c = act(`confirm_teaching_ceiling:${p0.key}`); if (c.ok) giveCmd(p0.drug, p0.cmd, p0.kind, p0.v); });
  const adminForm = h('div', { class: 'admin-form' },
    h('h4', {}, 'Give / adjust a drug'),
    h('div', { class: 'admin-form__row' },
      h('div', { class: 'field field--sm' }, h('label', { for: 'ad-drug', class: 'label' }, 'Drug'), adDrug),
      h('div', { class: 'field field--sm' }, h('label', { for: 'ad-kind', class: 'label' }, 'How'), adKind),
      adRouteWrap,
      h('div', { class: 'field field--sm' }, h('label', { for: 'ad-value', class: 'label' }, 'Amount / rate'), h('span', { class: 'with-unit' }, adVal, adUnit)),
      adOverWrap, adGive, adConfirm), adInfo, adTeach);
  const fb = h('p', { class: 'feedback', id: 'mon-feedback', role: 'status' });
  function feedback(msg, bad = false, warn = false) { fb.textContent = msg; fb.className = `feedback ${bad ? 'feedback--bad' : warn ? 'feedback--warn' : 'feedback--ok'}`; }
  const drugPanel = h('section', { class: 'hmi-panel hmi-panel--wide', 'aria-labelledby': 'mon-drugs-h' }, h('h3', { id: 'mon-drugs-h' }, 'Drugs & infusions'), drugEmpty, drugTable, adminForm);

  // ---------------- readiness (GA)
  const readyList = h('ul', { class: 'ready-list', id: 'mon-ready' });
  const readyHead = h('p', { class: 'ready-head' });
  const readyPanel = isGA ? h('section', { class: 'hmi-panel', 'aria-labelledby': 'mon-ready-h' }, h('h3', { id: 'mon-ready-h' }, 'Extubation readiness (live)'), readyHead, readyList,
    h('p', { class: 'hint hint--hmi' }, 'TOFR ≥ 0.9 before extubation ', srcTags([E.tofExtubation]), '. Without reversal, rocuronium recovery is slow; sugammadex dose depends on block depth.')) : null;

  // ---------------- advisory haemodynamic rescue (engine/rescue.js): suggestions only; a bolus is given
  // only when the clinician presses "Give suggested bolus" (it does not end guided/automatic mode).
  const advisor = createRescueAdvisor(sim);
  let autoDirty = false; let inAdvance = false; let focusResume = false; // runner-event re-render state
  const advAccept = (id) => { const r = advisor.accept(id); feedback(r.message, !r.ok, !!(r.warnings && r.warnings.length)); announce(r.message); render(true); };
  const advDismiss = (id) => { const r = advisor.dismiss(id); feedback(r.message, !r.ok); announce(r.message); render(true); };
  const advRun = advisoryCard({ prefix: 'adv', live: true, onAccept: advAccept, onDismiss: advDismiss });
  const advAuto = advisoryCard({ prefix: 'auto-adv', live: false, onAccept: advAccept, onDismiss: advDismiss });
  // Depth-low advisory (engine/depth-advisory.js): TEXT ONLY — no drug/dose/rate, not an alarm, never pauses
  // guided/automatic mode. Only "Dismiss" (logged). Before incision the pre-incision item applies instead.
  const depthAdvisor = createDepthAdvisor(sim);
  const depthDismiss = (id) => { const r = depthAdvisor.dismiss(id); feedback(r.message, !r.ok); announce(r.message); render(true); };
  const depthRun = depthAdvisoryCard({ prefix: 'dadv', live: true, onDismiss: depthDismiss });
  const depthAuto = depthAdvisoryCard({ prefix: 'auto-dadv', live: false, onDismiss: depthDismiss });

  // ---------------- guided / automatic modes (engine/autorun.js; conditions in engine/autorun-config.js)
  const autoStatus = h('p', { class: 'auto-status', id: 'auto-status' });
  const autoBanner = h('p', { class: 'auto-banner', id: 'auto-banner', hidden: true });
  // Paused banner (2026-11 fix): shown the moment the runner pauses itself, with the reason and the exact
  // action needed; Resume is enabled while paused (it re-checks and lists anything still needed).
  const autoPausedHead = h('p', { class: 'auto-paused__head', id: 'auto-paused-head' });
  const autoPausedList = h('ul', { class: 'auto-paused__list', id: 'auto-paused-list' });
  // "Continue with hold latched (this hold only)" (owner-approved): explicit clinician choice, logged; never a default.
  const autoHoldContinue = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'auto-hold-continue', hidden: true }, 'Continue with hold latched (this hold only)');
  const autoHoldHint = h('p', { class: 'hint hint--hmi', id: 'auto-hold-hint', hidden: true }, 'Continues with the held infusions at zero. It does not release the hold or acknowledge any alarm; a new hold or a new HIGH alarm pauses again.');
  const autoPaused = h('div', { class: 'auto-paused', id: 'auto-paused', role: 'alert', hidden: true }, autoPausedHead, autoPausedList, autoHoldHint, autoHoldContinue);
  const autoGate = h('button', { type: 'button', class: 'btn btn--hmi btn--primary auto-gate', id: 'auto-gate', hidden: true });
  const autoUnmet = h('ul', { class: 'auto-unmet', id: 'auto-unmet' });
  // Countdown for time-gated transitions (pre-op holding → OR → preoxygenation → induction).
  const autoCountdown = h('p', { class: 'auto-countdown', id: 'auto-countdown', 'aria-live': 'off', hidden: true });
  // Pre-incision / pre-procedure verification (engine/timing.js preIncisionItems). Clinician-only items
  // (WHO time out, an index below the GA band, missing prophylaxis) are satisfied ONLY by these buttons;
  // they do not end guided/automatic mode and the runner never presses them.
  const autoCkList = h('ul', { class: 'checklist__items', id: 'auto-checklist-items' });
  const autoCkMsg = h('p', { class: 'checklist__msg', id: 'auto-checklist-msg' });
  const clin = (id) => { const r = run.auto ? run.auto.clinicianAction(id) : { ok: false, message: 'Not running' }; feedback(r.message, !r.ok); announce(r.message); render(true); return r; };
  autoHoldContinue.addEventListener('click', () => { const r = clin('continue_with_hold'); if (r && r.ok && r.resumed && run.auto && run.auto.state === 'running' && !run.playing) setPlaying(true, true); render(true); });
  const autoTimeOut = h('button', { type: 'button', class: 'btn btn--hmi btn--primary', id: 'auto-timeout' }, 'Confirm WHO time out');
  autoTimeOut.addEventListener('click', () => clin('confirm_time_out'));
  const autoDepthAck = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'auto-depth-ack', hidden: true }, `Acknowledge index below the GA band (${GA_BAND[0]})`);
  autoDepthAck.addEventListener('click', () => clin('acknowledge_depth_below_band'));
  const autoAbxGive = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'auto-abx-give', hidden: true }, 'Give guideline prophylaxis now');
  autoAbxGive.addEventListener('click', () => clin('give_prophylaxis'));
  // Sedation below the plan target (MAC): (a) titrate within the label range (clinician-approved, logged), or
  // (b) acknowledge and start the procedure at the current level. Never automatic.
  const autoSedMsg = h('p', { class: 'checklist__msg auto-sed__msg', id: 'auto-sed-msg', hidden: true });
  const autoSedTitrate = h('button', { type: 'button', class: 'btn btn--hmi btn--primary', id: 'auto-sed-titrate', hidden: true }, 'Titrate');
  autoSedTitrate.addEventListener('click', () => clin('titrate_sedation'));
  const autoSedAck = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'auto-sed-ack', hidden: true }, 'Acknowledge and start procedure at current level');
  autoSedAck.addEventListener('click', () => {
    if (!run.auto) return;
    const r = run.auto.clinicianAction('acknowledge_sedation_below_target');
    let msg = r.message;
    // Guided: the clinician's acknowledgement also presses "Start procedure" when every other item is met.
    if (r.ok && run.auto.mode === 'guided' && run.auto.state === 'running') {
      const st = run.auto.status();
      if (st.current && st.current.id === 'start_procedure' && st.current.enabled) { const a = run.auto.approve('start_procedure'); msg = `${msg}. ${a.message}`; if (a.ok && !run.playing) setPlaying(true, true); }
    }
    feedback(msg, !r.ok); announce(msg); render(true);
  });
  const autoCk = h('div', { class: 'checklist', id: 'auto-checklist', role: 'group', 'aria-label': 'Verification before Start surgery / Start procedure', hidden: true },
    h('p', { class: 'checklist__title' }, 'Verification before incision — every item must be met; you confirm the time out ', srcTags([...TIMING_CONFIG.TIME_OUT_REQUIRED.sourceIds])), autoCkList, autoCkMsg,
    autoSedMsg, h('div', { class: 'btn-row' }, autoTimeOut, autoDepthAck, autoAbxGive, autoSedTitrate, autoSedAck));
  // Live timing check (engine/timing.js liveTimingChecks): warnings stay visible before each gate.
  const autoTiming = h('ul', { class: 'tchecks', id: 'auto-timing' });
  const autoTimingBox = h('details', { class: 'auto-timing', id: 'auto-timing-box', open: true }, h('summary', {}, 'Timing check (live)'), autoTiming);
  const autoSeq = h('ol', { class: 'auto-seq', id: 'auto-seq' });
  const autoPause = h('button', { type: 'button', class: 'btn btn--hmi', id: 'auto-pause' }, 'Pause');
  const autoResume = h('button', { type: 'button', class: 'btn btn--hmi', id: 'auto-resume' }, 'Resume');
  const autoTake = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'auto-takeover' }, 'Take over manually');
  const autoGuided = h('button', { type: 'button', class: 'btn btn--hmi btn--primary', id: 'auto-guided' }, 'Start guided mode');
  const autoFull = h('button', { type: 'button', class: 'btn btn--hmi', id: 'auto-full' }, 'Run full case automatically');
  const autoStartRow = h('div', { class: 'btn-row', id: 'auto-start-row' }, autoGuided, autoFull);
  const autoCtlRow = h('div', { class: 'btn-row', id: 'auto-ctl-row' }, autoPause, autoResume, autoTake);
  const autoPanel = h('section', { class: 'hmi-panel auto-panel', id: 'auto-panel', 'aria-labelledby': 'auto-h', 'data-auto-safe': 'auto-panel' },
    h('h3', { id: 'auto-h' }, 'Guided & automatic modes'), autoBanner,
    h('p', { class: 'hint hint--hmi', id: 'auto-intro' }, `Use the patient and plan already entered (doses are not changed) and start the case from 00:00. Guided mode runs each phase from your plan and waits for you at every transition; the full demonstration walks the same sequence on fixed timings. Both pause for an interlock hold or a HIGH-priority alarm (never clearing or acknowledging it), never extubate unless the readiness checklist is met, and end as soon as you use any manual control. Every step is logged (log kind "auto").`),
    autoStartRow, autoStatus, autoPaused, autoCtlRow, autoCountdown, autoGate, autoCk, autoUnmet, advAuto.el, depthAuto.el, autoTimingBox, autoSeq);
  const startAuto = (mode) => {
    if (sim.state.tSec > 0 || sim.state.phase !== 'premed') { ctx.restartSim(); store.run.autoStart = mode; ctx.rerender(); return; }
    beginAuto(mode);
  };
  function beginAuto(mode) {
    run.auto = createAutoRunner({ sim, mode, onEvent: (ev) => { if (run.autoListener) run.autoListener(ev); } });
    run.autoListener = onAutoEvent;
    const r = run.auto.start();
    feedback(r.message, !r.ok); announce(`${MODE_LABELS[mode]} started. ${BANNERS[mode]}`);
    if (r.ok) setPlaying(true, true);
    render(true);
  }
  function onAutoEvent(ev) {
    if (!alive) return;
    const bad = ev.type === 'paused' || ev.type === 'stopped' || ev.type === 'still_paused' || ev.type === 'timeout_warning';
    if (['paused', 'stopped', 'completed', 'still_paused'].includes(ev.type) && run.playing) setPlaying(false, true);
    feedback(ev.message, bad && ev.type !== 'timeout_warning', ev.type === 'timeout_warning');
    if (ev.type !== 'started') announce(ev.message, bad);
    // Re-render the panel at once on every runner state change (2026-11 fix: the clock stops on a self-pause,
    // so the animation loop no longer renders; the panel used to stay "running" with Resume disabled).
    autoDirty = true;
    if (!inAdvance) render(true);
    if (ev.type === 'paused' && ev.reasons && ev.reasons.some((x) => x.kind !== 'user')) focusResume = true;
  }
  run.autoListener = run.auto ? onAutoEvent : null;
  autoGuided.addEventListener('click', () => startAuto('guided'));
  autoFull.addEventListener('click', () => startAuto('full'));
  autoPause.addEventListener('click', () => { if (run.auto) { const r = run.auto.pause(); if (!r.ok) feedback(r.message, true); render(true); } });
  autoResume.addEventListener('click', () => { if (!run.auto) return; const r = run.auto.resume(); if (r.ok) setPlaying(true, true); render(true); });
  autoTake.addEventListener('click', () => { if (run.auto) { run.auto.takeOver('Take over manually button'); render(true); } });
  // A gate click approves only the gate id that was rendered on the button (dataset.gate), and the
  // button stays disabled while the approval is processed and for GATE_COOLDOWN_MS afterwards, so a
  // double-click or key repeat cannot approve the next gate (2026-11 audit, finding 2).
  let gateBusy = false; let gateTimer = null;
  autoGate.addEventListener('click', () => {
    if (gateBusy || autoGate.disabled || !run.auto) return;
    const shownId = autoGate.dataset.gate; if (!shownId) return;
    gateBusy = true; autoGate.disabled = true; autoGate.dataset.busy = '1';
    let r;
    try { r = run.auto.approve(shownId); } finally {
      if (gateTimer) clearTimeout(gateTimer);
      gateTimer = setTimeout(() => { gateBusy = false; gateTimer = null; delete autoGate.dataset.busy; if (alive) render(true); }, GATE_COOLDOWN_MS);
    }
    feedback(r.message, !r.ok);
    if (r.ok && run.auto.state === 'running' && !run.playing) setPlaying(true, true);
    render(true);
  });
  // Any manual control on the monitor (phase, airway, drug, fluid, complication, sensor, step,
  // play, restart) ends guided/automatic mode first; speed, alarm acknowledge, "Resume hold" and
  // the mode panel itself do not (data-auto-safe).
  const describeControl = (b) => (b.getAttribute('aria-label') || b.textContent || b.id || 'control').trim().replace(/\s+/g, ' ');
  function renderAuto() {
    const A = run.auto; const st = A ? A.status() : null;
    const active = !!(st && st.active);
    autoStartRow.hidden = active; autoCtlRow.hidden = !active;
    autoBanner.hidden = !st; if (st) setText(autoBanner, st.banner);
    autoPanel.classList.toggle('auto-panel--active', active);
    autoPanel.classList.toggle('auto-panel--paused', !!st && st.state === 'paused');
    if (!st) { setText(autoStatus, ''); autoGate.hidden = true; autoPaused.hidden = true; clear(autoUnmet); clear(autoSeq); return; }
    const stateText = { running: 'running', paused: 'PAUSED', completed: 'complete', stopped: 'STOPPED', manual: 'ended (manual control)' }[st.state] || st.state;
    setText(autoStatus, `${st.modeLabel} — ${stateText}. ${st.message}`);
    autoPause.disabled = st.state !== 'running'; autoResume.disabled = st.state !== 'paused';
    autoDirty = false;
    const paused = st.state === 'paused';
    autoPaused.hidden = !paused;
    autoHoldContinue.hidden = !(paused && st.canContinueWithHold); autoHoldHint.hidden = autoHoldContinue.hidden;
    if (paused) {
      const det = st.pauseDetails || [];
      const head = det.length ? `Paused — ${det.map((d) => String(d.headline).replace(/[.\s]+$/, '')).join('; ')}. ${det.length === 1 ? det[0].action : 'Do each action below, then press Resume.'}` : `Paused — ${st.message}`;
      setText(autoPausedHead, head);
      const psig = det.map((d) => d.headline + d.action).join('|');
      if (autoPausedList.dataset.sig !== psig) { autoPausedList.dataset.sig = psig; fill(autoPausedList, ...(det.length > 1 ? det.map((d) => h('li', {}, h('strong', {}, d.headline), ` — ${d.action}`)) : [])); }
    }
    if (focusResume && paused) { focusResume = false; announce(autoPausedHead.textContent, true); if (!autoResume.disabled) autoResume.focus({ preventScroll: true }); }
    const c = st.current;
    const showGate = active && st.mode === 'guided' && c && c.gate;
    autoGate.hidden = !showGate;
    if (showGate) { setText(autoGate, c.gateLabel); autoGate.disabled = !c.enabled || gateBusy; autoGate.dataset.gate = c.id; }
    else delete autoGate.dataset.gate;
    const cd = active && c && c.countdownSec > 0 ? c.countdownSec : null;
    autoCountdown.hidden = cd === null;
    if (cd !== null) setText(autoCountdown, `⏱ ${c.gateLabel || c.label}: available in ${fmtClock(cd)} — ${(c.unmet[0] || '').replace(/ — \d+ s to go.*$/, '')}`);
    const items = active && c && c.items ? c.items : null;
    autoCk.hidden = !items;
    if (items) {
      const isig = items.map((x) => `${x.id}${x.met}${x.detail}`).join('|');
      if (autoCkList.dataset.sig !== isig) {
        autoCkList.dataset.sig = isig;
        // Keyed (audit 05l): the live detail (e.g. the depth index) changes every render; the source-tag
        // buttons and items persist, only texts change.
        reconcileKeyed(autoCkList, items, { key: (x) => x.id, create: checkItem, update: updateCheckItem });
      }
      const need = (id) => items.some((x) => x.id === id && !x.met && (x.clinician || id === 'antibiotic'));
      autoTimeOut.hidden = !items.some((x) => x.id === 'time_out' && !x.met); autoDepthAck.hidden = !need('depth'); autoAbxGive.hidden = !need('antibiotic');
      const sedIt = items.find((x) => x.id === 'sedation' && !x.met && x.clinician && x.belowTarget);
      autoSedMsg.hidden = !sedIt; autoSedAck.hidden = !sedIt; autoSedTitrate.hidden = !sedIt;
      if (sedIt) {
        const tz = st.titration;
        setText(autoSedMsg, `Sedation below the planned target (${sedIt.belowTarget.level} vs ${sedIt.belowTarget.target}). Choose: titrate within the label range, or acknowledge and start the procedure at the current level. Nothing is done automatically.`);
        if (!tz || tz.none) { setText(autoSedTitrate, 'Titrate: no further step within the label range'); autoSedTitrate.disabled = true; }
        else { setText(autoSedTitrate, `Titrate: ${tz.label} [${tz.sources.join(', ')}]${tz.waitSec > 0 ? ` — reassess, allowed in ${fmtClock(tz.waitSec)}` : ''}`); autoSedTitrate.disabled = tz.waitSec > 0; }
      }
      setText(autoCkMsg, c.checklist ? `Antibiotic: ${c.checklist}` : '');
    }
    if (active && run.auto) {
      const tc = run.auto.timingChecks(); const tsig = tc.map((x) => `${x.id}${x.status}${x.message}`).join('|');
      if (autoTiming.dataset.sig !== tsig) { autoTiming.dataset.sig = tsig; const seen = {}; const keyed = tc.map((x) => ({ x, k: `${x.id}#${seen[x.id] = (seen[x.id] || 0) + 1}` })); // ids repeat (repeat_bolus, stop_before_end)
        reconcileKeyed(autoTiming, keyed, { key: (y) => y.k, create: timingCheckItem, update: (it, y) => updateTimingCheckItem(it, y.x), empty: () => h('li', { class: 'hint' }, 'No timing events yet.') }); }
    }
    autoTimingBox.hidden = !active;
    const unmet = st.state === 'stopped' ? st.unmetAtStop : active && c && !c.conditionsMet ? c.unmet : [];
    const usig = unmet.join('|') + st.state;
    if (autoUnmet.dataset.sig !== usig) {
      autoUnmet.dataset.sig = usig;
      fill(autoUnmet, ...(unmet.length ? [h('li', { class: 'auto-unmet__head' }, st.state === 'stopped' ? 'Unmet when stopped:' : `Waiting for${c && c.timedOut ? ' (time limit passed)' : ''}:`), ...unmet.map((u) => h('li', {}, '✗ ', u))] : []));
    }
    const ssig = st.sequence.map((x) => `${x.done}${x.current}`).join('') + st.state;
    if (autoSeq.dataset.sig !== ssig) {
      autoSeq.dataset.sig = ssig;
      fill(autoSeq, ...st.sequence.map((x) => h('li', { class: x.done ? 'is-done' : x.current ? 'is-current' : '' },
        h('span', { class: 'auto-seq__mark', 'aria-hidden': 'true' }, x.done ? '✓' : x.current ? '▶' : '○'),
        h('span', { class: 'sr-only' }, x.done ? 'Done: ' : x.current ? 'Current: ' : 'Pending: '),
        `${x.label}${x.gate && st.mode === 'guided' ? ' (you confirm)' : x.gate ? '' : ' (automatic)'}`, h('span', { class: 'hint hint--hmi' }, ` — ${x.describe}`))));
    }
  }

  // ---------------- log
  const logFilter = h('select', { id: 'log-filter', class: 'input input--hmi' }, ['all', 'dose', 'alarm', 'interlock', 'action', 'phase', 'event', 'auto', 'advisory'].map((k) => h('option', { value: k }, k === 'all' ? 'All entries' : k === 'auto' ? 'auto (guided / automatic steps)' : k === 'advisory' ? 'advisory (rescue suggestions)' : k)));
  const logList = h('ol', { class: 'log', id: 'mon-log', reversed: true });
  let logLen = -1;
  logFilter.addEventListener('change', () => { logLen = -1; renderLog(); });
  const logPanel = h('section', { class: 'hmi-panel hmi-panel--wide', 'aria-labelledby': 'mon-log-h' }, h('h3', { id: 'mon-log-h' }, 'Event log'),
    h('div', { class: 'inline-form' }, h('label', { for: 'log-filter', class: 'label' }, 'Show'), logFilter), logList);

  const toDebrief = h('button', { type: 'button', class: 'btn btn--primary', id: 'mon-debrief' }, 'Finish → Debrief');
  toDebrief.addEventListener('click', () => ctx.go(5));

  fill(main, 
    h('div', { class: 'step-head' }, h('h2', { id: 'step-title', tabindex: '-1' }, '4 · Run'),
      h('p', { class: 'muted' }, `${isGA ? 'General anaesthesia' : `MAC / sedation (target: ${sim.plan.sedationTarget})`} · fictional patient ${patient.sex}, ${patient.ageYears} y, ${patient.weightKg} kg · seed ${sim.seed} · all values are illustrative model output.`)),
    h('div', { class: 'hmi', id: 'hmi' },
      h('div', { class: 'hmi-toolbar' },
        h('div', { class: 'hmi-toolbar__group' }, h('span', { class: 'label' }, 'Sim time'), clock, phaseEl),
        h('div', { class: 'hmi-toolbar__group', role: 'group', 'aria-label': 'Playback' }, playBtn, stepBtns),
        h('div', { class: 'hmi-toolbar__group', role: 'group', 'aria-label': 'Speed' }, h('span', { class: 'label' }, 'Speed'), speedBtns),
        h('div', { class: 'hmi-toolbar__group' }, ilBadge, restartBtn)),
      fb, susBanner, holdBanner, autoPanel, advRun.el, depthRun.el,
      h('div', { class: 'hmi-grid' },
        h('div', { class: 'hmi-main' }, tileGrid, chartGrid, drugPanel),
        h('div', { class: 'hmi-side' }, alarmPanel, ilPanel, abxPanel, phasePanel, readyPanel, airwayPanel, fluidPanel, intPanel)),
      logPanel),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => ctx.go(3) }, '← Back to plan'), toDebrief));

  // Buttons that only show information or pre-fill a form (source tags, drug-row Bolus/Adjust)
  // are not manual control and do not end guided/automatic mode (2026-11 audit, finding 6).
  document.getElementById('hmi').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !run.auto || !run.auto.active || b.closest('[data-auto-safe]') || b.classList.contains('src-tag')) return;
    run.auto.takeOver(describeControl(b));
    feedback(run.auto.message, false, true); announce(run.auto.message);
  }, true);

  // ---------------- behaviour
  function setPlaying(p, quiet = false) {
    run.playing = p; if (p) sim.play(); else sim.pause();
    playBtn.textContent = p ? '❚❚ Pause' : '▶ Play'; playBtn.setAttribute('aria-pressed', String(p));
    if (p) { lastTs = null; if (!raf) raf = requestAnimationFrame(frame); }
    if (!quiet) announce(p ? `Playing at ${run.speed} times.` : 'Paused.');
  }
  function sample() {
    const S = sim.state; const H = run.hist;
    if (S.tSec - run.lastSample < SAMPLE_SEC - 1e-9) return;
    run.lastSample = S.tSec;
    H.t.push(S.tSec); H.hr.push(S.vitals.hr); H.map.push(S.vitals.map); H.spo2.push(S.vitals.spo2); H.depth.push(S.vitals.depthIndex);
    let mac = 0; let anyInh = false;
    for (const d of lib.DRUGS) {
      const ds = S.drugs[d.id]; if (!ds) continue;
      if (isInhaledDrug(d)) { mac += ds.unitConc || 0; if (ds.unitConc > 0.005) anyInh = true; continue; }
      if ((ds.unitConc || 0) > 0.01 || H.ce[d.id]) { if (!H.ce[d.id]) H.ce[d.id] = new Array(H.t.length - 1).fill(NaN); H.ce[d.id].push(ds.unitConc || 0); }
    }
    H.mac.push(anyInh || H.mac.some(Number.isFinite) ? mac : NaN);
    const cut = H.t.findIndex((t) => t >= S.tSec - WINDOW_SEC - 30);
    if (cut > 200) { for (const k of ['t', 'hr', 'map', 'spo2', 'depth', 'mac']) H[k].splice(0, cut); for (const k of Object.keys(H.ce)) H.ce[k].splice(0, cut); }
  }
  function advance(sec) {
    inAdvance = true;
    try {
      for (let i = 0; i < sec; i++) {
        sim.step(1); sample();
        const A = run.auto;
        if (A && A.state === 'running') { A.tick(); if (A.state !== 'running') break; }
      }
    } finally { inAdvance = false; }
    if (autoDirty) render(true);
  }
  function frame(ts) {
    raf = null;
    if (!alive || !run.playing) return;
    if (lastTs !== null && !run.testClock) {
      acc += Math.min(0.25, (ts - lastTs) / 1000) * run.speed;
      const n = Math.min(240, Math.floor(acc)); acc -= n;
      if (n > 0) advance(n);
    }
    lastTs = ts;
    if (ts - lastRender > 150) { lastRender = ts; render(); }
    raf = requestAnimationFrame(frame);
  }

  function alarmFor(key) {
    const ids = TILE_ALARMS[key] || [];
    let best = null;
    for (const a of sim.state.alarms) if (ids.includes(a.id) && (a.active || !a.acknowledged) && (!best || RANK[a.priority] > RANK[best.priority])) best = a;
    return best;
  }
  // A faulted sensor shows "—" (never the last number), with an accessible label (final-check fixes).
  const FAULT_LABEL = 'no valid reading (sensor fault)';
  function setTile(key, value, sub, fault = false) {
    const t = tiles[key]; setText(t.val, fault ? '—' : value); setText(t.sub, sub);
    if (fault) { t.val.setAttribute('aria-label', FAULT_LABEL); t.val.setAttribute('title', FAULT_LABEL); t.val.dataset.fault = '1'; }
    else if (t.val.dataset.fault) { t.val.removeAttribute('aria-label'); t.val.removeAttribute('title'); delete t.val.dataset.fault; }
    const a = alarmFor(key);
    t.el.classList.toggle('tile--fault', fault);
    for (const p of ['high', 'medium', 'low']) t.el.classList.toggle(`tile--${p}`, !!a && a.priority === p);
    t.el.classList.toggle('tile--latched', !!a && !a.active);
    setText(t.alarm, a ? `${PRIORITY_SHAPES[a.priority]} ${PRIORITY_LABELS[a.priority]}${a.active ? '' : ' (latched)'}: ${a.message}` : '');
  }

  function render() {
    if (!alive) return;
    const S = sim.state; const V = S.vitals; const A = S.airway;
    setText(clock, fmtClock(S.tSec)); setText(phaseEl, phaseLabel(S.phase));
    // tiles
    const F = (v) => (isNum(v) ? String(v) : '—');
    const hrBad = S.sensors.hr === 'fault' || !isNum(V.hr); const mapBad = S.sensors.map === 'fault' || !isNum(V.map); const spBad = S.sensors.spo2 === 'fault' || !isNum(V.spo2);
    setTile('hr', F(V.hr), hrBad ? 'SENSOR FAULT — no valid reading' : '', hrBad);
    setTile('bp', mapBad ? '—' : `${V.sbp}/${V.dbp}`, mapBad ? 'SENSOR FAULT — MAP —, no valid reading' : `MAP ${V.map}`, mapBad);
    setTile('spo2', F(V.spo2), spBad ? 'PROBE OFF / SENSOR FAULT — no valid reading' : '', spBad);
    const supported = (A.secured && A.ventilated) || A.maskVentilation;
    const noBreaths = !(V.rr > 0) && !supported;
    setTile('rr', String(V.rr), noBreaths ? 'APNOEA — no breaths' : A.secured && A.ventilated ? 'ventilator' : A.maskVentilation ? 'bag-mask' : 'spontaneous');
    const noEt = noBreaths || !isNum(V.etco2); // engine reports null without exhaled gas (no capnography signal)
    setTile('etco2', noEt ? '—' : String(V.etco2), noEt ? '(no breaths)' : 'illustrative');
    setTile('depth', String(V.depthIndex), `${V.sedationLevel} · GA band ${GA_BAND[0]}–${GA_BAND[1]}: ${V.depthIndex < GA_BAND[0] ? 'below band' : V.depthIndex > GA_BAND[1] ? 'above band' : 'in band'} · simulated`);
    setTile('tof', `${V.tofCount}/4`, V.tofCount === 4 ? `TOFR ${V.tofRatio.toFixed(2)} · ${tofDepthText(V.tofCount, V.tofRatio)}` : `TOFR n/a · ${tofDepthText(V.tofCount, V.tofRatio)}`);
    let mac = 0; const agents = [];
    for (const d of lib.DRUGS) if (isInhaledDrug(d)) { const ds = S.drugs[d.id]; if (ds && (ds.unitConc > 0.005 || ds.infusionRate > 0)) { mac += ds.unitConc; agents.push(`${d.name} Et ${fmtNum(ds.cp, 1)} % (${fmtNum(ds.unitConc, 2)})`); } }
    setTile('mac', agents.length ? mac.toFixed(2) : '—', agents.length ? `${agents.join(' + ')} · age-adjusted, summed (illustrative)` : 'no inhaled agent');
    const n2o = S.drugs.nitrous_oxide ? S.drugs.nitrous_oxide.infusionRate : 0;
    setTile('fio2', A.fio2.toFixed(2), n2o > 0 ? `N2O ${n2o} % · FiO2 max ${(1 - n2o / 100).toFixed(2)}` : '');
    // interlocks
    const st = S.interlocks.status;
    const suspended = !!(S.interlocks.suspension && S.interlocks.suspension.active);
    ilBadge.className = `il-badge il-badge--${st.toLowerCase()}${suspended ? ' il-badge--suspended' : ''}`; setText(ilBadge, `Interlocks: ${st}${suspended ? ' · SUSPENDED' : ''}`);
    setText(ilStatus, INTERLOCK_TEXT[st] || st); ilStatus.className = `il-status il-status--${st.toLowerCase()}`;
    const hdr = S.interlocks.hold && S.interlocks.hold.reasons.length ? ` — reason(s): ${S.interlocks.hold.reasons.map((x) => x.reason).join('; ')}` : '';
    setText(ilHeld, S.interlocks.holdLatched ? `Held: ${S.interlocks.heldDrugs.map((id) => getDrugById(lib, id)?.name || id).join(', ') || 'none'}${hdr}` : 'No hold latched.');
    resumeBtn.disabled = !(S.interlocks.enabled && S.interlocks.holdLatched);
    renderRelease(); renderSuspension();
    // alarms
    renderAlarms();
    // phase buttons
    const ph = S.phase; const surg = surgeryState(sim);
    const en = (id, on) => { if (phaseBtns[id]) phaseBtns[id].disabled = !on; };
    if (isGA) {
      en('induction', ph === 'premed'); en('secure', !A.secured && (ph === 'induction' || ph === 'maintenance' || ph === 'emergence') && !run.extubated);
      en('maintenance', ph === 'induction'); en('surgery', !surg.started || surg.ended); en('endsurgery', surg.started && !surg.ended);
      en('emergence', ph === 'maintenance'); en('extubate', A.secured);
      setText(nextHint, ph === 'premed' ? 'Next: Start induction.' : ph === 'induction' && !A.secured ? 'Next: when the patient is asleep and paralysed (TOF count 0–1), Secure airway (starts the ventilator).' : ph === 'induction' ? 'Next: Start maintenance.' : ph === 'maintenance' && !surg.started ? 'Next: Start surgery.' : ph === 'maintenance' && !surg.ended ? 'Surgery in progress. End surgery when done.' : ph === 'maintenance' ? 'Next: Begin emergence.' : A.secured ? 'Emergence: reverse block if needed, wait for the readiness checklist, then Extubate.' : 'Extubated. Observe, then Finish → Debrief.');
    } else {
      en('sedation', ph === 'premed'); en('surgery', ph === 'sedation' && (!surg.started || surg.ended)); en('endsurgery', surg.started && !surg.ended); en('emergence', ph === 'sedation');
      setText(nextHint, ph === 'premed' ? 'Next: Start sedation.' : ph === 'sedation' && !surg.started ? 'Next: Start procedure when the target depth is reached.' : ph === 'sedation' ? 'Procedure in progress; watch depth vs target, SpO2 and EtCO2.' : 'Recovery. Finish → Debrief when done.');
    }
    // airway
    setText(awState, `${A.secured ? 'Tracheal tube in place' : 'Natural airway'} · ${A.secured && A.ventilated ? 'mechanical ventilation' : A.maskVentilation ? 'bag-mask ventilation' : 'no ventilatory support'}${A.jawThrust ? ' · jaw thrust' : ''} · FiO2 ${A.fio2.toFixed(2)}`);
    maskBtn.setAttribute('aria-pressed', String(!!A.maskVentilation)); maskBtn.textContent = A.maskVentilation ? 'Stop mask ventilation' : 'Mask ventilate'; maskBtn.disabled = A.secured;
    jawBtn.setAttribute('aria-pressed', String(!!A.jawThrust)); jawBtn.textContent = A.jawThrust ? 'Release jaw thrust' : 'Jaw thrust';
    secBtn.disabled = A.secured; ventOn.disabled = !A.secured || A.ventilated; ventOff.disabled = !A.ventilated;
    if (document.activeElement !== fio2Sel) fio2Sel.value = String([0.21, 0.3, 0.4, 0.5, 0.6, 0.8, 1].find((v) => Math.abs(v - A.fio2) < 1e-6) ?? fio2Sel.value);
    if (fluids) setText(fluidOut, S.fluids && isNum(S.fluids.crystalloidMl) ? `${fmtNum(S.fluids.crystalloidMl, 0)} mL` : '0 mL');
    if (fluids) setText(flTeach, teachText(teachFor('crystalloid')));
    { const tk = adCtx && adCtx.drug && adCtx.kind === 'bolus' ? teachKeyFor(adCtx.drug.id, adRoute.hidden ? null : adRoute.value) : null; setText(adTeach, tk ? teachText(teachFor(tk)) : ''); adTeach.hidden = !tk; }
    renderFluids(); renderAbx();
    // drugs
    renderDrugs();
    // readiness
    if (readyPanel) {
      const r = sim.extubationReadiness();
      setText(readyHead, r.ready ? '✓ All criteria met' : `✗ Not ready — ${r.criteria.filter((c) => !c.met).length} criterion/criteria not met`);
      readyHead.className = `ready-head ${r.ready ? 'ready-head--ok' : 'ready-head--no'}`;
      const sig = r.criteria.map((c) => `${c.id}${c.met}${JSON.stringify(c.value)}`).join('|');
      if (sig !== readyList.dataset.sig) { readyList.dataset.sig = sig; reconcileKeyed(readyList, r.criteria, { key: (c) => c.id, create: readinessItem, update: updateReadinessItem }); }
    }
    renderAuto();
    const av = advisor.view(); const dv = depthAdvisor.view();
    // Both cards can show at once: each names the other so the two are read together.
    const hypo = av.visible && (av.kind === 'hypotension' || av.kind === 'hypotension_recovering');
    const advCross = hypo && dv.visible ? 'The depth-index advisory is also shown (below): the index is below the GA band, so anaesthetic depth may be contributing to the hypotension.' : '';
    const depthCross = hypo && dv.visible ? 'The haemodynamic rescue advisory is also shown (above): MAP is low — review both cards together.' : '';
    const autoOn = run.auto && run.auto.active;
    advRun.update(av, advCross); advAuto.update(autoOn ? av : null, advCross);
    depthRun.update(dv, depthCross); depthAuto.update(autoOn ? dv : null, depthCross);
    renderLog();
    drawCharts();
  }

  function renderFluids() {
    const F = sim.state.fluids; if (!F || !F.byType) return;
    const M = F.maintenance;
    setText(flMaint, M && M.rateMlH > 0 ? `Maintenance running: ${(FL.find((f) => f.id === M.fluidId) || {}).name} ${M.rateMlH} mL/h (continues across phases)` : 'No maintenance infusion running.');
    flStop.disabled = !(M && M.rateMlH > 0);
    const rows = Object.entries(F.byType).map(([id, v]) => `${id}:${Math.round(v.bolusMl)}:${Math.round(v.maintenanceMl)}`).join('|');
    if (flTotals.dataset.sig === rows) return; flTotals.dataset.sig = rows;
    fill(flTotals, ...Object.entries(F.byType).map(([id, v]) => h('tr', { dataset: { fluid: id } }, h('th', { scope: 'row' }, (FL.find((f) => f.id === id) || {}).name || id),
      h('td', { class: 'mono' }, `${fmtNum(v.bolusMl, 0)} mL`), h('td', { class: 'mono' }, `${fmtNum(v.maintenanceMl, 0)} mL`), h('td', { class: 'mono' }, `${fmtNum(v.bolusMl + v.maintenanceMl, 0)} mL`))));
  }
  function renderAbx() {
    if (!abxPanel) return;
    const P = sim.state.prophylaxis; const surg = surgeryState(sim);
    const ck = sim.prophylaxisChecklist();
    const showCk = ck.indicated && !surg.started && (!ck.window || !ck.window.ok);
    abxCheck.hidden = !showCk;
    abxCheck.classList.toggle('checklist--ack', !!ck.acknowledged);
    if (showCk) { setText(abxCheckMsg, ck.message); abxAck.disabled = !!ck.acknowledged; setText(abxAck, ck.acknowledged ? 'Warning acknowledged' : 'Acknowledge: proceed without prophylaxis in window'); }
    const last = P.doses[P.doses.length - 1];
    const red = P.redose && P.redose.items ? P.redose.items.filter((x) => x.drugId) : [];
    setText(abxState, `${ck.indicated ? 'Indicated for this plan.' : 'Not marked as indicated for this plan.'} ${last ? `Last dose: ${(getDrugById(lib, last.drugId) || {}).name} ${last.amount} ${last.unit} at ${fmtClock(last.tSec)}.` : 'No dose given.'}${red.length ? ` Next redose: ${red.map((x) => `${x.name} at ${fmtClock(x.dueAtSec)}`).join('; ')}.` : ''}${P.window ? ` At incision: ${P.window.ok ? 'in window' : 'NOT in window'} (${P.window.message}).` : ''}`);
  }

  // Keyed reconciliation (audit 05l, finding 2; dom.js reconcileKeyed): one persistent <li> per alarm id.
  // Texts are updated in place and items are added/removed only when the set of ids changes, so the
  // Acknowledge button element survives every render while its alarm exists (only its disabled state and
  // labels change), a click that straddles a render is never lost, and focus stays on the button.
  function alarmItem(a) {
    const id = a.id;
    const prio = h('span', {}); const text = h('span', { class: 'alarm__text' }); const meta = h('span', { class: 'alarm__meta' });
    const btn = h('button', { type: 'button', class: 'btn btn--hmi btn--small', dataset: { ack: id }, 'data-auto-safe': 'acknowledge' });
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      sim.action(`acknowledge:${id}`); render(true);
      const nb = alarmList.querySelector('button:not([disabled])'); (nb || alarmPanel.querySelector('h3')).focus?.();
    });
    return { el: h('li', { dataset: { alarm: id } }, prio, h('span', { class: 'alarm__msg' }, text, meta), btn), prio, text, meta, btn };
  }
  function updateAlarmItem(it, a) {
    const cls = `alarm alarm--${a.priority}${a.active ? '' : ' alarm--latched'}`;
    if (it.el.className !== cls) it.el.className = cls;
    const pcls = `prio prio--${a.priority}`; if (it.prio.className !== pcls) it.prio.className = pcls;
    setText(it.prio, `${PRIORITY_SHAPES[a.priority]} ${PRIORITY_LABELS[a.priority]}`);
    setText(it.text, a.message);
    setText(it.meta, ` since ${fmtClock(a.sinceSec)} · ${a.active ? 'active' : 'condition cleared (latched)'}${a.acknowledged ? ' · acknowledged' : ''}`);
    if (it.btn.disabled !== !!a.acknowledged) it.btn.disabled = !!a.acknowledged;
    setText(it.btn, a.acknowledged ? 'Acknowledged' : 'Acknowledge');
    const label = `Acknowledge ${PRIORITY_LABELS[a.priority]} alarm: ${a.message}`;
    if (it.btn.getAttribute('aria-label') !== label) it.btn.setAttribute('aria-label', label);
  }
  function renderAlarms() {
    const list = sim.state.alarms;
    const sig = list.map((a) => `${a.id}:${a.active}:${a.acknowledged}:${a.message}`).join('|');
    const activeNow = new Set(list.filter((a) => a.active).map((a) => a.id));
    for (const a of list) if (a.active && !run.seenAlarms.has(a.id)) announce(`${PRIORITY_LABELS[a.priority]} priority alarm: ${a.message}`, a.priority === 'high');
    run.seenAlarms = activeNow;
    if (sig === alarmSig) return;
    alarmSig = sig;
    reconcileKeyed(alarmList, list, { key: (a) => a.id, create: alarmItem, update: updateAlarmItem, empty: () => h('li', { class: 'alarm alarm--none' }, 'No alarms.') });
  }

  function renderDrugs() {
    const S = sim.state;
    const active = lib.DRUGS.filter((d) => { const ds = S.drugs[d.id]; return ds && (ds.cumulative > 0 || ds.infusionRate > 0 || ds.ce > 1e-6); });
    drugEmpty.hidden = active.length > 0; drugTable.hidden = !active.length;
    const sig = active.map((d) => d.id).join(',');
    if (sig !== drugSig) {
      drugSig = sig; clear(drugBody);
      for (const d of active) {
        const rate = h('td', { class: 'mono' }); const ce = h('td', { class: 'mono' }); const cum = h('td', { class: 'mono' });
        const bol = h('button', { type: 'button', class: 'btn btn--hmi btn--small', 'data-auto-safe': 'prefill', 'aria-label': `Bolus ${d.name}` }, 'Bolus');
        const adj = h('button', { type: 'button', class: 'btn btn--hmi btn--small', 'data-auto-safe': 'prefill', 'aria-label': `Adjust ${d.name} rate` }, 'Adjust');
        const stop = h('button', { type: 'button', class: 'btn btn--hmi btn--small btn--danger', 'aria-label': `Stop ${d.name}` }, 'Stop');
        const kinds = new Set(Object.values(d.regimens || {}).map((r) => r.kind));
        bol.hidden = !(kinds.has('bolus') || Object.values(d.regimens || {}).some((r) => r.loading));
        adj.hidden = !(kinds.has('infusion') || kinds.has('inhaled'));
        bol.addEventListener('click', () => { adDrug.value = d.id; fillKinds('bolus'); adVal.focus(); });
        adj.addEventListener('click', () => { adDrug.value = d.id; fillKinds(kinds.has('inhaled') ? 'inhaled' : 'infusion'); adVal.focus(); });
        stop.addEventListener('click', () => { const r = sim.administer({ drugId: d.id, kind: 'stop' }); feedback(r.ok ? `${d.name} stopped.` : r.reasons.join('; '), !r.ok); render(true); });
        drugCells[d.id] = { rate, ce, cum, stop };
        add(drugBody, h('tr', {}, h('th', { scope: 'row' }, d.name), rate, ce, cum, h('td', { class: 'controls' }, bol, adj, stop)));
      }
    }
    for (const d of active) {
      const ds = S.drugs[d.id]; const c = drugCells[d.id]; const inh = isInhaledDrug(d);
      const held = S.interlocks.heldDrugs.includes(d.id);
      setText(c.rate, ds.infusionRate > 0 ? `${fmtNum(ds.infusionRate, 2)} ${ds.rateUnit}` : held ? '0 (HELD)' : '—');
      setText(c.ce, inh ? `Et ${fmtNum(ds.cp, 2)} % · ${fmtNum(ds.unitConc, 2)} MAC` : `${fmtNum(ds.ce, 3)} ${d.amountUnit}/L · ${fmtNum(ds.unitConc, 2)}× ref`);
      setText(c.cum, `${fmtNum(ds.cumulative, 2)} ${ds.amountUnit}`);
      c.stop.disabled = !(ds.infusionRate > 0);
    }
  }

  function renderLog() {
    const log = sim.state.log;
    if (log.length === logLen) return; logLen = log.length;
    const f = logFilter.value;
    const items = log.filter((e) => f === 'all' || e.kind === f).slice(-200).reverse();
    fill(logList, ...items.map((e) => h('li', { class: `log__item log__item--${e.kind}` }, h('span', { class: 'mono' }, fmtClock(e.tSec)), ' ', h('span', { class: 'log__kind' }, e.kind), ' ', e.message)));
  }

  function drawCharts() {
    const H = run.hist; const now = sim.state.tSec;
    for (const c of charts) {
      let series;
      if (c.key === 'ce') {
        series = [];
        if (H.mac.some(Number.isFinite)) series.push({ label: 'Total MAC', color: SERIES_COLORS[0], data: H.mac });
        Object.keys(H.ce).slice(0, 5).forEach((id, i) => series.push({ label: `${getDrugById(lib, id).name} Ce`, color: SERIES_COLORS[(i + 1) % SERIES_COLORS.length], data: H.ce[id], dash: i % 2 ? [6, 3] : null }));
      } else series = [{ label: c.title, color: { hr: '#7ee787', map: '#ff9aa2', spo2: '#67d4ff', depth: '#c8b6ff' }[c.key], data: H[c.key] }];
      drawChart(c.canvas, { t: H.t, series, min: c.min, max: c.max, autoMax: c.autoMax, thresholds: c.th, nowSec: now });
      const sig = series.map((s) => s.label).join('|');
      if (c.legend.dataset.sig !== sig) {
        c.legend.dataset.sig = sig;
        fill(c.legend, ...series.map((s) => h('li', {}, h('span', { class: `swatch${s.dash ? ' swatch--dash' : ''}` }), s.label)));
        for (const [i, li] of [...c.legend.children].entries()) li.firstChild.style.borderColor = series[i].color;
      }
      const last = series.map((s) => { const v = s.data[s.data.length - 1]; return `${s.label} ${isNum(v) ? fmtNum(v, 2) : 'no value'}`; }).join('; ');
      c.canvas.setAttribute('aria-label', `${c.title}, last 15 simulated minutes. Current: ${last || 'no data'}.`);
    }
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => drawCharts()) : null;
  if (ro) for (const c of charts) ro.observe(c.canvas);

  if (!run.hist.t.length) sample();
  // Test hook (only used by app.js when the page URL has ?test=1): advance simulated time
  // synchronously (with the guided/automatic runner ticking) and re-render. With run.testClock on,
  // the requestAnimationFrame loop never advances time, so browser tests are step-driven.
  run.testAdvance = (sec) => { if (!alive) return false; advance(Math.max(0, Math.round(sec))); render(true); return true; };
  render(true);
  if (run.autoStart) { const m = run.autoStart; run.autoStart = null; beginAuto(m); }
  else if (run.playing) setPlaying(true);

  return {
    leave() { if (run.auto && run.auto.state === 'running') run.auto.pause('Paused: left the Run screen.'); run.autoListener = null; alive = false; if (raf) cancelAnimationFrame(raf); raf = null; if (ro) ro.disconnect(); if (run.playing) { run.playing = false; sim.pause(); } },
  };
}

/** Persistent met/not-met row (readiness criteria, pre-incision checklist): mark, sr text, label text, source holder. */
function statusRow() {
  const mark = h('span', { class: 'ready__mark', 'aria-hidden': 'true' }); const sr = h('span', { class: 'sr-only' });
  const text = h('span', {}); const src = h('span', {});
  return { el: h('li', {}, mark, h('span', {}, sr, text, src)), mark, sr, text, src };
}
function updateStatusRow(it, met, text) {
  const cls = met ? 'ready--met' : 'ready--no'; if (it.el.className !== cls) it.el.className = cls;
  setText(it.mark, met ? '✓' : '✗'); setText(it.sr, met ? 'Met: ' : 'Not met: '); setText(it.text, text);
}
function readinessItem() { return statusRow(); }
function updateReadinessItem(it, c) {
  const v = c.value && typeof c.value === 'object' ? Object.entries(c.value).map(([k, x]) => `${k.toUpperCase()} ${isNum(x) ? x : 'FAULT'}`).join(', ') : isNum(c.value) ? String(c.value) : 'FAULT';
  updateStatusRow(it, c.met, `${c.label} — ${v} `);
  const real = c.source && c.source !== 'illustrative';
  setChildrenIf(it.src, real ? `src:${c.source}` : 'illustrative', () => (real ? srcTags([c.source]) : h('span', { class: 'badge badge--illustrative' }, 'illustrative')));
}
function checkItem() { return statusRow(); }
function updateCheckItem(it, x) {
  it.el.dataset.item = x.id; it.el.dataset.met = String(x.met);
  updateStatusRow(it, x.met, `${x.label} — ${x.detail} `);
  setChildrenIf(it.src, x.sources.join(','), () => (x.sources.length ? srcTags(x.sources) : h('span', { class: 'badge badge--illustrative' }, 'convention')));
}
export { readinessItem };
/** One complete readiness row (static lists: extubation dialog, debrief). Same markup as the live panel. */
export function readinessRow(c) { const it = statusRow(); updateReadinessItem(it, c); return it.el; }

function groupDrugs(lib) {
  const m = new Map();
  for (const d of lib.DRUGS) { if (!m.has(d.cls)) m.set(d.cls, []); m.get(d.cls).push(d); }
  return [...m.entries()].sort((a, b) => (CLASS_ORDER.indexOf(a[0]) + 100 * (CLASS_ORDER.indexOf(a[0]) < 0)) - (CLASS_ORDER.indexOf(b[0]) + 100 * (CLASS_ORDER.indexOf(b[0]) < 0)));
}
