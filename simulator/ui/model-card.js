// Model card panel and model-limitations text. Everything shown is read from the engine
// (createPkModel / sim.modelInfo()), the drug library (timing, MAC, sources) and SOURCES.md;
// provenance that the engine does not record is shown as "not recorded" (never invented).
import { h, clear, fmtNum, isNum } from './dom.js';
import { createPkModel } from '../engine/pk.js';
import { PHYS } from '../engine/physiology.js';
import { scalarWeight } from '../engine/patient.js';
import { srcTags } from './sources.js';

export const AI_DISCLOSURE = 'Code, parameter selection and source gathering for this simulator were produced with AI assistance (Anthropic Claude, model claude-opus-5-5, via Claude Code, November 2026) under the owner’s direction. Sources were checked through web-search records of labels and publications as recorded in SOURCES.md; independent human verification of every source by the owner is pending. AI was not used to generate data presented as observed. The owner is responsible for the content.';

export const TOOL_DESCRIPTION = 'An educational, label-calibrated anesthesia pharmacology simulator with fictional patients.';

const shortCite = (s) => { const c = String(s.citation || ''); return c.length > 70 ? `${c.slice(0, 67)}…` : c; };

/** Provenance category for a source id (from SOURCES[id].type). */
export function categoryFor(lib, id) {
  const s = lib.SOURCES[id];
  if (!s) return 'not recorded';
  const t = String(s.type || '').toLowerCase();
  if (t.includes('fda label')) return `FDA label (${shortCite(s)})`;
  if (/guideline|consensus|standard|statement/.test(t)) return 'guideline/consensus';
  if (/rct|trial|physiology study/.test(t)) return 'trial/physiology study';
  if (/model|validation|formula|meta-analysis/.test(t)) return `published model (${shortCite(s)})`;
  if (t.includes('project configuration')) return 'project configuration (Smart NOA config.yaml; not clinical evidence)';
  return s.type || 'not recorded';
}

let ASSUMPTIONS = null;
/** Bullet list of SOURCES.md "Model assumptions (illustrative)" (same-origin read; null if unavailable). */
export async function loadModelAssumptions() {
  if (ASSUMPTIONS) return ASSUMPTIONS;
  try {
    const r = await fetch('SOURCES.md', { cache: 'no-cache' });
    if (!r.ok) return null;
    const md = await r.text();
    const sec = md.split(/\n(?=## )/).find((x) => /^## Model assumptions/.test(x));
    if (!sec) return null;
    const items = []; let cur = null;
    for (const line of sec.split('\n').slice(1)) {
      if (/^\s*[-*] /.test(line)) { if (cur) items.push(cur); cur = line.replace(/^\s*[-*] /, ''); } else if (cur && line.trim()) cur += ` ${line.trim()}`;
    }
    if (cur) items.push(cur);
    ASSUMPTIONS = items.map((s) => s.replace(/\*\*|`/g, ''));
    return ASSUMPTIONS;
  } catch { return null; }
}

export function assumptionsList(items) {
  if (!items) return h('p', { class: 'hint' }, 'See SOURCES.md, section “Model assumptions (illustrative)”.');
  return h('ul', { class: 'list list--tight' }, items.map((t) => h('li', {}, t)));
}

function pkRows(lib, drug, patient, info) {
  const rows = [];
  const add = (param, value, unit, provenance, sources = null) => rows.push({ param, value, unit, provenance, sources });
  if (info && Array.isArray(info.parameters)) {
    for (const p of info.parameters) add(p.name || p.id || '?', p.value, p.unit || '', p.provenance || 'not recorded', p.sources || null);
    return rows;
  }
  let m = null;
  try {
    const reg = Object.values(drug.regimens || {}).find((r) => r && r.scalar);
    m = createPkModel(drug, patient, { volumeWeightKg: reg ? scalarWeight(patient, reg.scalar).weightKg : patient.weightKg });
  } catch (e) { add('model', 'unavailable', '', e.message); return rows; }
  const type = (info && info.type) || m.type;
  const prov = (info && info.provenance) || m.provenance || 'not recorded';
  const published = type !== 'calibrated' && type !== 'volatile';
  const fitCat = published ? `published model (${prov})` : 'author estimate — unvalidated';
  if (m.type === 'volatile') {
    const ms = (drug.mac && drug.mac.sources) || [];
    add('MAC40', m.mac40, '%', ms.length ? categoryFor(lib, ms[0]) : 'not recorded', ms);
    add('Age-adjusted MAC (this patient)', fmtNum(m.macAgeAdjusted, 2), '%', ms.length ? categoryFor(lib, ms[0]) : 'not recorded', ms);
    add('End-tidal wash-in/out time constant', fmtNum(m.model.tauMin ?? m.model.tau, 2), 'min', 'author estimate — unvalidated');
    add('Effect-site ke0', fmtNum(m.model.ke0, 3), 'min⁻¹', 'author estimate — unvalidated');
  } else {
    const k = m.model;
    if (isNum(k.v1L)) add('V1', fmtNum(k.v1L, 2), 'L', published ? fitCat : 'author estimate — unvalidated (concentrations are normalised, so V1 cancels)');
    for (const p of ['k10', 'k12', 'k21', 'k13', 'k31', 'ke0']) if (isNum(k[p]) && (k[p] > 0 || p === 'k10')) add(p, fmtNum(k[p], 4), 'min⁻¹', published ? fitCat : 'author estimate — unvalidated (fitted to the timing statements below)');
  }
  const t = drug.timing;
  if (t && m.type !== 'volatile') {
    const srcs = t.sources || [];
    const cat = srcs.length ? categoryFor(lib, srcs[0]) : t.basis || 'not recorded';
    for (const [key, label] of [['onsetMin', 'Onset (calibration target)'], ['peakMin', 'Peak (calibration target)'], ['durationMin', 'Duration (calibration target)']]) {
      add(label, isNum(t[key]) ? t[key] : 'not stated', isNum(t[key]) ? 'min' : '', isNum(t[key]) ? cat : 'not recorded — engine fallback (author estimate — unvalidated)', isNum(t[key]) ? srcs : null);
    }
  }
  return rows;
}

export function renderModelCard(container, { lib, patient, sim, assumptions }) {
  clear(container);
  const info = sim ? sim.modelInfo() : {};
  const pt = patient;
  container.append(
    h('p', {}, TOOL_DESCRIPTION, ' Intended use: education only; not for clinical decisions or dosing.'),
    h('p', { class: 'hint' }, pt ? `Parameters below are computed for the current fictional patient (${pt.sex}, ${pt.ageYears} y, ${pt.weightKg} kg). ` : 'Parameters below use a fictional reference patient. ',
      sim ? 'Drugs already used in the running case show the engine’s own model record (sim.modelInfo()).' : ''),
    h('h3', {}, 'Pharmacology parameters'),
  );
  for (const d of lib.DRUGS) {
    const rows = pkRows(lib, d, pt, info[d.id]);
    const type = (info[d.id] && info[d.id].type) || (rows.length ? null : 'unavailable');
    let header = '';
    try { const reg = Object.values(d.regimens || {}).find((r) => r && r.scalar); header = createPkModel(d, pt, { volumeWeightKg: reg ? scalarWeight(pt, reg.scalar).weightKg : pt.weightKg }); } catch { header = null; }
    const t = type || (header && header.type) || 'unknown';
    const published = t !== 'calibrated' && t !== 'volatile' && t !== 'unknown' && t !== 'unavailable';
    const prov = (info[d.id] && info[d.id].provenance) || (header && header.provenance) || 'not recorded';
    container.append(h('details', { class: 'model-drug' },
      h('summary', {}, h('strong', {}, d.name), ` — ${published ? `implements the published model recorded as “${prov}”; implementation checked against published reference values where tests exist; the simulator as a whole is not validated` : t === 'volatile' ? 'inhaled-agent model' : 'label-calibrated illustrative model'}`),
      h('p', { class: 'hint' }, `Engine record: ${prov}`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Parameter'), h('th', { scope: 'col' }, 'Value'), h('th', { scope: 'col' }, 'Unit'), h('th', { scope: 'col' }, 'Provenance'))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.param), h('td', { class: 'mono' }, String(r.value)), h('td', {}, r.unit), h('td', {}, r.provenance, ' ', srcTags(r.sources)))))))));
  }
  container.append(
    h('details', { class: 'model-drug' }, h('summary', {}, h('strong', {}, 'Physiology constants'), ' — ventilation, oxygenation, CO2'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Parameter'), h('th', { scope: 'col' }, 'Value'), h('th', { scope: 'col' }, 'Provenance'))),
        h('tbody', {}, Object.entries(PHYS).map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, h('code', {}, k)), h('td', { class: 'mono' }, String(v)), h('td', {}, 'author estimate — unvalidated'))),
          h('tr', {}, h('th', { scope: 'row' }, 'Alveolar gas equation; Severinghaus 1979 SO2 curve'), h('td', {}, '—'), h('td', {}, 'published physiology relation (cited in engine code; not in the SOURCES registry)'))))),
      h('p', { class: 'hint' }, 'Haemodynamic gains, effect-model EC50s and patient modifiers are engine assumptions (author estimate — unvalidated); per-parameter provenance for them is not recorded.')),
    h('h3', {}, 'Model assumptions (from SOURCES.md)'), assumptionsList(assumptions),
    h('h3', {}, 'Verification'),
    h('p', {}, 'Automated tests (node --test simulator/tests) check unit conversions, dose arithmetic against the drug library, contraindication rules, determinism per seed, and decision parity with the Python Smart NOA controller (EXAMPLE_RESULTS.json statuses and zeroed infusions; NaN/missing fail-safe; direct-write bypass; rate ceilings). A browser smoke test exercises the user interface.'),
    h('h3', {}, 'Timing evidence'),
    h('p', {}, 'Every timed element (templates, guided-mode gates, full-auto settings, timing-validator thresholds) was cross-checked against FDA labels and guidelines in November 2026; what each source says, the agreement, the classification (label / guideline / owner practice / simulator convention) and a clinician-review checklist are in ',
      h('a', { href: 'TIMING_EVIDENCE.md', id: 'model-timing-evidence' }, 'TIMING_EVIDENCE.md'), '. No clinician review of the timings has been recorded.'),
    h('h3', {}, 'Face validity'), h('p', {}, 'No expert anesthesiologist review has been recorded.'),
    h('h3', {}, 'External validation'), h('p', {}, 'None performed.'),
    h('h3', {}, 'Parts that cannot be validated with available sources'),
    h('ul', { class: 'list list--tight' },
      h('li', {}, 'Fitted compartment constants: labels give only onset/peak/duration statements, not concentration–time data.'),
      h('li', {}, 'Effect-model shapes, drug interactions (synergy), haemodynamic and respiratory gains, and the processed-EEG depth index (BIS-style, simulated; not a BIS value — BIS is a trademark of its owner).'),
      h('li', {}, 'Patient modifiers (age, obesity, OSA, organ dysfunction) and complication magnitudes.')),
    h('h3', {}, 'Intended use'), h('p', {}, 'Education only; not for clinical decisions or dosing. Fictional patients only.'));
}
