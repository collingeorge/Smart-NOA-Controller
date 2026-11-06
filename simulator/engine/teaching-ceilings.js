// Simulator teaching ceilings (owner decision, emergency-rescue stress matrix, November 2026).
// Pure; no DOM; no imports. EDUCATIONAL SIMULATION — fictional patients — not a medical device.
//
// Where neither the drug library nor a verifiable label/guideline states a cumulative maximum, a cumulative
// TEACHING GUARD is applied: a dose that would take the running total above it is refused until the clinician
// presses "Confirm dose above the simulator teaching ceiling" (sim.action('confirm_teaching_ceiling:<key>'),
// logged). A confirmation covers ONE dose of that agent within CONFIRMATION_VALID_SEC. These values are NOT
// clinical limits and NOT sourced (provenance 'simulator_convention', sourceIds empty); the statements they are
// anchored to are named in the rationale text only. Guided and automatic modes never confirm them: a planned
// step above the guard is refused (logged) and skipped.
//
// Searched 2026-11-06 (web-search records; see EMERGENCY_STRESS.md): no cumulative maximum was found for
// intraoperative glycopyrrolate (label: 0.1 mg IV repeated as needed at 2–3 min intervals; paediatric intraoperative
// dosing is capped at 0.1 mg per single dose) or for perioperative IV epinephrine boluses (UK [S44, S45]
// perioperative-anaphylaxis guidance: titrate 50 mcg boluses, start an infusion after several doses / a poor
// response). Crystalloid has no label dose.

const CONVENTION = 'simulator_convention';
const e = (value, unit, rationale, extra = {}) => Object.freeze({ value, unit, rationale, provenance: CONVENTION, sourceIds: Object.freeze([]), ...extra });

export const TEACHING_CEILINGS = Object.freeze({
  EPINEPHRINE_IV_BOLUS_TOTAL: e(0.5, 'mg',
    'Teaching guard, not a clinical limit: total IV epinephrine BOLUSES in the session (infusion not counted; it has its label rate ceiling). 0.5 mg = 10 × the 50-microgram perioperative-anaphylaxis titration step of the rescue_iv regimen (UK guidance [S44, S45], which advises an infusion if several doses are needed) and equals the label per-injection IM maximum (0.5 mg [S40]). No guideline or label states an IV cumulative maximum.',
    { key: 'epinephrine_iv', drugId: 'epinephrine', routes: Object.freeze(['IV']), label: 'epinephrine IV boluses' }),
  GLYCOPYRROLATE_BOLUS_TOTAL: e(1, 'mg',
    'Teaching guard, not a clinical limit: total glycopyrrolate boluses in the session (any phase). 1 mg = 10 × the 0.1 mg intraoperative rescue dose [S8] and the top of the emergence regimen range in the library (0.2 mg per 1 mg neostigmine applied to the 5 mg neostigmine label maximum [S7, S8]). The label states no cumulative intraoperative maximum (the FDA pharmacology review of a prefilled-syringe product, NDA 214919, calculated a maximum daily dose of 1.0 mg/day from the reference label — seen in a web-search record, 2026-11-06; a reviewer calculation, not a label limit).',
    { key: 'glycopyrrolate', drugId: 'glycopyrrolate', routes: Object.freeze(['IV']), label: 'glycopyrrolate boluses' }),
  CRYSTALLOID_TOTAL_ML_PER_KG: e(30, 'mL/kg TBW',
    'Teaching guard, not a clinical limit: total crystalloid (boluses + maintenance, any fluid type) per kg total body weight. A bolus that would take the total above it needs the confirmation; a running maintenance infusion is not stopped. 30 mL/kg is the Surviving Sepsis Campaign 2021 initial resuscitation volume for sepsis-induced hypoperfusion (already shown as context by the fluid model, FLUID_MODEL.SEPSIS_CONTEXT_ML_PER_KG) reused as a "stop and think" point; fluid overload is not modelled.',
    { key: 'crystalloid', label: 'crystalloid (boluses + maintenance)' }),
  CONFIRMATION_VALID_SEC: e(60, 's',
    'A clinician confirmation covers one dose (or one fluid bolus) of that agent given within this time; it is then used up. Simulator convention.'),
});

/** The three guards as a list: [{ name, key, drugId?, routes?, label, value, unit }]. */
export const TEACHING_GUARDS = Object.freeze(Object.entries(TEACHING_CEILINGS).filter(([, x]) => x.key).map(([name, x]) => Object.freeze({ name, ...x })));
export const teachingGuard = (key) => TEACHING_GUARDS.find((g) => g.key === key) || null;
