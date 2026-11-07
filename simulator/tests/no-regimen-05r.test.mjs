// 05r: a drug × administration kind with no sourced regimen is refused cleanly (robustness; the UI never
// offers these). Before 05r a bolus on an inhaled agent threw "model.model.bolus is not a function".
// Also: guided/automatic modes refuse to start while interlocks are suspended (engine message, shown by the UI).
// EDUCATIONAL SIMULATION — fictional patients — not a medical device. Software checks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, noRegimenReason } from '../engine/sim.js';
import { derivePatient } from '../engine/patient.js';
import { listDrugs } from '../engine/library.js';
import { isInhaled } from '../engine/pk.js';
import { createAutoRunner, SUSPENDED_START_MESSAGE } from '../engine/autorun.js';
import { basePatient, LIBS } from './helpers.mjs';

const KINDS = ['bolus', 'infusion', 'inhaled'];
/** Independent statement of "has a sourced regimen for this kind" (bolus: a bolus regimen or a loading dose). */
const hasRegimen = (drug, kind) => Object.values(drug.regimens || {}).some((r) => r && (r.kind === kind || (kind === 'bolus' && r.loading)));
const cmdFor = (drug, kind, ds) => (kind === 'bolus' ? { drugId: drug.id, kind, amount: 1, amountUnit: drug.amountUnit }
  : kind === 'inhaled' ? { drugId: drug.id, kind, rate: 1, rateUnit: '%' }
    : { drugId: drug.id, kind, rate: 1, rateUnit: ds.rateUnit || `${drug.amountUnit}/kg/h` });
const snapshot = (sim, id) => JSON.stringify({ drug: sim.state.drugs[id], log: sim.doseLog.length, bolus: sim.bolusGiven[id] || 0, timed: sim.timed.length, depots: sim.depots.length });

for (const { name, lib } of LIBS) {
  test(`[${name}] every drug × kind without a sourced regimen is refused cleanly; nothing is administered`, () => {
    let combos = 0;
    for (const interlocks of [true, false]) {
      for (const drug of listDrugs(lib)) {
        for (const kind of KINDS) {
          if (hasRegimen(drug, kind)) continue;
          combos += 1;
          const sim = createSimulation({ patient: derivePatient(basePatient(), { library: lib }), seed: 3, library: lib, interlocks });
          sim.step(1);
          const before = snapshot(sim, drug.id);
          let r;
          assert.doesNotThrow(() => { r = sim.administer(cmdFor(drug, kind, sim.state.drugs[drug.id])); }, `${drug.id} ${kind}`);
          assert.equal(r.ok, false, `${drug.id} ${kind}`); assert.equal(r.blocked, true, `${drug.id} ${kind}`);
          assert.match(r.reasons[0], /no sourced (bolus for an inhaled agent|bolus regimen|infusion regimen)|is an inhaled agent|is not an inhaled agent/, `${drug.id} ${kind}: ${r.reasons[0]}`);
          if (kind === 'bolus' && isInhaled(drug)) assert.equal(r.reasons[0], `${drug.name}: no sourced bolus for an inhaled agent`);
          assert.equal(snapshot(sim, drug.id), before, `${drug.id} ${kind}: state changed`);
          sim.step(1); // the engine keeps running
          assert.ok(Number.isFinite(sim.state.tSec));
        }
      }
    }
    assert.ok(combos > 0);
  });

  test(`[${name}] noRegimenReason: null where a regimen (or a loading dose for a bolus) exists`, () => {
    for (const drug of listDrugs(lib)) {
      if (hasRegimen(drug, 'bolus')) assert.equal(noRegimenReason(drug, 'bolus'), null, drug.id);
      if (hasRegimen(drug, 'infusion')) assert.equal(noRegimenReason(drug, 'infusion'), null, drug.id);
    }
  });
}

test('the inhaled agents of the real library all refuse a bolus without throwing (sevoflurane, desflurane, isoflurane, nitrous oxide)', () => {
  const real = LIBS.find((x) => x.name === 'real'); if (!real) return;
  const ids = listDrugs(real.lib).filter(isInhaled).map((d) => d.id);
  for (const id of ['sevoflurane', 'desflurane', 'isoflurane', 'nitrous_oxide']) assert.ok(ids.includes(id), id);
  for (const id of ids) {
    const sim = createSimulation({ patient: derivePatient(basePatient(), { library: real.lib }), seed: 1, library: real.lib });
    const r = sim.administer({ drugId: id, kind: 'bolus', amount: 1 });
    assert.equal(r.ok, false); assert.match(r.reasons[0], /no sourced bolus for an inhaled agent$/);
  }
});

test('guided/automatic modes refuse to start while interlocks are suspended, with the exact engine message', () => {
  assert.equal(SUSPENDED_START_MESSAGE, 'Interlocks are suspended (manual override). End the suspension, or let it expire, before starting guided or automatic mode.');
  const { lib } = LIBS[LIBS.length - 1];
  for (const mode of ['guided', 'full']) {
    const sim = createSimulation({ patient: derivePatient(basePatient(), { library: lib }), seed: 1, library: lib });
    assert.equal(sim.action('suspend_interlocks:60:teaching test').ok, true);
    const r = createAutoRunner({ sim, mode }).start();
    assert.equal(r.ok, false); assert.equal(r.refused, 'interlocks_suspended'); assert.equal(r.message, SUSPENDED_START_MESSAGE);
    assert.ok(sim.core.suspended, 'the suspension is not discarded');
  }
});
