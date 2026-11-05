# Smart NOA Web Simulator — sources registry

> **SIMULATION — fictional patients — educational use only. Not a medical device. Not medical advice.**
> Every dose, range, ceiling and timing in `data/drugs.js` is an **illustrative educational value transcribed from the cited source**. None is an order or a recommendation for any real patient. Labels differ by manufacturer and are revised often; real doses are individualized by the treating clinician.

Compiled 2026-11-05 by the drug-library worker. Machine-readable copy: `data/drugs.js` (`SOURCES`).

## How entries were checked

DailyMed, Drugs@FDA, PubMed, doi.org and label mirrors such as drugs.com could not be opened directly from the build environment (direct page fetches failed DNS resolution). Every entry was therefore checked through **web-search records** of FDA-hosted label PDFs, manufacturer prescribing-information pages, label mirrors (medlibrary.org, prescriberpoint.com, ndclist.com, medthority.com, drugcentral.org) and publisher or indexing records. The `verifiedVia` line of each entry says exactly what was seen. Anything not seen is marked "(identifier unverified)" or left out.

Entries S1–S22 reuse citations and verification text from `breast-reconstruction-anesthesia-protocol/DOSING_SOURCES.md`, renumbered:

| Here | DOSING_SOURCES.md | Here | DOSING_SOURCES.md |
|---|---|---|---|
| S1 | S1 (Foo 2021) | S12 | S17 (rocuronium) |
| S2 | S7 (PONV 4th) | S13 | S18 (fentanyl) |
| S3 | S8 (PONV 5th) | S14 | S22 (naloxone) |
| S4 | S9 (Apfel) | S15 | S23 (ketorolac) |
| S5 | S10 (Thilen 2023) | S16 | S24 (acetaminophen IV) |
| S6 | S11 (sugammadex) | S17 | S27 (midazolam) |
| S7 | S12 (neostigmine) | S18 | S28 (phenylephrine) |
| S8 | S13 (glycopyrrolate) | S19 | S29 (ephedrine) |
| S9 | S14 (dexmedetomidine) | S20 | S32 (STOP-Bang 2008) |
| S10 | S15 (Schwenk 2018) | S21 | S33 (STOP-Bang 2016) |
| S11 | S16 (propofol) | S22 | S35 (ASA monitoring) |

S23–S35 are new. S35 is the repository's own `config.yaml`. It is cited only so the simulator matches the Python controller's software ceilings and lockouts. It is **not clinical evidence**.

## Data conventions

- **Defaults:** where the label names a usual, average or initial dose, that is the default. Otherwise the default is the lower bound of the stated range. Where a source gives only an upper limit (Foo 2021 lidocaine, Schwenk 2018 ketamine), `min` is 0 and the default is the limit. The ketamine maintenance default (0.2 mg/kg/h) is the Python simulation ceiling from S35, not a guideline value.
- **Weight scalars:** `scalarBasis: 'guideline'` for lidocaine (IBW, Foo 2021). `'label'` for sugammadex (actual body weight, Bridion label). `'convention'` (TBW) for propofol, etomidate, ketamine, fentanyl, rocuronium, succinylcholine, neostigmine and dexmedetomidine: their labels give mg/kg (or mcg/kg) doses, but this session found no label statement saying which weight to use.
- **Ceilings:** `basis: 'label maximum'` / `'guideline maximum'` only where the source states a maximum: neostigmine, phenylephrine, ephedrine, ketorolac, acetaminophen, lidocaine and ketamine. `'label range upper bound'` (propofol 200 mcg/kg/min, dexmedetomidine 1 mcg/kg/h, sevoflurane 3%, sugammadex 16 mg/kg) is a simulator hard stop at the top of a labelled range that the label does not call a maximum.
- **Timing:** numbers come only from label statements. Where the label gives a range, the midpoint is used and the range is kept in `timing.ranges`. Where no statement was verified, the numbers are `null` and `basis` is `'not stated in label'`. The engine then falls back to its own illustrative constants. This applies to dexmedetomidine, sevoflurane, lidocaine, sugammadex, glycopyrrolate, dexamethasone, ondansetron, phenylephrine, ephedrine, ketorolac and acetaminophen.
- **Severity versus label wording:** contraindication messages quote or closely paraphrase the label/guideline text. Where the simulator's severity differs from the label, the message says so:
  - Dexmedetomidine with heart block is a LOCK, mirroring the controller. The label only says "use with caution".
  - Ketamine with uncontrolled hypertension is a WARN, as the SPEC requires. The label lists it as a contraindication.
  - Lidocaine with heart block is a WARN, as the SPEC requires. The label lists severe block as a contraindication.
  - Ketorolac below eGFR 30: the label says "advanced renal impairment", and the numeric cut-off comes from S35.
  - Succinylcholine with pre-existing hyperkalaemia is a LOCK by SPEC policy. The label's exact wording on this point was not retrieved.
  - Etomidate with sepsis and ketamine with psychosis history are policy warnings. The quoted label text does not name these conditions.
- **`when` grammar:** contraindications take a single token: `condition:<id>`, `allergy:<id>`, `medication:<id>`, `egfr<N`, `age>=N` or `flag:<id>`. `adjust[].when` may join several tokens with `|` (OR) and may also use `asa>=N` and `weight<N`. `tests/drugs.test.mjs` enforces this.

## Registry

### S1
**Foo I, Macfarlane AJR, Srivastava D, et al. The use of intravenous lidocaine for postoperative pain and recovery: international consensus statement on efficacy and safety. Anaesthesia. 2021;76(2):238-250.** https://read.qxmd.com/read/33141959  
Identifiers: doi:10.1111/anae.15270; PMID 33141959

- **Supports:** Lidocaine loading dose ≤1.5 mg/kg over about 10 min; infusion ≤1.5 mg/kg/h; dosing on ideal body weight; hourly ceiling 120 mg/h for any patient; not for patients under 40 kg; not given concurrently with other local-anaesthetic interventions (nerve blocks, wound infiltration) or while their effect is still active; about 4 h separation between a block and IV lidocaine. IV lidocaine for analgesia is not an FDA-labelled indication.
- **Used by:** lidocaine
- **Verified via:** Copied from DOSING_SOURCES.md S1: WebSearch record of the abstract and full-text excerpts (Nottingham and Glasgow repository copies; read.qxmd.com/read/33141959), 2026-11-05. (date 2026-11-05)

### S2
**Gan TJ, Belani KG, Bergese S, et al. Fourth consensus guidelines for the management of postoperative nausea and vomiting. Anesth Analg. 2020;131(2):411-448.** https://pubmed.ncbi.nlm.nih.gov/32467512/  
Identifiers: doi:10.1213/ANE.0000000000004833; PMID 32467512

- **Supports:** Dexamethasone 4–8 mg IV at induction; ondansetron 4 mg IV at end of surgery; rescue with a different drug class.
- **Used by:** dexamethasone, ondansetron
- **Verified via:** Copied from DOSING_SOURCES.md S7: WebSearch records of PubMed 32467512 and of the APSF podcast notes and the Meyer TSHP handout summarizing Table 4, 2026-11-05. Superseded in part by S3. (date 2026-11-05)

### S3
**Gan TJ, et al. Fifth consensus guidelines for the management of postoperative nausea and vomiting: executive summary. Anesth Analg. Published online November 14, 2025.** https://journals.lww.com/anesthesia-analgesia/  
Identifiers: doi:10.1213/ANE.0000000000007816; PMID unverified

- **Supports:** Two interventions for adults at risk of PONV; dexamethasone 4–8 mg IV at induction (8 mg may be optimal); ondansetron 4 mg IV at end of surgery; dexamethasone plus a 5-HT3 antagonist as the best-studied pair.
- **Used by:** dexamethasone, ondansetron
- **Verified via:** Copied from DOSING_SOURCES.md S8: WebSearch records of journals.lww.com (executive summary landing page), the LWW-hosted full report (cdn-links.lww.com/permalink/aa/f/aa_1_1_2025_11_24_cd_1_sdc1.pdf), scholars.duke.edu and a NYSORA summary, 2026-11-05. Full text not opened. PMID (identifier unverified). (date 2026-11-05)

### S4
**Apfel CC, Läärä E, Koivuranta M, Greim CA, Roewer N. A simplified risk score for predicting postoperative nausea and vomiting: conclusions from cross-validations between two centers. Anesthesiology. 1999;91(3):693-700.** https://pubmed.ncbi.nlm.nih.gov/10485781/  
Identifiers: doi:10.1097/00000542-199909000-00022; PMID 10485781

- **Supports:** Four risk factors (female sex, non-smoking, history of PONV or motion sickness, postoperative opioids), one point each; estimated PONV incidence for 0–4 factors about 10%, 21%, 39%, 61%, 79%.
- **Used by:** engine/UI only
- **Verified via:** Copied from DOSING_SOURCES.md S9: citation and percentages as audited in v2.0 of that repository against the PubMed record; not re-searched in this session (2026-11-05). (date 2026-11-05)

### S5
**Thilen SR, Weigel WA, Todd MM, et al. 2023 American Society of Anesthesiologists practice guidelines for monitoring and antagonism of neuromuscular blockade. Anesthesiology. 2023;138(1):13-41.** https://pubmed.ncbi.nlm.nih.gov/36520073/  
Identifiers: doi:10.1097/ALN.0000000000004379; PMID 36520073

- **Supports:** Quantitative monitoring; confirm TOFR ≥0.9 before extubation; sugammadex over neostigmine for deep, moderate and shallow rocuronium/vecuronium block; neostigmine reasonable at minimal depth (TOFR 0.4 to <0.9).
- **Used by:** sugammadex, neostigmine
- **Verified via:** Copied from DOSING_SOURCES.md S10: WebSearch record of PubMed 36520073 and the APSF summary, 2026-11-05. (date 2026-11-05)

### S6
**Sugammadex injection (BRIDION). Merck Sharp & Dohme LLC. FDA-approved prescribing information, revised 11/2022.** https://www.accessdata.fda.gov/drugsatfda_docs/label/2022/022225Orig1s012lbl.pdf  
Identifiers: NDA 022225

- **Supports:** 2 mg/kg at reappearance of T2; 4 mg/kg at 1–2 post-tetanic counts with no TOF twitch; 16 mg/kg for immediate reversal about 3 min after rocuronium 1.2 mg/kg; dosing on actual body weight. Contraindication: known hypersensitivity to sugammadex or any of its components.
- **Used by:** sugammadex
- **Verified via:** Dosing copied from DOSING_SOURCES.md S11 (WebSearch record of the FDA-hosted 2022 label, the Merck PI and the Medsafe datasheet, 2026-11-05). Contraindication wording "Known hypersensitivity to sugammadex or any of its components" confirmed in a WebSearch record of the US label, 2026-11-05. Median recovery times were found only in non-US datasheets and are not used. (date 2026-11-05)

### S7
**Neostigmine methylsulfate injection (BLOXIVERZ). Exela Pharma Sciences. FDA-approved prescribing information, 2023 revision.** https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/204078Orig1s014lbl.pdf  
Identifiers: NDA 204078

- **Supports:** 0.03–0.07 mg/kg IV (0.03 mg/kg for shorter half-life agents such as rocuronium); maximum total 0.07 mg/kg or 5 mg, whichever is less; anticholinergic before or with neostigmine; TOF0.9 generally within 10–20 min. Contraindications: hypersensitivity to neostigmine; peritonitis or mechanical obstruction of the intestinal or urinary tract.
- **Used by:** neostigmine
- **Verified via:** Dosing copied from DOSING_SOURCES.md S12 (WebSearch record of the FDA-hosted 2023 and 2015 labels and the Amneal PI, 2026-11-05). Contraindications and the "TOF0.9 within 10 to 20 minutes" statement confirmed in a WebSearch record of the FDA-hosted 2023 label highlights and drugs.com/medlibrary copies, 2026-11-05. (date 2026-11-05)

### S8
**Glycopyrrolate injection, USP. Multiple manufacturers (label copies indexed at medlibrary.org/lib/rx/meds/glycopyrrolate-54/). FDA-approved prescribing information (revision dates vary).** https://medlibrary.org/lib/rx/meds/glycopyrrolate-54/  
Identifiers: none (multiple ANDAs)

- **Supports:** With neostigmine reversal, 0.2 mg glycopyrrolate per 1 mg neostigmine. Intraoperative use: 0.1 mg IV, repeated as needed at 2–3 min intervals.
- **Used by:** glycopyrrolate
- **Verified via:** Copied from DOSING_SOURCES.md S13: WebSearch record of several label copies (medlibrary.org; ndclist.com), 2026-11-05. The 0.1 mg wording was confirmed in one manufacturer's label but not tied to its section heading. (date 2026-11-05)

### S9
**Dexmedetomidine hydrochloride injection (PRECEDEX). Hospira, Inc. (Pfizer). FDA-approved prescribing information, 2026 revision.** https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/021038s061lbl.pdf  
Identifiers: NDA 021038

- **Supports:** Procedural sedation of non-intubated patients: loading 1 mcg/kg over 10 min (0.5 mcg/kg over 10 min for less invasive procedures); maintenance started at 0.6 mcg/kg/h, titrated 0.2–1 mcg/kg/h. ICU maintenance 0.2–0.7 mcg/kg/h. >65 y: loading 0.5 mcg/kg over 10 min, consider reducing maintenance. Hepatic impairment: consider reduction. Contraindications: none. Warning: use with caution in advanced heart block and/or severe ventricular dysfunction. Use as a general-anaesthesia adjunct is off-label.
- **Used by:** dexmedetomidine
- **Verified via:** Dosing copied from DOSING_SOURCES.md S14 (WebSearch record of the FDA-hosted 2026 and 2013 labels and Pfizer labeling pages, 2026-11-05; procedural 0.6 and 0.2–1 mcg/kg/h wording confirmed in the 2013 text). Contraindications "None" and the heart-block caution confirmed in a WebSearch record of the DailyMed Precedex listing and pfizermedicalinformation.com/precedex/warnings, 2026-11-05. No onset time was found. (date 2026-11-05)

### S10
**Schwenk ES, Viscusi ER, Buvanendran A, et al. Consensus guidelines on the use of intravenous ketamine infusions for acute pain management from the American Society of Regional Anesthesia and Pain Medicine, the American Academy of Pain Medicine, and the American Society of Anesthesiologists. Reg Anesth Pain Med. 2018;43(5):456-466.** https://pmc.ncbi.nlm.nih.gov/articles/PMC6023582/  
Identifiers: doi:10.1097/AAP.0000000000000806; PMID 29870457

- **Supports:** Subanaesthetic ketamine for acute pain: bolus ≤0.35 mg/kg; infusions up to about 1 mg/kg/h; contraindications for acute pain largely mirror those for chronic pain. Analgesic ketamine is outside the FDA-labelled anaesthetic indications.
- **Used by:** ketamine
- **Verified via:** Copied from DOSING_SOURCES.md S15: WebSearch record of PubMed 29870457, PMC6023582 and the ASRA guideline page, 2026-11-05. The 0.35 mg/kg and 1 mg/kg/h figures were confirmed in a secondary summary. The specific contraindication list was NOT retrieved in this session. (date 2026-11-05)

### S11
**Propofol injectable emulsion (DIPRIVAN). Fresenius Kabi USA. FDA-approved prescribing information, 2022 revision; and generic propofol injectable emulsion labels (medlibrary.org copies).** https://www.accessdata.fda.gov/drugsatfda_docs/Label/2022/019627s069lbl.pdf  
Identifiers: NDA 019627

- **Supports:** Induction <55 y about 2–2.5 mg/kg; elderly/debilitated/ASA III–IV about 1–1.5 mg/kg. Maintenance 100–200 mcg/kg/min (<55 y); 50–100 mcg/kg/min (elderly/ASA III–IV). MAC sedation initiation: 100–150 mcg/kg/min for 3–5 min or slow injection about 0.5 mg/kg over 3–5 min; slow infusion/injection preferable to rapid bolus; maintenance 25–75 mcg/kg/min during the first 10–15 min, then 25–50 mcg/kg/min; no rapid bolus for MAC sedation in elderly/debilitated/ASA III–IV. Onset: hypnosis usually within 40 s from start of injection. Contraindication: known hypersensitivity to propofol, egg or soybean (current label).
- **Used by:** propofol
- **Verified via:** Induction/maintenance copied from DOSING_SOURCES.md S16 (WebSearch record of the FDA-hosted 2022 label and the medlibrary.org label copy, 2026-11-05). MAC-sedation rates, slow-injection 0.5 mg/kg and the elderly no-rapid-bolus wording confirmed in WebSearch records of medlibrary.org propofol and Diprivan label copies (medlibrary.org/lib/rx/meds/propofol/, /diprivan/page/2/), 2026-11-05. 40 s onset confirmed in a WebSearch record of an ndclist.com label copy and the FDA-hosted 2014 label (019627s062). Contraindication wording from a WebSearch record of the current label highlights; older labels word it as anaphylaxis to eggs/egg products/soybeans/soy products. (date 2026-11-05)

### S12
**Rocuronium bromide injection. Generic manufacturer labels (e.g., DailyMed setid a54a79f7-5207-43d8-a139-7d57557caa50), Pfizer prescribing information, and FDA-hosted 2026 rocuronium label (NDA 217472).** https://www.accessdata.fda.gov/drugsatfda_docs/nda/2026/217472Orig1s000Lbl.pdf  
Identifiers: NDA 217472 (2026 label); others vary

- **Supports:** Intubating dose 0.6 mg/kg; rapid sequence 0.6–1.2 mg/kg; maintenance guided by response (older labels: 0.1, 0.15 or 0.2 mg/kg at 25% recovery of T1). 0.6 mg/kg: maximum block in most patients in <3 min; 31 (15–85) min clinical relaxation. Contraindication (older label): hypersensitivity (e.g., anaphylaxis) to rocuronium bromide or other neuromuscular blocking agents.
- **Used by:** rocuronium
- **Verified via:** Dosing copied from DOSING_SOURCES.md S17 (WebSearch record of the Pfizer dosage page, the DailyMed listing and an FDA-hosted 2026 label, 2026-11-05). Timing ("less than 3 minutes", "31 (15-85) minutes") from a WebSearch record of the FDA-hosted 2026 label; contraindication wording from an older label copy (ndclist.com / labeling.pfizer.com), 2026-11-05. (date 2026-11-05)

### S13
**Fentanyl citrate injection, USP. Hospira, Inc. (Pfizer) and Fresenius Kabi (August 2023 PI) prescribing information.** https://pfizermedicalinformation.com/fentanyl-citrate/dosage-admin  
Identifiers: none (multiple NDAs/ANDAs)

- **Supports:** Individualized dosing; reduce initial dose in elderly/debilitated. General anaesthesia low dose 2 mcg/kg; moderate dose 2–20 mcg/kg with 25–100 mcg increments for maintenance. IV onset almost immediate; analgesia 30–60 min after a single IV dose up to 100 mcg.
- **Used by:** fentanyl
- **Verified via:** Low-dose tier copied from DOSING_SOURCES.md S18 (WebSearch record of the Pfizer dosage page and Fresenius/medlibrary copies, 2026-11-05). Moderate-dose "2 mcg/kg to 20 mcg/kg, 25 mcg to 100 mcg" confirmed in a WebSearch record of the Fresenius Kabi August 2023 PI and ndclist.com label copies; the maintenance sentence itself was cut off in the snippet. Onset/duration from an archived (2008–2009) DailyMed label copy (webarchive.library.unt.edu), 2026-11-05. (date 2026-11-05)

### S14
**Naloxone hydrochloride injection, USP. Generic manufacturer labels (copies indexed at medlibrary.org/lib/rx/meds/naloxone-hydrochloride-14/; labeling.pfizer.com).** https://labeling.pfizer.com/ShowLabeling.aspx?id=4542  
Identifiers: none (multiple ANDAs)

- **Supports:** Postoperative opioid depression: 0.1–0.2 mg IV at 2–3 min intervals to desired reversal; repeat doses may be needed at 1–2 h intervals. IV onset generally apparent within 2 min; duration depends on dose and route.
- **Used by:** naloxone
- **Verified via:** Dosing copied from DOSING_SOURCES.md S22 (WebSearch record of multiple label copies, 2026-11-05). Onset "generally apparent within two minutes" confirmed in WebSearch records of ndclist.com and labeling.pfizer.com label copies, 2026-11-05. (date 2026-11-05)

### S15
**Ketorolac tromethamine injection, USP. Hospira, Inc. (Pfizer) prescribing information.** https://www.pfizermedical.com/ketorolac-inj/dosage-admin  
Identifiers: none

- **Supports:** <65 y: 30 mg IV every 6 h, max 120 mg/day; ≥65 y, renally impaired or <50 kg: 15 mg every 6 h, max 60 mg/day; ≤5 days. Contraindicated in advanced renal impairment or risk for renal failure due to volume depletion; in patients with allergic reactions to aspirin or other NSAIDs; in patients currently receiving aspirin or NSAIDs.
- **Used by:** ketorolac
- **Verified via:** Dosing copied from DOSING_SOURCES.md S23 (WebSearch record of the Pfizer dosage page and medlibrary.org copies, 2026-11-05). Contraindication wording confirmed in a WebSearch record of pfizermedicalinformation.com/ketorolac-inj/contradictions and the Hospira DailyMed listing, 2026-11-05. (date 2026-11-05)

### S16
**Acetaminophen injection (OFIRMEV). Mallinckrodt Hospital Products. FDA-approved prescribing information.** https://www.accessdata.fda.gov/drugsatfda_docs/label/2010/022450lbl.pdf  
Identifiers: NDA 022450

- **Supports:** Adults ≥50 kg: 1000 mg every 6 h or 650 mg every 4 h, max single dose 1000 mg, max 4000 mg/day; <50 kg: 15 mg/kg every 6 h, max 75 mg/kg/day; daily maximum counts all routes. Contraindicated in severe hepatic impairment; caution in hepatic impairment.
- **Used by:** acetaminophen
- **Verified via:** Copied from DOSING_SOURCES.md S24: WebSearch record of the FDA-hosted 2010 label, the Mallinckrodt PI and drugs.com label copy, 2026-11-05. (date 2026-11-05)

### S17
**Midazolam hydrochloride injection, USP. Multiple manufacturers (e.g., DailyMed setid e22611dd-1830-40af-9139-7cdb07f5a426).** https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=e22611dd-1830-40af-9139-7cdb07f5a426  
Identifiers: none (multiple ANDAs)

- **Supports:** Individualized; IV sedation in a healthy adult starts with as little as 1 mg and should not exceed 2.5 mg initial dose, titrated slowly; reduce in older, debilitated or chronically ill patients and with opioids/CNS depressants. Sedation achieved within 3–5 min after IV injection. Contraindicated in acute narrow-angle glaucoma. Boxed warning on respiratory depression.
- **Used by:** midazolam
- **Verified via:** Dosing copied from DOSING_SOURCES.md S27 (WebSearch record of a prescriberpoint.com label copy and the DailyMed listing, 2026-11-05; age ≥60 figure NOT confirmed). Onset "within 3 to 5 minutes" and the narrow-angle glaucoma contraindication confirmed in WebSearch records of US label copies (DailyMed listings; medlibrary.org), 2026-11-05. (date 2026-11-05)

### S18
**Phenylephrine hydrochloride injection (BIORPHEN). FDA-approved prescribing information, 2019.** https://www.accessdata.fda.gov/drugsatfda_docs/label/2019/212909s000lbl.pdf  
Identifiers: NDA 212909

- **Supports:** Hypotension during anaesthesia: initial IV bolus 40–100 mcg; additional boluses every 1–2 min, not exceeding 200 mcg per bolus; infusion 10–35 mcg/min, not exceeding 200 mcg/min.
- **Used by:** phenylephrine
- **Verified via:** Copied from DOSING_SOURCES.md S28: WebSearch record of the FDA-hosted 2019 label and drugs.com label copy, 2026-11-05. (date 2026-11-05)

### S19
**Ephedrine sulfate injection (AKOVAZ). Exela Pharma Sciences. FDA-approved prescribing information.** https://www.drugs.com/pro/akovaz.html  
Identifiers: none

- **Supports:** Clinically important hypotension in the setting of anaesthesia: IV bolus 5–10 mg as needed, not to exceed 50 mg; tachyphylaxis possible.
- **Used by:** ephedrine
- **Verified via:** Copied from DOSING_SOURCES.md S29: WebSearch record of drugs.com and medlibrary.org label copies, 2026-11-05. (date 2026-11-05)

### S20
**Chung F, Yegneswaran B, Liao P, et al. STOP questionnaire: a tool to screen patients for obstructive sleep apnea. Anesthesiology. 2008;108(5):812-821.** https://pubmed.ncbi.nlm.nih.gov/18431116/  
Identifiers: PMID 18431116 (DOI not re-verified)

- **Supports:** STOP items and Bang items (BMI >35, age >50, neck >40 cm, male sex).
- **Used by:** engine/UI only
- **Verified via:** Copied from DOSING_SOURCES.md S32: WebSearch record of PubMed 18431116 and qxmd.com/r/18431116, 2026-11-05. (date 2026-11-05)

### S21
**Chung F, Abdullah HR, Liao P. STOP-Bang questionnaire: a practical approach to screen for obstructive sleep apnea. Chest. 2016;149(3):631-638.** https://pubmed.ncbi.nlm.nih.gov/26378880/  
Identifiers: PMID 26378880 (DOI not re-verified)

- **Supports:** STOP-Bang 0–2 low, 3–4 intermediate, 5–8 high risk of moderate-to-severe OSA.
- **Used by:** engine/UI only
- **Verified via:** Copied from DOSING_SOURCES.md S33: WebSearch record of PubMed 26378880 and the UW-hosted STOP-Bang appendix, 2026-11-05. (date 2026-11-05)

### S22
**American Society of Anesthesiologists. Standards for Basic Anesthetic Monitoring. Last amended October 15, 2025.** https://www.asahq.org/standards-and-practice-parameters/standards-for-basic-anesthetic-monitoring  
Identifiers: none

- **Supports:** BP and HR at least every 5 min; continuous ECG; pulse oximetry; end-tidal CO2 during GA; exhaled-CO2 monitoring during moderate or deep sedation.
- **Used by:** engine/UI only
- **Verified via:** Copied from DOSING_SOURCES.md S35: WebSearch record of the asahq.org standards page and the OpenAnesthesia summary, 2026-11-05. (date 2026-11-05)

### S23
**Etomidate injection, USP (AMIDATE). Hospira, Inc. (Pfizer). FDA-approved prescribing information.** https://www.pfizermedical.com/amidate/dosage-admin  
Identifiers: NDA 018227 (FDA-hosted label 2017: 018227s032lbl.pdf)

- **Supports:** Adults: 0.2–0.6 mg/kg, individualized; usual 0.3 mg/kg over 30–60 s. Onset usually within 1 min; duration dose dependent, usually 3–5 min at 0.3 mg/kg. Reduced plasma cortisol after 0.3 mg/kg persisting about 6–8 h, unresponsive to ACTH. Geriatric patients may require reduced doses. Contraindicated in patients who have shown hypersensitivity to it.
- **Used by:** etomidate
- **Verified via:** WebSearch records of pfizermedical.com/amidate (dosage-admin), prescriberpoint.com etomidate label copies, the FDA-hosted 2017 label (accessdata.fda.gov 018227s032lbl.pdf, link only) and the drugs.com Amidate copy (updated Jan 2026) for onset/duration wording, 2026-11-05. (date 2026-11-05)

### S24
**Succinylcholine chloride injection, USP (ANECTINE; QUELICIN). Sandoz / Hospira prescribing information (medlibrary.org and medthority.com label copies; DailyMed setid 1d4302db-a0d5-d0e8-e063-6294a90a22f8).** https://medlibrary.org/lib/rx/meds/anectine/  
Identifiers: none

- **Supports:** Average adult intubating dose 0.6 mg/kg IV (range 0.3–1.1 mg/kg). After IV doses in this range blockade develops in about 1 min, maximum about 2 min, recovery within 4–6 min. Contraindications (older-format labels): personal or familial history of malignant hyperthermia, skeletal muscle myopathies, known hypersensitivity; not to be used after the acute phase of injury following major burns, multiple trauma, extensive denervation of skeletal muscle, or upper motor neuron injury. Boxed warning: hyperkalemic rhabdomyolysis in pediatric patients. Hyperkalemia risk in burn/injury patients peaks 7–10 days after injury.
- **Used by:** succinylcholine
- **Verified via:** WebSearch records of medlibrary.org Anectine copies (0.3–1.1 mg/kg; onset/peak/recovery), medthority.com Anectine/Quelicin copies (0.6 mg/kg; boxed warning; burn hyperkalemia timing), drugs.com and DailyMed listings (contraindication wording), 2026-11-05. Contraindication lists differ between label versions (some newer labels move burns/denervation to Warnings). (date 2026-11-05)

### S25
**Sevoflurane, USP, volatile liquid for inhalation (ULTANE). AbbVie. FDA-approved prescribing information.** https://medlibrary.org/lib/rx/meds/ultane-1/  
Identifiers: none confirmed

- **Supports:** MAC in oxygen by age: 25 y 2.6%; 40 y 2.1%; 60 y 1.7%; 80 y 1.4%. Surgical levels of anaesthesia usually achieved with 0.5–3% with or without nitrous oxide. Contraindicated in known or suspected genetic susceptibility to malignant hyperthermia and known sensitivity to sevoflurane or other halogenated agents.
- **Used by:** sevoflurane
- **Verified via:** WebSearch records of prescriberpoint.com sevoflurane label copies (MAC table; contraindications), medlibrary.org Ultane copy and pdr.net (0.5–3% maintenance sentence), 2026-11-05. The current US label full text was not opened; the 0.5–3% sentence appeared under an odd heading in the medlibrary copy. (date 2026-11-05)

### S26
**Mapleson WW. Effect of age on MAC in humans: a meta-analysis. Br J Anaesth. 1996;76(2):179-185.** https://academic.oup.com/bja/issue/76/2  
Identifiers: doi:10.1093/bja/76.2.179; PMID unverified

- **Supports:** MAC(age) = MAC40 × 10^(−0.00269 × (age − 40)); sevoflurane MAC40 1.80% (about 6% decline per decade).
- **Used by:** sevoflurane
- **Verified via:** WebSearch records of the BJA 76(2) issue listing (citation, DOI), a Mapleson-authored abstract on scite.ai (MAC40 1.80% sevoflurane; b = −0.00269), and a StatPearls review quoting the equation, 2026-11-05. Full text not opened. (date 2026-11-05)

### S27
**Ketamine hydrochloride injection (KETALAR). Par Pharmaceutical / Endo. FDA-approved prescribing information, 2022 revision (also 2026 revision 016812s057); and Fresenius Kabi generic ketamine label.** https://www.accessdata.fda.gov/drugsatfda_docs/label/2022/016812s051lbl.pdf  
Identifiers: NDA 016812

- **Supports:** IV induction 1–4.5 mg/kg over 60 s; average 2 mg/kg produces 5–10 min of surgical anaesthesia within 30 s; maintenance increments of one-half to the full induction dose. Contraindicated in patients for whom a significant elevation of blood pressure would constitute a serious hazard, and in known hypersensitivity. Postoperative confusional states may occur during recovery.
- **Used by:** ketamine
- **Verified via:** WebSearch records of the FDA-hosted 2022 and 2026 Ketalar labels (1–4.5 mg/kg; maintenance increments; contraindications; emergence wording) and the Fresenius Kabi generic label copy (2 mg/kg, 5–10 min, within 30 s), 2026-11-05. (date 2026-11-05)

### S28
**Lidocaine hydrochloride injection, USP (intravenous, antiarrhythmic). Fresenius Kabi and Hospira prescribing information; archived DailyMed lidocaine labels.** https://labeling.pfizer.com/ShowLabeling.aspx?id=4497  
Identifiers: none

- **Supports:** Contraindication (Fresenius Kabi): not to be used in Stokes-Adams syndrome, Wolff-Parkinson-White syndrome, or severe degrees of sinoatrial, atrioventricular or intraventricular block. Warning (older-format labels): patients with severe hepatic disease are at greater risk of developing toxic plasma concentrations.
- **Used by:** lidocaine
- **Verified via:** WebSearch records of guidelinecentral.com Fresenius lidocaine label, labeling.pfizer.com (Hospira caution wording), the drugs.com lidocaine monograph and archived DailyMed lidocaine labels (webarchive.library.unt.edu), 2026-11-05. No dose is taken from this label. (date 2026-11-05)

### S29
**Ondansetron injection, USP. Pfizer prescribing information (pfizermedicalinformation.com/ondansetron).** https://www.pfizermedicalinformation.com/ondansetron/contradictions  
Identifiers: none

- **Supports:** Contraindicated in known hypersensitivity (e.g., anaphylaxis) to the product or its components, and with concomitant apomorphine (profound hypotension and loss of consciousness reported).
- **Used by:** ondansetron
- **Verified via:** WebSearch record of pfizermedicalinformation.com/ondansetron/contradictions and Canadian monographs (pdf.hres.ca), 2026-11-05. Dose is taken from S3, not from this label. (date 2026-11-05)

### S30
**Dexamethasone sodium phosphate injection, USP. Multiple manufacturers (e.g., Fresenius Kabi; label copies at medthority.com and drugcentral.org).** https://drugcentral.org/label/9dbb2b90-471a-4de8-b105-6c9ede7d8d7e/view  
Identifiers: none

- **Supports:** Contraindications: systemic fungal infections; hypersensitivity to any component of this product (including sulfites in some products).
- **Used by:** dexamethasone
- **Verified via:** WebSearch records of drugcentral.org and medthority.com dexamethasone sodium phosphate label copies, 2026-11-05. Dose is taken from S2/S3, not from this label. (date 2026-11-05)

### S31
**American Society of Anesthesiologists. Statement on Continuum of Depth of Sedation: Definition of General Anesthesia and Levels of Sedation/Analgesia. Original approval October 13, 1999; last amended October 23, 2024.** https://www.asahq.org/standards-and-practice-parameters/statement-on-continuum-of-depth-of-sedation-definition-of-general-anesthesia-and-levels-of-sedation-analgesia  
Identifiers: none

- **Supports:** Minimal sedation: normal response to verbal stimulation. Moderate: purposeful response to verbal or light tactile stimulation. Deep: purposeful response after repeated or painful stimulation (reflex withdrawal is not purposeful). General anaesthesia: not arousable even by painful stimulation.
- **Used by:** engine/UI only
- **Verified via:** WebSearch record of the asahq.org statement page (amendment date) and reproductions of the statement text, 2026-11-05. (date 2026-11-05)

### S32
**Practice guidelines for moderate procedural sedation and analgesia 2018: a report by the American Society of Anesthesiologists Task Force on Moderate Procedural Sedation and Analgesia, et al. Anesthesiology. 2018;128(3):437-479.** https://pubmed.ncbi.nlm.nih.gov/29334501/  
Identifiers: doi:10.1097/ALN.0000000000002043; PMID 29334501

- **Supports:** Framework for moderate procedural sedation (monitoring, titration, personnel). No dose is taken from it in this library.
- **Used by:** engine/UI only
- **Verified via:** WebSearch record of PubMed 29334501 and qxmd.com/r/29334501 (citation, DOI), 2026-11-05. Its capnography recommendation text was not retrieved; capnography statements in the simulator are tagged to S22. (date 2026-11-05)

### S33
**Devine BJ. Gentamicin therapy. Drug Intell Clin Pharm. 1974;8:650-655.** https://wikem.org/wiki/Ideal_body_weight_calculator  
Identifiers: none confirmed

- **Supports:** Ideal body weight: male 50 kg, female 45.5 kg, + 2.3 kg per inch over 60 in.
- **Used by:** engine/UI only
- **Verified via:** WebSearch records of secondary reproductions (wikem.org; evigrade.com; calcfyi.com) giving the citation and formula, 2026-11-05. Original article not opened. (date 2026-11-05)

### S34
**Janmahasatian S, Duffull SB, Ash S, Ward LC, Byrne NM, Green B. Quantification of lean bodyweight. Clin Pharmacokinet. 2005;44(10):1051-1065.** https://pmc.ncbi.nlm.nih.gov/articles/PMC2485235  
Identifiers: doi:10.2165/00003088-200544100-00004

- **Supports:** Lean body weight: male 9270 × TBW / (6680 + 216 × BMI); female 9270 × TBW / (8780 + 244 × BMI).
- **Used by:** engine/UI only
- **Verified via:** WebSearch records of bibliographic copies (citation, DOI, pages) and a PMC article quoting the denominators 6680 + 216×BMI and 8780 + 244×BMI, 2026-11-05. The 9270 numerator was not displayed in the search record (identifier/constant unverified in this session); check the original before reuse. (date 2026-11-05)

### S35
**Smart NOA Controller. config.yaml (simulation_rate_ceilings; ketorolac egfr_minimum; dexmedetomidine cardiac_conditions). Project configuration in this repository.** config.yaml  
Identifiers: none

- **Supports:** Python simulation rate ceilings: dexmedetomidine 0.5 mcg/kg/h, ketamine 0.2 mg/kg/h, lidocaine 1.5 mg/kg/h; ketorolac lockout below eGFR 30; dexmedetomidine lockout for heart block conditions.
- **Used by:** ketamine, dexmedetomidine, lidocaine, ketorolac
- **Verified via:** Read directly from /home/user/smart-noa-controller/config.yaml, 2026-11-05. This is not clinical evidence; it is cited so the simulator mirrors the Python controller. (date 2026-11-05)


## Not included, and why

| Item | Reason |
|---|---|
| Marsh 1991 propofol PK parameters (`pkModel: 'marsh'`) | The citation was confirmed (Br J Anaesth 1991;67(1):41-48, doi:10.1093/bja/67.1.41). The adult parameter set (V1, k10, k12, k13, k21, k31, ke0) was **not** displayed in any search record, so propofol uses `pkModel: 'calibrated'`. |
| Ketamine for MAC sedation (all `sedation_*` keys) | No label or guideline sedation dose was verified. The label gives anaesthetic doses only, and Schwenk 2018 covers analgesic infusions. |
| Fentanyl for MAC sedation (all `sedation_*` keys) | The label gives premedication (IM) and general-anaesthesia tiers only. No IV procedural-sedation dose was verified. The 2018 ASA sedation guideline (S32) gives no doses. |
| Fentanyl high-dose tier (20–50 mcg/kg) | Not verified this session. Also not relevant to the modelled cases. |
| Midazolam IM premedication (0.07–0.08 mg/kg) and IV induction (0.3–0.35 mg/kg) | Seen only in non-US product information (Rwanda SmPC, Australian PI). Not confirmed in a US label record. The age ≥60 dose was also not confirmed. |
| Midazolam cumulative ceiling | No US label maximum was verified (`ceiling: null`). |
| Propofol MAC-sedation dose for elderly patients (e.g. "80% of adult dose") | Not found in any label record. Only the "no rapid bolus" wording is used. |
| Propofol, fentanyl, rocuronium, etomidate, succinylcholine and midazolam ceilings | The labels state no maximum. The range-out-of-bounds warnings apply instead. |
| Sugammadex and dexmedetomidine timing | Sugammadex median recovery times were seen only in non-US datasheets. No dexmedetomidine onset statement was found. |
| Rocuronium dose adjustment in severe CKD; weight-scalar statement | Not verified in the label. Prolonged block in severe CKD is an illustrative engine modifier only. |
| Lidocaine bolus for airway/pressor attenuation | No acceptable source supports a dose for this indication. The induction regimen is the Foo 2021 loading dose, and its note says so. |
| Schwenk 2018 contraindication list | Not retrieved this session. Ketamine warnings use label wording instead. |
| Ondansetron, ephedrine, naloxone, glycopyrrolate, rocuronium, midazolam, acetaminophen, sugammadex, lidocaine and dexmedetomidine concentrations | The supplied concentration was not seen in a label record (`concentration: null`). |
| Janmahasatian numerator (9270) | The citation, DOI and denominators were confirmed, but the numerator was not displayed in a search record. The engine worker should treat it as unverified (S34). |
| Mapleson 1996 PMID; PONV 5th consensus PMID; sevoflurane NDA | Identifiers unverified. Omitted. |
| Bratzler 2013 antibiotic prophylaxis | Not part of the SPEC §4 drug set, so it is not registered here. |
| Dexamethasone under `emergence` | S2 and S3 say to give it at induction. The regimen is stored under `induction`, with a note. |

## Model assumptions (illustrative)

- All drugs use `pkModel: 'calibrated'`. The engine fits illustrative constants to the `timing` values above, or to its own fallbacks when those are null. No PK/PD parameter is a published model except the Mapleson age-adjusted MAC equation (S26).
- Sevoflurane carries two MAC references: Mapleson MAC40 = 1.80% and the US label table (2.1% at 40 y in O2). They differ. The engine's effect model uses Mapleson, and the UI may show both.
