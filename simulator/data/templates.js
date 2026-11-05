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
// notes: keys into data/drugs.js TEMPLATE_NOTES.

const LR = 'lactated_ringers';

export const TECHNIQUE_TEMPLATES = [
  {
    id: 'ga_opioid', label: 'GA — opioid-based (balanced)', mode: 'GA', sedationTarget: null, notes: ['propofolPain'],
    description: 'Midazolam (optional), fentanyl, lidocaine pretreatment (optional), propofol, rocuronium, sevoflurane (propofol infusion if sevoflurane is locked), dexamethasone, ondansetron, sugammadex; lactated Ringer\'s maintenance; guideline antibiotic prophylaxis.',
    steps: [
      { phase: 'premed', atSec: 0, kind: 'fluid', fluidId: LR, rate: 'default' },
      { phase: 'premed', atSec: 0, kind: 'antibiotic', drugId: 'auto' },
      { phase: 'premed', atSec: 0, kind: 'bolus', drugId: 'midazolam', regimenKey: 'premed', optional: { id: 'midazolam', label: 'Midazolam premedication', default: true } },
      { phase: 'induction', atSec: 0, kind: 'bolus', drugId: 'fentanyl', regimenKey: 'induction' },
      { phase: 'induction', atSec: 0, kind: 'bolus', drugId: 'dexamethasone', regimenKey: 'induction' },
      { phase: 'induction', atSec: 50, kind: 'bolus', drugId: 'lidocaine', regimenKey: 'pretreatment', omitIf: 'lidocaineAnalgesic', optional: { id: 'lidocainePretreatment', label: 'Lidocaine pretreatment before propofol (injection pain)', default: true } },
      { phase: 'induction', atSec: 60, kind: 'bolus', drugId: 'propofol', regimenKey: 'induction' },
      { phase: 'induction', atSec: 90, kind: 'bolus', drugId: 'rocuronium', regimenKey: 'induction' },
      { phase: 'maintenance', atSec: 0, kind: 'inhaled', drugId: 'sevoflurane', regimenKey: 'maintenance', dial: 'mac1', fallback: { drugId: 'propofol', regimenKey: 'maintenance', kind: 'infusion' } },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'sevoflurane' },
      { phase: 'emergence', atSec: 0, kind: 'bolus', drugId: 'ondansetron', regimenKey: 'emergence' },
      { phase: 'emergence', atSec: 30, kind: 'bolus', drugId: 'sugammadex', regimenKey: 'emergence' },
    ],
  },
  {
    id: 'ga_opioid_free', label: 'GA — opioid-free', mode: 'GA', sedationTarget: null, notes: ['pofa', 'lidocaineOverlap', 'propofolPain'],
    description: 'Dexmedetomidine, ketamine and IV lidocaine (Foo 2021 loading + infusion) instead of an opioid, with propofol, rocuronium, sevoflurane (propofol infusion if sevoflurane is locked), dexamethasone, ondansetron, sugammadex; lactated Ringer\'s maintenance; guideline antibiotic prophylaxis. Lidocaine pretreatment is omitted because an IV lidocaine infusion is planned.',
    steps: [
      { phase: 'premed', atSec: 0, kind: 'fluid', fluidId: LR, rate: 'default' },
      { phase: 'premed', atSec: 0, kind: 'antibiotic', drugId: 'auto' },
      { phase: 'induction', atSec: 0, kind: 'infusion', drugId: 'dexmedetomidine', regimenKey: 'maintenance' },
      { phase: 'induction', atSec: 0, kind: 'infusion', drugId: 'ketamine', regimenKey: 'maintenance' },
      { phase: 'induction', atSec: 0, kind: 'bolus', drugId: 'lidocaine', regimenKey: 'induction' },
      { phase: 'induction', atSec: 0, kind: 'bolus', drugId: 'dexamethasone', regimenKey: 'induction' },
      { phase: 'induction', atSec: 50, kind: 'bolus', drugId: 'lidocaine', regimenKey: 'pretreatment', omitIf: 'lidocaineAnalgesic', optional: { id: 'lidocainePretreatment', label: 'Lidocaine pretreatment before propofol (omitted while an IV lidocaine infusion is planned)', default: true } },
      { phase: 'induction', atSec: 60, kind: 'bolus', drugId: 'propofol', regimenKey: 'induction' },
      { phase: 'induction', atSec: 90, kind: 'bolus', drugId: 'rocuronium', regimenKey: 'induction' },
      { phase: 'maintenance', atSec: 0, kind: 'inhaled', drugId: 'sevoflurane', regimenKey: 'maintenance', dial: 'mac1', fallback: { drugId: 'propofol', regimenKey: 'maintenance', kind: 'infusion' } },
      { phase: 'maintenance', atSec: 0, kind: 'infusion', drugId: 'lidocaine', regimenKey: 'maintenance' },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'sevoflurane' },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'dexmedetomidine' },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'ketamine' },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'lidocaine' },
      { phase: 'emergence', atSec: 0, kind: 'bolus', drugId: 'ondansetron', regimenKey: 'emergence' },
      { phase: 'emergence', atSec: 30, kind: 'bolus', drugId: 'sugammadex', regimenKey: 'emergence' },
    ],
  },
  {
    id: 'mac_dex', label: 'MAC — dexmedetomidine', mode: 'MAC', sedationTarget: 'moderate', notes: ['dexMac', 'dexInterlock'],
    description: 'Dexmedetomidine procedural sedation (label loading dose + titrated infusion) toward the chosen ASA-continuum target, with optional midazolam or propofol supplementation; lactated Ringer\'s maintenance.',
    steps: [
      { phase: 'sedation', atSec: 0, kind: 'fluid', fluidId: LR, rate: 'default' },
      { phase: 'sedation', atSec: 0, kind: 'infusion', drugId: 'dexmedetomidine', regimenKey: 'sedation' },
      { phase: 'sedation', atSec: 0, kind: 'bolus', drugId: 'midazolam', regimenKey: 'sedation', optional: { id: 'midazolam', label: 'Midazolam supplementation (no deep-sedation regimen in the label)', default: false } },
      { phase: 'sedation', atSec: 600, kind: 'infusion', drugId: 'propofol', regimenKey: 'sedation', optional: { id: 'propofol', label: 'Propofol supplementation after the loading dose (no minimal-sedation regimen in the label)', default: false } },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'dexmedetomidine' },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'propofol' },
    ],
  },
  {
    id: 'mac_propofol', label: 'MAC — propofol (existing technique)', mode: 'MAC', sedationTarget: 'moderate', notes: [],
    description: 'Midazolam (optional) then a propofol MAC-sedation infusion (label slow loading + infusion), as in the MAC example plan.',
    steps: [
      { phase: 'sedation', atSec: 0, kind: 'bolus', drugId: 'midazolam', regimenKey: 'sedation', optional: { id: 'midazolam', label: 'Midazolam (no deep-sedation regimen in the label)', default: true } },
      { phase: 'sedation', atSec: 120, kind: 'infusion', drugId: 'propofol', regimenKey: 'sedation' },
      { phase: 'emergence', atSec: 0, kind: 'stop', drugId: 'propofol' },
    ],
  },
];
