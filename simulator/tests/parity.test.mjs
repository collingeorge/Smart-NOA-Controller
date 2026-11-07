// Parity with the Python reference controller (smart_noa_controller.py / config.yaml).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NOA_CONFIG, SmartNoaControllerPort, PyPharmacokinetics, validatePyPatient, pythonLockouts, isValidReading } from '../engine/interlocks.js';
import { createSimulation } from '../engine/sim.js';
import { derivePatient } from '../engine/patient.js';
import { basePatient, LIBS, runFor } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXAMPLES = JSON.parse(readFileSync(ROOT + 'EXAMPLE_RESULTS.json', 'utf8'));
const YAML = readFileSync(ROOT + 'config.yaml', 'utf8');

const pyEvent = (e) => ({ t_sec: e.tSec, code: e.code, status: e.status, drugs: e.drugs, message: e.message });
const relClose = (a, b) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const make = ({ age = 40, weight = 70, egfr = 90, allergies = [], comorbidities = [] } = {}) => {
  const c = new SmartNoaControllerPort({ age, weight_kg: weight, asa_class: 2, egfr, allergies, comorbidities });
  c.generateStartingRates();
  return c;
};

test('NOA_CONFIG mirrors config.yaml', () => {
  const num = (key) => Number(new RegExp(`^\\s*${key}:\\s*([-0-9.]+)`, 'm').exec(YAML)[1]);
  assert.equal(num('hr_critical_low'), NOA_CONFIG.hemodynamic_thresholds.hr_critical_low);
  assert.equal(num('map_critical_low'), NOA_CONFIG.hemodynamic_thresholds.map_critical_low);
  assert.equal(num('central_volume_L_per_kg'), NOA_CONFIG.pharmacokinetics.dexmedetomidine.central_volume_L_per_kg);
  assert.equal(num('elimination_rate_constant_k10'), NOA_CONFIG.pharmacokinetics.dexmedetomidine.elimination_rate_constant_k10);
  assert.equal(num('effect_site_transfer_k1e'), NOA_CONFIG.pharmacokinetics.dexmedetomidine.effect_site_transfer_k1e);
  assert.equal(num('egfr_minimum'), NOA_CONFIG.contraindications.ketorolac.egfr_minimum);
  assert.equal(num('Dexmedetomidine'), NOA_CONFIG.simulation_rate_ceilings.Dexmedetomidine);
  assert.equal(num('Ketamine'), NOA_CONFIG.simulation_rate_ceilings.Ketamine);
  assert.equal(num('Lidocaine'), NOA_CONFIG.simulation_rate_ceilings.Lidocaine);
  assert.equal(num('geriatric_dose'), NOA_CONFIG.drug_dosing.dexmedetomidine.geriatric_dose);
  for (const k of ['hr_min', 'hr_max', 'map_min', 'map_max', 'hr_max_drop_per_sec', 'map_max_drop_per_sec']) assert.equal(num(k), NOA_CONFIG.sensor_plausibility[k], k);
  assert.deepEqual(Object.keys(NOA_CONFIG.sensor_plausibility).sort(), ['hr_max', 'hr_max_drop_per_sec', 'hr_min', 'map_max', 'map_max_drop_per_sec', 'map_min']);
  assert.equal(num('interlock_suspension_max_sec'), NOA_CONFIG.interlock_suspension_max_sec);
  assert.equal(num('interlock_long_hold_advisory_sec'), NOA_CONFIG.interlock_long_hold_advisory_sec);
  assert.match(YAML, new RegExp(`version: "${NOA_CONFIG.version}"`));
  const list = (key) => JSON.parse(new RegExp(`${key}:\\s*(\\[[^\\]]*\\])`).exec(YAML)[1]);
  assert.deepEqual(list('cardiac_conditions'), NOA_CONFIG.contraindications.dexmedetomidine.cardiac_conditions);
  assert.deepEqual(list('allergy_triggers'), NOA_CONFIG.contraindications.ketorolac.allergy_triggers);
});

for (const ex of EXAMPLES.examples) {
  test(`EXAMPLE_RESULTS ${ex.label}: lockouts, starting rates, trace, regeneration`, () => {
    const c = new SmartNoaControllerPort(ex.model_inputs);
    assert.deepEqual(c.hardLockouts, ex.lockouts);
    const starting = c.generateStartingRates();
    assert.deepEqual(starting, ex.starting);
    const w = ex.model_inputs.weight_kg;
    assert.equal(starting.Dexmedetomidine * w, ex.starting_mass_per_hour.Dexmedetomidine_mcg);
    assert.equal(starting.Ketamine * w, ex.starting_mass_per_hour.Ketamine_mg);
    assert.equal(starting.Lidocaine * w, ex.starting_mass_per_hour.Lidocaine_mg);
    const trace = c.monitorAndControl(ex.trace.map((s) => [s.hr, s.map_mmHg]));
    ex.trace.forEach((exp, i) => {
      const got = trace[i];
      assert.equal(got.status, exp.status, `step ${exp.step} status`);
      assert.equal(got.hold_latched, exp.hold_latched);
      assert.deepEqual(got.rates_before, exp.rates_before);
      assert.deepEqual(got.rates_after, exp.rates_after);
      relClose(got.Cp, exp.Cp_ng_mL); relClose(got.Ce, exp.Ce_ng_mL);
      // Auditable event log: identical codes, statuses, drugs, times and messages (Python ↔ JS).
      assert.deepEqual(got.events.map(pyEvent), exp.events, `step ${exp.step} events`);
    });
    assert.deepEqual(c.generateStartingRates(), ex.after_explicit_regeneration);
    for (const [drug, [allowed, msg]] of Object.entries(ex.unsupported_drugs)) assert.deepEqual(c.checkContraindication(drug), [allowed, msg]);
  });
}

// Scripted audit-log examples (example_walkthrough.py AUDIT_SCRIPTS): replay every op on the port; every
// event (code, status, drugs, time, message), every refusal message and the final state must match Python.
for (const ex of EXAMPLES.audit_examples) {
  test(`EXAMPLE_RESULTS audit ${ex.label}: event codes and messages identical to Python`, () => {
    const c = make();
    const refusals = [];
    for (const op of ex.ops) {
      try {
        if (op.op === 'vitals') c.monitorAndControl(op.readings);
        else if (op.op === 'steady') c.monitorAndControl(Array(op.seconds).fill(op.reading));
        else if (op.op === 'acknowledge') c.acknowledgeHold(op.by, op.note);
        else if (op.op === 'resume') c.resumeHold(op.by);
        else if (op.op === 'suspend') c.suspendInterlocks(op.seconds, op.by, op.reason);
        else if (op.op === 'end_suspension') c.endSuspension(op.by);
        else if (op.op === 'set_rate') c.infusions[op.drug] = op.rate;
        else throw new TypeError(`unknown op ${op.op}`);
      } catch (e) { if (e instanceof TypeError) throw e; refusals.push({ t_sec: c.clockSec, op: op.op, message: e.message }); }
    }
    assert.deepEqual(refusals, ex.refusals);
    assert.deepEqual(c.events.map(pyEvent), ex.events);
    assert.deepEqual({ status: c.status, hold_latched: c.holdLatched, infusions: { ...c.infusions }, suspended: c.suspended, hold_reasons: c.holdReasons }, ex.final);
  });
}

test('EXAMPLE_RESULTS exact_boundary: strict comparisons', () => {
  const b = EXAMPLES.exact_boundary;
  const c = new SmartNoaControllerPort({ age: b.age, weight_kg: 70, asa_class: 2, egfr: b.egfr, allergies: [], comorbidities: [] });
  assert.deepEqual(c.generateStartingRates(), b.starting);
  const [s] = c.monitorAndControl([[b.hr, b.map_mmHg]]);
  assert.equal(s.status, b.status);
});

// ---- test_safety_hardening.py
test('invalid readings fail safe (NaN/None/inf/string/bool)', () => {
  for (const [hr, map] of [[NaN, 80], [80, NaN], [null, 80], [80, null], [Infinity, 80], ['80', 80], [true, 80], [undefined, 80]]) {
    const c = make();
    c.monitorAndControl([[hr, map]]);
    assert.equal(c.status, 'RED'); assert.ok(c.holdLatched);
    assert.ok(Object.values(c.infusions).every((r) => r === 0));
  }
  assert.equal(isValidReading(80), true); assert.equal(isValidReading(80.5), true);
});

test('valid reading after fault does not restart', () => {
  const c = make(); c.monitorAndControl([[NaN, 80], [80, 80], [80, 80]]);
  assert.equal(c.status, 'HOLD'); assert.ok(Object.values(c.infusions).every((r) => r === 0));
});

test('locked drug cannot be infused by direct write', () => {
  const c = make({ age: 72, comorbidities: ['Heart Block'] });
  c.infusions.Dexmedetomidine = 0.5;
  c.monitorAndControl(Array(120).fill([80, 80]));
  assert.equal(c.infusions.Dexmedetomidine, 0); assert.equal(c.dexPk.Cp, 0);
});

test('held drug cannot be restarted while latched', () => {
  const c = make(); c.monitorAndControl([[40, 80]]);
  c.infusions.Dexmedetomidine = 0.5;
  c.monitorAndControl(Array(120).fill([80, 80]));
  assert.equal(c.infusions.Dexmedetomidine, 0); assert.equal(c.status, 'HOLD');
});

test('hypotension hold scope unchanged (ketamine not held)', () => {
  const c = make(); c.monitorAndControl([[80, 50]]);
  assert.equal(c.infusions.Dexmedetomidine, 0); assert.equal(c.infusions.Lidocaine, 0); assert.equal(c.infusions.Ketamine, 0.2);
});

test('runtime rate above ceiling is zeroed and latched', () => {
  for (const [drug, rate] of [['Dexmedetomidine', 1e6], ['Ketamine', 999], ['Lidocaine', 2.0], ['Lidocaine', -1], ['Ketamine', NaN]]) {
    const c = make(); c.infusions[drug] = rate;
    c.monitorAndControl([[80, 80]]);
    assert.equal(c.infusions[drug], 0); assert.equal(c.status, 'RED'); assert.ok(c.holdLatched); assert.ok(c.dexPk.Cp < 1);
  }
});

test('case-insensitive substring matching; unlisted free text not recognised; ketorolac listed once', () => {
  for (const cond of ['heart block', 'HEART BLOCK', 'Complete heart block', 'Second-degree AV block', 'Mobitz II']) assert.ok(make({ comorbidities: [cond] }).hardLockouts.includes('Dexmedetomidine'), cond);
  for (const a of ['nsaid', 'NSAIDs', 'aspirin']) assert.ok(make({ allergies: [a] }).hardLockouts.includes('Ketorolac'), a);
  assert.ok(!make({ allergies: ['Ibuprofen'] }).hardLockouts.includes('Ketorolac'));
  assert.equal(make({ egfr: 20, allergies: ['NSAID'] }).hardLockouts.filter((x) => x === 'Ketorolac').length, 1);
  assert.deepEqual(pythonLockouts({ egfr: 24, allergies: [], comorbidities: ['Heart Block'] }), ['Ketorolac', 'Dexmedetomidine']);
});

test('implausible / invalid profiles rejected', () => {
  const base = { age: 40, weight_kg: 70, asa_class: 2, egfr: 90, allergies: [], comorbidities: [] };
  for (const [f, v] of [['age', 250], ['age', -1], ['age', true], ['asa_class', 7], ['egfr', NaN], ['weight_kg', 0], ['allergies', 'NSAID'], ['comorbidities', [null]], ['age', 0.5]])
    assert.throws(() => validatePyPatient({ ...base, [f]: v }), Error, `${f}=${v}`);
});

// ---- test_revision_regressions.py
test('unknown drug is UNASSESSED; geriatric soft warning; boundary age 65', () => {
  const [ok, msg] = make().checkContraindication('unrecognized'); assert.equal(ok, false); assert.match(msg, /UNASSESSED/);
  assert.match(make({ age: 70 }).checkContraindication('Dexmedetomidine')[1], /SOFT WARNING/);
  assert.equal(make({ age: 66 }).infusions.Dexmedetomidine, 0.25);
  assert.equal(make({ age: 65 }).infusions.Dexmedetomidine, 0.5);
});

test('PK port: invalid inputs, mass balance, overflow without partial update', () => {
  for (const w of [0, -1, NaN, Infinity]) assert.throws(() => new PyPharmacokinetics(w, 1, 0.1, 0.1));
  const m = new PyPharmacokinetics(70, 1, 0.1, 0.1);
  for (const [r, dt] of [[-1, 1], [NaN, 1], [1, 0], [1, Infinity], [1, 20]]) assert.throws(() => m.updateConcentration(r, dt));
  const mb = new PyPharmacokinetics(10, 2, 0, 0);
  const [cp, ce] = mb.updateConcentration(5, 2); assert.ok(Math.abs(cp - 0.5) < 1e-12); assert.equal(ce, 0);
  const before = [mb.Cp, mb.Ce];
  assert.throws(() => mb.updateConcentration(1e308, 10));
  assert.deepEqual([mb.Cp, mb.Ce], before);
  for (const v of [[1e308, 1e308, 0, 0], [true, 1, 0, 0], [1, 1, true, 0]]) assert.throws(() => new PyPharmacokinetics(...v));
});

test('low HR hold at zero concentration; no restart; simultaneous low HR and MAP; regeneration does not bypass hold', () => {
  const a = make(); a.infusions.Dexmedetomidine = 0; a.monitorAndControl([[40, 80]]);
  assert.ok(a.holdLatched); assert.equal(a.infusions.Dexmedetomidine, 0);
  const b = make(); b.monitorAndControl([[80, 50], [80, 90]]);
  assert.equal(b.status, 'HOLD'); assert.equal(b.infusions.Dexmedetomidine, 0); assert.equal(b.infusions.Lidocaine, 0);
  const c = make(); c.monitorAndControl([[40, 50]]);
  assert.ok(c.holdLatched); assert.equal(c.status, 'RED'); assert.equal(c.infusions.Dexmedetomidine, 0); assert.equal(c.infusions.Lidocaine, 0);
  const d = make(); d.core.holdLatched = true;
  const rates = d.generateStartingRates();
  for (const k of ['Dexmedetomidine', 'Ketamine', 'Lidocaine']) assert.equal(rates[k], 0);
});

// ---- Simulator integration of the same rules
for (const { name, lib } of LIBS) {
  const P = (over = {}) => derivePatient(basePatient(over), { library: lib });
  const dexRate = (sim) => sim.state.drugs.dexmedetomidine.infusionRate;

  test(`${name}: sim sensor fault zeroes controlled infusions, latches, never auto-restarts; resume_hold is explicit`, () => {
    const sim = createSimulation({ patient: P(), seed: 2, library: lib });
    assert.ok(sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.4, rateUnit: 'mcg/kg/h' }).ok);
    assert.ok(sim.administer({ drugId: 'ketamine', kind: 'infusion', rate: 0.1, rateUnit: 'mg/kg/h' }).ok);
    runFor(sim, 5);
    assert.equal(sim.state.interlocks.status, 'GREEN');
    sim.inject('hr_sensor_fault'); runFor(sim, 3);
    assert.ok(Number.isNaN(sim.state.vitals.hr)); assert.equal(sim.state.sensors.hr, 'fault');
    assert.equal(sim.state.interlocks.status, 'RED'); assert.ok(sim.state.interlocks.holdLatched);
    assert.equal(dexRate(sim), 0); assert.equal(sim.state.drugs.ketamine.infusionRate, 0);
    assert.ok(sim.state.alarms.some((a) => a.id === 'sensor_fault_hr' && a.priority === 'high'));
    runFor(sim, 90);
    assert.equal(sim.state.sensors.hr, 'ok'); assert.equal(sim.state.interlocks.status, 'HOLD'); assert.equal(dexRate(sim), 0);
    const blocked = sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.4, rateUnit: 'mcg/kg/h' });
    assert.equal(blocked.blocked, true);
    sim.state.drugs.dexmedetomidine.infusionRate = 0.4; // direct write while latched
    runFor(sim, 2); assert.equal(dexRate(sim), 0);
    const refused = sim.action('resume_hold'); // two engine-enforced steps: acknowledge, then release
    assert.equal(refused.ok, false); assert.match(refused.message, /^Acknowledge the hold first: review the cause \(invalid sensor \(HR=unusable\)\), then resume$/);
    assert.equal(sim.state.interlocks.holdLatched, true);
    assert.ok(sim.action('acknowledge_hold').ok);
    assert.ok(sim.action('resume_hold').ok);
    assert.equal(sim.action('resume_hold').ok, false, 'the acknowledgment is consumed by the release');
    runFor(sim, 2);
    assert.equal(sim.state.interlocks.status, 'GREEN'); assert.equal(dexRate(sim), 0); // no automatic restart
    assert.ok(sim.state.log.some((l) => l.kind === 'interlock' && /resume_hold/.test(l.message)));
    assert.ok(sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.4, rateUnit: 'mcg/kg/h' }).ok);
  });

  test(`${name}: sim HR < 48 holds dexmedetomidine only; MAP < 60 holds dex + lidocaine, not ketamine`, () => {
    const sim = createSimulation({ patient: P(), seed: 4, library: lib });
    sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.3, rateUnit: 'mcg/kg/h' });
    sim.administer({ drugId: 'ketamine', kind: 'infusion', rate: 0.1, rateUnit: 'mg/kg/h' });
    sim.administer({ drugId: 'lidocaine', kind: 'infusion', rate: 1, rateUnit: 'mg/kg/h' });
    sim.inject('vagal_bradycardia'); runFor(sim, 60);
    assert.ok(sim.summary().minHr < 48);
    assert.equal(dexRate(sim), 0); assert.ok(sim.state.drugs.ketamine.infusionRate > 0); assert.ok(sim.state.drugs.lidocaine.infusionRate > 0);
    assert.deepEqual(sim.state.interlocks.heldDrugs, ['dexmedetomidine']);
    const s2 = createSimulation({ patient: P(), seed: 4, library: lib });
    s2.administer({ drugId: 'ketamine', kind: 'infusion', rate: 0.1, rateUnit: 'mg/kg/h' });
    s2.administer({ drugId: 'lidocaine', kind: 'infusion', rate: 1, rateUnit: 'mg/kg/h' });
    s2.inject('anaphylaxis_hypotension'); runFor(s2, 240);
    assert.equal(s2.state.drugs.lidocaine.infusionRate, 0); assert.ok(s2.state.drugs.ketamine.infusionRate > 0);
  });

  test(`${name}: Python simulation ceilings apply only with interlocks on; label ceilings always`, () => {
    const on = createSimulation({ patient: P(), library: lib });
    const r1 = on.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.6, rateUnit: 'mcg/kg/h' });
    assert.equal(r1.blocked, true); assert.match(r1.reasons[0], /Python simulation ceiling/);
    assert.ok(on.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.5, rateUnit: 'mcg/kg/h' }).ok); // strict '>'
    // stepping at exactly the ceiling must not latch a hold, at any weight (2026-11 audit, code finding 1)
    for (const weightKg of [55.3, 60, 62, 71.9, 80, 97.1, 133.7]) {
      for (const [id, rate, unit] of [['dexmedetomidine', 0.5, 'mcg/kg/h'], ['ketamine', 0.2, 'mg/kg/h'], ['lidocaine', 1.5, 'mg/kg/h']]) {
        const sw = createSimulation({ patient: P({ weightKg }), library: lib });
        assert.ok(sw.administer({ drugId: id, kind: 'infusion', rate, rateUnit: unit }).ok, `${id} ${weightKg} kg`);
        runFor(sw, 3);
        assert.equal(sw.state.interlocks.holdLatched, false, `${id} at the ceiling, ${weightKg} kg: no hold`);
        assert.equal(sw.state.drugs[id].infusionRate, rate);
      }
    }
    runFor(on, 3); assert.equal(on.state.interlocks.holdLatched, false);
    const off = createSimulation({ patient: P(), library: lib, interlocks: false });
    assert.ok(off.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.6, rateUnit: 'mcg/kg/h' }).ok);
    assert.equal(off.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 5, rateUnit: 'mcg/kg/h' }).blocked, true); // label ceiling
    // direct write above the Python ceiling → zeroed and latched (rate fault)
    on.state.drugs.dexmedetomidine.infusionRate = 1e6; runFor(on, 2);
    assert.equal(on.state.drugs.dexmedetomidine.infusionRate, 0); assert.ok(on.state.interlocks.holdLatched);
    assert.ok(on.state.interlocks.heldDrugs.includes('dexmedetomidine'));
    // NaN direct write → rate fault
    const n = createSimulation({ patient: P(), library: lib });
    n.state.drugs.ketamine.infusionRate = NaN; runFor(n, 2);
    assert.equal(n.state.drugs.ketamine.infusionRate, 0); assert.ok(n.state.interlocks.holdLatched);
  });

  test(`${name}: lockouts enforced at administration and re-enforced every step (incl. Python free-text match)`, () => {
    const sim = createSimulation({ patient: P({ conditions: ['heart_block'], egfr: 20 }), library: lib });
    const lk = sim.state.interlocks.lockouts;
    assert.ok(lk.dexmedetomidine.some((r) => /Python controller/.test(r)));
    assert.ok(lk.ketorolac.some((r) => /Python controller/.test(r)));
    assert.equal(sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.2, rateUnit: 'mcg/kg/h' }).blocked, true);
    sim.state.drugs.dexmedetomidine.infusionRate = 0.2; runFor(sim, 1);
    assert.equal(sim.state.drugs.dexmedetomidine.infusionRate, 0);
    assert.equal(sim.state.drugs.dexmedetomidine.cumulative, 0);
  });
}
