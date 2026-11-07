// Step 1 — Patient form (fictional adult patients only).
import { h, announce, fill } from './dom.js';
import { validatePatient, LIMITS } from '../engine/patient.js';
import { CONDITION_GROUPS } from './labels.js';
import { EXAMPLE_PATIENTS } from '../data/scenarios.js';

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.'); let a = o;
  for (const k of ks.slice(0, -1)) { if (a[k] == null || typeof a[k] !== 'object') a[k] = {}; a = a[k]; }
  if (v === undefined) delete a[ks[ks.length - 1]]; else a[ks[ks.length - 1]] = v;
}
const fid = (path) => `pf-${path.replace(/\./g, '-')}`;

const FIELD_LABELS = {
  sex: 'Sex', ageYears: 'Age', heightCm: 'Height', weightKg: 'Weight', asa: 'ASA physical status', emergency: 'Emergency',
  'baseline.hr': 'Heart rate', 'baseline.sbp': 'Systolic BP', 'baseline.dbp': 'Diastolic BP', 'baseline.spo2': 'SpO2', 'baseline.rr': 'Respiratory rate',
  egfr: 'eGFR', 'airway.mallampati': 'Mallampati class', 'stopBang.neckCm': 'Neck circumference',
};

export function renderPatient(ctx, main) {
  const { store, lib } = ctx;
  const model = store.patientInput;
  const touched = new Set();
  let showAll = false;

  const errEls = new Map();
  const numberField = (path, label, unit, { step = 'any', hint = null, optional = false } = {}) => {
    const lim = LIMITS[path.split('.').pop()] || null;
    const id = fid(path); const errId = `${id}-err`; const hintId = `${id}-hint`;
    const v = getPath(model, path);
    const input = h('input', { type: 'number', inputmode: 'decimal', id, class: 'input input--num', step, min: lim ? lim[0] : null, max: lim ? lim[1] : null,
      value: v === undefined || v === null || Number.isNaN(v) ? '' : v, 'aria-describedby': `${hintId} ${errId}`, dataset: { path } });
    input.addEventListener('input', () => {
      const raw = input.value.trim();
      setPath(model, path, raw === '' ? (optional ? undefined : null) : Number(raw));
      touched.add(path); changed();
    });
    input.addEventListener('blur', () => { touched.add(path); refreshErrors(); });
    const err = h('p', { class: 'field-error', id: errId, hidden: true });
    errEls.set(path, { err, input });
    return h('div', { class: 'field' },
      h('label', { for: id, class: 'label' }, label, unit ? h('span', { class: 'unit' }, ` (${unit})`) : null, optional ? h('span', { class: 'muted' }, ' — optional') : null),
      input,
      h('p', { class: 'hint', id: hintId }, hint || (lim ? `Allowed ${lim[0]}–${lim[1]}` : '')),
      err);
  };
  const checkbox = (path, label, hint = null) => {
    const id = fid(path);
    const input = h('input', { type: 'checkbox', id, checked: !!getPath(model, path), dataset: { path } });
    input.addEventListener('change', () => { setPath(model, path, input.checked); changed(); });
    return h('div', { class: 'check' }, input, h('label', { for: id }, label, hint ? h('span', { class: 'muted' }, ` — ${hint}`) : null));
  };
  const listChecks = (field, items, legendText, groupFilter = null) => {
    const set = new Set(model[field] || []);
    const boxes = items.filter((it) => !groupFilter || it.group === groupFilter).map((it) => {
      const id = `pf-${field}-${it.id}`;
      const input = h('input', { type: 'checkbox', id, checked: set.has(it.id), dataset: { list: field, item: it.id } });
      input.addEventListener('change', () => {
        const cur = new Set(model[field] || []);
        if (input.checked) cur.add(it.id); else cur.delete(it.id);
        model[field] = items.map((x) => x.id).filter((x) => cur.has(x));
        changed();
      });
      return h('div', { class: 'check' }, input, h('label', { for: id }, it.label));
    });
    if (!boxes.length) return null;
    return h('fieldset', { class: 'fieldset fieldset--checks' }, h('legend', {}, legendText), h('div', { class: 'check-grid' }, boxes));
  };

  // --- live derived preview
  const preview = h('p', { class: 'preview', id: 'pf-preview', 'aria-live': 'polite' });
  const updatePreview = () => {
    const b = model.baseline || {}; const ok = (x) => typeof x === 'number' && Number.isFinite(x);
    const parts = [];
    if (ok(b.sbp) && ok(b.dbp) && b.dbp < b.sbp) parts.push(`MAP ${Math.round(b.dbp + (b.sbp - b.dbp) / 3)} mmHg`);
    if (ok(model.weightKg) && ok(model.heightCm)) parts.push(`BMI ${(model.weightKg / (model.heightCm / 100) ** 2).toFixed(1)} kg/m²`);
    preview.textContent = parts.length ? `Derived: ${parts.join(' · ')} (full assessment on the next step)` : '';
  };

  const errorSummary = h('div', { class: 'error-summary', id: 'pf-error-summary', tabindex: '-1', hidden: true, role: 'alert' });

  function currentErrors() {
    const v = validatePatient(model, { library: lib });
    const byField = new Map();
    for (const e of v.errors) {
      const val = getPath(model, e.field);
      const msg = val === null || val === undefined || (typeof val === 'number' && Number.isNaN(val)) ? 'Required — enter a number.' : e.message.replace(/\s*\(got [^)]*\)\s*$/, '').replace(/^must/, 'Must');
      if (!byField.has(e.field)) byField.set(e.field, msg);
    }
    return { ok: v.ok, byField };
  }
  function refreshErrors() {
    const { byField } = currentErrors();
    for (const [path, { err, input }] of errEls) {
      const msg = byField.get(path);
      const show = msg && (showAll || touched.has(path));
      err.hidden = !show; err.textContent = show ? msg : '';
      if (show) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    }
    if (showAll && byField.size) {
      fill(errorSummary, h('h3', {}, `Please correct ${byField.size} ${byField.size === 1 ? 'field' : 'fields'}`),
        h('ul', {}, [...byField].map(([f, m]) => h('li', {}, errEls.has(f) ? h('a', { href: `#${fid(f)}`, dataset: { focus: fid(f) } }, `${FIELD_LABELS[f] || f}: ${m}`) : `${FIELD_LABELS[f] || f}: ${m}`))));
      errorSummary.hidden = false;
    } else errorSummary.hidden = true;
    return byField;
  }
  errorSummary.addEventListener('click', (e) => { const a = e.target.closest('[data-focus]'); if (a) { e.preventDefault(); document.getElementById(a.dataset.focus).focus(); } });

  function changed() { ctx.patientChanged(); updatePreview(); refreshErrors(); ctx.refreshStepper(); }

  // --- examples
  const exSel = h('select', { id: 'pf-example', class: 'input' },
    h('option', { value: '' }, 'Choose a fictional example…'),
    EXAMPLE_PATIENTS.map((e) => h('option', { value: e.id, selected: store.exampleId === e.id }, e.label)));
  const exBtn = h('button', { type: 'button', class: 'btn', id: 'pf-load-example' }, 'Load example case');
  exBtn.addEventListener('click', () => {
    if (!exSel.value) { exSel.focus(); announce('Choose an example first.'); return; }
    ctx.loadExample(exSel.value);
    ctx.rerender();
    announce(`Example case loaded: ${EXAMPLE_PATIENTS.find((e) => e.id === exSel.value).label}. Patient and matching anaesthetic plan filled in.`);
  });

  const sexField = h('fieldset', { class: 'fieldset fieldset--inline' }, h('legend', {}, 'Sex (for weight scalars and scores)'),
    ['female', 'male'].map((s) => {
      const id = `pf-sex-${s}`;
      const r = h('input', { type: 'radio', name: 'pf-sex', id, value: s, checked: model.sex === s });
      r.addEventListener('change', () => { if (r.checked) { model.sex = s; changed(); } });
      return h('div', { class: 'check' }, r, h('label', { for: id }, s === 'female' ? 'Female' : 'Male'));
    }));

  const asaSel = h('select', { id: fid('asa'), class: 'input', 'aria-describedby': 'pf-asa-hint' }, [1, 2, 3, 4, 5].map((n) => h('option', { value: n, selected: model.asa === n }, `ASA ${n}`)));
  asaSel.addEventListener('change', () => { model.asa = Number(asaSel.value); changed(); });
  const mallSel = h('select', { id: fid('airway.mallampati'), class: 'input' }, [1, 2, 3, 4].map((n) => h('option', { value: n, selected: model.airway && model.airway.mallampati === n }, `Class ${n}`)));
  mallSel.addEventListener('change', () => { setPath(model, 'airway.mallampati', Number(mallSel.value)); changed(); });

  const cont = h('button', { type: 'submit', class: 'btn btn--primary', id: 'pf-continue' }, 'Continue to assessment →');
  const form = h('form', { class: 'patient-form', novalidate: true, 'aria-labelledby': 'step-title' },
    errorSummary,
    h('section', { class: 'card' }, h('h3', {}, 'Demographics'),
      h('div', { class: 'grid grid--4' },
        sexField,
        numberField('ageYears', 'Age', 'years', { step: '1', hint: 'Adults 18–90 y only' }),
        numberField('heightCm', 'Height', 'cm'),
        numberField('weightKg', 'Weight', 'kg'),
        h('div', { class: 'field' }, h('label', { class: 'label', for: fid('asa') }, 'ASA physical status'), asaSel, h('p', { class: 'hint', id: 'pf-asa-hint' }, '1 (healthy) to 5')),
        h('div', { class: 'field field--check' }, checkbox('emergency', 'Emergency procedure', 'adds aspiration-risk flag')),
      )),
    h('section', { class: 'card' }, h('h3', {}, 'Baseline vital signs & renal function'),
      h('div', { class: 'grid grid--6' },
        numberField('baseline.hr', 'Heart rate', '/min'),
        numberField('baseline.sbp', 'Systolic BP', 'mmHg'),
        numberField('baseline.dbp', 'Diastolic BP', 'mmHg'),
        numberField('baseline.spo2', 'SpO2 (room air)', '%'),
        numberField('baseline.rr', 'Respiratory rate', '/min'),
        numberField('egfr', 'eGFR', 'mL/min/1.73 m²'),
      ), preview),
    h('section', { class: 'card' }, h('h3', {}, 'Airway'),
      h('div', { class: 'grid grid--4' },
        h('div', { class: 'field' }, h('label', { class: 'label', for: fid('airway.mallampati') }, 'Mallampati class'), mallSel),
        h('div', { class: 'field field--check' },
          checkbox('airway.difficultHistory', 'Previous difficult airway'),
          checkbox('airway.limitedMouthOpening', 'Limited mouth opening'),
          checkbox('airway.limitedNeck', 'Limited neck movement')))),
    h('section', { class: 'card' }, h('h3', {}, 'Conditions'),
      h('p', { class: 'muted' }, 'Conditions drive contraindication lockouts/warnings and illustrative patient modifiers.'),
      h('div', { class: 'grid grid--2' }, CONDITION_GROUPS.map(([g, label]) => listChecks('conditions', lib.CONDITIONS, label, g)),
        listChecks('conditions', lib.CONDITIONS.filter((c) => !CONDITION_GROUPS.some(([g]) => g === c.group)), 'Other'))),
    h('section', { class: 'card' }, h('h3', {}, 'Allergies & current medications'),
      h('div', { class: 'grid grid--2' }, listChecks('allergies', lib.ALLERGIES, 'Allergies'), listChecks('medications', lib.MEDICATIONS, 'Medications'))),
    h('section', { class: 'card' }, h('h3', {}, 'PONV risk factors (Apfel) & STOP-Bang'),
      h('div', { class: 'grid grid--2' },
        h('fieldset', { class: 'fieldset' }, h('legend', {}, 'Apfel factors (sex is taken from above)'),
          checkbox('ponvHistory', 'History of PONV or motion sickness'),
          checkbox('smoker', 'Current smoker'),
          checkbox('postopOpioidsExpected', 'Postoperative opioids expected')),
        h('fieldset', { class: 'fieldset' }, h('legend', {}, 'STOP-Bang items (BMI, age and sex are derived)'),
          checkbox('stopBang.snoring', 'Snores loudly'),
          checkbox('stopBang.tired', 'Tired / sleepy in the daytime'),
          checkbox('stopBang.observedApnea', 'Observed apnoea during sleep'),
          checkbox('stopBang.pressure', 'Treated for high blood pressure', 'also counted if “Uncontrolled hypertension” is ticked'),
          numberField('stopBang.neckCm', 'Neck circumference', 'cm', { optional: true, hint: 'Leave blank if not measured' })))),
    h('div', { class: 'actions' }, cont),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showAll = true;
    const errs = refreshErrors();
    if (errs.size) {
      errorSummary.focus();
      announce(`${errs.size} field${errs.size === 1 ? '' : 's'} need correcting.`, true);
      return;
    }
    ctx.go(2);
  });

  fill(main, 
    h('div', { class: 'step-head' },
      h('h2', { id: 'step-title', tabindex: '-1' }, '1 · Patient'),
      h('p', { class: 'muted' }, 'Enter a fictional adult patient (18–90 y). Pregnancy, paediatrics, cardiac bypass and neuraxial/regional techniques are not modelled.')),
    h('section', { class: 'card card--accent' },
      h('h3', {}, 'Load an example case'),
      h('p', { class: 'muted' }, 'Loads a fictional patient and the matching example plan (doses are filled from the drug library at load time).'),
      h('div', { class: 'inline-form' }, h('label', { for: 'pf-example', class: 'label' }, 'Example case'), exSel, exBtn)),
    form);
  updatePreview();
  refreshErrors();
}

export function defaultPatientInput() {
  const p = EXAMPLE_PATIENTS[0].patient;
  return JSON.parse(JSON.stringify(p));
}
