// Pharmacodynamics (ILLUSTRATIVE). Pure; no DOM.
// Sigmoid Emax on the normalised concentration u = Ce / Ce_ref (see pk.js; for
// volatiles u = fraction of age-adjusted MAC). E(u) = u^γ / (EC50^γ + u^γ).
// Weights/EC50s below are engine-author assumptions chosen so that a drug's
// default reference dose produces its intended qualitative effect (e.g. an
// induction bolus of propofol → general anaesthesia range of the depth index).
// None of these numbers is a published model parameter.

export const sigmoid = (u, ec50 = 0.5, gamma = 2) => (u <= 0 ? 0 : Math.pow(u, gamma) / (Math.pow(ec50, gamma) + Math.pow(u, gamma)));

// Each effect: [weight, EC50, gamma]. map/hr are fractional changes from baseline at full effect.
export const PROFILES = {
  propofol: { hyp: [1.0, 0.6, 2.5], resp: [1.0, 0.55, 2], map: [-0.32, 0.6, 1.5], hr: [-0.06, 0.6, 1.5], ana: [0.1, 0.8, 2] },
  etomidate: { hyp: [1.0, 0.6, 2.5], resp: [0.7, 0.6, 2], map: [-0.05, 0.6, 1.5] },
  ketamine: { hyp: [0.9, 0.6, 2.5], ana: [0.85, 0.12, 1.5], resp: [0.15, 0.8, 2], map: [0.15, 0.3, 1.5], hr: [0.15, 0.3, 1.5] },
  midazolam: { hyp: [0.3, 1.0, 2], resp: [0.35, 0.7, 2], map: [-0.05, 0.6, 1.5] },
  dexmedetomidine: { hyp: [0.35, 0.6, 2], ana: [0.3, 0.6, 2], resp: [0.05, 0.8, 2], map: [-0.18, 0.6, 1.5], hr: [-0.22, 0.6, 1.5], mapCpHigh: [0.25, 2.5, 3] },
  fentanyl: { hyp: [0.2, 0.8, 2], ana: [0.95, 0.5, 2], resp: [0.9, 0.9, 2.5], hr: [-0.12, 0.6, 1.5], map: [-0.06, 0.6, 1.5], opioid: true },
  lidocaine: { hyp: [0.1, 0.8, 2], ana: [0.35, 0.4, 2], map: [-0.03, 0.6, 1.5] },
  sevoflurane: { hyp: [0.8, 0.45, 2.5], ana: [0.6, 0.9, 2], resp: [0.8, 0.7, 2], map: [-0.22, 0.8, 1.5] },
  rocuronium: { nmb: { kind: 'nondepolarizing', ec50: 0.416, gamma: 6 } },
  succinylcholine: { nmb: { kind: 'depolarizing', ec50: 0.416, gamma: 6 } },
  glycopyrrolate: { hr: [0.22, 0.5, 2], antimuscarinic: [1, 0.5, 2] },
  phenylephrine: { map: [0.3, 0.5, 1.5], hr: [-0.1, 0.5, 1.5] },
  ephedrine: { map: [0.18, 0.5, 1.5], hr: [0.15, 0.5, 1.5] },
  // Epinephrine (ILLUSTRATIVE author estimates; u = 1 at steady state of the lowest label septic-shock
  // rate, 0.05 mcg/kg/min, in the 70 kg reference): ↑MAP, ↑HR, bronchodilation ('broncho' =
  // fraction by which bronchospasm/anaphylaxis event intensity is countered, see sim.js).
  // u≈1 → MAP +8 %, HR +6 %, broncho 0.5; IM 0.3 mg peak (u≈6) → MAP ≈ +34 %, HR ≈ +32 %, broncho ≈ 0.97.
  // mapHigh/hrHigh (2026-11 audit): a second, higher-EC50 component so the response keeps rising
  // at high infusion rates (0.5 mcg/kg/min, u≈10 → MAP ≈ +45 %, HR ≈ +45 %) instead of plateauing;
  // the sum of increasing sigmoids is monotonic in dose. Caps: mapFrac ≤ 0.6, hrFrac ≤ 0.8.
  epinephrine: { map: [0.30, 2.0, 1.5], hr: [0.30, 2.5, 1.5], mapHigh: [0.35, 10, 2], hrHigh: [0.35, 10, 2], broncho: [1, 1.0, 2] },
  neostigmine: { anticholinesterase: [1, 0.5, 2], hr: [-0.15, 0.5, 2] },
  naloxone: { opioidAntagonist: [1, 0.3, 2], hr: [0.05, 0.5, 2], map: [0.05, 0.5, 2] },
  ketorolac: { ana: [0.3, 0.5, 2] },
  acetaminophen: { ana: [0.25, 0.5, 2] },
  sugammadex: {}, dexamethasone: {}, ondansetron: {},
};

const CLASS_FALLBACK = {
  hypnotic: PROFILES.propofol, opioid: PROFILES.fentanyl, benzodiazepine: PROFILES.midazolam, alpha2: PROFILES.dexmedetomidine,
  nmda: PROFILES.ketamine, local: PROFILES.lidocaine, volatile: PROFILES.sevoflurane, anticholinergic: PROFILES.glycopyrrolate,
  vasopressor: PROFILES.phenylephrine, nsaid: PROFILES.ketorolac, analgesic: PROFILES.acetaminophen,
};

export function profileFor(drug) {
  return drug._profile || PROFILES[drug.id] || CLASS_FALLBACK[drug.cls] || {};
}

// Patient modifier constants (ILLUSTRATIVE author estimates; listed in sim.modelInfo().inventory).
export const PATIENT_MODS = Object.freeze({
  ELDERLY_SENS: 1.3, ASA3_SENS: 1.15, DEPLETION_HYPO_AMP: 1.5, HYPO_AMP_MAX: 3, RESP_SENS_OBESE_OSA: 1.3,
  BETA_BLOCKER_HR_RISE: 0.4, FRC_MORBID_OBESE: 0.35, FRC_OBESE: 0.5, FRC_ELDERLY: 0.85, FRC_COPD: 0.8,
  OBSTRUCTION_OSA: 1.6, OBSTRUCTION_OBESE: 1.3, K10_SEVERE_CKD_ROCURONIUM: 0.6, K10_LIVER_LIDO_MIDAZ: 0.6,
  OPIOID_HYPNOTIC_SYNERGY: 0.5, NALOXONE_OPIOID_DISPLACEMENT: 10, NEOSTIGMINE_EC50_SHIFT_MAX: 0.6,
  // 2026-11 audit (illustrative): ketamine relatively preserves upper-airway tone, so only this
  // fraction of its hypnotic effect counts toward airway obstruction (effects.Hairway).
  KETAMINE_AIRWAY_FRACTION: 0.3,
  // 2026-11 audit (illustrative): nitrous oxide is a weak hypnotic; its MAC fraction counts at this
  // weight toward hypnosis (immobility/analgesia/respiratory effects still use the summed MAC), so
  // 70 % N2O alone (≈ 0.67 MAC) gives sedation, not general anaesthesia.
  N2O_HYPNOSIS_FRACTION: 0.5,
});

/** Patient sensitivity modifiers (illustrative). */
export function patientModifiers(p) {
  const K = PATIENT_MODS;
  const has = (id) => (p.conditions || []).includes(id);
  const flags = p.flags || [];
  let hypSens = 1; if (flags.includes('elderly')) hypSens *= K.ELDERLY_SENS; if (p.asa >= 3) hypSens *= K.ASA3_SENS;
  let hypoAmp = 1; if (flags.includes('elderly')) hypoAmp *= K.ELDERLY_SENS; if (p.asa >= 3) hypoAmp *= K.ASA3_SENS;
  for (const c of ['hypovolemia', 'sepsis', 'hf_reduced_ef', 'aortic_stenosis_severe']) if (has(c)) hypoAmp *= K.DEPLETION_HYPO_AMP;
  const respSens = (flags.includes('obese') || has('osa') || flags.includes('osaRisk')) ? K.RESP_SENS_OBESE_OSA : 1;
  const hrRiseBlunt = (p.medications || []).includes('beta_blocker') ? K.BETA_BLOCKER_HR_RISE : 1;
  let frcFactor = 1;
  if (flags.includes('morbidObese')) frcFactor = K.FRC_MORBID_OBESE; else if (flags.includes('obese')) frcFactor = K.FRC_OBESE;
  if (flags.includes('elderly')) frcFactor *= K.FRC_ELDERLY;
  if (has('copd')) frcFactor *= K.FRC_COPD;
  const obstruction = (has('osa') || flags.includes('osaRisk')) ? K.OBSTRUCTION_OSA : flags.includes('obese') ? K.OBSTRUCTION_OBESE : 1;
  const k10Mult = {};
  if (flags.includes('severeCkd')) k10Mult.rocuronium = K.K10_SEVERE_CKD_ROCURONIUM;
  if (has('liver_disease') || has('severe_hepatic_impairment')) { k10Mult.lidocaine = K.K10_LIVER_LIDO_MIDAZ; k10Mult.midazolam = K.K10_LIVER_LIDO_MIDAZ; }
  return { hypSens, hypoAmp: Math.min(hypoAmp, K.HYPO_AMP_MAX), respSens, hrRiseBlunt, frcFactor, obstruction, k10Mult };
}

const eff = (spec, u) => (spec ? spec[0] * sigmoid(u, spec[1], spec[2]) : 0);

/**
 * Combine drug effects.
 * entries: [{ drug, u, cpU }]  (u = normalised Ce; cpU = normalised Cp)
 * Returns hypnosis H (0..1, with opioid synergy), analgesia A, opioid analgesia,
 * respiratory depression D, fractional MAP/HR changes, NMB twitch heights.
 */
export function combineEffects(entries, mods) {
  let antag = 0, achE = 0, antimusc = 0, broncho = 0;
  for (const { drug, u } of entries) {
    const pr = profileFor(drug);
    if (pr.broncho) broncho = Math.max(broncho, eff(pr.broncho, u));
    if (pr.opioidAntagonist) antag = Math.max(antag, eff(pr.opioidAntagonist, u));
    if (pr.anticholinesterase) achE = Math.max(achE, eff(pr.anticholinesterase, u));
    if (pr.antimuscarinic) antimusc = Math.max(antimusc, eff(pr.antimuscarinic, u));
  }
  let notH = 1, notHair = 1, notA = 1, notAop = 1, notD = 1, mapF = 0, hrF = 0;
  let nd = 0, dep = 0;
  for (const { drug, u: u0, cpU } of entries) {
    const pr = profileFor(drug);
    let u = u0;
    if (pr.opioid) u = u0 / (1 + PATIENT_MODS.NALOXONE_OPIOID_DISPLACEMENT * antag);
    const uh = u * mods.hypSens;
    const eh = eff(pr.hyp, uh);
    notH *= 1 - eh;
    notHair *= 1 - eh * (drug.id === 'ketamine' ? PATIENT_MODS.KETAMINE_AIRWAY_FRACTION : 1);
    const a = eff(pr.ana, u);
    notA *= 1 - a;
    if (pr.opioid) notAop *= 1 - a;
    notD *= 1 - eff(pr.resp, u * mods.respSens);
    let m = eff(pr.map, u);
    if (m < 0) m *= mods.hypoAmp;
    if (pr.mapCpHigh) m += eff(pr.mapCpHigh, cpU || 0);
    if (pr.mapHigh) m += eff(pr.mapHigh, u);
    mapF += m;
    let h = eff(pr.hr, u) + eff(pr.hrHigh, u);
    if (drug.id === 'neostigmine' || pr.anticholinesterase) h *= 1 - antimusc; // glycopyrrolate blocks muscarinic bradycardia
    hrF += h;
    if (pr.nmb) {
      if (pr.nmb.kind === 'depolarizing') dep = Math.max(dep, u);
      else nd += u; // additive normalised non-depolarising concentration
    }
  }
  const Hraw = 1 - notH;
  const Aop = 1 - notAop;
  const syn = (x) => Math.min(1, x + PATIENT_MODS.OPIOID_HYPNOTIC_SYNERGY * Aop * x * (1 - x));
  const H = syn(Hraw);
  const Hairway = syn(1 - notHair);
  // Neuromuscular junction (illustrative): T1..T4 twitch heights; fade only for non-depolarising block.
  // Neostigmine (anticholinesterase) shifts EC50 up by ≤ 60 % — a ceiling effect, so it cannot reverse deep block.
  const ndProf = PROFILES.rocuronium.nmb, dpProf = PROFILES.succinylcholine.nmb;
  const shift = 1 + PATIENT_MODS.NEOSTIGMINE_EC50_SHIFT_MAX * achE;
  const twitch = (k) => 1 - sigmoid(nd, ndProf.ec50 * shift * [1, 0.92, 0.84, 0.76][k], ndProf.gamma);
  const depT = 1 - sigmoid(dep, dpProf.ec50, dpProf.gamma);
  const T = [0, 1, 2, 3].map((k) => twitch(k) * depT);
  return {
    H, Hraw, Hairway, A: 1 - notA, Aop, D: 1 - notD,
    mapFrac: Math.max(-0.6, Math.min(0.6, mapF)), hrFrac: Math.max(-0.6, Math.min(0.8, hrF)),
    twitches: T, block: 1 - T[0], antimuscarinic: antimusc, anticholinesterase: achE,
    bronchodilation: broncho,
  };
}

/** TOF count and ratio from twitch heights (count = twitches > 5 % of control). */
export function tofFromTwitches(T) {
  const count = T.filter((x) => x > 0.05).length;
  const ratio = count < 4 ? 0 : Math.max(0, Math.min(1, T[3] / T[0]));
  return { count, ratio };
}

/** Sedation level from the simulated depth index (illustrative mapping onto the ASA continuum labels). */
export function sedationLevelFromDepth(d) {
  if (!(d >= 0)) return 'awake';
  if (d >= 90) return 'awake';
  if (d >= 80) return 'minimal';
  if (d >= 70) return 'moderate';
  if (d >= 60) return 'deep';
  return 'general';
}
export const SEDATION_RANK = { awake: 0, minimal: 1, moderate: 2, deep: 3, general: 4 };
