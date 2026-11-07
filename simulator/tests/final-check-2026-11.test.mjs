// Final-check fixes (2026-11, owner-approved): maintenance-hypnotic lockout gap (plan level + guided gate +
// full-demonstration refusal), depth-high (awareness-risk) alarm, "unusable" reading text, hold-continue choice,
// MAP/HR summary statistics across sensor faults.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REAL, basePatient, clinicianResolves } from './helpers.mjs';
import { derivePatient } from '../engine/patient.js';
import { createSimulation } from '../engine/sim.js';
import { recommend } from '../engine/dosing.js';
import { InterlockCore } from '../engine/interlocks.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { createAutoRunner } from '../engine/autorun.js';
import { AUTORUN_CONFIG } from '../engine/autorun-config.js';
import { CASE_ACTIONS } from '../engine/case-actions.js';
import { TIMING_CONFIG, validatePlanTiming } from '../engine/timing.js';
import { maintenanceHypnoticGap, tivaMaintenanceSteps, computeLockouts } from '../engine/plan-safety.js';
import { buildTemplatePlan } from '../engine/templates.js';
import { evaluateRescue } from '../engine/rescue.js';
import { exportPlan, planIssues, addTivaMaintenance, stepsFromBuiltPlan, setLockoutRemoved, noteLockedDeletion } from '../ui/plan-model.js';

const DONE = ['completed', 'stopped', 'manual'];
const N = TIMING_CONFIG.DEPTH_HIGH_ALARM_SUSTAIN_SEC.value;
const [, HI] = TIMING_CONFIG.GA_DEPTH_BAND.value;
const ex = (id) => EXAMPLE_PLANS.find((p) => p.id === id);
const pat = (id) => derivePatient(EXAMPLE_PATIENTS.find((p) => p.id === id).patient, { library: REAL });
const depthHigh = (sim) => sim.alarmMgr.history.filter((x) => x.id === 'depth_high');

/** What the user does at a pause: acknowledge HIGH alarms, release a latched hold, clinician-only items, Resume. */
function resolve(sim, runner) {
  for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`);
  if (sim.core.holdLatched) { sim.action('acknowledge_hold'); sim.action('resume_hold'); }
  clinicianResolves(runner);
  return runner.resume();
}
/** Drives a full or guided run to the end; onStep(sim) after each simulated second. */
function drive(sim, runner, { maxSec = 12000, onStep = null } = {}) {
  let pauses = 0;
  for (let i = 0; i < maxSec && !DONE.includes(runner.state); i++) {
    if (runner.state === 'paused') { pauses++; resolve(sim, runner); continue; }
    if (runner.mode === 'guided') {
      const st = runner.status();
      if (st.current && st.current.gate) { clinicianResolves(runner); if (runner.status().current.enabled) runner.approve(st.current.id); }
    }
    sim.step(1); runner.tick();
    if (onStep) onStep(sim);
  }
  return pauses;
}
const withSteps = (plan, extra) => ({ ...plan, steps: [...plan.steps, ...extra.map((s, i) => ({ ...s, id: `tiva${i + 1}`, order: 100 + i }))] });

if (REAL) {
  // ======================================================================== 1a / C / E: plan level
  test('F1a MH + sevoflurane example plan: lockout leaves no maintenance hypnotic → blocking message; plan never modified', () => {
    const p = pat('mh_susceptible');
    const { plan, skipped } = buildPlan(ex('ga_healthy'), p, REAL);
    assert.ok(skipped.some((x) => x.drugId === 'sevoflurane' && x.locked));
    assert.deepEqual(plan.lockoutRemoved.map((x) => [x.drugId, x.phase, x.kind]), [['sevoflurane', 'maintenance', 'inhaled']]);
    const before = JSON.stringify(plan);
    const g = maintenanceHypnoticGap(plan, p, { library: REAL });
    assert.equal(g.blocking, true);
    assert.match(g.message, /^No maintenance hypnotic after lockout: Sevoflurane is contraindicated \(.*malignant hyperthermia.*\)\. Add an alternative \(e\.g\. propofol infusion — TIVA\) before approving\.$/);
    assert.equal(g.tivaAvailable, true);
    assert.equal(JSON.stringify(plan), before, 'the check never modifies the plan');
    // the engine sees the same gap (sim.plan keeps lockoutRemoved), logs it, and never adds a step
    const sim = createSimulation({ patient: p, plan, seed: 1, library: REAL });
    assert.equal(sim.maintenanceHypnoticGap().blocking, true);
    assert.ok(sim.state.log.some((l) => l.message === g.message));
    assert.equal(sim.plan.steps.length, plan.steps.length);
  });

  test('F1a full demonstration refuses to start; guided "Approve & start induction" stays disabled with the message', () => {
    const p = pat('mh_susceptible'); const { plan } = buildPlan(ex('ga_healthy'), p, REAL);
    const msg = maintenanceHypnoticGap(plan, p, { library: REAL }).message;
    const full = createAutoRunner({ sim: createSimulation({ patient: p, plan, seed: 1, library: REAL }), mode: 'full' });
    const r = full.start();
    assert.equal(r.ok, false); assert.equal(r.message, msg); assert.equal(full.state, 'idle');
    const sim = createSimulation({ patient: p, plan, seed: 1, library: REAL });
    const g = createAutoRunner({ sim, mode: 'guided' });
    assert.equal(g.start().ok, true);
    for (let i = 0; i < 2400; i++) {
      const st = g.status();
      if (st.current && st.current.gate && st.current.enabled) g.approve(st.current.id);
      if (g.status().current.id === 'start_induction' && sim.state.tSec > 1200) break;
      sim.step(1); g.tick();
    }
    const st = g.status();
    assert.equal(st.current.id, 'start_induction');
    assert.equal(st.current.enabled, false);
    assert.ok(st.current.unmet.includes(msg), st.current.unmet.join(' | '));
    const a = g.approve('start_induction');
    assert.equal(a.ok, false); assert.match(a.message, /No maintenance hypnotic after lockout/);
    assert.equal(sim.state.phase, 'premed');
  });

  test('C generic over plan steps × lockouts: sevoflurane, desflurane and isoflurane for an MH patient; propofol allergy for TIVA', () => {
    const p = pat('mh_susceptible');
    for (const vol of ['sevoflurane', 'desflurane', 'isoflurane']) {
      const tpl = { ...ex('ga_healthy'), steps: ex('ga_healthy').steps.map((s) => (s.drugId === 'sevoflurane' ? { ...s, drugId: vol } : s)) };
      const { plan } = buildPlan(tpl, p, REAL);
      const g = maintenanceHypnoticGap(plan, p, { library: REAL });
      assert.equal(g.blocking, true, vol);
      assert.match(g.message, new RegExp(`after lockout: ${REAL.DRUGS.find((d) => d.id === vol).name} is contraindicated`), vol);
      // a locked step left IN the plan (patient changed after the plan was built) is detected the same way
      const kept = buildPlan(tpl, pat('healthy_adult'), REAL).plan;
      assert.equal(maintenanceHypnoticGap(kept, p, { library: REAL }).blocking, true, `${vol} kept in plan`);
      assert.equal(maintenanceHypnoticGap(kept, pat('healthy_adult'), { library: REAL }).blocking, false, `${vol} healthy`);
    }
    // a different lockout rule: propofol allergy removes the TIVA hypnotic; TIVA is then not offered
    const allergic = derivePatient(basePatient({ allergies: ['propofol'] }), { library: REAL });
    const { plan } = buildPlan(ex('tiva_mh'), allergic, REAL);
    const g = maintenanceHypnoticGap(plan, allergic, { library: REAL });
    assert.equal(g.blocking, true); assert.match(g.message, /Propofol is contraindicated/); assert.equal(g.tivaAvailable, false);
    assert.deepEqual(computeLockouts(allergic, REAL).lockouts.propofol.length > 0, true);
    // unaffected: every example plan for its own patient, MAC plans, and templates (fallback swaps the volatile)
    for (const e of EXAMPLE_PLANS) assert.equal(maintenanceHypnoticGap(buildPlan(e, pat(e.patientId), REAL).plan, pat(e.patientId), { library: REAL }).blocking, false, e.id);
    for (const t of ['ga_opioid', 'ga_opioid_free']) assert.equal(maintenanceHypnoticGap(buildTemplatePlan(t, p, { library: REAL }).plan, p, { library: REAL }).blocking, false, t);
  });

  test('F1a / D "Add propofol TIVA maintenance": steps from recommend(), "Why this time" rationale, Timing check; unblocks', () => {
    const p = pat('mh_susceptible'); const { plan } = buildPlan(ex('ga_healthy'), p, REAL);
    const { steps } = tivaMaintenanceSteps(p, REAL);
    const inf = steps.find((s) => s.kind === 'infusion'); const stop = steps.find((s) => s.kind === 'stop');
    const rec = recommend(p, 'maintenance', 'propofol', REAL);
    assert.equal(inf.rate, rec.rate.value); assert.equal(inf.rateUnit, rec.rate.unit); assert.deepEqual(inf.sources, rec.sources);
    assert.equal(inf.phase, 'maintenance'); assert.equal(stop.phase, 'emergence'); assert.equal(stop.drugId, 'propofol');
    for (const s of steps) { assert.equal(s.addedBy, 'clinician_tiva'); assert.ok(s.timingRationale && s.timingRationale.text.length > 30 && s.timingRationale.provenance); }
    const fixed = withSteps(plan, steps);
    assert.equal(maintenanceHypnoticGap(fixed, p, { library: REAL }).blocking, false);
    const checks = validatePlanTiming(fixed, REAL);
    const rev = checks.find((c) => c.id === 'reversal');
    assert.equal(rev.status, 'pass', rev.message); // the propofol infusion is stopped at emergence before sugammadex
    // logged in the case log as the clinician's addition
    const sim = createSimulation({ patient: p, plan: fixed, seed: 1, library: REAL });
    assert.ok(sim.state.log.some((l) => /added by the clinician with "Add propofol TIVA maintenance"/.test(l.message)));
  });

  test('F1a plan editor model: planIssues blocks; nothing changes until the clinician adds TIVA; deleting a locked volatile keeps the gap', () => {
    const p = pat('mh_susceptible'); const c = { lib: REAL, patient: p, interlocks: true, patientVersion: 1 };
    const { plan: built } = buildPlan(ex('ga_healthy'), p, REAL);
    const edit = { mode: 'GA', sedationTarget: null, steps: stepsFromBuiltPlan(c, built) };
    setLockoutRemoved(edit, built.lockoutRemoved);
    const iss = planIssues(c, edit);
    assert.ok(iss.errors >= 1); assert.ok(iss.hypnoticGap && /No maintenance hypnotic after lockout/.test(iss.hypnoticGap.message));
    const n = edit.steps.length; planIssues(c, edit); exportPlan(edit);
    assert.equal(edit.steps.length, n, 'no auto-modification');
    const r = addTivaMaintenance(c, edit);
    assert.equal(r.ok, true); assert.match(r.message, /^Clinician added propofol TIVA maintenance/);
    assert.equal(edit.steps.length, n + 2);
    assert.equal(planIssues(c, edit).hypnoticGap, null);
    const ex2 = exportPlan(edit);
    assert.ok(ex2.steps.some((s) => s.drugId === 'propofol' && s.kind === 'infusion' && s.addedBy === 'clinician_tiva' && s.timingRationale));
    // patient changed to MH after a healthy plan: the user deletes the (locked) sevoflurane step → still blocked
    const h = { mode: 'GA', sedationTarget: null, steps: stepsFromBuiltPlan(c, buildPlan(ex('ga_healthy'), pat('healthy_adult'), REAL).plan) };
    const sevo = h.steps.find((s) => s.drugId === 'sevoflurane' && s.kind === 'inhaled');
    noteLockedDeletion(c, h, sevo); h.steps.splice(h.steps.indexOf(sevo), 1);
    assert.ok(planIssues(c, h).hypnoticGap, 'deleting the locked volatile does not hide the gap');
  });

  test('E regression (reported case): MH patient + healthy-adult GA example → blocked; after TIVA, full demonstration completes with zero depth-high alarms', (t) => {
    const p = pat('mh_susceptible');
    const pcts = [];
    for (let seed = 1; seed <= 5; seed++) {
      const { plan } = buildPlan(ex('ga_healthy'), p, REAL);
      assert.equal(createAutoRunner({ sim: createSimulation({ patient: p, plan, seed, library: REAL }), mode: 'full' }).start().ok, false);
      const fixed = withSteps(plan, tivaMaintenanceSteps(p, REAL).steps);
      const sim = createSimulation({ patient: p, plan: fixed, seed, library: REAL });
      const runner = createAutoRunner({ sim, mode: 'full' });
      assert.equal(runner.start().ok, true);
      let n = 0, inBand = 0, above = 0;
      drive(sim, runner, { onStep: (s) => { const S = s.state; if (S.phase === 'maintenance' && S.airway.secured) { n++; const d = S.vitals.depthIndex; if (d >= 40 && d <= HI) inBand++; if (d > HI) above++; } } });
      assert.equal(runner.state, 'completed', `seed ${seed}: ${runner.stopReason}`);
      assert.equal(depthHigh(sim).length, 0, `seed ${seed}`);
      assert.equal(above, 0, `seed ${seed}: index never above ${HI} in maintenance/surgery`);
      pcts.push(Math.round((1000 * inBand) / n) / 10);
    }
    t.diagnostic(`MH + ga_healthy + TIVA, % of maintenance/surgery time with index 40–60, seeds 1–5: ${pcts.join(', ')} (rest below 40, none above 60)`);
  });

  // ======================================================================== 1b / B: depth-high alarm
  test('F1b config: sustain duration, hysteresis and priority are simulator conventions in TIMING_CONFIG and the parameter inventory; band reused', () => {
    for (const k of ['DEPTH_HIGH_ALARM_SUSTAIN_SEC', 'DEPTH_HIGH_ALARM_CLEAR', 'DEPTH_HIGH_ALARM_PRIORITY']) {
      assert.equal(TIMING_CONFIG[k].provenance, 'simulator_convention', k);
      assert.equal(TIMING_CONFIG[k].sourceIds.length, 0, k);
    }
    assert.equal(N, 60); assert.equal(TIMING_CONFIG.DEPTH_HIGH_ALARM_CLEAR.value, 58); assert.equal(TIMING_CONFIG.DEPTH_HIGH_ALARM_PRIORITY.value, 'high');
    assert.ok(AUTORUN_CONFIG.PAUSE_ALARM_PRIORITIES.value.includes('high'));
    const inv = createSimulation({ patient: pat('healthy_adult'), library: REAL }).parameterInventory();
    for (const k of ['DEPTH_HIGH_ALARM_SUSTAIN_SEC', 'DEPTH_HIGH_ALARM_CLEAR']) assert.ok(inv.some((x) => x.name === k && x.provenance === 'simulator_convention'), k);
  });

  test('F1b reported case in MANUAL mode (engine alarm): MH + sevoflurane-locked plan → HIGH depth-high alarm within N s of sustained index > 60', () => {
    const p = pat('mh_susceptible'); const { plan } = buildPlan(ex('ga_healthy'), p, REAL);
    const sim = createSimulation({ patient: p, plan, seed: 1, library: REAL });
    const A = CASE_ACTIONS; let run = 0; let firstAt = null; let alarmAt = null;
    const step = (sec) => { for (let i = 0; i < sec; i++) {
      sim.step(1);
      const S = sim.state; const armed = S.airway.secured && ['induction', 'maintenance'].includes(S.phase);
      run = armed && S.vitals.depthIndex > HI ? run + 1 : 0;
      if (run === N && firstAt === null) firstAt = S.tSec;
      const a = S.alarms.find((x) => x.id === 'depth_high');
      if (a && alarmAt === null) { alarmAt = S.tSec; assert.equal(a.priority, 'high'); assert.match(a.message, /Processed-EEG index \d+ > 60 for ≥ 60 s during general anaesthesia — risk of awareness; check hypnotic delivery/); }
    } };
    A.transfer_to_or(sim); step(600); A.mask_ventilate(sim); A.start_induction(sim); step(330);
    assert.equal(A.secure_airway(sim).ok, true); step(60); A.start_maintenance(sim); A.confirm_time_out(sim); A.start_surgery(sim); step(1800);
    assert.ok(firstAt !== null, 'index stayed above 60 for N s');
    assert.ok(alarmAt !== null, 'depth-high alarm raised');
    assert.ok(Math.abs(alarmAt - firstAt) <= 1, `alarm at ${alarmAt}, sustained ${N} s at ${firstAt}`);
    assert.ok(sim.alarmMgr.history.find((x) => x.id === 'depth_high'));
  });

  test('F1b full demonstration pauses for the depth-high alarm and never acknowledges it; guided pauses too', () => {
    for (const mode of ['full', 'guided']) {
      // no lockout: a plan whose maintenance volatile was simply left out (the alarm is the runtime safety net)
      const p = pat('healthy_adult');
      const { plan } = buildPlan({ ...ex('ga_healthy'), steps: ex('ga_healthy').steps.filter((s) => s.drugId !== 'sevoflurane') }, p, REAL);
      const sim = createSimulation({ patient: p, plan, seed: 1, library: REAL });
      const runner = createAutoRunner({ sim, mode });
      assert.equal(runner.start().ok, true);
      let paused = null;
      for (let i = 0; i < 6000 && !DONE.includes(runner.state); i++) {
        if (runner.state === 'paused') {
          if (runner.pauseReasons.some((r) => r.alarmId === 'depth_high')) { paused = sim.state.tSec; break; }
          resolve(sim, runner); continue;
        }
        // guided: the clinician approves every gate up to incision, then lets surgery run (never presses End surgery here)
        if (mode === 'guided') { const st = runner.status(); if (st.current && st.current.gate && st.current.id !== 'end_surgery') { clinicianResolves(runner); if (runner.status().current.enabled) runner.approve(st.current.id); } }
        sim.step(1); runner.tick();
      }
      assert.ok(paused !== null, `${mode}: paused for depth_high`);
      for (let i = 0; i < 30; i++) { runner.tick(); assert.equal(runner.resume().ok, false, 'Resume refused until the clinician acknowledges'); }
      const a = sim.state.alarms.find((x) => x.id === 'depth_high');
      assert.equal(a.acknowledged, false, `${mode}: never auto-acknowledged`);
      assert.ok(!sim.state.log.some((l) => /acknowledg/i.test(l.message) && /depth_high/.test(l.message) && l.kind === 'auto'));
      sim.action('acknowledge:depth_high');
      assert.equal(runner.resume().ok, true, mode);
    }
  });

  test('F1b not before loss of consciousness, not in MAC, not in emergence; hysteresis clears at ≤ 58', () => {
    // pre-LOC: airway secured right after induction starts, no hypnotic given yet → no alarm
    const p = pat('healthy_adult');
    const opioidOnly = buildPlan({ mode: 'GA', steps: [{ phase: 'induction', atSec: 0, drugId: 'fentanyl', regimenKey: 'induction', kind: 'bolus' }] }, p, REAL).plan;
    const sim = createSimulation({ patient: p, plan: opioidOnly, seed: 1, library: REAL });
    CASE_ACTIONS.start_induction(sim); sim.action('secure_airway');
    for (let i = 0; i < 300; i++) sim.step(1);
    assert.ok(sim.state.airway.secured); assert.ok(sim.state.vitals.depthIndex > HI);
    assert.equal(depthHigh(sim).length, 0, 'not before loss of consciousness');
    // MAC: the sedation index is above 60 throughout → never
    const mp = pat('obese_osa'); const ms = createSimulation({ patient: mp, plan: buildPlan(ex('mac_obese_osa'), mp, REAL).plan, seed: 1, library: REAL });
    const mr = createAutoRunner({ sim: ms, mode: 'full' }); mr.start(); let macHigh = 0;
    drive(ms, mr, { onStep: (s) => { if (s.state.vitals.depthIndex > HI) macHigh++; } });
    assert.ok(macHigh > N); assert.equal(depthHigh(ms).length, 0, 'never in MAC');
    // hysteresis: raise the alarm (hypnotic omitted), then start propofol → clears only at ≤ 58, stays latched until acknowledged
    const { plan } = buildPlan({ ...ex('ga_healthy'), steps: ex('ga_healthy').steps.filter((s) => s.drugId !== 'sevoflurane') }, p, REAL);
    const s2 = createSimulation({ patient: p, plan, seed: 1, library: REAL });
    const A = CASE_ACTIONS; A.transfer_to_or(s2); for (let i = 0; i < 600; i++) s2.step(1); A.mask_ventilate(s2); A.start_induction(s2);
    for (let i = 0; i < 330; i++) s2.step(1); A.secure_airway(s2); A.start_maintenance(s2);
    let on = null; for (let i = 0; i < 1800 && on === null; i++) { s2.step(1); if (s2.state.alarms.some((x) => x.id === 'depth_high' && x.active)) on = s2.state.tSec; }
    assert.ok(on !== null);
    const rec = recommend(p, 'maintenance', 'propofol', REAL);
    s2.administer({ drugId: 'propofol', kind: 'infusion', rate: rec.rate.value, rateUnit: rec.rate.unit, regimenKey: 'maintenance' });
    s2.administer({ drugId: 'propofol', kind: 'bolus', amount: 30, amountUnit: 'mg', regimenKey: 'induction' });
    let cleared = null;
    for (let i = 0; i < 900 && cleared === null; i++) {
      s2.step(1); const a = s2.state.alarms.find((x) => x.id === 'depth_high');
      if (a && a.active) assert.ok(s2.state.vitals.depthIndex > TIMING_CONFIG.DEPTH_HIGH_ALARM_CLEAR.value, `active at ${s2.state.vitals.depthIndex}`);
      if (a && !a.active) { cleared = s2.state.vitals.depthIndex; assert.equal(a.acknowledged, false, 'latched until acknowledged'); }
    }
    assert.ok(cleared !== null && cleared <= TIMING_CONFIG.DEPTH_HIGH_ALARM_CLEAR.value, `cleared at ${cleared}`);
  });

  test('F1b example plans × guided/full × seeds 1–20: zero depth-high alarms (emergence and MAC exercise index > 60)', () => {
    let emergenceHigh = 0; let runs = 0;
    for (const e of EXAMPLE_PLANS) {
      const p = pat(e.patientId);
      for (const mode of ['full', 'guided']) for (let seed = 1; seed <= 20; seed++) {
        const sim = createSimulation({ patient: p, plan: buildPlan(e, p, REAL).plan, seed, library: REAL });
        const runner = createAutoRunner({ sim, mode }); assert.equal(runner.start().ok, true);
        let run = 0;
        drive(sim, runner, { onStep: (s) => { run = s.state.phase === 'emergence' && s.state.airway.secured && s.state.vitals.depthIndex > HI ? run + 1 : 0; if (run === N) emergenceHigh++; } });
        assert.equal(runner.state, 'completed', `${e.id} ${mode} seed ${seed}: ${runner.stopReason}`);
        assert.deepEqual(depthHigh(sim), [], `${e.id} ${mode} seed ${seed}`);
        runs++;
      }
    }
    assert.equal(runs, EXAMPLE_PLANS.length * 40);
    assert.ok(emergenceHigh > 0, 'emergence with the tube in and index > 60 for ≥ N s occurred and did not alarm');
  });

  // ======================================================================== 2 / F: unusable readings
  test('F2 sensor-fault interlock message renders unusable values as "unusable" (never NaN)', () => {
    const core = new InterlockCore();
    const r = core.evaluate(NaN, 118);
    assert.equal(r.events[0].message, 'Invalid sensor reading (HR=unusable, MAP=118) → all controlled infusions set to zero; hold latched');
    assert.match(new InterlockCore().evaluate(72, undefined).events[0].message, /HR=72, MAP=unusable/);
    const sim = createSimulation({ patient: pat('healthy_adult'), seed: 1, library: REAL });
    sim.inject('map_sensor_fault'); for (let i = 0; i < 5; i++) sim.step(1);
    sim.inject('hr_sensor_fault'); for (let i = 0; i < 5; i++) sim.step(1);
    const text = [...sim.state.log.map((l) => l.message), ...sim.state.alarms.map((a) => a.message)].join('\n');
    assert.match(text, /HR=unusable, MAP=unusable|MAP=unusable/);
    assert.doesNotMatch(text, /NaN/);
  });

  test('F advisory card reads "MAP reading unusable" during a MAP fault; debrief MAP/HR/SpO2 min–max skip fault gaps', () => {
    const p = pat('healthy_adult');
    const sim = createSimulation({ patient: p, seed: 1, library: REAL });
    for (let i = 0; i < 30; i++) sim.step(1);
    sim.inject('map_sensor_fault'); sim.inject('hr_sensor_fault'); sim.inject('spo2_probe_off');
    for (let i = 0; i < 10; i++) sim.step(1);
    assert.ok(Number.isNaN(sim.state.vitals.map));
    assert.match(evaluateRescue(sim).headline, /^MAP reading unusable/);
    for (let i = 0; i < 120; i++) sim.step(1);
    assert.equal(sim.state.sensors.map, 'ok');
    const s = sim.summary();
    for (const k of ['minMap', 'maxMap', 'minHr', 'maxHr', 'minSpo2']) { assert.ok(Number.isFinite(s[k]), k); assert.ok(s[k] > 0, `${k} not read as 0`); }
    assert.ok(s.minMap >= 50 && s.maxMap <= 140, `${s.minMap}–${s.maxMap}`);
    assert.ok(s.minHr >= 40, String(s.minHr));
  });

  // ======================================================================== A: continue with hold latched
  /** Elderly example, full demonstration, hemorrhage 5 min into surgery → sustained MAP < 60 → interlock hold. */
  function holdCase() {
    const p = pat('elderly_cad_ckd');
    const sim = createSimulation({ patient: p, plan: buildPlan(ex('ga_elderly_cad_ckd'), p, REAL).plan, seed: 1, library: REAL });
    const runner = createAutoRunner({ sim, mode: 'full' }); runner.start();
    let injected = false;
    for (let i = 0; i < 6000; i++) {
      if (runner.state === 'paused') {
        if (runner.pauseReasons.some((r) => r.kind === 'interlock_hold')) break;
        for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`);
        clinicianResolves(runner); runner.resume(); continue;
      }
      sim.step(1); runner.tick();
      if (!injected && sim.stim.surgeryStartAt !== null && sim.state.tSec - sim.stim.surgeryStartAt > 300) { sim.inject('hemorrhage'); injected = true; }
    }
    assert.ok(runner.pauseReasons.some((r) => r.kind === 'interlock_hold'), 'paused for the hold');
    for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`);
    return { sim, runner };
  }

  test('A1 never a default, never chosen by the runner; offered only while paused for a hold', () => {
    const { sim, runner } = holdCase();
    assert.equal(runner.status().canContinueWithHold, true);
    for (let i = 0; i < 20; i++) { runner.tick(); assert.equal(runner.resume().ok, false); }
    assert.equal(runner.holdContinue, null);
    assert.ok(!sim.state.log.some((l) => /Clinician chose to continue with hold latched/.test(l.message)));
    const fresh = createAutoRunner({ sim: createSimulation({ patient: pat('healthy_adult'), seed: 1, library: REAL }), mode: 'full' });
    fresh.start();
    assert.equal(fresh.clinicianAction('continue_with_hold').ok, false);
    assert.equal(AUTORUN_CONFIG.CONTINUE_WITH_HOLD_OPTION.provenance, 'simulator convention (unsourced)');
  });

  test('A2 explicit and logged; the hold stays latched, held infusions stay at zero, no alarm is acknowledged; the same hold does not re-pause', () => {
    const { sim, runner } = holdCase();
    const ep = sim.state.interlocks.holdEpisode;
    assert.ok(ep && ep.triggers.includes('map_low'));
    const ackBefore = sim.state.alarms.map((a) => [a.id, a.acknowledged]);
    const r = runner.clinicianAction('continue_with_hold');
    assert.equal(r.ok, true);
    assert.match(r.message, /^Clinician chose to continue with hold latched: dexmedetomidine, lidocaine held \(MAP < 60; latched at \d\d:\d\d\)/);
    assert.ok(sim.state.log.some((l) => l.kind === 'auto' && /Clinician chose to continue with hold latched: dexmedetomidine, lidocaine/.test(l.message)));
    assert.equal(runner.state, 'running');
    assert.deepEqual(runner.holdContinue.heldDrugs, ep.heldDrugs); assert.equal(runner.holdContinue.latchedAtSec, ep.latchedAtSec); assert.deepEqual(runner.holdContinue.triggers, ep.triggers);
    for (const [id, ack] of ackBefore) { const a = sim.state.alarms.find((x) => x.id === id); if (a) assert.equal(a.acknowledged, ack, id); }
    let below = 0;
    for (let i = 0; i < 120 && runner.state === 'running'; i++) { sim.step(1); runner.tick(); if (sim.state.vitals.map < 60) below++; }
    assert.ok(below > 30, 'MAP stayed below 60');
    assert.equal(runner.state, 'running', 'the same hold does not pause again');
    assert.equal(sim.core.holdLatched, true);
    for (const id of ['dexmedetomidine', 'lidocaine']) assert.equal(sim.state.drugs[id].infusionRate, 0, id);
  });

  test('A3 a new HIGH alarm or a new trigger pauses again; A4 the choice ends when the hold is released', () => {
    const { sim, runner } = holdCase();
    runner.clinicianAction('continue_with_hold');
    for (let i = 0; i < 10; i++) { sim.step(1); runner.tick(); }
    assert.equal(runner.state, 'running');
    // a new HIGH alarm alone (SpO2 probe off is not an interlock trigger) pauses: only the alarm
    sim.inject('spo2_probe_off');
    for (let i = 0; i < 3 && runner.state === 'running'; i++) { sim.step(1); runner.tick(); }
    assert.equal(runner.state, 'paused');
    assert.deepEqual(runner.pauseReasons.map((r) => r.alarmId || r.kind), ['sensor_fault_spo2'], 'the continued hold itself is not a reason');
    sim.action('acknowledge:sensor_fault_spo2'); assert.equal(runner.resume().ok, true);
    assert.ok(runner.holdContinue, 'the choice still covers the same hold');
    sim.inject('map_sensor_fault'); // new trigger (sensor_fault: unusable MAP) + new HIGH alarm
    for (let i = 0; i < 3 && runner.state === 'running'; i++) { sim.step(1); runner.tick(); }
    assert.equal(runner.state, 'paused');
    assert.ok(runner.pauseReasons.some((r) => r.alarmId === 'sensor_fault_map'), 'new HIGH alarm');
    sim.action('acknowledge:sensor_fault_map'); runner.resume();
    for (let i = 0; i < 3 && runner.state === 'running'; i++) { sim.step(1); runner.tick(); }
    assert.equal(runner.state, 'paused');
    assert.ok(sim.state.interlocks.holdEpisode.triggers.includes('sensor_fault'));
    assert.ok(runner.pauseReasons.some((r) => r.kind === 'interlock_hold'), 'new trigger → the hold pauses again');
    assert.equal(runner.holdContinue, null, 'a new episode ends the earlier choice');
    assert.ok(sim.state.log.some((l) => /"Continue with hold latched" choice ended — new hold episode/.test(l.message)));
    // release: "Resume hold" ends the choice; MAP still < 60 re-latches → a new episode pauses again
    const b = holdCase();
    b.runner.clinicianAction('continue_with_hold');
    assert.ok(b.runner.holdContinue);
    { b.sim.action('acknowledge_hold'); b.sim.action('resume_hold'); }
    b.sim.step(1); b.runner.tick();
    assert.equal(b.runner.holdContinue, null, 'released hold → the choice is gone');
    assert.ok(b.sim.core.holdLatched, 'MAP still < 60: re-latched');
    assert.equal(b.runner.state, 'paused', 'the new latch pauses again');
  });

  test('A3 hold episode identity: re-latch after recovery (past the clearing hysteresis) or another held drug is a new episode', () => {
    const sim = createSimulation({ patient: pat('healthy_adult'), seed: 1, library: REAL });
    sim.core.latchHold(['Dexmedetomidine', 'Lidocaine']);
    const ev = (code) => [{ code }];
    const S = sim.state; S.interlocks.heldDrugs = ['dexmedetomidine', 'lidocaine'];
    S.vitals.map = 55; sim._trackHoldEpisode(10, ev('map_low'), new Set());
    const id1 = S.interlocks.holdEpisode.id;
    S.vitals.map = 61; sim._trackHoldEpisode(11, [], new Set(sim.core.heldDrugs));
    assert.equal(S.interlocks.holdEpisode.triggerActive, true, 'MAP 61 has not passed the clearing hysteresis (62)');
    S.vitals.map = 59; sim._trackHoldEpisode(12, ev('map_low'), new Set(sim.core.heldDrugs));
    assert.equal(S.interlocks.holdEpisode.id, id1, 'noise at the threshold is the same episode');
    S.vitals.map = 66; sim._trackHoldEpisode(13, [], new Set(sim.core.heldDrugs));
    assert.equal(S.interlocks.holdEpisode.triggerActive, false);
    S.vitals.map = 58; sim._trackHoldEpisode(14, ev('map_low'), new Set(sim.core.heldDrugs));
    const id2 = S.interlocks.holdEpisode.id; assert.notEqual(id2, id1, 're-latch after recovery');
    S.vitals.hr = 45; sim._trackHoldEpisode(15, [...ev('map_low'), ...ev('hr_low')], new Set(sim.core.heldDrugs));
    assert.notEqual(S.interlocks.holdEpisode.id, id2, 'different trigger');
    sim.core.acknowledgeHold('clinician'); sim.core.resumeHold('clinician'); sim._trackHoldEpisode(16, [], new Set());
    assert.equal(S.interlocks.holdEpisode, null);
  });
}
