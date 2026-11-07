# Model card — Smart NOA web simulator

> **Educational work by a pre-medical student — not medical advice.** Not a clinical protocol, prescription, or patient handout, and not for patient care. See [DISCLAIMER](../DISCLAIMER.md).

Generated from `sim.parameterInventory()` and `engine/autorun-config.js` on 2026-11-05 by `node simulator/tools/model-card-tables.mjs` so these tables match the code. Structure follows the ISPOR–SMDM Modeling Good Research Practices Task Force-7 report on model transparency and validation (Eddy et al., *Value in Health* 2012;15:843-850).

## Intended use
Education only: an educational, label-calibrated anesthesia pharmacology simulator with fictional adult patients. Not for clinical decisions or dosing. Not a medical device. No device, monitor, pump or patient-data interface. Since November 2026 it also has **palliative pain management** and **end-of-life care** teaching modules (fictional patients; hour/day time scale; goals-of-care, proportionality and double-effect teaching; no outcome claims; no content about medical aid in dying, euthanasia or hastening death) — see "Palliative and end-of-life modules" below.

## Verification and validation status
- **Verification (does the code do what it is written to do):** automated tests — 179 engine/library tests (patient derivations, dosing and contraindications, PK/PD sanity, physiology sanity, Python-controller parity, determinism, full GA and MAC runs, model-implementation checks, guided/automatic sequence behaviour, and the November 2026 additions: lidocaine pretreatment, IV fluids by type, antibiotic prophylaxis timing/alarms/checklist, technique templates in guided and full modes) and a 19-case browser smoke test.
- **Implementation check of a published model:** propofol uses the published Eleveld 2018 model; tests reproduce its reference-patient parameter values as recorded in independent open-source implementations. The PK coefficients were not compared with the original paper's Table 2 in this session (publisher pages unreachable) — see SOURCES.md.
- **Face validity:** no expert anesthesiologist review has been recorded.
- **Timing cross-check (November 2026):** every timed element was compared with FDA labels and guidelines — [TIMING_EVIDENCE.md](TIMING_EVIDENCE.md) (one conflict fixed: MAC propofol now starts 4 min after midazolam; clinician-review checklist included, no review recorded yet).
- **External validation:** none performed. Simulator outputs have not been compared with observed patient data.
- **November 2026 additions:** antibiotic doses, windows and redosing intervals (Bratzler 2013, S46) and the lidocaine pretreatment dose (propofol label, S11) appear below as components `prophylaxis` and `pretreatment`; fluid label composition (S47, S48) and the fluid UI conventions under `fluids`; template definitions under `template` (no doses — filled by `recommend()`). Antibiotic pharmacology, propofol injection pain and type-specific fluid physiology are not modelled.
- **Palliative and end-of-life modules (November 2026):** `tests/palliative.test.mjs` checks every sourced rule (label starting doses and renal/hepatic/elderly adjustments, breakthrough 10–20%, the +50–100% titration suggestion, conversion ratios and the mandatory clinician-entered cross-tolerance reduction, renal warnings, the bowel-regimen reminder, CDC 2022 scope and the 50 MME/day pause), symptom-model sanity, naloxone increments, the six-item palliative-sedation gate, the proportionality alarm, no automatic escalation or acknowledgement, continued comfort opioids, determinism, all six example cases in guided mode, the banner/ethics text and a text scan for the hard exclusions; the browser smoke test runs both modules end to end. The symptom model is illustrative and not validated.
- **Known model limit (emergency-rescue stress matrix, November 2026; documented only, no dose or physiology change):** with the default GA plan (label-default fentanyl and propofol induction, 1.0 × age-adjusted MAC sevoflurane or propofol TIVA) MAP is already below 65 mmHg before any scripted emergency in 7 of the 12 extreme fictional patients of [EMERGENCY_STRESS.md](EMERGENCY_STRESS.md) (processed-EEG index 31–40) — the illustrative haemodynamic/depth model reads deep and hypotensive at label-default maintenance. The same report lists the other model findings (light-anaesthesia stimulus fully blunted, bronchospasm without desaturation at FiO2 0.5, glycopyrrolate onset).
- **Simulator teaching ceilings (owner decision, November 2026):** cumulative teaching guards for IV epinephrine boluses (0.5 mg), glycopyrrolate (1 mg) and crystalloid (30 mL/kg TBW) where no label or guideline states a cumulative maximum (`engine/teaching-ceilings.js`; component `teaching_ceiling` below; simulator convention, not clinical limits). A dose above one needs the clinician's explicit, logged confirmation; guided and automatic modes never confirm it.
- **Parts that cannot be validated with available sources:** all rows below marked *author estimate — unvalidated* (effect magnitudes, physiology constants, wash-in time constants, fluid-response constants).

## Parameter inventory (615 parameters)
Provenance counts: published_model: 29, author_estimate_unvalidated: 427, fda_label: 37, trial_or_physiology_study: 3, simulator_convention: 83, guideline: 26, clinical_practice_convention_owner: 2, project_config: 8.

| Component | Drug | Parameter | Value | Unit | Provenance | Sources | Note |
|---|---|---|---|---|---|---|---|
| pk | propofol | Eleveld Θ1 V1ref (L) | 6.28 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ2 V2ref (L) | 25.5 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ3 V3ref (L) | 273 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ4 CLref male (L/min) | 1.79 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ5 Q2ref (L/min) | 1.75 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ6 Q3ref (L/min) | 1.11 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ7 residual error | 0.191 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ8 CL maturation E50 (weeks PMA) | 42.3 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ9 CL maturation slope | 9.06 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ10 V2 age (1/yr) | -0.0156 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ11 CL age with opioids (1/yr) | -0.00286 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ12 V1 weight E50 (kg) | 33.6 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ13 V3 age with opioids (1/yr) | -0.0138 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ14 Q3 maturation E50 (weeks) | 68.3 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ15 CLref female (L/min) | 2.1 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ16 Q2 maturation factor | 1.3 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ17 V1 venous factor | 1.42 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld Θ18 Q2 venous factor | 0.68 |  | published_model | S42 | Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md). |
| pk | propofol | Eleveld ke0 arterial (70 kg) | 0.146 | 1/min | published_model | S42 | Table 3 Θ2; scaled × (WGT/70)^−0.25. |
| pk | propofol | Eleveld reference individual | "35 y, 70 kg, 170 cm, male" |  | published_model | S42 | Reference covariates of the published model; also the simulator normalisation reference (no concomitant drugs). |
| pk | propofol | PD normalisation: induction bolus for reference Ce | 2 | mg/kg | author_estimate_unvalidated |  | Ce normalised to the peak Ce of the default induction bolus in the reference individual; the depth index PD is illustrative (not the Eleveld BIS model). |
| pk | propofol | verification: reference-individual reproduction | "V1 6.28 L, V2 25.5 L, V3 273 L, CL 1.79, Q2 1.83, Q3 1.11 L/min, ke0 0.146/min" |  | published_model | S42 | Implementation verification (tests/models.test.mjs) — not validation of the simulator. |
| pk | etomidate | k10 | 0.492238 | 1/min | author_estimate_unvalidated | S23 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | etomidate | k12 | 0 | 1/min | author_estimate_unvalidated | S23 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | etomidate | k21 | 0 | 1/min | author_estimate_unvalidated | S23 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | etomidate | ke0 | 0.451698 | 1/min | author_estimate_unvalidated | S23 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | etomidate | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | etomidate | timing fill peak | 1.5 | min | author_estimate_unvalidated |  | Missing label timing metric filled by assumption. |
| pk | ketamine | k10 | 0.357875 | 1/min | author_estimate_unvalidated | S27 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | ketamine | k12 | 0.851963 | 1/min | author_estimate_unvalidated | S27 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | ketamine | k21 | 0.170393 | 1/min | author_estimate_unvalidated | S27 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | ketamine | ke0 | 0.395823 | 1/min | author_estimate_unvalidated | S27 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | ketamine | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | ketamine | timing fill peak | 1 | min | author_estimate_unvalidated |  | Missing label timing metric filled by assumption. |
| pk | sevoflurane | MAC40 | 1.8 | % | published_model | S26 | Mapleson 1996 age-40 MAC (drug library). |
| pk | sevoflurane | MAC age slope | -0.00269 | log10 per year | published_model | S26 | MAC(age) = MAC40 × 10^(slope × (age − 40)), Mapleson 1996. |
| pk | sevoflurane | wash-in/out tau | 2.5 | min | author_estimate_unvalidated |  | End-tidal toward dial; ordered by solubility. |
| pk | sevoflurane | effect-site ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Effect site lagging end-tidal. |
| pk | desflurane | MAC40 | 6.6 | % | published_model | S26 | Mapleson 1996 age-40 MAC (drug library). |
| pk | desflurane | MAC age slope | -0.00269 | log10 per year | published_model | S26 | MAC(age) = MAC40 × 10^(slope × (age − 40)), Mapleson 1996. |
| pk | desflurane | wash-in/out tau | 1.5 | min | author_estimate_unvalidated |  | End-tidal toward dial; ordered by solubility. |
| pk | desflurane | effect-site ke0 | 0.5 | 1/min | author_estimate_unvalidated |  | Effect site lagging end-tidal. |
| pk | isoflurane | MAC40 | 1.17 | % | published_model | S26 | Mapleson 1996 age-40 MAC (drug library). |
| pk | isoflurane | MAC age slope | -0.00269 | log10 per year | published_model | S26 | MAC(age) = MAC40 × 10^(slope × (age − 40)), Mapleson 1996. |
| pk | isoflurane | wash-in/out tau | 4 | min | author_estimate_unvalidated |  | End-tidal toward dial; ordered by solubility. |
| pk | isoflurane | effect-site ke0 | 0.1875 | 1/min | author_estimate_unvalidated |  | Effect site lagging end-tidal. |
| pk | nitrous_oxide | MAC40 | 104 | % | published_model | S26 | Mapleson 1996 age-40 MAC (drug library). |
| pk | nitrous_oxide | MAC age slope | -0.00269 | log10 per year | published_model | S26 | MAC(age) = MAC40 × 10^(slope × (age − 40)), Mapleson 1996. |
| pk | nitrous_oxide | wash-in/out tau | 2 | min | author_estimate_unvalidated |  | End-tidal toward dial; ordered by solubility. |
| pk | nitrous_oxide | effect-site ke0 | 0.375 | 1/min | author_estimate_unvalidated |  | Effect site lagging end-tidal. |
| pk | dexmedetomidine | k10 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | dexmedetomidine | k12 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | dexmedetomidine | k21 | 0.02 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | dexmedetomidine | ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | dexmedetomidine | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | midazolam | k10 | 0.0147571 | 1/min | author_estimate_unvalidated | S17 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | midazolam | k12 | 0.0434456 | 1/min | author_estimate_unvalidated | S17 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | midazolam | k21 | 0.00868911 | 1/min | author_estimate_unvalidated | S17 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | midazolam | ke0 | 0.110121 | 1/min | author_estimate_unvalidated | S17 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | midazolam | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | midazolam | timing fill peak | 8 | min | author_estimate_unvalidated |  | Missing label timing metric filled by assumption. |
| pk | midazolam | timing fill duration | 45 | min | author_estimate_unvalidated |  | Missing label timing metric filled by assumption. |
| pk | fentanyl | k10 | 0.134338 | 1/min | author_estimate_unvalidated | S13 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | fentanyl | k12 | 0.313454 | 1/min | author_estimate_unvalidated | S13 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | fentanyl | k21 | 0.0626909 | 1/min | author_estimate_unvalidated | S13 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | fentanyl | ke0 | 0.0718886 | 1/min | author_estimate_unvalidated | S13 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | fentanyl | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | fentanyl | timing fill onset | 1.5 | min | author_estimate_unvalidated |  | Missing label timing metric filled by assumption. |
| pk | fentanyl | timing fill peak | 4 | min | author_estimate_unvalidated |  | Missing label timing metric filled by assumption. |
| pk | lidocaine | k10 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | lidocaine | k12 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | lidocaine | k21 | 0.02 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | lidocaine | ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | lidocaine | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | rocuronium | k10 | 0.104004 | 1/min | author_estimate_unvalidated | S12 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | rocuronium | k12 | 0.312013 | 1/min | author_estimate_unvalidated | S12 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | rocuronium | k21 | 0.0624025 | 1/min | author_estimate_unvalidated | S12 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | rocuronium | ke0 | 0.11365 | 1/min | author_estimate_unvalidated | S12 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | rocuronium | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | rocuronium | timing fill onset | 1.5 | min | author_estimate_unvalidated |  | Missing label timing metric filled by assumption. |
| pk | succinylcholine | k10 | 0.416017 | 1/min | author_estimate_unvalidated | S24 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | succinylcholine | k12 | 0 | 1/min | author_estimate_unvalidated | S24 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | succinylcholine | k21 | 0 | 1/min | author_estimate_unvalidated | S24 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | succinylcholine | ke0 | 0.37952 | 1/min | author_estimate_unvalidated | S24 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | succinylcholine | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | sugammadex | k10 | 0.006 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: author-estimate constants. |
| pk | sugammadex | k12 | 0.02 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: author-estimate constants. |
| pk | sugammadex | k21 | 0.02 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: author-estimate constants. |
| pk | sugammadex | ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: author-estimate constants. |
| pk | sugammadex | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | neostigmine | k10 | 0.0228117 | 1/min | author_estimate_unvalidated | S7 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | neostigmine | k12 | 0.0684352 | 1/min | author_estimate_unvalidated | S7 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | neostigmine | k21 | 0.013687 | 1/min | author_estimate_unvalidated | S7 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | neostigmine | ke0 | 0.0464391 | 1/min | author_estimate_unvalidated | S7 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | neostigmine | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | neostigmine | timing fill onset | 4 | min | author_estimate_unvalidated |  | Missing label timing metric filled by assumption. |
| pk | neostigmine | timing fill duration | 60 | min | author_estimate_unvalidated |  | Missing label timing metric filled by assumption. |
| pk | glycopyrrolate | k10 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | glycopyrrolate | k12 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | glycopyrrolate | k21 | 0.02 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | glycopyrrolate | ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | glycopyrrolate | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | dexamethasone | k10 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | dexamethasone | k12 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | dexamethasone | k21 | 0.02 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | dexamethasone | ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | dexamethasone | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | ondansetron | k10 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ondansetron | k12 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ondansetron | k21 | 0.02 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ondansetron | ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ondansetron | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | phenylephrine | k10 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | phenylephrine | k12 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | phenylephrine | k21 | 0.02 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | phenylephrine | ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | phenylephrine | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | ephedrine | k10 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ephedrine | k12 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ephedrine | k21 | 0.02 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ephedrine | ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ephedrine | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | epinephrine | k10 | 0.3 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: author-estimate constants. |
| pk | epinephrine | k12 | 0.05 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: author-estimate constants. |
| pk | epinephrine | k21 | 0.01 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: author-estimate constants. |
| pk | epinephrine | ke0 | 1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: author-estimate constants. |
| pk | epinephrine | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | naloxone | k10 | 0.101026 | 1/min | author_estimate_unvalidated | S14 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | naloxone | k12 | 0.212951 | 1/min | author_estimate_unvalidated | S14 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | naloxone | k21 | 0.0425903 | 1/min | author_estimate_unvalidated | S14 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | naloxone | ke0 | 0.0660889 | 1/min | author_estimate_unvalidated | S14 | Illustrative 2-compartment model: fitted by the engine to label timing (drug.timing). |
| pk | naloxone | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | naloxone | timing fill peak | 5 | min | author_estimate_unvalidated |  | Missing label timing metric filled by assumption. |
| pk | naloxone | timing fill duration | 45 | min | author_estimate_unvalidated |  | Missing label timing metric filled by assumption. |
| pk | ketorolac | k10 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ketorolac | k12 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ketorolac | k21 | 0.02 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ketorolac | ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | ketorolac | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk | acetaminophen | k10 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | acetaminophen | k12 | 0.1 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | acetaminophen | k21 | 0.02 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | acetaminophen | ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Illustrative 2-compartment model: generic illustrative constants. |
| pk | acetaminophen | V1 | 0.25 | L/kg (dosing scalar) | author_estimate_unvalidated |  | Illustrative; cancels in the normalised concentration. |
| pk |  | calibrated peripheral/central volume ratio | 5 |  | author_estimate_unvalidated |  | k21 = k12/5. |
| pk |  | calibrated minimum elimination fraction | 0.25 |  | author_estimate_unvalidated |  | Fit regularisation. |
| pk |  | generic k10 | 0.1 | 1/min | author_estimate_unvalidated |  | Used when drug.timing is entirely missing and no drug-specific estimate exists. |
| pk |  | generic k12 | 0.1 | 1/min | author_estimate_unvalidated |  | Used when drug.timing is entirely missing and no drug-specific estimate exists. |
| pk |  | generic k21 | 0.02 | 1/min | author_estimate_unvalidated |  | Used when drug.timing is entirely missing and no drug-specific estimate exists. |
| pk |  | generic ke0 | 0.3 | 1/min | author_estimate_unvalidated |  | Used when drug.timing is entirely missing and no drug-specific estimate exists. |
| pk |  | absorption ka IM | 0.15 | 1/min | author_estimate_unvalidated |  | First-order IM absorption (epinephrine anaphylaxis dose). |
| pk |  | absorption ka SC | 0.07 | 1/min | author_estimate_unvalidated |  | First-order SC absorption (epinephrine anaphylaxis dose). |
| pk |  | IM/SC absorption perfusion MAP_FRAC_FULL | 0.8 | fraction of baseline MAP | author_estimate_unvalidated |  | Absorption slows when MAP is far below baseline (linear between MAP_FRAC_MIN and MAP_FRAC_FULL). |
| pk |  | IM/SC absorption perfusion MAP_FRAC_MIN | 0.4 | fraction of baseline MAP | author_estimate_unvalidated |  | Absorption slows when MAP is far below baseline (linear between MAP_FRAC_MIN and MAP_FRAC_FULL). |
| pk |  | IM/SC absorption perfusion KA_FACTOR_MIN | 0.1 | multiplier | author_estimate_unvalidated |  | Absorption slows when MAP is far below baseline (linear between MAP_FRAC_MIN and MAP_FRAC_FULL). |
| pk | rocuronium | molecular weight rocuronium bromide | 609.7 | g/mol | fda_label | S12 | Label DESCRIPTION (C32H53BrN2O4, 609.70); verified 2026-11 (WebSearch record of the Pfizer rocuronium label). |
| pk | sugammadex | molecular weight sugammadex sodium | 2178.01 | g/mol | fda_label | S6 | Label DESCRIPTION (2178.01); 1:1 molar binding, instantaneous (illustrative kinetics). |
| pk | sugammadex | sugammadex dose-salt factor | 1.088 | mg sugammadex sodium per mg sugammadex | fda_label | S6 | Label: each mL contains 100 mg sugammadex, equivalent to 108.8 mg sugammadex sodium. |
| pd | propofol | hyp max effect | 1 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | propofol | hyp EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | propofol | hyp gamma | 2.5 |  | author_estimate_unvalidated |  |  |
| pd | propofol | resp max effect | 1 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | propofol | resp EC50 | 0.55 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | propofol | resp gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | propofol | map max effect | -0.32 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | propofol | map EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | propofol | map gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | propofol | hr max effect | -0.06 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | propofol | hr EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | propofol | hr gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | propofol | ana max effect | 0.1 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | propofol | ana EC50 | 0.8 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | propofol | ana gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | etomidate | hyp max effect | 1 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | etomidate | hyp EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | etomidate | hyp gamma | 2.5 |  | author_estimate_unvalidated |  |  |
| pd | etomidate | resp max effect | 0.7 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | etomidate | resp EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | etomidate | resp gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | etomidate | map max effect | -0.05 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | etomidate | map EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | etomidate | map gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | ketamine | hyp max effect | 0.9 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | ketamine | hyp EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | ketamine | hyp gamma | 2.5 |  | author_estimate_unvalidated |  |  |
| pd | ketamine | ana max effect | 0.85 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | ketamine | ana EC50 | 0.12 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | ketamine | ana gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | ketamine | resp max effect | 0.15 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | ketamine | resp EC50 | 0.8 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | ketamine | resp gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | ketamine | map max effect | 0.15 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | ketamine | map EC50 | 0.3 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | ketamine | map gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | ketamine | hr max effect | 0.15 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | ketamine | hr EC50 | 0.3 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | ketamine | hr gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | midazolam | hyp max effect | 0.3 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | midazolam | hyp EC50 | 1 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | midazolam | hyp gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | midazolam | resp max effect | 0.35 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | midazolam | resp EC50 | 0.7 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | midazolam | resp gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | midazolam | map max effect | -0.05 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | midazolam | map EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | midazolam | map gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | hyp max effect | 0.35 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | dexmedetomidine | hyp EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | hyp gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | ana max effect | 0.3 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | dexmedetomidine | ana EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | ana gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | resp max effect | 0.05 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | dexmedetomidine | resp EC50 | 0.8 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | resp gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | map max effect | -0.18 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | dexmedetomidine | map EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | map gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | hr max effect | -0.22 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | dexmedetomidine | hr EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | hr gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | mapCpHigh max effect | 0.25 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | dexmedetomidine | mapCpHigh EC50 | 2.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | dexmedetomidine | mapCpHigh gamma | 3 |  | author_estimate_unvalidated |  |  |
| pd | fentanyl | hyp max effect | 0.2 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | fentanyl | hyp EC50 | 0.8 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | fentanyl | hyp gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | fentanyl | ana max effect | 0.95 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | fentanyl | ana EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | fentanyl | ana gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | fentanyl | resp max effect | 0.9 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | fentanyl | resp EC50 | 0.9 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | fentanyl | resp gamma | 2.5 |  | author_estimate_unvalidated |  |  |
| pd | fentanyl | hr max effect | -0.12 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | fentanyl | hr EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | fentanyl | hr gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | fentanyl | map max effect | -0.06 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | fentanyl | map EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | fentanyl | map gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | lidocaine | hyp max effect | 0.1 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | lidocaine | hyp EC50 | 0.8 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | lidocaine | hyp gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | lidocaine | ana max effect | 0.35 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | lidocaine | ana EC50 | 0.4 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | lidocaine | ana gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | lidocaine | map max effect | -0.03 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | lidocaine | map EC50 | 0.6 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | lidocaine | map gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | sevoflurane | hyp max effect | 0.8 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | sevoflurane | hyp EC50 | 0.45 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | sevoflurane | hyp gamma | 2.5 |  | author_estimate_unvalidated |  |  |
| pd | sevoflurane | ana max effect | 0.6 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | sevoflurane | ana EC50 | 0.9 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | sevoflurane | ana gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | sevoflurane | resp max effect | 0.8 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | sevoflurane | resp EC50 | 0.7 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | sevoflurane | resp gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | sevoflurane | map max effect | -0.22 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | sevoflurane | map EC50 | 0.8 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | sevoflurane | map gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | rocuronium | NMB EC50 | 0.416 | normalised Ce | author_estimate_unvalidated |  | nondepolarizing block |
| pd | rocuronium | NMB gamma | 6 |  | author_estimate_unvalidated |  |  |
| pd | succinylcholine | NMB EC50 | 0.416 | normalised Ce | author_estimate_unvalidated |  | depolarizing block |
| pd | succinylcholine | NMB gamma | 6 |  | author_estimate_unvalidated |  |  |
| pd | glycopyrrolate | hr max effect | 0.22 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | glycopyrrolate | hr EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | glycopyrrolate | hr gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | glycopyrrolate | antimuscarinic max effect | 1 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | glycopyrrolate | antimuscarinic EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | glycopyrrolate | antimuscarinic gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | phenylephrine | map max effect | 0.3 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | phenylephrine | map EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | phenylephrine | map gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | phenylephrine | hr max effect | -0.1 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | phenylephrine | hr EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | phenylephrine | hr gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | ephedrine | map max effect | 0.18 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | ephedrine | map EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | ephedrine | map gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | ephedrine | hr max effect | 0.15 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | ephedrine | hr EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | ephedrine | hr gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | epinephrine | map max effect | 0.3 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | epinephrine | map EC50 | 2 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | epinephrine | map gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | epinephrine | hr max effect | 0.3 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | epinephrine | hr EC50 | 2.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | epinephrine | hr gamma | 1.5 |  | author_estimate_unvalidated |  |  |
| pd | epinephrine | mapHigh max effect | 0.35 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | epinephrine | mapHigh EC50 | 10 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | epinephrine | mapHigh gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | epinephrine | hrHigh max effect | 0.35 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | epinephrine | hrHigh EC50 | 10 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | epinephrine | hrHigh gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | epinephrine | broncho max effect | 1 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | epinephrine | broncho EC50 | 1 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | epinephrine | broncho gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | neostigmine | anticholinesterase max effect | 1 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | neostigmine | anticholinesterase EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | neostigmine | anticholinesterase gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | neostigmine | hr max effect | -0.15 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | neostigmine | hr EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | neostigmine | hr gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | naloxone | opioidAntagonist max effect | 1 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | naloxone | opioidAntagonist EC50 | 0.3 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | naloxone | opioidAntagonist gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | naloxone | hr max effect | 0.05 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | naloxone | hr EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | naloxone | hr gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | naloxone | map max effect | 0.05 | fraction of baseline | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | naloxone | map EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | naloxone | map gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | ketorolac | ana max effect | 0.3 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | ketorolac | ana EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | ketorolac | ana gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd | acetaminophen | ana max effect | 0.25 | fraction | author_estimate_unvalidated |  | Sigmoid Emax on normalised Ce. |
| pd | acetaminophen | ana EC50 | 0.5 | normalised Ce | author_estimate_unvalidated |  |  |
| pd | acetaminophen | ana gamma | 2 |  | author_estimate_unvalidated |  |  |
| pd |  | patient/interaction modifier ELDERLY_SENS | 1.3 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier ASA3_SENS | 1.15 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier DEPLETION_HYPO_AMP | 1.5 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier HYPO_AMP_MAX | 3 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier RESP_SENS_OBESE_OSA | 1.3 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier BETA_BLOCKER_HR_RISE | 0.4 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier FRC_MORBID_OBESE | 0.35 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier FRC_OBESE | 0.5 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier FRC_ELDERLY | 0.85 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier FRC_COPD | 0.8 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier OBSTRUCTION_OSA | 1.6 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier OBSTRUCTION_OBESE | 1.3 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier K10_SEVERE_CKD_ROCURONIUM | 0.6 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier K10_LIVER_LIDO_MIDAZ | 0.6 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier OPIOID_HYPNOTIC_SYNERGY | 0.5 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier NALOXONE_OPIOID_DISPLACEMENT | 10 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier NEOSTIGMINE_EC50_SHIFT_MAX | 0.6 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier KETAMINE_AIRWAY_FRACTION | 0.3 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| pd |  | patient/interaction modifier N2O_HYPNOSIS_FRACTION | 0.5 |  | author_estimate_unvalidated |  | Illustrative sensitivity or interaction modifier. |
| physiology |  | oxyhaemoglobin dissociation (Severinghaus 1979 approximation) | "SO2 = 100/(23400/(PO2³+150·PO2)+1)" |  | trial_or_physiology_study |  | Severinghaus JW, J Appl Physiol 1979, blood O2 dissociation equations (citation not registered in SOURCES; not re-verified). |
| physiology |  | alveolar gas equation constants | "PAO2 = FiO2·713 − PaCO2/0.8" | mmHg | trial_or_physiology_study |  | Standard sea-level alveolar gas equation (textbook relation; no citation registered). |
| physiology |  | O2_CONSUMPTION_MMHG_PER_MIN | 70 |  | author_estimate_unvalidated |  | Illustrative ventilation/oxygenation constant. |
| physiology |  | VENT_EQUIL_PER_MIN | 1.4 |  | author_estimate_unvalidated |  | Illustrative ventilation/oxygenation constant. |
| physiology |  | CO2_APNOEA_RISE_PER_MIN | 4 |  | author_estimate_unvalidated |  | Illustrative ventilation/oxygenation constant. |
| physiology |  | APNOEA_DRIVE_THRESHOLD | 0.8 |  | author_estimate_unvalidated |  | Illustrative ventilation/oxygenation constant. |
| physiology |  | CONTROLLED_RR | 12 |  | author_estimate_unvalidated |  | Illustrative ventilation/oxygenation constant. |
| physiology |  | STIM_ANALGESIA_BLUNT | 0.8 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | STIM_HYPNOSIS_BLUNT | 0.4 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | STIM_MAP_GAIN | 0.4 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | STIM_HR_GAIN | 0.35 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | HYPERCAPNIA_PACO2_MMHG | 60 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | HYPERCAPNIA_MAP_HR_FRAC | 0.1 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | HYPOXAEMIA_SAO2_TACHY | 85 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | HYPOXAEMIA_SAO2_BRADY | 70 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | HYPOXAEMIA_TACHY_FRAC | 0.15 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | HYPOXAEMIA_BRADY_FRAC | 0.3 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | MAP_TAU_SEC | 15 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | HR_TAU_SEC | 10 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | DEPTH_TAU_SEC | 8 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | SPO2_LAG_SEC | 12 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | DEPTH_AWAKE | 97 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | DEPTH_HYPNOSIS_SPAN | 72 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | DEPTH_STIM_GAIN | 18 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | AA_SECURED_ADD_MMHG | 5 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | AA_FIO2_FACTOR | 1.5 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | ETCO2_GAP_MMHG | 4 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | OBSTRUCTION_H_START | 0.55 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | OBSTRUCTION_H_SPAN | 0.3 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | JAW_THRUST_OBSTRUCTION_MULT | 0.2 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | MASK_VENT_EFFECTIVE | 0.85 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | MASK_VENT_LARYNGOSPASM | 0.15 |  | author_estimate_unvalidated |  | Illustrative gain / time constant. |
| physiology |  | blood O2 store capacitance factor | 243 |  | author_estimate_unvalidated |  | Buffers apnoeic PAO2 fall on the steep part of the curve. |
| physiology |  | noise AR(1) coefficient | 0.95 |  | author_estimate_unvalidated |  | Seeded physiological noise. |
| physiology |  | stimulus INCISION | 0.9 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus INCISION_SEC | 120 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus MAINTENANCE | 0.55 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus CLOSING | 0.3 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus CLOSING_SEC | 300 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus LARYNGOSCOPY_SEC | 150 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus LARYNGOSCOPY_DECAY_SEC | 70 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus TUBE_IN_SITU | 0.25 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus EXTUBATION | 0.6 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus EXTUBATION_SEC | 60 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus EXTUBATION_DECAY_SEC | 25 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus SUGAMMADEX_KE0_MULT_MAX | 10 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus SUGAMMADEX_EXCESS_HALF | 1.5 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus SUGAMMADEX_EXCESS_HILL | 4 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus DES_RAPID_RISE_HR | 0.15 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus DES_RAPID_RISE_MAP | 0.1 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | stimulus DES_RAPID_RISE_START_MAC | 0.5 |  | author_estimate_unvalidated |  | Nociceptive stimulus profile / orchestrator constant. |
| physiology |  | FiO2 maximum with N2O | 0.3 | fraction | author_estimate_unvalidated |  | Minimum FiO2 enforced with N2O (O2 + N2O ≤ 1 arithmetic; 0.30 floor is a simulator choice matching the ENIGMA-II 30% O2 arm). |
| fluids |  | ALLOWED_ML | "250, 500" | mL | author_estimate_unvalidated |  | Simulator action sizes (owner-specified UI choice); not a recommendation. |
| fluids |  | DEFAULT_ML | 500 | mL | author_estimate_unvalidated |  | Simulator action sizes (owner-specified UI choice); not a recommendation. |
| fluids |  | DEFAULT_FLUID | "lactated_ringers" |  | simulator_convention |  | Fluid used when a bolus names no type (UI choice; lactated Ringer's). Not a recommendation. |
| fluids |  | MAINTENANCE_DEFAULT_ML_H | 100 | mL/h | simulator_convention |  | Pre-filled maintenance-infusion rate in the plan editor and Run screen (editable). The FDA labels give no fixed dose; this is a UI choice, not a recommendation. |
| fluids |  | MAINTENANCE_MAX_ML_H | 1000 | mL/h | simulator_convention |  | Input limit for the maintenance-infusion rate field (UI validation only). |
| fluids |  | RUN_ML_PER_MIN | 50 | min | author_estimate_unvalidated |  | Illustrative volume-restoration model. |
| fluids |  | RETENTION_TAU_MIN | 40 | min | author_estimate_unvalidated |  | Illustrative volume-restoration model. |
| fluids |  | RESTORE_SCALE_ML | 750 | mL | author_estimate_unvalidated |  | Illustrative volume-restoration model. |
| fluids |  | EVENT_COUNTER_MAX | 0.8 |  | author_estimate_unvalidated |  | Illustrative volume-restoration model. |
| fluids |  | DIRECT_MAP_FRAC euvolaemic | 0.04 | fraction of baseline MAP | author_estimate_unvalidated |  | Cap of direct MAP effect. |
| fluids |  | DIRECT_MAP_FRAC depleted | 0.1 | fraction of baseline MAP | author_estimate_unvalidated |  | Cap of direct MAP effect (hypovolemia/sepsis). |
| fluids |  | DEPLETED_CONDITIONS | "hypovolemia, sepsis" |  | author_estimate_unvalidated |  | Conditions treated as volume depleted. |
| fluids |  | SEPSIS_CONTEXT_ML_PER_KG | 30 | mL/kg | guideline | S43 | Surviving Sepsis Campaign 2021 statement shown as context text only; not used in the effect model. |
| fluids |  | lactated_ringers composition sodiumMmol | 130 | mmol/L | fda_label | S47 | Lactated Ringer's label composition (per litre (approx.)); shown in the fluids panel. Not used by the volume model (no type-specific physiology). |
| fluids |  | lactated_ringers composition potassiumMmol | 4 | mmol/L | fda_label | S47 | Lactated Ringer's label composition (per litre (approx.)); shown in the fluids panel. Not used by the volume model (no type-specific physiology). |
| fluids |  | lactated_ringers composition calciumMmol | 1.4 | mmol/L | fda_label | S47 | Lactated Ringer's label composition (per litre (approx.)); shown in the fluids panel. Not used by the volume model (no type-specific physiology). |
| fluids |  | lactated_ringers composition calciumMeq | 2.7 | mEq/L | fda_label | S47 | Lactated Ringer's label composition (per litre (approx.)); shown in the fluids panel. Not used by the volume model (no type-specific physiology). |
| fluids |  | lactated_ringers composition chlorideMmol | 109 | mmol/L | fda_label | S47 | Lactated Ringer's label composition (per litre (approx.)); shown in the fluids panel. Not used by the volume model (no type-specific physiology). |
| fluids |  | lactated_ringers composition lactateMmol | 28 | mmol/L | fda_label | S47 | Lactated Ringer's label composition (per litre (approx.)); shown in the fluids panel. Not used by the volume model (no type-specific physiology). |
| fluids |  | lactated_ringers composition osmolarityMosmolL | 272 | mOsmol/L | fda_label | S47 | Lactated Ringer's label composition (per litre (approx.)); shown in the fluids panel. Not used by the volume model (no type-specific physiology). |
| fluids |  | lactated_ringers composition pH | 6.5 |  | fda_label | S47 | Lactated Ringer's label composition (per litre (approx.)); shown in the fluids panel. Not used by the volume model (no type-specific physiology). |
| fluids |  | sodium_chloride_0_9 composition sodiumMeq | 154 | mEq/L | fda_label | S48 | 0.9% sodium chloride label composition (per litre); shown in the fluids panel. Not used by the volume model (no type-specific physiology). |
| fluids |  | sodium_chloride_0_9 composition chlorideMeq | 154 | mEq/L | fda_label | S48 | 0.9% sodium chloride label composition (per litre); shown in the fluids panel. Not used by the volume model (no type-specific physiology). |
| fluids |  | sodium_chloride_0_9 composition osmolarityMosmolL | 308 | mOsmol/L | fda_label | S48 | 0.9% sodium chloride label composition (per litre); shown in the fluids panel. Not used by the volume model (no type-specific physiology). |
| prophylaxis | cefazolin | cefazolin dose | 2000 | mg | guideline | S46 | Bratzler 2013 adult prophylaxis dose (fixed). |
| prophylaxis | cefazolin | cefazolin dose (weight>=120) | 3000 | mg | guideline | S46 | Bratzler 2013: 3 g for patients weighing ≥ 120 kg. |
| prophylaxis | cefazolin | cefazolin start window before incision | 60 | min | guideline | S46 | Dose must be STARTED within this time before incision (window alarm). |
| prophylaxis | cefazolin | cefazolin redosing interval | 240 | min | guideline | S46 | Measured from the start of the last dose; "redose due" alarm during surgery. |
| prophylaxis | clindamycin | clindamycin dose | 900 | mg | guideline | S46 | Bratzler 2013 adult prophylaxis dose (fixed). |
| prophylaxis | clindamycin | clindamycin start window before incision | 60 | min | guideline | S46 | Dose must be STARTED within this time before incision (window alarm). |
| prophylaxis | clindamycin | clindamycin redosing interval | 360 | min | guideline | S46 | Measured from the start of the last dose; "redose due" alarm during surgery. |
| prophylaxis | vancomycin | vancomycin dose | 15 | mg/kg | guideline | S46 | Bratzler 2013 adult prophylaxis dose (TBW; weight basis = simulator convention). |
| prophylaxis | vancomycin | vancomycin start window before incision | 120 | min | guideline | S46 | Dose must be STARTED within this time before incision (window alarm). |
| prophylaxis | vancomycin | vancomycin redosing interval | "not applicable" |  | guideline | S46 | Measured from the start of the last dose; "redose due" alarm during surgery. |
| prophylaxis |  | WINDOW_ALARM_PRIORITY | "medium" | alarm priority | simulator_convention |  | Alarm "Surgery started without antibiotic prophylaxis in the recommended window" (owner-approved additions spec). Latched until acknowledged. |
| prophylaxis |  | REDOSE_ALARM_PRIORITY | "medium" | alarm priority | simulator_convention |  | Alarm "Prophylaxis redose due" once the guideline redosing interval has elapsed since the start of the last dose, while surgery is in progress. |
| prophylaxis |  | CHECKLIST_REQUIRES_ACK | true | boolean | simulator_convention |  | Manual mode: an antibiotic checklist warning before "Start surgery" can be acknowledged (the window alarm still sounds at incision). Guided and automatic modes (2026-11 timing review): a dose started within the window is a REQUIRED pre-incision item — acknowledgement does not satisfy it; the clinician gives prophylaxis (guided: the gate waits; full demonstration: it pauses). Neither mode ever acknowledges or gives it on its own. |
| prophylaxis |  | INDICATED_DEFAULT_GA | true | boolean | simulator_convention |  | Plan screen: "Surgical antibiotic prophylaxis indicated" is ticked by default for GA plans and unticked for MAC plans (the simulator does not know the procedure). In the engine a plan without the flag counts as indicated only if it contains an antibiotic step. |
| pretreatment | lidocaine | lidocaine pretreatment dose (before propofol) | 10 | mg | fda_label | S11 | Propofol label: prior IV lidocaine 1 mL of a 1% solution (= 10 mg). Counts toward cumulative lidocaine. |
| pretreatment | lidocaine | lidocaine pretreatment / IV lidocaine overlap window | 14400 | s | guideline | S1 | Foo 2021 ~4 h separation between local-anaesthetic interventions and IV lidocaine, applied to pretreatment (simulator mapping). |
| pretreatment |  | overlap alarm priority | "low" | alarm priority | simulator_convention |  | LOW alarm + log warning when pretreatment and IV lidocaine analgesic dosing overlap. |
| template |  | ga_opioid steps | 12 | steps | simulator_convention |  | Template "GA — opioid-based (balanced)": drug/regimen/phase/offset choices only — every dose is filled at runtime by recommend() from the drug library. Each step's timing rationale (source or convention) is listed under component template_timing. |
| template |  | ga_opioid_free steps | 17 | steps | simulator_convention |  | Template "GA — opioid-free": drug/regimen/phase/offset choices only — every dose is filled at runtime by recommend() from the drug library. Each step's timing rationale (source or convention) is listed under component template_timing. |
| template |  | mac_dex steps | 6 | steps | simulator_convention |  | Template "MAC — dexmedetomidine": drug/regimen/phase/offset choices only — every dose is filled at runtime by recommend() from the drug library. Each step's timing rationale (source or convention) is listed under component template_timing. |
| template |  | mac_propofol steps | 3 | steps | simulator_convention |  | Template "MAC — propofol (existing technique)": drug/regimen/phase/offset choices only — every dose is filled at runtime by recommend() from the drug library. Each step's timing rationale (source or convention) is listed under component template_timing. |
| timing |  | PREMED_TO_TRANSFER_SEC | 300 | s | clinical_practice_convention_owner | S17 | Premedication midazolam is given in pre-op holding (some centres use the PACU as holding) about 5 min before the patient is rolled to the OR. Counted from the END of the last premedication bolus (midazolam is injected over at least 2 min, label). Label support for waiting at least this long: sedation is achieved within 3 to 5 minutes after IV injection [S17]. |
| timing |  | OR_SETUP_SEC | 120 | s | simulator_convention |  | Transfer to the OR, monitors applied (ECG, NIBP, SpO2) before preoxygenation. No source gives a duration; teaching value. |
| timing |  | PREOXYGENATION_SEC | 180 | s | simulator_convention |  | Preoxygenation (FiO2 1.0 by face mask) before induction. The 3-min tidal-breathing technique is widely described, but no guideline giving this duration was verified, so the value is a simulator convention. Guidelines set an end point, not a time: DAS 2015 — preoxygenate all patients with 100% oxygen until the end-tidal oxygen fraction is 0.87–0.9 (S55); ASA 2022 — supplemental oxygen before initiating difficult-airway management (S56). End-tidal O2 is not modelled (see PREOXYGENATION_END_POINT; timing cross-check 2026-11, TIMING_EVIDENCE.md). |
| timing |  | PREOXYGENATION_END_POINT | "end-tidal O2 fraction 0.87–0.9 (not modelled)" | fraction | guideline | S55, S56 | Guideline end point for preoxygenation, recorded for teaching and shown in the Timing evidence page: DAS 2015 — all patients preoxygenated with 100% oxygen, face-mask seal maintained, until the end-tidal oxygen fraction is 0.87–0.9 [S55]; ASA 2022 difficult-airway guideline — supplemental oxygen before initiating difficult-airway management [S56]. The simulator does not model end-tidal O2, so the guided/automatic gate uses the PREOXYGENATION_SEC time convention instead; nothing in the engine reads this value. |
| timing |  | OPIOID_LEAD_SEC | 180 | s | simulator_convention |  | Opioid given about 3 min before the hypnotic so it approaches peak effect before laryngoscopy. Fentanyl label: onset almost immediate IV, but the maximal analgesic and respiratory depressant effect may not be noted for several minutes [S13]; the label gives no number, so 3 min is a simulator convention anchored to that statement. |
| timing |  | PRETREATMENT_MAX_GAP_SEC | 60 | s | simulator_convention |  | Lidocaine pretreatment must be given before propofol and "immediately" before it (propofol label: prior injection of IV lidocaine reduces injection pain [S11]); the 60-s maximum gap and the 10-s template gap are simulator conventions. |
| timing |  | NMB_AFTER_HYPNOTIC | "hypnotic label onset" | s | fda_label | S11 | The intubating neuromuscular blocker is given only after loss of consciousness: no earlier than the hypnotic's label onset after the hypnotic (propofol: hypnosis usually within 40 s from the start of injection [S11]; read from the drug library `timing.onsetMin`). |
| timing |  | LOADING_THEN_MAINTENANCE | "loading start + loading duration" | s | fda_label | S9, S11, S1 | A maintenance infusion starts when its loading dose ends (dexmedetomidine: loading over 10 min, followed by the maintenance infusion [S9]; propofol MAC sedation: initiation over 3–5 min, then maintenance [S11]; IV lidocaine: loading over about 10 min, then infusion [S1]). Overlap of the two is flagged. |
| timing |  | MAC_SEDATIVE_AFTER_MIDAZOLAM_SEC | 240 | s | fda_label | S17, S32 | MAC templates/example plan: a second sedative (propofol initiation) starts no earlier than 4 min after the midazolam bolus starts — midazolam label: give over at least 2 minutes, then wait an additional 2 or more minutes to fully evaluate the sedative effect [S17]; ASA 2018 moderate-sedation guideline: titrate in small increments and allow sufficient time between doses to assess the effect of each [S32]. Timing cross-check 2026-11: mac_propofol and the MAC example plan started propofol at +2:00 (end of the midazolam injection, before its effect could be evaluated) — moved to +4:00. Template offset (data/templates.js); a test keeps them equal. |
| timing |  | MIDAZOLAM_REPEAT_MIN_SEC | 240 | s | fda_label | S17 | No repeat midazolam bolus within 4 min of the previous one: label — give over at least 2 minutes, then wait an additional 2 or more minutes to evaluate the effect [S17]. |
| timing |  | PHENYLEPHRINE_REPEAT_MIN_SEC | 60 | s | fda_label | S18 | No repeat phenylephrine IV bolus within 60 s of the previous one: label — additional boluses may be administered every 1–2 minutes as needed [S18]; the lower bound is used. Same label statement and value as the advisory repeat interval (engine/rescue-config.js RESCUE_CONFIG.PHENYLEPHRINE_REPEAT_MIN_SEC; a test keeps them equal). |
| timing |  | GLYCOPYRROLATE_RESCUE_REPEAT_MIN_SEC | 120 | s | fda_label | S8 | No repeat glycopyrrolate IV bolus within 120 s of the previous one outside emergence: label — intraoperative 0.1 mg IV, repeated as needed at 2–3 minute intervals [S8]; the lower bound is used. Not applied in emergence, where glycopyrrolate is given with neostigmine (0.2 mg per 1 mg, same label). |
| timing |  | EPINEPHRINE_IM_REPEAT_MIN_SEC | 300 | s | fda_label | S40 | No repeat intramuscular/subcutaneous epinephrine injection within 5 min of the previous IM/SC injection: label — anaphylaxis 0.3–0.5 mg IM or SC, repeated every 5 to 10 minutes as necessary [S40]; the lower bound is used. IV boluses (guideline titration, "titrated to effect" [S44, S45]) have no stated interval and are not gated. |
| timing |  | ROCURONIUM_TOPUP_TOF_COUNT_MIN | 3 | TOF count | fda_label | S12 | A rocuronium top-up (any rocuronium bolus after the first) waits until TOF count ≥ 3: label maintenance doses are administered at 25% recovery of control T1, defined as 3 twitches of train-of-four [S12]. A planned top-up is held (status "waiting") until then; a manual one is logged with a warning. |
| timing |  | DEX_STOP_BEFORE_END_SEC | 900 | s | simulator_convention |  | Opioid-free template: the dexmedetomidine infusion stops 15 min before the planned end of surgery so its sedative effect is waning at emergence. No label, guideline or verified trial statement gives this interval (published opioid-free protocols vary and were not confirmed in their primary sources), so it is a simulator convention. |
| timing |  | GA_DEPTH_BAND | "40–60" | processed-EEG depth index (BIS-style, simulated) | trial_or_physiology_study | S52, S53 | General-anaesthesia target band 40–60, the protocol target used in the B-Unaware [S52] and BAG-RECALL [S53] trials (neither showed the BIS protocol superior for preventing awareness). Applied to the simulated index, which is an illustrative model output, not a BIS value. Used for the pre-incision item (an index below 40 needs the clinician's acknowledgement; above 60 blocks), the tile/trend-chart band, the live timing check (time outside the band during surgery) and, for the upper bound only, the depth-high (awareness-risk) alarm (DEPTH_HIGH_ALARM_*). No alarm below the band: in this illustrative model 1 MAC of a volatile agent often reads just below 40; for the lower bound only a text-only advisory is shown during surgery (DEPTH_LOW_ADVISORY_*). No sedation bands are used (none verified). |
| timing |  | DEPTH_HIGH_ALARM_SUSTAIN_SEC | 60 | s | simulator_convention |  | HIGH alarm "Processed-EEG index > 60 for ≥ 60 s during general anaesthesia — risk of awareness; check hypnotic delivery" when the simulated index stays above the GA band upper bound (GA_DEPTH_BAND, reused, not redefined) for this long. Armed only in GA with the airway secured after loss of consciousness (index ≤ 60 reached after induction started), in the induction and maintenance phases (surgery and closing included), and not after every maintenance hypnotic is stopped once surgery has ended; never in MAC/sedation or emergence. Any sample at or below 60 restarts the count. The duration is a teaching choice (no source gives one); guided and automatic modes pause for it under the existing HIGH-alarm rule and never acknowledge it. |
| timing |  | DEPTH_HIGH_ALARM_CLEAR | 58 | processed-EEG depth index (BIS-style, simulated) | simulator_convention |  | Hysteresis of the depth-high alarm: once raised it stays active until the index is at or below this value (2 index units under the band upper bound, the same 2-unit hysteresis as the other simulator level alarms), then stays listed (latched) until acknowledged. Simulator convention. |
| timing |  | DEPTH_HIGH_ALARM_PRIORITY | "high" | alarm priority | simulator_convention |  | Priority of the depth-high alarm (owner-approved, final-check fixes 2026-11): HIGH, so guided and automatic modes pause for it (AUTORUN_CONFIG.PAUSE_ALARM_PRIORITIES); only the clinician acknowledges it. Simulator convention. |
| timing |  | DEPTH_LOW_ADVISORY_SUSTAIN_SEC | 300 | s | simulator_convention |  | Text-only "lighten anaesthetic" advisory (engine/depth-advisory.js) when the simulated index stays below the GA band lower bound (GA_DEPTH_BAND, reused, not redefined) for this long. Armed only in GA with the airway secured after loss of consciousness, in the maintenance phase after incision (before incision the pre-incision item — acknowledge an index below the band — applies instead), and not after every maintenance hypnotic is stopped once surgery has ended; never in MAC/sedation, before loss of consciousness or in emergence. Any sample at or above the lower bound restarts the count. NOT an alarm: no sound/priority, guided and automatic modes never pause for it, it never acknowledges anything and never changes a dose, rate or concentration. Owner-approved instead of recalibrating the illustrative depth model (which reads ~34–39 at label-default maintenance doses). The duration is a teaching choice (no source gives one): 300 s (owner decision, 05l; was 120 s in 05k) to limit alert fatigue — at 120 s the card appeared in nearly every GA case because the illustrative model reads deep at label-default doses; 300 s still flags sustained deep readings. |
| timing |  | DEPTH_LOW_ADVISORY_CLEAR | 42 | processed-EEG depth index (BIS-style, simulated) | simulator_convention |  | Hysteresis of the depth-low advisory: once shown it stays until the index is at or above this value (2 index units over the band lower bound, the same 2-unit hysteresis as the depth-high alarm and the other level alarms) or the advisory is disarmed (emergence, agents off after surgery). Simulator convention. |
| timing |  | NMB_SURGERY_TOF_COUNT_MAX | 2 | TOF count | simulator_convention |  | Pre-incision item when the plan includes a neuromuscular blocker: TOF count ≤ 2. No label gives a surgical-relaxation TOF target; teaching value. |
| timing |  | TIME_OUT_REQUIRED | true | boolean | guideline | S54 | WHO Surgical Safety Checklist "Time Out" before skin incision (team confirms patient, site and procedure; antibiotic prophylaxis within the last 60 minutes) [S54]. Only the clinician can confirm it; guided and automatic modes never confirm it. |
| timing |  | ANTIBIOTIC_REQUIRED_BEFORE_INCISION | true | boolean | guideline | S46 | When prophylaxis is indicated, a dose started within its guideline window before incision (Bratzler 2013: within 60 min; vancomycin 120 min [S46]) is a REQUIRED pre-incision item in guided and automatic modes (acknowledging the warning no longer suffices there; manual mode keeps the alarm). |
| template_timing |  | ga_opioid: lactated_ringers fluid | 0 | s | simulator_convention | S47 | premed +0:00 — Maintenance crystalloid started in pre-op holding and continued across phases until changed (rate and start are simulator conventions; the labels give no fixed dose). |
| template_timing |  | ga_opioid: antibiotic prophylaxis antibiotic | 0 | s | guideline | S46 | premed +0:00 — Started in pre-op holding so the dose begins within 60 min before incision (Bratzler); the pre-incision gate re-checks the window [S46]. |
| template_timing |  | ga_opioid: midazolam bolus (optional) | 0 | s | clinical_practice_convention_owner | S17 | premed +0:00 — Given in pre-op holding about 5 min before transfer to the OR (owner-stated practice); label: sedation within 3 to 5 min after IV injection [S17]. It never overlaps induction: the induction gate opens only after transfer + OR setup + preoxygenation. |
| template_timing |  | ga_opioid: fentanyl bolus | 0 | s | simulator_convention | S13 | induction +0:00 — Opioid given ~3 min before the hypnotic so it approaches peak effect before laryngoscopy (convention). Label: onset almost immediate IV, maximal effect may not be noted for several minutes [S13]. |
| template_timing |  | ga_opioid: dexamethasone bolus | 0 | s | guideline | S2, S3 | induction +0:00 — Given at induction for PONV prophylaxis (consensus) [S2, S3]. |
| template_timing |  | ga_opioid: lidocaine bolus (optional) | 170 | s | fda_label | S11 | induction +2:50 — Immediately before propofol (label: prior IV lidocaine reduces injection pain) [S11]; the 10-s gap is a convention. |
| template_timing |  | ga_opioid: propofol bolus | 180 | s | simulator_convention | S11 | induction +3:00 — Hypnotic 3 min after the opioid (convention, see fentanyl); label: hypnosis usually within 40 s from the start of injection [S11]. |
| template_timing |  | ga_opioid: rocuronium bolus | 240 | s | fda_label | S11 | induction +4:00 — After loss of consciousness: 60 s after the hypnotic, beyond its label onset (hypnosis usually within 40 s) [S11]; the 60-s spacing is a convention. |
| template_timing |  | ga_opioid: sevoflurane inhaled | 0 | s | simulator_convention |  | maintenance +0:00 — Started when maintenance begins, after the airway is secured (convention). |
| template_timing |  | ga_opioid: sevoflurane stop | 0 | s | simulator_convention |  | emergence +0:00 — Agent off at the start of emergence, after End surgery and closing (convention). |
| template_timing |  | ga_opioid: ondansetron bolus | 0 | s | guideline | S2, S3 | emergence +0:00 — At the end of surgery for PONV prophylaxis (consensus) [S2, S3]. |
| template_timing |  | ga_opioid: sugammadex bolus | 30 | s | fda_label | S6 | emergence +0:30 — After the anaesthetic agents are off; the dose is compared with the TOF depth of block when given (label tiers) [S6]. The 30-s offset is a convention. |
| template_timing |  | ga_opioid_free: lactated_ringers fluid | 0 | s | simulator_convention | S47 | premed +0:00 — Maintenance crystalloid started in pre-op holding and continued across phases until changed (rate and start are simulator conventions; the labels give no fixed dose). |
| template_timing |  | ga_opioid_free: antibiotic prophylaxis antibiotic | 0 | s | guideline | S46 | premed +0:00 — Started in pre-op holding so the dose begins within 60 min before incision (Bratzler); the pre-incision gate re-checks the window [S46]. |
| template_timing |  | ga_opioid_free: dexmedetomidine infusion | 0 | s | simulator_convention | S9 | induction +0:00 — Adjunct infusion started at induction, without a loading dose (this off-label regimen has none) (convention). |
| template_timing |  | ga_opioid_free: ketamine infusion | 0 | s | simulator_convention | S10 | induction +0:00 — Subanaesthetic analgesic infusion started at induction (consensus gives the dose, not the start time; start = convention) [S10]. |
| template_timing |  | ga_opioid_free: lidocaine bolus | 0 | s | guideline | S1 | induction +0:00 — Foo 2021 loading dose over about 10 min, started at induction; the infusion starts when this loading dose ends [S1]. |
| template_timing |  | ga_opioid_free: dexamethasone bolus | 0 | s | guideline | S2, S3 | induction +0:00 — Given at induction for PONV prophylaxis (consensus) [S2, S3]. |
| template_timing |  | ga_opioid_free: lidocaine bolus (optional) | 50 | s | fda_label | S11 | induction +0:50 — Immediately before propofol (label: prior IV lidocaine reduces injection pain) [S11]; the 10-s gap is a convention. |
| template_timing |  | ga_opioid_free: propofol bolus | 60 | s | simulator_convention | S11 | induction +1:00 — Hypnotic 1 min after the adjunct infusions start (no opioid to wait for; convention); label: hypnosis usually within 40 s [S11]. |
| template_timing |  | ga_opioid_free: rocuronium bolus | 120 | s | fda_label | S11 | induction +2:00 — After loss of consciousness: 60 s after the hypnotic, beyond its label onset (hypnosis usually within 40 s) [S11]; the 60-s spacing is a convention. |
| template_timing |  | ga_opioid_free: sevoflurane inhaled | 0 | s | simulator_convention |  | maintenance +0:00 — Started when maintenance begins, after the airway is secured (convention). |
| template_timing |  | ga_opioid_free: lidocaine infusion | 0 | s | guideline | S1 | maintenance +0:00 (after the loading dose ends) — Infusion starts when the lidocaine loading dose (about 10 min) has finished — never overlapping it [S1]. |
| template_timing |  | ga_opioid_free: dexmedetomidine stop | -900 | s | simulator_convention |  | end of surgery − 15:00 — Stopped 15 min before the planned end of surgery so its sedative effect is waning at emergence. No label, guideline or verified trial statement gives this interval: simulator convention. |
| template_timing |  | ga_opioid_free: sevoflurane stop | 0 | s | simulator_convention |  | emergence +0:00 — Agent off at the start of emergence, after End surgery and closing (convention). |
| template_timing |  | ga_opioid_free: ketamine stop | 0 | s | simulator_convention | S10 | emergence +0:00 — Stopped with the anaesthetic agents at emergence; the consensus gives no intraoperative stop time (convention) [S10]. |
| template_timing |  | ga_opioid_free: lidocaine stop | 0 | s | simulator_convention | S1 | emergence +0:00 — Stopped at emergence because the simulation ends there. Foo 2021 allows the infusion for up to 24 h with review [S1]; stopping it here is a convention, not a guideline requirement. |
| template_timing |  | ga_opioid_free: ondansetron bolus | 0 | s | guideline | S2, S3 | emergence +0:00 — At the end of surgery for PONV prophylaxis (consensus) [S2, S3]. |
| template_timing |  | ga_opioid_free: sugammadex bolus | 30 | s | fda_label | S6 | emergence +0:30 — After the anaesthetic agents are off; the dose is compared with the TOF depth of block when given (label tiers) [S6]. The 30-s offset is a convention. |
| template_timing |  | mac_dex: lactated_ringers fluid | 0 | s | simulator_convention | S47 | sedation +0:00 — Maintenance crystalloid started in pre-op holding and continued across phases until changed (rate and start are simulator conventions; the labels give no fixed dose). |
| template_timing |  | mac_dex: dexmedetomidine infusion | 0 | s | fda_label | S9 | sedation +0:00 — Loading infusion over 10 min, then maintenance (label) [S9]: the maintenance infusion starts at +10:00, when the loading dose ends. |
| template_timing |  | mac_dex: midazolam bolus (optional) | 0 | s | fda_label | S17, S9 | sedation +0:00 — Optional supplementation at the start of sedation; label: give over at least 2 min and wait at least 2 more min before more [S17]. In the dexmedetomidine label studies rescue midazolam was permitted to reach the target [S9]. |
| template_timing |  | mac_dex: propofol infusion (optional) | 600 | s | simulator_convention | S9, S11 | sedation +10:00 — Only after the dexmedetomidine loading dose ends (+10:00); propofol initiation over 3–5 min, then its maintenance [S11]. Start time = convention. |
| template_timing |  | mac_dex: dexmedetomidine stop | 0 | s | simulator_convention |  | emergence +0:00 — Stopped when the procedure ends (recovery) (convention). |
| template_timing |  | mac_dex: propofol stop | 0 | s | simulator_convention |  | emergence +0:00 — Stopped when the procedure ends (recovery) (convention). |
| template_timing |  | mac_propofol: midazolam bolus (optional) | 0 | s | fda_label | S17 | sedation +0:00 — First, given over at least 2 min (label) [S17]. |
| template_timing |  | mac_propofol: propofol infusion | 240 | s | fda_label | S17, S32, S11 | sedation +4:00 — Started 4 min after the midazolam starts: midazolam is given over at least 2 min and its effect is evaluated over at least 2 more min before more sedative is added (midazolam label [S17]; ASA 2018 moderate-sedation guideline: allow sufficient time between doses to assess the effect of each [S32]). Then propofol initiation (slow injection 0.5 mg/kg over 3–5 min) and the maintenance infusion when the initiation ends (label) [S11]. Timing cross-check 2026-11: was +2:00 (before the midazolam effect could be evaluated). |
| template_timing |  | mac_propofol: propofol stop | 0 | s | simulator_convention |  | emergence +0:00 — Stopped when the procedure ends (recovery) (convention). |
| scenario |  | hemorrhage.rampSec | 600 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | hemorrhage.resolveSec | 0 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | hemorrhage.mapFrac | -0.35 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | hemorrhage.hrFrac | 0.35 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | vagal_bradycardia.rampSec | 10 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | vagal_bradycardia.holdSec | 90 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | vagal_bradycardia.resolveSec | 30 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | vagal_bradycardia.hrMult | 0.5 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | vagal_bradycardia.mapFrac | -0.15 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | vagal_bradycardia.counteredBy.glycopyrrolate | 0.9 |  | author_estimate_unvalidated |  | Illustrative countering/resolution constant. |
| scenario |  | bronchospasm.rampSec | 30 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | bronchospasm.holdSec | 300 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | bronchospasm.resolveSec | 120 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | bronchospasm.ventFactor | 0.35 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | bronchospasm.aaAdd | 60 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | bronchospasm.etco2GapAdd | 10 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | bronchospasm.counteredBy._hypnosis | 0.4 |  | author_estimate_unvalidated |  | Illustrative countering/resolution constant. |
| scenario |  | bronchospasm.counteredBy._bronchodilation | 0.8 |  | author_estimate_unvalidated |  | Illustrative countering/resolution constant. |
| scenario |  | laryngospasm_on_extubation.rampSec | 2 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | laryngospasm_on_extubation.holdSec | 120 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | laryngospasm_on_extubation.resolveSec | 10 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | laryngospasm_on_extubation.resolvedBy.maskVentilationSec | 45 |  | author_estimate_unvalidated |  | Illustrative countering/resolution constant. |
| scenario |  | light_anesthesia_stimulus.rampSec | 10 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | light_anesthesia_stimulus.holdSec | 120 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | light_anesthesia_stimulus.resolveSec | 60 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | light_anesthesia_stimulus.stimulus | 0.9 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | hr_sensor_fault.rampSec | 0 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | hr_sensor_fault.holdSec | 60 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | hr_sensor_fault.resolveSec | 0 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | map_sensor_fault.rampSec | 0 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | map_sensor_fault.holdSec | 60 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | map_sensor_fault.resolveSec | 0 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | spo2_probe_off.rampSec | 0 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | spo2_probe_off.holdSec | 60 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | spo2_probe_off.resolveSec | 0 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | anaphylaxis_hypotension.rampSec | 120 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | anaphylaxis_hypotension.holdSec | 900 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | anaphylaxis_hypotension.resolveSec | 300 | s | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | anaphylaxis_hypotension.mapFrac | -0.5 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | anaphylaxis_hypotension.hrFrac | 0.4 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | anaphylaxis_hypotension.ventFactor | 0.6 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | anaphylaxis_hypotension.aaAdd | 40 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | anaphylaxis_hypotension.etco2GapAdd | 6 |  | author_estimate_unvalidated |  | Illustrative perturbation magnitude/timing. |
| scenario |  | anaphylaxis_hypotension.counteredBy._bronchodilation | 0.7 |  | author_estimate_unvalidated |  | Illustrative countering/resolution constant. |
| interlock |  | hr_critical_low | 48 | /min | project_config | S35 | config.yaml; strict "<" (Python controller parity). |
| interlock |  | map_critical_low | 60 | mmHg | project_config | S35 | config.yaml; strict "<". |
| interlock |  | simulation_rate_ceiling Dexmedetomidine | 0.5 | mcg/kg/h | project_config | S35 | Python simulation ceiling (applies while interlocks are on); software value, not clinical evidence. |
| interlock |  | simulation_rate_ceiling Ketamine | 0.2 | mg/kg/h | project_config | S35 | Python simulation ceiling (applies while interlocks are on); software value, not clinical evidence. |
| interlock |  | simulation_rate_ceiling Lidocaine | 1.5 | mg/kg/h | project_config | S35 | Python simulation ceiling (applies while interlocks are on); software value, not clinical evidence. |
| interlock |  | ketorolac egfr_minimum | 30 | mL/min/1.73m² | project_config | S35 | Lockout below this eGFR. |
| alarm |  | SPO2_LOW | 90 | % | author_estimate_unvalidated |  | Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard. |
| alarm |  | SPO2_LOW_CLEAR | 92 | % | author_estimate_unvalidated |  | Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard. |
| alarm |  | APNOEA_SEC | 30 | s | author_estimate_unvalidated |  | Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard. |
| alarm |  | MAP_LOW | 65 | mmHg | author_estimate_unvalidated |  | Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard. |
| alarm |  | MAP_LOW_CLEAR | 67 | mmHg | author_estimate_unvalidated |  | Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard. |
| alarm |  | MAP_HIGH | 120 | mmHg | author_estimate_unvalidated |  | Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard. |
| alarm |  | MAP_HIGH_CLEAR | 118 | mmHg | author_estimate_unvalidated |  | Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard. |
| alarm |  | HR_HIGH | 120 | /min | author_estimate_unvalidated |  | Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard. |
| alarm |  | HR_HIGH_CLEAR | 118 | /min | author_estimate_unvalidated |  | Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard. |
| alarm |  | MAP_CRITICAL_CLEAR | 62 | mmHg | author_estimate_unvalidated |  | Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard. |
| alarm |  | HR_CRITICAL_CLEAR | 50 | /min | author_estimate_unvalidated |  | Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard. |
| alarm |  | TOFR_EXTUBATION | 0.9 | ratio | guideline | S5 | Thilen 2023: TOFR ≥ 0.9 before extubation. |
| extubation |  | DEPTH_AWAKE | 80 |  | author_estimate_unvalidated |  | Illustrative extubation-readiness criterion (TOFR criterion is the guideline value above). |
| extubation |  | RR_MIN | 8 |  | author_estimate_unvalidated |  | Illustrative extubation-readiness criterion (TOFR criterion is the guideline value above). |
| extubation |  | CAPABILITY_MIN | 0.6 |  | author_estimate_unvalidated |  | Illustrative extubation-readiness criterion (TOFR criterion is the guideline value above). |
| extubation |  | SPO2_MIN | 94 |  | author_estimate_unvalidated |  | Illustrative extubation-readiness criterion (TOFR criterion is the guideline value above). |
| extubation |  | MAP_MIN | 65 |  | author_estimate_unvalidated |  | Illustrative extubation-readiness criterion (TOFR criterion is the guideline value above). |
| extubation |  | MAP_MAX | 110 |  | author_estimate_unvalidated |  | Illustrative extubation-readiness criterion (TOFR criterion is the guideline value above). |
| extubation |  | HR_MIN | 50 |  | author_estimate_unvalidated |  | Illustrative extubation-readiness criterion (TOFR criterion is the guideline value above). |
| extubation |  | HR_MAX | 110 |  | author_estimate_unvalidated |  | Illustrative extubation-readiness criterion (TOFR criterion is the guideline value above). |
| autorun |  | PRE_INDUCTION_DWELL_SEC | 60 | s | simulator_convention |  | [full demonstration only] Full demonstration waits at least this long after 00:00 (premedication steps run at their offsets) before "Transfer to OR". Transfer also waits for the premedication interval (engine/timing.js TIMING_CONFIG.PREMED_TO_TRANSFER_SEC). In guided mode the clinician presses "Transfer to OR". |
| autorun |  | INDUCTION_FIO2 | 1 | fraction | simulator_convention |  | [guided + full] After transfer and OR setup the sequence starts preoxygenation (FiO2 1.0, set_fio2 — the Airway panel action); at "Start induction" it starts bag-mask ventilation (mask_ventilate). Durations: engine/timing.js TIMING_CONFIG (OR_SETUP_SEC, PREOXYGENATION_SEC). |
| autorun |  | SEDATION_FIO2 | 0.4 | fraction | simulator_convention |  | [guided + full] At "Start sedation" the sequence sets supplemental oxygen FiO2 0.4 with the Airway panel set_fio2 action (the same value the browser smoke test uses for the MAC example). |
| autorun |  | INTUBATION_DEPTH_MAX | 60 | processed-EEG depth index (BIS-style, simulated) | simulator_convention |  | [guided + full] Intubating conditions: simulated processed-EEG depth index ≤ 60 (upper end of the GA band, engine/timing.js). The engine notes laryngoscopy above 70 as light; 60 is the depth the existing GA smoke test waits for. |
| autorun |  | INTUBATION_TOF_COUNT_MAX | 1 | TOF count | simulator_convention |  | [guided + full] Intubating conditions: TOF count ≤ 1 (the Run screen hint "asleep and paralysed (TOF count 0–1)"). All induction plan steps must also have run. |
| autorun |  | INTUBATION_TIMEOUT_SEC | 600 | s | simulator_convention |  | [guided + full] If intubating conditions are not met within this time after induction starts: the demonstration stops; guided mode shows the unmet conditions and keeps the Intubate button disabled. |
| autorun |  | MAINTENANCE_AFTER_AIRWAY_SEC | 60 | s | simulator_convention |  | [full demonstration only] Full demonstration enters maintenance this long after the airway is secured. In guided mode the clinician presses "Enter maintenance mode". |
| autorun |  | SURGERY_START_TIMEOUT_SEC | 900 | s | simulator_convention |  | [guided + full] Pre-incision verification ("Start surgery" gate, both modes; no time-based start): if its state items are not met within this time after maintenance begins, the full demonstration stops and guided mode shows the unmet items. Items: airway + ventilation, processed-EEG index in the GA band (or below it with the clinician's acknowledgement), analgesia given per plan, neuromuscular block (TOF), antibiotic in window, WHO time out (clinician only) — engine/timing.js preIncisionItems() and TIMING_CONFIG. |
| autorun |  | SURGERY_DURATION_SEC | 1800 | s | simulator_convention |  | [full demonstration only] Full demonstration ends surgery after this time (the plan has no maintenance-duration field); it is also the planned end of surgery that anchors "stop X min before the end of surgery" plan steps. In guided mode the clinician presses "End surgery" (such stops then run at that moment if not earlier). |
| autorun |  | CLOSING_BEFORE_EMERGENCE_SEC | 300 | s | simulator_convention |  | [full demonstration only] Full demonstration begins emergence this long after surgery ends (matches the engine closing-stimulus duration). In guided mode the clinician presses "Enter emergence / extubation mode". |
| autorun |  | EXTUBATION_TOFR_MIN | 0.9 | TOF ratio | guideline | S5 | [guided + full] Extubation needs sim.extubationReadiness() to be met, which includes TOFR ≥ 0.9. The sequence never uses the "Extubate anyway" override. Other readiness criteria are the engine's illustrative rules. |
| autorun |  | READINESS_HOLD_SEC | 10 | s | simulator_convention |  | [full demonstration only] Full demonstration extubates only after readiness has been met for this many consecutive simulated seconds (readiness can flicker with seeded noise). Guided mode enables "Extubate" whenever readiness is met and re-checks it on the click. |
| autorun |  | EXTUBATION_TIMEOUT_SEC | 1800 | s | simulator_convention |  | [guided + full] If readiness is not met within this time after emergence begins: the demonstration stops and lists the unmet criteria; guided mode lists them and keeps "Extubate" disabled. |
| autorun |  | POST_EXTUBATION_OBSERVE_SEC | 300 | s | simulator_convention |  | [guided + full] After extubation the sequence observes for this time, then reports the case complete. |
| autorun |  | SEDATION_TARGET_LEVEL | "plan.sedationTarget" | ASA continuum level | guideline | S31 | [guided + full] The procedure can start once the simulated sedation level reaches the plan target (minimal / moderate / deep, ASA continuum definitions), all sedation plan steps have run, antibiotic prophylaxis (if indicated) is in window and the clinician has confirmed the WHO time out. The mapping from the processed-EEG depth index to level is an illustrative engine rule. |
| autorun |  | SEDATION_TARGET_HOLD_SEC | 10 | s | simulator_convention |  | [guided + full] The sedation target must be met for this many consecutive simulated seconds before the procedure starts, so a single noisy sample does not start it (2026-11 audit; same idea as READINESS_HOLD_SEC and RECOVERY_HOLD_SEC). |
| autorun |  | SEDATION_BELOW_TARGET_PAUSE_SEC | 300 | s | simulator_convention |  | [full demonstration only] Sedation below the planned target: once every sedation plan step has run, guided mode at once offers the clinician two options at the "Start procedure" gate — titrate within the label range (SEDATION_TITRATION_*), or "Acknowledge and start procedure at current level". The full demonstration waits this long after the last sedation plan step for the target, then PAUSES for the clinician; it never titrates and never acknowledges on its own. |
| autorun |  | SEDATION_TITRATION_STEP_FRACTION | 0.5 | fraction of the label rate range | simulator_convention |  | [guided + full] Clinician titration suggestion for a running sedation infusion: current rate + this fraction of the label rate range of the plan's sedation regimen, capped at the range maximum (propofol MAC sedation 25–75 mcg/kg/min [S11] → steps of 25). The step size is a simulator convention; the range is the label range. A bolus agent (midazolam) is suggested at its regimen default dose and waits for the label repeat interval (engine/timing.js MIDAZOLAM_REPEAT_MIN_SEC [S17]). Applied only by the clinician's click (logged as clinician-approved). |
| autorun |  | SEDATION_TITRATION_REASSESS_SEC | 180 | s | simulator_convention |  | [guided + full] After an infusion-rate change the next titration suggestion waits this long. The propofol label gives no number; ASA 2018 moderate-sedation guidance: allow sufficient time between doses to assess the effect of each [S32] (no number) — so the value is a simulator convention. |
| autorun |  | SEDATION_TARGET_TIMEOUT_SEC | 900 | s | simulator_convention |  | [guided + full] If the sedation target is not reached within this time after sedation starts, automatic mode stops and reports it. |
| autorun |  | PROCEDURE_DURATION_SEC | 1200 | s | simulator_convention |  | [full demonstration only] Full demonstration ends the procedure after this time and moves to recovery. In guided mode the clinician presses "End procedure". |
| autorun |  | RECOVERY_LEVEL_MAX | "minimal" | ASA continuum level | simulator_convention |  | [guided + full] Recovery is reported complete when the simulated sedation level is minimal or awake for RECOVERY_HOLD_SEC. This is a teaching end point, not a discharge criterion. |
| autorun |  | RECOVERY_HOLD_SEC | 10 | s | simulator_convention |  | [guided + full] Consecutive simulated seconds the recovery level must hold. |
| autorun |  | RECOVERY_TIMEOUT_SEC | 1800 | s | simulator_convention |  | [guided + full] If recovery is not reached within this time after the procedure ends, automatic mode stops and reports it. |
| autorun |  | PAUSE_ON_INTERLOCK_HOLD | true | boolean | simulator_convention |  | [guided + full] Automatic mode pauses whenever an interlock hold is latched (the Run screen also stops the clock). It never calls resume_hold; the user must release the hold, then press Resume. |
| autorun |  | INTERLOCK_MAP_CRITICAL_LOW | 60 | mmHg | project_config | S35 | [guided + full] Reused, not redefined: the engine latches the hold when MAP < 60 (config.yaml). Automatic mode reacts to the latched hold, not to its own threshold. |
| autorun |  | INTERLOCK_HR_CRITICAL_LOW | 48 | /min | project_config | S35 | [guided + full] Reused, not redefined: the engine latches the hold when HR < 48 (config.yaml). |
| autorun |  | CONTINUE_WITH_HOLD_OPTION | true | boolean | simulator_convention |  | [guided + full] Owner-approved (final-check fixes, 2026-11): while paused for a latched interlock hold, the clinician may press "Continue with hold latched (this hold only)". It is explicit and logged ("Clinician chose to continue with hold latched: <drugs> (<MAP/HR reason>)"), never a default and never chosen by the runner. It covers only the hold episode latched at that moment (held drugs + trigger + latch time, engine sim.state.interlocks.holdEpisode): a new latch — another trigger, another held drug, or the trigger firing again after it had cleared (MAP back to ≥ 62 mmHg / HR ≥ 50 /min, the alarm clearing hysteresis reused from sim.js ALARM_THRESHOLDS, so noise at the threshold is not a new latch) — pauses again, and so does any new HIGH alarm. It does not release the hold (held infusions stay at zero) and does not acknowledge any alarm. It ends when the hold is released ("Resume hold") or a new episode starts, so it never carries to the next episode. |
| autorun |  | PAUSE_ALARM_PRIORITIES | "high" | alarm priority | simulator_convention |  | [guided + full] Automatic mode pauses for an unacknowledged HIGH-priority alarm that is active or was raised since the last check. It never acknowledges alarms. Medium and low alarms (e.g. MAP < 65, depth over the sedation target, dose-range notices) do not pause: they are shown and announced as usual, and the user can pause or take over at any time. |
| rescue |  | TRIGGER_MAP_BELOW | 65 | mmHg | simulator_convention |  | [reuses ALARM_THRESHOLDS.MAP_LOW] A rescue-bolus suggestion is offered only while MAP < this value (strict "<"; MAP = 65 gives no suggestion). Reuses the simulator MAP-low alarm threshold (sim.js ALARM_THRESHOLDS.MAP_LOW, a build-specification alarm value, not a clinical standard); not redefined here. |
| rescue |  | EPISODE_CLEAR_MAP_AT_OR_ABOVE | 67 | mmHg | simulator_convention |  | [reuses ALARM_THRESHOLDS.MAP_LOW_CLEAR] A hypotension episode (for the advisory record and for "Dismiss") ends when MAP ≥ this value — reuses the MAP-low alarm clearing hysteresis (sim.js ALARM_THRESHOLDS.MAP_LOW_CLEAR). Between the trigger and this value no dose is suggested. |
| rescue |  | HIGH_MAP_ADVICE_ABOVE | 120 | mmHg | simulator_convention |  | [reuses ALARM_THRESHOLDS.MAP_HIGH] MAP > this value (reuses sim.js ALARM_THRESHOLDS.MAP_HIGH, the map_high alarm) shows teaching text only — review depth and analgesia, check the sensor. No drug and no dose is suggested: no verified dosing source for an antihypertensive is in the drug library. |
| rescue |  | HIGH_MAP_EPISODE_CLEAR_AT_OR_BELOW | 118 | mmHg | simulator_convention |  | [reuses ALARM_THRESHOLDS.MAP_HIGH_CLEAR] The high-MAP advisory (text only) ends when MAP ≤ this value — reuses the map_high alarm clearing hysteresis (sim.js ALARM_THRESHOLDS.MAP_HIGH_CLEAR). |
| rescue |  | RESCUE_AGENTS | "phenylephrine, ephedrine" | drug ids | fda_label | S18, S19 | Agents the advisory may suggest. Dose, range, timing text and sources come from each drug's label rescue regimen in data/drugs.js (phenylephrine 40–100 mcg IV bolus [S18]; ephedrine 5–10 mg IV bolus [S19]) via dosing.js recommend(). Epinephrine is never suggested for routine hypotension: it stays a manual choice (the anaphylaxis scenario has its own guidance [S44, S45]). |
| rescue |  | REGIMEN_KEY | "rescue" | regimen key | fda_label | S18, S19 | Drug-library regimen read for the suggestion (label rescue bolus). |
| rescue |  | DOSE_CHOICE | "regimen default (label lower bound), capped by the per-bolus and cumulative maxima" | rule | simulator_convention |  | Suggested dose = the regimen default from recommend() (for both agents the label lower bound), never above the regimen maximum or a per-bolus ceiling, and reduced to what the cumulative label maximum still allows; if that is below the regimen minimum, no dose is suggested ("label maximum reached"). Choosing the lower bound is a simulator convention; the numbers are label values. |
| rescue |  | AGENT_SELECTION_HR_BELOW | 60 | /min | simulator_convention |  | Agent selection (simulator convention — no label or guideline statement giving this rule or threshold was verified): HR < 60 /min → ephedrine (mixed-acting; raises HR as well as MAP in this model); HR ≥ 60 /min → phenylephrine (alpha-agonist; reflex HR fall in this model). The directions mirror the illustrative PD profiles in engine/pd.js; 60 /min is a teaching value. An unusable HR reading gives no suggestion. |
| rescue | phenylephrine | PHENYLEPHRINE_REPEAT_MIN_SEC | 60 | s | fda_label | S18 | After a phenylephrine bolus the next suggestion waits at least 60 s ("reassess — next dose allowed in mm:ss"): label — additional boluses may be administered every 1–2 minutes as needed [S18]; the lower bound is used. |
| rescue | ephedrine | EPHEDRINE_REPEAT_MIN_SEC | 120 | s | simulator_convention |  | After an ephedrine bolus the next suggestion waits at least 120 s. The ephedrine label gives no repeat interval (IV bolus "as needed"; tachyphylaxis possible [S19]), so this is a simulator convention (a conservative teaching pause equal to the upper end of the phenylephrine label interval). |
| rescue |  | OTHER_VASOPRESSOR_REASSESS_SEC | 120 | s | simulator_convention |  | After a bolus of any other vasopressor (e.g. epinephrine given manually) the advisory waits this long before suggesting phenylephrine or ephedrine. Simulator convention (no source). |
| rescue |  | REPEAT_INTERVAL_FROM | "last vasopressor bolus (any source)" | rule | simulator_convention |  | The interval runs from the most recent vasopressor bolus of any source (manual, plan or advisory) and uses the interval of the agent that was given. Simulator convention. |
| rescue |  | CUMULATIVE_MAX | "drug.ceiling (label maximum)" | rule | fda_label | S18, S19 | Cumulative maximum already given is read from the drug library ceiling: phenylephrine 200 mcg for all boluses in the session (conservative reading of the 2019 label [S18]); ephedrine 50 mg total [S19]. When the remaining allowance is below the regimen minimum the advisory shows "label maximum reached — consider other causes / escalate; not simulated". |
| rescue |  | SUPPRESS_DURING_ANAPHYLAXIS | true | boolean | simulator_convention |  | While the anaphylaxis scenario is active the advisory suggests no phenylephrine/ephedrine bolus and points to the scenario guidance (epinephrine, a manual choice [S44, S45]). Simulator convention. |
| rescue |  | SUPPRESS_ON_SENSOR_FAULT | true | boolean | simulator_convention |  | No dose is suggested while the MAP or HR reading is unusable (sensor fault / non-finite value); the card asks to check the sensor. Simulator convention. |
| rescue |  | NEVER_AUTO_ACCEPT | true | boolean | simulator_convention |  | The suggestion is never accepted automatically — not in manual, guided or automatic-demonstration mode. Only "Give suggested bolus" gives it (logged "ADVISORY accepted", clinician-approved). The advisory never acknowledges alarms and never releases interlock holds. Owner requirement; simulator convention. |
| teaching_ceiling | epinephrine | EPINEPHRINE_IV_BOLUS_TOTAL | 0.5 | mg | simulator_convention |  | Teaching guard, not a clinical limit: total IV epinephrine BOLUSES in the session (infusion not counted; it has its label rate ceiling). 0.5 mg = 10 × the 50-microgram perioperative-anaphylaxis titration step of the rescue_iv regimen (UK guidance [S44, S45], which advises an infusion if several doses are needed) and equals the label per-injection IM maximum (0.5 mg [S40]). No guideline or label states an IV cumulative maximum. |
| teaching_ceiling | glycopyrrolate | GLYCOPYRROLATE_BOLUS_TOTAL | 1 | mg | simulator_convention |  | Teaching guard, not a clinical limit: total glycopyrrolate boluses in the session (any phase). 1 mg = 10 × the 0.1 mg intraoperative rescue dose [S8] and the top of the emergence regimen range in the library (0.2 mg per 1 mg neostigmine applied to the 5 mg neostigmine label maximum [S7, S8]). The label states no cumulative intraoperative maximum (the FDA pharmacology review of a prefilled-syringe product, NDA 214919, calculated a maximum daily dose of 1.0 mg/day from the reference label — seen in a web-search record, 2026-11-06; a reviewer calculation, not a label limit). |
| teaching_ceiling |  | CRYSTALLOID_TOTAL_ML_PER_KG | 30 | mL/kg TBW | simulator_convention |  | Teaching guard, not a clinical limit: total crystalloid (boluses + maintenance, any fluid type) per kg total body weight. A bolus that would take the total above it needs the confirmation; a running maintenance infusion is not stopped. 30 mL/kg is the Surviving Sepsis Campaign 2021 initial resuscitation volume for sepsis-induced hypoperfusion (already shown as context by the fluid model, FLUID_MODEL.SEPSIS_CONTEXT_ML_PER_KG) reused as a "stop and think" point; fluid overload is not modelled. |
| teaching_ceiling |  | CONFIRMATION_VALID_SEC | 60 | s | simulator_convention |  | A clinician confirmation covers one dose (or one fluid bolus) of that agent given within this time; it is then used up. Simulator convention. |

## Automatic demonstration and guided mode
Generated from `engine/autorun-config.js` and `engine/autorun.js`. Both modes are a **scripted sequence** of the same phase and airway actions as the manual Run-screen buttons (`engine/case-actions.js`); they are not a controller and not a clinical recommendation, and they have not been evaluated against clinical practice. They never give, change or stop a drug on their own (only the user's plan steps and the clinician's own clicks do — e.g. guideline prophylaxis, a sedation titration step, an advisory rescue bolus), never extubate unless `sim.extubationReadiness()` is met (the "Extubate anyway" override is never used), pause on a latched interlock hold or an unacknowledged HIGH-priority alarm without releasing or acknowledging it (the panel then shows a paused banner with the reason and the action needed, and Resume), offer the clinician two choices when MAC sedation stays below the plan target (titrate within the label range, or acknowledge and start the procedure at the current level; the full demonstration pauses there and never chooses), and end as soon as any manual control is used.

While either mode runs, an on-screen banner (exact text: `BANNERS` in `engine/autorun.js`) states that it is a scripted educational sequence, not a controller or a clinical recommendation. Steps taken are logged with the prefix `AUTO:` (log kind `auto`), and the debrief and the downloaded session JSON (`automaticMode`, `summary.automatic`) record the mode, outcome, pauses and where/why it stopped.

**GA sequence**

1. **Transfer to OR** — gate “Transfer to OR” (guided: you press it; full demonstration: passes automatically); pre-op holding: enabled 5 min after any premedication bolus has ended (countdown shown).
2. **OR setup → preoxygenation** — automatic in both modes; after OR setup (2 min, monitors applied): preoxygenation FiO2 1.
3. **Start induction** — gate “Approve & start induction” (guided: you press it; full demonstration: passes automatically); enabled after 3 min of preoxygenation and at least 10 min after the premedication ended (countdown shown); bag-mask ventilation, then induction plan steps run at their offsets.
4. **Secure airway** — gate “Intubate (secure airway)” (guided: you press it; full demonstration: passes automatically); enabled when intubating conditions are met; tube + mechanical ventilation.
5. **Start maintenance** — gate “Enter maintenance mode” (guided: you press it; full demonstration: passes automatically); maintenance plan steps run at their offsets.
6. **Start surgery** — gate “Start surgery (incision)” (guided: you press it; full demonstration: passes automatically); pre-incision verification, no time-based start: airway + ventilation, processed-EEG index in the GA band, analgesia per plan, neuromuscular block adequate, antibiotic in window (required), WHO time out confirmed by the clinician (the full demonstration waits for the state items and pauses for the clinician items; it never confirms them).
7. **End surgery** — gate “End surgery” (guided: you press it; full demonstration: passes automatically); clinician-chosen end of surgery.
8. **Begin emergence** — gate “Enter emergence / extubation mode” (guided: you press it; full demonstration: passes automatically); emergence plan steps run (agents off, antiemetic, reversal).
9. **Extubate** — gate “Extubate” (guided: you press it; full demonstration: passes automatically); enabled only when sim.extubationReadiness() is met.
10. **Observe after extubation** — automatic in both modes; observation, then complete.

**MAC sequence**

1. **Transfer to OR** — gate “Transfer to OR” (guided: you press it; full demonstration: passes automatically); pre-op holding: enabled 5 min after any premedication bolus has ended (countdown shown).
2. **Start sedation** — gate “Approve & start sedation” (guided: you press it; full demonstration: passes automatically); after OR setup (2 min, monitors): supplemental O2 FiO2 0.4, then sedation plan steps run at their offsets.
3. **Start procedure** — gate “Start procedure” (guided: you press it; full demonstration: passes automatically); pre-procedure verification: plan sedation target held for 10 s with all sedation plan steps run, antibiotic in window if indicated, and the WHO time out confirmed by the clinician (the full demonstration pauses for it).
4. **End procedure → recovery** — gate “End procedure” (guided: you press it; full demonstration: passes automatically); ends the procedure and starts recovery (plan stop steps run).
5. **Recovery** — automatic in both modes; complete when sedation level is minimal or awake.

Every condition and timing (29 entries; also listed in the parameter inventory as component `autorun`):

| Entry | Value | Unit | Applies to | Provenance | Sources | Rationale |
|---|---|---|---|---|---|---|
| PRE_INDUCTION_DWELL_SEC | 60 | s | full demonstration | simulator convention (unsourced) |  | Full demonstration waits at least this long after 00:00 (premedication steps run at their offsets) before "Transfer to OR". Transfer also waits for the premedication interval (engine/timing.js TIMING_CONFIG.PREMED_TO_TRANSFER_SEC). In guided mode the clinician presses "Transfer to OR". |
| INDUCTION_FIO2 | 1 | fraction | both | simulator convention (unsourced) |  | After transfer and OR setup the sequence starts preoxygenation (FiO2 1.0, set_fio2 — the Airway panel action); at "Start induction" it starts bag-mask ventilation (mask_ventilate). Durations: engine/timing.js TIMING_CONFIG (OR_SETUP_SEC, PREOXYGENATION_SEC). |
| SEDATION_FIO2 | 0.4 | fraction | both | simulator convention (unsourced) |  | At "Start sedation" the sequence sets supplemental oxygen FiO2 0.4 with the Airway panel set_fio2 action (the same value the browser smoke test uses for the MAC example). |
| INTUBATION_DEPTH_MAX | 60 | processed-EEG depth index (BIS-style, simulated) | both | simulator convention (unsourced) |  | Intubating conditions: simulated processed-EEG depth index ≤ 60 (upper end of the GA band, engine/timing.js). The engine notes laryngoscopy above 70 as light; 60 is the depth the existing GA smoke test waits for. |
| INTUBATION_TOF_COUNT_MAX | 1 | TOF count | both | simulator convention (unsourced) |  | Intubating conditions: TOF count ≤ 1 (the Run screen hint "asleep and paralysed (TOF count 0–1)"). All induction plan steps must also have run. |
| INTUBATION_TIMEOUT_SEC | 600 | s | both | simulator convention (unsourced) |  | If intubating conditions are not met within this time after induction starts: the demonstration stops; guided mode shows the unmet conditions and keeps the Intubate button disabled. |
| MAINTENANCE_AFTER_AIRWAY_SEC | 60 | s | full demonstration | simulator convention (unsourced) |  | Full demonstration enters maintenance this long after the airway is secured. In guided mode the clinician presses "Enter maintenance mode". |
| SURGERY_START_TIMEOUT_SEC | 900 | s | both | simulator convention (unsourced) |  | Pre-incision verification ("Start surgery" gate, both modes; no time-based start): if its state items are not met within this time after maintenance begins, the full demonstration stops and guided mode shows the unmet items. Items: airway + ventilation, processed-EEG index in the GA band (or below it with the clinician's acknowledgement), analgesia given per plan, neuromuscular block (TOF), antibiotic in window, WHO time out (clinician only) — engine/timing.js preIncisionItems() and TIMING_CONFIG. |
| SURGERY_DURATION_SEC | 1800 | s | full demonstration | simulator convention (unsourced) |  | Full demonstration ends surgery after this time (the plan has no maintenance-duration field); it is also the planned end of surgery that anchors "stop X min before the end of surgery" plan steps. In guided mode the clinician presses "End surgery" (such stops then run at that moment if not earlier). |
| CLOSING_BEFORE_EMERGENCE_SEC | 300 | s | full demonstration | simulator convention (unsourced) |  | Full demonstration begins emergence this long after surgery ends (matches the engine closing-stimulus duration). In guided mode the clinician presses "Enter emergence / extubation mode". |
| EXTUBATION_TOFR_MIN | 0.9 | TOF ratio | both | guideline | S5 | Extubation needs sim.extubationReadiness() to be met, which includes TOFR ≥ 0.9. The sequence never uses the "Extubate anyway" override. Other readiness criteria are the engine's illustrative rules. |
| READINESS_HOLD_SEC | 10 | s | full demonstration | simulator convention (unsourced) |  | Full demonstration extubates only after readiness has been met for this many consecutive simulated seconds (readiness can flicker with seeded noise). Guided mode enables "Extubate" whenever readiness is met and re-checks it on the click. |
| EXTUBATION_TIMEOUT_SEC | 1800 | s | both | simulator convention (unsourced) |  | If readiness is not met within this time after emergence begins: the demonstration stops and lists the unmet criteria; guided mode lists them and keeps "Extubate" disabled. |
| POST_EXTUBATION_OBSERVE_SEC | 300 | s | both | simulator convention (unsourced) |  | After extubation the sequence observes for this time, then reports the case complete. |
| SEDATION_TARGET_LEVEL | "plan.sedationTarget" | ASA continuum level | both | guideline | S31 | The procedure can start once the simulated sedation level reaches the plan target (minimal / moderate / deep, ASA continuum definitions), all sedation plan steps have run, antibiotic prophylaxis (if indicated) is in window and the clinician has confirmed the WHO time out. The mapping from the processed-EEG depth index to level is an illustrative engine rule. |
| SEDATION_TARGET_HOLD_SEC | 10 | s | both | simulator convention (unsourced) |  | The sedation target must be met for this many consecutive simulated seconds before the procedure starts, so a single noisy sample does not start it (2026-11 audit; same idea as READINESS_HOLD_SEC and RECOVERY_HOLD_SEC). |
| SEDATION_BELOW_TARGET_PAUSE_SEC | 300 | s | full demonstration | simulator convention (unsourced) |  | Sedation below the planned target: once every sedation plan step has run, guided mode at once offers the clinician two options at the "Start procedure" gate — titrate within the label range (SEDATION_TITRATION_*), or "Acknowledge and start procedure at current level". The full demonstration waits this long after the last sedation plan step for the target, then PAUSES for the clinician; it never titrates and never acknowledges on its own. |
| SEDATION_TITRATION_STEP_FRACTION | 0.5 | fraction of the label rate range | both | simulator convention (unsourced) |  | Clinician titration suggestion for a running sedation infusion: current rate + this fraction of the label rate range of the plan's sedation regimen, capped at the range maximum (propofol MAC sedation 25–75 mcg/kg/min [S11] → steps of 25). The step size is a simulator convention; the range is the label range. A bolus agent (midazolam) is suggested at its regimen default dose and waits for the label repeat interval (engine/timing.js MIDAZOLAM_REPEAT_MIN_SEC [S17]). Applied only by the clinician's click (logged as clinician-approved). |
| SEDATION_TITRATION_REASSESS_SEC | 180 | s | both | simulator convention (unsourced) |  | After an infusion-rate change the next titration suggestion waits this long. The propofol label gives no number; ASA 2018 moderate-sedation guidance: allow sufficient time between doses to assess the effect of each [S32] (no number) — so the value is a simulator convention. |
| SEDATION_TARGET_TIMEOUT_SEC | 900 | s | both | simulator convention (unsourced) |  | If the sedation target is not reached within this time after sedation starts, automatic mode stops and reports it. |
| PROCEDURE_DURATION_SEC | 1200 | s | full demonstration | simulator convention (unsourced) |  | Full demonstration ends the procedure after this time and moves to recovery. In guided mode the clinician presses "End procedure". |
| RECOVERY_LEVEL_MAX | "minimal" | ASA continuum level | both | simulator convention (unsourced) |  | Recovery is reported complete when the simulated sedation level is minimal or awake for RECOVERY_HOLD_SEC. This is a teaching end point, not a discharge criterion. |
| RECOVERY_HOLD_SEC | 10 | s | both | simulator convention (unsourced) |  | Consecutive simulated seconds the recovery level must hold. |
| RECOVERY_TIMEOUT_SEC | 1800 | s | both | simulator convention (unsourced) |  | If recovery is not reached within this time after the procedure ends, automatic mode stops and reports it. |
| PAUSE_ON_INTERLOCK_HOLD | true | boolean | both | simulator convention (unsourced) |  | Automatic mode pauses whenever an interlock hold is latched (the Run screen also stops the clock). It never calls resume_hold; the user must release the hold, then press Resume. |
| INTERLOCK_MAP_CRITICAL_LOW | 60 | mmHg | both | project_config | S35 | Reused, not redefined: the engine latches the hold when MAP < 60 (config.yaml). Automatic mode reacts to the latched hold, not to its own threshold. |
| INTERLOCK_HR_CRITICAL_LOW | 48 | /min | both | project_config | S35 | Reused, not redefined: the engine latches the hold when HR < 48 (config.yaml). |
| CONTINUE_WITH_HOLD_OPTION | true | boolean | both | simulator convention (unsourced) |  | Owner-approved (final-check fixes, 2026-11): while paused for a latched interlock hold, the clinician may press "Continue with hold latched (this hold only)". It is explicit and logged ("Clinician chose to continue with hold latched: <drugs> (<MAP/HR reason>)"), never a default and never chosen by the runner. It covers only the hold episode latched at that moment (held drugs + trigger + latch time, engine sim.state.interlocks.holdEpisode): a new latch — another trigger, another held drug, or the trigger firing again after it had cleared (MAP back to ≥ 62 mmHg / HR ≥ 50 /min, the alarm clearing hysteresis reused from sim.js ALARM_THRESHOLDS, so noise at the threshold is not a new latch) — pauses again, and so does any new HIGH alarm. It does not release the hold (held infusions stay at zero) and does not acknowledge any alarm. It ends when the hold is released ("Resume hold") or a new episode starts, so it never carries to the next episode. |
| PAUSE_ALARM_PRIORITIES | "high" | alarm priority | both | simulator convention (unsourced) |  | Automatic mode pauses for an unacknowledged HIGH-priority alarm that is active or was raised since the last check. It never acknowledges alarms. Medium and low alarms (e.g. MAP < 65, depth over the sedation target, dose-range notices) do not pause: they are shown and announced as usual, and the user can pause or take over at any time. |

## Timing rules and template timing
Generated from `engine/timing.js` (`TIMING_CONFIG`, the plan timing validator, live timing checks, pre-incision verification and state-gated repeat boluses) and from the `timingRationale` of every technique-template step (`data/templates.js`). A rule marked *simulator convention* has no source for its number; where a label statement is cited in its text, the convention is anchored to that statement, not taken from it. *Clinical practice convention (owner)* is practice stated by the project owner, not a published source.

Minimum interval from the end of a premedication bolus to "Start induction": 10 min (pre-op holding 5 min + OR setup 2 min + preoxygenation 3 min). Plan drugs in the induction/sedation phase never start while a premedication bolus is pending or running.

| Rule | Value | Unit | Provenance | Sources | Rationale |
|---|---|---|---|---|---|
| PREMED_TO_TRANSFER_SEC | 300 | s | clinical practice convention (owner) | S17 | Premedication midazolam is given in pre-op holding (some centres use the PACU as holding) about 5 min before the patient is rolled to the OR. Counted from the END of the last premedication bolus (midazolam is injected over at least 2 min, label). Label support for waiting at least this long: sedation is achieved within 3 to 5 minutes after IV injection [S17]. |
| OR_SETUP_SEC | 120 | s | simulator convention |  | Transfer to the OR, monitors applied (ECG, NIBP, SpO2) before preoxygenation. No source gives a duration; teaching value. |
| PREOXYGENATION_SEC | 180 | s | simulator convention |  | Preoxygenation (FiO2 1.0 by face mask) before induction. The 3-min tidal-breathing technique is widely described, but no guideline giving this duration was verified, so the value is a simulator convention. Guidelines set an end point, not a time: DAS 2015 — preoxygenate all patients with 100% oxygen until the end-tidal oxygen fraction is 0.87–0.9 (S55); ASA 2022 — supplemental oxygen before initiating difficult-airway management (S56). End-tidal O2 is not modelled (see PREOXYGENATION_END_POINT; timing cross-check 2026-11, TIMING_EVIDENCE.md). |
| PREOXYGENATION_END_POINT | "end-tidal O2 fraction 0.87–0.9 (not modelled)" | fraction | guideline / consensus | S55, S56 | Guideline end point for preoxygenation, recorded for teaching and shown in the Timing evidence page: DAS 2015 — all patients preoxygenated with 100% oxygen, face-mask seal maintained, until the end-tidal oxygen fraction is 0.87–0.9 [S55]; ASA 2022 difficult-airway guideline — supplemental oxygen before initiating difficult-airway management [S56]. The simulator does not model end-tidal O2, so the guided/automatic gate uses the PREOXYGENATION_SEC time convention instead; nothing in the engine reads this value. |
| OPIOID_LEAD_SEC | 180 | s | simulator convention |  | Opioid given about 3 min before the hypnotic so it approaches peak effect before laryngoscopy. Fentanyl label: onset almost immediate IV, but the maximal analgesic and respiratory depressant effect may not be noted for several minutes [S13]; the label gives no number, so 3 min is a simulator convention anchored to that statement. |
| PRETREATMENT_MAX_GAP_SEC | 60 | s | simulator convention |  | Lidocaine pretreatment must be given before propofol and "immediately" before it (propofol label: prior injection of IV lidocaine reduces injection pain [S11]); the 60-s maximum gap and the 10-s template gap are simulator conventions. |
| NMB_AFTER_HYPNOTIC | "hypnotic label onset" | s | FDA label | S11 | The intubating neuromuscular blocker is given only after loss of consciousness: no earlier than the hypnotic's label onset after the hypnotic (propofol: hypnosis usually within 40 s from the start of injection [S11]; read from the drug library `timing.onsetMin`). |
| LOADING_THEN_MAINTENANCE | "loading start + loading duration" | s | FDA label | S9, S11, S1 | A maintenance infusion starts when its loading dose ends (dexmedetomidine: loading over 10 min, followed by the maintenance infusion [S9]; propofol MAC sedation: initiation over 3–5 min, then maintenance [S11]; IV lidocaine: loading over about 10 min, then infusion [S1]). Overlap of the two is flagged. |
| MAC_SEDATIVE_AFTER_MIDAZOLAM_SEC | 240 | s | FDA label | S17, S32 | MAC templates/example plan: a second sedative (propofol initiation) starts no earlier than 4 min after the midazolam bolus starts — midazolam label: give over at least 2 minutes, then wait an additional 2 or more minutes to fully evaluate the sedative effect [S17]; ASA 2018 moderate-sedation guideline: titrate in small increments and allow sufficient time between doses to assess the effect of each [S32]. Timing cross-check 2026-11: mac_propofol and the MAC example plan started propofol at +2:00 (end of the midazolam injection, before its effect could be evaluated) — moved to +4:00. Template offset (data/templates.js); a test keeps them equal. |
| MIDAZOLAM_REPEAT_MIN_SEC | 240 | s | FDA label | S17 | No repeat midazolam bolus within 4 min of the previous one: label — give over at least 2 minutes, then wait an additional 2 or more minutes to evaluate the effect [S17]. |
| PHENYLEPHRINE_REPEAT_MIN_SEC | 60 | s | FDA label | S18 | No repeat phenylephrine IV bolus within 60 s of the previous one: label — additional boluses may be administered every 1–2 minutes as needed [S18]; the lower bound is used. Same label statement and value as the advisory repeat interval (engine/rescue-config.js RESCUE_CONFIG.PHENYLEPHRINE_REPEAT_MIN_SEC; a test keeps them equal). |
| GLYCOPYRROLATE_RESCUE_REPEAT_MIN_SEC | 120 | s | FDA label | S8 | No repeat glycopyrrolate IV bolus within 120 s of the previous one outside emergence: label — intraoperative 0.1 mg IV, repeated as needed at 2–3 minute intervals [S8]; the lower bound is used. Not applied in emergence, where glycopyrrolate is given with neostigmine (0.2 mg per 1 mg, same label). |
| EPINEPHRINE_IM_REPEAT_MIN_SEC | 300 | s | FDA label | S40 | No repeat intramuscular/subcutaneous epinephrine injection within 5 min of the previous IM/SC injection: label — anaphylaxis 0.3–0.5 mg IM or SC, repeated every 5 to 10 minutes as necessary [S40]; the lower bound is used. IV boluses (guideline titration, "titrated to effect" [S44, S45]) have no stated interval and are not gated. |
| ROCURONIUM_TOPUP_TOF_COUNT_MIN | 3 | TOF count | FDA label | S12 | A rocuronium top-up (any rocuronium bolus after the first) waits until TOF count ≥ 3: label maintenance doses are administered at 25% recovery of control T1, defined as 3 twitches of train-of-four [S12]. A planned top-up is held (status "waiting") until then; a manual one is logged with a warning. |
| DEX_STOP_BEFORE_END_SEC | 900 | s | simulator convention |  | Opioid-free template: the dexmedetomidine infusion stops 15 min before the planned end of surgery so its sedative effect is waning at emergence. No label, guideline or verified trial statement gives this interval (published opioid-free protocols vary and were not confirmed in their primary sources), so it is a simulator convention. |
| GA_DEPTH_BAND | "40–60" | processed-EEG depth index (BIS-style, simulated) | trial protocol | S52, S53 | General-anaesthesia target band 40–60, the protocol target used in the B-Unaware [S52] and BAG-RECALL [S53] trials (neither showed the BIS protocol superior for preventing awareness). Applied to the simulated index, which is an illustrative model output, not a BIS value. Used for the pre-incision item (an index below 40 needs the clinician's acknowledgement; above 60 blocks), the tile/trend-chart band, the live timing check (time outside the band during surgery) and, for the upper bound only, the depth-high (awareness-risk) alarm (DEPTH_HIGH_ALARM_*). No alarm below the band: in this illustrative model 1 MAC of a volatile agent often reads just below 40; for the lower bound only a text-only advisory is shown during surgery (DEPTH_LOW_ADVISORY_*). No sedation bands are used (none verified). |
| DEPTH_HIGH_ALARM_SUSTAIN_SEC | 60 | s | simulator convention |  | HIGH alarm "Processed-EEG index > 60 for ≥ 60 s during general anaesthesia — risk of awareness; check hypnotic delivery" when the simulated index stays above the GA band upper bound (GA_DEPTH_BAND, reused, not redefined) for this long. Armed only in GA with the airway secured after loss of consciousness (index ≤ 60 reached after induction started), in the induction and maintenance phases (surgery and closing included), and not after every maintenance hypnotic is stopped once surgery has ended; never in MAC/sedation or emergence. Any sample at or below 60 restarts the count. The duration is a teaching choice (no source gives one); guided and automatic modes pause for it under the existing HIGH-alarm rule and never acknowledge it. |
| DEPTH_HIGH_ALARM_CLEAR | 58 | processed-EEG depth index (BIS-style, simulated) | simulator convention |  | Hysteresis of the depth-high alarm: once raised it stays active until the index is at or below this value (2 index units under the band upper bound, the same 2-unit hysteresis as the other simulator level alarms), then stays listed (latched) until acknowledged. Simulator convention. |
| DEPTH_HIGH_ALARM_PRIORITY | "high" | alarm priority | simulator convention |  | Priority of the depth-high alarm (owner-approved, final-check fixes 2026-11): HIGH, so guided and automatic modes pause for it (AUTORUN_CONFIG.PAUSE_ALARM_PRIORITIES); only the clinician acknowledges it. Simulator convention. |
| DEPTH_LOW_ADVISORY_SUSTAIN_SEC | 300 | s | simulator convention |  | Text-only "lighten anaesthetic" advisory (engine/depth-advisory.js) when the simulated index stays below the GA band lower bound (GA_DEPTH_BAND, reused, not redefined) for this long. Armed only in GA with the airway secured after loss of consciousness, in the maintenance phase after incision (before incision the pre-incision item — acknowledge an index below the band — applies instead), and not after every maintenance hypnotic is stopped once surgery has ended; never in MAC/sedation, before loss of consciousness or in emergence. Any sample at or above the lower bound restarts the count. NOT an alarm: no sound/priority, guided and automatic modes never pause for it, it never acknowledges anything and never changes a dose, rate or concentration. Owner-approved instead of recalibrating the illustrative depth model (which reads ~34–39 at label-default maintenance doses). The duration is a teaching choice (no source gives one): 300 s (owner decision, 05l; was 120 s in 05k) to limit alert fatigue — at 120 s the card appeared in nearly every GA case because the illustrative model reads deep at label-default doses; 300 s still flags sustained deep readings. |
| DEPTH_LOW_ADVISORY_CLEAR | 42 | processed-EEG depth index (BIS-style, simulated) | simulator convention |  | Hysteresis of the depth-low advisory: once shown it stays until the index is at or above this value (2 index units over the band lower bound, the same 2-unit hysteresis as the depth-high alarm and the other level alarms) or the advisory is disarmed (emergence, agents off after surgery). Simulator convention. |
| NMB_SURGERY_TOF_COUNT_MAX | 2 | TOF count | simulator convention |  | Pre-incision item when the plan includes a neuromuscular blocker: TOF count ≤ 2. No label gives a surgical-relaxation TOF target; teaching value. |
| TIME_OUT_REQUIRED | true | boolean | guideline / consensus | S54 | WHO Surgical Safety Checklist "Time Out" before skin incision (team confirms patient, site and procedure; antibiotic prophylaxis within the last 60 minutes) [S54]. Only the clinician can confirm it; guided and automatic modes never confirm it. |
| ANTIBIOTIC_REQUIRED_BEFORE_INCISION | true | boolean | guideline / consensus | S46 | When prophylaxis is indicated, a dose started within its guideline window before incision (Bratzler 2013: within 60 min; vancomycin 120 min [S46]) is a REQUIRED pre-incision item in guided and automatic modes (acknowledging the warning no longer suffices there; manual mode keeps the alarm). |

**Template step timing (why each step is where it is)**

| Template | Step | When | Provenance | Sources | Why |
|---|---|---|---|---|---|
| ga_opioid | lactated_ringers fluid | premed +0:00 | simulator convention | S47 | Maintenance crystalloid started in pre-op holding and continued across phases until changed (rate and start are simulator conventions; the labels give no fixed dose). |
| ga_opioid | antibiotic (guideline agent) antibiotic | premed +0:00 | guideline | S46 | Started in pre-op holding so the dose begins within 60 min before incision (Bratzler); the pre-incision gate re-checks the window [S46]. |
| ga_opioid | midazolam bolus (premed) — optional | premed +0:00 | clinical practice convention (owner) | S17 | Given in pre-op holding about 5 min before transfer to the OR (owner-stated practice); label: sedation within 3 to 5 min after IV injection [S17]. It never overlaps induction: the induction gate opens only after transfer + OR setup + preoxygenation. |
| ga_opioid | fentanyl bolus (induction) | induction +0:00 | simulator convention | S13 | Opioid given ~3 min before the hypnotic so it approaches peak effect before laryngoscopy (convention). Label: onset almost immediate IV, maximal effect may not be noted for several minutes [S13]. |
| ga_opioid | dexamethasone bolus (induction) | induction +0:00 | consensus | S2, S3 | Given at induction for PONV prophylaxis (consensus) [S2, S3]. |
| ga_opioid | lidocaine bolus (pretreatment) — optional | induction +2:50 | label | S11 | Immediately before propofol (label: prior IV lidocaine reduces injection pain) [S11]; the 10-s gap is a convention. |
| ga_opioid | propofol bolus (induction) | induction +3:00 | simulator convention | S11 | Hypnotic 3 min after the opioid (convention, see fentanyl); label: hypnosis usually within 40 s from the start of injection [S11]. |
| ga_opioid | rocuronium bolus (induction) | induction +4:00 | label | S11 | After loss of consciousness: 60 s after the hypnotic, beyond its label onset (hypnosis usually within 40 s) [S11]; the 60-s spacing is a convention. |
| ga_opioid | sevoflurane inhaled (maintenance) | maintenance +0:00 | simulator convention |  | Started when maintenance begins, after the airway is secured (convention). |
| ga_opioid | sevoflurane stop | emergence +0:00 | simulator convention |  | Agent off at the start of emergence, after End surgery and closing (convention). |
| ga_opioid | ondansetron bolus (emergence) | emergence +0:00 | consensus | S2, S3 | At the end of surgery for PONV prophylaxis (consensus) [S2, S3]. |
| ga_opioid | sugammadex bolus (emergence) | emergence +0:30 | label | S6 | After the anaesthetic agents are off; the dose is compared with the TOF depth of block when given (label tiers) [S6]. The 30-s offset is a convention. |
| ga_opioid_free | lactated_ringers fluid | premed +0:00 | simulator convention | S47 | Maintenance crystalloid started in pre-op holding and continued across phases until changed (rate and start are simulator conventions; the labels give no fixed dose). |
| ga_opioid_free | antibiotic (guideline agent) antibiotic | premed +0:00 | guideline | S46 | Started in pre-op holding so the dose begins within 60 min before incision (Bratzler); the pre-incision gate re-checks the window [S46]. |
| ga_opioid_free | dexmedetomidine infusion (maintenance) | induction +0:00 | simulator convention | S9 | Adjunct infusion started at induction, without a loading dose (this off-label regimen has none) (convention). |
| ga_opioid_free | ketamine infusion (maintenance) | induction +0:00 | simulator convention | S10 | Subanaesthetic analgesic infusion started at induction (consensus gives the dose, not the start time; start = convention) [S10]. |
| ga_opioid_free | lidocaine bolus (induction) | induction +0:00 | consensus | S1 | Foo 2021 loading dose over about 10 min, started at induction; the infusion starts when this loading dose ends [S1]. |
| ga_opioid_free | dexamethasone bolus (induction) | induction +0:00 | consensus | S2, S3 | Given at induction for PONV prophylaxis (consensus) [S2, S3]. |
| ga_opioid_free | lidocaine bolus (pretreatment) — optional | induction +0:50 | label | S11 | Immediately before propofol (label: prior IV lidocaine reduces injection pain) [S11]; the 10-s gap is a convention. |
| ga_opioid_free | propofol bolus (induction) | induction +1:00 | simulator convention | S11 | Hypnotic 1 min after the adjunct infusions start (no opioid to wait for; convention); label: hypnosis usually within 40 s [S11]. |
| ga_opioid_free | rocuronium bolus (induction) | induction +2:00 | label | S11 | After loss of consciousness: 60 s after the hypnotic, beyond its label onset (hypnosis usually within 40 s) [S11]; the 60-s spacing is a convention. |
| ga_opioid_free | sevoflurane inhaled (maintenance) | maintenance +0:00 | simulator convention |  | Started when maintenance begins, after the airway is secured (convention). |
| ga_opioid_free | lidocaine infusion (maintenance) | maintenance +0:00, after the loading dose ends | consensus | S1 | Infusion starts when the lidocaine loading dose (about 10 min) has finished — never overlapping it [S1]. |
| ga_opioid_free | dexmedetomidine stop | end of surgery − 15:00 | simulator convention |  | Stopped 15 min before the planned end of surgery so its sedative effect is waning at emergence. No label, guideline or verified trial statement gives this interval: simulator convention. |
| ga_opioid_free | sevoflurane stop | emergence +0:00 | simulator convention |  | Agent off at the start of emergence, after End surgery and closing (convention). |
| ga_opioid_free | ketamine stop | emergence +0:00 | simulator convention | S10 | Stopped with the anaesthetic agents at emergence; the consensus gives no intraoperative stop time (convention) [S10]. |
| ga_opioid_free | lidocaine stop | emergence +0:00 | simulator convention | S1 | Stopped at emergence because the simulation ends there. Foo 2021 allows the infusion for up to 24 h with review [S1]; stopping it here is a convention, not a guideline requirement. |
| ga_opioid_free | ondansetron bolus (emergence) | emergence +0:00 | consensus | S2, S3 | At the end of surgery for PONV prophylaxis (consensus) [S2, S3]. |
| ga_opioid_free | sugammadex bolus (emergence) | emergence +0:30 | label | S6 | After the anaesthetic agents are off; the dose is compared with the TOF depth of block when given (label tiers) [S6]. The 30-s offset is a convention. |
| mac_dex | lactated_ringers fluid | sedation +0:00 | simulator convention | S47 | Maintenance crystalloid started in pre-op holding and continued across phases until changed (rate and start are simulator conventions; the labels give no fixed dose). |
| mac_dex | dexmedetomidine infusion (sedation) | sedation +0:00 | label | S9 | Loading infusion over 10 min, then maintenance (label) [S9]: the maintenance infusion starts at +10:00, when the loading dose ends. |
| mac_dex | midazolam bolus (sedation) — optional | sedation +0:00 | label | S17, S9 | Optional supplementation at the start of sedation; label: give over at least 2 min and wait at least 2 more min before more [S17]. In the dexmedetomidine label studies rescue midazolam was permitted to reach the target [S9]. |
| mac_dex | propofol infusion (sedation) — optional | sedation +10:00 | simulator convention | S9, S11 | Only after the dexmedetomidine loading dose ends (+10:00); propofol initiation over 3–5 min, then its maintenance [S11]. Start time = convention. |
| mac_dex | dexmedetomidine stop | emergence +0:00 | simulator convention |  | Stopped when the procedure ends (recovery) (convention). |
| mac_dex | propofol stop | emergence +0:00 | simulator convention |  | Stopped when the procedure ends (recovery) (convention). |
| mac_propofol | midazolam bolus (sedation) — optional | sedation +0:00 | label | S17 | First, given over at least 2 min (label) [S17]. |
| mac_propofol | propofol infusion (sedation) | sedation +4:00 | label | S17, S32, S11 | Started 4 min after the midazolam starts: midazolam is given over at least 2 min and its effect is evaluated over at least 2 more min before more sedative is added (midazolam label [S17]; ASA 2018 moderate-sedation guideline: allow sufficient time between doses to assess the effect of each [S32]). Then propofol initiation (slow injection 0.5 mg/kg over 3–5 min) and the maintenance infusion when the initiation ends (label) [S11]. Timing cross-check 2026-11: was +2:00 (before the midazolam effect could be evaluated). |
| mac_propofol | propofol stop | emergence +0:00 | simulator convention |  | Stopped when the procedure ends (recovery) (convention). |

Same-phase loading → maintenance: `buildPlan()` and the plan editor start the maintenance infusion at loading start + loading duration (mac_dex: dexmedetomidine maintenance at +10:00; mac_propofol: propofol initiation at +4:00, maintenance at +9:00); the plan editor warns when a user schedules them overlapping.

Every timed element was cross-checked against FDA labels and guidelines in November 2026: see [TIMING_EVIDENCE.md](TIMING_EVIDENCE.md) (what each source says, agreement, classification, the one conflict fixed, and a clinician-review checklist — no clinician review recorded yet).

## Palliative and end-of-life modules
Generated from `engine/palliative.js` `palliativeParameterInventory()` (data: `data/palliative.js`; sources S100–S120 in SOURCES.md). Educational simulation with fictional patients; not clinical decision support. Opioid starting doses come only from FDA labels; titration, breakthrough, conversion, CDC, naloxone and palliative-sedation values from the cited guidelines/frameworks; every other number is a labelled simulator convention or an illustrative author estimate. The symptom model (pain, dyspnoea, agitation, secretions, nausea, constipation, RASS, respiratory rate) is illustrative and not validated; no survival or mortality is modelled and no outcome claim is made. Palliative sedation is gated by six documentation items, every titration needs the clinician's approval, the engine never escalates or acknowledges anything on its own, and comfort opioids continue (they are not used to sedate). Excluded by design: any content about medical aid in dying, euthanasia or hastening death.

78 parameters. Provenance counts: fda_label: 11, guideline: 21, simulator_convention: 12, author_estimate_unvalidated: 34.

| Component | Drug | Parameter | Value | Unit | Provenance | Sources | Note |
|---|---|---|---|---|---|---|---|
| palliative_dose | morphine | oral starting dose (opioid-naïve) | "10–20" | mg | fda_label | S110 | oral solution (10 mg/5 mL) |
| palliative_dose | morphine | oral interval | "4–4" | h | fda_label | S110 | Default = lower bound (simulator convention). |
| palliative_dose | morphine | iv starting dose (opioid-naïve) | "0.1–0.2" | mg/kg | fda_label | S112 | injection (direct IV) |
| palliative_dose | morphine | iv interval | "4–4" | h | fda_label | S112 | Default = lower bound (simulator convention). |
| palliative_dose | oxycodone | oral starting dose (opioid-naïve) | "5–15" | mg | fda_label | S113 | immediate-release tablet |
| palliative_dose | oxycodone | oral interval | "4–6" | h | fda_label | S113 | Default = lower bound (simulator convention). |
| palliative_dose | hydromorphone | oral starting dose (opioid-naïve) | "2–4" | mg | fda_label | S114 | tablet |
| palliative_dose | hydromorphone | oral interval | "4–6" | h | fda_label | S114 | Default = lower bound (simulator convention). |
| palliative_dose | hydromorphone | iv starting dose (opioid-naïve) | "0.2–1" | mg | fda_label | S115 | injection (standard strength; not HP) |
| palliative_dose | hydromorphone | iv interval | "2–3" | h | fda_label | S115 | Default = lower bound (simulator convention). |
| palliative_dose | hydromorphone | hydromorphone renal/hepatic fraction | "0.25–0.5" | × usual starting dose | fda_label | S114, S115 | Label range; moderate → 0.5, severe → 0.25 is a simulator mapping. |
| palliative_dose | morphine | morphine severe-CKD warning threshold | 30 | mL/min/1.73m² (eGFR) | guideline | S107, S111 | ESMO 2018 eGFR <30 statement; label: start lower in renal failure. |
| palliative_dose |  | rounding increment morphine:oral | 0.5 | mg | simulator_convention |  | Measurable increment for computed doses. |
| palliative_dose |  | rounding increment oxycodone:oral | 0.5 | mg | simulator_convention |  | Measurable increment for computed doses. |
| palliative_dose |  | rounding increment hydromorphone:oral | 0.25 | mg | simulator_convention |  | Measurable increment for computed doses. |
| palliative_dose |  | rounding increment morphine:iv | 0.5 | mg | simulator_convention |  | Measurable increment for computed doses. |
| palliative_dose |  | rounding increment hydromorphone:iv | 0.05 | mg | simulator_convention |  | Measurable increment for computed doses. |
| palliative_rule |  | BREAKTHROUGH_PCT | "10–20" | % of 24-h scheduled dose | guideline | S108, S107 | NCCN: rescue dose 10–20% of the total daily dose, every hour as needed (oral). ESMO 2018: about 10–15%. Default = lower bound (simulator convention). |
| palliative_rule |  | PRN_MIN_INTERVAL_ORAL_MIN | 60 | min | guideline | S108 | NCCN: rescue dose every hour as needed; reassess ~60 min after an oral dose. |
| palliative_rule |  | PRN_MIN_INTERVAL_IV_MIN | 15 | min | guideline | S108 | NCCN (secondary summaries): reassess ~15 min after an IV dose. The simulator does not give an IV rescue dose sooner. |
| palliative_rule |  | TITRATION_INCREASE_PCT | "50–100" | % increase of the 24-h dose | guideline | S108 | NCCN (secondary summaries): if moderate-to-severe pain is unchanged or increased, increase the dose by 50–100%. Suggestion default = lower bound (simulator convention); the clinician approves or declines. |
| palliative_rule |  | TITRATION_PAIN_THRESHOLD | 4 | NRS 0–10 (24-h mean) | simulator_convention |  | "Moderate" pain taken as NRS ≥4 for the review suggestion (common NRS banding; not a cited cut-off). |
| palliative_rule |  | PRN_GIVE_PAIN_THRESHOLD | 4 | NRS 0–10 | simulator_convention |  | The simulated patient requests/receives the approved PRN dose when pain ≥4 and the minimum interval has passed (teaching convention). |
| palliative_rule |  | REVIEW_INTERVAL_H | 24 | h | simulator_convention |  | Daily review gate in guided mode (teaching cadence; not a cited interval). |
| palliative_rule |  | CONVERSION_ORAL_MORPHINE_TO_ORAL_OXYCODONE | 1.5 | mg oral morphine : 1 mg oral oxycodone | guideline | S109 | MASCC-ASCO 2025 consensus ratio 1.5:1. |
| palliative_rule |  | CONVERSION_ORAL_MORPHINE_TO_ORAL_HYDROMORPHONE | 5 | mg oral morphine : 1 mg oral hydromorphone | guideline | S109 | MASCC-ASCO 2025 consensus ratio 5:1. |
| palliative_rule |  | CONVERSION_ORAL_TO_IV_MORPHINE | "2–3" | mg oral morphine : 1 mg IV morphine | guideline | S107 | ESMO 2018: average relative potency oral:IV morphine between 1:2 and 1:3 [II, A]. Default 2:1 (gives the smaller IV dose; simulator convention). |
| palliative_rule |  | CROSS_TOLERANCE_REDUCTION_PCT | "0–50" | % reduction after conversion | guideline | S109 | MASCC-ASCO 2025: no panel consensus on a routine reduction for incomplete cross-tolerance; 25–50% is common practice (secondary commentary). The simulator has NO default: the clinician enters a value 0–50%. |
| palliative_rule |  | CDC_MME_FACTORS | "{\"morphine\":1,\"oxycodone\":1.5,\"hydromorphone\":5}" | MME per mg (oral) | guideline | S105 | CDC 2022 MME conversion factors (oral) — for estimating daily exposure (risk), NOT for converting between opioids; not defined for IV doses here. |
| palliative_rule |  | CDC_PAUSE_MME | 50 | MME/day | guideline | S105 | CDC 2022 Rec. 4: before increasing to ≥50 MME/day, pause and carefully reassess individual benefits and risks. Non-cancer modules only (out of CDC scope for cancer, palliative and end-of-life care). |
| palliative_rule |  | CDC_90_NOTE_MME | 90 | MME/day | guideline | S105 | Teaching note only: the 2016 guideline advised avoiding ≥90 MME/day or carefully justifying it; the 2022 guideline removed that threshold from its recommendations (still refers to the level). |
| palliative_rule |  | RR_ALARM | 8 | breaths/min (alarm if below) | guideline | S116 | Scottish Palliative Care Guidelines: naloxone titrated until respiratory status satisfactory (≥8 respirations/min). |
| palliative_rule |  | RASS_EXCESS | -3 | RASS (alarm at or below, when not the documented sedation target) | simulator_convention | S120 | Unintended sedation alarm: RASS ≤ −3 without a documented palliative-sedation target at that depth. Scale from Sessler 2002; the cut-off is a teaching convention. |
| palliative_rule |  | NALOXONE_DOSE_MG | 0.1 | mg per increment | guideline | S116, S14 | Scottish palliative guideline: 100 microgram IV boluses every 2 min, titrated to respiratory rate; FDA naloxone label 0.1–0.2 mg IV at 2–3 min intervals (S14). Never a full-reversal dose by default. |
| palliative_rule |  | NALOXONE_MIN_INTERVAL_MIN | 2 | min | guideline | S116, S14 | Repeat no sooner than every 2 min (IV). |
| palliative_rule |  | PROPORTIONALITY_ALARM_MIN | 30 | min deeper than the documented target | simulator_convention | S101 | Proportionality (S101) means the lowest sedation level that relieves the symptom; the 30-min persistence before the alarm is a teaching convention. |
| palliative_rule |  | COMFORT_NOT_ACHIEVED_SCORE | 4 | symptom score 0–10, sustained 60 min | simulator_convention |  | Alarm when the documented target symptom stays ≥4 for 60 min during sedation (teaching convention). The engine never escalates on its own. |
| palliative_rule |  | MIDAZOLAM_MAX_SIM_MG_H | 10 | mg/h | guideline | S101 | Framework: at doses above 10 mg/h consider adding or changing medication; second-line agents are not simulated, so the simulator stops at 10 mg/h (simulator hard stop anchored to the framework statement). |
| palliative_sedation | midazolam | midazolam light bolus SC / IV | "2.5 / 1.25" | mg | guideline | S101 | Revised EAPC framework step 1. |
| palliative_sedation | midazolam | midazolam deep bolus SC / IV | "5–10 / 2.5–5" | mg | guideline | S101 | Revised EAPC framework step 1; default = lower bound. |
| palliative_sedation | midazolam | midazolam repeat fraction / interval SC, IV | "0.5 / 20, 5" | × starting bolus / min | guideline | S101 | Half the starting bolus after 20 min SC or 5 min IV. |
| palliative_sedation | midazolam | midazolam infusion start | 1 | mg/h | guideline | S101 | Then adjust as needed (clinician-approved). |
| palliative_sedation | midazolam | light/deep ↔ RASS mapping | "light = target RASS −1 to −3; deep = −4 to −5 (simulator mapping)" |  | simulator_convention | S120 | The framework does not use RASS; mapping chosen for the simulator. |
| palliative_sedation |  | continuous deep sedation prognosis requirement | "hours_days" | prognosis category | guideline | S100, S117, S102 | 2009 EAPC: closeness to death relevant for continuous deep sedation; ASCO 2021: life expectancy of days; AMA 5.6: final stages. The 2024 revision specifies no period — the simulator keeps the conservative requirement. |
| palliative_model |  | delirium-risk factors (age ≥70, eGFR <30, ≥5 medicines, last hours–days, high opioid effect) | "≥3 high, ≥1 moderate" | count | author_estimate_unvalidated | S119 | Illustrative count; not a validated tool. |
| palliative_model |  | KA_ORAL_PER_MIN | 0.02 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | KE_PER_MIN | 0.0058 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | KE0_PER_MIN | 0.033 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | RENAL_KE_FACTOR | "{\"morphine\":{\"lt30\":0.5,\"lt60\":0.75},\"hydromorphone\":{\"lt30\":0.5,\"lt60\":0.75},\"oxycodone\":{\"lt30\":0.7,\"lt60\":0.8}}" |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | HEPATIC_KE_FACTOR | 0.75 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | IV_EFFECT_FACTOR | "{\"morphine\":2.5,\"hydromorphone\":12.5}" |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | EC50_BASE_OME | 6 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | EC50_PER_OME_DAY | 0.05 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | ANALGESIA_EMAX | 0.85 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | ANALGESIA_GAMMA | 1.5 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | SED_OPIOID_X50 | 5 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | SED_OPIOID_GAMMA | 2.5 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | RR_OPIOID_X50 | 6 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | RR_OPIOID_MAX | 0.7 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | MIDAZ_KA_SC_PER_MIN | 0.06 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | MIDAZ_KE_PER_MIN | 0.0067 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | MIDAZ_EC50_MG | 4.4 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | MIDAZ_GAMMA | 1.5 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | MIDAZ_AGITATION_MAX | 0.9 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | MIDAZ_RR_MAX | 2 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | NALOX_KE_PER_MIN | 0.017 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | NALOX_HALF_MG | 0.15 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | DYSPNOEA_OPIOID_MAX | 0.5 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | NONPHARM_RELIEF | 1 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | OXYGEN_RELIEF_HYPOXAEMIC | 1.5 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | POSITIONING_SECRETION_RELIEF | 1 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | CONSTIPATION_PER_H | 0.15 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | CONSTIPATION_WITH_BOWEL_PER_H | 0.03 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | NAUSEA_START | 3 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | NAUSEA_DECAY_DAYS | 2 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | AGITATION_TO_RASS | 0.45 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | NOISE_SD | 0.15 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |
| palliative_model |  | TREND_EVERY_MIN | 5 |  | author_estimate_unvalidated |  | Illustrative symptom / PK-PD model constant (not validated). |

## Advisory haemodynamic rescue
Generated from `engine/rescue-config.js` (`RESCUE_CONFIG`; logic in `engine/rescue.js`; card `ui/advisory.js`). Owner-approved feature (November 2026). On MAP below the trigger the Run screen (and the guided/automatic panel) shows an **advisory** that suggests one label-sourced rescue bolus; the clinician gives it with one click ("Give suggested bolus", logged `ADVISORY accepted`) or dismisses it (logged). Card text: "Advisory only — the simulator never gives a vasopressor by itself." The simulator never gives the suggested drug by itself — not in manual, guided or automatic-demonstration mode — and the advisory never acknowledges alarms or releases interlock holds. Doses are not written in the advisory module: they are read from the drug library rescue regimens (phenylephrine [S18], ephedrine [S19]) through `recommend()` and the label ceilings. MAP above the high threshold gives teaching text only (no drug, no dose). Epinephrine is never suggested for routine hypotension. Every non-drug checklist line is teaching text without doses: “Check anaesthetic depth and the volatile / hypnotic concentration — reduce if deeper than needed.” “Assess volume status and fluids given; consider a fluid bolus (Fluids panel).” “Look for surgical causes (bleeding, caval compression, retraction) and positioning — tell the surgeon.” “Rule out sensor artefact: check the cuff / transducer level and the waveform before treating a number.” The debrief and the session JSON (`summary.advisories`) list every advisory shown, accepted and dismissed, with times. Not validated; not clinical decision support.

16 entries (also in the parameter inventory as component `rescue`):

| Entry | Value | Unit | Provenance | Sources | Rationale |
|---|---|---|---|---|---|
| TRIGGER_MAP_BELOW | 65 (= ALARM_THRESHOLDS.MAP_LOW) | mmHg | simulator_convention |  | A rescue-bolus suggestion is offered only while MAP < this value (strict "<"; MAP = 65 gives no suggestion). Reuses the simulator MAP-low alarm threshold (sim.js ALARM_THRESHOLDS.MAP_LOW, a build-specification alarm value, not a clinical standard); not redefined here. |
| EPISODE_CLEAR_MAP_AT_OR_ABOVE | 67 (= ALARM_THRESHOLDS.MAP_LOW_CLEAR) | mmHg | simulator_convention |  | A hypotension episode (for the advisory record and for "Dismiss") ends when MAP ≥ this value — reuses the MAP-low alarm clearing hysteresis (sim.js ALARM_THRESHOLDS.MAP_LOW_CLEAR). Between the trigger and this value no dose is suggested. |
| HIGH_MAP_ADVICE_ABOVE | 120 (= ALARM_THRESHOLDS.MAP_HIGH) | mmHg | simulator_convention |  | MAP > this value (reuses sim.js ALARM_THRESHOLDS.MAP_HIGH, the map_high alarm) shows teaching text only — review depth and analgesia, check the sensor. No drug and no dose is suggested: no verified dosing source for an antihypertensive is in the drug library. |
| HIGH_MAP_EPISODE_CLEAR_AT_OR_BELOW | 118 (= ALARM_THRESHOLDS.MAP_HIGH_CLEAR) | mmHg | simulator_convention |  | The high-MAP advisory (text only) ends when MAP ≤ this value — reuses the map_high alarm clearing hysteresis (sim.js ALARM_THRESHOLDS.MAP_HIGH_CLEAR). |
| RESCUE_AGENTS | "phenylephrine, ephedrine" | drug ids | fda_label | S18, S19 | Agents the advisory may suggest. Dose, range, timing text and sources come from each drug's label rescue regimen in data/drugs.js (phenylephrine 40–100 mcg IV bolus [S18]; ephedrine 5–10 mg IV bolus [S19]) via dosing.js recommend(). Epinephrine is never suggested for routine hypotension: it stays a manual choice (the anaphylaxis scenario has its own guidance [S44, S45]). |
| REGIMEN_KEY | "rescue" | regimen key | fda_label | S18, S19 | Drug-library regimen read for the suggestion (label rescue bolus). |
| DOSE_CHOICE | "regimen default (label lower bound), capped by the per-bolus and cumulative maxima" | rule | simulator_convention |  | Suggested dose = the regimen default from recommend() (for both agents the label lower bound), never above the regimen maximum or a per-bolus ceiling, and reduced to what the cumulative label maximum still allows; if that is below the regimen minimum, no dose is suggested ("label maximum reached"). Choosing the lower bound is a simulator convention; the numbers are label values. |
| AGENT_SELECTION_HR_BELOW | 60 | /min | simulator_convention |  | Agent selection (simulator convention — no label or guideline statement giving this rule or threshold was verified): HR < 60 /min → ephedrine (mixed-acting; raises HR as well as MAP in this model); HR ≥ 60 /min → phenylephrine (alpha-agonist; reflex HR fall in this model). The directions mirror the illustrative PD profiles in engine/pd.js; 60 /min is a teaching value. An unusable HR reading gives no suggestion. |
| PHENYLEPHRINE_REPEAT_MIN_SEC | 60 | s | fda_label | S18 | After a phenylephrine bolus the next suggestion waits at least 60 s ("reassess — next dose allowed in mm:ss"): label — additional boluses may be administered every 1–2 minutes as needed [S18]; the lower bound is used. |
| EPHEDRINE_REPEAT_MIN_SEC | 120 | s | simulator_convention |  | After an ephedrine bolus the next suggestion waits at least 120 s. The ephedrine label gives no repeat interval (IV bolus "as needed"; tachyphylaxis possible [S19]), so this is a simulator convention (a conservative teaching pause equal to the upper end of the phenylephrine label interval). |
| OTHER_VASOPRESSOR_REASSESS_SEC | 120 | s | simulator_convention |  | After a bolus of any other vasopressor (e.g. epinephrine given manually) the advisory waits this long before suggesting phenylephrine or ephedrine. Simulator convention (no source). |
| REPEAT_INTERVAL_FROM | "last vasopressor bolus (any source)" | rule | simulator_convention |  | The interval runs from the most recent vasopressor bolus of any source (manual, plan or advisory) and uses the interval of the agent that was given. Simulator convention. |
| CUMULATIVE_MAX | "drug.ceiling (label maximum)" | rule | fda_label | S18, S19 | Cumulative maximum already given is read from the drug library ceiling: phenylephrine 200 mcg for all boluses in the session (conservative reading of the 2019 label [S18]); ephedrine 50 mg total [S19]. When the remaining allowance is below the regimen minimum the advisory shows "label maximum reached — consider other causes / escalate; not simulated". |
| SUPPRESS_DURING_ANAPHYLAXIS | true | boolean | simulator_convention |  | While the anaphylaxis scenario is active the advisory suggests no phenylephrine/ephedrine bolus and points to the scenario guidance (epinephrine, a manual choice [S44, S45]). Simulator convention. |
| SUPPRESS_ON_SENSOR_FAULT | true | boolean | simulator_convention |  | No dose is suggested while the MAP or HR reading is unusable (sensor fault / non-finite value); the card asks to check the sensor. Simulator convention. |
| NEVER_AUTO_ACCEPT | true | boolean | simulator_convention |  | The suggestion is never accepted automatically — not in manual, guided or automatic-demonstration mode. Only "Give suggested bolus" gives it (logged "ADVISORY accepted", clinician-approved). The advisory never acknowledges alarms and never releases interlock holds. Owner requirement; simulator convention. |

## Advisory: depth index below the GA band
Generated from `engine/depth-advisory.js` (card `ui/advisory.js` `depthAdvisoryCard`; settings in `engine/timing.js` `TIMING_CONFIG`). Owner-approved feature (November 2026), chosen instead of recalibrating the illustrative depth model, which reads about 34–39 at label-default maintenance doses. **Text only:** no drug, dose, rate or percentage is suggested; it is **not an alarm** (nothing is added to the alarm list, guided and automatic modes never pause for it, it never acknowledges anything and never changes a dose). Shown on the Run screen and in the guided/automatic panel when the simulated index stays below the GA band lower bound for the sustain time during GA maintenance **after incision** with the airway secured, after loss of consciousness, and not after every maintenance hypnotic is stopped once surgery has ended; never in MAC/sedation, before loss of consciousness or in emergence. Before incision the pre-incision item (acknowledge an index below the GA band) remains the gate. The only control is "Dismiss" (logged). If the MAP < 65 haemodynamic advisory is shown at the same time, each card names the other. Checklist: “Review the volatile concentration (end-tidal / MAC) or the propofol infusion rate against the plan.” “Consider haemodynamics: if the patient is hypotensive, anaesthetic depth may be contributing.” “Confirm the planned depth target and the current surgical stimulus.” “Check for sensor artefact (electrode contact, signal quality) before acting on a number.” Footnote: “Advisory only — the simulator never changes a dose by itself. Simulated index (illustrative); the 40–60 band is the protocol target used in B-Unaware/BAG-RECALL [S52][S53].” The debrief and the session JSON (`summary.depthAdvisories`) list every card shown and dismissed, with times, and the total time below the band. No outcome effect of deep anaesthesia is claimed. Not validated; not clinical decision support.

| Entry | Value | Unit | Provenance | Sources |
|---|---|---|---|---|
| GA_DEPTH_BAND | "40–60" | processed-EEG depth index (BIS-style, simulated) | trial protocol | S52, S53 |
| DEPTH_LOW_ADVISORY_SUSTAIN_SEC | 300 | s | simulator convention |  |
| DEPTH_LOW_ADVISORY_CLEAR | 42 | processed-EEG depth index (BIS-style, simulated) | simulator convention |  |

Rationale text for each entry: see the timing-rules table above and the parameter inventory (component `timing`); timing evidence row 65 ([TIMING_EVIDENCE.md](TIMING_EVIDENCE.md)).

## Sources
Full citations, what each supports, and how each was checked are in [SOURCES.md](SOURCES.md) (43 entries; plus S100–S120 for the palliative and end-of-life modules).

## AI assistance
Code, parameter selection and source gathering for this simulator were produced with AI assistance (Anthropic Claude, via Claude Code, November 2026) under the owner's direction. Sources were checked through web-search records of labels and publications as recorded in SOURCES.md; independent human verification of every source by the owner is pending. AI was not used to generate data presented as observed. The owner is responsible for the content.
