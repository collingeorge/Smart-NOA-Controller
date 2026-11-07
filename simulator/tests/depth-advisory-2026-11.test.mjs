// Depth-low advisory (engine/depth-advisory.js; owner-approved 2026-11): TEXT ONLY "lighten anaesthetic"
// advisory when the simulated processed-EEG index stays below the GA band during maintenance after incision.
// Not an alarm; never doses; never pauses guided/automatic mode. EDUCATIONAL SIMULATION — not a medical device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REAL, clinicianResolves } from './helpers.mjs';
import { drive, checkDA7, DONE, P } from './depth-advisory-runs.mjs';
import { createSimulation } from '../engine/sim.js';
import { EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { createAutoRunner } from '../engine/autorun.js';
import { TIMING_CONFIG } from '../engine/timing.js';
import { DepthLowAdvisor, createDepthAdvisor, depthLowArmed, DEPTH_LOW_CHECKLIST, DEPTH_LOW_DISCLAIMER, DEPTH_BAND_SOURCES, depthLowFootnote } from '../engine/depth-advisory.js';

const [LO, HI] = TIMING_CONFIG.GA_DEPTH_BAND.value;
const N = TIMING_CONFIG.DEPTH_LOW_ADVISORY_SUSTAIN_SEC.value;
const CLR = TIMING_CONFIG.DEPTH_LOW_ADVISORY_CLEAR.value;
const DOSE_RE = /\d\s*(mg|mcg|µg|g|mL|ml|%|mcg\/kg|mg\/kg|MAC\b|vol)/i;

/** Minimal stand-in for the fields the advisor reads (lets each rule be tested sample by sample). */
function fakeSim(over = {}) {
  const log = [];
  const sim = {
    plan: { mode: 'GA' }, _locAt: 100, _hypnoticSeenRunning: true, running: true,
    _maintenanceHypnoticRunning() { return this.running; },
    stim: { surgeryStartAt: 500, surgeryEndAt: null },
    state: { tSec: 1000, phase: 'maintenance', airway: { secured: true }, sensors: {}, vitals: { depthIndex: 50 } },
    logNote: (kind, msg) => log.push({ kind, msg }), log, ...over,
  };
  return sim;
}
/** New advisor on the fake sim, evaluated once at creation (as createDepthAdvisor does). */
const mk = (sim) => { const a = new DepthLowAdvisor(sim); a.update(); return a; };
/** Steps the fake sim by 1 s with the given index and updates the advisor. */
const tick = (sim, adv, idx, n = 1) => { for (let i = 0; i < n; i++) { sim.state.tSec += 1; sim.state.vitals.depthIndex = idx; adv.update(); } return adv.view(); };

test('DA1 config: sustain 300 s and clear 42 are simulator conventions in TIMING_CONFIG and the parameter inventory; the GA band is reused, not redefined', () => {
  assert.equal(N, 300); assert.equal(CLR, 42);
  for (const k of ['DEPTH_LOW_ADVISORY_SUSTAIN_SEC', 'DEPTH_LOW_ADVISORY_CLEAR']) {
    assert.equal(TIMING_CONFIG[k].provenance, 'simulator_convention', k);
    assert.equal(TIMING_CONFIG[k].sourceIds.length, 0, k);
    assert.match(TIMING_CONFIG[k].rationale, /convention|teaching choice/, k);
  }
  assert.deepEqual([...DEPTH_BAND_SOURCES], ['S52', 'S53']);
  for (const id of DEPTH_BAND_SOURCES) assert.ok(REAL.SOURCES[id], id);
  const src = readFileSync(new URL('../engine/depth-advisory.js', import.meta.url), 'utf8');
  assert.ok(!/\[\s*40\s*,\s*60\s*\]|[<>]=?\s*(40|42|60)\b|\b(120|300)\b/.test(src.replace(/^\s*\/\/.*$/gm, '')), 'no band / sustain / clear literal in the module code (reads TIMING_CONFIG)');
  const inv = createSimulation({ patient: P('healthy_adult'), library: REAL }).parameterInventory();
  for (const k of ['DEPTH_LOW_ADVISORY_SUSTAIN_SEC', 'DEPTH_LOW_ADVISORY_CLEAR']) assert.ok(inv.some((x) => x.component === 'timing' && x.name === k && x.provenance === 'simulator_convention'), k);
  const card = readFileSync(new URL('../MODEL_CARD.md', import.meta.url), 'utf8');
  assert.match(card, /\| DEPTH_LOW_ADVISORY_SUSTAIN_SEC \| 300 \|/); assert.match(card, /\| DEPTH_LOW_ADVISORY_CLEAR \| 42 \|/);
  const ev = readFileSync(new URL('../TIMING_EVIDENCE.md', import.meta.url), 'utf8');
  assert.match(ev, /\| 65 \| Depth-low advisory/);
});

test('DA2 content is text only: no drug, dose, rate or percentage; footnote names the trials; no outcome claims', () => {
  const sim = fakeSim(); const adv = mk(sim);
  const v = tick(sim, adv, 35, N + 1);
  assert.equal(v.visible, true);
  assert.equal(v.headline, `Depth index 35 below the GA target band (${LO}–${HI}) for ≥ ${N} s — the anaesthetic may be deeper than needed.`);
  assert.equal(DEPTH_LOW_DISCLAIMER, 'Advisory only — the simulator never changes a dose by itself.');
  assert.equal(depthLowFootnote(), 'Advisory only — the simulator never changes a dose by itself. Simulated index (illustrative); the 40–60 band is the protocol target used in B-Unaware/BAG-RECALL');
  assert.equal(DEPTH_LOW_CHECKLIST.length, 4);
  const all = [v.headline, ...v.checklist, v.footnote, DEPTH_LOW_DISCLAIMER].join(' ');
  for (const x of v.checklist) assert.ok(!DOSE_RE.test(x), x);
  assert.ok(!/reduce .* by|decrease .* to|\bset\b .* to \d/i.test(all), 'no instruction to change a value by a number');
  assert.ok(!/mortality|delirium|death|outcome|cognitive/i.test(all), 'no outcome claims');
  assert.match(v.checklist.join(' '), /end-tidal \/ MAC/); assert.match(v.checklist.join(' '), /propofol infusion rate/);
  assert.match(v.checklist.join(' '), /hypotensive/); assert.match(v.checklist.join(' '), /artefact/);
});

test('DA3 fires only after the index is below the band for ≥ 300 s (DEPTH_LOW_ADVISORY_SUSTAIN_SEC); any sample at the lower bound restarts the count', () => {
  const sim = fakeSim(); const adv = mk(sim);
  assert.equal(tick(sim, adv, LO - 1, N - 1).visible, false, `${N - 1} s below: nothing`);
  assert.equal(tick(sim, adv, LO).visible, false, 'index at the bound resets');
  assert.equal(tick(sim, adv, LO - 5, N - 1).visible, false);
  const v = tick(sim, adv, LO - 5);
  assert.equal(v.visible, true, `shown at ${N} s`); assert.equal(adv.entries.length, 1);
  assert.match(sim.log.at(-1).msg, /^ADVISORY shown: DEPTH-1 — processed-EEG depth index 35 below the GA target band \(40–60\) for ≥ 300 s/);
  assert.equal(sim.log.at(-1).kind, 'advisory');
});

test('DA4 hysteresis: stays shown between the bound and the clearing value; clears at ≥ 42; a new episode needs another 300 s', () => {
  const sim = fakeSim(); const adv = mk(sim);
  tick(sim, adv, 30, N);
  assert.equal(tick(sim, adv, LO).visible, true, 'still shown at 40');
  assert.equal(tick(sim, adv, CLR - 1, 30).visible, true, 'still shown at 41');
  assert.equal(tick(sim, adv, CLR).visible, false, 'cleared at 42');
  assert.equal(adv.entries[0].status, 'expired'); assert.match(adv.entries[0].note, /index recovered to 42/);
  assert.equal(tick(sim, adv, 30, N - 1).visible, false, 'new episode not yet');
  assert.equal(tick(sim, adv, 30).visible, true); assert.equal(adv.entries.length, 2);
});

test('DA5 arming: not in MAC, not before loss of consciousness, not before incision, not in emergence, not after agents off, not on an unusable reading', () => {
  const cases = [
    ['MAC', { plan: { mode: 'MAC' } }],
    ['pre-LOC', { _locAt: null }],
    ['before incision', { stim: { surgeryStartAt: null, surgeryEndAt: null } }],
    ['airway not secured', (s) => { s.state.airway.secured = false; }],
    ['induction', (s) => { s.state.phase = 'induction'; }],
    ['sedation', (s) => { s.state.phase = 'sedation'; }],
    ['emergence', (s) => { s.state.phase = 'emergence'; }],
    ['agents off after surgery', (s) => { s.stim.surgeryEndAt = 900; s.running = false; }],
    ['depth sensor fault', (s) => { s.state.sensors.depth = 'fault'; }],
  ];
  for (const [label, over] of cases) {
    const sim = typeof over === 'function' ? fakeSim() : fakeSim(over); if (typeof over === 'function') over(sim);
    const adv = mk(sim);
    assert.equal(depthLowArmed(sim).armed, false, label);
    assert.equal(tick(sim, adv, 25, 3 * N).visible, false, label);
    assert.equal(adv.entries.length, 0, label);
  }
  // Closing (surgery ended) with the hypnotic still running stays armed; emergence ends an open episode.
  const sim = fakeSim(); const adv = mk(sim);
  sim.stim.surgeryEndAt = 900; assert.equal(depthLowArmed(sim).armed, true);
  assert.equal(tick(sim, adv, 30, N).visible, true);
  sim.state.phase = 'emergence';
  assert.equal(tick(sim, adv, 30).visible, false);
  assert.equal(adv.entries[0].status, 'expired'); assert.match(adv.entries[0].note, /disarmed \(phase emergence\)/);
});

test('DA6 Dismiss: logged, card hidden for the rest of the episode, shown again in a later episode; unknown id refused', () => {
  const sim = fakeSim(); const adv = mk(sim);
  tick(sim, adv, 30, N);
  assert.equal(adv.dismiss('DEPTH-9').ok, false);
  const r = adv.dismiss('DEPTH-1');
  assert.equal(r.ok, true); assert.match(sim.log.at(-1).msg, /^ADVISORY dismissed by the clinician: DEPTH-1 \(depth index below the GA band; text only, no dose changed\)\./);
  assert.equal(adv.view().visible, false); assert.equal(adv.view().dismissed, true);
  assert.equal(adv.dismiss('DEPTH-1').ok, false, 'not twice');
  assert.equal(tick(sim, adv, 30, 200).visible, false, 'stays hidden in the same episode');
  tick(sim, adv, 50);
  assert.equal(tick(sim, adv, 30, N).visible, true, 'new episode shows again');
  const rec = adv.record();
  assert.equal(rec.shown, 2); assert.equal(rec.dismissed, 1);
  assert.deepEqual(rec.entries.map((x) => x.status), ['dismissed', 'shown']);
  assert.ok(rec.entries[0].endedAtSec > rec.entries[0].resolvedAtSec);
  assert.equal(rec.totalBelowBandSec, N + 200 + N);
});

// ---------------------------------------------------------------- real runs: example plans × guided/full × seeds 1–20
// The driver and the DA7 body live in tests/depth-advisory-runs.mjs. DA7 is split by mode across two files so
// that node --test runs them in parallel (audit 05l, finding 4): guided here, full-auto in
// tests/depth-advisory-full-2026-11.test.mjs (DA7-full and DA-R). Same assertions, same 4 plans × 20 seeds.
if (REAL) {
  test('DA7 example plans × guided × seeds 1–20: identical completion outcomes, doses, alarms and pauses with the advisor; it appears only after incision in GA', (t) => {
    checkDA7(t, 'guided');
  });

  test('DA8 determinism: same seed → identical depth-advisory record and log', () => {
    const tpl = EXAMPLE_PLANS.find((x) => x.id === 'ga_healthy');
    const a = drive(tpl, 'full', 3, true); const b = drive(tpl, 'full', 3, true);
    assert.deepEqual(a.adv.record(), b.adv.record());
    assert.deepEqual(a.sim.state.log, b.sim.state.log);
    assert.ok(a.adv.record().shown >= 1, 'healthy sevoflurane GA example: advisory shown at label-default doses');
  });

  test('DA9 the pre-incision "acknowledge index below the GA band" item is unchanged; the summary defaults to used:false without the advisor', () => {
    const tpl = EXAMPLE_PLANS.find((x) => x.id === 'ga_healthy');
    const r = drive(tpl, 'full', 1, true);
    assert.ok(r.sim.state.log.some((e) => /Clinician acknowledged a processed-EEG depth index/.test(e.message)), 'gate still acknowledged by the clinician (test stand-in) before incision');
    const first = r.adv.record().entries[0];
    const ack = r.sim.state.periop.depthAck;
    assert.ok(ack && first.shownAtSec > ack.tSec, 'advisory after the pre-incision acknowledgement');
    assert.deepEqual(createSimulation({ patient: P('healthy_adult'), library: REAL }).summary().depthAdvisories, { used: false, shown: 0, dismissed: 0, entries: [] });
    assert.equal(createDepthAdvisor(r.sim), r.adv, 'one advisor per simulation');
  });
}

// ---------------------------------------------------------------- 05l: disarm on the same simulated second as "Begin emergence"
test('DA-L the card disarms on the same simulated second as Begin emergence (no one-step lag); outcomes unchanged', () => {
  let checked = 0;
  for (const id of ['ga_healthy', 'ga_elderly_cad_ckd']) {
    const tpl = EXAMPLE_PLANS.find((x) => x.id === id);
    for (let seed = 1; seed <= 20; seed++) {
      const p = P(tpl.patientId); const { plan } = buildPlan(tpl, p, REAL);
      const sim = createSimulation({ patient: p, plan, library: REAL, seed });
      const adv = createDepthAdvisor(sim);
      const runner = createAutoRunner({ sim, mode: 'full' });
      assert.ok(runner.start().ok);
      let prevPhase = sim.state.phase;
      for (let i = 0; i < 14000 && !DONE.includes(runner.state); i++) {
        if (runner.state === 'paused') {
          for (const a of sim.state.alarms) if (a.priority === 'high' && !a.acknowledged) sim.action(`acknowledge:${a.id}`);
          if (sim.core.holdLatched) sim.action('resume_hold');
          clinicianResolves(runner); runner.resume(); continue;
        }
        sim.step(1); runner.tick();
        if (sim.state.phase === 'emergence' && prevPhase !== 'emergence') {
          const wasOpen = adv.entries.some((x) => x.endedAtSec === sim.state.tSec && /disarmed \(phase emergence\)/.test(x.note || ''));
          assert.equal(adv.view().visible, false, `${id} seed ${seed}: card hidden at the emergence second t=${sim.state.tSec}`);
          if (wasOpen) checked++;
        }
        if (sim.state.phase === 'emergence') assert.equal(adv.view().visible, false, `${id} seed ${seed}: never visible in emergence`);
        prevPhase = sim.state.phase;
      }
      for (const x of adv.entries) if (/disarmed \(phase emergence\)/.test(x.note || '')) {
        const ph = sim.state.log.find((l) => l.kind === 'phase' && /Phase: emergence/.test(l.message));
        assert.ok(ph, 'emergence logged');
        assert.equal(x.endedAtSec, ph.tSec, `${id} seed ${seed}: disarmed at the emergence second (${x.endedAtSec} vs ${ph.tSec})`);
        const dl = sim.state.log.find((l) => l.kind === 'advisory' && /disarmed \(phase emergence\)/.test(l.message));
        assert.equal(dl.tSec, ph.tSec, `${id} seed ${seed}: log entry on the same second`);
      }
    }
  }
  assert.ok(checked >= 1, `at least one card was open at Begin emergence (got ${checked})`);
});

test('DA-L2 a zero-time re-evaluation after an action never starts or lengthens an episode', () => {
  const sim = fakeSim(); const adv = mk(sim);
  tick(sim, adv, 30, N - 1);
  for (let i = 0; i < 50; i++) adv.update(); // same simulated second: dt = 0
  assert.equal(adv.view().visible, false, 'still not shown before N s of simulated time');
  tick(sim, adv, 30);
  assert.equal(adv.view().visible, true); assert.equal(adv.entries.length, 1);
});
