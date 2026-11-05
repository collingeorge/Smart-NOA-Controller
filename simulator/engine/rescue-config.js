// Advisory haemodynamic rescue — every rule and timing in ONE block (owner-approved feature, 2026-11).
// Pure; no DOM; no imports (engine/inventory.js imports this file, and sim.js imports inventory.js,
// so importing sim.js here would create a cycle; thresholds are referenced by name instead and
// resolved from sim.js ALARM_THRESHOLDS by engine/rescue.js and engine/inventory.js).
// EDUCATIONAL SIMULATION — fictional patients — not a medical device, not clinical decision support.
//
// The advisory only SUGGESTS; it never gives a drug. A suggested bolus is given only when the
// clinician presses "Give suggested bolus" (engine/rescue.js accept()), in manual, guided and
// automatic-demonstration mode alike. It never acknowledges alarms and never releases interlock holds.
// No dose is written here: the agent's dose, range, per-bolus maximum and cumulative maximum are read
// from the drug library (data/drugs.js regimens.rescue and ceiling) through dosing.js recommend() and
// interpretCeilings().
//
// Each entry: { value, unit, rationale, provenance, sourceIds, ref?, drugId? }
//   provenance — inventory vocabulary (engine/inventory.js PROVENANCE):
//     'fda_label'             the value is stated in the cited FDA label(s) (sourceIds = data/drugs.js SOURCES ids)
//     'simulator_convention'  a teaching choice; NOT sourced (sourceIds empty; any label statement it is
//                             anchored to is named in the rationale text only)
//   ref    — name of a sim.js ALARM_THRESHOLDS key that the rule REUSES (value is resolved, never redefined)
//   drugId — the drug a repeat-interval entry applies to

const CONVENTION = 'simulator_convention';
const e = (value, unit, rationale, provenance = CONVENTION, sourceIds = [], extra = {}) =>
  Object.freeze({ value, unit, rationale, provenance, sourceIds: Object.freeze([...sourceIds]), ...extra });

export const ADVISORY_DISCLAIMER = 'Advisory only — the simulator never gives a vasopressor by itself.';

export const RESCUE_CONFIG = Object.freeze({
  // ---------------------------------------------------------------- triggers (reused thresholds)
  TRIGGER_MAP_BELOW: e(null, 'mmHg',
    'A rescue-bolus suggestion is offered only while MAP < this value (strict "<"; MAP = 65 gives no suggestion). Reuses the simulator MAP-low alarm threshold (sim.js ALARM_THRESHOLDS.MAP_LOW, a build-specification alarm value, not a clinical standard); not redefined here.',
    CONVENTION, [], { ref: 'MAP_LOW' }),
  EPISODE_CLEAR_MAP_AT_OR_ABOVE: e(null, 'mmHg',
    'A hypotension episode (for the advisory record and for "Dismiss") ends when MAP ≥ this value — reuses the MAP-low alarm clearing hysteresis (sim.js ALARM_THRESHOLDS.MAP_LOW_CLEAR). Between the trigger and this value no dose is suggested.',
    CONVENTION, [], { ref: 'MAP_LOW_CLEAR' }),
  HIGH_MAP_ADVICE_ABOVE: e(null, 'mmHg',
    'MAP > this value (reuses sim.js ALARM_THRESHOLDS.MAP_HIGH, the map_high alarm) shows teaching text only — review depth and analgesia, check the sensor. No drug and no dose is suggested: no verified dosing source for an antihypertensive is in the drug library.',
    CONVENTION, [], { ref: 'MAP_HIGH' }),
  HIGH_MAP_EPISODE_CLEAR_AT_OR_BELOW: e(null, 'mmHg',
    'The high-MAP advisory (text only) ends when MAP ≤ this value — reuses the map_high alarm clearing hysteresis (sim.js ALARM_THRESHOLDS.MAP_HIGH_CLEAR).',
    CONVENTION, [], { ref: 'MAP_HIGH_CLEAR' }),
  // ---------------------------------------------------------------- agents and doses (drug library)
  RESCUE_AGENTS: e(Object.freeze(['phenylephrine', 'ephedrine']), 'drug ids',
    'Agents the advisory may suggest. Dose, range, timing text and sources come from each drug\'s label rescue regimen in data/drugs.js (phenylephrine 40–100 mcg IV bolus [S18]; ephedrine 5–10 mg IV bolus [S19]) via dosing.js recommend(). Epinephrine is never suggested for routine hypotension: it stays a manual choice (the anaphylaxis scenario has its own guidance [S44, S45]).',
    'fda_label', ['S18', 'S19']),
  REGIMEN_KEY: e('rescue', 'regimen key', 'Drug-library regimen read for the suggestion (label rescue bolus).', 'fda_label', ['S18', 'S19']),
  DOSE_CHOICE: e('regimen default (label lower bound), capped by the per-bolus and cumulative maxima', 'rule',
    'Suggested dose = the regimen default from recommend() (for both agents the label lower bound), never above the regimen maximum or a per-bolus ceiling, and reduced to what the cumulative label maximum still allows; if that is below the regimen minimum, no dose is suggested ("label maximum reached"). Choosing the lower bound is a simulator convention; the numbers are label values.'),
  AGENT_SELECTION_HR_BELOW: e(60, '/min',
    'Agent selection (simulator convention — no label or guideline statement giving this rule or threshold was verified): HR < 60 /min → ephedrine (mixed-acting; raises HR as well as MAP in this model); HR ≥ 60 /min → phenylephrine (alpha-agonist; reflex HR fall in this model). The directions mirror the illustrative PD profiles in engine/pd.js; 60 /min is a teaching value. An unusable HR reading gives no suggestion.'),
  // ---------------------------------------------------------------- timing (repeat interval, cumulative maximum)
  PHENYLEPHRINE_REPEAT_MIN_SEC: e(60, 's',
    'After a phenylephrine bolus the next suggestion waits at least 60 s ("reassess — next dose allowed in mm:ss"): label — additional boluses may be administered every 1–2 minutes as needed [S18]; the lower bound is used.',
    'fda_label', ['S18'], { drugId: 'phenylephrine' }),
  EPHEDRINE_REPEAT_MIN_SEC: e(120, 's',
    'After an ephedrine bolus the next suggestion waits at least 120 s. The ephedrine label gives no repeat interval (IV bolus "as needed"; tachyphylaxis possible [S19]), so this is a simulator convention (a conservative teaching pause equal to the upper end of the phenylephrine label interval).',
    CONVENTION, [], { drugId: 'ephedrine' }),
  OTHER_VASOPRESSOR_REASSESS_SEC: e(120, 's',
    'After a bolus of any other vasopressor (e.g. epinephrine given manually) the advisory waits this long before suggesting phenylephrine or ephedrine. Simulator convention (no source).'),
  REPEAT_INTERVAL_FROM: e('last vasopressor bolus (any source)', 'rule',
    'The interval runs from the most recent vasopressor bolus of any source (manual, plan or advisory) and uses the interval of the agent that was given. Simulator convention.'),
  CUMULATIVE_MAX: e('drug.ceiling (label maximum)', 'rule',
    'Cumulative maximum already given is read from the drug library ceiling: phenylephrine 200 mcg for all boluses in the session (conservative reading of the 2019 label [S18]); ephedrine 50 mg total [S19]. When the remaining allowance is below the regimen minimum the advisory shows "label maximum reached — consider other causes / escalate; not simulated".',
    'fda_label', ['S18', 'S19']),
  // ---------------------------------------------------------------- suppression and safety rules
  SUPPRESS_DURING_ANAPHYLAXIS: e(true, 'boolean',
    'While the anaphylaxis scenario is active the advisory suggests no phenylephrine/ephedrine bolus and points to the scenario guidance (epinephrine, a manual choice [S44, S45]). Simulator convention.'),
  SUPPRESS_ON_SENSOR_FAULT: e(true, 'boolean',
    'No dose is suggested while the MAP or HR reading is unusable (sensor fault / non-finite value); the card asks to check the sensor. Simulator convention.'),
  NEVER_AUTO_ACCEPT: e(true, 'boolean',
    'The suggestion is never accepted automatically — not in manual, guided or automatic-demonstration mode. Only "Give suggested bolus" gives it (logged "ADVISORY accepted", clinician-approved). The advisory never acknowledges alarms and never releases interlock holds. Owner requirement; simulator convention.'),
});

/** Non-drug checklist shown with every hypotension advisory (teaching text; no doses). */
export const HYPOTENSION_CHECKLIST = Object.freeze([
  'Check anaesthetic depth and the volatile / hypnotic concentration — reduce if deeper than needed.',
  'Assess volume status and fluids given; consider a fluid bolus (Fluids panel).',
  'Look for surgical causes (bleeding, caval compression, retraction) and positioning — tell the surgeon.',
  'Rule out sensor artefact: check the cuff / transducer level and the waveform before treating a number.',
]);

/** Teaching text for MAP > MAP_HIGH (no drug, no dose). */
export const HYPERTENSION_CHECKLIST = Object.freeze([
  'Review anaesthetic depth (processed-EEG index, volatile / hypnotic concentration) — light anaesthesia?',
  'Review analgesia against the surgical stimulus.',
  'Check the sensor: cuff size and position, transducer level, artefact.',
  'No drug or dose is suggested: the simulator has no verified dosing source for an antihypertensive.',
]);
