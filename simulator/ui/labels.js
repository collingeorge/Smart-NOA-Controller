// Human-readable labels used across the UI.

export const CLASS_LABELS = {
  hypnotic: 'Hypnotics', benzodiazepine: 'Benzodiazepines', alpha2: 'Alpha-2 agonists', nmda: 'NMDA antagonists',
  opioid: 'Opioids', local: 'Local anaesthetics (IV)', nmb: 'Neuromuscular blockers', reversal: 'Reversal agents',
  anticholinergic: 'Anticholinergics', antiemetic: 'Antiemetics', vasopressor: 'Vasopressors', volatile: 'Volatile agents',
  gas: 'Anaesthetic gases', nsaid: 'NSAIDs', analgesic: 'Analgesics', antibiotic: 'Antibiotic prophylaxis',
};
export const CLASS_ORDER = ['hypnotic', 'volatile', 'gas', 'benzodiazepine', 'alpha2', 'nmda', 'opioid', 'local', 'nmb', 'reversal', 'anticholinergic', 'antiemetic', 'vasopressor', 'nsaid', 'analgesic'];

export const CONDITION_GROUPS = [
  ['cardiovascular', 'Cardiovascular'],
  ['respiratory', 'Respiratory'],
  ['renal_hepatic', 'Renal / hepatic / abdominal'],
  ['neuro_psych', 'Neurological / psychiatric / neuromuscular'],
  ['metabolic_other', 'Metabolic / other'],
  ['anesthesia_specific', 'Anaesthesia-specific'],
];

export const FLAG_LABELS = {
  elderly: 'Elderly (age ≥ 65 y)',
  underweight: 'Underweight (BMI < 18.5)',
  obese: 'Obese (BMI ≥ 30)',
  morbidObese: 'Severe obesity (BMI ≥ 40)',
  ckd: 'Reduced renal function (eGFR < 60)',
  severeCkd: 'Severely reduced renal function (eGFR < 30)',
  asa3plus: 'ASA physical status ≥ 3',
  aspirationRisk: 'Aspiration risk (emergency / reflux / obstruction)',
  difficultAirwayPredicted: 'Difficult airway predicted',
  osaRisk: 'OSA or high STOP-Bang risk',
  highPonvRisk: 'High PONV risk (Apfel ≥ 3)',
  mhSusceptible: 'Malignant hyperthermia susceptible',
  betaBlocker: 'Taking a beta-blocker (blunted HR response, illustrative)',
};

export const PHASE_LABELS = {
  premed: 'Premedication', sedation: 'Sedation', induction: 'Induction', maintenance: 'Maintenance', emergence: 'Emergence / extubation',
};
export const PHASE_LABELS_MAC = { ...PHASE_LABELS, emergence: 'End of procedure / recovery' };

export const REGIMEN_LABELS = {
  premed: 'premedication', sedation_minimal: 'minimal sedation', sedation_moderate: 'moderate sedation', sedation_deep: 'deep sedation',
  induction: 'induction', maintenance: 'maintenance', emergence: 'emergence', rescue: 'rescue / as needed', rescue_iv: 'rescue IV bolus (guideline)',
  pretreatment: 'pretreatment before propofol (label)', prophylaxis: 'surgical prophylaxis (guideline)',
};

export const KIND_LABELS = { bolus: 'Bolus', infusion: 'Infusion', inhaled: 'Inhaled (dial %)', stop: 'Stop', fluid: 'Fluid maintenance (mL/h)', fluid_bolus: 'Fluid bolus', antibiotic: 'Antibiotic prophylaxis' };

export const SCALAR_LABELS = { TBW: 'total body weight', IBW: 'ideal body weight (Devine)', LBW: 'lean body weight (Janmahasatian)', ABW: 'adjusted body weight' };

export const PRIORITY_LABELS = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };
export const PRIORITY_SHAPES = { high: '!!!', medium: '!!', low: '!' };

export const INTERLOCK_TEXT = {
  GREEN: 'GREEN — no interlock action',
  RED: 'RED — fault or threshold breach; the affected controlled infusions are zeroed (all three on an unusable sensor reading)',
  HOLD: 'HOLD — latched; held infusions stay at zero (release with “Resume hold” after reviewing the cause; nothing restarts automatically)',
  DISABLED: 'DISABLED — Smart NOA rules off (label ceilings and lockouts still apply)',
  INITIALIZING: 'INITIALIZING — waiting for first monitor reading',
};

/** Out-of-scope items; library/engine features present at runtime are left out automatically. */
export function notModeled(lib, { fluids = false } = {}) {
  const hasEpi = (lib.DRUGS || []).some((d) => d.id === 'epinephrine');
  return ['Pregnancy', 'Paediatric patients (under 18 y)', 'Cardiopulmonary bypass / cardiac surgery', 'Neuraxial and regional anaesthesia techniques',
    fluids ? 'Blood products, temperature, electrolytes and acid-base (fluid type changes volume only)' : 'Fluids, blood products, temperature and electrolytes',
    'Antibiotic pharmacology and infection outcomes (prophylaxis timing only)', 'Propofol injection pain (teaching note only)',
    hasEpi ? 'Bronchodilators' : 'Epinephrine and bronchodilators'];
}

/** Fluid label composition as text, e.g. "Na 130 mmol/L, K 4 mmol/L, …" (data/drugs.js FLUIDS). */
const COMP = { sodiumMmol: ['Na', 'mmol/L'], sodiumMeq: ['Na', 'mEq/L'], potassiumMmol: ['K', 'mmol/L'], calciumMmol: ['Ca', 'mmol/L'], calciumMeq: ['Ca', 'mEq/L'], chlorideMmol: ['Cl', 'mmol/L'], chlorideMeq: ['Cl', 'mEq/L'], lactateMmol: ['lactate', 'mmol/L'], osmolarityMosmolL: ['osmolarity', 'mOsmol/L'], pH: ['pH', ''] };
export function fluidCompositionText(f) {
  return Object.entries(f.composition || {}).filter(([k, v]) => typeof v === 'number' && COMP[k]).map(([k, v]) => `${COMP[k][0]} ${v}${COMP[k][1] ? ` ${COMP[k][1]}` : ''}`).join(', ');
}
