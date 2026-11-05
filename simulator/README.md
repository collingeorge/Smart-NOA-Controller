# Smart NOA web simulator

**SIMULATION — fictional patient — educational use only. Not a medical device. Not medical advice.**

An educational, label-calibrated anesthesia pharmacology simulator that runs entirely in the browser. You build a fictional adult patient, review a computed assessment, plan a general anaesthetic or MAC/procedural sedation with doses auto-filled from the drug library, run an illustrative monitor, and debrief the case. It is not a medical device, not clinical decision support, and is not connected to any monitor, pump or health record. Nothing entered leaves the page: there are no requests to other origins (the only same-origin read is `SOURCES.md`, for the model-assumptions text).

The simulator lives in the Smart-NOA-Controller repository and is hosted at `/simulator/` on collinbgeorge.com.

## Run it locally

ES modules do not load from `file://`, so serve the folder with any static server:

```sh
cd smart-noa-controller            # repository root
python3 -m http.server 8765
# open http://localhost:8765/simulator/
```

No build step, framework, CDN or external font is used. The page sets a Content-Security-Policy (`script-src 'self'`, no inline scripts or handlers).

## How it works

| Step | What happens |
|---|---|
| 1 Patient | Sex, age, height, weight, ASA, emergency, baseline vitals, eGFR, airway, conditions (grouped by system), allergies, medications, Apfel and STOP-Bang items. Inline validation. "Load example case" fills one of four fictional patients and the matching example plan. |
| 2 Assessment | BMI, IBW (Devine), LBW (Janmahasatian), ABW, MAP, Apfel and STOP-Bang scores, simulator flags, airway concerns, and every drug lockout/warning with its source. |
| 3 Anesthetic plan | GA (induction → maintenance → emergence/extubation) or MAC with a minimal/moderate/deep target (ASA continuum; moderate and deep require exhaled-CO2 monitoring). Per-phase drug pickers are built from the library. Each dose is auto-filled from `recommend()` and shows the sourced range, the weight scalar and kg used, and the source tags. Values can be edited (out of range: warning; above a ceiling: blocked), timed (mm:ss), reordered from the keyboard, and previewed on a timeline. There is an interlocks toggle and a random seed. |
| 4 Run | A dark HMI-style monitor. It has vitals tiles with alarm styling and text, 15-minute canvas trends, a drug panel (live rate, Ce, cumulative, bolus/adjust/stop), alarms with priority labels and Acknowledge, interlock status with "Resume hold", and airway and phase controls. Extubation uses a readiness checklist and a logged override. You can also give fluid boluses (when the engine supports them), inject complications and sensor faults, and use play/pause/step at 1×/5×/20×/60×. An event log records everything. A **Guided mode** and a **Run full case automatically** demonstration can drive the same phase controls (see below). |
| 5 Debrief | Whether the case ran in guided or automatic mode (and where/why it stopped), drug totals (amount and per kg), time with MAP < 65, minimum SpO2, alarms, interlock events, extubation readiness at extubation, plan-step outcomes, model limits, and "Download session (JSON)". The JSON is built from a Blob, so nothing goes over the network. |

The **Sources**, **Model card** and **About & limitations** panels can be opened from every step.

## Guided mode and the automatic demonstration

Both live on the Run screen ("Guided & automatic modes" panel), work for GA and MAC plans and all four example cases, and use the existing speed controls (1×/5×/20×/60×). They use the patient and plan already entered and start the case from 00:00. They **do not change any dose, rate, source or model value**: drugs are given only by your plan steps, at the offsets you set, through the engine's plan scheduler.

- **Guided mode (phase-gated).** Each phase runs automatically from your approved plan; you confirm every transition with a gate button. GA: *Approve & start induction* (FiO2 1.0 and bag-mask ventilation, then premed/induction plan steps) → *Intubate (secure airway)*, enabled only when intubating conditions are met (all induction steps given, simulated depth index ≤ 60, TOF count ≤ 1); it never secures the airway by itself → *Enter maintenance mode* (maintenance plan steps; surgery starts automatically after 2 min once depth ≤ 60) → *End surgery* (your choice; the plan has no maintenance-duration field) → *Enter emergence / extubation mode* (emergence plan steps: agents off, antiemetic, reversal) → *Extubate*, enabled only while `sim.extubationReadiness()` is met. MAC: *Approve & start sedation* (FiO2 0.4, sedation plan steps; the procedure starts automatically once the plan's ASA-continuum target level is reached) → *End procedure* (ends the procedure and starts recovery) → complete when the sedation level is minimal or awake.
- **Run full case automatically.** A demonstration that walks the same sequence without waiting at the gates; gates pass on fixed timings (e.g. 30 min of surgery, 20 min of procedure).
- **Same actions as the manual buttons.** Every step calls the shared functions in `engine/case-actions.js` that the manual phase, airway and extubation controls also call, so interlocks, alarms and the event log behave exactly as in a manual run.
- **Extubation is never forced.** Extubation happens only when `sim.extubationReadiness()` is met (TOFR ≥ 0.9, Thilen 2023, plus the illustrative criteria); the "Extubate anyway" override is never used. If readiness is not met within 30 min of emergence, the demonstration stops and lists the unmet criteria; guided mode lists them and keeps *Extubate* disabled (you can take over).
- **Pauses.** Both modes pause, stop the clock and say why (on screen and through the `aria-live` region) when an interlock hold latches or an unacknowledged HIGH-priority alarm is active or newly raised. They never release a hold or acknowledge an alarm: you decide (e.g. *Acknowledge*, *Resume hold*), then press *Resume*. Medium and low alarms (MAP < 65, depth over the sedation target, dose-range notices) do not pause; they are shown and announced as usual.
- **Manual control ends it.** *Pause*, *Resume* and *Take over manually* are always available. Using any other control on the monitor (phase, airway, drug, fluid, complication, sensor fault, step or play button, restart) ends guided/automatic mode and is logged; the case then continues manually. Speed, alarm *Acknowledge* and *Resume hold* do not end it.
- **Labelled and recorded.** While a mode runs, a banner says it is a scripted educational sequence, not a controller or a clinical recommendation. Each step it takes is logged with the prefix `AUTO:` (log kind `auto`). The debrief and the downloaded session JSON (`automaticMode`, `summary.automatic`) record the mode, the steps (automatic or confirmed by you), pauses, and where and why it stopped.
- **Limits.** The conditions are simulator conventions applied to illustrative model outputs (depth index, sedation level, TOF); only TOFR 0.9 (Thilen 2023), the ASA continuum levels and the config.yaml interlock thresholds are sourced. Every condition and timing is in one block, `engine/autorun-config.js`, with its unit, rationale and provenance; the Model card lists them. In the healthy-adult example (seed 1) the illustrative model's MAP falls below 60 during maintenance, so the demonstration pauses there until you respond. A sequence can only start from 00:00; after you take over it cannot be re-entered mid-case.

## Where doses come from

Every dose, range, ceiling, threshold and score cut-off comes from `data/drugs.js`. Each value traces to an entry in its `SOURCES` registry: FDA prescribing information, a society guideline or consensus statement, or, for scores and weight formulas, the original paper. The human-readable registry is `SOURCES.md`. It also records how each source was checked, which drugs were left out and why, and the illustrative model assumptions. Source tags such as `[S7]` in the UI open the Sources panel at that entry. The auto-filled default within a range is a simulator convention (usually the label's stated usual dose or the lower bound), not a recommendation.

## Model limits (honest summary)

- Physiology and PK/PD are **illustrative**. For most drugs, the compartment constants are fitted so that a default bolus reproduces the onset, peak and duration statements in the label. Where the label gives no timing, the engine uses its own fallback constants. Effect models, synergy, haemodynamic and respiratory gains, patient modifiers and complication magnitudes are engine assumptions. Each drug's actual model record is shown in the Model card (from `sim.modelInfo()`), so it stays current if a published model is adopted later.
- Inhaled agents use first-order wash-in/out toward the dial setting. Their effect is expressed as a fraction of age-adjusted MAC (Mapleson 1996). Total MAC is the sum of the agents' fractions, which is an uncited teaching assumption.
- The depth number is a **simulated depth index (0–100, illustrative; not BIS)**. The extubation criteria other than TOFR ≥ 0.9 (Thilen 2023) are illustrative simulator rules.
- No expert anesthesiologist review has been recorded, and no external validation has been performed. The simulator as a whole is not validated.
- The simulator covers adults 18–90 years only. Pregnancy, paediatrics, cardiopulmonary bypass and neuraxial/regional techniques are not modelled.

## Relation to the Python Smart NOA controller

With **Interlocks (Smart NOA rules)** switched on, `engine/interlocks.js` applies the decision rules of `smart_noa_controller.py` with the thresholds in `config.yaml`:

- HR < 48 sets dexmedetomidine to zero.
- MAP < 60 sets dexmedetomidine and lidocaine to zero.
- An unusable sensor value sets the dexmedetomidine, ketamine and lidocaine infusions to zero and turns the status RED.
- Holds latch and are never released automatically.
- The free-text lockouts and the simulation rate ceilings apply (dexmedetomidine 0.5 mcg/kg/h, ketamine 0.2 mg/kg/h, lidocaine 1.5 mg/kg/h).

The simulator adds one thing the Python controller does not have: an explicit, logged **Resume hold** action.

When a label default exceeds a Smart NOA ceiling, the plan editor pre-fills the ceiling and explains why. For example, the dexmedetomidine sedation start rate of 0.6 mcg/kg/h becomes 0.5. With interlocks off, these rules are skipped, but label ceilings and contraindication lockouts always apply. Parity tests (`tests/parity.test.mjs`) reproduce the outcomes in `EXAMPLE_RESULTS.json` and the regression cases in `test_safety_hardening.py`.

## Tests

```sh
# engine, drug library and Python-parity tests (Node ≥ 18)
node --test simulator/tests

# browser smoke test (needs Playwright + Chromium and a running static server)
python3 -m http.server 8765 &        # from the repository root
node --test simulator/tests/ui.smoke.mjs
#   optional: SIM_URL=http://host:port/simulator/index.html  SHOTS_DIR=/path/for/screenshots
```

The smoke test skips itself when Playwright or the server is unavailable. When it runs, it checks:

- the page loads with no console, CSP or external-request errors;
- inline validation works;
- every example case loads and reaches the debrief;
- a GA case runs end to end at 60× (induction → airway → maintenance → emergence → sugammadex → extubation readiness);
- extubating when not ready asks for confirmation and is logged;
- the MAC moderate-sedation case runs;
- guided mode for a GA example (elderly) and the MAC example at 60×: gates appear in order, nothing advances without the gate, *Intubate* and *Extubate* are enabled only when their conditions are met, and the debrief notes guided mode;
- "Run full case automatically" for a GA example (MH-susceptible TIVA) and the MAC example at 60×: the banner text, completion, `AUTO:` log entries, no override, the debrief "ran automatically" note and the session JSON flag;
- a manual control ends automatic mode;
- a sensor fault shows `FAULT`, turns the status RED/HOLD, and "Resume hold" is logged;
- the Sources, Model card and About panels open;
- there is no page-level horizontal scroll at 390 px.

## AI assistance

Code, parameter selection and source gathering for this simulator were produced with AI assistance (Anthropic Claude, model claude-opus-5-5, via Claude Code, November 2026) under the owner's direction. Sources were checked through web-search records of labels and publications as recorded in SOURCES.md; independent human verification of every source by the owner is pending. AI was not used to generate data presented as observed. The owner is responsible for the content.

## Files

```
index.html            page shell (banner, stepper, panels)
css/simulator.css     site palette + dark HMI monitor
ui/app.js             entry: state, stepper, panels, extubation dialog
ui/patient-form.js    step 1        ui/assessment.js   step 2
ui/plan-editor.js     step 3        ui/plan-model.js   plan validation helpers
ui/monitor.js         step 4        ui/charts.js       canvas trends
ui/debrief.js         step 5        ui/model-card.js   Model card panel
ui/sources.js         Sources panel and source tags
engine/, data/        pure simulation engine and drug library (no DOM)
engine/case-actions.js   phase/airway/extubation actions shared by the manual buttons and the sequences
engine/autorun.js        guided mode and the automatic demonstration (pure, testable)
engine/autorun-config.js every guided/automatic condition and timing, with provenance
tools/model-card-tables.mjs  regenerates the Model card tables (--check verifies they are current)
```
