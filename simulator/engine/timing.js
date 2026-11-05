// Timing rules: plan timing validator, live timing checks, pre-incision verification and
// state-gated repeat boluses (2026-11 timing review). Pure; no DOM; deterministic.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device, not clinical advice.
//
// Every threshold lives in TIMING_CONFIG (one frozen block). Each entry:
//   { value, unit, rationale, provenance, sourceIds }
// provenance (inventory vocabulary, engine/inventory.js PROVENANCE):
//   'fda_label' | 'guideline' | 'trial_or_physiology_study'  — sourceIds are ids in data/drugs.js SOURCES
//   'simulator_convention'                                   — a teaching choice; NOT sourced (sourceIds empty;
//                                                               a label statement it is anchored to is cited in the rationale text only)
//   'clinical_practice_convention_owner'                     — practice stated by the project owner; not a published source
// The checks only compare times and states; they never give, change or stop a drug.
// A check result: { id, label, status: 'pass' | 'warn' | 'info', message, sources:[ids], provenance }.

import { getDrug, getAntibiotic, resolveLibrary } from './library.js';
import { evaluateWindow, redoseStatus } from './prophylaxis.js';

export const CONVENTION = 'simulator_convention';
export const OWNER_PRACTICE = 'clinical_practice_convention_owner';
export const PROVENANCE_TEXT = Object.freeze({
  fda_label: 'FDA label', guideline: 'guideline / consensus', trial_or_physiology_study: 'trial protocol',
  simulator_convention: 'simulator convention', clinical_practice_convention_owner: 'clinical practice convention (owner)',
});
const e = (value, unit, rationale, provenance = CONVENTION, sourceIds = []) =>
  Object.freeze({ value, unit, rationale, provenance, sourceIds: Object.freeze([...sourceIds]) });

export const TIMING_CONFIG = Object.freeze({
  // ---------------------------------------------------------------- pre-op holding → OR → induction
  PREMED_TO_TRANSFER_SEC: e(300, 's',
    'Premedication midazolam is given in pre-op holding (some centres use the PACU as holding) about 5 min before the patient is rolled to the OR. Counted from the END of the last premedication bolus (midazolam is injected over at least 2 min, label). Label support for waiting at least this long: sedation is achieved within 3 to 5 minutes after IV injection [S17].',
    OWNER_PRACTICE, ['S17']),
  OR_SETUP_SEC: e(120, 's',
    'Transfer to the OR, monitors applied (ECG, NIBP, SpO2) before preoxygenation. No source gives a duration; teaching value.'),
  PREOXYGENATION_SEC: e(180, 's',
    'Preoxygenation (FiO2 1.0 by face mask) before induction. The 3-min tidal-breathing technique is widely described, but no guideline giving this duration was verified, so the value is a simulator convention. Guidelines set an end point, not a time: DAS 2015 — preoxygenate all patients with 100% oxygen until the end-tidal oxygen fraction is 0.87–0.9 (S55); ASA 2022 — supplemental oxygen before initiating difficult-airway management (S56). End-tidal O2 is not modelled (see PREOXYGENATION_END_POINT; timing cross-check 2026-11, TIMING_EVIDENCE.md).'),
  PREOXYGENATION_END_POINT: e('end-tidal O2 fraction 0.87–0.9 (not modelled)', 'fraction',
    'Guideline end point for preoxygenation, recorded for teaching and shown in the Timing evidence page: DAS 2015 — all patients preoxygenated with 100% oxygen, face-mask seal maintained, until the end-tidal oxygen fraction is 0.87–0.9 [S55]; ASA 2022 difficult-airway guideline — supplemental oxygen before initiating difficult-airway management [S56]. The simulator does not model end-tidal O2, so the guided/automatic gate uses the PREOXYGENATION_SEC time convention instead; nothing in the engine reads this value.',
    'guideline', ['S55', 'S56']),
  // ---------------------------------------------------------------- induction order
  OPIOID_LEAD_SEC: e(180, 's',
    'Opioid given about 3 min before the hypnotic so it approaches peak effect before laryngoscopy. Fentanyl label: onset almost immediate IV, but the maximal analgesic and respiratory depressant effect may not be noted for several minutes [S13]; the label gives no number, so 3 min is a simulator convention anchored to that statement.'),
  PRETREATMENT_MAX_GAP_SEC: e(60, 's',
    'Lidocaine pretreatment must be given before propofol and "immediately" before it (propofol label: prior injection of IV lidocaine reduces injection pain [S11]); the 60-s maximum gap and the 10-s template gap are simulator conventions.'),
  NMB_AFTER_HYPNOTIC: e('hypnotic label onset', 's',
    'The intubating neuromuscular blocker is given only after loss of consciousness: no earlier than the hypnotic\'s label onset after the hypnotic (propofol: hypnosis usually within 40 s from the start of injection [S11]; read from the drug library `timing.onsetMin`).',
    'fda_label', ['S11']),
  // ---------------------------------------------------------------- loading → maintenance
  LOADING_THEN_MAINTENANCE: e('loading start + loading duration', 's',
    'A maintenance infusion starts when its loading dose ends (dexmedetomidine: loading over 10 min, followed by the maintenance infusion [S9]; propofol MAC sedation: initiation over 3–5 min, then maintenance [S11]; IV lidocaine: loading over about 10 min, then infusion [S1]). Overlap of the two is flagged.',
    'fda_label', ['S9', 'S11', 'S1']),
  // ---------------------------------------------------------------- MAC: second sedative after midazolam
  MAC_SEDATIVE_AFTER_MIDAZOLAM_SEC: e(240, 's',
    'MAC templates/example plan: a second sedative (propofol initiation) starts no earlier than 4 min after the midazolam bolus starts — midazolam label: give over at least 2 minutes, then wait an additional 2 or more minutes to fully evaluate the sedative effect [S17]; ASA 2018 moderate-sedation guideline: titrate in small increments and allow sufficient time between doses to assess the effect of each [S32]. Timing cross-check 2026-11: mac_propofol and the MAC example plan started propofol at +2:00 (end of the midazolam injection, before its effect could be evaluated) — moved to +4:00. Template offset (data/templates.js); a test keeps them equal.',
    'fda_label', ['S17', 'S32']),
  // ---------------------------------------------------------------- repeat boluses (state/interval gated)
  MIDAZOLAM_REPEAT_MIN_SEC: e(240, 's',
    'No repeat midazolam bolus within 4 min of the previous one: label — give over at least 2 minutes, then wait an additional 2 or more minutes to evaluate the effect [S17].',
    'fda_label', ['S17']),
  ROCURONIUM_TOPUP_TOF_COUNT_MIN: e(3, 'TOF count',
    'A rocuronium top-up (any rocuronium bolus after the first) waits until TOF count ≥ 3: label maintenance doses are administered at 25% recovery of control T1, defined as 3 twitches of train-of-four [S12]. A planned top-up is held (status "waiting") until then; a manual one is logged with a warning.',
    'fda_label', ['S12']),
  // ---------------------------------------------------------------- end of surgery
  DEX_STOP_BEFORE_END_SEC: e(900, 's',
    'Opioid-free template: the dexmedetomidine infusion stops 15 min before the planned end of surgery so its sedative effect is waning at emergence. No label, guideline or verified trial statement gives this interval (published opioid-free protocols vary and were not confirmed in their primary sources), so it is a simulator convention.'),
  // ---------------------------------------------------------------- pre-incision verification
  GA_DEPTH_BAND: e(Object.freeze([40, 60]), 'processed-EEG depth index (BIS-style, simulated)',
    'General-anaesthesia target band 40–60, the protocol target used in the B-Unaware [S52] and BAG-RECALL [S53] trials (neither showed the BIS protocol superior for preventing awareness). Applied to the simulated index, which is an illustrative model output, not a BIS value. Used for the pre-incision item (an index below 40 needs the clinician\'s acknowledgement; above 60 blocks), the tile/trend-chart band, the live timing check (time outside the band during surgery) and, for the upper bound only, the depth-high (awareness-risk) alarm (DEPTH_HIGH_ALARM_*). No alarm below the band: in this illustrative model 1 MAC of a volatile agent often reads just below 40. No sedation bands are used (none verified).',
    'trial_or_physiology_study', ['S52', 'S53']),
  // ---------------------------------------------------------------- depth-high (awareness-risk) alarm (final-check fixes)
  DEPTH_HIGH_ALARM_SUSTAIN_SEC: e(60, 's',
    'HIGH alarm "Processed-EEG index > 60 for ≥ 60 s during general anaesthesia — risk of awareness; check hypnotic delivery" when the simulated index stays above the GA band upper bound (GA_DEPTH_BAND, reused, not redefined) for this long. Armed only in GA with the airway secured after loss of consciousness (index ≤ 60 reached after induction started), in the induction and maintenance phases (surgery and closing included), and not after every maintenance hypnotic is stopped once surgery has ended; never in MAC/sedation or emergence. Any sample at or below 60 restarts the count. The duration is a teaching choice (no source gives one); guided and automatic modes pause for it under the existing HIGH-alarm rule and never acknowledge it.'),
  DEPTH_HIGH_ALARM_CLEAR: e(58, 'processed-EEG depth index (BIS-style, simulated)',
    'Hysteresis of the depth-high alarm: once raised it stays active until the index is at or below this value (2 index units under the band upper bound, the same 2-unit hysteresis as the other simulator level alarms), then stays listed (latched) until acknowledged. Simulator convention.'),
  DEPTH_HIGH_ALARM_PRIORITY: e('high', 'alarm priority',
    'Priority of the depth-high alarm (owner-approved, final-check fixes 2026-11): HIGH, so guided and automatic modes pause for it (AUTORUN_CONFIG.PAUSE_ALARM_PRIORITIES); only the clinician acknowledges it. Simulator convention.'),
  NMB_SURGERY_TOF_COUNT_MAX: e(2, 'TOF count',
    'Pre-incision item when the plan includes a neuromuscular blocker: TOF count ≤ 2. No label gives a surgical-relaxation TOF target; teaching value.'),
  TIME_OUT_REQUIRED: e(true, 'boolean',
    'WHO Surgical Safety Checklist "Time Out" before skin incision (team confirms patient, site and procedure; antibiotic prophylaxis within the last 60 minutes) [S54]. Only the clinician can confirm it; guided and automatic modes never confirm it.',
    'guideline', ['S54']),
  ANTIBIOTIC_REQUIRED_BEFORE_INCISION: e(true, 'boolean',
    'When prophylaxis is indicated, a dose started within its guideline window before incision (Bratzler 2013: within 60 min; vancomycin 120 min [S46]) is a REQUIRED pre-incision item in guided and automatic modes (acknowledging the warning no longer suffices there; manual mode keeps the alarm).',
    'guideline', ['S46']),
});

export const cfgv = (k) => TIMING_CONFIG[k].value;
// Live comparisons allow one simulated second: the engine steps at 1 Hz and a plan step due exactly at
// a phase start runs in that phase's first simulated second (offset-0 steps are 1 s "late").
export const STEP_TOLERANCE_SEC = 1;
const TOL = STEP_TOLERANCE_SEC;
export const PREMED_TO_INDUCTION_MIN_SEC = cfgv('PREMED_TO_TRANSFER_SEC') + cfgv('OR_SETUP_SEC') + cfgv('PREOXYGENATION_SEC');

const fmt = (sec) => { const s = Math.round(sec); const m = Math.floor(Math.abs(s) / 60); return `${s < 0 ? '−' : ''}${m}:${String(Math.abs(s) % 60).padStart(2, '0')}`; };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const cls = (lib, id) => { const d = getDrug(lib, id); return d ? d.cls : null; };
const name = (lib, id) => { const d = getDrug(lib, id) || getAntibiotic(lib, id); return d ? d.name : id; };
const check = (id, label, status, message, sources = [], provenance = CONVENTION) => ({ id, label, status, message, sources: [...sources], provenance });
const src = (k) => [...TIMING_CONFIG[k].sourceIds];
const prov = (k) => TIMING_CONFIG[k].provenance;

/** Is this step a drug bolus (not antibiotic/fluid)? */
const isDrugBolus = (s) => s.kind === 'bolus';
const bolusEnd = (s) => (s.atSec || 0) + (isNum(s.overSec) && s.overSec > 0 ? s.overSec : 0);
export const isHypnoticInduction = (lib, s) => isDrugBolus(s) && s.regimenKey === 'induction' && ['hypnotic', 'nmda'].includes(cls(lib, s.drugId));

/**
 * Loading / maintenance pairs in a list of plan steps: an infusion preceded (same drug) by a loading
 * bolus (loading:true, or a timed bolus of a drug that also has an infusion in the plan).
 * -> [{ loading, infusion, samePhase, overlapSec }]  (overlapSec > 0 = maintenance starts before the loading ends)
 */
export function loadingPairs(steps) {
  const out = [];
  steps.forEach((inf, i) => {
    if (inf.kind !== 'infusion') return;
    const cands = steps.filter((b, j) => b.drugId === inf.drugId && b.kind === 'bolus' && (b.loading || (isNum(b.overSec) && b.overSec >= 60)) && (b.phase !== inf.phase || j !== i));
    const same = cands.filter((b) => b.phase === inf.phase);
    const load = same.length ? same.reduce((a, b) => (bolusEnd(b) > bolusEnd(a) ? b : a)) : cands[cands.length - 1];
    if (!load) return;
    const samePhase = load.phase === inf.phase;
    out.push({ loading: load, infusion: inf, samePhase, anchored: inf.afterLoadingOf === inf.drugId, overlapSec: samePhase ? bolusEnd(load) - (inf.atSec || 0) : null });
  });
  return out;
}

/** Same-phase loading → maintenance: the infusion starts at loading start + loading duration (mutates; returns the changes). */
export function scheduleMaintenanceAfterLoading(steps) {
  const changes = [];
  for (const p of loadingPairs(steps)) {
    if (!p.samePhase || !(p.overlapSec > 0)) continue;
    const from = p.infusion.atSec || 0; p.infusion.atSec = bolusEnd(p.loading);
    changes.push({ drugId: p.infusion.drugId, from, to: p.infusion.atSec });
  }
  return changes;
}

// ======================================================================================= plan checks
/**
 * validatePlanTiming(plan, library) -> checks[]  (plan: engine plan or plan-editor plan; steps need
 * phase, atSec, kind, drugId, regimenKey, overSec, loading, beforeEndSec, afterLoadingOf)
 */
export function validatePlanTiming(plan, library = null) {
  const lib = resolveLibrary(library);
  const steps = (plan && plan.steps) || [];
  const ph = (p) => steps.filter((s) => s.phase === p);
  const out = [];
  const GA = plan.mode !== 'MAC';
  // 1. premedication → induction
  const premedBol = ph('premed').filter(isDrugBolus);
  if (premedBol.length) {
    const end = Math.max(...premedBol.map(bolusEnd));
    out.push(check('premed_interval', 'Premedication → induction', 'pass',
      `Premedication bolus(es) end by premed +${fmt(end)} (pre-op holding). Transfer to the OR is allowed ${cfgv('PREMED_TO_TRANSFER_SEC') / 60} min after the last one ends, then OR setup ${cfgv('OR_SETUP_SEC') / 60} min${GA ? ` and preoxygenation ${cfgv('PREOXYGENATION_SEC') / 60} min` : ''}: ${GA ? 'induction' : 'sedation'} no earlier than ${(GA ? PREMED_TO_INDUCTION_MIN_SEC : PREMED_TO_INDUCTION_MIN_SEC - cfgv('PREOXYGENATION_SEC')) / 60} min after the premedication ends (enforced by the guided/automatic gates; never overlapping).`,
      src('PREMED_TO_TRANSFER_SEC'), prov('PREMED_TO_TRANSFER_SEC')));
  } else out.push(check('premed_interval', 'Premedication → induction', 'info', 'No premedication bolus in the plan.', [], CONVENTION));
  // 2. loading → maintenance
  const pairs = loadingPairs(steps);
  if (!pairs.length) out.push(check('loading_maintenance', 'Loading → maintenance', 'info', 'No loading dose + maintenance infusion pair in the plan.', [], 'fda_label'));
  for (const p of pairs) {
    const n = name(lib, p.infusion.drugId);
    if (p.samePhase) {
      if (p.overlapSec > 0) out.push(check('loading_maintenance', 'Loading → maintenance', 'warn', `${n}: the maintenance infusion (+${fmt(p.infusion.atSec || 0)}) starts before the loading dose ends (+${fmt(bolusEnd(p.loading))}); they overlap by ${fmt(p.overlapSec)}. Start the infusion at +${fmt(bolusEnd(p.loading))}.`, src('LOADING_THEN_MAINTENANCE'), 'fda_label'));
      else out.push(check('loading_maintenance', 'Loading → maintenance', 'pass', `${n}: loading +${fmt(p.loading.atSec || 0)} over ${fmt(p.loading.overSec || 0)}, then maintenance at +${fmt(p.infusion.atSec || 0)} (no overlap).`, src('LOADING_THEN_MAINTENANCE'), 'fda_label'));
    } else if (p.anchored) out.push(check('loading_maintenance', 'Loading → maintenance', 'pass', `${n}: the ${p.infusion.phase} infusion waits until the ${p.loading.phase} loading dose has finished (anchored).`, src('LOADING_THEN_MAINTENANCE'), 'fda_label'));
    else out.push(check('loading_maintenance', 'Loading → maintenance', 'warn', `${n}: loading dose in ${p.loading.phase} and infusion in ${p.infusion.phase} — the infusion may start before the loading dose ends.`, src('LOADING_THEN_MAINTENANCE'), 'fda_label'));
  }
  // 3. opioid → hypnotic
  const ind = ph('induction');
  const opi = ind.filter((s) => isDrugBolus(s) && cls(lib, s.drugId) === 'opioid');
  const hyp = ind.filter((s) => isHypnoticInduction(lib, s));
  const firstBy = (arr) => arr.reduce((a, b) => ((b.atSec || 0) < (a.atSec || 0) ? b : a), arr[0]);
  if (opi.length && hyp.length) {
    const o = firstBy(opi); const hy = firstBy(hyp); const gap = (hy.atSec || 0) - (o.atSec || 0); const lead = cfgv('OPIOID_LEAD_SEC');
    out.push(check('opioid_hypnotic', 'Opioid → hypnotic', gap >= lead ? 'pass' : 'warn', gap >= lead
      ? `${name(lib, o.drugId)} at induction +${fmt(o.atSec || 0)}, ${name(lib, hy.drugId)} at +${fmt(hy.atSec || 0)}: ${fmt(gap)} apart (≥ ${fmt(lead)}).`
      : `${name(lib, hy.drugId)} is only ${fmt(gap)} after ${name(lib, o.drugId)} (convention ≥ ${fmt(lead)}): the opioid will not have approached its peak effect by laryngoscopy (label: maximal effect may not be noted for several minutes [S13]).`,
    ['S13'], prov('OPIOID_LEAD_SEC')));
  } else out.push(check('opioid_hypnotic', 'Opioid → hypnotic', 'info', opi.length ? 'No hypnotic induction bolus in the plan.' : 'No opioid bolus at induction (opioid-free or not planned).', [], prov('OPIOID_LEAD_SEC')));
  // 4. lidocaine pretreatment immediately before propofol
  const pre = ind.filter((s) => s.drugId === 'lidocaine' && s.regimenKey === 'pretreatment');
  const pro = ind.filter((s) => s.drugId === 'propofol' && s.regimenKey === 'induction');
  if (pre.length && pro.length) {
    const a = pre[0]; const b = firstBy(pro); const gap = (b.atSec || 0) - bolusEnd(a);
    const ok = gap >= 0 && steps.indexOf(a) < steps.indexOf(b) && gap <= cfgv('PRETREATMENT_MAX_GAP_SEC');
    out.push(check('pretreatment', 'Lidocaine pretreatment → propofol', ok ? 'pass' : 'warn', ok
      ? `Lidocaine pretreatment at +${fmt(a.atSec || 0)}, propofol at +${fmt(b.atSec || 0)} (immediately before; gap ${fmt(gap)}).`
      : `Lidocaine pretreatment at +${fmt(a.atSec || 0)} is not immediately before propofol at +${fmt(b.atSec || 0)} (must precede it by ≤ ${fmt(cfgv('PRETREATMENT_MAX_GAP_SEC'))}).`, ['S11'], 'fda_label'));
  } else if (pre.length) out.push(check('pretreatment', 'Lidocaine pretreatment → propofol', 'warn', 'Lidocaine pretreatment planned without a propofol induction bolus.', ['S11'], 'fda_label'));
  // 5. NMB after the hypnotic
  const nmb = ind.filter((s) => isDrugBolus(s) && cls(lib, s.drugId) === 'nmb');
  if (nmb.length && hyp.length) {
    const hy = firstBy(hyp); const nb = firstBy(nmb); const d = getDrug(lib, hy.drugId);
    const onset = d && d.timing && isNum(d.timing.onsetMin) ? Math.round(d.timing.onsetMin * 60) : null; const gap = (nb.atSec || 0) - (hy.atSec || 0);
    const ok = onset !== null ? gap >= onset : gap > 0;
    out.push(check('nmb_after_hypnotic', 'Hypnotic → neuromuscular blocker', ok ? 'pass' : 'warn', ok
      ? `${name(lib, nb.drugId)} ${fmt(gap)} after ${name(lib, hy.drugId)} (after loss of consciousness${onset !== null ? `; label onset ${onset} s` : ''}).`
      : `${name(lib, nb.drugId)} at +${fmt(nb.atSec || 0)} is not after loss of consciousness from ${name(lib, hy.drugId)} at +${fmt(hy.atSec || 0)}${onset !== null ? ` (label onset ${onset} s)` : ''}.`,
    d && d.timing && d.timing.sources ? [...d.timing.sources] : [], 'fda_label'));
  } else if (nmb.length) out.push(check('nmb_after_hypnotic', 'Hypnotic → neuromuscular blocker', 'warn', 'Neuromuscular blocker at induction without a hypnotic induction bolus (awake paralysis risk).', [], 'fda_label'));
  // 6. antibiotic prophylaxis
  const abx = steps.filter((s) => s.kind === 'antibiotic');
  const indicated = typeof plan.prophylaxisIndicated === 'boolean' ? plan.prophylaxisIndicated : abx.length > 0;
  if (indicated) {
    const before = abx.filter((s) => ['premed', 'induction', 'sedation'].includes(s.phase));
    if (!before.length) out.push(check('antibiotic_window', 'Antibiotic before incision', 'warn', abx.length ? 'Prophylaxis is planned only after incision phases; it must begin within the guideline window BEFORE incision (Bratzler 2013).' : 'Prophylaxis is indicated but no antibiotic step is planned; the pre-incision gate will require a dose started within the window (Bratzler 2013).', ['S46'], 'guideline'));
    else {
      const a = before[0]; const ab = getAntibiotic(lib, a.drugId === 'auto' ? 'cefazolin' : a.drugId);
      const w = ab && ab.prophylaxis ? ab.prophylaxis : null;
      out.push(check('antibiotic_window', 'Antibiotic before incision', 'pass', `${a.drugId === 'auto' ? 'Guideline agent' : name(lib, a.drugId)} at ${a.phase} +${fmt(a.atSec || 0)}: must begin within ${w ? w.windowBeforeIncisionMin : 60} min before incision${w && w.redoseIntervalMin ? `; redose every ${w.redoseIntervalMin / 60} h from the start of the dose` : ''} (Bratzler 2013). Re-checked at the pre-incision gate.`, ['S46'], 'guideline'));
    }
  } else out.push(check('antibiotic_window', 'Antibiotic before incision', 'info', 'Antibiotic prophylaxis not marked as indicated.', ['S46'], 'guideline'));
  // 7. PONV agents
  for (const [id, want, why] of [['dexamethasone', ['induction', 'premed', 'sedation'], 'at induction'], ['ondansetron', ['emergence'], 'at the end of surgery']]) {
    const st = steps.filter((s) => s.drugId === id && s.kind === 'bolus');
    if (!st.length) continue;
    const bad = st.filter((s) => !want.includes(s.phase));
    out.push(check(`ponv_${id}`, `PONV: ${name(lib, id)}`, bad.length ? 'warn' : 'pass', bad.length ? `${name(lib, id)} planned in ${bad.map((s) => s.phase).join(', ')}; consensus timing is ${why} [S2, S3].` : `${name(lib, id)} ${why} (PONV consensus) [S2, S3].`, ['S2', 'S3'], 'guideline'));
  }
  // 8. reversal only after agents off
  const rev = steps.filter((s) => s.kind === 'bolus' && ['sugammadex', 'neostigmine'].includes(s.drugId));
  for (const r of rev) {
    const offs = steps.filter((s) => s.kind === 'stop' && s.phase === r.phase && ['volatile', 'gas', 'hypnotic'].includes(cls(lib, s.drugId)));
    const lastOff = offs.length ? Math.max(...offs.map((s) => s.atSec || 0)) : null;
    const running = steps.some((s) => (s.kind === 'inhaled' || (s.kind === 'infusion' && cls(lib, s.drugId) === 'hypnotic')) && !steps.some((x) => x.kind === 'stop' && x.drugId === s.drugId));
    const ok = r.phase === 'emergence' && !running && (lastOff === null || (r.atSec || 0) > lastOff);
    out.push(check('reversal', `Reversal (${name(lib, r.drugId)})`, ok ? 'pass' : 'warn', ok
      ? `${name(lib, r.drugId)} at emergence +${fmt(r.atSec || 0)}, after the anaesthetic agents are off; the dose is compared with the TOF depth of block when given (label tiers) [S6].`
      : `${name(lib, r.drugId)} should follow the anaesthetic agents off at emergence (${r.phase !== 'emergence' ? `planned in ${r.phase}` : running ? 'an agent is never stopped' : `planned at +${fmt(r.atSec || 0)}, not after the stop at +${fmt(lastOff)}`}).`, ['S6'], 'fda_label'));
  }
  // 9. repeat boluses
  const mids = steps.filter((s) => s.drugId === 'midazolam' && s.kind === 'bolus');
  for (let i = 1; i < mids.length; i++) {
    const a = mids[i - 1]; const b = mids[i];
    if (a.phase !== b.phase) continue;
    const gap = (b.atSec || 0) - (a.atSec || 0);
    if (gap < cfgv('MIDAZOLAM_REPEAT_MIN_SEC')) out.push(check('repeat_bolus', 'Repeat bolus interval', 'warn', `Midazolam boluses ${fmt(gap)} apart in ${a.phase} (label: over ≥ 2 min, then wait ≥ 2 more min → ≥ ${fmt(cfgv('MIDAZOLAM_REPEAT_MIN_SEC'))}) [S17].`, ['S17'], 'fda_label'));
  }
  const rocs = steps.filter((s) => s.drugId === 'rocuronium' && s.kind === 'bolus');
  if (rocs.length > 1) out.push(check('repeat_bolus', 'Rocuronium top-up', 'pass', `Planned rocuronium top-up(s) wait for TOF count ≥ ${cfgv('ROCURONIUM_TOPUP_TOF_COUNT_MIN')} (label: at 25% recovery of control T1 = 3 twitches of TOF) before they run [S12].`, ['S12'], 'fda_label'));
  // 10. stop-before-end anchors
  for (const s of steps.filter((x) => x.kind === 'stop' && isNum(x.beforeEndSec))) {
    const started = steps.some((x) => x.drugId === s.drugId && (x.kind === 'infusion' || x.kind === 'inhaled'));
    out.push(check('stop_before_end', `Stop before end of surgery (${name(lib, s.drugId)})`, started ? 'pass' : 'warn', started
      ? `${name(lib, s.drugId)} stops ${fmt(s.beforeEndSec)} before the planned end of surgery (automatic demonstration: at planned end − ${fmt(s.beforeEndSec)}; guided/manual: when End surgery is pressed, if not earlier; never later than the start of emergence).`
      : `${name(lib, s.drugId)} stop before the end of surgery, but no ${name(lib, s.drugId)} infusion is planned.`, s.drugId === 'dexmedetomidine' ? [] : [], CONVENTION));
  }
  return out;
}

// ======================================================================================= live (state) helpers
/** Premedication status from the simulation: pending premed boluses and the time the last one ended. */
export function premedStatus(sim) {
  const steps = sim.plan.steps.filter((s) => s.phase === 'premed' && s.kind === 'bolus' && !s.invalid);
  const pending = steps.filter((s) => !sim.executed.has(s.id));
  const done = steps.filter((s) => sim.executed.has(s.id) && !sim.executed.get(s.id).blocked);
  const lastEnd = done.length ? Math.max(...done.map((s) => sim.executed.get(s.id).tSec + (isNum(s.overSec) && s.overSec > 0 ? s.overSec : 0))) : null;
  return { hasPremedBolus: steps.length > 0, pending: pending.length, lastEndSec: lastEnd };
}

/**
 * State-gated repeat bolus (plan scheduler and manual administration).
 * -> null (may proceed) | { reason, sources }
 */
export function repeatBolusHold(sim, drugId) {
  const t = sim.state.tSec; const log = (sim.doseLog || []).filter((d) => d.drugId === drugId && d.kind === 'bolus');
  if (!log.length) return null;
  if (drugId === 'rocuronium') {
    const need = cfgv('ROCURONIUM_TOPUP_TOF_COUNT_MIN'); const c = sim.state.vitals.tofCount;
    if (c < need) return { reason: `rocuronium top-up waits for TOF count ≥ ${need} (now ${c}; label: at 25% recovery of control T1 = 3 twitches of TOF)`, sources: ['S12'] };
  }
  if (drugId === 'midazolam') {
    const last = log[log.length - 1]; const min = cfgv('MIDAZOLAM_REPEAT_MIN_SEC');
    if (t - last.tSec < min - 1e-9) return { reason: `repeat midazolam waits ${Math.ceil(min - (t - last.tSec))} s more (label: over ≥ 2 min, then ≥ 2 min to evaluate)`, sources: ['S17'] };
  }
  return null;
}

/** Analgesia given per plan: an opioid given, or an opioid-free adjunct infusion running. */
function analgesiaState(sim) {
  const lib = sim.lib;
  const opioid = (sim.doseLog || []).some((d) => cls(lib, d.drugId) === 'opioid');
  const adj = ['dexmedetomidine', 'ketamine', 'lidocaine'].filter((id) => sim.state.drugs[id] && sim.state.drugs[id].infusionRate > 0);
  const plannedPending = sim.plan.steps.filter((s) => ['premed', 'induction'].includes(s.phase) && !sim.executed.has(s.id) && !s.invalid && (cls(lib, s.drugId) === 'opioid' || (s.kind === 'infusion' && ['dexmedetomidine', 'ketamine', 'lidocaine'].includes(s.drugId))));
  return { met: (opioid || adj.length > 0) && plannedPending.length === 0, opioid, adj, plannedPending: plannedPending.length };
}

/**
 * Pre-incision verification items (GA) / pre-procedure items (MAC). Each:
 * { id, label, met, detail, sources, provenance, clinician }  (clinician = only the clinician can satisfy it)
 */
export function preIncisionItems(sim, { planMode = sim.plan.mode, sedationCheck = null } = {}) {
  const V = sim.state.vitals; const a = sim.state.airway; const items = [];
  const [lo, hi] = cfgv('GA_DEPTH_BAND');
  if (planMode !== 'MAC') {
    items.push({ id: 'airway', label: 'Airway secured and ventilation running', met: !!(a.secured && a.ventilated), detail: a.secured ? (a.ventilated ? 'tube in, ventilated' : 'not ventilated') : 'airway not secured', sources: [], provenance: CONVENTION, clinician: false });
    items.push({ id: 'depth', label: `Processed-EEG depth index within the GA band ${lo}–${hi}`, met: V.depthIndex >= lo && V.depthIndex <= hi, detail: `index ${V.depthIndex} (simulated; BIS-style)`, sources: src('GA_DEPTH_BAND'), provenance: prov('GA_DEPTH_BAND'), clinician: false });
    const an = analgesiaState(sim);
    items.push({ id: 'analgesia', label: 'Analgesia given per plan (opioid, or opioid-free adjuncts running)', met: an.met, detail: an.met ? (an.opioid ? 'opioid given' : `running: ${an.adj.join(', ')}`) : an.plannedPending ? `${an.plannedPending} planned analgesic step(s) not yet run` : 'no opioid given and no opioid-free adjunct running', sources: [], provenance: CONVENTION, clinician: false });
    const nmbPlanned = sim.plan.steps.some((s) => cls(sim.lib, s.drugId) === 'nmb' && s.kind !== 'stop');
    if (nmbPlanned) items.push({ id: 'nmb', label: `Neuromuscular block adequate (TOF count ≤ ${cfgv('NMB_SURGERY_TOF_COUNT_MAX')})`, met: V.tofCount <= cfgv('NMB_SURGERY_TOF_COUNT_MAX'), detail: `TOF count ${V.tofCount}`, sources: [], provenance: CONVENTION, clinician: false });
  } else if (sedationCheck) items.push({ id: 'sedation', label: 'Sedation target reached (ASA continuum)', met: sedationCheck.met, detail: sedationCheck.detail, sources: ['S31'], provenance: 'guideline', clinician: false });
  const P = sim.state.prophylaxis;
  if (P.indicated) {
    const w = evaluateWindow(P.doses, sim.state.tSec, sim.lib);
    items.push({ id: 'antibiotic', label: 'Antibiotic prophylaxis started within its window before incision', met: w.ok, detail: w.message, sources: ['S46'], provenance: 'guideline', clinician: false, givable: !w.ok });
  }
  const to = sim.state.periop && sim.state.periop.timeOut;
  items.push({ id: 'time_out', label: 'WHO Surgical Safety Checklist “Time Out” confirmed by the clinician', met: !!to, detail: to ? `confirmed at ${fmt(to.tSec)}` : 'not confirmed — only the clinician can confirm it', sources: src('TIME_OUT_REQUIRED'), provenance: 'guideline', clinician: true });
  return items;
}

// ======================================================================================= live checks
/** liveTimingChecks(sim) -> checks[] for the running case (guided panel, debrief). */
export function liveTimingChecks(sim) {
  const lib = sim.lib; const log = sim.doseLog || []; const out = [];
  const t = sim.state.tSec;
  const first = (pred) => log.find(pred) || null;
  // 1. premed → induction
  const pm = premedStatus(sim);
  const indStart = sim.phaseStart.induction !== undefined ? sim.phaseStart.induction : sim.phaseStart.sedation;
  const firstInd = first((d) => d.phase === 'induction' || d.phase === 'sedation');
  if (pm.lastEndSec !== null) {
    const min = sim.plan.mode === 'MAC' ? PREMED_TO_INDUCTION_MIN_SEC - cfgv('PREOXYGENATION_SEC') : PREMED_TO_INDUCTION_MIN_SEC;
    const at = firstInd ? firstInd.tSec : indStart;
    if (at === undefined || at === null) out.push(check('premed_interval', 'Premedication → induction', 'info', `Premedication ended at ${fmt(pm.lastEndSec)}; ${sim.plan.mode === 'MAC' ? 'sedation' : 'induction'} allowed from ${fmt(pm.lastEndSec + min)} (${fmt(Math.max(0, pm.lastEndSec + min - t))} to go).`, src('PREMED_TO_TRANSFER_SEC'), OWNER_PRACTICE));
    else { const gap = at - pm.lastEndSec; out.push(check('premed_interval', 'Premedication → induction', gap >= min - TOL ? 'pass' : 'warn', `First ${sim.plan.mode === 'MAC' ? 'sedation' : 'induction'} drug ${fmt(gap)} after the premedication ended (minimum ${fmt(min)}).`, src('PREMED_TO_TRANSFER_SEC'), OWNER_PRACTICE)); }
  }
  // 2. loading → maintenance overlap
  for (const inf of log.filter((d) => d.kind === 'infusion' && d.rate > 0)) {
    const load = log.filter((d) => d.drugId === inf.drugId && d.kind === 'bolus' && d.overSec && d.tSec <= inf.tSec).pop();
    if (!load) continue;
    const end = load.tSec + load.overSec;
    if (log.filter((d) => d.drugId === inf.drugId && d.kind === 'infusion' && d.rate > 0 && d.tSec < inf.tSec && d.tSec >= load.tSec).length) continue;
    out.push(check('loading_maintenance', 'Loading → maintenance', inf.tSec >= end - 1e-9 ? 'pass' : 'warn', inf.tSec >= end - 1e-9 ? `${name(lib, inf.drugId)} maintenance started at ${fmt(inf.tSec)}, after the loading dose ended (${fmt(end)}).` : `${name(lib, inf.drugId)} maintenance started at ${fmt(inf.tSec)} while the loading dose was still running (until ${fmt(end)}).`, src('LOADING_THEN_MAINTENANCE'), 'fda_label'));
  }
  // 3. opioid → hypnotic, 4. pretreatment, 5. NMB after hypnotic
  const op = first((d) => d.phase === 'induction' && d.kind === 'bolus' && cls(lib, d.drugId) === 'opioid');
  const hy = first((d) => d.phase === 'induction' && d.kind === 'bolus' && d.regimenKey === 'induction' && ['hypnotic', 'nmda'].includes(cls(lib, d.drugId)));
  if (op && hy) { const g = hy.tSec - op.tSec; out.push(check('opioid_hypnotic', 'Opioid → hypnotic', g >= cfgv('OPIOID_LEAD_SEC') - TOL ? 'pass' : 'warn', `${name(lib, hy.drugId)} ${fmt(g)} after ${name(lib, op.drugId)} (convention ≥ ${fmt(cfgv('OPIOID_LEAD_SEC'))}; label: maximal effect after several minutes [S13]).`, ['S13'], CONVENTION)); }
  const pre = first((d) => d.drugId === 'lidocaine' && d.regimenKey === 'pretreatment');
  const pro = first((d) => d.drugId === 'propofol' && d.kind === 'bolus' && d.regimenKey === 'induction');
  if (pre && pro) { const g = pro.tSec - pre.tSec; out.push(check('pretreatment', 'Lidocaine pretreatment → propofol', g >= 0 && g <= cfgv('PRETREATMENT_MAX_GAP_SEC') + TOL ? 'pass' : 'warn', `Pretreatment ${fmt(g)} before propofol (≤ ${fmt(cfgv('PRETREATMENT_MAX_GAP_SEC'))}) [S11].`, ['S11'], 'fda_label')); }
  const nb = first((d) => d.kind === 'bolus' && cls(lib, d.drugId) === 'nmb');
  if (nb && hy) { const d = getDrug(lib, hy.drugId); const on = d && d.timing && isNum(d.timing.onsetMin) ? d.timing.onsetMin * 60 : 0; const g = nb.tSec - hy.tSec; out.push(check('nmb_after_hypnotic', 'Hypnotic → neuromuscular blocker', g >= on - TOL ? 'pass' : 'warn', `${name(lib, nb.drugId)} ${fmt(g)} after ${name(lib, hy.drugId)} (label onset ${Math.round(on)} s).`, d && d.timing ? [...(d.timing.sources || [])] : [], 'fda_label')); }
  // 6. antibiotic window and redose
  const P = sim.state.prophylaxis;
  if (P.indicated) {
    if (P.window) out.push(check('antibiotic_window', 'Antibiotic before incision', P.window.ok ? 'pass' : 'warn', `At incision: ${P.window.message} (Bratzler 2013).`, ['S46'], 'guideline'));
    else { const w = evaluateWindow(P.doses, t, lib); out.push(check('antibiotic_window', 'Antibiotic before incision', w.ok ? 'pass' : 'warn', `If incision were now: ${w.message}.`, ['S46'], 'guideline')); }
    const rd = redoseStatus(P.doses, t, lib);
    if (rd.items.length) out.push(check('antibiotic_redose', 'Antibiotic redose interval', rd.due && sim.stim.surgeryStartAt !== null && sim.stim.surgeryEndAt === null ? 'warn' : 'pass', rd.items.map((x) => `${x.name}: redose due ${fmt(x.dueAtSec)} (every ${x.intervalMin / 60} h)`).join('; '), ['S46'], 'guideline'));
  }
  // 7. PONV
  const dexa = first((d) => d.drugId === 'dexamethasone'); const ond = first((d) => d.drugId === 'ondansetron');
  if (dexa) out.push(check('ponv_dexamethasone', 'PONV: Dexamethasone', dexa.phase === 'induction' || dexa.phase === 'premed' ? 'pass' : 'warn', `Dexamethasone given in ${dexa.phase} (consensus: at induction) [S2, S3].`, ['S2', 'S3'], 'guideline'));
  if (ond) { const ok = sim.stim.surgeryEndAt !== null && ond.tSec >= sim.stim.surgeryEndAt - 1e-9; out.push(check('ponv_ondansetron', 'PONV: Ondansetron', ok ? 'pass' : 'warn', `Ondansetron at ${fmt(ond.tSec)}${sim.stim.surgeryEndAt !== null ? `, end of surgery ${fmt(sim.stim.surgeryEndAt)}` : ''} (consensus: at the end of surgery) [S2, S3].`, ['S2', 'S3'], 'guideline')); }
  // 8. reversal
  for (const r of log.filter((d) => d.kind === 'bolus' && ['sugammadex', 'neostigmine'].includes(d.drugId))) {
    const ok = r.agentsOn.length === 0 && !r.tierWarning;
    out.push(check('reversal', `Reversal (${name(lib, r.drugId)})`, ok ? 'pass' : 'warn', `${name(lib, r.drugId)} at ${fmt(r.tSec)} with TOF count ${r.tofCount}${r.agentsOn.length ? `; still running: ${r.agentsOn.map((id) => name(lib, id)).join(', ')}` : '; agents off'}${r.tierWarning ? `; ${r.tierWarning}` : ''} [S6].`, ['S6'], 'fda_label'));
  }
  // 9. repeat boluses
  for (const h of sim.timingHolds || []) out.push(check('repeat_bolus', 'Repeat bolus condition', h.manual ? 'warn' : 'pass', `${fmt(h.tSec)}: ${h.manual ? 'given manually although' : 'planned step held:'} ${h.reason}.`, h.sources, 'fda_label'));
  // 10. stop-before-end
  for (const s of sim.plan.steps.filter((x) => x.kind === 'stop' && isNum(x.beforeEndSec))) {
    const ex = sim.executed.get(s.id);
    if (!ex) { out.push(check('stop_before_end', `Stop before end of surgery (${name(lib, s.drugId)})`, 'info', `${name(lib, s.drugId)} stop ${fmt(s.beforeEndSec)} before the planned end of surgery — pending${sim.state.periop && isNum(sim.state.periop.plannedSurgeryEndSec) ? ` (due ${fmt(sim.state.periop.plannedSurgeryEndSec - s.beforeEndSec)})` : ' (at End surgery)'}.`, [], CONVENTION)); continue; }
    const end = sim.stim.surgeryEndAt;
    out.push(check('stop_before_end', `Stop before end of surgery (${name(lib, s.drugId)})`, end === null || ex.tSec <= end + 1e-9 ? 'pass' : 'warn', `${name(lib, s.drugId)} stopped at ${fmt(ex.tSec)}${end !== null ? ` (end of surgery ${fmt(end)}, ${fmt(end - ex.tSec)} before)` : ''}.`, [], CONVENTION));
  }
  // 11. depth band during surgery
  if (sim.plan.mode !== 'MAC' && sim.stats && isNum(sim.stats.depthOutOfBandSec) && sim.stim.surgeryStartAt !== null) {
    const [lo, hi] = cfgv('GA_DEPTH_BAND');
    out.push(check('depth_band', 'Processed-EEG index in GA band', sim.stats.depthOutOfBandSec > 0 ? 'warn' : 'pass', `Time outside ${lo}–${hi} during GA maintenance with the airway secured: ${fmt(sim.stats.depthOutOfBandSec)} (simulated index; illustrative).`, src('GA_DEPTH_BAND'), prov('GA_DEPTH_BAND')));
  }
  return out;
}

export { fmt as fmtTimingClock };
