// Scripted complication presets, fictional example patients and example plans.
// EDUCATIONAL SIMULATION — fictional patients — not medical advice.
// Perturbation magnitudes are ILLUSTRATIVE engine assumptions. Example plans contain
// NO dose numbers: amounts/rates are filled at runtime from recommend() (data/drugs.js).

import { recommend } from '../engine/dosing.js';
import { getDrug } from '../engine/library.js';
import { macForAge, createPkModel } from '../engine/pk.js';

// Perturbation fields (applied × intensity 0..1; intensity ramps up over rampSec,
// holds for holdSec (null = until the end of the case), then resolves over resolveSec):
//   mapFrac / hrFrac   fractional change of MAP / HR target
//   hrMult             multiplier on HR target (1 → none)
//   ventFactor         multiplier on effective ventilation at full intensity
//   aaAdd              added A–a gradient (mmHg) — shunt / V/Q mismatch
//   etco2GapAdd        widened PaCO2–EtCO2 gap (mmHg)
//   stimulus           added nociceptive stimulus (0..1)
//   sensor             'hr' | 'map' | 'spo2' sensor reads as unusable while active
//   laryngospasm       true → no spontaneous ventilation; mask ventilation only partially effective
//   counteredBy        { drugId | '_hypnosis' : fraction } intensity × (1 − fraction × effect)
//                      special keys: '_hypnosis' (hypnotic effect H), '_bronchodilation'
//                      (epinephrine bronchodilation effect, pd.js 'broncho')
//   volumeLoss         true → intravenous crystalloid (sim.action('fluid_bolus')) offsets the
//                      event intensity (illustrative; at most 80 %, engine/sim.js FLUID_MODEL)
//   resolvedBy         { drugs:[ids], maskVentilationSec } ends the event
//   armOnExtubation    event starts at the next extubation (immediately if already extubated)
export const SCENARIOS = [
  {
    id: 'hemorrhage', label: 'Surgical hemorrhage',
    description: 'Progressive blood loss over about 10 minutes.',
    perturbation: { rampSec: 600, holdSec: null, resolveSec: 0, mapFrac: -0.35, hrFrac: 0.35, volumeLoss: true },
    teachingPoint: 'Falling MAP with rising HR (blunted by beta-blockade) suggests hypovolaemia. Restore volume (crystalloid boluses here; blood products are not modelled) and support pressure with a vasopressor while the bleeding is controlled surgically — fluids and vasopressors only temporise. In this illustrative model fluid helps most when the patient is volume-depleted, with diminishing returns, and the effect fades as crystalloid redistributes.',
  },
  {
    id: 'vagal_bradycardia', label: 'Vagal bradycardia',
    description: 'Abrupt vagally mediated bradycardia (e.g. peritoneal traction) lasting about 90 s.',
    perturbation: { rampSec: 10, holdSec: 90, resolveSec: 30, hrMult: 0.5, mapFrac: -0.15, counteredBy: { glycopyrrolate: 0.9 } },
    teachingPoint: 'Stop the stimulus; an anticholinergic restores the rate. HR < 48 also triggers the Python-derived interlock hold on dexmedetomidine.',
  },
  {
    id: 'bronchospasm', label: 'Bronchospasm',
    description: 'Increased airway resistance reducing effective ventilation for about 5 minutes.',
    perturbation: { rampSec: 30, holdSec: 300, resolveSec: 120, ventFactor: 0.35, aaAdd: 60, etco2GapAdd: 10, counteredBy: { _hypnosis: 0.4, _bronchodilation: 0.8 } },
    teachingPoint: 'Rising CO2, a widened PaCO2–EtCO2 gap and falling SpO2. Give 100 % oxygen, deepen anaesthesia, and consider epinephrine as a bronchodilator (inhaled bronchodilators are not modelled). Check the dose and route against the Sources panel.',
  },
  {
    id: 'laryngospasm_on_extubation', label: 'Laryngospasm on extubation',
    description: 'Glottic closure at extubation; spontaneous ventilation stops.',
    perturbation: { armOnExtubation: true, rampSec: 2, holdSec: 120, resolveSec: 10, laryngospasm: true, resolvedBy: { drugs: ['propofol', 'succinylcholine'], maskVentilationSec: 45 } },
    teachingPoint: 'Mask ventilation with 100 % oxygen and positive pressure; deepening (propofol) or a small dose of succinylcholine breaks the spasm. SpO2 falls fastest in obese patients.',
  },
  {
    id: 'light_anesthesia_stimulus', label: 'Light anaesthesia / strong stimulus',
    description: 'A strong surgical stimulus for about 2 minutes.',
    perturbation: { rampSec: 10, holdSec: 120, resolveSec: 60, stimulus: 0.9 },
    teachingPoint: 'Tachycardia, hypertension and a rising depth index signal inadequate analgesia/hypnosis; give analgesia or deepen.',
  },
  {
    id: 'hr_sensor_fault', label: 'HR sensor fault',
    description: 'The heart-rate signal becomes unusable for 60 s.',
    perturbation: { rampSec: 0, holdSec: 60, resolveSec: 0, sensor: 'hr' },
    teachingPoint: 'An unusable reading fails safe: controlled infusions are zeroed and the hold latches; it never restarts automatically (resume_hold).',
  },
  {
    id: 'map_sensor_fault', label: 'MAP sensor fault',
    description: 'The blood-pressure signal becomes unusable for 60 s.',
    perturbation: { rampSec: 0, holdSec: 60, resolveSec: 0, sensor: 'map' },
    teachingPoint: 'NaN fails every "<" comparison and would otherwise read as normal; the controller treats it as a fault.',
  },
  {
    id: 'spo2_probe_off', label: 'SpO2 probe off',
    description: 'The pulse-oximeter signal is lost for 60 s.',
    perturbation: { rampSec: 0, holdSec: 60, resolveSec: 0, sensor: 'spo2' },
    teachingPoint: 'Loss of oximetry is a high-priority alarm; confirm the patient before the probe. (The Python interlock reads only HR and MAP.)',
  },
  {
    id: 'anaphylaxis_hypotension', label: 'Anaphylaxis with hypotension',
    description: 'Severe vasodilatory hypotension, tachycardia and bronchospasm developing over 2 minutes.',
    perturbation: { rampSec: 120, holdSec: 900, resolveSec: 300, mapFrac: -0.5, hrFrac: 0.4, ventFactor: 0.6, aaAdd: 40, etco2GapAdd: 6, counteredBy: { _bronchodilation: 0.7 } },
    teachingPoint: 'Stop the suspected trigger and call for help. Epinephrine is the expected response (labelled for anaphylaxis by intramuscular injection; see the Sources panel for the dose); in this model it raises MAP and HR and reverses the bronchospasm. Phenylephrine or ephedrine only partially temporise.',
  },
];

export function getScenario(id) { return SCENARIOS.find((s) => s.id === id) || null; }

// ---------------------------------------------------------------------------
// Fictional example patients (inputs to derivePatient).

const noStopBang = { snoring: false, tired: false, observedApnea: false, pressure: false };
const normalAirway = { mallampati: 1, difficultHistory: false, limitedMouthOpening: false, limitedNeck: false };

export const EXAMPLE_PATIENTS = [
  {
    id: 'healthy_adult', label: 'Healthy adult (fictional), 34 y, ASA 1',
    patient: { sex: 'female', ageYears: 34, heightCm: 165, weightKg: 62, asa: 1, emergency: false,
      baseline: { hr: 72, sbp: 118, dbp: 74, spo2: 99, rr: 14 }, egfr: 105, airway: normalAirway,
      conditions: [], allergies: [], medications: [], ponvHistory: false, smoker: false, postopOpioidsExpected: true, stopBang: { ...noStopBang } },
  },
  {
    id: 'elderly_cad_ckd', label: 'Elderly with CAD and CKD (fictional), 78 y, ASA 3',
    patient: { sex: 'male', ageYears: 78, heightCm: 172, weightKg: 78, asa: 3, emergency: false,
      baseline: { hr: 64, sbp: 148, dbp: 82, spo2: 95, rr: 16 }, egfr: 38, airway: { ...normalAirway, mallampati: 2 },
      conditions: ['cad', 'uncontrolled_htn'], allergies: [], medications: ['beta_blocker'], ponvHistory: false, smoker: false, postopOpioidsExpected: true,
      stopBang: { snoring: true, tired: false, observedApnea: false, pressure: true } },
  },
  {
    id: 'obese_osa', label: 'Obese with OSA (fictional), 52 y, ASA 3',
    patient: { sex: 'male', ageYears: 52, heightCm: 178, weightKg: 132, asa: 3, emergency: false,
      baseline: { hr: 84, sbp: 138, dbp: 86, spo2: 95, rr: 18 }, egfr: 88, airway: { ...normalAirway, mallampati: 3 },
      conditions: ['osa', 'gerd'], allergies: [], medications: [], ponvHistory: false, smoker: true, postopOpioidsExpected: false,
      stopBang: { snoring: true, tired: true, observedApnea: true, pressure: true, neckCm: 46 } },
  },
  {
    id: 'mh_susceptible', label: 'MH-susceptible adult (fictional), 27 y, ASA 2',
    patient: { sex: 'male', ageYears: 27, heightCm: 183, weightKg: 85, asa: 2, emergency: false,
      baseline: { hr: 68, sbp: 124, dbp: 76, spo2: 99, rr: 12 }, egfr: 110, airway: normalAirway,
      conditions: ['mh_susceptible'], allergies: [], medications: [], ponvHistory: true, smoker: false, postopOpioidsExpected: true, stopBang: { ...noStopBang } },
  },
];

// ---------------------------------------------------------------------------
// Example plan templates. Each step names a drug + regimen; buildPlan() fills the
// amount/rate from recommend(). `dial:'mac1'` selects a vaporizer setting of 1.0 ×
// age-adjusted MAC (Mapleson 1996, library MAC40) clamped to the regimen's sourced range.

export const EXAMPLE_PLANS = [
  {
    id: 'ga_healthy', label: 'GA: propofol / fentanyl / rocuronium + sevoflurane', patientId: 'healthy_adult', mode: 'GA', sedationTarget: null,
    steps: [
      { phase: 'premed', atSec: 0, drugId: 'midazolam', regimenKey: 'premed', kind: 'bolus' },
      { phase: 'induction', atSec: 0, drugId: 'fentanyl', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'induction', atSec: 0, drugId: 'dexamethasone', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'induction', atSec: 60, drugId: 'propofol', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'induction', atSec: 90, drugId: 'rocuronium', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'maintenance', atSec: 0, drugId: 'sevoflurane', regimenKey: 'maintenance', kind: 'inhaled', dial: 'mac1' },
      { phase: 'maintenance', atSec: 900, drugId: 'fentanyl', regimenKey: 'maintenance', kind: 'bolus' },
      { phase: 'emergence', atSec: 0, drugId: 'sevoflurane', kind: 'stop' },
      { phase: 'emergence', atSec: 0, drugId: 'ondansetron', regimenKey: 'emergence', kind: 'bolus' },
      { phase: 'emergence', atSec: 30, drugId: 'sugammadex', regimenKey: 'emergence', kind: 'bolus' },
    ],
  },
  {
    id: 'ga_elderly_cad_ckd', label: 'GA: elderly CAD/CKD — reduced propofol, sevoflurane, phenylephrine available', patientId: 'elderly_cad_ckd', mode: 'GA', sedationTarget: null,
    steps: [
      { phase: 'induction', atSec: 0, drugId: 'fentanyl', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'induction', atSec: 60, drugId: 'propofol', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'induction', atSec: 90, drugId: 'rocuronium', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'maintenance', atSec: 0, drugId: 'sevoflurane', regimenKey: 'maintenance', kind: 'inhaled', dial: 'mac1' },
      { phase: 'maintenance', atSec: 120, drugId: 'phenylephrine', regimenKey: 'rescue', kind: 'bolus' },
      { phase: 'emergence', atSec: 0, drugId: 'sevoflurane', kind: 'stop' },
      { phase: 'emergence', atSec: 0, drugId: 'ondansetron', regimenKey: 'emergence', kind: 'bolus' },
      { phase: 'emergence', atSec: 30, drugId: 'sugammadex', regimenKey: 'emergence', kind: 'bolus' },
    ],
  },
  {
    id: 'mac_obese_osa', label: 'MAC moderate sedation: obese OSA — midazolam + propofol infusion', patientId: 'obese_osa', mode: 'MAC', sedationTarget: 'moderate',
    steps: [
      { phase: 'sedation', atSec: 0, drugId: 'midazolam', regimenKey: 'sedation_moderate', kind: 'bolus' },
      { phase: 'sedation', atSec: 120, drugId: 'propofol', regimenKey: 'sedation_moderate', kind: 'infusion' },
      { phase: 'emergence', atSec: 0, drugId: 'propofol', kind: 'stop' },
    ],
  },
  {
    id: 'tiva_mh', label: 'TIVA for MH-susceptible patient — no succinylcholine, no volatile', patientId: 'mh_susceptible', mode: 'GA', sedationTarget: null,
    steps: [
      { phase: 'induction', atSec: 0, drugId: 'fentanyl', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'induction', atSec: 60, drugId: 'propofol', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'induction', atSec: 90, drugId: 'rocuronium', regimenKey: 'induction', kind: 'bolus' },
      { phase: 'maintenance', atSec: 0, drugId: 'propofol', regimenKey: 'maintenance', kind: 'infusion' },
      { phase: 'emergence', atSec: 0, drugId: 'propofol', kind: 'stop' },
      { phase: 'emergence', atSec: 0, drugId: 'ondansetron', regimenKey: 'emergence', kind: 'bolus' },
      { phase: 'emergence', atSec: 30, drugId: 'sugammadex', regimenKey: 'emergence', kind: 'bolus' },
    ],
  },
];

/**
 * buildPlan(template, patientDerived[, library]) -> { plan, skipped:[{drugId, reason}] }
 * Fills each step from recommend(). Locked or unavailable drugs are skipped (with the reason).
 * A loading dose of an infusion regimen becomes a separate timed bolus step before the infusion.
 */
export function buildPlan(template, patient, library = null) {
  const steps = []; const skipped = [];
  let order = 0;
  for (const s of template.steps) {
    const base = { phase: s.phase, atSec: s.atSec, drugId: s.drugId };
    if (!getDrug(library, s.drugId)) { skipped.push({ drugId: s.drugId, reason: 'Drug not in library' }); continue; }
    if (s.kind === 'stop') { steps.push({ ...base, id: `s${++order}`, order, kind: 'stop' }); continue; }
    const rec = recommend(patient, s.regimenKey, s.drugId, library);
    if (rec.locked) { skipped.push({ drugId: s.drugId, reason: rec.lockReasons.join('; ') }); continue; }
    if (!rec.available) { skipped.push({ drugId: s.drugId, reason: rec.warnings.join('; ') }); continue; }
    const src = { regimenKey: s.regimenKey, sources: rec.sources };
    if (s.kind === 'bolus' && rec.dose) {
      steps.push({ ...base, ...src, id: `s${++order}`, order, kind: 'bolus', amount: rec.dose.value, amountUnit: rec.dose.unit, overSec: rec.route && rec.route !== 'IV' ? null : overSecFromTiming(rec.timing), ...(rec.route && rec.route !== 'IV' ? { route: rec.route } : {}) });
    } else if (s.kind === 'infusion' && rec.rate) {
      if (rec.loading && rec.loading.value) steps.push({ ...base, ...src, id: `s${++order}`, order, kind: 'bolus', amount: rec.loading.value, amountUnit: rec.loading.unit, overSec: rec.loading.overSec || null, loading: true });
      steps.push({ ...base, ...src, id: `s${++order}`, order, kind: 'infusion', rate: rec.rate.value, rateUnit: rec.rate.unit });
    } else if (s.kind === 'inhaled' && rec.rate) {
      let dial = rec.rate.value;
      if (s.dial === 'mac1') {
        if (rec.rate.ageAdjustedMac) dial = rec.rate.ageAdjustedMac.value;
        else { const pk = createPkModel(getDrug(library, s.drugId), patient); dial = Math.round(macForAge(pk.mac40, patient.ageYears) * 10) / 10; }
        if (rec.rate.range.min !== null) dial = Math.max(rec.rate.range.min, dial);
        if (rec.rate.range.max !== null) dial = Math.min(rec.rate.range.max, dial);
      }
      steps.push({ ...base, ...src, id: `s${++order}`, order, kind: 'inhaled', rate: dial, rateUnit: '%' });
    } else {
      skipped.push({ drugId: s.drugId, reason: `No ${s.kind} value in ${s.regimenKey} regimen` });
    }
  }
  return { plan: { mode: template.mode, sedationTarget: template.sedationTarget, steps }, skipped };
}

/** "give over 30–60 s" / "over 10 min" -> seconds (upper bound) if ≥ 60 s, else null (instant). */
export function overSecFromTiming(timing) {
  if (typeof timing !== 'string') return null;
  const m = /over\s+(?:about\s+)?(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*(min|minutes|s|sec|seconds)\b/i.exec(timing);
  if (!m) return null;
  const v = Number(m[2] || m[1]); const sec = /^m/i.test(m[3]) ? v * 60 : v;
  return sec >= 60 ? sec : null;
}
