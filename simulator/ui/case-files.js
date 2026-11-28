import { validatePatient } from '../engine/patient.js';
import { validatePalliative } from '../engine/palliative.js';
import { EXAMPLE_PATIENTS } from '../data/scenarios.js';
import { PALLIATIVE_CASES, PALLIATIVE_OPIOIDS } from '../data/palliative.js';
import { getDrugById, phasesFor } from './plan-model.js';

export const MAX_CASE_BYTES = 256 * 1024;
const format = 'smart-noa.case';
const stepKinds = ['bolus', 'infusion', 'inhaled', 'stop', 'fluid', 'fluid_bolus', 'antibiotic'];
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message) => { throw new Error(message); };
const fields = (value, keys) => Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
const optionalNumber = (value) => value === undefined || value === null || (Number.isFinite(value) && value >= 0);

export function encodeCase({ module, patient, plan, exampleId }) {
  return JSON.stringify({ format, version: 1, module, exampleId: exampleId || null,
    instructions: 'Fictional patients only. Edit values in a plain-text editor and save as UTF-8 JSON. atSec and overSec are seconds; amountUnit and rateUnit specify units. Import opens the setup for review. A run or approval is never restored.',
    patient, plan }, null, 2) + '\n';
}

export function decodeCase(text, lib) {
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { fail('Use a UTF-8 Smart NOA JSON case file. Check commas and quotation marks.'); }
  if (!record(data) || data.format !== format || data.version !== 1) fail('This is not a supported Smart NOA case file (version 1).');
  const { module, exampleId } = data;
  if (!['periop', 'pain', 'eol'].includes(module) || !record(data.patient)) fail('The file needs a supported module and a patient object.');
  if (module !== 'periop') {
    const base = PALLIATIVE_CASES[0].patient;
    const patient = fields(data.patient, [...Object.keys(base), 'veryLowAlbumin', 'sedatingCoMedication']);
    if (record(patient.currentRegimen)) patient.currentRegimen = fields(patient.currentRegimen, ['drugId', 'route', 'dose', 'intervalH']);
    if (typeof patient.priorAdverse !== 'string' || patient.priorAdverse.length > 1000) fail('Prior adverse effects must be text of at most 1,000 characters.');
    const check = validatePalliative(patient);
    if (!check.ok) fail('Patient details are invalid. Check required fields, ranges, and the current opioid regimen.');
    const raw = data.plan;
    let plan = null;
    if (raw !== null && raw !== undefined) {
      if (!record(raw) || typeof raw.drugId !== 'string' || !Object.hasOwn(PALLIATIVE_OPIOIDS, raw.drugId) ||
          !Object.hasOwn(PALLIATIVE_OPIOIDS[raw.drugId].routes, raw.route) ||
          !['dose', 'intervalH', 'prnDose', 'reductionPct', 'ivRatio'].every((k) => optionalNumber(raw[k])) ||
          !Number.isFinite(raw.intervalH) || raw.intervalH <= 0 ||
          !['scheduled', 'bowel', 'convert'].every((k) => raw[k] === undefined || raw[k] === null || typeof raw[k] === 'boolean')) {
        fail('The opioid plan has an invalid drug, route, interval, or value.');
      }
      plan = { ...fields(raw, ['drugId', 'route', 'dose', 'intervalH', 'prnDose', 'reductionPct', 'ivRatio', 'scheduled', 'bowel', 'convert']), ack: false };
    }
    return { module, patient, plan, exampleId: PALLIATIVE_CASES.some((c) => c.id === exampleId && c.module === module) ? exampleId : null };
  }
  const base = EXAMPLE_PATIENTS[0].patient;
  const patient = fields(data.patient, [...Object.keys(base), 'neckCm']);
  for (const key of ['baseline', 'airway', 'stopBang']) {
    if (record(patient[key])) patient[key] = fields(patient[key], [...Object.keys(base[key]), ...(key === 'stopBang' ? ['neckCm'] : [])]);
  }
  const check = validatePatient(patient, { library: lib });
  if (!check.ok) fail('Patient details are invalid. Check required fields, ranges, and condition IDs.');
  const raw = data.plan;
  if (!record(raw) || !['GA', 'MAC'].includes(raw.mode) || !Array.isArray(raw.steps) || raw.steps.length > 200 ||
      (raw.mode === 'MAC' && !['minimal', 'moderate', 'deep'].includes(raw.sedationTarget))) fail('Use a GA or MAC plan with up to 200 valid steps.');
  const phases = phasesFor(raw.mode);
  const steps = raw.steps.map((step, index) => {
    if (!record(step) || !phases.includes(step.phase) || !stepKinds.includes(step.kind) ||
        typeof step.drugId !== 'string' || !getDrugById(lib, step.drugId) ||
        (step.afterLoadingOf != null && step.afterLoadingOf !== step.drugId) ||
        (step.fluidId != null && step.fluidId !== step.drugId) ||
        !Number.isFinite(step.atSec) || step.atSec < 0 ||
        !['amount', 'rate', 'overSec', 'beforeEndSec'].every((k) => optionalNumber(step[k])) ||
        !['regimenKey', 'route', 'amountUnit', 'rateUnit', 'fluidId', 'afterLoadingOf'].every((k) =>
          step[k] === undefined || step[k] === null || (typeof step[k] === 'string' && step[k].length <= 80))) {
      fail(`Plan step ${index + 1} has an invalid phase, drug, kind, timing, or unit field.`);
    }
    return { ...fields(step, ['phase', 'atSec', 'drugId', 'kind', 'regimenKey', 'route', 'amount', 'amountUnit', 'rate', 'rateUnit', 'overSec', 'fluidId', 'beforeEndSec', 'afterLoadingOf']),
      id: `import-${index + 1}`, loading: step.loading === true };
  });
  return { module, patient, exampleId: null, plan: { mode: raw.mode, sedationTarget: raw.sedationTarget || 'moderate', steps,
    prophylaxisIndicated: typeof raw.prophylaxisIndicated === 'boolean' ? raw.prophylaxisIndicated : raw.mode === 'GA' } };
}

export function downloadText(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
