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
| 4 Run | A dark HMI-style monitor. It has vitals tiles with alarm styling and text, 15-minute canvas trends, a drug panel (live rate, Ce, cumulative, bolus/adjust/stop), alarms with priority labels and Acknowledge, interlock status with "Resume hold", and airway and phase controls. Extubation uses a readiness checklist and a logged override. You can also give fluid boluses (when the engine supports them), inject complications and sensor faults, and use play/pause/step at 1×/5×/20×/60×. An event log records everything. |
| 5 Debrief | Drug totals (amount and per kg), time with MAP < 65, minimum SpO2, alarms, interlock events, extubation readiness at extubation, plan-step outcomes, model limits, and "Download session (JSON)". The JSON is built from a Blob, so nothing goes over the network. |

The **Sources**, **Model card** and **About & limitations** panels can be opened from every step.

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
```
