// Timing review (2026-11): loading → maintenance, induction order, premedication → induction,
// stop-before-end anchors, pre-incision verification, state-gated repeat boluses, timing validator.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REAL, runFor, clinicianResolves } from './helpers.mjs';
import { derivePatient } from '../engine/patient.js';
import { createSimulation } from '../engine/sim.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { buildTemplatePlan, TECHNIQUE_TEMPLATES } from '../engine/templates.js';
import { createAutoRunner, buildSequence } from '../engine/autorun.js';
import { AUTORUN_CONFIG } from '../engine/autorun-config.js';
import { TIMING_CONFIG, PREMED_TO_INDUCTION_MIN_SEC, validatePlanTiming, liveTimingChecks, preIncisionItems, loadingPairs } from '../engine/timing.js';
import { makeSteps, loadingOverlapWarning, checkStep, getDrugById } from '../ui/plan-model.js';

if (REAL) {
  const EX = (id) => derivePatient(EXAMPLE_PATIENTS.find((x) => x.id === id).patient, { library: REAL });
  const sim0 = (p, plan, seed = 1) => createSimulation({ patient: p, plan, seed, library: REAL });
  const DONE = ['completed', 'stopped', 'manual'];
  const T = (k) => TIMING_CONFIG[k].value;
  const firstDose = (sim, pred) => sim.doseLog.find(pred) || null;

  /** Drives a runner like a user would (guided: approve enabled gates; both: clinician resolves clinician-only items). */
  function drive(sim, r, mode, maxSec = 14000, onTick = null) {
    for (let i = 0; i < maxSec && !DONE.includes(r.state); i++) {
      if (r.state === 'paused') { for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`); if (sim.core.holdLatched) sim.action('resume_hold'); clinicianResolves(r); r.resume(); continue; }
      let st = r.status();
      if (mode === 'guided' && st.current && st.current.items && !st.current.enabled) { clinicianResolves(r); st = r.status(); }
      if (mode === 'guided' && st.current && st.current.gate && st.current.enabled) { assert.ok(r.approve(st.current.id).ok); continue; }
      sim.step(1); r.tick(); if (onTick) onTick();
    }
  }

  // ------------------------------------------------------------------ 1. loading → maintenance
  test('T1 mac_dex: dexmedetomidine loading 1 mcg/kg over 10 min at +0:00, maintenance at +10:00 (label: loading, then maintenance)', () => {
    for (const ex of EXAMPLE_PATIENTS) {
      const { plan } = buildTemplatePlan('mac_dex', EX(ex.id), { library: REAL });
      const load = plan.steps.find((s) => s.drugId === 'dexmedetomidine' && s.loading);
      const inf = plan.steps.find((s) => s.drugId === 'dexmedetomidine' && s.kind === 'infusion');
      assert.equal(load.atSec, 0); assert.equal(load.overSec, 600);
      assert.equal(inf.atSec, 600, `${ex.id}: maintenance starts when the loading ends`);
      assert.match(inf.timingRationale.text, /Loading infusion over 10 min, then maintenance \(label\)/); assert.deepEqual([...inf.timingRationale.sources], ['S9']);
      assert.ok(validatePlanTiming(plan, REAL).filter((c) => c.id === 'loading_maintenance').every((c) => c.status === 'pass'));
      // live: the maintenance infusion starts at 10:00 after sedation starts, not before
      const sim = sim0(EX(ex.id), plan); sim.setPhase('sedation'); runFor(sim, 700);
      const infLog = firstDose(sim, (d) => d.drugId === 'dexmedetomidine' && d.kind === 'infusion');
      const loadLog = firstDose(sim, (d) => d.drugId === 'dexmedetomidine' && d.kind === 'bolus');
      assert.equal(infLog.tSec, loadLog.tSec + 600, 'maintenance starts exactly when the loading dose ends (anchored)');
      assert.ok(liveTimingChecks(sim).filter((c) => c.id === 'loading_maintenance').every((c) => c.status === 'pass'));
    }
  });

  test('T2 mac_propofol: propofol initiation 0.5 mg/kg over 5 min at +2:00, maintenance at +7:00 (label: initiation, then maintenance)', () => {
    for (const ex of EXAMPLE_PATIENTS) {
      const { plan } = buildTemplatePlan('mac_propofol', EX(ex.id), { library: REAL });
      const load = plan.steps.find((s) => s.drugId === 'propofol' && s.loading);
      const inf = plan.steps.find((s) => s.drugId === 'propofol' && s.kind === 'infusion');
      assert.equal(load.atSec, 120); assert.equal(load.overSec, 300); assert.equal(inf.atSec, 420, ex.id);
    }
    // the MAC example plan uses the same rule
    const p = EX('obese_osa'); const { plan } = buildPlan(EXAMPLE_PLANS.find((x) => x.id === 'mac_obese_osa'), p, REAL);
    assert.equal(plan.steps.find((s) => s.drugId === 'propofol' && s.kind === 'infusion').atSec, 420);
  });

  test('T3 plan editor: adding a loading regimen schedules maintenance at loading end; an overlap gives a warning (editor + validator)', () => {
    const p = EX('healthy_adult'); const c = { lib: REAL, patient: p, interlocks: false, patientVersion: 1 };
    const { steps } = makeSteps(c, 'dexmedetomidine', 'sedation_moderate', 'sedation', 30);
    assert.equal(steps.length, 2); assert.equal(steps[0].loading, true); assert.equal(steps[0].atSec, 30);
    assert.equal(steps[1].atSec, 630, 'maintenance at loading start + 10 min');
    assert.ok(steps[1].timingRationale && /then maintenance/.test(steps[1].timingRationale.text));
    assert.equal(loadingOverlapWarning(steps[1], steps, getDrugById(REAL, 'dexmedetomidine')), null);
    steps[1].atSec = 30; // user schedules them overlapping
    const w = loadingOverlapWarning(steps[1], steps, getDrugById(REAL, 'dexmedetomidine'));
    assert.match(w, /overlaps its loading dose/); assert.match(w, /set the infusion to \+10:30/);
    assert.ok(checkStep(c, steps[1], steps).warnings.some((x) => /overlaps its loading dose/.test(x)));
    const v = validatePlanTiming({ mode: 'MAC', steps }, REAL).find((x) => x.id === 'loading_maintenance');
    assert.equal(v.status, 'warn'); assert.match(v.message, /overlap by 10:00/);
    assert.equal(loadingPairs(steps).length, 1);
  });

  // ------------------------------------------------------------------ 2. induction order
  test('T4 ga_opioid: fentanyl ≥ 3 min before propofol; lidocaine pretreatment immediately before propofol; rocuronium after loss of consciousness', () => {
    for (const ex of EXAMPLE_PATIENTS) {
      const { plan } = buildTemplatePlan('ga_opioid', EX(ex.id), { library: REAL });
      const at = (id, rk) => plan.steps.find((s) => s.drugId === id && (!rk || s.regimenKey === rk)).atSec;
      assert.ok(at('propofol', 'induction') - at('fentanyl') >= T('OPIOID_LEAD_SEC'), ex.id);
      assert.equal(at('propofol', 'induction') - at('lidocaine', 'pretreatment'), 10);
      assert.ok(at('rocuronium') - at('propofol', 'induction') >= 40, 'after the label hypnosis onset (40 s)');
      const v = validatePlanTiming(plan, REAL);
      for (const id of ['opioid_hypnotic', 'pretreatment', 'nmb_after_hypnotic', 'ponv_dexamethasone', 'ponv_ondansetron', 'reversal', 'antibiotic_window', 'premed_interval']) {
        const x = v.find((y) => y.id === id); assert.ok(x, id); assert.notEqual(x.status, 'warn', `${ex.id} ${id}: ${x.message}`);
      }
    }
    // the GA example plans follow the same spacing (no opioid → hypnotic warning)
    for (const tpl of EXAMPLE_PLANS.filter((x) => x.mode === 'GA')) {
      const { plan } = buildPlan(tpl, EX(tpl.patientId), REAL);
      assert.equal(validatePlanTiming(plan, REAL).find((x) => x.id === 'opioid_hypnotic').status, 'pass', tpl.id);
    }
    assert.equal(TIMING_CONFIG.OPIOID_LEAD_SEC.provenance, 'simulator_convention');
    assert.match(TIMING_CONFIG.OPIOID_LEAD_SEC.rationale, /several minutes \[S13\]/);
    assert.match(REAL.SOURCES.S13.supports, /maximal analgesic and respiratory depressant effect may not be noted for several minutes/);
  });

  // ------------------------------------------------------------------ 3. every template step has a timing rationale
  test('T5 every template step has a timingRationale with sources or an explicit convention provenance; sources exist', () => {
    const PROV = ['label', 'guideline', 'consensus', 'trial', 'simulator convention', 'clinical practice convention (owner)'];
    for (const t of TECHNIQUE_TEMPLATES) for (const s of t.steps) {
      const r = s.timingRationale; const L = `${t.id} ${s.phase} ${s.drugId || s.fluidId} ${s.kind}`;
      assert.ok(r && typeof r.text === 'string' && r.text.length > 20, `${L}: text`);
      assert.ok(PROV.includes(r.provenance), `${L}: provenance ${r.provenance}`);
      assert.ok(r.sources.length > 0 || /convention/.test(r.provenance), `${L}: sources or convention`);
      for (const id of r.sources) assert.ok(REAL.SOURCES[id], `${L}: ${id}`);
      assert.ok(!/(?<!not |un|never )\bvalidated\b|\baccurate\b|closed-loop/i.test(r.text), `${L}: wording`);
    }
    // carried into the built plan (plan editor and timeline show it)
    const { plan } = buildTemplatePlan('ga_opioid', EX('healthy_adult'), { library: REAL });
    assert.ok(plan.steps.every((s) => s.timingRationale), 'every built step keeps its rationale');
    // and listed in the parameter inventory
    const inv = sim0(EX('healthy_adult'), plan).parameterInventory();
    assert.equal(inv.filter((x) => x.component === 'template_timing').length, TECHNIQUE_TEMPLATES.reduce((a, t) => a + t.steps.length, 0));
    assert.equal(inv.filter((x) => x.component === 'timing').length, Object.keys(TIMING_CONFIG).length);
  });

  // ------------------------------------------------------------------ 4. dexmedetomidine stops before the end of surgery
  test('T6 ga_opioid_free: dexmedetomidine stops 15 min before the planned end (full demonstration) / at End surgery (guided); lidocaine infusion after its loading', () => {
    const p = EX('healthy_adult');
    const { plan } = buildTemplatePlan('ga_opioid_free', p, { library: REAL });
    const stop = plan.steps.find((s) => s.kind === 'stop' && s.drugId === 'dexmedetomidine');
    assert.equal(stop.phase, 'maintenance'); assert.equal(stop.beforeEndSec, T('DEX_STOP_BEFORE_END_SEC'));
    assert.equal(validatePlanTiming(plan, REAL).find((x) => x.id === 'stop_before_end').status, 'pass');
    // full demonstration
    const sim = sim0(p, plan); const r = createAutoRunner({ sim, mode: 'full' }); r.start(); drive(sim, r, 'full');
    assert.equal(r.state, 'completed', r.message);
    const ex = sim.executed.get(stop.id);
    const surgStart = r.history.find((h) => h.id === 'start_surgery').tSec;
    assert.equal(ex.tSec, surgStart + AUTORUN_CONFIG.SURGERY_DURATION_SEC.value - T('DEX_STOP_BEFORE_END_SEC'), 'stopped at planned end − 15 min');
    assert.ok(ex.tSec < sim.stim.surgeryEndAt);
    assert.equal(liveTimingChecks(sim).find((x) => x.id === 'stop_before_end').status, 'pass');
    // lidocaine infusion only after its loading dose (anchored across phases)
    const lidoLoad = firstDose(sim, (d) => d.drugId === 'lidocaine' && d.kind === 'bolus');
    const lidoInf = firstDose(sim, (d) => d.drugId === 'lidocaine' && d.kind === 'infusion' && d.rate > 0);
    assert.ok(lidoInf.tSec >= lidoLoad.tSec + lidoLoad.overSec, `lidocaine infusion ${lidoInf.tSec} after loading end ${lidoLoad.tSec + lidoLoad.overSec}`);
    // guided: no planned end → the stop runs when the clinician presses End surgery
    const g = sim0(p, plan); const rg = createAutoRunner({ sim: g, mode: 'guided' }); rg.start();
    let stoppedBeforeEnd = false;
    drive(g, rg, 'guided', 14000, () => { if (g.executed.has(stop.id) && g.stim.surgeryEndAt === null) stoppedBeforeEnd = true; });
    assert.equal(rg.state, 'completed', rg.message);
    assert.equal(stoppedBeforeEnd, false, 'guided: not stopped before End surgery (no planned end)');
    const lag = g.executed.get(stop.id).tSec - g.stim.surgeryEndAt;
    assert.ok(lag >= 0 && lag <= 1, `guided: stopped at End surgery (next simulated second; lag ${lag} s)`);
    // manual: the emergence fallback also stops it if End surgery is never pressed
    const m = sim0(p, plan); m.setPhase('induction'); runFor(m, 300); m.setPhase('maintenance'); runFor(m, 60); m.setPhase('emergence'); runFor(m, 2);
    assert.ok(m.executed.has(stop.id));
    // invalid anchor on a non-stop step never runs
    const bad = sim0(p, { mode: 'GA', steps: [{ id: 'x', phase: 'maintenance', atSec: 0, kind: 'bolus', drugId: 'fentanyl', amount: 25, amountUnit: 'mcg', beforeEndSec: 60 }] });
    assert.match(bad.plan.steps[0].invalid, /beforeEndSec/);
  });

  // ------------------------------------------------------------------ 5. premedication never overlaps induction
  const withPremed = (plan) => ({ ...plan, steps: [{ id: 'pm', phase: 'premed', atSec: 0, order: -1, drugId: 'midazolam', kind: 'bolus', amount: 1, amountUnit: 'mg', overSec: 120, regimenKey: 'premed' }, ...plan.steps] });
  for (const mode of ['guided', 'full']) {
    test(`T7 premedication midazolam never within the minimum interval of any induction/sedation drug — ${mode}, all templates × all example patients`, () => {
      let checked = 0;
      for (const t of TECHNIQUE_TEMPLATES) for (const ex of EXAMPLE_PATIENTS) {
        const p = EX(ex.id); let { plan } = buildTemplatePlan(t.id, p, { library: REAL });
        if (!plan.steps.some((s) => s.phase === 'premed' && s.kind === 'bolus')) plan = withPremed(plan); // MAC / opioid-free: add one
        const sim = sim0(p, plan); const r = createAutoRunner({ sim, mode }); r.start(); drive(sim, r, mode);
        const pre = sim.plan.steps.filter((s) => s.phase === 'premed' && s.kind === 'bolus' && sim.executed.has(s.id));
        if (!pre.length) continue;
        const end = Math.max(...pre.map((s) => sim.executed.get(s.id).tSec + (s.overSec || 0)));
        const first = firstDose(sim, (d) => d.phase === 'induction' || d.phase === 'sedation');
        assert.ok(first, `${t.id}/${ex.id}: an induction/sedation drug was given`);
        const min = t.mode === 'GA' ? PREMED_TO_INDUCTION_MIN_SEC : PREMED_TO_INDUCTION_MIN_SEC - T('PREOXYGENATION_SEC');
        assert.ok(first.tSec - end >= min - 1e-9, `${t.id}/${ex.id}: first ${first.drugId} ${first.tSec - end} s after premedication ended (min ${min})`);
        assert.equal(liveTimingChecks(sim).find((x) => x.id === 'premed_interval').status, 'pass');
        checked++;
      }
      assert.equal(checked, TECHNIQUE_TEMPLATES.length * EXAMPLE_PATIENTS.length);
    });
  }

  test('T8 engine guard: induction drugs never start while a premedication bolus is pending or running (manual mode)', () => {
    const p = EX('healthy_adult'); const { plan } = buildPlan(EXAMPLE_PLANS.find((x) => x.id === 'ga_healthy'), p, REAL);
    const sim = sim0(p, plan); runFor(sim, 10); sim.setPhase('induction'); // clinician starts induction too early
    runFor(sim, 30);
    const fent = sim.planStatus().find((s) => s.drugId === 'fentanyl');
    assert.equal(fent.status, 'pending'); assert.match(fent.waiting, /premedication bolus has finished/);
    runFor(sim, 200);
    const f = firstDose(sim, (d) => d.drugId === 'fentanyl'); const mid = firstDose(sim, (d) => d.drugId === 'midazolam');
    assert.equal(f.tSec, mid.tSec + 120, 'fentanyl at the end of the 2-min midazolam injection');
    const c = liveTimingChecks(sim).find((x) => x.id === 'premed_interval');
    assert.equal(c.status, 'warn', 'early induction is flagged'); assert.match(c.message, /0:00 after the premedication ended \(minimum 10:00\)/);
  });

  // ------------------------------------------------------------------ 6. gate countdowns
  test('T9 guided gates: Transfer to OR and Start induction stay disabled with a countdown until the interval has elapsed', () => {
    const p = EX('healthy_adult'); const { plan } = buildTemplatePlan('ga_opioid', p, { library: REAL });
    const sim = sim0(p, plan); const r = createAutoRunner({ sim, mode: 'guided' }); r.start();
    sim.step(1); r.tick(); // premedication midazolam starts (first simulated second), given over 2 min (label: over at least 2 min)
    const preEnd = sim.doseLog.find((d) => d.drugId === 'midazolam').tSec + 120;
    while (sim.state.tSec < preEnd + T('PREMED_TO_TRANSFER_SEC') - 1) { sim.step(1); r.tick(); }
    let st = r.status();
    assert.equal(st.current.id, 'transfer_to_or'); assert.equal(st.current.enabled, false); assert.equal(st.current.countdownSec, 1);
    assert.match(st.current.unmet[0], /transfer 5 min after the premedication ended — 1 s to go/);
    assert.equal(r.approve('transfer_to_or').ok, false);
    sim.step(1); r.tick(); st = r.status();
    assert.equal(st.current.enabled, true); assert.equal(st.current.countdownSec, 0);
    assert.ok(r.approve('transfer_to_or').ok);
    // OR setup (automatic), then preoxygenation; induction gate counts down
    for (let i = 0; i < T('OR_SETUP_SEC'); i++) { sim.step(1); r.tick(); }
    assert.equal(r.current.id, 'start_induction'); assert.equal(sim.state.airway.fio2, 1, 'preoxygenation FiO2 1.0');
    st = r.status(); assert.equal(st.current.enabled, false); assert.ok(st.current.countdownSec > 0 && st.current.countdownSec <= T('PREOXYGENATION_SEC'));
    for (let i = 0; i < T('PREOXYGENATION_SEC') - 1; i++) { sim.step(1); r.tick(); }
    assert.equal(r.status().current.enabled, false);
    sim.step(1); r.tick();
    assert.equal(r.status().current.enabled, true);
    assert.equal(sim.state.tSec - preEnd, PREMED_TO_INDUCTION_MIN_SEC, 'induction possible exactly at the minimum interval');
    assert.deepEqual(buildSequence('GA').slice(0, 3).map((s) => s.id), ['transfer_to_or', 'preoxygenate', 'start_induction']);
  });

  // ------------------------------------------------------------------ 7. pre-incision verification: one test per item
  function atIncisionGate() {
    const p = EX('healthy_adult'); const { plan } = buildTemplatePlan('ga_opioid', p, { library: REAL });
    const sim = sim0(p, plan); const r = createAutoRunner({ sim, mode: 'guided' }); r.start();
    for (let i = 0; i < 6000 && !(r.current && r.current.id === 'start_surgery'); i++) {
      if (r.state === 'paused') { for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`); if (sim.core.holdLatched) sim.action('resume_hold'); r.resume(); continue; }
      const st = r.status(); if (st.current.enabled) { r.approve(st.current.id); continue; }
      sim.step(1); r.tick();
    }
    assert.equal(r.current.id, 'start_surgery');
    idle(sim, r, 120);
    return { sim, r };
  }
  /** Steps time; the user resolves interlock holds / HIGH alarms (never clinician-only items). */
  function idle(sim, r, n) {
    for (let i = 0; i < n; i++) {
      sim.step(1); r.tick();
      if (r.state === 'paused') { for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`); if (sim.core.holdLatched) sim.action('resume_hold'); r.resume(); }
    }
  }
  const gateOpen = (r) => r.status().current.enabled;
  const item = (r, id) => r.status().current.items.find((x) => x.id === id);

  test('T10 pre-incision gate: WHO time out missing keeps it closed; only the clinician confirms it (sourced S54)', () => {
    const { sim, r } = atIncisionGate();
    assert.equal(item(r, 'time_out').met, false); assert.equal(item(r, 'time_out').clinician, true); assert.deepEqual(item(r, 'time_out').sources, ['S54']);
    assert.equal(gateOpen(r), false); assert.equal(r.approve('start_surgery').ok, false);
    idle(sim, r, 300);
    assert.equal(sim.state.periop.timeOut, null, 'never confirmed automatically'); assert.equal(sim.stim.surgeryStartAt, null);
    clinicianResolves(r);
    assert.ok(sim.state.periop.timeOut); assert.equal(gateOpen(r), true, JSON.stringify(r.status().current.unmet));
    assert.ok(sim.state.log.some((e) => /time out confirmed by the clinician/.test(e.message)));
  });

  const breakItem = (name, mutate, restore, id) => test(`T11 pre-incision gate: ${name} missing keeps it closed`, () => {
    const { sim, r } = atIncisionGate(); clinicianResolves(r);
    assert.equal(gateOpen(r), true, 'all items met');
    const saved = mutate(sim);
    assert.equal(item(r, id).met, false, `${id} unmet`); assert.equal(gateOpen(r), false); assert.equal(r.approve('start_surgery').ok, false);
    restore(sim, saved); assert.equal(gateOpen(r), true);
  });
  breakItem('airway/ventilation', (s) => { s.state.airway.ventilated = false; }, (s) => { s.state.airway.ventilated = true; }, 'airway');
  breakItem('depth index above the GA band', (s) => { const v = s.state.vitals.depthIndex; s.state.vitals.depthIndex = 70; return v; }, (s, v) => { s.state.vitals.depthIndex = v; }, 'depth');
  breakItem('depth index below the GA band without acknowledgement', (s) => { const v = [s.state.vitals.depthIndex, s.state.periop.depthAck]; s.state.vitals.depthIndex = 30; s.state.periop.depthAck = null; return v; }, (s, v) => { s.state.vitals.depthIndex = v[0]; s.state.periop.depthAck = v[1]; }, 'depth');
  breakItem('analgesia', (s) => { const d = s.doseLog; s.doseLog = d.filter((x) => x.drugId !== 'fentanyl'); return d; }, (s, d) => { s.doseLog = d; }, 'analgesia');
  breakItem('neuromuscular block (TOF count > 2)', (s) => { const v = s.state.vitals.tofCount; s.state.vitals.tofCount = 4; return v; }, (s, v) => { s.state.vitals.tofCount = v; }, 'nmb');
  breakItem('antibiotic in window', (s) => { const d = s.state.prophylaxis.doses; s.state.prophylaxis.doses = []; return d; }, (s, d) => { s.state.prophylaxis.doses = d; }, 'antibiotic');

  test('T12 pre-incision items: GA band from B-Unaware/BAG-RECALL (S52, S53); an index below the band needs the clinician; MAC items include the time out', () => {
    assert.deepEqual([...TIMING_CONFIG.GA_DEPTH_BAND.value], [40, 60]); assert.deepEqual([...TIMING_CONFIG.GA_DEPTH_BAND.sourceIds], ['S52', 'S53']);
    for (const id of ['S52', 'S53', 'S54']) assert.ok(REAL.SOURCES[id] && REAL.SOURCES[id].verifiedVia, id);
    const { sim, r } = atIncisionGate(); r.clinicianAction('confirm_time_out');
    sim.state.vitals.depthIndex = 35;
    const d = item(r, 'depth'); assert.equal(d.met, false); assert.equal(d.clinician, true); assert.match(d.detail, /clinician must acknowledge/);
    assert.ok(r.clinicianAction('acknowledge_depth_below_band').ok);
    assert.equal(item(r, 'depth').met, true);
    const mac = preIncisionItems(sim, { planMode: 'MAC', sedationCheck: { met: true, detail: 'moderate' } }).map((x) => x.id);
    assert.ok(mac.includes('time_out') && mac.includes('sedation') && !mac.includes('airway'));
  });

  test('T13 full demonstration never self-confirms: it pauses for the time out and surgery never starts without the clinician', () => {
    const p = EX('healthy_adult'); const { plan } = buildTemplatePlan('ga_opioid', p, { library: REAL });
    const sim = sim0(p, plan); const r = createAutoRunner({ sim, mode: 'full' }); r.start();
    let timeOutPause = null;
    for (let i = 0; i < 6000 && !DONE.includes(r.state); i++) {
      if (r.state === 'paused') {
        const tp = r.pauseReasons.find((x) => x.item === 'time_out');
        if (tp) { timeOutPause = tp; break; }
        for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`); if (sim.core.holdLatched) sim.action('resume_hold'); r.resume(); continue;
      }
      sim.step(1); r.tick();
    }
    assert.ok(timeOutPause, 'paused for the WHO time out'); assert.match(timeOutPause.message, /never confirms it/);
    assert.equal(r.resume().ok, false, 'resume refused until the clinician confirms');
    for (let i = 0; i < 600; i++) { sim.step(1); r.tick(); }
    assert.equal(sim.state.periop.timeOut, null); assert.equal(sim.stim.surgeryStartAt, null);
    assert.equal(r.current.id, 'start_surgery');
  });

  // ------------------------------------------------------------------ 8. state-gated repeat boluses
  test('T14 rocuronium top-up is held until TOF count ≥ 3 (label: 25% recovery of control T1 = 3 twitches); manual top-up warned', () => {
    const p = EX('healthy_adult');
    const { plan } = buildPlan({ mode: 'GA', steps: [
      { phase: 'induction', atSec: 0, drugId: 'propofol', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'induction', atSec: 60, drugId: 'rocuronium', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'maintenance', atSec: 0, drugId: 'propofol', regimenKey: 'maintenance', kind: 'infusion' },
      { phase: 'maintenance', atSec: 60, drugId: 'rocuronium', regimenKey: 'maintenance', kind: 'bolus' },
    ] }, p, REAL);
    const sim = sim0(p, plan); sim.setPhase('induction'); runFor(sim, 200); sim.action('secure_airway'); sim.action('start_ventilation'); sim.setPhase('maintenance');
    runFor(sim, 120);
    const top = sim.planStatus().find((s) => s.drugId === 'rocuronium' && s.phase === 'maintenance');
    assert.equal(top.status, 'pending'); assert.match(top.waiting, /TOF count ≥ 3/);
    assert.ok(sim.state.vitals.tofCount < 3);
    let i = 0; for (; i < 7200 && !sim.executed.has(top.id); i++) sim.step(1);
    const ex = firstDose(sim, (d) => d.drugId === 'rocuronium' && d.phase === 'maintenance');
    assert.ok(ex && ex.tofCount >= 3, `top-up given at TOF count ${ex && ex.tofCount}`);
    assert.ok(liveTimingChecks(sim).some((c) => c.id === 'repeat_bolus' && /held/.test(c.message)));
    assert.equal(validatePlanTiming(plan, REAL).find((c) => c.label === 'Rocuronium top-up').status, 'pass');
    // manual top-up at deep block: allowed (clinician's choice) but warned and recorded
    const m = sim0(p, plan); m.administer({ drugId: 'rocuronium', kind: 'bolus', amount: 40, amountUnit: 'mg' }); runFor(m, 120);
    const w = m.administer({ drugId: 'rocuronium', kind: 'bolus', amount: 10, amountUnit: 'mg' });
    assert.ok(w.ok && w.warnings.some((x) => /Repeat-bolus condition not met: rocuronium top-up waits for TOF count ≥ 3.*\[S12\]/.test(x)), w.warnings.join(' | '));
    assert.equal(liveTimingChecks(m).find((c) => c.id === 'repeat_bolus').status, 'warn');
  });

  test('T15 repeat midazolam waits 4 min (label: over ≥ 2 min, then ≥ 2 min to evaluate)', () => {
    const p = EX('healthy_adult');
    const { plan } = buildPlan({ mode: 'MAC', sedationTarget: 'moderate', steps: [
      { phase: 'sedation', atSec: 0, drugId: 'midazolam', regimenKey: 'sedation_moderate', kind: 'bolus' },
      { phase: 'sedation', atSec: 60, drugId: 'midazolam', regimenKey: 'sedation_moderate', kind: 'bolus' },
    ] }, p, REAL);
    assert.equal(validatePlanTiming(plan, REAL).find((c) => c.id === 'repeat_bolus').status, 'warn');
    const sim = sim0(p, plan); sim.setPhase('sedation'); runFor(sim, 300);
    const doses = sim.doseLog.filter((d) => d.drugId === 'midazolam');
    assert.equal(doses.length, 2); assert.equal(doses[1].tSec - doses[0].tSec, T('MIDAZOLAM_REPEAT_MIN_SEC'));
  });

  // ------------------------------------------------------------------ 9. the validator flags each violation type
  test('T16 plan timing validator: a crafted bad plan triggers every plan-level warning type', () => {
    const p = EX('healthy_adult');
    const { plan } = buildPlan({ mode: 'GA', steps: [
      { phase: 'premed', atSec: 0, drugId: 'midazolam', regimenKey: 'premed', kind: 'bolus' },
      { phase: 'induction', atSec: 0, drugId: 'fentanyl', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'induction', atSec: 30, drugId: 'propofol', regimenKey: 'induction', kind: 'bolus' }, // opioid only 30 s before
      { phase: 'induction', atSec: 0, drugId: 'lidocaine', regimenKey: 'pretreatment', kind: 'bolus' }, // not immediately before
      { phase: 'induction', atSec: 40, drugId: 'rocuronium', regimenKey: 'induction', kind: 'bolus' }, // 10 s after the hypnotic
      { phase: 'maintenance', atSec: 0, drugId: 'dexmedetomidine', regimenKey: 'sedation_moderate', kind: 'infusion' },
      { phase: 'maintenance', atSec: 0, drugId: 'sevoflurane', regimenKey: 'maintenance', kind: 'inhaled', dial: 'mac1' },
      { phase: 'maintenance', atSec: 0, drugId: 'ketamine', kind: 'stop', beforeEndSec: 600 }, // nothing to stop
      { phase: 'maintenance', atSec: 0, drugId: 'midazolam', regimenKey: 'premed', kind: 'bolus' },
      { phase: 'maintenance', atSec: 30, drugId: 'midazolam', regimenKey: 'premed', kind: 'bolus' },
      { phase: 'maintenance', atSec: 60, drugId: 'sugammadex', regimenKey: 'emergence', kind: 'bolus' }, // reversal during maintenance
      { phase: 'emergence', atSec: 0, drugId: 'dexamethasone', regimenKey: 'induction', kind: 'bolus' }, // not at induction
      { phase: 'induction', atSec: 0, drugId: 'ondansetron', regimenKey: 'emergence', kind: 'bolus' }, // not at end of surgery
    ] }, p, REAL);
    plan.prophylaxisIndicated = true; // no antibiotic planned
    // the dexmedetomidine loading + infusion are scheduled correctly by buildPlan: make them overlap like a user would
    plan.steps.find((s) => s.drugId === 'dexmedetomidine' && s.kind === 'infusion').atSec = 0;
    const v = validatePlanTiming(plan, REAL);
    const warn = new Set(v.filter((x) => x.status === 'warn').map((x) => x.id));
    for (const id of ['loading_maintenance', 'opioid_hypnotic', 'pretreatment', 'nmb_after_hypnotic', 'antibiotic_window', 'ponv_dexamethasone', 'ponv_ondansetron', 'reversal', 'repeat_bolus', 'stop_before_end']) assert.ok(warn.has(id), `${id} flagged: ${[...warn].join(', ')}`);
    for (const x of v) assert.ok(x.sources.length > 0 || /convention/.test(x.provenance) || x.status === 'info', `${x.id}: source or convention`);
  });
}

test('T17 timing config: one frozen block; every rule has value, unit, rationale, provenance; conventions carry no sourceIds', () => {
  assert.ok(Object.isFrozen(TIMING_CONFIG));
  for (const [k, x] of Object.entries(TIMING_CONFIG)) {
    assert.ok(Object.isFrozen(x), k); assert.ok(x.value !== undefined && x.value !== null, k);
    assert.ok(typeof x.unit === 'string' && x.unit, k); assert.ok(x.rationale.length > 30, k);
    assert.ok(['fda_label', 'guideline', 'trial_or_physiology_study', 'simulator_convention', 'clinical_practice_convention_owner'].includes(x.provenance), `${k}: ${x.provenance}`);
    if (x.provenance === 'simulator_convention') assert.equal(x.sourceIds.length, 0, `${k}: convention`);
    else assert.ok(x.sourceIds.length > 0, `${k}: sourced`);
    if (REAL) for (const id of x.sourceIds) assert.ok(REAL.SOURCES[id], `${k}: ${id}`);
  }
  assert.equal(PREMED_TO_INDUCTION_MIN_SEC, 600);
  assert.equal(TIMING_CONFIG.PREMED_TO_TRANSFER_SEC.provenance, 'clinical_practice_convention_owner');
});

