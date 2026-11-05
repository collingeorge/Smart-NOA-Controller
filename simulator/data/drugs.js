// Smart NOA Web Simulator — drug library (pure data, no DOM).
//
// EDUCATIONAL SIMULATION WITH FICTIONAL PATIENTS. Not a medical device, not clinical decision
// support, not medical advice. Every dose below is an illustrative value transcribed from the cited
// source (FDA prescribing information, society guideline/consensus, or original validation paper).
// None is an order. Labels vary by manufacturer and are revised often.
//
// Schema: simulator/SPEC.md §4. Human-readable registry: simulator/SOURCES.md.
//
// S100+ (palliative and end-of-life modules) live in data/palliative.js and are merged into
// SOURCES at the end of this file, so the Sources panel lists them.
import { PALLIATIVE_SOURCES } from './palliative.js';
//
// ---------------------------------------------------------------------------------------------
// S-id mapping to /home/user/breast-reconstruction-anesthesia-protocol/DOSING_SOURCES.md
// (citation and verification text copied from that registry; new entries verified 2026-11-05):
//   S1  <- S1  Foo 2021 lidocaine consensus
//   S2  <- S7  Gan 2020 Fourth PONV consensus
//   S3  <- S8  Gan 2025 Fifth PONV consensus
//   S4  <- S9  Apfel 1999
//   S5  <- S10 Thilen 2023 ASA NMB guideline
//   S6  <- S11 Sugammadex (Bridion) label
//   S7  <- S12 Neostigmine (Bloxiverz) label
//   S8  <- S13 Glycopyrrolate label
//   S9  <- S14 Dexmedetomidine (Precedex) label
//   S10 <- S15 Schwenk 2018 ketamine consensus
//   S11 <- S16 Propofol (Diprivan) label (+ MAC-sedation and onset text verified this session)
//   S12 <- S17 Rocuronium label (+ 2026 FDA label timing verified this session)
//   S13 <- S18 Fentanyl label (+ moderate-dose tier and timing verified this session)
//   S14 <- S22 Naloxone label (+ onset verified this session)
//   S15 <- S23 Ketorolac label (+ contraindications verified this session)
//   S16 <- S24 Acetaminophen injection (Ofirmev) label
//   S17 <- S27 Midazolam label (+ onset verified this session)
//   S18 <- S28 Phenylephrine (Biorphen) label
//   S19 <- S29 Ephedrine (Akovaz) label
//   S20 <- S32 Chung 2008 STOP-Bang
//   S21 <- S33 Chung 2016 STOP-Bang risk categories
//   S22 <- S35 ASA Standards for Basic Anesthetic Monitoring
//   S23–S35 new in this registry (no counterpart in DOSING_SOURCES.md).
// ---------------------------------------------------------------------------------------------
//
// Conventions used throughout (also documented in SOURCES.md):
// * `default` values: the label's stated usual/average/initial dose where the label names one;
//   otherwise the LOWER bound of the stated range. Where a source gives only an upper limit
//   ("not exceeding X"), min is 0 and default is X (noted per regimen). Defaults are a simulator
//   choice for auto-fill, not a recommendation.
// * `scalarBasis`: 'label' / 'guideline' when the source states the weight scalar; 'convention'
//   when the source just says "mg/kg" and the simulator applies total body weight (TBW).
// * Ceiling `basis`: 'label maximum' / 'guideline maximum' only when the source states a maximum;
//   'label range upper bound' when the simulator hard-stops at the top of a labelled range that the
//   label does not call a maximum.
// * `timing`: numbers only from label statements; when a label gives a range the midpoint is used
//   and the range is kept in `ranges`. Missing values are null and the engine falls back to its
//   illustrative defaults. `basis: 'not stated in label'` means no usable label statement was
//   verified.
// * `when` grammar (contraindications): exactly one token of
//     condition:<id> | allergy:<id> | medication:<id> | egfr<N | age>=N | flag:<id>
//   `adjust[].when` may join several tokens with '|' (logical OR) and may also use asa>=N and
//   weight<N (kg, total body weight).

export const SOURCES = {
  S1: {
    id: 'S1',
    citation: 'Foo I, Macfarlane AJR, Srivastava D, et al. The use of intravenous lidocaine for postoperative pain and recovery: international consensus statement on efficacy and safety. Anaesthesia. 2021;76(2):238-250.',
    url: 'https://read.qxmd.com/read/33141959',
    identifiers: 'doi:10.1111/anae.15270; PMID 33141959',
    type: 'consensus statement',
    supports: 'Lidocaine loading dose ≤1.5 mg/kg over about 10 min; infusion ≤1.5 mg/kg/h; dosing on ideal body weight; hourly ceiling 120 mg/h for any patient; not for patients under 40 kg; not given concurrently with other local-anaesthetic interventions (nerve blocks, wound infiltration) or while their effect is still active; about 4 h separation between a block and IV lidocaine. IV lidocaine for analgesia is not an FDA-labelled indication.',
    verifiedVia: 'Copied from DOSING_SOURCES.md S1: WebSearch record of the abstract and full-text excerpts (Nottingham and Glasgow repository copies; read.qxmd.com/read/33141959), 2026-11-05.',
  },
  S2: {
    id: 'S2',
    citation: 'Gan TJ, Belani KG, Bergese S, et al. Fourth consensus guidelines for the management of postoperative nausea and vomiting. Anesth Analg. 2020;131(2):411-448.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/32467512/',
    identifiers: 'doi:10.1213/ANE.0000000000004833; PMID 32467512',
    type: 'consensus guideline',
    supports: 'Dexamethasone 4–8 mg IV at induction; ondansetron 4 mg IV at end of surgery; rescue with a different drug class.',
    verifiedVia: 'Copied from DOSING_SOURCES.md S7: WebSearch records of PubMed 32467512 and of the APSF podcast notes and the Meyer TSHP handout summarizing Table 4, 2026-11-05. Superseded in part by S3.',
  },
  S3: {
    id: 'S3',
    citation: 'Gan TJ, et al. Fifth consensus guidelines for the management of postoperative nausea and vomiting: executive summary. Anesth Analg. Published online November 14, 2025.',
    url: 'https://journals.lww.com/anesthesia-analgesia/',
    identifiers: 'doi:10.1213/ANE.0000000000007816; PMID unverified',
    type: 'consensus guideline',
    supports: 'Two interventions for adults at risk of PONV; dexamethasone 4–8 mg IV at induction (8 mg may be optimal); ondansetron 4 mg IV at end of surgery; dexamethasone plus a 5-HT3 antagonist as the best-studied pair. Baseline risk reduction includes avoidance of nitrous oxide during maintenance anaesthesia (with opioid-sparing analgesia, propofol TIVA where appropriate, regional anaesthesia, hydration).',
    verifiedVia: 'Copied from DOSING_SOURCES.md S8: WebSearch records of journals.lww.com (executive summary landing page), the LWW-hosted full report (cdn-links.lww.com/permalink/aa/f/aa_1_1_2025_11_24_cd_1_sdc1.pdf), scholars.duke.edu and a NYSORA summary, 2026-11-05. Full text not opened. PMID (identifier unverified). The nitrous-oxide baseline-risk-reduction item was confirmed only in a secondary summary (WebSearch record, nysora.com / dovepress review), not in the guideline text; secondary summaries add that the benefit of avoidance is duration dependent (Peyton & Wu meta-analysis cited by the consensus: NNT 9 for >2 h, 128 for <1 h).',
  },
  S4: {
    id: 'S4',
    citation: 'Apfel CC, Läärä E, Koivuranta M, Greim CA, Roewer N. A simplified risk score for predicting postoperative nausea and vomiting: conclusions from cross-validations between two centers. Anesthesiology. 1999;91(3):693-700.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/10485781/',
    identifiers: 'doi:10.1097/00000542-199909000-00022; PMID 10485781',
    type: 'score validation',
    supports: 'Four risk factors (female sex, non-smoking, history of PONV or motion sickness, postoperative opioids), one point each; estimated PONV incidence for 0–4 factors about 10%, 21%, 39%, 61%, 79%.',
    verifiedVia: 'Copied from DOSING_SOURCES.md S9: citation and percentages as audited in v2.0 of that repository against the PubMed record; not re-searched in this session (2026-11-05).',
  },
  S5: {
    id: 'S5',
    citation: 'Thilen SR, Weigel WA, Todd MM, et al. 2023 American Society of Anesthesiologists practice guidelines for monitoring and antagonism of neuromuscular blockade. Anesthesiology. 2023;138(1):13-41.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/36520073/',
    identifiers: 'doi:10.1097/ALN.0000000000004379; PMID 36520073',
    type: 'society guideline',
    supports: 'Quantitative monitoring; confirm TOFR ≥0.9 before extubation; sugammadex over neostigmine for deep, moderate and shallow rocuronium/vecuronium block; neostigmine reasonable at minimal depth (TOFR 0.4 to <0.9).',
    verifiedVia: 'Copied from DOSING_SOURCES.md S10: WebSearch record of PubMed 36520073 and the APSF summary, 2026-11-05.',
  },
  S6: {
    id: 'S6',
    citation: 'Sugammadex injection (BRIDION). Merck Sharp & Dohme LLC. FDA-approved prescribing information, revised 11/2022.',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2022/022225Orig1s012lbl.pdf',
    identifiers: 'NDA 022225',
    type: 'FDA label',
    supports: '2 mg/kg at reappearance of T2; 4 mg/kg at 1–2 post-tetanic counts with no TOF twitch; 16 mg/kg for immediate reversal about 3 min after rocuronium 1.2 mg/kg; dosing on actual body weight. Contraindication: known hypersensitivity to sugammadex or any of its components. DESCRIPTION: sugammadex sodium molecular weight 2178.01; each mL contains 100 mg sugammadex, equivalent to 108.8 mg sugammadex sodium (used for the 1:1 molar binding).',
    verifiedVia: 'Dosing copied from DOSING_SOURCES.md S11 (WebSearch record of the FDA-hosted 2022 label, the Merck PI and the Medsafe datasheet, 2026-11-05). Contraindication wording "Known hypersensitivity to sugammadex or any of its components" confirmed in a WebSearch record of the US label, 2026-11-05. Median recovery times were found only in non-US datasheets and are not used. 2026-11 audit: molecular weight 2178.01 and the 100 mg sugammadex = 108.8 mg sugammadex sodium equivalence confirmed in WebSearch records of medlibrary.org Bridion label copies (US label text), the Dutch and Singapore registry entries (108.8 mg/mL), PharmaCompass/NCATS (2178.0 g/mol, C72H104Na8O48S8). The 2/4/16 mg/kg depth wording is used for a runtime dose-vs-depth warning.',
  },
  S7: {
    id: 'S7',
    citation: 'Neostigmine methylsulfate injection (BLOXIVERZ). Exela Pharma Sciences. FDA-approved prescribing information, 2023 revision.',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/204078Orig1s014lbl.pdf',
    identifiers: 'NDA 204078',
    type: 'FDA label',
    supports: '0.03–0.07 mg/kg IV (0.03 mg/kg for shorter half-life agents such as rocuronium); maximum total 0.07 mg/kg or 5 mg, whichever is less; anticholinergic before or with neostigmine; TOF0.9 generally within 10–20 min. Contraindications: hypersensitivity to neostigmine; peritonitis or mechanical obstruction of the intestinal or urinary tract.',
    verifiedVia: 'Dosing copied from DOSING_SOURCES.md S12 (WebSearch record of the FDA-hosted 2023 and 2015 labels and the Amneal PI, 2026-11-05). Contraindications and the "TOF0.9 within 10 to 20 minutes" statement confirmed in a WebSearch record of the FDA-hosted 2023 label highlights and drugs.com/medlibrary copies, 2026-11-05.',
  },
  S8: {
    id: 'S8',
    citation: 'Glycopyrrolate injection, USP. Multiple manufacturers (label copies indexed at medlibrary.org/lib/rx/meds/glycopyrrolate-54/). FDA-approved prescribing information (revision dates vary).',
    url: 'https://medlibrary.org/lib/rx/meds/glycopyrrolate-54/',
    identifiers: 'none (multiple ANDAs)',
    type: 'FDA label',
    supports: 'With neostigmine reversal, 0.2 mg glycopyrrolate per 1 mg neostigmine. Intraoperative use: 0.1 mg IV, repeated as needed at 2–3 min intervals.',
    verifiedVia: 'Copied from DOSING_SOURCES.md S13: WebSearch record of several label copies (medlibrary.org; ndclist.com), 2026-11-05. The 0.1 mg wording was confirmed in one manufacturer\'s label but not tied to its section heading.',
  },
  S9: {
    id: 'S9',
    citation: 'Dexmedetomidine hydrochloride injection (PRECEDEX). Hospira, Inc. (Pfizer). FDA-approved prescribing information, 2026 revision.',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/021038s061lbl.pdf',
    identifiers: 'NDA 021038',
    type: 'FDA label',
    supports: 'Procedural sedation of non-intubated patients: loading 1 mcg/kg over 10 min (0.5 mcg/kg over 10 min for less invasive procedures); maintenance started at 0.6 mcg/kg/h, titrated 0.2–1 mcg/kg/h. ICU maintenance 0.2–0.7 mcg/kg/h. >65 y: loading 0.5 mcg/kg over 10 min, consider reducing maintenance. Hepatic impairment: consider reduction. Contraindications: none. Warning: use with caution in advanced heart block and/or severe ventricular dysfunction. Use as a general-anaesthesia adjunct is off-label. Sequence (label): initiate with the loading infusion over 10 minutes, followed by the maintenance infusion.',
    verifiedVia: 'Dosing copied from DOSING_SOURCES.md S14 (WebSearch record of the FDA-hosted 2026 and 2013 labels and Pfizer labeling pages, 2026-11-05; procedural 0.6 and 0.2–1 mcg/kg/h wording confirmed in the 2013 text). Contraindications "None" and the heart-block caution confirmed in a WebSearch record of the DailyMed Precedex listing and pfizermedicalinformation.com/precedex/warnings, 2026-11-05. No onset time was found. Addition (2026-11-05): in the label\'s procedural-sedation clinical studies the maintenance infusion was titrated 0.2–1 mcg/kg/h to a target sedation score (Ramsay ≥ 2) and rescue midazolam was permitted as needed to achieve and/or maintain the target — WebSearch records of medlibrary.org Precedex label copies and pfizermedical.com/precedex/clinical-studies. No label sentence stating that dexmedetomidine alone may not reach deep sedation was found, so none is shown. Timing review (2026-11-05): the sequencing wording ("Initiate at one mcg/kg over 10 minutes, followed by a maintenance infusion initiated at 0.6 mcg/kg/hour") confirmed in a WebSearch record of the DailyMed Precedex label and Pfizer labeling copies (labeling.pfizer.com); used for loading-then-maintenance scheduling.',
  },
  S10: {
    id: 'S10',
    citation: 'Schwenk ES, Viscusi ER, Buvanendran A, et al. Consensus guidelines on the use of intravenous ketamine infusions for acute pain management from the American Society of Regional Anesthesia and Pain Medicine, the American Academy of Pain Medicine, and the American Society of Anesthesiologists. Reg Anesth Pain Med. 2018;43(5):456-466.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6023582/',
    identifiers: 'doi:10.1097/AAP.0000000000000806; PMID 29870457',
    type: 'consensus guideline',
    supports: 'Subanaesthetic ketamine for acute pain: bolus ≤0.35 mg/kg; infusions up to about 1 mg/kg/h; contraindications for acute pain largely mirror those for chronic pain. Analgesic ketamine is outside the FDA-labelled anaesthetic indications.',
    verifiedVia: 'Copied from DOSING_SOURCES.md S15: WebSearch record of PubMed 29870457, PMC6023582 and the ASRA guideline page, 2026-11-05. The 0.35 mg/kg and 1 mg/kg/h figures were confirmed in a secondary summary. The specific contraindication list was NOT retrieved in this session.',
  },
  S11: {
    id: 'S11',
    citation: 'Propofol injectable emulsion (DIPRIVAN). Fresenius Kabi USA. FDA-approved prescribing information, 2022 revision; and generic propofol injectable emulsion labels (medlibrary.org copies).',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/Label/2022/019627s069lbl.pdf',
    identifiers: 'NDA 019627',
    type: 'FDA label',
    supports: 'Pain on injection: may be reduced by using the larger veins of the forearm or antecubital fossa, and by prior injection of IV lidocaine (1 mL of a 1% solution); lidocaine should be given before propofol or added immediately before use (≤ 20 mg lidocaine per 200 mg propofol). DESCRIPTION: isotonic, pH 7 to 8.5. Induction <55 y about 2–2.5 mg/kg; elderly/debilitated/ASA III–IV about 1–1.5 mg/kg. Maintenance 100–200 mcg/kg/min (<55 y); 50–100 mcg/kg/min (elderly/ASA III–IV). MAC sedation initiation: 100–150 mcg/kg/min for 3–5 min or slow injection about 0.5 mg/kg over 3–5 min; slow infusion/injection preferable to rapid bolus; maintenance 25–75 mcg/kg/min during the first 10–15 min, then 25–50 mcg/kg/min; no rapid bolus for MAC sedation in elderly/debilitated/ASA III–IV. Onset: hypnosis usually within 40 s from start of injection. Contraindication: known hypersensitivity to propofol, egg or soybean (current label). Sequence (label): MAC sedation initiation over 3–5 min, then a maintenance infusion (rates stated for the first 10–15 min of sedation maintenance).',
    verifiedVia: 'Induction/maintenance copied from DOSING_SOURCES.md S16 (WebSearch record of the FDA-hosted 2022 label and the medlibrary.org label copy, 2026-11-05). MAC-sedation rates, slow-injection 0.5 mg/kg and the elderly no-rapid-bolus wording confirmed in WebSearch records of medlibrary.org propofol and Diprivan label copies (medlibrary.org/lib/rx/meds/propofol/, /diprivan/page/2/), 2026-11-05. 40 s onset confirmed in a WebSearch record of an ndclist.com label copy and the FDA-hosted 2014 label (019627s062). Contraindication wording from a WebSearch record of the current label highlights; older labels word it as anaphylaxis to eggs/egg products/soybeans/soy products. Additions (2026-11-05): injection-pain wording ("pain during intravenous injection may also be reduced by prior injection of IV lidocaine (1 mL of a 1% solution)"; larger veins of the forearm or antecubital fossa; boluses via small veins if pretreated with lidocaine; lidocaine given before propofol or added immediately before use, not exceeding 20 mg lidocaine per 200 mg propofol) and DESCRIPTION wording ("isotonic and has a pH of 7 to 8.5") confirmed in WebSearch records of medlibrary.org Diprivan label copies, drugs.com/pro/diprivan, guidelinecentral.com Diprivan listings and an FDA-archived Diprivan PI (webarchive.library.unt.edu). One trial-protocol copy of the lidocaine sentence was garbled; the medlibrary/drugs.com wording is used. Timing review (2026-11-05): "maintenance rates of 25 to 75 mcg/kg/min … during the first 10 to 15 minutes of sedation maintenance" after initiation over 3 to 5 minutes confirmed in WebSearch records of medlibrary.org propofol/Diprivan label copies and drugs.com/rxlist dosage summaries; no label sentence with the words "followed immediately" was found for MAC sedation, so the sequence is taken from the initiation/maintenance headings.',
  },
  S12: {
    id: 'S12',
    citation: 'Rocuronium bromide injection. Generic manufacturer labels (e.g., DailyMed setid a54a79f7-5207-43d8-a139-7d57557caa50), Pfizer prescribing information, and FDA-hosted 2026 rocuronium label (NDA 217472).',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2026/217472Orig1s000Lbl.pdf',
    identifiers: 'NDA 217472 (2026 label); others vary',
    type: 'FDA label',
    supports: 'Intubating dose 0.6 mg/kg; rapid sequence 0.6–1.2 mg/kg; maintenance guided by response (older labels: 0.1, 0.15 or 0.2 mg/kg at 25% recovery of T1). 0.6 mg/kg: maximum block in most patients in <3 min; 31 (15–85) min clinical relaxation. Contraindication (older label): hypersensitivity (e.g., anaphylaxis) to rocuronium bromide or other neuromuscular blocking agents. DESCRIPTION: C32H53BrN2O4, molecular weight 609.70 (used for the 1:1 molar sugammadex binding). Maintenance (older label): doses administered at 25% recovery of control T1, defined as 3 twitches of train-of-four; newer labels: not administered until recovery of neuromuscular function is evident.',
    verifiedVia: 'Dosing copied from DOSING_SOURCES.md S17 (WebSearch record of the Pfizer dosage page, the DailyMed listing and an FDA-hosted 2026 label, 2026-11-05). Timing ("less than 3 minutes", "31 (15-85) minutes") from a WebSearch record of the FDA-hosted 2026 label; contraindication wording from an older label copy (ndclist.com / labeling.pfizer.com), 2026-11-05. 2026-11 audit: molecular weight 609.70 confirmed in WebSearch records of the Pfizer rocuronium label description page (pfizermedicalinformation.com) and a DrugCentral label copy. Timing review (2026-11-05): "administered at 25% recovery of control T1 (defined as 3 twitches of train-of-four)" confirmed in WebSearch records of the archived FDA-hosted Zemuron PI (2008, webarchive.library.unt.edu) and a generic rocuronium label (prescriberpoint.com); the "until recovery of neuromuscular function is evident" wording seen in a Piramal-labelled version (search summary). Used for the rocuronium top-up rule (TOF count ≥ 3).',
  },
  S13: {
    id: 'S13',
    citation: 'Fentanyl citrate injection, USP. Hospira, Inc. (Pfizer) and Fresenius Kabi (August 2023 PI) prescribing information.',
    url: 'https://pfizermedicalinformation.com/fentanyl-citrate/dosage-admin',
    identifiers: 'none (multiple NDAs/ANDAs)',
    type: 'FDA label',
    supports: 'Individualized dosing; reduce initial dose in elderly/debilitated. General anaesthesia low dose 2 mcg/kg; moderate dose 2–20 mcg/kg with 25–100 mcg increments for maintenance. IV onset almost immediate; analgesia 30–60 min after a single IV dose up to 100 mcg. PRECAUTIONS: the initial dose should be appropriately reduced in elderly and debilitated patients; the effect of the initial dose should be considered in determining incremental doses (no figure given). Onset: almost immediate IV, but the maximal analgesic and respiratory depressant effect may not be noted for several minutes (no figure).',
    verifiedVia: 'Low-dose tier copied from DOSING_SOURCES.md S18 (WebSearch record of the Pfizer dosage page and Fresenius/medlibrary copies, 2026-11-05). Moderate-dose "2 mcg/kg to 20 mcg/kg, 25 mcg to 100 mcg" confirmed in a WebSearch record of the Fresenius Kabi August 2023 PI and ndclist.com label copies; the maintenance sentence itself was cut off in the snippet. Onset/duration from an archived (2008–2009) DailyMed label copy (webarchive.library.unt.edu), 2026-11-05. 2026-11 audit: PRECAUTIONS wording confirmed in WebSearch records of an archived DailyMed fentanyl citrate label (webarchive.library.unt.edu) and a Patterson Dental label PDF. A 25–50 mcg reduced-dose figure seen on one Pfizer-hosted page was not tied to the induction context and is not used. Timing review (2026-11-05): "The onset of action of fentanyl is almost immediate when the drug is given intravenously; however, the maximal analgesic and respiratory depressant effect may not be noted for several minutes" confirmed in a WebSearch record of the archived DailyMed fentanyl citrate label (webarchive.library.unt.edu) and pfizermedicalinformation.com clinical-pharmacology listings. A 5–15 min peak respiratory-depression figure seen on a Pfizer page is not used. The 3-min opioid-to-hypnotic spacing in the templates is a simulator convention anchored to "several minutes".',
  },
  S14: {
    id: 'S14',
    citation: 'Naloxone hydrochloride injection, USP. Generic manufacturer labels (copies indexed at medlibrary.org/lib/rx/meds/naloxone-hydrochloride-14/; labeling.pfizer.com).',
    url: 'https://labeling.pfizer.com/ShowLabeling.aspx?id=4542',
    identifiers: 'none (multiple ANDAs)',
    type: 'FDA label',
    supports: 'Postoperative opioid depression: 0.1–0.2 mg IV at 2–3 min intervals to desired reversal; repeat doses may be needed at 1–2 h intervals. IV onset generally apparent within 2 min; duration depends on dose and route.',
    verifiedVia: 'Dosing copied from DOSING_SOURCES.md S22 (WebSearch record of multiple label copies, 2026-11-05). Onset "generally apparent within two minutes" confirmed in WebSearch records of ndclist.com and labeling.pfizer.com label copies, 2026-11-05.',
  },
  S15: {
    id: 'S15',
    citation: 'Ketorolac tromethamine injection, USP. Hospira, Inc. (Pfizer) prescribing information.',
    url: 'https://www.pfizermedical.com/ketorolac-inj/dosage-admin',
    identifiers: 'none',
    type: 'FDA label',
    supports: '<65 y: 30 mg IV every 6 h, max 120 mg/day; ≥65 y, renally impaired or <50 kg: 15 mg every 6 h, max 60 mg/day; ≤5 days. Contraindicated in advanced renal impairment or risk for renal failure due to volume depletion; in patients with allergic reactions to aspirin or other NSAIDs; in patients currently receiving aspirin or NSAIDs. Also contraindicated: as a prophylactic analgesic before any major surgery; in patients with suspected or confirmed cerebrovascular bleeding, hemorrhagic diathesis, incomplete hemostasis and those at high risk of bleeding (inhibits platelet function); active peptic ulcer disease, recent gastrointestinal bleeding or perforation; in the setting of CABG surgery. WARNINGS (hemorrhage): peri-operative use should be avoided, and postoperative use undertaken with caution, when hemostasis is critical.',
    verifiedVia: 'Dosing copied from DOSING_SOURCES.md S23 (WebSearch record of the Pfizer dosage page and medlibrary.org copies, 2026-11-05). Contraindication wording confirmed in a WebSearch record of pfizermedicalinformation.com/ketorolac-inj/contradictions and the Hospira DailyMed listing, 2026-11-05. 2026-11 audit: WebSearch records of pfizermedicalinformation.com/ketorolac-inj/contradictions (cerebrovascular bleeding / hemorrhagic diathesis / incomplete hemostasis / high risk of bleeding, quoted), medlibrary.org and Searle ketorolac label copies ("CONTRAINDICATED as prophylactic analgesic before any major surgery"; peptic ulcer, GI bleeding/perforation; CABG; "peri-operative use ... should be avoided and postoperative use be undertaken with caution when hemostasis is critical"). The exact phrase "intraoperatively when hemostasis is critical" was seen only in the Canadian monograph, so the US WARNINGS wording is used, as a runtime warning.',
  },
  S16: {
    id: 'S16',
    citation: 'Acetaminophen injection (OFIRMEV). Mallinckrodt Hospital Products. FDA-approved prescribing information.',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2010/022450lbl.pdf',
    identifiers: 'NDA 022450',
    type: 'FDA label',
    supports: 'Adults ≥50 kg: 1000 mg every 6 h or 650 mg every 4 h, max single dose 1000 mg, max 4000 mg/day; <50 kg: 15 mg/kg every 6 h or 12.5 mg/kg every 4 h, maximum single dose 15 mg/kg up to 750 mg, maximum 75 mg/kg per 24 h up to 3750 mg; daily maximum counts all routes. Contraindicated in severe hepatic impairment; caution in hepatic impairment.',
    verifiedVia: 'Copied from DOSING_SOURCES.md S24: WebSearch record of the FDA-hosted 2010 label, the Mallinckrodt PI and drugs.com label copy, 2026-11-05. 2026-11 audit: the <50 kg absolute caps (15 mg/kg up to 750 mg per dose; 75 mg/kg up to 3750 mg per 24 h) confirmed in WebSearch records of the FDA-hosted 2010 label (accessdata 022450lbl.pdf), drugs.com/pro/ofirmev and RxList.',
  },
  S17: {
    id: 'S17',
    citation: 'Midazolam hydrochloride injection, USP. Multiple manufacturers (e.g., DailyMed setid e22611dd-1830-40af-9139-7cdb07f5a426).',
    url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=e22611dd-1830-40af-9139-7cdb07f5a426',
    identifiers: 'none (multiple ANDAs)',
    type: 'FDA label',
    supports: 'Individualized; IV sedation in a healthy adult starts with as little as 1 mg and should not exceed 2.5 mg initial dose, titrated slowly; reduce in older, debilitated or chronically ill patients and with opioids/CNS depressants. Sedation achieved within 3–5 min after IV injection. Contraindicated in acute narrow-angle glaucoma. Boxed warning on respiratory depression. Patients 60 years or older, debilitated or chronically ill: initial IV sedation dose no more than 1.5 mg over no less than 2 minutes; wait an additional 2 or more minutes to evaluate; further titration about 1 mg per 2 minutes; total doses greater than 3.5 mg are not usually necessary. Healthy adults under 60: no more than 2.5 mg over at least 2 minutes.',
    verifiedVia: 'Dosing copied from DOSING_SOURCES.md S27 (WebSearch record of a prescriberpoint.com label copy and the DailyMed listing, 2026-11-05; age ≥60 figure confirmed in the 2026-11 audit). Onset "within 3 to 5 minutes" and the narrow-angle glaucoma contraindication confirmed in WebSearch records of US label copies (DailyMed listings; medlibrary.org), 2026-11-05. 2026-11 audit: the ≥60 y / debilitated / chronically ill tier (≤1.5 mg over ≥2 min; wait ≥2 min; ~1 mg per 2 min; >3.5 mg not usually necessary) and the healthy-adult ≤2.5 mg over ≥2 min wording confirmed in a WebSearch record of pfizermedicalinformation.com/midazolam/dosage-admin (US label text). UK SmPCs differ (0.5–1 mg in older patients) and are not used.',
  },
  S18: {
    id: 'S18',
    citation: 'Phenylephrine hydrochloride injection (BIORPHEN). FDA-approved prescribing information, 2019.',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2019/212909s000lbl.pdf',
    identifiers: 'NDA 212909',
    type: 'FDA label',
    supports: 'Hypotension during anaesthesia: initial IV bolus 40–100 mcg; additional boluses every 1–2 min as needed, not to exceed a total dosage of 200 mcg (2019 label wording; some later label copies read "additional boluses up to 200 mcg" — the simulator applies the conservative total-dosage reading); infusion 10–35 mcg/min, not exceeding 200 mcg/min.',
    verifiedVia: 'Copied from DOSING_SOURCES.md S28: WebSearch record of the FDA-hosted 2019 label and drugs.com label copy, 2026-11-05. 2026-11 audit: WebSearch records of the FDA-hosted 2019 label (212909s000lbl.pdf; "Additional boluses may be administered every 1-2 minutes as needed; not to exceed a total dosage of 200 mcg"), ndclist.com Eton label copies (same wording) and drugs.com/pro/biorphen ("additional boluses up to 200 mcg"). Per-bolus wording on the current US label could not be verified, so the 200 mcg limit is applied to all phenylephrine boluses in the session combined.',
  },
  S19: {
    id: 'S19',
    citation: 'Ephedrine sulfate injection (AKOVAZ). Exela Pharma Sciences. FDA-approved prescribing information.',
    url: 'https://www.drugs.com/pro/akovaz.html',
    identifiers: 'none',
    type: 'FDA label',
    supports: 'Clinically important hypotension in the setting of anaesthesia: IV bolus 5–10 mg as needed, not to exceed 50 mg; tachyphylaxis possible.',
    verifiedVia: 'Copied from DOSING_SOURCES.md S29: WebSearch record of drugs.com and medlibrary.org label copies, 2026-11-05.',
  },
  S20: {
    id: 'S20',
    citation: 'Chung F, Yegneswaran B, Liao P, et al. STOP questionnaire: a tool to screen patients for obstructive sleep apnea. Anesthesiology. 2008;108(5):812-821.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/18431116/',
    identifiers: 'PMID 18431116 (DOI not re-verified)',
    type: 'score validation',
    supports: 'STOP items and Bang items (BMI >35, age >50, neck >40 cm, male sex).',
    verifiedVia: 'Copied from DOSING_SOURCES.md S32: WebSearch record of PubMed 18431116 and qxmd.com/r/18431116, 2026-11-05.',
  },
  S21: {
    id: 'S21',
    citation: 'Chung F, Abdullah HR, Liao P. STOP-Bang questionnaire: a practical approach to screen for obstructive sleep apnea. Chest. 2016;149(3):631-638.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/26378880/',
    identifiers: 'PMID 26378880 (DOI not re-verified)',
    type: 'score validation',
    supports: 'STOP-Bang 0–2 low, 3–4 intermediate, 5–8 high risk of moderate-to-severe OSA.',
    verifiedVia: 'Copied from DOSING_SOURCES.md S33: WebSearch record of PubMed 26378880 and the UW-hosted STOP-Bang appendix, 2026-11-05.',
  },
  S22: {
    id: 'S22',
    citation: 'American Society of Anesthesiologists. Standards for Basic Anesthetic Monitoring. Last amended October 15, 2025.',
    url: 'https://www.asahq.org/standards-and-practice-parameters/standards-for-basic-anesthetic-monitoring',
    identifiers: 'none',
    type: 'society standard',
    supports: 'BP and HR at least every 5 min; continuous ECG; pulse oximetry; end-tidal CO2 during GA; exhaled-CO2 monitoring during moderate or deep sedation.',
    verifiedVia: 'Copied from DOSING_SOURCES.md S35: WebSearch record of the asahq.org standards page and the OpenAnesthesia summary, 2026-11-05.',
  },
  S23: {
    id: 'S23',
    citation: 'Etomidate injection, USP (AMIDATE). Hospira, Inc. (Pfizer). FDA-approved prescribing information.',
    url: 'https://www.pfizermedical.com/amidate/dosage-admin',
    identifiers: 'NDA 018227 (FDA-hosted label 2017: 018227s032lbl.pdf)',
    type: 'FDA label',
    supports: 'Adults: 0.2–0.6 mg/kg, individualized; usual 0.3 mg/kg over 30–60 s. Onset usually within 1 min; duration dose dependent, usually 3–5 min at 0.3 mg/kg. Reduced plasma cortisol after 0.3 mg/kg persisting about 6–8 h, unresponsive to ACTH. Geriatric patients may require reduced doses. Contraindicated in patients who have shown hypersensitivity to it.',
    verifiedVia: 'WebSearch records of pfizermedical.com/amidate (dosage-admin), prescriberpoint.com etomidate label copies, the FDA-hosted 2017 label (accessdata.fda.gov 018227s032lbl.pdf, link only) and the drugs.com Amidate copy (updated Jan 2026) for onset/duration wording, 2026-11-05.',
  },
  S24: {
    id: 'S24',
    citation: 'Succinylcholine chloride injection, USP (ANECTINE; QUELICIN). Sandoz / Hospira prescribing information (medlibrary.org and medthority.com label copies; DailyMed setid 1d4302db-a0d5-d0e8-e063-6294a90a22f8).',
    url: 'https://medlibrary.org/lib/rx/meds/anectine/',
    identifiers: 'none',
    type: 'FDA label',
    supports: 'Average adult intubating dose 0.6 mg/kg IV (range 0.3–1.1 mg/kg). After IV doses in this range blockade develops in about 1 min, maximum about 2 min, recovery within 4–6 min. Contraindications (older-format labels): personal or familial history of malignant hyperthermia, skeletal muscle myopathies, known hypersensitivity; not to be used after the acute phase of injury following major burns, multiple trauma, extensive denervation of skeletal muscle, or upper motor neuron injury. Boxed warning: hyperkalemic rhabdomyolysis in pediatric patients. Hyperkalemia risk in burn/injury patients peaks 7–10 days after injury.',
    verifiedVia: 'WebSearch records of medlibrary.org Anectine copies (0.3–1.1 mg/kg; onset/peak/recovery), medthority.com Anectine/Quelicin copies (0.6 mg/kg; boxed warning; burn hyperkalemia timing), drugs.com and DailyMed listings (contraindication wording), 2026-11-05. Contraindication lists differ between label versions (some newer labels move burns/denervation to Warnings).',
  },
  S25: {
    id: 'S25',
    citation: 'Sevoflurane, USP, volatile liquid for inhalation (ULTANE). AbbVie. FDA-approved prescribing information.',
    url: 'https://medlibrary.org/lib/rx/meds/ultane-1/',
    identifiers: 'none confirmed',
    type: 'FDA label',
    supports: 'MAC in oxygen by age: 25 y 2.6%; 40 y 2.1%; 60 y 1.7%; 80 y 1.4%. Surgical levels of anaesthesia usually achieved with 0.5–3% with or without nitrous oxide. Contraindicated in known or suspected genetic susceptibility to malignant hyperthermia and known sensitivity to sevoflurane or other halogenated agents.',
    verifiedVia: 'WebSearch records of prescriberpoint.com sevoflurane label copies (MAC table; contraindications), medlibrary.org Ultane copy and pdr.net (0.5–3% maintenance sentence), 2026-11-05. The current US label full text was not opened; the 0.5–3% sentence appeared under an odd heading in the medlibrary copy.',
  },
  S26: {
    id: 'S26',
    citation: 'Mapleson WW. Effect of age on MAC in humans: a meta-analysis. Br J Anaesth. 1996;76(2):179-185.',
    url: 'https://academic.oup.com/bja/issue/76/2',
    identifiers: 'doi:10.1093/bja/76.2.179; PMID unverified',
    type: 'meta-analysis (age-adjusted MAC model)',
    supports: 'MAC(age) = MAC40 × 10^(−0.00269 × (age − 40)), same slope for all inhaled agents above age 1 y (about 6% decline per decade). MAC40: sevoflurane 1.80%, isoflurane 1.17%, desflurane 6.6%, nitrous oxide 104% (halothane 0.75%, enflurane 1.63%); 95% limits about ±7% (desflurane ±10%).',
    verifiedVia: 'WebSearch records of the BJA 76(2) issue listing (citation, DOI), a Mapleson-authored abstract on scite.ai (MAC40 1.80% sevoflurane; b = −0.00269), and a StatPearls review quoting the equation, 2026-11-05. Isoflurane 1.17%, desflurane 6.6% and nitrous oxide 104% MAC40 values confirmed in the same scite.ai abstract record and repeated in secondary pages (meddic.jp; medicalalgorithms.com), 2026-11-05. Full text not opened.',
  },
  S27: {
    id: 'S27',
    citation: 'Ketamine hydrochloride injection (KETALAR). Par Pharmaceutical / Endo. FDA-approved prescribing information, 2022 revision (also 2026 revision 016812s057); and Fresenius Kabi generic ketamine label.',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2022/016812s051lbl.pdf',
    identifiers: 'NDA 016812',
    type: 'FDA label',
    supports: 'IV induction 1–4.5 mg/kg over 60 s; average 2 mg/kg produces 5–10 min of surgical anaesthesia within 30 s; maintenance increments of one-half to the full induction dose. Contraindicated in patients for whom a significant elevation of blood pressure would constitute a serious hazard, and in known hypersensitivity. Postoperative confusional states may occur during recovery.',
    verifiedVia: 'WebSearch records of the FDA-hosted 2022 and 2026 Ketalar labels (1–4.5 mg/kg; maintenance increments; contraindications; emergence wording) and the Fresenius Kabi generic label copy (2 mg/kg, 5–10 min, within 30 s), 2026-11-05.',
  },
  S28: {
    id: 'S28',
    citation: 'Lidocaine hydrochloride injection, USP (intravenous, antiarrhythmic). Fresenius Kabi and Hospira prescribing information; archived DailyMed lidocaine labels.',
    url: 'https://labeling.pfizer.com/ShowLabeling.aspx?id=4497',
    identifiers: 'none',
    type: 'FDA label',
    supports: 'Contraindication (Fresenius Kabi): not to be used in Stokes-Adams syndrome, Wolff-Parkinson-White syndrome, or severe degrees of sinoatrial, atrioventricular or intraventricular block. Warning (older-format labels): patients with severe hepatic disease are at greater risk of developing toxic plasma concentrations.',
    verifiedVia: 'WebSearch records of guidelinecentral.com Fresenius lidocaine label, labeling.pfizer.com (Hospira caution wording), the drugs.com lidocaine monograph and archived DailyMed lidocaine labels (webarchive.library.unt.edu), 2026-11-05. No dose is taken from this label.',
  },
  S29: {
    id: 'S29',
    citation: 'Ondansetron injection, USP. Pfizer prescribing information (pfizermedicalinformation.com/ondansetron).',
    url: 'https://www.pfizermedicalinformation.com/ondansetron/contradictions',
    identifiers: 'none',
    type: 'FDA label',
    supports: 'Contraindicated in known hypersensitivity (e.g., anaphylaxis) to the product or its components, and with concomitant apomorphine (profound hypotension and loss of consciousness reported).',
    verifiedVia: 'WebSearch record of pfizermedicalinformation.com/ondansetron/contradictions and Canadian monographs (pdf.hres.ca), 2026-11-05. Dose is taken from S3, not from this label.',
  },
  S30: {
    id: 'S30',
    citation: 'Dexamethasone sodium phosphate injection, USP. Multiple manufacturers (e.g., Fresenius Kabi; label copies at medthority.com and drugcentral.org).',
    url: 'https://drugcentral.org/label/9dbb2b90-471a-4de8-b105-6c9ede7d8d7e/view',
    identifiers: 'none',
    type: 'FDA label',
    supports: 'Contraindications: systemic fungal infections; hypersensitivity to any component of this product (including sulfites in some products).',
    verifiedVia: 'WebSearch records of drugcentral.org and medthority.com dexamethasone sodium phosphate label copies, 2026-11-05. Dose is taken from S2/S3, not from this label.',
  },
  S31: {
    id: 'S31',
    citation: 'American Society of Anesthesiologists. Statement on Continuum of Depth of Sedation: Definition of General Anesthesia and Levels of Sedation/Analgesia. Original approval October 13, 1999; last amended October 23, 2024.',
    url: 'https://www.asahq.org/standards-and-practice-parameters/statement-on-continuum-of-depth-of-sedation-definition-of-general-anesthesia-and-levels-of-sedation-analgesia',
    identifiers: 'none',
    type: 'society statement',
    supports: 'Minimal sedation: normal response to verbal stimulation. Moderate: purposeful response to verbal or light tactile stimulation. Deep: purposeful response after repeated or painful stimulation (reflex withdrawal is not purposeful). General anaesthesia: not arousable even by painful stimulation.',
    verifiedVia: 'WebSearch record of the asahq.org statement page (amendment date) and reproductions of the statement text, 2026-11-05.',
  },
  S32: {
    id: 'S32',
    citation: 'Practice guidelines for moderate procedural sedation and analgesia 2018: a report by the American Society of Anesthesiologists Task Force on Moderate Procedural Sedation and Analgesia, et al. Anesthesiology. 2018;128(3):437-479.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/29334501/',
    identifiers: 'doi:10.1097/ALN.0000000000002043; PMID 29334501',
    type: 'society guideline',
    supports: 'Framework for moderate procedural sedation (monitoring, titration, personnel). No dose is taken from it in this library. Timing cross-check (2026-11): intravenous sedative/analgesic drugs are titrated in small increments (or by infusion) and sufficient time is allowed between doses for the effect of each to be assessed before more is given (recommendation as summarised in search records; verbatim wording not retrieved). Used for the MAC second-sedative spacing (TIMING_CONFIG.MAC_SEDATIVE_AFTER_MIDAZOLAM_SEC).',
    verifiedVia: 'WebSearch record of PubMed 29334501 and qxmd.com/r/29334501 (citation, DOI), 2026-11-05. Its capnography recommendation text was not retrieved; capnography statements in the simulator are tagged to S22. Timing cross-check 2026-11-05: WebSearch records of the LWW Anesthesiology full-text listing and PDF reproductions (mercycare.org, sedationsystems.com, researchgate) summarising the titration recommendation; the exact sentence was not retrieved and is not quoted.',
  },
  S33: {
    id: 'S33',
    citation: 'Devine BJ. Gentamicin therapy. Drug Intell Clin Pharm. 1974;8:650-655.',
    url: 'https://wikem.org/wiki/Ideal_body_weight_calculator',
    identifiers: 'none confirmed',
    type: 'weight scalar (original formula)',
    supports: 'Ideal body weight: male 50 kg, female 45.5 kg, + 2.3 kg per inch over 60 in.',
    verifiedVia: 'WebSearch records of secondary reproductions (wikem.org; evigrade.com; calcfyi.com) giving the citation and formula, 2026-11-05. Original article not opened.',
  },
  S34: {
    id: 'S34',
    citation: 'Janmahasatian S, Duffull SB, Ash S, Ward LC, Byrne NM, Green B. Quantification of lean bodyweight. Clin Pharmacokinet. 2005;44(10):1051-1065.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2485235',
    identifiers: 'doi:10.2165/00003088-200544100-00004',
    type: 'weight scalar (original formula)',
    supports: 'Lean body weight: male 9270 × TBW / (6680 + 216 × BMI); female 9270 × TBW / (8780 + 244 × BMI).',
    verifiedVia: 'WebSearch records of bibliographic copies (citation, DOI, pages) and a PMC article quoting the denominators 6680 + 216×BMI and 8780 + 244×BMI, 2026-11-05. The 9270 numerator was not displayed in the search record (identifier/constant unverified in this session); check the original before reuse.',
  },
  S35: {
    id: 'S35',
    citation: 'Smart NOA Controller. config.yaml (simulation_rate_ceilings; ketorolac egfr_minimum; dexmedetomidine cardiac_conditions). Project configuration in this repository.',
    url: 'config.yaml',
    identifiers: 'none',
    type: 'project configuration (software ceilings, not clinical maxima)',
    supports: 'Python simulation rate ceilings: dexmedetomidine 0.5 mcg/kg/h, ketamine 0.2 mg/kg/h, lidocaine 1.5 mg/kg/h; ketorolac lockout below eGFR 30; dexmedetomidine lockout for heart block conditions.',
    verifiedVia: 'Read directly from /home/user/smart-noa-controller/config.yaml, 2026-11-05. This is not clinical evidence; it is cited so the simulator mirrors the Python controller.',
  },
  S36: {
    id: 'S36',
    citation: 'Desflurane, USP, volatile liquid for inhalation (SUPRANE). Baxter Healthcare. FDA-approved prescribing information (drugs.com copy revised July 2026; medlibrary.org and ndclist.com copies; DailyMed desflurane setid 21ba0e18-3dbc-4feb-a3a4-f6470c00910a).',
    url: 'https://medlibrary.org/lib/rx/meds/suprane/page/2/',
    identifiers: 'none confirmed',
    type: 'FDA label',
    supports: 'Surgical levels of anesthesia in adults may be maintained with 2.5–8.5% with or without nitrous oxide; required concentration is age dependent. Can induce malignant hyperthermia in patients with known or suspected susceptibility based on genetic factors or family history (MH susceptibility listed as a contraindication). Concentrations exceeding 1 MAC may increase heart rate; a rapid increase in concentration is associated with marked increase in pulse rate, mean arterial pressure and catecholamines. Not recommended for induction in paediatric patients because of moderate to severe upper airway adverse events (laryngospasm, coughing, breath holding, apnea, increased secretions, desaturation). Contraindicated in patients with known sensitivity to SUPRANE or to other halogenated agents, and with a history of moderate to severe hepatic dysfunction following anaesthesia with SUPRANE or other halogenated agents.',
    verifiedVia: 'WebSearch records of drugs.com/pro/suprane (current label, MH and heart-rate wording), medlibrary.org Suprane copies (2.5–8.5% maintenance sentence, older-format version; rapid-increase wording) and the DailyMed desflurane listing, 2026-11-05. The adult mask-induction statement ("not recommended for mask induction of anesthesia in adults") was seen only in the Canadian monograph and is not used as US wording. No US MAC-by-age table was retrieved. 2026-11 audit: halogenated-agent sensitivity and hepatic-dysfunction contraindications confirmed in WebSearch records of drugs.com/pro/suprane, medlibrary.org Suprane copies and the medthority.com (Henry Schein) US label copy; the same items appear in the EU SmPC and Canadian monograph.',
  },
  S37: {
    id: 'S37',
    citation: 'Isoflurane, USP (FORANE). Baxter Healthcare. FDA-approved prescribing information (FDA-hosted August 2006 PI, archived: webarchive.library.unt.edu ... fda.gov/MEDWATCH/safety/2006/Aug_PIs/Forane_PI.pdf).',
    url: 'https://webarchive.library.unt.edu/eot2008/20081028114252/http:/www.fda.gov/MEDWATCH/safety/2006/Aug_PIs/Forane_PI.pdf',
    identifiers: 'none confirmed',
    type: 'FDA label',
    supports: 'Induction: start at 0.5%; 1.5–3.0% usually produces surgical anesthesia in 7–10 min. Maintenance: 1.0–2.5% in oxygen/nitrous oxide; an additional 0.5–1.0% may be required with oxygen alone. Average MAC in 100% O2: 1.28% (age 26 ± 4), 1.15% (44 ± 7), 1.05% (64 ± 5); in 70% N2O: 0.56%, 0.50%, 0.37%. Contraindications: known sensitivity to isoflurane or other halogenated agents; known or suspected genetic susceptibility to malignant hyperthermia.',
    verifiedVia: 'WebSearch records of the archived FDA-hosted 2006 Forane PI, the Baxter Canada Forane monograph and an Irish SmPC (consistent figures), 2026-11-05. US-format contraindication wording from the search record; drugs.com isoflurane page text was garbled and not relied on.',
  },
  // S38–S39: NON-LABEL sources used for nitrous oxide only (owner request; US labels give no clinical dose).
  S38: {
    id: 'S38',
    citation: 'Myles PS, Leslie K, Chan MTV, et al; ANZCA Trials Group for the ENIGMA-II investigators. The safety of addition of nitrous oxide to general anaesthesia in at-risk patients having major non-cardiac surgery (ENIGMA-II): a randomised, single-blind trial. Lancet. 2014;384(9952):1446-1454.',
    url: 'https://clinicaltrials.gov/study/NCT00430989',
    identifiers: 'doi:10.1016/S0140-6736(14)60893-X; PMID 25142708; NCT00430989',
    type: 'RCT',
    supports: 'Intervention arm: nitrous oxide at an inspired concentration of 70% in 30% oxygen; control: N2O-free with inspired oxygen 30%. 7112 patients ≥45 y with or at risk of coronary disease; death and cardiovascular complications at 30 days 8% in each group (RR 0.96, 95% CI 0.83–1.12). Avoiding nitrous oxide reduced severe PONV.',
    verifiedVia: 'WebSearch records of the ClinicalTrials.gov NCT00430989 record ("inspired concentration of 70% in 30% Oxygen"), the University of Geneva archive record (citation, DOI, PMID), ANZCA repository and qxmd.com/r/25142708, 2026-11-05. Full text not opened. Non-label source: used because no US nitrous oxide label states a clinical concentration.',
  },
  S39: {
    id: 'S39',
    citation: 'Eger EI 2nd, Saidman LJ. Hazards of nitrous oxide anesthesia in bowel obstruction and pneumothorax. Anesthesiology. 1965;26:61-66.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/14257336/',
    identifiers: 'PMID 14257336',
    type: 'physiology study',
    supports: 'Nitrous oxide diffuses into closed gas spaces faster than nitrogen leaves, expanding them: in dogs breathing 75% N2O, pneumothorax volume roughly doubled by 10 min and roughly tripled-to-quadrupled (about +300%) by 60 min, whereas oxygen did not change it; bowel gas also expanded. Authors concluded nitrous oxide is relatively contraindicated in intestinal obstruction or pneumothorax.',
    verifiedVia: 'WebSearch records of PubMed 14257336 (citation; no abstract listed), the Scilit record (conclusion "relatively contraindicated in intestinal obstruction or pneumothorax"), BestBets review table (dog data, +100% at 10 min, ~+300% at 60 min) and a textbook figure reproduction (75% N2O), 2026-11-05. Full text not opened; volume figures are from secondary reproductions. Animal study (pneumothorax created by air injection). Non-label source: used because no US nitrous oxide label states contraindications.',
  },
  // S40–S43 added 2026-11-05 (epinephrine, Eleveld propofol PK, sepsis fluid context).
  S40: {
    id: 'S40',
    citation: 'Epinephrine injection, USP 1 mg/mL (ADRENALIN). Par Pharmaceutical / Par Health USA. FDA-approved prescribing information (DailyMed setid 3b7a4364-668d-4eb2-a20c-04adc35aabe4; FDA-hosted label files 204200s004 (2016), 204200s009/204640s009 (2019), 204640Orig1s018 (2023)).',
    url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=3b7a4364-668d-4eb2-a20c-04adc35aabe4',
    identifiers: 'NDA 204200 / NDA 204640 (as shown in FDA-hosted label file names; not otherwise re-verified)',
    type: 'FDA label',
    supports: 'Anaphylaxis, adults and children over 30 kg: 0.3 to 0.5 mg (0.3 to 0.5 mL) undiluted, intramuscularly or subcutaneously into the anterolateral aspect of the thigh, up to a maximum of 0.5 mg (0.5 mL) per injection, repeated every 5 to 10 minutes as necessary; monitor clinically for reaction severity and cardiac effects. Do not inject into buttock, digits, hands or feet. Hypotension associated with septic shock: dilute 1 mg in 1000 mL of 5% dextrose (or 5% dextrose and sodium chloride) to 1 mcg/mL; infuse into a large vein; 0.05 to 2 mcg/kg/min titrated to the desired mean arterial pressure. Contraindications: None. Contains sodium bisulfite; presence of sulfite should not deter use for anaphylaxis. Epinephrine may induce cardiac arrhythmias and myocardial ischemia, especially in patients with coronary artery disease or cardiomyopathy.',
    verifiedVia: 'WebSearch records (2026-11-05) of the DailyMed Adrenalin listings (setids 3b7a4364-…, 7663c49d-…, b293ad8e-…), drugs.com/pro/adrenalin-injection, the FFF Enterprises-hosted Adrenalin PI PDF, guidelinecentral.com (setid 3b7a4364-…) and FDA-hosted Adrenalin labels 204200s004/204200s009/204640s018: anaphylaxis 0.3–0.5 mg IM/SC anterolateral thigh, max 0.5 mg per injection, every 5–10 min; septic-shock 0.05–2 mcg/kg/min titrated to MAP and 1 mcg/mL dilution; contraindications "None"; injection-site wording; sulfite "should not deter use for anaphylaxis (5.4)" (2016 highlights); arrhythmia/ischaemia wording. The weight boundary was seen as "over 30 kg" (children "30 kg or less"); wording may differ between label versions. Full label text not opened (DailyMed and accessdata.fda.gov not reachable from the build environment).',
  },
  S41: {
    id: 'S41',
    citation: 'Epinephrine injection (generic 1 mg/mL vial; NDA 215425). FDA-approved prescribing information, 2025 (accessdata.fda.gov label 215425s000lbl.pdf); and other generic epinephrine injection labels (NDA 205029, 2021–2025 revisions; Pfizer/Hospira labeling).',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/215425s000lbl.pdf',
    identifiers: 'NDA 215425; NDA 205029 (as shown in FDA-hosted label file names)',
    type: 'FDA label',
    supports: 'Hypotension associated with septic shock: suggested infusion 0.05 mcg/kg/min to 2 mcg/kg/min, titrated to achieve a desired mean arterial pressure; dosage may be adjusted periodically, e.g. every 10 to 15 minutes, in increments of 0.05 to 0.2 mcg/kg/min; after haemodynamic stabilisation wean incrementally (e.g. decreasing doses every 10 minutes). The ideal body weight (IBW) should be used as the weight parameter for dosing epinephrine in adult patients with septic-shock-associated hypotension (215425 label). Presence of sulfite should not deter use for hypotension associated with septic shock.',
    verifiedVia: 'WebSearch records (2026-11-05) of FDA-hosted labels 215425s000 (2025; IBW sentence quoted verbatim in the record), 205029Orig1s009 (2023) and 205029Orig1s015 (2025), DailyMed generic epinephrine listings and a Pfizer labeling highlights page ("0.05 mcg/kg/min to 2 mcg/kg/min, titrated to achieve desired mean arterial pressure (2.2) • Wean gradually"). Titration increments and the weaning sentence were seen in search excerpts attributed to these labels; the exact label each excerpt came from was not pinned down. Full label text not opened.',
  },
  S42: {
    id: 'S42',
    citation: 'Eleveld DJ, Colin P, Absalom AR, Struys MMRF. Pharmacokinetic-pharmacodynamic model for propofol for broad application in anaesthesia and sedation. Br J Anaesth. 2018;120(5):942-959. Corrigendum: Br J Anaesth. 2018;121(2):519.',
    url: 'https://www.bjanaesthesia.org/article/S0007-0912(18)30051-5/fulltext',
    identifiers: 'doi:10.1016/j.bja.2018.01.018; PMID 29661412',
    type: 'published population PK-PD model',
    supports: 'Three-compartment propofol PK with covariates age, weight, height, sex (Al-Sallami fat-free mass for V3), post-menstrual age maturation, and presence/absence of concomitant anaesthetic drugs, implemented as opioids (the opioid covariate lowers CL and V3 with age; this is how the open-source implementations name the switch); reference individual 35 y, 70 kg, 170 cm male. Table 2 fixed effects Θ1–Θ18 (V1ref 6.28 L, V2ref 25.5 L, V3ref 273 L, CL 1.79 (male) / 2.10 (female) L/min, Q2ref 1.75 L/min (1.83 at the reference individual after the Θ16 term, per the corrigendum), Q3ref 1.11 L/min, …). Table 3: ke0 0.146 min⁻¹ (arterial) / 1.24 min⁻¹ (venous) × (WGT/70)^−0.25; Ce50 3.08 mcg/mL × exp(−0.00635 × (age − 35)); BIS0 93.0; γ 1.47 above / 1.89 below Ce50.',
    verifiedVia: 'Citation, DOI and corrigendum from WebSearch records (bvsalud mdl-29661412, mardi4nfdi, BJA landing page). PK fixed effects and equations taken from four sources that agree to printed precision: CRAN package tci 0.2.1 R/poppk_mods.R (github.com/cran/tci, cloned 2026-11-05); PyPI python-anesthesia-simulator 1.0.0 pk_models.py (full-precision thetas); github.com/vitaldb/tivatci tivatci/__init__.py; and the stanpumpR paper digest papers/digests/PMID_29661412.md (github.com/StevenLShafer/stanpumpR), a reading of the paper PDF quoting Table 2/3 values with 99% CIs and page numbers (itself an AI-assisted digest; secondary). PD/ke0 values (0.146, 1.24, 3.08, −0.00635, 93.0, 1.47/1.89) also seen in a WebSearch record of the BJA table. The PK theta values themselves were NOT displayed in any publisher or PubMed search record; the primary PDF and supplementary NONMEM code could not be opened (bjanaesthesia.org, PMC, doi.org unreachable). 2026-11 audit: the simulator now switches the covariate on for opioids only; the earlier extension to IV lidocaine was a simulator choice and was removed.',
  },
  S43: {
    id: 'S43',
    citation: 'Evans L, Rhodes A, Alhazzani W, et al. Surviving Sepsis Campaign: international guidelines for management of sepsis and septic shock 2021. Crit Care Med. 2021 (published simultaneously in Intensive Care Med. 2021).',
    url: 'https://sccm.org/sepsisguidelines',
    identifiers: 'none confirmed (volume, pages, DOI and PMID not re-verified)',
    type: 'guideline',
    supports: 'For adults with sepsis-induced hypoperfusion or septic shock, the guideline suggests that at least 30 mL/kg of IV crystalloid fluid be given within the first 3 hours of resuscitation (weak recommendation, low quality of evidence; downgraded from strong in 2016).',
    verifiedVia: 'WebSearch records (2026-11-05) of sccm.org/sepsisguidelines, an AMiner executive-summary record, emDocs and Red Cross guideline summaries and a CME PDF reproducing the recommendation wording and its weak/low-quality grading. Used only as context text for sepsis fluid boluses; no simulator dose, threshold or effect size is derived from it.',
  },
  // S44–S45 added in the 2026-11 audit (perioperative anaphylaxis; IV epinephrine titration dose).
  S44: {
    id: 'S44',
    citation: 'Association of Anaesthetists of Great Britain and Ireland. Suspected anaphylactic reactions associated with anaesthesia. Anaesthesia. 2009;64(2):199-211.',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3082210/',
    identifiers: 'doi:10.1111/j.1365-2044.2008.05733.x; PMC3082210 (PMID not re-verified)',
    type: 'society guideline',
    supports: 'Adrenaline (epinephrine) is the most effective drug in anaphylaxis and should be given as early as possible. Adult IV dose 50 µg (0.5 mL of 1:10 000 solution); several doses may be required if there is severe hypotension or bronchospasm; if several doses are required, consider starting an IV adrenaline infusion. The anaesthetist is responsible for referral for investigation.',
    verifiedVia: 'WebSearch records (2026-11-05) of the PMC3082210 full-text record (quoted: "Adult dose: 50 µg (0.5 ml of 1:10 000 solution). Several doses may be required if there is severe hypotension or bronchospasm. If several doses of adrenaline are required, consider starting an intravenous infusion of adrenaline."), the University of Southampton eprint 72661 (citation, DOI) and NHS Scotland Right Decisions copies. The NAP6 report chapter (rcoa.ac.uk) states that AAGBI guidelines recommend an initial IV dose of 50 mcg, repeated as necessary. Full PDF not opened (WebFetch unavailable in this session).',
  },
  S45: {
    id: 'S45',
    citation: 'Resuscitation Council UK. Peri-operative anaphylaxis: initial management (algorithm for anaesthetists and intensivists), with the Association of Anaesthetists. Resuscitation Council UK; 2024 (file 2526 AAP RCUK periop anaphylaxis).',
    url: 'https://www.resus.org.uk/sites/default/files/2024-01/2526%20AAP%20RCUK%20periop%20anaphylaxis-8C.pdf',
    identifiers: 'none',
    type: 'society guideline (algorithm)',
    supports: 'Peri-operative anaphylaxis (anaesthetists/intensivists): give an initial IV bolus of adrenaline — adults and children over 12 years 50 micrograms (0.5 mL of 1 mg/10 mL), titrated to effect; if repeated boluses are needed, start an adrenaline infusion; give IV crystalloid. RCUK 2021 emergency treatment of anaphylaxis: IV adrenaline only by experienced specialists in an appropriate setting.',
    verifiedVia: 'WebSearch records (2026-11-05) of the resus.org.uk algorithm PDF (2024-01 file) and of the RCUK 2021 guideline/draft ("IV adrenaline should be given only by experienced specialists in an appropriate setting"; titration step "Adults 50 micrograms"), and SALG/Perioperative Allergy Network summaries (infusion if signs persist despite boluses). Full PDF not opened.',
  },
  // S46–S51 added for the November 2026 owner-approved additions (antibiotic prophylaxis, IV fluids,
  // technique-template evidence notes, propofol injection pain). Verified by WebSearch records, 2026-11-05.
  S46: {
    id: 'S46',
    citation: 'Bratzler DW, Dellinger EP, Olsen KM, et al. Clinical practice guidelines for antimicrobial prophylaxis in surgery. Am J Health Syst Pharm. 2013;70(3):195-283. (Joint ASHP/IDSA/SIS/SHEA guideline; also published in Surg Infect (Larchmt). 2013;14(1):73-156.)',
    url: 'https://academic.oup.com/ajhp/article/70/3/195/5112717',
    identifiers: 'doi:10.2146/ajhp120568; PMID 23327981',
    type: 'society guideline',
    supports: 'Adult doses: cefazolin 2 g IV (3 g for patients weighing ≥120 kg), redosing interval 4 h; clindamycin 900 mg IV, redosing interval 6 h; vancomycin 15 mg/kg IV, routine redosing not applicable. First dose should begin within 60 minutes before surgical incision; vancomycin (and fluoroquinolones) should begin within 120 minutes before incision because of prolonged infusion times. Redosing is needed when the procedure exceeds about two half-lives of the agent; the interval is measured from the initiation of the preoperative dose. For patients with β-lactam allergy, clindamycin or vancomycin are the alternatives most frequently recommended; cephalosporins are avoided in patients with an IgE-mediated (e.g. anaphylaxis) or severe reaction to a β-lactam.',
    verifiedVia: 'Citation, PMID and doses copied from the protocol registry DOSING_SOURCES.md S6 (WebSearch records of the OU publication list and institutional summaries — UNMC prophylaxis/redosing tables, ASA quality measure using the 4-h cefazolin interval), 2026-11-05. Re-checked 2026-11-05 by WebSearch: DOI 10.2146/ajhp120568 and the academic.oup.com AJHP 70(3):195 landing record; CHOC 2017/2023 guidelines reproducing Table 1 (cefazolin 2 g, 3 g for ≥120 kg, redose 4 h; clindamycin 900 mg, redose 6 h); UNMC/Thompson Health protocols quoting "within 60 minutes before surgical incision … vancomycin within 120 minutes"; OpenAnesthesia and Infection Control & Hospital Epidemiology summaries (clindamycin and vancomycin as the most frequent β-lactam-allergy alternatives; avoid cephalosporins after IgE-mediated or severe reactions). The guideline full text and Table 1 were not opened (ashp.org, PMC not reachable); the vancomycin "N/A" redosing cell and the exact allergy sentence were seen only in secondary reproductions. The 60–120 min wording in the additions request was NOT found for clindamycin (guideline: within 60 min); see SOURCES.md.',
  },
  S47: {
    id: 'S47',
    citation: "Lactated Ringer's Injection, USP. Baxter Healthcare Corporation. FDA-approved prescribing information, revised 10/2025 (accessdata.fda.gov label 019632s067, 019634s058, 020002s037); and Baxter container labeling.",
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/019632s067%2C019634s058%2C020002s037lbl.pdf',
    identifiers: 'NDA 019632 / 019634 / 020002 (as shown in the FDA-hosted label file name)',
    type: 'FDA label',
    supports: 'Indicated as a source of water and electrolytes or as an alkalinizing agent. Approximate composition (per litre): sodium 130, potassium 4, calcium 1.4 mmol (2.7 mEq), chloride 109, lactate 28 mmol; osmolarity about 272–273 mOsmol/L; pH about 6.5. Dosage: the recommended dosage and duration are based on the patient\'s age, weight, clinical condition and concomitant therapy (no fixed dose). Warnings include: potassium-containing solutions may increase the risk of hyperkalaemia; patients with severe hepatic impairment may have impaired lactate metabolism (monitor lactate and acid-base status); do not give simultaneously with ceftriaxone in neonates ≤ 28 days (sequentially with line flushing in older patients); fluid/solute overload.',
    verifiedVia: 'WebSearch records (2026-11-05) of the FDA-hosted 2025 Baxter label (dosage based on age, weight, clinical condition and concomitant therapy; severe hepatic impairment and lactate; ceftriaxone wording), ndclist.com Baxter label copies 0338-0117 / 0338-9600 (container composition "Na 130 K 4 Ca 1.4 Cl 109 LACTATE 28 mmol/L, 272 mOsmol/L, pH 6.5"; "Potassium-containing solutions, including Lactated Ringer\'s Injection, USP, may increase the risk of hyperkalemia"; indication sentence) and a Canadian Baxter monograph (not for use in hyperkalaemia; not for lactic acidosis). Full label not opened. 2.7 mEq/L calcium is the mmol→mEq conversion of 1.4 mmol/L (×2, valence), arithmetic. No dose is taken from this label: rates and volumes in the simulator are UI choices (simulator convention).',
  },
  S48: {
    id: 'S48',
    citation: '0.9% Sodium Chloride Injection, USP (VIAFLEX / VIAFLO containers). Baxter Healthcare Corporation; and Pfizer/Hospira 0.9% sodium chloride prescribing information.',
    url: 'https://labeling.pfizer.com/ShowLabeling.aspx?id=4612',
    identifiers: 'none',
    type: 'FDA label',
    supports: 'Source of water and electrolytes. Per litre: sodium 154 mEq, chloride 154 mEq; osmolarity 308 mOsmol/L (calc.), isotonic. Warnings: may cause fluid and/or solute overload; use with particular caution (or avoid) in patients with or at risk for hypernatraemia, hyperchloraemia or metabolic acidosis; monitor serum sodium and chloride, fluid status and acid-base balance. Post-marketing: hypernatraemia, hyperchloraemic metabolic acidosis and hyponatraemia reported.',
    verifiedVia: 'WebSearch records (2026-11-05) of pfizermedicalinformation.com sodium chloride description (154 mEq sodium and chloride per 1000 mL; 308 mOsmol/L calc.; isotonic), the Baxter 2B1324X/VIAFLO package inserts (pim.integratedmedsys.com) and medthority.com Baxter label copies (fluid/solute overload; caution in hypernatraemia, hyperchloraemia, metabolic acidosis; monitoring of sodium, chloride and acid-base balance; post-marketing hyperchloraemic metabolic acidosis). Exact dosage-section wording was not displayed; no fixed dose is taken from this label (rates/volumes are simulator conventions).',
  },
  S49: {
    id: 'S49',
    citation: 'Beloeil H, Garot M, Lebuffe G, et al. Balanced opioid-free anesthesia with dexmedetomidine versus balanced anesthesia with remifentanil for major or intermediate noncardiac surgery: the Postoperative and Opioid-free Anesthesia (POFA) randomized clinical trial. Anesthesiology. 2021;134(4):541-551.',
    url: 'https://www.iasp-pain.org/publications/pain-research-forum/papers-of-the-week/paper/163431-balanced-opioid-free-anesthesia-dexmedetomidine-versus-balanced-anesthesia/',
    identifiers: 'doi:10.1097/ALN.0000000000003725; PMID 33630043',
    type: 'randomized clinical trial',
    supports: 'Dexmedetomidine-based opioid-free balanced anaesthesia versus remifentanil-based balanced anaesthesia: more of the composite of postoperative opioid-related adverse events (driven by hypoxaemia), more delayed extubation and longer PACU stay, and the trial was stopped early after five cases of severe bradycardia in the dexmedetomidine group; postoperative nausea and vomiting was less frequent in the dexmedetomidine group. Used only as an evidence note on the opioid-free template; no dose is taken from it.',
    verifiedVia: 'WebSearch records (2026-11-05) of the IASP Pain Research Forum abstract record (PMID 33630043; composite 78% vs 67%; hypoxaemia 72% vs 61%; early termination for severe bradycardia; delayed extubation and PACU stay), typeset.io and revistachilenadeanestesia.cl copies, the Anesthesiology podcast page and editorial record (Kharasch & Clark). The PONV direction (less with dexmedetomidine) was seen in search excerpts whose percentages were inconsistently labelled, so no PONV figure is shown. Full text not opened.',
  },
  S50: {
    id: 'S50',
    citation: 'Semler MW, Self WH, Wanderer JP, et al. Balanced crystalloids versus saline in critically ill adults. N Engl J Med. 2018;378(9):829-839.',
    url: 'https://www.uab.edu/medicine/coere/images/nejmoa1711584.pdf',
    identifiers: 'doi:10.1056/NEJMoa1711584 (PMID not re-verified)',
    type: 'randomized clinical trial (cluster, multiple crossover)',
    supports: 'SMART: 15,802 critically ill adults in five ICUs; major adverse kidney events within 30 days in 14.3% with balanced crystalloids versus 15.4% with 0.9% saline (adjusted OR 0.90, 95% CI 0.82–0.99). Critically ill (ICU) population, not elective surgery; used only as an evidence note on the fluids panel.',
    verifiedVia: 'WebSearch records (2026-11-05) of the NEJM PDF copy (uab.edu), criticalcarereviews.com, The Bottom Line and EMRA summaries (citation, DOI, 14.3% vs 15.4%, OR 0.90). PMID was not confirmed in a search record and is not shown.',
  },
  S51: {
    id: 'S51',
    citation: 'Jalota L, Kalira V, George E, et al. Prevention of pain on injection of propofol: systematic review and meta-analysis. BMJ. 2011;342:d1110.',
    url: 'https://www.bmj.com/content/342/bmj.d1110.abstract',
    identifiers: 'doi:10.1136/bmj.d1110; PMID 21406529',
    type: 'systematic review and meta-analysis',
    supports: '177 randomised trials, 25,260 adults; pain with propofol alone in about 60%. Most effective: antecubital vein instead of a hand vein (RR 0.14, 95% CI 0.07–0.30) and lidocaine pretreatment with venous occlusion (RR 0.29, 0.22–0.38); lidocaine–propofol admixture (0.40) and lidocaine pretreatment alone (0.47, 0.40–0.56) also effective. Used only as an evidence note; the dose comes from the propofol label (S11).',
    verifiedVia: 'WebSearch records (2026-11-05) of the bmj.com abstract page (bmj.d1110), the read.qxmd.com record (PMID 21406529) and library catalogue records (citation, abstract figures). Author list beyond the first three not re-verified (et al.).',
  },
  S52: {
    id: 'S52',
    citation: 'Avidan MS, Zhang L, Burnside BA, et al. Anesthesia awareness and the bispectral index. N Engl J Med. 2008;358(11):1097-1108. (B-Unaware trial.)',
    url: 'https://pubmed.ncbi.nlm.nih.gov/18337600/',
    identifiers: 'doi:10.1056/NEJMoa0707361; PMID 18337600',
    type: 'randomized clinical trial',
    supports: 'About 2000 patients at high risk of awareness randomised to a BIS-guided protocol (target BIS 40 to 60) or an end-tidal anaesthetic-gas-guided protocol; definite awareness in 2 patients in each group; the findings did not support routine BIS monitoring as part of standard practice. Used only for the 40–60 target band of the simulated processed-EEG index (a trial protocol target, not evidence of benefit).',
    verifiedVia: 'WebSearch records (2026-11-05) of the PubMed record 18337600, the ovid.com NEJM PDF listing (doi 10.1056/nejmoa0707361), Washington University news release and the BAG-RECALL protocol paper (BMC Anesthesiol 2009;9:8) describing the 40–60 target. Full text not opened.',
  },
  S53: {
    id: 'S53',
    citation: 'Avidan MS, Jacobsohn E, Glick D, et al. Prevention of intraoperative awareness in a high-risk surgical population. N Engl J Med. 2011;365(7):591-600. (BAG-RECALL trial.)',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3447261/',
    identifiers: 'PMC3447261 (DOI and PMID not confirmed in a search record; not shown)',
    type: 'randomized clinical trial',
    supports: '6041 high-risk patients; BIS protocol with an audible alert when BIS fell below 40 or rose above 60, versus an end-tidal anaesthetic-concentration (ETAC) protocol; definite awareness 7/2861 (0.24%) BIS vs 2/2852 (0.07%) ETAC; superiority of the BIS protocol was not demonstrated. Used only for the 40–60 target band of the simulated processed-EEG index.',
    verifiedVia: 'WebSearch records (2026-11-05) of the PMC3447261 record, digitalcommons.wustl.edu and aminer.org listings and the BAG-RECALL protocol (BMC Anesthesiol 2009;9:8, PMID 19948045) — 40/60 alert thresholds and awareness counts. DOI/PMID not confirmed in a search record and not shown. Full text not opened.',
  },
  S54: {
    id: 'S54',
    citation: 'World Health Organization. WHO Guidelines for Safe Surgery 2009: Safe Surgery Saves Lives; and WHO Surgical Safety Checklist with Implementation Manual (2009). Geneva: WHO; 2009.',
    url: 'https://www.leapfroggroup.org/sites/default/files/Files/WHO_SafeSurgeryChecklistImplementationManual.pdf',
    identifiers: 'none (WHO publication; ISBN not verified, not shown)',
    type: 'guideline / checklist',
    supports: 'Three-phase checklist: Sign In (before induction of anaesthesia), Time Out (before skin incision) and Sign Out. At the Time Out the team members introduce themselves and the surgeon, anaesthesia professional and nurse verbally confirm the patient, site and procedure; the checklist asks "Has antibiotic prophylaxis been given within the last 60 minutes?" (Yes / Not applicable). The checklist is not intended to be comprehensive; local modification is encouraged.',
    verifiedVia: 'WebSearch records (2026-11-05) of the WHO Safe Surgery Checklist Implementation Manual copy (leapfroggroup.org), checklist reproductions (caho.in, hqontario.ca), a PMC table and Wikipedia summaries. The who.int originals were not opened; the URL is the implementation-manual copy seen in the search record.',
  },
  // Timing cross-check (2026-11-05): S55–S56. Page fetches were blocked in this session (egress proxy
  // refused accessdata.fda.gov / pubmed); what each search record showed is in TIMING_EVIDENCE.md.
  S55: {
    id: 'S55',
    citation: 'Frerk C, Mitchell VS, McNarry AF, et al. Difficult Airway Society 2015 guidelines for management of unanticipated difficult intubation in adults. Br J Anaesth. 2015;115(6):827-848.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4650961/',
    identifiers: 'PMID 26556848; PMCID PMC4650961 (DOI not seen in a search record; not shown)',
    type: 'guideline',
    supports: 'Preoxygenation: all patients should be preoxygenated before induction of general anaesthesia with 100% oxygen at an appropriate flow, maintaining an effective face-mask seal until the end-tidal oxygen fraction is 0.87–0.9. Head-up (20–25°) position with CPAP delays hypoxia in obese patients. The guideline gives an end point (end-tidal O2), not a duration. Superseded by DAS 2025 (Br J Anaesth 2026;136(1):283-307; PMID 41203471), whose preoxygenation figures were not confirmed in this session.',
    verifiedVia: 'WebSearch records (2026-11-05, timing cross-check) of the PMC4650961 full-text record (preoxygenation sentence with the 0.87–0.9 end-tidal oxygen fraction; head-up/CPAP sentence), the PubMed record 26556848 and a UKZN-hosted PDF copy. The pages themselves could not be fetched (egress proxy). A 3-min tidal-breathing duration was NOT found in the DAS 2015 text in these records.',
  },
  S56: {
    id: 'S56',
    citation: '2022 American Society of Anesthesiologists Practice Guidelines for Management of the Difficult Airway. Anesthesiology. 2022;136(1):31-81.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34762729/',
    identifiers: 'doi:10.1097/ALN.0000000000004002; PMID 34762729',
    type: 'guideline',
    supports: 'Supplemental oxygen before initiating and throughout difficult-airway management, including extubation (wording seen in secondary reproductions: "administer supplemental oxygen before initiating management of the difficult airway, and continue to deliver supplemental oxygen whenever feasible"). No preoxygenation duration or end-tidal target was found.',
    verifiedVia: 'WebSearch records (2026-11-05, timing cross-check) of the PubMed record 34762729 (citation, DOI), the APSF update article and two secondary summaries reproducing the oxygen recommendation. Guideline full text not opened (egress proxy); author list not confirmed and not shown.',
  },
};

// ---------------------------------------------------------------------------------------------
// IV fluids (2026-11 additions). Composition and warnings from the FDA labels; the labels give no
// fixed dose ("based on the patient's age, weight, clinical condition and concomitant therapy"),
// so every rate and volume used in the simulator is a UI choice (simulator convention, listed in
// engine/sim.js FLUID_MODEL and in the parameter inventory). Both fluids use the SAME illustrative
// volume-response model: no type-specific physiology (e.g. chloride, lactate, potassium) is modelled.
export const FLUIDS = [
  {
    id: 'lactated_ringers', name: "Lactated Ringer's", shortName: 'LR', type: 'balanced crystalloid',
    composition: { unit: 'per litre (approx.)', sodiumMmol: 130, potassiumMmol: 4, calciumMmol: 1.4, calciumMeq: 2.7, chlorideMmol: 109, lactateMmol: 28, osmolarityMosmolL: 272, pH: 6.5 },
    indication: 'Source of water and electrolytes or an alkalinizing agent (label).',
    dosing: 'Label: dosage and duration based on age, weight, clinical condition and concomitant therapy (no fixed dose). Simulator rates/volumes are UI choices.',
    cautions: [
      { when: 'condition:hyperkalemia', severity: 'warn', message: "Lactated Ringer's label: potassium-containing solutions, including Lactated Ringer's Injection, may increase the risk of hyperkalemia.", sources: ['S47'] },
      { when: 'condition:severe_hepatic_impairment', severity: 'warn', message: "Lactated Ringer's label: patients with severe hepatic impairment may have impaired lactate metabolism; monitor serum lactate and acid-base status.", sources: ['S47'] },
      { when: 'condition:liver_disease', severity: 'warn', message: "Lactated Ringer's label: in hepatic impairment lactate metabolism may be impaired (severe impairment named in the label); monitor lactate and acid-base status.", sources: ['S47'] },
    ],
    labelNotes: ["Do not give simultaneously with ceftriaxone in neonates ≤ 28 days; in older patients give sequentially with thorough line flushing (label).", 'Risk of fluid and/or solute overload (label).'],
    sources: ['S47'],
  },
  {
    id: 'sodium_chloride_0_9', name: '0.9% sodium chloride', shortName: 'NS', type: 'isotonic saline',
    composition: { unit: 'per litre', sodiumMeq: 154, chlorideMeq: 154, osmolarityMosmolL: 308 },
    indication: 'Source of water and electrolytes (label).',
    dosing: 'Label: no fixed dose (dosage individualised). Simulator rates/volumes are UI choices.',
    cautions: [
      { when: 'condition:sepsis', severity: 'warn', message: '0.9% sodium chloride label: use with particular caution in patients with or at risk for metabolic acidosis; hyperchloraemic metabolic acidosis has been reported (post-marketing). Monitor chloride and acid-base balance. (The simulator applies this caution to the sepsis condition — a simulator mapping.)', sources: ['S48'] },
      { when: 'condition:hf_reduced_ef', severity: 'warn', message: '0.9% sodium chloride label: may cause fluid and/or solute overload; monitor fluid status. (Applied to heart failure — a simulator mapping.)', sources: ['S48'] },
    ],
    labelNotes: ['Use with particular caution, if at all, in patients with or at risk for hypernatraemia, hyperchloraemia or metabolic acidosis (label).', 'Monitor serum sodium and chloride, fluid status and acid-base balance (label).'],
    sources: ['S48'],
  },
];

// Evidence note shown next to the fluid choice (not used in the model).
export const FLUID_EVIDENCE_NOTE = Object.freeze({
  text: 'SMART (Semler 2018; critically ill ICU adults, not elective surgery): balanced crystalloids versus 0.9% saline — major adverse kidney events within 30 days 14.3% vs 15.4% (adjusted OR 0.90). The simulator does not model chloride, acid-base or kidney outcomes.',
  sources: ['S50'],
});

// ---------------------------------------------------------------------------------------------
// Surgical antibiotic prophylaxis (2026-11 additions; Bratzler 2013, S46). TIMING ONLY: antibiotic
// pharmacology is not modelled (no PK/PD). Same regimen schema as DRUGS so recommend() can fill the
// dose; `prophylaxis` holds the guideline timing (window before incision, redosing interval).
export const ANTIBIOTICS = [
  {
    id: 'cefazolin', name: 'Cefazolin', cls: 'antibiotic', amountUnit: 'mg', concentration: null,
    regimens: {
      prophylaxis: {
        kind: 'bolus', fixed: { default: 2000, min: 2000, max: 2000, unit: 'mg' }, scalar: null, scalarBasis: null,
        adjust: [{ when: 'weight>=120', fixed: { default: 3000, min: 3000, max: 3000, unit: 'mg' }, note: 'Bratzler 2013: 3 g for patients weighing ≥ 120 kg.', sources: ['S46'] }],
        timing: 'Begin within 60 minutes before surgical incision; redose every 4 h (from the start of the preoperative dose) during prolonged surgery.',
        sources: ['S46'],
        note: 'Guideline adult dose 2 g IV (3 g if ≥ 120 kg). Timing only — antibiotic pharmacology is not modelled.',
      },
    },
    prophylaxis: { windowBeforeIncisionMin: 60, redoseIntervalMin: 240, sources: ['S46'] },
    contraindications: [
      { when: 'allergy:beta_lactam_severe', severity: 'lock', message: 'Bratzler 2013 (as summarised): avoid cephalosporins in patients with an IgE-mediated (e.g. anaphylaxis) or severe β-lactam allergy; clindamycin or vancomycin are the recommended alternatives.', sources: ['S46'] },
    ],
    ceiling: null,
  },
  {
    id: 'clindamycin', name: 'Clindamycin', cls: 'antibiotic', amountUnit: 'mg', concentration: null,
    regimens: {
      prophylaxis: {
        kind: 'bolus', fixed: { default: 900, min: 900, max: 900, unit: 'mg' }, scalar: null, scalarBasis: null,
        timing: 'Begin within 60 minutes before surgical incision; redose every 6 h during prolonged surgery.',
        sources: ['S46'],
        note: 'β-lactam-allergy alternative (Bratzler 2013). Timing only — antibiotic pharmacology is not modelled.',
      },
    },
    prophylaxis: { windowBeforeIncisionMin: 60, redoseIntervalMin: 360, alternativeFor: 'allergy:beta_lactam_severe', sources: ['S46'] },
    contraindications: [],
    ceiling: null,
  },
  {
    id: 'vancomycin', name: 'Vancomycin', cls: 'antibiotic', amountUnit: 'mg', concentration: null,
    regimens: {
      prophylaxis: {
        kind: 'bolus', perKg: { default: 15, min: 15, max: 15 }, unit: 'mg/kg', scalar: 'TBW', scalarBasis: 'convention',
        timing: 'Begin within 120 minutes before surgical incision (prolonged infusion time); routine intraoperative redosing not applicable.',
        sources: ['S46'],
        note: 'β-lactam-allergy alternative (Bratzler 2013), 15 mg/kg. The guideline weight basis was not confirmed; the simulator uses total body weight (convention). Timing only — infusion duration and pharmacology are not modelled.',
      },
    },
    prophylaxis: { windowBeforeIncisionMin: 120, redoseIntervalMin: null, alternativeFor: 'allergy:beta_lactam_severe', sources: ['S46'] },
    contraindications: [],
    ceiling: null,
  },
];

// Selection order (Bratzler 2013): cefazolin first-line; with a severe β-lactam allergy (cefazolin
// locked) the first unlocked alternative is offered (clindamycin, then vancomycin).
export const PROPHYLAXIS_SELECTION = Object.freeze({ order: Object.freeze(['cefazolin', 'clindamycin', 'vancomycin']), sources: Object.freeze(['S46']) });

// Technique-template evidence and teaching notes (shown on the plan screen; not used in the model).
export const TEMPLATE_NOTES = Object.freeze({
  pofa: { text: 'Evidence note — POFA trial (Beloeil 2021): a dexmedetomidine-based opioid-free balanced anaesthetic, compared with remifentanil-based balanced anaesthesia, caused more postoperative hypoxaemia (the main driver of more opioid-related adverse events), more delayed extubation and longer PACU stay, and the trial was stopped early after five cases of severe bradycardia with dexmedetomidine; postoperative nausea and vomiting was less frequent with dexmedetomidine. The doses in this template come from the drug library, not from the trial protocol.', sources: ['S49'] },
  propofolPain: { text: 'Teaching note (not modelled numerically): propofol injectable emulsion is isotonic with a pH of 7 to 8.5 (label), so injection pain is not caused by an acidic solution. It is generally attributed to propofol in the aqueous phase of the emulsion acting on the vein wall (mechanism not fully resolved; no source registered for it). Label measures: larger forearm/antecubital veins and prior IV lidocaine 1 mL of 1%. Meta-analysis (Jalota 2011): antecubital vein and lidocaine pretreatment with venous occlusion were the most effective measures.', sources: ['S11', 'S51'] },
  dexMac: { text: 'Dexmedetomidine procedural sedation (label): loading 1 mcg/kg over 10 min (0.5 mcg/kg for less invasive procedures; 0.5 mcg/kg if > 65 y), then 0.6 mcg/kg/h titrated 0.2–1 mcg/kg/h. In the label studies rescue midazolam was permitted to reach or keep the target sedation. Optional propofol or midazolam supplementation can be added from the library. Targets follow the ASA continuum (minimal / moderate / deep). Sedation beyond deep — not arousable to painful stimulation — is general anaesthesia: use a GA template (airway management).', sources: ['S9', 'S31'] },
  dexInterlock: { text: 'With interlocks on, the Smart NOA simulation ceiling for dexmedetomidine is 0.5 mcg/kg/h (config.yaml), below the 0.6 mcg/kg/h label start rate; the ceiling is pre-filled and titration above 0.5 is blocked while interlocks are on.', sources: ['S35'] },
  lidocaineOverlap: { text: 'IV lidocaine infusion planned: lidocaine pretreatment before propofol is omitted, because every lidocaine dose counts toward the cumulative IV lidocaine total (Foo 2021 loading ≤ 1.5 mg/kg IBW; infusion ≤ 1.5 mg/kg/h IBW, ≤ 120 mg/h).', sources: ['S1'] },
});

// ---------------------------------------------------------------------------------------------
// Patient-entry vocabularies. `group` drives UI checkbox grouping.
export const CONDITIONS = [
  // cardiovascular
  { id: 'heart_block', label: '2nd/3rd-degree heart block (no pacemaker)', group: 'cardiovascular' },
  { id: 'wpw', label: 'Wolff-Parkinson-White syndrome', group: 'cardiovascular' },
  { id: 'cad', label: 'Coronary artery disease', group: 'cardiovascular' },
  { id: 'hf_reduced_ef', label: 'Heart failure with reduced ejection fraction', group: 'cardiovascular' },
  { id: 'aortic_stenosis_severe', label: 'Severe aortic stenosis', group: 'cardiovascular' },
  { id: 'uncontrolled_htn', label: 'Uncontrolled hypertension', group: 'cardiovascular' },
  { id: 'hypovolemia', label: 'Hypovolaemia / volume depletion', group: 'cardiovascular' },
  { id: 'bleeding_risk', label: 'High bleeding risk (cerebrovascular bleeding, haemorrhagic diathesis, incomplete haemostasis)', group: 'cardiovascular' },
  // respiratory
  { id: 'osa', label: 'Obstructive sleep apnoea (diagnosed)', group: 'respiratory' },
  { id: 'asthma', label: 'Asthma', group: 'respiratory' },
  { id: 'copd', label: 'COPD', group: 'respiratory' },
  // renal / hepatic
  { id: 'liver_disease', label: 'Liver disease / hepatic impairment', group: 'renal_hepatic' },
  { id: 'severe_hepatic_impairment', label: 'Severe hepatic impairment', group: 'renal_hepatic' },
  { id: 'peptic_ulcer_gi_bleed', label: 'Active peptic ulcer disease or recent GI bleeding/perforation', group: 'renal_hepatic' },
  { id: 'bowel_obstruction', label: 'Bowel obstruction (gas-distended bowel)', group: 'renal_hepatic' },
  { id: 'bowel_or_urinary_obstruction', label: 'Peritonitis or mechanical bowel/urinary obstruction', group: 'renal_hepatic' },
  // neuro / psych
  { id: 'psychosis_history', label: 'History of psychosis', group: 'neuro_psych' },
  { id: 'neuromuscular_disease', label: 'Skeletal muscle myopathy / neuromuscular disease', group: 'neuro_psych' },
  { id: 'recent_burn_or_denervation', label: 'Major burn, multiple trauma, extensive denervation or upper motor neuron injury (after acute phase)', group: 'neuro_psych' },
  { id: 'narrow_angle_glaucoma', label: 'Acute narrow-angle glaucoma', group: 'neuro_psych' },
  // metabolic / other
  { id: 'hyperkalemia', label: 'Hyperkalaemia', group: 'metabolic_other' },
  { id: 'adrenal_insufficiency', label: 'Adrenal insufficiency', group: 'metabolic_other' },
  { id: 'sepsis', label: 'Sepsis', group: 'metabolic_other' },
  { id: 'diabetes', label: 'Diabetes mellitus', group: 'metabolic_other' },
  { id: 'pneumothorax', label: 'Pneumothorax (current)', group: 'respiratory' },
  { id: 'gerd', label: 'Gastro-oesophageal reflux (aspiration risk)', group: 'metabolic_other' },
  { id: 'systemic_fungal_infection', label: 'Systemic fungal infection', group: 'metabolic_other' },
  // anaesthesia-specific
  { id: 'mh_susceptible', label: 'Malignant hyperthermia susceptible (personal/family history)', group: 'anesthesia_specific' },
  { id: 'regional_block_planned', label: 'Regional block / wound infiltration planned or active', group: 'anesthesia_specific' },
];

export const ALLERGIES = [
  { id: 'nsaid', label: 'NSAID / aspirin' },
  { id: 'propofol', label: 'Propofol' },
  { id: 'egg_soy', label: 'Egg or soybean' },
  { id: 'rocuronium', label: 'Rocuronium / other neuromuscular blocker' },
  { id: 'succinylcholine', label: 'Succinylcholine' },
  { id: 'sugammadex', label: 'Sugammadex' },
  { id: 'neostigmine', label: 'Neostigmine' },
  { id: 'etomidate', label: 'Etomidate' },
  { id: 'ketamine', label: 'Ketamine' },
  { id: 'halogenated_volatile', label: 'Sevoflurane / desflurane / isoflurane / other halogenated volatile agents' },
  { id: 'ondansetron', label: 'Ondansetron' },
  { id: 'dexamethasone', label: 'Dexamethasone (product component)' },
  { id: 'beta_lactam_severe', label: 'β-lactam (penicillin/cephalosporin) allergy — IgE-mediated (e.g. anaphylaxis) or severe reaction' },
];

export const MEDICATIONS = [
  { id: 'beta_blocker', label: 'Beta-blocker' },
  { id: 'apomorphine', label: 'Apomorphine' },
  { id: 'nsaid_aspirin', label: 'Current aspirin or NSAID therapy' },
  { id: 'opioid_chronic', label: 'Long-term opioid therapy' },
  { id: 'cns_depressant', label: 'Other CNS depressant (benzodiazepine, sedative)' },
];

// Patient flags produced by engine/patient.js derivePatient() (SPEC §3). Listed here so data tests
// can validate `flag:<id>` references.
export const KNOWN_FLAGS = Object.freeze([
  'elderly', 'obese', 'morbidObese', 'ckd', 'severeCkd', 'aspirationRisk', 'difficultAirwayPredicted',
]);

export const WHEN_FORMS = Object.freeze({
  contraindication: ['condition:<id>', 'allergy:<id>', 'medication:<id>', 'egfr<N', 'age>=N', 'flag:<id>'],
  adjust: ['any contraindication form', 'asa>=N', 'weight<N', "tokens joined by '|' (OR)"],
});

export const LIBRARY_NOTES = Object.freeze({
  inhaledMacAdditivity: 'Illustrative model assumption: MAC fractions of co-administered inhaled agents are treated as additive. This is standard teaching; no acceptable source was verified in this session (see SOURCES.md, Model assumptions).',
  nitrousOxide: 'Nitrous oxide is included from NON-LABEL sources only (US cylinder labels give no clinical dose): ENIGMA-II trial concentration (S38), Eger & Saidman 1965 closed-gas-space physiology (S39), PONV consensus (S3), Mapleson MAC40 104% (S26). MAC40 >100% means it cannot provide anaesthesia alone at 1 atm and must be combined with another agent.',
  fio2Arithmetic: 'Inspired N2O fraction limits the maximum FiO2: FiO2 max = 1 − FiN2O (e.g., 70% N2O leaves at most 0.30 O2). Simple fraction arithmetic; no source cited.',
});

const NOT_STATED = (note) => ({
  onsetMin: null, peakMin: null, durationMin: null,
  basis: 'not stated in label', sources: [], note: note || 'Engine uses its illustrative fallback constants.',
});

// ---------------------------------------------------------------------------------------------
export const DRUGS = [
  // ---------------- Hypnotics ----------------
  {
    id: 'propofol', name: 'Propofol', cls: 'hypnotic',
    concentration: { value: 10, unit: 'mg/mL' },
    amountUnit: 'mg',
    regimens: {
      sedation_moderate: {
        kind: 'infusion',
        loading: { method: 'slow injection', perKg: { default: 0.5, min: 0.5, max: 0.5 }, unit: 'mg/kg', overMin: { min: 3, max: 5 },
          alternative: 'or infusion 100–150 mcg/kg/min for 3–5 min' },
        rate: { default: 25, min: 25, max: 75, unit: 'mcg/kg/min' },
        scalar: 'TBW', scalarBasis: 'convention',
        adjust: [{ when: 'flag:elderly|asa>=3', note: 'Label: in elderly, debilitated or ASA III/IV patients, rapid (single or repeated) bolus dose administration should not be used for MAC sedation.', sources: ['S11'] }],
        timing: 'Slow infusion or slow injection preferable to rapid bolus; maintenance 25–75 mcg/kg/min for the first 10–15 min, then 25–50 mcg/kg/min.',
        sources: ['S11'],
        note: 'Label MAC-sedation dosing does not distinguish moderate from deep; target depth is set by titration (S31). Default = lower bound.',
      },
      sedation_deep: {
        kind: 'infusion',
        loading: { method: 'slow injection', perKg: { default: 0.5, min: 0.5, max: 0.5 }, unit: 'mg/kg', overMin: { min: 3, max: 5 },
          alternative: 'or infusion 100–150 mcg/kg/min for 3–5 min' },
        rate: { default: 25, min: 25, max: 75, unit: 'mcg/kg/min' },
        scalar: 'TBW', scalarBasis: 'convention',
        adjust: [{ when: 'flag:elderly|asa>=3', note: 'Label: in elderly, debilitated or ASA III/IV patients, rapid (single or repeated) bolus dose administration should not be used for MAC sedation.', sources: ['S11'] }],
        timing: 'Slow infusion or slow injection preferable to rapid bolus.',
        sources: ['S11'],
        note: 'Same label range as moderate sedation; deep sedation requires exhaled-CO2 monitoring (S22).',
      },
      induction: {
        kind: 'bolus',
        perKg: { default: 2, min: 2, max: 2.5 }, unit: 'mg/kg',
        scalar: 'TBW', scalarBasis: 'convention',
        adjust: [{ when: 'flag:elderly|asa>=3', perKg: { default: 1, min: 1, max: 1.5 }, note: 'Label: elderly, debilitated or ASA III–IV about 1–1.5 mg/kg (20 mg every 10 s).', sources: ['S11'] }],
        timing: 'Healthy adults <55 y: about 40 mg every 10 s until onset.',
        sources: ['S11'],
      },
      maintenance: {
        kind: 'infusion',
        rate: { default: 100, min: 100, max: 200, unit: 'mcg/kg/min' },
        scalar: 'TBW', scalarBasis: 'convention',
        adjust: [{ when: 'flag:elderly|asa>=3', rate: { default: 50, min: 50, max: 100, unit: 'mcg/kg/min' }, note: 'Label: elderly, debilitated or ASA III–IV 50–100 mcg/kg/min.', sources: ['S11'] }],
        timing: 'Label rates assume co-administered nitrous oxide or opioids.',
        sources: ['S11'],
      },
    },
    ceiling: { value: 200, unit: 'mcg/kg/min', basis: 'label range upper bound', sources: ['S11'], note: 'Top of the label maintenance range; the label does not call this a maximum.' },
    contraindications: [
      { when: 'allergy:propofol', severity: 'lock', message: 'Contraindicated: known hypersensitivity to propofol (label CONTRAINDICATIONS).', sources: ['S11'] },
      { when: 'allergy:egg_soy', severity: 'lock', message: 'Contraindicated: known hypersensitivity to propofol, egg or soybean (current label CONTRAINDICATIONS; older labels: anaphylaxis to eggs, egg products, soybeans or soy products).', sources: ['S11'] },
    ],
    timing: { onsetMin: 0.67, peakMin: null, durationMin: null, basis: 'label statement: hypnosis usually within 40 seconds from the start of injection (one arm-brain circulation)', defaultBolus: '2 mg/kg', sources: ['S11'] },
    pkModel: 'eleveld',
    pkModelFallback: 'calibrated',
    pkModelInfo: {
      model: 'eleveld', form: 'arterial', sources: ['S42'],
      note: 'Published Eleveld 2018 population PK with ke0 (arterial). Covariates from the simulated patient (age, total body weight, height, sex) plus the published concomitant-drug switch, implemented as opioids only (an opioid in the plan or already given), as in the open-source implementations. The simulated depth index still uses the illustrative PD in engine/pd.js, not the Eleveld BIS model. Set pkModel to the fallback \'calibrated\' to use the illustrative 2-compartment model fitted to label timing.',
    },
    pkNote: 'Eleveld 2018 PK (S42) verified against four agreeing open-source implementations/readings; Marsh 1991 parameters remain unverified against the paper (see SOURCES.md "Propofol PK model").',
  },
  {
    id: 'etomidate', name: 'Etomidate', cls: 'hypnotic',
    concentration: { value: 2, unit: 'mg/mL' },
    amountUnit: 'mg',
    regimens: {
      induction: {
        kind: 'bolus',
        perKg: { default: 0.3, min: 0.2, max: 0.6 }, unit: 'mg/kg',
        scalar: 'TBW', scalarBasis: 'convention',
        adjust: [{ when: 'flag:elderly', note: 'Label: geriatric patients may require reduced doses (no figure given).', sources: ['S23'] }],
        timing: 'Inject over 30–60 seconds.',
        sources: ['S23'],
        note: 'Default is the label usual dose 0.3 mg/kg.',
      },
    },
    ceiling: null,
    contraindications: [
      { when: 'allergy:etomidate', severity: 'lock', message: 'Contraindicated in patients who have shown hypersensitivity to it (label CONTRAINDICATIONS).', sources: ['S23'] },
      { when: 'condition:adrenal_insufficiency', severity: 'warn', message: 'Label: reduced plasma cortisol levels have been reported with induction doses of 0.3 mg/kg; these persist for approximately 6–8 hours and appear to be unresponsive to ACTH administration.', sources: ['S23'] },
      { when: 'condition:sepsis', severity: 'warn', message: 'Label: reduced plasma cortisol levels have been reported with induction doses of 0.3 mg/kg; these persist for approximately 6–8 hours and appear to be unresponsive to ACTH administration. (The label does not name sepsis; the simulator applies this warning as policy.)', sources: ['S23'] },
    ],
    timing: { onsetMin: 1, peakMin: null, durationMin: 4, ranges: { durationMin: [3, 5] }, basis: 'label statement: rapid onset, usually within one minute; duration usually three to five minutes at 0.3 mg/kg (midpoint used)', defaultBolus: '0.3 mg/kg', sources: ['S23'] },
    pkModel: 'calibrated',
  },
  {
    id: 'ketamine', name: 'Ketamine', cls: 'nmda',
    concentration: { value: 10, unit: 'mg/mL' },
    amountUnit: 'mg',
    regimens: {
      induction: {
        kind: 'bolus',
        perKg: { default: 2, min: 1, max: 4.5 }, unit: 'mg/kg',
        scalar: 'TBW', scalarBasis: 'convention',
        timing: 'Administer slowly (over 60 seconds); rapid administration may cause respiratory depression and enhanced vasopressor response.',
        sources: ['S27'],
        note: 'Default is the label average dose (2 mg/kg gives 5–10 min surgical anaesthesia).',
      },
      maintenance: {
        kind: 'infusion',
        rate: { default: 0.2, min: 0, max: 1, unit: 'mg/kg/h' },
        scalar: 'TBW', scalarBasis: 'convention',
        timing: 'Subanaesthetic analgesic infusion (consensus); bolus, if used, ≤0.35 mg/kg.',
        sources: ['S10', 'S35'],
        note: 'Off-label analgesic use per Schwenk 2018 (infusion up to about 1 mg/kg/h). Default 0.2 mg/kg/h equals the Smart NOA Python simulation ceiling (config.yaml), which applies when interlocks are enabled; it is a software value, not a guideline recommendation.',
      },
    },
    ceiling: { value: 1, unit: 'mg/kg/h', basis: 'guideline maximum', appliesTo: 'maintenance', sources: ['S10'], note: 'Schwenk 2018: infusions up to about 1 mg/kg/h; bolus ≤0.35 mg/kg for analgesia.' },
    contraindications: [
      { when: 'allergy:ketamine', severity: 'lock', message: 'Contraindicated: known hypersensitivity to ketamine or to any excipient (label CONTRAINDICATIONS).', sources: ['S27'] },
      { when: 'condition:uncontrolled_htn', severity: 'lock', message: 'Contraindicated in patients for whom a significant elevation of blood pressure would constitute a serious hazard (label CONTRAINDICATIONS; the simulator applies it to uncontrolled hypertension).', sources: ['S27'] },
      { when: 'condition:psychosis_history', severity: 'warn', message: 'Label: postoperative confusional states may occur during the recovery period. (The label does not name psychosis history; the simulator applies this warning as policy. Schwenk 2018 contraindication list not retrieved.)', sources: ['S27'] },
    ],
    timing: { onsetMin: 0.5, peakMin: null, durationMin: 7.5, ranges: { durationMin: [5, 10] }, basis: 'label statement: 2 mg/kg produces 5 to 10 minutes of surgical anesthesia within 30 seconds (midpoint used)', defaultBolus: '2 mg/kg', sources: ['S27'] },
    pkModel: 'calibrated',
  },
  {
    id: 'sevoflurane', name: 'Sevoflurane', cls: 'volatile',
    concentration: null,
    amountUnit: '%',
    regimens: {
      maintenance: {
        kind: 'inhaled',
        rate: { default: 0.5, min: 0.5, max: 3, unit: '%' },
        defaultRule: 'ageAdjustedMac',
        scalar: null, scalarBasis: null,
        timing: 'Surgical levels of anesthesia can usually be achieved with concentrations of 0.5–3% with or without nitrous oxide.',
        sources: ['S25', 'S26'],
        note: 'Numeric default is the label lower bound. Engine may instead display/offer 1.0 × age-adjusted MAC (Mapleson 1996); 1 MAC is a definitional reference point, not a recommendation.',
      },
    },
    mac: {
      model: 'mapleson1996', mac40Pct: 1.80, slopePerYear: -0.00269,
      formula: 'MAC(age) = MAC40 × 10^(slopePerYear × (age − 40))',
      sources: ['S26'],
      labelTableO2: [{ ageYears: 25, macPct: 2.6 }, { ageYears: 40, macPct: 2.1 }, { ageYears: 60, macPct: 1.7 }, { ageYears: 80, macPct: 1.4 }],
      labelTableSources: ['S25'],
      note: 'Mapleson MAC40 (1.80%) and the US label table (2.1% at 40 y) differ; both are shown. The simulator effect model uses Mapleson.',
    },
    ceiling: { value: 3, unit: '%', basis: 'label range upper bound', sources: ['S25'], note: 'Top of the label maintenance range (0.5–3%); not called a maximum.' },
    contraindications: [
      { when: 'condition:mh_susceptible', severity: 'lock', message: 'Contraindicated in patients with known or suspected genetic susceptibility to malignant hyperthermia (label CONTRAINDICATIONS).', sources: ['S25'] },
      { when: 'allergy:halogenated_volatile', severity: 'lock', message: 'Contraindicated in patients with known sensitivity to sevoflurane or to other halogenated agents (label CONTRAINDICATIONS).', sources: ['S25'] },
    ],
    timing: NOT_STATED('Volatile agent: engine uses first-order wash-in/out of end-tidal fraction (illustrative).'),
    pkModel: 'calibrated',
  },

  {
    id: 'desflurane', name: 'Desflurane', cls: 'volatile',
    concentration: null,
    amountUnit: '%',
    regimens: {
      maintenance: {
        kind: 'inhaled',
        rate: { default: 2.5, min: 2.5, max: 8.5, unit: '%' },
        defaultRule: 'ageAdjustedMac',
        scalar: null, scalarBasis: null,
        timing: 'Surgical levels of anesthesia in adults may be maintained with 2.5–8.5% with or without nitrous oxide; concentration required is age dependent. Avoid rapid increases in concentration.',
        sources: ['S36', 'S26'],
        note: 'No induction regimen: the US label wording on adult mask induction was not retrieved (the Canadian monograph says it is not recommended for mask induction in adults because of a high incidence of moderate to severe upper airway adverse events; the US label says the same for paediatric induction). Default = label lower bound.',
      },
    },
    mac: {
      model: 'mapleson1996', mac40Pct: 6.6, slopePerYear: -0.00269,
      formula: 'MAC(age) = MAC40 × 10^(slopePerYear × (age − 40))',
      sources: ['S26'],
      labelTableO2: null, labelTableSources: [],
      note: 'US label MAC-by-age table not retrieved in this session.',
    },
    runtimeRules: [
      { id: 'rapid_concentration_increase', severity: 'warn', message: 'Label: a rapid increase in desflurane concentration is associated with marked increase in pulse rate, mean arterial pressure and levels of epinephrine and norepinephrine; concentrations exceeding 1 MAC may increase heart rate, so an increased heart rate may not serve reliably as a sign of inadequate anesthesia.', sources: ['S36'] },
    ],
    ceiling: { value: 8.5, unit: '%', basis: 'label range upper bound', sources: ['S36'], note: 'Top of the label adult maintenance range; not called a maximum.' },
    contraindications: [
      { when: 'condition:mh_susceptible', severity: 'lock', message: 'Label: SUPRANE can induce malignant hyperthermia in patients with known or suspected susceptibility based on genetic factors or family history (listed among CONTRAINDICATIONS).', sources: ['S36'] },
      { when: 'allergy:halogenated_volatile', severity: 'lock', message: 'Contraindicated in patients with known sensitivity to SUPRANE or to other halogenated agents (label CONTRAINDICATIONS).', sources: ['S36'] },
    ],
    timing: NOT_STATED('Volatile agent: engine uses first-order wash-in/out of end-tidal fraction (illustrative).'),
    pkModel: 'calibrated',
  },
  {
    id: 'isoflurane', name: 'Isoflurane', cls: 'volatile',
    concentration: null,
    amountUnit: '%',
    regimens: {
      induction: {
        kind: 'inhaled',
        rate: { default: 1.5, min: 1.5, max: 3, unit: '%' },
        scalar: null, scalarBasis: null,
        timing: 'Begin at 0.5%; 1.5–3.0% usually produces surgical anesthesia in 7–10 minutes.',
        sources: ['S37'],
        note: 'Default = lower bound of the label surgical-anaesthesia range (label starting concentration is 0.5%).',
      },
      maintenance: {
        kind: 'inhaled',
        rate: { default: 1, min: 1, max: 2.5, unit: '%' },
        defaultRule: 'ageAdjustedMac',
        scalar: null, scalarBasis: null,
        timing: 'Surgical anesthesia sustained with 1.0–2.5% in oxygen/nitrous oxide; an additional 0.5–1.0% may be required with oxygen alone.',
        sources: ['S37', 'S26'],
        note: 'Range is for O2/N2O mixtures; with oxygen alone the label allows up to 1.0% more (ceiling 3.5%).',
      },
    },
    mac: {
      model: 'mapleson1996', mac40Pct: 1.17, slopePerYear: -0.00269,
      formula: 'MAC(age) = MAC40 × 10^(slopePerYear × (age − 40))',
      sources: ['S26'],
      labelTableO2: [{ ageYears: 26, macPct: 1.28 }, { ageYears: 44, macPct: 1.15 }, { ageYears: 64, macPct: 1.05 }],
      labelTableN2O70: [{ ageYears: 26, macPct: 0.56 }, { ageYears: 44, macPct: 0.50 }, { ageYears: 64, macPct: 0.37 }],
      labelTableSources: ['S37'],
      note: 'Label ages are group means (26 ± 4, 44 ± 7, 64 ± 5 y).',
    },
    ceiling: { value: 3.5, unit: '%', basis: 'label range upper bound', sources: ['S37'], note: 'Label maintenance upper bound 2.5% plus up to 1.0% with oxygen alone (arithmetic of label figures); not called a maximum.' },
    contraindications: [
      { when: 'condition:mh_susceptible', severity: 'lock', message: 'Contraindicated in patients with known or suspected genetic susceptibility to malignant hyperthermia (label CONTRAINDICATIONS).', sources: ['S37'] },
      { when: 'allergy:halogenated_volatile', severity: 'lock', message: 'Contraindicated in patients with known sensitivity to isoflurane or to other halogenated agents (label CONTRAINDICATIONS).', sources: ['S37'] },
    ],
    timing: NOT_STATED('Volatile agent: engine uses first-order wash-in/out (illustrative). Label: 1.5–3.0% usually produces surgical anesthesia in 7–10 minutes (induction context).'),
    pkModel: 'calibrated',
  },

  {
    id: 'nitrous_oxide', name: 'Nitrous oxide', cls: 'gas',
    concentration: null,
    amountUnit: '%',
    sourceTypeNote: 'NON-LABEL sources (RCT, physiology study, consensus); see SOURCES.md.',
    regimens: {
      maintenance: {
        kind: 'inhaled',
        rate: { default: 70, min: 70, max: 70, unit: '%' },
        scalar: null, scalarBasis: null,
        timing: 'Adjunct to another anaesthetic; ENIGMA-II gave an inspired concentration of 70% in 30% oxygen.',
        sources: ['S38', 'S26'],
        note: 'Illustrative concentration from the ENIGMA-II intervention arm (RCT), not a label dose. No source for a lower bound (e.g., 50%) was confirmed, so the range is the single trial value. MAC40 104% (Mapleson): cannot provide anaesthesia alone; must be combined.',
      },
    },
    mac: {
      model: 'mapleson1996', mac40Pct: 104, slopePerYear: -0.00269,
      formula: 'MAC(age) = MAC40 × 10^(slopePerYear × (age − 40))',
      sources: ['S26'],
      labelTableO2: null, labelTableSources: [],
      note: 'MAC above 100% at 1 atm: N2O alone cannot reach 1 MAC.',
    },
    fio2Note: 'FiO2 max = 1 − FiN2O (70% N2O → FiO2 ≤ 0.30). Arithmetic; no source.',
    ponvNote: { text: 'PONV consensus lists avoidance of nitrous oxide during maintenance anaesthesia among baseline risk-reduction measures; benefit is reported to be duration dependent.', sources: ['S3'] },
    ceiling: { value: 70, unit: '%', basis: 'study protocol value', sources: ['S38'], note: 'Highest concentration supported by the cited trial; not a label maximum.' },
    contraindications: [
      { when: 'condition:pneumothorax', severity: 'lock', message: 'Eger & Saidman 1965: nitrous oxide expands closed gas spaces; in dogs breathing 75% N2O a pneumothorax roughly doubled in volume within 10 min. The authors concluded N2O is relatively contraindicated in pneumothorax. (Simulator LOCK is policy; source is an animal physiology study, not a label.)', sources: ['S39'] },
      { when: 'condition:bowel_obstruction', severity: 'warn', message: 'Eger & Saidman 1965: nitrous oxide diffuses into and expands gas in obstructed bowel; the authors concluded N2O is relatively contraindicated in intestinal obstruction. (Physiology study, not a label.)', sources: ['S39'] },
    ],
    timing: NOT_STATED('Inhaled gas: engine uses first-order wash-in/out (illustrative). No label timing exists.'),
    pkModel: 'calibrated',
  },

  // ---------------- Alpha-2 agonist ----------------
  {
    id: 'dexmedetomidine', name: 'Dexmedetomidine', cls: 'alpha2',
    concentration: null,
    amountUnit: 'mcg',
    regimens: {
      sedation_minimal: {
        kind: 'infusion',
        loading: { perKg: { default: 1, min: 0.5, max: 1 }, unit: 'mcg/kg', overMin: { min: 10, max: 10 } },
        rate: { default: 0.6, min: 0.2, max: 1, unit: 'mcg/kg/h' },
        scalar: 'TBW', scalarBasis: 'convention',
        adjust: [
          { when: 'age>=66', loading: { perKg: { default: 0.5, min: 0.5, max: 0.5 }, unit: 'mcg/kg' }, note: 'Label: patients >65 years, loading 0.5 mcg/kg over 10 min; consider reducing maintenance.', sources: ['S9'] },
          { when: 'condition:liver_disease|condition:severe_hepatic_impairment', note: 'Label: consider dose reduction in hepatic impairment.', sources: ['S9'] },
        ],
        timing: 'Loading infusion over 10 minutes; 0.5 mcg/kg may suit less invasive procedures.',
        sources: ['S9'],
        note: 'Same label procedural-sedation regimen (the label does not define sedation levels); titrate within 0.2–1 mcg/kg/h toward the ASA-continuum target (S31). In the label studies rescue midazolam was permitted to reach/maintain the target.',
      },
      sedation_moderate: {
        kind: 'infusion',
        loading: { perKg: { default: 1, min: 0.5, max: 1 }, unit: 'mcg/kg', overMin: { min: 10, max: 10 } },
        rate: { default: 0.6, min: 0.2, max: 1, unit: 'mcg/kg/h' },
        scalar: 'TBW', scalarBasis: 'convention',
        adjust: [
          { when: 'age>=66', loading: { perKg: { default: 0.5, min: 0.5, max: 0.5 }, unit: 'mcg/kg' }, note: 'Label: patients >65 years, loading 0.5 mcg/kg over 10 min; consider reducing maintenance.', sources: ['S9'] },
          { when: 'condition:liver_disease|condition:severe_hepatic_impairment', note: 'Label: consider dose reduction in hepatic impairment.', sources: ['S9'] },
        ],
        timing: 'Loading infusion over 10 minutes; 0.5 mcg/kg may suit less invasive procedures.',
        sources: ['S9'],
        note: 'Labelled for procedural sedation of non-intubated patients. Default rate = label starting rate 0.6 mcg/kg/h (above the 0.5 mcg/kg/h Python simulation ceiling when interlocks are on, S35).',
      },
      sedation_deep: {
        kind: 'infusion',
        loading: { perKg: { default: 1, min: 0.5, max: 1 }, unit: 'mcg/kg', overMin: { min: 10, max: 10 } },
        rate: { default: 0.6, min: 0.2, max: 1, unit: 'mcg/kg/h' },
        scalar: 'TBW', scalarBasis: 'convention',
        adjust: [
          { when: 'age>=66', loading: { perKg: { default: 0.5, min: 0.5, max: 0.5 }, unit: 'mcg/kg' }, note: 'Label: patients >65 years, loading 0.5 mcg/kg over 10 min; consider reducing maintenance.', sources: ['S9'] },
          { when: 'condition:liver_disease|condition:severe_hepatic_impairment', note: 'Label: consider dose reduction in hepatic impairment.', sources: ['S9'] },
        ],
        timing: 'Loading infusion over 10 minutes.',
        sources: ['S9'],
        note: 'Same label regimen; label does not define a deep-sedation dose.',
      },
      maintenance: {
        kind: 'infusion',
        rate: { default: 0.2, min: 0.2, max: 0.7, unit: 'mcg/kg/h' },
        scalar: 'TBW', scalarBasis: 'convention',
        adjust: [
          { when: 'age>=66', note: 'Label: consider reducing maintenance dose in patients >65 years.', sources: ['S9'] },
          { when: 'condition:liver_disease|condition:severe_hepatic_impairment', note: 'Label: consider dose reduction in hepatic impairment.', sources: ['S9'] },
        ],
        timing: 'No loading dose in this regimen.',
        sources: ['S9', 'S35'],
        note: 'OFF-LABEL general-anaesthesia adjunct. Range shown is the label ICU maintenance range (0.2–0.7 mcg/kg/h) as the nearest labelled infusion range; Python simulation ceiling 0.5 mcg/kg/h applies with interlocks.',
      },
    },
    ceiling: { value: 1, unit: 'mcg/kg/h', basis: 'label range upper bound', sources: ['S9'], note: 'Top of the labelled procedural titration range (0.2–1 mcg/kg/h); not called a maximum.' },
    contraindications: [
      { when: 'condition:heart_block', severity: 'lock', message: 'Label WARNINGS: use with caution in patients with advanced heart block and/or severe ventricular dysfunction (bradycardia and sinus arrest reported). Label CONTRAINDICATIONS: none. Simulator LOCK mirrors the Smart NOA controller cardiac-condition lockout (config.yaml).', sources: ['S9', 'S35'] },
    ],
    timing: NOT_STATED('No onset/peak/duration statement verified in the label; 10 min is the loading-infusion duration, not onset.'),
    pkModel: 'calibrated',
  },

  // ---------------- Benzodiazepine ----------------
  {
    id: 'midazolam', name: 'Midazolam', cls: 'benzodiazepine',
    concentration: null,
    amountUnit: 'mg',
    regimens: Object.fromEntries(['premed', 'sedation_minimal', 'sedation_moderate'].map((k) => [k, {
      kind: 'bolus',
      fixed: { default: 1, min: 1, max: 2.5, unit: 'mg' },
      scalar: null, scalarBasis: null,
      adjust: [
        { when: 'age>=60|asa>=3', fixed: { default: 1, min: 0, max: 1.5, unit: 'mg' }, note: 'Label: patients 60 years or older, debilitated or chronically ill — initial IV sedation dose no more than 1.5 mg, given over no less than 2 minutes; wait an additional 2 or more minutes to evaluate the effect; total doses greater than 3.5 mg are not usually necessary. (ASA ≥ 3 stands in for "debilitated or chronically ill" — a simulator mapping. Source gives only an upper limit, so min 0; default 1 mg is the label\'s healthy-adult "as little as 1 mg" starting figure, which lies within this cap.)', sources: ['S17'] },
        { when: 'medication:cns_depressant|medication:opioid_chronic', note: 'Label: reduce dose with concomitant opioids or other CNS depressants (no figure used in the simulator).', sources: ['S17'] },
      ],
      timing: 'Give over at least 2 minutes; wait an additional 2 or more minutes to evaluate the effect. Healthy adult <60 y: start with as little as 1 mg; initial dose not to exceed 2.5 mg; titrate slowly.',
      sources: ['S17'],
      note: k === 'premed' ? 'IV anxiolysis using the label IV sedation titration (IM premedication dosing not used).' : 'Label IV sedation/anxiolysis titration.',
    }])),
    ceiling: null,
    contraindications: [
      { when: 'condition:narrow_angle_glaucoma', severity: 'lock', message: 'Benzodiazepines are contraindicated in patients with acute narrow-angle glaucoma (label CONTRAINDICATIONS).', sources: ['S17'] },
    ],
    timing: { onsetMin: 4, peakMin: null, durationMin: null, ranges: { onsetMin: [3, 5] }, basis: 'label statement: sedation achieved within 3 to 5 minutes after IV injection (midpoint used)', defaultBolus: '1 mg', sources: ['S17'] },
    pkModel: 'calibrated',
  },

  // ---------------- Opioid ----------------
  {
    id: 'fentanyl', name: 'Fentanyl', cls: 'opioid',
    concentration: { value: 50, unit: 'mcg/mL' },
    amountUnit: 'mcg',
    regimens: {
      induction: {
        kind: 'bolus',
        perKg: { default: 2, min: 2, max: 20 }, unit: 'mcg/kg',
        scalar: 'TBW', scalarBasis: 'convention',
        adjust: [{ when: 'flag:elderly|asa>=3', warn: true, note: 'Label PRECAUTIONS: the initial dose of fentanyl citrate should be appropriately reduced in elderly and debilitated patients; the effect of the initial dose should be considered in determining incremental doses. The label gives no reduced figure, so the auto-filled value is the unreduced low-dose tier (2 mcg/kg) — reduce it for this patient. (ASA ≥ 3 stands in for "debilitated" — a simulator mapping.)', sources: ['S13'] }],
        timing: 'Low dose 2 mcg/kg (minor procedures); moderate dose 2–20 mcg/kg.',
        sources: ['S13'],
        note: 'Default = label low-dose tier.',
      },
      maintenance: {
        kind: 'bolus',
        fixed: { default: 25, min: 25, max: 100, unit: 'mcg' },
        scalar: null, scalarBasis: null,
        timing: 'Moderate-dose technique increments, given when indicated by response.',
        sources: ['S13'],
        note: 'Range seen in label copies paired with the moderate-dose tier; full maintenance sentence not displayed in the search record. Default = lower bound.',
      },
    },
    ceiling: null,
    contraindications: [],
    timing: { onsetMin: null, peakMin: null, durationMin: 45, ranges: { durationMin: [30, 60] }, basis: 'label statement: onset almost immediate IV; analgesia 30 to 60 minutes after a single IV dose of up to 100 mcg (midpoint used)', defaultBolus: '≤100 mcg', sources: ['S13'] },
    pkModel: 'calibrated',
  },

  // ---------------- Local anaesthetic (IV) ----------------
  {
    id: 'lidocaine', name: 'Lidocaine (IV)', cls: 'local',
    concentration: null,
    amountUnit: 'mg',
    regimens: {
      induction: {
        kind: 'bolus',
        perKg: { default: 1.5, min: 0, max: 1.5 }, unit: 'mg/kg',
        scalar: 'IBW', scalarBasis: 'guideline',
        timing: 'Loading dose ≤1.5 mg/kg given over about 10 min.',
        sources: ['S1'],
        note: 'Foo 2021 loading dose for an analgesic infusion (off-label). The cited sources do not support a dose for airway/pressor attenuation. Source gives only an upper limit: min 0, default = limit. Not for patients <40 kg. Overlap rule: not with other local-anaesthetic interventions.',
      },
      maintenance: {
        kind: 'infusion',
        rate: { default: 1.5, min: 0, max: 1.5, unit: 'mg/kg/h' },
        scalar: 'IBW', scalarBasis: 'guideline',
        timing: 'Infusion ≤1.5 mg/kg/h (IBW), never above 120 mg/h; review by 24 h.',
        sources: ['S1', 'S35'],
        note: 'Source gives only an upper limit: min 0, default = limit. Equals the Python simulation ceiling (config.yaml).',
      },
      pretreatment: {
        kind: 'bolus',
        fixed: { default: 10, min: 10, max: 10, unit: 'mg' },
        scalar: null, scalarBasis: null,
        timing: 'Give IV immediately before propofol (label: prior injection of IV lidocaine, 1 mL of a 1% solution). Larger forearm/antecubital veins also reduce injection pain.',
        sources: ['S11'],
        note: 'Propofol label (S11): pain during IV injection may be reduced by prior injection of IV lidocaine (1 mL of a 1% solution = 10 mg; arithmetic). The label also allows lidocaine added immediately before use, not exceeding 20 mg per 200 mg propofol (admixture not modelled). Counts toward the cumulative lidocaine total and the Foo 2021 IV-lidocaine overlap check (S1). Injection pain itself is not modelled numerically.',
      },
    },
    ceiling: { value: 120, unit: 'mg/h', basis: 'guideline maximum', perKg: { value: 1.5, unit: 'mg/kg/h', scalar: 'IBW' }, sources: ['S1'], note: 'Whichever is lower: 1.5 mg/kg/h IBW or 120 mg/h.' },
    contraindications: [
      { when: 'condition:regional_block_planned', severity: 'warn', message: 'Foo 2021: IV lidocaine should not be given concurrently with other local anaesthetic interventions (nerve blocks, wound infiltration) or while their effect is still active; separate by about 4 h.', sources: ['S1'] },
      { when: 'condition:liver_disease', severity: 'warn', message: 'Label: patients with severe hepatic disease, because of their inability to metabolize local anesthetics normally, are at greater risk of developing toxic plasma concentrations.', sources: ['S28'] },
      { when: 'condition:heart_block', severity: 'lock', message: 'Contraindicated (label CONTRAINDICATIONS, IV lidocaine): should not be used in patients with Stokes-Adams syndrome, Wolff-Parkinson-White syndrome, or with severe degrees of sinoatrial, atrioventricular or intraventricular block (the simulator heart-block condition is 2nd/3rd-degree block without a pacemaker).', sources: ['S28'] },
      { when: 'condition:wpw', severity: 'lock', message: 'Contraindicated (label CONTRAINDICATIONS, IV lidocaine, Fresenius Kabi label): should not be used in patients with Wolff-Parkinson-White syndrome.', sources: ['S28'] },
    ],
    timing: NOT_STATED(),
    pkModel: 'calibrated',
  },

  // ---------------- Neuromuscular blockers ----------------
  {
    id: 'rocuronium', name: 'Rocuronium', cls: 'nmb',
    concentration: null,
    amountUnit: 'mg',
    regimens: {
      induction: {
        kind: 'bolus',
        perKg: { default: 0.6, min: 0.6, max: 1.2 }, unit: 'mg/kg',
        scalar: 'TBW', scalarBasis: 'convention',
        timing: 'Intubating dose 0.6 mg/kg; rapid sequence 0.6–1.2 mg/kg.',
        sources: ['S12'],
        note: 'TBW is a simulator convention; the scalar statement in the label was not verified.',
      },
      maintenance: {
        kind: 'bolus',
        perKg: { default: 0.1, min: 0.1, max: 0.2 }, unit: 'mg/kg',
        scalar: 'TBW', scalarBasis: 'convention',
        timing: 'Guided by response to prior dose (older labels: at 25% recovery of T1).',
        sources: ['S12'],
      },
    },
    ceiling: null,
    contraindications: [
      { when: 'allergy:rocuronium', severity: 'lock', message: 'Contraindicated in patients known to have hypersensitivity (e.g., anaphylaxis) to rocuronium bromide or other neuromuscular blocking agents (label CONTRAINDICATIONS).', sources: ['S12'] },
    ],
    timing: { onsetMin: null, peakMin: 3, durationMin: 31, ranges: { durationMin: [15, 85] }, basis: 'label statement: 0.6 mg/kg — maximum blockade in most patients in less than 3 minutes (upper bound used); 31 (15–85) minutes clinical relaxation', defaultBolus: '0.6 mg/kg', sources: ['S12'] },
    pkModel: 'calibrated',
  },
  {
    id: 'succinylcholine', name: 'Succinylcholine', cls: 'nmb',
    concentration: { value: 20, unit: 'mg/mL' },
    amountUnit: 'mg',
    regimens: {
      induction: {
        kind: 'bolus',
        perKg: { default: 0.6, min: 0.3, max: 1.1 }, unit: 'mg/kg',
        scalar: 'TBW', scalarBasis: 'convention',
        timing: 'Average dose to facilitate tracheal intubation 0.6 mg/kg IV.',
        sources: ['S24'],
      },
    },
    ceiling: null,
    contraindications: [
      { when: 'condition:mh_susceptible', severity: 'lock', message: 'Contraindicated in patients with personal or familial history of malignant hyperthermia (label CONTRAINDICATIONS).', sources: ['S24'] },
      { when: 'condition:neuromuscular_disease', severity: 'lock', message: 'Contraindicated in patients with skeletal muscle myopathies (label CONTRAINDICATIONS).', sources: ['S24'] },
      { when: 'condition:recent_burn_or_denervation', severity: 'lock', message: 'Label: should not be used after the acute phase of injury following major burns, multiple trauma, extensive denervation of skeletal muscle, or upper motor neuron injury (risk of severe hyperkalemia; peaks 7–10 days after injury).', sources: ['S24'] },
      { when: 'condition:hyperkalemia', severity: 'lock', message: 'Label WARNINGS: succinylcholine can cause hyperkalemia leading to cardiac arrhythmias and arrest (boxed warning: hyperkalemic rhabdomyolysis). The label wording on pre-existing hyperkalemia was not retrieved; the simulator lock is a teaching-simulator policy.', sources: ['S24'] },
      { when: 'allergy:succinylcholine', severity: 'lock', message: 'Contraindicated in patients with known hypersensitivity to succinylcholine (label CONTRAINDICATIONS).', sources: ['S24'] },
    ],
    timing: { onsetMin: 1, peakMin: 2, durationMin: 5, ranges: { durationMin: [4, 6] }, basis: 'label statement: after 0.3–1.1 mg/kg IV, blockade develops in about 1 minute, maximum in about 2 minutes, recovery within 4 to 6 minutes (midpoint used)', defaultBolus: '0.6 mg/kg', sources: ['S24'] },
    pkModel: 'calibrated',
  },

  // ---------------- Reversal ----------------
  {
    id: 'sugammadex', name: 'Sugammadex', cls: 'reversal',
    concentration: null,
    amountUnit: 'mg',
    regimens: {
      emergence: {
        kind: 'bolus',
        perKg: { default: 2, min: 2, max: 16 }, unit: 'mg/kg',
        byDepth: [
          { depth: 'shallow', criterion: 'spontaneous recovery to reappearance of T2', perKg: 2 },
          { depth: 'deep', criterion: '1–2 post-tetanic counts, no TOF twitch', perKg: 4 },
          { depth: 'immediate', criterion: 'about 3 min after a single rocuronium 1.2 mg/kg', perKg: 16, afterRocuroniumPerKg: 1.2, withinMin: 3 },
        ],
        scalar: 'TBW', scalarBasis: 'label',
        timing: 'Single IV bolus; dose chosen by depth of block.',
        sources: ['S6', 'S5'],
        note: 'Label: dose on actual body weight. Thilen 2023: sugammadex preferred over neostigmine for deep, moderate and shallow block.',
      },
    },
    runtimeRules: [
      { id: 'dose_vs_block_depth', severity: 'warn', message: 'Label: sugammadex dose depends on depth of block — 2 mg/kg if spontaneous recovery has reached the reappearance of T2; 4 mg/kg if recovery has reached 1–2 post-tetanic counts with no twitch response to TOF; 16 mg/kg for reversal soon (about 3 min) after a single rocuronium dose of 1.2 mg/kg', sources: ['S6'] },
    ],
    ceiling: { value: 16, unit: 'mg/kg', basis: 'label range upper bound', sources: ['S6'], note: 'Highest labelled dose (immediate reversal); not called a maximum.' },
    contraindications: [
      { when: 'allergy:sugammadex', severity: 'lock', message: 'Contraindicated: known hypersensitivity to sugammadex or any of its components (label CONTRAINDICATIONS).', sources: ['S6'] },
    ],
    timing: NOT_STATED('Median recovery times verified only in non-US datasheets; not used.'),
    pkModel: 'calibrated',
  },
  {
    id: 'neostigmine', name: 'Neostigmine', cls: 'reversal',
    concentration: { value: 1, unit: 'mg/mL' },
    amountUnit: 'mg',
    regimens: {
      emergence: {
        kind: 'bolus',
        perKg: { default: 0.03, min: 0.03, max: 0.07 }, unit: 'mg/kg',
        scalar: 'TBW', scalarBasis: 'convention',
        timing: 'Give glycopyrrolate (or atropine) before or with neostigmine.',
        sources: ['S7', 'S5'],
        note: 'Label: 0.03 mg/kg for shorter half-life agents such as rocuronium. Thilen 2023: neostigmine reasonable only at minimal depth (TOFR 0.4 to <0.9).',
      },
    },
    runtimeRules: [
      { id: 'tof_depth_not_minimal', severity: 'warn', message: 'Thilen 2023: neostigmine is reasonable only at minimal depth of block (TOFR 0.4 to <0.9); sugammadex is recommended for deep, moderate and shallow block.', sources: ['S5'] },
    ],
    ceiling: { value: 5, unit: 'mg', basis: 'label maximum', perKg: { value: 0.07, unit: 'mg/kg' }, rule: 'lesser of', sources: ['S7'] },
    contraindications: [
      { when: 'allergy:neostigmine', severity: 'lock', message: 'Contraindicated: hypersensitivity to neostigmine (label CONTRAINDICATIONS).', sources: ['S7'] },
      { when: 'condition:bowel_or_urinary_obstruction', severity: 'lock', message: 'Contraindicated: peritonitis or mechanical obstruction of the intestinal or urinary tract (label CONTRAINDICATIONS).', sources: ['S7'] },
    ],
    timing: { onsetMin: null, peakMin: 15, durationMin: null, ranges: { peakMin: [10, 20] }, basis: 'label statement: 0.03–0.07 mg/kg will generally achieve TOF0.9 within 10 to 20 minutes (midpoint used)', defaultBolus: '0.03 mg/kg', sources: ['S7'] },
    pkModel: 'calibrated',
  },

  // ---------------- Anticholinergic ----------------
  {
    id: 'glycopyrrolate', name: 'Glycopyrrolate', cls: 'anticholinergic',
    concentration: null,
    amountUnit: 'mg',
    regimens: {
      emergence: {
        kind: 'bolus',
        ratioTo: { drugId: 'neostigmine', mgPerMg: 0.2 },
        fixed: { default: 0.2, min: 0.2, max: 1, unit: 'mg' },
        scalar: null, scalarBasis: null,
        timing: 'With neostigmine: 0.2 mg glycopyrrolate for each 1 mg neostigmine.',
        sources: ['S8'],
        note: 'Engine should compute 0.2 × neostigmine mg; fixed range is that ratio applied to 1–5 mg neostigmine (label 5 mg neostigmine maximum, S7).',
      },
      rescue: {
        kind: 'bolus',
        fixed: { default: 0.1, min: 0.1, max: 0.1, unit: 'mg' },
        scalar: null, scalarBasis: null,
        timing: 'Intraoperative: 0.1 mg IV, repeated as needed at 2–3 minute intervals.',
        sources: ['S8'],
      },
    },
    ceiling: null,
    contraindications: [],
    timing: NOT_STATED(),
    pkModel: 'calibrated',
  },

  // ---------------- Antiemetics ----------------
  {
    id: 'dexamethasone', name: 'Dexamethasone', cls: 'antiemetic',
    concentration: { value: 4, unit: 'mg/mL' },
    amountUnit: 'mg',
    regimens: {
      induction: {
        kind: 'bolus',
        fixed: { default: 4, min: 4, max: 8, unit: 'mg' },
        scalar: null, scalarBasis: null,
        timing: 'PONV prophylaxis given at induction (early), per consensus.',
        sources: ['S3', 'S2'],
        note: 'Given at induction for PONV prophylaxis per consensus guidance [S2][S3]; 8 mg may be optimal (S3).',
      },
    },
    ceiling: null,
    contraindications: [
      { when: 'condition:systemic_fungal_infection', severity: 'lock', message: 'Contraindicated: systemic fungal infections (label CONTRAINDICATIONS; see WARNINGS regarding amphotericin B).', sources: ['S30'] },
      { when: 'allergy:dexamethasone', severity: 'lock', message: 'Contraindicated: hypersensitivity to any component of this product (label CONTRAINDICATIONS).', sources: ['S30'] },
    ],
    timing: NOT_STATED(),
    pkModel: 'calibrated',
  },
  {
    id: 'ondansetron', name: 'Ondansetron', cls: 'antiemetic',
    concentration: null,
    amountUnit: 'mg',
    regimens: {
      emergence: {
        kind: 'bolus',
        fixed: { default: 4, min: 4, max: 4, unit: 'mg' },
        scalar: null, scalarBasis: null,
        timing: 'At end of surgery.',
        sources: ['S3', 'S2'],
      },
    },
    ceiling: null,
    contraindications: [
      { when: 'medication:apomorphine', severity: 'lock', message: 'The concomitant use of apomorphine with ondansetron is contraindicated based on reports of profound hypotension and loss of consciousness (label CONTRAINDICATIONS).', sources: ['S29'] },
      { when: 'allergy:ondansetron', severity: 'lock', message: 'Contraindicated for patients known to have hypersensitivity (e.g., anaphylaxis) to this product or any of its components (label CONTRAINDICATIONS).', sources: ['S29'] },
    ],
    timing: NOT_STATED(),
    pkModel: 'calibrated',
  },

  // ---------------- Vasopressors ----------------
  {
    id: 'phenylephrine', name: 'Phenylephrine', cls: 'vasopressor',
    concentration: { value: 100, unit: 'mcg/mL' },
    amountUnit: 'mcg',
    regimens: {
      rescue: {
        kind: 'bolus',
        fixed: { default: 40, min: 40, max: 100, unit: 'mcg' },
        scalar: null, scalarBasis: null,
        timing: 'Additional boluses every 1–2 min as needed; not to exceed a total dosage of 200 mcg (2019 label wording; the simulator applies this conservative cumulative reading).',
        sources: ['S18'],
      },
      maintenance: {
        kind: 'infusion',
        rate: { default: 10, min: 10, max: 35, unit: 'mcg/min', hardMax: 200 },
        scalar: null, scalarBasis: null,
        timing: 'Infusion 10–35 mcg/min titrated; not exceeding 200 mcg/min.',
        sources: ['S18'],
      },
    },
    ceiling: { value: 200, unit: 'mcg', scope: 'cumulative boluses', basis: 'label maximum', infusion: { value: 200, unit: 'mcg/min' }, sources: ['S18'],
      note: 'The FDA-hosted 2019 Biorphen label reads "not to exceed a total dosage of 200 mcg" for IV boluses; some later label copies read "additional boluses up to 200 mcg". The simulator applies the conservative reading: all phenylephrine boluses in the session together may not exceed 200 mcg. The infusion limit (200 mcg/min) is separate.' },
    contraindications: [],
    timing: NOT_STATED('Label: onset of BP increase after IV bolus is rapid, typically within minutes (no number).'),
    pkModel: 'calibrated',
  },
  {
    id: 'ephedrine', name: 'Ephedrine', cls: 'vasopressor',
    concentration: null,
    amountUnit: 'mg',
    regimens: {
      rescue: {
        kind: 'bolus',
        fixed: { default: 5, min: 5, max: 10, unit: 'mg' },
        scalar: null, scalarBasis: null,
        timing: 'IV bolus as needed; tachyphylaxis possible.',
        sources: ['S19'],
      },
    },
    ceiling: { value: 50, unit: 'mg', scope: 'cumulative', basis: 'label maximum', sources: ['S19'] },
    contraindications: [],
    timing: NOT_STATED(),
    pkModel: 'calibrated',
  },
  {
    // Added 2026-11-05. IM anaphylaxis dose from the FDA label (rescue). 2026-11 audit: IV bolus
    // for perioperative anaphylaxis in an anaesthetised, monitored patient from UK perioperative
    // guidance (rescue_iv; AAGBI 2009 / RCUK perioperative algorithm) — a guideline dose, not a
    // label dose. A bolus without a route is intramuscular (first entry of bolusRoutes).
    id: 'epinephrine', name: 'Epinephrine', cls: 'vasopressor',
    concentration: { value: 1, unit: 'mg/mL' },
    amountUnit: 'mg',
    bolusRoutes: ['IM', 'SC', 'IV'],
    routeBolusMax: { IV: { value: 0.05, unit: 'mg', basis: 'guideline IV titration dose used as a per-bolus stop (simulator policy)', sources: ['S44', 'S45'] } },
    pkReferenceRegimen: 'maintenance',
    regimens: {
      rescue: {
        kind: 'bolus', route: 'IM',
        fixed: { default: 0.3, min: 0.3, max: 0.5, unit: 'mg' },
        scalar: null, scalarBasis: null,
        timing: 'Anaphylaxis: undiluted, intramuscularly (or subcutaneously) into the anterolateral aspect of the thigh; repeat every 5 to 10 minutes as necessary; up to 0.5 mg per injection. Do not inject into buttock, digits, hands or feet.',
        sources: ['S40'],
        note: 'Label dose for anaphylaxis in adults and children over 30 kg (the simulator models adults only). Default = label lower bound. Monitor clinically for reaction severity and cardiac effects. Contains sodium bisulfite; presence of sulfite should not deter use for anaphylaxis. The simulator models the IM route with an illustrative absorption constant (slower when MAP is very low). For an anaesthetised, monitored patient with IV access, see the rescue_iv regimen (guideline IV titration dose).',
      },
      rescue_iv: {
        kind: 'bolus', route: 'IV',
        fixed: { default: 0.05, min: 0.05, max: 0.05, unit: 'mg' },
        scalar: null, scalarBasis: null,
        timing: 'Perioperative anaphylaxis in an anaesthetised, monitored adult with IV access: 50 micrograms IV (0.5 mL of 1:10 000), titrated to effect; several doses may be required for severe hypotension or bronchospasm; if several doses are needed, consider an IV adrenaline infusion. Specialist use (anaesthetists/intensivists).',
        sources: ['S44', 'S45'],
        note: 'UK perioperative-anaphylaxis guideline dose (AAGBI 2009; RCUK perioperative algorithm), not an FDA label dose: the US label gives no IV bolus dose for anaphylaxis. IV epinephrine is for experienced specialists in a monitored setting only. Each IV bolus is capped at this 0.05 mg titration step in the simulator (policy); repeat as needed.',
      },
      maintenance: {
        kind: 'infusion',
        rate: { default: 0.05, min: 0.05, max: 2, unit: 'mcg/kg/min' },
        scalar: 'IBW', scalarBasis: 'label',
        timing: 'Dilute 1 mg in 1000 mL 5% dextrose (1 mcg/mL); infuse into a large vein. Titrate to the desired MAP; adjust e.g. every 10 to 15 minutes in increments of 0.05 to 0.2 mcg/kg/min; wean gradually after stabilisation.',
        sources: ['S40', 'S41'],
        note: 'Labelled indication: hypotension associated with septic shock (the simulator lets it be used for any hypotension for teaching; outside septic shock that is not the labelled indication). Weight = ideal body weight per the 215425 label (S41). Default = label lower bound.',
      },
    },
    ceiling: { value: 0.5, unit: 'mg', scope: 'per bolus', basis: 'label maximum', infusion: { value: 2, unit: 'mcg/kg/min', scalar: 'IBW', basis: 'label range upper bound' }, sources: ['S40', 'S41'],
      note: '0.5 mg per injection is a stated label maximum (anaphylaxis). The 2 mcg/kg/min infusion stop is the top of the labelled septic-shock range, which the label does not call a maximum.' },
    contraindications: [
      { when: 'condition:cad', severity: 'warn', message: 'Label WARNINGS: epinephrine may induce cardiac arrhythmias and myocardial ischemia in patients, especially patients suffering from coronary artery disease, or cardiomyopathy. (Label contraindications: none.)', sources: ['S40'] },
      { when: 'condition:hf_reduced_ef', severity: 'warn', message: 'Label WARNINGS: epinephrine may induce cardiac arrhythmias and myocardial ischemia, especially in patients with coronary artery disease or cardiomyopathy. (The simulator maps cardiomyopathy to heart failure with reduced EF as policy; label contraindications: none.)', sources: ['S40'] },
    ],
    timing: NOT_STATED('No label onset/peak/duration statement verified. Engine uses illustrative author-estimate constants (engine/pk.js ILLUSTRATIVE_PK.epinephrine; IM absorption ROUTE_KA_ILLUSTRATIVE).'),
    pkModel: 'calibrated',
  },

  // ---------------- Opioid antagonist ----------------
  {
    id: 'naloxone', name: 'Naloxone', cls: 'reversal',
    concentration: null,
    amountUnit: 'mg',
    regimens: {
      rescue: {
        kind: 'bolus',
        fixed: { default: 0.1, min: 0.1, max: 0.2, unit: 'mg' },
        scalar: null, scalarBasis: null,
        timing: 'IV at 2–3 min intervals to desired reversal; repeat doses may be needed at 1–2 h intervals.',
        sources: ['S14'],
        note: 'Larger doses can reverse analgesia and raise blood pressure.',
      },
    },
    ceiling: null,
    contraindications: [],
    timing: { onsetMin: 2, peakMin: null, durationMin: null, basis: 'label statement: IV onset of action generally apparent within two minutes; duration depends on dose and route', defaultBolus: '0.1 mg', sources: ['S14'] },
    pkModel: 'calibrated',
  },

  // ---------------- Non-opioid analgesics ----------------
  {
    id: 'ketorolac', name: 'Ketorolac', cls: 'nsaid',
    concentration: null,
    amountUnit: 'mg',
    regimens: {
      rescue: {
        kind: 'bolus',
        fixed: { default: 30, min: 30, max: 30, unit: 'mg' },
        scalar: null, scalarBasis: null,
        adjust: [{ when: 'flag:elderly|flag:ckd|weight<50', fixed: { default: 15, min: 15, max: 15, unit: 'mg' }, note: 'Label: ≥65 years, renally impaired or <50 kg: 15 mg every 6 h, maximum 60 mg/day.', sources: ['S15'] }],
        timing: 'Every 6 h; combined IV/IM and oral use not to exceed 5 days.',
        sources: ['S15'],
      },
    },
    ceiling: { value: 120, unit: 'mg/day', basis: 'label maximum', adjusted: { when: 'flag:elderly|flag:ckd|weight<50', value: 60, unit: 'mg/day' }, sources: ['S15'] },
    contraindications: [
      { when: 'egfr<30', severity: 'lock', message: 'Contraindicated in patients with advanced renal impairment (label CONTRAINDICATIONS). eGFR <30 threshold mirrors the Smart NOA controller (config.yaml); the label gives no eGFR number.', sources: ['S15', 'S35'] },
      { when: 'condition:hypovolemia', severity: 'lock', message: 'Contraindicated in patients at risk for renal failure due to volume depletion (label CONTRAINDICATIONS).', sources: ['S15'] },
      { when: 'allergy:nsaid', severity: 'lock', message: 'Contraindicated in patients with hypersensitivity to ketorolac and in patients with allergic reactions (asthma, urticaria or allergic-type reactions) to aspirin or other NSAIDs (label CONTRAINDICATIONS).', sources: ['S15'] },
      { when: 'medication:nsaid_aspirin', severity: 'lock', message: 'Contraindicated in patients currently receiving aspirin or NSAIDs because of the cumulative risk of serious NSAID-related side effects (label CONTRAINDICATIONS).', sources: ['S15'] },
      { when: 'condition:bleeding_risk', severity: 'lock', message: 'Ketorolac tromethamine inhibits platelet function and is, therefore, contraindicated in patients with suspected or confirmed cerebrovascular bleeding, hemorrhagic diathesis, incomplete hemostasis and those at high risk of bleeding (label CONTRAINDICATIONS).', sources: ['S15'] },
      { when: 'condition:peptic_ulcer_gi_bleed', severity: 'lock', message: 'Contraindicated in patients with active peptic ulcer disease and in patients with recent gastrointestinal bleeding or perforation (label CONTRAINDICATIONS).', sources: ['S15'] },
    ],
    runtimeRules: [
      { id: 'prophylactic_before_major_surgery', severity: 'warn', surgery: 'before', planPhases: ['premed', 'induction', 'sedation'], message: 'Label CONTRAINDICATIONS: ketorolac is contraindicated as a prophylactic analgesic before any major surgery.', sources: ['S15'] },
      { id: 'perioperative_hemostasis', severity: 'warn', surgery: 'during', planPhases: ['maintenance'], message: 'Label WARNINGS (hemorrhage): peri-operative use of ketorolac should be avoided, and postoperative use undertaken with caution, when hemostasis is critical, because of the increased risk of bleeding.', sources: ['S15'] },
    ],
    timing: NOT_STATED(),
    pkModel: 'calibrated',
  },
  {
    id: 'acetaminophen', name: 'Acetaminophen (IV)', cls: 'analgesic',
    concentration: null,
    amountUnit: 'mg',
    regimens: {
      rescue: {
        kind: 'bolus',
        fixed: { default: 1000, min: 650, max: 1000, unit: 'mg' },
        scalar: null, scalarBasis: null,
        adjust: [{ when: 'weight<50', perKg: { default: 15, min: 12.5, max: 15 }, unit: 'mg/kg', note: 'Label: adults <50 kg 15 mg/kg every 6 h or 12.5 mg/kg every 4 h; maximum single dose 15 mg/kg up to 750 mg; maximum 75 mg/kg per 24 h up to 3750 mg.', sources: ['S16'] }],
        timing: '1000 mg every 6 h or 650 mg every 4 h; minimum interval 4 h.',
        sources: ['S16'],
      },
    },
    ceiling: { value: 4000, unit: 'mg/day', basis: 'label maximum', perDose: { value: 1000, unit: 'mg' },
      adjusted: { when: 'weight<50', perKg: 75, unit: 'mg/kg/day', value: 3750, valueUnit: 'mg/day', perDose: { value: 750, unit: 'mg' } }, sources: ['S16'],
      note: 'Counts all routes and all acetaminophen-containing products. Adults ≥50 kg: maximum single dose 1000 mg, 4000 mg/day. Adults <50 kg: maximum single dose 15 mg/kg up to 750 mg; maximum 75 mg/kg per 24 h up to 3750 mg (lesser applies).' },
    contraindications: [
      { when: 'condition:severe_hepatic_impairment', severity: 'lock', message: 'Contraindicated in patients with severe hepatic impairment (label CONTRAINDICATIONS).', sources: ['S16'] },
      { when: 'condition:liver_disease', severity: 'warn', message: 'Label: use caution in hepatic impairment, chronic alcohol use, malnutrition or hypovolemia.', sources: ['S16'] },
      { when: 'condition:hypovolemia', severity: 'warn', message: 'Label: use caution in hypovolemia.', sources: ['S16'] },
    ],
    timing: NOT_STATED(),
    pkModel: 'calibrated',
  },
];

// Every S-id referenced anywhere above (regimens, adjust, ceilings, contraindications, timing,
// runtime rules, MAC model). Kept frozen; tests check it matches the actual references.
export const SOURCE_IDS_USED = Object.freeze([
  'S1', 'S2', 'S3', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16',
  'S17', 'S18', 'S19', 'S23', 'S24', 'S25', 'S26', 'S27', 'S28', 'S29', 'S30', 'S35', 'S36', 'S37', 'S38', 'S39',
  'S40', 'S41', 'S42', 'S44', 'S45',
]);

// S-ids present for the engine/UI (scores, weight scalars, monitoring, sedation definitions) but
// not referenced by a drug entry.
export const SOURCE_IDS_ENGINE = Object.freeze({
  apfel: 'S4', stopBang: 'S20', stopBangRisk: 'S21', monitoring: 'S22',
  sedationContinuum: 'S31', moderateSedationGuideline: 'S32', ibwDevine: 'S33', lbwJanmahasatian: 'S34',
  tofExtubation: 'S5', pythonConfig: 'S35',
  propofolPk: 'S42', sepsisFluids: 'S43',
  prophylaxis: 'S46', fluidLactatedRingers: 'S47', fluidSaline: 'S48', pofaTrial: 'S49', smartTrial: 'S50', propofolPainMeta: 'S51',
  depthBandBUnaware: 'S52', depthBandBagRecall: 'S53', whoChecklist: 'S54',
  preoxygenationDas2015: 'S55', difficultAirwayAsa2022: 'S56',
});

// Palliative / end-of-life module sources (S100+; data/palliative.js). Merged here so the Sources
// panel and source tags resolve them; they are used by the palliative modules, not by DRUGS.
Object.assign(SOURCES, PALLIATIVE_SOURCES);
