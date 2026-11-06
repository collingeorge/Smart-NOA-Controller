// Emergency-rescue stress matrix (2026-11): a representative deterministic subset of the matrix in
// tools/emergency-stress-report.mjs (which runs all of it and writes EMERGENCY_STRESS.md).
// Driver: tests/emergency-stress.mjs. EDUCATIONAL SIMULATION — fictional patients — not a medical device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REAL, basePatient } from './helpers.mjs';
import { derivePatient } from '../engine/patient.js';
import { createSimulation } from '../engine/sim.js';
import { recommend } from '../engine/dosing.js';
import { TIMING_CONFIG, LABEL_REPEAT_INTERVALS } from '../engine/timing.js';
import { RESCUE_CONFIG } from '../engine/rescue-config.js';
import { SCENARIOS } from '../data/scenarios.js';
import * as D from './emergency-stress.mjs';

const SUBSET = D.SUBSET_PATIENTS;
const cache = new Map();
const run = (c) => { const k = D.caseId(c); if (!cache.has(k)) cache.set(k, D.runCase(c)); return cache.get(k); };
const efficacyCases = D.matrixCases({ patients: SUBSET, timings: ['early'] }).filter((c) => c.arm !== 'aggressive');
const aggressiveCases = D.matrixCases({ patients: ['wt40_bmi15', 'sepsis_emergency'], timings: ['late'], seeds: [1] }).filter((c) => c.arm === 'aggressive');
const comboCasesSubset = D.comboCases({ patients: ['elderly_cad_ckd'] });

test('ES0 matrix definition: every non-sensor complication; fictional extreme patients built through derivePatient; plans pass plan safety', () => {
  const want = ['hemorrhage', 'vagal_bradycardia', 'bronchospasm', 'laryngospasm_on_extubation', 'light_anesthesia_stimulus', 'anaphylaxis_hypotension'];
  for (const id of want) assert.ok(D.EMERGENCIES.includes(id), id);
  assert.deepEqual([...D.EMERGENCIES].sort(), SCENARIOS.filter((s) => !s.perturbation.sensor).map((s) => s.id).sort());
  assert.ok(D.STRESS_PATIENTS.length >= 12);
  const P = D.STRESS_PATIENTS.map((x) => D.stressPatient(x.id));
  const has = (f) => P.some(f);
  assert.ok(has((p) => p.ageYears === 18) && has((p) => p.ageYears === 90), 'age 18 and 90');
  assert.ok(has((p) => p.weightKg === 40) && has((p) => p.weightKg === 200), 'weight 40 and 200 kg');
  assert.ok(has((p) => p.bmi < 16) && has((p) => p.bmi > 60), 'BMI extremes');
  assert.ok(has((p) => p.egfr === 10) && has((p) => p.egfr === 120), 'eGFR 10 and 120');
  assert.ok(has((p) => p.asa === 1) && has((p) => p.asa === 4), 'ASA 1 and 4');
  for (const c of ['hypovolemia', 'sepsis', 'mh_susceptible', 'osa', 'cad']) assert.ok(has((p) => p.conditions.includes(c)), c);
  assert.ok(has((p) => p.medications.includes('beta_blocker') && p.baseline.hr <= 55), 'beta-blocker / bradycardia-prone');
  for (const sp of D.STRESS_PATIENTS) {
    const p = D.stressPatient(sp.id);
    assert.equal(p.derived, true, sp.id);
    for (const tpl of ['ga_opioid', 'ga_opioid_free']) {
      const b = D.stressPlan(p, tpl);
      assert.equal(b.gap.blocking, false, `${sp.id} ${tpl}: ${b.gap.message}`);
      if (p.conditions.includes('mh_susceptible')) assert.ok(!b.plan.steps.some((s) => ['sevoflurane', 'succinylcholine'].includes(s.drugId)), 'MH: TIVA-compatible plan');
    }
  }
  assert.ok(D.SEEDS.length >= 3); assert.equal(D.TIMINGS.length, 2);
  assert.equal(D.matrixCases().length, D.STRESS_PATIENTS.length * D.TIMINGS.length * D.SEEDS.length * (D.EMERGENCIES.length * 3 + 1));
  assert.throws(() => derivePatient(basePatient({ weightKg: 260 }), { library: REAL }), /weightKg/, 'validation applies');
});

test('ES1 label repeat intervals of rescue boluses (fix): sourced, a manual repeat is warned and recorded, a planned repeat waits; IM and IV gated separately', () => {
  for (const r of LABEL_REPEAT_INTERVALS) {
    const x = TIMING_CONFIG[r.key];
    assert.equal(x.provenance, 'fda_label', r.key); assert.ok(x.sourceIds.length && x.sourceIds.every((id) => REAL.SOURCES[id]), r.key);
    assert.equal(r.minSec, x.value);
  }
  assert.equal(TIMING_CONFIG.PHENYLEPHRINE_REPEAT_MIN_SEC.value, RESCUE_CONFIG.PHENYLEPHRINE_REPEAT_MIN_SEC.value, 'same label value as the advisory');
  assert.deepEqual(LABEL_REPEAT_INTERVALS.map((r) => [r.drugId, r.minSec]), [['phenylephrine', 60], ['glycopyrrolate', 120], ['epinephrine', 300]]);
  const p = derivePatient(basePatient(), { library: REAL });
  const dose = (key, id) => { const r = recommend(p, key, id, REAL); return { drugId: id, kind: 'bolus', amount: r.dose.value, amountUnit: r.dose.unit, ...(r.route ? { route: r.route } : {}) }; };
  for (const [key, id, gap] of [['rescue', 'phenylephrine', 60], ['rescue', 'glycopyrrolate', 120], ['rescue', 'epinephrine', 300]]) {
    const sim = createSimulation({ patient: p, library: REAL, seed: 1 }); sim.setPhase('maintenance');
    assert.equal(sim.administer(dose(key, id)).warnings.some((w) => /Repeat-bolus/.test(w)), false, `${id}: first dose`);
    for (let i = 0; i < gap - 5; i++) sim.step(1);
    const r = sim.administer(dose(key, id));
    assert.equal(r.ok, true, `${id}: a manual repeat is given (warning policy)`);
    assert.ok(r.warnings.some((w) => /Repeat-bolus condition not met: repeat .* waits \d+ s more \(label/.test(w)), `${id}: warned — ${r.warnings.join(' | ')}`);
    assert.ok(sim.timingHolds.some((h) => h.drugId === id && h.manual), `${id}: recorded`);
    for (let i = 0; i < gap + 1; i++) sim.step(1);
    assert.ok(!sim.administer(dose(key, id)).warnings.some((w) => /Repeat-bolus/.test(w)), `${id}: after the interval no warning`);
  }
  // IV epinephrine (titrated) and ephedrine ("as needed") are not gated; IM after IV is not a repeat
  const sim = createSimulation({ patient: p, library: REAL, seed: 1 });
  sim.administer(dose('rescue_iv', 'epinephrine')); sim.step(1);
  assert.ok(!sim.administer(dose('rescue_iv', 'epinephrine')).warnings.some((w) => /Repeat-bolus/.test(w)));
  assert.ok(!sim.administer(dose('rescue', 'epinephrine')).warnings.some((w) => /Repeat-bolus/.test(w)), 'first IM after IV boluses');
  sim.administer(dose('rescue', 'ephedrine'));
  assert.ok(!sim.administer(dose('rescue', 'ephedrine')).warnings.some((w) => /Repeat-bolus/.test(w)));
  assert.equal(sim.doseLog.filter((d) => d.drugId === 'epinephrine').map((d) => d.route).join(','), 'IV,IV,IM', 'route in the dose log');
  // glycopyrrolate with neostigmine in emergence is not gated by the intraoperative interval
  const em = createSimulation({ patient: p, library: REAL, seed: 1 }); em.setPhase('maintenance'); em.administer(dose('rescue', 'glycopyrrolate')); em.setPhase('emergence');
  assert.ok(!em.administer(dose('emergence', 'glycopyrrolate')).warnings.some((w) => /Repeat-bolus/.test(w)));
  // a PLANNED repeat waits for the interval
  const plan = { mode: 'GA', steps: [
    { id: 'a', phase: 'maintenance', atSec: 0, drugId: 'phenylephrine', kind: 'bolus', amount: 40, amountUnit: 'mcg' },
    { id: 'b', phase: 'maintenance', atSec: 10, drugId: 'phenylephrine', kind: 'bolus', amount: 40, amountUnit: 'mcg' }] };
  const ps = createSimulation({ patient: p, plan, library: REAL, seed: 1 }); ps.setPhase('maintenance');
  for (let i = 0; i < 30; i++) ps.step(1);
  assert.equal(ps.planStatus().find((s) => s.id === 'b').status, 'pending'); assert.match(ps.planStatus().find((s) => s.id === 'b').waiting, /repeat phenylephrine IV bolus/);
  for (let i = 0; i < 40; i++) ps.step(1);
  const b = ps.doseLog.filter((d) => d.drugId === 'phenylephrine');
  assert.equal(b.length, 2); assert.ok(b[1].tSec - b[0].tSec >= 60 - 1e-9);
});

test('ES2 safety holds in every run of the subset (control, rescue, rescue_im): no NaN/Infinity, no exception, hard limits, holds, advisory accept', () => {
  for (const c of efficacyCases) {
    const r = run(c);
    assert.equal(r.exception, null, r.id);
    assert.deepEqual(r.violations, [], r.id);
    assert.ok(r.metrics.samples >= (c.emergency === 'laryngospasm_on_extubation' ? D.DRIVER_CONVENTIONS.OBSERVE_LARYNGOSPASM_SEC : D.DRIVER_CONVENTIONS.OBSERVE_SEC), r.id);
    if (c.arm === 'control') { assert.equal(r.advisory.accepted, 0, r.id); assert.ok(!Object.keys(r.doseSummary).some((k) => /phenylephrine|ephedrine|epinephrine/.test(k)), r.id); }
    // the non-aggressive arms give only regimen doses from recommend() (no invented dose)
    for (const d of r.doses.filter((x) => x.ok && x.kind === 'bolus')) {
      const drug = REAL.DRUGS.find((x) => x.id === d.drugId);
      const values = Object.keys(drug.regimens).map((k) => recommend(D.stressPatient(c.patientId), k, d.drugId, REAL)).filter((x) => x.dose).map((x) => x.dose.value);
      assert.ok(values.some((v) => Math.abs(v - d.amount) < 1e-9), `${r.id}: ${d.drugId} ${d.amount} is a regimen dose (${values.join(', ')})`);
    }
  }
});

test('ES3 aggressive / abusive dosing: every hard cap refuses (logged), soft limits are flagged, never clamped; physiology stays inside the plausible bounds', () => {
  for (const c of aggressiveCases) {
    const r = run(c);
    assert.deepEqual(r.violations, [], r.id); assert.equal(r.exception, null, r.id);
    const S = r.doseSummary;
    assert.ok(S['phenylephrine:bolus:IV'].blocked > 0 && S['phenylephrine:bolus:IV'].total <= 200 + 1e-9, `${r.id}: phenylephrine cumulative cap`);
    assert.ok(S['ephedrine:bolus:IV'].blocked > 0 && S['ephedrine:bolus:IV'].total <= 50 + 1e-9, `${r.id}: ephedrine cumulative cap`);
    assert.ok(S['epinephrine:bolus:IV'].blocked > 0 && S['epinephrine:bolus:IM'].blocked > 0, `${r.id}: epinephrine per-injection caps`);
    assert.ok(S['epinephrine:bolus:IM'].flagged > 0, `${r.id}: too-close IM epinephrine flagged`);
    // glycopyrrolate's intraoperative interval does not apply in emergence (laryngospasm happens at extubation)
    if (c.emergency !== 'laryngospasm_on_extubation') assert.ok(S['glycopyrrolate:bolus:IV'].flagged > 0, `${r.id}: too-close glycopyrrolate flagged`);
    for (const id of ['epinephrine', 'phenylephrine', 'dexmedetomidine']) assert.ok(S[`${id}:infusion`].blocked >= 1, `${r.id}: ${id} above the rate ceiling refused`);
    const m = r.metrics;
    assert.ok(m.maxMap <= D.BOUNDS.map[1] && m.minMap >= D.BOUNDS.map[0] && m.maxHr <= D.BOUNDS.hr[1] && m.minSpo2 >= D.BOUNDS.spo2[0], r.id);
  }
});

test('ES4 efficacy (directional, illustrative): rescue vs control per emergency × patient; documented findings only', () => {
  const recs = efficacyCases.map(run);
  const eff = D.efficacy(recs);
  const rows = [...D.compareArms(eff, 'rescue'), ...D.compareArms(eff, 'rescue_im')];
  const lines = [];
  for (const x of rows) {
    lines.push(`${x.emergency}/${x.patientId}/${x.arm}: control ${x.control.recovered}/${x.control.n} ${x.control.medianTime ?? '—'} s, rescue ${x.rescue.recovered}/${x.rescue.n} ${x.rescue.medianTime ?? '—'} s → ${x.verdict}`);
    assert.notEqual(x.verdict, 'worse', `${x.emergency}/${x.patientId}: rescue worse than control`);
    if (D.KNOWN_FINDINGS.neverDeranged.includes(x.emergency)) assert.ok(['no_derangement', 'better', 'better_time_deranged', 'better_deficit'].includes(x.verdict), `${x.emergency}/${x.patientId}: ${x.verdict}`);
    else assert.ok(['better', 'better_time_deranged', 'better_deficit'].includes(x.verdict), `${x.emergency}/${x.patientId}: rescue must beat control (${x.verdict})`);
    const known = (D.KNOWN_FINDINGS.notRecovered[x.emergency] || []).includes(x.patientId);
    if (!known) assert.equal(x.rescue.recovered, x.rescue.n, `${x.emergency}/${x.patientId}: rescue recovers in every run (finite time)`);
    else assert.ok(x.rescue.recovered >= x.control.recovered, `${x.emergency}/${x.patientId}: documented finding, still ≥ control`);
  }
  // the obese patient desaturates during laryngospasm without airway rescue; the rescue prevents it
  const lar = rows.find((x) => x.emergency === 'laryngospasm_on_extubation' && x.patientId === 'wt200_bmi65_osa');
  assert.ok(lar.control.worstMinSpo2 < 90 && lar.rescue.worstMinSpo2 >= 92, `laryngospasm obese: ${lar.control.worstMinSpo2} → ${lar.rescue.worstMinSpo2}`);
  // light anaesthesia at the default maintenance never deranges (documented finding)
  for (const x of rows.filter((y) => y.emergency === 'light_anesthesia_stimulus')) assert.equal(x.verdict, 'no_derangement', x.patientId);
  const recovered = rows.filter((x) => !D.KNOWN_FINDINGS.neverDeranged.includes(x.emergency));
  const rate = recovered.reduce((a, x) => a + x.rescue.recovered, 0) / recovered.reduce((a, x) => a + x.rescue.n, 0);
  assert.ok(rate >= 0.9, `rescue recovery rate ${rate}`);
  test.diagnostic?.(lines.join('\n'));
});

test('ES5 emergencies during a sensor fault, a latched hold and "Continue with hold latched": safety holds and the rescue path stays available', () => {
  for (const c of comboCasesSubset) {
    const r = run(c);
    assert.deepEqual(r.violations, [], r.id); assert.equal(r.exception, null, r.id);
    const pr = r.probes.fault || r.probes.hold;
    assert.ok(pr, `${r.id}: probe ran`);
    for (const x of pr.results) {
      if (/restart while held/.test(x.what)) assert.equal(x.ok, false, `${r.id}: ${x.what}`);
      else assert.ok(x.ok || /Cumulative|cumulative|Total bolus/.test(x.reason || ''), `${r.id}: ${x.what} ${x.reason || ''}`);
    }
    if (['hold_latched', 'continue_with_hold', 'map_sensor_fault', 'hr_sensor_fault'].includes(c.combo)) assert.equal(r.interlock.holdLatchedAtEnd, true, `${r.id}: latched holds never auto-release`);
    assert.equal(r.interlock.resumeCalls, 0);
    if (c.combo === 'continue_with_hold') assert.equal(r.runner.holdContinue, true, `${r.id}: continuing with the hold latched`);
  }
});

test('ES6 determinism: the same case gives the same record; another seed differs', () => {
  const c = { patientId: 'age90', emergency: 'anaphylaxis_hypotension', arm: 'rescue', timing: 'early', seed: 2, combo: null };
  const a = D.runCase(c); const b = D.runCase(c);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(D.runCase({ ...c, seed: 3 }).metrics), JSON.stringify(a.metrics));
});

test('ES7 EMERGENCY_STRESS.md is generated from this driver and reports zero safety violations', () => {
  const md = readFileSync(new URL('../EMERGENCY_STRESS.md', import.meta.url), 'utf8');
  assert.match(md, /^# Emergency-rescue stress matrix/);
  assert.match(md, /SIMULATION — fictional patients — educational use only\. Not a medical device/);
  assert.ok(md.includes(`| main matrix | ${D.matrixCases().length} |`), 'matrix size matches the driver');
  assert.ok(md.includes(`| fault / hold combinations | ${D.comboCases().length} |`));
  assert.match(md, /\| \*\*runs with any violation\*\* \| \*\*0\*\* \|/);
  assert.match(md, /## Findings/); assert.match(md, /## Gaps the engine cannot model/); assert.match(md, /## Bug fixed during this work/);
  for (const em of D.EMERGENCIES) assert.ok(md.includes(`| ${em} | rescue |`), em);
});
