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
const load = (s, amount, extra = {}) => s.administer({ drugId: 'lidocaine', kind: 'bolus', amount, amountUnit: 'mg', regimenKey: 'induction', ...extra });
const lido = (s) => s.state.drugs.lidocaine.cumulative;

test('a second full IV lidocaine load is refused (timed, push, and unlabelled manual); delivered and pending shown separately', { skip }, () => {
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

test('overlap warning: delivered and pending amounts, no double counting (immediate, timed, cancelled)', { skip }, () => {
  const msg = (r) => r.warnings.find((w) => /pretreatment and IV lidocaine analgesic dosing/.test(w));
  let s = mk(); s.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' });
  let r = load(s, 30);
  assert.equal(lido(s), 40); assert.match(msg(r), /delivered so far 40 mg; still to be delivered from timed doses 0 mg/);
  s = mk(); s.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' });
  r = load(s, 60, { overSec: 600 });
  assert.match(msg(r), /delivered so far 10 mg; still to be delivered from timed doses 60 mg/);
  runFor(s, 120); s.administer({ drugId: 'lidocaine', kind: 'stop' });
  const r2 = s.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' });
  const m = msg(r2); assert.ok(m); assert.match(m, new RegExp(`delivered so far ${Math.round(lido(s))} mg; still to be delivered from timed doses 0 mg`));
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
