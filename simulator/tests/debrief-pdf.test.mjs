import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDebriefPdf, workflowBlocks } from '../ui/debrief-pdf.js';

test('instructor workflow records plan execution, alarm clearing, and the complete event trail', () => {
  const blocks = workflowBlocks({
    plan: { steps: [{ id: 'p1', phase: 'induction', atSec: 195, drugId: 'propofol', kind: 'bolus', amount: 80,
      amountUnit: 'mg', route: 'IV', regimenKey: 'induction', timingRationale: { text: 'Scheduled induction', sources: ['S11'] } }] },
    planStatus: [{ id: 'p1', status: 'done', result: { tSec: 916 } }],
    summary: { alarms: [{ sinceSec: 930, clearedSec: 950, priority: 'medium', message: 'Simulated low MAP' }] },
    automaticMode: { pauses: [{ tSec: 950, resumedAtSec: 980, reasons: ['Learner checklist confirmation required'] }] },
    log: [{ tSec: 916, kind: 'dose', message: 'Propofol administered' }, { tSec: 980, kind: 'action', message: 'Confirmed checklist' }],
  });
  const text = blocks.map((block) => block.text).join('\n');
  for (const expected of ['+3:15', '80 mg IV', '15:16', 'Scheduled induction', 'Cleared 15:50', 'Resumed 16:20', 'Confirmed checklist']) {
    assert.ok(text.includes(expected), expected);
  }
});

test('debrief PDF has valid byte offsets, multiple pages, and reviewer feedback', () => {
  const pdf = buildDebriefPdf('Perioperative anesthesia', Array.from({ length: 85 }, (_, i) => ({
    text: `Event ${i + 1}: monitor (SpO₂ ≥ 95%) — case review.`,
  })));
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /Fictional patient/);
  assert.match(pdf, /Reviewer feedback/);
  assert.ok(pdf.includes('monitor \\(SpO2 >= 95%\\)'));
  assert.ok(Number(pdf.match(/\/Count (\d+)/)[1]) > 1);
  assert.equal(Buffer.byteLength(pdf), pdf.length);
  const offset = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(offset, offset + 4), 'xref');
  const entries = pdf.slice(offset).split('\n').filter((line) => /^\d{10} 00000 n /.test(line));
  for (const [index, entry] of entries.entries()) {
    assert.ok(pdf.slice(Number(entry.slice(0, 10))).startsWith(`${index + 1} 0 obj`));
  }
});
