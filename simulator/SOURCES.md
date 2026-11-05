# Smart NOA Web Simulator — sources registry

> **SIMULATION — fictional patients — educational use only. Not a medical device. Not medical advice.**
> Every dose, range, ceiling and timing in `data/drugs.js` is an **illustrative educational value transcribed from the cited source**. None is an order or a recommendation for any real patient. Labels differ by manufacturer and are revised often; real doses are individualized by the treating clinician.

Compiled 2026-11-05. Machine-readable copy: `data/drugs.js` (`SOURCES`).

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

S23–S43 are new (S40–S43 added later on 2026-11-05 for epinephrine, the Eleveld propofol model and sepsis fluid context). S38 and S39 are non-label sources used only for nitrous oxide (see below). S35 is the repository's own `config.yaml`. It is cited only so the simulator matches the Python controller's software ceilings and lockouts. It is **not clinical evidence**.

## Data conventions

- **Defaults:** where the label names a usual, average or initial dose, that is the default. Otherwise the default is the lower bound of the stated range. Where a source gives only an upper limit (Foo 2021 lidocaine, Schwenk 2018 ketamine), `min` is 0 and the default is the limit. The ketamine maintenance default (0.2 mg/kg/h) is the Python simulation ceiling from S35, not a guideline value.
- **Weight scalars:** `scalarBasis: 'guideline'` for lidocaine (IBW, Foo 2021). `'label'` for sugammadex (actual body weight, Bridion label). `'convention'` (TBW) for propofol, etomidate, ketamine, fentanyl, rocuronium, succinylcholine, neostigmine and dexmedetomidine: their labels give mg/kg (or mcg/kg) doses, but this session found no label statement saying which weight to use.
- **Ceilings:** `basis: 'label maximum'` / `'guideline maximum'` only where the source states a maximum: neostigmine, phenylephrine, ephedrine, ketorolac, acetaminophen, lidocaine and ketamine. `'study protocol value'` (nitrous oxide 70%, from ENIGMA-II) marks a trial concentration, not a label maximum. `'label range upper bound'` (propofol 200 mcg/kg/min, dexmedetomidine 1 mcg/kg/h, sevoflurane 3%, desflurane 8.5%, isoflurane 3.5% (2.5% maintenance bound plus the label's extra 1.0% with oxygen alone), sugammadex 16 mg/kg) is a simulator hard stop at the top of a labelled range that the label does not call a maximum.
- **Timing:** numbers come only from label statements. Where the label gives a range, the midpoint is used and the range is kept in `timing.ranges`. Where no statement was verified, the numbers are `null` and `basis` is `'not stated in label'`. The engine then falls back to its own illustrative constants. This applies to dexmedetomidine, sevoflurane, desflurane, isoflurane, lidocaine, sugammadex, glycopyrrolate, dexamethasone, ondansetron, phenylephrine, ephedrine, ketorolac and acetaminophen.
- **Severity versus label wording:** contraindication messages quote or closely paraphrase the label/guideline text. Where the simulator's severity differs from the label, the message says so:
  - Dexmedetomidine with heart block is a LOCK, mirroring the controller. The label only says "use with caution".
  - Ketamine with uncontrolled hypertension is a WARN in the simulator. The label lists it as a contraindication.
  - Lidocaine with heart block is a WARN in the simulator. The label lists severe block as a contraindication.
  - Ketorolac below eGFR 30: the label says "advanced renal impairment", and the numeric cut-off comes from S35.
  - Succinylcholine with pre-existing hyperkalaemia is a LOCK by simulator policy. The label's exact wording on this point was not retrieved.
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
Type: consensus guideline

- **Supports:** Two interventions for adults at risk of PONV; dexamethasone 4–8 mg IV at induction (8 mg may be optimal); ondansetron 4 mg IV at end of surgery; dexamethasone plus a 5-HT3 antagonist as the best-studied pair. Baseline risk reduction includes avoidance of nitrous oxide during maintenance anaesthesia (with opioid-sparing analgesia, propofol TIVA where appropriate, regional anaesthesia, hydration).
- **Used by:** nitrous_oxide, dexamethasone, ondansetron
- **Verified via:** Copied from DOSING_SOURCES.md S8: WebSearch records of journals.lww.com (executive summary landing page), the LWW-hosted full report (cdn-links.lww.com/permalink/aa/f/aa_1_1_2025_11_24_cd_1_sdc1.pdf), scholars.duke.edu and a NYSORA summary, 2026-11-05. Full text not opened. PMID (identifier unverified). The nitrous-oxide baseline-risk-reduction item was confirmed only in a secondary summary (WebSearch record, nysora.com / dovepress review), not in the guideline text; secondary summaries add that the benefit of avoidance is duration dependent (Peyton & Wu meta-analysis cited by the consensus: NNT 9 for >2 h, 128 for <1 h). (date 2026-11-05)

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
Type: meta-analysis (age-adjusted MAC model)

- **Supports:** MAC(age) = MAC40 × 10^(−0.00269 × (age − 40)), same slope for all inhaled agents above age 1 y (about 6% decline per decade). MAC40: sevoflurane 1.80%, isoflurane 1.17%, desflurane 6.6%, nitrous oxide 104% (halothane 0.75%, enflurane 1.63%); 95% limits about ±7% (desflurane ±10%).
- **Used by:** sevoflurane, desflurane, isoflurane, nitrous_oxide
- **Verified via:** WebSearch records of the BJA 76(2) issue listing (citation, DOI), a Mapleson-authored abstract on scite.ai (MAC40 1.80% sevoflurane; b = −0.00269), and a StatPearls review quoting the equation, 2026-11-05. Isoflurane 1.17%, desflurane 6.6% and nitrous oxide 104% MAC40 values confirmed in the same scite.ai abstract record and repeated in secondary pages (meddic.jp; medicalalgorithms.com), 2026-11-05. Full text not opened. (date 2026-11-05)

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


### S36
**Desflurane, USP, volatile liquid for inhalation (SUPRANE). Baxter Healthcare. FDA-approved prescribing information (drugs.com copy revised July 2026; medlibrary.org and ndclist.com copies; DailyMed desflurane setid 21ba0e18-3dbc-4feb-a3a4-f6470c00910a).** https://medlibrary.org/lib/rx/meds/suprane/page/2/  
Identifiers: none confirmed

- **Supports:** Surgical levels of anesthesia in adults may be maintained with 2.5–8.5% with or without nitrous oxide; required concentration is age dependent. Can induce malignant hyperthermia in patients with known or suspected susceptibility based on genetic factors or family history (MH susceptibility listed as a contraindication). Concentrations exceeding 1 MAC may increase heart rate; a rapid increase in concentration is associated with marked increase in pulse rate, mean arterial pressure and catecholamines. Not recommended for induction in paediatric patients because of moderate to severe upper airway adverse events (laryngospasm, coughing, breath holding, apnea, increased secretions, desaturation).
- **Used by:** desflurane
- **Verified via:** WebSearch records of drugs.com/pro/suprane (current label, MH and heart-rate wording), medlibrary.org Suprane copies (2.5–8.5% maintenance sentence, older-format version; rapid-increase wording) and the DailyMed desflurane listing, 2026-11-05. The adult mask-induction statement ("not recommended for mask induction of anesthesia in adults") was seen only in the Canadian monograph and is not used as US wording. No US MAC-by-age table was retrieved. (date 2026-11-05)

### S37
**Isoflurane, USP (FORANE). Baxter Healthcare. FDA-approved prescribing information (FDA-hosted August 2006 PI, archived: webarchive.library.unt.edu ... fda.gov/MEDWATCH/safety/2006/Aug_PIs/Forane_PI.pdf).** https://webarchive.library.unt.edu/eot2008/20081028114252/http:/www.fda.gov/MEDWATCH/safety/2006/Aug_PIs/Forane_PI.pdf  
Identifiers: none confirmed

- **Supports:** Induction: start at 0.5%; 1.5–3.0% usually produces surgical anesthesia in 7–10 min. Maintenance: 1.0–2.5% in oxygen/nitrous oxide; an additional 0.5–1.0% may be required with oxygen alone. Average MAC in 100% O2: 1.28% (age 26 ± 4), 1.15% (44 ± 7), 1.05% (64 ± 5); in 70% N2O: 0.56%, 0.50%, 0.37%. Contraindications: known sensitivity to isoflurane or other halogenated agents; known or suspected genetic susceptibility to malignant hyperthermia.
- **Used by:** isoflurane
- **Verified via:** WebSearch records of the archived FDA-hosted 2006 Forane PI, the Baxter Canada Forane monograph and an Irish SmPC (consistent figures), 2026-11-05. US-format contraindication wording from the search record; drugs.com isoflurane page text was garbled and not relied on. (date 2026-11-05)

### Non-label sources for nitrous oxide (S38, S39)

These two sources are **not** FDA labels or society guidelines. The owner asked for nitrous oxide to be included. US nitrous oxide cylinder labels give no clinical concentration and no contraindications, only handling, fire and asphyxia warnings. So for N2O only, an RCT (S38) supplies the illustrative concentration and an animal physiology study (S39) supplies the closed-gas-space rules. Each entry is labelled with its type.

### S38
**Myles PS, Leslie K, Chan MTV, et al; ANZCA Trials Group for the ENIGMA-II investigators. The safety of addition of nitrous oxide to general anaesthesia in at-risk patients having major non-cardiac surgery (ENIGMA-II): a randomised, single-blind trial. Lancet. 2014;384(9952):1446-1454.** https://clinicaltrials.gov/study/NCT00430989  
Identifiers: doi:10.1016/S0140-6736(14)60893-X; PMID 25142708; NCT00430989  
Type: RCT

- **Supports:** Intervention arm: nitrous oxide at an inspired concentration of 70% in 30% oxygen; control: N2O-free with inspired oxygen 30%. 7112 patients ≥45 y with or at risk of coronary disease; death and cardiovascular complications at 30 days 8% in each group (RR 0.96, 95% CI 0.83–1.12). Avoiding nitrous oxide reduced severe PONV.
- **Used by:** nitrous_oxide
- **Verified via:** WebSearch records of the ClinicalTrials.gov NCT00430989 record ("inspired concentration of 70% in 30% Oxygen"), the University of Geneva archive record (citation, DOI, PMID), ANZCA repository and qxmd.com/r/25142708, 2026-11-05. Full text not opened. Non-label source: used because no US nitrous oxide label states a clinical concentration. (date 2026-11-05)

### S39
**Eger EI 2nd, Saidman LJ. Hazards of nitrous oxide anesthesia in bowel obstruction and pneumothorax. Anesthesiology. 1965;26:61-66.** https://pubmed.ncbi.nlm.nih.gov/14257336/  
Identifiers: PMID 14257336  
Type: physiology study

- **Supports:** Nitrous oxide diffuses into closed gas spaces faster than nitrogen leaves, expanding them: in dogs breathing 75% N2O, pneumothorax volume roughly doubled by 10 min and roughly tripled-to-quadrupled (about +300%) by 60 min, whereas oxygen did not change it; bowel gas also expanded. Authors concluded nitrous oxide is relatively contraindicated in intestinal obstruction or pneumothorax.
- **Used by:** nitrous_oxide
- **Verified via:** WebSearch records of PubMed 14257336 (citation; no abstract listed), the Scilit record (conclusion "relatively contraindicated in intestinal obstruction or pneumothorax"), BestBets review table (dog data, +100% at 10 min, ~+300% at 60 min) and a textbook figure reproduction (75% N2O), 2026-11-05. Full text not opened; volume figures are from secondary reproductions. Animal study (pneumothorax created by air injection). Non-label source: used because no US nitrous oxide label states contraindications. (date 2026-11-05)

### S40
**Epinephrine injection, USP 1 mg/mL (ADRENALIN). Par Pharmaceutical / Par Health USA. FDA-approved prescribing information (DailyMed setid 3b7a4364-668d-4eb2-a20c-04adc35aabe4; FDA-hosted label files 204200s004 (2016), 204200s009/204640s009 (2019), 204640Orig1s018 (2023)).** https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=3b7a4364-668d-4eb2-a20c-04adc35aabe4  
Identifiers: NDA 204200 / NDA 204640 (as shown in FDA-hosted label file names; not otherwise re-verified)

- **Supports:** Anaphylaxis, adults and children over 30 kg: 0.3–0.5 mg (0.3–0.5 mL) undiluted IM or SC into the anterolateral thigh, up to a maximum of 0.5 mg (0.5 mL) per injection, every 5–10 min as necessary; monitor clinically for reaction severity and cardiac effects; do not inject into buttock, digits, hands or feet. Hypotension associated with septic shock: dilute 1 mg in 1000 mL D5W (1 mcg/mL), large vein, 0.05–2 mcg/kg/min titrated to the desired MAP. Contraindications: None. Contains sodium bisulfite; "presence of sulfite in this product should not deter use for anaphylaxis". "Epinephrine may induce cardiac arrhythmias and myocardial ischemia in patients, especially patients suffering from coronary artery disease, or cardiomyopathy."
- **Used by:** epinephrine
- **Verified via:** WebSearch records (2026-11-05) of DailyMed Adrenalin listings (setids 3b7a4364-…, 7663c49d-…, b293ad8e-…), drugs.com/pro/adrenalin-injection, the FFF Enterprises-hosted Adrenalin PI PDF, guidelinecentral.com and FDA-hosted Adrenalin labels 204200s004 / 204200s009 / 204640s018. The weight boundary appeared as "over 30 kg" (children "30 kg or less"); wording may differ between versions. Full label text not opened (DailyMed and accessdata.fda.gov unreachable from the build environment). (date 2026-11-05)

### S41
**Epinephrine injection (generic 1 mg/mL vial; NDA 215425). FDA-approved prescribing information, 2025 (215425s000lbl.pdf); and other generic epinephrine injection labels (NDA 205029, 2021–2025 revisions; Pfizer/Hospira labeling).** https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/215425s000lbl.pdf  
Identifiers: NDA 215425; NDA 205029 (as shown in FDA-hosted label file names)

- **Supports:** Septic-shock hypotension: 0.05–2 mcg/kg/min titrated to the desired MAP; adjust e.g. every 10–15 min in increments of 0.05–0.2 mcg/kg/min; wean incrementally after stabilisation. "The ideal body weight (IBW) should be used as the weight parameter for dosing epinephrine in adult patients with septic shock associated hypotension" (215425 label). Sulfite should not deter use for septic-shock hypotension.
- **Used by:** epinephrine
- **Verified via:** WebSearch records (2026-11-05) of FDA-hosted labels 215425s000 (IBW sentence quoted verbatim), 205029Orig1s009 and 205029Orig1s015, DailyMed generic listings and a Pfizer highlights page ("0.05 mcg/kg/min to 2 mcg/kg/min, titrated to achieve desired mean arterial pressure (2.2) • Wean gradually"). The exact label carrying each titration/weaning excerpt was not pinned down. Full text not opened. (date 2026-11-05)

### S42
**Eleveld DJ, Colin P, Absalom AR, Struys MMRF. Pharmacokinetic-pharmacodynamic model for propofol for broad application in anaesthesia and sedation. Br J Anaesth. 2018;120(5):942-959. Corrigendum: Br J Anaesth. 2018;121(2):519.** https://www.bjanaesthesia.org/article/S0007-0912(18)30051-5/fulltext  
Identifiers: doi:10.1016/j.bja.2018.01.018; PMID 29661412  
Type: published population PK-PD model

- **Supports:** The propofol PK model (see "Propofol PK model" below).
- **Used by:** propofol (`pkModel: 'eleveld'`)
- **Verified via:** see "Propofol PK model" below. (date 2026-11-05)

### S43
**Evans L, Rhodes A, Alhazzani W, et al. Surviving Sepsis Campaign: international guidelines for management of sepsis and septic shock 2021. Crit Care Med. 2021 (published simultaneously in Intensive Care Med. 2021).** https://sccm.org/sepsisguidelines  
Identifiers: none confirmed (volume, pages, DOI and PMID not re-verified)  
Type: guideline

- **Supports:** "For adults with sepsis-induced hypoperfusion or septic shock, we suggest that at least 30 mL/kg of IV crystalloid fluid should be given within the first 3 hours of resuscitation" — weak recommendation, low quality of evidence (downgraded from strong in 2016).
- **Used by:** engine only (context text logged when a sepsis patient's cumulative crystalloid reaches 30 mL/kg). No dose, threshold or effect size in the simulator is derived from it.
- **Verified via:** WebSearch records (2026-11-05) of sccm.org/sepsisguidelines, an AMiner executive-summary record, emDocs and Red Cross summaries and a CME PDF reproducing the wording and grading. The guideline text itself was not opened. (date 2026-11-05)

## Propofol PK model

Propofol now uses the **Eleveld 2018** published population PK model (`pkModel: 'eleveld'`, arterial form, `engine/pk.js` `ELEVELD_2018` / `eleveldPropofol()`); `pkModelFallback: 'calibrated'` keeps the illustrative model available. Order tried: Eleveld 2018 → (Schnider 1998/1999, Marsh 1991 not needed). Eleveld was implemented because its full parameter set could be checked in more than two independent sources.

**How it was verified.** The publisher page, PMC, PubMed and doi.org could not be opened from the build environment, and the PK theta values were **not** displayed in any publisher or PubMed search record. The parameter set was therefore taken from four sources that agree to the printed precision:

1. CRAN package **tci** 0.2.1 (R. Jarrett), `R/poppk_mods.R` `pkmod_eleveld_ppf` (GitHub mirror cran/tci, cloned 2026-11-05).
2. PyPI **python-anesthesia-simulator** 1.0.0 (B. Aubouin-Pairault), `pk_models.py` (thetas at full precision, e.g. Θ1 6.2830780766822).
3. **vitaldb/tivatci**, `tivatci/__init__.py`.
4. **stanpumpR** (S. L. Shafer) `papers/digests/PMID_29661412.md`: a digest of the paper PDF quoting Table 2/3 values with 99% CIs, page numbers, the printed equations and the corrigendum Q2 value. It is itself an AI-assisted reading, so it is secondary.

Cross-check against publication records: the PD/effect-site values (ke0 0.146 arterial, 1.24 venous; Ce50 3.08; age term −0.00635; BIS0 93.0; γ 1.47/1.89) were seen in a WebSearch record of the BJA table. The model structure was also seen in search records: three compartments, covariates age, weight, height, sex and concomitant drugs, with an opioid effect lowering CL and V3 in an age-dependent way. Citation, DOI, PMID and corrigendum were seen in bvsalud/mardi4nfdi/BJA records. The owner should still compare the Θ values below with Table 2 of the paper and the corrigendum, which asks implementers to use the supplementary NONMEM control streams.

| Parameter | Value | Source |
|---|---|---|
| Θ1 V1ref | 6.28 L | Table 2 (via 1–4) |
| Θ2 V2ref | 25.5 L | Table 2 |
| Θ3 V3ref | 273 L | Table 2 |
| Θ4 CLref male | 1.79 L/min | Table 2 |
| Θ5 Q2ref | 1.75 L/min (1.83 at reference after Θ16 term; corrigendum) | Table 2 / corrigendum |
| Θ6 Q3ref | 1.11 L/min | Table 2 |
| Θ7 residual error | 0.191 | Table 2 (not used) |
| Θ8 CL maturation E50 | 42.3 weeks PMA | Table 2 |
| Θ9 CL maturation slope | 9.06 | Table 2 |
| Θ10 V2 age | −0.0156 /yr | Table 2 |
| Θ11 CL age (with concomitant drugs) | −0.00286 /yr | Table 2 |
| Θ12 V1 weight E50 | 33.6 kg | Table 2 |
| Θ13 V3 age (with concomitant drugs) | −0.0138 /yr | Table 2 |
| Θ14 Q3 maturation E50 | 68.3 weeks | Table 2 |
| Θ15 CLref female | 2.10 L/min | Table 2 |
| Θ16 Q2 maturation factor | 1.30 | Table 2 |
| Θ17 V1 venous factor | 1.42 | Table 2 (venous form only) |
| Θ18 Q2 venous factor | 0.68 | Table 2 (venous form only) |
| ke0 arterial | 0.146 min⁻¹ × (WGT/70)^−0.25 | Table 3 Θ2 (also search record) |
| ke0 venous | 1.24 min⁻¹ × (WGT/70)^−0.25 | Table 3 Θ8 (not used) |
| Reference individual | 35 y, 70 kg, 170 cm, male | paper p943 (via 4) |

Equations (as printed, p948, and identical in sources 1–4): V1 = Θ1·f(WGT)/f(70), f(x) = x/(x+Θ12); V2 = Θ2·(WGT/70)·exp(Θ10·(AGE−35)); V3 = Θ3·(FFM/FFMref)·fop(Θ13); CL = (Θ4 male | Θ15 female)·(WGT/70)^0.75·fCLmat/fCLmat,ref·fop(Θ11); Q2 = Θ5·(V2/Θ2)^0.75·(1+Θ16·(1−fQ3mat)); Q3 = Θ6·(V3/Θ3)^0.75·fQ3mat/fQ3mat,ref; fop(x) = exp(x·AGE) with concomitant drugs, else 1; fCLmat = PMA^Θ9/(PMA^Θ9+Θ8^Θ9); fQ3mat = (AGE·52+40)/(AGE·52+40+Θ14); PMA (weeks) = AGE·52+40. FFM = Al-Sallami 2015: male (0.88 + 0.12/(1+(AGE/13.4)^−12.7))·9270·WGT/(6680+216·BMI); female (1.11 − 0.11/(1+(AGE/7.1)^−1.1))·9270·WGT/(8780+244·BMI).

**Reference values reproduced in tests** (`tests/models.test.mjs`, implementation verification, not validation):
- Reference individual, no concomitant drugs: V1 6.28, V2 25.5, V3 273 L; CL 1.79, Q2 1.83 (corrigendum), Q3 1.11 L/min; ke0 0.146 min⁻¹. Female CL 2.10 L/min.
- Same individual with concomitant opioid: CL 1.619 L/min, V3 ≈ 168.2 L, Q3 ≈ 0.771 L/min (as computed in the stanpumpR digest; this code gives V3 168.4 because it uses the 3-significant-figure Θ3 = 273).
- Derived, not a published table value: bolus time to peak Ce ≈ 2.9 min at the reference (also the digest's derived figure).

**Simulator choices (not part of the published model):** the arterial form is used. The concomitant-drug switch is set once, when the propofol model is first created: it is ON if an opioid or IV local anaesthetic is in the plan or already given. The simulated depth index, sedation level, MAP and respiratory effects still come from the illustrative PD in `engine/pd.js`. They are driven by Ce normalised to the peak Ce of a 2 mg/kg bolus in the Eleveld reference individual. The Eleveld BIS model is **not** used, and the depth index is not BIS.

Cross-checking mattered: one implementation's Schnider function (tci 0.2.1 `pkmod_schnider`) uses lean body mass where Schnider's CL equation uses weight. This was noticed while comparing sources, and Schnider is not used here.

## Epinephrine and IV fluids

- **Epinephrine** (S40, S41): `rescue` = anaphylaxis IM 0.3 mg (range 0.3–0.5 mg; label maximum 0.5 mg per injection, hard stop), modelled with an illustrative IM absorption constant. `maintenance` = septic-shock infusion 0.05–2 mcg/kg/min on ideal body weight. The 2 mcg/kg/min hard stop is the top of the labelled range, which the label does not call a maximum. This follows the phenylephrine pattern (rescue bolus + maintenance infusion), because one regimen key cannot hold two dose kinds. Warnings: CAD, and HFrEF as a policy mapping of "cardiomyopathy". The label lists no contraindications. **Push-dose epinephrine is not included (no label/guideline dose verified).** An IV epinephrine bolus is blocked with that reason.
- **IV fluid bolus** (`sim.action('fluid_bolus:250' | 'fluid_bolus:500' | 'fluid_bolus')`, default 500 mL crystalloid; `state.fluids = { crystalloidMl, infusingMl, boluses }`; `summary().fluids`). The response model is **illustrative** (see Model assumptions). The only cited item is S43, which is logged as context text for sepsis patients at 30 mL/kg.

## Not included, and why

| Item | Reason |
|---|---|
| Marsh 1991 propofol PK parameters (`pkModel: 'marsh'`) | The citation was confirmed (Br J Anaesth 1991;67(1):41-48, doi:10.1093/bja/67.1.41). The adult parameter set was **not** displayed in any search record. Two implementations (tci, python-anesthesia-simulator) agree with the engine's constants, but that is not a check of the paper. Not needed: propofol uses Eleveld 2018 (see "Propofol PK model"). |
| Schnider 1998/1999 propofol model | Not needed, because Eleveld 2018 was verified first. Not implemented. |
| Push-dose (IV bolus) epinephrine | Not included: no label or guideline dose was verified. The simulator blocks an IV epinephrine bolus with this reason. |
| Epinephrine onset/peak/duration; IM absorption time course | No label timing statement was verified. The engine uses illustrative author estimates (`ILLUSTRATIVE_PK.epinephrine`, `ROUTE_KA_ILLUSTRATIVE`). |
| Epinephrine label wording on hypovolaemia, hyperthyroidism, diabetes and Parkinson's disease | Not retrieved verbatim in this session, so no rule was added. Only the CAD/cardiomyopathy warning is used. |
| Fluid-response physiology (volume expansion, crystalloid redistribution) | No source was verified for the size or time course of the MAP response to a crystalloid bolus. The model is illustrative. The SSC 2021 30 mL/kg statement (S43) is shown only as context. |
| Blood products, colloids, fluid-overload harm | Not modelled. |
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
| Janmahasatian numerator (9270) | The citation, DOI and denominators were confirmed, but the numerator was not displayed in a search record. Treat it as unverified from this source (S34). The same 9270 numerator appears in the Al-Sallami fat-free-mass equation as implemented in four independent Eleveld propofol implementations (see S42), which is consistent but is not a check of the Janmahasatian paper. |
| Mapleson 1996 PMID; PONV 5th consensus PMID; sevoflurane NDA | Identifiers unverified. Omitted. |
| Bratzler 2013 antibiotic prophylaxis | Not part of the simulator's drug set, so it is not registered here. |
| Nitrous oxide: 50% lower bound, vitamin B12/folate and middle-ear/eye-gas rules, intracranial air | No confirmable primary or guideline source was found. B12 and middle-ear wording was seen only in non-US product information. The maintenance range is therefore the single ENIGMA-II value of 70%, and the only N2O rules are pneumothorax (LOCK, as simulator policy) and bowel obstruction (WARN), both from S39. N2O is not an MH trigger, so it has no MH lock. |
| Desflurane induction regimen and airway-irritability warning | The US adult mask-induction wording was not retrieved. "Not recommended for mask induction in adults" was seen only in the Canadian monograph. The US label's airway-event statement found concerns paediatric induction, which is outside scope. Desflurane therefore has a maintenance regimen only. The verified heart-rate/rapid-increase wording is a runtime warning. |
| Desflurane US MAC-by-age table | Not retrieved. Only the Mapleson MAC40 (6.6%) is used. |
| Dexamethasone under `emergence` | S2 and S3 say to give it at induction. The regimen is stored under `induction`, with a note. |

## Model assumptions (illustrative)

- All drugs except propofol use `pkModel: 'calibrated'`. The engine fits illustrative constants to the `timing` values above, or uses its own fallbacks when those are null. Propofol PK (with ke0) is the published Eleveld 2018 model (S42). Apart from that and the Mapleson age-adjusted MAC equation (S26), no PK/PD parameter is a published model. Every PD effect size (sigmoid weights, EC50s, gammas), including propofol's, is an author estimate. `sim.modelInfo().inventory` lists every parameter with its provenance.
- **Epinephrine PD** (`engine/pd.js` `PROFILES.epinephrine`, author estimates): concentration is normalised to steady state at 0.05 mcg/kg/min (u = 1). At u ≈ 1: MAP +8%, HR +6%, bronchodilation 0.5. At the peak after 0.3 mg IM (u ≈ 6): MAP ≈ +25%, HR ≈ +24%, bronchodilation ≈ 0.97. Bronchodilation counters the bronchospasm (× (1 − 0.8·B)) and anaphylaxis (× (1 − 0.7·B)) scenario intensities. PK: k10 0.3, k12 0.05, k21 0.01, ke0 1.0 min⁻¹. IM absorption ka 0.15 min⁻¹ (SC 0.07). All are illustrative and not from the label.
- **IV fluid bolus** (`engine/sim.js` `FLUID_MODEL`, author estimates): 250 or 500 mL crystalloid, default 500 mL. Bolus sizes are UI choices, not recommendations. Run-in is 50 mL/min. Retained intravascular volume R decays with τ = 40 min. Restoration r = 1 − exp(−R/750 mL), which gives diminishing returns. A volume-loss event (hemorrhage) has its intensity multiplied by (1 − 0.8·r). **Cap:** fluids offset at most 80% of the event, because ongoing bleeding needs surgical control. Direct MAP effect is +4%·r when euvolaemic and +10%·r with the hypovolemia or sepsis condition. With these constants, 500 mL raised MAP by about 12 mmHg in a hemorrhage case and about 2 mmHg in a euvolaemic patient (fictional 80 kg adult).
- **Awake room-air oxygenation** (fix, 2026-11-05): FRC (obesity/OSA/elderly/COPD) now scales only the O2 store, which sets how fast SpO2 falls during apnoea. It no longer scales the steady-state alveolar balance. Before the fix, an awake obese patient with no drugs settled near SpO2 40% on room air. Regression tests check all example patients stay within 2% of baseline, and that the obese patient still desaturates faster during apnoea.
- **Additive MAC of co-administered inhaled agents** (`LIBRARY_NOTES.inhaledMacAdditivity`). The engine treats MAC fractions as additive. This is standard teaching. **No acceptable source was verified for it in this session**, so it is uncited.
- Isoflurane and desflurane also use the Mapleson equation (MAC40 1.17% and 6.6%, the same slope). The isoflurane label table (1.28/1.15/1.05% at mean ages 26/44/64 y) is stored for display.
- **N2O and FiO2:** the maximum FiO2 is 1 − FiN2O (70% N2O leaves at most 0.30). This is simple arithmetic, so no source is cited.
- **N2O cannot work alone:** its MAC40 is 104% (Mapleson), so it cannot provide anaesthesia alone at 1 atm and is modelled only as an adjunct.
- Sevoflurane carries two MAC references: Mapleson MAC40 = 1.80% and the US label table (2.1% at 40 y in O2). They differ. The engine's effect model uses Mapleson, and the UI may show both.

## Verification and validation status

Terms follow the FDA computational-modelling credibility vocabulary (verification = the code does what the model says; validation = the model matches the real system). **This simulator has not been validated.**

- **Verification (automated tests, `cd simulator && npm test`, 108 tests passing on 2026-11-05):**
  - drug-library schema and source integrity (`drugs.test.mjs`): ids, ranges, `when` grammar, that every referenced S-id exists, and required contraindication rules;
  - dosing arithmetic and ceilings (`dosing.test.mjs`);
  - patient derivations: BMI, IBW/LBW/ABW, Apfel, STOP-Bang, flags (`patient.test.mjs`);
  - parity with the Python Smart NOA controller (`parity.test.mjs`): reproduces the `EXAMPLE_RESULTS.json` GREEN/RED/HOLD decisions and the `test_safety_hardening.py` regressions (NaN/None fail-safe, direct-write bypass, ceilings, matching);
  - engine behaviour (`sim.test.mjs`, run against a fixture library and the real library): PK mass balance and steady state, calibrated fits to label timing, determinism per seed, scenarios, alarms, interlocks, full GA/MAC runs;
  - model extensions (`models.test.mjs`): the Eleveld 2018 implementation reproduces published reference-individual values (V1 6.28, V2 25.5, V3 273 L; CL 1.79/2.10, Q2 1.83, Q3 1.11 L/min; ke0 0.146) and the opioid-switch values; epinephrine regimens, route block and qualitative effects; fluid tracking and qualitative response; the parameter inventory (every parameter has a provenance and existing source ids); and the awake room-air SpO2 regression.
  Reproducing published numbers checks the implementation only. It does not show that simulated patients behave like real ones.
- **Face validity:** no expert (clinician) review is recorded.
- **External validation:** none. No simulated output has been compared with patient data, monitor recordings or published clinical time courses.
- **Parts that cannot be validated with the sources available:** all PD effect sizes (depth index, MAP/HR/respiratory effects, opioid synergy, NMB/TOF mapping); the calibrated PK constants (fitted only to label onset/duration statements); epinephrine PK/PD and IM absorption; the fluid-response model; physiology gains and time constants (stimulus, apnoea, CO2, noise); scenario perturbation magnitudes; patient-modifier multipliers; alarm and extubation thresholds (simulator choices); and the depth index itself, which is not BIS. `sim.modelInfo().inventory` labels each of these `author_estimate_unvalidated`.
