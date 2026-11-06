// Step 3 — Anesthetic plan editor.
import { h, clear, announce, fmtClock, parseClock, isNum } from './dom.js';
import { recommend } from '../engine/dosing.js';
import { EXAMPLE_PLANS, buildPlan } from '../data/scenarios.js';
import { srcTags, sourcesInText } from './sources.js';
import { CLASS_LABELS, CLASS_ORDER, PHASE_LABELS, PHASE_LABELS_MAC, REGIMEN_LABELS, KIND_LABELS, SCALAR_LABELS, fluidCompositionText } from './labels.js';
import { phasesFor, keyForPhase, makeSteps, refillStep, checkStep, planIssues, getDrugById, stepsFromBuiltPlan, interlockCeiling, isInhaledDrug, makeFluidStep, makeAntibioticStep, isFluidStep, prophylaxisIndicated, setProphylaxisIndicated } from './plan-model.js';
import { TECHNIQUE_TEMPLATES, buildTemplatePlan, templateOptions, getTemplate } from '../engine/templates.js';
import { selectProphylaxis } from '../engine/prophylaxis.js';
import { FLUID_MODEL } from '../engine/sim.js';
import { NOA_CONFIG } from '../engine/interlocks.js';
import { validatePlanTiming } from '../engine/timing.js';
import { timingCheckItems, rationaleLine, rationaleText } from './timing-view.js';
import { exportPlan, setLockoutRemoved, noteLockedDeletion, addTivaMaintenance } from './plan-model.js';

export const SEDATION_TARGETS = [
  { id: 'minimal', label: 'Minimal sedation', def: 'Normal response to verbal stimulation.' },
  { id: 'moderate', label: 'Moderate sedation', def: 'Purposeful response to verbal or light tactile stimulation.', co2: true },
  { id: 'deep', label: 'Deep sedation', def: 'Purposeful response after repeated or painful stimulation (reflex withdrawal is not purposeful).', co2: true },
];

export function setMode(plan, mode) {
  plan.stepsByMode = plan.stepsByMode || { GA: [], MAC: [] };
  plan.stepsByMode[plan.mode] = plan.steps;
  plan.mode = mode;
  plan.steps = plan.stepsByMode[mode] || (plan.stepsByMode[mode] = []);
}

export function interlockExplanation(lib) {
  const E = lib.SOURCE_IDS_ENGINE || {};
  const c = NOA_CONFIG;
  return h('div', { class: 'explain' },
    h('p', {}, 'When on, the simulator applies the same safety rules as the Smart NOA Python controller (', h('code', {}, 'config.yaml'), ' ', srcTags([E.pythonConfig]), '):'),
    h('ul', { class: 'list list--tight' },
      h('li', {}, `HR < ${c.hemodynamic_thresholds.hr_critical_low}/min → dexmedetomidine set to zero and the hold latches.`),
      h('li', {}, `MAP < ${c.hemodynamic_thresholds.map_critical_low} mmHg → dexmedetomidine and lidocaine set to zero; hold latches.`),
      h('li', {}, 'An unusable sensor reading (fault) → dexmedetomidine, ketamine and lidocaine infusions zeroed; status RED.'),
      h('li', {}, 'A latched hold never restarts automatically — you must press “Resume hold” (logged), then restart infusions yourself.'),
      h('li', {}, `Simulation rate ceilings: dexmedetomidine ${c.simulation_rate_ceilings.Dexmedetomidine} mcg/kg/h, ketamine ${c.simulation_rate_ceilings.Ketamine} mg/kg/h, lidocaine ${c.simulation_rate_ceilings.Lidocaine} mg/kg/h. These are the Python simulation ceilings, not clinical maxima.`)),
    h('p', { class: 'hint' }, 'When off, those rules are skipped. Label ceilings and contraindication lockouts still apply either way.'));
}

export function renderPlan(ctx, main) {
  const { store, lib } = ctx;
  const patient = ctx.getPatient();
  if (!patient) { ctx.go(1); return; }
  const plan = store.plan;
  const c = () => ({ lib, patient, interlocks: store.interlocks, patientVersion: store.patientVersion });
  const phaseLabels = () => (plan.mode === 'MAC' ? PHASE_LABELS_MAC : PHASE_LABELS);
  const E = lib.SOURCE_IDS_ENGINE || {};

  // ---------- mode
  const modeBox = h('fieldset', { class: 'fieldset' }, h('legend', {}, 'Technique'),
    [['GA', 'General anaesthesia', 'Phases: Induction → Maintenance → Emergence / extubation. Not arousable even by painful stimulation.'],
      ['MAC', 'MAC / procedural sedation', 'Phases: Sedation → End of procedure. Choose a target depth on the ASA continuum.']].map(([id, label, desc]) => {
      const rid = `pl-mode-${id}`;
      const r = h('input', { type: 'radio', name: 'pl-mode', id: rid, value: id, checked: plan.mode === id });
      r.addEventListener('change', () => { if (r.checked) { setMode(plan, id); ctx.planChanged(); renderAll(); announce(`${label} selected.`); document.getElementById(rid).focus(); } });
      return h('div', { class: 'check check--block' }, r, h('label', { for: rid }, h('strong', {}, label), h('span', { class: 'hint block' }, desc)));
    }));

  const targetBox = h('fieldset', { class: 'fieldset', id: 'pl-target', hidden: plan.mode !== 'MAC' },
    h('legend', {}, 'Sedation target (ASA continuum of depth of sedation) ', srcTags([E.sedationContinuum])),
    SEDATION_TARGETS.map((t) => {
      const rid = `pl-target-${t.id}`;
      const r = h('input', { type: 'radio', name: 'pl-target', id: rid, value: t.id, checked: plan.sedationTarget === t.id });
      r.addEventListener('change', () => { if (r.checked) { changeTarget(t.id); document.getElementById(rid).focus(); } });
      return h('div', { class: 'check check--block' }, r, h('label', { for: rid }, h('strong', {}, t.label), h('span', { class: 'hint block' }, t.def),
        t.co2 ? h('span', { class: 'note-co2 block' }, 'Requires exhaled-CO2 (capnography) monitoring ', srcTags([E.monitoring])) : null));
    }),
    h('p', { class: 'hint' }, 'General anaesthesia (for comparison): not arousable even by painful stimulation. The monitor raises a medium alarm if the simulated sedation level goes deeper than the target.'));

  function changeTarget(t) {
    plan.sedationTarget = t;
    const key = keyForPhase('sedation', t);
    let refilled = 0, unavailable = 0;
    for (const s of plan.steps.filter((x) => x.phase === 'sedation' && x.kind !== 'stop' && !isFluidStep(x) && x.kind !== 'antibiotic')) {
      const d = getDrugById(lib, s.drugId);
      s.regimenKey = key;
      if (d.regimens && d.regimens[key]) { refillStep(c(), s); refilled++; } else unavailable++;
    }
    ctx.planChanged(); renderAll();
    announce(`Target ${t}. ${refilled} sedation step(s) re-filled from the ${REGIMEN_LABELS[key]} regimen${unavailable ? `; ${unavailable} step(s) have no sourced regimen for this target and must be removed` : ''}.`);
  }

  // ---------- interlocks + seed
  const ilId = 'pl-interlocks';
  const ilBox = h('input', { type: 'checkbox', id: ilId, checked: store.interlocks });
  ilBox.addEventListener('change', () => { store.interlocks = ilBox.checked; ctx.planChanged(); renderAll(); document.getElementById(ilId).focus(); announce(`Interlocks ${ilBox.checked ? 'on' : 'off'}.`); });
  const seedIn = h('input', { type: 'number', id: 'pl-seed', class: 'input input--num', min: 1, max: 999999, step: 1, value: store.seed });
  seedIn.addEventListener('change', () => { const v = Math.round(Number(seedIn.value)); store.seed = isNum(v) && v >= 1 ? v : 1; seedIn.value = store.seed; ctx.planChanged(); });

  // ---------- example plans
  const exSel = h('select', { id: 'pl-example', class: 'input' }, h('option', { value: '' }, 'Choose an example plan…'),
    EXAMPLE_PLANS.map((p) => h('option', { value: p.id }, p.label)));
  const exBtn = h('button', { type: 'button', class: 'btn' }, 'Load example plan');
  exBtn.addEventListener('click', () => {
    const t = EXAMPLE_PLANS.find((p) => p.id === exSel.value);
    if (!t) { exSel.focus(); return; }
    const { plan: built, skipped } = buildPlan(t, patient, lib);
    setMode(plan, t.mode); plan.sedationTarget = t.sedationTarget || plan.sedationTarget;
    plan.steps.splice(0, plan.steps.length, ...stepsFromBuiltPlan(c(), built));
    setLockoutRemoved(plan, built.lockoutRemoved || []);
    store.planNotice = skipped.length ? `Skipped for this patient: ${skipped.map((s) => `${getDrugById(lib, s.drugId)?.name || s.drugId} (${s.reason})`).join('; ')}` : null;
    ctx.planChanged(); renderAll();
    announce(`Example plan loaded with ${plan.steps.length} steps.${skipped.length ? ` ${skipped.length} skipped.` : ''}`);
  });

  // ---------- technique templates (data/templates.js; doses filled by recommend() at runtime)
  const tplSel = h('select', { id: 'pl-template', class: 'input' }, h('option', { value: '' }, 'Choose a technique template…'),
    TECHNIQUE_TEMPLATES.map((t) => h('option', { value: t.id, selected: !!plan.template && plan.template.id === t.id }, t.label)));
  const tplDesc = h('p', { class: 'hint', id: 'pl-template-desc' });
  const tplOpts = h('fieldset', { class: 'fieldset fieldset--plain', id: 'pl-template-opts', hidden: true }, h('legend', {}, 'Optional steps'));
  const tplBtn = h('button', { type: 'button', class: 'btn btn--primary', id: 'pl-template-apply' }, 'Apply template');
  const tplNotes = h('div', { id: 'pl-template-notes', 'aria-live': 'polite' });
  function renderTemplateChoice() {
    const t = getTemplate(tplSel.value);
    setTextSafe(tplDesc, t ? t.description : 'A template fills the plan steps from the drug library for this patient (no fixed doses); every step stays editable.');
    while (tplOpts.children.length > 1) tplOpts.lastChild.remove();
    const opts = t ? templateOptions(t) : [];
    tplOpts.hidden = !opts.length;
    for (const o of opts) {
      const id = `pl-tpl-opt-${o.id}`;
      tplOpts.append(h('div', { class: 'check' }, h('input', { type: 'checkbox', id, checked: o.default, dataset: { opt: o.id } }), h('label', { for: id }, o.label)));
    }
  }
  function renderTemplateNotes() {
    clear(tplNotes);
    const notes = plan.templateNotes && plan.template && plan.template.mode === plan.mode ? plan.templateNotes : [];
    for (const n of notes) tplNotes.append(h('p', { class: `note note--template note--${n.key}`, dataset: { note: n.key } }, n.text, ' ', srcTags(n.sources)));
  }
  tplSel.addEventListener('change', renderTemplateChoice);
  tplBtn.addEventListener('click', () => {
    const t = getTemplate(tplSel.value);
    if (!t) { tplSel.focus(); announce('Choose a template first.'); return; }
    const include = Object.fromEntries([...tplOpts.querySelectorAll('input[data-opt]')].map((i) => [i.dataset.opt, i.checked]));
    const r = buildTemplatePlan(t.id, patient, { library: lib, interlocks: store.interlocks, prefillCeilings: false, sedationTarget: t.mode === 'MAC' && plan.mode === 'MAC' ? plan.sedationTarget : null, include });
    setMode(plan, t.mode); if (t.mode === 'MAC') plan.sedationTarget = r.plan.sedationTarget;
    plan.steps.splice(0, plan.steps.length, ...stepsFromBuiltPlan(c(), r.plan));
    setLockoutRemoved(plan, r.plan.lockoutRemoved || []);
    plan.template = { id: t.id, label: t.label, mode: t.mode }; plan.templateNotes = r.notes;
    if (r.plan.steps.some((x) => x.kind === 'antibiotic')) setProphylaxisIndicated(plan, true);
    const bits = [];
    if (r.skipped.length) bits.push(`Skipped for this patient: ${r.skipped.map((x) => `${getDrugById(lib, x.drugId)?.name || x.drugId} (${x.reason})`).join('; ')}`);
    if (r.substitutions.length) bits.push(`Substituted: ${r.substitutions.map((x) => `${getDrugById(lib, x.from).name} → ${getDrugById(lib, x.to).name} (${x.reason})`).join('; ')}`);
    if (r.omitted.length) bits.push(`Omitted: ${r.omitted.map((x) => `lidocaine pretreatment (${x.reason})`).join('; ')}`);
    store.planNotice = bits.length ? `Template “${t.label}”. ${bits.join('. ')}.` : null;
    ctx.planChanged(); renderAll();
    announce(`Template ${t.label} applied: ${plan.steps.length} steps.${r.skipped.length ? ` ${r.skipped.length} skipped.` : ''}`);
  });
  const tplCard = h('section', { class: 'card', id: 'pl-template-card', 'aria-labelledby': 'pl-template-h' },
    h('h3', { id: 'pl-template-h' }, 'Start from a technique template'),
    h('div', { class: 'inline-form' }, h('label', { class: 'label', for: 'pl-template' }, 'Template'), tplSel, tplBtn), tplDesc, tplOpts, tplNotes,
    h('p', { class: 'hint' }, 'Templates name drugs, regimens and offsets only; doses and rates are filled from the drug library for this patient (with sources) and stay editable. Offsets are simulator conventions, not recommendations.'));

  // ---------- antibiotic prophylaxis indication (simulator does not know the procedure)
  const abxBox = h('input', { type: 'checkbox', id: 'pl-abx-indicated', checked: prophylaxisIndicated(plan) });
  abxBox.addEventListener('change', () => { setProphylaxisIndicated(plan, abxBox.checked); ctx.planChanged(); renderSummary(); announce(`Antibiotic prophylaxis ${abxBox.checked ? 'marked as indicated' : 'not indicated'}.`); });
  const abxSel = selectProphylaxis(patient, lib);
  const abxField = h('div', { class: 'check check--block' }, abxBox, h('label', { for: 'pl-abx-indicated' }, h('strong', {}, 'Surgical antibiotic prophylaxis indicated'),
    h('span', { class: 'hint block' }, `When ticked, starting surgery without a dose started within the guideline window raises a MEDIUM alarm, and guided mode asks you to acknowledge a checklist warning first. Guideline agent for this patient: ${abxSel.drugId ? getDrugById(lib, abxSel.drugId).name : 'none available'} — ${abxSel.reason} `, srcTags(abxSel.sources))));

  const phasesWrap = h('div', { class: 'phases', id: 'pl-phases' });
  const timingList = h('ul', { class: 'tchecks tchecks--light', id: 'pl-timing-list' });
  const timingCard = h('section', { class: 'card', id: 'pl-timing', 'aria-labelledby': 'pl-timing-h' }, h('h3', { id: 'pl-timing-h' }, 'Timing check'),
    h('p', { class: 'hint' }, 'Checks the whole plan against the timing rules (premedication → induction, loading → maintenance, opioid → hypnotic, pretreatment, neuromuscular blocker, antibiotic window, PONV, reversal, repeat boluses, stop-before-end). Each rule shows its source or “simulator convention”. Warnings do not block the run.'),
    timingList);
  function renderTiming() {
    const checks = validatePlanTiming(exportPlan(plan), lib);
    clear(timingList).append(...timingCheckItems(checks));
    timingCard.dataset.warnings = String(checks.filter((x) => x.status === 'warn').length);
  }
  const timeline = h('section', { class: 'card', 'aria-labelledby': 'pl-tl-title' });
  const summary = h('div', { class: 'plan-summary', id: 'pl-summary' });
  const notice = h('div', { id: 'pl-notice' });

  // ---------- step cards
  function moveStep(uid, dir) {
    const s = plan.steps.find((x) => x.uid === uid);
    const same = plan.steps.filter((x) => x.phase === s.phase);
    const i = same.indexOf(s); const j = i + dir;
    if (j < 0 || j >= same.length) return;
    const a = plan.steps.indexOf(same[i]); const b = plan.steps.indexOf(same[j]);
    [plan.steps[a], plan.steps[b]] = [plan.steps[b], plan.steps[a]];
    ctx.planChanged(); renderPhases(); renderTimeline(); renderSummary();
    const btn = document.querySelector(`[data-move="${uid}"][data-dir="${dir}"]`) || document.querySelector(`[data-move="${uid}"]:not([disabled])`);
    if (btn) btn.focus();
    announce(`${getDrugById(lib, s.drugId).name} moved to position ${j + 1} of ${same.length} in ${phaseLabels()[s.phase]}.`);
  }
  function deleteStep(uid) {
    const i = plan.steps.findIndex((x) => x.uid === uid); const s = plan.steps[i];
    const ph = s.phase;
    noteLockedDeletion(c(), plan, s);
    plan.steps.splice(i, 1);
    ctx.planChanged(); renderPhases(); renderTimeline(); renderSummary();
    const next = document.querySelector(`#pl-phase-${ph} .step-card [data-del]`) || document.getElementById(`pl-add-${ph}`);
    if (next) next.focus();
    announce(`${getDrugById(lib, s.drugId).name} step removed.`);
  }

  function stepCard(s, idx, count) {
    const drug = getDrugById(lib, s.drugId);
    const info = h('div', { class: 'step-card__info' });
    const fid = (n) => `st-${s.uid}-${n}`;
    const fields = h('div', { class: 'step-card__fields' });
    const time = h('input', { type: 'text', inputmode: 'numeric', id: fid('t'), class: 'input input--time', value: fmtClock(s.atSec), 'aria-describedby': fid('t-hint'), pattern: '(\\d{1,2}:[0-5]\\d:[0-5]\\d|\\d{1,3}:[0-5]\\d|\\d{1,5})' });
    time.addEventListener('change', () => { const v = parseClock(time.value); s.atSec = v; if (v !== null) time.value = fmtClock(v); update(); });
    fields.append(h('div', { class: 'field field--sm' }, h('label', { class: 'label', for: fid('t') }, 'Time offset in phase'), time, h('p', { class: 'hint', id: fid('t-hint') }, 'mm:ss (or h:mm:ss) from phase start')));
    if (s.kind === 'fluid' || s.kind === 'fluid_bolus' || s.kind === 'antibiotic') {
      const isRate = s.kind === 'fluid';
      const inp = h('input', { type: 'number', step: 'any', min: 0, id: fid(isRate ? 'r' : 'a'), class: 'input input--num', value: isRate ? s.rate : s.amount });
      inp.addEventListener('change', () => { const v = inp.value === '' ? NaN : Number(inp.value); if (isRate) s.rate = v; else s.amount = v; update(); });
      fields.append(h('div', { class: 'field field--sm' }, h('label', { class: 'label', for: inp.id }, isRate ? 'Maintenance rate' : s.kind === 'fluid_bolus' ? 'Volume' : 'Dose', h('span', { class: 'unit' }, ` (${isRate ? 'mL/h' : s.amountUnit})`)), inp,
        isRate ? h('p', { class: 'hint' }, '0 stops the maintenance infusion') : null));
    } else if (s.kind === 'bolus') {
      const amt = h('input', { type: 'number', step: 'any', min: 0, id: fid('a'), class: 'input input--num', value: s.amount });
      amt.addEventListener('change', () => { s.amount = amt.value === '' ? NaN : Number(amt.value); update(); });
      const over = h('input', { type: 'number', step: 'any', min: 0, id: fid('o'), class: 'input input--num', value: isNum(s.overSec) && s.overSec > 0 ? Math.round(s.overSec / 6) / 10 : '', placeholder: 'push' });
      over.addEventListener('change', () => { s.overSec = over.value === '' ? null : Number(over.value) * 60; update(); });
      fields.append(
        h('div', { class: 'field field--sm' }, h('label', { class: 'label', for: fid('a') }, s.loading ? 'Loading dose' : 'Dose', h('span', { class: 'unit' }, ` (${s.amountUnit})`)), amt),
        h('div', { class: 'field field--sm' }, h('label', { class: 'label', for: fid('o') }, 'Give over', h('span', { class: 'unit' }, ' (min)')), over, h('p', { class: 'hint' }, 'blank = push; ≥ 1 min runs as a timed infusion')));
    } else if (s.kind === 'stop' && s.phase === 'maintenance') {
      const be = h('input', { type: 'number', step: 'any', min: 0, id: fid('be'), class: 'input input--num', value: isNum(s.beforeEndSec) ? Math.round(s.beforeEndSec / 6) / 10 : '', placeholder: 'not anchored', 'aria-describedby': fid('be-hint') });
      be.addEventListener('change', () => { if (be.value === '') delete s.beforeEndSec; else s.beforeEndSec = Number(be.value) * 60; update(); });
      fields.append(h('div', { class: 'field field--sm' }, h('label', { class: 'label', for: fid('be') }, 'Before end of surgery', h('span', { class: 'unit' }, ' (min)')), be,
        h('p', { class: 'hint', id: fid('be-hint') }, 'blank = at the time offset; a value = that many minutes before the planned end of surgery')));
    } else if (s.kind === 'infusion' || s.kind === 'inhaled') {
      const rate = h('input', { type: 'number', step: 'any', min: 0, id: fid('r'), class: 'input input--num', value: s.rate });
      rate.addEventListener('change', () => { s.rate = rate.value === '' ? NaN : Number(rate.value); delete s.prefillNote; update(); });
      fields.append(h('div', { class: 'field field--sm' }, h('label', { class: 'label', for: fid('r') }, s.kind === 'inhaled' ? 'Dial setting' : 'Rate', h('span', { class: 'unit' }, ` (${s.rateUnit})`)), rate));
    }
    const up = h('button', { type: 'button', class: 'btn btn--icon', dataset: { move: s.uid, dir: '-1' }, disabled: idx === 0, 'aria-label': `Move ${drug.name} ${KIND_LABELS[s.kind]} up` }, '↑');
    const down = h('button', { type: 'button', class: 'btn btn--icon', dataset: { move: s.uid, dir: '1' }, disabled: idx === count - 1, 'aria-label': `Move ${drug.name} ${KIND_LABELS[s.kind]} down` }, '↓');
    const del = h('button', { type: 'button', class: 'btn btn--icon btn--danger', dataset: { del: s.uid }, 'aria-label': `Delete ${drug.name} ${KIND_LABELS[s.kind]} step` }, 'Delete');
    up.addEventListener('click', () => moveStep(s.uid, -1));
    down.addEventListener('click', () => moveStep(s.uid, 1));
    del.addEventListener('click', () => deleteStep(s.uid));
    const card = h('li', { class: 'step-card', id: `card-${s.uid}`, dataset: { uid: s.uid } },
      h('div', { class: 'step-card__head' },
        h('span', { class: 'step-card__num', 'aria-hidden': 'true' }, String(idx + 1)),
        h('h4', {}, drug.name, ' ', h('span', { class: 'badge' }, s.loading ? 'Loading bolus' : KIND_LABELS[s.kind]),
          s.regimenKey ? h('span', { class: 'hint' }, ` ${REGIMEN_LABELS[s.regimenKey] || s.regimenKey} regimen`) : null),
        h('div', { class: 'step-card__actions' }, up, down, del)),
      fields, info);
    const whyHost = h('div', { class: 'step-card__why' });
    card.insertBefore(whyHost, info);

    function update() {
      clear(whyHost);
      const anchor = s.kind === 'stop' && isNum(s.beforeEndSec) ? h('p', { class: 'hint' }, h('strong', {}, 'Anchored: '), `runs ${Math.round(s.beforeEndSec / 6) / 10} min before the planned end of surgery (automatic demonstration: planned end − ${Math.round(s.beforeEndSec / 6) / 10} min; guided/manual: when End surgery is pressed, if not earlier).`) : null;
      const after = s.afterLoadingOf ? h('p', { class: 'hint' }, h('strong', {}, 'Anchored: '), `starts only when the ${getDrugById(lib, s.afterLoadingOf).name} loading dose has finished.`) : null;
      whyHost.append(...[rationaleLine(s.timingRationale, { id: fid('why') }), anchor, after].filter(Boolean));
      const r = checkStep(c(), s, plan.steps);
      clear(info);
      const rec = r.rec;
      if (isFluidStep(s)) {
        info.append(h('p', {}, h('strong', {}, `${drug.name}: `), `${drug.type}; ${fluidCompositionText(drug)} (approx., label) `, srcTags(drug.sources)),
          h('p', { class: 'hint' }, `${drug.dosing} Default ${FLUID_MODEL.MAINTENANCE_DEFAULT_ML_H} mL/h; boluses ${FLUID_MODEL.ALLOWED_ML.join(' / ')} mL (simulator conventions). Maintenance continues across phases until changed. Same illustrative volume model for every fluid type.`));
        if (lib.FLUID_EVIDENCE_NOTE) info.append(h('p', { class: 'note' }, lib.FLUID_EVIDENCE_NOTE.text, ' ', srcTags(lib.FLUID_EVIDENCE_NOTE.sources)));
      } else if (s.kind === 'antibiotic' && rec && !rec.locked) {
        info.append(h('p', {}, h('strong', {}, 'Guideline dose: '), `${rec.dose.range.min === rec.dose.range.max ? rec.dose.value : `${rec.dose.range.min}–${rec.dose.range.max}`} ${rec.dose.unit}${rec.dose.perKg ? ` (${rec.dose.perKg.value} ${rec.dose.perKg.unit} × ${rec.weightUsedKg} kg ${rec.scalar})` : ''} `, srcTags(rec.sources)),
          h('p', { class: 'hint' }, h('strong', {}, 'Timing (guideline): '), rec.timing),
          ...rec.notes.map((n) => h('p', { class: 'note' }, h('strong', {}, 'Note: '), n)));
      } else if (rec && rec.available && !rec.locked) {
        const wt = `${rec.weightUsedKg} kg ${rec.scalar}`;
        const lines = [];
        if (s.kind === 'bolus') {
          const d = s.loading ? rec.loading : rec.dose;
          if (d) {
            const per = d.perKg ? `${d.perKg.min ?? d.perKg.value}–${d.perKg.max ?? d.perKg.value} ${d.perKg.unit} (default ${d.perKg.value}) × ${wt} (${SCALAR_LABELS[rec.scalar]})` : 'fixed dose (not weight-based)';
            lines.push(h('p', {}, h('strong', {}, 'Sourced range: '), `${d.range.min ?? 0}–${d.range.max} ${d.unit}`, ` · ${per} `, srcTags(rec.sources)));
          }
        } else if (rec.rate) {
          const abs = rec.rate.absolute ? ` (default ≈ ${rec.rate.absolute.value} ${rec.rate.absolute.unit})` : '';
          lines.push(h('p', {}, h('strong', {}, 'Sourced range: '), `${rec.rate.range.min ?? 0}–${rec.rate.range.max} ${rec.rate.unit}; label default ${rec.rate.value}${abs}`,
            rec.rate.unit.includes('/kg') ? ` · weight ${wt} (${SCALAR_LABELS[rec.scalar]})` : '', ' ', srcTags(rec.sources)));
          if (rec.rate.ceiling) lines.push(h('p', { class: 'hint' }, `Label ceiling (hard stop): ${rec.rate.ceiling.label}`));
          if (rec.rate.ageAdjustedMac) {
            const m = rec.rate.ageAdjustedMac;
            const b = h('button', { type: 'button', class: 'btn btn--small' }, `Set dial to 1.0 × age-adjusted MAC (${m.value} %)`);
            b.addEventListener('click', () => { s.rate = m.value; const ri = document.getElementById(fid('r')); if (ri) ri.value = m.value; update(); announce(`Dial set to ${m.value} %.`); });
            lines.push(h('p', {}, `1.0 × age-adjusted MAC for ${patient.ageYears} y = ${m.value} % (MAC40 ${m.mac40} %) `, srcTags(m.sources), m.withinRange ? ' ' : ' (outside the label range) ', b,
              h('span', { class: 'hint block' }, m.note)));
          }
          const ic = interlockCeiling(drug, s.rateUnit, patient);
          if (ic) lines.push(h('p', { class: 'hint' }, `Smart NOA simulation ceiling ${ic.pyValue} ${ic.pyUnit} — ${store.interlocks ? 'applies (interlocks on)' : 'not applied (interlocks off)'} `, srcTags([E.pythonConfig])));
          if (!store.interlocks && s.prefillNote === undefined && isNum(s.labelDefault) && s.rate !== s.labelDefault && ic && s.rate === ic.value) {
            const b = h('button', { type: 'button', class: 'btn btn--small' }, `Restore label default ${s.labelDefault}`);
            b.addEventListener('click', () => { s.rate = s.labelDefault; const ri = document.getElementById(fid('r')); if (ri) ri.value = s.rate; update(); });
            lines.push(h('p', {}, b));
          }
        }
        if (rec.timing) lines.push(h('p', { class: 'hint' }, h('strong', {}, 'Timing (label/guideline): '), rec.timing));
        for (const n of rec.notes) lines.push(h('p', { class: 'note' }, h('strong', {}, 'Note: '), n, ' ', srcTags(sourcesInText(n))));
        for (const w of s.addWarnings || []) lines.push(h('p', { class: 'warn-text' }, h('strong', {}, 'Warning: '), w, ' ', srcTags(sourcesInText(w))));
        if (s.prefillNote) lines.push(h('p', { class: 'note note--interlock' }, h('strong', {}, 'Interlock ceiling: '), s.prefillNote, ' ', srcTags([E.pythonConfig, ...(rec.sources || [])])));
        if (s.dialNote) lines.push(h('p', { class: 'hint' }, s.dialNote, ' ', srcTags(rec.rate ? rec.rate.ageAdjustedMac?.sources : [])));
        if (store.patientVersion !== s.filledFor) lines.push(h('p', { class: 'warn-text' }, 'Patient details changed after this dose was filled. Use “Re-fill all doses” to recompute.'));
        info.append(...lines);
      } else if (s.kind === 'stop') {
        info.append(h('p', { class: 'hint' }, `Stops ${drug.name} (${isInhaledDrug(drug) ? 'dial to 0 %' : 'infusion to 0'}) at this time.`));
      }
      for (const w of r.warnings) info.append(h('p', { class: 'warn-text', role: 'note' }, h('span', { class: 'badge badge--warn' }, 'Out of range'), ' ', w));
      for (const e of r.errors) {
        const p = h('p', { class: 'error-text' }, h('span', { class: 'badge badge--lock' }, 'Blocked'), ' ', e.text);
        if (e.fix) {
          const b = h('button', { type: 'button', class: 'btn btn--small' }, e.fix.label);
          b.addEventListener('click', () => { e.fix.apply(s); const ri = document.getElementById(fid(s.kind === 'bolus' || s.kind === 'fluid_bolus' || s.kind === 'antibiotic' ? 'a' : 'r')); if (ri) ri.value = s.kind === 'bolus' ? s.amount : s.rate; update(); announce('Value updated.'); });
          p.append(' ', b);
        }
        info.append(p);
      }
      card.classList.toggle('step-card--error', r.errors.length > 0);
      card.classList.toggle('step-card--warn', !r.errors.length && r.warnings.length > 0);
      ctx.planChanged(); renderTimeline(); renderSummary();
    }
    card._update = update;
    return card;
  }

  function pickerFor(ph) {
    const key = keyForPhase(ph, plan.sedationTarget);
    const groups = new Map();
    const locked = [];
    for (const d of lib.DRUGS) {
      if (!d.regimens || !d.regimens[key]) continue;
      const rec = recommend(patient, key, d.id, lib);
      if (!groups.has(d.cls)) groups.set(d.cls, []);
      groups.get(d.cls).push({ d, rec, key });
      if (rec.locked) locked.push({ d, rec });
    }
    // Rescue regimens (key 'rescue' or 'rescue_<route>', e.g. epinephrine rescue_iv) are offered in every phase.
    const rescue = lib.DRUGS.flatMap((d) => Object.keys(d.regimens || {}).filter((k) => /^rescue(_|$)/.test(k) && k !== key).map((k) => ({ d, rec: recommend(patient, k, d.id, lib), key: k })));
    for (const r of rescue) if (r.rec.locked && !locked.some((x) => x.d.id === r.d.id)) locked.push(r);
    const sel = h('select', { id: `pl-pick-${ph}`, class: 'input' }, h('option', { value: '' }, `Add a drug (${REGIMEN_LABELS[key]} regimens)…`),
      CLASS_ORDER.filter((cl) => groups.has(cl)).concat([...groups.keys()].filter((cl) => !CLASS_ORDER.includes(cl))).map((cl) => h('optgroup', { label: CLASS_LABELS[cl] || cl },
        groups.get(cl).map(({ d, rec }) => h('option', { value: `${d.id}|${key}`, disabled: rec.locked }, `${d.name}${rec.locked ? ' — LOCKED for this patient' : rec.warnings.length ? ' — warning' : ''}`)))),
      rescue.length ? h('optgroup', { label: 'Rescue / as needed' }, rescue.map(({ d, rec, key: rk }) => h('option', { value: `${d.id}|${rk}`, disabled: rec.locked }, `${d.name} (${REGIMEN_LABELS[rk] || rk}${rec.route && rec.route !== 'IV' ? `, ${rec.route}` : rk !== 'rescue' && rec.route ? `, ${rec.route}` : ''})${rec.locked ? ' — LOCKED' : ''}`))) : null);
    // Lidocaine pretreatment before propofol (propofol label) is offered in the induction phase.
    if (ph === 'induction') {
      const lido = lib.DRUGS.find((d) => d.id === 'lidocaine' && d.regimens && d.regimens.pretreatment);
      if (lido) { const rec = recommend(patient, 'pretreatment', 'lidocaine', lib); sel.append(h('optgroup', { label: 'Pretreatment (before propofol)' }, h('option', { value: 'lidocaine|pretreatment', disabled: rec.locked }, `Lidocaine pretreatment (propofol injection pain)${rec.locked ? ' — LOCKED' : ''}`))); }
    }
    const add = h('button', { type: 'button', class: 'btn', id: `pl-add-${ph}` }, 'Add');
    add.addEventListener('click', () => {
      if (!sel.value) { sel.focus(); announce('Choose a drug first.'); return; }
      const [drugId, k] = sel.value.split('|');
      const { steps, reason } = makeSteps(c(), drugId, k, ph);
      if (!steps.length) { announce(reason, true); return; }
      plan.steps.push(...steps);
      ctx.planChanged(); renderPhases(); renderTimeline(); renderSummary();
      const card = document.getElementById(`card-${steps[0].uid}`);
      const first = card && card.querySelector('input');
      if (first) first.focus();
      announce(`${getDrugById(lib, drugId).name} added to ${phaseLabels()[ph]}${steps.length > 1 ? ' (loading bolus + infusion)' : ''}.`);
    });
    // Stop picker: infusions / inhaled agents started anywhere in the plan
    const running = [...new Set(plan.steps.filter((s) => s.kind === 'infusion' || s.kind === 'inhaled').map((s) => s.drugId))];
    let stopRow = null;
    if (running.length && ph !== 'premed') {
      const ssel = h('select', { id: `pl-stop-${ph}`, class: 'input' }, h('option', { value: '' }, 'Stop an infusion / agent…'), running.map((id) => h('option', { value: id }, getDrugById(lib, id).name)));
      const sb = h('button', { type: 'button', class: 'btn' }, 'Add stop');
      sb.addEventListener('click', () => {
        if (!ssel.value) { ssel.focus(); return; }
        const st = { uid: `stop-${Date.now().toString(36)}-${Math.floor(performance.now())}`, phase: ph, atSec: 0, drugId: ssel.value, kind: 'stop', regimenKey: null, filledFor: store.patientVersion };
        plan.steps.push(st); ctx.planChanged(); renderPhases(); renderTimeline(); renderSummary();
        const card = document.getElementById(`card-${st.uid}`); if (card) card.querySelector('input').focus();
        announce(`Stop ${getDrugById(lib, st.drugId).name} added.`);
      });
      stopRow = h('div', { class: 'inline-form' }, h('label', { class: 'sr-only', for: `pl-stop-${ph}` }, `Stop an infusion in ${phaseLabels()[ph]}`), ssel, sb);
    }
    return h('div', { class: 'picker' },
      h('div', { class: 'inline-form' }, h('label', { class: 'sr-only', for: `pl-pick-${ph}` }, `Add a drug to ${phaseLabels()[ph]}`), sel, add),
      stopRow, fluidRow(ph), antibioticRow(ph),
      locked.length ? h('details', { class: 'locked-list' }, h('summary', {}, `${locked.length} locked for this patient`),
        h('ul', { class: 'list list--tight' }, locked.map(({ d, rec }) => h('li', {}, h('strong', {}, d.name), ': ', rec.lockReasons.join('; '), ' ', srcTags((rec.contraindications || []).filter((x) => x.severity === 'lock').flatMap((x) => x.sources).concat(sourcesInText(rec.lockReasons.join(' ')))))))) : null);
  }

  function addSteps(steps, reason, ph, what) {
    if (!steps.length) { announce(reason, true); return; }
    plan.steps.push(...steps);
    ctx.planChanged(); renderPhases(); renderTimeline(); renderSummary();
    const card = document.getElementById(`card-${steps[0].uid}`); const first = card && card.querySelector('input'); if (first) first.focus();
    announce(`${what} added to ${phaseLabels()[ph]}.`);
  }
  /** "Fluids" row per phase: type, maintenance rate (mL/h) and 250/500 mL boluses (simulator conventions). */
  function fluidRow(ph) {
    const fl = lib.FLUIDS || []; if (!fl.length) return null;
    const tSel = h('select', { id: `pl-fluid-${ph}`, class: 'input' }, fl.map((f) => h('option', { value: f.id }, f.name)));
    const rate = h('input', { type: 'number', min: 0, max: FLUID_MODEL.MAINTENANCE_MAX_ML_H, step: 'any', id: `pl-fluid-rate-${ph}`, class: 'input input--num', value: FLUID_MODEL.MAINTENANCE_DEFAULT_ML_H });
    const mb = h('button', { type: 'button', class: 'btn', id: `pl-fluid-maint-${ph}` }, 'Set maintenance');
    mb.addEventListener('click', () => { const { steps, reason } = makeFluidStep(c(), tSel.value, 'fluid', rate.value === '' ? NaN : Number(rate.value), ph); addSteps(steps, reason, ph, `${getDrugById(lib, tSel.value).name} maintenance ${rate.value} mL/h`); });
    const bb = FLUID_MODEL.ALLOWED_ML.map((ml) => { const b = h('button', { type: 'button', class: 'btn', id: `pl-fluid-bolus-${ml}-${ph}` }, `Bolus ${ml} mL`); b.addEventListener('click', () => { const { steps, reason } = makeFluidStep(c(), tSel.value, 'fluid_bolus', ml, ph); addSteps(steps, reason, ph, `${getDrugById(lib, tSel.value).name} bolus ${ml} mL`); }); return b; });
    return h('div', { class: 'inline-form fluid-row' }, h('span', { class: 'label' }, 'Fluids'),
      h('label', { class: 'sr-only', for: `pl-fluid-${ph}` }, `Fluid type in ${phaseLabels()[ph]}`), tSel,
      h('label', { class: 'label', for: `pl-fluid-rate-${ph}` }, 'mL/h'), rate, mb, ...bb);
  }
  /** Antibiotic prophylaxis row (before incision: premedication / induction or sedation). */
  function antibioticRow(ph) {
    const abx = lib.ANTIBIOTICS || [];
    if (!abx.length || !['premed', 'induction', 'sedation'].includes(ph)) return null;
    const best = selectProphylaxis(patient, lib);
    const aSel = h('select', { id: `pl-abx-${ph}`, class: 'input' }, abx.map((a) => { const r = recommend(patient, 'prophylaxis', a.id, lib); return h('option', { value: a.id, disabled: r.locked, selected: a.id === best.drugId }, `${a.name}${a.id === best.drugId ? ' (guideline choice)' : ''}${r.locked ? ' — LOCKED' : ''}`); }));
    const b = h('button', { type: 'button', class: 'btn', id: `pl-abx-add-${ph}` }, 'Add prophylaxis');
    b.addEventListener('click', () => { const { steps, reason } = makeAntibioticStep(c(), aSel.value, ph); addSteps(steps, reason, ph, `${getDrugById(lib, aSel.value).name} prophylaxis`); if (steps.length) { setProphylaxisIndicated(plan, true); abxBox.checked = true; } });
    return h('div', { class: 'inline-form abx-row' }, h('label', { class: 'label', for: `pl-abx-${ph}` }, 'Antibiotic prophylaxis'), aSel, b);
  }

  function renderPhases() {
    clear(phasesWrap);
    const cards = [];
    for (const ph of phasesFor(plan.mode)) {
      const steps = plan.steps.filter((s) => s.phase === ph);
      const key = keyForPhase(ph, plan.sedationTarget);
      const list = h('ol', { class: 'step-list', 'aria-label': `${phaseLabels()[ph]} steps` });
      steps.forEach((s, i) => { const cd = stepCard(s, i, steps.length); cards.push(cd); list.append(cd); });
      phasesWrap.append(h('section', { class: 'card phase', id: `pl-phase-${ph}`, 'aria-labelledby': `pl-phase-${ph}-h` },
        h('h3', { id: `pl-phase-${ph}-h` }, phaseLabels()[ph], ph === 'premed' ? h('span', { class: 'hint' }, ' (optional; runs from the start of the case)') : null),
        h('p', { class: 'hint' }, ph === 'sedation' ? `Uses ${REGIMEN_LABELS[key]} regimens.` : `Drugs with a sourced ${REGIMEN_LABELS[key]} regimen. Steps run at their time offset; list order breaks ties.`),
        steps.length ? list : h('p', { class: 'muted' }, 'No steps yet.'),
        pickerFor(ph)));
    }
    for (const cd of cards) cd._update();
  }

  function renderTimeline() {
    renderTiming();
    clear(timeline);
    timeline.append(h('h3', { id: 'pl-tl-title' }, 'Phase timeline preview'));
    const L = phaseLabels();
    for (const ph of phasesFor(plan.mode)) {
      const steps = plan.steps.filter((s) => s.phase === ph);
      const maxT = Math.max(300, ...steps.map((s) => (s.atSec || 0) + (isNum(s.overSec) ? s.overSec : 0) + 60));
      const track = h('div', { class: 'tl-track', 'aria-hidden': 'true' });
      for (let t = 0; t <= maxT; t += maxT > 1200 ? 300 : 60) {
        const tick = h('span', { class: 'tl-tick', dataset: { t: fmtClock(t) } });
        tick.style.left = `${(t / maxT) * 100}%`; // position from the numeric time, not by re-parsing the label
        track.append(tick);
      }
      steps.forEach((s, i) => {
        const left = ((s.atSec || 0) / maxT) * 100;
        const m = h('span', { class: `tl-mark tl-mark--${s.kind}`, title: rationaleText(s.timingRationale) || null }, String(i + 1));
        m.style.left = `${Math.min(left, 97)}%`;
        if (s.kind === 'infusion' || s.kind === 'inhaled' || (s.kind === 'fluid' && s.rate > 0)) { const bar = h('span', { class: 'tl-bar' }); bar.style.left = `${left}%`; bar.style.right = '0'; track.append(bar); }
        if (s.kind === 'bolus' && isNum(s.overSec) && s.overSec >= 60) { const bar = h('span', { class: 'tl-bar tl-bar--timed' }); bar.style.left = `${left}%`; bar.style.width = `${(s.overSec / maxT) * 100}%`; track.append(bar); }
        track.append(m);
      });
      const legend = h('ol', { class: 'tl-legend' }, steps.map((s) => {
        const d = getDrugById(lib, s.drugId);
        const what = s.kind === 'bolus' || s.kind === 'antibiotic' || s.kind === 'fluid_bolus' ? `${s.amount} ${s.amountUnit}${s.kind === 'fluid_bolus' ? ' bolus' : s.kind === 'antibiotic' ? ' (prophylaxis)' : ''}${isNum(s.overSec) && s.overSec >= 60 ? ` over ${Math.round(s.overSec / 60)} min` : ''}` : s.kind === 'stop' ? 'stop' : s.kind === 'fluid' ? `${s.rate} mL/h maintenance` : `${s.rate} ${s.rateUnit}`;
        const at = s.kind === 'stop' && isNum(s.beforeEndSec) ? `end − ${fmtClock(s.beforeEndSec)}` : fmtClock(s.atSec);
        return h('li', { title: rationaleText(s.timingRationale) || null }, h('span', { class: 'mono' }, at), ` ${d.name} ${what}`,
          s.timingRationale ? h('span', { class: 'tl-why hint' }, ` — ${s.timingRationale.text} (${s.timingRationale.provenance})`) : null);
      }));
      timeline.append(h('div', { class: 'tl-row' }, h('div', { class: 'tl-label' }, L[ph]), track, steps.length ? legend : h('p', { class: 'hint' }, 'No steps')));
    }
  }

  const contBtn = h('button', { type: 'button', class: 'btn btn--primary', id: 'pl-continue' }, 'Continue to run →');
  contBtn.addEventListener('click', () => {
    const iss = planIssues(c(), plan);
    if (iss.errors) {
      announce(`${iss.errors} blocking issue(s) — fix them before running.${iss.hypnoticGap ? ` ${iss.hypnoticGap.message}` : ''}`, true);
      if (!iss.firstError && iss.hypnoticGap) { const g = document.getElementById('pl-hypnotic-gap'); if (g) { g.scrollIntoView({ block: 'center' }); const b = g.querySelector('button'); (b || g).focus(); } return; }
      const card = document.getElementById(`card-${iss.firstError}`);
      if (card) { card.scrollIntoView({ block: 'center' }); const i = card.querySelector('input'); if (i) i.focus(); }
      return;
    }
    ctx.go(4);
  });

  function renderSummary() {
    const iss = planIssues(c(), plan);
    clear(summary).append(
      h('p', {}, h('strong', {}, `${plan.steps.length} step(s)`), ' · ',
        iss.errors ? h('span', { class: 'error-text' }, `${iss.errors} blocking issue(s)`) : h('span', {}, 'no blocking issues'), ' · ',
        iss.warnings ? h('span', { class: 'warn-text' }, `${iss.warnings} warning(s)`) : 'no warnings',
        ' · Interlocks ', h('strong', {}, store.interlocks ? 'ON' : 'OFF')));
    contBtn.setAttribute('aria-disabled', iss.errors ? 'true' : 'false');
    ctx.refreshStepper();
    clear(notice);
    const stale = plan.steps.some((s) => s.kind !== 'stop' && s.filledFor !== store.patientVersion);
    if (stale) {
      const b = h('button', { type: 'button', class: 'btn btn--small' }, 'Re-fill all doses for the current patient');
      b.addEventListener('click', () => { for (const s of plan.steps) refillStep(c(), s); ctx.planChanged(); renderAll(); announce('All doses re-filled from the drug library.'); });
      notice.append(h('p', { class: 'notice notice--warn' }, 'The patient changed after some doses were auto-filled. ', b));
    }
    if (store.planNotice) notice.append(h('p', { class: 'notice' }, store.planNotice));
    // Lockout removed the only maintenance hypnotic (engine/plan-safety.js): blocking; never fixed automatically.
    const gap = iss.hypnoticGap;
    if (gap) {
      const box = h('div', { class: 'notice notice--block', id: 'pl-hypnotic-gap', role: 'alert', tabindex: '-1' },
        h('p', {}, h('span', { class: 'badge badge--lock' }, 'Blocked'), ' ', gap.message, ' ', srcTags(sourcesInText(gap.message))));
      if (gap.tivaAvailable) {
        const b = h('button', { type: 'button', class: 'btn btn--small btn--primary', id: 'pl-add-tiva' }, 'Add propofol TIVA maintenance');
        b.addEventListener('click', () => {
          const r = addTivaMaintenance(c(), plan);
          store.planNotice = r.message;
          ctx.planChanged(); renderAll(); announce(r.message, !r.ok);
          const card = r.added[0] && document.getElementById(`card-${r.added[0].uid}`); if (card) card.scrollIntoView({ block: 'center' });
        });
        box.append(h('p', { class: 'hint' }, 'Adds the propofol maintenance infusion from the drug library (label regimen, auto-filled like any step) at maintenance +0:00 and its stop at emergence. Nothing is changed until you press it; review the step afterwards.'), b);
      }
      notice.append(box);
    }
  }

  function renderAll() {
    targetBox.hidden = plan.mode !== 'MAC';
    for (const r of targetBox.querySelectorAll('input')) r.checked = r.value === plan.sedationTarget;
    for (const r of modeBox.querySelectorAll('input')) r.checked = r.value === plan.mode;
    ilBox.checked = store.interlocks; abxBox.checked = prophylaxisIndicated(plan);
    renderTemplateNotes();
    renderPhases(); renderTimeline(); renderSummary();
  }

  clear(main).append(
    h('div', { class: 'step-head' },
      h('h2', { id: 'step-title', tabindex: '-1' }, '3 · Anesthetic plan'),
      h('p', { class: 'muted' }, 'Doses are auto-filled from the drug library for this patient. Every value shows its sourced range, the weight scalar used and its source. Defaults are a simulator convention, not a recommendation.')),
    notice,
    tplCard,
    h('div', { class: 'grid grid--2' },
      h('section', { class: 'card' }, h('h3', {}, 'Technique & target'), modeBox, targetBox, abxField),
      h('section', { class: 'card' }, h('h3', {}, 'Simulation settings'),
        h('div', { class: 'check check--block' }, ilBox, h('label', { for: ilId }, h('strong', {}, 'Interlocks (Smart NOA rules)'))),
        interlockExplanation(lib),
        h('div', { class: 'field field--sm' }, h('label', { class: 'label', for: 'pl-seed' }, 'Random seed'), seedIn, h('p', { class: 'hint' }, 'Same seed = same (illustrative) physiological noise.')),
        h('div', { class: 'inline-form' }, h('label', { class: 'label', for: 'pl-example' }, 'Example plan'), exSel, exBtn))),
    phasesWrap,
    timingCard,
    timeline,
    h('div', { class: 'actions actions--sticky' }, summary,
      h('div', { class: 'actions__btns' },
        h('button', { type: 'button', class: 'btn', onclick: () => ctx.go(2) }, '← Back'),
        contBtn)),
  );
  renderTemplateChoice();
  renderAll();
}

function setTextSafe(el, t) { el.textContent = t; }
