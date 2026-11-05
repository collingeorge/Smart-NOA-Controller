// Regenerates the generated sections of simulator/MODEL_CARD.md from the engine:
//   "## Parameter inventory (N parameters)"  — sim.parameterInventory() (healthy example patient)
//   "## Automatic demonstration and guided mode" — engine/autorun-config.js + engine/autorun.js
//   "## Timing rules and template timing" — engine/timing.js TIMING_CONFIG + data/templates.js timingRationale
//   "## Palliative and end-of-life modules" — engine/palliative.js palliativeParameterInventory()
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
import { TIMING_CONFIG, PREMED_TO_INDUCTION_MIN_SEC, PROVENANCE_TEXT } from '../engine/timing.js';
import { TECHNIQUE_TEMPLATES } from '../data/templates.js';
import { palliativeParameterInventory } from '../engine/palliative.js';

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

const mmss = (v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
const cell = (t) => String(t).replace(/\|/g, '\\|');
const timingSection = [
  '## Timing rules and template timing',
  'Generated from `engine/timing.js` (`TIMING_CONFIG`, the plan timing validator, live timing checks, pre-incision verification and state-gated repeat boluses) and from the `timingRationale` of every technique-template step (`data/templates.js`). A rule marked *simulator convention* has no source for its number; where a label statement is cited in its text, the convention is anchored to that statement, not taken from it. *Clinical practice convention (owner)* is practice stated by the project owner, not a published source.',
  '',
  `Minimum interval from the end of a premedication bolus to "Start induction": ${PREMED_TO_INDUCTION_MIN_SEC / 60} min (pre-op holding ${TIMING_CONFIG.PREMED_TO_TRANSFER_SEC.value / 60} min + OR setup ${TIMING_CONFIG.OR_SETUP_SEC.value / 60} min + preoxygenation ${TIMING_CONFIG.PREOXYGENATION_SEC.value / 60} min). Plan drugs in the induction/sedation phase never start while a premedication bolus is pending or running.`,
  '',
  '| Rule | Value | Unit | Provenance | Sources | Rationale |',
  '|---|---|---|---|---|---|',
  ...Object.entries(TIMING_CONFIG).map(([k, x]) => `| ${k} | ${fmt(Array.isArray(x.value) ? x.value.join('–') : x.value)} | ${x.unit} | ${PROVENANCE_TEXT[x.provenance] || x.provenance} | ${x.sourceIds.join(', ')} | ${cell(x.rationale)} |`),
  '',
  '**Template step timing (why each step is where it is)**',
  '',
  '| Template | Step | When | Provenance | Sources | Why |',
  '|---|---|---|---|---|---|',
  ...TECHNIQUE_TEMPLATES.flatMap((t) => t.steps.map((st) => `| ${t.id} | ${st.kind === 'fluid' ? st.fluidId : st.kind === 'antibiotic' ? 'antibiotic (guideline agent)' : st.drugId} ${st.kind}${st.regimenKey ? ` (${st.regimenKey})` : ''}${st.optional ? ' — optional' : ''} | ${typeof st.beforeEndSec === 'number' ? `end of surgery − ${mmss(st.beforeEndSec)}` : `${st.phase} +${mmss(st.atSec)}${st.afterLoadingOf ? ', after the loading dose ends' : ''}`} | ${st.timingRationale ? st.timingRationale.provenance : ''} | ${st.timingRationale ? st.timingRationale.sources.join(', ') : ''} | ${st.timingRationale ? cell(st.timingRationale.text) : ''} |`)),
  '',
  'Same-phase loading → maintenance: `buildPlan()` and the plan editor start the maintenance infusion at loading start + loading duration (mac_dex: dexmedetomidine maintenance at +10:00; mac_propofol: propofol initiation at +4:00, maintenance at +9:00); the plan editor warns when a user schedules them overlapping.',
  '',
  'Every timed element was cross-checked against FDA labels and guidelines in November 2026: see [TIMING_EVIDENCE.md](TIMING_EVIDENCE.md) (what each source says, agreement, classification, the one conflict fixed, and a clinician-review checklist — no clinician review recorded yet).',
  '',
].join('\n');

const palInv = palliativeParameterInventory();
const palCounts = {};
for (const x of palInv) palCounts[x.provenance] = (palCounts[x.provenance] || 0) + 1;
const palSection = [
  '## Palliative and end-of-life modules',
  'Generated from `engine/palliative.js` `palliativeParameterInventory()` (data: `data/palliative.js`; sources S100–S120 in SOURCES.md). Educational simulation with fictional patients; not clinical decision support. Opioid starting doses come only from FDA labels; titration, breakthrough, conversion, CDC, naloxone and palliative-sedation values from the cited guidelines/frameworks; every other number is a labelled simulator convention or an illustrative author estimate. The symptom model (pain, dyspnoea, agitation, secretions, nausea, constipation, RASS, respiratory rate) is illustrative and not validated; no survival or mortality is modelled and no outcome claim is made. Palliative sedation is gated by six documentation items, every titration needs the clinician\'s approval, the engine never escalates or acknowledges anything on its own, and comfort opioids continue (they are not used to sedate). Excluded by design: any content about medical aid in dying, euthanasia or hastening death.',
  '',
  `${palInv.length} parameters. Provenance counts: ${Object.entries(palCounts).map(([k, v]) => `${k}: ${v}`).join(', ')}.`,
  '',
  '| Component | Drug | Parameter | Value | Unit | Provenance | Sources | Note |',
  '|---|---|---|---|---|---|---|---|',
  ...palInv.map((x) => `| ${x.component} | ${x.drugId || ''} | ${cell(x.name)} | ${cell(fmt(x.value))} | ${cell(x.unit || '')} | ${x.provenance} | ${(x.sourceIds || []).join(', ')} | ${cell(x.note || '')} |`),
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
const withTiming = replaceSection(out, /^## Timing rules and template timing/, timingSection);
out = withTiming !== null ? withTiming : out.replace(/\n## Sources\n/, `\n${timingSection}\n## Sources\n`);
const withPal = replaceSection(out, /^## Palliative and end-of-life modules/, palSection);
out = withPal !== null ? withPal : out.replace(/\n## Sources\n/, `\n${palSection}\n## Sources\n`);
if (process.argv.includes('--check')) { if (out !== md) { console.error('MODEL_CARD.md is out of date: run node simulator/tools/model-card-tables.mjs'); process.exit(1); } console.log('MODEL_CARD.md up to date'); }
else { writeFileSync(file, out); console.log(`MODEL_CARD.md: ${inv.length} inventory rows, ${Object.keys(AUTORUN_CONFIG).length} autorun entries, ${Object.keys(TIMING_CONFIG).length} timing rules, ${palInv.length} palliative rows`); }
