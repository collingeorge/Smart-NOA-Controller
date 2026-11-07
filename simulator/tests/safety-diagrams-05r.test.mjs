// 05r: the Mermaid diagrams in /SAFETY_DESIGN.md are generated from the engine configuration
// (tools/safety-diagrams.mjs). This test runs the generator's --check mode (fails if the page drifted from the
// code) and shows that the numbers come from the configuration, not from hand-typed text.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NOA_CONFIG } from '../engine/interlocks.js';
import { TIMING_CONFIG } from '../engine/timing.js';
import { TEACHING_CEILINGS } from '../engine/teaching-ceilings.js';
import { buildBlocks, render, FILE, BLOCKS } from '../tools/safety-diagrams.mjs';

const TOOL = fileURLToPath(new URL('../tools/safety-diagrams.mjs', import.meta.url));

test('node tools/safety-diagrams.mjs --check passes (SAFETY_DESIGN.md matches the configuration)', () => {
  const r = spawnSync(process.execPath, [TOOL, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /up to date/);
});

test('the decision tree carries the NOA_CONFIG thresholds and follows evaluate() order', () => {
  const t = buildBlocks()['decision-tree'];
  const c = NOA_CONFIG; const P = c.sensor_plausibility;
  for (const s of [`HR < ${c.hemodynamic_thresholds.hr_critical_low} /min`, `MAP < ${c.hemodynamic_thresholds.map_critical_low} mmHg`, `${P.hr_min}-${P.hr_max} /min`, `more than ${P.hr_max_drop_per_sec} /min`, `more than ${P.map_max_drop_per_sec} mmHg`, `${c.interlock_long_hold_advisory_sec} s`]) assert.ok(t.includes(s), s);
  const order = ['Enforce constraints', 'Suspension set and its end time reached', 'Sensor problem', 'simulation ceiling', 'Update the dexmedetomidine model', 'HR <', 'MAP <', 'Status for this second', 'cancel an acknowledgment', 'Hold latched for another'];
  const pos = order.map((s) => t.indexOf(s));
  assert.ok(pos.every((p) => p >= 0), JSON.stringify(pos));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, 'branches appear in evaluate() order');
  assert.doesNotMatch(t, /<br|<\/?[a-z]+>/i, 'plain-text labels only (no HTML)');
});

test('changing the configuration changes the generated numbers (nothing is hand-typed)', () => {
  const noa = { ...NOA_CONFIG, hemodynamic_thresholds: { hr_critical_low: 47, map_critical_low: 61 }, interlock_suspension_max_sec: 240, interlock_long_hold_advisory_sec: 900, sensor_plausibility: { ...NOA_CONFIG.sensor_plausibility, hr_max_drop_per_sec: 35 } };
  const timing = { ...TIMING_CONFIG, PHENYLEPHRINE_REPEAT_MIN_SEC: { ...TIMING_CONFIG.PHENYLEPHRINE_REPEAT_MIN_SEC, value: 90 } };
  const teaching = { ...TEACHING_CEILINGS, CRYSTALLOID_TOTAL_ML_PER_KG: { ...TEACHING_CEILINGS.CRYSTALLOID_TOTAL_ML_PER_KG, value: 25 } };
  const b = buildBlocks({ noa, timing, teaching });
  assert.ok(b['decision-tree'].includes('HR < 47 /min') && b['decision-tree'].includes('MAP < 61 mmHg') && b['decision-tree'].includes('more than 35 /min') && b['decision-tree'].includes('15 min (900 s)'));
  assert.ok(b['hold-lifecycle'].includes('HR < 47'));
  assert.ok(b['clinician-loop'].includes('1-240 s'));
  assert.ok(b.architecture.includes('(90 / 120 / 300 s)') && b.architecture.includes('25 mL/kg TBW'));
  const md = readFileSync(FILE, 'utf8');
  assert.notEqual(render(md, b), md, 'a drifted configuration makes --check fail');
});

test('SAFETY_DESIGN.md: markers, required framing, prose numbers match the configuration', () => {
  const md = readFileSync(FILE, 'utf8');
  for (const n of BLOCKS) { assert.ok(md.includes(`<!-- safety-diagrams:${n}:start -->`)); assert.ok(md.includes(`<!-- safety-diagrams:${n}:end -->`)); }
  assert.ok(md.startsWith('# How the safety logic works, and why these design principles reduce risk\n'));
  assert.ok(md.includes("This simulation does not reduce anyone's liability or insurance costs; real reductions depend on validated, regulated devices and institutional practice."));
  const c = NOA_CONFIG; const T = (k) => TIMING_CONFIG[k].value;
  for (const s of [`lasts 1–${c.interlock_suspension_max_sec} s`, `every ${c.interlock_long_hold_advisory_sec / 60} minutes`, `phenylephrine IV ${T('PHENYLEPHRINE_REPEAT_MIN_SEC')} s`, `glycopyrrolate IV ${T('GLYCOPYRROLATE_RESCUE_REPEAT_MIN_SEC')} s`, `epinephrine IM/SC ${T('EPINEPHRINE_IM_REPEAT_MIN_SEC')} s`,
    `IV epinephrine boluses ${TEACHING_CEILINGS.EPINEPHRINE_IV_BOLUS_TOTAL.value} mg`, `glycopyrrolate boluses ${TEACHING_CEILINGS.GLYCOPYRROLATE_BOLUS_TOTAL.value} mg`, `crystalloid ${TEACHING_CEILINGS.CRYSTALLOID_TOTAL_ML_PER_KG.value} mL/kg`]) assert.ok(md.includes(s), s);
  // every Mermaid block has a text alternative right after it
  const blocks = md.split('```mermaid').length - 1;
  assert.equal(blocks, 4);
  assert.equal((md.match(/\*\*Text alternative\.\*\*/g) || []).length, 4);
  assert.match(md, /confirmed against the full source/);
});
