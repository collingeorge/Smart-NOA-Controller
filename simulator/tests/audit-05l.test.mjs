// Code audit 05l (simulator/AUDIT_2026-11.md → "Code audit, 05l"): alarm threshold text from config,
// explicit depth arming state, the interlock-before-physiology ordering (documented, unchanged) and the
// npm test file list. Finding 1 (advisor refresh) is DA-R in tests/depth-advisory-full-2026-11.test.mjs.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { REAL, clinicianResolves } from './helpers.mjs';
import { derivePatient } from '../engine/patient.js';
import { createSimulation } from '../engine/sim.js';
import { NOA_CONFIG, CONTROLLED, PY_TO_SIM_ID } from '../engine/interlocks.js';
import { EXAMPLE_PATIENTS, EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { createAutoRunner } from '../engine/autorun.js';
import { createDepthAdvisor, depthLowArmed } from '../engine/depth-advisory.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const pat = (id) => derivePatient(EXAMPLE_PATIENTS.find((x) => x.id === id).patient, { library: REAL });
const ex = (id) => EXAMPLE_PLANS.find((x) => x.id === id);
const THR = NOA_CONFIG.hemodynamic_thresholds;

/** Elderly GA example, full-auto, hemorrhage 5 min into surgery; calls onStep(sim) after every step until the hold pause. */
function hemorrhageCase(onStep = () => {}) {
  const p = pat('elderly_cad_ckd');
  const sim = createSimulation({ patient: p, plan: buildPlan(ex('ga_elderly_cad_ckd'), p, REAL).plan, seed: 1, library: REAL });
  const runner = createAutoRunner({ sim, mode: 'full' }); runner.start();
  let injected = false;
  for (let i = 0; i < 6000; i++) {
    if (runner.state === 'paused') {
      if (runner.pauseReasons.some((r) => r.kind === 'interlock_hold')) break;
      for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`);
      clinicianResolves(runner); runner.resume(); continue;
    }
    sim.step(1); onStep(sim); runner.tick();
    if (!injected && sim.stim.surgeryStartAt !== null && sim.state.tSec - sim.stim.surgeryStartAt > 300) { sim.inject('hemorrhage'); injected = true; }
  }
  return { sim, runner };
}

if (REAL) {
  test('A05l-3a critical MAP/HR alarm texts read NOA_CONFIG.hemodynamic_thresholds (no hard-coded 60 / 48)', () => {
    const code = src('../engine/sim.js').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/<\s*60 mmHg/.test(code) && !/<\s*48 \/min/.test(code), 'no literal threshold in the alarm messages');
    assert.match(code, /< \$\{NOA_CONFIG\.hemodynamic_thresholds\.map_critical_low\} mmHg \(interlock threshold\)/);
    assert.match(code, /< \$\{NOA_CONFIG\.hemodynamic_thresholds\.hr_critical_low\} \/min \(interlock threshold\)/);
    const { sim } = hemorrhageCase();
    const msgs = sim.alarmMgr.history.filter((h) => h.id === 'map_critical').map((h) => h.message);
    assert.ok(msgs.length > 0, 'map_critical alarm raised in the hemorrhage case');
    for (const m of msgs) assert.match(m, new RegExp(`^MAP (\\d+|unusable) < ${THR.map_critical_low} mmHg \\(interlock threshold\\)$`));
  });

  test('A05l-3b depth arming state (_locAt, _hypnoticSeenRunning) has one writer, updated once per substep; reads are pure and order-independent', () => {
    const code = src('../engine/sim.js');
    const writes = (re) => [...code.matchAll(re)].length;
    assert.equal(writes(/this\._hypnoticSeenRunning = true/g), 1, 'one writer of _hypnoticSeenRunning');
    assert.equal(writes(/this\._locAt = this\.state\.tSec/g), 1, 'one writer of the LOC marker');
    const body = code.slice(code.indexOf('  _updateDepthArmingState(V) {'), code.indexOf('  /** Depth-high alarm condition'));
    assert.match(body, /this\._hypnoticSeenRunning = true/); assert.match(body, /this\._locAt = this\.state\.tSec/);
    // Real runs (GA examples, full-auto): evaluating the depth-high arming and the depth-low advisory arming
    // in either order, any number of times, gives the same answers and leaves the state untouched.
    for (const id of ['ga_healthy', 'tiva_mh']) {
      const p = pat(ex(id).patientId);
      const sim = createSimulation({ patient: p, plan: buildPlan(ex(id), p, REAL).plan, seed: 2, library: REAL });
      createDepthAdvisor(sim);
      const runner = createAutoRunner({ sim, mode: 'full' }); assert.ok(runner.start().ok);
      let seen = null; let checked = 0;
      for (let i = 0; i < 14000 && !['completed', 'stopped', 'manual'].includes(runner.state); i++) {
        if (runner.state === 'paused') {
          for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`);
          if (sim.core.holdLatched) { sim.action('acknowledge_hold'); sim.action('resume_hold'); }
          clinicianResolves(runner); runner.resume(); continue;
        }
        sim.step(1);
        const V = sim.state.vitals; const st = () => [sim._locAt, sim._hypnoticSeenRunning];
        const s0 = st();
        const low1 = depthLowArmed(sim).armed; const high1 = sim._depthHighArmed(V);
        const high2 = sim._depthHighArmed(V); const low2 = depthLowArmed(sim).armed;
        assert.deepEqual([low2, high2], [low1, high1], `${id} t=${sim.state.tSec}: order-independent`);
        assert.deepEqual(st(), s0, `${id} t=${sim.state.tSec}: reads do not write the arming state`);
        if (seen === null && sim._hypnoticSeenRunning) seen = sim.state.tSec;
        checked++;
        runner.tick();
      }
      assert.ok(seen !== null && sim._locAt !== null && checked > 1000, `${id}: arming state reached (LOC ${sim._locAt}, hypnotic seen ${seen})`);
    }
  });

  test('A05l-5 interlocks evaluate before physiology (accepted, mirrors the Python loop): the hold latches one second after the reading; no held drug is delivered in that second', () => {
    // Elderly example patient, dexmedetomidine infusion (controlled by the Python-derived interlock), then
    // hemorrhage + anaphylaxis hypotension until MAP < 60 latches the hold.
    const sim = createSimulation({ patient: pat('elderly_cad_ckd'), library: REAL, seed: 1 });
    assert.ok(sim.administer({ drugId: 'dexmedetomidine', kind: 'infusion', rate: 0.4, rateUnit: 'mcg/kg/h' }).ok);
    sim.administer({ drugId: 'propofol', kind: 'bolus', amount: 100, amountUnit: 'mg' });
    sim.inject('hemorrhage'); sim.inject('anaphylaxis_hypotension');
    const ds = sim.state.drugs.dexmedetomidine; const rows = [];
    for (let i = 0; i < 1800 && !sim.core.holdLatched; i++) {
      sim.step(1);
      rows.push({ t: sim.state.tSec, map: sim.state.vitals.map, hr: sim.state.vitals.hr, latched: sim.core.holdLatched, cum: ds.cumulative, rate: ds.infusionRate });
    }
    const k = rows.findIndex((r) => r.latched);
    assert.ok(k > 1, 'hold latched');
    const prev = rows[k - 1]; const at = rows[k];
    assert.ok(prev.map < THR.map_critical_low || prev.hr < THR.hr_critical_low, `displayed reading crossed the threshold at t=${prev.t} (MAP ${prev.map}, HR ${prev.hr})`);
    assert.equal(prev.latched, false, 'not yet latched on the second the reading is displayed (one-second lag)');
    assert.ok(prev.rate > 0 && prev.cum > rows[k - 2].cum, 'the infusion was running up to that second');
    assert.equal(at.rate, 0, 'zeroed at the latch');
    assert.equal(at.cum, prev.cum, `no dexmedetomidine delivered in the lag second (${prev.cum} → ${at.cum})`);
    assert.ok(sim.state.interlocks.heldDrugs.includes('dexmedetomidine'), 'dexmedetomidine held');
    assert.ok(CONTROLLED.map((py) => PY_TO_SIM_ID[py]).includes('dexmedetomidine'));
    const code = src('../engine/sim.js');
    assert.ok(code.indexOf('// 4. Python-derived interlocks') < code.indexOf('// 9. physiology'), 'ordering unchanged');
    assert.match(code, /KNOWN, ACCEPTED ORDERING \(audit 05l, finding 5\)/);
  });
}

test('A05l-4 npm test runs every *.test.mjs file (parallel file glob); the folder shim loads the same set', () => {
  const pkg = JSON.parse(src('../package.json'));
  const m = /^node --test (?:--\S+ )*'?(tests\/\*\.test\.mjs)'?$/.exec(pkg.scripts.test);
  assert.ok(m, `test script is a node --test file glob: ${pkg.scripts.test}`);
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir);
  const tests = files.filter((f) => f.endsWith('.test.mjs'));
  assert.ok(tests.length >= 16, `${tests.length} test files`);
  for (const f of ['audit-05l.test.mjs', 'depth-advisory-full-2026-11.test.mjs', 'depth-advisory-2026-11.test.mjs', 'parity.test.mjs']) assert.ok(tests.includes(f), f);
  // Nothing that looks like a test file escapes the glob (ui.smoke.mjs is the separate browser suite, test:ui).
  const strays = files.filter((f) => /test|spec/i.test(f) && /\.(m?js|cjs)$/.test(f) && !f.endsWith('.test.mjs') && f !== 'index.js');
  assert.deepEqual(strays, [], 'no test-like file outside the glob');
  assert.equal(pkg.scripts['test:ui'], 'node --test tests/ui.smoke.mjs');
  assert.match(src('./index.js'), /filter\(\(n\) => n\.endsWith\('\.test\.mjs'\)\)/, 'tests/index.js (SPEC §1 `node --test simulator/tests`) loads the same *.test.mjs set');
});
