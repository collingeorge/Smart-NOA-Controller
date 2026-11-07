// Step 2 — Assessment (computed, read-only).
import { h, fmtNum, fill } from './dom.js';
import { evaluateContraindications } from '../engine/dosing.js';
import { createSimulation } from '../engine/sim.js';
import { srcTags, sourcesInText } from './sources.js';
import { FLAG_LABELS, CLASS_LABELS, notModeled } from './labels.js';

export function computeLockouts(patient, lib) {
  // The simulation computes the full lockout set (library LOCK rules + Python controller free-text lockouts).
  const sim = createSimulation({ patient, plan: null, seed: 1, interlocks: true, library: lib });
  const locks = sim.state.interlocks.lockouts;
  const rows = [];
  for (const d of lib.DRUGS) {
    const cis = evaluateContraindications(patient, d.id, lib);
    const lockMsgs = locks[d.id] || [];
    const libLocks = cis.filter((c) => c.severity === 'lock');
    const warns = cis.filter((c) => c.severity === 'warn');
    if (!lockMsgs.length && !warns.length) continue;
    rows.push({ drug: d, locked: lockMsgs.length > 0,
      lockItems: lockMsgs.map((m) => ({ message: m, sources: (libLocks.find((c) => c.message === m) || {}).sources || sourcesInText(m) })),
      warnItems: warns.map((c) => ({ message: c.message, sources: c.sources })) });
  }
  return rows;
}

export function renderAssessment(ctx, main) {
  const { lib } = ctx;
  const p = ctx.getPatient();
  if (!p) { ctx.go(1); return; }
  const E = lib.SOURCE_IDS_ENGINE || {};
  const kg = (v) => `${fmtNum(v, 1)} kg`;
  const aw = p.airway;
  const awConcerns = [];
  if (aw.mallampati >= 3) awConcerns.push(`Mallampati class ${aw.mallampati}`);
  if (aw.difficultHistory) awConcerns.push('Previous difficult airway');
  if (aw.limitedMouthOpening) awConcerns.push('Limited mouth opening');
  if (aw.limitedNeck) awConcerns.push('Limited neck movement');
  if (p.flags.includes('aspirationRisk')) awConcerns.push('Aspiration risk');
  if (p.flags.includes('osaRisk')) awConcerns.push('OSA / high STOP-Bang risk (faster desaturation and obstruction in the model)');

  const rows = computeLockouts(p, lib);
  const sb = p.stopBang;
  const sbItems = Object.entries(sb.items || {}).filter(([, v]) => v).map(([k]) => ({ snoring: 'snoring', tired: 'tiredness', observedApnea: 'observed apnoea', pressure: 'high blood pressure', bmiOver35: 'BMI > 35', ageOver50: 'age > 50', neckOver40: 'neck > 40 cm', male: 'male sex' }[k] || k));
  const ap = p.apfel;
  const apItems = Object.entries(ap.factors || {}).filter(([, v]) => v).map(([k]) => ({ female: 'female sex', nonSmoker: 'non-smoker', ponvHistory: 'PONV/motion-sickness history', postopOpioids: 'postoperative opioids' }[k] || k));

  fill(main, 
    h('div', { class: 'step-head' },
      h('h2', { id: 'step-title', tabindex: '-1' }, '2 · Assessment'),
      h('p', { class: 'muted' }, 'Computed from the patient entries. Read-only — go back to step 1 to change anything.')),
    h('div', { class: 'grid grid--3' },
      h('section', { class: 'card' }, h('h3', {}, 'Body size & weight scalars'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'BMI'), h('dd', {}, `${fmtNum(p.bmi, 1)} kg/m²`),
          h('dt', {}, 'Total body weight (TBW)'), h('dd', {}, kg(p.weightKg)),
          h('dt', {}, 'Ideal body weight (IBW, Devine)'), h('dd', {}, kg(p.ibwKg), ' ', srcTags([E.ibwDevine])),
          h('dt', {}, 'Lean body weight (LBW, Janmahasatian)'), h('dd', {}, kg(p.lbwKg), ' ', srcTags([E.lbwJanmahasatian])),
          h('dt', {}, 'Adjusted body weight (ABW = IBW + 0.4 × (TBW − IBW))'), h('dd', {}, kg(p.abwKg))),
        p.ibwKg > p.weightKg ? h('p', { class: 'hint' }, 'IBW exceeds TBW: scalars are capped at TBW when dosing.') : null),
      h('section', { class: 'card' }, h('h3', {}, 'Haemodynamics & scores'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Baseline MAP'), h('dd', {}, `${Math.round(p.map)} mmHg (DBP + (SBP − DBP)/3)`),
          h('dt', {}, 'Apfel simplified PONV score'), h('dd', {}, `${ap.score}/4 — ${ap.riskPercent} % risk `, srcTags([E.apfel]),
            h('div', { class: 'hint' }, apItems.length ? `Factors: ${apItems.join(', ')}` : 'No factors')),
          h('dt', {}, 'STOP-Bang'), h('dd', {}, `${sb.score}/8 — ${sb.risk} risk `, srcTags([E.stopBang, E.stopBangRisk]),
            h('div', { class: 'hint' }, sbItems.length ? `Items: ${sbItems.join(', ')}` : 'No items', sb.escalated ? '; intermediate score escalated to high (STOP ≥ 2 plus male/BMI > 35/neck > 40)' : '', sb.neckMeasured ? '' : '; neck not measured')),
          h('dt', {}, 'eGFR'), h('dd', {}, `${p.egfr} mL/min/1.73 m²`))),
      h('section', { class: 'card' }, h('h3', {}, 'Airway concerns'),
        awConcerns.length ? h('ul', { class: 'list' }, awConcerns.map((c) => h('li', {}, c))) : h('p', {}, 'None entered.'),
        h('h4', {}, 'Simulator flags'),
        p.flags.length ? h('ul', { class: 'chips' }, p.flags.map((f) => h('li', { class: 'chip' }, FLAG_LABELS[f] || f))) : h('p', {}, 'No flags.'),
        h('p', { class: 'hint' }, 'Flags are simulator rules that select label adjustments (e.g. elderly dosing) and illustrative model modifiers.'))),
    h('section', { class: 'card' }, h('h3', {}, 'Drug lockouts & warnings for this patient'),
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Drug'), h('th', { scope: 'col' }, 'Status'), h('th', { scope: 'col' }, 'Reason and source'))),
        h('tbody', {}, rows.map((r) => h('tr', { class: r.locked ? 'row--locked' : 'row--warn' },
          h('th', { scope: 'row' }, r.drug.name, h('div', { class: 'hint' }, CLASS_LABELS[r.drug.cls] || r.drug.cls)),
          h('td', {}, r.locked ? h('span', { class: 'badge badge--lock' }, 'LOCKED') : h('span', { class: 'badge badge--warn' }, 'WARNING')),
          h('td', {}, h('ul', { class: 'list list--tight' },
            r.lockItems.map((x) => h('li', {}, x.message, ' ', srcTags(x.sources))),
            r.warnItems.map((x) => h('li', {}, h('span', { class: 'warn-text' }, 'Warning: '), x.message, ' ', srcTags(x.sources))))))))))
        : h('p', {}, 'No lockouts or warnings for this patient.'),
      h('p', { class: 'hint' }, 'Locked drugs cannot be given in the simulator, even with the Smart NOA interlocks switched off.')),
    h('section', { class: 'card card--muted' }, h('h3', {}, 'Not modelled'),
      h('ul', { class: 'chips' }, notModeled(lib, { fluids: ctx.fluidsSupported() }).map((x) => h('li', { class: 'chip chip--muted' }, x)))),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.go(1) }, '← Back to patient'),
      h('button', { type: 'button', class: 'btn btn--primary', id: 'as-continue', onclick: () => ctx.go(3) }, 'Continue to anesthetic plan →')),
  );
}
