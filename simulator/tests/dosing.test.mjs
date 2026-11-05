import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePatient } from '../engine/patient.js';
import { recommend, evaluateContraindications, evaluateWhen, interpretCeilings, devWarnings } from '../engine/dosing.js';
import { basePatient, FIXTURE, REAL, LIBS } from './helpers.mjs';

const P = (over = {}, lib = FIXTURE) => derivePatient(basePatient(over), { library: lib });
const close = (a, b, tol = 0.02) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('evaluateWhen grammar', () => {
  const p = P({ ageYears: 70, weightKg: 45, heightCm: 160, conditions: ['heart_block'], allergies: ['nsaid'], medications: ['maoi'], egfr: 25, asa: 3 });
  for (const e of ['condition:heart_block', 'allergy:nsaid', 'medication:maoi', 'egfr<30', 'age>=65', 'asa>=3', 'weight<50', 'flag:elderly', 'elderly', 'elderly|asa>=3', 'flag:elderly|asa>=3|medication:cns_depressant', 'age>=65&egfr<30', '!condition:osa'])
    assert.equal(evaluateWhen(e, p).value, true, e);
  for (const e of ['condition:osa', 'egfr<20', 'age>=80', 'weight<40', 'flag:obese', '!elderly'])
    assert.equal(evaluateWhen(e, p).value, false, e);
  const u = evaluateWhen('bogus:thing|foo>=3', p);
  assert.equal(u.value, false); assert.equal(u.unknown.length, 2);
});

test('fixture: weight scalar and per-kg dosing', () => {
  const p = P();
  const r = recommend(p, 'induction', 'propofol', FIXTURE);
  assert.equal(r.scalar, 'LBW'); close(r.weightUsedKg, p.lbwKg, 0.1);
  close(r.dose.value, 2 * p.lbwKg, 0.2); assert.equal(r.dose.unit, 'mg');
  close(r.dose.range.min, 1.5 * p.lbwKg, 0.2); close(r.dose.range.max, 2.5 * p.lbwKg, 0.2);
  assert.ok(r.sources.includes('SFX')); assert.equal(r.locked, false);
  const f = recommend(p, 'induction', 'fentanyl', FIXTURE);
  assert.equal(f.dose.unit, 'mcg'); close(f.dose.value, 1.5 * p.lbwKg, 0.2);
  const roc = recommend(p, 'induction', 'rocuronium', FIXTURE);
  assert.equal(roc.scalar, 'IBW'); close(roc.dose.value, 0.6 * p.ibwKg, 0.1);
  const fx = recommend(p, 'sedation_moderate', 'fentanyl', FIXTURE);
  assert.equal(fx.dose.value, 25); assert.equal(fx.dose.perKg, null);
  const inf = recommend(p, 'maintenance', 'propofol', FIXTURE);
  assert.equal(inf.rate.value, 100); assert.equal(inf.rate.unit, 'mcg/kg/min'); close(inf.rate.absolute.value, 100 * 80 * 60 / 1000, 0.1);
});

test('fixture: adjustments choose the conservative regimen and carry notes', () => {
  const p = P({ ageYears: 75 });
  const r = recommend(p, 'induction', 'propofol', FIXTURE);
  close(r.dose.value, 1.25 * p.lbwKg, 0.2);
  assert.ok(r.notes.some((n) => n.startsWith('Adjustment (elderly|asa>=3)')));
  const m = recommend(p, 'sedation_moderate', 'midazolam', FIXTURE);
  assert.equal(m.dose.value, 1);
});

test('fixture: locks and warnings', () => {
  const r = recommend(P({ allergies: ['propofol'] }), 'induction', 'propofol', FIXTURE);
  assert.equal(r.locked, true); assert.equal(r.dose, null); assert.ok(r.lockReasons.length);
  assert.equal(recommend(P({ conditions: ['mh_susceptible'] }), 'induction', 'succinylcholine', FIXTURE).locked, true);
  assert.equal(recommend(P({ egfr: 20 }), 'emergence', 'ketorolac', FIXTURE).locked, true);
  assert.equal(recommend(P({ egfr: 30 }), 'emergence', 'ketorolac', FIXTURE).locked, false); // strict '<'
  const k = recommend(P({ conditions: ['psychosis_history'] }), 'induction', 'ketamine', FIXTURE);
  assert.equal(k.locked, false); assert.ok(k.warnings.length >= 1);
  const ci = evaluateContraindications(P({ conditions: ['heart_block'] }), 'dexmedetomidine', FIXTURE);
  assert.deepEqual(ci.map((c) => c.severity), ['lock']);
  const none = recommend(P(), 'rescue', 'propofol', FIXTURE);
  assert.equal(none.available, false); assert.equal(none.dose, null);
});

test('fixture: ceilings cap recommendations; unknown fields do not crash', () => {
  const lib = { ...FIXTURE, DRUGS: FIXTURE.DRUGS.map((d) => (d.id === 'lidocaine' ? { ...d, futureField: 1, ceiling: { ...d.ceiling, weird: true }, regimens: { ...d.regimens, maintenance: { ...d.regimens.maintenance, mystery: 2 } } } : d)) };
  const p = P({ heightCm: 200, weightKg: 120 }, lib);
  const r = recommend(p, 'maintenance', 'lidocaine', lib);
  assert.ok(r.rate.absolute.value <= 120 + 1e-6, `rate ${r.rate.absolute.value} mg/h`);
  assert.ok(r.warnings.some((w) => /capped/.test(w)));
  assert.ok(devWarnings().some((w) => /weird|mystery/.test(w)));
});

if (REAL) {
  const R = (over = {}) => derivePatient(basePatient(over), { library: REAL });

  test('real library: every drug/regimen recommends without throwing; sources exist', () => {
    const pts = [R(), R({ ageYears: 80, asa: 3, egfr: 20 }), R({ weightKg: 45, heightCm: 150, sex: 'female' }), R({ weightKg: 160, heightCm: 175 })];
    for (const p of pts) for (const d of REAL.DRUGS) for (const key of Object.keys(d.regimens)) {
      const r = recommend(p, key, d.id, REAL);
      for (const s of r.sources) assert.ok(REAL.SOURCES[s], `${d.id}.${key} source ${s}`);
      if (!r.locked) assert.ok(r.dose || r.rate || r.loading, `${d.id}.${key} has a value`);
    }
  });

  test('real library: adjustments incl. weight<N, OR lists, note-only, own unit', () => {
    const light = R({ weightKg: 45, heightCm: 155, sex: 'female' });
    const apap = recommend(light, 'rescue', 'acetaminophen', REAL);
    close(apap.dose.value, 15 * 45, 0.5); assert.ok(apap.dose.perKg);
    const keto = recommend(R({ ageYears: 70 }), 'rescue', 'ketorolac', REAL);
    assert.equal(keto.dose.value, 15);
    const mid = recommend(R({ ageYears: 70 }), 'sedation_moderate', 'midazolam', REAL);
    assert.equal(mid.dose.value, recommend(R(), 'sedation_moderate', 'midazolam', REAL).dose.value); // note-only adjust keeps base dose
    assert.ok(mid.notes.some((n) => n.startsWith('Adjustment')));
  });

  test('real library: loading doses exposed (dexmedetomidine, propofol sedation)', () => {
    const d = recommend(R(), 'sedation_moderate', 'dexmedetomidine', REAL);
    assert.ok(d.loading); assert.equal(d.loading.unit, 'mcg'); close(d.loading.value, 1 * 80, 0.1); assert.equal(d.loading.overSec, 600);
    const de = recommend(R({ ageYears: 70 }), 'sedation_moderate', 'dexmedetomidine', REAL);
    close(de.loading.value, 0.5 * 80, 0.1);
    const pr = recommend(R(), 'sedation_moderate', 'propofol', REAL);
    assert.ok(pr.loading && pr.loading.value > 0 && pr.loading.overSec >= 180);
  });

  test('real library: ceiling scopes (per bolus, rate, hardMax, lesser-of, adjusted daily)', () => {
    const p = R();
    const phe = interpretCeilings(REAL.DRUGS.find((x) => x.id === 'phenylephrine'), p);
    assert.ok(phe.some((l) => l.type === 'bolus' && l.absolute === 200));
    assert.ok(phe.some((l) => l.type === 'rate' && l.value === 200 && l.rateUnit === 'mcg/min'));
    assert.ok(!phe.some((l) => l.type === 'cumulative'));
    const lido = interpretCeilings(REAL.DRUGS.find((x) => x.id === 'lidocaine'), p);
    assert.equal(lido.filter((l) => l.type === 'rate').length, 2);
    const big = R({ heightCm: 200, weightKg: 130 });
    const lr = recommend(big, 'maintenance', 'lidocaine', REAL);
    assert.ok(lr.rate.absolute.value <= 120 + 1e-6);
    const apap = interpretCeilings(REAL.DRUGS.find((x) => x.id === 'acetaminophen'), R({ weightKg: 45, heightCm: 155, sex: 'female' }));
    assert.ok(apap.some((l) => l.type === 'cumulative' && Math.abs(l.absolute - 75 * 45) < 1e-6 && l.daily));
    const keto = interpretCeilings(REAL.DRUGS.find((x) => x.id === 'ketorolac'), R({ ageYears: 70 }));
    assert.equal(keto[0].absolute, 60);
    const neo = interpretCeilings(REAL.DRUGS.find((x) => x.id === 'neostigmine'), p);
    assert.equal(neo.filter((l) => l.type === 'cumulative').length, 2);
  });

  test('real library: required locks', () => {
    const mh = R({ conditions: ['mh_susceptible'] });
    for (const id of ['succinylcholine', 'sevoflurane', 'desflurane', 'isoflurane']) if (REAL.DRUGS.some((d) => d.id === id)) assert.ok(evaluateContraindications(mh, id, REAL).some((c) => c.severity === 'lock'), id);
    assert.ok(evaluateContraindications(R({ conditions: ['heart_block'] }), 'dexmedetomidine', REAL).some((c) => c.severity === 'lock'));
    assert.ok(evaluateContraindications(R({ egfr: 25 }), 'ketorolac', REAL).some((c) => c.severity === 'lock'));
  });

  test('real library: sevoflurane age-adjusted MAC offered (Mapleson 1996)', () => {
    const r = recommend(R({ ageYears: 40 }), 'maintenance', 'sevoflurane', REAL);
    close(r.rate.ageAdjustedMac.exact, 1.8, 1e-9);
    const o = recommend(R({ ageYears: 80 }), 'maintenance', 'sevoflurane', REAL);
    close(o.rate.ageAdjustedMac.exact, 1.8 * Math.pow(10, -0.00269 * 40), 1e-9);
  });
}

for (const { name, lib } of LIBS) {
  test(`${name}: recommend is pure (no mutation of library)`, () => {
    const before = JSON.stringify(lib.DRUGS);
    for (const d of lib.DRUGS) for (const k of Object.keys(d.regimens)) recommend(P({ ageYears: 75 }, lib), k, d.id, lib);
    assert.equal(JSON.stringify(lib.DRUGS), before);
  });
}
