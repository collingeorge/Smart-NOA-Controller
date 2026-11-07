# Smart NOA Web Simulator — build specification

Owner: Collin B. George, pre-medical student. Audience: medical-school admissions readers and physicians.
Location: `simulator/` inside the Smart-NOA-Controller repo; it will be hosted at `https://collinbgeorge.com/simulator/`.

## 0. Non-negotiable framing (applies to every file)

- This is an **educational simulation with fictional patients**. It is **not** a medical device, not clinical decision support, and not connected to any monitor, pump, or EHR. It has no network calls (`connect-src 'self'` only; no fetch to other origins).
- A persistent banner on every screen reads: **"SIMULATION — fictional patient — educational use only. Not a medical device. Not medical advice."**
- Every auto-filled dose shows its source tag (e.g. `[S7]`) linking to the in-app Sources panel (built from `data/drugs.js` `SOURCES`). Doses come **only** from FDA prescribing information, society guidelines/consensus statements, or (for scores) original validation papers. Never invent a dose, identifier, or citation. If a value cannot be verified, omit the drug or the regimen and record why in `simulator/SOURCES.md`.
- Physiology and pharmacokinetic/pharmacodynamic behaviour is **illustrative** unless a parameter set is explicitly a published model (e.g., Marsh propofol). The UI must label model outputs "illustrative model output". The depth number is a **"processed-EEG depth index (BIS-style, simulated)"** (0–100, illustrative; owner wording, 2026-11 timing review): it is not a BIS value and "BIS" is never used as a product claim (BIS is a trademark of its owner).
- Adults (18–90 y) only. Pregnancy, pediatrics, cardiac bypass, and neuraxial/regional techniques are out of scope (the UI may list them as "not modeled").

## 1. Technical constraints

- Static files only. No build step, no frameworks, no CDNs, no external fonts. ES modules (`<script type="module" src=...>`). **No inline `<script>` and no inline event handlers** (`onclick=` etc.) — the site CSP is `script-src 'self'`. Inline `style=` attributes are allowed but prefer CSS classes.
- Charts: hand-written `<canvas>` or SVG. No libraries.
- Engine modules in `engine/` and `data/` must be **pure** (no DOM), importable in Node ≥18 for tests (`node --test simulator/tests`). Deterministic given a seed (use a small seeded PRNG, e.g. mulberry32; never `Math.random` inside the engine).
- Accessibility: semantic HTML, labels for every input, keyboard operable, alarm changes announced via an `aria-live` region, colour is never the only signal (pair with text/shape), WCAG AA contrast.
- Visual style matches collinbgeorge.com: CSS variables
  `--navy:#18374b; --navy-deep:#102b3d; --ink:#263b48; --muted:#586773; --gold:#88682f; --gold-light:#c1a36c; --line:#d7dcd9; --paper:#fff; --wash:#f5f6f3; --serif:Georgia,"Times New Roman",serif; --sans:Inter,"Segoe UI",Arial,sans-serif; --mono:"SFMono-Regular",Consolas,"Liberation Mono",monospace;`
  The live-monitor area may use a dark HMI theme (navy-deep background, high-contrast numerals) for readability; alarm colours follow IEC 60601-1-8 convention (high = red, medium = yellow/amber, low = cyan/blue) **with text labels**.
- Must work at 1280 px desktop and remain usable at 390 px phone width without page-level horizontal scroll.

## 2. File layout and ownership

```
simulator/
  index.html            (UI worker)
  css/simulator.css     (UI worker)
  ui/*.js               (UI worker)  entry: ui/app.js
  engine/*.js           (engine worker)
  data/drugs.js         (drug-library worker)  exports SOURCES, DRUGS, CONDITIONS, ALLERGIES, MEDICATIONS
  data/scenarios.js     (engine worker)        scripted complication presets
  tests/*.test.mjs      (engine worker; drug-library worker adds data tests)
  SOURCES.md            (drug-library worker)  human-readable registry + "not included and why"
  README.md             (parent)
```

## 3. Patient model (`engine/patient.js`)

Input object (all fields required unless marked optional):
```js
{
  sex: 'male'|'female',
  ageYears: 18..90, heightCm: 140..210, weightKg: 35..250,
  asa: 1..5, emergency: false,
  baseline: { hr: 40..140, sbp: 80..220, dbp: 40..130, spo2: 85..100, rr: 8..30 },   // map derived = dbp + (sbp-dbp)/3
  egfr: 5..150,                       // mL/min/1.73m²
  airway: { mallampati: 1..4, difficultHistory: bool, limitedMouthOpening: bool, limitedNeck: bool },
  conditions: string[],               // ids from CONDITIONS (data/drugs.js)
  allergies: string[],                // ids from ALLERGIES
  medications: string[],              // ids from MEDICATIONS
  ponvHistory: bool, smoker: bool, postopOpioidsExpected: bool,
  stopBang: { snoring, tired, observedApnea, pressure } // booleans; BMI/age/neck/sex parts derived where possible; neckCm optional
}
```
`derivePatient(p)` returns `{ ...p, map, bmi, ibwKg, lbwKg, abwKg, apfel: {score, riskPercent}, stopBang: {score, risk}, flags: string[] }`.
- IBW: Devine (male 50 kg, female 45.5 kg, + 2.3 kg per inch over 60 in). LBW: Janmahasatian 2005. Adjusted BW = IBW + 0.4 × (TBW − IBW). Cite in SOURCES (Apfel 1999 percentages 10/21/39/61/79; STOP-Bang Chung).
- `flags` examples: `elderly` (≥65), `obese` (BMI ≥30), `morbidObese` (≥40), `ckd` (eGFR <60), `severeCkd` (<30), `aspirationRisk` (gerd/emergency/…), `difficultAirwayPredicted`.

## 4. Drug library schema (`data/drugs.js`)

```js
export const SOURCES = { S1: { id:'S1', citation:'…AMA style…', url:'…', identifiers:'doi/PMID if confirmed', verifiedVia:'…', supports:'…' }, … };
export const CONDITIONS = [{ id:'heart_block', label:'2nd/3rd-degree heart block (no pacemaker)' }, …];
export const ALLERGIES  = [{ id:'nsaid', label:'NSAID / aspirin' }, …];
export const MEDICATIONS = [{ id:'beta_blocker', label:'Beta-blocker' }, …];
export const DRUGS = [{
  id: 'propofol', name: 'Propofol', cls: 'hypnotic',     // cls: hypnotic|opioid|nmb|reversal|alpha2|nmda|local|antiemetic|vasopressor|anticholinergic|benzodiazepine|volatile|nsaid|analgesic
  concentration: { value: 10, unit: 'mg/mL' },            // as commonly supplied (label)
  amountUnit: 'mg',                                       // unit of cumulative amount (mg|mcg|units|%)
  regimens: {                                             // keys: premed | sedation_minimal | sedation_moderate | sedation_deep | induction | maintenance | emergence | rescue
    induction: { kind:'bolus', perKg:{ default:2, min:1.5, max:2.5 }, unit:'mg/kg', scalar:'TBW'|'IBW'|'LBW'|'ABW',
                 adjust:[{ when:'elderly|asa>=3', perKg:{default:1.25,min:1,max:1.5}, note:'…', sources:['S…'] }],
                 fixed:{ default, min, max, unit }        // use instead of perKg for fixed-dose drugs (e.g. ondansetron 4 mg)
                 rate:{ default,min,max, unit:'mcg/kg/min'|'mcg/kg/h'|'mg/kg/h'|'%' }  // for kind:'infusion' or 'inhaled'
                 timing:'…free text from label, e.g. "give over 30–60 s"…', sources:['S…'], note:'…' },
    …
  },
  ceiling: { value, unit, basis:'label maximum'|'guideline maximum', sources:['S…'] },   // hard stop in simulator (cumulative or rate as stated)
  contraindications: [{ when:'condition:mh_susceptible' | 'allergy:nsaid' | 'egfr<30' | 'medication:maoi' | 'condition:heart_block', severity:'lock'|'warn', message:'…', sources:['S…'] }],
  timing: { onsetMin, peakMin, durationMin, basis:'label statement or published model', sources:['S…'] },   // used by engine to calibrate illustrative PK
  pkModel: 'marsh'|'calibrated',                          // 'marsh' only for propofol if published parameters are verified
}];
```
Drug set (adult). Include a drug only if its doses can be sourced:
- premed/anxiolysis: midazolam
- sedation (MAC): propofol, dexmedetomidine, midazolam, fentanyl, ketamine
- induction: propofol, etomidate, ketamine, fentanyl, lidocaine (airway/pressor attenuation; overlap rule), rocuronium, succinylcholine
- maintenance: propofol infusion, sevoflurane (age-adjusted MAC, Mapleson 1996 / label), dexmedetomidine infusion, ketamine infusion (Schwenk 2018 limits), lidocaine infusion (Foo 2021: ≤1.5 mg/kg/h IBW, ≤120 mg/h, not with other local-anaesthetic interventions), fentanyl, rocuronium top-up
- emergence: dexamethasone (PONV, given early), ondansetron, sugammadex (2/4/16 mg/kg by depth — Thilen 2023 + label), neostigmine + glycopyrrolate (minimal depth only — Thilen 2023)
- rescue: phenylephrine, ephedrine, glycopyrrolate, naloxone, ketorolac (renal/NSAID lockout), acetaminophen IV
Required contraindication rules (at minimum): succinylcholine LOCK for `mh_susceptible`, `hyperkalemia`, `recent_burn_or_denervation`, `neuromuscular_disease`; sevoflurane LOCK for `mh_susceptible`; dexmedetomidine LOCK for `heart_block`; ketorolac LOCK for `egfr<30`, `allergy:nsaid`; ketamine WARN for `psychosis_history` and LOCK for uncontrolled HTN (label CONTRAINDICATIONS; changed from WARN in the 2026-11 audit); etomidate WARN for `adrenal_insufficiency`/`sepsis`; propofol LOCK for `allergy:propofol`; rocuronium LOCK for `allergy:rocuronium`; sugammadex LOCK for `allergy:sugammadex`; lidocaine WARN for `regional_block_planned`, `liver_disease` and LOCK for `heart_block` (label CONTRAINDICATIONS; changed from WARN in the 2026-11 audit); neostigmine WARN when TOF depth not minimal (runtime rule, engine). Wording must match the source.

## 5. Engine API (`engine/sim.js` and helpers)

```js
import { derivePatient } from './patient.js';
import { recommend, evaluateContraindications } from './dosing.js';
import { createSimulation } from './sim.js';

evaluateContraindications(patientDerived, drugId) -> [{ severity:'lock'|'warn', message, sources }]
recommend(patientDerived, regimenKey, drugId) -> {
  drugId, regimenKey, kind, scalar, weightUsedKg,
  dose: { value, unit, perKg, range:{min,max} } | null,      // bolus amount in drug.amountUnit (mg or mcg)
  rate: { value, unit, range:{min,max} } | null,             // infusion/inhaled
  sources:[…], notes:[…], warnings:[…], locked:boolean, lockReasons:[…] }

createSimulation({ patient: patientDerived, plan, seed = 1, interlocks: true }) -> sim
  plan = { mode:'GA'|'MAC', sedationTarget:'minimal'|'moderate'|'deep'|null,
           steps:[{ id, phase:'premed'|'sedation'|'induction'|'maintenance'|'emergence', atSec /* offset from phase start */,
                    order, drugId, kind:'bolus'|'infusion'|'inhaled'|'stop', amount, amountUnit, rate, rateUnit }] }
sim.state -> {
  tSec, phase, running,
  vitals: { hr, sbp, dbp, map, spo2, rr, etco2, depthIndex, sedationLevel:'awake'|'minimal'|'moderate'|'deep'|'general', tofCount, tofRatio },
  sensors: { hr:'ok'|'fault', map:'ok'|'fault', spo2:'ok'|'fault' },
  drugs: { [drugId]: { cp, ce, unitConc, infusionRate, rateUnit, cumulative, amountUnit } },
  airway: { secured:bool, ventilated:bool, maskVentilation:bool, fio2 },
  surgery: { stimulus:'none'|'laryngoscopy'|'incision'|'maintenance'|'closing' },
  alarms: [{ id, priority:'high'|'medium'|'low', message, active, acknowledged, sinceSec }],
  interlocks: { enabled, holdLatched, heldDrugs:[…], lockouts:{[drugId]:reasons} },
  log: [{ tSec, kind:'dose'|'alarm'|'action'|'event'|'interlock'|'phase', message }] }
sim.step(dtSec = 1) -> state                // fixed internal sub-step ≤ 1 s
sim.administer({ drugId, kind, amount, amountUnit, rate, rateUnit }) -> { ok, blocked:bool, reasons:[…], warnings:[…] }
sim.setPhase(phase); sim.action(id)         // ids: secure_airway, mask_ventilate, jaw_thrust, start_ventilation, stop_ventilation,
                                            //      set_fio2:<0.21..1>, start_surgery, end_surgery, extubate, acknowledge:<alarmId>, resume_hold
sim.inject(eventId)                         // ids from data/scenarios.js: hemorrhage, vagal_bradycardia, bronchospasm, laryngospasm_on_extubation,
                                            //   light_anesthesia_stimulus, hr_sensor_fault, map_sensor_fault, spo2_probe_off, anaphylaxis_hypotension
sim.extubationReadiness() -> { ready, criteria:[{ id, label, met, value, source }] }   // awake (depth index), TOFR ≥ 0.9 (Thilen 2023), RR/ventilation adequate, SpO2, hemodynamics
sim.summary() -> { durationSec, totals:{[drugId]:{ amount, unit, perKg }}, timeMapBelow65Sec, minSpo2, maxHr, minHr, alarms:[…], extubation:{…}, interlockEvents:[…] }
```

### 5.1 Pharmacokinetics / pharmacodynamics (illustrative)
- Propofol: Marsh 3-compartment + effect site **only if** the worker can cite Marsh et al. BJA 1991 parameters confidently; otherwise use the calibrated model and say so.
- Others (`pkModel:'calibrated'`): 2-compartment + effect site whose constants are fitted so a default bolus reproduces the label onset/peak/duration in `drug.timing`. Document the fitting in code comments. Volatile: first-order wash-in/out of end-tidal fraction toward the dial setting; effect = fraction of age-adjusted MAC.
- Effects (sigmoid Emax, illustrative): hypnotic depth (propofol, sevo, midazolam, dex, ketamine, etomidate; opioid synergy), analgesia/stimulus suppression (opioids, ketamine, lidocaine, dex), HR/MAP changes (propofol ↓MAP; dex ↓HR/↓MAP then possible ↑MAP with bolus; ketamine ↑HR/↑MAP; phenylephrine ↑MAP ↓HR reflex; ephedrine ↑HR/↑MAP; glyco ↑HR), respiratory depression (opioids, propofol, benzodiazepines; synergy), neuromuscular block (rocuronium, succinylcholine) → TOF count/ratio; sugammadex encapsulates rocuronium (dose-dependent, fast); neostigmine only effective at minimal depth.
- Patient modifiers: elderly/ASA ≥3 → greater sensitivity and hypotension; hypovolemia/sepsis/hf_reduced_ef/aortic_stenosis_severe → amplified hypotension; beta_blocker → blunted HR rise; osa/obese → faster desaturation, more respiratory sensitivity; severe CKD → prolonged rocuronium; liver disease → prolonged lidocaine/midazolam.
- Stimuli: laryngoscopy (+HR/+MAP, 2–3 min) when airway secured; incision/maintenance stimulus scaled down by analgesia; emergence stimulus.
- Oxygenation: apnoea when respiratory drive below threshold or full NMB and not ventilated → SpO2 falls with a time course that depends on preoxygenation/FiO2 and obesity; ventilation (bag-mask or secured airway + ventilator) restores. During apnoea without ventilatory support the internal PaCO2 rises, and EtCO2 is reported as `null` (no exhaled gas, no capnography signal; 2026-11 audit).
- Seeded small physiological noise only (no random alarms). Vitals must be reproducible per seed.

### 5.2 Safety layer (`engine/interlocks.js`) — must mirror the Python controller where they overlap
Ported verbatim in behaviour from `smart_noa_controller.py` (same thresholds from `config.yaml`: hr_critical_low 48, map_critical_low 60, strict `<`):
- lockouts enforced at administration and re-enforced every step; case-insensitive substring matching where free text is used;
- unusable sensor value (NaN/missing/non-finite) → zero dexmedetomidine, ketamine and lidocaine infusions, latch hold, status RED (high alarm "sensor fault");
- HR < 48 → zero dexmedetomidine, latch hold; MAP < 60 → zero dexmedetomidine and lidocaine, latch hold; a latched hold re-zeroes held drugs every step and never auto-restarts; `resume_hold` is an explicit, logged user action;
- simulation rate ceilings (`config.yaml` `simulation_rate_ceilings`: dexmedetomidine 0.5 mcg/kg/h, ketamine 0.2 mg/kg/h, lidocaine 1.5 mg/kg/h) apply **when interlocks are enabled**, with a UI note that these are the Python simulation ceilings; label maxima in `drug.ceiling` always apply as hard stops.
Additional simulator alarms: SpO2 < 90 (high), apnoea > 30 s unventilated (high), MAP < 65 (medium), HR > 120 (medium), MAP > 120 (medium), depth deeper than the MAC sedation target (medium, "airway/ventilation risk"), TOFR < 0.9 at extubation attempt (high), dose/rate outside regimen range (low/medium), cumulative over ceiling (blocked). Alarms latch until acknowledged once the condition clears.
- Parity tests in `tests/parity.test.mjs` must reproduce the decision outcomes in `EXAMPLE_RESULTS.json` (statuses GREEN/RED/HOLD and which infusions are zeroed for the scripted HR/MAP sequences) and the regression cases in `test_safety_hardening.py` (NaN/None fail-safe, direct-write bypass prevented, ceilings, matching).

## 6. UI flow (`index.html`, `ui/*.js`)

Steps across the top (stepper): **1 Patient → 2 Assessment → 3 Anesthetic plan → 4 Run (monitor) → 5 Debrief**, plus a **Sources** panel and **About/limitations** panel reachable from every step.

1. **Patient**: sex, age, height, weight, ASA, emergency, baseline vitals, eGFR, airway, conditions (checkbox groups: cardiovascular, respiratory, renal/hepatic, neuro/psych, metabolic/other, anaesthesia-specific like MH susceptibility), allergies, medications, PONV/smoker/postop opioids, STOP-Bang items. "Load example patient" presets (3–4 fictional adults incl. a healthy adult, an elderly patient with CAD/CKD, an obese OSA patient, an MH-susceptible patient). Validation with inline messages.
2. **Assessment** (computed, read-only): BMI, IBW/LBW/ABW, MAP, Apfel score/risk, STOP-Bang, flags, airway concerns, drug lockouts/warnings list with sources.
3. **Anesthetic plan**: choose **General anesthesia** (phases Induction → Maintenance → Emergence/Extubation) or **MAC / procedural sedation** with target **Minimal / Moderate / Deep** (ASA continuum; show the ASA definition and that moderate/deep require exhaled-CO2 monitoring). For each phase, a drug picker grouped by class shows only drugs with a regimen for that phase; locked drugs are disabled with the reason; warnings shown. Selecting a drug **auto-fills dose/rate from `recommend()`** with range, weight scalar used, and source tag. User can edit dose/rate (out-of-range → warning; above ceiling → blocked), set **time offset (mm:ss)** within the phase, and **reorder steps** (keyboard-accessible up/down). Show a phase timeline preview.
4. **Run**: HMI dashboard. Big vitals tiles (HR, BP/MAP, SpO2, RR, EtCO2, depth index + sedation level, TOF), trend charts (last 15 min, canvas), infusion/drug panel (rate, Ce, cumulative, stop/adjust/bolus controls), alarm panel (priority, text, acknowledge), interlock status (GREEN/RED/HOLD, held drugs, Resume hold), airway/ventilation controls, phase controls (Start induction, Secure airway, Start surgery, End surgery, Begin emergence, Extubate — extubate shows readiness criteria and warns if not met), complication injection menu, sensor-fault buttons, play/pause/step, speed 1×/5×/20×/60×, event log.
5. **Debrief**: totals per drug (amount and per-kg), time MAP < 65, min SpO2, alarm list, interlock events, extubation readiness at time of extubation, and a reminder of model limits. "Download session (JSON)" via a Blob link (no network).

## 7. Evidence and honesty rules
- Every number shown as a dose, range, ceiling, threshold, or score cut-off must trace to `SOURCES`. Model parameters that are illustrative must be labelled as such in `SOURCES.md` under "Model assumptions (illustrative)".
- PubMed/doi.org/DailyMed may be unreachable; verify via web-search records of FDA label PDFs/publisher pages and record exactly what was confirmed in `verifiedVia`. Reuse confirmed entries from `Breast-Reconstruction-Anesthesia-Protocol/DOSING_SOURCES.md` (S1–S39) where they apply — copy the citation and verification text, do not re-number blindly.
- No claims of validation, accuracy, or clinical use anywhere.
