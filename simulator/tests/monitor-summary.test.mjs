import assert from 'node:assert/strict';
import test from 'node:test';
import { recordMonitorSample, summarizeMonitor } from '../engine/monitor-summary.js';
import { briefingBlocks } from '../ui/debrief-pdf.js';

test('monitor statistics are time-weighted and exclude faults and unavailable ratios', () => {
  const totals = {};
  recordMonitorSample(totals, { map: 70, tofCount: 4, tofRatio: 0.8 }, 1);
  recordMonitorSample(totals, { map: 90, tofCount: 2, tofRatio: 0 }, 3);
  recordMonitorSample(totals, { map: NaN, tofCount: 4, tofRatio: 1 }, 1);
  const rows = Object.fromEntries(summarizeMonitor(totals).map((row) => [row.id, row]));
  assert.deepEqual([rows.map.min, rows.map.mean, rows.map.max, rows.map.observedSec], [70, 85, 90, 4]);
  assert.deepEqual([rows.tofRatio.min, rows.tofRatio.mean, rows.tofRatio.max], [0.8, 0.9, 1]);
  assert.equal(rows.depthIndex.mean, null);
  assert.equal(briefingBlocks({ durationSec: 5, monitor: Object.values(rows) })[0].text, 'BLUF | Case outcome');
});
