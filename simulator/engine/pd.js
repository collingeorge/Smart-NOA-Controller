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
  propofol: { hyp: [1.0, 0.75, 2.5], resp: [1.0, 0.55, 2], map: [-0.32, 0.6, 1.5], hr: [-0.06, 0.6, 1.5], ana: [0.1, 0.8, 2] },
  etomidate: { hyp: [1.0, 0.6, 2.5], resp: [0.7, 0.6, 2], map: [-0.05, 0.6, 1.5] },
  ketamine: { hyp: [0.9, 0.6, 2.5], ana: [0.85, 0.12, 1.5], resp: [0.15, 0.8, 2], map: [0.15, 0.3, 1.5], hr: [0.15, 0.3, 1.5] },
  midazolam: { hyp: [0.5, 0.5, 2], resp: [0.45, 0.6, 2], map: [-0.06, 0.6, 1.5] },
  dexmedetomidine: { hyp: [0.55, 0.6, 2], ana: [0.3, 0.6, 2], resp: [0.05, 0.8, 2], map: [-0.18, 0.6, 1.5], hr: [-0.22, 0.6, 1.5], mapCpHigh: [0.25, 2.5, 3] },
  fentanyl: { hyp: [0.2, 0.6, 2], ana: [0.95, 0.35, 2], resp: [0.9, 0.5, 2], hr: [-0.12, 0.6, 1.5], map: [-0.06, 0.6, 1.5], opioid: true },
  lidocaine: { hyp: [0.1, 0.8, 2], ana: [0.35, 0.4, 2], map: [-0.03, 0.6, 1.5] },
  sevoflurane: { hyp: [0.88, 0.35, 2.5], ana: [0.6, 0.9, 2], resp: [0.8, 0.7, 2], map: [-0.28, 1.0, 1.5] },
  rocuronium: { nmb: { kind: 'nondepolarizing', ec50: 0.39, gamma: 4.5 } },
  succinylcholine: { nmb: { kind: 'depolarizing', ec50: 0.39, gamma: 4.5 } },
  glycopyrrolate: { hr: [0.22, 0.5, 2], antimuscarinic: [1, 0.5, 2] },
  phenylephrine: { map: [0.3, 0.5, 1.5], hr: [-0.1, 0.5, 1.5] },
  ephedrine: { map: [0.18, 0.5, 1.5], hr: [0.15, 0.5, 1.5] },
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

/** Patient sensitivity modifiers (illustrative). */
export function patientModifiers(p) {
  const has = (id) => (p.conditions || []).includes(id);
  const flags = p.flags || [];
  let hypSens = 1; if (flags.includes('elderly')) hypSens *= 1.3; if (p.asa >= 3) hypSens *= 1.15;
  let hypoAmp = 1; if (flags.includes('elderly')) hypoAmp *= 1.3; if (p.asa >= 3) hypoAmp *= 1.15;
  for (const c of ['hypovolemia', 'sepsis', 'hf_reduced_ef', 'aortic_stenosis_severe']) if (has(c)) hypoAmp *= 1.5;
  const respSens = (flags.includes('obese') || has('osa') || flags.includes('osaRisk')) ? 1.3 : 1;
  const hrRiseBlunt = (p.medications || []).includes('beta_blocker') ? 0.4 : 1;
  let frcFactor = 1;
  if (flags.includes('morbidObese')) frcFactor = 0.35; else if (flags.includes('obese')) frcFactor = 0.5;
  if (flags.includes('elderly')) frcFactor *= 0.85;
  if (has('copd')) frcFactor *= 0.8;
  const obstruction = (has('osa') || flags.includes('osaRisk')) ? 1.6 : flags.includes('obese') ? 1.3 : 1;
  const k10Mult = {};
  if (flags.includes('severeCkd')) k10Mult.rocuronium = 0.6;
  if (has('liver_disease') || has('severe_hepatic_impairment')) { k10Mult.lidocaine = 0.6; k10Mult.midazolam = 0.6; }
  return { hypSens, hypoAmp: Math.min(hypoAmp, 3), respSens, hrRiseBlunt, frcFactor, obstruction, k10Mult };
}

const eff = (spec, u) => (spec ? spec[0] * sigmoid(u, spec[1], spec[2]) : 0);

/**
 * Combine drug effects.
 * entries: [{ drug, u, cpU }]  (u = normalised Ce; cpU = normalised Cp)
 * Returns hypnosis H (0..1, with opioid synergy), analgesia A, opioid analgesia,
 * respiratory depression D, fractional MAP/HR changes, NMB twitch heights.
 */
export function combineEffects(entries, mods) {
  let antag = 0, achE = 0, antimusc = 0;
  for (const { drug, u } of entries) {
    const pr = profileFor(drug);
    if (pr.opioidAntagonist) antag = Math.max(antag, eff(pr.opioidAntagonist, u));
    if (pr.anticholinesterase) achE = Math.max(achE, eff(pr.anticholinesterase, u));
    if (pr.antimuscarinic) antimusc = Math.max(antimusc, eff(pr.antimuscarinic, u));
  }
  let notH = 1, notA = 1, notAop = 1, notD = 1, mapF = 0, hrF = 0;
  let nd = 0, dep = 0;
  for (const { drug, u: u0, cpU } of entries) {
    const pr = profileFor(drug);
    let u = u0;
    if (pr.opioid) u = u0 / (1 + 10 * antag);
    const uh = u * mods.hypSens;
    notH *= 1 - eff(pr.hyp, uh);
    const a = eff(pr.ana, u);
    notA *= 1 - a;
    if (pr.opioid) notAop *= 1 - a;
    notD *= 1 - eff(pr.resp, u * mods.respSens);
    let m = eff(pr.map, u);
    if (m < 0) m *= mods.hypoAmp;
    if (pr.mapCpHigh) m += eff(pr.mapCpHigh, cpU || 0);
    mapF += m;
    let h = eff(pr.hr, u);
    if (drug.id === 'neostigmine' || pr.anticholinesterase) h *= 1 - antimusc; // glycopyrrolate blocks muscarinic bradycardia
    hrF += h;
    if (pr.nmb) {
      if (pr.nmb.kind === 'depolarizing') dep = Math.max(dep, u);
      else nd += u; // additive normalised non-depolarising concentration
    }
  }
  const Hraw = 1 - notH;
  const Aop = 1 - notAop;
  const H = Math.min(1, Hraw + 0.5 * Aop * Hraw * (1 - Hraw));
  // Neuromuscular junction (illustrative): T1..T4 twitch heights; fade only for non-depolarising block.
  // Neostigmine (anticholinesterase) shifts EC50 up by ≤ 60 % — a ceiling effect, so it cannot reverse deep block.
  const ndProf = PROFILES.rocuronium.nmb, dpProf = PROFILES.succinylcholine.nmb;
  const shift = 1 + 0.6 * achE;
  const twitch = (k) => 1 - sigmoid(nd, ndProf.ec50 * shift * [1, 0.85, 0.7, 0.55][k], ndProf.gamma);
  const depT = 1 - sigmoid(dep, dpProf.ec50, dpProf.gamma);
  const T = [0, 1, 2, 3].map((k) => twitch(k) * depT);
  return {
    H, Hraw, A: 1 - notA, Aop, D: 1 - notD,
    mapFrac: Math.max(-0.6, Math.min(0.6, mapF)), hrFrac: Math.max(-0.6, Math.min(0.8, hrF)),
    twitches: T, block: 1 - T[0], antimuscarinic: antimusc, anticholinesterase: achE,
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
