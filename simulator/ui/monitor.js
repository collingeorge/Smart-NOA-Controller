// Step 4 — Run: HMI monitor dashboard driving sim.step() from requestAnimationFrame.
import { h, clear, setText, fmtClock, fmtNum, isNum, announce } from './dom.js';
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

const SPEEDS = [1, 5, 20, 60];
const TILE_ALARMS = {
  hr: ['hr_critical', 'hr_high', 'sensor_fault_hr'], bp: ['map_critical', 'map_low', 'map_high', 'sensor_fault_map'],
  spo2: ['spo2_low', 'sensor_fault_spo2'], rr: ['apnea'], etco2: ['apnea'], depth: ['depth_over_target'], tof: ['tofr_extubation'],
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
    tile('rr', 'RR', '/min'), tile('etco2', 'EtCO2', 'mmHg'), tile('depth', 'Simulated depth index', '0–100', 'tile--depth'),
    tile('tof', 'TOF', ''), tile('mac', 'Total MAC', ''), tile('fio2', 'FiO2', ''));

  // ---------------- charts
  const charts = [
    { key: 'hr', title: 'HR (/min)', min: 30, max: 160, th: [{ v: 48, label: '48 interlock' }] },
    { key: 'map', title: 'MAP (mmHg)', min: 30, max: 140, th: [{ v: 65, label: '65' }, { v: 60, label: '60 interlock' }] },
    { key: 'spo2', title: 'SpO2 (%)', min: 50, max: 100, th: [{ v: 90, label: '90' }] },
    { key: 'depth', title: 'Simulated depth index (illustrative; not BIS)', min: 0, max: 100, th: [{ v: 80, label: '80 awake' }] },
    { key: 'ce', title: 'Total MAC / drug Ce (× reference peak, illustrative)', min: 0, max: 1.5, autoMax: true, th: [] },
  ].map((c) => {
    const canvas = h('canvas', { class: 'chart__canvas', id: `chart-${c.key}`, role: 'img', 'aria-label': c.title });
    const legend = h('ul', { class: 'chart__legend' });
    const el = h('figure', { class: 'chart' }, h('figcaption', {}, c.title), canvas, legend);
    return { ...c, canvas, legend, el };
  });
  const chartGrid = h('div', { class: 'charts', id: 'mon-charts' }, charts.map((c) => c.el),
    h('p', { class: 'hint hint--hmi' }, 'Last 15 simulated minutes · illustrative model output · dashed lines are alarm/interlock thresholds.'));

  // ---------------- alarms
  const alarmList = h('ul', { class: 'alarm-list', id: 'mon-alarms' });
  const alarmPanel = h('section', { class: 'hmi-panel', 'aria-labelledby': 'mon-alarms-h' }, h('h3', { id: 'mon-alarms-h' }, 'Alarms'), alarmList);
  let alarmSig = '';

  // ---------------- interlocks
  const ilStatus = h('p', { class: 'il-status', id: 'mon-il-status' });
  const ilHeld = h('p', { class: 'il-held', id: 'mon-il-held' });
  const resumeBtn = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'mon-resume', 'data-auto-safe': 'resume-hold' }, 'Resume hold');
  resumeBtn.addEventListener('click', () => { const r = sim.action('resume_hold'); feedback(r.ok ? 'Hold released (logged). Held infusions stay at zero — restart them yourself if appropriate.' : r.message, !r.ok); render(true); });
  const ilToggle = h('input', { type: 'checkbox', id: 'mon-il-toggle', checked: store.interlocks });
  const ilConfirm = h('div', { class: 'il-confirm', hidden: true });
  ilToggle.addEventListener('change', () => {
    const want = ilToggle.checked;
    if (sim.state.tSec <= 0) { store.interlocks = want; ctx.restartSim(); ctx.rerender(); announce(`Interlocks ${want ? 'on' : 'off'}.`); return; }
    ilToggle.checked = !want;
    clear(ilConfirm).append(h('p', {}, `Changing interlocks restarts the case from 00:00 with interlocks ${want ? 'ON' : 'OFF'}.`),
      h('button', { type: 'button', class: 'btn btn--hmi btn--warn', onclick: () => { store.interlocks = want; ctx.restartSim(); ctx.rerender(); announce(`Case restarted with interlocks ${want ? 'on' : 'off'}.`); } }, `Restart with interlocks ${want ? 'ON' : 'OFF'}`),
      ' ', h('button', { type: 'button', class: 'btn btn--hmi', onclick: () => { ilConfirm.hidden = true; ilToggle.focus(); } }, 'Cancel'));
    ilConfirm.hidden = false; ilConfirm.querySelector('button').focus();
  });
  const lockouts = Object.entries(sim.state.interlocks.lockouts);
  const ilPanel = h('section', { class: 'hmi-panel', 'aria-labelledby': 'mon-il-h' }, h('h3', { id: 'mon-il-h' }, 'Interlocks (Smart NOA rules)'),
    ilStatus, ilHeld, resumeBtn,
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
  const caseAct = (id) => { const r = CASE_ACTIONS[id](sim); feedback(r.message, !r.ok); return r; };
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
  const fluidBtns = [250, 500].map((ml) => { const b = h('button', { type: 'button', class: 'btn btn--hmi', id: `fl-${ml}`, disabled: !fluids }, `Bolus ${ml} mL`); b.addEventListener('click', () => { act(FL.length ? `fluid_bolus:${ml}:${flType.value}` : `fluid_bolus:${ml}`, `${flName()} ${ml} mL given`); render(true); }); return b; });
  const flRate = h('input', { type: 'number', min: 0, max: FLUID_MODEL.MAINTENANCE_MAX_ML_H, step: 'any', id: 'fl-rate', class: 'input input--hmi input--num', value: FLUID_MODEL.MAINTENANCE_DEFAULT_ML_H, disabled: !fluids || !FL.length });
  const flSet = h('button', { type: 'button', class: 'btn btn--hmi', id: 'fl-maint-set', disabled: !fluids || !FL.length }, 'Set maintenance');
  flSet.addEventListener('click', () => { act(`fluid_maintenance:${flType.value}:${flRate.value === '' ? 'x' : Number(flRate.value)}`); render(true); });
  const flStop = h('button', { type: 'button', class: 'btn btn--hmi btn--danger', id: 'fl-maint-stop', disabled: !fluids || !FL.length }, 'Stop maintenance');
  flStop.addEventListener('click', () => { act('fluid_maintenance_stop'); render(true); });
  const flMaint = h('p', { class: 'hint hint--hmi', id: 'fl-maint-state' });
  const flTotals = h('tbody', { id: 'mon-fluid-totals' });
  const flComp = h('p', { class: 'hint hint--hmi', id: 'fl-comp' });
  const renderComp = () => { const f = FL.find((x) => x.id === flType.value); clear(flComp); if (f) flComp.append(`${f.name} (${f.type}): ${fluidCompositionText(f)} (approx., label) `, srcTags(f.sources), `. ${f.labelNotes.join(' ')}`); };
  flType.addEventListener('change', renderComp); renderComp();
  const fluidPanel = h('section', { class: 'hmi-panel', id: 'mon-fluids-panel', 'aria-labelledby': 'mon-fl-h' }, h('h3', { id: 'mon-fl-h' }, 'IV fluids'),
    h('div', { class: 'inline-form' }, h('label', { for: 'fl-type', class: 'label' }, 'Fluid'), flType),
    h('div', { class: 'btn-row' }, fluidBtns),
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
  abxCheck.append(h('p', { class: 'checklist__title' }, '☐ Checklist before Start surgery: antibiotic prophylaxis'), abxCheckMsg, abxAck);
  const abxPanel = ABX.length ? h('section', { class: 'hmi-panel', id: 'abx-panel', 'aria-labelledby': 'abx-h' }, h('h3', { id: 'abx-h' }, 'Antibiotic prophylaxis'),
    abxCheck,
    h('div', { class: 'inline-form' }, h('label', { for: 'abx-drug', class: 'label' }, 'Agent'), abxSel, abxGive), abxState,
    h('p', { class: 'hint hint--hmi' }, `Guideline (Bratzler 2013): start within 60 min before incision (vancomycin 120 min); redose cefazolin every 4 h, clindamycin every 6 h. ${abxBest.reason} Timing only — antibiotic pharmacology is not modelled. `, srcTags(abxBest.sources))) : null;
  const nonSensor = SCENARIOS.filter((s) => !s.perturbation.sensor);
  const sensor = SCENARIOS.filter((s) => s.perturbation.sensor);
  const cxSel = h('select', { id: 'cx-select', class: 'input input--hmi' }, h('option', { value: '' }, 'Choose a complication…'), nonSensor.map((s) => h('option', { value: s.id }, s.label)));
  const cxBtn = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'cx-inject' }, 'Inject');
  const teach = h('div', { class: 'teach', id: 'cx-teach', 'aria-live': 'polite' });
  const inject = (id) => { const s = SCENARIOS.find((x) => x.id === id); const r = sim.inject(id); feedback(r.ok ? `${r.message} injected.` : r.message, !r.ok); if (r.ok) clear(teach).append(h('p', {}, h('strong', {}, `${s.label}: `), s.description), h('p', { class: 'hint hint--hmi' }, h('strong', {}, 'Teaching point: '), s.teachingPoint)); render(true); };
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
  let adCtx = null;
  adDrug.addEventListener('change', () => fillKinds());
  adKind.addEventListener('change', () => { syncRoutes(); prefill(); });
  adRoute.addEventListener('change', () => prefill());
  function syncRoutes() {
    const d = getDrugById(lib, adDrug.value);
    const routes = d && Array.isArray(d.bolusRoutes) && d.bolusRoutes.length > 1 ? d.bolusRoutes : null;
    const show = !!routes && adKind.value === 'bolus';
    adRouteWrap.hidden = !show; adRoute.hidden = !show;
    if (show && [...adRoute.options].map((o) => o.value).join() !== routes.join()) { clear(adRoute).append(...routes.map((r) => h('option', { value: r }, r))); }
  }
  function fillKinds(kindWanted = null) {
    clear(adKind); const d = getDrugById(lib, adDrug.value); if (!d) { clear(adInfo); return; }
    const kinds = [...new Set(Object.values(d.regimens || {}).flatMap((r) => (r.kind === 'infusion' && r.loading ? ['bolus', 'infusion'] : [r.kind])))];
    for (const k of kinds) adKind.append(h('option', { value: k, selected: k === kindWanted }, KIND_LABELS[k]));
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
      if (dz) adInfo.append(h('p', {}, `Sourced ${key} range ${dz.range.min ?? 0}–${dz.range.max} ${dz.unit}${dz.perKg ? ` (${dz.perKg.min ?? dz.perKg.value}–${dz.perKg.max ?? dz.perKg.value} ${dz.perKg.unit} × ${rec.weightUsedKg} kg ${rec.scalar})` : ''} `, srcTags(rec.sources)));
    } else {
      const r = rec && rec.rate;
      let v = ds.infusionRate > 0 ? ds.infusionRate : r ? r.value : '';
      const unit = r ? r.unit : ds.rateUnit;
      const ic = kind === 'infusion' ? interlockCeiling(d, unit, patient) : null;
      if (store.interlocks && ic && isNum(v) && exceedsInterlockCeiling(d, v, unit, patient)) { v = ic.value; adInfo.append(h('p', { class: 'note note--interlock' }, interlockNote(rec, ic), ' ', srcTags([E.pythonConfig]))); }
      adVal.value = v; adUnit.textContent = unit || '';
      if (r) adInfo.append(h('p', {}, `Sourced ${key} range ${r.range.min ?? 0}–${r.range.max} ${r.unit}${r.unit.includes('/kg') ? ` · ${rec.weightUsedKg} kg ${rec.scalar}` : ''} `, srcTags(rec.sources)));
      if (r && r.ageAdjustedMac) adInfo.append(h('p', { class: 'hint hint--hmi' }, `1.0 × age-adjusted MAC = ${r.ageAdjustedMac.value} % `, srcTags(r.ageAdjustedMac.sources)));
    }
    if (rec) for (const w of rec.warnings) adInfo.append(h('p', { class: 'warn-text' }, 'Warning: ', w));
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
    const r = sim.administer(cmd);
    const what = kind === 'bolus' ? `${v} ${drug.amountUnit}${cmd.route ? ` ${cmd.route}` : ''}` : `${v} ${cmd.rateUnit}`;
    feedback(r.ok ? `${drug.name} ${what} ${kind === 'bolus' ? 'given' : 'set'}.${r.warnings.length ? ` Warnings: ${r.warnings.join('; ')}` : ''}` : `BLOCKED: ${drug.name} ${what} — ${r.reasons.join('; ')}`, !r.ok, r.warnings.length > 0);
    render(true);
  });
  const adminForm = h('div', { class: 'admin-form' },
    h('h4', {}, 'Give / adjust a drug'),
    h('div', { class: 'admin-form__row' },
      h('div', { class: 'field field--sm' }, h('label', { for: 'ad-drug', class: 'label' }, 'Drug'), adDrug),
      h('div', { class: 'field field--sm' }, h('label', { for: 'ad-kind', class: 'label' }, 'How'), adKind),
      adRouteWrap,
      h('div', { class: 'field field--sm' }, h('label', { for: 'ad-value', class: 'label' }, 'Amount / rate'), h('span', { class: 'with-unit' }, adVal, adUnit)),
      adOverWrap, adGive), adInfo);
  const fb = h('p', { class: 'feedback', id: 'mon-feedback', role: 'status' });
  function feedback(msg, bad = false, warn = false) { fb.textContent = msg; fb.className = `feedback ${bad ? 'feedback--bad' : warn ? 'feedback--warn' : 'feedback--ok'}`; }
  const drugPanel = h('section', { class: 'hmi-panel hmi-panel--wide', 'aria-labelledby': 'mon-drugs-h' }, h('h3', { id: 'mon-drugs-h' }, 'Drugs & infusions'), drugEmpty, drugTable, adminForm);

  // ---------------- readiness (GA)
  const readyList = h('ul', { class: 'ready-list', id: 'mon-ready' });
  const readyHead = h('p', { class: 'ready-head' });
  const readyPanel = isGA ? h('section', { class: 'hmi-panel', 'aria-labelledby': 'mon-ready-h' }, h('h3', { id: 'mon-ready-h' }, 'Extubation readiness (live)'), readyHead, readyList,
    h('p', { class: 'hint hint--hmi' }, 'TOFR ≥ 0.9 before extubation ', srcTags([E.tofExtubation]), '. Without reversal, rocuronium recovery is slow; sugammadex dose depends on block depth.')) : null;

  // ---------------- guided / automatic modes (engine/autorun.js; conditions in engine/autorun-config.js)
  const autoStatus = h('p', { class: 'auto-status', id: 'auto-status' });
  const autoBanner = h('p', { class: 'auto-banner', id: 'auto-banner', hidden: true });
  const autoGate = h('button', { type: 'button', class: 'btn btn--hmi btn--primary auto-gate', id: 'auto-gate', hidden: true });
  const autoUnmet = h('ul', { class: 'auto-unmet', id: 'auto-unmet' });
  // Antibiotic checklist item before "Start surgery" (guided: waits; full: pauses). Never acknowledged automatically.
  const autoCkMsg = h('p', { class: 'checklist__msg' });
  const autoCkAck = h('button', { type: 'button', class: 'btn btn--hmi btn--warn', id: 'auto-abx-ack' }, 'Acknowledge checklist warning');
  autoCkAck.addEventListener('click', () => { const r = sim.action('acknowledge_checklist:antibiotic'); feedback(r.message, !r.ok); announce(r.message); render(true); });
  const autoCk = h('div', { class: 'checklist', id: 'auto-checklist', role: 'group', 'aria-label': 'Checklist before Start surgery', hidden: true },
    h('p', { class: 'checklist__title' }, '☐ Checklist item before Start surgery — antibiotic prophylaxis (warning; you must acknowledge it)'), autoCkMsg, autoCkAck);
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
    autoStartRow, autoStatus, autoGate, autoCk, autoUnmet, autoCtlRow, autoSeq);
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
    gateBusy = true; autoGate.disabled = true;
    let r;
    try { r = run.auto.approve(shownId); } finally {
      if (gateTimer) clearTimeout(gateTimer);
      gateTimer = setTimeout(() => { gateBusy = false; gateTimer = null; if (alive) render(true); }, GATE_COOLDOWN_MS);
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
    if (!st) { setText(autoStatus, ''); autoGate.hidden = true; clear(autoUnmet); clear(autoSeq); return; }
    const stateText = { running: 'running', paused: 'PAUSED', completed: 'complete', stopped: 'STOPPED', manual: 'ended (manual control)' }[st.state] || st.state;
    setText(autoStatus, `${st.modeLabel} — ${stateText}. ${st.message}`);
    autoPause.disabled = st.state !== 'running'; autoResume.disabled = st.state !== 'paused';
    const c = st.current;
    const showGate = active && st.mode === 'guided' && c && c.gate;
    autoGate.hidden = !showGate;
    if (showGate) { setText(autoGate, c.gateLabel); autoGate.disabled = !c.enabled || gateBusy; autoGate.dataset.gate = c.id; }
    else delete autoGate.dataset.gate;
    const ckText = active && c && c.checklist ? c.checklist : null;
    autoCk.hidden = !ckText; if (ckText) setText(autoCkMsg, ckText);
    const unmet = st.state === 'stopped' ? st.unmetAtStop : active && c && !c.conditionsMet ? c.unmet : [];
    const usig = unmet.join('|') + st.state;
    if (autoUnmet.dataset.sig !== usig) {
      autoUnmet.dataset.sig = usig;
      clear(autoUnmet).append(...(unmet.length ? [h('li', { class: 'auto-unmet__head' }, st.state === 'stopped' ? 'Unmet when stopped:' : `Waiting for${c && c.timedOut ? ' (time limit passed)' : ''}:`), ...unmet.map((u) => h('li', {}, '✗ ', u))] : []));
    }
    const ssig = st.sequence.map((x) => `${x.done}${x.current}`).join('') + st.state;
    if (autoSeq.dataset.sig !== ssig) {
      autoSeq.dataset.sig = ssig;
      clear(autoSeq).append(...st.sequence.map((x) => h('li', { class: x.done ? 'is-done' : x.current ? 'is-current' : '' },
        h('span', { class: 'auto-seq__mark', 'aria-hidden': 'true' }, x.done ? '✓' : x.current ? '▶' : '○'),
        h('span', { class: 'sr-only' }, x.done ? 'Done: ' : x.current ? 'Current: ' : 'Pending: '),
        `${x.label}${x.gate && st.mode === 'guided' ? ' (you confirm)' : x.gate ? '' : ' (automatic)'}`, h('span', { class: 'hint hint--hmi' }, ` — ${x.describe}`))));
    }
  }

  // ---------------- log
  const logFilter = h('select', { id: 'log-filter', class: 'input input--hmi' }, ['all', 'dose', 'alarm', 'interlock', 'action', 'phase', 'event', 'auto'].map((k) => h('option', { value: k }, k === 'all' ? 'All entries' : k === 'auto' ? 'auto (guided / automatic steps)' : k)));
  const logList = h('ol', { class: 'log', id: 'mon-log', reversed: true });
  let logLen = -1;
  logFilter.addEventListener('change', () => { logLen = -1; renderLog(); });
  const logPanel = h('section', { class: 'hmi-panel hmi-panel--wide', 'aria-labelledby': 'mon-log-h' }, h('h3', { id: 'mon-log-h' }, 'Event log'),
    h('div', { class: 'inline-form' }, h('label', { for: 'log-filter', class: 'label' }, 'Show'), logFilter), logList);

  const toDebrief = h('button', { type: 'button', class: 'btn btn--primary', id: 'mon-debrief' }, 'Finish → Debrief');
  toDebrief.addEventListener('click', () => ctx.go(5));

  clear(main).append(
    h('div', { class: 'step-head' }, h('h2', { id: 'step-title', tabindex: '-1' }, '4 · Run'),
      h('p', { class: 'muted' }, `${isGA ? 'General anaesthesia' : `MAC / sedation (target: ${sim.plan.sedationTarget})`} · fictional patient ${patient.sex}, ${patient.ageYears} y, ${patient.weightKg} kg · seed ${sim.seed} · all values are illustrative model output.`)),
    h('div', { class: 'hmi', id: 'hmi' },
      h('div', { class: 'hmi-toolbar' },
        h('div', { class: 'hmi-toolbar__group' }, h('span', { class: 'label' }, 'Sim time'), clock, phaseEl),
        h('div', { class: 'hmi-toolbar__group', role: 'group', 'aria-label': 'Playback' }, playBtn, stepBtns),
        h('div', { class: 'hmi-toolbar__group', role: 'group', 'aria-label': 'Speed' }, h('span', { class: 'label' }, 'Speed'), speedBtns),
        h('div', { class: 'hmi-toolbar__group' }, ilBadge, restartBtn)),
      fb, autoPanel,
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
    for (let i = 0; i < sec; i++) {
      sim.step(1); sample();
      const A = run.auto;
      if (A && A.state === 'running') { A.tick(); if (A.state !== 'running') break; }
    }
  }
  function frame(ts) {
    raf = null;
    if (!alive || !run.playing) return;
    if (lastTs !== null) {
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
  function setTile(key, value, sub, fault = false) {
    const t = tiles[key]; setText(t.val, value); setText(t.sub, sub);
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
    const F = (v) => (isNum(v) ? String(v) : 'FAULT');
    setTile('hr', F(V.hr), S.sensors.hr === 'fault' ? 'sensor fault — no usable reading' : '', S.sensors.hr === 'fault');
    setTile('bp', S.sensors.map === 'fault' ? 'FAULT' : `${V.sbp}/${V.dbp}`, S.sensors.map === 'fault' ? 'sensor fault — no usable reading' : `MAP ${V.map}`, S.sensors.map === 'fault');
    setTile('spo2', F(V.spo2), S.sensors.spo2 === 'fault' ? 'probe off / sensor fault' : '', S.sensors.spo2 === 'fault');
    const supported = (A.secured && A.ventilated) || A.maskVentilation;
    const noBreaths = !(V.rr > 0) && !supported;
    setTile('rr', String(V.rr), noBreaths ? 'APNOEA — no breaths' : A.secured && A.ventilated ? 'ventilator' : A.maskVentilation ? 'bag-mask' : 'spontaneous');
    const noEt = noBreaths || !isNum(V.etco2); // engine reports null without exhaled gas (no capnography signal)
    setTile('etco2', noEt ? '—' : String(V.etco2), noEt ? '(no breaths)' : 'illustrative');
    setTile('depth', String(V.depthIndex), `${V.sedationLevel} · illustrative; not BIS`);
    setTile('tof', `${V.tofCount}/4`, V.tofCount === 4 ? `TOFR ${V.tofRatio.toFixed(2)} · ${tofDepthText(V.tofCount, V.tofRatio)}` : `TOFR n/a · ${tofDepthText(V.tofCount, V.tofRatio)}`);
    let mac = 0; const agents = [];
    for (const d of lib.DRUGS) if (isInhaledDrug(d)) { const ds = S.drugs[d.id]; if (ds && (ds.unitConc > 0.005 || ds.infusionRate > 0)) { mac += ds.unitConc; agents.push(`${d.name} Et ${fmtNum(ds.cp, 1)} % (${fmtNum(ds.unitConc, 2)})`); } }
    setTile('mac', agents.length ? mac.toFixed(2) : '—', agents.length ? `${agents.join(' + ')} · age-adjusted, summed (illustrative)` : 'no inhaled agent');
    const n2o = S.drugs.nitrous_oxide ? S.drugs.nitrous_oxide.infusionRate : 0;
    setTile('fio2', A.fio2.toFixed(2), n2o > 0 ? `N2O ${n2o} % · FiO2 max ${(1 - n2o / 100).toFixed(2)}` : '');
    // interlocks
    const st = S.interlocks.status;
    ilBadge.className = `il-badge il-badge--${st.toLowerCase()}`; setText(ilBadge, `Interlocks: ${st}`);
    setText(ilStatus, INTERLOCK_TEXT[st] || st); ilStatus.className = `il-status il-status--${st.toLowerCase()}`;
    setText(ilHeld, S.interlocks.holdLatched ? `Held: ${S.interlocks.heldDrugs.map((id) => getDrugById(lib, id)?.name || id).join(', ') || 'none'}` : 'No hold latched.');
    resumeBtn.disabled = !(S.interlocks.enabled && S.interlocks.holdLatched);
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
    renderFluids(); renderAbx();
    // drugs
    renderDrugs();
    // readiness
    if (readyPanel) {
      const r = sim.extubationReadiness();
      setText(readyHead, r.ready ? '✓ All criteria met' : `✗ Not ready — ${r.criteria.filter((c) => !c.met).length} criterion/criteria not met`);
      readyHead.className = `ready-head ${r.ready ? 'ready-head--ok' : 'ready-head--no'}`;
      const sig = r.criteria.map((c) => `${c.id}${c.met}${JSON.stringify(c.value)}`).join('|');
      if (sig !== readyList.dataset.sig) { readyList.dataset.sig = sig; clear(readyList).append(...r.criteria.map((c) => readinessItem(c))); }
    }
    renderAuto();
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
    clear(flTotals).append(...Object.entries(F.byType).map(([id, v]) => h('tr', { dataset: { fluid: id } }, h('th', { scope: 'row' }, (FL.find((f) => f.id === id) || {}).name || id),
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

  function renderAlarms() {
    const list = sim.state.alarms;
    const sig = list.map((a) => `${a.id}:${a.active}:${a.acknowledged}:${a.message}`).join('|');
    const activeNow = new Set(list.filter((a) => a.active).map((a) => a.id));
    for (const a of list) if (a.active && !run.seenAlarms.has(a.id)) announce(`${PRIORITY_LABELS[a.priority]} priority alarm: ${a.message}`, a.priority === 'high');
    run.seenAlarms = activeNow;
    if (sig === alarmSig) return;
    alarmSig = sig;
    const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ack : null;
    clear(alarmList);
    if (!list.length) { alarmList.append(h('li', { class: 'alarm alarm--none' }, 'No alarms.')); }
    for (const a of list) {
      const b = h('button', { type: 'button', class: 'btn btn--hmi btn--small', dataset: { ack: a.id }, 'data-auto-safe': 'acknowledge', disabled: a.acknowledged, 'aria-label': `Acknowledge ${PRIORITY_LABELS[a.priority]} alarm: ${a.message}` }, a.acknowledged ? 'Acknowledged' : 'Acknowledge');
      b.addEventListener('click', () => { sim.action(`acknowledge:${a.id}`); render(true); const nb = alarmList.querySelector('button:not([disabled])'); (nb || alarmPanel.querySelector('h3')).focus?.(); });
      alarmList.append(h('li', { class: `alarm alarm--${a.priority}${a.active ? '' : ' alarm--latched'}` },
        h('span', { class: `prio prio--${a.priority}` }, `${PRIORITY_SHAPES[a.priority]} ${PRIORITY_LABELS[a.priority]}`),
        h('span', { class: 'alarm__msg' }, a.message, h('span', { class: 'alarm__meta' }, ` since ${fmtClock(a.sinceSec)} · ${a.active ? 'active' : 'condition cleared (latched)'}${a.acknowledged ? ' · acknowledged' : ''}`)), b));
    }
    if (focusedId) { const fbtn = alarmList.querySelector(`[data-ack="${focusedId}"]`); if (fbtn && !fbtn.disabled) fbtn.focus(); }
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
        drugBody.append(h('tr', {}, h('th', { scope: 'row' }, d.name), rate, ce, cum, h('td', { class: 'controls' }, bol, adj, stop)));
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
    clear(logList).append(...items.map((e) => h('li', { class: `log__item log__item--${e.kind}` }, h('span', { class: 'mono' }, fmtClock(e.tSec)), ' ', h('span', { class: 'log__kind' }, e.kind), ' ', e.message)));
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
        clear(c.legend).append(...series.map((s) => h('li', {}, h('span', { class: `swatch${s.dash ? ' swatch--dash' : ''}` }), s.label)));
        for (const [i, li] of [...c.legend.children].entries()) li.firstChild.style.borderColor = series[i].color;
      }
      const last = series.map((s) => { const v = s.data[s.data.length - 1]; return `${s.label} ${isNum(v) ? fmtNum(v, 2) : 'no value'}`; }).join('; ');
      c.canvas.setAttribute('aria-label', `${c.title}, last 15 simulated minutes. Current: ${last || 'no data'}.`);
    }
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => drawCharts()) : null;
  if (ro) for (const c of charts) ro.observe(c.canvas);

  if (!run.hist.t.length) sample();
  render(true);
  if (run.autoStart) { const m = run.autoStart; run.autoStart = null; beginAuto(m); }
  else if (run.playing) setPlaying(true);

  return {
    leave() { if (run.auto && run.auto.state === 'running') run.auto.pause('Paused: left the Run screen.'); run.autoListener = null; alive = false; if (raf) cancelAnimationFrame(raf); raf = null; if (ro) ro.disconnect(); if (run.playing) { run.playing = false; sim.pause(); } },
  };
}

function readinessItem(c) {
  const v = c.value && typeof c.value === 'object' ? Object.entries(c.value).map(([k, x]) => `${k.toUpperCase()} ${isNum(x) ? x : 'FAULT'}`).join(', ') : isNum(c.value) ? String(c.value) : 'FAULT';
  return h('li', { class: c.met ? 'ready--met' : 'ready--no' }, h('span', { class: 'ready__mark', 'aria-hidden': 'true' }, c.met ? '✓' : '✗'),
    h('span', {}, h('span', { class: 'sr-only' }, c.met ? 'Met: ' : 'Not met: '), c.label, ` — ${v} `, c.source && c.source !== 'illustrative' ? srcTags([c.source]) : h('span', { class: 'badge badge--illustrative' }, 'illustrative')));
}
export { readinessItem };

function groupDrugs(lib) {
  const m = new Map();
  for (const d of lib.DRUGS) { if (!m.has(d.cls)) m.set(d.cls, []); m.get(d.cls).push(d); }
  return [...m.entries()].sort((a, b) => (CLASS_ORDER.indexOf(a[0]) + 100 * (CLASS_ORDER.indexOf(a[0]) < 0)) - (CLASS_ORDER.indexOf(b[0]) + 100 * (CLASS_ORDER.indexOf(b[0]) < 0)));
}
