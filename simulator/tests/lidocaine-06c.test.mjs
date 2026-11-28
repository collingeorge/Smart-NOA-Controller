// Regression tests for the IV lidocaine loading guard and the overlap message (review of 06b, 2026-11-27).
// EDUCATIONAL SIMULATION — fictional patients — not a medical device. Software checks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../engine/sim.js';
import { derivePatient } from '../engine/patient.js';
import { recommend } from '../engine/dosing.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { checkStep } from '../ui/plan-model.js';
import { createAutoRunner } from '../engine/autorun.js';
import { REAL, runFor } from './helpers.mjs';

const skip = !REAL && 'default library not available';
const pat = () => derivePatient(EXAMPLE_PATIENTS.find((p) => p.id === 'healthy_adult').patient, { library: REAL });
const mk = () => { const s = createSimulation({ patient: pat(), library: REAL, seed: 1 }); runFor(s, 1); return s; };
const limit = () => recommend(pat(), 'induction', 'lidocaine', REAL).dose.range.max; // 1.5 mg/kg IBW
const load = (s, amount, extra = {}) => s.administer({ drugId: 'lidocaine', kind: 'bolus', amount, amountUnit: 'mg', regimenKey: 'induction', overSec: extra.regimenKey === 'pretreatment' ? undefined : 600, ...extra });
const lido = (s) => s.state.drugs.lidocaine.cumulative;

test('lidocaine loading and maintenance cannot overlap in either direction, with or without HR/MAP holds', { skip }, () => {
  const maintenance = { drugId: 'lidocaine', kind: 'infusion', rate: 1, rateUnit: 'mg/kg/h' };
  for (const interlocks of [true, false]) {
    const s = createSimulation({ patient: pat(), library: REAL, interlocks });
    runFor(s, 1);
    assert.ok(load(s, 30).ok);
    assert.match(s.administer(maintenance).reasons[0], /must wait/);
    runFor(s, 600);
    assert.equal(s.isLidocaineLoading(), false);
    assert.ok(s.administer(maintenance).ok);
    assert.match(load(s, 10).reasons[0], /maintenance is running/);
    assert.ok(s.administer({ drugId: 'lidocaine', kind: 'stop' }).ok);
    assert.ok(load(s, 10).ok);
    runFor(s, 60);
    assert.ok(s.administer({ drugId: 'lidocaine', kind: 'stop' }).ok);
    assert.ok(s.administer(maintenance).ok, 'cancelled loading is no longer pending');
  }
});

test('a scheduled lidocaine maintenance step waits for a manually started load', { skip }, () => {
  const plan = { mode: 'GA', steps: [{ id: 'maintenance', phase: 'premed', atSec: 60, drugId: 'lidocaine', kind: 'infusion', rate: 1, rateUnit: 'mg/kg/h', regimenKey: 'maintenance' }] };
  const s = createSimulation({ patient: pat(), library: REAL, plan });
  runFor(s, 1);
  assert.ok(load(s, 30).ok);
  runFor(s, 90);
  assert.equal(s.executed.has('maintenance'), false);
  runFor(s, 520);
  assert.ok(s.executed.has('maintenance'));
  assert.ok(s.state.drugs.lidocaine.infusionRate > 0);
  assert.equal(s.isLidocaineLoading(), false);
});

test('analgesic lidocaine requires a ten-minute minimum in the engine and plan editor', { skip }, () => {
  const c = { lib: REAL, patient: pat(), interlocks: true };
  const step = { uid: 'a', drugId: 'lidocaine', kind: 'bolus', phase: 'induction', atSec: 0, amount: 30, amountUnit: 'mg', regimenKey: 'induction' };
  const s = mk();
  for (const overSec of [undefined, 0, 60, 599]) {
    assert.match(load(s, 30, { overSec, regimenKey: undefined }).reasons[0], /at least 10 minutes/);
    assert.ok(checkStep(c, { ...step, overSec }, [step]).errors.some((e) => /at least 10 minutes/.test(e.text)));
  }
  assert.equal(lido(s), 0);
  assert.ok(load(s, 30, { regimenKey: undefined }).ok);
  assert.equal(lido(s), 0, 'the timed dose is not delivered as a push');
  assert.ok(!checkStep(c, { ...step, overSec: 600 }, [step]).errors.some((e) => /at least 10 minutes/.test(e.text)));
});

test('a second full IV lidocaine load is refused; delivered and pending shown separately', { skip }, () => {
  const L = limit();
  for (const first of [{ overSec: 600 }, {}]) {
    const s = mk();
    assert.ok(load(s, L, first).ok); runFor(s, 60);
    for (const second of [{ overSec: 600 }, {}, { regimenKey: undefined }]) {
      const r = load(s, L, second);
      assert.equal(r.blocked, true, JSON.stringify({ first, second }));
      assert.match(r.reasons[0], /IV lidocaine loading would total .* \(delivered .* mg, pending .* mg, this dose .* mg\), above the consensus loading limit of 1\.5 mg\/kg ideal body weight .*simulator convention/);
    }
    assert.ok(load(s, 0.01).blocked, 'nothing above the limit');
  }
  // split loading up to the limit is allowed
  const s = mk(); assert.ok(load(s, L / 2).ok); assert.ok(load(s, L / 2).ok); assert.equal(load(s, 1).blocked, true);
});

test('cancelling a timed load credits only the undelivered part; pretreatment does not count toward the loading limit', { skip }, () => {
  const L = limit(); const s = mk();
  assert.ok(load(s, L, { overSec: 600 }).ok); runFor(s, 120);
  assert.ok(s.administer({ drugId: 'lidocaine', kind: 'stop' }).ok);
  const delivered = lido(s);
  assert.equal(load(s, L - delivered + 0.5).blocked, true, 'delivered part still counts');
  assert.ok(load(s, L - delivered - 0.01).ok, 'undelivered part credited back');
  const p = mk(); assert.ok(p.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' }).ok);
  assert.ok(load(p, L).ok, 'pretreatment is outside the analgesic loading allowance');
});

test('overlap warning: delivered and pending amounts, no double counting (timed and cancelled)', { skip }, () => {
  const msg = (r) => r.warnings.find((w) => /pretreatment and IV lidocaine analgesic dosing/.test(w));
  let s = mk(); s.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' });
  let r = load(s, 30);
  assert.equal(lido(s), 10); assert.match(msg(r), /delivered so far 10 mg; still to be delivered from timed doses 30 mg/);
  s = mk(); s.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' });
  r = load(s, 60, { overSec: 600 });
  assert.match(msg(r), /delivered so far 10 mg; still to be delivered from timed doses 60 mg/);
  runFor(s, 120); s.administer({ drugId: 'lidocaine', kind: 'stop' });
  const r2 = load(s, 5);
  const m = msg(r2); assert.ok(m); assert.match(m, new RegExp(`delivered so far ${Math.round(lido(s))} mg; still to be delivered from timed doses 5 mg`));
});

test('planned and guided delivery: the plan editor blocks a planned second load; the shipped opioid-free plan stays within the limit', { skip }, () => {
  const p = pat(); const L = limit(); const c = { lib: REAL, patient: p, interlocks: true };
  const a = { uid: 'a', drugId: 'lidocaine', kind: 'bolus', phase: 'induction', atSec: 0, amount: L, amountUnit: 'mg', overSec: 600, regimenKey: 'induction' };
  const b = { ...a, uid: 'b', atSec: 60 };
  assert.ok(checkStep(c, a, [a, b]).errors.some((e) => /planned IV lidocaine loading totals/.test(e.text)));
  assert.ok(!checkStep(c, a, [a]).errors.some((e) => /planned IV lidocaine loading/.test(e.text)));
  // guided/automatic: a full run of the opioid-free GA template gives at most one loading allowance
  const tplId = EXAMPLE_PLANS.find((x) => x.id === 'ga_healthy') ? 'ga_healthy' : EXAMPLE_PLANS[0].id;
  const tpl = EXAMPLE_PLANS.find((x) => x.id === tplId); const pp = derivePatient(EXAMPLE_PATIENTS.find((x) => x.id === tpl.patientId).patient, { library: REAL });
  const sim = createSimulation({ patient: pp, plan: buildPlan(tpl, pp, REAL).plan, library: REAL, seed: 1 });
  const run = createAutoRunner({ sim, mode: 'full' }); assert.ok(run.start().ok);
  for (let i = 0; i < 3600 && run.state === 'running'; i++) { sim.step(1); run.tick(); }
  assert.ok(sim.lido.loadCharged <= recommend(pp, 'induction', 'lidocaine', REAL).dose.range.max + 1e-9);
});

test('lidocaine pretreatment exemption requires the fixed dose after unit conversion', { skip }, () => {
  const s = mk();
  assert.match(load(s, limit(), { regimenKey: 'pretreatment' }).reasons[0], /fixed simulator dose/);
  assert.equal(lido(s), 0);
  assert.ok(load(s, 10000, { regimenKey: 'pretreatment', amountUnit: 'mcg' }).ok);
  assert.ok(load(s, limit()).ok);

  const c = { lib: REAL, patient: pat(), interlocks: true };
  const step = { uid: 'p', drugId: 'lidocaine', kind: 'bolus', phase: 'induction', atSec: 0, amount: 11, amountUnit: 'mg', regimenKey: 'pretreatment' };
  assert.ok(checkStep(c, step, [step]).errors.some((e) => /fixed simulator dose/.test(e.text)));
  const a = { ...step, uid: 'a', regimenKey: 'induction', amount: limit() * 500, amountUnit: 'mcg' };
  const b = { ...a, uid: 'b', amount: limit() / 2, amountUnit: 'mg' };
  assert.ok(!checkStep(c, a, [a, b]).errors.some((e) => /planned IV lidocaine loading/.test(e.text)));
  assert.ok(checkStep(c, a, [a, { ...b, amount: b.amount + 1 }]).errors.some((e) => /planned IV lidocaine loading/.test(e.text)));
});

test('pretreatment is refused on repeat or after propofol starts', { skip }, () => {
  const opts = { regimenKey: 'pretreatment' };
  const s = mk();
  assert.ok(load(s, 10, opts).ok);
  assert.match(load(s, 10, opts).reasons[0], /one lidocaine pretreatment/);
  assert.equal(lido(s), 10);
  const p = mk();
  assert.ok(p.administer({ drugId: 'propofol', kind: 'bolus', amount: 10, amountUnit: 'mg' }).ok);
  assert.match(load(p, 10, opts).reasons[0], /before the first propofol/);
  const c = { lib: REAL, patient: pat(), interlocks: true };
  const a = { uid: 'a', drugId: 'lidocaine', kind: 'bolus', phase: 'induction', atSec: 0, amount: 10, amountUnit: 'mg', ...opts };
  assert.ok(checkStep(c, a, [a, { ...a, uid: 'b' }]).errors.some((e) => /one lidocaine pretreatment/.test(e.text)));
});

test('extubation compares the full precision train-of-four ratio', { skip }, () => {
  const s = mk();
  for (const [ratio, met] of [[0.899, false], [0.9, true], [0.901, true]]) {
    s.state.vitals.tofRatio = ratio;
    assert.equal(s.extubationReadiness().criteria.find((c) => c.id === 'tofr').met, met);
  }
});
