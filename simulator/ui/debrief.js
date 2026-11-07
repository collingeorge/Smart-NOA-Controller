// Step 5 — Debrief: totals, haemodynamic/oxygenation summary, alarms, interlock events, extubation.
import { h, fmtClock, fmtNum, isNum, announce, fill, add } from './dom.js';
import { srcTags } from './sources.js';
import { PRIORITY_LABELS, PRIORITY_SHAPES } from './labels.js';
import { getDrugById } from './plan-model.js';
import { readinessRow } from './monitor.js';
import { timingCheckItems } from './timing-view.js';
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
      automaticMode: s.automatic,
      summary: s, fluidsCrystalloidMl: fl, extubationOverrides: overrides,
      modelInfo, log: sim.state.log,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `smart-noa-sim-session-seed${sim.seed}.json`, class: 'sr-only' }, 'download');
    add(document.body, a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    announce('Session JSON downloaded.');
  });

  fill(main, 
    h('div', { class: 'step-head' }, h('h2', { id: 'step-title', tabindex: '-1' }, '5 · Debrief'),
      h('p', { class: 'muted' }, `Simulated duration ${fmtClock(s.durationSec)} · ${sim.plan.mode === 'GA' ? 'general anaesthesia' : `MAC (${sim.plan.sedationTarget})`} · interlocks ${store.interlocks ? 'on' : 'off'} · seed ${sim.seed}. ${s.modelNote}`)),
    autoCard(s.automatic),
    advisoryDebrief(s.advisories),
    depthAdvisoryDebrief(s.depthAdvisories, s.depthOutOfBandSec),
    h('div', { class: 'grid grid--4 stats' },
      stat('Time MAP < 65 mmHg', fmtClock(s.timeMapBelow65Sec)),
      stat('Minimum SpO2', isNum(s.minSpo2) ? `${s.minSpo2} %` : '—'),
      stat('HR range', isNum(s.minHr) ? `${s.minHr}–${s.maxHr} /min` : '—'),
      stat('MAP range', isNum(s.minMap) ? `${s.minMap}–${s.maxMap} mmHg` : '—'),
      stat('Alarms raised', String(s.alarms.length)),
      fl !== null ? stat('Crystalloid given', `${fmtNum(fl, 0)} mL`) : null),
    fluidsCard(s.fluids, p),
    teachingCeilingsCard(s.teachingCeilings),
    prophylaxisCard(s.prophylaxis, lib),
    h('section', { class: 'card', id: 'db-timing' }, h('h3', {}, 'Timing check'),
      h('p', { class: 'hint' }, 'Each check compares when things happened with the timing rule and its source or simulator convention (engine/timing.js). It only compares times; it does not judge the illustrative physiology.'),
      s.timingChecks && s.timingChecks.length ? h('ul', { class: 'tchecks tchecks--light' }, timingCheckItems(s.timingChecks)) : h('p', {}, 'No timing events.')),
    h('section', { class: 'card' }, h('h3', {}, 'Drug totals'),
      s.lidocaine && s.lidocaine.totalMg > 0 ? h('p', { id: 'db-lido' }, `Lidocaine total ${fmtNum(s.lidocaine.totalMg, 3)} mg (${fmtNum(s.lidocaine.perKgIbw, 3)} mg/kg IBW), including pretreatment ${fmtNum(s.lidocaine.pretreatmentMg, 3)} mg (${s.lidocaine.pretreatmentDoses} dose${s.lidocaine.pretreatmentDoses === 1 ? '' : 's'}).${s.lidocaine.overlapWarning ? ' Pretreatment and IV lidocaine analgesic dosing overlapped (Foo 2021 check) ' : ' '}`, s.lidocaine.overlapWarning ? srcTags(['S1']) : null) : null,
      totals.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'db-totals' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Drug'), h('th', { scope: 'col' }, 'Total'), h('th', { scope: 'col' }, `Per kg (TBW ${p.weightKg} kg)`))),
        h('tbody', {}, totals.map(([id, t]) => h('tr', {}, h('th', { scope: 'row' }, getDrugById(lib, id)?.name || id), h('td', { class: 'mono' }, `${fmtNum(t.amount, 3)} ${t.unit}`),
          h('td', { class: 'mono' }, t.perKg === null ? (t.unit === '%·h' ? 'n/a (dial-hours)' : '—') : `${fmtNum(t.perKg, 3)} ${t.unit}/kg`)))))) : h('p', {}, 'No drugs given.'),
      h('p', { class: 'hint' }, 'Inhaled agents are totalled as dial %·hours (area under the vaporizer setting), not as an amount.')),
    h('div', { class: 'grid grid--2' },
      h('section', { class: 'card' }, h('h3', {}, 'Extubation'),
        sim.plan.mode !== 'GA' ? h('p', {}, 'Not applicable (MAC / sedation).') :
          [h('p', {}, ext.tSec === null || ext.tSec === undefined ? 'Not extubated — readiness at the end of the session:' : `Extubated at ${fmtClock(ext.tSec)} — readiness ${ext.ready ? 'met' : 'NOT met'}:`),
            h('ul', { class: 'ready-list ready-list--light' }, (ext.criteria || []).map((c) => readinessRow(c))),
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
        h('li', {}, 'The depth number is a processed-EEG depth index (BIS-style, simulated; 0–100, illustrative); it is not a BIS value (BIS is a trademark of its owner).'),
        h('li', {}, 'Doses are label/guideline values chosen as defaults by a simulator convention; they are not recommendations.')),
      assumptionsHost,
      Object.keys(modelInfo).length ? h('details', {}, h('summary', {}, 'Model provenance for drugs used'), h('ul', { class: 'list list--tight' },
        Object.entries(modelInfo).map(([id, m]) => h('li', {}, h('strong', {}, getDrugById(lib, id)?.name || id), `: ${m.type} — ${m.provenance}`)))) : null),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.go(4) }, '← Back to monitor'),
      h('button', { type: 'button', class: 'btn', onclick: () => { ctx.restartSim(); ctx.go(4); } }, 'Run again (same plan)'),
      dl));
}

function autoCard(A) {
  if (!A || !A.used) return null;
  const lead = A.mode === 'full'
    ? 'This case ran automatically (automatic demonstration): a scripted sequence of the same phase and airway actions as the manual buttons. Plan doses were not changed.'
    : 'This case ran in guided mode: each phase ran automatically from the approved plan and the clinician confirmed every transition. Plan doses were not changed.';
  const outcome = {
    completed: `Completed at ${fmtClock(A.endedAtSec)}.`,
    stopped: `Stopped at ${fmtClock(A.endedAtSec)} during “${A.stoppedAt && A.stoppedAt.step}”: ${A.stopReason}.`,
    manual: `Ended at ${fmtClock(A.endedAtSec)} during “${A.stoppedAt && A.stoppedAt.step}” because a manual control was used (${A.manualControl}); the case continued manually.`,
    paused: `Still paused at ${fmtClock(A.stoppedAt && A.stoppedAt.tSec)} during “${A.stoppedAt && A.stoppedAt.step}”${A.pauseReasons.length ? `: ${A.pauseReasons.join(' ')}` : ''}.`,
    running: 'Still running when the debrief opened.',
  }[A.outcome] || A.outcome;
  return h('section', { class: 'card card--auto', id: 'db-auto' }, h('h3', {}, A.modeLabel),
    h('p', { class: 'auto-banner auto-banner--light' }, A.banner),
    h('p', { id: 'db-auto-note' }, lead, ' ', h('strong', {}, outcome)),
    A.unmet && A.unmet.length ? h('p', { class: 'error-text' }, `Unmet criteria: ${A.unmet.join('; ')}`) : null,
    A.steps.length ? h('ol', { class: 'list list--tight' }, A.steps.map((x) => h('li', {}, h('span', { class: 'mono' }, fmtClock(x.tSec)), ` ${x.label} — ${x.by === 'clinician' ? 'confirmed by the clinician' : 'automatic'}`))) : null,
    A.pauses.length ? h('p', {}, `Pauses: ${A.pauses.map((p) => `${fmtClock(p.tSec)} (${p.reasons.join(' ')})${p.resumedAtSec !== null ? ` → resumed ${fmtClock(p.resumedAtSec)}` : ''}`).join('; ')}`) : null,
    h('p', { class: 'hint' }, 'Automatic steps are marked “AUTO:” (log kind “auto”) in the event log and in the downloaded session JSON (automaticMode).'));
}

const ADV_STATUS = { shown: 'shown (open at the end)', accepted: 'ACCEPTED by the clinician — bolus given', accept_blocked: 'accepted, but the bolus was blocked', dismissed: 'dismissed by the clinician', withdrawn: 'withdrawn', superseded: 'superseded', expired: 'expired (MAP recovered)' };
function advisoryDebrief(A) {
  if (!A || !A.used) return null;
  return h('section', { class: 'card', id: 'db-advisories' }, h('h3', {}, 'Advisory: haemodynamic rescue'),
    h('p', {}, `Shown ${A.shown} · accepted ${A.accepted} · dismissed ${A.dismissed}. ${A.note}`),
    A.entries.length ? h('ol', { class: 'list list--tight', id: 'db-advisory-list' }, A.entries.map((x) => h('li', { dataset: { status: x.status } },
      h('span', { class: 'mono' }, fmtClock(x.shownAtSec)), ` ${x.id} — ${x.kind === 'hypotension' ? `MAP ${x.map}, HR ${x.hr}: suggested ${x.name} ${x.amount} ${x.unit} IV bolus ` : `MAP ${x.map}: high-MAP advice (text only, no drug) `}`,
      x.sources.length ? srcTags(x.sources) : null,
      ` — ${ADV_STATUS[x.status] || x.status}${x.resolvedAtSec !== null ? ` at ${fmtClock(x.resolvedAtSec)}` : ''}${x.note && x.status !== 'accepted' && x.status !== 'dismissed' ? ` (${x.note})` : ''}`))) : h('p', { class: 'hint' }, 'No advisory was shown in this case.'));
}

const DEPTH_STATUS = { shown: 'shown (open at the end)', dismissed: 'dismissed by the clinician', expired: 'ended' };
/** Depth-low advisory (engine/depth-advisory.js; text only): every card shown / dismissed, with times, and total time below the band. */
function depthAdvisoryDebrief(D, outOfBandSec) {
  if (!D || !D.used) return null;
  const [lo, hi] = D.band;
  return h('section', { class: 'card', id: 'db-depth-advisories' }, h('h3', {}, 'Advisory: depth index below the GA band'),
    h('p', {}, `Shown ${D.shown} · dismissed ${D.dismissed} · time below the band (${lo}) during GA maintenance after incision: `, h('strong', { id: 'db-depth-below' }, fmtClock(D.totalBelowBandSec)),
      isNum(outOfBandSec) ? ` (time outside ${lo}–${hi} in either direction: ${fmtClock(outOfBandSec)}). ` : '. ',
      `Shown after ≥ ${D.sustainSec} s below ${lo}; ends at ≥ ${D.clearAt} (simulator conventions). ${D.note} Band `, srcTags(D.entries.length ? D.entries[0].sources : []), '.'),
    D.entries.length ? h('ol', { class: 'list list--tight', id: 'db-depth-advisory-list' }, D.entries.map((x) => h('li', { dataset: { status: x.status } },
      h('span', { class: 'mono' }, fmtClock(x.shownAtSec)), ` ${x.id} — index ${x.index} below the GA band (text only, no dose changed) — ${DEPTH_STATUS[x.status] || x.status}${x.resolvedAtSec !== null ? ` at ${fmtClock(x.resolvedAtSec)}` : ''}`,
      x.endedAtSec !== null ? `; episode ended at ${fmtClock(x.endedAtSec)}${x.note && x.status === 'expired' ? ` (${x.note})` : ''}` : '',
      x.episodeSec !== null ? `; below the band ${fmtClock(x.episodeSec)} in this episode` : ''))) : h('p', { class: 'hint' }, 'No depth-index advisory was shown in this case.'));
}

/** Simulator teaching ceilings (engine/teaching-ceilings.js): totals, ceiling, refusals and every clinician confirmation. */
function teachingCeilingsCard(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return h('section', { class: 'card', id: 'db-teaching' }, h('h3', {}, 'Simulator teaching ceilings'),
    h('p', { class: 'hint' }, 'Teaching guards where no label or guideline states a cumulative maximum (simulator convention, not clinical limits). A dose above one is given only after the clinician presses "Confirm dose above the simulator teaching ceiling"; guided and automatic modes never confirm it.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'db-teaching-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Agent'), h('th', { scope: 'col' }, 'Total given'), h('th', { scope: 'col' }, 'Teaching ceiling'), h('th', { scope: 'col' }, 'Refused (confirmation needed)'), h('th', { scope: 'col' }, 'Clinician confirmations'))),
      h('tbody', {}, list.map((x) => h('tr', { dataset: { teaching: x.key } }, h('th', { scope: 'row' }, x.label), h('td', { class: 'mono' }, `${fmtNum(x.total, 3)} ${x.unit}`),
        h('td', { class: 'mono' }, `${fmtNum(x.limit, 3)} ${x.unit}${x.unit !== x.ruleUnit ? ` (${x.ruleValue} ${x.ruleUnit})` : ''}`), h('td', { class: 'mono' }, String(x.refusals)),
        h('td', {}, x.confirmations.length ? x.confirmations.map((c) => `${fmtClock(c.tSec)}${c.used ? ` → given ${fmtNum(c.used.amount, 3)} ${x.unit} (total ${fmtNum(c.used.totalAfter, 3)})` : ' (not used)'}`).join('; ') : 'none')))))));
}

function fluidsCard(F, p) {
  if (!F || !F.byType || !Object.keys(F.byType).length) return null;
  const rows = Object.entries(F.byType);
  return h('section', { class: 'card', id: 'db-fluids' }, h('h3', {}, 'IV fluids by type'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table', id: 'db-fluid-totals' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Fluid'), h('th', { scope: 'col' }, 'Boluses'), h('th', { scope: 'col' }, 'Maintenance'), h('th', { scope: 'col' }, 'Total'), h('th', { scope: 'col' }, `mL/kg (TBW ${p.weightKg} kg)`))),
      h('tbody', {}, rows.map(([id, v]) => h('tr', { dataset: { fluid: id } }, h('th', { scope: 'row' }, v.name), h('td', { class: 'mono' }, `${fmtNum(v.bolusMl, 0)} mL`), h('td', { class: 'mono' }, `${fmtNum(v.maintenanceMl, 0)} mL`), h('td', { class: 'mono' }, `${fmtNum(v.totalMl, 0)} mL`), h('td', { class: 'mono' }, fmtNum(v.totalMl / p.weightKg, 3))))))),
    h('p', { class: 'hint' }, `All crystalloid: ${fmtNum(F.crystalloidMl, 0)} mL. ${F.model}. Rates and volumes are simulator choices; the labels give no fixed dose.`));
}

function prophylaxisCard(P, lib) {
  if (!P) return null;
  const name = (id) => ((lib.ANTIBIOTICS || []).find((a) => a.id === id) || { name: id }).name;
  return h('section', { class: 'card', id: 'db-abx' }, h('h3', {}, 'Antibiotic prophylaxis (timing only)'),
    h('p', {}, P.indicated ? 'Marked as indicated for this plan.' : 'Not marked as indicated for this plan.',
      P.window ? [' At incision: ', h('strong', {}, P.window.ok ? 'in the recommended window' : 'NOT in the recommended window'), ` — ${P.window.message}. `, srcTags(P.window.sources || [])] : ' Surgery/procedure was not started.'),
    P.doses.length ? h('ul', { class: 'list list--tight' }, P.doses.map((d) => h('li', {}, h('span', { class: 'mono' }, fmtClock(d.tSec)), ` ${name(d.drugId)} ${d.amount} ${d.unit}`))) : h('p', {}, 'No antibiotic dose given.'),
    P.checklistAcknowledged ? h('p', { class: 'warn-text' }, `Checklist warning acknowledged by the clinician at ${fmtClock(P.checklistAcknowledged.tSec)}: ${P.checklistAcknowledged.message}`) : null,
    P.redose && P.redose.items.some((x) => x.due) ? h('p', { class: 'warn-text' }, `Redose due at the end of the session: ${P.redose.items.filter((x) => x.due).map((x) => x.name).join(', ')}.`) : null,
    h('p', { class: 'hint' }, P.note));
}

function stat(label, value) { return h('div', { class: 'card stat' }, h('p', { class: 'stat__label' }, label), h('p', { class: 'stat__value mono' }, value)); }
export { srcTags };
