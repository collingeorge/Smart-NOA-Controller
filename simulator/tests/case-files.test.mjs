import assert from 'node:assert/strict';
import test from 'node:test';
import * as lib from '../data/drugs.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { PALLIATIVE_CASES } from '../data/palliative.js';
import { derivePatient } from '../engine/patient.js';
import { decodeCase, encodeCase } from '../ui/case-files.js';
import { planIssues, stepsFromBuiltPlan } from '../ui/plan-model.js';

const example = EXAMPLE_PATIENTS[0];
const patient = derivePatient(example.patient, { library: lib });
const ctx = { lib, patient, interlocks: true, patientVersion: 1 };
const setup = {
  module: 'periop',
  patient: example.patient,
  plan: buildPlan(EXAMPLE_PLANS.find((item) => item.patientId === example.id), patient, lib).plan,
};

test('a perioperative example round trips with timing and units and remains runnable through the plan checks', () => {
  const { plan, patient: input } = decodeCase(encodeCase(setup), lib);
  assert.deepEqual(input, example.patient);
  assert.equal(plan.steps.length, setup.plan.steps.length);
  assert.deepEqual(plan.steps.map(({ atSec, amount, amountUnit, rate, rateUnit, overSec }) => [atSec, amount, amountUnit, rate, rateUnit, overSec]),
    setup.plan.steps.map(({ atSec, amount, amountUnit, rate, rateUnit, overSec }) => [atSec, amount, amountUnit, rate, rateUnit, overSec]));
  assert.equal(planIssues(ctx, { ...plan, steps: stepsFromBuiltPlan(ctx, plan) }).errors, 0);
});

test('an imported editable dose still goes through the normal plan guard', () => {
  const bad = structuredClone(setup);
  const step = { phase: 'induction', kind: 'bolus', drugId: 'lidocaine', regimenKey: 'induction',
    amount: 1e8, amountUnit: 'mg', atSec: 0, overSec: 600 };
  bad.plan.steps.push(step);
  const { plan } = decodeCase(encodeCase(bad), lib);
  assert.ok(planIssues(ctx, { ...plan, steps: stepsFromBuiltPlan(ctx, plan) }).errors > 0);
  step.drugId = 'unknown';
  assert.throws(() => decodeCase(encodeCase(bad), lib), /Plan step/);
});

test('palliative setup preserves its scenario and discards imported approval and runtime state', () => {
  for (const module of ['pain', 'eol']) {
    const example = PALLIATIVE_CASES.find((item) => item.module === module);
    const text = encodeCase({ module, exampleId: example.id, patient: example.patient,
      plan: { ...example.plan, ack: true, sim: { playing: true } } });
    const result = decodeCase(text, lib);
    assert.equal(result.exampleId, example.id);
    assert.equal(result.plan.ack, false);
    assert.equal(result.plan.sim, undefined);
  }
});

test('unrecognized formats, incomplete patients and excessive step counts are refused', () => {
  assert.throws(() => decodeCase('{}', lib), /supported Smart NOA/);
  assert.throws(() => decodeCase(encodeCase({ ...setup, patient: {} }), lib), /invalid/);
  assert.throws(() => decodeCase(encodeCase({ ...setup, plan: { mode: 'GA', steps: Array(201).fill(setup.plan.steps[0]) } }), lib), /200/);
});
