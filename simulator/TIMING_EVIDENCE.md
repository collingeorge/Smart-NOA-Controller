# Timing evidence — cross-check of every simulator timing against labels and guidelines

> **SIMULATION — fictional patients — educational use only. Not a medical device. Not medical advice.**
> This page compares the timings used by an educational simulator with what published labels and guidelines say. It is not a protocol and not a recommendation for any real patient.

Compiled 2026-11-05 (branch `autorun-2026-11`), after the November 2026 timing pass (`AUDIT_2026-11.md` → "Timing review"). Scope: every timed element in the technique templates (`data/templates.js`), the example plans (`data/scenarios.js`), the guided-mode gates and full-automatic settings (`engine/autorun-config.js`) and the timing-validator thresholds (`engine/timing.js` `TIMING_CONFIG`).

## How the sources were checked (read this first)

- **Page fetches were not possible.** Direct fetches were refused by this session's egress proxy (HTTP 403 on CONNECT to `www.accessdata.fda.gov` and `pubmed.ncbi.nlm.nih.gov`; WebFetch failed to resolve accessdata.fda.gov). No label PDF or guideline full text was opened.
- **What was used instead:** WebSearch result records (2026-11-05). Each record is a search-engine result list plus a short extract of the matching pages. "Seen" below means the statement appeared in such an extract, attributed to the page named. Quotation marks are used only where the extract gave the wording; otherwise the statement is summarised and marked *(summary)*.
- **Where a statement was not found,** the row says so and the element is not called "agrees". Nothing was filled in from memory.
- Source ids (S1–S56) are the entries in `data/drugs.js` `SOURCES` / `SOURCES.md`. **New this check: S55 (DAS 2015) and S56 (ASA 2022 difficult airway).** S32 gained the titration statement. Sources consulted but not added to the registry (no simulator value depends on them) are named in full in the table.

**Agreement** — *agrees*: the source states this timing (or the simulator value is inside what it states); *partially*: the source supports the direction or an end point but not the number, or the simulator is narrower/different in form without contradicting it; *conflicts*: the simulator timing contradicts a label/guideline statement; *no published timing*: no label, guideline or verified trial statement gives a time for this element.
**Classification** — *label-stated* / *guideline-stated* (includes consensus statements and trial protocols) / *practice convention (owner)* / *simulator convention*.

## Summary

| Agreement | Rows |
|---|---|
| agrees | 21 |
| partially | 8 |
| conflicts | 1 (fixed) |
| no published timing | 25 |
| **total** | **55** |

**Added after this check (November 2026, section G, rows 56–63; row 64 added with the final-check fixes; row 65 with the depth-low advisory):** advisory rescue and MAC sedation-titration timings (rows 56–63) — agrees 3, no published timing 5 (all simulator conventions); rows 64–65 (depth-high alarm, depth-low advisory) — no published timing 2 (simulator conventions). The counts above cover rows 1–55 only; no row 1–55 was changed. Sources for rows 56–60 are the existing registry records (S18, S19); no new search was made for them.

**The one conflict:** `mac_propofol` template and the MAC example plan (`mac_obese_osa`) started the propofol MAC-sedation initiation at sedation +2:00 — the moment the midazolam injection (given over ≥ 2 min) ends, before its effect could be evaluated. Midazolam label: give over at least 2 minutes and wait an additional 2 or more minutes to fully evaluate the sedative effect [S17]; ASA 2018 moderate-sedation guideline: allow sufficient time between doses to assess the effect of each [S32]. **Fix:** propofol initiation now starts at +4:00 (maintenance at +9:00), recorded as `TIMING_CONFIG.MAC_SEDATIVE_AFTER_MIDAZOLAM_SEC` = 240 s (provenance label, S17/S32); test T2 checks the template, the example plan and the config value agree. No dose changed.

**Other changes (documentation only, no timing changed):** `TIMING_CONFIG.PREOXYGENATION_END_POINT` records the DAS 2015 end point (end-tidal O2 fraction 0.87–0.9, S55) and the ASA 2022 oxygen statement (S56); end-tidal O2 is not modelled, so the 3-min preoxygenation gate stays a simulator convention.

## Evidence table

### A. Pre-op holding → OR → induction

| # | Element | Simulator value | Published statement(s) — source, what it says (how seen) | Agreement | Classification | Action |
|---|---|---|---|---|---|---|
| 1 | Maintenance crystalloid start (all templates) | pre-op holding / sedation +0:00 | Lactated Ringer's label: dosage "based on age, weight, clinical condition and concomitant therapy" — no fixed dose or time [S47] (prior registry record). | no published timing | simulator convention | none |
| 2 | Antibiotic prophylaxis start and pre-incision window | started in pre-op holding (+0:00); pre-incision gate **requires** a dose begun within 60 min (vancomycin 120 min) before incision | Bratzler 2013 [S46]: first dose "within 60 minutes before surgical incision"; vancomycin and fluoroquinolones "within 120 minutes" (UNMC protocol quoting the guideline; ASHP guideline text itself not opened — secondary records only). WHO Surgical Safety Checklist [S54]: Time Out item "Has antibiotic prophylaxis been given within the last 60 minutes?" (WHO implementation-manual copy, leapfroggroup.org). ERAS Society colorectal 2018 (Gustafsson et al., World J Surg 2019;43(3):659-695; not in registry): secondary records disagree ("within 60 min" vs "30–60 min"), not used. | agrees | guideline-stated | none |
| 3 | Antibiotic redosing interval | cefazolin 4 h, clindamycin 6 h, measured from the start of the pre-op dose; vancomycin no routine redose | Bratzler 2013 [S46] *(secondary)*: "The redosing interval should be measured from the time of administration of the preoperative dose, not from the beginning of the procedure"; cefazolin 4 h, clindamycin 6 h (ASA quality-measure document, UNMC, CHOC). Vancomycin: secondary institutional documents give q8h or q12h; the registry entry (prior record of the CHOC Table 1 reproduction) gives "not applicable". | partially | guideline-stated | none (cefazolin/clindamycin agree; vancomycin redose wording unresolved — simulated cases last ≈ 1 h, so it never fires) — flagged for clinician review |
| 4 | Premedication midazolam → *Transfer to OR* | IV midazolam in pre-op holding; transfer ≥ 5 min after the bolus **ends** | Midazolam label [S17]: "sedation … is achieved within 3 to 5 minutes after intravenous (IV) injection" (DailyMed midazolam listing, Pfizer clinical-pharmacology page). IM premedication "about an hour before surgery" was seen only in non-US labels (Rwanda FDA SmPC, Australian PI) and is not used (IV route modelled). | agrees | practice convention (owner), label-supported | none |
| 5 | Midazolam injection duration | over ≥ 2 min | Midazolam label [S17]: initial dose "over a period of at least 2 minutes" (Benzosed SmPC record); US label: "wait an additional 2 or more minutes to fully evaluate the sedative effect" (Pfizer dosage page record). | agrees | label-stated | none |
| 6 | OR setup (transfer, monitors) | 2 min (`OR_SETUP_SEC`) | None found. | no published timing | simulator convention | none |
| 7 | Preoxygenation duration | FiO2 1.0 for 3 min (`PREOXYGENATION_SEC`) | DAS 2015 [S55]: all patients preoxygenated with 100% oxygen, face-mask seal maintained "until the end-tidal oxygen fraction is 0.87–0.9" (PMC4650961 record); head-up 20–25° with CPAP delays hypoxia in obese patients. **No duration** in the DAS 2015 text seen. ASA 2022 difficult airway [S56]: "administer supplemental oxygen before initiating management of the difficult airway" (secondary reproductions; APSF update). 3-min tidal breathing appears only in secondary literature (Can J Anaesth 2005 study; obstetric review). DAS 2025 (Ahmad I, et al., Br J Anaesth 2026;136(1):283-307; PMID 41203471; not in registry): exists; its preoxygenation target was not confirmed (records disagreed). | partially | simulator convention (guideline end point recorded) | added `PREOXYGENATION_END_POINT` (S55, S56) and rationale text; value unchanged (end-tidal O2 not modelled) |
| 8 | Premedication end → *Start induction* | ≥ 10 min (5 + 2 + 3, `PREMED_TO_INDUCTION_MIN_SEC`) | Sum of rows 4, 6, 7; no source gives the total. | no published timing | simulator convention (composite) | none |
| 9 | Full demonstration dwell before *Transfer to OR* | ≥ 60 s (`PRE_INDUCTION_DWELL_SEC`) | None. | no published timing | simulator convention | none |

### B. Induction

| # | Element | Simulator value | Published statement(s) | Agreement | Classification | Action |
|---|---|---|---|---|---|---|
| 10 | Opioid → hypnotic spacing | fentanyl at induction +0:00, propofol +3:00 (`OPIOID_LEAD_SEC` 180 s) | Fentanyl label [S13]: "The onset of action of fentanyl is almost immediate when the drug is given intravenously; however, the maximal analgesic and respiratory depressant effect may not be noted for several minutes" (pfizermedicalinformation.com clinical-pharmacology record). No number. | partially | simulator convention (anchored to label) | none |
| 11 | Dexamethasone (PONV) | at induction +0:00 | Fourth PONV consensus, Gan 2020 [S2]: Table 4 as summarised by APSF — "Dexamethasone 4-8mg IV given at induction". Fifth consensus, Gan 2025 [S3]: timing **not** confirmed in this session's records (executive summary and full-report PDF listed, text not seen); prior registry record states the same timing. PROSPECT (ESRA; not in registry): procedure-specific — e.g. THA 2019 "single intra-operative dose" 8–10 mg — the simulator has no procedure-specific analgesic plan, so not applied. | agrees | guideline-stated | none |
| 12 | Lidocaine pretreatment → propofol | 10 s before propofol (`+2:50`); plan check ≤ 60 s gap (`PRETREATMENT_MAX_GAP_SEC`) | Propofol (Diprivan) label [S11]: "If lidocaine is to be administered to minimize pain on injection of DIPRIVAN, it is recommended that it be administered prior to DIPRIVAN administration or that it be added to DIPRIVAN immediately before administration" (Guideline Central label copy; prescriberpoint record). Gap values not in the label. | agrees | label-stated (order); simulator convention (10 s / 60 s) | none |
| 13 | Propofol onset (drives "after loss of consciousness") | 40 s (`timing.onsetMin` 0.67) | Propofol label [S11]: "induces hypnosis with minimal excitation, usually within 40 seconds from the start of injection (the time for one arm-brain circulation)" (ndclist generic label; FDA-hosted 2014 label listed). | agrees | label-stated | none |
| 14 | Neuromuscular blocker after loss of consciousness | rocuronium 60 s after propofol (+4:00 / OFA +2:00); plan check ≥ hypnotic label onset (`NMB_AFTER_HYPNOTIC`) | Propofol onset 40 s (row 13). Wording that rocuronium be given only once the patient is unconscious was seen only in a blog reproduction of Zemuron text — **not confirmed in a label record**. | agrees | label-stated (onset); simulator convention (60 s) | none |
| 15 | Opioid-free template: propofol after adjunct infusions start | +1:00 | None. | no published timing | simulator convention | none |
| 16 | Time to intubating conditions; *Intubate* gate | state-gated: all induction steps run, depth index ≤ 60, TOF count ≤ 1; timeout 600 s | Rocuronium label [S12]: 0.6–1.2 mg/kg "will provide excellent or good intubating conditions in most patients in less than 2 minutes" (archived Zemuron PI, webarchive.library.unt.edu); Pfizer clinical studies: conditions "generally achieved within 2 minutes and maximum block occurred within 3 minutes in most patients". The gate waits for state, which is compatible; the TOF ≤ 1 / index ≤ 60 thresholds are not label numbers. | partially | label-stated (time); simulator convention (thresholds) | none |
| 17 | Rocuronium dose and onset (0.6 vs 1.2 mg/kg; RSI) | 0.6 mg/kg intubating dose; peak block ≤ 3 min (drug timing) | Rocuronium label [S12]: initial dose 0.6 mg/kg; rapid sequence 0.6–1.2 mg/kg, < 2 min to good/excellent conditions (records as row 16). A non-US label (Gland "Rocsur", MIMS Malaysia record) recommends 1.0 mg/kg for RSI and intubating 90 s after 0.6 mg/kg — not the US label, not used. | agrees | label-stated | none |
| 18 | Succinylcholine onset (drug library; no template uses it) | onset ≈ 1 min, max ≈ 2 min, recovery 4–6 min | Succinylcholine label [S24] — prior registry record (medlibrary Anectine copies). This session's search did **not** retrieve the label wording (only trials and reviews). | agrees | label-stated (prior record; not re-seen this session) | none |
| 19 | Rapid-sequence induction | no RSI technique or ICU population is modelled | SCCM 2023 RSI guideline, critically ill adults (Acquisto NM, et al. Crit Care Med 2023;51(10); PMID 37707379 seen in qxmd record; not in registry): suggests HFNO preoxygenation when laryngoscopy is expected to be challenging, NIPPV if PaO2/FiO2 < 150; "either rocuronium or succinylcholine" when no contraindication to succinylcholine; a sedative-hypnotic whenever an NMBA is used (sccm.org / guidelinecentral records). **No timing numbers; population = critically ill adults, not the elective adults simulated.** | no published timing | — (not applicable) | none |

### C. Maintenance and pre-incision

| # | Element | Simulator value | Published statement(s) | Agreement | Classification | Action |
|---|---|---|---|---|---|---|
| 20 | Volatile (or propofol infusion) start | maintenance +0:00, after the airway is secured | None. | no published timing | simulator convention | none |
| 21 | Full demonstration: airway → maintenance | 60 s (`MAINTENANCE_AFTER_AIRWAY_SEC`) | None. | no published timing | simulator convention | none |
| 22 | IV lidocaine loading → infusion (opioid-free) | loading over ≈ 10 min from induction; infusion starts when it ends (`afterLoadingOf`) | Foo 2021 [S1]: "an initial dose of no more than 1.5 [mg/kg], calculated using the patient's ideal body weight and given as an infusion over 10 min. Thereafter, an infusion of no more than 1.5 mg.kg-1.h-1 for no longer than 24 h is recommended, subject to review and re-assessment" (Glasgow/Nottingham repository records). | agrees | guideline-stated (consensus) | none |
| 23 | Dexmedetomidine adjunct start (opioid-free) | infusion at induction +0:00, no loading dose | Precedex label [S9] gives loading → maintenance only for procedural/ICU sedation; GA-adjunct use is off-label. No start time found. | no published timing | simulator convention | none |
| 24 | Ketamine adjunct start (opioid-free) | infusion at induction +0:00 | Schwenk 2018 ketamine consensus [S10]: this session's records showed only scope and citation (Reg Anesth Pain Med 2018;43(5):456-466); no start or stop time seen. | no published timing | simulator convention | none |
| 25 | Loading → maintenance (any infusion) | maintenance at loading start + loading duration (`LOADING_THEN_MAINTENANCE`) | Precedex [S9]: "Initiate at one mcg/kg over 10 minutes, followed by a maintenance infusion initiated at 0.6 mcg/kg/hour" (labeling.pfizer.com / DailyMed records). Propofol MAC [S11]: slow injection 0.5 mg/kg over 3–5 min, then 25–75 mcg/kg/min during the first 10–15 min of maintenance *(summary: Optum, RxList, GlobalRPH label extracts)*. Foo 2021 [S1] as row 22. | agrees | label-stated / guideline-stated | none |
| 26 | Rocuronium top-up | held until TOF count ≥ 3 (`ROCURONIUM_TOPUP_TOF_COUNT_MIN`) | Zemuron label [S12]: maintenance doses of 0.1, 0.15 and 0.2 mg/kg "administered at 25% recovery of control T1 (defined as 3 twitches of train-of-four)" (archived FDA-hosted Zemuron PI; Pfizer generic label §2.4 record). Newer labels: guided by response / when recovery is evident — compatible. | agrees | label-stated | none |
| 27 | Repeat midazolam bolus | ≥ 4 min after the previous one (`MIDAZOLAM_REPEAT_MIN_SEC`) | Midazolam label [S17]: over ≥ 2 min, then "wait an additional 2 or more minutes to fully evaluate the sedative effect" (Pfizer dosage page record). | agrees | label-stated | none |
| 28 | Pre-incision: processed-EEG index in GA band | 40–60 (`GA_DEPTH_BAND`; < 40 needs acknowledgement, > 60 blocks) | B-Unaware [S52]: BIS-guided group targeted 40–60 vs end-tidal gas 0.7–1.3 MAC; 2 definite awareness cases per group (WashU news release record). BAG-RECALL [S53]: alert below 40 / above 60 (prior record). Trial protocol targets, not evidence of benefit; the simulated index is not BIS. | agrees | guideline-stated (trial protocol) | none |
| 29 | Intubation depth threshold | index ≤ 60 (`INTUBATION_DEPTH_MAX`) | Upper bound of the trial maintenance band (row 28); the trials do not address intubation. | partially | simulator convention | none |
| 30 | Pre-incision: TOF count | ≤ 2 if an NMB is planned (`NMB_SURGERY_TOF_COUNT_MAX`) | No label or guideline surgical-relaxation TOF target found (Thilen 2023 addresses monitoring and reversal, not surgical depth). | no published timing | simulator convention | none |
| 31 | Pre-incision: WHO Time Out | required, clinician-confirmed (`TIME_OUT_REQUIRED`) | WHO checklist [S54]: Time Out "before skin incision" (Wikipedia/WHO manual records). | agrees | guideline-stated | none |
| 32 | Pre-incision gate timeout | 900 s (`SURGERY_START_TIMEOUT_SEC`) | None. | no published timing | simulator convention | none |

### D. End of surgery and emergence

| # | Element | Simulator value | Published statement(s) | Agreement | Classification | Action |
|---|---|---|---|---|---|---|
| 33 | Surgery duration and closing (full demonstration) | 30 min; emergence 5 min after End surgery | None (teaching durations). | no published timing | simulator convention | none |
| 34 | Dexmedetomidine stop (opioid-free) | 15 min before the planned end of surgery (`DEX_STOP_BEFORE_END_SEC`) | No label/guideline statement. Search records mention other protocols stopping "when skin suturing begins" (gynaecologic laparoscopy protocol) or "15–30 minutes before the procedure ended" (small ophthalmic series); the POFA stop rule [S49] was not confirmed. None verified in primary text. | no published timing | simulator convention | none |
| 35 | Ketamine stop | at emergence +0:00 | Schwenk 2018 [S10]: no stop time seen. | no published timing | simulator convention | none |
| 36 | IV lidocaine stop | at emergence +0:00 | Foo 2021 [S1]: infusion "for no longer than 24 h … subject to review and re-assessment" (row 22). Stopping at emergence is inside that limit; no stop time is required by the consensus. | partially | simulator convention (inside guideline limit) | none |
| 37 | Volatile off | emergence +0:00 | None. | no published timing | simulator convention | none |
| 38 | 5-HT3 antagonist (ondansetron) | at emergence +0:00 (after End surgery) | Gan 2020 [S2] Table 4 via APSF: "Ondansetron 4mg IV given at the end of surgery". Gan 2025 [S3]: not confirmed this session (see row 11). | agrees | guideline-stated | none |
| 39 | Reversal dose vs depth of block | sugammadex dose compared with TOF/PTC depth when given (label tiers) | Bridion label [S6]: 4 mg/kg at 1–2 post-tetanic counts with no TOF response; 16 mg/kg for immediate reversal (Merck dosing guide and drugs.com label records); the 2 mg/kg (reappearance of T2) sentence was cut off in this session's record (prior registry record). Thilen 2023 [S5]: sugammadex for deep, moderate and shallow rocuronium/vecuronium block; neostigmine reasonable at minimal depth (TOFR 0.4 to < 0.9) (APSF / MPOG records). | agrees | label-stated / guideline-stated | none |
| 40 | Reversal time point | sugammadex 30 s after the agents are off | Neither the label nor Thilen 2023 gives a time point relative to the anaesthetic agents; Thilen: deeper blocks "will require more time to attain a TOF ratio ≥ 0.9" (APSF record). | no published timing | simulator convention | none |
| 41 | Extubation criterion | TOFR ≥ 0.9 (`EXTUBATION_TOFR_MIN`) within `extubationReadiness()` | Thilen 2023 [S5]: "When using quantitative monitoring, we recommend confirming a train-of-four ratio greater than or equal to 0.9 before extubation" (guidelinecentral / healthday records). | agrees | guideline-stated | none |
| 42 | Readiness hold / extubation timeout | 10 s hold; 1800 s timeout | None. | no published timing | simulator convention | none |
| 43 | Post-extubation observation | 300 s, then "case complete" | None for this teaching end point (not a PACU discharge criterion). | no published timing | simulator convention | none |

### E. MAC / procedural sedation

| # | Element | Simulator value | Published statement(s) | Agreement | Classification | Action |
|---|---|---|---|---|---|---|
| 44 | Supplemental oxygen at *Start sedation* | FiO2 0.4 at sedation +0:00 | None for the time point. | no published timing | simulator convention | none |
| 45 | mac_dex: dexmedetomidine loading → maintenance | loading 1 mcg/kg over 10 min; maintenance at +10:00 | Precedex label [S9] (row 25). | agrees | label-stated | none |
| 46 | mac_dex: optional midazolam supplementation | sedation +0:00 (with the loading start); optional, off by default | Precedex label studies [S9]: rescue midazolam permitted as needed to achieve/maintain the target (prior registry record). ASA 2018 [S32]: titrate and allow time to assess each dose *(summary)*. Co-starting is not addressed by either. | partially | label-supported; simulator convention (time) | none — flagged for clinician review |
| 47 | mac_dex: optional propofol supplementation | +10:00 (when the loading ends); optional, off by default | Propofol MAC initiation over 3–5 min [S11]; no statement on timing relative to dexmedetomidine loading. | partially | simulator convention | none — flagged for clinician review |
| 48 | mac_propofol: midazolam first | +0:00, over ≥ 2 min | Midazolam label [S17] (row 5). | agrees | label-stated | none |
| 49 | **mac_propofol and MAC example plan: propofol start after midazolam** | **was +2:00 → now +4:00** (`MAC_SEDATIVE_AFTER_MIDAZOLAM_SEC` 240 s) | Midazolam label [S17]: give over ≥ 2 min, then "wait an additional 2 or more minutes to fully evaluate the sedative effect" (Pfizer dosage page record). ASA 2018 moderate procedural sedation [S32] *(summary of LWW/PDF reproductions; verbatim sentence not retrieved)*: IV sedatives titrated in small increments, with sufficient time between doses for the effect of each to be assessed. +2:00 started a second sedative at the moment the midazolam injection ended. | **conflicts** | label-stated / guideline-stated | **fixed**: `data/templates.js` mac_propofol and `data/scenarios.js` mac_obese_osa → 240 s; maintenance now +9:00; test T2 updated |
| 50 | Propofol MAC initiation → maintenance | 0.5 mg/kg over 5 min, then maintenance | Propofol label [S11]: slow injection 0.5 mg/kg over 3–5 min; slow infusion/injection preferable to rapid bolus; 25–75 mcg/kg/min during the first 10–15 min *(summary: label extracts)* (row 25). | agrees | label-stated | none |
| 51 | *Start procedure* gate: sedation target held | ASA continuum level held 10 s; timeout 900 s | ASA continuum statement [S31] defines the levels; no time. | no published timing | guideline-stated (levels); simulator convention (times) | none |
| 52 | Procedure duration (full demonstration) | 20 min | None. | no published timing | simulator convention | none |
| 53 | Sedative stops | at the end of the procedure (recovery) | None. | no published timing | simulator convention | none |
| 54 | Recovery end point | sedation level minimal/awake held 10 s; timeout 1800 s | ASA 2018 [S32] added recovery-care recommendations and discharge criteria aimed at minimising cardiorespiratory and CNS risk *(summary; CADTH record)*; no time given. The simulator end point is labelled a teaching end point, not a discharge criterion. | no published timing | simulator convention | none |

### F. Validator mechanics

| # | Element | Simulator value | Published statement(s) | Agreement | Classification | Action |
|---|---|---|---|---|---|---|
| 55 | Live-check tolerance | 1 s (`STEP_TOLERANCE_SEC`; 1-Hz engine) | Engine artefact. | no published timing | simulator convention | none |

Plan/live checks that re-use rows above (PONV, antibiotic window/redose, reversal, repeat boluses, opioid → hypnotic, pretreatment, hypnotic → NMB, loading → maintenance) carry the same agreement as those rows.

### G. Advisory haemodynamic rescue and MAC sedation titration (added November 2026)

| # | Element | Simulator value | Published statement(s) — source, what it says (how seen) | Agreement | Classification | Action |
|---|---|---|---|---|---|---|
| 56 | Advisory: phenylephrine repeat interval | next suggestion ≥ 60 s after a phenylephrine bolus (`RESCUE_CONFIG.PHENYLEPHRINE_REPEAT_MIN_SEC`) | Biorphen label [S18]: "Additional boluses may be administered every 1-2 minutes as needed" (registry record: WebSearch of the FDA-hosted 2019 label and ndclist.com copies). Lower bound used. | agrees | label-stated | none |
| 57 | Advisory: ephedrine reassessment pause | 120 s after an ephedrine bolus (`EPHEDRINE_REPEAT_MIN_SEC`) | Akovaz label [S19]: IV bolus 5–10 mg "as needed" — no interval (registry record). | no published timing | simulator convention | none |
| 58 | Advisory: pause after any other vasopressor bolus | 120 s (`OTHER_VASOPRESSOR_REASSESS_SEC`) | None for this use. | no published timing | simulator convention | none |
| 59 | Advisory: phenylephrine cumulative maximum | all boluses in the session ≤ 200 mcg (drug-library ceiling) | Biorphen 2019 label [S18]: "not to exceed a total dosage of 200 mcg"; some later copies read "additional boluses up to 200 mcg" (registry record). The simulator applies the conservative 2019 reading. | agrees | label-stated | none (wording difference already recorded in SOURCES.md) |
| 60 | Advisory: ephedrine cumulative maximum | ≤ 50 mg in all (drug-library ceiling) | Akovaz label [S19]: "not to exceed 50 mg" (registry record: drugs.com / medlibrary.org label copies). | agrees | label-stated | none |
| 61 | Guided titration: midazolam repeat step | ≥ 4 min after the previous midazolam bolus (reuses `MIDAZOLAM_REPEAT_MIN_SEC`, row 27) | Midazolam label [S17] as row 27. | agrees | label-stated | none |
| 62 | Guided titration: reassessment after an infusion-rate step | 180 s (`AUTORUN_CONFIG.SEDATION_TITRATION_REASSESS_SEC`) | ASA 2018 moderate sedation [S32]: allow sufficient time between doses to assess the effect of each *(summary; no number)*; propofol label [S11] gives no titration interval. | no published timing | simulator convention | none |
| 63 | Full demonstration: pause when sedation stays below the target | 300 s after the last sedation plan step (`SEDATION_BELOW_TARGET_PAUSE_SEC`) | None. | no published timing | simulator convention | none |
| 64 | Depth-high (awareness-risk) alarm: sustain duration | index > 60 (GA band upper bound, row 28) for ≥ 60 s during GA with the airway secured (`TIMING_CONFIG.DEPTH_HIGH_ALARM_SUSTAIN_SEC`; clears at ≤ 58, `DEPTH_HIGH_ALARM_CLEAR`) — added in the final-check fixes, November 2026 | None for this use; the band is from B-Unaware [S52] / BAG-RECALL [S53] (row 28), the duration is not. | no published timing | simulator convention | none |
| 65 | Depth-low advisory (text only, not an alarm): sustain duration | index < 40 (GA band lower bound, row 28) for ≥ 300 s (was 120 s in 05k; lengthened in 05l to limit alert fatigue) during GA maintenance after incision with the airway secured (`TIMING_CONFIG.DEPTH_LOW_ADVISORY_SUSTAIN_SEC`; ends at ≥ 42, `DEPTH_LOW_ADVISORY_CLEAR`) — added November 2026 (owner-approved, instead of recalibrating the illustrative depth model) | None for this use; the band is from B-Unaware [S52] / BAG-RECALL [S53] (row 28), the duration and hysteresis are not. No new search was made. | no published timing | simulator convention | none |
| 66 | Repeat phenylephrine IV bolus | ≥ 60 s after the previous one (`TIMING_CONFIG.PHENYLEPHRINE_REPEAT_MIN_SEC`; a planned repeat waits, a manual one is warned and recorded) — added November 2026 (emergency-rescue stress matrix) | Biorphen label [S18] as recorded in the source registry: additional boluses every 1–2 min as needed (same statement as the advisory interval, row 56). No new search was made. | agrees (lower bound) | label-stated | none |
| 67 | Repeat glycopyrrolate IV bolus (intraoperative) | ≥ 120 s after the previous one outside emergence (`GLYCOPYRROLATE_RESCUE_REPEAT_MIN_SEC`) — added November 2026 | Glycopyrrolate label [S8] as recorded in the source registry: intraoperative 0.1 mg IV, repeated as needed at 2–3 min intervals. No new search was made. | agrees (lower bound) | label-stated | none |
| 68 | Repeat IM/SC epinephrine injection | ≥ 300 s after the previous IM/SC injection (`EPINEPHRINE_IM_REPEAT_MIN_SEC`; IV boluses not gated) — added November 2026 | Epinephrine label [S40] as recorded in the source registry: anaphylaxis 0.3–0.5 mg IM/SC, repeated every 5 to 10 minutes as necessary. IV: UK perioperative guidance [S44, S45] gives "titrated to effect", no interval. No new search was made. | agrees (lower bound) | label-stated | none |

## Sources verified in this check, and what could not be accessed

Verified through WebSearch records (2026-11-05): FDA-label statements for propofol [S11], midazolam [S17], fentanyl [S13], rocuronium [S12], dexmedetomidine [S9], sugammadex [S6] (4 and 16 mg/kg tiers); Thilen 2023 [S5]; Gan 2020 [S2] (via the APSF Table 4 summary); Bratzler 2013 [S46] (secondary reproductions only); WHO checklist [S54]; Foo 2021 [S1]; B-Unaware [S52]; DAS 2015 [S55]; ASA 2022 difficult airway [S56] (secondary reproductions); ASA 2018 moderate sedation [S32] (summary only); SCCM 2023 RSI (recommendations, no timing); DAS 2025, ERAS colorectal 2018, PROSPECT (citations/fragments only).

**Not accessible / not confirmed:** every label PDF and guideline full text (fetches refused); Gan 2025 [S3] timing; Schwenk 2018 [S10] dosing/stop text; succinylcholine [S24] label wording (relies on the prior record); sugammadex 2 mg/kg sentence; ASA 2018 verbatim titration sentence; DAS 2025 preoxygenation target; POFA [S49] stop rule; a label sentence requiring rocuronium after unconsciousness.

## Clinician review

**No clinician review has been recorded** (as of 2026-11-05). An attending anesthesiologist or CRNA can mark each element below. Record the reviewer's name, credential and date at the top when a review is done; until then, every timing above remains an AI-assisted reading of search records.

Reviewer: ______________________  Credential: ________  Date: __________

| # | Element | Agree | Disagree | Comment |
|---|---|---|---|---|
| 1 | Maintenance crystalloid start | [ ] | [ ] | |
| 2 | Antibiotic start and 60/120-min pre-incision window | [ ] | [ ] | |
| 3 | Antibiotic redosing (cefazolin 4 h, clindamycin 6 h, from the start of the dose; vancomycin) | [ ] | [ ] | |
| 4 | IV midazolam premedication, transfer ≥ 5 min after the bolus ends | [ ] | [ ] | |
| 5 | Midazolam injection over ≥ 2 min | [ ] | [ ] | |
| 6 | OR setup 2 min | [ ] | [ ] | |
| 7 | Preoxygenation 3 min (no end-tidal O2 modelled) | [ ] | [ ] | |
| 8 | ≥ 10 min premedication end → induction | [ ] | [ ] | |
| 9 | 60-s dwell before transfer (demonstration) | [ ] | [ ] | |
| 10 | Fentanyl 3 min before propofol | [ ] | [ ] | |
| 11 | Dexamethasone at induction | [ ] | [ ] | |
| 12 | Lidocaine pretreatment 10 s (≤ 60 s) before propofol | [ ] | [ ] | |
| 13 | Propofol onset 40 s | [ ] | [ ] | |
| 14 | Rocuronium 60 s after propofol | [ ] | [ ] | |
| 15 | Opioid-free: propofol 1 min after adjuncts | [ ] | [ ] | |
| 16 | Intubate gate (TOF ≤ 1, index ≤ 60, timeout 10 min) | [ ] | [ ] | |
| 17 | Rocuronium 0.6 mg/kg onset; RSI dose range | [ ] | [ ] | |
| 18 | Succinylcholine onset/duration | [ ] | [ ] | |
| 19 | RSI not modelled (SCCM 2023 is ICU population) | [ ] | [ ] | |
| 20 | Volatile start after airway | [ ] | [ ] | |
| 21 | Airway → maintenance 60 s (demonstration) | [ ] | [ ] | |
| 22 | IV lidocaine loading 10 min → infusion | [ ] | [ ] | |
| 23 | Dexmedetomidine adjunct at induction, no loading | [ ] | [ ] | |
| 24 | Ketamine adjunct at induction | [ ] | [ ] | |
| 25 | Loading → maintenance rule | [ ] | [ ] | |
| 26 | Rocuronium top-up at TOF count ≥ 3 | [ ] | [ ] | |
| 27 | Repeat midazolam ≥ 4 min | [ ] | [ ] | |
| 28 | Pre-incision index band 40–60 | [ ] | [ ] | |
| 29 | Intubation index ≤ 60 | [ ] | [ ] | |
| 30 | Pre-incision TOF count ≤ 2 | [ ] | [ ] | |
| 31 | WHO Time Out before incision | [ ] | [ ] | |
| 32 | Pre-incision gate timeout 15 min | [ ] | [ ] | |
| 33 | Surgery 30 min, closing 5 min (demonstration) | [ ] | [ ] | |
| 34 | Dexmedetomidine stop 15 min before end | [ ] | [ ] | |
| 35 | Ketamine stop at emergence | [ ] | [ ] | |
| 36 | IV lidocaine stop at emergence | [ ] | [ ] | |
| 37 | Volatile off at emergence | [ ] | [ ] | |
| 38 | Ondansetron at end of surgery | [ ] | [ ] | |
| 39 | Sugammadex dose vs depth of block | [ ] | [ ] | |
| 40 | Sugammadex 30 s after agents off | [ ] | [ ] | |
| 41 | Extubation at TOFR ≥ 0.9 | [ ] | [ ] | |
| 42 | Readiness hold 10 s; timeout 30 min | [ ] | [ ] | |
| 43 | Post-extubation observation 5 min | [ ] | [ ] | |
| 44 | FiO2 0.4 at start of sedation | [ ] | [ ] | |
| 45 | mac_dex loading 10 min → maintenance | [ ] | [ ] | |
| 46 | mac_dex optional midazolam at +0:00 | [ ] | [ ] | |
| 47 | mac_dex optional propofol at +10:00 | [ ] | [ ] | |
| 48 | mac_propofol midazolam first, over ≥ 2 min | [ ] | [ ] | |
| 49 | mac_propofol propofol at +4:00 (changed from +2:00) | [ ] | [ ] | |
| 50 | Propofol MAC initiation 5 min → maintenance | [ ] | [ ] | |
| 51 | Sedation target held 10 s; timeout 15 min | [ ] | [ ] | |
| 52 | Procedure 20 min (demonstration) | [ ] | [ ] | |
| 53 | Sedatives stop at end of procedure | [ ] | [ ] | |
| 54 | Recovery end point (minimal/awake 10 s) | [ ] | [ ] | |
| 55 | 1-s live-check tolerance | [ ] | [ ] | |
| 56 | Advisory: phenylephrine next suggestion ≥ 60 s | [ ] | [ ] | |
| 57 | Advisory: ephedrine pause 120 s (convention) | [ ] | [ ] | |
| 58 | Advisory: other vasopressor pause 120 s (convention) | [ ] | [ ] | |
| 59 | Advisory: phenylephrine ≤ 200 mcg cumulative | [ ] | [ ] | |
| 60 | Advisory: ephedrine ≤ 50 mg cumulative | [ ] | [ ] | |
| 61 | Guided titration: midazolam ≥ 4 min | [ ] | [ ] | |
| 62 | Guided titration: 180-s reassessment after a rate step | [ ] | [ ] | |
| 63 | Full demonstration pauses 300 s after the last sedation step if below target | [ ] | [ ] | |
| 64 | Depth-high alarm: index > 60 for ≥ 60 s (convention) | [ ] | [ ] | |
| 65 | Depth-low advisory: index < 40 for ≥ 300 s, ends at ≥ 42 (convention; text only) | [ ] | [ ] | |
| 66 | Repeat phenylephrine bolus ≥ 60 s (label lower bound) | [ ] | [ ] | |
| 67 | Repeat glycopyrrolate bolus ≥ 120 s outside emergence (label lower bound) | [ ] | [ ] | |
| 68 | Repeat IM/SC epinephrine ≥ 5 min (label lower bound) | [ ] | [ ] | |
