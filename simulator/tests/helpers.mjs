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
