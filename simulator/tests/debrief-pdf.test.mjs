import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDebriefPdf } from '../ui/debrief-pdf.js';

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
