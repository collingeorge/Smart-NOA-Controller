// November 2026 owner-approved additions (ADDITIONS_SPEC §A–F): lidocaine pretreatment, IV fluids,
// antibiotic prophylaxis, technique templates and guided/full-auto integration.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device. Passing tests checks the code;
// it does not validate the simulator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REAL, basePatient, runFor } from './helpers.mjs';
import { derivePatient } from '../engine/patient.js';
import { createSimulation, FLUID_MODEL, LIDOCAINE_RULES } from '../engine/sim.js';
import { recommend } from '../engine/dosing.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { TECHNIQUE_TEMPLATES } from '../data/templates.js';
import { buildTemplatePlan, templateOptions } from '../engine/templates.js';
import { selectProphylaxis, evaluateWindow, redoseStatus, PROPHYLAXIS_CONFIG } from '../engine/prophylaxis.js';
import { createAutoRunner } from '../engine/autorun.js';
import { NOA_CONFIG } from '../engine/interlocks.js';

const P = (over = {}) => derivePatient(basePatient(over), { library: REAL });
const EX = (id) => derivePatient(EXAMPLE_PATIENTS.find((p) => p.id === id).patient, { library: REAL });
const DONE = ['completed', 'stopped', 'manual'];
const sim0 = (patient = P(), plan = null, seed = 1) => createSimulation({ patient, plan, seed, library: REAL });

// ===================================================================== A. lidocaine pretreatment
test('A1 pretreatment regimen: propofol label dose 10 mg (1 mL of 1%), sourced to the propofol label', () => {
  const r = recommend(P(), 'pretreatment', 'lidocaine', REAL);
  assert.equal(r.kind, 'bolus'); assert.equal(r.dose.value, 10); assert.equal(r.dose.unit, 'mg');
  assert.deepEqual([r.dose.range.min, r.dose.range.max], [10, 10]);
  assert.ok(r.sources.includes('S11'));
  assert.match(REAL.SOURCES.S11.supports, /prior injection of IV lidocaine \(1 mL of a 1% solution\)/);
  assert.match(REAL.SOURCES.S11.supports, /pH 7 to 8\.5/);
  // mechanism text: never "low pH"; mentions the aqueous phase
  const note = REAL.TEMPLATE_NOTES.propofolPain.text;
  assert.match(note, /pH of 7 to 8\.5/); assert.match(note, /aqueous phase/); assert.match(note, /not caused by an acidic solution/);
  assert.doesNotMatch(note, /due to (its )?low pH|caused by (its )?low pH/i);
  // reference regimen for the lidocaine PK normalisation is unchanged (induction comes first)
  assert.deepEqual(Object.keys(REAL.DRUGS.find((d) => d.id === 'lidocaine').regimens), ['induction', 'maintenance', 'pretreatment']);
});

test('A2 pretreatment counts toward cumulative lidocaine (mg and mg/kg IBW) and is reported separately', () => {
  const p = P(); const s = sim0(p);
  assert.ok(s.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' }).ok);
  runFor(s, 5);
  assert.equal(s.state.drugs.lidocaine.cumulative, 10);
  const sum = s.summary();
  assert.equal(sum.totals.lidocaine.amount, 10);
  assert.equal(sum.lidocaine.pretreatmentMg, 10); assert.equal(sum.lidocaine.pretreatmentDoses, 1);
  assert.ok(Math.abs(sum.lidocaine.perKgIbw - 10 / p.ibwKg) < 0.01);
  assert.equal(sum.lidocaine.overlapWarning, false);
});

test('A3 Foo 2021 overlap: pretreatment + IV lidocaine infusion within the window warns (LOW alarm + log); outside it does not', () => {
  const s = sim0();
  s.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' });
  runFor(s, 60);
  const r = s.administer({ drugId: 'lidocaine', kind: 'infusion', rate: 1, rateUnit: 'mg/kg/h' });
  assert.ok(r.ok);
  assert.ok(r.warnings.some((w) => /Foo 2021/.test(w) && /cumulative lidocaine total/.test(w)), r.warnings.join(' | '));
  assert.ok(s.state.alarms.some((a) => a.id === 'lidocaine_overlap' && a.priority === LIDOCAINE_RULES.OVERLAP_ALARM_PRIORITY));
  assert.equal(s.summary().lidocaine.overlapWarning, true);
  assert.equal(s.summary().lidocaine.totalMg >= 10, true);
  // analgesic loading bolus first, then pretreatment → also warns
  const s2 = sim0();
  s2.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 50, amountUnit: 'mg', regimenKey: 'induction' });
  assert.ok(s2.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' }).warnings.some((w) => /Foo 2021/.test(w)));
  // outside the window: no warning
  const s3 = sim0();
  s3.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 10, amountUnit: 'mg', regimenKey: 'pretreatment' });
  runFor(s3, LIDOCAINE_RULES.OVERLAP_WINDOW_SEC + 2);
  assert.ok(!s3.administer({ drugId: 'lidocaine', kind: 'bolus', amount: 50, amountUnit: 'mg', regimenKey: 'induction' }).warnings.some((w) => /Foo 2021/.test(w)));
  assert.equal(LIDOCAINE_RULES.OVERLAP_WINDOW_SEC, 4 * 3600);
  assert.match(REAL.SOURCES.S1.supports, /about 4 h separation/);
});

test('A4 plan scheduler passes the regimen key, so a planned pretreatment is recognised; template places it just before propofol', () => {
  const p = EX('healthy_adult');
  const { plan } = buildTemplatePlan('ga_opioid', p, { library: REAL });
  const pre = plan.steps.find((s) => s.drugId === 'lidocaine' && s.regimenKey === 'pretreatment');
  const pro = plan.steps.find((s) => s.drugId === 'propofol' && s.regimenKey === 'induction');
  assert.ok(pre && pro); assert.equal(pre.phase, 'induction'); assert.ok(pre.atSec < pro.atSec);
  assert.equal(pre.amount, recommend(p, 'pretreatment', 'lidocaine', REAL).dose.value);
  const s = sim0(p, plan); s.setPhase('induction'); runFor(s, 240);
  assert.equal(s.summary().lidocaine.pretreatmentMg, 10);
  // the template option can be switched off
  const off = buildTemplatePlan('ga_opioid', p, { library: REAL, include: { lidocainePretreatment: false } });
  assert.ok(!off.plan.steps.some((s2) => s2.regimenKey === 'pretreatment'));
});

// ===================================================================== B. IV fluids
test('B1 fluid library: LR and 0.9% NaCl label composition and warnings, sourced', () => {
  const lr = REAL.FLUIDS.find((f) => f.id === 'lactated_ringers'); const ns = REAL.FLUIDS.find((f) => f.id === 'sodium_chloride_0_9');
  assert.equal(lr.composition.sodiumMmol, 130); assert.equal(lr.composition.potassiumMmol, 4); assert.equal(lr.composition.lactateMmol, 28); assert.equal(lr.composition.chlorideMmol, 109);
  assert.equal(ns.composition.sodiumMeq, 154); assert.equal(ns.composition.chlorideMeq, 154); assert.equal(ns.composition.osmolarityMosmolL, 308);
  assert.ok(lr.cautions.some((c) => /hyperkalemia/.test(c.message))); assert.ok(ns.labelNotes.some((n) => /hyperchloraemia/.test(n)));
  for (const f of REAL.FLUIDS) { assert.ok(f.sources.every((s) => REAL.SOURCES[s])); for (const c of f.cautions) assert.ok(c.sources.every((s) => REAL.SOURCES[s])); }
  assert.ok(REAL.FLUID_EVIDENCE_NOTE.sources.includes('S50'));
  assert.match(REAL.SOURCES.S50.citation, /N Engl J Med\. 2018;378\(9\):829-839/);
});

test('B2 fluid totals by type: boluses of each type + maintenance infusion; summary totals', () => {
  const p = P(); const s = sim0(p);
  assert.ok(s.action('fluid_bolus:500:lactated_ringers').ok);
  assert.ok(s.action('fluid_bolus:250:sodium_chloride_0_9').ok);
  assert.ok(s.action('fluid_bolus:250').ok, 'untyped bolus = default fluid');
  assert.equal(FLUID_MODEL.DEFAULT_FLUID, 'lactated_ringers');
  assert.ok(s.action('fluid_maintenance:lactated_ringers:120').ok);
  runFor(s, 1800);
  const F = s.summary().fluids;
  assert.equal(F.byType.lactated_ringers.bolusMl, 750); assert.equal(F.byType.sodium_chloride_0_9.bolusMl, 250);
  assert.ok(Math.abs(F.byType.lactated_ringers.maintenanceMl - 60) < 0.01, String(F.byType.lactated_ringers.maintenanceMl));
  assert.ok(Math.abs(F.byType.lactated_ringers.totalMl - 810) < 0.01);
  assert.equal(F.byType.sodium_chloride_0_9.maintenanceMl, 0);
  assert.ok(Math.abs(F.crystalloidMl - 1060) < 0.01);
  assert.equal(F.boluses.filter((b) => b.fluidId === 'lactated_ringers').length, 2);
  assert.equal(F.maintenance.rateMlH, 120); assert.equal(F.maintenance.fluidId, 'lactated_ringers');
});

test('B3 maintenance infusion: change type/rate, stop, validation; volume accrues at the rate across phases', () => {
  const s = sim0();
  assert.equal(s.action('fluid_maintenance:ringer:100').ok, false);
  assert.equal(s.action(`fluid_maintenance:lactated_ringers:${FLUID_MODEL.MAINTENANCE_MAX_ML_H + 1}`).ok, false);
  assert.equal(s.action('fluid_maintenance:lactated_ringers:-5').ok, false);
  assert.equal(s.action('fluid_maintenance_stop').ok, false);
  assert.ok(s.action('fluid_maintenance:sodium_chloride_0_9:60').ok);
  runFor(s, 600); s.setPhase('induction'); runFor(s, 600); s.setPhase('maintenance'); runFor(s, 600);
  assert.ok(Math.abs(s.state.fluids.byType.sodium_chloride_0_9.maintenanceMl - 30) < 0.01, 'continues across phases');
  assert.match(s.action('fluid_maintenance:lactated_ringers:240').message, /was 0\.9% sodium chloride 60 mL\/h/);
  runFor(s, 300);
  assert.ok(Math.abs(s.state.fluids.byType.lactated_ringers.maintenanceMl - 20) < 0.01);
  assert.ok(s.action('fluid_maintenance_stop').ok); runFor(s, 300);
  assert.ok(Math.abs(s.state.fluids.byType.lactated_ringers.maintenanceMl - 20) < 0.01);
  assert.equal(s.state.fluids.maintenance.rateMlH, 0);
});

test('B4 illustrative response: a maintenance infusion adds to the same volume model (more MAP support in haemorrhage); same model for both types', () => {
  const run = (cmd) => { const s = sim0(P(), null, 2); s.inject('hemorrhage'); if (cmd) s.action(cmd); runFor(s, 1800); return s.phys.map; };
  const none = run(null); const lr = run('fluid_maintenance:lactated_ringers:1000'); const ns = run('fluid_maintenance:sodium_chloride_0_9:1000');
  assert.ok(lr > none, `${lr} > ${none}`);
  assert.ok(Math.abs(lr - ns) < 1e-9, 'no type-specific physiology');
});

test('B5 label caution logged once for a matching patient (LR + hyperkalaemia); plan fluid steps run at their offsets', () => {
  const s = sim0(P({ conditions: ['hyperkalemia'] }));
  assert.match(s.action('fluid_bolus:250:lactated_ringers').message, /hyperkalemia.*\[S47\]/);
  assert.doesNotMatch(s.action('fluid_bolus:250:lactated_ringers').message, /caution/);
  const plan = { mode: 'GA', steps: [
    { id: 'f1', phase: 'premed', atSec: 0, kind: 'fluid', fluidId: 'lactated_ringers', drugId: 'lactated_ringers', rate: 100, rateUnit: 'mL/h' },
    { id: 'f2', phase: 'induction', atSec: 30, kind: 'fluid_bolus', fluidId: 'sodium_chloride_0_9', drugId: 'sodium_chloride_0_9', amount: 250, amountUnit: 'mL' },
    { id: 'f3', phase: 'emergence', atSec: 0, kind: 'fluid', fluidId: 'lactated_ringers', drugId: 'lactated_ringers', rate: 0, rateUnit: 'mL/h' },
  ] };
  const s2 = sim0(P(), plan);
  runFor(s2, 60); assert.equal(s2.state.fluids.maintenance.rateMlH, 100);
  s2.setPhase('induction'); runFor(s2, 20); assert.equal(s2.state.fluids.byType.sodium_chloride_0_9.bolusMl, 0);
  runFor(s2, 20); assert.equal(s2.state.fluids.byType.sodium_chloride_0_9.bolusMl, 250);
  s2.setPhase('emergence'); runFor(s2, 2); assert.equal(s2.state.fluids.maintenance.rateMlH, 0);
  assert.ok(s2.planStatus().every((x) => x.status === 'done'));
});

// ===================================================================== C. antibiotic prophylaxis
test('C1 guideline doses (Bratzler 2013 = S46): cefazolin 2 g / 3 g if ≥ 120 kg; clindamycin 900 mg; vancomycin 15 mg/kg', () => {
  assert.equal(recommend(P({ weightKg: 119 }), 'prophylaxis', 'cefazolin', REAL).dose.value, 2000);
  assert.equal(recommend(P({ weightKg: 120 }), 'prophylaxis', 'cefazolin', REAL).dose.value, 3000);
  assert.equal(recommend(P(), 'prophylaxis', 'clindamycin', REAL).dose.value, 900);
  assert.equal(recommend(P({ weightKg: 80 }), 'prophylaxis', 'vancomycin', REAL).dose.value, 1200);
  const by = Object.fromEntries(REAL.ANTIBIOTICS.map((a) => [a.id, a.prophylaxis]));
  assert.deepEqual([by.cefazolin.windowBeforeIncisionMin, by.cefazolin.redoseIntervalMin], [60, 240]);
  assert.deepEqual([by.clindamycin.windowBeforeIncisionMin, by.clindamycin.redoseIntervalMin], [60, 360]);
  assert.deepEqual([by.vancomycin.windowBeforeIncisionMin, by.vancomycin.redoseIntervalMin], [120, null]);
  for (const a of REAL.ANTIBIOTICS) assert.ok(a.regimens.prophylaxis.sources.includes('S46'));
  assert.match(REAL.SOURCES.S46.identifiers, /PMID 23327981/);
});

test('C2 allergy selection: severe β-lactam allergy locks cefazolin → clindamycin (vancomycin alternative); cefazolin dose blocked', () => {
  const ok = selectProphylaxis(P(), REAL);
  assert.equal(ok.drugId, 'cefazolin'); assert.deepEqual(ok.alternatives, ['clindamycin', 'vancomycin']);
  const al = P({ allergies: ['beta_lactam_severe'] });
  const sel = selectProphylaxis(al, REAL);
  assert.equal(sel.drugId, 'clindamycin'); assert.deepEqual(sel.alternatives, ['vancomycin']);
  assert.ok(sel.locked.some((l) => l.drugId === 'cefazolin' && /IgE-mediated/.test(l.reasons[0])));
  assert.ok(recommend(al, 'prophylaxis', 'cefazolin', REAL).locked);
  const s = sim0(al);
  const r = s.administer({ drugId: 'cefazolin', kind: 'antibiotic', amount: 2000, amountUnit: 'mg' });
  assert.equal(r.blocked, true); assert.equal(s.state.prophylaxis.doses.length, 0);
  // template / example plan picks clindamycin for the allergic patient
  const { plan } = buildTemplatePlan('ga_opioid', al, { library: REAL });
  assert.equal(plan.steps.find((x) => x.kind === 'antibiotic').drugId, 'clindamycin');
  assert.equal(plan.steps.find((x) => x.kind === 'antibiotic').amount, 900);
});

test('C3 window alarm: surgery started with no dose / with a dose too early → MEDIUM alarm; in window → none', () => {
  const surg = (setup) => { const s = sim0(P(), { mode: 'GA', steps: [], prophylaxisIndicated: true }); setup(s); s.action('start_surgery'); s.step(1); return s; };
  const none = surg(() => {});
  const a = none.state.alarms.find((x) => x.id === 'abx_window');
  assert.ok(a, 'alarm raised'); assert.equal(a.priority, 'medium'); assert.equal(PROPHYLAXIS_CONFIG.WINDOW_ALARM_PRIORITY.value, 'medium');
  assert.match(a.message, /^Surgery started without antibiotic prophylaxis in the recommended window/);
  assert.ok(none.state.log.some((l) => l.kind === 'alarm' && /abx|antibiotic/i.test(l.message)));
  const inWin = surg((s) => { s.administer({ drugId: 'cefazolin', kind: 'antibiotic', amount: 2000, amountUnit: 'mg' }); runFor(s, 59 * 60); });
  assert.ok(!inWin.state.alarms.some((x) => x.id === 'abx_window')); assert.equal(inWin.summary().prophylaxis.window.ok, true);
  const early = surg((s) => { s.administer({ drugId: 'cefazolin', kind: 'antibiotic', amount: 2000, amountUnit: 'mg' }); runFor(s, 61 * 60); });
  assert.ok(early.state.alarms.some((x) => x.id === 'abx_window' && /outside the 60 min window/.test(x.message)));
  const vanco = surg((s) => { s.administer({ drugId: 'vancomycin', kind: 'antibiotic', amount: 1200, amountUnit: 'mg' }); runFor(s, 90 * 60); });
  assert.ok(!vanco.state.alarms.some((x) => x.id === 'abx_window'), 'vancomycin: 120-min window');
  const clinda = surg((s) => { s.administer({ drugId: 'clindamycin', kind: 'antibiotic', amount: 900, amountUnit: 'mg' }); runFor(s, 90 * 60); });
  assert.ok(clinda.state.alarms.some((x) => x.id === 'abx_window'), 'clindamycin: 60-min window');
  // not indicated (MAC default without an antibiotic step): no alarm
  const mac = sim0(P(), { mode: 'MAC', sedationTarget: 'moderate', steps: [] }); mac.action('start_surgery'); mac.step(1);
  assert.ok(!mac.state.alarms.some((x) => x.id === 'abx_window'));
});

test('C4 redose reminder: cefazolin every 4 h during surgery (MEDIUM, clears after a redose); clindamycin 6 h; vancomycin none', () => {
  const s = sim0(P(), { mode: 'GA', steps: [], prophylaxisIndicated: true });
  s.administer({ drugId: 'cefazolin', kind: 'antibiotic', amount: 2000, amountUnit: 'mg' }); runFor(s, 600); s.action('start_surgery');
  runFor(s, 4 * 3600 - 600 - 5);
  assert.ok(!s.state.alarms.some((x) => x.id === 'abx_redose'));
  runFor(s, 10);
  const a = s.state.alarms.find((x) => x.id === 'abx_redose');
  assert.ok(a && a.active && a.priority === 'medium', JSON.stringify(s.state.alarms));
  assert.match(a.message, /^Prophylaxis redose due: Cefazolin every 4 h/);
  s.administer({ drugId: 'cefazolin', kind: 'antibiotic', amount: 2000, amountUnit: 'mg' }); runFor(s, 2);
  assert.equal(s.state.alarms.find((x) => x.id === 'abx_redose').active, false);
  assert.ok(s.state.log.some((l) => /Prophylaxis redose due/.test(l.message)));
  const doses = [{ drugId: 'clindamycin', tSec: 0 }, { drugId: 'vancomycin', tSec: 0 }];
  assert.equal(redoseStatus(doses, 5 * 3600, REAL).due, false);
  assert.equal(redoseStatus(doses, 6 * 3600, REAL).due, true);
  assert.deepEqual(redoseStatus(doses, 9 * 3600, REAL).items.map((x) => x.drugId), ['clindamycin']);
  assert.equal(evaluateWindow([], 100, REAL).ok, false);
});

test('C5 guided mode: checklist warning before Start surgery waits for the clinician; never acknowledged automatically', () => {
  const p = EX('healthy_adult');
  const tpl = EXAMPLE_PLANS.find((x) => x.id === 'ga_healthy');
  const { plan } = buildPlan({ ...tpl, steps: tpl.steps.filter((x) => x.kind !== 'antibiotic') }, p, REAL);
  plan.prophylaxisIndicated = true;
  const sim = sim0(p, plan); const r = createAutoRunner({ sim, mode: 'guided' });
  const actions = []; const act = sim.action.bind(sim); sim.action = (id) => { actions.push(id); return act(id); };
  r.start(); let sawChecklist = false;
  for (let i = 0; i < 9000 && !DONE.includes(r.state); i++) {
    if (r.state === 'paused') { for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`); if (sim.core.holdLatched) sim.action('resume_hold'); r.resume(); continue; }
    const st = r.status();
    if (st.current && st.current.id === 'start_surgery' && st.current.checklist && !sawChecklist) {
      sawChecklist = true;
      assert.ok(st.current.unmet.some((u) => /^Antibiotic checklist/.test(u)));
      for (let k = 0; k < 400; k++) { sim.step(1); r.tick(); if (r.state === 'paused') { sim.action('resume_hold'); r.resume(); } }
      assert.equal(sim.stim.surgeryStartAt, null, 'surgery waits for the acknowledgement');
      assert.equal(sim.state.prophylaxis.checklistAcknowledged, null, 'never auto-acknowledged');
      assert.ok(!actions.includes('acknowledge_checklist:antibiotic'));
      assert.ok(sim.action('acknowledge_checklist:antibiotic').ok);
      continue;
    }
    if (st.current && st.current.gate && st.current.enabled) { r.approve(st.current.id); continue; }
    sim.step(1); r.tick();
  }
  assert.ok(sawChecklist); assert.equal(r.state, 'completed', r.message);
  assert.ok(sim.state.prophylaxis.checklistAcknowledged);
  assert.ok(sim.state.log.some((l) => /acknowledged the antibiotic checklist/.test(l.message)));
  assert.ok(sim.alarmMgr.history.some((a) => a.id === 'abx_window'), 'incision still raises the window alarm');
});

test('C6 full demonstration: an unsatisfied checklist pauses the sequence until the clinician acknowledges', () => {
  const p = EX('mh_susceptible');
  const tpl = EXAMPLE_PLANS.find((x) => x.id === 'tiva_mh');
  const { plan } = buildPlan({ ...tpl, steps: tpl.steps.filter((x) => x.kind !== 'antibiotic') }, p, REAL);
  plan.prophylaxisIndicated = true;
  const sim = sim0(p, plan); const r = createAutoRunner({ sim, mode: 'full' });
  r.start(); let checklistPauses = 0;
  for (let i = 0; i < 12000 && !DONE.includes(r.state); i++) {
    if (r.state === 'paused') {
      if (r.pauseReasons.some((x) => /Antibiotic checklist/.test(x.message))) {
        checklistPauses++;
        if (checklistPauses === 1) { const again = r.resume(); assert.equal(again.ok, false, 'resume refused while unacknowledged'); assert.equal(sim.stim.surgeryStartAt, null); }
        sim.action('acknowledge_checklist:antibiotic');
      }
      for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`);
      if (sim.core.holdLatched) sim.action('resume_hold');
      r.resume(); continue;
    }
    sim.step(1); r.tick();
  }
  assert.ok(checklistPauses >= 1); assert.equal(r.state, 'completed', r.message);
  // with prophylaxis in the plan (example plans) there is no checklist pause
  const { plan: p2 } = buildPlan(tpl, p, REAL);
  assert.ok(p2.steps.some((x) => x.kind === 'antibiotic') && p2.prophylaxisIndicated);
});

// ===================================================================== D/E. technique templates
const DOSE_KEYS = ['amount', 'rate', 'dose', 'perKg', 'fixed', 'mg', 'mcg'];
test('D1 templates contain no hard-coded doses (only drug/regimen/phase/offset choices)', () => {
  assert.deepEqual(TECHNIQUE_TEMPLATES.map((t) => t.id), ['ga_opioid', 'ga_opioid_free', 'mac_dex', 'mac_propofol']);
  for (const t of TECHNIQUE_TEMPLATES) for (const s of t.steps) {
    for (const k of DOSE_KEYS) if (k in s) assert.ok(k === 'rate' && s.rate === 'default' && s.kind === 'fluid', `${t.id}: ${k} in ${JSON.stringify(s)}`);
    if (s.fallback) for (const k of DOSE_KEYS) assert.ok(!(k in s.fallback), `${t.id} fallback ${k}`);
    if (!['fluid', 'antibiotic', 'stop'].includes(s.kind)) assert.ok(s.regimenKey, `${t.id}: regimen for ${s.drugId}`);
  }
});

for (const t of TECHNIQUE_TEMPLATES) {
  test(`D2 template ${t.id}: every dose equals recommend() (or the interlock ceiling / fluid default) for all example patients`, () => {
    for (const ex of EXAMPLE_PATIENTS) {
      const p = EX(ex.id);
      for (const interlocks of [true, false]) {
        const r = buildTemplatePlan(t.id, p, { library: REAL, interlocks });
        assert.equal(r.plan.mode, t.mode);
        for (const s of r.plan.steps) {
          if (s.kind === 'stop') { assert.ok(r.plan.steps.some((x) => x.drugId === s.drugId && (x.kind === 'infusion' || x.kind === 'inhaled'))); continue; }
          if (s.kind === 'fluid') { assert.equal(s.rate, FLUID_MODEL.MAINTENANCE_DEFAULT_ML_H); continue; }
          const rec = recommend(p, s.regimenKey, s.drugId, REAL);
          assert.ok(!rec.locked, `${ex.id}/${t.id}: ${s.drugId} locked but planned`);
          if (s.kind === 'bolus' || s.kind === 'antibiotic') assert.equal(s.amount, s.loading ? rec.loading.value : rec.dose.value, `${ex.id}/${t.id}/${s.drugId}`);
          if (s.kind === 'infusion') {
            const pre = r.prefilled.find((x) => x.drugId === s.drugId);
            if (pre) { assert.ok(interlocks); assert.equal(pre.from, rec.rate.value); } else assert.equal(s.rate, rec.rate.value);
          }
          if (s.kind === 'inhaled') assert.ok(s.rate >= rec.rate.range.min && s.rate <= rec.rate.range.max);
        }
      }
    }
  });
}

test('D3 opioid-based template: optional midazolam and pretreatment; MH patient gets the propofol fallback (sevoflurane locked)', () => {
  assert.deepEqual(templateOptions(TECHNIQUE_TEMPLATES[0]).map((o) => o.id), ['midazolam', 'lidocainePretreatment']);
  const p = EX('healthy_adult');
  const full = buildTemplatePlan('ga_opioid', p, { library: REAL });
  for (const d of ['midazolam', 'fentanyl', 'propofol', 'rocuronium', 'sevoflurane', 'dexamethasone', 'ondansetron', 'sugammadex', 'cefazolin', 'lactated_ringers']) assert.ok(full.plan.steps.some((s) => s.drugId === d), d);
  assert.ok(full.notes.some((n) => n.key === 'propofolPain'));
  const noMid = buildTemplatePlan('ga_opioid', p, { library: REAL, include: { midazolam: false } });
  assert.ok(!noMid.plan.steps.some((s) => s.drugId === 'midazolam'));
  const mh = buildTemplatePlan('ga_opioid', EX('mh_susceptible'), { library: REAL });
  assert.ok(!mh.plan.steps.some((s) => s.drugId === 'sevoflurane'));
  assert.deepEqual(mh.substitutions.map((x) => [x.from, x.to]), [['sevoflurane', 'propofol']]);
  assert.ok(mh.plan.steps.some((s) => s.drugId === 'propofol' && s.kind === 'infusion'));
  assert.ok(mh.plan.steps.some((s) => s.drugId === 'propofol' && s.kind === 'stop' && s.phase === 'emergence'));
});

test('D4 opioid-free template: no opioid; POFA evidence note (S49); pretreatment omitted because an IV lidocaine infusion is planned', () => {
  const r = buildTemplatePlan('ga_opioid_free', EX('healthy_adult'), { library: REAL });
  assert.ok(!r.plan.steps.some((s) => REAL.DRUGS.find((d) => d.id === s.drugId)?.cls === 'opioid'));
  for (const d of ['dexmedetomidine', 'ketamine', 'lidocaine', 'propofol', 'rocuronium', 'sevoflurane', 'dexamethasone', 'ondansetron', 'sugammadex', 'cefazolin', 'lactated_ringers']) assert.ok(r.plan.steps.some((s) => s.drugId === d), d);
  assert.ok(!r.plan.steps.some((s) => s.regimenKey === 'pretreatment'));
  assert.equal(r.omitted.length, 1); assert.match(r.omitted[0].reason, /Foo 2021/);
  const pofa = r.notes.find((n) => n.key === 'pofa');
  assert.ok(pofa && pofa.sources.includes('S49'));
  assert.match(pofa.text, /hypoxaemia/); assert.match(pofa.text, /severe bradycardia/); assert.match(pofa.text, /nausea and vomiting was less frequent/);
  assert.ok(r.notes.some((n) => n.key === 'lidocaineOverlap'));
  assert.match(REAL.SOURCES.S49.citation, /Anesthesiology\. 2021;134\(4\):541-551/);
  // uncontrolled hypertension locks ketamine → skipped with the reason
  const el = buildTemplatePlan('ga_opioid_free', EX('elderly_cad_ckd'), { library: REAL });
  assert.ok(el.skipped.some((x) => x.drugId === 'ketamine'));
  assert.ok(!el.plan.steps.some((s) => s.drugId === 'ketamine'));
});

test('D5 MAC dexmedetomidine template: label procedural dosing, every target, optional supplementation, notes, interlock ceiling', () => {
  const p = EX('healthy_adult');
  for (const target of ['minimal', 'moderate', 'deep']) {
    const r = buildTemplatePlan('mac_dex', p, { library: REAL, sedationTarget: target });
    assert.equal(r.plan.sedationTarget, target);
    const load = r.plan.steps.find((s) => s.drugId === 'dexmedetomidine' && s.loading);
    const inf = r.plan.steps.find((s) => s.drugId === 'dexmedetomidine' && s.kind === 'infusion');
    assert.equal(load.amount, p.weightKg * 1); assert.equal(load.overSec, 600);
    assert.equal(inf.rate, NOA_CONFIG.simulation_rate_ceilings.Dexmedetomidine, 'interlock ceiling pre-filled');
    assert.equal(buildTemplatePlan('mac_dex', p, { library: REAL, sedationTarget: target, interlocks: false }).plan.steps.find((s) => s.kind === 'infusion').rate, 0.6);
  }
  const rec = recommend(p, 'sedation_minimal', 'dexmedetomidine', REAL);
  assert.deepEqual([rec.rate.value, rec.rate.range.min, rec.rate.range.max], [0.6, 0.2, 1]);
  const keys = buildTemplatePlan('mac_dex', p, { library: REAL }).notes.map((n) => n.key);
  assert.deepEqual(keys, ['dexMac', 'dexInterlock']);
  assert.match(REAL.TEMPLATE_NOTES.dexMac.text, /Sedation beyond deep .* is general anaesthesia: use a GA template/);
  assert.ok(!buildTemplatePlan('mac_dex', p, { library: REAL, interlocks: false }).notes.some((n) => n.key === 'dexInterlock'));
  // supplementation: propofol has no minimal regimen, midazolam has no deep regimen → skipped with reasons
  const deep = buildTemplatePlan('mac_dex', p, { library: REAL, sedationTarget: 'deep', include: { propofol: true, midazolam: true } });
  assert.ok(deep.plan.steps.some((s) => s.drugId === 'propofol' && s.kind === 'infusion'));
  assert.ok(deep.skipped.some((x) => x.drugId === 'midazolam'));
  const min = buildTemplatePlan('mac_dex', p, { library: REAL, sedationTarget: 'minimal', include: { propofol: true, midazolam: true } });
  assert.ok(min.plan.steps.some((s) => s.drugId === 'midazolam')); assert.ok(min.skipped.some((x) => x.drugId === 'propofol'));
  assert.ok(!min.plan.steps.some((s) => s.kind === 'stop' && s.drugId === 'propofol'), 'no stop for a drug not started');
});

// E: every template runs in guided and full-auto modes for every example patient
for (const t of TECHNIQUE_TEMPLATES) for (const mode of ['guided', 'full']) {
  test(`E1 ${t.id} runs to completion in ${mode} mode for all example patients (plan steps executed, none blocked)`, () => {
    for (const ex of EXAMPLE_PATIENTS) {
      const p = EX(ex.id);
      const { plan } = buildTemplatePlan(t.id, p, { library: REAL });
      const sim = sim0(p, plan); const r = createAutoRunner({ sim, mode });
      const runnerActions = []; const act = sim.action.bind(sim); let user = false;
      sim.action = (id) => { if (!user) runnerActions.push(id); return act(id); };
      const asUser = (fn) => { user = true; try { return fn(); } finally { user = false; } };
      assert.ok(r.start().ok);
      for (let i = 0; i < 14000 && !DONE.includes(r.state); i++) {
        if (r.state === 'paused') { asUser(() => { for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`); if (sim.core.holdLatched) sim.action('resume_hold'); }); r.resume(); continue; }
        const st = r.status();
        if (mode === 'guided' && st.current && st.current.gate && st.current.enabled) { assert.ok(r.approve(st.current.id).ok); continue; }
        sim.step(1); r.tick();
      }
      assert.equal(r.state, 'completed', `${ex.id}: ${r.message}`);
      const ps = sim.planStatus();
      assert.ok(ps.every((s) => s.status === 'done'), `${ex.id}: ${JSON.stringify(ps.filter((s) => s.status !== 'done'))}`);
      assert.ok(!runnerActions.some((a) => /^acknowledge/.test(a) || a === 'resume_hold'), 'runner never acknowledges or releases');
      const sum = sim.summary();
      if (plan.steps.some((s) => s.kind === 'fluid')) assert.ok(sum.fluids.byType.lactated_ringers.maintenanceMl > 0, 'fluids continue across phases');
      if (t.mode === 'GA') { assert.equal(sum.prophylaxis.window.ok, true); assert.equal(sum.extubation.ready, true); }
    }
  });
}

test('E2 example GA plans now include guideline prophylaxis (selected at runtime) and stay dose-free', () => {
  for (const tpl of EXAMPLE_PLANS.filter((x) => x.mode === 'GA')) {
    const a = tpl.steps.find((s) => s.kind === 'antibiotic');
    assert.ok(a && a.drugId === 'auto' && !('amount' in a), tpl.id);
  }
});

// ===================================================================== inventory / data
test('F1 every new value is in the parameter inventory with provenance and sources', () => {
  const inv = sim0(EX('healthy_adult')).parameterInventory();
  const find = (comp, name) => inv.find((x) => x.component === comp && x.name === name);
  assert.deepEqual([find('prophylaxis', 'cefazolin dose').value, find('prophylaxis', 'cefazolin dose').provenance, find('prophylaxis', 'cefazolin dose').sourceIds], [2000, 'guideline', ['S46']]);
  assert.equal(find('prophylaxis', 'cefazolin dose (weight>=120)').value, 3000);
  assert.equal(find('prophylaxis', 'vancomycin dose').value, 15);
  assert.equal(find('prophylaxis', 'clindamycin redosing interval').value, 360);
  assert.equal(find('prophylaxis', 'vancomycin start window before incision').value, 120);
  assert.equal(find('prophylaxis', 'CHECKLIST_REQUIRES_ACK').provenance, 'simulator_convention');
  assert.deepEqual([find('pretreatment', 'lidocaine pretreatment dose (before propofol)').value, find('pretreatment', 'lidocaine pretreatment dose (before propofol)').provenance], [10, 'fda_label']);
  assert.equal(find('pretreatment', 'lidocaine pretreatment / IV lidocaine overlap window').sourceIds[0], 'S1');
  assert.equal(find('fluids', 'lactated_ringers composition sodiumMmol').provenance, 'fda_label');
  assert.equal(find('fluids', 'sodium_chloride_0_9 composition chlorideMeq').value, 154);
  assert.equal(find('fluids', 'MAINTENANCE_DEFAULT_ML_H').provenance, 'simulator_convention');
  assert.equal(inv.filter((x) => x.component === 'template').length, TECHNIQUE_TEMPLATES.length);
  for (const x of inv) for (const s of x.sourceIds) assert.ok(REAL.SOURCES[s], `${x.name}: ${s}`);
});

test('F2 data integrity: new sources registered and used; allergy id; antibiotic rules reference known ids', () => {
  for (const id of ['S46', 'S47', 'S48', 'S49', 'S50', 'S51']) { const s = REAL.SOURCES[id]; assert.ok(s && s.citation && s.verifiedVia && s.supports, id); assert.ok(Object.values(REAL.SOURCE_IDS_ENGINE).includes(id), `${id} registered for the engine`); }
  assert.ok(REAL.ALLERGIES.some((a) => a.id === 'beta_lactam_severe'));
  const allergyIds = new Set(REAL.ALLERGIES.map((a) => a.id)); const condIds = new Set(REAL.CONDITIONS.map((c) => c.id));
  for (const a of REAL.ANTIBIOTICS) for (const c of a.contraindications) { const [k, v] = c.when.split(':'); assert.ok(k === 'allergy' ? allergyIds.has(v) : condIds.has(v), c.when); }
  for (const f of REAL.FLUIDS) for (const c of f.cautions) assert.ok(condIds.has(c.when.split(':')[1]), c.when);
  for (const n of Object.values(REAL.TEMPLATE_NOTES)) for (const s of n.sources) assert.ok(REAL.SOURCES[s], s);
});
