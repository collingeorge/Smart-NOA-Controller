// Regenerates the Mermaid diagrams (and their text alternatives) in /SAFETY_DESIGN.md between marker comments
//   <!-- safety-diagrams:<name>:start --> … <!-- safety-diagrams:<name>:end -->
// Every threshold and number is read from the engine configuration — engine/interlocks.js NOA_CONFIG
// (mirror of config.yaml), engine/timing.js TIMING_CONFIG, engine/teaching-ceilings.js TEACHING_CEILINGS,
// engine/rescue-config.js RESCUE_CONFIG — never typed by hand, so the diagrams cannot drift from the code.
// The decision tree follows InterlockCore.evaluate() branch by branch (engine/interlocks.js).
// Labels are plain text (the site renders Mermaid with securityLevel 'strict' and htmlLabels false).
// Usage (from the repository root):  node simulator/tools/safety-diagrams.mjs [--check]
// --check exits 1 if SAFETY_DESIGN.md is out of date. Pure Node; no network.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { NOA_CONFIG, CONTROLLED, PY_RATE_UNITS } from '../engine/interlocks.js';
import { TIMING_CONFIG } from '../engine/timing.js';
import { TEACHING_CEILINGS } from '../engine/teaching-ceilings.js';
import { RESCUE_CONFIG } from '../engine/rescue-config.js';

export const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'SAFETY_DESIGN.md');
export const BLOCKS = Object.freeze(['numbers', 'decision-tree', 'hold-lifecycle', 'clinician-loop', 'architecture']);

const lc = (s) => s.toLowerCase();
const mermaid = (lines) => ['```mermaid', ...lines, '```'].join('\n');

/** Every number the diagrams use, from the configuration objects passed in (defaults: the engine's). */
export function numbers({ noa = NOA_CONFIG, timing = TIMING_CONFIG, teaching = TEACHING_CEILINGS, rescue = RESCUE_CONFIG } = {}) {
  const t = (k) => timing[k].value;
  const P = noa.sensor_plausibility;
  return {
    hr: noa.hemodynamic_thresholds.hr_critical_low, map: noa.hemodynamic_thresholds.map_critical_low,
    hrMin: P.hr_min, hrMax: P.hr_max, mapMin: P.map_min, mapMax: P.map_max, hrDrop: P.hr_max_drop_per_sec, mapDrop: P.map_max_drop_per_sec,
    suspendMax: noa.interlock_suspension_max_sec, longSec: noa.interlock_long_hold_advisory_sec, longMin: noa.interlock_long_hold_advisory_sec / 60,
    ceilings: CONTROLLED.map((d) => ({ d, v: noa.simulation_rate_ceilings[d], u: PY_RATE_UNITS[d] })),
    phenyl: t('PHENYLEPHRINE_REPEAT_MIN_SEC'), glyco: t('GLYCOPYRROLATE_RESCUE_REPEAT_MIN_SEC'), epiIm: t('EPINEPHRINE_IM_REPEAT_MIN_SEC'),
    depthLowSec: t('DEPTH_LOW_ADVISORY_SUSTAIN_SEC'), band: t('GA_DEPTH_BAND'),
    epiIv: teaching.EPINEPHRINE_IV_BOLUS_TOTAL, glycoTotal: teaching.GLYCOPYRROLATE_BOLUS_TOTAL, crystalloid: teaching.CRYSTALLOID_TOTAL_ML_PER_KG, confirmSec: teaching.CONFIRMATION_VALID_SEC.value,
    advisoryHr: rescue.AGENT_SELECTION_HR_BELOW.value,
  };
}

/** The generated blocks: { name: markdown }. Pure function of the configuration. */
export function buildBlocks(cfg = {}) {
  const n = numbers(cfg);
  const ceil = n.ceilings.map((c) => `${lc(c.d)} ${c.v} ${c.u}`).join(', ');
  const out = {};

  out.numbers = [
    '| Number in the diagrams | Value | Read from |',
    '|---|---|---|',
    `| HR hold threshold (strict "<") | ${n.hr} /min | \`config.yaml\` \`hemodynamic_thresholds.hr_critical_low\` (\`NOA_CONFIG\`) |`,
    `| MAP hold threshold (strict "<") | ${n.map} mmHg | \`hemodynamic_thresholds.map_critical_low\` |`,
    `| Sensor plausibility limits | HR ${n.hrMin}–${n.hrMax} /min, MAP ${n.mapMin}–${n.mapMax} mmHg | \`sensor_plausibility\` (simulation limits, not clinical standards) |`,
    `| Sudden-drop limits (1-s drop, strict ">") | HR ${n.hrDrop} /min, MAP ${n.mapDrop} mmHg | \`sensor_plausibility.*_max_drop_per_sec\` |`,
    `| Simulation rate ceilings | ${ceil} | \`simulation_rate_ceilings\` (software ceilings, not clinical maxima) |`,
    `| Longest suspension | 1–${n.suspendMax} s | \`interlock_suspension_max_sec\` (simulator convention) |`,
    `| Long-hold note interval | ${n.longSec} s (${n.longMin} min) | \`interlock_long_hold_advisory_sec\` (simulator convention) |`,
    `| Label repeat intervals (clinician repeat refused) | phenylephrine IV ${n.phenyl} s, glycopyrrolate IV ${n.glyco} s (outside emergence), epinephrine IM/SC ${n.epiIm} s | \`TIMING_CONFIG\` (lower bounds of the label intervals) |`,
    `| Teaching ceilings (simulator conventions) | epinephrine IV boluses ${n.epiIv.value} ${n.epiIv.unit}, glycopyrrolate boluses ${n.glycoTotal.value} ${n.glycoTotal.unit}, crystalloid ${n.crystalloid.value} ${n.crystalloid.unit}; one confirmation covers one dose within ${n.confirmSec} s | \`TEACHING_CEILINGS\` |`,
    `| Depth-low advisory (text only) | index below ${n.band[0]} for ≥ ${n.depthLowSec} s | \`TIMING_CONFIG.DEPTH_LOW_ADVISORY_SUSTAIN_SEC\` |`,
  ].join('\n');

  out['decision-tree'] = [
    mermaid([
      'flowchart TD',
      '  T0(["Each simulated second with interlocks on: InterlockCore.evaluate(HR, MAP)"])',
      '  T0 --> C1["Enforce constraints: re-zero hard-locked agents and agents held by a latched hold"]',
      '  C1 --> X{"Suspension set and its end time reached?"}',
      '  X -->|"yes"| X1["End the suspension; log suspension_expired"]',
      '  X -->|"no"| S{"Sensor problem in this reading?"}',
      '  X1 --> S',
      '  S -->|"invalid: HR or MAP missing, not a number, NaN, infinite or boolean"| SF',
      `  S -->|"implausible: HR outside ${n.hrMin}-${n.hrMax} /min or MAP outside ${n.mapMin}-${n.mapMax} mmHg"| SF`,
      `  S -->|"drop: HR fell more than ${n.hrDrop} /min or MAP more than ${n.mapDrop} mmHg since the last usable reading 1 s earlier"| SF`,
      `  SF["All controlled infusions (${CONTROLLED.map(lc).join(', ')}) set to zero; hold latched; status RED; log sensor_fault; drop baseline reset"]`,
      '  S -->|"no problem"| B["Keep this reading as the drop baseline"]',
      `  B --> R{"Any controlled rate negative, non-finite or above its simulation ceiling: ${ceil}?"}`,
      '  R -->|"yes"| RF["That agent set to zero; hold latched; status RED; log rate_fault"]',
      '  R -->|"no"| PK["Update the dexmedetomidine model"]',
      '  RF --> PK',
      `  PK --> H{"HR < ${n.hr} /min?"}`,
      '  H -->|"yes, suspension active"| HS["Log breach_suppressed; no hold latched"]',
      '  H -->|"yes, not suspended"| HT["Dexmedetomidine set to zero; hold latched; status RED; log hr_low"]',
      `  H -->|"no"| M{"MAP < ${n.map} mmHg?"}`,
      '  HS --> M',
      '  HT --> M',
      '  M -->|"yes, suspension active"| MS["Log breach_suppressed; no hold latched"]',
      '  M -->|"yes, not suspended"| MT["Dexmedetomidine and lidocaine set to zero; hold latched; status RED; log map_low"]',
      '  M -->|"no"| ST{"Status for this second"}',
      '  MS --> ST',
      '  MT --> ST',
      '  ST -->|"MAP hold latched this second"| RED["RED"]',
      '  ST -->|"hold latched, no HR trip and no rate fault this second"| HOLD["HOLD: held infusions stay at zero; no automatic restart"]',
      '  ST -->|"no hold latched and no rate fault"| GREEN["GREEN"]',
      '  ST -->|"otherwise: HR trip or rate fault this second"| RED',
      '  SF --> A{"Did a new trigger or a newly held agent cancel an acknowledgment?"}',
      '  RED --> A',
      '  HOLD --> A',
      '  GREEN --> A',
      '  A -->|"yes"| A1["Log acknowledgment_invalidated: acknowledge again before release"]',
      `  A -->|"no"| L{"Hold latched for another ${n.longMin} min (${n.longSec} s) since it latched?"}`,
      '  A1 --> L',
      '  L -->|"yes"| L1["Log hold_long note: not an alarm, nothing changes"]',
      '  L -->|"no"| DONE(["End of the second: nothing in this step raises a rate"])',
      '  L1 --> DONE',
    ]),
    '',
    `**Text alternative.** Every simulated second, while interlocks are on, the engine first re-zeroes every hard-locked agent and every agent held by a latched hold, then ends a suspension whose time is up (logged). It then checks the reading. If HR or MAP is unusable — missing, not a number, NaN, infinite or boolean; outside HR ${n.hrMin}–${n.hrMax} /min or MAP ${n.mapMin}–${n.mapMax} mmHg; or a drop of more than ${n.hrDrop} /min (HR) or ${n.mapDrop} mmHg (MAP) since the previous usable reading one second earlier — all three controlled infusions go to zero, the hold latches, the status is RED and the rest of the threshold rules are skipped (fail-safe). Otherwise the reading becomes the drop baseline; any rate that is negative, non-finite or above its simulation ceiling (${ceil}) is set to zero and latches the hold (RED); the dexmedetomidine model updates; then HR < ${n.hr} /min (dexmedetomidine) and MAP < ${n.map} mmHg (dexmedetomidine and lidocaine) are checked in that order: each either zeroes its agents, latches the hold and sets RED, or — only while an explicit suspension is active — is logged as a suppressed breach without a latch. The status is RED after a MAP trip; HOLD when a hold is latched and nothing new tripped on HR or rate; GREEN when no hold is latched and there is no rate fault; otherwise RED. Finally, if a new trigger or a newly held agent cancelled an acknowledgment, that is logged, and a non-blocking long-hold note is logged every ${n.longMin} minutes a hold stays latched. Ketamine is not part of the HR/MAP rules. Nothing in the step raises a rate.`,
  ].join('\n');

  out['hold-lifecycle'] = [
    mermaid([
      'stateDiagram-v2',
      '  state "GREEN: no hold latched" as Green',
      '  state "Latched: RED on the trip, then HOLD; held infusions at zero; needs an acknowledgment" as Latched',
      '  state "Acknowledged: cause reviewed by the clinician; still latched, infusions still zero" as Acked',
      '  state "Released: hold cleared; held infusions still zero, nothing restored" as Released',
      '  [*] --> Green',
      `  Green --> Latched: sensor fault, rate fault, HR < ${n.hr} or MAP < ${n.map} (not suspended)`,
      '  Latched --> Latched: release attempted without acknowledgment (refused)',
      '  Latched --> Acked: acknowledge_hold(by, note)',
      '  Acked --> Latched: new trigger or newly held agent (acknowledgment cancelled, logged)',
      '  Acked --> Acked: same trigger again (acknowledgment kept)',
      '  Acked --> Released: resume_hold(by) uses the acknowledgment once',
      '  Released --> Green: next second with no trip',
      '  Released --> Latched: next second trips again (a new hold, needs a new acknowledgment)',
    ]),
    '',
    `**Text alternative.** A case starts GREEN. A sensor fault, a rate fault, or HR < ${n.hr} / MAP < ${n.map} outside a suspension latches a hold: the status is RED on that second and HOLD afterwards, and the held infusions stay at zero. Release takes two explicit steps. First the clinician acknowledges the hold (\`acknowledge_hold\`) after reviewing its cause; a release attempted without that acknowledgment is refused. While acknowledged the hold is still latched; the same trigger firing again keeps the acknowledgment, but a new trigger or a newly held agent cancels it (logged) and the hold needs a new acknowledgment. Then the clinician releases it (\`resume_hold\`), which uses the acknowledgment once. After release nothing is restored: held infusions stay at zero until the clinician restarts them, and the status becomes GREEN at the next second only if nothing trips; if something trips again it is a new hold that needs a new acknowledgment. A suspension never releases a hold, and the long-hold note (every ${n.longMin} min) changes nothing.`,
  ].join('\n');

  out['clinician-loop'] = [
    mermaid([
      'flowchart LR',
      '  subgraph RUNNER["Guided mode and automatic demonstration (engine/autorun.js)"]',
      '    R1["Walk the phase and airway steps of the case"]',
      '    R2["Plan steps run only as the clinician approved them"]',
      `    R3["Pause for a latched interlock hold or an unacknowledged HIGH alarm"]`,
      '    R4["Extubate only when the readiness checklist is met; never the override"]',
      '  end',
      '  subgraph CLIN["Only the clinician (explicit, logged)"]',
      '    C1["Acknowledge and release a hold"]',
      `    C2["Suspend the HR/MAP holds (1-${n.suspendMax} s, reason required) or end a suspension"]`,
      '    C3["Confirm the WHO time out"]',
      `    C4["Confirm a dose above a teaching ceiling (one dose within ${n.confirmSec} s)"]`,
      '    C5["Acknowledge alarms; accept or dismiss advisories"]',
      '    C6["Continue with hold latched (this hold only)"]',
      '  end',
      '  R3 -->|"waits for"| CLIN',
      '  CLIN -->|"then presses Resume"| RUNNER',
      '  C2 -->|"starting a suspension ends the mode; neither mode starts while one is active"| RUNNER',
    ]),
    '',
    `**Text alternative.** Guided mode and the automatic demonstration only walk the case's phase and airway steps, run the plan steps the clinician approved, extubate only when the readiness checklist is met (never with the override), and pause for a latched interlock hold or an unacknowledged HIGH-priority alarm. They never acknowledge or release a hold, never suspend the interlocks or end a suspension, never confirm the WHO time out, never confirm a dose above a teaching ceiling (a planned step above one is refused and skipped), never acknowledge alarms and never accept an advisory: each of these is an explicit, logged clinician action. "Continue with hold latched (this hold only)" is also the clinician's choice and does not release the hold. Starting a suspension ends either mode, and neither mode can be started while a suspension is active. Medium and low alarms and the text-only depth-low advisory (index below ${n.band[0]} for ≥ ${n.depthLowSec} s) do not pause them.`,
  ].join('\n');

  out.architecture = [
    mermaid([
      'flowchart TB',
      '  UI["Browser UI (ui/): plan editor, monitor, hold and suspension panels, debrief"]',
      '  ENG["Simulation engine (engine/sim.js): illustrative patient, PK/PD and physiology"]',
      '  LIB["Drug library (data/drugs.js) with its source registry"]',
      `  DOSE["Dose rules: label ceilings, lockouts and warnings, label repeat intervals (${n.phenyl} / ${n.glyco} / ${n.epiIm} s), teaching ceilings (${n.epiIv.value} ${n.epiIv.unit} / ${n.glycoTotal.value} ${n.glycoTotal.unit} / ${n.crystalloid.value} ${n.crystalloid.unit})"]`,
      `  CORE["Shared interlock core (engine/interlocks.js): fail-safe, rate ceilings, HR < ${n.hr}, MAP < ${n.map}, two-step release, suspension up to ${n.suspendMax} s"]`,
      '  PY["Python reference (smart_noa_controller.py, config.yaml)"]',
      '  RUN["Guided and automatic modes (engine/autorun.js): scripted steps, pause rules"]',
      '  ADV["Advisories (engine/rescue.js, engine/depth-advisory.js): suggestions only"]',
      '  LOG["Event log, debrief and session JSON (interlock audit)"]',
      '  NONE["No monitor, pump or record-system interface"]',
      '  UI --> ENG',
      '  LIB --> DOSE',
      '  DOSE --> ENG',
      '  ENG --> CORE',
      '  PY -.->|"same rules and messages, parity tests"| CORE',
      '  RUN -->|"same actions as the buttons"| ENG',
      '  ADV -->|"clinician accepts or dismisses"| UI',
      '  ENG --> LOG',
      '  CORE --> LOG',
      '  NONE -.- ENG',
    ]),
    '',
    `**Text alternative.** The browser UI drives a single simulation engine with an illustrative patient, PK/PD and physiology model. Every dose passes the dose rules — label ceilings, contraindication lockouts and warnings, label repeat intervals (phenylephrine ${n.phenyl} s, glycopyrrolate ${n.glyco} s, IM/SC epinephrine ${n.epiIm} s) and the teaching ceilings (epinephrine IV boluses ${n.epiIv.value} ${n.epiIv.unit}, glycopyrrolate ${n.glycoTotal.value} ${n.glycoTotal.unit}, crystalloid ${n.crystalloid.value} ${n.crystalloid.unit}) — fed by the drug library and its source registry. Each simulated second the engine calls the shared interlock core, which implements the same rules and messages as the Python reference controller (checked by parity tests): the sensor fail-safe, rate ceilings, HR < ${n.hr} and MAP < ${n.map} holds, the two-step release and the suspension of up to ${n.suspendMax} s. Guided and automatic modes use the same actions as the on-screen buttons and pause under fixed rules; advisories only suggest, and the clinician accepts or dismisses them. Everything is written to a time-stamped event log that feeds the debrief and the downloadable session JSON. There is no monitor, pump or record-system interface.`,
  ].join('\n');
  return out;
}

const marker = (name, edge) => `<!-- safety-diagrams:${name}:${edge} -->`;
/** Replaces each marked block in `text`; throws if a marker pair is missing. */
export function render(text, blocks = buildBlocks()) {
  let out = text;
  for (const name of BLOCKS) {
    const a = marker(name, 'start'); const b = marker(name, 'end');
    const i = out.indexOf(a); const j = out.indexOf(b);
    if (i < 0 || j < i) throw new Error(`SAFETY_DESIGN.md: missing marker pair for "${name}"`);
    out = `${out.slice(0, i + a.length)}\n${blocks[name]}\n${out.slice(j)}`;
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const md = readFileSync(FILE, 'utf8');
  const out = render(md);
  if (process.argv.includes('--check')) {
    if (out !== md) { console.error('SAFETY_DESIGN.md is out of date: run node simulator/tools/safety-diagrams.mjs'); process.exit(1); }
    console.log('SAFETY_DESIGN.md diagrams up to date');
  } else { writeFileSync(FILE, out); console.log(`SAFETY_DESIGN.md: ${BLOCKS.length} generated blocks written`); }
}
