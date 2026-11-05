// Palliative pain management and end-of-life care modules — engine/data tests (node:test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOURCES } from '../data/drugs.js';
import { PROVENANCE } from '../engine/inventory.js';
import {
  PALLIATIVE_SOURCES, PALLIATIVE_SOURCE_IDS, PALLIATIVE_BANNER, PALLIATIVE_CASES, PALLIATIVE_RULES as R, SEDATION_DOC_ITEMS, ETHICS_PANEL, SEDATION_MIDAZOLAM as SM,
} from '../data/palliative.js';
import {
  derivePalliative, validatePalliative, recommendStart, breakthroughDose, convertOpioid, mmePerDay, cdcApplies, createPalliativeSim, palliativeParameterInventory,
} from '../engine/palliative.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CASE = (id) => PALLIATIVE_CASES.find((c) => c.id === id);
const pat = (over = {}) => derivePalliative({ ...CASE('naive_ckd_inpatient').patient, egfr: 80, ageYears: 50, ...over });
const sim = (id, over = {}, seed = 1) => { const c = CASE(id); return createPalliativeSim({ patient: derivePalliative({ ...c.patient, ...over }), caseDef: c, module: c.module, seed }); };
const DOCS = { refractory: { symptom: 'agitation', tried: ['Reversible-cause review'], why: 'Persisting despite treatment' }, goals: { with: 'surrogate', summary: 'Comfort' }, consent: { type: 'surrogate_consent', depthDiscussed: true }, interdisciplinary: { specialist: true, note: 'Team review' }, prognosis: { confirmed: true }, jurisdiction: { acknowledged: true } };
const fullDocs = (s) => { for (const [k, v] of Object.entries(DOCS)) s.setDoc(k, v); };
const OK = { approved: true };

test('S100+ sources: registered in SOURCES, well formed, no collision with S55–S99, each used by the modules', () => {
  const text = read('../data/palliative.js') + read('../engine/palliative.js') + read('../ui/palliative.js');
  for (const id of PALLIATIVE_SOURCE_IDS) {
    assert.ok(Number(id.slice(1)) >= 100, `${id} ≥ S100`);
    assert.equal(SOURCES[id], PALLIATIVE_SOURCES[id], `${id} merged into SOURCES`);
    for (const f of ['citation', 'url', 'identifiers', 'verifiedVia', 'supports', 'type']) assert.ok(String(PALLIATIVE_SOURCES[id][f]).length > 0, `${id}.${f}`);
    const uses = text.split(`'${id}'`).length - 1; assert.ok(uses >= 2, `${id} referenced beyond its definition (${uses})`);
  }
  assert.ok(read('../SOURCES.md').includes('### S100'), 'SOURCES.md lists the palliative entries');
  for (const id of PALLIATIVE_SOURCE_IDS) assert.ok(read('../SOURCES.md').includes(`### ${id}`), `SOURCES.md has ${id}`);
});

test('label starting doses (opioid-naïve) and renal/hepatic/elderly adjustments', () => {
  const p = pat({ weightKg: 55 });
  const m = recommendStart(p, 'morphine', 'oral'); assert.deepEqual([m.dose.min, m.dose.max, m.dose.value, m.intervalH.value], [10, 20, 10, 4]); assert.ok(m.sources.includes('S110'));
  const mi = recommendStart(p, 'morphine', 'iv'); assert.deepEqual([mi.dose.min, mi.dose.max], [5.5, 11]); assert.ok(mi.sources.includes('S112'));
  const o = recommendStart(p, 'oxycodone', 'oral'); assert.deepEqual([o.dose.min, o.dose.max, o.intervalH.min, o.intervalH.max], [5, 15, 4, 6]);
  const hy = recommendStart(p, 'hydromorphone', 'oral'); assert.deepEqual([hy.dose.min, hy.dose.max], [2, 4]);
  const hiv = recommendStart(p, 'hydromorphone', 'iv'); assert.deepEqual([hiv.dose.min, hiv.dose.max, hiv.intervalH.min, hiv.intervalH.max], [0.2, 1, 2, 3]);
  const sev = recommendStart(pat({ egfr: 22 }), 'hydromorphone', 'oral'); assert.deepEqual([sev.dose.min, sev.dose.max], [0.5, 1]); assert.ok(sev.adjusted && sev.sources.includes('S114'));
  const mod = recommendStart(pat({ egfr: 45 }), 'hydromorphone', 'oral'); assert.deepEqual([mod.dose.min, mod.dose.max], [1, 2]);
  const liver = recommendStart(pat({ liverDisease: true }), 'hydromorphone', 'iv'); assert.deepEqual([liver.dose.min, liver.dose.max], [0.1, 0.5]);
  assert.ok(recommendStart(pat({ ageYears: 80 }), 'hydromorphone', 'iv').notes.some((n) => /0\.2 mg/.test(n)));
  assert.equal(recommendStart(p, 'oxycodone', 'iv').ok, false, 'unsourced route not simulated');
});

test('renal rules: morphine warning in severe CKD; oxycodone warning below eGFR 60', () => {
  const w = recommendStart(pat({ egfr: 22 }), 'morphine', 'oral').warnings; assert.equal(w[0].id, 'morphine_severe_ckd'); assert.ok(w[0].sources.includes('S107'));
  assert.equal(recommendStart(pat({ egfr: 40 }), 'morphine', 'oral').warnings.length, 0);
  assert.equal(recommendStart(pat({ egfr: 50 }), 'oxycodone', 'oral').warnings[0].id, 'oxycodone_ckd');
});

test('breakthrough dose: 10–20% of the 24-h scheduled dose (NCCN)', () => {
  const b = breakthroughDose(120, 'morphine', 'oral'); assert.deepEqual([b.pct, b.dose, b.range.min, b.range.max], [10, 12, 12, 24]);
  assert.equal(breakthroughDose(120, 'morphine', 'oral', 20).dose, 24);
  assert.equal(breakthroughDose(120, 'morphine', 'oral', 25).ok, false);
  assert.deepEqual(R.BREAKTHROUGH_PCT.value, [10, 20]); assert.ok(R.BREAKTHROUGH_PCT.sourceIds.includes('S108'));
});

test('rotation: sourced ratios, mandatory clinician-entered reduction, unsupported pairs not simulated', () => {
  const base = { fromDrug: 'morphine', fromRoute: 'oral', total24h: 120 };
  const ox = convertOpioid({ ...base, toDrug: 'oxycodone', toRoute: 'oral', reductionPct: 25 }); assert.deepEqual([ox.converted24h, ox.reduced24h, ox.perDose], [80, 60, 10]);
  assert.equal(convertOpioid({ ...base, toDrug: 'hydromorphone', toRoute: 'oral', reductionPct: 0 }).converted24h, 24);
  assert.equal(convertOpioid({ ...base, toDrug: 'morphine', toRoute: 'iv', reductionPct: 0 }).converted24h, 60);
  assert.equal(convertOpioid({ ...base, toDrug: 'morphine', toRoute: 'iv', reductionPct: 0, ivRatio: 3 }).converted24h, 40);
  assert.equal(convertOpioid({ ...base, toDrug: 'morphine', toRoute: 'iv', reductionPct: 0, ivRatio: 4 }).ok, false);
  assert.match(convertOpioid({ ...base, toDrug: 'oxycodone', toRoute: 'oral', reductionPct: null }).reason, /no default/);
  assert.equal(convertOpioid({ ...base, toDrug: 'oxycodone', toRoute: 'oral', reductionPct: 60 }).ok, false);
  assert.match(convertOpioid({ fromDrug: 'hydromorphone', fromRoute: 'oral', total24h: 24, toDrug: 'morphine', toRoute: 'oral', reductionPct: 25 }).reason, /not simulated/);
  assert.match(convertOpioid({ ...base, toDrug: 'hydromorphone', toRoute: 'iv', reductionPct: 25 }).reason, /not simulated/);
  assert.match(convertOpioid({ ...base, toDrug: 'methadone', toRoute: 'oral', reductionPct: 25 }).reason, /not simulated/);
  assert.equal(R.CROSS_TOLERANCE_REDUCTION_PCT.default, null, 'no default reduction');
  assert.equal(R.CONVERSION_ORAL_MORPHINE_TO_ORAL_OXYCODONE.value, 1.5); assert.equal(R.CONVERSION_ORAL_MORPHINE_TO_ORAL_HYDROMORPHONE.value, 5);
});

test('CDC 2022: MME factors (risk only), scope excludes cancer/palliative/end-of-life, pause at 50 MME/day', () => {
  assert.equal(mmePerDay({ drugId: 'oxycodone', route: 'oral', dose: 10, intervalH: 6 }), 60);
  assert.equal(mmePerDay({ drugId: 'hydromorphone', route: 'oral', dose: 2, intervalH: 4 }), 60);
  assert.equal(mmePerDay({ drugId: 'morphine', route: 'iv', dose: 5, intervalH: 4 }), null, 'no IV MME');
  assert.equal(cdcApplies(CASE('chronic_stable').patient), true); assert.equal(cdcApplies(CASE('postop_home_naive').patient), true);
  for (const id of ['bone_pain_hospice', 'naive_ckd_inpatient', 'eol_dyspnoea_secretions', 'refractory_delirium']) assert.equal(cdcApplies(CASE(id).patient), false, id);
  assert.equal(R.CDC_PAUSE_MME.value, 50);
  // Increase crossing 50 MME/day in a non-cancer case requires the explicit CDC acknowledgement.
  const c = CASE('chronic_stable');
  const s = createPalliativeSim({ patient: derivePalliative({ ...c.patient, currentRegimen: { drugId: 'oxycodone', route: 'oral', dose: 7.5, intervalH: 6 } }), caseDef: { generator: { ...c.generator, baseline: 9 } }, module: 'pain', seed: 1 });
  s.approveRegimen({ drugId: 'oxycodone', route: 'oral', dose: 7.5, intervalH: 6, scheduled: true, prnDose: 2, bowel: true }, OK);
  s.step(1440);
  const inc = s.state.pendingReview.suggestions.find((x) => x.kind === 'increase');
  assert.ok(inc && inc.needsAck && /50 MME/.test(inc.needsAck), 'CDC acknowledgement required');
  assert.equal(s.decide(inc.id, 'approve').ok, false); assert.equal(s.state.regimen.dose, 7.5, 'nothing changed');
  assert.equal(s.decide(inc.id, 'approve', { ack: true }).ok, true); assert.ok(s.state.regimen.dose > 7.5);
});

test('daily review: +50% suggestion (NCCN 50–100%), nothing changes without approval, decline keeps the dose', () => {
  const s = sim('naive_ckd_inpatient');
  s.approveRegimen({ drugId: 'hydromorphone', route: 'oral', dose: 0.5, intervalH: 4, scheduled: true, prnDose: 0.25, bowel: true }, OK);
  s.step(5000);
  assert.equal(s.state.tMin, 1440, 'paused at the review');
  assert.equal(s.state.paused.reason, 'review');
  const inc = s.state.pendingReview.suggestions.find((x) => x.kind === 'increase');
  assert.ok(inc, 'increase suggested'); assert.equal(inc.change.dose, 0.75); assert.equal(inc.change.prnDose, 0.5);
  assert.equal(s.state.regimen.dose, 0.5);
  assert.equal(s.resume().ok, false, 'cannot resume with open review');
  s.decide(inc.id, 'decline'); for (const x of s.state.pendingReview ? s.state.pendingReview.suggestions : []) if (x.status === 'pending') s.decide(x.id, 'decline');
  assert.equal(s.state.regimen.dose, 0.5, 'declined → unchanged'); assert.equal(s.state.paused, null);
});

test('bowel-regimen reminder when a scheduled opioid starts without one', () => {
  const s = sim('chronic_stable');
  s.approveRegimen({ drugId: 'oxycodone', route: 'oral', dose: 10, intervalH: 6, scheduled: true, prnDose: 4, bowel: false }, OK);
  assert.ok(s.state.alarms.some((a) => a.id === 'bowel_missing'));
  s.step(1440);
  assert.ok(s.state.pendingReview.suggestions.some((x) => x.kind === 'bowel'));
  const t = sim('chronic_stable'); t.approveRegimen({ drugId: 'oxycodone', route: 'oral', dose: 10, intervalH: 6, scheduled: true, prnDose: 4, bowel: true }, OK);
  assert.ok(!t.state.alarms.some((a) => a.id === 'bowel_missing'));
});

test('symptom model sanity: analgesia lowers pain; opioid excess raises sedation/RR alarms; naloxone small increments', () => {
  const none = sim('naive_ckd_inpatient'); const treated = sim('naive_ckd_inpatient');
  treated.approveRegimen({ drugId: 'hydromorphone', route: 'oral', dose: 1, intervalH: 4, scheduled: true, prnDose: 0.5, bowel: true }, OK);
  none.step(600); treated.step(600);
  const mean = (x) => x.state.trend.slice(-60).reduce((a, y) => a + y.pain, 0) / 60;
  assert.ok(mean(treated) < mean(none) - 1, `pain lower with analgesia (${mean(treated)} vs ${mean(none)})`);
  const od = sim('naive_ckd_inpatient');
  od.approveRegimen({ drugId: 'hydromorphone', route: 'iv', dose: 1, intervalH: 2, scheduled: true, prnDose: 1, bowel: true }, OK);
  od.step(1000);
  assert.ok(od.state.alarms.some((a) => ['excess_sedation', 'resp_depression'].includes(a.id) && a.priority === 'high'), 'opioid excess alarm');
  assert.equal(od.state.paused.reason, 'alarm', 'HIGH alarm pauses');
  assert.ok(od.state.alarms.every((a) => !a.acknowledged), 'never auto-acknowledged');
  assert.equal(od.resume().ok, false, 'resume blocked until acknowledged');
  const before = od.state.rassCont;
  assert.equal(od.naloxone().ok, true); assert.equal(od.naloxone().ok, false, 'repeat within 2 min blocked');
  assert.equal(od.state.mar.filter((m) => m.drugId === 'naloxone')[0].dose, 0.1);
  for (const a of [...od.state.alarms]) od.acknowledge(a.id);
  od.resume(); od.step(3);
  assert.ok(od.state.rassCont > before, 'small naloxone increment lightens sedation');
});

test('palliative sedation gate: all six documentation items required; approval required for every action', () => {
  const s = sim('refractory_delirium'); s.approveRegimen({ ...CASE('refractory_delirium').plan, prnDose: 2.5 }, OK);
  assert.equal(SEDATION_DOC_ITEMS.length, 6);
  assert.equal(s.sedationAction({ type: 'set_target', targetRass: -2, symptom: 'agitation' }, OK).ok, false);
  for (const skip of Object.keys(DOCS)) {
    const t = sim('refractory_delirium');
    for (const [k, v] of Object.entries(DOCS)) if (k !== skip) t.setDoc(k, v);
    const g = t.gateStatus(); assert.equal(g.complete, false, `missing ${skip} keeps the gate closed`); assert.equal(g.missing.length, 1);
    assert.equal(t.sedationAction({ type: 'set_target', targetRass: -2, symptom: 'agitation' }, OK).blocked, true);
  }
  s.setDoc('refractory', { ...DOCS.refractory, why: '   ' }); assert.equal(s.gateStatus().complete, false, 'blank free text does not count');
  fullDocs(s); assert.equal(s.gateStatus().complete, true);
  assert.equal(s.sedationAction({ type: 'set_target', targetRass: -2, symptom: 'agitation' }).ok, false, 'no approval → blocked');
  assert.equal(s.sedationAction({ type: 'bolus', route: 'sc' }, OK).ok, false, 'target must be documented first');
  assert.equal(s.sedationAction({ type: 'set_target', targetRass: -2, symptom: 'agitation' }, OK).ok, true);
  assert.equal(s.sedationAction({ type: 'infusion', rateMgH: 3 }, OK).ok, false, 'infusion starts at 1 mg/h');
  assert.equal(s.sedationAction({ type: 'bolus', route: 'sc' }, OK).ok, true);
  assert.equal(s.state.mar.at(-1).dose, SM.bolus.light.sc.value);
  assert.equal(s.sedationAction({ type: 'repeat' }, OK).ok, false, 'repeat interval enforced (20 min SC)');
  s.step(20); assert.equal(s.sedationAction({ type: 'repeat' }, OK).ok, true); assert.equal(s.state.mar.at(-1).dose, 1.25);
  assert.equal(s.sedationAction({ type: 'infusion', rateMgH: 1 }, OK).ok, true);
  assert.equal(s.sedationAction({ type: 'infusion', rateMgH: 12 }, OK).ok, false, '>10 mg/h: specialist decision');
  const deep = sim('refractory_delirium', { prognosis: 'days_weeks' }); fullDocs(deep);
  assert.match(deep.sedationAction({ type: 'set_target', targetRass: -4, symptom: 'agitation' }, OK).reasons[0], /hours–days/);
});

test('no auto-escalation; comfort opioids continue; opioids are never used to sedate; proportionality alarm', () => {
  const s = sim('refractory_delirium'); s.approveRegimen({ ...CASE('refractory_delirium').plan, prnDose: 2.5 }, OK);
  fullDocs(s);
  s.sedationAction({ type: 'set_target', targetRass: -2, symptom: 'agitation' }, OK); s.sedationAction({ type: 'infusion', rateMgH: 1 }, OK);
  const n = s.state.sedation.titrations.length; const opioidBefore = s.state.mar.filter((m) => m.kind === 'scheduled').length;
  for (let i = 0; i < 24; i++) { s.step(60); for (const a of [...s.state.alarms]) s.acknowledge(a.id); if (s.state.pendingReview) for (const x of s.state.pendingReview.suggestions) s.decide(x.id, 'decline'); s.resume(); }
  assert.equal(s.state.sedation.infusionMgH, 1, 'engine never changes the infusion'); assert.equal(s.state.sedation.titrations.length, n);
  assert.ok(s.state.alarmHistory.some((a) => a.id === 'comfort_not_achieved'), 'comfort-not-achieved alarm instead of escalation');
  assert.ok(s.state.mar.filter((m) => m.kind === 'scheduled').length >= opioidBefore + 5, 'comfort opioid continues on schedule');
  assert.equal(s.state.regimen.dose, CASE('refractory_delirium').plan.dose, 'opioid not escalated');
  const blocked = s.adjustOpioid({ reason: 'sedation' }); assert.equal(blocked.blocked, true); assert.match(blocked.reason, /not used to produce sedation/);
  // Deeper than target → not proportional (medium), not "unintended".
  const t = sim('refractory_delirium'); t.approveRegimen({ ...CASE('refractory_delirium').plan, prnDose: 2.5 }, OK); fullDocs(t);
  t.sedationAction({ type: 'set_target', targetRass: -1, symptom: 'agitation' }, OK); t.sedationAction({ type: 'infusion', rateMgH: 1 }, OK);
  t.sedationAction({ type: 'infusion', rateMgH: 8 }, OK);
  for (let i = 0; i < 12; i++) { t.step(60); for (const a of [...t.state.alarms]) if (a.priority === 'high') t.acknowledge(a.id); if (t.state.pendingReview) for (const x of t.state.pendingReview.suggestions) t.decide(x.id, 'decline'); t.resume(); }
  assert.ok(t.state.alarmHistory.some((a) => a.id === 'not_proportional' && a.priority === 'medium'), 'proportionality alarm');
  assert.ok(!t.state.alarmHistory.some((a) => a.id === 'excess_sedation'), 'documented sedation is not flagged as unintended');
  assert.ok(t.state.sedation.infusionMgH === 8, 'no automatic reduction either: the clinician decides');
});

test('determinism: same seed → identical run; different seed → different noise', () => {
  const run = (seed) => { const s = sim('bone_pain_hospice', {}, seed); s.approveRegimen({ ...CASE('bone_pain_hospice').plan, prnDose: 12 }, OK); s.step(1440); return JSON.stringify([s.state.trend, s.state.mar]); };
  assert.equal(run(7), run(7)); assert.notEqual(run(7), run(8));
});

test('all example cases run in guided mode for three days with clinician decisions', () => {
  for (const c of PALLIATIVE_CASES) {
    const p = derivePalliative(c.patient); assert.ok(validatePalliative(c.patient).ok, c.id);
    const s = createPalliativeSim({ patient: p, caseDef: c, module: c.module, seed: 1 });
    let dose = c.plan.dose; let intervalH = c.plan.intervalH;
    if (c.plan.convertFromCurrent) { const r = p.currentRegimen; const cv = convertOpioid({ fromDrug: r.drugId, fromRoute: r.route, total24h: r.dose * 24 / r.intervalH, toDrug: c.plan.drugId, toRoute: c.plan.route, reductionPct: 25 }); assert.ok(cv.ok, c.id); dose = cv.perDose; intervalH = cv.intervalH; }
    else if (!dose) dose = recommendStart(p, c.plan.drugId, c.plan.route).dose.value;
    const prn = c.plan.scheduled ? breakthroughDose(dose * 24 / intervalH, c.plan.drugId, c.plan.route).dose : dose;
    assert.equal(s.approveRegimen({ ...c.plan, dose, intervalH, prnDose: prn }, OK).ok, true, c.id);
    assert.equal(s.approveRegimen({ ...c.plan, dose, intervalH, prnDose: prn }, OK).ok, false, 'second regimen must go through review');
    let guard = 0;
    while (s.state.tMin < 3 * 1440 && guard++ < 200) {
      s.step(3 * 1440 - s.state.tMin);
      if (s.state.pendingReview) for (const x of s.state.pendingReview.suggestions) s.decide(x.id, x.kind === 'rotation' ? 'decline' : 'approve', { ack: true });
      for (const a of [...s.state.alarms]) s.acknowledge(a.id);
      s.resume();
    }
    assert.equal(s.state.tMin, 3 * 1440, c.id);
    assert.ok(s.state.reviews.length >= 2, `${c.id} reviews`);
    assert.ok(s.state.trend.every((y) => Number.isFinite(y.pain) && Number.isFinite(y.rr)), c.id);
    const sm = s.summary(); assert.ok(sm.perDay.length >= 3 && sm.documentation.items.length === 6, c.id);
  }
});

test('banner and ethics panel text present; index.html carries the verbatim banner and the ethics panel', () => {
  assert.equal(PALLIATIVE_BANNER, 'Palliative / end-of-life simulation — fictional patient — educational only. Not medical advice. Palliative sedation is not euthanasia or medical aid in dying; laws differ by jurisdiction.');
  const html = read('../index.html');
  assert.ok(html.includes(PALLIATIVE_BANNER)); assert.ok(html.includes('id="ethics-dialog"')); assert.ok(html.includes('id="open-ethics"'));
  const keys = ETHICS_PANEL.flatMap((s) => s.items.map((i) => i[0])).join(' | ');
  for (const k of ['Palliative care', 'Hospice', 'Palliative sedation', 'Euthanasia and medical aid in dying (MAID)', 'Intent', 'Proportionality', 'Double effect', 'Decision-making capacity', 'Surrogate decision-makers', 'Advance directives', 'Interdisciplinary review', 'Documentation', 'Laws and policies differ']) assert.ok(keys.includes(k), k);
  assert.ok(/continuous deep sedation/i.test(JSON.stringify(ETHICS_PANEL)));
});

test('hard exclusions (text scan): no assisted-dying content or dosing, no "lethal", no outcome claims', () => {
  const md = read('../SOURCES.md'); const palMd = md.slice(md.indexOf('## Palliative and end-of-life modules'), md.indexOf('## Palliative and end-of-life modules') > 0 ? md.indexOf('\n## ', md.indexOf('## Palliative and end-of-life modules') + 5) : 0);
  assert.ok(palMd.length > 500, 'SOURCES.md palliative section present');
  const files = { 'data/palliative.js': read('../data/palliative.js'), 'engine/palliative.js': read('../engine/palliative.js'), 'ui/palliative.js': read('../ui/palliative.js'), 'SOURCES.md (palliative)': palMd };
  const DOSE = /\d+(\.\d+)?\s*(mg|mcg|microgram|mL)\b/i;
  const NEG = /\b(no|not|never|nothing|without|abuse|excluded?|exclusions?|distinct|different|distinguish(es)?)\b/i;
  for (const [name, text] of Object.entries(files)) {
    assert.doesNotMatch(text, /lethal/i, `${name}: "lethal"`);
    assert.doesNotMatch(text, /(?<![-/\w])end-life|end life dos/i, `${name}: "end-life" dosing (URL slugs excepted)`);
    for (const line of text.split('\n')) {
      if (/euthanas|\bMAID\b|aid in dying|assisted suicide|assisted dying/i.test(line)) {
        // Sentences mentioning these practices must never carry a dose.
        for (const sentence of line.split(/(?<=[.;])\s+/)) if (/euthanas|\bMAID\b|aid in dying|assisted suicide|assisted dying/i.test(sentence)) assert.doesNotMatch(sentence, DOSE, `${name}: dose next to an excluded practice: ${sentence.slice(0, 120)}`);
      }
      for (const sentence of line.split(/(?<=[.;])\s+/)) {
        if (/hasten/i.test(sentence)) assert.match(sentence, NEG, `${name}: "hasten" only in exclusion/abuse statements: ${sentence.slice(0, 120)}`);
        if (/surviv|shorten|mortality|life-span|lifespan/i.test(sentence)) assert.match(sentence, NEG, `${name}: outcome wording only negated: ${sentence.slice(0, 120)}`);
      }
    }
  }
});

test('parameter inventory: every palliative value has a provenance from the fixed vocabulary', () => {
  const inv = palliativeParameterInventory();
  assert.ok(inv.length > 40);
  for (const x of inv) { assert.ok(PROVENANCE.includes(x.provenance), `${x.name}: ${x.provenance}`); for (const s of x.sourceIds) assert.ok(SOURCES[s], `${x.name}: ${s}`); }
  for (const x of inv.filter((y) => ['fda_label', 'guideline'].includes(y.provenance))) assert.ok(x.sourceIds.length > 0, `${x.name} sourced`);
  assert.ok(read('../MODEL_CARD.md').includes('## Palliative and end-of-life modules'), 'MODEL_CARD has the palliative section');
});
