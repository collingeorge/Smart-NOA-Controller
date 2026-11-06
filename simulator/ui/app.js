// Smart NOA web simulator — UI entry point. Educational simulation with fictional patients.
import * as LIB from '../data/drugs.js';
import { h, clear, announce, fmtClock } from './dom.js';
import { derivePatient, validatePatient } from '../engine/patient.js';
import { createSimulation } from '../engine/sim.js';
import { CASE_ACTIONS } from '../engine/case-actions.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { initSources, srcTags } from './sources.js';
import { renderPatient, defaultPatientInput } from './patient-form.js';
import { renderAssessment } from './assessment.js';
import { renderPlan, setMode, interlockExplanation } from './plan-editor.js';
import { renderMonitor, newRunState, readinessItem } from './monitor.js';
import { renderDebrief } from './debrief.js';
import { exportPlan, planIssues, stepsFromBuiltPlan, setLockoutRemoved } from './plan-model.js';
import { notModeled } from './labels.js';
import { renderModelCard, loadModelAssumptions, assumptionsList, AI_DISCLOSURE, TOOL_DESCRIPTION } from './model-card.js';
import { pal, renderPalliative, setPalModule, stop as stopPalliative, renderEthics, palSnapshot } from './palliative.js';

const lib = LIB;
const STEPS = [
  { n: 1, label: 'Patient' }, { n: 2, label: 'Assessment' }, { n: 3, label: 'Anesthetic plan' }, { n: 4, label: 'Run' }, { n: 5, label: 'Debrief' },
];

const store = {
  step: 1,
  module: 'periop',
  patientInput: defaultPatientInput(),
  patientVersion: 1,
  exampleId: null,
  plan: { mode: 'GA', sedationTarget: 'moderate', steps: [], stepsByMode: null },
  planVersion: 1,
  planNotice: null,
  interlocks: true,
  seed: 1,
  sim: null, simKey: null,
  run: newRunState(),
};
store.plan.stepsByMode = { GA: store.plan.steps, MAC: [] };

let derivedCache = { v: -1, p: null };
function getPatient() {
  if (derivedCache.v === store.patientVersion) return derivedCache.p;
  let p = null;
  try { if (validatePatient(store.patientInput, { library: lib }).ok) p = derivePatient(store.patientInput, { library: lib }); } catch { p = null; }
  derivedCache = { v: store.patientVersion, p };
  return p;
}

let fluidsCache = null;
function fluidsSupported() {
  if (fluidsCache !== null) return fluidsCache;
  try {
    const s = createSimulation({ patient: derivePatient(EXAMPLE_PATIENTS[0].patient, { library: lib }), library: lib });
    fluidsCache = !!s.action('fluid_bolus:250').ok;
  } catch { fluidsCache = false; }
  return fluidsCache;
}

const simKey = () => JSON.stringify([store.patientVersion, store.planVersion, store.interlocks, store.seed]);
function restartSim() {
  const p = getPatient();
  store.sim = createSimulation({ patient: p, plan: exportPlan(store.plan), seed: store.seed, interlocks: store.interlocks, library: lib });
  store.simKey = simKey();
  store.run = { ...newRunState(), testClock: !!(store.run && store.run.testClock) };
  return store.sim;
}
function ensureSim() { if (!store.sim || store.simKey !== simKey()) restartSim(); return store.sim; }

function planCtx() { return { lib, patient: getPatient(), interlocks: store.interlocks, patientVersion: store.patientVersion }; }

function canGo(n) {
  if (n <= 1) return { ok: true };
  if (!getPatient()) return { ok: false, why: 'Complete a valid patient first.' };
  if (n <= 3) return { ok: true };
  if (n === 4) { const iss = planIssues(planCtx(), store.plan); return iss.errors ? { ok: false, why: `Fix ${iss.errors} blocking plan issue(s) first.` } : { ok: true }; }
  if (n === 5) return store.sim && store.simKey === simKey() ? { ok: true } : { ok: false, why: 'Run the case first.' };
  return { ok: true };
}

let current = null;
// Context passed to every view (functions below are hoisted declarations).
const ctx = { store, lib, go, rerender, refreshStepper, getPatient, loadExample, ensureSim, restartSim, openExtubation, fluidsSupported,
  patientChanged() { store.patientVersion += 1; },
  planChanged() { store.planVersion += 1; } };

function go(n) {
  const c = canGo(n);
  if (!c.ok) { announce(c.why, true); refreshStepper(); return false; }
  if (current && current.leave) current.leave();
  current = null;
  store.step = n;
  render();
  const t = document.getElementById('step-title');
  if (t) t.focus();
  window.scrollTo({ top: 0 });
  return true;
}

function render() {
  const main = document.getElementById('main');
  if (store.module !== 'periop') { renderPalliative(main); main.dataset.step = `pal-${pal.step}`; return; }
  const views = { 1: renderPatient, 2: renderAssessment, 3: renderPlan, 4: renderMonitor, 5: renderDebrief };
  current = views[store.step](ctx, main) || null;
  main.dataset.step = String(store.step);
  refreshStepper();
}
function rerender() { if (current && current.leave) current.leave(); current = null; render(); }

/** Module chooser: Perioperative (existing) | Palliative pain management | End-of-life care. */
function setModule(m) {
  if (!['periop', 'pain', 'eol'].includes(m)) return;
  if (current && current.leave) current.leave();
  current = null;
  stopPalliative();
  if (m !== 'periop') setPalModule(m);
  store.module = m;
  const palOn = m !== 'periop';
  document.getElementById('pal-banner').hidden = !palOn;
  document.getElementById('open-ethics').hidden = !palOn;
  document.querySelector('.stepper').hidden = palOn;
  for (const b of document.querySelectorAll('[data-module]')) b.setAttribute('aria-pressed', String(b.dataset.module === m));
  render();
  const t = document.getElementById('step-title'); if (t) t.focus();
  announce(`Module: ${{ periop: 'Perioperative', pain: 'Palliative pain management', eol: 'End-of-life care' }[m]}.`);
}

function refreshStepper() {
  const ol = document.getElementById('stepper-list');
  clear(ol);
  for (const s of STEPS) {
    const c = canGo(s.n);
    const b = h('button', { type: 'button', class: 'stepper__btn', id: `stepper-${s.n}`, 'aria-current': store.step === s.n ? 'step' : null, 'aria-disabled': c.ok ? null : 'true', title: c.ok ? null : c.why },
      h('span', { class: 'stepper__num' }, String(s.n)), h('span', { class: 'stepper__label' }, s.label), c.ok ? null : h('span', { class: 'sr-only' }, ` (unavailable: ${c.why})`));
    b.addEventListener('click', () => { if (store.step !== s.n) go(s.n); });
    ol.append(h('li', { class: store.step === s.n ? 'is-current' : store.step > s.n ? 'is-done' : '' }, b));
  }
}

function loadExample(id) {
  const ex = EXAMPLE_PATIENTS.find((e) => e.id === id);
  if (!ex) return;
  store.patientInput = JSON.parse(JSON.stringify(ex.patient));
  store.exampleId = id;
  store.patientVersion += 1;
  const p = getPatient();
  const t = EXAMPLE_PLANS.find((pl) => pl.patientId === id);
  if (p && t) {
    const { plan, skipped } = buildPlan(t, p, lib);
    setMode(store.plan, t.mode);
    store.plan.sedationTarget = t.sedationTarget || store.plan.sedationTarget;
    store.plan.steps.splice(0, store.plan.steps.length, ...stepsFromBuiltPlan(planCtx(), plan));
    setLockoutRemoved(store.plan, plan.lockoutRemoved || []);
    store.planNotice = `Example plan “${t.label}” loaded.${skipped.length ? ` Skipped: ${skipped.map((s) => `${s.drugId} (${s.reason})`).join('; ')}` : ''}`;
  }
  store.planVersion += 1;
}

// ---------------------------------------------------------------- extubation dialog
/**
 * Extubation dialog. `opts.pause()` is called when it opens and `opts.resume()` when it closes, so
 * the simulation clock does not run while the clinician reads the checklist. Readiness is
 * re-evaluated when a button is pressed: if it changed since the dialog was drawn, the dialog is
 * redrawn with the current state instead of acting on a stale snapshot (2026-11 audit, finding 3).
 */
function openExtubation(sim, opts = {}) {
  const o = typeof opts === 'function' ? { after: opts } : opts;
  const after = o.after || (() => {});
  const dlg = document.getElementById('extubate-dialog');
  if (!dlg.open) {
    if (o.pause) o.pause();
    dlg.addEventListener('close', () => { if (o.resume) o.resume(); after(); }, { once: true });
  }
  drawExtubation(sim, dlg);
  if (!dlg.open) dlg.showModal();
  const first = document.getElementById('extubate-body').querySelector('button'); if (first) first.focus();
}

function drawExtubation(sim, dlg) {
  const body = document.getElementById('extubate-body');
  const r = sim.extubationReadiness();
  const unmet = r.criteria.filter((c) => !c.met);
  const sig = JSON.stringify(r.criteria.map((c) => c.met));
  const E = lib.SOURCE_IDS_ENGINE || {};
  const doIt = (override) => {
    const now = sim.extubationReadiness();
    if (JSON.stringify(now.criteria.map((c) => c.met)) !== sig) {
      // Readiness changed since the dialog was drawn: show the current checklist; do not act.
      drawExtubation(sim, dlg);
      announce('Readiness changed — the checklist was updated. Review it and confirm again.', true);
      const b = body.querySelector('#ext-confirm, #ext-override'); if (b) b.focus();
      return;
    }
    // Shared case actions (engine/case-actions.js); the guided/automatic runner never calls the override.
    if (override) store.run.overrides.push({ tSec: sim.state.tSec, unmet: now.criteria.filter((c) => !c.met).map((c) => c.label) });
    const res = override ? CASE_ACTIONS.extubateOverride(sim) : CASE_ACTIONS.extubateFromDialog(sim);
    if (!res.ok && !override) { drawExtubation(sim, dlg); announce(res.message, true); return; }
    announce(res.message, !now.ready);
    dlg.close();
  };
  clear(body).append(
    h('p', {}, `Sim time ${fmtClock(sim.state.tSec)}. TOFR ≥ 0.9 must be confirmed before extubation `, srcTags([E.tofExtubation]), '; other criteria are illustrative simulator rules.'),
    h('ul', { class: 'ready-list ready-list--light' }, r.criteria.map((c) => readinessItem(c))),
    r.ready ? h('p', { class: 'notice' }, 'All readiness criteria are met.')
      : h('p', { class: 'notice notice--warn', role: 'alert' }, `Not ready: ${unmet.map((c) => c.label).join('; ')}. Extubating now is logged as a decision against the checklist.`),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel — keep the tube'),
      r.ready ? h('button', { type: 'button', class: 'btn btn--primary', id: 'ext-confirm', onclick: () => doIt(false) }, 'Extubate')
        : h('button', { type: 'button', class: 'btn btn--danger', id: 'ext-override', onclick: () => doIt(true) }, 'Extubate anyway (logged)')));
}

// ---------------------------------------------------------------- about + model card
async function renderAbout() {
  const body = document.getElementById('about-body');
  const assumptions = await loadModelAssumptions();
  const sim = store.sim;
  const info = sim ? sim.modelInfo() : {};
  clear(body).append(
    h('p', {}, h('strong', {}, TOOL_DESCRIPTION), ' It is not a medical device, not clinical decision support, and is not connected to any monitor, pump or record system. Nothing you enter leaves this page.'),
    h('h3', {}, 'What it does'),
    h('p', {}, 'You build a fictional adult patient, review a computed assessment, plan an anaesthetic with doses auto-filled from FDA prescribing information and society guidelines (each with its source), then run an illustrative monitor and debrief the case.'),
    h('h3', {}, 'Model limits'),
    h('ul', { class: 'list' },
      h('li', {}, 'Every displayed physiological value is illustrative model output; the simulator as a whole is not validated.'),
      h('li', {}, 'The depth number is a processed-EEG depth index (BIS-style, simulated; 0–100, illustrative). It is not a BIS value; BIS is a trademark of its owner.'),
      h('li', {}, 'Doses are label/guideline values; the auto-filled default within a range is a simulator convention, not a recommendation.')),
    h('h4', {}, 'Model assumptions recorded in SOURCES.md'), assumptionsList(assumptions),
    h('h4', {}, 'Engine model records for drugs used in the current case'),
    Object.keys(info).length ? h('ul', { class: 'list list--tight' }, Object.entries(info).map(([id, m]) => h('li', {}, h('strong', {}, (lib.DRUGS.find((d) => d.id === id) || {}).name || id), `: ${m.type} — ${m.provenance}`)))
      : h('p', { class: 'hint' }, 'No drugs used yet. The Model card lists every drug’s parameters.'),
    h('h4', {}, 'Not modelled'), h('ul', { class: 'chips' }, notModeled(lib, { fluids: fluidsSupported() }).map((x) => h('li', { class: 'chip chip--muted' }, x))),
    h('h3', {}, 'Relation to the Smart NOA Python controller'), interlockExplanation(lib),
    h('p', {}, 'The interlock layer is a port of the decision rules in smart_noa_controller.py with the thresholds of config.yaml; automated parity tests reproduce the Python reference outcomes. The simulator adds an explicit, logged “Resume hold” action that the Python controller does not have.'),
    h('h3', {}, 'AI assistance'), h('p', {}, AI_DISCLOSURE),
    h('h3', {}, 'Accessibility'), h('p', {}, 'Alarms are announced to screen readers, every colour signal is paired with text, and all controls work from the keyboard.'));
}

async function renderModel() {
  const body = document.getElementById('model-body');
  const assumptions = await loadModelAssumptions();
  const p = getPatient() || derivePatient(EXAMPLE_PATIENTS[0].patient, { library: lib });
  renderModelCard(body, { lib, patient: store.sim ? store.sim.patient : p, sim: store.sim, assumptions });
}

function init() {
  initSources(lib);
  document.getElementById('loading')?.remove();
  document.getElementById('open-sources').addEventListener('click', (e) => { document.getElementById('sources-dialog').showModal(); const r = e.currentTarget; document.getElementById('sources-dialog').addEventListener('close', () => r.focus(), { once: true }); });
  document.getElementById('open-about').addEventListener('click', async (e) => { const r = e.currentTarget; await renderAbout(); const d = document.getElementById('about-dialog'); d.showModal(); d.addEventListener('close', () => r.focus(), { once: true }); });
  document.getElementById('open-ethics').addEventListener('click', (e) => { const r = e.currentTarget; renderEthics(document.getElementById('ethics-body')); const d = document.getElementById('ethics-dialog'); d.showModal(); d.addEventListener('close', () => r.focus(), { once: true }); });
  for (const b of document.querySelectorAll('[data-module]')) b.addEventListener('click', () => { if (store.module !== b.dataset.module) setModule(b.dataset.module); });
  document.getElementById('open-model').addEventListener('click', async (e) => { const r = e.currentTarget; await renderModel(); const d = document.getElementById('model-dialog'); d.showModal(); d.addEventListener('close', () => r.focus(), { once: true }); });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-close-dialog]'); if (b) b.closest('dialog').close(); });
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  render();
}

// Test hook for the browser smoke test, only when the page URL has ?test=1. It exposes a
// snapshot() function returning a deep copy of the state (plain data; nothing live or mutable).
function testSnapshot() {
  const sim = store.sim; const a = store.run.auto;
  const copy = (x) => JSON.parse(JSON.stringify(x));
  return copy({
    step: store.step, interlocksOn: store.interlocks, overrides: store.run.overrides,
    sim: sim ? { t: sim.state.tSec, phase: sim.state.phase, v: sim.state.vitals, il: sim.state.interlocks.status, interlocks: sim.state.interlocks,
      airway: sim.state.airway, ready: sim.extubationReadiness().ready, readiness: sim.extubationReadiness(), log: sim.state.log, playing: store.run.playing,
      fluids: sim.state.fluids, prophylaxis: sim.state.prophylaxis, checklist: sim.prophylaxisChecklist(), alarms: sim.state.alarms, drugs: { lidocaine: sim.state.drugs.lidocaine } } : null,
    plan: { mode: store.plan.mode, sedationTarget: store.plan.sedationTarget, template: store.plan.template || null, steps: store.plan.steps.map((x) => ({ drugId: x.drugId, kind: x.kind, phase: x.phase, regimenKey: x.regimenKey, amount: x.amount, rate: x.rate, atSec: x.atSec })) },
    auto: a ? { ...a.status(), idx: a.idx, history: a.history } : null,
    hist: store.run && store.run.hist ? { hr: store.run.hist.hr.slice(-3), map: store.run.hist.map.slice(-3), spo2: store.run.hist.spo2.slice(-3) } : null, // trend-chart samples (NaN gap → null)
    periop: sim ? sim.state.periop : null, planStatus: sim ? sim.planStatus().map((x) => ({ id: x.id, phase: x.phase, drugId: x.drugId, kind: x.kind, status: x.status, waiting: x.waiting || null })) : null,
  });
}
function testLite() {
  const sim = store.sim; const a = store.run.auto; const st = a ? a.status() : null;
  return JSON.parse(JSON.stringify({ t: sim ? sim.state.tSec : null, phase: sim ? sim.state.phase : null, v: sim ? sim.state.vitals : null, airway: sim ? sim.state.airway : null,
    ready: sim ? sim.extubationReadiness().ready : null, playing: store.run.playing,
    auto: st ? { state: st.state, message: st.message, current: st.current, historyIds: a.history.map((x) => x.id) } : null }));
}
try {
  if (new URLSearchParams(window.location.search).get('test') === '1') {
    window.__smartNoa = Object.freeze({
      snapshot: testSnapshot,
      /** Step-driven tests: true = the wall clock never advances simulated time (only advance() does). */
      testClock: (on) => { store.run.testClock = !!on; return store.run.testClock; },
      /** Advance simulated time synchronously by `sec` seconds on the Run screen (runner ticks each second). */
      advance: (sec) => (store.run && typeof store.run.testAdvance === 'function' && store.run.testAdvance(sec) ? testLite() : null),
      /** Small status object (cheap to poll): time, phase, vitals, airway, readiness, runner state. */
      lite: () => testLite(),
      /** Injects a scenario event directly into the engine (no UI control is clicked) — used to reproduce self-pauses. */
      inject: (id) => (store.sim ? JSON.parse(JSON.stringify(store.sim.inject(id))) : null),
      /** Advisory record (engine/rescue.js), plain data. */
      advisories: () => (store.sim ? JSON.parse(JSON.stringify(store.sim.summary().advisories)) : null),
      /** Depth-low advisory record (engine/depth-advisory.js), plain data. */
      depthAdvisories: () => (store.sim ? JSON.parse(JSON.stringify(store.sim.summary().depthAdvisories)) : null),
      /** Palliative modules: plain-data snapshot, step-driven clock, synchronous advance by `min` simulated minutes. */
      pal: () => palSnapshot(),
      palTestClock: (on) => { pal.testClock = !!on; return pal.testClock; },
      palAdvance: (min) => (typeof pal.testAdvance === 'function' && pal.step === 3 ? (pal.testAdvance(min), palSnapshot()) : null),
    });
  }
} catch { /* no test hook */ }

init();
