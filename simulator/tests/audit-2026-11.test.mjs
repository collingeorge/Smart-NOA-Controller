// Regression tests for the 2026-11 clinical and code audits (simulator/AUDIT_2026-11.md).
// Software checks of an educational simulation; passing them is not clinical validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSimulation, MW, MMOL_PER_MG } from '../engine/sim.js';
import { derivePatient } from '../engine/patient.js';
import { recommend, interpretCeilings, evaluateContraindications, convertRateSafe } from '../engine/dosing.js';
import { normAmountUnit, convertAmount } from '../engine/units.js';
import { NOA_CONFIG, PY_RATE_UNITS, RATE_CEILING_EPS, SmartNoaControllerPort } from '../engine/interlocks.js';
import { createAutoRunner, buildSequence } from '../engine/autorun.js';
import { AUTORUN_CONFIG } from '../engine/autorun-config.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan, overSecFromTiming } from '../data/scenarios.js';
import { parseClock, fmtClock } from '../ui/dom.js';
import { basePatient, REAL, runFor } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const P = (over = {}) => derivePatient(basePatient(over), { library: REAL });
const EX = (id) => derivePatient(EXAMPLE_PATIENTS.find((e) => e.id === id).patient, { library: REAL });
const minDepth = (sim, sec) => { let m = 100; for (let i = 0; i < sec; i++) { sim.step(1); m = Math.min(m, sim.state.vitals.depthIndex); } return m; };

// ---------------------------------------------------------------- code finding 1: ceiling parity
test('code 1: a rate exactly at the Python ceiling never latches a hold (weight sweep, sim stepped)', () => {
  const cases = [['dexmedetomidine', 'Dexmedetomidine'], ['ketamine', 'Ketamine'], ['lidocaine', 'Lidocaine']];
  for (const [id, py] of cases) {
    const ceil = NOA_CONFIG.simulation_rate_ceilings[py]; const unit = PY_RATE_UNITS[py];
    for (let w = 35; w <= 250; w += 1.7) {
      const weightKg = Math.round(w * 10) / 10;
      assert.equal(convertRateSafe(ceil, unit, unit, weightKg), ceil, 'same-unit conversion is the identity');
      const sim = createSimulation({ patient: P({ weightKg }), library: REAL, seed: 1 });
      const r = sim.administer({ drugId: id, kind: 'infusion', rate: ceil, rateUnit: unit });
      assert.ok(r.ok, `${id} ${weightKg} kg admitted`);
      runFor(sim, 3);
      assert.equal(sim.state.interlocks.holdLatched, false, `${id} at ${weightKg} kg: no spurious hold`);
      assert.equal(sim.state.drugs[id].infusionRate, ceil);
    }
  }
  // the probe weights from the audit (62 kg dexmedetomidine; lidocaine label default, male 171 cm)
  const d = createSimulation({ patient: P({ weightKg: 62 }), library: REAL });
  d.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.5, rateUnit: 'mcg/kg/h' }); runFor(d, 2);
  assert.equal(d.state.interlocks.status, 'GREEN');
  const lp = P({ heightCm: 171, weightKg: 90 });
  const rec = recommend(lp, 'maintenance', 'lidocaine', REAL);
  const l = createSimulation({ patient: lp, library: REAL });
  assert.ok(l.administer({ drugId: 'lidocaine', kind: 'infusion', rate: rec.rate.value, rateUnit: rec.rate.unit }).ok); runFor(l, 2);
  assert.equal(l.state.interlocks.holdLatched, false);
  // a rate in another unit equal to the ceiling is also accepted; clearly above it is a fault
  const m = createSimulation({ patient: P({ weightKg: 62 }), library: REAL });
  assert.ok(m.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.5 / 60, rateUnit: 'mcg/kg/min' }).ok); runFor(m, 2);
  assert.equal(m.state.interlocks.holdLatched, false);
  assert.equal(m.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.51, rateUnit: 'mcg/kg/h' }).blocked, true);
});

test('code 1: tolerance equals the Python RATE_CEILING_TOLERANCE', () => {
  const py = readFileSync(ROOT + 'smart_noa_controller.py', 'utf8');
  const m = /^RATE_CEILING_TOLERANCE = ([0-9.e-]+)$/m.exec(py);
  assert.ok(m, 'constant present in the Python controller');
  assert.equal(Number(m[1]), RATE_CEILING_EPS);
});

// ---------------------------------------------------------------- code findings 4, 5, 8, 9, 10
test('code 4: prototype names are not units; NaN amounts never reach the PK model', () => {
  for (const u of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(normAmountUnit(u), null, u);
    assert.throws(() => convertAmount(1, u, 'mg'));
  }
  const sim = createSimulation({ patient: P(), library: REAL });
  assert.equal(sim.administer({ drugId: 'propofol', kind: 'bolus', amount: 10, amountUnit: 'constructor', overSec: 120 }).blocked, true);
  assert.equal(sim.administer({ drugId: 'propofol', kind: 'infusion', rate: 10, rateUnit: 'constructor/kg/min' }).blocked, true);
  assert.doesNotThrow(() => runFor(sim, 5));
});

test('code 5: plan normalisation validates types instead of trusting raw values', () => {
  const sim = createSimulation({ patient: P(), library: REAL, plan: { mode: 'GA', steps: [
    { phase: 'premed', atSec: '30', drugId: 'midazolam', kind: 'bolus', amount: 1, amountUnit: 'mg' },
    { phase: 'premed', atSec: undefined, drugId: 'ondansetron', kind: 'bolus', amount: 4, amountUnit: 'mg' },
    { id: undefined, phase: 'premed', drugId: 'dexamethasone', kind: 'bolus', amount: 4, amountUnit: 'mg' },
    { id: undefined, phase: 'premed', atSec: 10, drugId: 'glycopyrrolate', kind: 'bolus', amount: 0.1, amountUnit: 'mg' },
  ] } });
  const st = sim.planStatus();
  assert.equal(st[0].status, 'invalid'); assert.equal(st[1].status, 'invalid');
  assert.equal(new Set(st.map((s) => s.id)).size, 4, 'unique ids');
  runFor(sim, 20);
  const s2 = sim.planStatus();
  assert.equal(s2[0].status, 'invalid', 'string atSec never runs (no "10030" concatenation)');
  assert.equal(s2[2].status, 'done'); assert.equal(s2[3].status, 'done', 'steps without ids are not skipped');
  assert.ok(sim.state.log.some((e) => /is invalid and will not run/.test(e.message)));
});

test('code 8: "Give over" under 1 min is rejected explicitly, not silently pushed', () => {
  const sim = createSimulation({ patient: P(), library: REAL });
  const r = sim.administer({ drugId: 'midazolam', kind: 'bolus', amount: 1, amountUnit: 'mg', overSec: 30 });
  assert.equal(r.blocked, true); assert.match(r.reasons[0], /at least 1 min/);
  assert.equal(sim.state.drugs.midazolam.cumulative, 0);
  assert.ok(sim.administer({ drugId: 'midazolam', kind: 'bolus', amount: 1, amountUnit: 'mg', overSec: 0 }).ok, '0 = push');
  assert.ok(sim.administer({ drugId: 'midazolam', kind: 'bolus', amount: 1, amountUnit: 'mg', overSec: 60 }).ok);
});

test('code 9 (JS port): a malformed scripted reading fails safe', () => {
  const c = new SmartNoaControllerPort({ age: 40, weight_kg: 70, asa_class: 2, egfr: 90, allergies: [], comorbidities: [] });
  c.generateStartingRates();
  const tr = c.monitorAndControl([[80, 80], null, [80]]);
  assert.equal(tr[1].status, 'RED'); assert.ok(tr[1].hold_latched);
  assert.ok(Object.values(c.infusions).every((v) => v === 0));
});

test('code 10: a sustained interlock condition is recorded once per 60 s (matches the comment)', () => {
  const sim = createSimulation({ patient: P({ ageYears: 85 }), library: REAL, seed: 1 });
  sim.administer({ drugId: 'propofol', kind: 'bolus', amount: 200, amountUnit: 'mg' });
  sim.inject('hemorrhage'); sim.inject('anaphylaxis_hypotension');
  runFor(sim, 900);
  const t = sim.stats.interlockEvents.filter((e) => e.code === 'map_low').map((e) => e.tSec);
  assert.ok(t.length >= 5, `map_low recorded repeatedly (${t.length})`);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 60 - 1e-9);
});

test('code 7: parseClock accepts the h:mm:ss that fmtClock prints', () => {
  for (const s of [0, 59, 61, 3599, 3600, 4500, 7322]) assert.equal(parseClock(fmtClock(s)), s);
  assert.equal(parseClock('1:15:00'), 4500);
  assert.equal(parseClock('1:75:00'), null);
});

// ---------------------------------------------------------------- clinical 1: midazolam elderly cap
test('clinical 1: midazolam ≥60 y / debilitated initial dose ≤ 1.5 mg over ≥ 2 min', () => {
  for (const key of ['premed', 'sedation_minimal', 'sedation_moderate']) {
    const old = recommend(EX('elderly_cad_ckd'), key, 'midazolam', REAL);
    assert.ok(old.dose.value <= 1.5 && old.dose.range.max === 1.5, `${key}: ${JSON.stringify(old.dose)}`);
    assert.ok(old.sources.includes('S17'));
    const at60 = recommend(P({ ageYears: 60 }), key, 'midazolam', REAL);
    assert.equal(at60.dose.range.max, 1.5, 'label threshold is 60 y (not the simulator elderly flag ≥65)');
    const young = recommend(P({ ageYears: 40 }), key, 'midazolam', REAL);
    assert.equal(young.dose.range.max, 2.5);
    assert.equal(overSecFromTiming(young.timing), 120, 'given over at least 2 minutes');
  }
});

// ---------------------------------------------------------------- clinical 2, 4, 19: locks
test('clinical 2/4/19: desflurane halogenated-sensitivity lock; ketorolac bleeding/GI locks; ketamine and lidocaine label contraindications lock', () => {
  const lockOf = (p, id) => evaluateContraindications(p, id, REAL).filter((c) => c.severity === 'lock');
  assert.ok(lockOf(P({ allergies: ['halogenated_volatile'] }), 'desflurane').some((c) => /other halogenated agents/.test(c.message)));
  assert.ok(lockOf(P({ conditions: ['bleeding_risk'] }), 'ketorolac').some((c) => /hemorrhagic diathesis/.test(c.message)));
  assert.ok(lockOf(P({ conditions: ['peptic_ulcer_gi_bleed'] }), 'ketorolac').some((c) => /peptic ulcer/.test(c.message)));
  assert.ok(lockOf(P({ conditions: ['uncontrolled_htn'] }), 'ketamine').some((c) => /significant elevation of blood pressure/.test(c.message)));
  assert.ok(lockOf(P({ conditions: ['heart_block'] }), 'lidocaine').some((c) => /Stokes-Adams/.test(c.message)));
  assert.ok(recommend(EX('elderly_cad_ckd'), 'induction', 'ketamine', REAL).locked, 'elderly example with uncontrolled HTN cannot receive ketamine');
});

test('clinical 4: ketorolac surgery-timing warnings (prophylactic before major surgery; intraoperative haemostasis)', () => {
  const sim = createSimulation({ patient: P(), library: REAL });
  const before = sim.administer({ drugId: 'ketorolac', kind: 'bolus', amount: 30, amountUnit: 'mg' });
  assert.ok(before.ok && before.warnings.some((w) => /prophylactic analgesic before any major surgery/.test(w)));
  sim.action('start_surgery');
  const during = createSimulation({ patient: P(), library: REAL }); during.action('start_surgery');
  assert.ok(during.administer({ drugId: 'ketorolac', kind: 'bolus', amount: 30, amountUnit: 'mg' }).warnings.some((w) => /hemostasis is critical/.test(w)));
  const after = createSimulation({ patient: P(), library: REAL }); after.action('start_surgery'); after.action('end_surgery'); after.setPhase('emergence');
  assert.ok(!after.administer({ drugId: 'ketorolac', kind: 'bolus', amount: 30, amountUnit: 'mg' }).warnings.some((w) => /prophylactic|hemostasis/.test(w)));
});

// ---------------------------------------------------------------- clinical 3: phenylephrine
test('clinical 3: phenylephrine 200 mcg is a total bolus limit; infusion limit separate', () => {
  const L = interpretCeilings(REAL.DRUGS.find((d) => d.id === 'phenylephrine'), P());
  assert.ok(L.some((l) => l.type === 'cumulative' && l.bolusOnly && l.absolute === 200));
  assert.ok(!L.some((l) => l.type === 'bolus'));
});

// ---------------------------------------------------------------- clinical 5: sugammadex
function reversal(rocPerKg, waitSec, sgxPerKg) {
  const sim = createSimulation({ patient: P(), library: REAL, seed: 1 });
  const w = sim.patient.weightKg;
  sim.action('set_fio2:1'); sim.action('mask_ventilate');
  sim.administer({ drugId: 'propofol', kind: 'bolus', amount: 2 * w, amountUnit: 'mg' });
  sim.administer({ drugId: 'rocuronium', kind: 'bolus', amount: rocPerKg * w, amountUnit: 'mg' });
  if (waitSec === 'T2') { runFor(sim, 300); while (sim.state.vitals.tofCount < 2) sim.step(1); } else runFor(sim, waitSec);
  const t0 = sim.state.tSec;
  const r = sim.administer({ drugId: 'sugammadex', kind: 'bolus', amount: sgxPerKg * w, amountUnit: 'mg' });
  let t90 = null;
  for (let i = 0; i < 1800 && t90 === null; i++) { sim.step(1); if (sim.state.vitals.tofRatio >= 0.9) t90 = sim.state.tSec - t0; }
  return { sim, r, t90 };
}

test('clinical 5: sugammadex reversal depends on dose vs block depth; under-dosing warns and is slower/incomplete', () => {
  assert.equal(MW.rocuronium, 609.70); assert.equal(MW.sugammadex, 2178.01);
  assert.ok(Math.abs(MMOL_PER_MG.sugammadex - 1.088 / 2178.01) < 1e-15);
  const shallow = reversal(0.6, 'T2', 2);
  const deep4 = reversal(0.6, 300, 4);
  const deep2 = reversal(0.6, 300, 2);
  const imm16 = reversal(1.2, 180, 16);
  const imm4 = reversal(1.2, 180, 4);
  const imm2 = reversal(1.2, 180, 2);
  for (const x of [shallow, deep4, imm16]) {
    assert.ok(x.t90 !== null && x.t90 <= 150, `label-tier dose reverses promptly (${x.t90} s)`);
    assert.ok(!x.r.warnings.some((w) => /below the label/.test(w)));
  }
  assert.ok(deep2.t90 > deep4.t90 * 1.5, `2 mg/kg at deep block slower (${deep2.t90} vs ${deep4.t90} s)`);
  assert.ok(imm4.t90 === null || imm4.t90 > imm16.t90 * 1.5, `4 mg/kg soon after 1.2 mg/kg slower (${imm4.t90} vs ${imm16.t90} s)`);
  assert.equal(imm2.t90, null, '2 mg/kg soon after 1.2 mg/kg: incomplete reversal within 30 min');
  for (const x of [deep2, imm4, imm2]) {
    assert.ok(x.r.warnings.some((w) => /below the label (4|16) mg\/kg tier/.test(w)), x.r.warnings.join(' | '));
    assert.ok(x.sim.state.log.some((e) => /below the label/.test(e.message)), 'warning logged');
    assert.ok(x.sim.state.alarms.some((a) => a.id === 'sugammadex_dose'), 'warning shown as an alarm');
  }
});

// ---------------------------------------------------------------- clinical 6, 13, 14, 15, 17: PD recalibration
test('clinical 6: dexmedetomidine at labelled procedural doses gives moderate sedation (not general) and bradycardia', () => {
  for (const id of ['healthy_adult', 'elderly_cad_ckd']) {
    const sim = createSimulation({ patient: EX(id), library: REAL, interlocks: false, seed: 1 });
    const w = sim.patient.weightKg; const hr0 = sim.patient.baseline.hr;
    sim.administer({ drugId: 'dexmedetomidine', kind: 'bolus', amount: (id === 'healthy_adult' ? 1 : 0.5) * w, amountUnit: 'mcg', overSec: 600 });
    runFor(sim, 600);
    sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 1, rateUnit: 'mcg/kg/h' });
    const m = minDepth(sim, 1800);
    assert.ok(m >= 65, `${id}: depth ${m} stays out of the general-anaesthesia range`);
    assert.notEqual(sim.state.vitals.sedationLevel, 'general');
    assert.ok(sim.state.vitals.hr < hr0 * 0.9, `${id}: bradycardia kept (${sim.state.vitals.hr} vs ${hr0})`);
  }
});

test('clinical 13: 70 % nitrous oxide alone gives sedation, not general anaesthesia', () => {
  const sim = createSimulation({ patient: EX('healthy_adult'), library: REAL, seed: 1 });
  sim.action('set_fio2:0.3');
  assert.ok(sim.administer({ drugId: 'nitrous_oxide', kind: 'inhaled', rate: 70, rateUnit: '%' }).ok);
  const m = minDepth(sim, 1200);
  assert.ok(m >= 65, `N2O alone depth ${m}`);
});

test('clinical 14: ketamine causes less airway obstruction / respiratory depression than propofol', () => {
  const pt = derivePatient({ ...EXAMPLE_PATIENTS.find((e) => e.id === 'obese_osa').patient }, { library: REAL });
  const minRr = (drug, perKg) => { const s = createSimulation({ patient: pt, library: REAL, seed: 1 }); s.administer({ drugId: drug, kind: 'bolus', amount: perKg * s.patient.weightKg, amountUnit: 'mg' }); let rr = 99; for (let i = 0; i < 300; i++) { s.step(1); rr = Math.min(rr, s.state.vitals.rr); } return rr; };
  const k = minRr('ketamine', 2); const p = minRr('propofol', 2);
  assert.ok(k >= 10 && k > p, `ketamine min RR ${k} vs propofol ${p}`);
});

test('clinical 15: epinephrine infusion response rises monotonically with rate (no early plateau)', () => {
  const out = [0.05, 0.1, 0.2, 0.5, 1].map((r) => { const s = createSimulation({ patient: P(), library: REAL, seed: 1 }); s.administer({ drugId: 'epinephrine', kind: 'infusion', rate: r, rateUnit: 'mcg/kg/min' }); runFor(s, 600); return { r, map: s.phys.out._true.map, hr: s.phys.out._true.hr }; });
  for (let i = 1; i < out.length; i++) { assert.ok(out[i].map > out[i - 1].map); assert.ok(out[i].hr > out[i - 1].hr); }
  const p = P();
  assert.ok(out[3].map > p.map * 1.35 && out[3].hr > p.baseline.hr * 1.35, `0.5 mcg/kg/min: ${JSON.stringify(out[3])}`);
});

test('clinical 17: midazolam 1 mg in a healthy adult is minimal sedation', () => {
  const sim = createSimulation({ patient: EX('healthy_adult'), library: REAL, seed: 1 });
  sim.administer({ drugId: 'midazolam', kind: 'bolus', amount: 1, amountUnit: 'mg' });
  assert.ok(minDepth(sim, 900) >= 80);
});

// ---------------------------------------------------------------- clinical 7: anaphylaxis
test('clinical 7: perioperative anaphylaxis — IV 50 mcg rescue regimen sourced; IM absorption slowed by profound hypotension', () => {
  const rec = recommend(EX('healthy_adult'), 'rescue_iv', 'epinephrine', REAL);
  assert.equal(rec.dose.value, 0.05); assert.equal(rec.route, 'IV'); assert.deepEqual(rec.sources.slice(0, 2), ['S44', 'S45']);
  for (const id of ['S44', 'S45']) assert.ok(REAL.SOURCES[id] && REAL.SOURCES[id].verifiedVia);
  const run = (mode) => {
    const s = createSimulation({ patient: EX('healthy_adult'), library: REAL, seed: 1 }); const w = s.patient.weightKg;
    s.action('set_fio2:1'); s.administer({ drugId: 'propofol', kind: 'bolus', amount: 2 * w, amountUnit: 'mg' }); s.administer({ drugId: 'rocuronium', kind: 'bolus', amount: 0.6 * w, amountUnit: 'mg' });
    runFor(s, 90); s.action('secure_airway'); s.action('start_ventilation'); s.administer({ drugId: 'sevoflurane', kind: 'inhaled', rate: 2, rateUnit: '%' }); runFor(s, 300);
    s.inject('anaphylaxis_hypotension'); runFor(s, 150);
    if (mode === 'IM') s.administer({ drugId: 'epinephrine', kind: 'bolus', amount: 0.5, amountUnit: 'mg' });
    if (mode === 'IV') assert.ok(s.administer({ drugId: 'epinephrine', kind: 'bolus', amount: 0.05, amountUnit: 'mg', route: 'IV' }).ok);
    runFor(s, 120); return s.state.vitals.map;
  };
  const none = run('none'), im = run('IM'), iv = run('IV');
  assert.ok(im < 70, `IM 0.5 mg at MAP < 30: not a near-complete recovery within 2 min (${im})`);
  assert.ok(iv > none + 20, `IV 50 mcg titration raises MAP (${iv} vs ${none})`);
});

// ---------------------------------------------------------------- clinical 9-12
test('clinical 9-12: dexmedetomidine hepatic note on every regimen; fentanyl elderly warning; acetaminophen <50 kg caps; Eleveld opioid-only switch', () => {
  const liver = P({ conditions: ['liver_disease'] });
  for (const key of ['sedation_moderate', 'sedation_deep', 'maintenance']) assert.ok(recommend(liver, key, 'dexmedetomidine', REAL).notes.some((n) => /hepatic impairment/.test(n)), key);
  assert.ok(recommend(EX('elderly_cad_ckd'), 'induction', 'fentanyl', REAL).warnings.some((w) => /appropriately reduced in elderly and debilitated/.test(w)));
  const small = P({ weightKg: 49.9, heightCm: 160, sex: 'female' });
  const apap = interpretCeilings(REAL.DRUGS.find((d) => d.id === 'acetaminophen'), small);
  assert.ok(apap.some((l) => l.type === 'cumulative' && Math.abs(l.absolute - 3742.5) < 1e-6), '75 mg/kg/day');
  assert.ok(apap.some((l) => l.type === 'cumulative' && l.absolute === 3750), '3750 mg/day absolute');
  assert.ok(apap.some((l) => l.type === 'bolus' && l.absolute === 750), '750 mg per dose');
  const big = interpretCeilings(REAL.DRUGS.find((d) => d.id === 'acetaminophen'), P());
  assert.ok(big.some((l) => l.type === 'bolus' && l.absolute === 1000));
  const lidoOnly = createSimulation({ patient: P(), library: REAL, plan: { mode: 'GA', steps: [{ phase: 'induction', drugId: 'lidocaine', kind: 'bolus', amount: 50, amountUnit: 'mg' }] } });
  lidoOnly.administer({ drugId: 'propofol', kind: 'bolus', amount: 100, amountUnit: 'mg' });
  assert.equal(lidoOnly.models.propofol.params.opioids, false, 'IV lidocaine does not switch the Eleveld opioid covariate');
  const opi = createSimulation({ patient: P(), library: REAL, plan: { mode: 'GA', steps: [{ phase: 'induction', drugId: 'fentanyl', kind: 'bolus', amount: 100, amountUnit: 'mcg' }] } });
  opi.administer({ drugId: 'propofol', kind: 'bolus', amount: 100, amountUnit: 'mg' });
  assert.equal(opi.models.propofol.params.opioids, true);
});

// ---------------------------------------------------------------- clinical 16: sedation-target hold
test('clinical 16: the sedation target must hold for SEDATION_TARGET_HOLD_SEC before the procedure starts', () => {
  assert.equal(AUTORUN_CONFIG.SEDATION_TARGET_HOLD_SEC.value, 10);
  const step = buildSequence('MAC').find((s) => s.id === 'start_procedure');
  assert.equal(step.holdSec, 10);
  const p = EX('obese_osa');
  const { plan } = buildPlan(EXAMPLE_PLANS.find((x) => x.id === 'mac_obese_osa'), p, REAL);
  const sim = createSimulation({ patient: p, plan, library: REAL, seed: 1 });
  const A = createAutoRunner({ sim, mode: 'full' }); A.start();
  let started = null; const levels = [];
  for (let i = 0; i < 2400 && A.state === 'running' && started === null; i++) {
    sim.step(1); levels.push(sim.state.vitals.sedationLevel); A.tick();
    if (A.history.some((h) => h.id === 'start_procedure')) started = sim.state.tSec;
  }
  assert.ok(started !== null, 'procedure started');
  const rank = { awake: 0, minimal: 1, moderate: 2, deep: 3, general: 4 };
  const lastHeld = levels.slice(-11);
  assert.ok(lastHeld.every((l) => rank[l] >= rank.moderate), `target held for ≥ 10 s before start: ${lastHeld.join(',')}`);
});
