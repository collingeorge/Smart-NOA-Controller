// Regenerates the generated sections of simulator/MODEL_CARD.md from the engine:
//   "## Parameter inventory (N parameters)"  — sim.parameterInventory() (healthy example patient)
//   "## Automatic demonstration and guided mode" — engine/autorun-config.js + engine/autorun.js
// Usage (from the repository root):  node simulator/tools/model-card-tables.mjs [--check]
// --check exits 1 if MODEL_CARD.md is out of date. Pure Node; no network.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as LIB from '../data/drugs.js';
import { derivePatient } from '../engine/patient.js';
import { createSimulation } from '../engine/sim.js';
import { EXAMPLE_PATIENTS } from '../data/scenarios.js';
import { AUTORUN_CONFIG, CONVENTION } from '../engine/autorun-config.js';
import { buildSequence } from '../engine/autorun.js';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'MODEL_CARD.md');
const fmt = (v) => (typeof v === 'string' ? JSON.stringify(v) : typeof v === 'number' ? String(Number(v.toPrecision(6))) : Array.isArray(v) ? JSON.stringify(v.join(', ')) : String(v));

const sim = createSimulation({ patient: derivePatient(EXAMPLE_PATIENTS[0].patient, { library: LIB }), library: LIB });
const inv = sim.parameterInventory();
const counts = {};
for (const x of inv) counts[x.provenance] = (counts[x.provenance] || 0) + 1;
const invSection = [
  `## Parameter inventory (${inv.length} parameters)`,
  `Provenance counts: ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}.`,
  '',
  '| Component | Drug | Parameter | Value | Unit | Provenance | Sources | Note |',
  '|---|---|---|---|---|---|---|---|',
  ...inv.map((x) => `| ${x.component} | ${x.drugId || ''} | ${x.name} | ${fmt(x.value)} | ${x.unit || ''} | ${x.provenance} | ${(x.sourceIds || []).join(', ')} | ${x.note || ''} |`),
  '',
].join('\n');

const seqRows = (mode) => buildSequence(mode).map((s, i) => `${i + 1}. **${s.label}** — ${s.gate ? `gate “${s.gateLabel}” (guided: you press it; full demonstration: passes automatically)` : 'automatic in both modes'}; ${s.describe}.`);
const autoSection = [
  '## Automatic demonstration and guided mode',
  'Generated from `engine/autorun-config.js` and `engine/autorun.js`. Both modes are a **scripted sequence** of the same phase and airway actions as the manual Run-screen buttons (`engine/case-actions.js`); they are not a controller and not a clinical recommendation, and they have not been evaluated against clinical practice. They never give, change or stop a drug (only the user\'s plan steps do), never extubate unless `sim.extubationReadiness()` is met (the "Extubate anyway" override is never used), pause on a latched interlock hold or an unacknowledged HIGH-priority alarm without releasing or acknowledging it, and end as soon as any manual control is used.',
  '',
  'While either mode runs, an on-screen banner (exact text: `BANNERS` in `engine/autorun.js`) states that it is a scripted educational sequence, not a controller or a clinical recommendation. Steps taken are logged with the prefix `AUTO:` (log kind `auto`), and the debrief and the downloaded session JSON (`automaticMode`, `summary.automatic`) record the mode, outcome, pauses and where/why it stopped.',
  '',
  '**GA sequence**', '', ...seqRows('GA'), '',
  '**MAC sequence**', '', ...seqRows('MAC'), '',
  `Every condition and timing (${Object.keys(AUTORUN_CONFIG).length} entries; also listed in the parameter inventory as component \`autorun\`):`,
  '',
  '| Entry | Value | Unit | Applies to | Provenance | Sources | Rationale |',
  '|---|---|---|---|---|---|---|',
  ...Object.entries(AUTORUN_CONFIG).map(([k, x]) => `| ${k} | ${fmt(x.value)} | ${x.unit} | ${x.appliesTo === 'full' ? 'full demonstration' : x.appliesTo === 'guided' ? 'guided' : 'both'} | ${x.provenance === CONVENTION ? 'simulator convention (unsourced)' : x.provenance} | ${x.sourceIds.join(', ')} | ${x.rationale} |`),
  '',
].join('\n');

const md = readFileSync(file, 'utf8');
const replaceSection = (text, startRe, body) => {
  const parts = text.split(/\n(?=## )/);
  const i = parts.findIndex((p) => startRe.test(p));
  if (i < 0) return null;
  parts[i] = body;
  return parts.join('\n');
};
let out = replaceSection(md, /^## Parameter inventory/, invSection);
const withAuto = replaceSection(out, /^## Automatic demonstration and guided mode/, autoSection);
out = withAuto !== null ? withAuto : out.replace(/\n## Sources\n/, `\n${autoSection}\n## Sources\n`);
if (process.argv.includes('--check')) { if (out !== md) { console.error('MODEL_CARD.md is out of date: run node simulator/tools/model-card-tables.mjs'); process.exit(1); } console.log('MODEL_CARD.md up to date'); }
else { writeFileSync(file, out); console.log(`MODEL_CARD.md: ${inv.length} inventory rows, ${Object.keys(AUTORUN_CONFIG).length} autorun entries`); }
