// Model parameter inventory (transparency record). Pure; no DOM.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device.
//
// buildParameterInventory() lists every numeric model parameter the engine uses, each as
//   { component, drugId?, name, value, unit, provenance, sourceIds, note }
// provenance (fixed vocabulary):
//   'fda_label'                     number transcribed from FDA prescribing information
//   'published_model'               parameter of a published PK/PD model or meta-analysis model
//   'guideline'                     society guideline / consensus statement
//   'trial_or_physiology_study'     trial protocol value or classic physiology relation
//   'project_config'                Smart NOA config.yaml (software setting, not clinical evidence)
//   'author_estimate_unvalidated'   engine author's illustrative choice; not sourced, not validated
//   'simulator_convention'          teaching-sequence choice of the guided/automatic modes
//                                   (engine/autorun-config.js); not sourced, not a model parameter
// sourceIds are ids in the drug library SOURCES. A non-author entry whose citation is not in
// SOURCES carries citationRegistered:false and names the work in `note`.
// Implementation checks against published reference values are VERIFICATION of the code, not
// validation of the simulator; no part of the simulator has been externally validated.

import { getDrug, listDrugs, findSourceId } from './library.js';
import {
  ELEVELD_2018, MARSH_1991, GENERIC_ILLUSTRATIVE, CALIBRATED_V1_PER_KG, PERIPHERAL_RATIO, VOLATILE_DEFAULTS, VOLATILE_TAU_MIN,
  ILLUSTRATIVE_PK, ROUTE_KA_ILLUSTRATIVE, ROUTE_PERFUSION_ILLUSTRATIVE, ILLUSTRATIVE_TIMING_FILL, MIN_ELIM_FRACTION, FALLBACK_SEVO_MAC40, fitCalibrated, isInhaled,
} from './pk.js';
import { PROFILES, PATIENT_MODS } from './pd.js';
import { PHYS, GAINS } from './physiology.js';
import { NOA_CONFIG } from './interlocks.js';
import { SCENARIOS } from '../data/scenarios.js';
import { AUTORUN_CONFIG, CONVENTION } from './autorun-config.js';

export const PROVENANCE = Object.freeze(['fda_label', 'published_model', 'guideline', 'trial_or_physiology_study', 'project_config', 'author_estimate_unvalidated', 'simulator_convention']);
const AUTHOR = 'author_estimate_unvalidated';

export function buildParameterInventory({ lib, patient, models = {}, fluidModel, mw, minFio2WithN2O, alarmThresholds, extubationCriteria, stimulus }) {
  const out = [];
  const add = (component, name, value, unit, provenance, sourceIds = [], note = '', extra = {}) => out.push({ component, name, value, unit, provenance, sourceIds, note, ...extra });
  const eng = (lib && lib.SOURCE_IDS_ENGINE) || {};
  const cfg = eng.pythonConfig ? [eng.pythonConfig] : [];

  // ---------------------------------------------------------------- PK, per drug
  for (const d of listDrugs(lib)) {
    const pk = (name, value, unit, provenance, sourceIds, note, extra = {}) => add('pk', name, value, unit, provenance, sourceIds, note, { drugId: d.id, ...extra });
    if (isInhaled(d)) {
      const mac = d.mac || {};
      const mac40 = Number.isFinite(mac.mac40Pct) ? mac.mac40Pct : null;
      if (mac40 !== null) pk('MAC40', mac40, '%', 'published_model', mac.sources || [], 'Mapleson 1996 age-40 MAC (drug library).');
      else pk('MAC40 (fallback)', FALLBACK_SEVO_MAC40, '%', AUTHOR, [], 'Used only if the library supplies no MAC40.');
      pk('MAC age slope', Number.isFinite(mac.slopePerYear) ? mac.slopePerYear : -0.00269, 'log10 per year', 'published_model', mac.sources || [], 'MAC(age) = MAC40 × 10^(slope × (age − 40)), Mapleson 1996.');
      pk('wash-in/out tau', VOLATILE_TAU_MIN[d.id] ?? VOLATILE_DEFAULTS.tauMin, 'min', AUTHOR, [], 'End-tidal toward dial; ordered by solubility.');
      pk('effect-site ke0', (VOLATILE_DEFAULTS.tauMin / (VOLATILE_TAU_MIN[d.id] ?? VOLATILE_DEFAULTS.tauMin)) * VOLATILE_DEFAULTS.ke0, '1/min', AUTHOR, [], 'Effect site lagging end-tidal.');
      continue;
    }
    if (d.pkModel === 'eleveld') {
      const src = (d.pkModelInfo && d.pkModelInfo.sources) || [];
      const T = ELEVELD_2018.THETA;
      const names = [null, 'V1ref (L)', 'V2ref (L)', 'V3ref (L)', 'CLref male (L/min)', 'Q2ref (L/min)', 'Q3ref (L/min)', 'residual error', 'CL maturation E50 (weeks PMA)', 'CL maturation slope', 'V2 age (1/yr)', 'CL age with opioids (1/yr)', 'V1 weight E50 (kg)', 'V3 age with opioids (1/yr)', 'Q3 maturation E50 (weeks)', 'CLref female (L/min)', 'Q2 maturation factor', 'V1 venous factor', 'Q2 venous factor'];
      for (let i = 1; i < T.length; i++) pk(`Eleveld Θ${i} ${names[i]}`, T[i], '', 'published_model', src, 'Eleveld 2018 Table 2 fixed effect (transcription verified against four open-source implementations; see SOURCES.md).');
      pk('Eleveld ke0 arterial (70 kg)', ELEVELD_2018.PD.ke0Arterial, '1/min', 'published_model', src, 'Table 3 Θ2; scaled × (WGT/70)^−0.25.');
      pk('Eleveld reference individual', '35 y, 70 kg, 170 cm, male', '', 'published_model', src, 'Reference covariates of the published model; also the simulator normalisation reference (no concomitant drugs).');
      const m = models[d.id];
      if (m && m.type === 'eleveld') {
        const e = m.params;
        for (const [k, u] of [['v1', 'L'], ['v2', 'L'], ['v3', 'L'], ['cl', 'L/min'], ['q2', 'L/min'], ['q3', 'L/min'], ['ke0', '1/min']]) pk(`patient ${k.toUpperCase()}`, e[k], u, 'published_model', src, `Eleveld equations at this patient's covariates (opioid switch ${e.opioids ? 'ON' : 'OFF'}).`);
      }
      pk('PD normalisation: induction bolus for reference Ce', 2, 'mg/kg', AUTHOR, [], 'Ce normalised to the peak Ce of the default induction bolus in the reference individual; the depth index PD is illustrative (not the Eleveld BIS model).');
      pk('verification: reference-individual reproduction', 'V1 6.28 L, V2 25.5 L, V3 273 L, CL 1.79, Q2 1.83, Q3 1.11 L/min, ke0 0.146/min', '', 'published_model', src, 'Implementation verification (tests/models.test.mjs) — not validation of the simulator.', { verification: true });
      continue;
    }
    if (d.pkModel === 'marsh') {
      for (const [k, v] of Object.entries(MARSH_1991)) {
        pk(`Marsh ${k}`, v, k === 'v1PerKg' ? 'L/kg' : '1/min', 'published_model', [], 'Marsh 1991 as reproduced in TCI implementations; transcription not verified against the paper (ke0 is an implementation value; citation not registered in SOURCES).');
        out[out.length - 1].citationRegistered = false;
      }
      continue;
    }
    // calibrated
    const fit = fitCalibrated(d.timing, d.id);
    const label = ILLUSTRATIVE_PK[d.id] && !(fit.targets) ? 'author-estimate constants' : fit.targets ? 'fitted by the engine to label timing (drug.timing)' : 'generic illustrative constants';
    const tSrc = (d.timing && d.timing.sources) || [];
    for (const k of ['k10', 'k12', 'k21', 'ke0']) pk(k, fit[k], '1/min', AUTHOR, fit.targets ? tSrc : [], `Illustrative 2-compartment model: ${label}.`);
    pk('V1', CALIBRATED_V1_PER_KG, 'L/kg (dosing scalar)', AUTHOR, [], 'Illustrative; cancels in the normalised concentration.');
    if (fit.targets && fit.targets.filled && fit.targets.filled.length) for (const f of fit.targets.filled) pk(`timing fill ${f}`, ILLUSTRATIVE_TIMING_FILL[d.id][f], 'min', AUTHOR, [], 'Missing label timing metric filled by assumption.');
  }
  add('pk', 'calibrated peripheral/central volume ratio', PERIPHERAL_RATIO, '', AUTHOR, [], 'k21 = k12/5.');
  add('pk', 'calibrated minimum elimination fraction', MIN_ELIM_FRACTION, '', AUTHOR, [], 'Fit regularisation.');
  for (const [k, v] of Object.entries(GENERIC_ILLUSTRATIVE)) if (k !== 'illustrative') add('pk', `generic ${k}`, v, '1/min', AUTHOR, [], 'Used when drug.timing is entirely missing and no drug-specific estimate exists.');
  for (const [r, ka] of Object.entries(ROUTE_KA_ILLUSTRATIVE)) add('pk', `absorption ka ${r}`, ka, '1/min', AUTHOR, [], `First-order ${r} absorption (epinephrine anaphylaxis dose).`);
  for (const [k, v] of Object.entries(ROUTE_PERFUSION_ILLUSTRATIVE)) add('pk', `IM/SC absorption perfusion ${k}`, v, k === 'KA_FACTOR_MIN' ? 'multiplier' : 'fraction of baseline MAP', AUTHOR, [], 'Absorption slows when MAP is far below baseline (linear between MAP_FRAC_MIN and MAP_FRAC_FULL).');
  if (mw) {
    const roc = getDrug(lib, 'rocuronium'), sgx = getDrug(lib, 'sugammadex');
    add('pk', 'molecular weight rocuronium bromide', mw.rocuronium, 'g/mol', 'fda_label', ['S12'], 'Label DESCRIPTION (C32H53BrN2O4, 609.70); verified 2026-11 (WebSearch record of the Pfizer rocuronium label).', { drugId: roc ? 'rocuronium' : undefined });
    add('pk', 'molecular weight sugammadex sodium', mw.sugammadex, 'g/mol', 'fda_label', ['S6'], 'Label DESCRIPTION (2178.01); 1:1 molar binding, instantaneous (illustrative kinetics).', { drugId: sgx ? 'sugammadex' : undefined });
    add('pk', 'sugammadex dose-salt factor', mw.SUGAMMADEX_SALT_PER_MG, 'mg sugammadex sodium per mg sugammadex', 'fda_label', ['S6'], 'Label: each mL contains 100 mg sugammadex, equivalent to 108.8 mg sugammadex sodium.', { drugId: sgx ? 'sugammadex' : undefined });
  }

  // ---------------------------------------------------------------- PD
  for (const [drugId, pr] of Object.entries(PROFILES)) {
    for (const [eff, spec] of Object.entries(pr)) {
      if (Array.isArray(spec)) {
        const [w, ec50, g] = spec;
        add('pd', `${eff} max effect`, w, eff === 'map' || eff === 'hr' ? 'fraction of baseline' : 'fraction', AUTHOR, [], 'Sigmoid Emax on normalised Ce.', { drugId });
        add('pd', `${eff} EC50`, ec50, 'normalised Ce', AUTHOR, [], '', { drugId });
        add('pd', `${eff} gamma`, g, '', AUTHOR, [], '', { drugId });
      } else if (spec && typeof spec === 'object') {
        add('pd', 'NMB EC50', spec.ec50, 'normalised Ce', AUTHOR, [], `${spec.kind} block`, { drugId });
        add('pd', 'NMB gamma', spec.gamma, '', AUTHOR, [], '', { drugId });
      }
    }
  }
  for (const [k, v] of Object.entries(PATIENT_MODS)) add('pd', `patient/interaction modifier ${k}`, v, '', AUTHOR, [], 'Illustrative sensitivity or interaction modifier.');

  // ---------------------------------------------------------------- physiology
  const sev = findSourceId(lib, 'Severinghaus');
  add('physiology', 'oxyhaemoglobin dissociation (Severinghaus 1979 approximation)', 'SO2 = 100/(23400/(PO2³+150·PO2)+1)', '', 'trial_or_physiology_study', sev ? [sev] : [], 'Severinghaus JW, J Appl Physiol 1979, blood O2 dissociation equations (citation not registered in SOURCES; not re-verified).', { citationRegistered: !!sev });
  add('physiology', 'alveolar gas equation constants', 'PAO2 = FiO2·713 − PaCO2/0.8', 'mmHg', 'trial_or_physiology_study', [], 'Standard sea-level alveolar gas equation (textbook relation; no citation registered).', { citationRegistered: false });
  for (const [k, v] of Object.entries(PHYS)) add('physiology', k, v, '', AUTHOR, [], 'Illustrative ventilation/oxygenation constant.');
  for (const [k, v] of Object.entries(GAINS)) add('physiology', k, v, '', AUTHOR, [], 'Illustrative gain / time constant.');
  add('physiology', 'blood O2 store capacitance factor', 243, '', AUTHOR, [], 'Buffers apnoeic PAO2 fall on the steep part of the curve.');
  add('physiology', 'noise AR(1) coefficient', 0.95, '', AUTHOR, [], 'Seeded physiological noise.');
  if (stimulus) for (const [k, v] of Object.entries(stimulus)) add('physiology', `stimulus ${k}`, v, '', AUTHOR, [], 'Nociceptive stimulus profile / orchestrator constant.');
  add('physiology', 'FiO2 maximum with N2O', minFio2WithN2O, 'fraction', AUTHOR, [], 'Minimum FiO2 enforced with N2O (O2 + N2O ≤ 1 arithmetic; 0.30 floor is a simulator choice matching the ENIGMA-II 30% O2 arm).');

  // ---------------------------------------------------------------- fluids
  if (fluidModel) {
    for (const [k, v] of Object.entries(fluidModel)) {
      if (k === 'SEPSIS_CONTEXT_ML_PER_KG') add('fluids', k, v, 'mL/kg', 'guideline', eng.sepsisFluids ? [eng.sepsisFluids] : [], 'Surviving Sepsis Campaign 2021 statement shown as context text only; not used in the effect model.');
      else if (k === 'ALLOWED_ML' || k === 'DEFAULT_ML') add('fluids', k, Array.isArray(v) ? v.join(', ') : v, 'mL', AUTHOR, [], 'Simulator action sizes (owner-specified UI choice); not a recommendation.');
      else if (k === 'DEPLETED_CONDITIONS') add('fluids', k, v.join(', '), '', AUTHOR, [], 'Conditions treated as volume depleted.');
      else if (k === 'DIRECT_MAP_FRAC') { add('fluids', 'DIRECT_MAP_FRAC euvolaemic', v.euvolaemic, 'fraction of baseline MAP', AUTHOR, [], 'Cap of direct MAP effect.'); add('fluids', 'DIRECT_MAP_FRAC depleted', v.depleted, 'fraction of baseline MAP', AUTHOR, [], 'Cap of direct MAP effect (hypovolemia/sepsis).'); }
      else add('fluids', k, v, k.endsWith('_ML') ? 'mL' : k.endsWith('_MIN') ? 'min' : k.includes('PER_MIN') ? 'mL/min' : '', AUTHOR, [], 'Illustrative volume-restoration model.');
    }
  }

  // ---------------------------------------------------------------- scenarios
  for (const sc of SCENARIOS) {
    for (const [k, v] of Object.entries(sc.perturbation || {})) {
      if (typeof v === 'number') add('scenario', `${sc.id}.${k}`, v, k.endsWith('Sec') ? 's' : '', AUTHOR, [], 'Illustrative perturbation magnitude/timing.');
      else if (v && typeof v === 'object' && !Array.isArray(v)) for (const [kk, vv] of Object.entries(v)) if (typeof vv === 'number') add('scenario', `${sc.id}.${k}.${kk}`, vv, '', AUTHOR, [], 'Illustrative countering/resolution constant.');
    }
  }

  // ---------------------------------------------------------------- alarms / interlocks / extubation
  const thr = NOA_CONFIG.hemodynamic_thresholds;
  add('interlock', 'hr_critical_low', thr.hr_critical_low, '/min', 'project_config', cfg, 'config.yaml; strict "<" (Python controller parity).');
  add('interlock', 'map_critical_low', thr.map_critical_low, 'mmHg', 'project_config', cfg, 'config.yaml; strict "<".');
  for (const [k, v] of Object.entries(NOA_CONFIG.simulation_rate_ceilings)) add('interlock', `simulation_rate_ceiling ${k}`, v, k === 'Dexmedetomidine' ? 'mcg/kg/h' : 'mg/kg/h', 'project_config', cfg, 'Python simulation ceiling (applies while interlocks are on); software value, not clinical evidence.');
  add('interlock', 'ketorolac egfr_minimum', NOA_CONFIG.contraindications.ketorolac.egfr_minimum, 'mL/min/1.73m²', 'project_config', cfg, 'Lockout below this eGFR.');
  const tofSrc = eng.tofExtubation ? [eng.tofExtubation] : [];
  if (alarmThresholds) for (const [k, v] of Object.entries(alarmThresholds)) {
    if (k === 'TOFR_EXTUBATION') add('alarm', k, v, 'ratio', 'guideline', tofSrc, 'Thilen 2023: TOFR ≥ 0.9 before extubation.');
    else add('alarm', k, v, /SPO2/.test(k) ? '%' : /HR/.test(k) ? '/min' : /SEC/.test(k) ? 's' : 'mmHg', AUTHOR, [], 'Simulator alarm threshold/hysteresis chosen in the build specification; not a clinical standard.');
  }
  if (extubationCriteria) for (const [k, v] of Object.entries(extubationCriteria)) add('extubation', k, v, '', AUTHOR, [], 'Illustrative extubation-readiness criterion (TOFR criterion is the guideline value above).');

  // ---------------------------------------------------------------- guided / automatic sequence (engine/autorun-config.js)
  for (const [k, x] of Object.entries(AUTORUN_CONFIG)) {
    const prov = x.provenance === CONVENTION ? 'simulator_convention' : x.provenance;
    add('autorun', k, Array.isArray(x.value) ? x.value.join(', ') : x.value, x.unit, prov, [...x.sourceIds], `[${x.appliesTo === 'full' ? 'full demonstration only' : x.appliesTo === 'guided' ? 'guided mode only' : 'guided + full'}] ${x.rationale}`);
  }
  return out;
}
