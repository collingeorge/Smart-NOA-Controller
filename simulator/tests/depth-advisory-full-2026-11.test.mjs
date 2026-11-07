// Depth-low advisory, full-auto real runs (engine/depth-advisory.js). Split from
// tests/depth-advisory-2026-11.test.mjs so that node --test runs it in parallel (audit 05l, finding 4).
// EDUCATIONAL SIMULATION — fictional patients — not a medical device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REAL } from './helpers.mjs';
import { EXAMPLE_PLANS } from '../data/scenarios.js';
import { checkDA7, driveCached } from './depth-advisory-runs.mjs';

if (REAL) {
  test('DA7 example plans × full × seeds 1–20: identical completion outcomes, doses, alarms and pauses with the advisor; it appears only after incision in GA', (t) => {
    checkDA7(t, 'full');
  });

  // Audit 05l, finding 1: the plan scheduler inside _substep used to call the public action()/administer(),
  // whose depth-advisor refresh then ran mid-substep with dt = 1 on the previous second's index.
  test('DA-R refresh after an action never adds time; none runs inside _substep; card counts and outcomes equal the step-only path (4 example plans × seeds 1–20, full-auto)', (t) => {
    const expected = { ga_healthy: [20, 20], ga_elderly_cad_ckd: [20, 20], tiva_mh: [3, 3], mac_obese_osa: [0, 0] };
    const got = {}; let refreshes = 0; let ended = 0;
    for (const tpl of EXAMPLE_PLANS) {
      let runs = 0; let cards = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const r = driveCached(tpl, 'full', seed); const tag = `${tpl.id} seed ${seed}`;
        for (const c of r.probe.calls) {
          assert.equal(c.inSubstep, false, `${tag} t=${c.t}: no advisor update from inside _substep`);
          if (!c.refreshOnly) continue;
          refreshes++;
          const { before: b, after: a } = c;
          assert.equal(a.lastT, b.lastT, `${tag} t=${c.t}: refresh does not move lastT`);
          assert.equal(a.totalBelowSec, b.totalBelowSec, `${tag} t=${c.t}: refresh adds no time below the band`);
          assert.equal(a.entries, b.entries, `${tag} t=${c.t}: refresh never starts an episode`);
          assert.ok(a.runSec <= b.runSec && (a.active ? a.episodeSec === b.episodeSec : true), `${tag} t=${c.t}: refresh never lengthens a run or episode`);
          if (b.active && !a.active) ended++;
        }
        const real = r.adv.record(); const step = r.probe.shadow.record();
        assert.equal(real.shown, step.shown, `${tag}: card count equals the step-only path`);
        assert.equal(real.totalBelowBandSec, step.totalBelowBandSec, `${tag}: time below the band equals the step-only path`);
        real.entries.forEach((x, i) => {
          const y = step.entries[i];
          assert.equal(x.shownAtSec, y.shownAtSec, `${tag} ${x.id}: shown on the same second`);
          assert.equal(x.status, y.status, `${tag} ${x.id}: same outcome`);
          assert.equal(x.index, y.index, `${tag} ${x.id}`);
          if (x.endedAtSec !== y.endedAtSec) {
            // Only allowed difference: the refresh ends the card on the action's second (e.g. Begin emergence),
            // the step-only path one step later; it is never later and never longer.
            assert.match(x.note, /disarmed/, `${tag} ${x.id}: only a disarm may end earlier`);
            assert.ok(y.endedAtSec === null || (x.endedAtSec < y.endedAtSec && y.endedAtSec - x.endedAtSec <= 1), `${tag} ${x.id}: ended ${x.endedAtSec} vs step-only ${y.endedAtSec}`);
            assert.ok(x.episodeSec <= y.episodeSec, `${tag} ${x.id}: never longer`);
          } else assert.equal(x.episodeSec, y.episodeSec, `${tag} ${x.id}: same episode length`);
        });
        if (real.shown) runs++; cards += real.shown;
      }
      got[tpl.id] = [runs, cards];
    }
    assert.deepEqual(got, expected, 'full-auto card counts (runs with a card, cards) for seeds 1–20');
    assert.ok(refreshes > 0 && ended >= 1, `refresh path exercised (${refreshes} refresh calls, ${ended} episodes ended by a refresh)`);
    t.diagnostic(`refresh-only calls: ${refreshes}; episodes ended by a refresh: ${ended}; counts ${JSON.stringify(got)}`);
  });
}
