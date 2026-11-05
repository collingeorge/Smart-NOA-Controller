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
| 3 Anesthetic plan | Optional **technique templates** (GA opioid-based, GA opioid-free, MAC dexmedetomidine, MAC propofol) fill the steps from the drug library for this patient and stay editable (see below). GA (induction → maintenance → emergence/extubation) or MAC with a minimal/moderate/deep target (ASA continuum; moderate and deep require exhaled-CO2 monitoring). Per-phase drug pickers are built from the library. Each dose is auto-filled from `recommend()` and shows the sourced range, the weight scalar and kg used, and the source tags. Values can be edited (out of range: warning; above a ceiling: blocked), timed (mm:ss), reordered from the keyboard, and previewed on a timeline. There is an interlocks toggle and a random seed. |
| 4 Run | A dark HMI-style monitor. It has vitals tiles with alarm styling and text, 15-minute canvas trends, a drug panel (live rate, Ce, cumulative, bolus/adjust/stop), alarms with priority labels and Acknowledge, interlock status with "Resume hold", and airway and phase controls. Extubation uses a readiness checklist and a logged override. An **IV fluids** panel (lactated Ringer's or 0.9% sodium chloride; 250/500 mL boluses; maintenance mL/h; totals by type) and an **antibiotic prophylaxis** panel (guideline agent, window and redose status, checklist warning) sit beside the monitor. You can also inject complications and sensor faults, and use play/pause/step at 1×/5×/20×/60×. An event log records everything. A **Guided mode** and a **Run full case automatically** demonstration can drive the same phase controls (see below). |
| 5 Debrief | Whether the case ran in guided or automatic mode (and where/why it stopped), drug totals (amount and per kg; lidocaine total incl. pretreatment, mg/kg IBW), IV fluids by type, antibiotic prophylaxis timing (in window or not, checklist acknowledgement), time with MAP < 65, minimum SpO2, alarms, interlock events, extubation readiness at extubation, plan-step outcomes, model limits, and "Download session (JSON)". The JSON is built from a Blob, so nothing goes over the network. |

The **Sources**, **Model card** and **About & limitations** panels can be opened from every step.

## Guided mode and the automatic demonstration

Both live on the Run screen ("Guided & automatic modes" panel), work for GA and MAC plans and all four example cases, and use the existing speed controls (1×/5×/20×/60×). They use the patient and plan already entered and start the case from 00:00. They **do not change any dose, rate, source or model value**: drugs are given only by your plan steps, at the offsets you set, through the engine's plan scheduler.

- **Guided mode (phase-gated).** Each phase runs automatically from your approved plan; you confirm every transition with a gate button, and no transition proceeds on time alone when a state condition exists. GA: *Transfer to OR* (pre-op holding: enabled 5 min after the premedication bolus has ended, with a countdown) → OR setup (2 min) and preoxygenation (FiO2 1.0) → *Approve & start induction* (enabled after 3 min of preoxygenation and ≥ 10 min after the premedication ended; bag-mask ventilation, then induction plan steps) → *Intubate (secure airway)*, enabled only when intubating conditions are met (all induction steps given, processed-EEG depth index ≤ 60, TOF count ≤ 1) → *Enter maintenance mode* → *Start surgery (incision)*: the **pre-incision verification** — airway secured and ventilated, processed-EEG index in the GA band 40–60 (below 40 only with your acknowledgement), analgesia given per plan, TOF count ≤ 2 when the plan has a neuromuscular blocker, antibiotic started within its window (required), and the **WHO time out** confirmed by you → *End surgery* → *Enter emergence / extubation mode* → *Extubate*, enabled only while `sim.extubationReadiness()` is met. MAC: *Transfer to OR* → *Approve & start sedation* (after OR setup; FiO2 0.4) → *Start procedure* (sedation target held, antibiotic if indicated, WHO time out) → *End procedure* → complete when the sedation level is minimal or awake.
- **Run full case automatically.** A demonstration that walks the same sequence; gates pass once their state conditions hold (e.g. 30 min of surgery, 20 min of procedure). It **never confirms the WHO time out, never acknowledges an index below the GA band and never gives missing prophylaxis**: it pauses and waits for you (buttons in the panel; they do not end the mode).
- **Same actions as the manual buttons.** Every step calls the shared functions in `engine/case-actions.js` that the manual phase, airway and extubation controls also call, so interlocks, alarms and the event log behave exactly as in a manual run.
- **Extubation is never forced.** Extubation happens only when `sim.extubationReadiness()` is met (TOFR ≥ 0.9, Thilen 2023, plus the illustrative criteria); the "Extubate anyway" override is never used. If readiness is not met within 30 min of emergence, the demonstration stops and lists the unmet criteria; guided mode lists them and keeps *Extubate* disabled (you can take over).
- **Pauses.** Both modes pause, stop the clock and say why (on screen and through the `aria-live` region) when an interlock hold latches or an unacknowledged HIGH-priority alarm is active or newly raised. They never release a hold or acknowledge an alarm: you decide (e.g. *Acknowledge*, *Resume hold*), then press *Resume*. Medium and low alarms (MAP < 65, depth over the sedation target, dose-range notices) do not pause; they are shown and announced as usual.
- **Manual control ends it.** *Pause*, *Resume* and *Take over manually* are always available. Using any other control on the monitor (phase, airway, drug, fluid, complication, sensor fault, step or play button, restart) ends guided/automatic mode and is logged; the case then continues manually. Speed, alarm *Acknowledge* and *Resume hold* do not end it.
- **Labelled and recorded.** While a mode runs, a banner says it is a scripted educational sequence, not a controller or a clinical recommendation. Each step it takes is logged with the prefix `AUTO:` (log kind `auto`). The debrief and the downloaded session JSON (`automaticMode`, `summary.automatic`) record the mode, the steps (automatic or confirmed by you), pauses, and where and why it stopped.
- **Limits.** The conditions are simulator conventions applied to illustrative model outputs (processed-EEG depth index, sedation level, TOF); only TOFR 0.9 (Thilen 2023), the ASA continuum levels, the GA band (S52/S53), the WHO time out (S54), the antibiotic window (S46) and the config.yaml interlock thresholds are sourced. Every condition and timing is in one block, `engine/autorun-config.js`, with its unit, rationale and provenance; the Model card lists them. In the healthy-adult example (seed 1) the illustrative model's MAP falls below 60 during maintenance, so the demonstration pauses there until you respond. A sequence can only start from 00:00; after you take over it cannot be re-entered mid-case.

## Why the timing

Every technique-template step carries a **timing rationale** (`timingRationale`: text + sources, or "simulator convention"), shown under the step in the plan editor ("Why this time"), in the phase-timeline tooltip and legend, in the parameter inventory (component `template_timing`) and in `MODEL_CARD.md` ("Timing rules and template timing"). All timing thresholds live in one block, `engine/timing.js` `TIMING_CONFIG`.

- **Loading, then maintenance.** A maintenance infusion starts when its loading dose ends: dexmedetomidine loading 1 mcg/kg over 10 min, then maintenance at +10:00 (label "followed by a maintenance infusion", S9); propofol MAC initiation 0.5 mg/kg over 5 min, then maintenance (S11); IV lidocaine loading over ~10 min, then the infusion (S1). `buildPlan()` and the plan editor schedule it; the editor warns if you make them overlap.
- **Induction order.** Fentanyl ~3 min before propofol so it approaches peak effect before laryngoscopy — a *simulator convention* anchored to the fentanyl label ("maximal analgesic and respiratory depressant effect may not be noted for several minutes", S13). Lidocaine pretreatment immediately before propofol (S11). Rocuronium after loss of consciousness, beyond the propofol label onset of 40 s (S11). Dexamethasone at induction and ondansetron at the end of surgery (PONV consensus, S2/S3). Cefazolin within 60 min before incision (Bratzler, S46). Sugammadex after the agents are off, dose compared with the TOF depth of block (S6).
- **Pre-op holding.** Midazolam premedication is given in pre-op holding about 5 min before transfer to the OR (owner-stated practice; label onset 3–5 min, S17). Induction is allowed no earlier than transfer interval + OR setup + preoxygenation (10 min) after the premedication ends; plan drugs never start while a premedication bolus is running.
- **End of surgery.** In the opioid-free template, dexmedetomidine stops 15 min before the planned end of surgery (*simulator convention*: no source gives the interval). The automatic demonstration knows its planned end (30 min of surgery); in guided and manual mode the stop runs when you press *End surgery* (or at emergence at the latest).
- **Pharmacology waits for pharmacology.** A rocuronium top-up waits for TOF count ≥ 3 (label: at 25 % recovery of control T1 = 3 twitches, S12); a repeat midazolam bolus waits 4 min (label: over ≥ 2 min, then ≥ 2 min to evaluate, S17). Planned steps are held with the reason shown; a manual dose is warned and logged.
- **Timing check.** The plan screen, the guided/automatic panel and the debrief show a *Timing check* (each rule with pass/warning and its source or convention).
- **Processed-EEG depth index.** The depth number is a *processed-EEG depth index (BIS-style, simulated)* — an illustrative model output, not a BIS value (BIS is a trademark of its owner). The GA band 40–60 is the protocol target of the B-Unaware (S52) and BAG-RECALL (S53) trials, neither of which showed the BIS protocol superior for preventing awareness. In this illustrative model 1 MAC of a volatile agent often reads just below 40, so the pre-incision gate asks you to acknowledge an index below the band rather than blocking.

## November 2026 additions

- **Technique templates** (`data/templates.js`, `engine/templates.js`). Templates name drugs, regimens and phase offsets only; every dose and rate is filled at runtime by `recommend()` (no hard-coded doses), and locked drugs are skipped or replaced by the template fallback (e.g. sevoflurane → propofol infusion for MH susceptibility). *GA — opioid-based*: midazolam (optional), fentanyl, lidocaine pretreatment (optional), propofol, rocuronium, sevoflurane, dexamethasone, ondansetron, sugammadex, lactated Ringer's maintenance, guideline prophylaxis. *GA — opioid-free*: dexmedetomidine, ketamine and IV lidocaine (Foo 2021) instead of an opioid; lidocaine pretreatment is omitted because an IV lidocaine infusion is planned; evidence note from the POFA trial (more hypoxaemia and severe bradycardia, less PONV). *MAC — dexmedetomidine*: label procedural-sedation dosing (1 mcg/kg over 10 min, 0.6 mcg/kg/h titrated 0.2–1; 0.5 mcg/kg loading > 65 y), minimal/moderate/deep target, optional midazolam/propofol supplementation; sedation beyond deep is general anaesthesia (use a GA template); with interlocks on the Smart NOA ceiling (0.5 mcg/kg/h) is pre-filled. *MAC — propofol*: the existing technique.
- **Lidocaine pretreatment before propofol**: 10 mg (propofol label: 1 mL of 1%), counted in the cumulative lidocaine total; a LOW alarm and plan warning when it overlaps (within 4 h) with IV lidocaine analgesic dosing (Foo 2021). Injection pain is a teaching note only: propofol emulsion pH is 7–8.5 (label), so the pain is not from an acidic solution.
- **IV fluids**: lactated Ringer's and 0.9% sodium chloride (label composition and cautions). The labels give no fixed dose, so the 100 mL/h default, the 1000 mL/h input limit and the 250/500 mL bolus sizes are simulator conventions. Maintenance continues across phases. Both fluids use the same illustrative volume model; electrolytes and acid-base are not modelled.
- **Antibiotic prophylaxis (timing only)**: Bratzler 2013 — cefazolin 2 g (3 g ≥ 120 kg) started ≤ 60 min before incision, redose every 4 h; with a severe β-lactam allergy, clindamycin 900 mg (≤ 60 min, redose 6 h) or vancomycin 15 mg/kg (≤ 120 min). MEDIUM alarms: "Surgery started without antibiotic prophylaxis in the recommended window" and "Prophylaxis redose due". Manual mode: a checklist warning before Start surgery can be acknowledged (the alarm still sounds at incision). Guided/automatic modes (timing review): a dose started within the window is a **required** pre-incision item — the clinician gives it from the panel; neither mode gives or acknowledges it on its own. "Prophylaxis indicated" is a plan checkbox (default on for GA, off for MAC).

## Palliative pain management and end-of-life care modules

**Palliative / end-of-life simulation — fictional patient — educational only. Not medical advice. Palliative sedation is not euthanasia or medical aid in dying; laws differ by jurisdiction.**

Choose **Palliative pain management** or **End-of-life care** with the module buttons under the header (the **Perioperative** simulator is unchanged). Each module has four steps — Case → Assess & plan → Run → Debrief — and an **Ethics, law & communication** panel that opens from every screen (definitions of palliative care, hospice, proportionate and continuous deep palliative sedation, euthanasia and MAID; intent, proportionality and the double-effect principle; capacity, surrogates, advance directives, interdisciplinary review, documentation, hydration, a jurisdiction note and paraphrased goals-of-care topics from the Serious Illness Conversation Guide, CC BY-NC-SA 4.0). The modules teach goals-of-care conversations, proportionality and double effect and make **no outcome claims** (no survival, life-span or efficacy claims). **Excluded by design:** any content, doses or guidance for medical aid in dying or euthanasia, or for hastening death.

- **Cases (fictional):** cancer bone pain at home hospice (opioid-tolerant), opioid-naïve inpatient with new cancer pain and CKD, non-cancer post-operative pain at home (CDC 2022 scope), chronic non-cancer pain on stable opioids (CDC 2022 scope), end-of-life dyspnoea with terminal secretions, refractory terminal delirium (palliative-sedation teaching case). The case form records setting, diagnosis category, opioid status and current regimen (oral MME/day), eGFR and hepatic impairment, goals of care, capacity, surrogate/advance directive, prognosis category and prior adverse effects.
- **Doses and rules (sources S100–S120):** opioid starting doses only from FDA labels (oral/IV morphine, oral oxycodone, oral/IV hydromorphone; renal/hepatic/elderly wording); breakthrough 10–20% of the 24-h dose and a +50–100% titration suggestion (NCCN); oral:IV morphine 2:1–3:1 and laxatives with opioids (ESMO 2018); conversion ratios 1.5:1 and 5:1 (MASCC-ASCO 2025) with a **clinician-entered** cross-tolerance reduction (no consensus value exists, so there is no default); CDC 2022 for non-cancer pain only (MME/day is a risk estimate, never a conversion; pause and reassess before ≥ 50 MME/day); naloxone in 0.1 mg increments titrated to respiratory rate (Scottish Palliative Care Guidelines, FDA label); midazolam palliative-sedation steps from the revised EAPC framework (2024). Anything not verifiable (methadone, fentanyl patches, SC opioid doses, second-line sedatives, anticholinergic, antipsychotic and benzodiazepine doses) is labelled "not simulated — specialist decision".
- **Run (calm light monitor; 1, 6 or 24 simulated hours per second):** pain, dyspnoea, agitation, secretions, nausea, constipation, RASS and respiratory rate (illustrative model output), 24-h trends, a medication administration record with 24-h totals and MME/day, alarms that you acknowledge, and a **daily review gate**: scheduled and PRN doses run from the regimen you approved, and every titration, rotation or bowel-regimen suggestion waits for your *Approve* or *Decline*. HIGH alarms (respiratory rate < 8, unintended RASS ≤ −3) pause the run; nothing is acknowledged for you.
- **Palliative sedation (end-of-life module):** the controls stay disabled until all six documentation items are complete (refractory symptom with treatments tried and why refractory; goals-of-care conversation with patient or surrogate; consent/assent including depth and duration; interdisciplinary/palliative-specialist input; prognosis — continuous deep sedation only with "hours to days"; jurisdiction/institutional-policy acknowledgement). You choose the target RASS and the symptom, and approve every bolus, repeat and infusion change. The engine never escalates on its own; it raises a **"not proportional"** alarm when sedation is deeper than the target and a **"comfort not achieved"** alarm when the symptom persists. Comfort opioids continue on schedule and are never used to sedate. Hydration is a separate, documented decision; vital-sign de-emphasis in comfort-focused care is a labelled teaching toggle.
- **Debrief:** regimen and totals, per-day opioid totals, review decisions, alarms, the documentation checklist, a proportionality timeline (RASS vs target vs symptom), family-communication notes (shown as plain text, never HTML) and "Download session (JSON)".

Code: `data/palliative.js`, `engine/palliative.js`, `ui/palliative.js`; tests `tests/palliative.test.mjs` and the palliative block of `tests/ui.smoke.mjs`; sources in `SOURCES.md` → "Palliative and end-of-life modules (S100–S120)"; every value in `MODEL_CARD.md` → "Palliative and end-of-life modules".

## Where doses come from

Every dose, range, ceiling, threshold and score cut-off comes from `data/drugs.js`. Each value traces to an entry in its `SOURCES` registry: FDA prescribing information, a society guideline or consensus statement, or, for scores and weight formulas, the original paper. The human-readable registry is `SOURCES.md`. It also records how each source was checked, which drugs were left out and why, and the illustrative model assumptions. Source tags such as `[S7]` in the UI open the Sources panel at that entry. The auto-filled default within a range is a simulator convention (usually the label's stated usual dose or the lower bound), not a recommendation.

## Model limits (honest summary)

- Physiology and PK/PD are **illustrative**. For most drugs, the compartment constants are fitted so that a default bolus reproduces the onset, peak and duration statements in the label. Where the label gives no timing, the engine uses its own fallback constants. Effect models, synergy, haemodynamic and respiratory gains, patient modifiers and complication magnitudes are engine assumptions. Each drug's actual model record is shown in the Model card (from `sim.modelInfo()`), so it stays current if a published model is adopted later.
- Inhaled agents use first-order wash-in/out toward the dial setting. Their effect is expressed as a fraction of age-adjusted MAC (Mapleson 1996). Total MAC is the sum of the agents' fractions, which is an uncited teaching assumption.
- The depth number is a **processed-EEG depth index (BIS-style, simulated; 0–100, illustrative)**; it is not a BIS value (BIS is a trademark of its owner). The extubation criteria other than TOFR ≥ 0.9 (Thilen 2023) are illustrative simulator rules.
- No expert anesthesiologist review has been recorded, and no external validation has been performed. The simulator as a whole is not validated.
- The simulator covers adults 18–90 years only. Pregnancy, paediatrics, cardiopulmonary bypass and neuraxial/regional techniques are not modelled.

## Relation to the Python Smart NOA controller

With **Interlocks (Smart NOA rules)** switched on, `engine/interlocks.js` applies the decision rules of `smart_noa_controller.py` with the thresholds in `config.yaml`:

- HR < 48 sets dexmedetomidine to zero.
- MAP < 60 sets dexmedetomidine and lidocaine to zero.
- An unusable sensor value sets the dexmedetomidine, ketamine and lidocaine infusions to zero and turns the status RED.
- Holds latch and are never released automatically.
- The free-text lockouts and the simulation rate ceilings apply (dexmedetomidine 0.5 mcg/kg/h, ketamine 0.2 mg/kg/h, lidocaine 1.5 mg/kg/h). A rate is compared with its ceiling in the Python unit with the same tolerance (1e-9) as `smart_noa_controller.py` (`RATE_CEILING_TOLERANCE`), so a rate exactly at the ceiling is accepted in both.

The simulator adds one thing the Python controller does not have: an explicit, logged **Resume hold** action.

When a label default exceeds a Smart NOA ceiling, the plan editor pre-fills the ceiling and explains why. For example, the dexmedetomidine sedation start rate of 0.6 mcg/kg/h becomes 0.5. With interlocks off, these rules are skipped, but label ceilings and contraindication lockouts always apply. Parity tests (`tests/parity.test.mjs`) reproduce the outcomes in `EXAMPLE_RESULTS.json` and the regression cases in `test_safety_hardening.py`.

## Tests and lint

```sh
cd simulator
# engine, drug library and Python-parity tests (Node ≥ 18; no dependencies)
npm test

# browser smoke test: starts its own static server (Node http, no dependencies) on a free port.
# Needs Playwright + Chromium (e.g. npm i -D playwright && npx playwright install chromium).
npm run test:ui
#   optional: SIM_URL=http://host:port/simulator/index.html?test=1 (use an existing server), SHOTS_DIR=/path
#   SMOKE_SKIP=1 skips it explicitly when Playwright is not installed; otherwise a missing Playwright FAILS.

# lint (dev dependencies only: eslint 9, @eslint/js 9, globals — `npm install` in simulator/;
# node_modules is git-ignored and is not needed to serve the site)
npm run lint
```

The page exposes a test hook only when its URL contains `?test=1`: `window.__smartNoa.snapshot()` returns a deep copy (plain data) of the run state; nothing live or mutable is exposed. The smoke test checks:

- the page loads with no console, CSP or external-request errors;
- inline validation works;
- every example case loads and reaches the debrief;
- a GA case runs end to end at 60× (induction → airway → maintenance → emergence → sugammadex → extubation readiness);
- extubating when not ready asks for confirmation and is logged;
- the MAC moderate-sedation case runs;
- guided mode for a GA example (elderly) and the MAC example at 60×: gates appear in order, nothing advances without the gate, *Intubate* and *Extubate* are enabled only when their conditions are met, and the debrief notes guided mode;
- "Run full case automatically" for a GA example (MH-susceptible TIVA) and the MAC example at 60×: the banner text, completion, `AUTO:` log entries, no override, the debrief "ran automatically" note and the session JSON flag;
- a manual control ends automatic mode, but reading a source citation or pre-filling the drug form (drug-row *Bolus*/*Adjust*) does not;
- a double-click on a guided-mode gate approves only the gate that was shown (the button is disabled while the approval is processed);
- the extubation dialog pauses the clock while it is open, resumes it on close, and re-checks readiness when a button is pressed;
- technique templates: the selector, the opioid-free plan with the POFA note, lidocaine pretreatment before propofol, and the dexmedetomidine MAC plan with its notes;
- the antibiotic checklist in guided mode waits for the clinician's acknowledgement before Start surgery, and the window alarm is raised at incision;
- the fluids panel (type, boluses, maintenance, totals by type) and the debrief totals (fluids by type, prophylaxis timing, lidocaine including pretreatment);
- no console warnings or errors;
- a sensor fault shows `FAULT`, turns the status RED/HOLD, and "Resume hold" is logged;
- the palliative modules: the verbatim banner, the ethics panel from every screen, all six example cases end to end (daily review gate holds the clock until every item is decided), the conversion that refuses to proceed without a clinician-entered reduction, the end-of-life sedation gate (disabled until all six items are documented; every titration approved; no automatic escalation; "increase opioid to sedate" refused), free-text notes rendered as text, and every palliative screen at 390 px;
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
engine/prophylaxis.js    antibiotic prophylaxis selection, window and redose checks (timing only)
engine/templates.js      technique templates -> plan (doses from recommend())
data/templates.js        technique template definitions (no doses)
tools/model-card-tables.mjs  regenerates the Model card tables (--check verifies they are current)
data/palliative.js       palliative/end-of-life sources (S100–S120), label doses, rules, cases, ethics text
engine/palliative.js     palliative symptom model, dosing/conversion rules, review and sedation gates (pure)
ui/palliative.js         palliative module screens and the ethics panel
```
