// Shared real-run driver for the depth-low advisory suites (not a test file itself: it is imported by
// tests/depth-advisory-2026-11.test.mjs and tests/depth-advisory-full-2026-11.test.mjs, which node --test
// runs in parallel). EDUCATIONAL SIMULATION — fictional patients — not a medical device.
//
// drive(..., withAdvisor = true) also instruments the advisor (audit 05l, finding 1), at no extra simulation cost:
//   - every update() call is recorded with its kind (post-step / refresh-only) and whether it ran inside
//     sim._substep, and the time counters before/after (lastT, runSec, episodeSec, totalBelowSec, entries);
//   - a SHADOW advisor (same class, reading the same simulation, its log discarded) is updated only after each
//     sim.step(1) — the "step-only path", never refreshed after an action — for comparison with the real one.
import assert from 'node:assert/strict';
import { REAL, clinicianResolves } from './helpers.mjs';
import { derivePatient } from '../engine/patient.js';
import { createSimulation } from '../engine/sim.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { createAutoRunner } from '../engine/autorun.js';
import { TIMING_CONFIG } from '../engine/timing.js';
import { DepthLowAdvisor, createDepthAdvisor, depthLowArmed } from '../engine/depth-advisory.js';

export const DONE = ['completed', 'stopped', 'manual'];
export const P = (id) => derivePatient(EXAMPLE_PATIENTS.find((x) => x.id === id).patient, { library: REAL });
const LO = TIMING_CONFIG.GA_DEPTH_BAND.value[0];

const counters = (a) => ({ lastT: a.lastT, runSec: a.runSec, episodeSec: a.episodeSec, totalBelowSec: a.totalBelowSec, entries: a.entries.length, active: a.active });

function instrument(sim, adv) {
  const calls = []; let inSub = false;
  const sub = sim._substep.bind(sim);
  sim._substep = (h) => { inSub = true; try { return sub(h); } finally { inSub = false; } };
  const orig = adv.update.bind(adv);
  adv.update = (opts) => {
    const before = counters(adv); const t = sim.state.tSec;
    const r = orig(opts);
    calls.push({ t, refreshOnly: !!(opts && opts.refreshOnly), inSubstep: inSub, before, after: counters(adv) });
    return r;
  };
  // Step-only shadow: reads the same simulation; its log lines go nowhere (the real log is untouched).
  const view = Object.create(sim, { logNote: { value: () => {} } });
  const shadow = new DepthLowAdvisor(view); shadow.update();
  return { calls, shadow };
}

export function drive(tpl, mode, seed, withAdvisor) {
  const p = P(tpl.patientId); const { plan } = buildPlan(tpl, p, REAL);
  const sim = createSimulation({ patient: p, plan, library: REAL, seed });
  const adv = withAdvisor ? createDepthAdvisor(sim) : null;
  const probe = adv ? instrument(sim, adv) : null;
  const runner = createAutoRunner({ sim, mode });
  const started = runner.start();
  let pauses = 0; let surgeryAt = null; const alarmIds = new Set(); let shownBeforeIncision = 0; let shownOutsideArm = 0;
  if (started.ok) {
    for (let i = 0; i < 14000 && !DONE.includes(runner.state); i++) {
      if (runner.state === 'paused') {
        pauses++;
        for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`);
        if (sim.core.holdLatched) sim.action('resume_hold');
        clinicianResolves(runner);
        if (runner.status().pauseDetails.some((d) => d.item === 'sedation')) runner.clinicianAction('acknowledge_sedation_below_target');
        runner.resume(); continue;
      }
      if (mode === 'guided') {
        const st = runner.status();
        if (st.current && st.current.gate) {
          clinicianResolves(runner);
          if (st.current.items && st.current.items.some((x) => x.id === 'sedation' && x.clinician && !x.met)) runner.clinicianAction('acknowledge_sedation_below_target');
          if (runner.status().current.enabled) runner.approve(st.current.id);
        }
      }
      const before = adv ? adv.entries.length : 0;
      sim.step(1);
      if (probe) probe.shadow.update(); // step-only path: same point as the real post-step update
      runner.tick();
      if (surgeryAt === null && sim.stim.surgeryStartAt !== null) surgeryAt = sim.stim.surgeryStartAt;
      for (const a of sim.state.alarms) alarmIds.add(a.id);
      if (adv && adv.entries.length > before) { if (surgeryAt === null) shownBeforeIncision++; if (!depthLowArmed(sim).armed) shownOutsideArm++; }
    }
  }
  return {
    sim, adv, runner, probe, started: started.ok, pauses, alarmIds, shownBeforeIncision, shownOutsideArm,
    outcome: { state: runner.state, stopReason: runner.stopReason || null, t: sim.state.tSec, phase: sim.state.phase, extubated: sim.stats.extubation ? sim.stats.extubation.tSec : null },
    doses: JSON.stringify(sim.doseLog), alarms: JSON.stringify(sim.alarmMgr.history), history: JSON.stringify(runner.history),
    rates: JSON.stringify(Object.fromEntries(Object.entries(sim.state.drugs).map(([id, d]) => [id, [d.cumulative, d.infusionRate]]))),
  };
}

// With-advisor runs kept for reuse by later tests in the same file (DA-R reuses DA7's full-auto runs).
const cache = new Map();
export function driveCached(tpl, mode, seed) {
  const k = `${tpl.id}|${mode}|${seed}`;
  if (!cache.has(k)) cache.set(k, drive(tpl, mode, seed, true));
  return cache.get(k);
}

/** DA7 for one mode: example plans × seeds 1–20, without vs with the advisor (assertions unchanged from 05k/05l). */
export function checkDA7(t, mode) {
  const freq = [];
  for (const tpl of EXAMPLE_PLANS) {
    let cases = 0; let shown = 0; let below = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const a = drive(tpl, mode, seed, false); const b = driveCached(tpl, mode, seed);
      const tag = `${tpl.id} ${mode} seed ${seed}`;
      assert.deepEqual(b.outcome, a.outcome, `${tag}: completion outcome`);
      assert.equal(b.doses, a.doses, `${tag}: every dose and rate change identical`);
      assert.equal(b.rates, a.rates, `${tag}: final cumulative amounts and rates identical`);
      assert.equal(b.alarms, a.alarms, `${tag}: alarm history identical (no alarm added, none acknowledged by it)`);
      assert.equal(b.pauses, a.pauses, `${tag}: guided/automatic pauses identical`);
      assert.equal(b.history, a.history, `${tag}: runner history identical`);
      assert.ok(![...b.alarmIds].some((id) => /depth_low/.test(id)), `${tag}: no depth-low alarm`);
      assert.equal(b.shownBeforeIncision, 0, `${tag}: never before incision`);
      assert.equal(b.shownOutsideArm, 0, `${tag}: only while armed`);
      const rec = b.sim.summary().depthAdvisories;
      assert.equal(rec.used, true);
      if (tpl.mode === 'MAC') assert.equal(rec.shown, 0, `${tag}: never in MAC`);
      if (rec.shown) cases++;
      shown += rec.shown; below += rec.totalBelowBandSec;
      for (const x of rec.entries) assert.ok(x.shownAtSec >= b.sim.stim.surgeryStartAt || b.sim.stim.surgeryStartAt === null, tag);
      assert.equal(rec.dismissed, 0, `${tag}: nothing dismisses it automatically`);
      assert.ok(!b.sim.state.log.some((e) => /ADVISORY dismissed/.test(e.message) && /DEPTH-/.test(e.message)), tag);
    }
    freq.push(`${tpl.id}/${mode}: ${cases}/20 runs, ${shown} cards, mean ${Math.round(below / 20)} s below ${LO}`);
  }
  t.diagnostic(`depth-low advisory frequency (seeds 1–20): ${freq.join('; ')}`);
}
