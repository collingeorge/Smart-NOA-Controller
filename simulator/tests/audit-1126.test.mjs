// Regression tests for the 2026-11-26 external audit (findings 1-3).
// EDUCATIONAL SIMULATION — fictional patients — not a medical device. Software checks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../engine/sim.js';
import { derivePatient } from '../engine/patient.js';
import { createPalliativeSim, derivePalliative, recommendStart } from '../engine/palliative.js';
import { PALLIATIVE_CASES } from '../data/palliative.js';
import { NOA_CONFIG } from '../engine/interlocks.js';
import { REAL, basePatient, runFor } from './helpers.mjs';

const skip = !REAL && 'default library not available';
const OK = { approved: true };
const newSim = (opts = {}) => createSimulation({ patient: derivePatient(basePatient(), { library: REAL }), library: REAL, seed: 1, ...opts });
const cum = (sim, id) => sim.state.drugs[id].cumulative;

// ------------------------------------------------------------------ finding 1: timed IV doses
test('finding 1: a hold cancels the pending timed IV dose of every held drug; the delivered total stays flat', { skip }, () => {
  for (const [id, amt, unit] of [['lidocaine', 50, 'mg'], ['ketamine', 20, 'mg'], ['dexmedetomidine', 20, 'mcg']]) {
    const sim = newSim(); runFor(sim, 1);
    assert.ok(sim.administer({ drugId: id, kind: 'bolus', amount: amt, amountUnit: unit, overSec: 600 }).ok, id);
    runFor(sim, 60);
    const before = cum(sim, id);
    sim.state.vitals.hr = Number.NaN; runFor(sim, 1); // sensor fault: all three controlled agents held
    assert.ok(sim.core.holdLatched);
    assert.equal(cum(sim, id), before, `${id}: nothing delivered in the second the hold latched`);
    runFor(sim, 300);
    assert.equal(cum(sim, id), before, `${id}: delivered total flat during the hold`);
    const rec = sim.stats.timedCancellations.find((x) => x.drugId === id);
    assert.ok(rec && rec.reason === 'interlock hold' && Math.abs(rec.delivered + rec.undelivered - amt) < 1e-6 && rec.undelivered > 0, `${id}: cancellation recorded`);
    assert.ok(sim.state.log.some((l) => l.kind === 'dose' && /timed dose cancelled \(interlock hold\).*not delivered\. It does not restart/.test(l.message)), `${id}: logged`);
    assert.equal(sim.timed.filter((x) => x.drugId === id).length, 0);
    // a new dose of the held drug is refused until the hold is released; afterwards it needs a fresh action
    assert.equal(sim.administer({ drugId: id, kind: 'bolus', amount: amt / 10, amountUnit: unit }).blocked, true);
    assert.ok(sim.action('acknowledge_hold').ok); assert.ok(sim.action('resume_hold').ok);
    runFor(sim, 60); assert.equal(cum(sim, id), before, `${id}: nothing restarts after release`);
    assert.ok(sim.administer({ drugId: id, kind: 'bolus', amount: amt / 10, amountUnit: unit, overSec: 60 }).ok, `${id}: new dose after release`);
    runFor(sim, 61); assert.ok(cum(sim, id) > before);
  }
});

test('finding 1: stop cancels the pending timed IV dose and logs the undelivered amount', { skip }, () => {
  const sim = newSim(); runFor(sim, 1);
  assert.ok(sim.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 50, amountUnit: 'mg', overSec: 600 }).ok);
  runFor(sim, 120); const atStop = cum(sim, 'lidocaine');
  assert.ok(sim.administer({ drugId: 'lidocaine', kind: 'stop' }).ok);
  runFor(sim, 600);
  assert.equal(cum(sim, 'lidocaine'), atStop);
  const rec = sim.stats.timedCancellations.at(-1);
  assert.equal(rec.reason, 'stopped by the clinician'); assert.ok(Math.abs(rec.undelivered - (50 - atStop)) < 1e-6);
  assert.ok(sim.doseLog.some((d) => d.kind === 'timed_cancelled' && d.drugId === 'lidocaine'));
});

test('finding 1: a timed dose of a drug that is not held keeps running through a hold', { skip }, () => {
  const sim = newSim(); runFor(sim, 1);
  assert.ok(sim.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 50, amountUnit: 'mg', overSec: 600 }).ok);
  assert.ok(sim.administer({ drugId: 'fentanyl', kind: 'bolus', amount: 50, amountUnit: 'mcg', overSec: 300 }).ok);
  runFor(sim, 30);
  sim.state.vitals.hr = Number.NaN; runFor(sim, 1); runFor(sim, 120);
  assert.equal(sim.timed.filter((x) => x.drugId === 'lidocaine').length, 0);
  assert.ok(cum(sim, 'fentanyl') > 25, 'fentanyl (not a controlled agent) continues');
});

// ------------------------------------------------------------------ finding 3: HR/MAP holds off
test('finding 3: with the HR/MAP holds off, the rate ceiling, rate fault and sensor fail-safe still apply', { skip }, () => {
  const sim = newSim({ interlocks: false }); runFor(sim, 1);
  const r = sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.6, rateUnit: 'mcg/kg/h' });
  assert.equal(r.blocked, true); assert.match(r.reasons[0], /applies in every mode/);
  assert.ok(sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: NOA_CONFIG.simulation_rate_ceilings.Dexmedetomidine, rateUnit: 'mcg/kg/h' }).ok);
  sim.state.vitals.hr = 40; runFor(sim, 1);
  assert.equal(sim.core.holdLatched, false, 'HR < 48: no hold with the HR/MAP holds off');
  assert.ok(sim.state.drugs.dexmedetomidine.infusionRate > 0);
  assert.equal(sim.action('suspend_interlocks:60:test').ok, false, 'nothing to suspend');
  sim.state.vitals.map = Number.NaN; runFor(sim, 1);
  assert.ok(sim.core.holdLatched, 'sensor fault still latches'); assert.equal(sim.state.drugs.dexmedetomidine.infusionRate, 0);
  assert.ok(sim.state.alarms.some((a) => a.id === 'interlock_hold'));
  assert.ok(sim.action('acknowledge_hold').ok); assert.ok(sim.action('resume_hold').ok, 'release works with the holds off');
});

// ------------------------------------------------------------------ finding 2: palliative bounds
const CASE = (id) => PALLIATIVE_CASES.find((c) => c.id === id);
const pal = (id, over = {}) => { const c = CASE(id); return createPalliativeSim({ patient: derivePalliative({ ...c.patient, ...over }), caseDef: c, module: c.module, seed: 1 }); };

test('finding 2: non-numeric, non-finite and non-positive doses are refused for every case', () => {
  for (const c of PALLIATIVE_CASES) {
    for (const [dose, prnDose] of [[Infinity, 0], [Number.NaN, 0], ['5', 0], [-1, 0], [5, Infinity], [5, '2'], [5, -2]]) {
      const s = pal(c.id);
      const r = s.approveRegimen({ drugId: 'morphine', route: 'oral', dose, intervalH: 4, scheduled: true, prnDose }, OK);
      assert.equal(r.ok, false, `${c.id} ${String(dose)}/${String(prnDose)}`); assert.equal(s.state.regimen, null);
    }
  }
});

test('finding 2: opioid-naive doses must lie in the (renal-adjusted) label starting range; as-needed capped', () => {
  const s = pal('naive_ckd_inpatient'); const p = s.patient;
  const rec = recommendStart(p, 'morphine', 'oral');
  assert.equal(s.approveRegimen({ drugId: 'morphine', route: 'oral', dose: rec.dose.max + 1, intervalH: 4, scheduled: true, prnDose: 0 }, OK).ok, false);
  assert.equal(pal('naive_ckd_inpatient').approveRegimen({ drugId: 'morphine', route: 'oral', dose: 5000, intervalH: 4, scheduled: true, prnDose: 0 }, OK).ok, false);
  const hydro = recommendStart(p, 'hydromorphone', 'iv');
  assert.ok(hydro.adjusted, 'renal adjustment applies to this patient');
  const r = pal('naive_ckd_inpatient').approveRegimen({ drugId: 'hydromorphone', route: 'iv', dose: 1, intervalH: 2, scheduled: true, prnDose: 0 }, OK);
  assert.equal(r.ok, false); assert.equal(r.bound.max, hydro.dose.max);
  // scheduled: as-needed above 20% of the 24-h amount is refused; within it is accepted
  const d = rec.dose.value; const day = d * 24 / 4;
  assert.equal(pal('naive_ckd_inpatient').approveRegimen({ drugId: 'morphine', route: 'oral', dose: d, intervalH: 4, scheduled: true, prnDose: day * 0.2 + 1 }, OK).ok, false);
  const ok = pal('naive_ckd_inpatient'); assert.ok(ok.approveRegimen({ drugId: 'morphine', route: 'oral', dose: d, intervalH: 4, scheduled: true, prnDose: day * 0.1 }, OK).ok);
  assert.equal(ok.state.regimen.dose, d);
});

test('finding 2: opioid-tolerant doses are bounded by the current regimen or the engine conversion', () => {
  const s = pal('bone_pain_hospice'); const cur = s.patient.currentRegimen;
  assert.equal(s.approveRegimen({ drugId: cur.drugId, route: cur.route, dose: cur.dose * 2, intervalH: cur.intervalH, scheduled: true, prnDose: 0 }, OK).ok, false);
  assert.ok(pal('bone_pain_hospice').approveRegimen({ drugId: cur.drugId, route: cur.route, dose: cur.dose, intervalH: cur.intervalH, scheduled: true, prnDose: 0 }, OK).ok);
  // rotation: the reduction is required and the dose cannot exceed the engine's own conversion
  const e = pal('eol_dyspnoea_secretions');
  assert.match(e.approveRegimen({ drugId: 'morphine', route: 'iv', dose: 1, intervalH: 4, scheduled: true, prnDose: 0 }, OK).reason, /cross-tolerance reduction/);
  const big = pal('eol_dyspnoea_secretions').approveRegimen({ drugId: 'morphine', route: 'iv', dose: 100, intervalH: 4, scheduled: true, prnDose: 0, reductionPct: 25, ivRatio: 3 }, OK);
  assert.equal(big.ok, false); assert.match(big.reason, /engine's conversion/);
  assert.ok(pal('eol_dyspnoea_secretions').approveRegimen({ drugId: 'morphine', route: 'iv', dose: big.bound.max, intervalH: 4, scheduled: true, prnDose: 0, reductionPct: 25, ivRatio: 3 }, OK).ok);
});
