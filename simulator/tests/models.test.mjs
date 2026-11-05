// Model-extension tests: Eleveld 2018 propofol PK (implementation verification against
// published reference values), epinephrine, IV fluid bolus, parameter inventory, and the
// awake room-air SpO2 regression. node:test, no dependencies.
// "Verification" here means the code reproduces published numbers; it is NOT validation of
// the simulator against patients.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eleveldPropofol, alSallamiFfm, ELEVELD_2018, CompartmentModel } from '../engine/pk.js';
import { createSimulation, FLUID_MODEL } from '../engine/sim.js';
import { derivePatient } from '../engine/patient.js';
import { recommend } from '../engine/dosing.js';
import { PROVENANCE } from '../engine/inventory.js';
import { EXAMPLE_PATIENTS } from '../data/scenarios.js';
import { REAL, basePatient, runFor } from './helpers.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const REF = { ageYears: 35, weightKg: 70, heightCm: 170, sex: 'male' };

// ---------------------------------------------------------------- Eleveld 2018
test('Eleveld 2018: reference individual reproduces published typical values (no concomitant drugs)', () => {
  // Published reference values (Eleveld 2018 abstract/Table 2; Q2 1.83 per the corrigendum; ke0 Table 3 arterial).
  const e = eleveldPropofol({ ...REF, opioids: false });
  near(e.v1, 6.28, 0.005, 'V1'); near(e.v2, 25.5, 0.05, 'V2'); near(e.v3, 273, 0.5, 'V3');
  near(e.cl, 1.79, 0.005, 'CL'); near(e.q2, 1.83, 0.005, 'Q2 (corrigendum)'); near(e.q3, 1.11, 0.005, 'Q3');
  near(e.ke0, 0.146, 1e-9, 'ke0 arterial');
  near(eleveldPropofol({ ...REF, sex: 'female', opioids: false }).cl, 2.10, 0.005, 'female CLref (Θ15)');
  assert.ok(alSallamiFfm('male', 70, 170, 35) > 40 && alSallamiFfm('male', 70, 170, 35) < 70, 'Al-Sallami FFM plausible');
});

test('Eleveld 2018: reference individual with concomitant opioids (published equations)', () => {
  // With the opioid switch: CL = 1.79·exp(−0.00286·35), V3 = 273·exp(−0.0138·35). Values match the
  // stanpumpR digest computation (CL 1.619, V3 168.2 with full-precision thetas, Q3 0.771).
  const e = eleveldPropofol({ ...REF, opioids: true });
  near(e.cl, 1.79 * Math.exp(-0.00286 * 35), 1e-9, 'CL formula'); near(e.cl, 1.619, 0.001, 'CL');
  near(e.v3, 168.2, 0.5, 'V3'); near(e.q3, 0.771, 0.003, 'Q3');
  // Derived (not published as a table value): bolus time to peak Ce ≈ 2.9 min at the reference.
  const r = eleveldPropofol({ ...REF, opioids: false });
  const m = new CompartmentModel({ v1L: r.v1, k10: r.k10, k12: r.k12, k21: r.k21, k13: r.k13, k31: r.k31, ke0: r.ke0 });
  m.bolus(140); let peak = 0, tPeak = 0;
  for (let i = 1; i <= 1200; i++) { m.step(1 / 60); if (m.ce > peak) { peak = m.ce; tPeak = i / 60; } }
  near(tPeak, 2.9, 0.2, 'tPeak (min)');
  assert.ok(Math.abs(m.massBalanceError()) < 1e-6);
});

test('Eleveld 2018: covariate sanity (age, weight, sex, venous form)', () => {
  const young = eleveldPropofol({ ...REF, opioids: true }), old = eleveldPropofol({ ...REF, ageYears: 80, opioids: true });
  assert.ok(old.v2 < young.v2 && old.cl < young.cl && old.v3 < young.v3, 'older: smaller V2, V3 and CL (with opioids)');
  const noOpOld = eleveldPropofol({ ...REF, ageYears: 80, opioids: false });
  near(noOpOld.cl, young.cl / Math.exp(-0.00286 * 35), 1e-9, 'without opioids CL has no adult age term');
  const heavy = eleveldPropofol({ ...REF, weightKg: 140, opioids: false });
  assert.ok(heavy.v1 < 2 * 6.28 && heavy.v1 > 6.28, 'V1 saturates with weight (sigmoid)');
  near(heavy.ke0, 0.146 * Math.pow(2, -0.25), 1e-9, 'ke0 weight scaling');
  const ven = eleveldPropofol({ ...REF, venous: true, opioids: false });
  near(ven.ke0, ELEVELD_2018.PD.ke0Venous, 1e-9, 'venous ke0'); near(ven.q2, 1.83 * 0.68, 0.01, 'venous Q2');
  for (const k of ['v1', 'v2', 'v3', 'cl', 'q2', 'q3', 'ke0']) assert.ok(Number.isFinite(heavy[k]) && heavy[k] > 0);
  assert.throws(() => eleveldPropofol({ ...REF, weightKg: NaN }));
});

if (REAL) {
  test('real library: propofol uses Eleveld; covariates and opioid switch from the plan; calibrated fallback kept', () => {
    const prop = REAL.DRUGS.find((d) => d.id === 'propofol');
    assert.equal(prop.pkModel, 'eleveld'); assert.equal(prop.pkModelFallback, 'calibrated');
    assert.ok(prop.pkModelInfo.sources.every((s) => REAL.SOURCES[s]));
    const p = derivePatient(basePatient(), { library: REAL });
    const a = createSimulation({ patient: p, library: REAL });
    a.administer({ drugId: 'propofol', kind: 'bolus', amount: 160, amountUnit: 'mg' });
    runFor(a, 120);
    const info = a.modelInfo();
    assert.equal(info.propofol.type, 'eleveld');
    assert.ok(/verification only/i.test(info.propofol.provenance) && !/\bvalidated\b/i.test(info.propofol.provenance));
    assert.ok(a.state.drugs.propofol.ce > 0 && a.state.vitals.depthIndex < 80, 'bolus deepens');
    assert.equal(a.models.propofol.params.opioids, false);
    const b = createSimulation({ patient: p, library: REAL, plan: { mode: 'GA', steps: [{ phase: 'induction', atSec: 0, drugId: 'fentanyl', kind: 'bolus', amount: 100, amountUnit: 'mcg' }] } });
    b.administer({ drugId: 'propofol', kind: 'bolus', amount: 160, amountUnit: 'mg' });
    assert.equal(b.models.propofol.params.opioids, true);
    // fallback still works
    const lib2 = { ...REAL, DRUGS: REAL.DRUGS.map((d) => (d.id === 'propofol' ? { ...d, pkModel: d.pkModelFallback } : d)) };
    const c = createSimulation({ patient: derivePatient(basePatient(), { library: lib2 }), library: lib2 });
    c.administer({ drugId: 'propofol', kind: 'bolus', amount: 160, amountUnit: 'mg' }); runFor(c, 60);
    assert.equal(c.modelInfo().propofol.type, 'calibrated');
  });

  // ---------------------------------------------------------------- epinephrine
  test('epinephrine: label regimens, route, ceilings; no IV push dose', () => {
    const epi = REAL.DRUGS.find((d) => d.id === 'epinephrine');
    assert.ok(epi);
    assert.deepEqual(epi.regimens.rescue.fixed, { default: 0.3, min: 0.3, max: 0.5, unit: 'mg' });
    assert.equal(epi.regimens.rescue.route, 'IM');
    assert.deepEqual([epi.regimens.maintenance.rate.min, epi.regimens.maintenance.rate.max, epi.regimens.maintenance.rate.unit], [0.05, 2, 'mcg/kg/min']);
    assert.equal(epi.regimens.maintenance.scalar, 'IBW');
    assert.equal(epi.ceiling.value, 0.5); assert.equal(epi.ceiling.scope, 'per bolus');
    assert.ok(!epi.bolusRoutes.includes('IV'));
    const p = derivePatient(basePatient(), { library: REAL });
    const rec = recommend(p, 'rescue', 'epinephrine', REAL);
    assert.equal(rec.route, 'IM'); assert.equal(rec.dose.value, 0.3);
    const sim = createSimulation({ patient: p, library: REAL });
    const iv = sim.administer({ drugId: 'epinephrine', kind: 'bolus', amount: 0.3, amountUnit: 'mg', route: 'IV' });
    assert.ok(iv.blocked && /push-dose/i.test(iv.reasons[0]));
    assert.ok(sim.administer({ drugId: 'epinephrine', kind: 'bolus', amount: 0.6, amountUnit: 'mg' }).blocked, 'above 0.5 mg per injection');
    assert.ok(sim.administer({ drugId: 'epinephrine', kind: 'infusion', rate: 2.5, rateUnit: 'mcg/kg/min' }).blocked, 'above 2 mcg/kg/min');
    const cad = derivePatient(basePatient({ conditions: ['cad'] }), { library: REAL });
    assert.ok(recommend(cad, 'rescue', 'epinephrine', REAL).warnings.some((w) => /coronary artery disease/.test(w)));
  });

  test('epinephrine raises MAP and HR (IM bolus and infusion)', () => {
    const p = derivePatient(basePatient(), { library: REAL });
    const ctrl = createSimulation({ patient: p, library: REAL, seed: 4 }); runFor(ctrl, 600);
    const im = createSimulation({ patient: p, library: REAL, seed: 4 });
    assert.ok(im.administer({ drugId: 'epinephrine', kind: 'bolus', amount: 0.3, amountUnit: 'mg' }).ok);
    let maxMap = 0, maxHr = 0; for (let i = 0; i < 600; i++) { im.step(1); maxMap = Math.max(maxMap, im.state.vitals.map); maxHr = Math.max(maxHr, im.state.vitals.hr); }
    assert.ok(maxMap > p.map * 1.12, `IM MAP rise ${maxMap} vs ${p.map}`);
    assert.ok(maxHr > p.baseline.hr * 1.1, `IM HR rise ${maxHr}`);
    assert.ok(Math.abs(im.state.drugs.epinephrine.cumulative - 0.3) < 1e-9);
    const inf = createSimulation({ patient: p, library: REAL, seed: 4 });
    assert.ok(inf.administer({ drugId: 'epinephrine', kind: 'infusion', rate: 0.1, rateUnit: 'mcg/kg/min' }).ok);
    runFor(inf, 600);
    assert.ok(inf.state.vitals.map > ctrl.state.vitals.map + 5 && inf.state.vitals.hr > ctrl.state.vitals.hr + 3);
  });

  test('epinephrine reverses the bronchospasm and anaphylaxis scenario effects', () => {
    const p = derivePatient(basePatient(), { library: REAL });
    const run = (scen, epi, mg) => { const s = createSimulation({ patient: p, library: REAL, seed: 3 }); s.inject(scen); runFor(s, 90); if (epi) s.administer({ drugId: 'epinephrine', kind: 'bolus', amount: mg, amountUnit: 'mg' }); runFor(s, 300); return s; };
    const b0 = run('bronchospasm', false), b1 = run('bronchospasm', true, 0.3);
    assert.ok(b1.lastEffects.bronchodilation > 0.5);
    assert.ok(b1.state.vitals.spo2 > b0.state.vitals.spo2 + 10 && b1.state.vitals.etco2 < b0.state.vitals.etco2, 'oxygenation/CO2 improve');
    const a0 = run('anaphylaxis_hypotension', false), a1 = run('anaphylaxis_hypotension', true, 0.5);
    assert.ok(a1.state.vitals.map > a0.state.vitals.map + 20 && a1.state.vitals.spo2 > a0.state.vitals.spo2);
  });

  // ---------------------------------------------------------------- fluids
  test('fluid bolus: allowed sizes, cumulative tracking, log and summary', () => {
    const p = derivePatient(basePatient(), { library: REAL });
    const s = createSimulation({ patient: p, library: REAL });
    assert.equal(s.state.fluids.crystalloidMl, 0);
    assert.ok(!s.action('fluid_bolus:300').ok && !s.action('fluid_bolus:abc').ok);
    assert.ok(s.action('fluid_bolus:250').ok); assert.ok(s.action('fluid_bolus').ok);
    assert.equal(s.state.fluids.crystalloidMl, 250 + FLUID_MODEL.DEFAULT_ML);
    assert.equal(s.state.fluids.boluses.length, 2);
    runFor(s, 1200);
    assert.equal(s.state.fluids.infusingMl, 0);
    assert.ok(s.state.log.some((l) => /run-in complete/.test(l.message)));
    const sum = s.summary();
    assert.equal(sum.fluids.crystalloidMl, 750); assert.equal(sum.fluids.perKgBasis, 'TBW');
  });

  test('fluid bolus raises MAP more in hemorrhage than when euvolaemic; capped', () => {
    const p = derivePatient(basePatient(), { library: REAL });
    const gain = (hem, ml = [500]) => {
      const run = (fl) => { const s = createSimulation({ patient: p, library: REAL, seed: 2 }); if (hem) s.inject('hemorrhage'); runFor(s, 600); if (fl) for (const m of ml) s.action(`fluid_bolus:${m}`); runFor(s, 900); return s.phys.map; };
      return run(true) - run(false);
    };
    const gHem = gain(true), gEu = gain(false);
    assert.ok(gHem > 3 * gEu && gHem > 5, `hemorrhage gain ${gHem} vs euvolaemic ${gEu}`);
    assert.ok(gEu > 0 && gEu < 0.05 * p.map, 'small effect when euvolaemic');
    const g1 = gain(true, [500]), g2 = gain(true, [500, 500]), g4 = gain(true, [500, 500, 500, 500]);
    assert.ok(g2 > g1 && (g2 - g1) > (g4 - g2) / 2, 'diminishing returns');
    // cap: fluids never fully cancel the hemorrhage (≤ 80 % of the event offset)
    const s = createSimulation({ patient: p, library: REAL, seed: 2 }); s.inject('hemorrhage'); runFor(s, 600);
    for (let i = 0; i < 12; i++) s.action('fluid_bolus:500');
    runFor(s, 900); assert.ok(s.phys.map < p.map, 'still below baseline with ongoing hemorrhage');
    const dep = derivePatient(basePatient({ conditions: ['hypovolemia'] }), { library: REAL });
    const dg = (() => { const a = createSimulation({ patient: dep, library: REAL, seed: 2 }); const b = createSimulation({ patient: dep, library: REAL, seed: 2 }); b.action('fluid_bolus:500'); runFor(a, 900); runFor(b, 900); return b.phys.map - a.phys.map; })();
    assert.ok(dg > gEu, 'hypovolemia condition: larger response than euvolaemic');
  });

  test('fluid bolus: sepsis context note at ≥ 30 mL/kg cites the guideline source', () => {
    const p = derivePatient(basePatient({ weightKg: 40, heightCm: 160, conditions: ['sepsis'] }), { library: REAL });
    const s = createSimulation({ patient: p, library: REAL });
    let msg = ''; for (let i = 0; i < 3; i++) msg = s.action('fluid_bolus:500').message;
    assert.ok(/Surviving Sepsis/.test(msg) && /\[S43\]/.test(msg));
  });

  // ---------------------------------------------------------------- inventory
  test('parameter inventory: every parameter has a provenance and existing sourceIds; modelInfo stays drug-keyed', () => {
    const p = derivePatient(basePatient(), { library: REAL });
    const s = createSimulation({ patient: p, library: REAL });
    s.administer({ drugId: 'propofol', kind: 'bolus', amount: 160, amountUnit: 'mg' }); runFor(s, 30);
    const info = s.modelInfo();
    assert.deepEqual(Object.keys(info), ['propofol'], 'enumerable keys are drug ids only');
    const inv = info.inventory;
    assert.ok(Array.isArray(inv) && inv.length > 200);
    assert.deepEqual(inv, s.parameterInventory());
    for (const x of inv) {
      const L = `${x.component}/${x.drugId || ''}/${x.name}`;
      assert.ok(PROVENANCE.includes(x.provenance), `${L}: provenance ${x.provenance}`);
      assert.ok(Array.isArray(x.sourceIds), `${L}: sourceIds array`);
      for (const id of x.sourceIds) assert.ok(REAL.SOURCES[id], `${L}: source ${id} exists`);
      if (x.provenance !== 'author_estimate_unvalidated') assert.ok(x.sourceIds.length > 0 || x.citationRegistered === false, `${L}: sourced or flagged unregistered`);
      assert.ok(x.value !== undefined && x.value !== null && x.name, `${L}: value`);
      assert.ok(!/(?<!not |un|never )\bvalidated\b|\bpredictive\b|\baccurate\b/i.test(`${x.note}`), `${L}: wording`);
    }
    for (const comp of ['pk', 'pd', 'physiology', 'fluids', 'scenario', 'alarm', 'interlock', 'extubation']) assert.ok(inv.some((x) => x.component === comp), `component ${comp}`);
    assert.ok(inv.some((x) => x.drugId === 'propofol' && x.provenance === 'published_model' && x.verification === true), 'Eleveld verification entry');
    assert.ok(inv.filter((x) => x.component === 'pd').every((x) => x.provenance === 'author_estimate_unvalidated'));
    assert.ok(inv.some((x) => x.name === 'hr_critical_low' && x.value === 48 && x.provenance === 'project_config'));
    assert.ok(info.propofol.parameters.length > 0);
  });
}

// ---------------------------------------------------------------- physiology regression
test('awake, room air, no drugs: SpO2 stays within 2 % of baseline for every example patient (10 min)', () => {
  for (const ep of EXAMPLE_PATIENTS) {
    const s = createSimulation({ patient: derivePatient(ep.patient, REAL ? { library: REAL } : undefined), ...(REAL ? { library: REAL } : {}) });
    let min = 100, max = 0;
    for (let i = 0; i < 600; i++) { s.step(1); min = Math.min(min, s.state.vitals.spo2); max = Math.max(max, s.state.vitals.spo2); }
    assert.ok(min >= ep.patient.baseline.spo2 - 2 && max <= ep.patient.baseline.spo2 + 2, `${ep.id}: SpO2 ${min}–${max} vs baseline ${ep.patient.baseline.spo2}`);
  }
});

if (REAL) {
  test('equivalent apnoea: obese patient desaturates faster than non-obese', () => {
    const timeTo90 = (over) => {
      const p = derivePatient(basePatient(over), { library: REAL });
      const s = createSimulation({ patient: p, library: REAL });
      s.action('set_fio2:1'); s.action('mask_ventilate'); runFor(s, 180); s.action('mask_ventilate');
      s.administer({ drugId: 'propofol', kind: 'bolus', amount: 2 * p.weightKg, amountUnit: 'mg' });
      s.administer({ drugId: 'rocuronium', kind: 'bolus', amount: 0.6 * p.weightKg, amountUnit: 'mg' });
      for (let i = 1; i < 1800; i++) { s.step(1); if (s.state.vitals.spo2 < 90) return i; }
      return 1800;
    };
    const lean = timeTo90({ weightKg: 75 }), obese = timeTo90({ weightKg: 135 });
    assert.ok(obese < lean * 0.8, `obese ${obese}s vs lean ${lean}s`);
  });
}
