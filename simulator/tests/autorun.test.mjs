// Guided (phase-gated) mode and "Run full case automatically" (engine/autorun.js).
// EDUCATIONAL SIMULATION — fictional patients — not a medical device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REAL, clinicianResolves } from './helpers.mjs';
import { derivePatient } from '../engine/patient.js';
import { createSimulation, ALARM_THRESHOLDS } from '../engine/sim.js';
import { NOA_CONFIG } from '../engine/interlocks.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { createAutoRunner, buildSequence, BANNERS } from '../engine/autorun.js';
import { AUTORUN_CONFIG, CONVENTION } from '../engine/autorun-config.js';
import { CASE_ACTIONS } from '../engine/case-actions.js';

const DONE = ['completed', 'stopped', 'manual'];

/** Builds an example case with spies on sim.action and on the case actions. */
function setup(planId, { seed = 1, mode = 'full', editPlan = null } = {}) {
  const tpl = EXAMPLE_PLANS.find((p) => p.id === planId);
  const patient = derivePatient(EXAMPLE_PATIENTS.find((p) => p.id === tpl.patientId).patient, { library: REAL });
  const { plan } = buildPlan(tpl, patient, REAL);
  if (editPlan) editPlan(plan);
  const before = JSON.parse(JSON.stringify(plan.steps));
  const sim = createSimulation({ patient, plan, seed, library: REAL });
  const calls = { runner: [], user: [], caseActions: [] };
  let byUser = false;
  const action = sim.action.bind(sim);
  sim.action = (id) => { (byUser ? calls.user : calls.runner).push(id); return action(id); };
  const actions = Object.fromEntries(Object.entries(CASE_ACTIONS).map(([k, fn]) => [k, (...a) => { calls.caseActions.push(k); return fn(...a); }]));
  const runner = createAutoRunner({ sim, mode, actions });
  const asUser = (fn) => { byUser = true; try { return fn(); } finally { byUser = false; } };
  /** What a user does when the runner pauses: acknowledge HIGH alarms, release a latched hold, Resume. */
  const userResolves = () => asUser(() => {
    for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`);
    if (sim.core.holdLatched) sim.action('resume_hold');
    clinicianResolves(runner); // clinician-only items (time out, index below band, missing prophylaxis)
    return runner.resume();
  });
  /** Guided: the clinician confirms clinician-only items at the pre-incision / pre-procedure gate. */
  const clinician = () => asUser(() => clinicianResolves(runner));
  return { tpl, patient, plan, before, sim, runner, calls, asUser, userResolves, clinician };
}

function driveFull(c, maxSec = 12000) {
  const { sim, runner } = c; let pauses = 0;
  for (let i = 0; i < maxSec && !DONE.includes(runner.state); i++) {
    if (runner.state === 'paused') { pauses++; c.userResolves(); continue; }
    sim.step(1); runner.tick();
  }
  return pauses;
}

/** Guided: approve each gate as soon as it is enabled, recording what was seen. */
function driveGuided(c, maxSec = 12000, { onGate = null } = {}) {
  const { sim, runner } = c; const gates = [];
  for (let i = 0; i < maxSec && !DONE.includes(runner.state); i++) {
    if (runner.state === 'paused') { c.userResolves(); continue; }
    const st = runner.status();
    if (st.current && st.current.gate) {
      if (gates[gates.length - 1] !== st.current.id) gates.push(st.current.id);
      if (onGate) onGate(st, c);
      if (st.current.items && !st.current.enabled) c.clinician();
      if (runner.status().current.enabled) { const r = runner.approve(st.current.id); assert.ok(r.ok, r.message); continue; }
    }
    sim.step(1); runner.tick();
  }
  return gates;
}

function assertAutoLogged(c) {
  const log = c.sim.state.log.filter((e) => e.kind === 'auto');
  assert.ok(log.every((e) => e.message.startsWith('AUTO: ')));
  const n = c.runner.seq.length;
  c.runner.history.forEach((h, i) => assert.ok(log.some((e) => e.message.startsWith(`AUTO: step ${i + 1}/${n} — ${h.label}`) && e.tSec === Math.round(h.tSec * 10) / 10), `step ${h.id} logged`));
}

function assertUnchangedPlan(c) {
  assert.deepEqual(c.plan.steps, c.before, 'plan object unchanged');
  const pick = (s) => ({ id: s.id, drugId: s.drugId, kind: s.kind, amount: s.amount, amountUnit: s.amountUnit, rate: s.rate, rateUnit: s.rateUnit, atSec: s.atSec, phase: s.phase });
  assert.deepEqual(c.sim.plan.steps.map(pick), c.before.map(pick), 'simulation plan amounts/rates unchanged');
}

function assertNoRunnerOverrides(c) {
  assert.ok(!c.calls.caseActions.includes('extubateOverride'), 'override path never called');
  assert.ok(!c.calls.runner.some((id) => id === 'resume_hold' || id.startsWith('acknowledge:')), `runner never released holds/acknowledged: ${c.calls.runner.join(',')}`);
  assert.ok(!c.sim.state.log.some((e) => /despite unmet readiness/.test(e.message)));
}

const GA_GATES = ['transfer_to_or', 'start_induction', 'secure_airway', 'start_maintenance', 'start_surgery', 'end_surgery', 'begin_emergence', 'extubate'];
const MAC_GATES = ['transfer_to_or', 'start_sedation', 'start_procedure', 'end_procedure'];
const CLINICIAN_CASE_ACTIONS = ['confirm_time_out', 'acknowledge_depth_below_band'];

// ---------------------------------------------------------------- config block
test('autorun config: one frozen block; every entry has value, unit, rationale and provenance; sourceIds exist', () => {
  assert.ok(Object.isFrozen(AUTORUN_CONFIG));
  const entries = Object.entries(AUTORUN_CONFIG);
  assert.ok(entries.length >= 20);
  for (const [k, x] of entries) {
    assert.ok(Object.isFrozen(x), k);
    assert.ok(x.value !== undefined && x.value !== null, `${k}: value`);
    assert.ok(typeof x.unit === 'string' && x.unit, `${k}: unit`);
    assert.ok(typeof x.rationale === 'string' && x.rationale.length > 20, `${k}: rationale`);
    assert.ok(['both', 'guided', 'full'].includes(x.appliesTo), `${k}: appliesTo`);
    assert.ok(Array.isArray(x.sourceIds), `${k}: sourceIds`);
    if (x.provenance === CONVENTION) assert.equal(x.sourceIds.length, 0, `${k}: convention has no sources`);
    else { assert.ok(['guideline', 'project_config'].includes(x.provenance), `${k}: provenance ${x.provenance}`); assert.ok(x.sourceIds.length > 0, `${k}: sourced`); }
    if (REAL) for (const id of x.sourceIds) assert.ok(REAL.SOURCES[id], `${k}: source ${id} exists`);
    assert.ok(!/(?<!not |un|never )\bvalidated\b|\bpredictive\b|\baccurate\b|closed-loop/i.test(x.rationale), `${k}: wording`);
  }
  // reused thresholds are the engine's sourced values, not new ones
  assert.equal(AUTORUN_CONFIG.EXTUBATION_TOFR_MIN.value, ALARM_THRESHOLDS.TOFR_EXTUBATION);
  assert.deepEqual([...AUTORUN_CONFIG.EXTUBATION_TOFR_MIN.sourceIds], [REAL ? REAL.SOURCE_IDS_ENGINE.tofExtubation : 'S5']);
  assert.equal(AUTORUN_CONFIG.INTERLOCK_MAP_CRITICAL_LOW.value, NOA_CONFIG.hemodynamic_thresholds.map_critical_low);
  assert.equal(AUTORUN_CONFIG.INTERLOCK_HR_CRITICAL_LOW.value, NOA_CONFIG.hemodynamic_thresholds.hr_critical_low);
  if (REAL) assert.deepEqual([...AUTORUN_CONFIG.SEDATION_TARGET_LEVEL.sourceIds], [REAL.SOURCE_IDS_ENGINE.sedationContinuum]);
  assert.deepEqual([...AUTORUN_CONFIG.PAUSE_ALARM_PRIORITIES.value], ['high'], 'medium/low alarms do not pause');
  // every timing used by the sequences comes from the block
  for (const m of ['GA', 'MAC']) for (const s of buildSequence(m)) for (const k of ['fullWaitSec', 'minSec', 'holdSec', 'timeoutSec']) if (s[k] !== undefined) assert.ok(entries.some(([, x]) => x.value === s[k]), `${m}/${s.id}.${k}`);
  assert.deepEqual(buildSequence('GA').filter((s) => s.gate).map((s) => s.id), GA_GATES);
  assert.deepEqual(buildSequence('MAC').filter((s) => s.gate).map((s) => s.id), MAC_GATES);
  assert.match(BANNERS.full, /^Automatic demonstration: scripted sequence, not a closed-loop controller or a clinical recommendation$/);
});

if (REAL) {
  test('autorun config entries are in the parameter inventory with provenance', () => {
    const sim = createSimulation({ patient: derivePatient(EXAMPLE_PATIENTS[0].patient, { library: REAL }), library: REAL });
    const inv = sim.parameterInventory().filter((x) => x.component === 'autorun');
    assert.equal(inv.length, Object.keys(AUTORUN_CONFIG).length);
    for (const x of inv) {
      const c = AUTORUN_CONFIG[x.name];
      assert.equal(x.provenance, c.provenance === CONVENTION ? 'simulator_convention' : c.provenance);
      assert.deepEqual(x.sourceIds, [...c.sourceIds]);
    }
  });

  // ---------------------------------------------------------------- full demonstration, all examples
  for (const tpl of EXAMPLE_PLANS) {
    test(`full demonstration: ${tpl.id} runs the whole sequence with unchanged doses`, () => {
      const c = setup(tpl.id, { mode: 'full' });
      assert.ok(c.runner.start().ok);
      const pauses = driveFull(c);
      assert.equal(c.runner.state, 'completed', c.runner.message);
      assert.deepEqual(c.runner.history.map((h) => h.id), c.runner.seq.map((s) => s.id));
      assert.ok(c.runner.history.every((h) => h.by === 'auto'));
      assertUnchangedPlan(c); assertNoRunnerOverrides(c); assertAutoLogged(c);
      const sum = c.sim.summary();
      assert.equal(sum.automatic.used, true); assert.equal(sum.automatic.mode, 'full'); assert.equal(sum.automatic.outcome, 'completed');
      assert.equal(sum.automatic.pauses.length, pauses);
      assert.ok(c.sim.planStatus().every((s) => s.status === 'done'), JSON.stringify(c.sim.planStatus()));
      if (tpl.mode === 'GA') {
        assert.equal(c.sim.state.airway.secured, false);
        assert.equal(sum.extubation.ready, true, JSON.stringify(sum.extubation));
        assert.ok(sum.extubation.criteria.find((x) => x.id === 'tofr').value >= 0.9);
        assert.ok(c.calls.caseActions.includes('extubate'));
      } else {
        assert.equal(c.sim.state.phase, 'emergence');
        assert.ok(['minimal', 'awake'].includes(c.sim.state.vitals.sedationLevel));
      }
      // the sequence used the same shared case actions as the manual buttons
      const expect = tpl.mode === 'GA' ? ['transfer_to_or', 'set_fio2', 'mask_ventilate', 'start_induction', 'secure_airway', 'start_maintenance', 'start_surgery', 'end_surgery', 'begin_emergence', 'extubate']
        : ['transfer_to_or', 'set_fio2', 'start_sedation', 'start_procedure', 'end_procedure', 'end_sedation'];
      assert.deepEqual(c.calls.caseActions.filter((a) => !CLINICIAN_CASE_ACTIONS.includes(a)), expect);
      // the WHO time out was confirmed by the user (clinician), never by the runner
      assert.ok(c.calls.user.includes('confirm_time_out') && !c.calls.runner.includes('confirm_time_out'));
    });
  }

  test('full demonstration: MH-susceptible TIVA case completes with no volatile and no succinylcholine', () => {
    const c = setup('tiva_mh');
    assert.ok(!c.plan.steps.some((s) => ['sevoflurane', 'desflurane', 'isoflurane', 'succinylcholine'].includes(s.drugId)));
    c.runner.start(); driveFull(c);
    assert.equal(c.runner.state, 'completed', c.runner.message);
    const tot = c.sim.summary().totals;
    for (const d of ['sevoflurane', 'desflurane', 'isoflurane', 'succinylcholine']) assert.ok(!tot[d], d);
    assert.ok(tot.propofol.amount > 0);
  });

  // ---------------------------------------------------------------- guided mode, all examples
  for (const tpl of EXAMPLE_PLANS) {
    test(`guided mode: ${tpl.id} — gates in order, nothing advances without approval, conditions enforced`, () => {
      const c = setup(tpl.id, { mode: 'guided' });
      const { sim, runner } = c;
      runner.start();
      // nothing advances without the first gate (Transfer to OR: enabled 5 min after the premedication ended)
      for (let i = 0; i < 600; i++) { sim.step(1); runner.tick(); }
      assert.equal(sim.state.phase, 'premed'); assert.equal(runner.idx, 0);
      assert.ok(runner.status().current.enabled);
      let sawIntubateDisabled = false, sawExtubateDisabled = false, idleChecked = false;
      const gates = driveGuided(c, 12000, {
        onGate: (st) => {
          const id = st.current.id; const V = sim.state.vitals;
          if (id === 'secure_airway') {
            const ok = sim.planStatus().filter((s) => ['premed', 'induction'].includes(s.phase)).every((s) => s.status !== 'pending') && V.depthIndex <= AUTORUN_CONFIG.INTUBATION_DEPTH_MAX.value && V.tofCount <= AUTORUN_CONFIG.INTUBATION_TOF_COUNT_MAX.value;
            assert.equal(st.current.enabled, ok, `intubate enabled iff conditions met (depth ${V.depthIndex}, TOF ${V.tofCount})`);
            if (!ok) { sawIntubateDisabled = true; assert.equal(runner.approve('secure_airway').ok, false); assert.equal(sim.state.airway.secured, false); }
          }
          if (id === 'extubate') {
            const ready = sim.extubationReadiness().ready;
            assert.equal(st.current.enabled, ready);
            if (!ready) { sawExtubateDisabled = true; assert.equal(runner.approve('extubate').ok, false); assert.equal(sim.state.airway.secured, true); }
          }
          if (id === 'start_maintenance' && !idleChecked) {
            idleChecked = true; const ph = sim.state.phase;
            for (let i = 0; i < 200; i++) { sim.step(1); runner.tick(); if (runner.state === 'paused') c.userResolves(); }
            assert.equal(sim.state.phase, ph, 'maintenance waits for the clinician');
          }
        },
      });
      assert.equal(runner.state, 'completed', runner.message);
      assert.deepEqual(gates, tpl.mode === 'GA' ? GA_GATES : MAC_GATES);
      if (tpl.mode === 'GA') {
        assert.ok(sawIntubateDisabled, 'Intubate was disabled before conditions were met');
        assert.ok(sawExtubateDisabled, 'Extubate was disabled before readiness');
        assert.equal(c.sim.summary().extubation.ready, true);
        const surg = runner.history.find((h) => h.id === 'start_surgery');
        assert.equal(surg.by, 'clinician', 'surgery starts only through the pre-incision verification gate (no time-based start)');
      } else {
        assert.equal(runner.history.find((h) => h.id === 'start_procedure').by, 'clinician');
      }
      for (const h of runner.history) assert.equal(h.by, buildSequence(tpl.mode).find((s) => s.id === h.id).gate ? 'clinician' : 'auto');
      assertUnchangedPlan(c); assertNoRunnerOverrides(c); assertAutoLogged(c);
      assert.equal(c.sim.summary().automatic.mode, 'guided');
    });
  }

  // ---------------------------------------------------------------- failing extubation readiness
  const noReversal = (plan) => { plan.steps = plan.steps.filter((s) => s.drugId !== 'sugammadex'); };

  test('full demonstration: readiness not met (no reversal) — stops, reports unmet criteria, never extubates or overrides', () => {
    const c = setup('ga_elderly_cad_ckd', { editPlan: noReversal });
    c.runner.start(); driveFull(c);
    assert.equal(c.runner.state, 'stopped');
    assert.equal(c.runner.current.id, 'extubate');
    assert.ok(c.runner.unmetAtStop.some((u) => /TOF ratio/.test(u)), c.runner.unmetAtStop.join('; '));
    assert.ok(c.sim.state.vitals.tofRatio < 0.9);
    assert.equal(c.sim.state.airway.secured, true, 'tube still in');
    assert.ok(!c.calls.runner.includes('extubate'));
    assert.ok(!c.calls.caseActions.includes('extubate') && !c.calls.caseActions.includes('extubateOverride'));
    assertNoRunnerOverrides(c);
    const A = c.sim.summary().automatic;
    assert.equal(A.outcome, 'stopped'); assert.equal(A.stoppedAt.step, 'Extubate'); assert.ok(A.unmet.some((u) => /TOF ratio/.test(u)));
    assert.match(c.sim.state.log.filter((e) => e.kind === 'auto').pop().message, /stopped — Extubate: conditions not met.*Unmet: .*TOF ratio/);
  });

  test('guided mode: readiness not met — Extubate stays disabled, unmet criteria shown after the time limit, no override', () => {
    const c = setup('ga_elderly_cad_ckd', { mode: 'guided', editPlan: noReversal });
    const { sim, runner } = c;
    runner.start();
    for (let i = 0; i < 12000 && runner.current && runner.current.id !== 'extubate'; i++) {
      if (runner.state === 'paused') { c.userResolves(); continue; }
      let st = runner.status(); if (st.current.items && !st.current.enabled) { c.clinician(); st = runner.status(); }
      if (st.current.enabled) { runner.approve(st.current.id); continue; }
      sim.step(1); runner.tick();
    }
    assert.equal(runner.current.id, 'extubate');
    for (let i = 0; i < AUTORUN_CONFIG.EXTUBATION_TIMEOUT_SEC.value + 60; i++) { if (runner.state === 'paused') c.userResolves(); sim.step(1); runner.tick(); }
    const st = runner.status();
    assert.equal(runner.state, 'running', 'guided mode keeps waiting');
    assert.equal(st.current.enabled, false); assert.equal(st.current.timedOut, true);
    assert.ok(st.current.unmet.some((u) => /TOF ratio/.test(u)));
    assert.equal(runner.approve('extubate').ok, false);
    assert.equal(sim.state.airway.secured, true);
    assert.ok(sim.state.log.some((e) => e.kind === 'auto' && /Extubate: conditions not met after 30 min — .*TOF ratio/.test(e.message)));
    assertNoRunnerOverrides(c);
  });

  // ---------------------------------------------------------------- pauses
  function toSurgery(c) {
    c.runner.start();
    for (let i = 0; i < 3000 && !c.runner.history.some((h) => h.id === 'start_surgery'); i++) {
      if (c.runner.state === 'paused') { c.userResolves(); continue; }
      c.sim.step(1); c.runner.tick();
    }
    assert.ok(c.runner.history.some((h) => h.id === 'start_surgery'));
  }

  test('hemorrhage → MAP < 60 → pause with a message; the runner never resumes the hold or acknowledges', () => {
    const c = setup('ga_elderly_cad_ckd');
    toSurgery(c);
    c.asUser(() => c.sim.inject('hemorrhage'));
    for (let i = 0; i < 1800 && c.runner.state === 'running'; i++) { c.sim.step(1); c.runner.tick(); }
    assert.equal(c.runner.state, 'paused');
    assert.match(c.runner.message, /Paused — .*(MAP \d+ < 60|Interlock hold latched)/);
    // the clock keeps running in the engine (UI stops it): the runner stays paused and does nothing
    const idx = c.runner.idx; const nLog = c.sim.state.log.filter((e) => e.kind === 'auto').length;
    for (let i = 0; i < 120; i++) { c.sim.step(1); c.runner.tick(); }
    assert.equal(c.runner.state, 'paused'); assert.equal(c.runner.idx, idx);
    assert.equal(c.sim.state.log.filter((e) => e.kind === 'auto').length, nLog);
    assert.equal(c.sim.state.interlocks.holdLatched, true, 'hold latched (MAP < 60)');
    const blk = c.runner.blockers(false).map((b) => b.kind);
    assert.ok(blk.includes('interlock_hold'));
    const r = c.runner.resume();
    assert.equal(r.ok, false); assert.match(r.message, /Still paused — Interlock hold latched/);
    assert.deepEqual(c.calls.runner.filter((id) => id === 'resume_hold' || id.startsWith('acknowledge:')), []);
    assert.ok(c.sim.state.alarms.some((a) => a.priority === 'high' && !a.acknowledged));
    assert.equal(c.sim.summary().automatic.outcome, 'paused');
  });

  test('a HIGH-priority alarm (SpO2 probe off) pauses; medium alarms do not; resume only after the user acknowledges', () => {
    const c = setup('tiva_mh');
    toSurgery(c);
    // a medium alarm does not pause
    c.sim.alarmMgr.pulse(c.sim.state.tSec, 'test_medium', 'medium', 'test medium alarm');
    c.sim.step(1); c.runner.tick();
    assert.equal(c.runner.state, 'running');
    c.asUser(() => c.sim.inject('spo2_probe_off'));
    for (let i = 0; i < 10 && c.runner.state === 'running'; i++) { c.sim.step(1); c.runner.tick(); }
    assert.equal(c.runner.state, 'paused');
    assert.match(c.runner.message, /HIGH alarm needs a decision: SpO2 probe off/);
    assert.equal(c.sim.state.interlocks.holdLatched, false, 'SpO2 is not an interlock input');
    assert.equal(c.runner.resume().ok, false, 'still blocked while unacknowledged');
    assert.ok(c.sim.state.alarms.find((a) => a.id === 'sensor_fault_spo2' && !a.acknowledged));
    c.asUser(() => c.sim.action('acknowledge:sensor_fault_spo2'));
    assert.equal(c.runner.resume().ok, true);
    assertNoRunnerOverrides(c);
  });

  test('user pause/resume; manual control ends automatic mode (logged); start only from the beginning of a case', () => {
    const c = setup('ga_healthy');
    c.runner.start();
    c.runner.advance(30);
    assert.equal(c.runner.pause().ok, true); assert.equal(c.runner.state, 'paused');
    c.sim.step(1); c.runner.tick(); assert.equal(c.runner.state, 'paused');
    assert.equal(c.runner.resume().ok, true);
    c.runner.advance(200);
    const r = c.runner.takeOver('Bolus propofol');
    assert.ok(r.ok); assert.equal(c.runner.state, 'manual');
    const idx = c.runner.idx;
    for (let i = 0; i < 600; i++) { c.sim.step(1); c.runner.tick(); }
    assert.equal(c.runner.idx, idx, 'nothing automatic after takeover');
    assert.ok(c.sim.state.log.some((e) => e.kind === 'auto' && /AUTO: Automatic demonstration ended — manual control used \(Bolus propofol\)/.test(e.message)));
    const A = c.sim.summary().automatic;
    assert.equal(A.outcome, 'manual'); assert.equal(A.manualControl, 'Bolus propofol');
    assert.equal(c.runner.approve('secure_airway').ok, false);
    // mid-case start is refused
    const late = createAutoRunner({ sim: c.sim, mode: 'full' });
    assert.equal(late.start().ok, false);
    // summary of a case without automatic mode
    const plain = setup('ga_healthy');
    assert.deepEqual(plain.sim.summary().automatic, { used: false });
  });
}
