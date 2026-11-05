// Palliative pain management and end-of-life care modules — UI. Educational simulation with
// fictional patients. CSP: no inline scripts/handlers/styles; listeners via addEventListener (h()).
// Free text (family notes, documentation) is only ever set as input values or textContent — never HTML.
import { h, clear, announce } from './dom.js';
import { srcTags } from './sources.js';
import { PALLIATIVE_CASES, PALLIATIVE_OPIOIDS, PALLIATIVE_RULES as R, SEDATION_MIDAZOLAM as SM, ETHICS_PANEL, GOC_PROMPTS, TREATMENTS_TRIED, EXCLUSIONS_TEXT, OPTIONS, PALLIATIVE_BANNER } from '../data/palliative.js';
import { validatePalliative, derivePalliative, recommendStart, breakthroughDose, convertOpioid, createPalliativeSim, mmePerDay, fmtDay } from '../engine/palliative.js';

const STEPS = [{ n: 1, label: 'Case' }, { n: 2, label: 'Assess & plan' }, { n: 3, label: 'Run' }, { n: 4, label: 'Debrief' }];
const SPEEDS = [[60, '1 h/s'], [360, '6 h/s'], [1440, '24 h/s']];
const MODULE_LABEL = { pain: 'Palliative pain management', eol: 'End-of-life care' };

export const pal = { module: 'pain', step: 1, caseId: null, input: null, derived: null, plan: null, sim: null, speed: 60, playing: false, timer: null, testClock: false, notice: '' };

const blankInput = () => JSON.parse(JSON.stringify(PALLIATIVE_CASES[0].patient));
const optSel = (id, list, value, label) => [h('label', { for: id, class: 'label' }, label), h('select', { id, class: 'input' }, list.map(([v, t]) => h('option', { value: v, selected: v === value }, t)))];
const kv = (rows) => h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
const fmt = (v) => (typeof v === 'number' ? String(Number(v.toFixed(1))) : String(v));
const caseDef = () => PALLIATIVE_CASES.find((c) => c.id === pal.caseId) || { generator: {}, plan: {} };

export function setPalModule(m) { if (pal.module !== m) { stop(); pal.module = m; pal.step = 1; pal.caseId = null; pal.input = null; pal.derived = null; pal.plan = null; pal.sim = null; } }
export function stop() { pal.playing = false; if (pal.timer) { clearInterval(pal.timer); pal.timer = null; } }

/** Entry: renders the current palliative screen into `main`. */
export function renderPalliative(main) {
  stop();
  clear(main);
  if (!pal.input) pal.input = blankInput();
  const nav = h('nav', { class: 'pal-stepper', 'aria-label': `${MODULE_LABEL[pal.module]} steps` }, h('ol', {}, STEPS.map((s) => {
    const ok = canGo(s.n);
    const b = h('button', { type: 'button', class: 'stepper__btn', id: `pal-stepper-${s.n}`, 'aria-current': pal.step === s.n ? 'step' : null, 'aria-disabled': ok ? null : 'true' },
      h('span', { class: 'stepper__num' }, String(s.n)), h('span', { class: 'stepper__label' }, s.label));
    b.addEventListener('click', () => { if (canGo(s.n)) { pal.step = s.n; renderPalliative(main); } else announce('Complete the previous step first.', true); });
    return h('li', { class: pal.step === s.n ? 'is-current' : '' }, b);
  })));
  const box = h('div', { class: 'pal', id: 'pal-root', dataset: { module: pal.module, step: String(pal.step) } });
  main.append(nav, box);
  ({ 1: stepCase, 2: stepPlan, 3: stepRun, 4: stepDebrief })[pal.step](box, main);
}
function canGo(n) { if (n === 1) return true; if (n === 2) return !!pal.derived; if (n >= 3) return !!pal.sim; return false; }
const head = (title, sub) => h('div', { class: 'step-head' }, h('h2', { id: 'step-title', tabindex: '-1' }, title), sub ? h('p', { class: 'muted' }, sub) : null);

// ----------------------------------------------------------------------------- step 1: case
function readForm(box) {
  const v = (id) => box.querySelector(`#${id}`); const num = (id) => (v(id).value.trim() === '' ? NaN : Number(v(id).value));
  const p = { ...pal.input,
    sex: v('pc-sex').value, ageYears: num('pc-age'), weightKg: num('pc-weight'), egfr: num('pc-egfr'), baselineRr: num('pc-rr'), medicationCount: num('pc-meds'),
    liverDisease: v('pc-liver').checked, severeHepatic: v('pc-severe-liver').checked, hypoxaemic: v('pc-hypox').checked,
    setting: v('pc-setting').value, diagnosis: v('pc-diagnosis').value, opioidStatus: v('pc-opioid').value, goals: v('pc-goals').value, prognosis: v('pc-prognosis').value,
    capacity: v('pc-capacity').checked, surrogateDocumented: v('pc-surrogate').checked, advanceDirective: v('pc-ad').checked, priorAdverse: v('pc-adverse').value.slice(0, 300) };
  p.currentRegimen = p.opioidStatus === 'tolerant' ? { drugId: v('pc-cur-drug').value, route: v('pc-cur-route').value, dose: num('pc-cur-dose'), intervalH: num('pc-cur-int') } : null;
  return p;
}
function stepCase(box, main) {
  const p = pal.input; const cr = p.currentRegimen || { drugId: 'morphine', route: 'oral', dose: '', intervalH: 4 };
  const cases = PALLIATIVE_CASES.filter((c) => c.module === pal.module);
  const errBox = h('div', { id: 'pc-errors', role: 'alert' });
  const field = (id, label, value, attrs = {}) => h('div', { class: 'field field--sm' }, h('label', { for: id, class: 'label' }, label), h('input', { id, class: 'input input--num', type: 'number', value, ...attrs }), h('p', { class: 'field-error', id: `${id}-err`, hidden: true }));
  const chk = (id, label, on) => h('label', { class: 'check' }, h('input', { type: 'checkbox', id, checked: on }), ' ', label);
  const drugSel = h('select', { id: 'pc-cur-drug', class: 'input' }, Object.values(PALLIATIVE_OPIOIDS).map((d) => h('option', { value: d.id, selected: d.id === cr.drugId }, d.name)));
  const routeSel = h('select', { id: 'pc-cur-route', class: 'input' }, ['oral', 'iv'].map((r) => h('option', { value: r, selected: r === cr.route }, r === 'oral' ? 'Oral' : 'IV')));
  const cur = h('fieldset', { class: 'fieldset', id: 'pc-cur', hidden: p.opioidStatus !== 'tolerant' }, h('legend', {}, 'Current opioid regimen (opioid-tolerant)'),
    h('div', { class: 'grid grid--4' }, h('div', { class: 'field' }, h('label', { for: 'pc-cur-drug', class: 'label' }, 'Opioid'), drugSel), h('div', { class: 'field' }, h('label', { for: 'pc-cur-route', class: 'label' }, 'Route'), routeSel),
      field('pc-cur-dose', 'Dose (mg)', cr.dose, { step: '0.05', min: '0' }), field('pc-cur-int', 'Every (h)', cr.intervalH, { step: '1', min: '1', max: '24' })),
    h('p', { class: 'hint', id: 'pc-mme' }, ''), h('p', { class: 'field-error', id: 'pc-cur-err', hidden: true }));
  const sel = h('select', { id: 'pal-example', class: 'input' }, cases.map((c) => h('option', { value: c.id, selected: c.id === pal.caseId }, c.label)));
  const load = h('button', { type: 'button', class: 'btn', id: 'pal-load' }, 'Load example case');
  load.addEventListener('click', () => { const c = PALLIATIVE_CASES.find((x) => x.id === sel.value); pal.caseId = c.id; pal.input = JSON.parse(JSON.stringify(c.patient)); pal.derived = null; pal.sim = null; pal.plan = null; renderPalliative(main); announce(`Example loaded: ${c.label}.`); });
  const cont = h('button', { type: 'button', class: 'btn btn--primary', id: 'pal-continue' }, 'Continue to assessment & plan');
  box.append(head(`1 · ${MODULE_LABEL[pal.module]}: fictional case`, 'All values are fictional. Load an example or edit the fields.'),
    h('section', { class: 'card' }, h('div', { class: 'inline-form' }, h('label', { for: 'pal-example', class: 'label' }, 'Example case'), sel, load), pal.caseId ? h('p', { class: 'hint' }, `Loaded: ${caseDef().label}`) : null),
    errBox,
    h('section', { class: 'card' }, h('h3', {}, 'Patient'), h('div', { class: 'grid grid--4' },
      h('div', { class: 'field' }, ...optSel('pc-sex', [['female', 'Female'], ['male', 'Male']], p.sex, 'Sex')),
      field('pc-age', 'Age (years)', p.ageYears, { min: '18', max: '90' }), field('pc-weight', 'Weight (kg)', p.weightKg, { min: '35', max: '250' }),
      field('pc-egfr', 'eGFR (mL/min/1.73 m²)', p.egfr, { min: '5', max: '150' }), field('pc-rr', 'Baseline respiratory rate (/min)', p.baselineRr, { min: '8', max: '30' }),
      field('pc-meds', 'Number of regular medicines', p.medicationCount, { min: '0', max: '30' })),
    h('div', { class: 'check-grid' }, chk('pc-liver', 'Hepatic impairment', p.liverDisease), chk('pc-severe-liver', 'Severe hepatic impairment', p.severeHepatic), chk('pc-hypox', 'Hypoxaemic (SpO2 ≤90%)', p.hypoxaemic))),
    h('section', { class: 'card' }, h('h3', {}, 'Setting, diagnosis and opioid status'), h('div', { class: 'grid grid--3' },
      h('div', { class: 'field' }, ...optSel('pc-setting', OPTIONS.setting, p.setting, 'Setting')),
      h('div', { class: 'field' }, ...optSel('pc-diagnosis', OPTIONS.diagnosis, p.diagnosis, 'Diagnosis category')),
      h('div', { class: 'field' }, ...optSel('pc-opioid', OPTIONS.opioidStatus, p.opioidStatus, 'Opioid status'))), cur,
    h('div', { class: 'field' }, h('label', { for: 'pc-adverse', class: 'label' }, 'Prior adverse effects (free text; shown as text only)'), h('input', { id: 'pc-adverse', class: 'input', type: 'text', maxlength: '300', value: p.priorAdverse || '' }))),
    h('section', { class: 'card' }, h('h3', {}, 'Goals, decisions and prognosis'), h('div', { class: 'grid grid--2' },
      h('div', { class: 'field' }, ...optSel('pc-goals', OPTIONS.goals, p.goals, 'Goals of care')),
      h('div', { class: 'field' }, ...optSel('pc-prognosis', OPTIONS.prognosis, p.prognosis, 'Prognosis category'))),
    h('div', { class: 'check-grid' }, chk('pc-capacity', 'Has decision-making capacity (for these decisions)', p.capacity), chk('pc-surrogate', 'Surrogate decision-maker documented', p.surrogateDocumented), chk('pc-ad', 'Advance directive documented', p.advanceDirective))),
    h('div', { class: 'actions' }, cont));
  const opi = box.querySelector('#pc-opioid');
  const mmeHint = () => { try { const f = readForm(box); const m = f.currentRegimen ? mmePerDay(f.currentRegimen) : null; box.querySelector('#pc-mme').textContent = f.currentRegimen ? (m === null ? 'MME/day: not computed (CDC factors here are for oral opioids).' : `MME/day ≈ ${m} (CDC 2022 factor; risk estimate only — not for conversion).`) : ''; } catch { /* partial form */ } };
  opi.addEventListener('change', () => { box.querySelector('#pc-cur').hidden = opi.value !== 'tolerant'; mmeHint(); });
  box.addEventListener('input', mmeHint); mmeHint();
  cont.addEventListener('click', () => {
    const f = readForm(box); const v = validatePalliative(f);
    for (const e of box.querySelectorAll('.field-error')) e.hidden = true;
    for (const el of box.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    clear(errBox);
    if (!v.ok) {
      const map = { ageYears: 'pc-age', weightKg: 'pc-weight', egfr: 'pc-egfr', baselineRr: 'pc-rr', medicationCount: 'pc-meds', currentRegimen: 'pc-cur' };
      for (const [k, msg] of Object.entries(v.errors)) { const id = map[k]; const e = id && box.querySelector(id === 'pc-cur' ? '#pc-cur-err' : `#${id}-err`); if (e) { e.textContent = msg; e.hidden = false; } const inp = id && box.querySelector(`#${id}`); if (inp && inp.tagName === 'INPUT') inp.setAttribute('aria-invalid', 'true'); }
      errBox.append(h('div', { class: 'error-summary' }, h('h3', {}, 'Please fix:'), h('ul', {}, Object.values(v.errors).map((m) => h('li', {}, m)))));
      announce(`${Object.keys(v.errors).length} field(s) need attention.`, true); return;
    }
    pal.input = f; pal.derived = derivePalliative(f); pal.plan = null; pal.sim = null; pal.step = 2; renderPalliative(main);
  });
}

// ----------------------------------------------------------------------------- step 2: assess & plan
function defaultPlan(p) {
  const c = caseDef().plan || {};
  const drugId = c.drugId || (p.currentRegimen ? p.currentRegimen.drugId : 'morphine');
  const route = c.route || 'oral';
  return { drugId, route, scheduled: c.scheduled !== undefined ? c.scheduled : true, dose: c.dose || null, intervalH: c.intervalH || PALLIATIVE_OPIOIDS[drugId].routes[route].intervalH.min, prnDose: null, bowel: !!c.bowel, convert: !!c.convertFromCurrent || (p.currentRegimen && (p.currentRegimen.drugId !== drugId || p.currentRegimen.route !== route)), reductionPct: null, ivRatio: R.CONVERSION_ORAL_TO_IV_MORPHINE.default, ack: false };
}
function stepPlan(box, main) {
  const p = pal.derived; if (!pal.plan) pal.plan = defaultPlan(p);
  const pl = pal.plan; const rgd = PALLIATIVE_OPIOIDS[pl.drugId]; if (!rgd.routes[pl.route]) pl.route = 'oral';
  const tolerant = p.opioidStatus === 'tolerant';
  const rec = recommendStart(p, pl.drugId, pl.route);
  const out = h('div', { id: 'pal-plan-calc' });
  const assess = h('section', { class: 'card' }, h('h3', {}, 'Assessment (computed)'), kv([
    ['Flags', p.flags.length ? p.flags.join(', ') : 'none'],
    ['Current opioid', tolerant ? `${p.currentRegimen.drugId} ${p.currentRegimen.dose} mg ${p.currentRegimen.route.toUpperCase()} every ${p.currentRegimen.intervalH} h` : 'opioid-naïve'],
    ['MME/day (CDC factor)', h('span', {}, p.currentMmeDay === null ? '—' : String(p.currentMmeDay), ' ', h('span', { class: 'hint' }, p.mmeNote), ' ', srcTags(['S105']))],
    ['CDC 2022 scope', h('span', { id: 'pal-cdc-scope' }, p.cdcApplies ? 'Applies (outpatient non-cancer pain): immediate-release first, lowest effective dose; pause and reassess before ≥50 MME/day; offer naloxone when risk factors; PDMP review (teaching notes).' : 'Does not apply: CDC 2022 excludes cancer-related pain, palliative care and end-of-life care.', ' ', srcTags(['S105']))],
    ['Delirium risk (illustrative)', h('span', {}, `${p.delirium.level} (${p.delirium.factors.join('; ') || 'no listed factors'})`, ' ', srcTags(['S119']))],
    ['Goals / capacity / prognosis', `${p.goals}; capacity ${p.capacity ? 'yes' : 'no'}; surrogate ${p.surrogateDocumented ? 'documented' : 'not documented'}; advance directive ${p.advanceDirective ? 'yes' : 'no'}; ${p.prognosis}`],
    ['Prior adverse effects', p.priorAdverse || '—'],
  ]), h('p', { class: 'hint' }, 'Adjuvants (teaching notes; not dosed): NSAIDs, paracetamol and opioids may be used at initiation; adjuvant steroids when indicated; a bisphosphonate for bone-metastasis pain ', srcTags(['S106']), '. Neuropathic-pain adjuvants: not simulated — specialist decision.'));
  const drug = h('select', { id: 'pal-drug', class: 'input' }, Object.values(PALLIATIVE_OPIOIDS).map((d) => h('option', { value: d.id, selected: d.id === pl.drugId }, d.name)));
  const route = h('select', { id: 'pal-route', class: 'input' }, Object.keys(rgd.routes).map((r) => h('option', { value: r, selected: r === pl.route }, r === 'oral' ? 'Oral' : 'IV')));
  const re = () => renderPalliative(main);
  drug.addEventListener('change', () => { pl.drugId = drug.value; if (!PALLIATIVE_OPIOIDS[pl.drugId].routes[pl.route]) pl.route = 'oral'; pl.intervalH = PALLIATIVE_OPIOIDS[pl.drugId].routes[pl.route].intervalH.min; pl.dose = null; pl.prnDose = null; pl.convert = tolerant && (p.currentRegimen.drugId !== pl.drugId || p.currentRegimen.route !== pl.route); re(); });
  route.addEventListener('change', () => { pl.route = route.value; pl.intervalH = PALLIATIVE_OPIOIDS[pl.drugId].routes[pl.route].intervalH.min; pl.dose = null; pl.prnDose = null; pl.convert = tolerant && (p.currentRegimen.drugId !== pl.drugId || p.currentRegimen.route !== pl.route); re(); });
  const r = rgd.routes[pl.route];
  let conv = null;
  if (tolerant && pl.convert) {
    const red = h('input', { id: 'pal-red', class: 'input input--num', type: 'number', min: '0', max: '50', step: '5', value: pl.reductionPct === null ? '' : pl.reductionPct });
    const ratio = h('select', { id: 'pal-ivratio', class: 'input' }, [2, 3].map((x) => h('option', { value: String(x), selected: x === pl.ivRatio }, `${x}:1`)));
    const res = convertOpioid({ fromDrug: p.currentRegimen.drugId, fromRoute: p.currentRegimen.route, total24h: p.currentRegimen.dose * 24 / p.currentRegimen.intervalH, toDrug: pl.drugId, toRoute: pl.route, reductionPct: pl.reductionPct, ivRatio: pl.ivRatio, intervalH: pl.intervalH });
    if (res.ok && pl.dose === null) pl.dose = res.perDose;
    const go = h('button', { type: 'button', class: 'btn', id: 'pal-convert' }, 'Compute conversion');
    go.addEventListener('click', () => { pl.reductionPct = red.value.trim() === '' ? null : Number(red.value); pl.ivRatio = Number(ratio.value); pl.dose = null; pl.prnDose = null; re(); });
    conv = h('fieldset', { class: 'fieldset', id: 'pal-conv' }, h('legend', {}, 'Opioid conversion (rotation)'),
      h('p', { class: 'hint' }, 'Sourced ratios only: oral morphine → oral oxycodone 1.5:1, → oral hydromorphone 5:1 ', srcTags(['S109']), '; oral:IV morphine 2:1–3:1 ', srcTags(['S107']), '. CDC MME factors are NOT a conversion table ', srcTags(['S105']), '. Methadone and fentanyl patches: specialist conversion; not simulated.'),
      h('div', { class: 'grid grid--3' }, h('div', { class: 'field' }, h('label', { for: 'pal-red', class: 'label' }, 'Cross-tolerance reduction (%) — you choose, 0–50'), red, h('p', { class: 'hint' }, 'MASCC-ASCO 2025: no consensus on a routine reduction; no default.')),
        pl.drugId === 'morphine' && pl.route === 'iv' || p.currentRegimen.route === 'iv' ? h('div', { class: 'field' }, h('label', { for: 'pal-ivratio', class: 'label' }, 'Oral:IV morphine ratio'), ratio) : null, h('div', { class: 'field' }, go)),
      h('p', { id: 'pal-conv-result', class: res.ok ? 'notice' : 'notice notice--warn', role: 'status' }, res.ok ? `24-h oral morphine equivalent ${res.oralMorphineEquivalent24h} mg → ${res.converted24h} mg/24 h; after ${res.reductionPct}% reduction ${res.reduced24h} mg/24 h → ${res.perDose} mg every ${res.intervalH} h. ${res.notes.join(' ')}` : res.reason));
  }
  if (!tolerant && pl.dose === null && rec.ok) pl.dose = rec.dose.value;
  if (tolerant && !pl.convert && pl.dose === null) pl.dose = p.currentRegimen.dose;
  const total24 = pl.dose ? pl.dose * 24 / pl.intervalH : 0;
  const bt = pl.scheduled && pl.dose ? breakthroughDose(total24, pl.drugId, pl.route) : null;
  if (pl.prnDose === null) pl.prnDose = pl.scheduled ? (bt && bt.ok ? bt.dose : null) : pl.dose;
  const doseIn = h('input', { id: 'pal-dose', class: 'input input--num', type: 'number', step: '0.05', min: '0', value: pl.dose === null ? '' : pl.dose });
  const intIn = h('input', { id: 'pal-interval', class: 'input input--num', type: 'number', step: '1', min: String(r.intervalH.min), max: String(r.intervalH.max), value: pl.intervalH });
  const prnIn = h('input', { id: 'pal-prn', class: 'input input--num', type: 'number', step: '0.05', min: '0', value: pl.prnDose === null ? '' : pl.prnDose });
  const sch = h('input', { type: 'checkbox', id: 'pal-scheduled', checked: pl.scheduled });
  const bowel = h('input', { type: 'checkbox', id: 'pal-bowel', checked: pl.bowel });
  doseIn.addEventListener('change', () => { pl.dose = Number(doseIn.value) || null; pl.prnDose = null; re(); });
  intIn.addEventListener('change', () => { pl.intervalH = Number(intIn.value); pl.prnDose = null; re(); });
  prnIn.addEventListener('change', () => { pl.prnDose = Number(prnIn.value) || 0; });
  sch.addEventListener('change', () => { pl.scheduled = sch.checked; pl.prnDose = null; re(); });
  bowel.addEventListener('change', () => { pl.bowel = bowel.checked; re(); });
  const warns = rec.ok ? rec.warnings : [];
  const ack = warns.length ? h('label', { class: 'check check--block' }, h('input', { type: 'checkbox', id: 'pal-warn-ack', checked: pl.ack }), ' I have read the warning(s) above and take responsibility for this choice.') : null;
  if (ack) ack.querySelector('input').addEventListener('change', (e) => { pl.ack = e.target.checked; });
  const start = rec.ok ? h('div', { class: 'card card--muted' }, h('h4', {}, `${rgd.name} ${pl.route.toUpperCase()} — label starting dose (opioid-naïve)`),
    h('p', {}, `${rec.form}: ${rec.dose.min === rec.dose.max ? rec.dose.min : `${rec.dose.min}–${rec.dose.max}`} mg every ${r.intervalH.min === r.intervalH.max ? r.intervalH.min : `${r.intervalH.min}–${r.intervalH.max}`} h as needed${r.give ? `, ${r.give}` : ''} `, srcTags(rec.sources)),
    rec.notes.length ? h('ul', { class: 'list list--tight' }, rec.notes.map((n) => h('li', {}, n))) : null, h('p', { class: 'hint' }, rec.defaultRule),
    warns.map((w) => h('p', { class: 'notice notice--warn', role: 'alert' }, h('strong', {}, 'WARNING: '), w.message, ' ', srcTags(w.sources)))) : h('p', { class: 'notice notice--warn' }, rec.reason);
  const appr = h('button', { type: 'button', class: 'btn btn--primary', id: 'pal-approve' }, 'Approve & start regimen');
  appr.addEventListener('click', () => {
    const problems = [];
    if (!(pl.dose > 0)) problems.push(tolerant && pl.convert ? 'Compute the conversion (enter the reduction %).' : 'Enter a dose.');
    if (warns.length && !pl.ack) problems.push('Acknowledge the warning.');
    if (pl.prnDose === null || !(pl.prnDose >= 0)) problems.push('Enter a PRN dose (0 for none).');
    if (problems.length) { clear(out).append(h('p', { class: 'notice notice--warn', role: 'alert', id: 'pal-approve-err' }, problems.join(' '))); announce(problems.join(' '), true); return; }
    const sim = createPalliativeSim({ patient: p, caseDef: caseDef(), module: pal.module, seed: 1 });
    const res = sim.approveRegimen({ drugId: pl.drugId, route: pl.route, dose: pl.dose, intervalH: pl.intervalH, scheduled: pl.scheduled, prnDose: pl.prnDose, bowel: pl.bowel }, { approved: true });
    if (!res.ok) { clear(out).append(h('p', { class: 'notice notice--warn', role: 'alert', id: 'pal-approve-err' }, res.reason)); return; }
    pal.sim = sim; pal.step = 3; renderPalliative(main); announce('Regimen approved. Scheduled and PRN doses now run automatically; the daily review asks for your decisions.');
  });
  box.append(head('2 · Assess & plan', 'Doses auto-fill from the label/guideline values with their source tags; you approve the regimen. Nothing changes later without your approval.'), assess,
    h('section', { class: 'card' }, h('h3', {}, 'Opioid regimen'), h('div', { class: 'grid grid--2' }, h('div', { class: 'field' }, h('label', { for: 'pal-drug', class: 'label' }, 'Opioid'), drug), h('div', { class: 'field' }, h('label', { for: 'pal-route', class: 'label' }, 'Route'), route)),
      h('p', { class: 'hint' }, 'Subcutaneous opioid dosing, methadone and fentanyl: not simulated — specialist decision.'),
      tolerant ? null : start, conv,
      h('div', { class: 'grid grid--3' }, h('div', { class: 'field' }, h('label', { for: 'pal-dose', class: 'label' }, 'Dose (mg)'), doseIn), h('div', { class: 'field' }, h('label', { for: 'pal-interval', class: 'label' }, `Every (h; label ${r.intervalH.min}–${r.intervalH.max})`), intIn),
        h('div', { class: 'field' }, h('label', { for: 'pal-prn', class: 'label' }, 'PRN / breakthrough dose (mg)'), prnIn, h('p', { class: 'hint' }, bt && bt.ok ? `Breakthrough ${R.BREAKTHROUGH_PCT.value.join('–')}% of ${fmt(total24)} mg/24 h = ${bt.range.min}–${bt.range.max} mg (default ${bt.pct}%) ` : 'As-needed regimen: PRN dose = the label starting dose ', srcTags(bt ? bt.sources : r.sources)))),
      h('label', { class: 'check check--block' }, sch, ' Scheduled (around the clock); label wording is “as needed” — scheduling is a clinician choice'),
      h('label', { class: 'check check--block' }, bowel, ' Bowel regimen documented (laxative prophylaxis) ', srcTags(['S107'])),
      pl.scheduled && !pl.bowel ? h('p', { class: 'notice notice--warn', id: 'pal-bowel-reminder' }, 'Reminder: scheduled opioid without a bowel regimen — ESMO 2018 recommends routine laxatives [I, A]. ', srcTags(['S107'])) : null,
      p.cdcApplies ? h('p', { class: 'notice', id: 'pal-cdc-notes' }, 'CDC 2022 (non-cancer): immediate-release opioids first; lowest effective dose; for acute pain no greater quantity than needed for the expected duration; reassess benefits and risks before ≥50 MME/day; offer naloxone with risk factors; review PDMP data (teaching notes; PDMP not simulated). ', srcTags(['S105'])) : null,
      ack, out, h('div', { class: 'actions' }, appr)));
}

// ----------------------------------------------------------------------------- step 3: run
function tile(id, label, value, sub, cls = '') { return h('div', { class: `pal-tile ${cls}`, id }, h('span', { class: 'pal-tile__label' }, label), h('span', { class: 'pal-tile__value' }, value), sub ? h('span', { class: 'pal-tile__sub' }, sub) : null); }

function drawTrend(canvas, trend, series, { min, max, hours = 24, thresholds = [] }) {
  const dpr = window.devicePixelRatio || 1; const W = Math.max(200, canvas.clientWidth || 300); const H = Math.max(90, canvas.clientHeight || 120);
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.fillStyle = '#fbfcfa'; g.fillRect(0, 0, W, H);
  const pl = 30, pr = 6, pt = 6, pb = 16; const w = W - pl - pr; const hh = H - pt - pb;
  const tNow = trend.length ? trend[trend.length - 1].t : 0; const t1 = Math.max(tNow, hours * 60); const t0 = t1 - hours * 60;
  const x = (t) => pl + ((t - t0) / (hours * 60)) * w; const y = (v) => pt + hh - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * hh;
  g.strokeStyle = '#d7dcd9'; g.fillStyle = '#586773'; g.font = '10px Consolas, monospace';
  for (const v of [min, (min + max) / 2, max]) { const yy = Math.round(y(v)) + 0.5; g.beginPath(); g.moveTo(pl, yy); g.lineTo(pl + w, yy); g.stroke(); g.fillText(String(Math.round(v)), 2, yy + 3); }
  g.fillText(`−${hours} h`, pl, H - 3); g.fillText('now', pl + w - 20, H - 3);
  for (const th of thresholds) { g.save(); g.setLineDash([4, 3]); g.strokeStyle = '#88682f'; const yy = Math.round(y(th.v)) + 0.5; g.beginPath(); g.moveTo(pl, yy); g.lineTo(pl + w, yy); g.stroke(); g.restore(); g.fillStyle = '#88682f'; g.fillText(th.label, pl + 3, yy - 2); g.fillStyle = '#586773'; }
  for (const s of series) { g.save(); g.strokeStyle = s.color; g.lineWidth = 2; if (s.dash) g.setLineDash(s.dash); g.beginPath(); let pen = false;
    for (const p of trend) { if (p.t < t0) continue; const v = p[s.key]; if (v === null || !Number.isFinite(v)) { pen = false; continue; } if (!pen) { g.moveTo(x(p.t), y(v)); pen = true; } else g.lineTo(x(p.t), y(v)); }
    g.stroke(); g.restore(); }
}
const SYM_SERIES = [{ key: 'pain', label: 'Pain', color: '#18374b' }, { key: 'dyspnoea', label: 'Dyspnoea', color: '#0b6b8a', dash: [6, 3] }, { key: 'agitation', label: 'Agitation', color: '#8a5a00', dash: [2, 2] }, { key: 'secretions', label: 'Secretions', color: '#5b4a8a', dash: [8, 2, 2, 2] }];
const RASS_SERIES = [{ key: 'rass', label: 'RASS', color: '#18374b' }, { key: 'target', label: 'Target RASS', color: '#b3261e', dash: [5, 4] }];
const RR_SERIES = [{ key: 'rr', label: 'Respiratory rate', color: '#1e6b3a' }];
const legend = (series) => h('p', { class: 'pal-legend' }, series.map((s) => h('span', { class: 'pal-legend__item' }, h('span', { class: `pal-swatch pal-swatch--${s.key}`, 'aria-hidden': 'true' }), s.label)));

function stepRun(box, main) {
  const sim = pal.sim; const st = sim.state; const eol = pal.module === 'eol';
  const clock = h('span', { class: 'pal-clock', id: 'pal-clock', 'aria-live': 'off' }, fmtDay(st.tMin));
  const play = h('button', { type: 'button', class: 'btn btn--primary', id: 'pal-play', 'aria-pressed': pal.playing ? 'true' : 'false' }, pal.playing ? 'Pause' : 'Play');
  const speeds = SPEEDS.map(([m, l]) => { const b = h('button', { type: 'button', class: 'btn btn--small', dataset: { speed: String(m) }, 'aria-pressed': pal.speed === m ? 'true' : 'false' }, l); b.addEventListener('click', () => { pal.speed = m; refresh(); }); return b; });
  const stepBtns = [[60, '+1 h', 'pal-step-1h'], [360, '+6 h', 'pal-step-6h']].map(([m, l, id]) => { const b = h('button', { type: 'button', class: 'btn btn--small', id }, l); b.addEventListener('click', () => { advance(m); }); return b; });
  play.addEventListener('click', () => { if (pal.playing) stop(); else start(); refresh(); });
  const pausedBox = h('div', { id: 'pal-paused', 'aria-live': 'polite' });
  const tiles = h('div', { class: 'pal-tiles', id: 'pal-tiles' });
  const cSym = h('canvas', { class: 'pal-chart', id: 'pal-chart-sym', role: 'img', 'aria-label': 'Symptom scores, last 24 simulated hours (illustrative model output)' });
  const cRass = h('canvas', { class: 'pal-chart', id: 'pal-chart-rass', role: 'img', 'aria-label': 'RASS and documented target, last 24 simulated hours' });
  const cRr = h('canvas', { class: 'pal-chart', id: 'pal-chart-rr', role: 'img', 'aria-label': 'Respiratory rate, last 24 simulated hours' });
  const alarms = h('div', { id: 'pal-alarms' }); const review = h('div', { id: 'pal-review' }); const mar = h('div', { id: 'pal-mar' }); const fb = h('p', { class: 'feedback', id: 'pal-feedback', role: 'status' });
  const say = (t, bad = false) => { fb.textContent = t; fb.className = `feedback ${bad ? 'feedback--warn' : 'feedback--ok'}`; announce(t, bad); };
  const act = (id, label, fn, cls = 'btn') => { const b = h('button', { type: 'button', class: cls, id }, label); b.addEventListener('click', () => { const r = fn(); if (r && r.ok === false) say(r.reason || (r.reasons || []).join(' '), true); else if (r && r.note) say(r.note, true); else if (r && r.ok) say(`${label}: done.`); refresh(); }); return b; };
  const actions = h('section', { class: 'card' }, h('h3', {}, 'Clinician actions'),
    h('div', { class: 'btn-row' }, act('pal-prn-now', 'Give PRN dose now', () => sim.givePrnNow()),
      act('pal-naloxone', `Naloxone ${R.NALOXONE_DOSE_MG.value} mg IV (small increment)`, () => sim.naloxone(), 'btn btn--danger'),
      act('pal-bowel-run', 'Toggle bowel regimen', () => { sim.setBowel(!sim.state.bowelRegimen); return { ok: true }; }),
      eol ? act('pal-opioid-sedate', 'Increase opioid to sedate (teaching)', () => sim.adjustOpioid({ reason: 'sedation' })) : null),
    h('p', { class: 'hint' }, 'Naloxone: only for life-threatening respiratory depression; titrate to respiratory rate in small increments, never full reversal by default — risk of pain crisis or withdrawal in opioid-tolerant patients ', srcTags(['S116', 'S14']), '.'));
  let eolBox = null;
  if (eol) eolBox = eolPanels(sim, say, refresh);
  const family = h('textarea', { id: 'pal-family', class: 'input', rows: '3', maxlength: '4000' });
  family.value = st.familyNotes; family.addEventListener('input', () => sim.setFamilyNotes(family.value));
  const deb = h('button', { type: 'button', class: 'btn btn--primary', id: 'pal-debrief' }, 'Go to debrief');
  deb.addEventListener('click', () => { stop(); pal.step = 4; renderPalliative(main); });
  box.append(head(`3 · Run — ${MODULE_LABEL[pal.module]}`, 'Illustrative model output (author estimates; not validated). Scheduled and PRN doses run from your approved regimen; reviews and alarms pause for your decisions.'),
    h('div', { class: 'pal-toolbar' }, clock, play, h('span', { class: 'pal-toolbar__group', role: 'group', 'aria-label': 'Speed' }, speeds), h('span', { class: 'pal-toolbar__group', role: 'group', 'aria-label': 'Step' }, stepBtns)),
    pausedBox, fb, tiles,
    h('div', { class: 'grid grid--3 pal-charts' },
      h('figure', { class: 'card' }, h('figcaption', {}, 'Symptom scores (0–10)'), cSym, legend(SYM_SERIES)),
      h('figure', { class: 'card' }, h('figcaption', {}, 'RASS (−5 to +4) and documented target ', srcTags(['S120'])), cRass, legend(RASS_SERIES)),
      h('figure', { class: 'card' }, h('figcaption', {}, 'Respiratory rate (/min); alarm < 8 ', srcTags(['S116'])), cRr, legend(RR_SERIES))),
    h('div', { class: 'grid grid--2' }, h('section', { class: 'card' }, h('h3', {}, 'Alarms'), alarms), h('section', { class: 'card' }, h('h3', {}, 'Daily review'), review)),
    actions, ...(eolBox ? [eolBox] : []),
    h('section', { class: 'card' }, h('h3', {}, 'Medication administration record'), mar),
    h('section', { class: 'card' }, h('label', { for: 'pal-family', class: 'label' }, 'Family communication notes (free text; kept as text, never rendered as HTML)'), family),
    h('div', { class: 'actions' }, deb));

  function refresh() {
    const s = sim.state;
    clock.textContent = fmtDay(s.tMin);
    play.textContent = pal.playing ? 'Pause' : 'Play'; play.setAttribute('aria-pressed', pal.playing ? 'true' : 'false');
    for (const b of speeds) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === pal.speed));
    clear(pausedBox);
    if (s.paused) {
      const res = h('button', { type: 'button', class: 'btn btn--primary', id: 'pal-resume' }, 'Resume');
      res.addEventListener('click', () => { const r = sim.resume(); if (!r.ok) say(r.reason, true); refresh(); });
      pausedBox.append(h('p', { class: 'notice notice--warn', id: 'pal-paused-msg' }, s.paused.message, ' '), res);
    }
    const sy = s.symptoms;
    clear(tiles).append(tile('pal-t-pain', 'Pain (NRS)', fmt(sy.pain), '0–10'), tile('pal-t-dys', 'Dyspnoea', fmt(sy.dyspnoea), '0–10'), tile('pal-t-agi', 'Agitation', fmt(sy.agitation), '0–10'),
      tile('pal-t-rass', 'RASS', String(s.rass), s.sedation.targetRass !== null ? `target ${s.sedation.targetRass}` : 'no sedation target', s.rass <= -3 ? 'pal-tile--alert' : ''),
      tile('pal-t-rr', 'Resp. rate', fmt(s.rr), s.rr < R.RR_ALARM.value ? 'BELOW 8 — alarm' : '/min', s.rr < R.RR_ALARM.value ? 'pal-tile--alert' : ''),
      tile('pal-t-sec', 'Secretions', fmt(sy.secretions), '0–10'), tile('pal-t-nau', 'Nausea', fmt(sy.nausea), '0–10'), tile('pal-t-con', 'Constipation', fmt(sy.constipation), '0–10'),
      tile('pal-t-del', 'Delirium risk', s.deliriumRisk.level, 'illustrative'));
    drawTrend(cSym, s.trend, SYM_SERIES, { min: 0, max: 10 }); drawTrend(cRass, s.trend, RASS_SERIES, { min: -5, max: 4, thresholds: [{ v: -3, label: '−3' }] }); drawTrend(cRr, s.trend, RR_SERIES, { min: 0, max: 30, thresholds: [{ v: 8, label: '8' }] });
    clear(alarms).append(s.alarms.length ? h('ul', { class: 'pal-alarms' }, s.alarms.map((a) => { const b = h('button', { type: 'button', class: 'btn btn--small', dataset: { ack: a.id }, disabled: a.acknowledged }, a.acknowledged ? 'Acknowledged' : 'Acknowledge');
      b.addEventListener('click', () => { sim.acknowledge(a.id); refresh(); });
      return h('li', { class: `pal-alarm pal-alarm--${a.priority}`, dataset: { alarm: a.id } }, h('strong', {}, `${a.priority.toUpperCase()}: `), a.message, ' ', srcTags(a.sources), a.active ? '' : ' (condition cleared)', ' ', b); })) : h('p', { class: 'hint' }, 'No alarms.'));
    renderReview(review, sim, refresh, say);
    const w = sim.windowStats(Math.max(0, s.tMin - 1440)); const mme = mmePerDay(s.regimen);
    clear(mar).append(kv([['Regimen', `${s.regimen.scheduled ? 'Scheduled' : 'As needed'} ${s.regimen.drugId} ${s.regimen.dose} mg ${s.regimen.route.toUpperCase()} every ${s.regimen.intervalH} h; PRN ${s.regimen.prn ? `${s.regimen.prn.dose} mg` : 'none'}; bowel regimen ${s.bowelRegimen ? 'yes' : 'no'}`],
      ['Last 24 h', `scheduled ${w.scheduled24h} mg + PRN ${w.prn24h} mg (${w.prnCount} PRN doses) = ${w.total24h} mg`], ['MME/day (current regimen)', mme === null ? 'not computed (IV or no CDC factor)' : `${mme} — risk estimate only`]]),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact', id: 'pal-mar-table' }, h('thead', {}, h('tr', {}, ['Time', 'Drug', 'Route', 'Dose', 'Type', 'By'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, s.mar.slice(-10).reverse().map((m) => h('tr', {}, h('td', {}, fmtDay(m.tMin)), h('td', {}, m.drugId), h('td', {}, m.route.toUpperCase()), h('td', {}, `${m.dose} ${m.unit}`), h('td', {}, m.kind), h('td', {}, m.by)))))));
    if (eolBox && eolBox.refresh) eolBox.refresh();
    if (s.paused && pal.playing) { stop(); play.textContent = 'Play'; announce(s.paused.message, true); }
  }
  function advance(min) { sim.step(min); refresh(); }
  function start() { if (sim.state.paused) { say('Resolve the pause first (review items / HIGH alarm), then Resume.', true); return; } pal.playing = true; if (pal.testClock) return; pal.timer = setInterval(() => { sim.step(Math.max(1, Math.round(pal.speed / 4))); refresh(); }, 250); }
  pal.testAdvance = (min) => { advance(min); return true; };
  refresh();
}

function renderReview(box, sim, refresh, say) {
  const r = sim.state.pendingReview; clear(box);
  if (!r) { box.append(h('p', { class: 'hint' }, `Next review at the next ${R.REVIEW_INTERVAL_H.value}-h mark. Completed reviews: ${sim.state.reviews.length}.`)); return; }
  box.append(h('p', {}, `Review at ${fmtDay(r.tMin)} — mean pain ${r.stats.meanPain}, max ${fmt(r.stats.maxPain)}, PRN doses ${r.stats.prnCount}, total ${r.stats.total24h} mg/24 h.`));
  for (const s of r.suggestions) {
    const row = h('div', { class: `pal-sugg pal-sugg--${s.status}`, dataset: { sugg: s.id, kind: s.kind } }, h('p', {}, s.text, ' ', srcTags(s.sources)));
    if (s.status !== 'pending') { row.append(h('p', { class: 'hint' }, `Decision: ${s.status}`)); box.append(row); continue; }
    let ack = null; let rot = null;
    if (s.needsAck) { ack = h('input', { type: 'checkbox', id: `ack-${s.id}` }); row.append(h('label', { class: 'check check--block' }, ack, ' ', s.needsAck)); }
    if (s.kind === 'rotation') {
      const to = h('select', { id: `rot-${s.id}`, class: 'input' }, [['oxycodone:oral', 'Oral oxycodone'], ['hydromorphone:oral', 'Oral hydromorphone'], ['morphine:oral', 'Oral morphine'], ['morphine:iv', 'IV morphine']].map(([v, t]) => h('option', { value: v }, t)));
      const red = h('input', { id: `rotred-${s.id}`, class: 'input input--num', type: 'number', min: '0', max: '50', step: '5' });
      rot = { to, red }; row.append(h('div', { class: 'grid grid--2' }, h('div', { class: 'field' }, h('label', { for: `rot-${s.id}`, class: 'label' }, 'Rotate to'), to), h('div', { class: 'field' }, h('label', { for: `rotred-${s.id}`, class: 'label' }, 'Cross-tolerance reduction % (you choose)'), red)));
    }
    const yes = h('button', { type: 'button', class: 'btn btn--primary btn--small', dataset: { decide: 'approve' } }, s.kind === 'info' ? 'Acknowledge' : 'Approve');
    const no = s.kind === 'info' ? null : h('button', { type: 'button', class: 'btn btn--small', dataset: { decide: 'decline' } }, 'Decline');
    yes.addEventListener('click', () => {
      const opts = { ack: ack ? ack.checked : undefined };
      if (rot) { const [d, rt] = rot.to.value.split(':'); opts.toDrug = d; opts.toRoute = rt; opts.reductionPct = rot.red.value.trim() === '' ? null : Number(rot.red.value); }
      const res = sim.decide(s.id, 'approve', opts); if (!res.ok) say(res.reason, true); refresh();
    });
    if (no) no.addEventListener('click', () => { sim.decide(s.id, 'decline'); refresh(); });
    row.append(h('div', { class: 'btn-row' }, yes, no)); box.append(row);
  }
}

// EOL panels: non-pharmacological measures, monitoring toggle, documentation gate, sedation, hydration.
function eolPanels(sim, say, refresh) {
  const st = sim.state;
  const toggle = (id, label, key) => { const c = h('input', { type: 'checkbox', id, checked: st.nonPharm[key] }); c.addEventListener('change', () => { const r = sim.setNonPharm(key, c.checked); if (r.note) say(r.note, true); refresh(); }); return h('label', { class: 'check check--block' }, c, ' ', label); };
  const mon = h('input', { type: 'checkbox', id: 'pal-comfort-mon', checked: st.comfortMonitoring }); mon.addEventListener('change', () => { sim.setComfortMonitoring(mon.checked); refresh(); });
  const sym = h('section', { class: 'card' }, h('h3', {}, 'End-of-life symptoms'),
    h('p', {}, 'Dyspnoea: non-pharmacological measures first; oxygen only if hypoxaemic; systemic opioids when measures are insufficient (the comfort opioid continues; dyspnoea-specific dose changes are not simulated) ', srcTags(['S117']), '.'),
    toggle('pal-fan', 'Fan directed at the face', 'fan'), toggle('pal-positioning', 'Positioning (upright / repositioning)', 'positioning'), toggle('pal-oxygen', 'Supplemental oxygen', 'oxygen'),
    h('p', {}, 'Terminal respiratory secretions: no intervention shown superior to placebo; anticholinergic dosing not simulated — specialist decision ', srcTags(['S118']), '.'),
    h('p', {}, 'Delirium/agitation: review reversible causes first; antipsychotics and benzodiazepines minimised and reserved for failure of non-pharmacological measures (doses not simulated — specialist decision) ', srcTags(['S119']), '.'),
    h('label', { class: 'check check--block' }, mon, ' Comfort-focused monitoring (teaching toggle): routine respiratory-rate alarm shown as LOW, documented as a goals-of-care decision (simulator convention; no source cited).'));
  // Documentation gate.
  const doc = h('section', { class: 'card', id: 'pal-doc' }, h('h3', {}, 'Palliative sedation — documentation gate (all six required)'));
  const gate = h('div', { id: 'pal-gate-status', 'aria-live': 'polite' });
  const txt = (id, label, value) => [h('label', { for: id, class: 'label' }, label), h('textarea', { id, class: 'input', rows: '2', maxlength: '1000' }, value || '')];
  const d = st.doc;
  const refSym = h('select', { id: 'pd-ref-symptom', class: 'input' }, ['', 'agitation', 'dyspnoea', 'pain'].map((x) => h('option', { value: x, selected: d.refractory && d.refractory.symptom === x }, x || '— choose —')));
  const tried = TREATMENTS_TRIED.map((t, i) => h('label', { class: 'check check--block' }, h('input', { type: 'checkbox', id: `pd-tried-${i}`, dataset: { tried: t }, checked: !!(d.refractory && d.refractory.tried.includes(t)) }), ' ', t));
  const gocWith = h('select', { id: 'pd-goc-with', class: 'input' }, [['', '— choose —'], ['patient', 'Patient'], ['surrogate', 'Surrogate']].map(([v, t]) => h('option', { value: v, selected: d.goals && d.goals.with === v }, t)));
  const consType = h('select', { id: 'pd-consent-type', class: 'input' }, [['', '— choose —'], ['patient_consent', 'Patient consent'], ['surrogate_consent', 'Surrogate consent'], ['assent', 'Patient assent (with surrogate)']].map(([v, t]) => h('option', { value: v, selected: d.consent && d.consent.type === v }, t)));
  const ck = (id, label, on) => h('label', { class: 'check check--block' }, h('input', { type: 'checkbox', id, checked: !!on }), ' ', label);
  const save = h('button', { type: 'button', class: 'btn', id: 'pd-save' }, 'Save documentation');
  doc.append(
    h('fieldset', { class: 'fieldset' }, h('legend', {}, '1. Refractory symptom'), h('label', { for: 'pd-ref-symptom', class: 'label' }, 'Symptom'), refSym, h('p', { class: 'label' }, 'Treatments tried'), tried, ...txt('pd-ref-why', 'Why it is refractory', d.refractory && d.refractory.why)),
    h('fieldset', { class: 'fieldset' }, h('legend', {}, '2. Goals-of-care conversation'), h('details', {}, h('summary', {}, 'Conversation topics (paraphrased; Serious Illness Conversation Guide, CC BY-NC-SA 4.0) ', srcTags(['S104'])), h('ul', { class: 'list list--tight' }, GOC_PROMPTS.map((g) => h('li', {}, g)))),
      h('label', { for: 'pd-goc-with', class: 'label' }, 'Conversation with'), gocWith, ...txt('pd-goc-summary', 'Summary of what matters to the patient', d.goals && d.goals.summary)),
    h('fieldset', { class: 'fieldset' }, h('legend', {}, '3. Informed consent / assent'), h('label', { for: 'pd-consent-type', class: 'label' }, 'Type'), consType, ck('pd-consent-depth', 'Depth and duration of sedation, that lucidity may not return, and continuing care were discussed (AMA 5.6)', d.consent && d.consent.depthDiscussed)),
    h('fieldset', { class: 'fieldset' }, h('legend', {}, '4. Interdisciplinary input'), ck('pd-idt-specialist', 'Palliative-specialist input obtained', d.interdisciplinary && d.interdisciplinary.specialist), ...txt('pd-idt-note', 'Team members / input', d.interdisciplinary && d.interdisciplinary.note)),
    h('fieldset', { class: 'fieldset' }, h('legend', {}, '5. Prognosis'), h('p', {}, `Recorded prognosis category: ${sim.patient.prognosis}. Continuous deep sedation (target RASS −4/−5) only with “hours to days” `, srcTags(['S100', 'S117', 'S102'])), ck('pd-prognosis', 'I confirm the prognosis category recorded for this patient', d.prognosis && d.prognosis.confirmed)),
    h('fieldset', { class: 'fieldset' }, h('legend', {}, '6. Jurisdiction / policy'), ck('pd-jurisdiction', 'I have checked the applicable law and institutional policy; laws differ by jurisdiction', d.jurisdiction && d.jurisdiction.acknowledged)),
    h('div', { class: 'actions' }, save), gate);
  save.addEventListener('click', () => {
    const q = (id) => doc.querySelector(`#${id}`);
    sim.setDoc('refractory', { symptom: q('pd-ref-symptom').value, tried: [...doc.querySelectorAll('[data-tried]')].filter((c) => c.checked).map((c) => c.dataset.tried), why: q('pd-ref-why').value });
    sim.setDoc('goals', { with: q('pd-goc-with').value, summary: q('pd-goc-summary').value });
    sim.setDoc('consent', { type: q('pd-consent-type').value, depthDiscussed: q('pd-consent-depth').checked });
    sim.setDoc('interdisciplinary', { specialist: q('pd-idt-specialist').checked, note: q('pd-idt-note').value });
    sim.setDoc('prognosis', { confirmed: q('pd-prognosis').checked });
    sim.setDoc('jurisdiction', { acknowledged: q('pd-jurisdiction').checked });
    const g = sim.gateStatus(); say(g.complete ? 'Documentation complete: the sedation controls are enabled (each titration still needs your approval).' : `Documentation incomplete: ${g.missing.length} item(s) missing.`, !g.complete); refresh();
  });
  // Sedation controls.
  const sed = h('section', { class: 'card', id: 'pal-sed' }, h('h3', {}, 'Palliative sedation (proportionate; every titration needs your approval)'));
  const target = h('select', { id: 'pal-sed-target', class: 'input' }, [-1, -2, -3, -4, -5].map((v) => h('option', { value: String(v), selected: st.sedation.targetRass === v }, `RASS ${v}`)));
  const symSel = h('select', { id: 'pal-sed-symptom', class: 'input' }, ['agitation', 'dyspnoea', 'pain'].map((v) => h('option', { value: v, selected: st.sedation.symptom === v }, v)));
  const routeSel = h('select', { id: 'pal-sed-route', class: 'input' }, [['sc', 'SC'], ['iv', 'IV']].map(([v, t]) => h('option', { value: v }, t)));
  const rate = h('input', { id: 'pal-sed-rate', class: 'input input--num', type: 'number', min: '0', max: String(R.MIDAZOLAM_MAX_SIM_MG_H.value), step: '0.5', value: st.sedation.infusionMgH || SM.infusionStartMgH });
  const sAct = (id, label, fn) => { const b = h('button', { type: 'button', class: 'btn btn--small', id }, label); b.addEventListener('click', () => { const r = sim.sedationAction(fn(), { approved: true }); if (!r.ok) say(r.reasons.join(' '), true); else say(`${label}: approved and logged.`); refresh(); }); return b; };
  const ctrls = [sAct('pal-sed-set', 'Approve target', () => ({ type: 'set_target', targetRass: Number(target.value), symptom: symSel.value })),
    sAct('pal-sed-bolus', 'Approve starting bolus', () => ({ type: 'bolus', route: routeSel.value })), sAct('pal-sed-repeat', 'Approve repeat (half bolus)', () => ({ type: 'repeat' })),
    sAct('pal-sed-apply', 'Approve infusion rate', () => ({ type: 'infusion', rateMgH: Number(rate.value) })), sAct('pal-sed-stop', 'Approve stop', () => ({ type: 'stop' }))];
  const sedState = h('p', { id: 'pal-sed-state', class: 'hint' });
  sed.append(h('p', { class: 'hint' }, `Midazolam (step 1, revised EAPC framework): light — ${SM.bolus.light.sc.value} mg SC / ${SM.bolus.light.iv.value} mg IV; deep — ${SM.bolus.deep.sc.min}–${SM.bolus.deep.sc.max} mg SC / ${SM.bolus.deep.iv.min}–${SM.bolus.deep.iv.max} mg IV; half the starting bolus may be repeated after ${SM.repeatAfterMin.sc} min SC / ${SM.repeatAfterMin.iv} min IV; infusion starts at ${SM.infusionStartMgH} mg/h then adjust; above ${R.MIDAZOLAM_MAX_SIM_MG_H.value} mg/h consider adding/changing medication ${SM.notSimulated} Light/deep ↔ RASS mapping: ${SM.depthMapping}. `, srcTags(['S101', 'S120'])),
    h('p', { class: 'hint' }, 'Opioids are continued for comfort and are not escalated to sedate. The simulator never changes the sedation on its own.'),
    h('div', { class: 'grid grid--4' }, h('div', { class: 'field' }, h('label', { for: 'pal-sed-target', class: 'label' }, 'Target RASS (lowest level that relieves)'), target), h('div', { class: 'field' }, h('label', { for: 'pal-sed-symptom', class: 'label' }, 'Symptom to relieve'), symSel),
      h('div', { class: 'field' }, h('label', { for: 'pal-sed-route', class: 'label' }, 'Bolus route'), routeSel), h('div', { class: 'field' }, h('label', { for: 'pal-sed-rate', class: 'label' }, 'Infusion (mg/h)'), rate)),
    h('div', { class: 'btn-row' }, ctrls), sedState);
  // Hydration (separate decision).
  const hyd = h('section', { class: 'card', id: 'pal-hydration' }, h('h3', {}, 'Hydration and nutrition (separate decision)'));
  const hd = h('input', { type: 'checkbox', id: 'pal-hyd-discussed', checked: st.hydration.discussed });
  const hdec = h('select', { id: 'pal-hyd-decision', class: 'input' }, [['', '— not recorded —'], ['continue', 'Continue current hydration'], ['not_start', 'Not started'], ['reduce', 'Reduce / stop'], ['review', 'Review later']].map(([v, t]) => h('option', { value: v, selected: st.hydration.decision === v }, t)));
  const hnote = h('textarea', { id: 'pal-hyd-note', class: 'input', rows: '2', maxlength: '1000' }); hnote.value = st.hydration.note;
  const hsave = h('button', { type: 'button', class: 'btn btn--small', id: 'pal-hyd-save' }, 'Save hydration decision');
  hsave.addEventListener('click', () => { sim.setHydration({ discussed: hd.checked, decision: hdec.value, note: hnote.value }); say('Hydration decision documented.'); });
  hyd.append(h('p', { class: 'hint' }, 'Decided independently of sedation and discussed with the patient or family ', srcTags(['S101']), '. No outcome is modelled.'), h('label', { class: 'check check--block' }, hd, ' Discussed with patient / family'), h('label', { for: 'pal-hyd-decision', class: 'label' }, 'Decision'), hdec, h('label', { for: 'pal-hyd-note', class: 'label' }, 'Note'), hnote, hsave);
  const wrap = h('div', { class: 'pal-eol' }, sym, doc, sed, hyd);
  wrap.refresh = () => {
    const g = sim.gateStatus();
    clear(gate).append(g.complete ? h('p', { class: 'notice', id: 'pal-gate-ok' }, 'All six documentation items are complete.') : h('div', { class: 'notice notice--warn', id: 'pal-gate-missing' }, h('strong', {}, 'Sedation controls disabled — missing:'), h('ul', {}, g.missing.map((m) => h('li', {}, m)))));
    for (const b of ctrls) b.disabled = !g.complete;
    const s = sim.state.sedation; sedState.textContent = `Sedation ${s.active ? 'active' : 'not active'}; target ${s.targetRass === null ? 'not set' : `RASS ${s.targetRass} for ${s.symptom}`}; infusion ${s.infusionMgH} mg/h; approved titrations ${s.titrations.length}.`;
  };
  return wrap;
}

// ----------------------------------------------------------------------------- step 4: debrief
function stepDebrief(box) {
  const sim = pal.sim; const sm = sim.summary();
  const g = sm.documentation;
  const dl = h('button', { type: 'button', class: 'btn btn--primary', id: 'pal-download' }, 'Download session (JSON)');
  dl.addEventListener('click', () => {
    const data = { tool: 'Smart NOA simulator — palliative modules (educational; fictional patient)', banner: PALLIATIVE_BANNER, module: pal.module, caseId: pal.caseId, patient: sim.patient, summary: sm, log: sim.state.log, mar: sim.state.mar };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = h('a', { href: url, download: `smart-noa-palliative-${pal.module}.json`, class: 'sr-only' }, 'download'); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); announce('Session JSON downloaded.');
  });
  const canvas = h('canvas', { class: 'pal-chart pal-chart--tall', id: 'pal-db-timeline', role: 'img', 'aria-label': 'Proportionality timeline: RASS, documented target and symptom score' });
  const family = h('p', { class: 'pal-pre', id: 'pal-db-family' }); family.textContent = sm.familyNotes || '—';
  const hydNote = h('span', {}); hydNote.textContent = sm.hydration.note || '';
  box.append(head('4 · Debrief', `${MODULE_LABEL[pal.module]} · ${fmtDay(sm.durationMin)} · illustrative model output`),
    h('section', { class: 'card' }, h('h3', {}, 'Regimen and totals'), kv([['Final regimen', `${sm.regimen.drugId} ${sm.regimen.dose} mg ${sm.regimen.route.toUpperCase()} every ${sm.regimen.intervalH} h (${sm.regimen.scheduled ? 'scheduled' : 'as needed'}); PRN ${sm.regimen.prn ? `${sm.regimen.prn.dose} mg` : 'none'}`], ['Bowel regimen', sm.bowelRegimen ? 'yes' : 'no'], ['MME/day', sm.mmeDayNow === null ? 'not computed' : `${sm.mmeDayNow} (risk estimate; CDC 2022 ${sm.cdcApplies ? 'applies' : 'does not apply'})`]]),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact', id: 'pal-db-totals' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Drug / route / type'), h('th', { scope: 'col' }, 'Total (mg)'))), h('tbody', {}, Object.entries(sm.totals).map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, String(v))))))),
      h('p', {}, `Per day (opioid scheduled + PRN): ${sm.perDay.map((d) => `day ${d.day}: ${d.total} mg (${d.doses} doses)`).join('; ') || '—'}`)),
    h('section', { class: 'card' }, h('h3', {}, 'Reviews and decisions'), sm.reviews.length ? h('ul', { class: 'list' }, sm.reviews.flatMap((r) => r.suggestions.map((s) => h('li', {}, `${fmtDay(r.tMin)} — ${s.status}: ${s.text}`)))) : h('p', { class: 'hint' }, 'No review completed.')),
    h('section', { class: 'card' }, h('h3', {}, 'Alarms'), sm.alarms.length ? h('ul', { class: 'list list--tight' }, sm.alarms.map((a) => h('li', {}, `${fmtDay(a.tMin)} ${a.priority.toUpperCase()} ${a.id}`))) : h('p', { class: 'hint' }, 'No alarms.')),
    pal.module === 'eol' ? h('section', { class: 'card', id: 'pal-db-doc' }, h('h3', {}, 'Documentation checklist'), h('ul', { class: 'list list--tight' }, g.items.map((it) => h('li', {}, `${it.done ? '✓ complete' : '✗ missing'} — ${it.label}`))),
      h('h4', {}, 'Proportionality timeline (RASS vs documented target vs symptom score)'), canvas, legend([...RASS_SERIES, { key: 'symptom', label: 'Target symptom score (÷2, shown on the RASS axis)' }]),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact', id: 'pal-db-titrations' }, h('thead', {}, h('tr', {}, ['Time', 'Approved action', 'RASS', 'Target', 'Symptom score'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, sm.sedation.titrations.map((t) => h('tr', {}, h('td', {}, fmtDay(t.tMin)), h('td', {}, t.text), h('td', {}, String(t.rass)), h('td', {}, t.target === null ? '—' : String(t.target)), h('td', {}, t.symptomScore === null ? '—' : fmt(t.symptomScore))))))),
      h('p', {}, `Hydration/nutrition: ${sm.hydration.discussed ? 'discussed' : 'not documented as discussed'}; decision ${sm.hydration.decision || '—'}. `, hydNote)) : null,
    h('section', { class: 'card' }, h('h3', {}, 'Family communication notes'), family),
    h('section', { class: 'card card--muted' }, h('h3', {}, 'Ethics notes'), h('ul', { class: 'list' },
      h('li', {}, 'Palliative sedation relieves refractory suffering; intent, proportionality and titration to comfort distinguish it from euthanasia or medical aid in dying. Laws and policies differ by jurisdiction. ', srcTags(['S101', 'S102'])),
      h('li', {}, 'Comfort opioids were continued at their dose, not escalated to sedate. ', srcTags(['S101'])),
      h('li', {}, EXCLUSIONS_TEXT),
      h('li', {}, 'Model limits: every symptom score, RASS and respiratory rate is illustrative model output from author estimates; the model is not validated.'))),
    h('div', { class: 'actions' }, dl));
  if (pal.module === 'eol') {
    const sym = sm.sedation.symptom || 'agitation';
    drawTrend(canvas, sm.timeline.map((p) => ({ ...p, symptom: p[sym] / 2 })), [...RASS_SERIES, { key: 'symptom', color: '#8a5a00', dash: [2, 2] }], { min: -5, max: 5, hours: Math.max(24, Math.ceil(sm.durationMin / 60)) });
  }
}

// ----------------------------------------------------------------------------- ethics dialog
export function renderEthics(body) {
  clear(body).append(h('p', { class: 'notice notice--warn' }, PALLIATIVE_BANNER),
    ...ETHICS_PANEL.map((sec) => h('section', { class: 'pal-ethics' }, h('h3', {}, sec.h), h('dl', { class: 'kv kv--wide' }, sec.items.flatMap(([k, v, s]) => [h('dt', {}, k), h('dd', {}, v, ' ', srcTags(s))])))),
    h('section', { class: 'pal-ethics' }, h('h3', {}, 'Communication: goals-of-care topics (paraphrased)'), h('p', { class: 'hint' }, 'Adapted in paraphrase from the Serious Illness Conversation Guide, © Ariadne Labs, CC BY-NC-SA 4.0 ', srcTags(['S104'])), h('ol', { class: 'list list--tight' }, GOC_PROMPTS.map((g) => h('li', {}, g)))),
    h('p', { class: 'hint' }, EXCLUSIONS_TEXT));
}

/** Plain-data snapshot for the browser smoke test (?test=1). */
export function palSnapshot() {
  const s = pal.sim ? pal.sim.state : null;
  return JSON.parse(JSON.stringify({ module: pal.module, step: pal.step, caseId: pal.caseId, playing: pal.playing,
    sim: s ? { tMin: s.tMin, paused: s.paused, regimen: s.regimen, symptoms: s.symptoms, rass: s.rass, rr: s.rr, alarms: s.alarms, pendingReview: s.pendingReview, reviews: s.reviews.length, sedation: s.sedation, gate: pal.sim.gateStatus(), mar: s.mar.length, bowel: s.bowelRegimen } : null }));
}
