// Shared test helpers (engine worker). Runs suites against the TEST FIXTURE library and,
// when present, the real data/drugs.js library.
import * as FIXTURE from './fixtures/drugs.fixture.mjs';
import { hasDefaultLibrary, getDefaultLibrary } from '../engine/library.js';

export const LIBS = [{ name: 'fixture', lib: FIXTURE }];
if (hasDefaultLibrary()) LIBS.push({ name: 'real', lib: getDefaultLibrary() });
export const REAL = hasDefaultLibrary() ? getDefaultLibrary() : null;
export { FIXTURE };

export function basePatient(over = {}) {
  return {
    sex: 'male', ageYears: 40, heightCm: 180, weightKg: 80, asa: 2, emergency: false,
    baseline: { hr: 75, sbp: 125, dbp: 80, spo2: 98, rr: 14 }, egfr: 90,
    airway: { mallampati: 1, difficultHistory: false, limitedMouthOpening: false, limitedNeck: false },
    conditions: [], allergies: [], medications: [], ponvHistory: false, smoker: false, postopOpioidsExpected: false,
    stopBang: { snoring: false, tired: false, observedApnea: false, pressure: false },
    ...over,
  };
}

export function runFor(sim, sec) { for (let i = 0; i < sec; i++) sim.step(1); return sim.state; }
export function track(sim, sec, fn) { const out = []; for (let i = 0; i < sec; i++) { sim.step(1); out.push(fn(sim.state)); } return out; }

/**
 * What the CLINICIAN does at a pre-incision / pre-procedure gate (timing review): confirm the WHO time out,
 * acknowledge a processed-EEG index below the GA band, give guideline prophylaxis if it is missing.
 * Uses runner.clinicianAction (the runner never does this on its own). Returns the actions taken.
 */
export function clinicianResolves(runner) {
  const st = runner.status(); const items = st.current && st.current.items ? st.current.items : [];
  const map = { time_out: 'confirm_time_out', depth: 'acknowledge_depth_below_band', antibiotic: 'give_prophylaxis' };
  const done = [];
  for (const it of items) if (!it.met && (it.clinician || it.id === 'antibiotic') && map[it.id]) { runner.clinicianAction(map[it.id]); done.push(map[it.id]); }
  return done;
}
