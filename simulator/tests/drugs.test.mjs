// Schema-integrity tests for simulator/data/drugs.js (node:test, no dependencies).
// Run: node --test simulator/tests/drugs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCES, CONDITIONS, ALLERGIES, MEDICATIONS, DRUGS, KNOWN_FLAGS, SOURCE_IDS_USED, SOURCE_IDS_ENGINE, LIBRARY_NOTES,
} from '../data/drugs.js';

const CLASSES = new Set(['hypnotic', 'opioid', 'nmb', 'reversal', 'alpha2', 'nmda', 'local', 'antiemetic',
  'vasopressor', 'anticholinergic', 'benzodiazepine', 'volatile', 'gas', 'nsaid', 'analgesic']);
const AMOUNT_UNITS = new Set(['mg', 'mcg', 'units', '%']);
const REGIMEN_KEYS = new Set(['premed', 'sedation_minimal', 'sedation_moderate', 'sedation_deep',
  'induction', 'maintenance', 'emergence', 'rescue']);
const KINDS = new Set(['bolus', 'infusion', 'inhaled']);
const SCALARS = new Set(['TBW', 'IBW', 'LBW', 'ABW']);

const ids = {
  condition: new Set(CONDITIONS.map((c) => c.id)),
  allergy: new Set(ALLERGIES.map((a) => a.id)),
  medication: new Set(MEDICATIONS.map((m) => m.id)),
  flag: new Set(KNOWN_FLAGS),
};

// Returns null if valid, else an error string.
function checkToken(tok, { extended }) {
  let m = /^(condition|allergy|medication|flag):([A-Za-z0-9_]+)$/.exec(tok);
  if (m) return ids[m[1]].has(m[2]) ? null : `unknown ${m[1]} id "${m[2]}"`;
  if (/^egfr<\d+(\.\d+)?$/.test(tok)) return null;
  if (/^age>=\d+$/.test(tok)) return null;
  if (extended && (/^asa>=[1-5]$/.test(tok) || /^weight<\d+(\.\d+)?$/.test(tok))) return null;
  return `invalid when token "${tok}"`;
}

function checkRange(r, label) {
  assert.ok(r && typeof r === 'object', `${label}: range object`);
  for (const k of ['default', 'min', 'max']) {
    assert.equal(typeof r[k], 'number', `${label}.${k} is a number`);
    assert.ok(Number.isFinite(r[k]) && r[k] >= 0, `${label}.${k} finite, non-negative`);
  }
  assert.ok(r.min <= r.default && r.default <= r.max, `${label}: min ≤ default ≤ max (${r.min}, ${r.default}, ${r.max})`);
}

function checkSources(list, label) {
  assert.ok(Array.isArray(list) && list.length > 0, `${label}: has at least one source`);
  for (const s of list) assert.ok(SOURCES[s], `${label}: source ${s} exists`);
}

// Collect every source id referenced in the drug library.
function collectRefs(obj, out = new Set()) {
  if (Array.isArray(obj)) obj.forEach((v) => collectRefs(v, out));
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if ((k === 'sources' || k === 'labelTableSources') && Array.isArray(v)) v.forEach((s) => out.add(s));
      else collectRefs(v, out);
    }
  }
  return out;
}

test('SOURCES entries are well formed', () => {
  for (const [key, s] of Object.entries(SOURCES)) {
    assert.match(key, /^S\d+$/);
    assert.equal(s.id, key);
    for (const f of ['citation', 'url', 'identifiers', 'verifiedVia', 'supports']) {
      assert.equal(typeof s[f], 'string', `${key}.${f}`);
      assert.ok(s[f].length > 0, `${key}.${f} non-empty`);
    }
  }
});

test('vocabulary ids are unique and labelled', () => {
  for (const [name, list] of [['CONDITIONS', CONDITIONS], ['ALLERGIES', ALLERGIES], ['MEDICATIONS', MEDICATIONS]]) {
    const seen = new Set();
    for (const e of list) {
      assert.match(e.id, /^[a-z0-9_]+$/, `${name} id ${e.id}`);
      assert.ok(e.label, `${name} ${e.id} label`);
      assert.ok(!seen.has(e.id), `${name} duplicate ${e.id}`);
      seen.add(e.id);
    }
  }
});

test('every drug has id/name/cls/amountUnit and unique id', () => {
  const seen = new Set();
  for (const d of DRUGS) {
    assert.match(d.id, /^[a-z0-9_]+$/);
    assert.ok(!seen.has(d.id), `duplicate drug ${d.id}`);
    seen.add(d.id);
    assert.ok(d.name, `${d.id}.name`);
    assert.ok(CLASSES.has(d.cls), `${d.id}.cls ${d.cls}`);
    assert.ok(AMOUNT_UNITS.has(d.amountUnit), `${d.id}.amountUnit ${d.amountUnit}`);
    assert.ok(['marsh', 'calibrated'].includes(d.pkModel), `${d.id}.pkModel`);
    if (d.concentration !== null && d.concentration !== undefined) {
      assert.ok(d.concentration.value > 0 && d.concentration.unit, `${d.id}.concentration`);
    }
    assert.ok(d.regimens && Object.keys(d.regimens).length > 0, `${d.id} has regimens`);
  }
});

test('regimens: valid keys, kinds, scalars, ranges and sources', () => {
  for (const d of DRUGS) {
    for (const [key, r] of Object.entries(d.regimens)) {
      const L = `${d.id}.${key}`;
      assert.ok(REGIMEN_KEYS.has(key), `${L}: regimen key`);
      assert.ok(KINDS.has(r.kind), `${L}: kind ${r.kind}`);
      checkSources(r.sources, L);
      if (r.scalar !== null && r.scalar !== undefined) {
        assert.ok(SCALARS.has(r.scalar), `${L}: scalar ${r.scalar}`);
        assert.ok(['label', 'guideline', 'convention'].includes(r.scalarBasis), `${L}: scalarBasis`);
      }
      const hasDose = !!(r.perKg || r.fixed || r.rate);
      assert.ok(hasDose, `${L}: has perKg, fixed or rate`);
      if (r.perKg) { checkRange(r.perKg, `${L}.perKg`); assert.ok(r.unit, `${L}.unit`); assert.ok(r.scalar, `${L}: perKg needs scalar`); }
      if (r.fixed) { checkRange(r.fixed, `${L}.fixed`); assert.ok(r.fixed.unit, `${L}.fixed.unit`); }
      if (r.rate) { checkRange(r.rate, `${L}.rate`); assert.ok(r.rate.unit, `${L}.rate.unit`); }
      if (r.kind === 'infusion' || r.kind === 'inhaled') assert.ok(r.rate, `${L}: ${r.kind} needs rate`);
      if (r.loading) checkRange(r.loading.perKg, `${L}.loading.perKg`);
      for (const [i, a] of (r.adjust || []).entries()) {
        const AL = `${L}.adjust[${i}]`;
        assert.equal(typeof a.when, 'string', `${AL}.when`);
        for (const tok of a.when.split('|')) {
          const err = checkToken(tok, { extended: true });
          assert.equal(err, null, `${AL}: ${err}`);
        }
        checkSources(a.sources, AL);
        if (a.perKg) checkRange(a.perKg, `${AL}.perKg`);
        if (a.fixed) checkRange(a.fixed, `${AL}.fixed`);
        if (a.rate) checkRange(a.rate, `${AL}.rate`);
        if (a.loading) checkRange(a.loading.perKg, `${AL}.loading.perKg`);
      }
    }
  }
});

test('ceilings are positive and sourced', () => {
  for (const d of DRUGS) {
    if (d.ceiling === null || d.ceiling === undefined) continue;
    const c = d.ceiling;
    assert.ok(typeof c.value === 'number' && c.value > 0, `${d.id}.ceiling.value positive`);
    assert.ok(c.unit, `${d.id}.ceiling.unit`);
    assert.ok(['label maximum', 'guideline maximum', 'label range upper bound', 'study protocol value'].includes(c.basis), `${d.id}.ceiling.basis`);
    checkSources(c.sources, `${d.id}.ceiling`);
    if (c.perKg) assert.ok(c.perKg.value > 0, `${d.id}.ceiling.perKg positive`);
  }
});

test('contraindications use documented when-forms and existing ids', () => {
  for (const d of DRUGS) {
    assert.ok(Array.isArray(d.contraindications), `${d.id}.contraindications array`);
    for (const [i, c] of d.contraindications.entries()) {
      const L = `${d.id}.contraindications[${i}]`;
      assert.ok(!c.when.includes('|'), `${L}: single token`);
      const err = checkToken(c.when, { extended: false });
      assert.equal(err, null, `${L}: ${err}`);
      assert.ok(['lock', 'warn'].includes(c.severity), `${L}.severity`);
      assert.ok(c.message && c.message.length > 10, `${L}.message`);
      checkSources(c.sources, L);
    }
  }
});

test('timing has numbers or nulls with a basis', () => {
  for (const d of DRUGS) {
    const t = d.timing;
    assert.ok(t && typeof t.basis === 'string' && t.basis.length > 0, `${d.id}.timing.basis`);
    for (const k of ['onsetMin', 'peakMin', 'durationMin']) {
      assert.ok(t[k] === null || (typeof t[k] === 'number' && t[k] > 0), `${d.id}.timing.${k}`);
    }
    const anyNumber = ['onsetMin', 'peakMin', 'durationMin'].some((k) => t[k] !== null);
    if (anyNumber) checkSources(t.sources, `${d.id}.timing`);
    else assert.equal(t.basis, 'not stated in label', `${d.id}.timing: all-null timing must say 'not stated in label'`);
  }
});

test('required contraindication rules from SPEC §4 are present', () => {
  const byId = Object.fromEntries(DRUGS.map((d) => [d.id, d]));
  const need = [
    ['succinylcholine', 'condition:mh_susceptible', 'lock'],
    ['succinylcholine', 'condition:hyperkalemia', 'lock'],
    ['succinylcholine', 'condition:recent_burn_or_denervation', 'lock'],
    ['succinylcholine', 'condition:neuromuscular_disease', 'lock'],
    ['sevoflurane', 'condition:mh_susceptible', 'lock'],
    ['dexmedetomidine', 'condition:heart_block', 'lock'],
    ['ketorolac', 'egfr<30', 'lock'],
    ['ketorolac', 'allergy:nsaid', 'lock'],
    ['ketamine', 'condition:psychosis_history', 'warn'],
    ['ketamine', 'condition:uncontrolled_htn', 'warn'],
    ['etomidate', 'condition:adrenal_insufficiency', 'warn'],
    ['etomidate', 'condition:sepsis', 'warn'],
    ['propofol', 'allergy:propofol', 'lock'],
    ['rocuronium', 'allergy:rocuronium', 'lock'],
    ['sugammadex', 'allergy:sugammadex', 'lock'],
    ['lidocaine', 'condition:regional_block_planned', 'warn'],
    ['lidocaine', 'condition:liver_disease', 'warn'],
    ['lidocaine', 'condition:heart_block', 'warn'],
  ];
  for (const [drug, when, sev] of need) {
    assert.ok(byId[drug], `drug ${drug} present`);
    const hit = byId[drug].contraindications.find((c) => c.when === when);
    assert.ok(hit, `${drug}: rule ${when}`);
    assert.equal(hit.severity, sev, `${drug}: ${when} severity`);
  }
});

test('SOURCE_IDS_USED is frozen and matches the references exactly', () => {
  assert.ok(Object.isFrozen(SOURCE_IDS_USED));
  const refs = collectRefs(DRUGS);
  for (const s of refs) assert.ok(SOURCES[s], `referenced ${s} exists`);
  assert.deepEqual([...refs].sort(), [...SOURCE_IDS_USED].sort());
  for (const s of Object.values(SOURCE_IDS_ENGINE)) assert.ok(SOURCES[s], `engine source ${s} exists`);
  // Every registered source is used by a drug or by the engine.
  const all = new Set([...SOURCE_IDS_USED, ...Object.values(SOURCE_IDS_ENGINE)]);
  for (const s of Object.keys(SOURCES)) assert.ok(all.has(s), `${s} is used somewhere`);
});

test('special regimen semantics', () => {
  const byId = Object.fromEntries(DRUGS.map((d) => [d.id, d]));
  const sug = byId.sugammadex.regimens.emergence;
  assert.deepEqual(sug.byDepth.map((x) => x.perKg), [2, 4, 16]);
  assert.equal(sug.scalar, 'TBW');
  assert.equal(byId.lidocaine.regimens.maintenance.scalar, 'IBW');
  assert.equal(byId.lidocaine.ceiling.value, 120);
  const glyco = byId.glycopyrrolate.regimens.emergence;
  assert.equal(glyco.ratioTo.drugId, 'neostigmine');
  assert.ok(byId[glyco.ratioTo.drugId]);
  const mac = byId.sevoflurane.mac;
  assert.ok(mac.mac40Pct > 0 && mac.slopePerYear < 0);
});

test('inhaled agents: MAC model, inhaled regimens, MH lock', () => {
  const byId = Object.fromEntries(DRUGS.map((d) => [d.id, d]));
  const expectMac40 = { sevoflurane: 1.80, isoflurane: 1.17, desflurane: 6.6 };
  for (const [id, mac40] of Object.entries(expectMac40)) {
    const d = byId[id];
    assert.ok(d, `${id} present`);
    assert.equal(d.cls, 'volatile');
    assert.equal(d.amountUnit, '%');
    assert.equal(d.mac.mac40Pct, mac40, `${id} Mapleson MAC40`);
    assert.equal(d.mac.slopePerYear, -0.00269);
    checkSources(d.mac.sources, `${id}.mac`);
    const m = d.regimens.maintenance;
    assert.equal(m.kind, 'inhaled');
    assert.equal(m.rate.unit, '%');
    assert.ok(m.rate.max <= d.ceiling.value, `${id}: maintenance max within ceiling`);
    const mh = d.contraindications.find((c) => c.when === 'condition:mh_susceptible');
    assert.ok(mh && mh.severity === 'lock', `${id}: MH lock`);
    for (const row of d.mac.labelTableO2 || []) assert.ok(row.ageYears >= 18 && row.macPct > 0);
  }
  assert.deepEqual(byId.isoflurane.regimens.induction.rate, { default: 1.5, min: 1.5, max: 3, unit: '%' });
  assert.deepEqual([byId.desflurane.regimens.maintenance.rate.min, byId.desflurane.regimens.maintenance.rate.max], [2.5, 8.5]);
  assert.equal(byId.desflurane.regimens.induction, undefined, 'no desflurane induction regimen');
  assert.ok(byId.desflurane.runtimeRules.some((r) => r.id === 'rapid_concentration_increase'));
  assert.ok(LIBRARY_NOTES.nitrousOxide && LIBRARY_NOTES.inhaledMacAdditivity && LIBRARY_NOTES.fio2Arithmetic);
});

test('nitrous oxide: non-label sources, MAC 104%, gas-space rules, no MH lock', () => {
  const n2o = DRUGS.find((d) => d.id === 'nitrous_oxide');
  assert.ok(n2o);
  assert.equal(n2o.cls, 'gas');
  assert.equal(n2o.mac.mac40Pct, 104);
  const m = n2o.regimens.maintenance;
  assert.equal(m.kind, 'inhaled');
  assert.deepEqual([m.rate.default, m.rate.max, m.rate.unit], [70, 70, '%']);
  assert.ok(m.sources.includes('S38'));
  assert.equal(SOURCES.S38.type, 'RCT');
  assert.equal(SOURCES.S39.type, 'physiology study');
  const rule = (w) => n2o.contraindications.find((c) => c.when === w);
  assert.equal(rule('condition:pneumothorax').severity, 'lock');
  assert.equal(rule('condition:bowel_obstruction').severity, 'warn');
  assert.equal(rule('condition:mh_susceptible'), undefined, 'N2O is not an MH trigger');
  assert.ok(!n2o.contraindications.some((c) => /b12|folate|ear/i.test(c.when)));
  assert.ok(n2o.ponvNote.sources.every((s) => SOURCES[s]));
  assert.equal(n2o.induction, undefined);
});
