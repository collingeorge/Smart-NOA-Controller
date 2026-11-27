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

// ------------------------------------------------------------------ review of PR #23: the pretreatment exemption is validated
test('a dose labelled pretreatment is exempt only if it is the single fixed 10 mg dose (after unit conversion)', { skip }, () => {
  const L = limit();
  // the reproduced bypass: full load, then 300 mg and 0.3 g labelled pretreatment
  const s = mk(); assert.ok(load(s, L).ok);
  for (const [amount, amountUnit] of [[300, 'mg'], [0.3, 'g'], [11, 'mg']]) {
    const r = s.administer({ drugId: 'lidocaine', kind: 'bolus', amount, amountUnit, regimenKey: 'pretreatment' });
    assert.equal(r.blocked, true, `${amount} ${amountUnit}`); assert.match(r.reasons[0], /IV lidocaine loading would total/);
  }
  assert.ok(Math.abs(lido(s) - L) < 1e-6, 'nothing beyond the loading limit was given');
  // the genuine 10 mg pretreatment (also as 0.01 g) is exempt once; a second one counts as loading
  const p = mk();
  const first = p.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 0.01, amountUnit: 'g', regimenKey: 'pretreatment' });
  assert.ok(first.ok); assert.ok(!first.warnings.some((w) => /counted as IV lidocaine loading/.test(w)));
  assert.ok(load(p, L).ok, 'full loading allowance still available');
  const again = p.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' });
  assert.equal(again.blocked, true, 'second pretreatment counts toward the exhausted allowance');
  // a mislabelled dose within the allowance is given but counted, with a warning
  const q = mk(); const r = q.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 50, amountUnit: 'mg', regimenKey: 'pretreatment' });
  assert.ok(r.ok); assert.ok(r.warnings.some((w) => /counted as IV lidocaine loading/.test(w)));
  assert.equal(q.lido.loadCharged, 50);
});

test('the pretreatment label cannot bypass the under-40-kg analgesic lock', { skip }, () => {
  const small = derivePatient({ ...EXAMPLE_PATIENTS.find((p) => p.id === 'healthy_adult').patient, weightKg: 38, heightCm: 150, sex: 'female' }, { library: REAL });
  const s = createSimulation({ patient: small, library: REAL, seed: 1 }); runFor(s, 1);
  const r = s.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 100, amountUnit: 'mg', regimenKey: 'pretreatment' });
  assert.equal(r.blocked, true); assert.match(r.reasons[0], /not for patients under 40 kg/);
  assert.ok(s.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' }).ok, 'the real pretreatment is still allowed');
});

test('plan editor: same validated exemption, units converted before summing', { skip }, () => {
  const p = pat(); const L = limit(); const c = { lib: REAL, patient: p, interlocks: true };
  const loadStep = { uid: 'a', drugId: 'lidocaine', kind: 'bolus', phase: 'induction', atSec: 0, amount: L, amountUnit: 'mg', overSec: 600, regimenKey: 'induction' };
  const bigPre = { uid: 'b', drugId: 'lidocaine', kind: 'bolus', phase: 'induction', atSec: 0, amount: 0.3, amountUnit: 'g', overSec: null, regimenKey: 'pretreatment' };
  const errs = checkStep(c, bigPre, [loadStep, bigPre]).errors.map((e) => e.text).join(' ');
  assert.match(errs, /planned IV lidocaine loading totals .*mg, above the consensus limit/);
  const realPre = { ...bigPre, uid: 'c', amount: 10, amountUnit: 'mg' };
  assert.ok(!checkStep(c, realPre, [loadStep, realPre]).errors.length, 'real 10 mg pretreatment + full load is fine');
  const twoPre = { ...realPre, uid: 'd' };
  assert.ok(checkStep(c, twoPre, [loadStep, realPre, twoPre]).errors.some((e) => /planned IV lidocaine loading totals/.test(e.text)), 'a second pretreatment counts');
  const gramLoad = { ...loadStep, uid: 'e', amount: L / 1000 + 0.01, amountUnit: 'g' };
  assert.ok(checkStep(c, gramLoad, [gramLoad]).errors.some((e) => /planned IV lidocaine loading totals/.test(e.text)), 'grams are converted before comparing');
});
