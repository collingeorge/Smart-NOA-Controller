// Guided mode and "Run full case automatically" — every condition and timing in ONE block.
// Pure; no DOM. EDUCATIONAL SIMULATION — fictional patients — not a medical device.
//
// This is a SCRIPTED SEQUENCE of the same phase/airway actions a user can press by hand. It is
// not a controller and not a clinical recommendation. It never changes a dose, rate, source or
// model value: drugs are given only by the plan steps the user built (sim plan scheduler).
//
// Each entry: { value, unit, appliesTo, rationale, provenance, sourceIds }
//   provenance 'simulator convention (unsourced)'  — a teaching-sequence choice; no source
//   provenance 'guideline' / 'project_config'      — reuses a sourced value; sourceIds are ids
//                                                    in data/drugs.js SOURCES
//   appliesTo  'both' | 'guided' | 'full'          — 'full' = only the automatic demonstration
//                                                    (in guided mode the clinician decides when)
// Times are simulated seconds, counted from the moment the sequence reaches that step.
// Engine readouts used (depth index, sedation level, TOF) are illustrative model outputs.
// EXTUBATION_TOFR_MIN mirrors sim.js ALARM_THRESHOLDS.TOFR_EXTUBATION (a test keeps them equal; not
// imported here to avoid an import cycle sim.js → inventory.js → autorun-config.js → sim.js).

import { NOA_CONFIG } from './interlocks.js';

export const CONVENTION = 'simulator convention (unsourced)';

const e = (value, unit, appliesTo, rationale, provenance = CONVENTION, sourceIds = []) =>
  Object.freeze({ value, unit, appliesTo, rationale, provenance, sourceIds: Object.freeze([...sourceIds]) });

export const AUTORUN_CONFIG = Object.freeze({
  // ---------------------------------------------------------------- start
  PRE_INDUCTION_DWELL_SEC: e(60, 's', 'full',
    'Full demonstration waits this long after 00:00 (premedication steps run at their offsets) before "Start induction" / "Start sedation". In guided mode the clinician presses "Approve & start".'),
  INDUCTION_FIO2: e(1, 'fraction', 'both',
    'At "Start induction" the sequence sets FiO2 1.0 (pre-oxygenation) and starts bag-mask ventilation, using the same set_fio2 and mask_ventilate actions as the Airway panel buttons.'),
  SEDATION_FIO2: e(0.4, 'fraction', 'both',
    'At "Start sedation" the sequence sets supplemental oxygen FiO2 0.4 with the Airway panel set_fio2 action (the same value the browser smoke test uses for the MAC example).'),
  // ---------------------------------------------------------------- GA: intubating conditions
  INTUBATION_DEPTH_MAX: e(60, 'depth index (0–100, illustrative; not BIS)', 'both',
    'Intubating conditions: simulated depth index ≤ 60. The engine notes laryngoscopy above 70 as light; 60 is the depth the existing GA smoke test waits for.'),
  INTUBATION_TOF_COUNT_MAX: e(1, 'TOF count', 'both',
    'Intubating conditions: TOF count ≤ 1 (the Run screen hint "asleep and paralysed (TOF count 0–1)"). All induction plan steps must also have run.'),
  INTUBATION_TIMEOUT_SEC: e(600, 's', 'both',
    'If intubating conditions are not met within this time after induction starts: the demonstration stops; guided mode shows the unmet conditions and keeps the Intubate button disabled.'),
  // ---------------------------------------------------------------- GA: maintenance and surgery
  MAINTENANCE_AFTER_AIRWAY_SEC: e(60, 's', 'full',
    'Full demonstration enters maintenance this long after the airway is secured. In guided mode the clinician presses "Enter maintenance mode".'),
  SURGERY_START_MIN_SEC: e(120, 's', 'both',
    'Surgery (start_surgery) starts automatically no earlier than this after maintenance begins (a short pre-incision period; in the example cases a longer unstimulated period makes MAP < 60 more frequent in this illustrative model).'),
  SURGERY_DEPTH_MAX: e(60, 'depth index (0–100, illustrative; not BIS)', 'both',
    'Surgery starts automatically only when the simulated depth index is ≤ 60.'),
  SURGERY_START_TIMEOUT_SEC: e(900, 's', 'both',
    'If the surgery-start condition is not met within this time after maintenance begins, automatic mode stops and reports the unmet condition.'),
  SURGERY_DURATION_SEC: e(1800, 's', 'full',
    'Full demonstration ends surgery after this time (the plan has no maintenance-duration field). In guided mode the clinician presses "End surgery".'),
  CLOSING_BEFORE_EMERGENCE_SEC: e(300, 's', 'full',
    'Full demonstration begins emergence this long after surgery ends (matches the engine closing-stimulus duration). In guided mode the clinician presses "Enter emergence / extubation mode".'),
  // ---------------------------------------------------------------- GA: extubation
  EXTUBATION_TOFR_MIN: e(0.9, 'TOF ratio', 'both',
    'Extubation needs sim.extubationReadiness() to be met, which includes TOFR ≥ 0.9. The sequence never uses the "Extubate anyway" override. Other readiness criteria are the engine\'s illustrative rules.',
    'guideline', ['S5']),
  READINESS_HOLD_SEC: e(10, 's', 'full',
    'Full demonstration extubates only after readiness has been met for this many consecutive simulated seconds (readiness can flicker with seeded noise). Guided mode enables "Extubate" whenever readiness is met and re-checks it on the click.'),
  EXTUBATION_TIMEOUT_SEC: e(1800, 's', 'both',
    'If readiness is not met within this time after emergence begins: the demonstration stops and lists the unmet criteria; guided mode lists them and keeps "Extubate" disabled.'),
  POST_EXTUBATION_OBSERVE_SEC: e(300, 's', 'both',
    'After extubation the sequence observes for this time, then reports the case complete.'),
  // ---------------------------------------------------------------- MAC
  SEDATION_TARGET_LEVEL: e('plan.sedationTarget', 'ASA continuum level', 'both',
    'The procedure starts automatically once the simulated sedation level reaches the plan target (minimal / moderate / deep, ASA continuum definitions) and all sedation plan steps have run. The mapping from depth index to level is an illustrative engine rule.',
    'guideline', ['S31']),
  SEDATION_TARGET_HOLD_SEC: e(10, 's', 'both',
    'The sedation target must be met for this many consecutive simulated seconds before the procedure starts, so a single noisy sample does not start it (2026-11 audit; same idea as READINESS_HOLD_SEC and RECOVERY_HOLD_SEC).'),
  SEDATION_TARGET_TIMEOUT_SEC: e(900, 's', 'both',
    'If the sedation target is not reached within this time after sedation starts, automatic mode stops and reports it.'),
  PROCEDURE_DURATION_SEC: e(1200, 's', 'full',
    'Full demonstration ends the procedure after this time and moves to recovery. In guided mode the clinician presses "End procedure".'),
  RECOVERY_LEVEL_MAX: e('minimal', 'ASA continuum level', 'both',
    'Recovery is reported complete when the simulated sedation level is minimal or awake for RECOVERY_HOLD_SEC. This is a teaching end point, not a discharge criterion.'),
  RECOVERY_HOLD_SEC: e(10, 's', 'both', 'Consecutive simulated seconds the recovery level must hold.'),
  RECOVERY_TIMEOUT_SEC: e(1800, 's', 'both',
    'If recovery is not reached within this time after the procedure ends, automatic mode stops and reports it.'),
  // ---------------------------------------------------------------- pause rules
  PAUSE_ON_INTERLOCK_HOLD: e(true, 'boolean', 'both',
    'Automatic mode pauses whenever an interlock hold is latched (the Run screen also stops the clock). It never calls resume_hold; the user must release the hold, then press Resume.'),
  INTERLOCK_MAP_CRITICAL_LOW: e(NOA_CONFIG.hemodynamic_thresholds.map_critical_low, 'mmHg', 'both',
    'Reused, not redefined: the engine latches the hold when MAP < 60 (config.yaml). Automatic mode reacts to the latched hold, not to its own threshold.',
    'project_config', ['S35']),
  INTERLOCK_HR_CRITICAL_LOW: e(NOA_CONFIG.hemodynamic_thresholds.hr_critical_low, '/min', 'both',
    'Reused, not redefined: the engine latches the hold when HR < 48 (config.yaml).',
    'project_config', ['S35']),
  PAUSE_ALARM_PRIORITIES: e(Object.freeze(['high']), 'alarm priority', 'both',
    'Automatic mode pauses for an unacknowledged HIGH-priority alarm that is active or was raised since the last check. It never acknowledges alarms. Medium and low alarms (e.g. MAP < 65, depth over the sedation target, dose-range notices) do not pause: they are shown and announced as usual, and the user can pause or take over at any time.'),
});

/** Convenience: entry value. */
export const cfg = (config, key) => config[key].value;
