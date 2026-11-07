// Interlock hardening (2026-11): explicit acknowledged release, persistent hold reasons, plausibility and
// sudden-drop sensor checks, time-limited suspension, long-hold advisory, auditable event log.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device. Software checks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { InterlockCore, SmartNoaControllerPort, NOA_CONFIG, CLINICIAN_RESPONSIBILITY, LATCH_CODES } from '../engine/interlocks.js';
import { createSimulation } from '../engine/sim.js';
import { derivePatient } from '../engine/patient.js';
import { createAutoRunner } from '../engine/autorun.js';
import { basePatient, LIBS, runFor } from './helpers.mjs';

const port = () => { const c = new SmartNoaControllerPort({ age: 40, weight_kg: 70, asa_class: 2, egfr: 90, allergies: [], comorbidities: [] }); c.generateStartingRates(); return c; };
const codes = (c) => c.events.map((e) => e.code);
const STEADY = (n, hr = 80, map = 80) => Array(n).fill([hr, map]);

// ------------------------------------------------------------------------------------- core / port
test('core: unusable readings (invalid, implausible, sudden drop) zero ALL agents, latch, RED, logged with the reason', () => {
  for (const [seq, re] of [
    [[[NaN, 80]], /^Invalid sensor reading \(HR=unusable, MAP=80\) → all controlled infusions set to zero; hold latched$/],
    [[[80, 350]], /^MAP 350 outside simulation plausibility limits 0–300: unusable → /],
    [[[-1, 80]], /^HR -1 outside simulation plausibility limits 0–300: unusable/],
    [[[80, 80], [39, 80]], /^HR drop −41 \/min in 1 s \(80 → 39\) above the simulation rate-of-change limit 40: unusable/],
    [[[80, 80], [80, 49]], /^MAP drop −31 mmHg in 1 s \(80 → 49\) above the simulation rate-of-change limit 30: unusable/],
  ]) {
    const c = port(); const tr = c.monitorAndControl(seq);
    const last = tr[tr.length - 1];
    assert.equal(last.status, 'RED'); assert.ok(c.holdLatched);
    assert.ok(Object.values(c.infusions).every((r) => r === 0));
    assert.equal(last.events[0].code, 'sensor_fault'); assert.match(last.events[0].message, re);
  }
  // exact drop limits (strict '>') and a sudden RISE are not artifacts
  const ok = port(); ok.monitorAndControl([[80, 80], [40, 80], [100, 80], [100, 70], [160, 120]]);
  assert.ok(!codes(ok).includes('sensor_fault'));
  // the baseline resets after an unusable reading: the first valid reading after a fault is not compared
  const r = port(); r.monitorAndControl([[100, 100], [null, 100], [55, 60]]);
  assert.deepEqual(codes(r), ['sensor_fault']);
  assert.deepEqual(r.holdReasons, ['invalid sensor (HR=unusable)']);
});

test('core: HR/MAP breach messages, agents zeroed, latch; no automatic restart; direct write re-zeroed', () => {
  const c = port();
  c.monitorAndControl([[46, 80]]);
  assert.equal(c.events[0].message, 'HR 46 < 48 → Dexmedetomidine set to zero; hold latched');
  c.monitorAndControl([[80, 55]]);
  assert.equal(c.events[1].message, 'MAP 55 < 60 → Dexmedetomidine, Lidocaine set to zero; hold latched');
  assert.deepEqual(c.holdReasons, ['HR 46 < 48', 'MAP 55 < 60']);
  assert.deepEqual(c.core.hold.reasons, [{ tSec: 0, reason: 'HR 46 < 48' }, { tSec: 1, reason: 'MAP 55 < 60' }]);
  c.monitorAndControl(STEADY(900));
  assert.equal(c.status, 'HOLD'); assert.equal(c.infusions.Dexmedetomidine, 0); assert.equal(c.infusions.Lidocaine, 0);
  c.infusions.Dexmedetomidine = 0.5; c.monitorAndControl(STEADY(3));
  assert.equal(c.infusions.Dexmedetomidine, 0);
  assert.equal(codes(c).filter((x) => x === 'hold_long').length, 1, 'long-hold advisory once at 10 min');
  assert.match(c.events.find((e) => e.code === 'hold_long').message, /^Hold has been active for 10 min \(reasons: HR 46 < 48; MAP 55 < 60\)$/);
});

test('core: release needs an acknowledgment of THIS hold since its latest latch; stale and consumed acknowledgments refused', () => {
  const c = port(); c.monitorAndControl([[46, 80]]);
  assert.throws(() => c.resumeHold('clinician'), /^Error: Acknowledge the hold first: review the cause \(HR 46 < 48\), then resume$/);
  assert.throws(() => c.acknowledgeHold('  '), /by must be a non-empty string/);
  c.acknowledgeHold('clinician', 'reviewed');
  c.monitorAndControl([[46, 80]]); // the same trigger firing again is not a new latch event
  assert.equal(c.core.hold.acknowledgedBy, 'clinician');
  c.monitorAndControl([[80, 55]]); // new trigger + new agent → acknowledgment invalidated
  assert.equal(c.core.hold.acknowledgedBy, null); assert.ok(codes(c).includes('acknowledgment_invalidated'));
  assert.throws(() => c.resumeHold('clinician'), /Acknowledge the hold first/);
  c.acknowledgeHold('clinician');
  const held = c.resumeHold('clinician');
  assert.deepEqual(held, ['Dexmedetomidine', 'Lidocaine']);
  assert.equal(c.holdLatched, false); assert.equal(c.status, 'RED', 'status changes only at the next evaluation');
  assert.throws(() => c.resumeHold('clinician'), /No hold is latched/);
  c.monitorAndControl([[46, 80]]); // a later hold: the consumed acknowledgment cannot be reused
  assert.throws(() => c.resumeHold('clinician'), /Acknowledge the hold first/);
  assert.equal(c.core.hold.id, 2);
});

test('core: resume does not restore a rate — held agents stay exactly 0 until set explicitly', () => {
  const c = port(); c.monitorAndControl([[80, 55]]);
  c.acknowledgeHold('clinician'); c.resumeHold('clinician');
  const tr = c.monitorAndControl(STEADY(120));
  assert.ok(tr.every((s) => s.rates_after.Dexmedetomidine === 0 && s.rates_after.Lidocaine === 0 && s.rates_after.Ketamine === 0.2));
  assert.equal(c.status, 'GREEN');
  assert.ok(c.events.find((e) => e.code === 'hold_released').message.endsWith('→ held infusions stay at zero; no automatic restart'));
  c.infusions.Lidocaine = 1; c.monitorAndControl(STEADY(2)); // explicit new rate
  assert.equal(c.infusions.Lidocaine, 1);
  assert.equal(CLINICIAN_RESPONSIBILITY, 'Releasing this hold is a clinician decision. The simulation does not assess whether restart is appropriate.');
});

test('core: suspension suppresses only HR/MAP breaches, never an existing hold, sensor fail-safe or rate faults; expires and is logged', () => {
  const c = port();
  for (const [d, re] of [[0, /from 1 to 300/], [301, /from 1 to 300/], [1.5, /whole number/], [true, /whole number/]]) assert.throws(() => c.suspendInterlocks(d, 'clinician', 'x'), re);
  for (const reason of ['', '   ', '\n\t', null]) assert.throws(() => c.suspendInterlocks(60, 'clinician', reason), /reason must be a non-empty string/);
  const verbatim = '  <b>"why"</b> — é ✓ \'q\'  ';
  c.suspendInterlocks(4, 'clinician', verbatim);
  assert.equal(c.core.suspension.reason, verbatim);
  assert.ok(c.events.at(-1).message.includes(`(reason: ${verbatim})`));
  assert.throws(() => c.suspendInterlocks(10, 'clinician', 'again'), /already suspended/);
  c.monitorAndControl([[46, 80], [80, 55]]);
  assert.deepEqual(codes(c).slice(-2), ['breach_suppressed', 'breach_suppressed']);
  assert.equal(c.events.at(-2).message, 'HR 46 < 48 → interlock SUSPENDED by clinician (00:04 left): no hold latched');
  assert.equal(c.holdLatched, false); assert.equal(c.status, 'GREEN'); assert.equal(c.infusions.Dexmedetomidine, 0.5);
  c.infusions.Ketamine = 5; c.monitorAndControl([[80, 80]]); // rate fault still latches
  assert.ok(c.holdLatched); assert.equal(c.infusions.Ketamine, 0); assert.equal(c.status, 'RED');
  c.monitorAndControl([[null, 80]]); // sensor fail-safe still applies
  assert.ok(Object.values(c.infusions).every((r) => r === 0));
  assert.equal(c.suspended, false, 'expired at the end of the 4 s');
  assert.equal(codes(c).at(-1), 'suspension_expired');
  c.monitorAndControl([[46, 80]]);
  assert.equal(codes(c).at(-1), 'hr_low', 'after expiry the HR rule latches again');
  // a suspension started while a hold is latched never releases it or restores a rate
  c.suspendInterlocks(60, 'clinician', 'during hold'); c.monitorAndControl(STEADY(5));
  assert.ok(c.holdLatched); assert.ok(Object.values(c.infusions).every((r) => r === 0)); assert.equal(c.status, 'HOLD');
  c.endSuspension('clinician');
  assert.equal(c.events.at(-1).message, 'Suspension ended by clinician (00:55 left) → HR/MAP interlocks active');
  assert.throws(() => c.endSuspension('clinician'), /No interlock suspension is active/);
});

test('core: event records carry tSec, status and ordered drugs; latch codes are exactly the four hold triggers', () => {
  const core = new InterlockCore({ infusions: { Lidocaine: 1, Ketamine: 0.1, Dexmedetomidine: 0.3 } });
  const r = core.evaluate(40, 50, null, 12);
  assert.deepEqual(r.events.map((e) => [e.tSec, e.code, e.status, e.drugs]), [[12, 'hr_low', 'RED', ['Dexmedetomidine']], [12, 'map_low', 'RED', ['Dexmedetomidine', 'Lidocaine']]]);
  assert.deepEqual([...LATCH_CODES], ['sensor_fault', 'rate_fault', 'hr_low', 'map_low']);
  assert.equal(NOA_CONFIG.interlock_suspension_max_sec, 300);
});

// ------------------------------------------------------------------------------------- simulator
for (const { name, lib } of LIBS) {
  const P = (over = {}) => derivePatient(basePatient(over), { library: lib });
  const dex = (sim) => sim.state.drugs.dexmedetomidine.infusionRate;

  test(`${name}: sim acknowledge_hold / resume_hold — two explicit, logged steps; reasons persist; rates not restored`, () => {
    const sim = createSimulation({ patient: P(), seed: 3, library: lib });
    assert.equal(sim.action('acknowledge_hold').ok, false);
    assert.ok(sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.4, rateUnit: 'mcg/kg/h' }).ok);
    assert.ok(sim.administer({ drugId: 'lidocaine', kind: 'infusion', rate: 1, rateUnit: 'mg/kg/h' }).ok);
    runFor(sim, 5);
    sim.state.vitals.map = 70; runFor(sim, 1); sim.state.vitals.map = 55; runFor(sim, 1); // the next control iteration reads the displayed value (two writes: no sudden-drop artifact)
    const I = sim.state.interlocks;
    assert.ok(I.holdLatched); assert.deepEqual(I.hold.drugs, ['dexmedetomidine', 'lidocaine']);
    assert.deepEqual(I.hold.reasons.map((x) => x.reason), ['MAP 55 < 60']);
    runFor(sim, 30);
    assert.deepEqual(sim.state.interlocks.hold.reasons.map((x) => x.reason), ['MAP 55 < 60'], 'reason persists after recovery');
    const no = sim.action('resume_hold');
    assert.equal(no.ok, false); assert.equal(no.message, 'Acknowledge the hold first: review the cause (MAP 55 < 60), then resume');
    const ack = sim.action('acknowledge_hold:reviewed <i>trend</i>');
    assert.ok(ack.ok); assert.equal(sim.state.interlocks.hold.acknowledgedBy, 'clinician');
    const rel = sim.action('resume_hold');
    assert.ok(rel.ok); assert.deepEqual(rel.released, ['dexmedetomidine', 'lidocaine']);
    const evs = sim.stats.interlockEvents.filter((e) => ['hold_acknowledged', 'hold_released'].includes(e.code));
    assert.deepEqual(evs.map((e) => [e.code, e.tSec]), [['hold_acknowledged', 37], ['hold_released', 37]]);
    assert.ok(sim.state.log.some((l) => l.kind === 'interlock' && /note: reviewed <i>trend<\/i>/.test(l.message)));
    assert.ok(sim.state.log.some((l) => l.kind === 'interlock' && /resume_hold.*Infusions do not restart automatically\.$/.test(l.message)));
    const rates = []; for (let i = 0; i < 300; i++) { sim.step(1); rates.push([dex(sim), sim.state.drugs.lidocaine.infusionRate]); }
    assert.ok(rates.every(([a, b]) => a === 0 && b === 0), 'held infusions stay exactly 0 after release');
    assert.equal(sim.state.interlocks.status, 'GREEN'); assert.equal(sim.state.interlocks.hold, null);
    const A = sim.summary().interlockAudit;
    assert.deepEqual(A.actions.map((e) => e.code), ['hold_acknowledged', 'hold_released']);
    assert.equal(A.holds.length, 1); assert.equal(A.holds[0].releasedAtSec, 37); assert.deepEqual(A.holds[0].reasons, [{ tSec: 7, reason: 'MAP 55 < 60' }]);
    assert.ok(sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.3, rateUnit: 'mcg/kg/h' }).ok, 'an explicit new rate is accepted');
  });

  test(`${name}: sim sudden drop / implausible reading is an unusable reading (full fail-safe)`, () => {
    for (const [field, value, re] of [['hr', null, /HR drop −\d+ \/min in 1 s/], ['map', 350, /MAP 350 outside simulation plausibility limits 0–300/]]) {
      const sim = createSimulation({ patient: P(), seed: 1, library: lib });
      sim.administer({ drugId: 'ketamine', kind: 'infusion', rate: 0.1, rateUnit: 'mg/kg/h' });
      runFor(sim, 5);
      sim.state.vitals[field] = value === null ? sim.state.vitals.hr - 45 : value; runFor(sim, 1);
      assert.equal(sim.state.interlocks.status, 'RED'); assert.equal(sim.state.drugs.ketamine.infusionRate, 0);
      assert.ok(sim.stats.interlockEvents.some((e) => e.code === 'sensor_fault' && re.test(e.message)));
    }
  });

  test(`${name}: sim suspension — banner state, suppressed breach, expiry, end now, verbatim reason, refusals`, () => {
    const sim = createSimulation({ patient: P(), seed: 4, library: lib });
    sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.3, rateUnit: 'mcg/kg/h' });
    runFor(sim, 3);
    assert.equal(sim.action('suspend_interlocks:60').ok, false, 'a reason is required');
    assert.equal(sim.action('suspend_interlocks:60:   ').ok, false, 'whitespace-only reason refused');
    assert.equal(sim.action('suspend_interlocks:301:x').ok, false);
    assert.equal(sim.action('suspend_interlocks:abc:x').ok, false);
    assert.equal(sim.action('end_suspension').ok, false);
    const reason = ' "vagal" <b>test</b>: é ✓ ';
    assert.ok(sim.action(`suspend_interlocks:60:${reason}`).ok);
    const sp = sim.state.interlocks.suspension;
    assert.deepEqual({ ...sp }, { active: true, by: 'clinician', reason, startedAtSec: 3, durationSec: 60, untilSec: 63, remainingSec: 60 });
    assert.ok(sim.state.log.some((l) => l.kind === 'interlock' && l.message.includes(`(reason: ${reason})`)));
    const r = createAutoRunner({ sim, mode: 'full' }).start();
    assert.equal(r.ok, false); assert.equal(r.refused, 'interlocks_suspended');
    sim.inject('vagal_bradycardia'); runFor(sim, 40);
    assert.ok(sim.summary().minHr < 48);
    assert.equal(sim.state.interlocks.holdLatched, false, 'HR breach during the suspension latches no hold');
    assert.ok(dex(sim) > 0);
    assert.ok(sim.stats.interlockEvents.some((e) => e.code === 'breach_suppressed' && /^HR \d+ < 48 → interlock SUSPENDED by clinician \(\d\d:\d\d left\): no hold latched$/.test(e.message)));
    runFor(sim, 30);
    assert.equal(sim.state.interlocks.suspension.active, false);
    assert.ok(sim.stats.interlockEvents.some((e) => e.code === 'suspension_expired' && e.tSec === 63));
    // second suspension, ended early
    assert.ok(sim.action('suspend_interlocks:120:second').ok); runFor(sim, 10);
    assert.equal(sim.state.interlocks.suspension.remainingSec, 110);
    assert.ok(sim.action('end_suspension').ok);
    assert.equal(sim.state.interlocks.suspension.active, false);
    assert.deepEqual(sim.summary().interlockAudit.actions.map((e) => e.code), ['suspension_started', 'suspension_expired', 'suspension_started', 'suspension_ended']);
    const off = createSimulation({ patient: P(), library: lib, interlocks: false });
    assert.equal(off.action('suspend_interlocks:60:x').ok, false);
    assert.equal(off.action('acknowledge_hold').ok, false);
  });

  test(`${name}: plan scheduler never re-applies a held agent's executed plan step; a FUTURE plan step after release runs as planned`, () => {
    const plan = { mode: 'MAC', sedationTarget: 'moderate', steps: [
      { id: 'a', phase: 'premed', atSec: 0, drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.4, rateUnit: 'mcg/kg/h' },
      { id: 'b', phase: 'premed', atSec: 20, drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.3, rateUnit: 'mcg/kg/h' },
      { id: 'c', phase: 'premed', atSec: 200, drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.2, rateUnit: 'mcg/kg/h' }] };
    const sim = createSimulation({ patient: P(), plan, seed: 2, library: lib });
    runFor(sim, 5); assert.equal(dex(sim), 0.4);
    sim.state.vitals.hr = 46; runFor(sim, 1); assert.equal(dex(sim), 0); assert.ok(sim.core.holdLatched);
    runFor(sim, 30); // step b comes due while the hold is latched → blocked (executed, never re-run)
    const st = Object.fromEntries(sim.planStatus().map((s) => [s.id, s.status]));
    assert.equal(st.a, 'done'); assert.equal(st.b, 'blocked'); assert.equal(st.c, 'pending');
    sim.action('acknowledge_hold'); assert.ok(sim.action('resume_hold').ok);
    const after = []; for (let i = 0; i < 150; i++) { sim.step(1); after.push(dex(sim)); }
    assert.ok(after.every((x) => x === 0), 'release does not re-run executed steps a/b');
    runFor(sim, 30);
    assert.equal(dex(sim), 0.2, 'the future plan step c (approved in the plan) runs when due');
  });

  test(`${name}: long-hold advisory is logged every 10 min, changes nothing, is not an alarm`, () => {
    const sim = createSimulation({ patient: P(), seed: 5, library: lib });
    sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.3, rateUnit: 'mcg/kg/h' });
    runFor(sim, 2); sim.state.vitals.hr = 46; runFor(sim, 1);
    const alarmsBefore = sim.alarmMgr.history.length;
    runFor(sim, 1300);
    const long = sim.stats.interlockEvents.filter((e) => e.code === 'hold_long');
    assert.deepEqual(long.map((e) => e.tSec), [603, 1203]);
    assert.match(long[0].message, /^Hold has been active for 10 min \(reasons: HR 46 < 48\)$/);
    assert.equal(sim.state.interlocks.hold.longHoldNotices, 2);
    assert.equal(sim.alarmMgr.history.length, alarmsBefore, 'no alarm raised by the advisory');
    assert.ok(sim.core.holdLatched); assert.equal(dex(sim), 0);
  });
}
