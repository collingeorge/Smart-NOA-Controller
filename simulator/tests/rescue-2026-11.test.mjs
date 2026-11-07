// Advisory haemodynamic rescue (engine/rescue.js, engine/rescue-config.js) and the 2026-11 guided/automatic
// fixes (paused-banner details, sedation below the plan target). EDUCATIONAL SIMULATION — not a medical device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REAL, basePatient, clinicianResolves } from './helpers.mjs';
import { derivePatient } from '../engine/patient.js';
import { createSimulation, ALARM_THRESHOLDS } from '../engine/sim.js';
import { recommend } from '../engine/dosing.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan, EXAMPLE_TIMING_FALLBACK } from '../data/scenarios.js';
import { evaluateRescue, createRescueAdvisor, rescueValue, RESCUE_CONFIG, ADVISORY_DISCLAIMER } from '../engine/rescue.js';
import { HYPOTENSION_CHECKLIST } from '../engine/rescue-config.js';
import { PROVENANCE } from '../engine/inventory.js';
import { createAutoRunner, pauseAction } from '../engine/autorun.js';
import { AUTORUN_CONFIG } from '../engine/autorun-config.js';

const VASO = new Set(REAL.DRUGS.filter((d) => d.cls === 'vasopressor').map((d) => d.id));
const DONE = ['completed', 'stopped', 'manual'];
const P = (id) => derivePatient(EXAMPLE_PATIENTS.find((x) => x.id === id).patient, { library: REAL });
const fresh = (over = {}) => createSimulation({ patient: derivePatient(basePatient(over), { library: REAL }), library: REAL, seed: 3 });
/** Sets the displayed vitals directly (evaluateRescue is a pure read of the state). */
const setV = (sim, v) => { Object.assign(sim.state.vitals, v); return sim; };

test('R1 advisory triggers at MAP < 65 (the reused MAP_LOW alarm threshold), not at MAP ≥ 65', () => {
  assert.equal(rescueValue('TRIGGER_MAP_BELOW'), ALARM_THRESHOLDS.MAP_LOW);
  assert.equal(rescueValue('EPISODE_CLEAR_MAP_AT_OR_ABOVE'), ALARM_THRESHOLDS.MAP_LOW_CLEAR);
  assert.equal(rescueValue('HIGH_MAP_ADVICE_ABOVE'), ALARM_THRESHOLDS.MAP_HIGH);
  const sim = fresh();
  for (const map of [65, 66, 80, 120]) { const v = evaluateRescue(setV(sim, { map, hr: 80 })); assert.equal(v.suggestion, null, `MAP ${map}`); assert.notEqual(v.kind, 'hypotension'); }
  const v = evaluateRescue(setV(sim, { map: 64, hr: 80 }));
  assert.equal(v.kind, 'hypotension'); assert.ok(v.suggestion); assert.equal(v.disclaimer, ADVISORY_DISCLAIMER);
  assert.match(ADVISORY_DISCLAIMER, /Advisory only — the simulator never gives a vasopressor by itself\./);
  assert.deepEqual(v.checklist, [...HYPOTENSION_CHECKLIST]);
  assert.ok(v.checklist.every((x) => !/\d+\s*(mg|mcg)\b/.test(x)), 'checklist has no doses');
});

test('R2 agent selection by HR (simulator convention): ephedrine when HR < 60, phenylephrine otherwise; epinephrine never', () => {
  assert.equal(RESCUE_CONFIG.AGENT_SELECTION_HR_BELOW.provenance, 'simulator_convention');
  assert.equal(RESCUE_CONFIG.AGENT_SELECTION_HR_BELOW.sourceIds.length, 0);
  const sim = fresh();
  for (const [hr, id] of [[40, 'ephedrine'], [59, 'ephedrine'], [60, 'phenylephrine'], [75, 'phenylephrine'], [130, 'phenylephrine']]) {
    const v = evaluateRescue(setV(sim, { map: 58, hr }));
    assert.equal(v.suggestion.drugId, id, `HR ${hr}`);
    assert.match(v.suggestion.selection, /simulator convention/);
  }
  assert.ok(!RESCUE_CONFIG.RESCUE_AGENTS.value.includes('epinephrine'));
});

test('R3 the dose comes from the drug-library rescue regimen (recommend()) for every example patient', () => {
  for (const ex of EXAMPLE_PATIENTS) {
    const p = P(ex.id); const sim = createSimulation({ patient: p, library: REAL });
    for (const hr of [50, 90]) {
      const v = evaluateRescue(setV(sim, { map: 60, hr }));
      const rec = recommend(p, 'rescue', v.suggestion.drugId, REAL);
      assert.equal(v.suggestion.amount, rec.dose.value, `${ex.id} ${v.suggestion.drugId}`);
      assert.equal(v.suggestion.unit, rec.dose.unit);
      assert.deepEqual(v.suggestion.range, rec.dose.range);
      assert.deepEqual(v.suggestion.sources, rec.sources);
      assert.ok(v.suggestion.sources.length > 0);
    }
  }
});

test('R4 repeat interval: suppressed with "reassess — next dose allowed in mm:ss" until the interval since the last vasopressor bolus has passed', () => {
  assert.equal(RESCUE_CONFIG.PHENYLEPHRINE_REPEAT_MIN_SEC.value, 60); assert.equal(RESCUE_CONFIG.PHENYLEPHRINE_REPEAT_MIN_SEC.provenance, 'fda_label');
  assert.equal(RESCUE_CONFIG.EPHEDRINE_REPEAT_MIN_SEC.provenance, 'simulator_convention');
  for (const [hr, id, gap] of [[90, 'phenylephrine', 60], [50, 'ephedrine', 120]]) {
    const sim = fresh(); const adv = createRescueAdvisor(sim);
    setV(sim, { map: 58, hr }); const v0 = adv.update();
    assert.equal(v0.suggestion.drugId, id);
    const r = adv.accept(v0.entry.id); assert.ok(r.ok, r.message);
    const t0 = sim.state.tSec;
    for (let k = 1; k <= gap + 1; k++) {
      sim.state.tSec = t0 + k; setV(sim, { map: 58, hr });
      const v = evaluateRescue(sim);
      if (k < gap) { assert.equal(v.suggestion, null, `${id} +${k}`); assert.equal(v.suppressed.reason, 'interval'); assert.match(v.suppressed.message, /^Reassess — next dose allowed in \d\d:\d\d/); assert.equal(v.suppressed.remainingSec, gap - k); }
      else assert.ok(v.suggestion, `${id} +${k}`);
    }
  }
  // a manual (non-advisory) vasopressor bolus also starts the interval
  const sim = fresh(); sim.administer({ drugId: 'phenylephrine', kind: 'bolus', amount: 40, amountUnit: 'mcg' });
  assert.equal(evaluateRescue(setV(sim, { map: 58, hr: 90 })).suppressed.reason, 'interval');
});

test('R5 cumulative label maximum: dose capped to the remaining allowance; below the regimen minimum → "label maximum reached"', () => {
  const sim = fresh();
  sim.bolusGiven.phenylephrine = 150; let v = evaluateRescue(setV(sim, { map: 58, hr: 90 }));
  assert.equal(v.suggestion.amount, 40);
  sim.bolusGiven.phenylephrine = 170; v = evaluateRescue(sim);
  assert.equal(v.suggestion, null); assert.equal(v.suppressed.reason, 'cumulative');
  assert.match(v.suppressed.message, /label maximum reached .* consider other causes \/ escalate; not simulated/);
  sim.state.drugs.ephedrine.cumulative = 43; v = evaluateRescue(setV(sim, { map: 58, hr: 50 }));
  assert.equal(v.suggestion.amount, 5);
  sim.state.drugs.ephedrine.cumulative = 46; v = evaluateRescue(sim);
  assert.equal(v.suppressed.reason, 'cumulative');
  // through the advisor: five accepted phenylephrine boluses = 200 mcg, then maximum reached
  const s2 = fresh(); const a = createRescueAdvisor(s2); let given = 0;
  for (let i = 0; i < 2000 && given < 6; i++) {
    setV(s2, { map: 58, hr: 90 }); const w = a.update();
    if (w.canAccept) { assert.ok(a.accept(w.entry.id).ok); given++; }
    s2.state.tSec += 1;
  }
  assert.equal(given, 5); assert.equal(s2.bolusGiven.phenylephrine, 200);
  setV(s2, { map: 58, hr: 90 }); assert.equal(a.update().suppressed.reason, 'cumulative');
});

test('R6 MAP > 120: advisory text only — no drug and no dose suggested', () => {
  const sim = fresh(); const adv = createRescueAdvisor(sim);
  setV(sim, { map: 135, hr: 90 }); const v = adv.update();
  assert.equal(v.kind, 'hypertension'); assert.equal(v.suggestion, null); assert.equal(v.canAccept, false); assert.ok(v.canDismiss);
  assert.ok(v.checklist.some((x) => /depth/i.test(x)) && v.checklist.some((x) => /sensor/i.test(x)));
  assert.ok(v.checklist.every((x) => !/\d+\s*(mg|mcg)\b/.test(x)));
  assert.equal(adv.record().entries[0].drugId, null); assert.equal(adv.record().entries[0].amount, null);
  assert.ok(!adv.accept(v.entry.id).ok);
  assert.equal(sim.doseLog.length, 0);
});

test('R7 suppression: sensor fault, anaphylaxis scenario (epinephrine stays manual)', () => {
  const sim = fresh();
  sim.state.sensors.map = 'fault'; let v = evaluateRescue(setV(sim, { map: 50, hr: 90 }));
  assert.equal(v.kind, 'sensor'); assert.equal(v.suggestion, null);
  sim.state.sensors.map = 'ok'; sim.state.sensors.hr = 'fault'; v = evaluateRescue(sim);
  assert.equal(v.suggestion, null); assert.equal(v.suppressed.reason, 'sensor');
  sim.state.sensors.hr = 'ok'; sim.inject('anaphylaxis_hypotension'); sim.step(1); v = evaluateRescue(setV(sim, { map: 50, hr: 110 }));
  assert.equal(v.suggestion, null); assert.equal(v.suppressed.reason, 'anaphylaxis'); assert.match(v.suppressed.message, /Epinephrine .* manual/);
});

test('R8 accept gives exactly the suggested bolus (source advisory) and logs "ADVISORY accepted"; dismiss is logged and hides it for the episode', () => {
  const sim = fresh(); const adv = createRescueAdvisor(sim);
  setV(sim, { map: 58, hr: 90 }); const v = adv.update();
  assert.ok(sim.state.log.some((l) => l.kind === 'advisory' && /^ADVISORY shown: ADV-1/.test(l.message)));
  assert.equal(sim.doseLog.length, 0, 'showing never doses');
  const r = adv.accept(v.entry.id); assert.ok(r.ok);
  assert.ok(sim.state.log.some((l) => /^ADVISORY accepted by the clinician: ADV-1 — Phenylephrine 40 mcg IV bolus \(clinician-approved\)/.test(l.message)));
  const d = sim.doseLog.filter((x) => VASO.has(x.drugId));
  assert.equal(d.length, 1); assert.equal(d[0].source, 'advisory'); assert.equal(d[0].amount, 40); assert.equal(sim.state.drugs.phenylephrine.cumulative, 40);
  assert.ok(!adv.accept(v.entry.id).ok, 'cannot accept twice');
  // dismiss
  const s2 = fresh(); const a2 = createRescueAdvisor(s2);
  setV(s2, { map: 58, hr: 90 }); const w = a2.update();
  assert.ok(a2.dismiss(w.entry.id).ok);
  assert.ok(s2.state.log.some((l) => /^ADVISORY dismissed by the clinician: ADV-1/.test(l.message)));
  s2.state.tSec += 5; setV(s2, { map: 57, hr: 90 }); const w2 = a2.update();
  assert.equal(w2.dismissed, true); assert.equal(w2.canAccept, false);
  setV(s2, { map: 70, hr: 90 }); a2.update(); setV(s2, { map: 60, hr: 90 }); const w3 = a2.update();
  assert.ok(w3.canAccept, 'new episode after MAP recovered'); assert.equal(w3.entry.id, 'ADV-2');
  const rec = a2.record(); assert.equal(rec.shown, 2); assert.equal(rec.dismissed, 1); assert.equal(rec.accepted, 0);
  assert.equal(s2.doseLog.length, 0);
  assert.deepEqual(s2.summary().advisories.entries.map((x) => x.status), ['dismissed', 'shown']);
});

/** Runs an example case with an advisor and a haemorrhage; never accepts. Returns { sim, adv, runner }. */
function runCase(tplId, mode, { dropVaso = true, seed = 1 } = {}) {
  const tpl = EXAMPLE_PLANS.find((x) => x.id === tplId);
  const p = P(tpl.patientId); const { plan } = buildPlan(tpl, p, REAL);
  if (dropVaso) plan.steps = plan.steps.filter((s) => !VASO.has(s.drugId));
  const sim = createSimulation({ patient: p, plan, library: REAL, seed });
  const adv = createRescueAdvisor(sim);
  const runner = mode === 'manual' ? null : createAutoRunner({ sim, mode });
  if (runner) assert.ok(runner.start().ok);
  let injected = false;
  for (let i = 0; i < 9000; i++) {
    if (!injected && sim.state.tSec >= 900) { sim.inject('hemorrhage'); injected = true; }
    if (runner) {
      if (DONE.includes(runner.state)) break;
      if (runner.state === 'paused') {
        for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`);
        if (sim.core.holdLatched) { sim.action('acknowledge_hold'); sim.action('resume_hold'); }
        clinicianResolves(runner);
        if (runner.status().pauseDetails.some((d) => d.item === 'sedation')) runner.clinicianAction('acknowledge_sedation_below_target');
        runner.resume(); continue;
      }
      const st = runner.status();
      if (mode === 'guided' && st.current && st.current.items && !st.current.enabled) { clinicianResolves(runner); if (st.current.items.some((x) => x.id === 'sedation' && x.clinician)) runner.clinicianAction('acknowledge_sedation_below_target'); }
      if (mode === 'guided' && st.current && st.current.gate && runner.status().current.enabled) { runner.approve(st.current.id); continue; }
      sim.step(1); runner.tick();
    } else {
      if (i === 0) sim.setPhase(tpl.mode === 'MAC' ? 'sedation' : 'induction');
      if (sim.state.tSec > 2400) break;
      sim.step(1);
    }
  }
  return { sim, adv, runner };
}

test('R9 never auto-administers: manual, guided and full-auto, every example plan, induced haemorrhage — no vasopressor dose without an explicit accept', () => {
  let shownTotal = 0;
  for (const tpl of EXAMPLE_PLANS) for (const mode of ['manual', 'guided', 'full']) {
    const { sim, adv } = runCase(tpl.id, mode);
    const rec = adv.record(); shownTotal += rec.shown;
    assert.equal(rec.accepted, 0, `${tpl.id}/${mode}`);
    assert.deepEqual(sim.doseLog.filter((d) => VASO.has(d.drugId)), [], `${tpl.id}/${mode}: vasopressor given without accept`);
    assert.ok(!sim.state.log.some((l) => /ADVISORY accepted/.test(l.message)), `${tpl.id}/${mode}`);
    assert.ok(!sim.state.log.some((l) => l.kind === 'advisory' && /acknowledge|resume_hold/i.test(l.message)));
  }
  assert.ok(shownTotal > 0, 'the haemorrhage produced advisories');
  // a plan that includes its own phenylephrine step: every vasopressor dose is the plan's
  const { sim } = runCase('ga_elderly_cad_ckd', 'full', { dropVaso: false });
  assert.ok(sim.doseLog.filter((d) => VASO.has(d.drugId)).every((d) => d.source === 'plan'));
});

test('R10 determinism: same seed → identical advisory record and log', () => {
  const a = runCase('ga_healthy', 'full'); const b = runCase('ga_healthy', 'full');
  assert.deepEqual(a.adv.record(), b.adv.record());
  assert.deepEqual(a.sim.state.log, b.sim.state.log);
});

test('R11 config: provenance vocabulary, conventions unsourced, label entries sourced, inventory + summary', () => {
  for (const [k, x] of Object.entries(RESCUE_CONFIG)) {
    assert.ok(PROVENANCE.includes(x.provenance), k);
    assert.ok(typeof x.rationale === 'string' && x.rationale.length > 20, k);
    if (x.provenance === 'simulator_convention') assert.equal(x.sourceIds.length, 0, k);
    else assert.ok(x.sourceIds.every((id) => REAL.SOURCES[id]) && x.sourceIds.length, k);
    if (x.ref) assert.ok(Object.hasOwn(ALARM_THRESHOLDS, x.ref), k);
  }
  assert.ok(Object.isFrozen(RESCUE_CONFIG));
  const inv = fresh().parameterInventory().filter((x) => x.component === 'rescue');
  assert.equal(inv.length, Object.keys(RESCUE_CONFIG).length);
  assert.equal(inv.find((x) => x.name === 'TRIGGER_MAP_BELOW').value, ALARM_THRESHOLDS.MAP_LOW);
  assert.equal(fresh().summary().advisories.used, false);
});

// ---------------------------------------------------------------- 2026-11 guided / automatic fixes
const osa = (edit = null, mode = 'guided') => {
  const tpl = EXAMPLE_PLANS.find((x) => x.id === 'mac_obese_osa'); const p = P(tpl.patientId);
  const { plan } = buildPlan(tpl, p, REAL); if (edit) edit(plan);
  const before = JSON.stringify(plan.steps);
  const sim = createSimulation({ patient: p, plan, library: REAL, seed: 1 });
  const r = createAutoRunner({ sim, mode }); assert.ok(r.start().ok);
  return { sim, r, before, plan };
};

test('G1 pause details: a self-pause reports the reason and the exact action needed', () => {
  assert.match(pauseAction({ kind: 'alarm' }), /acknowledge the alarm .* then press Resume/);
  assert.match(pauseAction({ kind: 'interlock_hold' }), /Resume hold/);
  assert.match(pauseAction({ kind: 'clinician_confirm', item: 'sedation' }), /Acknowledge and start procedure at current level/);
  const { sim, r } = osa();
  for (let i = 0; i < 30; i++) { sim.step(1); r.tick(); }
  sim.inject('spo2_probe_off');
  for (let i = 0; i < 5 && r.state === 'running'; i++) { sim.step(1); r.tick(); }
  const st = r.status();
  assert.equal(st.state, 'paused');
  assert.ok(st.pauseDetails.length > 0);
  assert.match(st.pauseDetails[0].headline, /^HIGH alarm: /); assert.match(st.pauseDetails[0].action, /then press Resume/);
});

test('G2 obese-OSA MAC example, guided: sedation below target → acknowledge and start at current level → End procedure → recovery (example doses unchanged)', () => {
  const { sim, r, before, plan } = osa();
  let acked = false; let offered = false;
  for (let i = 0; i < 6000 && !DONE.includes(r.state); i++) {
    const st = r.status();
    if (st.current && st.current.id === 'start_procedure') {
      const sed = st.current.items.find((x) => x.id === 'sedation');
      if (sed && !sed.met && sed.clinician) {
        offered = true; assert.match(sed.detail, /Sedation below the planned target \(minimal vs moderate/);
        assert.ok(st.titration && !st.titration.none, 'titration option offered');
        if (!acked) { const a = r.clinicianAction('acknowledge_sedation_below_target'); assert.ok(a.ok, a.message); acked = true; }
      }
      if (!sim.state.periop.timeOut && acked) r.clinicianAction('confirm_time_out');
    }
    if (st.current && st.current.gate && st.current.enabled) { assert.ok(r.approve(st.current.id).ok); continue; }
    sim.step(1); r.tick();
  }
  assert.ok(offered); assert.equal(r.state, 'completed', r.message);
  assert.deepEqual(r.history.map((h) => h.id), ['transfer_to_or', 'start_sedation', 'start_procedure', 'end_procedure', 'recovery']);
  assert.ok(sim.state.periop.sedationAck && sim.state.periop.sedationAck.target === 'moderate');
  assert.ok(sim.state.log.some((l) => /Clinician acknowledged sedation below the planned target/.test(l.message)));
  assert.equal(JSON.stringify(plan.steps), before, 'plan doses unchanged');
});

test('G3 obese-OSA guided: titration within the label range (one clinician step, logged) then Start procedure → recovery', () => {
  const { sim, r } = osa();
  let titrated = null;
  for (let i = 0; i < 6000 && !DONE.includes(r.state); i++) {
    const st = r.status();
    if (st.current && st.current.id === 'start_procedure' && st.titration && !st.titration.none && !titrated) {
      assert.equal(st.titration.drugId, 'propofol');
      if (st.titration.waitSec === 0) {
        titrated = st.titration; const a = r.clinicianAction('titrate_sedation'); assert.ok(a.ok, a.message);
        const rec = recommend(sim.patient, 'sedation_moderate', 'propofol', REAL);
        assert.ok(titrated.rate > titrated.from && titrated.rate <= rec.rate.range.max && titrated.rate >= rec.rate.range.min);
      }
    }
    if (titrated && !sim.state.periop.timeOut) r.clinicianAction('confirm_time_out');
    if (st.current && st.current.gate && st.current.enabled && (titrated || st.current.id !== 'start_procedure')) { assert.ok(r.approve(st.current.id).ok); continue; }
    sim.step(1); r.tick();
  }
  assert.ok(titrated, 'titration offered and applied');
  assert.equal(r.state, 'completed', r.message);
  assert.equal(sim.state.periop.sedationAck, null, 'reached the target after titration — no acknowledgement needed');
  assert.ok(sim.state.log.some((l) => /clinician: Clinician-approved sedation titration: Propofol 25 → 50 mcg\/kg\/min/.test(l.message)));
  assert.ok(sim.doseLog.some((d) => d.drugId === 'propofol' && d.kind === 'infusion' && d.rate === 50 && d.source === 'clinician'));
  // the next step waits for the reassessment interval
  assert.equal(AUTORUN_CONFIG.SEDATION_TITRATION_REASSESS_SEC.provenance, 'simulator convention (unsourced)');
});

test('G4 full demonstration pauses for sedation below target and never titrates or acknowledges on its own', () => {
  const { sim, r } = osa((plan) => { plan.sedationTarget = 'deep'; }, 'full');
  for (let i = 0; i < 4000 && r.state === 'running'; i++) { sim.step(1); r.tick(); }
  assert.equal(r.state, 'paused', r.message);
  const st = r.status();
  assert.ok(st.pauseDetails.some((d) => d.item === 'sedation' && /Sedation below the planned target \(\w+ vs deep\)/.test(d.headline)), JSON.stringify(st.pauseDetails));
  for (let i = 0; i < 600; i++) { sim.step(1); r.tick(); }
  assert.equal(r.state, 'paused'); assert.equal(sim.state.periop.sedationAck, null);
  assert.ok(!sim.doseLog.some((d) => d.source === 'clinician'), 'no titration by the runner');
  assert.ok(!r.resume().ok, 'Resume alone does not pass the gate');
  // the clinician acknowledges (and confirms the time out) → the demonstration continues to recovery
  r.clinicianAction('acknowledge_sedation_below_target'); r.clinicianAction('confirm_time_out');
  assert.ok(r.resume().ok);
  for (let i = 0; i < 6000 && !DONE.includes(r.state); i++) { if (r.state === 'paused') { clinicianResolves(r); r.resume(); continue; } sim.step(1); r.tick(); }
  assert.equal(r.state, 'completed', r.message);
});

test('G5 example-plan steps carry a "Why this time" rationale (matching template step, else the example-plan convention)', () => {
  for (const tpl of EXAMPLE_PLANS) for (const s of tpl.steps) { assert.ok(s.timingRationale && s.timingRationale.text, `${tpl.id} ${s.drugId}`); assert.ok(s.timingRationale.provenance); }
  const osaPlan = EXAMPLE_PLANS.find((x) => x.id === 'mac_obese_osa');
  assert.match(osaPlan.steps[1].timingRationale.text, /4 min after the midazolam/);
  const eld = EXAMPLE_PLANS.find((x) => x.id === 'ga_elderly_cad_ckd');
  assert.deepEqual(eld.steps.find((s) => s.drugId === 'phenylephrine').timingRationale, EXAMPLE_TIMING_FALLBACK);
  const { plan } = buildPlan(osaPlan, P('obese_osa'), REAL);
  assert.ok(plan.steps.every((s) => s.timingRationale), 'built plan keeps the rationale');
});
