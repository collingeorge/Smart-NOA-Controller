import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePatient } from '../engine/patient.js';
import { createSimulation } from '../engine/sim.js';
import { recommend, interpretCeilings } from '../engine/dosing.js';
import { CompartmentModel, VolatileModel, fitCalibrated, curveMetrics, macForAge, MARSH_1991, createPkModel, GENERIC_ILLUSTRATIVE } from '../engine/pk.js';
import { severinghaus } from '../engine/physiology.js';
import { AlarmManager } from '../engine/alarms.js';
import { SCENARIOS, EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan, overSecFromTiming } from '../data/scenarios.js';
import { basePatient, FIXTURE, LIBS, runFor, track } from './helpers.mjs';

// ------------------------------------------------------------------ PK sanity
test('PK: bolus rises then falls, never negative, mass balance holds', () => {
  const fit = fitCalibrated({ onsetMin: 1, peakMin: 3, durationMin: 30 });
  const m = new CompartmentModel({ v1L: 20, k10: fit.k10, k12: fit.k12, k21: fit.k21, ke0: fit.ke0 });
  m.bolus(100);
  const ce = [];
  for (let i = 0; i < 120 * 60; i++) { m.step(1 / 60); ce.push(m.ce); assert.ok(m.cp >= 0 && m.ce >= 0 && m.a2 >= 0); }
  const iPeak = ce.indexOf(Math.max(...ce));
  assert.ok(iPeak > 10 && iPeak < 20 * 60, `peak at ${iPeak}s`);
  assert.ok(ce[ce.length - 1] < 0.2 * ce[iPeak]);
  assert.ok(Math.abs(m.massBalanceError()) < 1e-9 * 100);
  assert.ok(m.cp < 100 / 20);
});

test('PK: infusion approaches steady state Css = R/(k10·V1); stop → decline', () => {
  const m = new CompartmentModel({ v1L: 10, k10: 0.2, k12: 0.1, k21: 0.05, ke0: 0.5 });
  m.setInfusion(2);
  for (let i = 0; i < 600; i++) m.step(1);
  const css = 2 / (0.2 * 10);
  assert.ok(Math.abs(m.cp - css) / css < 0.01, `cp ${m.cp} vs ${css}`);
  assert.ok(Math.abs(m.ce - css) / css < 0.01);
  assert.ok(Math.abs(m.massBalanceError()) < 1e-6);
  const peak = m.cp; m.setInfusion(0); for (let i = 0; i < 30; i++) m.step(1);
  assert.ok(m.cp < peak);
  assert.throws(() => m.setInfusion(-1)); assert.throws(() => m.bolus(NaN)); assert.throws(() => m.step(0));
});

test('PK: calibrated fit reproduces label timing (onset/peak/duration within a factor of 2)', () => {
  for (const t of [{ onsetMin: 1, peakMin: 3, durationMin: 31 }, { onsetMin: 0.5, peakMin: 1, durationMin: 8 }, { onsetMin: 4, peakMin: 15, durationMin: 60 }]) {
    const f = fitCalibrated(t);
    for (const [k, v] of [['onset', t.onsetMin], ['peak', t.peakMin], ['duration', t.durationMin]]) assert.ok(f.metrics[k] / v < 2 && f.metrics[k] / v > 0.5, `${k} ${f.metrics[k]} vs ${v}`);
  }
  const g = fitCalibrated(null);
  assert.equal(g.k10, GENERIC_ILLUSTRATIVE.k10); assert.match(g.provenance, /illustrative/);
  // closed form agrees with the numerical model
  const p = fitCalibrated({ onsetMin: 1, peakMin: 3, durationMin: 31 });
  const m = new CompartmentModel({ v1L: 1, ...p }); m.bolus(1); let peak = 0;
  for (let i = 0; i < 40 * 60; i++) { m.step(1 / 60); peak = Math.max(peak, m.ce); }
  assert.ok(Math.abs(peak - curveMetrics(p, 300).peakValue) / peak < 0.02);
});

test('PK: Marsh parameters wired; volatile wash-in/out; Mapleson MAC', () => {
  const d = { id: 'propofol', pkModel: 'marsh', regimens: { induction: { kind: 'bolus', perKg: { default: 2 }, unit: 'mg/kg' } }, amountUnit: 'mg' };
  const pk = createPkModel(d, { weightKg: 70, ageYears: 40 });
  assert.equal(pk.type, 'marsh'); assert.ok(Math.abs(pk.model.v1L - MARSH_1991.v1PerKg * 70) < 1e-9);
  assert.ok(pk.ref.value > 0);
  const v = new VolatileModel({ macAge: 2 }); v.setDial(2);
  for (let i = 0; i < 30; i++) v.step(1, 1);
  assert.ok(v.et > 1.95 && v.et <= 2); assert.ok(v.macFraction > 0.9);
  v.setDial(0); for (let i = 0; i < 30; i++) v.step(1, 1); assert.ok(v.et < 0.05);
  const n = new VolatileModel({ macAge: 2 }); n.setDial(2); for (let i = 0; i < 10; i++) n.step(1, 0); assert.equal(n.et, 0); // no uptake without ventilation
  assert.ok(Math.abs(macForAge(1.8, 40) - 1.8) < 1e-12);
  assert.ok(Math.abs(macForAge(1.8, 80) - 1.8 * Math.pow(10, -0.00269 * 40)) < 1e-12);
});

test('Severinghaus curve and overSec parsing', () => {
  assert.ok(Math.abs(severinghaus(100) - 97.7) < 0.3);
  assert.ok(Math.abs(severinghaus(60) - 90.6) < 0.6);
  assert.ok(Math.abs(severinghaus(27) - 50) < 3);
  assert.equal(overSecFromTiming('Loading infusion over 10 minutes'), 600);
  assert.equal(overSecFromTiming('Inject over 30–60 seconds.'), 60);
  assert.equal(overSecFromTiming('give over 30 s'), null);
});

test('alarm latching until acknowledged after clearing', () => {
  const a = new AlarmManager();
  a.update(1, [{ id: 'x', priority: 'medium', message: 'm', active: true }]);
  assert.equal(a.list()[0].active, true);
  a.update(2, [{ id: 'x', priority: 'medium', message: 'm', active: false }]);
  assert.equal(a.list().length, 1); assert.equal(a.list()[0].active, false); // latched
  a.acknowledge('x'); assert.equal(a.list().length, 0);
  a.update(3, [{ id: 'y', priority: 'high', message: 'h', active: true }]);
  a.acknowledge('y'); assert.equal(a.list()[0].acknowledged, true);
  a.update(4, [{ id: 'y', priority: 'high', message: 'h', active: false }]); assert.equal(a.list().length, 0);
  a.pulse(5, 'z', 'low', 'p'); a.update(5, []); assert.equal(a.list()[0].active, true);
  a.update(6, []); assert.equal(a.list()[0].active, false);
  assert.equal(a.history.length, 3);
});

// ------------------------------------------------------------------ physiology & full runs per library
for (const { name, lib } of LIBS) {
  const P = (over = {}) => derivePatient(basePatient(over), { library: lib });
  const sim0 = (over = {}, opts = {}) => createSimulation({ patient: P(over), seed: 7, library: lib, ...opts });
  const give = (sim, drugId, key, extra = {}) => {
    const r = recommend(sim.patient, key, drugId, lib);
    return sim.administer({ drugId, kind: 'bolus', amount: r.dose.value, amountUnit: r.dose.unit, ...extra });
  };
  const timeToSpo2 = (sim, thr, max = 1800) => { for (let i = 0; i < max; i++) { sim.step(1); if (sim.state.vitals.spo2 < thr) return sim.state.tSec; } return Infinity; };

  test(`${name}: propofol bolus lowers depth index and MAP`, () => {
    const sim = sim0(); runFor(sim, 30);
    const d0 = sim.state.vitals.depthIndex, m0 = sim.state.vitals.map;
    assert.ok(give(sim, 'propofol', 'induction').ok);
    runFor(sim, 180);
    assert.ok(sim.state.vitals.depthIndex < d0 - 25, `depth ${sim.state.vitals.depthIndex}`);
    assert.ok(sim.state.vitals.map < m0 - 8, `map ${sim.state.vitals.map}`);
    assert.ok(['deep', 'general'].includes(sim.state.vitals.sedationLevel));
    assert.ok(sim.state.drugs.propofol.cp > 0 && sim.state.drugs.propofol.unitConc > 0.3);
  });

  test(`${name}: apnoea without ventilation lowers SpO2 and raises EtCO2; ventilation restores`, () => {
    const sim = sim0(); runFor(sim, 10);
    give(sim, 'fentanyl', 'induction'); give(sim, 'propofol', 'induction'); give(sim, 'rocuronium', 'induction');
    const et0 = sim.state.vitals.etco2;
    const t = timeToSpo2(sim, 90, 900);
    assert.ok(t < 900, 'desaturated on room air');
    assert.equal(sim.state.vitals.rr, 0);
    assert.ok(sim.state.vitals.etco2 > et0);
    assert.ok(sim.state.alarms.some((a) => a.id === 'apnea' && a.priority === 'high'));
    assert.ok(sim.state.alarms.some((a) => a.id === 'spo2_low' && a.active));
    sim.action('set_fio2:1'); assert.ok(sim.action('mask_ventilate').ok);
    runFor(sim, 120);
    assert.ok(sim.state.vitals.spo2 >= 95, `spo2 ${sim.state.vitals.spo2}`);
    assert.ok(sim.state.alarms.find((a) => a.id === 'spo2_low').active === false); // latched until acknowledged
    assert.ok(sim.action('acknowledge:spo2_low').ok);
    assert.ok(!sim.state.alarms.some((a) => a.id === 'spo2_low'));
    sim.action('mask_ventilate'); sim.action('secure_airway'); sim.action('start_ventilation'); runFor(sim, 60);
    assert.ok(sim.state.vitals.spo2 >= 97 && sim.state.vitals.rr === 12);
  });

  test(`${name}: preoxygenation prolongs and obesity shortens time to desaturation`, () => {
    const apnoea = (over, fio2) => { const s = sim0(over); if (fio2) s.action(`set_fio2:${fio2}`); runFor(s, 180); give(s, 'propofol', 'induction'); give(s, 'rocuronium', 'induction'); return timeToSpo2(s, 90, 1800); };
    const air = apnoea({}, null), preox = apnoea({}, 1), obese = apnoea({ weightKg: 140 }, 1);
    assert.ok(preox > air + 120, `preox ${preox} vs air ${air}`);
    assert.ok(obese < preox, `obese ${obese} vs ${preox}`);
  });

  test(`${name}: rocuronium drops TOF; sugammadex restores TOFR ≥ 0.9; neostigmine ineffective at deep block`, () => {
    const sim = sim0(); give(sim, 'rocuronium', 'induction'); runFor(sim, 300);
    assert.equal(sim.state.vitals.tofCount, 0); assert.equal(sim.state.vitals.tofRatio, 0);
    const neo = sim0(); give(neo, 'rocuronium', 'induction'); runFor(neo, 300);
    const r = give(neo, 'neostigmine', 'emergence');
    assert.ok(r.ok && r.warnings.some((w) => /minimal|TOF/i.test(w)), 'runtime TOF-depth warning');
    runFor(neo, 600);
    assert.ok(neo.state.vitals.tofRatio < 0.9, `TOFR after neostigmine at deep block ${neo.state.vitals.tofRatio}`);
    const sgx = recommend(sim.patient, 'emergence', 'sugammadex', lib);
    const deep = Math.min(sgx.dose.range.max, 16 * sim.patient.weightKg);
    assert.ok(sim.administer({ drugId: 'sugammadex', kind: 'bolus', amount: Math.min(deep, 4 * sim.patient.weightKg), amountUnit: 'mg' }).ok);
    runFor(sim, 300);
    assert.ok(sim.state.vitals.tofRatio >= 0.9, `TOFR ${sim.state.vitals.tofRatio}`);
    assert.equal(sim.extubationReadiness().criteria.find((c) => c.id === 'tofr').met, true);
  });

  test(`${name}: neostigmine helps at minimal depth (shallow recovery)`, () => {
    const mk = () => { const s = sim0(); give(s, 'rocuronium', 'induction'); runFor(s, 300); assert.equal(s.state.vitals.tofCount, 0); for (let i = 0; i < 7200 && !(s.state.vitals.tofCount === 4 && s.state.vitals.tofRatio >= 0.4); i++) s.step(1); return s; };
    const a = mk(), b = mk();
    assert.ok(b.state.vitals.tofRatio >= 0.4 && b.state.vitals.tofRatio < 0.9);
    const r = give(b, 'neostigmine', 'emergence'); assert.ok(r.ok); assert.ok(!r.warnings.some((w) => /minimal depth/i.test(w) && /TOFR 0\.[0-3]/.test(w)));
    runFor(a, 600); runFor(b, 600);
    assert.ok(b.state.vitals.tofRatio >= a.state.vitals.tofRatio);
  });

  test(`${name}: determinism — same seed identical trace, different seed differs`, () => {
    const run = (seed) => { const s = createSimulation({ patient: P(), seed, library: lib }); give(s, 'propofol', 'induction'); return track(s, 300, (st) => [st.vitals.hr, st.vitals.map, st.vitals.spo2, st.vitals.depthIndex, st.vitals.etco2].join(',')); };
    assert.deepEqual(run(11), run(11));
    assert.notDeepEqual(run(11), run(12));
  });

  test(`${name}: full GA run (healthy adult example plan) completes and is extubation-ready`, () => {
    const tpl = EXAMPLE_PLANS.find((p) => p.id === 'ga_healthy');
    const pat = derivePatient(EXAMPLE_PATIENTS.find((p) => p.id === tpl.patientId).patient, { library: lib });
    const { plan } = buildPlan(tpl, pat, lib);
    assert.ok(plan.steps.length >= 5);
    for (const s of plan.steps) if (s.kind === 'bolus') assert.ok(s.amount > 0 && s.amountUnit);
    const sim = createSimulation({ patient: pat, plan, seed: 1, library: lib });
    runFor(sim, 60); sim.setPhase('induction'); sim.action('set_fio2:1'); runFor(sim, 240);
    assert.equal(sim.state.vitals.sedationLevel, 'general');
    assert.ok(sim.action('secure_airway').ok); assert.ok(sim.action('start_ventilation').ok);
    assert.equal(sim.state.surgery.stimulus, 'laryngoscopy');
    sim.setPhase('maintenance'); runFor(sim, 300); sim.action('start_surgery'); runFor(sim, 1800);
    assert.ok(sim.state.vitals.depthIndex < 60);
    sim.action('end_surgery'); sim.setPhase('emergence');
    let ready = false; for (let i = 0; i < 1800 && !ready; i++) { sim.step(1); ready = sim.extubationReadiness().ready; }
    assert.ok(ready, JSON.stringify(sim.extubationReadiness()));
    sim.action('stop_ventilation'); assert.ok(sim.action('extubate').ok); runFor(sim, 300);
    const sum = sim.summary();
    assert.ok(sum.totals.propofol.amount > 0 && sum.totals.rocuronium.perKg > 0);
    assert.ok(sum.durationSec > 3000); assert.ok(sum.minSpo2 >= 90);
    assert.equal(sum.extubation.ready, true);
    assert.ok(sim.planStatus().every((s) => s.status === 'done'));
    for (const v of Object.values(sim.state.vitals)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
    assert.ok(JSON.stringify(sum));
  });

  test(`${name}: MAC run (obese OSA, moderate target) completes; deep-sedation alarm`, () => {
    const tpl = EXAMPLE_PLANS.find((p) => p.id === 'mac_obese_osa');
    const pat = derivePatient(EXAMPLE_PATIENTS.find((p) => p.id === tpl.patientId).patient, { library: lib });
    const { plan } = buildPlan(tpl, pat, lib);
    const sim = createSimulation({ patient: pat, plan, seed: 5, library: lib });
    sim.action('set_fio2:0.3'); sim.setPhase('sedation'); runFor(sim, 1200);
    assert.ok(sim.state.vitals.depthIndex < 95);
    assert.ok(sim.state.drugs.propofol.cumulative > 0);
    give(sim, 'propofol', 'induction'); runFor(sim, 120);
    assert.ok(sim.state.alarms.some((a) => a.id === 'depth_over_target'));
    sim.action('jaw_thrust'); runFor(sim, 300); sim.setPhase('emergence'); runFor(sim, 900);
    const s = sim.summary(); assert.ok(s.durationSec > 2000);
  });

  test(`${name}: all example patients/plans build; locked drugs skipped`, () => {
    for (const tpl of EXAMPLE_PLANS) {
      const pat = derivePatient(EXAMPLE_PATIENTS.find((p) => p.id === tpl.patientId).patient, { library: lib });
      const { plan } = buildPlan(tpl, pat, lib);
      const sim = createSimulation({ patient: pat, plan, library: lib });
      for (const ph of ['premed', tpl.mode === 'MAC' ? 'sedation' : 'induction', 'maintenance', 'emergence']) { sim.setPhase(ph); runFor(sim, 200); }
      assert.ok(!sim.planStatus().some((s) => s.status === 'blocked'), `${tpl.id}: ${JSON.stringify(sim.planStatus().filter((s) => s.status === 'blocked'))}`);
    }
    const mh = derivePatient(basePatient({ conditions: ['mh_susceptible'] }), { library: lib });
    const { plan, skipped } = buildPlan({ mode: 'GA', steps: [{ phase: 'induction', atSec: 0, drugId: 'succinylcholine', regimenKey: 'induction', kind: 'bolus' }, { phase: 'maintenance', atSec: 0, drugId: 'sevoflurane', regimenKey: 'maintenance', kind: 'inhaled' }] }, mh, lib);
    assert.equal(plan.steps.length, 0); assert.equal(skipped.length, 2);
  });

  test(`${name}: plan scheduler is phase-relative and ordered`, () => {
    const plan = { mode: 'GA', steps: [
      { id: 'b', phase: 'induction', atSec: 30, order: 2, drugId: 'rocuronium', kind: 'bolus', amount: 10, amountUnit: 'mg' },
      { id: 'a', phase: 'induction', atSec: 30, order: 1, drugId: 'fentanyl', kind: 'bolus', amount: 50, amountUnit: 'mcg' },
      { id: 'c', phase: 'induction', atSec: 0, order: 3, drugId: 'propofol', kind: 'bolus', amount: 0.05, amountUnit: 'g' },
    ] };
    const sim = createSimulation({ patient: P(), plan, library: lib });
    runFor(sim, 100); assert.ok(sim.planStatus().every((s) => s.status === 'pending'));
    sim.setPhase('induction'); runFor(sim, 10);
    assert.equal(sim.state.drugs.propofol.cumulative, 50);
    runFor(sim, 30);
    const doses = sim.state.log.filter((l) => l.kind === 'dose').map((l) => l.message.split(' ')[0]);
    assert.deepEqual(doses, ['Propofol', 'Fentanyl', 'Rocuronium']);
  });

  test(`${name}: ceilings — cumulative/per-bolus blocked, range warnings, timed loading`, () => {
    const sim = sim0();
    const capped = lib.DRUGS.find((d) => interpretCeilings(d, sim.patient).some((l) => l.type === 'cumulative' && !l.daily));
    const L = interpretCeilings(capped, sim.patient).find((l) => l.type === 'cumulative');
    assert.ok(sim.administer({ drugId: capped.id, kind: 'bolus', amount: L.absolute * 0.6, amountUnit: capped.amountUnit }).ok);
    const r = sim.administer({ drugId: capped.id, kind: 'bolus', amount: L.absolute * 0.6, amountUnit: capped.amountUnit });
    assert.equal(r.blocked, true, capped.id); assert.match(r.reasons[0], /Cumulative/);
    assert.ok(sim.state.alarms.some((a) => a.id === 'dose_blocked'));
    if (lib.DRUGS.some((d) => d.id === 'phenylephrine' && d.ceiling && d.ceiling.scope)) {
      const pb = sim.administer({ drugId: 'phenylephrine', kind: 'bolus', amount: 300, amountUnit: 'mcg' });
      assert.equal(pb.blocked, true); assert.match(pb.reasons[0], /Single dose/);
      assert.equal(sim.administer({ drugId: 'phenylephrine', kind: 'infusion', rate: 250, rateUnit: 'mcg/min' }).blocked, true);
    }
    const w = sim.administer({ drugId: 'propofol', kind: 'bolus', amount: 20, amountUnit: 'mg' });
    assert.ok(w.ok && w.warnings.some((x) => /outside the sourced/.test(x)));
    assert.ok(sim.state.alarms.some((a) => a.id === 'dose_range'));
    assert.equal(sim.administer({ drugId: 'nope', kind: 'bolus', amount: 1 }).blocked, true);
    assert.equal(sim.administer({ drugId: 'propofol', kind: 'bolus', amount: -1 }).blocked, true);
    assert.equal(sim.administer({ drugId: 'propofol', kind: 'infusion', rate: 1000, rateUnit: 'mcg/kg/min' }).blocked, true);
    const t = sim0(); t.administer({ drugId: 'propofol', kind: 'bolus', amount: 40, amountUnit: 'mg', overSec: 240 });
    runFor(t, 120); const c = t.state.drugs.propofol.cumulative; assert.ok(c > 15 && c < 25, `timed cumulative ${c}`);
    runFor(t, 200); assert.ok(Math.abs(t.state.drugs.propofol.cumulative - 40) < 1e-6);
  });

  test(`${name}: scenarios inject and perturb in the expected direction`, () => {
    for (const sc of SCENARIOS) {
      const sim = sim0(); runFor(sim, 30);
      const v0 = { ...sim.state.vitals };
      assert.ok(sim.inject(sc.id).ok, sc.id);
      assert.ok(sc.description && sc.teachingPoint);
      runFor(sim, 200);
      const v = sim.state.vitals;
      if (sc.id === 'hemorrhage') { assert.ok(v.map < v0.map - 5 && v.hr > v0.hr + 5); }
      if (sc.id === 'vagal_bradycardia') assert.ok(sim.summary().minHr < v0.hr * 0.7);
      if (sc.id === 'anaphylaxis_hypotension') assert.ok(v.map < v0.map - 15);
      if (sc.id === 'light_anesthesia_stimulus') assert.ok(sim.summary().maxHr > v0.hr + 5);
      if (sc.id.endsWith('sensor_fault') || sc.id === 'spo2_probe_off') assert.ok(sim.state.log.some((l) => l.kind === 'event'));
    }
    const s = sim0(); s.inject('spo2_probe_off'); runFor(s, 5); assert.ok(Number.isNaN(s.state.vitals.spo2)); assert.equal(s.state.sensors.spo2, 'fault');
    assert.equal(s.inject('nonexistent').ok, false);
  });

  test(`${name}: laryngospasm armed until extubation, broken by succinylcholine/propofol`, () => {
    const sim = sim0(); give(sim, 'propofol', 'induction'); give(sim, 'rocuronium', 'induction');
    sim.action('set_fio2:1'); sim.action('secure_airway'); sim.action('start_ventilation'); runFor(sim, 60);
    sim.inject('laryngospasm_on_extubation'); runFor(sim, 30);
    assert.ok(sim.state.vitals.spo2 >= 97);
    sim.administer({ drugId: 'sugammadex', kind: 'bolus', amount: 4 * sim.patient.weightKg, amountUnit: 'mg' }); runFor(sim, 900);
    sim.action('stop_ventilation'); sim.action('extubate');
    sim.action('set_fio2:0.21'); runFor(sim, 60);
    const sp = sim.state.vitals.spo2;
    assert.ok(sim.state._dummy === undefined);
    const tr = sim.phys.out._true; assert.ok(tr.veff < 0.05, 'no ventilation during laryngospasm');
    give(sim, 'propofol', 'induction', { amount: 20, amountUnit: 'mg' });
    sim.action('set_fio2:1'); sim.action('mask_ventilate'); runFor(sim, 120);
    assert.ok(sim.state.vitals.spo2 >= sp);
  });

  test(`${name}: TOFR < 0.9 at extubation raises high alarm`, () => {
    const sim = sim0(); give(sim, 'rocuronium', 'induction'); sim.action('secure_airway'); runFor(sim, 60);
    sim.action('extubate');
    assert.ok(sim.state.alarms.some((a) => a.id === 'tofr_extubation' && a.priority === 'high'));
    assert.equal(sim.summary().extubation.ready, false);
  });

  test(`${name}: inhaled agents — additive MAC (sevo + N2O), FiO2 constraint, MH lock for desflurane`, () => {
    const mk = () => { const s = sim0(); s.action('set_fio2:1'); give(s, 'propofol', 'induction'); give(s, 'rocuronium', 'induction'); s.action('secure_airway'); s.action('start_ventilation'); return s; };
    const sevo = mk(); sevo.administer({ drugId: 'sevoflurane', kind: 'inhaled', rate: 1, rateUnit: '%' }); runFor(sevo, 1800);
    const both = mk(); both.administer({ drugId: 'sevoflurane', kind: 'inhaled', rate: 1, rateUnit: '%' });
    const n = both.administer({ drugId: 'nitrous_oxide', kind: 'inhaled', rate: 70, rateUnit: '%' });
    assert.ok(n.ok, JSON.stringify(n)); assert.ok(Math.abs(both.state.airway.fio2 - 0.3) < 1e-9); assert.ok(n.warnings.some((w) => /FiO2 reduced/.test(w)));
    runFor(both, 1800);
    const mS = sevo.state.drugs.sevoflurane.unitConc, mN = both.state.drugs.nitrous_oxide.unitConc;
    assert.ok(mS > 0.4 && mN > 0.5);
    assert.ok(both.state.vitals.depthIndex < sevo.state.vitals.depthIndex, `${both.state.vitals.depthIndex} vs ${sevo.state.vitals.depthIndex}`);
    assert.equal(both.action('set_fio2:0.5').ok, false);
    assert.equal(both.administer({ drugId: 'nitrous_oxide', kind: 'inhaled', rate: 75, rateUnit: '%' }).blocked, true);
    const f = sim0(); f.action('set_fio2:0.8');
    const blk = f.administer({ drugId: 'nitrous_oxide', kind: 'inhaled', rate: 75, rateUnit: '%' });
    assert.equal(blk.blocked, true); assert.ok(f.state.alarms.some((a) => a.id === 'fio2_n2o' || a.id === 'dose_blocked'));
    const mh = sim0({ conditions: ['mh_susceptible'] });
    for (const id of ['desflurane', 'sevoflurane', 'succinylcholine']) {
      const r = id === 'succinylcholine' ? mh.administer({ drugId: id, kind: 'bolus', amount: 50, amountUnit: 'mg' }) : mh.administer({ drugId: id, kind: 'inhaled', rate: 1, rateUnit: '%' });
      assert.equal(r.blocked, true, id);
    }
    const des = mk(); const dr = des.administer({ drugId: 'desflurane', kind: 'inhaled', rate: 6, rateUnit: '%' });
    assert.ok(dr.ok && dr.warnings.length >= 1, 'rapid increase warning from library runtime rule');
    assert.equal(des.administer({ drugId: 'sevoflurane', kind: 'infusion', rate: 1, rateUnit: '%' }).blocked, true);
  });
}
