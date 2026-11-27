// Regression tests for the 2026-11-27 review (propofol in MAC, IV lidocaine under 40 kg, phenylephrine limit wording).
// EDUCATIONAL SIMULATION — fictional patients — not a medical device. Software checks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, PROPOFOL_MAC_MIN_GIVE_OVER_SEC } from '../engine/sim.js';
import { derivePatient } from '../engine/patient.js';
import { recommend } from '../engine/dosing.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { checkStep } from '../ui/plan-model.js';
import { REAL, basePatient, runFor } from './helpers.mjs';

const skip = !REAL && 'default library not available';
const EX = (id) => derivePatient(EXAMPLE_PATIENTS.find((p) => p.id === id).patient, { library: REAL });
const macSim = (pat) => { const tpl = EXAMPLE_PLANS.find((p) => p.id === 'mac_obese_osa'); return createSimulation({ patient: pat, plan: buildPlan({ ...tpl }, pat, REAL).plan, library: REAL, seed: 1 }); };

test('propofol in MAC: elderly / ASA III–IV patients get no rapid bolus; given over ≥ 3 min it is accepted', { skip }, () => {
  assert.equal(PROPOFOL_MAC_MIN_GIVE_OVER_SEC, 180);
  for (const id of ['elderly_cad_ckd', 'obese_osa']) {
    const sim = macSim(EX(id)); runFor(sim, 1);
    assert.equal(sim.plan.mode, 'MAC');
    for (const overSec of [undefined, 0, 60, 179]) {
      const r = sim.administer({ drugId: 'propofol', kind: 'bolus', amount: 20, amountUnit: 'mg', overSec });
      assert.equal(r.blocked, true, `${id} over ${overSec}`); assert.match(r.reasons[0], /rapid \(single or repeated\) bolus should not be used \(label, S11\)/);
    }
    assert.ok(sim.administer({ drugId: 'propofol', kind: 'bolus', amount: 20, amountUnit: 'mg', overSec: 180 }).ok, id);
  }
});

test('propofol: the MAC rule leaves GA induction and low-risk MAC patients unchanged', { skip }, () => {
  const ga = createSimulation({ patient: EX('elderly_cad_ckd'), library: REAL, seed: 1 }); runFor(ga, 1);
  assert.notEqual(ga.plan.mode, 'MAC');
  assert.ok(ga.administer({ drugId: 'propofol', kind: 'bolus', amount: 20, amountUnit: 'mg' }).ok, 'GA: titrated induction push allowed');
  const low = macSim(EX('healthy_adult')); runFor(low, 1);
  assert.ok(low.administer({ drugId: 'propofol', kind: 'bolus', amount: 20, amountUnit: 'mg' }).ok, 'ASA I adult in MAC: label prefers slow, but does not prohibit');
});

test('propofol in MAC: the plan editor flags a push for the label group and offers a 3-min fix; the shipped MAC plan passes', { skip }, () => {
  const pat = EX('elderly_cad_ckd'); const c = { lib: REAL, patient: pat, interlocks: true };
  const step = { uid: 's1', drugId: 'propofol', kind: 'bolus', phase: 'sedation', atSec: 0, amount: 30, amountUnit: 'mg', overSec: null, regimenKey: 'sedation_moderate' };
  const r = checkStep(c, step, [step]);
  const e = r.errors.find((x) => /must not be a rapid bolus/.test(x.text)); assert.ok(e);
  e.fix.apply(step); assert.equal(step.overSec, 180);
  assert.ok(!checkStep(c, step, [step]).errors.some((x) => /rapid bolus/.test(x.text)));
  const tpl = EXAMPLE_PLANS.find((p) => p.id === 'mac_obese_osa'); const ob = EX('obese_osa');
  const plan = buildPlan(tpl, ob, REAL).plan;
  for (const s of plan.steps.filter((x) => x.drugId === 'propofol' && x.kind === 'bolus')) assert.ok(s.overSec >= 180, 'shipped MAC propofol bolus is slow');
});

test('IV lidocaine: analgesic loading dose and infusion are refused under 40 kg; propofol-pain pretreatment is not', { skip }, () => {
  const small = derivePatient(basePatient({ weightKg: 38, heightCm: 150, sex: 'female' }), { library: REAL });
  for (const key of ['induction', 'maintenance']) {
    const rec = recommend(small, key, 'lidocaine', REAL);
    assert.equal(rec.locked, true, key); assert.match(rec.lockReasons.join(' '), /not for patients under 40 kg/);
  }
  assert.equal(recommend(small, 'pretreatment', 'lidocaine', REAL).locked, false);
  const sim = createSimulation({ patient: small, library: REAL, seed: 1 }); runFor(sim, 1);
  assert.equal(sim.administer({ drugId: 'lidocaine', kind: 'infusion', rate: 1, rateUnit: 'mg/kg/h' }).blocked, true);
  assert.equal(sim.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 40, amountUnit: 'mg', overSec: 600 }).blocked, true, 'unlabelled loading is treated as analgesic');
  assert.ok(sim.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' }).ok);
  const ok = createSimulation({ patient: derivePatient(basePatient({ weightKg: 40 }), { library: REAL }), library: REAL, seed: 1 }); runFor(ok, 1);
  assert.ok(ok.administer({ drugId: 'lidocaine', kind: 'infusion', rate: 1, rateUnit: 'mg/kg/h' }).ok, '40 kg allowed');
});

test('phenylephrine: the cumulative bolus refusal names the limit as a simulator limit based on the 2019 label', { skip }, () => {
  const sim = createSimulation({ patient: derivePatient(basePatient(), { library: REAL }), library: REAL, seed: 1 }); runFor(sim, 1);
  assert.ok(sim.administer({ drugId: 'phenylephrine', kind: 'bolus', amount: 100, amountUnit: 'mcg' }).ok); runFor(sim, 120);
  assert.ok(sim.administer({ drugId: 'phenylephrine', kind: 'bolus', amount: 100, amountUnit: 'mcg' }).ok); runFor(sim, 120);
  const r = sim.administer({ drugId: 'phenylephrine', kind: 'bolus', amount: 50, amountUnit: 'mcg' });
  assert.equal(r.blocked, true); assert.match(r.reasons[0], /simulator limit based on the 2019 label/);
});

test('higher-risk MAC exposes a lower teaching option without changing scripted defaults', { skip }, () => {
  const healthy = EX('healthy_adult');
  const elderly = EX('elderly_cad_ckd');
  for (const regimen of ['sedation_moderate', 'sedation_deep']) {
    const a = recommend(healthy, regimen, 'propofol', REAL);
    const b = recommend(elderly, regimen, 'propofol', REAL);
    assert.equal(b.rate.value, a.rate.value);
    assert.equal(b.lowerMacExample.rate.value, b.rate.value * 0.8);
    assert.ok(Math.abs(b.lowerMacExample.loading.value - b.loading.value * 0.8) < 0.02);
    assert.equal(a.lowerMacExample, undefined);
    assert.ok(b.warnings.some((x) => /teaching conventions/.test(x)));
  }
});

test('sugammadex renal caution appears in plan and manual dosing', { skip }, () => {
  const p = derivePatient({ ...basePatient(), egfr: 10 }, { library: REAL });
  const r = recommend(p, 'emergence', 'sugammadex', REAL);
  assert.ok(r.warnings.some((x) => /eGFR and creatinine clearance are different/.test(x)));
  const sim = createSimulation({ patient: p, library: REAL });
  const dose = sim.administer({ drugId: 'sugammadex', kind: 'bolus', amount: r.dose.value, amountUnit: 'mg' });
  assert.ok(dose.warnings.some((x) => /eGFR and creatinine clearance are different/.test(x)));
  const normal = recommend(EX('healthy_adult'), 'emergence', 'sugammadex', REAL);
  assert.ok(!normal.warnings.some((x) => /severe renal impairment/.test(x)));
});
