// Illustrative physiology: ventilation, oxygenation, CO2, haemodynamics, depth index.
// Pure; no DOM. Deterministic given the injected RNG.
// Published relations used: alveolar gas equation (PAO2 = FiO2·713 − PaCO2/0.8 at
// sea level) and the Severinghaus 1979 oxyhaemoglobin dissociation approximation
// SO2 = 100 / (23400/(PO2³ + 150·PO2) + 1). Every rate constant, gain and time
// constant here is an ILLUSTRATIVE engine assumption, not a validated model.

import { sedationLevelFromDepth } from './pd.js';

export const severinghaus = (po2) => (po2 <= 0 ? 0 : 100 / (23400 / (po2 * po2 * po2 + 150 * po2) + 1));

function invertSeveringhaus(s) {
  let lo = 1, hi = 600;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (severinghaus(m) < s) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const PHYS = Object.freeze({
  O2_CONSUMPTION_MMHG_PER_MIN: 70,  // apnoeic fall of PAO2 with normal FRC (illustrative; ≈ VO2/FRC × 713)
  VENT_EQUIL_PER_MIN: 1.4,          // alveolar wash-in rate at normal ventilation (illustrative)
  CO2_APNOEA_RISE_PER_MIN: 4,       // illustrative
  APNOEA_DRIVE_THRESHOLD: 0.8,      // respiratory depression above which spontaneous breathing stops
  CONTROLLED_RR: 12,
});

// Remaining ILLUSTRATIVE gains/time constants used in Physiology.step (author estimates; values
// unchanged from the original literals — collected here so sim.modelInfo() can list them).
export const GAINS = Object.freeze({
  STIM_ANALGESIA_BLUNT: 0.8, STIM_HYPNOSIS_BLUNT: 0.4, STIM_MAP_GAIN: 0.4, STIM_HR_GAIN: 0.35,
  HYPERCAPNIA_PACO2_MMHG: 60, HYPERCAPNIA_MAP_HR_FRAC: 0.1,
  HYPOXAEMIA_SAO2_TACHY: 85, HYPOXAEMIA_SAO2_BRADY: 70, HYPOXAEMIA_TACHY_FRAC: 0.15, HYPOXAEMIA_BRADY_FRAC: 0.3,
  MAP_TAU_SEC: 15, HR_TAU_SEC: 10, DEPTH_TAU_SEC: 8, SPO2_LAG_SEC: 12,
  DEPTH_AWAKE: 97, DEPTH_HYPNOSIS_SPAN: 72, DEPTH_STIM_GAIN: 18,
  AA_SECURED_ADD_MMHG: 5, AA_FIO2_FACTOR: 1.5, ETCO2_GAP_MMHG: 4,
  OBSTRUCTION_H_START: 0.55, OBSTRUCTION_H_SPAN: 0.3, JAW_THRUST_OBSTRUCTION_MULT: 0.2,
  MASK_VENT_EFFECTIVE: 0.85, MASK_VENT_LARYNGOSPASM: 0.15,
});

export class Physiology {
  constructor(patient, mods, rng) {
    this.p = patient; this.mods = mods; this.rng = rng;
    const b = patient.baseline;
    this.map0 = patient.map; this.hr0 = b.hr; this.pp0 = b.sbp - b.dbp; this.rr0 = b.rr;
    // Calibrate A–a gradient so room-air SpO2 equals the patient's baseline.
    const S95 = severinghaus(95);
    if (b.spo2 >= S95) { this.aa0 = 5; this.spo2Offset = b.spo2 - S95; } else { this.aa0 = Math.max(5, 100 - invertSeveringhaus(b.spo2)); this.spo2Offset = 0; }
    this.paco2 = 40; this.pao2 = 100; this.sao2 = severinghaus(100 - this.aa0);
    this.spo2 = Math.min(100, this.sao2 + this.spo2Offset);
    this.map = this.map0; this.hr = this.hr0; this.depth = 97;
    this.noise = { hr: 0, map: 0, spo2: 0, rr: 0, depth: 0, etco2: 0 };
    this.apnoeaSec = 0;
    this.out = null;
  }

  /** Spontaneous ventilation fraction (0..1) given drug effects and airway, before support. */
  spontaneous(effects, airway, ev) {
    const D = effects.D;
    let s = D >= PHYS.APNOEA_DRIVE_THRESHOLD ? 0 : 1 - Math.pow(D / PHYS.APNOEA_DRIVE_THRESHOLD, 2);
    // Diaphragm is relatively spared: respiratory muscle failure only beyond 50 % T1 depression.
    const musc = clamp(1 - (effects.block - 0.5) / 0.4, 0, 1);
    s *= musc;
    // Hypercapnic chemoreflex (blunted by depressants).
    if (s > 0) s = Math.min(1, s * (1 + Math.max(0, this.paco2 - 40) / 40 * 0.5 * (1 - D)));
    const capability = s; // for extubation readiness (independent of obstruction)
    if (!airway.secured) {
      let obs = clamp((effects.H - GAINS.OBSTRUCTION_H_START) / GAINS.OBSTRUCTION_H_SPAN, 0, 1) * this.mods.obstruction;
      obs = clamp(obs, 0, 1);
      if (airway.jawThrust) obs *= GAINS.JAW_THRUST_OBSTRUCTION_MULT;
      s *= 1 - 0.8 * obs;
    }
    if (ev.laryngospasm) s = 0;
    s *= ev.ventFactor;
    return { s: clamp(s, 0, 1), capability };
  }

  step(h, { effects, airway, stimulus, ev }) {
    const dtMin = h / 60; const rng = this.rng; const m = this.mods;
    // ---- ventilation
    const sp = this.spontaneous(effects, airway, ev);
    let veff = sp.s, rr, supported = false;
    if (airway.secured && airway.ventilated) { veff = 1 * ev.ventFactor; rr = PHYS.CONTROLLED_RR; supported = true; }
    else if (airway.maskVentilation) { veff = Math.max(sp.s, (ev.laryngospasm ? GAINS.MASK_VENT_LARYNGOSPASM : GAINS.MASK_VENT_EFFECTIVE) * ev.ventFactor); rr = PHYS.CONTROLLED_RR; supported = true; }
    else rr = sp.s > 0.05 ? Math.max(4, this.rr0 * (0.35 + 0.65 * Math.min(1, sp.s))) : 0;
    const apnoeic = !supported && veff < 0.05;
    this.apnoeaSec = apnoeic ? this.apnoeaSec + h : 0;

    // ---- oxygen (alveolar store; FRC factor speeds desaturation in obesity)
    const pio2 = airway.fio2 * 713;
    // Blood O2 store buffers the alveolar fall on the steep part of the dissociation curve
    // (capacitance ∝ FRC + blood O2 content slope; ~850 mL blood O2 vs ~3.5 mL/mmHg alveolar; illustrative).
    const pa = Math.max(15, this.pao2 - this.aa0);
    const dSdP = (severinghaus(pa + 0.5) - severinghaus(pa - 0.5)) / 100;
    const cap = m.frcFactor + 243 * dSdP * Math.min(1, m.frcFactor + 0.3);
    // FRC (obesity/OSA/elderly/COPD) scales only the O2 store `cap` (time course of apnoeic
    // desaturation and of wash-in), NOT the steady-state balance: with adequate ventilation the
    // equilibrium PAO2 = PIO2 − VO2-term/(ventilation) is independent of FRC (alveolar gas equation).
    // (Fix 2026-11-05: the ventilation term was previously multiplied by frcFactor, which drove an
    // awake, unmedicated obese patient's equilibrium PAO2 below the floor — SpO2 ≈ 40 % on room air.)
    const dP = (veff * PHYS.VENT_EQUIL_PER_MIN * (pio2 - this.pao2) - PHYS.O2_CONSUMPTION_MMHG_PER_MIN) / cap;
    this.pao2 = clamp(this.pao2 + dP * dtMin, 15, pio2);
    const aa = (this.aa0 + ev.aaAdd + (airway.secured ? GAINS.AA_SECURED_ADD_MMHG : 0)) * (1 + GAINS.AA_FIO2_FACTOR * (airway.fio2 - 0.21));
    const pao2art = Math.max(15, this.pao2 - aa);
    this.sao2 = severinghaus(pao2art);
    const spo2True = clamp(this.sao2 + this.spo2Offset * (this.sao2 / 100), 40, 100);
    this.spo2 += (spo2True - this.spo2) * (1 - Math.exp(-h / GAINS.SPO2_LAG_SEC)); // circulation/averaging lag

    // ---- CO2
    if (veff < 0.05) this.paco2 += PHYS.CO2_APNOEA_RISE_PER_MIN * dtMin;
    else {
      const target = Math.min(110, 40 / veff);
      this.paco2 += clamp((target - this.paco2) / 1.5, -10, 5) * dtMin;
    }
    this.paco2 = clamp(this.paco2, 15, 130);

    // ---- stimulus response (blunted by analgesia and hypnosis)
    const R = stimulus * (1 - GAINS.STIM_ANALGESIA_BLUNT * effects.A) * (1 - GAINS.STIM_HYPNOSIS_BLUNT * effects.H);
    // ---- haemodynamics (fractional changes, first-order lags)
    let mapF = effects.mapFrac + GAINS.STIM_MAP_GAIN * R + ev.mapFrac + (ev.fluidMapFrac || 0);
    let hrRise = effects.hrFrac + GAINS.STIM_HR_GAIN * R + ev.hrFrac;
    if (this.paco2 > GAINS.HYPERCAPNIA_PACO2_MMHG) { mapF += GAINS.HYPERCAPNIA_MAP_HR_FRAC; hrRise += GAINS.HYPERCAPNIA_MAP_HR_FRAC; }
    if (this.sao2 < GAINS.HYPOXAEMIA_SAO2_TACHY && this.sao2 >= GAINS.HYPOXAEMIA_SAO2_BRADY) hrRise += GAINS.HYPOXAEMIA_TACHY_FRAC; else if (this.sao2 < GAINS.HYPOXAEMIA_SAO2_BRADY) hrRise -= GAINS.HYPOXAEMIA_BRADY_FRAC;
    if (hrRise > 0) hrRise *= m.hrRiseBlunt;
    const mapT = clamp(this.map0 * (1 + mapF), 25, 200);
    const hrT = clamp(this.hr0 * (1 + hrRise) * ev.hrMult, 25, 200);
    this.map += (mapT - this.map) * (1 - Math.exp(-h / GAINS.MAP_TAU_SEC));
    this.hr += (hrT - this.hr) * (1 - Math.exp(-h / GAINS.HR_TAU_SEC));

    // ---- depth index (illustrative; not BIS)
    const depthT = clamp(GAINS.DEPTH_AWAKE - GAINS.DEPTH_HYPNOSIS_SPAN * effects.H + GAINS.DEPTH_STIM_GAIN * R, 0, 100);
    this.depth += (depthT - this.depth) * (1 - Math.exp(-h / GAINS.DEPTH_TAU_SEC));

    // ---- seeded small noise (AR(1))
    const ar = (k, sd) => { this.noise[k] = 0.95 * this.noise[k] + sd * Math.sqrt(1 - 0.95 * 0.95) * rng.normal(); return this.noise[k]; };
    const hr = clamp(this.hr + ar('hr', 1.5), 25, 200);
    const map = clamp(this.map + ar('map', 1.5), 25, 200);
    const pp = this.pp0 * clamp(this.map / this.map0, 0.4, 1.6);
    const spo2 = clamp(this.spo2 + ar('spo2', 0.3), 40, 100);
    const depth = clamp(this.depth + ar('depth', 1), 0, 100);
    const rrOut = rr > 0 ? clamp(rr + (supported ? 0 : ar('rr', 0.5)), 0, 40) : 0;
    const gap = GAINS.ETCO2_GAP_MMHG + ev.etco2GapAdd;
    // NOTE (per SPEC): EtCO2 shown tracks the rising CO2 during apnoea, although a real
    // capnograph shows no waveform without exhaled gas.
    const etco2 = clamp(this.paco2 - gap + ar('etco2', 0.4), 0, 120);
    this.out = {
      hr: Math.round(hr), sbp: Math.round(map + (2 / 3) * pp), dbp: Math.round(map - pp / 3), map: Math.round(map),
      spo2: Math.round(spo2), rr: Math.round(rrOut), etco2: Math.round(etco2),
      depthIndex: Math.round(depth), sedationLevel: sedationLevelFromDepth(depth),
      // internal (not part of state.vitals)
      _true: { hr: this.hr, map: this.map, spo2: this.spo2, sao2: this.sao2, pao2: this.pao2, paco2: this.paco2, veff, spontaneousCapability: sp.capability, spontaneousRr: sp.capability > 0.05 ? this.rr0 * (0.35 + 0.65 * Math.min(1, sp.capability)) : 0, apnoeic, apnoeaSec: this.apnoeaSec, supported, depth: this.depth },
    };
    return this.out;
  }
}
