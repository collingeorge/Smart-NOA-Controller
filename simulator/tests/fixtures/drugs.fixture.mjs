// =============================================================================
// TEST FIXTURE — NOT CLINICAL DATA. NOT A DRUG REFERENCE. DO NOT DISPLAY IN UI.
// -----------------------------------------------------------------------------
// A small library that conforms to the data/drugs.js schema (SPEC §4) so the
// engine tests can run independently of the real, sourced library. Every
// number below is a placeholder chosen only to exercise engine code paths;
// the single source "SFX" is a fake citation that exists only for tests.
// The real, sourced values live in simulator/data/drugs.js.
// =============================================================================

const SRC = ['SFX'];
const FX = 'TEST FIXTURE placeholder — not clinical data';

export const SOURCES = {
  SFX: { id: 'SFX', citation: 'TEST FIXTURE — placeholder citation (not a real source).', url: '', identifiers: '', verifiedVia: 'not applicable (test fixture)', supports: 'engine unit tests only' },
};

export const CONDITIONS = [
  { id: 'heart_block', label: '2nd/3rd-degree heart block (no pacemaker)' },
  { id: 'mh_susceptible', label: 'Malignant hyperthermia susceptible' },
  { id: 'hyperkalemia', label: 'Hyperkalemia' },
  { id: 'cad', label: 'Coronary artery disease' },
  { id: 'hypertension', label: 'Hypertension' },
  { id: 'osa', label: 'Obstructive sleep apnea' },
  { id: 'gerd', label: 'GERD / reflux' },
  { id: 'liver_disease', label: 'Liver disease' },
  { id: 'hypovolemia', label: 'Hypovolemia' },
  { id: 'psychosis_history', label: 'History of psychosis' },
  { id: 'regional_block_planned', label: 'Regional block planned' },
];

export const ALLERGIES = [
  { id: 'nsaid', label: 'NSAID / aspirin' },
  { id: 'propofol', label: 'Propofol' },
  { id: 'rocuronium', label: 'Rocuronium' },
  { id: 'sugammadex', label: 'Sugammadex' },
];

export const MEDICATIONS = [
  { id: 'beta_blocker', label: 'Beta-blocker' },
  { id: 'maoi', label: 'MAO inhibitor' },
];

const t = (onsetMin, peakMin, durationMin) => ({ onsetMin, peakMin, durationMin, basis: FX, sources: SRC });

export const DRUGS = [
  {
    id: 'propofol', name: 'Propofol', cls: 'hypnotic', concentration: { value: 10, unit: 'mg/mL' }, amountUnit: 'mg',
    regimens: {
      sedation_moderate: { kind: 'infusion', rate: { default: 50, min: 25, max: 75, unit: 'mcg/kg/min' }, scalar: 'TBW', sources: SRC, note: FX },
      induction: { kind: 'bolus', perKg: { default: 2, min: 1.5, max: 2.5 }, unit: 'mg/kg', scalar: 'LBW', timing: 'over 30 s (fixture)', sources: SRC, note: FX,
        adjust: [{ when: 'elderly|asa>=3', perKg: { default: 1.25, min: 1, max: 1.5 }, note: FX, sources: SRC }] },
      maintenance: { kind: 'infusion', rate: { default: 100, min: 50, max: 200, unit: 'mcg/kg/min' }, scalar: 'TBW', sources: SRC, note: FX },
    },
    ceiling: { value: 250, unit: 'mcg/kg/min', basis: 'label maximum', sources: SRC },
    contraindications: [{ when: 'allergy:propofol', severity: 'lock', message: FX, sources: SRC }],
    timing: t(0.5, 1.5, 6), pkModel: 'marsh',
  },
  {
    id: 'fentanyl', name: 'Fentanyl', cls: 'opioid', concentration: { value: 50, unit: 'mcg/mL' }, amountUnit: 'mcg',
    regimens: {
      sedation_moderate: { kind: 'bolus', fixed: { default: 25, min: 25, max: 50, unit: 'mcg' }, sources: SRC, note: FX },
      induction: { kind: 'bolus', perKg: { default: 1.5, min: 1, max: 2 }, unit: 'mcg/kg', scalar: 'LBW', sources: SRC, note: FX },
      maintenance: { kind: 'bolus', fixed: { default: 25, min: 25, max: 50, unit: 'mcg' }, sources: SRC, note: FX },
    },
    ceiling: null, contraindications: [], timing: t(1.5, 4, 40), pkModel: 'calibrated',
  },
  {
    id: 'midazolam', name: 'Midazolam', cls: 'benzodiazepine', concentration: { value: 1, unit: 'mg/mL' }, amountUnit: 'mg',
    regimens: {
      premed: { kind: 'bolus', fixed: { default: 1, min: 0.5, max: 2, unit: 'mg' }, sources: SRC, note: FX },
      sedation_moderate: { kind: 'bolus', fixed: { default: 2, min: 1, max: 2.5, unit: 'mg' }, sources: SRC, note: FX,
        adjust: [{ when: 'elderly', fixed: { default: 1, min: 0.5, max: 1.5, unit: 'mg' }, note: FX, sources: SRC }] },
    },
    ceiling: { value: 5, unit: 'mg', basis: 'label maximum', sources: SRC }, contraindications: [], timing: t(2, 4, 45), pkModel: 'calibrated',
  },
  {
    id: 'dexmedetomidine', name: 'Dexmedetomidine', cls: 'alpha2', concentration: { value: 4, unit: 'mcg/mL' }, amountUnit: 'mcg',
    regimens: {
      sedation_moderate: { kind: 'infusion', rate: { default: 0.5, min: 0.2, max: 1, unit: 'mcg/kg/h' }, scalar: 'TBW', sources: SRC, note: FX },
      maintenance: { kind: 'infusion', rate: { default: 0.4, min: 0.2, max: 0.7, unit: 'mcg/kg/h' }, scalar: 'TBW', sources: SRC, note: FX },
    },
    ceiling: { value: 1.5, unit: 'mcg/kg/h', basis: 'label maximum', sources: SRC },
    contraindications: [{ when: 'condition:heart_block', severity: 'lock', message: FX, sources: SRC }],
    timing: t(10, 20, 120), pkModel: 'calibrated',
  },
  {
    id: 'ketamine', name: 'Ketamine', cls: 'nmda', concentration: { value: 10, unit: 'mg/mL' }, amountUnit: 'mg',
    regimens: {
      induction: { kind: 'bolus', perKg: { default: 1, min: 0.5, max: 2 }, unit: 'mg/kg', scalar: 'TBW', sources: SRC, note: FX },
      maintenance: { kind: 'infusion', rate: { default: 0.15, min: 0.1, max: 0.2, unit: 'mg/kg/h' }, scalar: 'IBW', sources: SRC, note: FX },
    },
    ceiling: null,
    contraindications: [{ when: 'condition:psychosis_history', severity: 'warn', message: FX, sources: SRC }],
    timing: t(0.5, 1, 12), pkModel: 'calibrated',
  },
  {
    id: 'lidocaine', name: 'Lidocaine', cls: 'local', concentration: { value: 20, unit: 'mg/mL' }, amountUnit: 'mg',
    regimens: {
      induction: { kind: 'bolus', perKg: { default: 1.5, min: 1, max: 1.5 }, unit: 'mg/kg', scalar: 'IBW', sources: SRC, note: FX },
      maintenance: { kind: 'infusion', rate: { default: 1.5, min: 0.5, max: 1.5, unit: 'mg/kg/h' }, scalar: 'IBW', sources: SRC, note: FX },
    },
    ceiling: { value: 120, unit: 'mg/h', basis: 'guideline maximum', sources: SRC },
    contraindications: [
      { when: 'condition:regional_block_planned', severity: 'warn', message: FX, sources: SRC },
      { when: 'condition:heart_block', severity: 'warn', message: FX, sources: SRC },
    ],
    timing: t(1, 3, 20), pkModel: 'calibrated',
  },
  {
    id: 'rocuronium', name: 'Rocuronium', cls: 'nmb', concentration: { value: 10, unit: 'mg/mL' }, amountUnit: 'mg',
    regimens: {
      induction: { kind: 'bolus', perKg: { default: 0.6, min: 0.6, max: 1.2 }, unit: 'mg/kg', scalar: 'IBW', sources: SRC, note: FX },
      maintenance: { kind: 'bolus', perKg: { default: 0.15, min: 0.1, max: 0.2 }, unit: 'mg/kg', scalar: 'IBW', sources: SRC, note: FX },
    },
    ceiling: null,
    contraindications: [{ when: 'allergy:rocuronium', severity: 'lock', message: FX, sources: SRC }],
    timing: t(1.5, 2, 35), pkModel: 'calibrated',
  },
  {
    id: 'succinylcholine', name: 'Succinylcholine', cls: 'nmb', concentration: { value: 20, unit: 'mg/mL' }, amountUnit: 'mg',
    regimens: { induction: { kind: 'bolus', perKg: { default: 1, min: 0.6, max: 1.5 }, unit: 'mg/kg', scalar: 'TBW', sources: SRC, note: FX } },
    ceiling: null,
    contraindications: [
      { when: 'condition:mh_susceptible', severity: 'lock', message: FX, sources: SRC },
      { when: 'condition:hyperkalemia', severity: 'lock', message: FX, sources: SRC },
    ],
    timing: t(0.75, 1, 8), pkModel: 'calibrated',
  },
  {
    id: 'sevoflurane', name: 'Sevoflurane', cls: 'volatile', concentration: null, amountUnit: '%', mac40: 2.0,
    regimens: { maintenance: { kind: 'inhaled', rate: { default: 2, min: 1, max: 3, unit: '%' }, sources: SRC, note: FX } },
    ceiling: { value: 8, unit: '%', basis: 'label maximum', sources: SRC },
    contraindications: [{ when: 'condition:mh_susceptible', severity: 'lock', message: FX, sources: SRC }],
    timing: null, pkModel: 'calibrated',
  },
  {
    id: 'sugammadex', name: 'Sugammadex', cls: 'reversal', concentration: { value: 100, unit: 'mg/mL' }, amountUnit: 'mg',
    regimens: { emergence: { kind: 'bolus', perKg: { default: 2, min: 2, max: 4 }, unit: 'mg/kg', scalar: 'TBW', sources: SRC, note: FX } },
    ceiling: null,
    contraindications: [{ when: 'allergy:sugammadex', severity: 'lock', message: FX, sources: SRC }],
    timing: t(1, 2, 120), pkModel: 'calibrated',
  },
  {
    id: 'neostigmine', name: 'Neostigmine', cls: 'reversal', concentration: { value: 1, unit: 'mg/mL' }, amountUnit: 'mg',
    regimens: { emergence: { kind: 'bolus', perKg: { default: 0.04, min: 0.03, max: 0.05 }, unit: 'mg/kg', scalar: 'TBW', sources: SRC, note: FX } },
    ceiling: { value: 5, unit: 'mg', basis: 'label maximum', sources: SRC },
    contraindications: [], timing: t(3, 8, 60), pkModel: 'calibrated',
  },
  {
    id: 'glycopyrrolate', name: 'Glycopyrrolate', cls: 'anticholinergic', concentration: { value: 0.2, unit: 'mg/mL' }, amountUnit: 'mg',
    regimens: { rescue: { kind: 'bolus', fixed: { default: 0.2, min: 0.1, max: 0.4, unit: 'mg' }, sources: SRC, note: FX } },
    ceiling: null, contraindications: [], timing: t(1, 3, 60), pkModel: 'calibrated',
  },
  {
    id: 'phenylephrine', name: 'Phenylephrine', cls: 'vasopressor', concentration: { value: 100, unit: 'mcg/mL' }, amountUnit: 'mcg',
    regimens: { rescue: { kind: 'bolus', fixed: { default: 100, min: 50, max: 200, unit: 'mcg' }, sources: SRC, note: FX } },
    ceiling: null, contraindications: [], timing: t(0.5, 1, 10), pkModel: 'calibrated',
  },
  {
    id: 'ketorolac', name: 'Ketorolac', cls: 'nsaid', concentration: { value: 30, unit: 'mg/mL' }, amountUnit: 'mg',
    regimens: { emergence: { kind: 'bolus', fixed: { default: 15, min: 15, max: 30, unit: 'mg' }, sources: SRC, note: FX,
      adjust: [{ when: 'age>=65', fixed: { default: 15, min: 15, max: 15, unit: 'mg' }, note: FX, sources: SRC }] } },
    ceiling: { value: 120, unit: 'mg', basis: 'label maximum', sources: SRC },
    contraindications: [
      { when: 'egfr<30', severity: 'lock', message: FX, sources: SRC },
      { when: 'allergy:nsaid', severity: 'lock', message: FX, sources: SRC },
    ],
    timing: t(10, 45, 360), pkModel: 'calibrated',
  },
  {
    id: 'ondansetron', name: 'Ondansetron', cls: 'antiemetic', concentration: { value: 2, unit: 'mg/mL' }, amountUnit: 'mg',
    regimens: { emergence: { kind: 'bolus', fixed: { default: 4, min: 4, max: 4, unit: 'mg' }, sources: SRC, note: FX } },
    ceiling: null, contraindications: [], timing: null, pkModel: 'calibrated',
  },
];
