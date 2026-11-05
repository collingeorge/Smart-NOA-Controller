import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePatient, validatePatient, devineIbw, janmahasatianLbw, apfel, stopBangScore, PatientValidationError, scalarWeight } from '../engine/patient.js';
import { basePatient, FIXTURE, LIBS } from './helpers.mjs';

const close = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('Devine IBW known cases', () => {
  close(devineIbw('male', 152.4), 50, 1e-9);          // exactly 60 in
  close(devineIbw('female', 152.4), 45.5, 1e-9);
  close(devineIbw('male', 177.8), 50 + 2.3 * 10, 1e-9); // 70 in → 73 kg
  close(devineIbw('female', 165.1), 45.5 + 2.3 * 5, 1e-9); // 65 in → 57 kg
});

test('Janmahasatian LBW known cases', () => {
  // male 80 kg, BMI 24.69 → 9270·80/(6680+216·24.69) = 61.7 kg
  const bmi = 80 / (1.8 * 1.8);
  close(janmahasatianLbw('male', 80, bmi), (9270 * 80) / (6680 + 216 * bmi), 1e-9);
  close(janmahasatianLbw("male", 80, bmi), 61.7, 0.1);
  // female 60 kg, 165 cm → BMI 22.04 → 9270·60/(8780+244·22.04) = 39.3 kg
  const bf = 60 / (1.65 * 1.65);
  close(janmahasatianLbw("female", 60, bf), 39.3, 0.1);
});

test('derivePatient: MAP, BMI, weights, flags', () => {
  const p = derivePatient(basePatient({ ageYears: 70, weightKg: 130, egfr: 25, emergency: true, airway: { mallampati: 3, difficultHistory: false, limitedMouthOpening: false, limitedNeck: false } }), { library: FIXTURE });
  close(p.map, 80 + 45 / 3, 1e-9);
  close(p.bmi, 130 / 3.24, 1e-6);
  close(p.ibwKg, devineIbw('male', 180), 1e-9);
  close(p.abwKg, p.ibwKg + 0.4 * (130 - p.ibwKg), 1e-9);
  for (const f of ['elderly', 'obese', 'morbidObese', 'ckd', 'severeCkd', 'aspirationRisk', 'difficultAirwayPredicted']) assert.ok(p.flags.includes(f), f);
  assert.ok(p.derived);
  // re-deriving a derived patient is stable
  assert.deepEqual(derivePatient(p, { library: FIXTURE }).stopBang, p.stopBang);
});

test('Apfel score and risk percentages 10/21/39/61/79', () => {
  const r = [
    apfel({ sex: 'male', smoker: true, ponvHistory: false, postopOpioidsExpected: false }),
    apfel({ sex: 'female', smoker: true, ponvHistory: false, postopOpioidsExpected: false }),
    apfel({ sex: 'female', smoker: false, ponvHistory: false, postopOpioidsExpected: false }),
    apfel({ sex: 'female', smoker: false, ponvHistory: true, postopOpioidsExpected: false }),
    apfel({ sex: 'female', smoker: false, ponvHistory: true, postopOpioidsExpected: true }),
  ];
  assert.deepEqual(r.map((x) => x.score), [0, 1, 2, 3, 4]);
  assert.deepEqual(r.map((x) => x.riskPercent), [10, 21, 39, 61, 79]);
});

test('STOP-Bang scoring and risk bands', () => {
  const none = stopBangScore({ snoring: false, tired: false, observedApnea: false, pressure: false, bmi: 22, ageYears: 30, sex: 'female' });
  assert.equal(none.score, 0); assert.equal(none.risk, 'low');
  const all = stopBangScore({ snoring: true, tired: true, observedApnea: true, pressure: true, bmi: 40, ageYears: 60, neckCm: 45, sex: 'male' });
  assert.equal(all.score, 8); assert.equal(all.risk, 'high');
  const inter = stopBangScore({ snoring: true, tired: false, observedApnea: false, pressure: false, bmi: 25, ageYears: 55, sex: 'female', neckCm: 35 });
  assert.equal(inter.score, 2); assert.equal(inter.risk, 'low');
  const three = stopBangScore({ snoring: true, tired: false, observedApnea: false, pressure: false, bmi: 25, ageYears: 55, sex: 'male' });
  assert.equal(three.score, 3); assert.equal(three.risk, 'intermediate');
  const esc = stopBangScore({ snoring: true, tired: true, observedApnea: false, pressure: false, bmi: 25, ageYears: 30, sex: 'male' });
  assert.equal(esc.score, 3); assert.equal(esc.risk, 'high'); assert.ok(esc.escalated);
  // hypertension condition counts as "pressure"
  const p = derivePatient(basePatient({ conditions: ['hypertension'] }), { library: FIXTURE });
  assert.ok(p.stopBang.items.pressure);
});

test('validation returns clear errors', () => {
  const v = validatePatient(basePatient({ ageYears: 12, weightKg: NaN, sex: 'x', conditions: ['not_a_condition'], baseline: { hr: 75, sbp: 80, dbp: 90, spo2: 98, rr: 14 } }), { library: FIXTURE });
  assert.equal(v.ok, false);
  const fields = v.errors.map((e) => e.field);
  for (const f of ['ageYears', 'weightKg', 'sex', 'conditions', 'baseline.dbp']) assert.ok(fields.includes(f), f);
  assert.throws(() => derivePatient(basePatient({ asa: 7 }), { library: FIXTURE }), PatientValidationError);
  assert.throws(() => derivePatient(basePatient({ asa: 2.5 }), { library: FIXTURE }), /asa/);
});

test('scalar weights are capped at total body weight', () => {
  const p = derivePatient(basePatient({ weightKg: 50, heightCm: 190 }), { library: FIXTURE });
  assert.ok(p.ibwKg > 50);
  const sw = scalarWeight(p, 'IBW');
  assert.equal(sw.weightKg, 50); assert.ok(sw.capped);
});

for (const { name, lib } of LIBS) {
  test(`example-style patient validates against ${name} library ids`, () => {
    assert.ok(validatePatient(basePatient({ conditions: ['heart_block', 'osa'], allergies: ['nsaid'], medications: ['beta_blocker'] }), { library: lib }).ok);
  });
}
