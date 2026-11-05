// Technique templates for the plan screen (2026-11 owner-approved additions).
// EDUCATIONAL SIMULATION — fictional patients — not medical advice.
//
// Templates contain NO dose numbers. Each step names a drug + regimen (or a fluid / antibiotic
// step); engine/templates.js buildTemplatePlan() fills every amount and rate at runtime from
// recommend() (data/drugs.js). Phase offsets (atSec) and the choice of steps are simulator
// conventions for teaching, not recommendations. Templates stay fully editable after loading.
//
// Step fields: phase, atSec, kind ('bolus'|'infusion'|'inhaled'|'stop'|'fluid'|'antibiotic'),
//   drugId, regimenKey ('sedation' = the plan's MAC target regimen), dial:'mac1',
//   optional: { id, label, default } — included only when selected,
//   fallback: { drugId, regimenKey, kind } — used when the primary drug is locked for the patient
//             (later 'stop' steps for the primary then stop the fallback),
//   omitIf: 'lidocaineAnalgesic' — dropped when the plan has an IV lidocaine analgesic regimen,
//   fluidId + rate:'default' — maintenance infusion at the simulator's default rate (FLUID_MODEL).
//   afterLoadingOf: drugId — the infusion waits until that drug's loading dose has finished (cross-phase anchor),
//   beforeEndSec: N — (maintenance-phase stop only) runs N s before the planned end of surgery (automatic
//                demonstration: planned end − N; guided/manual: when End surgery is pressed, if not earlier),
//   timingRationale: { text, provenance, sources } — WHY the step sits at this time. provenance is one of
//                'label' | 'guideline' | 'consensus' | 'trial' | 'simulator convention' |
//                'clinical practice convention (owner)'; sources are ids in data/drugs.js SOURCES (a convention
//                may cite the label statement it is anchored to). All thresholds: engine/timing.js TIMING_CONFIG.
// Same-phase loading → maintenance: buildPlan() starts the maintenance infusion when the loading dose ends.
// notes: keys into data/drugs.js TEMPLATE_NOTES.

const LR = 'lactated_ringers';
const CONV = 'simulator convention';
const OWNER = 'clinical practice convention (owner)';
const R = (text, provenance, sources = []) => Object.freeze({ text, provenance, sources: Object.freeze([...sources]) });

// Shared rationales (timing review 2026-11; values in engine/timing.js TIMING_CONFIG).
const WHY = Object.freeze({
  fluid: R('Maintenance crystalloid started in pre-op holding and continued across phases until changed (rate and start are simulator conventions; the labels give no fixed dose).', CONV, ['S47']),
  abx: R('Started in pre-op holding so the dose begins within 60 min before incision (Bratzler); the pre-incision gate re-checks the window [S46].', 'guideline', ['S46']),
  midazolamPremed: R('Given in pre-op holding about 5 min before transfer to the OR (owner-stated practice); label: sedation within 3 to 5 min after IV injection [S17]. It never overlaps induction: the induction gate opens only after transfer + OR setup + preoxygenation.', OWNER, ['S17']),
  fentanyl: R('Opioid given ~3 min before the hypnotic so it approaches peak effect before laryngoscopy (convention). Label: onset almost immediate IV, maximal effect may not be noted for several minutes [S13].', CONV, ['S13']),
  dexamethasone: R('Given at induction for PONV prophylaxis (consensus) [S2, S3].', 'consensus', ['S2', 'S3']),
  pretreatment: R('Immediately before propofol (label: prior IV lidocaine reduces injection pain) [S11]; the 10-s gap is a convention.', 'label', ['S11']),
  propofolAfterOpioid: R('Hypnotic 3 min after the opioid (convention, see fentanyl); label: hypnosis usually within 40 s from the start of injection [S11].', CONV, ['S11']),
  rocuronium: R('After loss of consciousness: 60 s after the hypnotic, beyond its label onset (hypnosis usually within 40 s) [S11]; the 60-s spacing is a convention.', 'label', ['S11']),
  volatileStart: R('Started when maintenance begins, after the airway is secured (convention).', CONV),
  volatileStop: R('Agent off at the start of emergence, after End surgery and closing (convention).', CONV),
  ondansetron: R('At the end of surgery for PONV prophylaxis (consensus) [S2, S3].', 'consensus', ['S2', 'S3']),
  sugammadex: R('After the anaesthetic agents are off; the dose is compared with the TOF depth of block when given (label tiers) [S6]. The 30-s offset is a convention.', 'label', ['S6']),
});

export const TECHNIQUE_TEMPLATES = [
  {
    id: 'ga_opioid', label: 'GA — opioid-based (balanced)', mode: 'GA', sedationTarget: null, notes: ['propofolPain'],
    description: 'Midazolam (optional, pre-op holding), fentanyl, lidocaine pretreatment (optional), propofol 3 min after fentanyl, rocuronium after loss of consciousness, sevoflurane (propofol infusion if sevoflurane is locked), dexamethasone, ondansetron, sugammadex; lactated Ringer\'s maintenance; guideline antibiotic prophylaxis.',
    steps: [
      { phase: 'premed', atSec: 0, kind: 'fluid', fluidId: LR, rate: 'default', timingRationale: WHY.fluid },
      { phase: 'premed', atSec: 0, kind: 'antibiotic', drugId: 'auto', timingRationale: WHY.abx },
      { phase: 'premed', atSec: 0, kind: 'bolus', drugId: 'midazolam', regimenKey: 'premed', optional: { id: 'midazolam', label: 'Midazolam premedication (pre-op holding)', default: true }, timingRationale: WHY.midazolamPremed },
      { phase: 'induction', atSec: 0, kind: 'bolus', drugId: 'fentanyl', regimenKey: 'induction', timingRationale: WHY.fentanyl },
      { phase: 'induction', atSec: 0, kind: 'bolus', drugId: 'dexamethasone', regimenKey: 'induction', timingRationale: WHY.dexamethasone },
      { phase: 'induction', atSec: 170, kind: 'bolus', drugId: 'lidocaine', regimenKey: 'pretreatment', omitIf: 'lidocaineAnalgesic', optional: { id: 'lidocainePretreatment', label: 'Lidocaine pretreatment before propofol (injection pain)', default: true }, timingRationale: WHY.pretreatment },
      { phase: 'induction', atSec: 180, kind: 'bolus', drugId: 'propofol', regimenKey: 'induction', timingRationale: WHY.propofolAfterOpioid },
      { phase: 'induction', atSec: 240, kind: 'bolus', drugId: 'rocuronium', regimenKey: 'induction', timingRationale: WHY.rocuronium },
      { phase: 'maintenance', atSec: 0, kind: 'inhaled', drugId: 'sevoflurane', regimenKey: 'maintenance', dial: 'mac1', fallback: { drugId: 'propofol', regimenKey: 'maintenance', kind: 'infusion' }, timingRationale: WHY.volatileStart },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'sevoflurane', timingRationale: WHY.volatileStop },
      { phase: 'emergence', atSec: 0, kind: 'bolus', drugId: 'ondansetron', regimenKey: 'emergence', timingRationale: WHY.ondansetron },
      { phase: 'emergence', atSec: 30, kind: 'bolus', drugId: 'sugammadex', regimenKey: 'emergence', timingRationale: WHY.sugammadex },
    ],
  },
  {
    id: 'ga_opioid_free', label: 'GA — opioid-free', mode: 'GA', sedationTarget: null, notes: ['pofa', 'lidocaineOverlap', 'propofolPain'],
    description: 'Dexmedetomidine, ketamine and IV lidocaine (Foo 2021 loading, then infusion when the loading ends) instead of an opioid, with propofol, rocuronium after loss of consciousness, sevoflurane (propofol infusion if sevoflurane is locked), dexamethasone, ondansetron, sugammadex; dexmedetomidine stops 15 min before the planned end of surgery; lactated Ringer\'s maintenance; guideline antibiotic prophylaxis. Lidocaine pretreatment is omitted because an IV lidocaine infusion is planned.',
    steps: [
      { phase: 'premed', atSec: 0, kind: 'fluid', fluidId: LR, rate: 'default', timingRationale: WHY.fluid },
      { phase: 'premed', atSec: 0, kind: 'antibiotic', drugId: 'auto', timingRationale: WHY.abx },
      { phase: 'induction', atSec: 0, kind: 'infusion', drugId: 'dexmedetomidine', regimenKey: 'maintenance', timingRationale: R('Adjunct infusion started at induction, without a loading dose (this off-label regimen has none) (convention).', CONV, ['S9']) },
      { phase: 'induction', atSec: 0, kind: 'infusion', drugId: 'ketamine', regimenKey: 'maintenance', timingRationale: R('Subanaesthetic analgesic infusion started at induction (consensus gives the dose, not the start time; start = convention) [S10].', CONV, ['S10']) },
      { phase: 'induction', atSec: 0, kind: 'bolus', drugId: 'lidocaine', regimenKey: 'induction', timingRationale: R('Foo 2021 loading dose over about 10 min, started at induction; the infusion starts when this loading dose ends [S1].', 'consensus', ['S1']) },
      { phase: 'induction', atSec: 0, kind: 'bolus', drugId: 'dexamethasone', regimenKey: 'induction', timingRationale: WHY.dexamethasone },
      { phase: 'induction', atSec: 50, kind: 'bolus', drugId: 'lidocaine', regimenKey: 'pretreatment', omitIf: 'lidocaineAnalgesic', optional: { id: 'lidocainePretreatment', label: 'Lidocaine pretreatment before propofol (omitted while an IV lidocaine infusion is planned)', default: true }, timingRationale: WHY.pretreatment },
      { phase: 'induction', atSec: 60, kind: 'bolus', drugId: 'propofol', regimenKey: 'induction', timingRationale: R('Hypnotic 1 min after the adjunct infusions start (no opioid to wait for; convention); label: hypnosis usually within 40 s [S11].', CONV, ['S11']) },
      { phase: 'induction', atSec: 120, kind: 'bolus', drugId: 'rocuronium', regimenKey: 'induction', timingRationale: WHY.rocuronium },
      { phase: 'maintenance', atSec: 0, kind: 'inhaled', drugId: 'sevoflurane', regimenKey: 'maintenance', dial: 'mac1', fallback: { drugId: 'propofol', regimenKey: 'maintenance', kind: 'infusion' }, timingRationale: WHY.volatileStart },
      { phase: 'maintenance', atSec: 0, kind: 'infusion', drugId: 'lidocaine', regimenKey: 'maintenance', afterLoadingOf: 'lidocaine', timingRationale: R('Infusion starts when the lidocaine loading dose (about 10 min) has finished — never overlapping it [S1].', 'consensus', ['S1']) },
      { phase: 'maintenance', atSec: 0, kind: 'stop', drugId: 'dexmedetomidine', beforeEndSec: 900, timingRationale: R('Stopped 15 min before the planned end of surgery so its sedative effect is waning at emergence. No label, guideline or verified trial statement gives this interval: simulator convention.', CONV) },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'sevoflurane', timingRationale: WHY.volatileStop },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'ketamine', timingRationale: R('Stopped with the anaesthetic agents at emergence; the consensus gives no intraoperative stop time (convention) [S10].', CONV, ['S10']) },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'lidocaine', timingRationale: R('Stopped at emergence because the simulation ends there. Foo 2021 allows the infusion for up to 24 h with review [S1]; stopping it here is a convention, not a guideline requirement.', CONV, ['S1']) },
      { phase: 'emergence', atSec: 0, kind: 'bolus', drugId: 'ondansetron', regimenKey: 'emergence', timingRationale: WHY.ondansetron },
      { phase: 'emergence', atSec: 30, kind: 'bolus', drugId: 'sugammadex', regimenKey: 'emergence', timingRationale: WHY.sugammadex },
    ],
  },
  {
    id: 'mac_dex', label: 'MAC — dexmedetomidine', mode: 'MAC', sedationTarget: 'moderate', notes: ['dexMac', 'dexInterlock'],
    description: 'Dexmedetomidine procedural sedation (label loading dose over 10 min, then the titrated maintenance infusion) toward the chosen ASA-continuum target, with optional midazolam or propofol supplementation; lactated Ringer\'s maintenance.',
    steps: [
      { phase: 'sedation', atSec: 0, kind: 'fluid', fluidId: LR, rate: 'default', timingRationale: WHY.fluid },
      { phase: 'sedation', atSec: 0, kind: 'infusion', drugId: 'dexmedetomidine', regimenKey: 'sedation', timingRationale: R('Loading infusion over 10 min, then maintenance (label) [S9]: the maintenance infusion starts at +10:00, when the loading dose ends.', 'label', ['S9']) },
      { phase: 'sedation', atSec: 0, kind: 'bolus', drugId: 'midazolam', regimenKey: 'sedation', optional: { id: 'midazolam', label: 'Midazolam supplementation (no deep-sedation regimen in the label)', default: false }, timingRationale: R('Optional supplementation at the start of sedation; label: give over at least 2 min and wait at least 2 more min before more [S17]. In the dexmedetomidine label studies rescue midazolam was permitted to reach the target [S9].', 'label', ['S17', 'S9']) },
      { phase: 'sedation', atSec: 600, kind: 'infusion', drugId: 'propofol', regimenKey: 'sedation', optional: { id: 'propofol', label: 'Propofol supplementation after the loading dose (no minimal-sedation regimen in the label)', default: false }, timingRationale: R('Only after the dexmedetomidine loading dose ends (+10:00); propofol initiation over 3–5 min, then its maintenance [S11]. Start time = convention.', CONV, ['S9', 'S11']) },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'dexmedetomidine', timingRationale: R('Stopped when the procedure ends (recovery) (convention).', CONV) },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'propofol', timingRationale: R('Stopped when the procedure ends (recovery) (convention).', CONV) },
    ],
  },
  {
    id: 'mac_propofol', label: 'MAC — propofol (existing technique)', mode: 'MAC', sedationTarget: 'moderate', notes: [],
    description: 'Midazolam (optional) then, 4 min after it starts (injection ≥ 2 min + ≥ 2 min to evaluate its effect), a propofol MAC-sedation infusion (label slow initiation over 3–5 min, then the maintenance infusion), as in the MAC example plan.',
    steps: [
      { phase: 'sedation', atSec: 0, kind: 'bolus', drugId: 'midazolam', regimenKey: 'sedation', optional: { id: 'midazolam', label: 'Midazolam (no deep-sedation regimen in the label)', default: true }, timingRationale: R('First, given over at least 2 min (label) [S17].', 'label', ['S17']) },
      { phase: 'sedation', atSec: 240, kind: 'infusion', drugId: 'propofol', regimenKey: 'sedation', timingRationale: R('Started 4 min after the midazolam starts: midazolam is given over at least 2 min and its effect is evaluated over at least 2 more min before more sedative is added (midazolam label [S17]; ASA 2018 moderate-sedation guideline: allow sufficient time between doses to assess the effect of each [S32]). Then propofol initiation (slow injection 0.5 mg/kg over 3–5 min) and the maintenance infusion when the initiation ends (label) [S11]. Timing cross-check 2026-11: was +2:00 (before the midazolam effect could be evaluated).', 'label', ['S17', 'S32', 'S11']) },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'propofol', timingRationale: R('Stopped when the procedure ends (recovery) (convention).', CONV) },
    ],
  },
];
