// Simulation orchestrator (SPEC §5). Pure; no DOM; deterministic per seed.
// EDUCATIONAL SIMULATION with fictional patients. Not a medical device.
// All model outputs are illustrative (see pk.js / pd.js / physiology.js).

import { resolveLibrary, getDrug, listDrugs, findSourceId } from './library.js';
import { derivePatient, scalarWeight } from './patient.js';
import { evaluateContraindications, interpretCeilings, recommend, convertRateSafe } from './dosing.js';
import { createPkModel, isInhaled, isNitrous, referenceRegimen, ROUTE_KA_ILLUSTRATIVE } from './pk.js';
import { combineEffects, patientModifiers, tofFromTwitches, SEDATION_RANK, PROFILES } from './pd.js';
import { Physiology } from './physiology.js';
import { buildParameterInventory } from './inventory.js';
import { InterlockCore, pythonLockouts, CONTROLLED, PY_TO_SIM_ID, SIM_TO_PY_ID, PY_RATE_UNITS, NOA_CONFIG } from './interlocks.js';
import { AlarmManager } from './alarms.js';
import { convertAmount, rateToAmountPerMin, isFiniteNumber, roundSig, parseRateUnit } from './units.js';
import { getScenario } from '../data/scenarios.js';
import { createRng as createRngLocal } from './rng.js';

export const PHASES = ['premed', 'sedation', 'induction', 'maintenance', 'emergence'];
export const MIN_FIO2_WITH_N2O = 0.30;
// Molecular weights for 1:1 sugammadex–rocuronium encapsulation (rocuronium bromide
// 609.7 g/mol; sugammadex sodium 2178 g/mol, as stated in the respective labels to the
// engine author's knowledge — verify). Binding kinetics are instantaneous (illustrative).
export const MW = Object.freeze({ rocuronium: 609.7, sugammadex: 2178 });

// IV crystalloid bolus (non-drug action `fluid_bolus[:<mL>]`). ILLUSTRATIVE volume-restoration
// model — every constant is an author estimate (not sourced, not validated):
//  * the ordered volume runs in at RUN_ML_PER_MIN; the intravascularly retained volume R decays
//    first-order with RETENTION_TAU_MIN (redistribution of crystalloid out of the circulation);
//  * restoration r = 1 − exp(−R / RESTORE_SCALE_ML) gives diminishing returns (0 → 1);
//  * a volume-loss event (scenario perturbation `volumeLoss: true`, i.e. hemorrhage) has its
//    intensity multiplied by (1 − EVENT_COUNTER_MAX × r): fluids can offset at most 80 % of the
//    loss (ongoing bleeding needs surgical control) — this is the documented cap;
//  * a direct MAP effect + DIRECT_MAP_FRAC × r: small when euvolaemic, larger with the
//    hypovolemia or sepsis condition.
export const FLUID_MODEL = Object.freeze({
  ALLOWED_ML: Object.freeze([250, 500]), DEFAULT_ML: 500,
  RUN_ML_PER_MIN: 50, RETENTION_TAU_MIN: 40, RESTORE_SCALE_ML: 750, EVENT_COUNTER_MAX: 0.8,
  DIRECT_MAP_FRAC: Object.freeze({ euvolaemic: 0.04, depleted: 0.10 }),
  DEPLETED_CONDITIONS: Object.freeze(['hypovolemia', 'sepsis']),
  SEPSIS_CONTEXT_ML_PER_KG: 30,
});

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Simulator alarm thresholds (SPEC §5.2 'Additional simulator alarms'; author/SPEC choices, not
// clinical standards) and extubation-readiness criteria. TOFR 0.9 is from Thilen 2023; the
// interlock thresholds (MAP 60, HR 48) come from config.yaml via interlocks.js.
export const ALARM_THRESHOLDS = Object.freeze({
  SPO2_LOW: 90, SPO2_LOW_CLEAR: 92, APNOEA_SEC: 30, MAP_LOW: 65, MAP_LOW_CLEAR: 67, MAP_HIGH: 120, MAP_HIGH_CLEAR: 118,
  HR_HIGH: 120, HR_HIGH_CLEAR: 118, MAP_CRITICAL_CLEAR: 62, HR_CRITICAL_CLEAR: 50, TOFR_EXTUBATION: 0.9,
});
// Nociceptive stimulus profile and other orchestrator constants (ILLUSTRATIVE author estimates).
export const STIMULUS = Object.freeze({
  INCISION: 0.9, INCISION_SEC: 120, MAINTENANCE: 0.55, CLOSING: 0.3, CLOSING_SEC: 300,
  LARYNGOSCOPY_SEC: 150, LARYNGOSCOPY_DECAY_SEC: 70, TUBE_IN_SITU: 0.25,
  EXTUBATION: 0.6, EXTUBATION_SEC: 60, EXTUBATION_DECAY_SEC: 25,
  SUGAMMADEX_ROC_KE0_MULT: 4, DES_RAPID_RISE_HR: 0.15, DES_RAPID_RISE_MAP: 0.1, DES_RAPID_RISE_START_MAC: 0.5,
});
export const EXTUBATION_CRITERIA = Object.freeze({ DEPTH_AWAKE: 80, RR_MIN: 8, CAPABILITY_MIN: 0.6, SPO2_MIN: 94, MAP_MIN: 65, MAP_MAX: 110, HR_MIN: 50, HR_MAX: 110 });

export function createSimulation({ patient, plan = null, seed = 1, interlocks = true, library = null } = {}) {
  return new Simulation({ patient, plan, seed, interlocks, library });
}

function normalizePlan(plan) {
  const p = plan || { mode: 'GA', sedationTarget: null, steps: [] };
  const steps = (p.steps || []).map((s, i) => ({ id: s.id || `step${i + 1}`, order: isFiniteNumber(s.order) ? s.order : i, atSec: isFiniteNumber(s.atSec) ? s.atSec : 0, ...s }));
  return { mode: p.mode === 'MAC' ? 'MAC' : 'GA', sedationTarget: p.sedationTarget || null, steps };
}

class Simulation {
  constructor({ patient, plan, seed, interlocks, library }) {
    this.lib = resolveLibrary(library);
    this.patient = patient && patient.derived ? patient : derivePatient(patient, { library: this.lib });
    this.plan = normalizePlan(plan);
    this.seed = seed;
    this.mods = patientModifiers(this.patient);
    this.rng = null;
    this._init(seed, interlocks);
  }

  _init(seed, interlocksEnabled) {
    const p = this.patient;
    this.phys = new Physiology(p, this.mods, (this.rng = makeRng(seed)));
    this.alarmMgr = new AlarmManager((t, kind, msg) => this._log(kind, msg));
    const pulse = this.alarmMgr.pulse.bind(this.alarmMgr);
    this.alarmMgr.pulse = (...args) => { pulse(...args); if (this.state) this.state.alarms = this.alarmMgr.list(); };
    this.models = {};
    this.timed = [];
    this.events = [];
    this.armed = [];
    this.stim = { laryngoscopyAt: null, surgeryStartAt: null, surgeryEndAt: null, extubatedAt: null };
    this.phaseStart = { premed: 0 };
    this.executed = new Map();
    this.stats = { timeMapBelow65Sec: 0, minSpo2: Infinity, maxHr: -Infinity, minHr: Infinity, interlockEvents: [], extubation: null };
    this.maskVentSec = 0;
    this.depots = [];
    this.fluid = { retainedMl: 0, pendingMl: 0, sepsisNoteLogged: false };
    this.sgxShownWarn = false;
    this.lastEffects = null;
    this.recCache = new Map();
    this.ceilings = {};
    this.rateWeight = {};
    this._ilLast = {}; this._ilLoggedStatus = null; this._ilStatusT = -Infinity; this._alarmOn = new Set();

    // Lockouts: library lock rules + Python free-text lockouts (config.yaml) on condition/allergy ids and labels.
    const lockouts = {};
    for (const d of listDrugs(this.lib)) {
      const locks = evaluateContraindications(p, d.id, this.lib).filter((c) => c.severity === 'lock').map((c) => c.message);
      if (locks.length) lockouts[d.id] = locks;
      this.ceilings[d.id] = interpretCeilings(d, p);
      this.rateWeight[d.id] = rateWeightFor(d, p);
    }
    const labelOf = (list, id) => { const x = (this.lib[list] || []).find((e) => e.id === id); return x ? x.label : ''; };
    const freeText = (ids, list) => ids.flatMap((id) => [id.replace(/_/g, ' '), labelOf(list, id)]).filter(Boolean);
    const pyLocks = pythonLockouts({ egfr: p.egfr, allergies: freeText(p.allergies, 'ALLERGIES'), comorbidities: freeText(p.conditions, 'CONDITIONS') });
    const pySrc = (this.lib.SOURCE_IDS_ENGINE && this.lib.SOURCE_IDS_ENGINE.pythonConfig) || null;
    for (const py of pyLocks) {
      const id = PY_TO_SIM_ID[py];
      if (!getDrug(this.lib, id)) continue;
      (lockouts[id] = lockouts[id] || []).push(`Python controller configured lockout (config.yaml${pySrc ? ` [${pySrc}]` : ''}; case-insensitive free-text match)`);
    }
    this.core = new InterlockCore({ hardLockouts: pyLocks });
    if (!interlocksEnabled) this.core.status = 'DISABLED';

    const drugs = {};
    for (const d of listDrugs(this.lib)) {
      const inh = isInhaled(d);
      drugs[d.id] = { cp: 0, ce: 0, unitConc: 0, infusionRate: 0, rateUnit: inh ? '%' : defaultRateUnit(d), cumulative: 0, amountUnit: inh ? '%·h' : d.amountUnit };
    }
    this._lastRate = Object.fromEntries(Object.keys(drugs).map((k) => [k, 0]));
    const b = p.baseline;
    this.state = {
      tSec: 0, phase: 'premed', running: false,
      vitals: { hr: b.hr, sbp: b.sbp, dbp: b.dbp, map: Math.round(p.map), spo2: b.spo2, rr: b.rr, etco2: 36, depthIndex: 97, sedationLevel: 'awake', tofCount: 4, tofRatio: 1 },
      sensors: { hr: 'ok', map: 'ok', spo2: 'ok' },
      drugs,
      airway: { secured: false, ventilated: false, maskVentilation: false, fio2: 0.21, jawThrust: false },
      fluids: { crystalloidMl: 0, infusingMl: 0, boluses: [] },
      surgery: { stimulus: 'none' },
      alarms: [],
      interlocks: { enabled: !!interlocksEnabled, status: interlocksEnabled ? 'INITIALIZING' : 'DISABLED', holdLatched: false, heldDrugs: [], lockouts },
      log: [],
    };
    this._log('phase', 'Simulation created (premed). Educational simulation — fictional patient.');
    for (const [id, r] of Object.entries(lockouts)) this._log('interlock', `Lockout: ${getDrug(this.lib, id).name} — ${r.join('; ')}`);
  }

  _log(kind, message) { this.state.log.push({ tSec: Math.round(this.state.tSec * 10) / 10, kind, message }); }

  // ------------------------------------------------------------------ models
  _model(drugId) {
    if (!this.models[drugId]) {
      const drug = getDrug(this.lib, drugId);
      const k10Mult = this.mods.k10Mult[drugId] || 1;
      const rr = referenceRegimen(drug);
      const volumeWeightKg = rr && rr.reg.scalar ? scalarWeight(this.patient, rr.reg.scalar).weightKg : this.patient.weightKg;
      const concomitantOpioid = drug.pkModel === 'eleveld' ? this._concomitantForEleveld() : false;
      this.models[drugId] = createPkModel(drug, this.patient, { k10Mult, volumeWeightKg, concomitantOpioid });
      if (this.models[drugId].type === 'eleveld') this._log('event', `${drug.name} PK: Eleveld 2018 published model (arterial), concomitant opioid/local-anaesthetic covariate ${concomitantOpioid ? 'ON' : 'OFF'} (fixed for the case). Illustrative depth/haemodynamic effects.`);
    }
    return this.models[drugId];
  }

  /** Eleveld covariate: opioid or IV local anaesthetic in the plan (any phase) or already given. */
  _concomitantForEleveld() {
    const isCo = (id) => { const d = getDrug(this.lib, id); return !!d && (d.cls === 'opioid' || d.cls === 'local'); };
    return this.plan.steps.some((s) => s.kind !== 'stop' && isCo(s.drugId)) || Object.keys(this.models).some(isCo);
  }

  _rec(drugId, key) {
    const k = `${drugId}|${key}`;
    if (!this.recCache.has(k)) this.recCache.set(k, recommend(this.patient, key, drugId, this.lib));
    return this.recCache.get(k);
  }

  _rangeCheck(drug, kind, value, unit) {
    // In range if inside the sourced range of ANY regimen of that kind (bolus also checks loading ranges).
    const ranges = [];
    for (const [key, reg] of Object.entries(drug.regimens || {})) {
      if (!reg) continue;
      const rec = this._rec(drug.id, key);
      if (kind === 'bolus') {
        for (const d of [reg.kind === 'bolus' ? rec.dose : null, rec.loading]) if (d && isFiniteNumber(d.range.min) && isFiniteNumber(d.range.max)) ranges.push({ key, min: d.range.min, max: d.range.max, unit: d.unit, v: value });
      } else if ((kind === 'infusion' || kind === 'inhaled') && rec.rate && reg.kind === kind) {
        const v = rec.rate.unit === unit ? value : convertRateSafe(value, unit, rec.rate.unit, this.rateWeight[drug.id]);
        if (v !== null && isFiniteNumber(rec.rate.range.min) && isFiniteNumber(rec.rate.range.max)) ranges.push({ key, min: rec.rate.range.min, max: rec.rate.range.max, unit: rec.rate.unit, v });
      }
    }
    if (!ranges.length) return null;
    if (ranges.some((r) => r.v >= r.min - 1e-9 && r.v <= r.max + 1e-9)) return null;
    const r = ranges[0];
    const far = r.v > r.max * 1.5 || r.v < r.min * 0.5;
    return { priority: far ? 'medium' : 'low', message: `${drug.name} ${roundSig(r.v)} ${r.unit} is outside the sourced ${r.key} range ${r.min}–${r.max} ${r.unit}` };
  }

  _tof() { return { count: this.state.vitals.tofCount, ratio: this.state.vitals.tofRatio }; }

  _runtimeWarnings(drug, cmd = null) {
    const out = [];
    const rules = Array.isArray(drug.runtimeRules) ? drug.runtimeRules : [];
    const tof = this._tof();
    const notMinimal = tof.count < 4 || tof.ratio < 0.4;
    for (const r of rules) {
      if (/tof/i.test(r.id || r.when || '') && notMinimal) out.push(`${r.message}${r.sources && r.sources.length ? ` [${r.sources.join(', ')}]` : ''} (current TOF count ${tof.count}, TOFR ${tof.ratio.toFixed(2)})`);
    }
    for (const r of rules) {
      if (/rapid/i.test(r.id || '') && cmd && isFiniteNumber(cmd.rate)) {
        const m = this._model(drug.id); const cur = this.state.drugs[drug.id].infusionRate || 0;
        if (m.type === 'volatile' && cmd.rate - cur > 0.5 * m.macAgeAdjusted) out.push(`${r.message}${r.sources && r.sources.length ? ` [${r.sources.join(', ')}]` : ''}`);
      }
    }
    if (!rules.length && drug.id === 'neostigmine' && notMinimal) out.push(`Neostigmine is effective only at minimal depth of block (TOFR ≥ 0.4); current TOF count ${tof.count}, TOFR ${tof.ratio.toFixed(2)}.`);
    return out;
  }

  // ------------------------------------------------------------------ administration
  administer(cmd, meta = {}) {
    const res = (ok, blocked, reasons, warnings) => {
      const r = { ok, blocked, reasons, warnings };
      const drug = getDrug(this.lib, cmd && cmd.drugId);
      const name = drug ? drug.name : String(cmd && cmd.drugId);
      if (blocked) {
        this._log('dose', `BLOCKED ${name} ${describe(cmd)}: ${reasons.join('; ')}`);
        this.alarmMgr.pulse(this.state.tSec, 'dose_blocked', 'medium', `${name} blocked: ${reasons[0]}`);
      }
      return r;
    };
    if (!cmd || typeof cmd !== 'object') return res(false, true, ['Invalid command'], []);
    const drug = getDrug(this.lib, cmd.drugId);
    if (!drug) return res(false, true, [`Unknown drug '${cmd.drugId}'`], []);
    const ds = this.state.drugs[drug.id];
    const kind = cmd.kind;
    const warnings = [];
    if (kind === 'stop') {
      this._setRate(drug, 0, ds.rateUnit);
      this._log('dose', `${drug.name} stopped${meta.source === 'plan' ? ' (plan)' : ''}`);
      return res(true, false, [], []);
    }
    if (this.state.interlocks.lockouts[drug.id]) return res(false, true, this.state.interlocks.lockouts[drug.id], []);
    for (const c of evaluateContraindications(this.patient, drug.id, this.lib)) if (c.severity === 'warn') warnings.push(c.message);
    const limits = this.ceilings[drug.id];

    if (kind === 'bolus') {
      if (!isFiniteNumber(cmd.amount) || cmd.amount <= 0) return res(false, true, ['Bolus amount must be a positive number'], []);
      const routes = Array.isArray(drug.bolusRoutes) && drug.bolusRoutes.length ? drug.bolusRoutes : ['IV'];
      const route = typeof cmd.route === 'string' && cmd.route ? cmd.route.toUpperCase() : routes[0];
      if (!routes.includes(route)) return res(false, true, [`${drug.name}: no sourced ${route} bolus dose; sourced bolus route(s): ${routes.join(', ')}${drug.id === 'epinephrine' ? ' (push-dose IV epinephrine not included: no label/guideline dose verified)' : ''}`], []);
      let amt;
      try { amt = convertAmount(cmd.amount, cmd.amountUnit || drug.amountUnit, drug.amountUnit); } catch (e) { return res(false, true, [e.message], []); }
      const pendingTimed = this.timed.filter((x) => x.drugId === drug.id).reduce((a, x) => a + x.remaining, 0);
      for (const L of limits) {
        if (L.type === 'bolus' && amt > L.absolute + 1e-9) return res(false, true, [`Single dose above ${L.label}`], warnings);
        if (L.type === 'cumulative' && ds.cumulative + pendingTimed + amt > L.absolute + 1e-9) return res(false, true, [`Cumulative dose would exceed ${L.label}${L.daily ? ' (daily limit applied to this session)' : ''}`], warnings);
      }
      warnings.push(...this._runtimeWarnings(drug));
      const rc = this._rangeCheck(drug, 'bolus', amt, drug.amountUnit);
      if (rc) { warnings.push(rc.message); this.alarmMgr.pulse(this.state.tSec, 'dose_range', rc.priority, rc.message); }
      const model = this._model(drug.id);
      const overSec = route === 'IV' && isFiniteNumber(cmd.overSec) && cmd.overSec >= 60 ? cmd.overSec : null;
      if (route !== 'IV') { this.depots.push({ drugId: drug.id, remaining: amt, ka: ROUTE_KA_ILLUSTRATIVE[route] ?? ROUTE_KA_ILLUSTRATIVE.IM, route }); ds.cumulative += amt; }
      else if (overSec) this.timed.push({ drugId: drug.id, perMin: amt / (overSec / 60), remaining: amt });
      else { model.model.bolus(amt); ds.cumulative += amt; }
      this._onDrugGiven(drug);
      this._log('dose', `${drug.name} ${roundSig(amt)} ${drug.amountUnit} ${route === 'IV' ? 'bolus' : `${route} injection (illustrative absorption)`}${overSec ? ` over ${Math.round(overSec / 60)} min` : ''}${meta.source === 'plan' ? ' (plan)' : ''}${warnings.length ? ` — warnings: ${warnings.join('; ')}` : ''}`);
      return res(true, false, [], warnings);
    }

    if (kind === 'infusion' || kind === 'inhaled') {
      const rate = cmd.rate; const unit = cmd.rateUnit || ds.rateUnit;
      if (!isFiniteNumber(rate) || rate < 0) return res(false, true, ['Rate must be a non-negative number'], []);
      const inh = isInhaled(drug);
      if (inh !== (kind === 'inhaled')) return res(false, true, [`${drug.name} is ${inh ? 'an inhaled agent (use kind "inhaled", %)' : 'not an inhaled agent'}`], []);
      if (inh) {
        warnings.push(...this._runtimeWarnings(drug, cmd));
        if (unit !== '%') return res(false, true, ['Inhaled agents are set in % (dial)'], []);
        for (const L of limits) if (L.type === 'dial' && rate > L.value + 1e-9) return res(false, true, [`Dial above ${L.label}`], warnings);
        if (isNitrous(drug)) {
          const maxO2 = 1 - rate / 100;
          if (maxO2 < MIN_FIO2_WITH_N2O - 1e-9) {
            this.alarmMgr.pulse(this.state.tSec, 'fio2_n2o', 'medium', `N2O ${rate}% would leave FiO2 ${maxO2.toFixed(2)} < ${MIN_FIO2_WITH_N2O}`);
            return res(false, true, [`N2O ${rate}% would reduce FiO2 below ${MIN_FIO2_WITH_N2O} (O2 + N2O fractions cannot exceed 1)`], warnings);
          }
          if (this.state.airway.fio2 > maxO2 + 1e-9) { this.state.airway.fio2 = Math.round(maxO2 * 100) / 100; warnings.push(`FiO2 reduced to ${this.state.airway.fio2} to make room for N2O ${rate}%`); }
        }
      } else {
        try { rateToAmountPerMin(rate, unit, drug.amountUnit, this.rateWeight[drug.id]); } catch (e) { return res(false, true, [e.message], []); }
        for (const L of limits) {
          if (L.type !== 'rate') continue;
          const cap = convertRateSafe(L.value, L.rateUnit, unit, L.weightKg ?? this.rateWeight[drug.id]);
          if (cap !== null && rate > cap + 1e-9) return res(false, true, [`Rate above ${L.label}`], warnings);
        }
        for (const L of limits) if (L.type === 'cumulative' && rate > 0 && ds.cumulative >= L.absolute - 1e-9) return res(false, true, [`Cumulative ceiling already reached (${L.label})`], warnings);
        const py = SIM_TO_PY_ID[drug.id];
        if (this.state.interlocks.enabled && py && CONTROLLED.includes(py)) {
          if (this.core.holdLatched && this.core.heldDrugs.has(py) && rate > 0) return res(false, true, [`${drug.name} is held by a latched interlock; use resume_hold first`], warnings);
          const pyRate = convertRateSafe(rate, unit, PY_RATE_UNITS[py], this.rateWeight[drug.id]);
          const ceil = NOA_CONFIG.simulation_rate_ceilings[py];
          if (pyRate === null || pyRate > ceil + 1e-12) return res(false, true, [`Rate above the Python simulation ceiling ${ceil} ${PY_RATE_UNITS[py]} (config.yaml simulation_rate_ceilings; applies while interlocks are on)`], warnings);
        }
      }
      const rc = this._rangeCheck(drug, kind, rate, unit);
      if (rc) { warnings.push(rc.message); this.alarmMgr.pulse(this.state.tSec, 'dose_range', rc.priority, rc.message); }
      this._setRate(drug, rate, unit);
      if (rate > 0) this._onDrugGiven(drug);
      this._log('dose', `${drug.name} ${kind === 'inhaled' ? 'dial' : 'infusion'} ${rate} ${unit}${meta.source === 'plan' ? ' (plan)' : ''}${warnings.length ? ` — warnings: ${warnings.join('; ')}` : ''}`);
      return res(true, false, [], warnings);
    }
    return res(false, true, [`Unknown administration kind '${kind}'`], []);
  }

  _setRate(drug, rate, unit) {
    const ds = this.state.drugs[drug.id];
    ds.infusionRate = rate; ds.rateUnit = unit || ds.rateUnit;
    this._lastRate[drug.id] = rate;
    if (rate === 0 && !this.models[drug.id]) return;
    const m = this._model(drug.id);
    if (m.type === 'volatile') m.model.setDial(rate);
    else m.model.setInfusion(rate > 0 ? rateToAmountPerMin(rate, ds.rateUnit, drug.amountUnit, this.rateWeight[drug.id]) : 0);
  }

  _onDrugGiven(drug) {
    for (const e of this.events) {
      const rb = e.def.perturbation.resolvedBy;
      if (rb && Array.isArray(rb.drugs) && rb.drugs.includes(drug.id) && !e.resolved) { e.resolved = true; e.resolvedAt = this.state.tSec; this._log('event', `${e.def.label} resolving after ${drug.name}`); }
    }
  }

  // ------------------------------------------------------------------ phases, actions, events
  setPhase(phase) {
    if (!PHASES.includes(phase)) return { ok: false, message: `Unknown phase '${phase}'` };
    this.state.phase = phase;
    if (this.phaseStart[phase] === undefined) this.phaseStart[phase] = this.state.tSec;
    this._log('phase', `Phase: ${phase}`);
    return { ok: true, message: `Phase ${phase}` };
  }

  play() { this.state.running = true; }
  pause() { this.state.running = false; }

  action(id) {
    const a = this.state.airway; const t = this.state.tSec;
    const ok = (message) => { this._log('action', message); return { ok: true, message }; };
    const no = (message) => ({ ok: false, message });
    if (typeof id !== 'string') return no('Invalid action');
    if (id.startsWith('set_fio2:')) {
      const v = Number(id.slice(9));
      if (!isFiniteNumber(v) || v < 0.21 || v > 1) return no('FiO2 must be between 0.21 and 1');
      const n2o = this._n2oPct();
      if (v > 1 - n2o / 100 + 1e-9) return no(`FiO2 ${v} not possible with N2O ${n2o}% (O2 + N2O ≤ 1)`);
      a.fio2 = v; return ok(`FiO2 set to ${v}`);
    }
    if (id === 'fluid_bolus' || id.startsWith('fluid_bolus:')) {
      const ml = id === 'fluid_bolus' ? FLUID_MODEL.DEFAULT_ML : Number(id.slice(12));
      if (!FLUID_MODEL.ALLOWED_ML.includes(ml)) return no(`Fluid bolus must be ${FLUID_MODEL.ALLOWED_ML.join(' or ')} mL crystalloid`);
      const F = this.state.fluids;
      F.crystalloidMl += ml; this.fluid.pendingMl += ml; F.infusingMl = Math.round(this.fluid.pendingMl);
      F.boluses.push({ tSec: t, ml, kind: 'crystalloid' });
      const perKg = F.crystalloidMl / this.patient.weightKg;
      let msg = `Crystalloid bolus ${ml} mL started (cumulative ${F.crystalloidMl} mL, ${roundSig(perKg, 3)} mL/kg TBW; illustrative volume model)`;
      if ((this.patient.conditions || []).includes('sepsis') && perKg >= FLUID_MODEL.SEPSIS_CONTEXT_ML_PER_KG && !this.fluid.sepsisNoteLogged) {
        const src = (this.lib.SOURCE_IDS_ENGINE && this.lib.SOURCE_IDS_ENGINE.sepsisFluids) || null;
        this.fluid.sepsisNoteLogged = true;
        msg += ` — context: Surviving Sepsis Campaign 2021 suggests at least 30 mL/kg IV crystalloid within the first 3 h for sepsis-induced hypoperfusion or septic shock (weak recommendation)${src ? ` [${src}]` : ''}`;
      }
      return ok(msg);
    }
    if (id.startsWith('acknowledge:')) {
      const aid = id.slice(12);
      const r = this.alarmMgr.acknowledge(aid); this.state.alarms = this.alarmMgr.list();
      return r ? ok(`Alarm acknowledged: ${aid}`) : no(`No alarm '${aid}'`);
    }
    switch (id) {
      case 'secure_airway': {
        if (a.secured) return no('Airway already secured');
        a.secured = true; a.maskVentilation = false; a.jawThrust = false; this.stim.laryngoscopyAt = t; this.state.surgery.stimulus = 'laryngoscopy';
        const v = this.state.vitals; const notes = [];
        if (v.depthIndex > 70) notes.push('depth index > 70: light for laryngoscopy (illustrative)');
        if (v.tofCount > 0 && this.lastEffects && this.lastEffects.block < 0.9) notes.push('neuromuscular block incomplete');
        return ok(`Airway secured (tracheal tube)${notes.length ? ' — ' + notes.join('; ') : ''}`);
      }
      case 'mask_ventilate': if (a.secured) return no('Airway is secured; use the ventilator'); a.maskVentilation = !a.maskVentilation; this.maskVentSec = 0; return ok(a.maskVentilation ? 'Bag-mask ventilation started' : 'Bag-mask ventilation stopped');
      case 'stop_mask_ventilation': a.maskVentilation = false; return ok('Bag-mask ventilation stopped');
      case 'jaw_thrust': a.jawThrust = !a.jawThrust; return ok(a.jawThrust ? 'Jaw thrust applied' : 'Jaw thrust released');
      case 'release_jaw_thrust': a.jawThrust = false; return ok('Jaw thrust released');
      case 'start_ventilation': if (!a.secured) return no('Secure the airway before mechanical ventilation (or mask ventilate)'); a.ventilated = true; return ok('Mechanical ventilation started');
      case 'stop_ventilation': a.ventilated = false; return ok('Mechanical ventilation stopped');
      case 'start_surgery': this.stim.surgeryStartAt = t; this.stim.surgeryEndAt = null; this.state.surgery.stimulus = 'incision'; return ok('Surgery started (incision)');
      case 'end_surgery': this.stim.surgeryEndAt = t; this.state.surgery.stimulus = 'closing'; return ok('Surgery ended (closing)');
      case 'extubate': {
        if (!a.secured) return no('No tracheal tube to remove');
        const r = this.extubationReadiness();
        this.stats.extubation = { tSec: t, ...r };
        if (this.state.vitals.tofRatio < ALARM_THRESHOLDS.TOFR_EXTUBATION) this.alarmMgr.pulse(t, 'tofr_extubation', 'high', `Extubation with TOFR ${this.state.vitals.tofRatio.toFixed(2)} < 0.9`);
        a.secured = false; a.ventilated = false; this.stim.extubatedAt = t;
        for (const def of this.armed.splice(0)) this._startEvent(def);
        return ok(`Extubated — readiness ${r.ready ? 'met' : 'NOT met: ' + r.criteria.filter((c) => !c.met).map((c) => c.label).join(', ')}`);
      }
      case 'resume_hold': {
        if (!this.state.interlocks.enabled) return no('Interlocks are disabled');
        if (!this.core.holdLatched) return no('No latched hold');
        const was = this.core.resumeHold();
        this.stats.interlockEvents.push({ tSec: t, code: 'resume_hold', message: `Hold released by user (${was.join(', ') || 'none held'})` });
        this._log('interlock', `Hold released by explicit user action (resume_hold); held: ${was.join(', ') || 'none'}. Infusions do not restart automatically.`);
        return ok('Hold released');
      }
      default: return no(`Unknown action '${id}'`);
    }
  }

  _n2oPct() { let s = 0; for (const d of listDrugs(this.lib)) if (isNitrous(d)) s += this.state.drugs[d.id].infusionRate || 0; return s; }

  inject(eventId) {
    const def = getScenario(eventId);
    if (!def) return { ok: false, message: `Unknown event '${eventId}'` };
    if (def.perturbation.armOnExtubation && this.state.airway.secured) {
      this.armed.push(def); this._log('event', `${def.label} armed (occurs at extubation)`);
      return { ok: true, message: `${def.label} armed` };
    }
    this._startEvent(def);
    return { ok: true, message: def.label };
  }

  _startEvent(def) {
    this.events.push({ def, startSec: this.state.tSec, resolved: false, resolvedAt: null });
    this._log('event', `Event: ${def.label} — ${def.description}`);
  }

  _eventIntensity(e, t) {
    const p = e.def.perturbation; const dt = t - e.startSec;
    let I = p.rampSec > 0 ? clamp(dt / p.rampSec, 0, 1) : 1;
    const holdEnd = p.holdSec === null || p.holdSec === undefined ? Infinity : (p.rampSec || 0) + p.holdSec;
    let endAt = e.resolved ? e.resolvedAt - e.startSec : holdEnd;
    if (dt > endAt) I *= p.resolveSec > 0 ? clamp(1 - (dt - endAt) / p.resolveSec, 0, 1) : 0;
    return I;
  }

  // ------------------------------------------------------------------ stepping
  step(dtSec = 1) {
    if (!isFiniteNumber(dtSec) || dtSec <= 0) throw new Error('step(dtSec): dtSec must be a positive number');
    const n = Math.ceil(dtSec - 1e-9);
    const h = dtSec / n;
    for (let i = 0; i < n; i++) this._substep(h);
    return this.state;
  }

  _substep(h) {
    const S = this.state; const lib = this.lib;
    S.tSec = Math.round((S.tSec + h) * 1e6) / 1e6;
    const t = S.tSec; const dtMin = h / 60;

    // 1. plan scheduler (phase-relative atSec, then order)
    const due = this.plan.steps.filter((s) => !this.executed.has(s.id) && this.phaseStart[s.phase] !== undefined && t >= this.phaseStart[s.phase] + s.atSec - 1e-9)
      .sort((a, b) => (this.phaseStart[a.phase] + a.atSec) - (this.phaseStart[b.phase] + b.atSec) || a.order - b.order);
    for (const s of due) {
      const r = this.administer({ drugId: s.drugId, kind: s.kind, amount: s.amount, amountUnit: s.amountUnit, rate: s.rate, rateUnit: s.rateUnit, overSec: s.overSec, route: s.route }, { source: 'plan' });
      this.executed.set(s.id, { tSec: t, ...r });
    }

    // 2a. fluids (illustrative): run-in, then first-order loss of retained intravascular volume
    if (this.fluid.pendingMl > 0) {
      const run = Math.min(this.fluid.pendingMl, FLUID_MODEL.RUN_ML_PER_MIN * dtMin);
      this.fluid.pendingMl -= run; this.fluid.retainedMl += run;
      if (this.fluid.pendingMl <= 1e-9) { this.fluid.pendingMl = 0; this._log('action', `Crystalloid bolus run-in complete (cumulative ${S.fluids.crystalloidMl} mL)`); }
      S.fluids.infusingMl = Math.round(this.fluid.pendingMl);
    }
    this.fluid.retainedMl *= Math.exp(-dtMin / FLUID_MODEL.RETENTION_TAU_MIN);
    const fluidR = 1 - Math.exp(-this.fluid.retainedMl / FLUID_MODEL.RESTORE_SCALE_ML);
    const depleted = (this.patient.conditions || []).some((c) => FLUID_MODEL.DEPLETED_CONDITIONS.includes(c));

    // 2. events
    const ev = { mapFrac: 0, hrFrac: 0, hrMult: 1, ventFactor: 1, aaAdd: 0, etco2GapAdd: 0, stimulus: 0, laryngospasm: false, sensors: new Set(),
      fluidMapFrac: (depleted ? FLUID_MODEL.DIRECT_MAP_FRAC.depleted : FLUID_MODEL.DIRECT_MAP_FRAC.euvolaemic) * fluidR };
    const H0 = this.lastEffects ? this.lastEffects.H : 0;
    for (const e of this.events) {
      let I = this._eventIntensity(e, t);
      if (I <= 0) continue;
      const p = e.def.perturbation;
      for (const [k, f] of Object.entries(p.counteredBy || {})) {
        const E = k === '_hypnosis' ? H0 : k === 'glycopyrrolate' ? (this.lastEffects ? this.lastEffects.antimuscarinic : 0)
          : k === '_bronchodilation' ? (this.lastEffects ? this.lastEffects.bronchodilation || 0 : 0) : 0;
        I *= 1 - f * E;
      }
      if (p.volumeLoss) I *= 1 - FLUID_MODEL.EVENT_COUNTER_MAX * fluidR;
      if (p.laryngospasm && this.state.airway.maskVentilation && p.resolvedBy && this.maskVentSec >= (p.resolvedBy.maskVentilationSec || Infinity) && !e.resolved) { e.resolved = true; e.resolvedAt = t; this._log('event', `${e.def.label} broken by positive-pressure mask ventilation`); }
      ev.mapFrac += (p.mapFrac || 0) * I; ev.hrFrac += (p.hrFrac || 0) * I;
      if (p.hrMult) ev.hrMult *= 1 - (1 - p.hrMult) * I;
      if (p.ventFactor !== undefined) ev.ventFactor *= 1 - (1 - p.ventFactor) * I;
      ev.aaAdd += (p.aaAdd || 0) * I; ev.etco2GapAdd += (p.etco2GapAdd || 0) * I; ev.stimulus += (p.stimulus || 0) * I;
      if (p.laryngospasm && I > 0.5) ev.laryngospasm = true;
      if (p.sensor && I > 0) ev.sensors.add(p.sensor);
    }
    this.maskVentSec = this.state.airway.maskVentilation ? this.maskVentSec + h : 0;

    // 3. direct writes to state.drugs[*].infusionRate are re-validated (never trusted)
    for (const d of listDrugs(lib)) {
      const ds = S.drugs[d.id];
      if (ds.infusionRate !== this._lastRate[d.id] && !(Number.isNaN(ds.infusionRate) && Number.isNaN(this._lastRate[d.id]))) {
        const v = ds.infusionRate;
        this._log('interlock', `Direct write detected: ${d.name} rate ${String(v)} ${ds.rateUnit} — re-validated by safety layer`);
        const isPy = S.interlocks.enabled && SIM_TO_PY_ID[d.id] && CONTROLLED.includes(SIM_TO_PY_ID[d.id]);
        if (!(isFiniteNumber(v) && v >= 0)) { if (!isPy) this._setRate(d, 0, ds.rateUnit); else this._lastRate[d.id] = v; }
        else {
          try { this._setRate(d, v, ds.rateUnit); } catch { this._setRate(d, 0, ds.rateUnit); }
          if (!isPy) this._enforceLabelRate(d, t);
          else this._labelCheckAfterInterlock = [...(this._labelCheckAfterInterlock || []), d];
        }
      }
    }

    // 4. Python-derived interlocks (1 Hz control iteration), readings = displayed monitor values
    if (S.interlocks.enabled) {
      const inf = {};
      for (const py of CONTROLLED) {
        const id = PY_TO_SIM_ID[py]; const ds = S.drugs[id];
        if (!ds) { inf[py] = 0; continue; }
        const v = ds.infusionRate;
        inf[py] = v === 0 ? 0 : (isFiniteNumber(v) ? (convertRateSafe(v, ds.rateUnit, PY_RATE_UNITS[py], this.rateWeight[id]) ?? NaN) : NaN);
      }
      this.core.infusions = inf;
      const prevStatus = this.core.status; const prevHeld = new Set(this.core.heldDrugs);
      const r = this.core.evaluate(S.vitals.hr, S.vitals.map);
      for (const py of CONTROLLED) {
        const id = PY_TO_SIM_ID[py]; const ds = S.drugs[id];
        if (ds && this.core.infusions[py] === 0 && ds.infusionRate !== 0) { this._setRate(getDrug(lib, id), 0, ds.rateUnit); this._log('interlock', `${getDrug(lib, id).name} set to zero by interlock`); }
      }
      const newHeld = [...this.core.heldDrugs].filter((d) => !prevHeld.has(d));
      // Log/record decisions without flooding: an event code is recorded once per 60 s.
      for (const e of r.events) {
        const last = this._ilLast[e.code];
        if (last === undefined || t - last >= 60 || newHeld.length) {
          this._log('interlock', e.message); this.stats.interlockEvents.push({ tSec: t, code: e.code, message: e.message });
        }
        this._ilLast[e.code] = t;
      }
      if (r.status !== prevStatus && (r.status !== this._ilLoggedStatus) && (t - this._ilStatusT >= 30 || newHeld.length || r.status === 'GREEN')) {
        this._log('interlock', `Interlock status ${r.status}${this.core.holdLatched ? ` (hold latched: ${[...this.core.heldDrugs].map((x) => PY_TO_SIM_ID[x]).join(', ')})` : ''}`);
        this._ilLoggedStatus = r.status; this._ilStatusT = t;
      }
      S.interlocks.status = this.core.status;
      S.interlocks.holdLatched = this.core.holdLatched;
      S.interlocks.heldDrugs = [...this.core.heldDrugs].map((x) => PY_TO_SIM_ID[x]);
    } else {
      for (const d of listDrugs(lib)) { const ds = S.drugs[d.id]; if (!(isFiniteNumber(ds.infusionRate) && ds.infusionRate >= 0)) this._setRate(d, 0, ds.rateUnit); }
    }

    for (const d of this._labelCheckAfterInterlock || []) this._enforceLabelRate(d, t);
    this._labelCheckAfterInterlock = null;

    // 5. lockouts (all drugs) re-enforced every step
    for (const id of Object.keys(S.interlocks.lockouts)) if (S.drugs[id] && S.drugs[id].infusionRate !== 0) { this._setRate(getDrug(lib, id), 0, S.drugs[id].rateUnit); this._log('interlock', `${getDrug(lib, id).name} is locked out — set to zero`); }

    // 6. timed boluses and cumulative ceilings, then PK
    for (const tb of this.timed) {
      const amt = Math.min(tb.remaining, tb.perMin * dtMin);
      const m = this._model(tb.drugId); m.model.bolus(amt); tb.remaining -= amt; S.drugs[tb.drugId].cumulative += amt;
    }
    this.timed = this.timed.filter((x) => x.remaining > 1e-12);
    // non-IV bolus depots (IM/SC): first-order absorption (illustrative ka, pk.js ROUTE_KA_ILLUSTRATIVE)
    for (const dp of this.depots) {
      const amt = dp.remaining * (1 - Math.exp(-dp.ka * dtMin));
      this._model(dp.drugId).model.bolus(amt); dp.remaining -= amt;
    }
    this.depots = this.depots.filter((x) => x.remaining > 1e-9);
    const veffPrev = this.phys.out ? this.phys.out._true.veff : 1;
    for (const [id, m] of Object.entries(this.models)) {
      const ds = S.drugs[id]; const drug = getDrug(lib, id);
      if (m.type === 'volatile') { m.model.step(dtMin, veffPrev); continue; }
      const add = m.model.infusionPerMin * dtMin;
      if (add > 0) {
        for (const L of this.ceilings[id]) if (L.type === 'cumulative' && ds.cumulative + add > L.absolute + 1e-9) {
          this._setRate(drug, 0, ds.rateUnit); this._log('dose', `${drug.name} infusion stopped: cumulative ceiling reached (${L.label})`);
          this.alarmMgr.pulse(t, 'ceiling_reached', 'medium', `${drug.name}: cumulative ceiling reached`);
        }
      }
      ds.cumulative += m.model.infusionPerMin * dtMin;
      let ke0Mult = 1;
      if (id === 'rocuronium' && this.models.sugammadex && this.models.sugammadex.model.a1 > 1e-6) ke0Mult = STIMULUS.SUGAMMADEX_ROC_KE0_MULT;
      m.model.step(dtMin, { ke0Mult });
    }
    // sugammadex encapsulation of rocuronium (1:1 molar, central compartment)
    if (this.models.sugammadex && this.models.rocuronium) {
      const sg = this.models.sugammadex.model, ro = this.models.rocuronium.model;
      const ratio = MW.sugammadex / MW.rocuronium;
      const bind = Math.min(ro.a1, sg.a1 / ratio);
      if (bind > 0) { ro.removeCentral(bind); sg.removeCentral(bind * ratio); }
    }

    // 7. PD
    const entries = []; let totalMac = 0, potentMac = 0;
    for (const [id, m] of Object.entries(this.models)) {
      const ds = S.drugs[id]; const drug = getDrug(lib, id);
      if (m.type === 'volatile') {
        ds.cp = m.model.et; ds.ce = m.model.ce; ds.unitConc = m.model.macFraction; ds.cumulative = m.model.dialPctMin / 60;
        totalMac += ds.unitConc; if (!isNitrous(drug)) potentMac += ds.unitConc;
        continue;
      }
      ds.cp = m.model.cp; ds.ce = m.model.ce;
      const ref = m.ref && m.ref.value;
      ds.unitConc = ref ? m.model.ce / ref : 0;
      entries.push({ drug, u: ds.unitConc, cpU: ref ? m.model.cp / ref : 0 });
    }
    if (totalMac > 0) {
      // Total MAC (sum of agents' age-adjusted MAC fractions) drives hypnosis/immobility/respiratory effect;
      // hypotension is driven by the potent (non-N2O) agents' share.
      const { map: _m, ...noMap } = PROFILES.sevoflurane;
      entries.push({ drug: { id: '_volatile_total', cls: '_volatile', _profile: noMap }, u: totalMac });
      entries.push({ drug: { id: '_volatile_potent', cls: '_volatile', _profile: { map: PROFILES.sevoflurane.map } }, u: potentMac });
    }
    const effects = combineEffects(entries, this.mods);
    this.lastEffects = effects;

    // 8. stimulus
    let stim = 0; let label = 'none'; const st = this.stim;
    if (st.surgeryStartAt !== null && st.surgeryEndAt === null) { const d = t - st.surgeryStartAt; if (d < STIMULUS.INCISION_SEC) { stim = STIMULUS.INCISION; label = 'incision'; } else { stim = STIMULUS.MAINTENANCE; label = 'maintenance'; } }
    else if (st.surgeryEndAt !== null && t - st.surgeryEndAt < STIMULUS.CLOSING_SEC) { stim = STIMULUS.CLOSING; label = 'closing'; }
    if (st.laryngoscopyAt !== null && t - st.laryngoscopyAt < STIMULUS.LARYNGOSCOPY_SEC) { const s = Math.exp(-(t - st.laryngoscopyAt) / STIMULUS.LARYNGOSCOPY_DECAY_SEC); if (s >= stim) { stim = Math.max(stim, s); label = 'laryngoscopy'; } }
    if (S.airway.secured) stim = Math.max(stim, STIMULUS.TUBE_IN_SITU);
    if (st.extubatedAt !== null && t - st.extubatedAt < STIMULUS.EXTUBATION_SEC) stim = Math.max(stim, STIMULUS.EXTUBATION * Math.exp(-(t - st.extubatedAt) / STIMULUS.EXTUBATION_DECAY_SEC));
    stim += ev.stimulus;
    S.surgery.stimulus = label;

    // desflurane: rapid increases may transiently raise HR/MAP — only if the library states it.
    for (const [id, m] of Object.entries(this.models)) {
      if (m.type !== 'volatile' || !libraryMentionsSympathetic(getDrug(lib, id))) continue;
      const rise = Math.max(0, (m.model.dial - m.model.et) / (m.macAgeAdjusted || 1));
      ev.hrFrac += STIMULUS.DES_RAPID_RISE_HR * clamp(rise - STIMULUS.DES_RAPID_RISE_START_MAC, 0, 1); ev.mapFrac += STIMULUS.DES_RAPID_RISE_MAP * clamp(rise - STIMULUS.DES_RAPID_RISE_START_MAC, 0, 1);
    }

    // 9. physiology
    const out = this.phys.step(h, { effects, airway: S.airway, stimulus: stim, ev });
    const tof = tofFromTwitches(effects.twitches);
    for (const k of ['hr', 'map', 'spo2']) S.sensors[k] = ev.sensors.has(k) ? 'fault' : 'ok';
    const V = S.vitals;
    V.hr = S.sensors.hr === 'fault' ? NaN : out.hr;
    V.map = S.sensors.map === 'fault' ? NaN : out.map;
    V.sbp = S.sensors.map === 'fault' ? NaN : out.sbp;
    V.dbp = S.sensors.map === 'fault' ? NaN : out.dbp;
    V.spo2 = S.sensors.spo2 === 'fault' ? NaN : out.spo2;
    V.rr = out.rr; V.etco2 = out.etco2; V.depthIndex = out.depthIndex; V.sedationLevel = out.sedationLevel;
    V.tofCount = tof.count; V.tofRatio = Math.round(tof.ratio * 100) / 100;

    // 10. statistics
    if (isFiniteNumber(V.map) && V.map < 65) this.stats.timeMapBelow65Sec += h;
    if (isFiniteNumber(V.spo2)) this.stats.minSpo2 = Math.min(this.stats.minSpo2, V.spo2);
    if (isFiniteNumber(V.hr)) { this.stats.maxHr = Math.max(this.stats.maxHr, V.hr); this.stats.minHr = Math.min(this.stats.minHr, V.hr); }

    // 11. alarms
    const ok = (x) => isFiniteNumber(x);
    // Level alarms with hysteresis: once on, they stay on until the value is 2 units past the threshold.
    const hy = (id, on, stayOn) => { const a = on || (this._alarmOn.has(id) && stayOn); if (a) this._alarmOn.add(id); else this._alarmOn.delete(id); return a; };
    const target = this.plan.mode === 'MAC' ? this.plan.sedationTarget : null;
    const A = ALARM_THRESHOLDS;
    const conds = [
      { id: 'spo2_low', priority: 'high', message: `SpO2 ${V.spo2}% < ${A.SPO2_LOW}%`, active: hy('spo2_low', ok(V.spo2) && V.spo2 < A.SPO2_LOW, ok(V.spo2) && V.spo2 < A.SPO2_LOW_CLEAR) },
      { id: 'apnea', priority: 'high', message: `Apnoea > ${A.APNOEA_SEC} s without ventilation (${Math.round(out._true.apnoeaSec)} s)`, active: out._true.apnoeaSec > A.APNOEA_SEC },
      { id: 'map_critical', priority: 'high', message: `MAP ${V.map} < 60 mmHg (interlock threshold)`, active: hy('map_critical', ok(V.map) && V.map < NOA_CONFIG.hemodynamic_thresholds.map_critical_low, ok(V.map) && V.map < A.MAP_CRITICAL_CLEAR) },
      { id: 'hr_critical', priority: 'high', message: `HR ${V.hr} < 48 /min (interlock threshold)`, active: hy('hr_critical', ok(V.hr) && V.hr < NOA_CONFIG.hemodynamic_thresholds.hr_critical_low, ok(V.hr) && V.hr < A.HR_CRITICAL_CLEAR) },
      { id: 'map_low', priority: 'medium', message: `MAP ${V.map} < 65 mmHg`, active: hy('map_low', ok(V.map) && V.map < A.MAP_LOW, ok(V.map) && V.map < A.MAP_LOW_CLEAR) },
      { id: 'map_high', priority: 'medium', message: `MAP ${V.map} > 120 mmHg`, active: hy('map_high', ok(V.map) && V.map > A.MAP_HIGH, ok(V.map) && V.map > A.MAP_HIGH_CLEAR) },
      { id: 'hr_high', priority: 'medium', message: `HR ${V.hr} > 120 /min`, active: hy('hr_high', ok(V.hr) && V.hr > A.HR_HIGH, ok(V.hr) && V.hr > A.HR_HIGH_CLEAR) },
      { id: 'sensor_fault_hr', priority: 'high', message: 'HR sensor fault (unusable reading)', active: S.sensors.hr === 'fault' },
      { id: 'sensor_fault_map', priority: 'high', message: 'MAP sensor fault (unusable reading)', active: S.sensors.map === 'fault' },
      { id: 'sensor_fault_spo2', priority: 'high', message: 'SpO2 probe off / sensor fault', active: S.sensors.spo2 === 'fault' },
      { id: 'depth_over_target', priority: 'medium', message: `Sedation deeper than ${target} target (${V.sedationLevel}): airway/ventilation risk`, active: !!target && SEDATION_RANK[V.sedationLevel] > SEDATION_RANK[target] },
      { id: 'interlock_hold', priority: 'medium', message: `Interlock hold latched (${S.interlocks.heldDrugs.join(', ') || 'no infusions running'}); resume_hold required`, active: S.interlocks.enabled && S.interlocks.holdLatched },
    ];
    this.alarmMgr.update(t, conds);
    S.alarms = this.alarmMgr.list();
  }

  _enforceLabelRate(d, t) {
    const ds = this.state.drugs[d.id];
    if (ds.infusionRate > 0 && !this._withinLabelRate(d, ds.infusionRate, ds.rateUnit)) {
      this._setRate(d, 0, ds.rateUnit);
      this._log('interlock', `${d.name}: rate above label ceiling — set to zero`);
      this.alarmMgr.pulse(t, 'dose_blocked', 'medium', `${d.name} rate above label ceiling`);
    }
  }

  _withinLabelRate(drug, rate, unit) {
    for (const L of this.ceilings[drug.id]) {
      if (L.type === 'rate') { const cap = convertRateSafe(L.value, L.rateUnit, unit, L.weightKg ?? this.rateWeight[drug.id]); if (cap !== null && rate > cap + 1e-9) return false; }
      if (L.type === 'dial' && unit === '%' && rate > L.value + 1e-9) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ readouts
  extubationReadiness() {
    const V = this.state.vitals; const tr = this.phys.out ? this.phys.out._true : null;
    const tofSrc = (this.lib.SOURCE_IDS_ENGINE && this.lib.SOURCE_IDS_ENGINE.tofExtubation) || findSourceId(this.lib, 'Thilen') || null;
    const sRr = tr ? tr.spontaneousRr : this.patient.baseline.rr;
    const cap = tr ? tr.spontaneousCapability : 1;
    const X = EXTUBATION_CRITERIA;
    const criteria = [
      { id: 'awake', label: 'Awake (depth index ≥ 80, illustrative)', met: V.depthIndex >= X.DEPTH_AWAKE, value: V.depthIndex, source: 'illustrative' },
      { id: 'tofr', label: 'TOF ratio ≥ 0.9', met: V.tofRatio >= ALARM_THRESHOLDS.TOFR_EXTUBATION, value: V.tofRatio, source: tofSrc },
      { id: 'ventilation', label: 'Adequate spontaneous ventilation (RR ≥ 8, illustrative)', met: sRr >= X.RR_MIN && cap >= X.CAPABILITY_MIN, value: Math.round(sRr), source: 'illustrative' },
      { id: 'spo2', label: 'SpO2 ≥ 94 % (illustrative)', met: isFiniteNumber(V.spo2) && V.spo2 >= X.SPO2_MIN, value: V.spo2, source: 'illustrative' },
      { id: 'hemodynamics', label: 'Haemodynamically stable (MAP 65–110, HR 50–110; illustrative)', met: isFiniteNumber(V.map) && isFiniteNumber(V.hr) && V.map >= X.MAP_MIN && V.map <= X.MAP_MAX && V.hr >= X.HR_MIN && V.hr <= X.HR_MAX, value: { map: V.map, hr: V.hr }, source: 'illustrative' },
    ];
    return { ready: criteria.every((c) => c.met), criteria };
  }

  planStatus() {
    return this.plan.steps.map((s) => ({ id: s.id, phase: s.phase, drugId: s.drugId, kind: s.kind, status: this.executed.has(s.id) ? (this.executed.get(s.id).blocked ? 'blocked' : 'done') : 'pending', result: this.executed.get(s.id) || null }));
  }

  summary() {
    const totals = {};
    for (const [id, ds] of Object.entries(this.state.drugs)) {
      if (ds.cumulative > 0) totals[id] = { amount: roundSig(ds.cumulative), unit: ds.amountUnit, perKg: ds.amountUnit === '%·h' ? null : roundSig(ds.cumulative / this.patient.weightKg), perKgBasis: 'TBW' };
    }
    return {
      durationSec: this.state.tSec, totals,
      timeMapBelow65Sec: Math.round(this.stats.timeMapBelow65Sec),
      minSpo2: isFiniteNumber(this.stats.minSpo2) ? this.stats.minSpo2 : null,
      maxHr: isFiniteNumber(this.stats.maxHr) ? this.stats.maxHr : null,
      minHr: isFiniteNumber(this.stats.minHr) ? this.stats.minHr : null,
      alarms: this.alarmMgr.history.map((a) => ({ ...a })),
      extubation: this.stats.extubation || { tSec: null, ...this.extubationReadiness(), note: 'not extubated; current readiness' },
      interlockEvents: this.stats.interlockEvents.slice(),
      fluids: { crystalloidMl: this.state.fluids.crystalloidMl, perKg: roundSig(this.state.fluids.crystalloidMl / this.patient.weightKg, 3), perKgBasis: 'TBW', boluses: this.state.fluids.boluses.map((b) => ({ ...b })), model: 'illustrative volume-restoration model (author estimates)' },
      modelNote: 'Illustrative model output — educational simulation, fictional patient; not a medical device.',
    };
  }

  /**
   * PK model provenance per drug used so far ({ [drugId]: { type, provenance, reference, parameters } }).
   * The complete parameter inventory (every model parameter with provenance and sourceIds) is
   * attached as the NON-ENUMERABLE property `inventory`, so Object.entries(modelInfo()) still
   * lists drugs only (backward compatible). Same data: sim.parameterInventory().
   */
  modelInfo() {
    const inv = this.parameterInventory();
    const out = Object.fromEntries(Object.entries(this.models).map(([id, m]) => [id, { type: m.type, provenance: m.provenance, reference: m.ref, parameters: inv.filter((x) => x.drugId === id && x.component === 'pk') }]));
    Object.defineProperty(out, 'inventory', { value: inv, enumerable: false });
    return out;
  }

  /** Every model parameter: { component, drugId?, name, value, unit, provenance, sourceIds, note }. */
  parameterInventory() {
    return buildParameterInventory({ lib: this.lib, patient: this.patient, mods: this.mods, models: this.models, fluidModel: FLUID_MODEL, mw: MW, minFio2WithN2O: MIN_FIO2_WITH_N2O, alarmThresholds: ALARM_THRESHOLDS, extubationCriteria: EXTUBATION_CRITERIA, stimulus: STIMULUS });
  }
}

// --------------------------------------------------------------------------
function makeRng(seed) {
  // local import-free wrapper (rng.js) — kept separate for clarity
  return createRngLocal(seed);
}

function defaultRateUnit(drug) {
  const regs = drug.regimens || {};
  for (const k of ['maintenance', 'sedation_moderate', 'sedation_deep', 'sedation_minimal', ...Object.keys(regs)]) if (regs[k] && regs[k].rate && regs[k].rate.unit) return regs[k].rate.unit;
  return null;
}

function rateWeightFor(drug, p) {
  const regs = drug.regimens || {};
  for (const k of ['maintenance', 'sedation_moderate', 'sedation_deep', 'sedation_minimal', ...Object.keys(regs)]) if (regs[k] && regs[k].rate && regs[k].scalar) return scalarWeight(p, regs[k].scalar).weightKg;
  return p.weightKg;
}

function libraryMentionsSympathetic(drug) {
  if (Array.isArray(drug.runtimeRules) && drug.runtimeRules.some((r) => /rapid_concentration_increase/.test(r.id || ''))) return true;
  return false;
}

function describe(cmd) {
  if (!cmd) return '';
  if (cmd.kind === 'bolus') return `${cmd.amount} ${cmd.amountUnit || ''} bolus`;
  if (cmd.kind === 'infusion' || cmd.kind === 'inhaled') return `${cmd.rate} ${cmd.rateUnit || ''}`;
  return cmd.kind || '';
}

export { Simulation };
