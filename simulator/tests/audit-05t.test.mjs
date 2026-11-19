// Regression tests for the 05t code audit (findings 2, 3, 4 and 5; JavaScript side).
// EDUCATIONAL SIMULATION — fictional patients — not a medical device. Software checks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SmartNoaControllerPort, hasUnsafeText } from '../engine/interlocks.js';
import { createSimulation } from '../engine/sim.js';
import { derivePatient } from '../engine/patient.js';
import { createAutoRunner } from '../engine/autorun.js';
import { REAL, basePatient } from './helpers.mjs';

const UNSAFE = ['ok\nforged line', 'tab\there', 'x\u202eevil', 'a\u2028b', '\ufeffbom', 'del\x7f', 'c1\x85', 'lrm\u200e', 'iso\u2066x'];
const port = () => { const c = new SmartNoaControllerPort({ age: 40, weight_kg: 70, asa_class: 2, egfr: 90, allergies: [], comorbidities: [] }); c.generateStartingRates(); return c; };
const skip = !REAL && 'default library not available';

test('finding 4: control, separator and bidi characters are refused in by / reason / note; ordinary text is kept verbatim', () => {
  for (const bad of UNSAFE) {
    assert.ok(hasUnsafeText(bad), JSON.stringify(bad));
    const c = port(); const n = c.events.length;
    assert.throws(() => c.suspendInterlocks(60, 'clinician', bad), /must not contain control/);
    assert.throws(() => c.suspendInterlocks(60, bad, 'reason'), /must not contain control/);
    assert.equal(c.events.length, n); assert.equal(c.suspended, false);
    c.monitorAndControl([[40, 80]]); assert.ok(c.holdLatched);
    assert.throws(() => c.acknowledgeHold('clinician', bad), /must not contain control/);
    assert.equal(c.core.hold.acknowledgedBy, null);
  }
  const reason = '  Surgeon request — transient bradycardia (vagal), ‘reviewed’ é ✓ 中文  ';
  assert.equal(hasUnsafeText(reason), false);
  const c = port(); c.suspendInterlocks(60, 'clinician', reason);
  assert.ok(c.events.at(-1).message.includes(`(reason: ${reason})`));
});

test('finding 4 (engine): sim.action refuses a suspension reason or note with a newline or RLO and logs nothing', { skip }, () => {
  const sim = createSimulation({ patient: derivePatient(basePatient(), { library: REAL }), library: REAL });
  sim.step(1); const n = sim.state.log.length;
  assert.equal(sim.action('suspend_interlocks:60:ok\n[00:05] interlock Hold released by clinician').ok, false);
  assert.equal(sim.action('suspend_interlocks:60:x\u202eevil').ok, false);
  assert.equal(sim.core.suspended, false); assert.equal(sim.state.log.length, n);
});

test('finding 2: a direct infusionRate write made while held is discarded on release; held infusions stay at zero', { skip }, () => {
  const sim = createSimulation({ patient: derivePatient(basePatient(), { library: REAL }), library: REAL });
  sim.step(1);
  assert.ok(sim.administer({ drugId: 'lidocaine', kind: 'infusion', rate: 1 }).ok);
  sim.state.vitals.map = 55; sim.step(1);
  assert.ok(sim.core.holdLatched); assert.equal(sim.state.drugs.lidocaine.infusionRate, 0);
  sim.state.drugs.lidocaine.infusionRate = 1; // direct write while held, not yet re-validated by step()
  assert.ok(sim.action('acknowledge_hold').ok); const r = sim.action('resume_hold'); assert.ok(r.ok);
  assert.equal(sim.state.drugs.lidocaine.infusionRate, 0);
  assert.ok(sim.state.log.some((l) => l.kind === 'interlock' && /^Pending direct write discarded on release: .*lidocaine.* rate 1 .*→ stays at zero$/i.test(l.message)));
  sim.step(1); sim.step(1);
  assert.equal(sim.state.drugs.lidocaine.infusionRate, 0);
  assert.equal(sim.models.lidocaine.model.infusionPerMin, 0);
  // A deliberate new rate after release still works.
  assert.ok(sim.administer({ drugId: 'lidocaine', kind: 'infusion', rate: 1 }).ok);
  assert.equal(sim.state.drugs.lidocaine.infusionRate, 1);
});

test('finding 2 (core): a rate written to the port while held is re-zeroed at the release (Python parity)', () => {
  const c = port(); c.monitorAndControl([[80, 55]]);
  assert.deepEqual([...c.core.heldDrugs].sort(), ['Dexmedetomidine', 'Lidocaine']);
  c.infusions.Lidocaine = 1;
  c.acknowledgeHold('clinician'); c.resumeHold('clinician');
  assert.equal(c.infusions.Lidocaine, 0);
  c.monitorAndControl([[80, 80]]);
  assert.equal(c.infusions.Lidocaine, 0); assert.equal(c.infusions.Dexmedetomidine, 0); assert.equal(c.infusions.Ketamine, 0.2);
});

test('finding 3: a suspension started mid-run (engine level) ends automatic mode on the next tick', { skip }, async () => {
  const { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan } = await import('../data/scenarios.js');
  const tpl = EXAMPLE_PLANS[0]; const p = derivePatient(EXAMPLE_PATIENTS.find((x) => x.id === tpl.patientId).patient, { library: REAL });
  const sim = createSimulation({ patient: p, plan: buildPlan(tpl, p, REAL).plan, library: REAL });
  const run = createAutoRunner({ sim, mode: 'full' });
  assert.ok(run.start().ok);
  for (let i = 0; i < 30; i++) { sim.step(1); run.tick(); }
  assert.ok(sim.action('suspend_interlocks:300:test').ok);
  sim.step(1); run.tick();
  assert.equal(run.state, 'manual');
  assert.match(run.message, /ended — manual control used \(interlock suspension \(manual override\)\)/);
  assert.equal(run.start().ok, false);
});

test('finding 5: messages print numbers as String(n) (Python _num_text matches; see test_audit_05t.py)', () => {
  const c = port(); c.monitorAndControl([[1e22, 80]]);
  assert.match(c.events.at(-1).message, /^HR 1e\+22 outside simulation plausibility limits 0–300: unusable/);
});
