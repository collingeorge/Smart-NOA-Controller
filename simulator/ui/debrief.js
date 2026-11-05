// Step 5 — Debrief: totals, haemodynamic/oxygenation summary, alarms, interlock events, extubation.
import { h, clear, fmtClock, fmtNum, isNum, announce } from './dom.js';
import { srcTags } from './sources.js';
import { PRIORITY_LABELS, PRIORITY_SHAPES } from './labels.js';
import { getDrugById } from './plan-model.js';
import { readinessItem } from './monitor.js';
import { exportPlan } from './plan-model.js';
import { loadModelAssumptions, assumptionsList } from './model-card.js';

export function renderDebrief(ctx, main) {
  const { store, lib } = ctx;
  const sim = store.sim;
  if (!sim) { ctx.go(4); return; }
  sim.pause(); store.run.playing = false;
  const s = sim.summary();
  const p = sim.patient;
  const totals = Object.entries(s.totals);
  const fl = sim.state.fluids && isNum(sim.state.fluids.crystalloidMl) ? sim.state.fluids.crystalloidMl : null;
  const ext = s.extubation || {};
  const overrides = store.run.overrides || [];
  const planStatus = sim.planStatus();
  const modelInfo = sim.modelInfo();

  const assumptionsHost = h('div', {}, h('h4', {}, 'Model assumptions (from SOURCES.md)'), h('p', { class: 'hint' }, 'Loading…'));
  loadModelAssumptions().then((a) => { assumptionsHost.lastChild.replaceWith(assumptionsList(a)); });
  const dl = h('button', { type: 'button', class: 'btn btn--primary', id: 'db-download' }, 'Download session (JSON)');
  dl.addEventListener('click', () => {
    const data = {
      notice: 'SIMULATION — fictional patient — educational use only. Not a medical device. Not medical advice.',
      generatedAt: new Date().toISOString(),
      seed: sim.seed, interlocksEnabled: store.interlocks,
      patientInput: store.patientInput, patientDerived: p,
      plan: exportPlan(store.plan), planStatus,
      summary: s, fluidsCrystalloidMl: fl, extubationOverrides: overrides,
      modelInfo, log: sim.state.log,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `smart-noa-sim-session-seed${sim.seed}.json`, class: 'sr-only' }, 'download');
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    announce('Session JSON downloaded.');
  });

  clear(main).append(
    h('div', { class: 'step-head' }, h('h2', { id: 'step-title', tabindex: '-1' }, '5 · Debrief'),
      h('p', { class: 'muted' }, `Simulated duration ${fmtClock(s.durationSec)} · ${sim.plan.mode === 'GA' ? 'general anaesthesia' : `MAC (${sim.plan.sedationTarget})`} · interlocks ${store.interlocks ? 'on' : 'off'} · seed ${sim.seed}. ${s.modelNote}`)),
    h('div', { class: 'grid grid--4 stats' },
      stat('Time MAP < 65 mmHg', fmtClock(s.timeMapBelow65Sec)),
      stat('Minimum SpO2', isNum(s.minSpo2) ? `${s.minSpo2} %` : '—'),
      stat('HR range', isNum(s.minHr) ? `${s.minHr}–${s.maxHr} /min` : '—'),
      stat('Alarms raised', String(s.alarms.length)),
      fl !== null ? stat('Crystalloid given', `${fl} mL`) : null),
    h('section', { class: 'card' }, h('h3', {}, 'Drug totals'),
      totals.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'db-totals' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Drug'), h('th', { scope: 'col' }, 'Total'), h('th', { scope: 'col' }, `Per kg (TBW ${p.weightKg} kg)`))),
        h('tbody', {}, totals.map(([id, t]) => h('tr', {}, h('th', { scope: 'row' }, getDrugById(lib, id)?.name || id), h('td', { class: 'mono' }, `${fmtNum(t.amount, 3)} ${t.unit}`),
          h('td', { class: 'mono' }, t.perKg === null ? (t.unit === '%·h' ? 'n/a (dial-hours)' : '—') : `${fmtNum(t.perKg, 3)} ${t.unit}/kg`)))))) : h('p', {}, 'No drugs given.'),
      h('p', { class: 'hint' }, 'Inhaled agents are totalled as dial %·hours (area under the vaporizer setting), not as an amount.')),
    h('div', { class: 'grid grid--2' },
      h('section', { class: 'card' }, h('h3', {}, 'Extubation'),
        sim.plan.mode !== 'GA' ? h('p', {}, 'Not applicable (MAC / sedation).') :
          [h('p', {}, ext.tSec === null || ext.tSec === undefined ? 'Not extubated — readiness at the end of the session:' : `Extubated at ${fmtClock(ext.tSec)} — readiness ${ext.ready ? 'met' : 'NOT met'}:`),
            h('ul', { class: 'ready-list ready-list--light' }, (ext.criteria || []).map((c) => readinessItem(c))),
            overrides.length ? h('p', { class: 'error-text' }, `Extubated despite unmet criteria (user confirmed, logged): ${overrides.map((o) => `${fmtClock(o.tSec)} — ${o.unmet.join(', ')}`).join('; ')}`) : null]),
      h('section', { class: 'card' }, h('h3', {}, 'Interlock events'),
        s.interlockEvents.length ? h('ol', { class: 'list list--tight' }, s.interlockEvents.map((e) => h('li', {}, h('span', { class: 'mono' }, fmtClock(e.tSec)), ` ${e.message}`))) : h('p', {}, store.interlocks ? 'No interlock events.' : 'Interlocks were off.'))),
    h('section', { class: 'card' }, h('h3', {}, 'Alarms'),
      s.alarms.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Priority'), h('th', { scope: 'col' }, 'Alarm'), h('th', { scope: 'col' }, 'From'), h('th', { scope: 'col' }, 'Cleared'))),
        h('tbody', {}, s.alarms.map((a) => h('tr', {}, h('td', {}, h('span', { class: `prio prio--${a.priority}` }, `${PRIORITY_SHAPES[a.priority]} ${PRIORITY_LABELS[a.priority]}`)), h('td', {}, a.message), h('td', { class: 'mono' }, fmtClock(a.sinceSec)), h('td', { class: 'mono' }, a.clearedSec === null ? 'still active' : fmtClock(a.clearedSec))))))) : h('p', {}, 'No alarms.')),
    h('section', { class: 'card' }, h('h3', {}, 'Plan steps'),
      planStatus.length ? h('ul', { class: 'list list--tight' }, planStatus.map((ps) => h('li', {}, `${getDrugById(lib, ps.drugId)?.name || ps.drugId} (${ps.phase}, ${ps.kind}): `,
        h('strong', { class: ps.status === 'blocked' ? 'error-text' : '' }, ps.status), ps.result && ps.result.blocked ? ` — ${ps.result.reasons.join('; ')}` : ''))) : h('p', {}, 'Empty plan.')),
    h('section', { class: 'card card--muted' }, h('h3', {}, 'Model limits — read before drawing conclusions'),
      h('ul', { class: 'list' },
        h('li', {}, 'This is an educational simulation with a fictional patient. It is not a medical device, not clinical decision support and not validated.'),
        h('li', {}, 'Physiology and PK/PD are illustrative except where the Model card records an implemented published model; other constants are fitted to label timing statements or are engine assumptions.'),
        h('li', {}, 'The depth number is a simulated depth index (0–100, illustrative; not BIS).'),
        h('li', {}, 'Doses are label/guideline values chosen as defaults by a simulator convention; they are not recommendations.')),
      assumptionsHost,
      Object.keys(modelInfo).length ? h('details', {}, h('summary', {}, 'Model provenance for drugs used'), h('ul', { class: 'list list--tight' },
        Object.entries(modelInfo).map(([id, m]) => h('li', {}, h('strong', {}, getDrugById(lib, id)?.name || id), `: ${m.type} — ${m.provenance}`)))) : null),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.go(4) }, '← Back to monitor'),
      h('button', { type: 'button', class: 'btn', onclick: () => { ctx.restartSim(); ctx.go(4); } }, 'Run again (same plan)'),
      dl));
}

function stat(label, value) { return h('div', { class: 'card stat' }, h('p', { class: 'stat__label' }, label), h('p', { class: 'stat__value mono' }, value)); }
export { srcTags };
