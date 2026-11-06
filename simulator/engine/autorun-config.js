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
// Engine readouts used (processed-EEG depth index (BIS-style, simulated), sedation level, TOF) are
// illustrative model outputs. Pre-op holding / OR / pre-incision timings: engine/timing.js TIMING_CONFIG.
// EXTUBATION_TOFR_MIN mirrors sim.js ALARM_THRESHOLDS.TOFR_EXTUBATION (a test keeps them equal; not
// imported here to avoid an import cycle sim.js → inventory.js → autorun-config.js → sim.js).

import { NOA_CONFIG } from './interlocks.js';

export const CONVENTION = 'simulator convention (unsourced)';

const e = (value, unit, appliesTo, rationale, provenance = CONVENTION, sourceIds = []) =>
  Object.freeze({ value, unit, appliesTo, rationale, provenance, sourceIds: Object.freeze([...sourceIds]) });

export const AUTORUN_CONFIG = Object.freeze({
  // ---------------------------------------------------------------- start
  PRE_INDUCTION_DWELL_SEC: e(60, 's', 'full',
    'Full demonstration waits at least this long after 00:00 (premedication steps run at their offsets) before "Transfer to OR". Transfer also waits for the premedication interval (engine/timing.js TIMING_CONFIG.PREMED_TO_TRANSFER_SEC). In guided mode the clinician presses "Transfer to OR".'),
  INDUCTION_FIO2: e(1, 'fraction', 'both',
    'After transfer and OR setup the sequence starts preoxygenation (FiO2 1.0, set_fio2 — the Airway panel action); at "Start induction" it starts bag-mask ventilation (mask_ventilate). Durations: engine/timing.js TIMING_CONFIG (OR_SETUP_SEC, PREOXYGENATION_SEC).'),
  SEDATION_FIO2: e(0.4, 'fraction', 'both',
    'At "Start sedation" the sequence sets supplemental oxygen FiO2 0.4 with the Airway panel set_fio2 action (the same value the browser smoke test uses for the MAC example).'),
  // ---------------------------------------------------------------- GA: intubating conditions
  INTUBATION_DEPTH_MAX: e(60, 'processed-EEG depth index (BIS-style, simulated)', 'both',
    'Intubating conditions: simulated processed-EEG depth index ≤ 60 (upper end of the GA band, engine/timing.js). The engine notes laryngoscopy above 70 as light; 60 is the depth the existing GA smoke test waits for.'),
  INTUBATION_TOF_COUNT_MAX: e(1, 'TOF count', 'both',
    'Intubating conditions: TOF count ≤ 1 (the Run screen hint "asleep and paralysed (TOF count 0–1)"). All induction plan steps must also have run.'),
  INTUBATION_TIMEOUT_SEC: e(600, 's', 'both',
    'If intubating conditions are not met within this time after induction starts: the demonstration stops; guided mode shows the unmet conditions and keeps the Intubate button disabled.'),
  // ---------------------------------------------------------------- GA: maintenance and surgery
  MAINTENANCE_AFTER_AIRWAY_SEC: e(60, 's', 'full',
    'Full demonstration enters maintenance this long after the airway is secured. In guided mode the clinician presses "Enter maintenance mode".'),
  SURGERY_START_TIMEOUT_SEC: e(900, 's', 'both',
    'Pre-incision verification ("Start surgery" gate, both modes; no time-based start): if its state items are not met within this time after maintenance begins, the full demonstration stops and guided mode shows the unmet items. Items: airway + ventilation, processed-EEG index in the GA band (or below it with the clinician\'s acknowledgement), analgesia given per plan, neuromuscular block (TOF), antibiotic in window, WHO time out (clinician only) — engine/timing.js preIncisionItems() and TIMING_CONFIG.'),
  SURGERY_DURATION_SEC: e(1800, 's', 'full',
    'Full demonstration ends surgery after this time (the plan has no maintenance-duration field); it is also the planned end of surgery that anchors "stop X min before the end of surgery" plan steps. In guided mode the clinician presses "End surgery" (such stops then run at that moment if not earlier).'),
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
    'The procedure can start once the simulated sedation level reaches the plan target (minimal / moderate / deep, ASA continuum definitions), all sedation plan steps have run, antibiotic prophylaxis (if indicated) is in window and the clinician has confirmed the WHO time out. The mapping from the processed-EEG depth index to level is an illustrative engine rule.',
    'guideline', ['S31']),
  SEDATION_TARGET_HOLD_SEC: e(10, 's', 'both',
    'The sedation target must be met for this many consecutive simulated seconds before the procedure starts, so a single noisy sample does not start it (2026-11 audit; same idea as READINESS_HOLD_SEC and RECOVERY_HOLD_SEC).'),
  SEDATION_BELOW_TARGET_PAUSE_SEC: e(300, 's', 'full',
    'Sedation below the planned target: once every sedation plan step has run, guided mode at once offers the clinician two options at the "Start procedure" gate — titrate within the label range (SEDATION_TITRATION_*), or "Acknowledge and start procedure at current level". The full demonstration waits this long after the last sedation plan step for the target, then PAUSES for the clinician; it never titrates and never acknowledges on its own.'),
  SEDATION_TITRATION_STEP_FRACTION: e(0.5, 'fraction of the label rate range', 'both',
    'Clinician titration suggestion for a running sedation infusion: current rate + this fraction of the label rate range of the plan\'s sedation regimen, capped at the range maximum (propofol MAC sedation 25–75 mcg/kg/min [S11] → steps of 25). The step size is a simulator convention; the range is the label range. A bolus agent (midazolam) is suggested at its regimen default dose and waits for the label repeat interval (engine/timing.js MIDAZOLAM_REPEAT_MIN_SEC [S17]). Applied only by the clinician\'s click (logged as clinician-approved).'),
  SEDATION_TITRATION_REASSESS_SEC: e(180, 's', 'both',
    'After an infusion-rate change the next titration suggestion waits this long. The propofol label gives no number; ASA 2018 moderate-sedation guidance: allow sufficient time between doses to assess the effect of each [S32] (no number) — so the value is a simulator convention.'),
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
  CONTINUE_WITH_HOLD_OPTION: e(true, 'boolean', 'both',
    'Owner-approved (final-check fixes, 2026-11): while paused for a latched interlock hold, the clinician may press "Continue with hold latched (this hold only)". It is explicit and logged ("Clinician chose to continue with hold latched: <drugs> (<MAP/HR reason>)"), never a default and never chosen by the runner. It covers only the hold episode latched at that moment (held drugs + trigger + latch time, engine sim.state.interlocks.holdEpisode): a new latch — another trigger, another held drug, or the trigger firing again after it had cleared (MAP back to ≥ 62 mmHg / HR ≥ 50 /min, the alarm clearing hysteresis reused from sim.js ALARM_THRESHOLDS, so noise at the threshold is not a new latch) — pauses again, and so does any new HIGH alarm. It does not release the hold (held infusions stay at zero) and does not acknowledge any alarm. It ends when the hold is released ("Resume hold") or a new episode starts, so it never carries to the next episode.'),
  PAUSE_ALARM_PRIORITIES: e(Object.freeze(['high']), 'alarm priority', 'both',
    'Automatic mode pauses for an unacknowledged HIGH-priority alarm that is active or was raised since the last check. It never acknowledges alarms. Medium and low alarms (e.g. MAP < 65, depth over the sedation target, dose-range notices) do not pause: they are shown and announced as usual, and the user can pause or take over at any time.'),
});

/** Convenience: entry value. */
export const cfg = (config, key) => config[key].value;
