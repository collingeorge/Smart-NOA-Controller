// Shared case-control actions (phase buttons, airway preparation, extubation).
// Pure; no DOM. EDUCATIONAL SIMULATION — fictional patients — not a medical device.
//
// The manual Run-screen buttons (ui/monitor.js, ui/app.js extubation dialog) and the
// automatic runner (engine/autorun.js) both call these functions, so both paths drive the
// simulation through exactly the same sim.setPhase()/sim.action() calls, with the same
// interlocks, alarms and event-log entries. Each function returns { ok, message }.

const phase = (sim, ph, message) => { const r = sim.setPhase(ph); return { ok: r.ok, message: r.ok ? message : r.message }; };
const act = (sim, id, okMessage = null) => { const r = sim.action(id); return { ok: r.ok, message: r.ok ? (okMessage || r.message) : r.message }; };

export const CASE_ACTIONS = Object.freeze({
  // ---- pre-op holding → OR (timing review): the patient leaves holding after the premedication interval
  transfer_to_or: (sim) => act(sim, 'transfer_to_or'),
  // ---- clinician-only checklist items (never called by the automatic runner on its own)
  confirm_time_out: (sim) => act(sim, 'confirm_time_out'),
  acknowledge_depth_below_band: (sim) => act(sim, 'acknowledge_depth_below_band'),
  // ---- GA phase controls
  start_induction: (sim) => phase(sim, 'induction', 'Induction started — plan induction steps run from now.'),
  secure_airway: (sim) => {
    const r = sim.action('secure_airway');
    if (!r.ok) return { ok: false, message: r.message };
    sim.action('start_ventilation');
    return { ok: true, message: `${r.message}. Mechanical ventilation started.` };
  },
  start_maintenance: (sim) => phase(sim, 'maintenance', 'Maintenance phase started.'),
  start_surgery: (sim) => act(sim, 'start_surgery'),
  end_surgery: (sim) => act(sim, 'end_surgery'),
  begin_emergence: (sim) => phase(sim, 'emergence', 'Emergence started — plan emergence steps run from now.'),
  // ---- MAC phase controls
  start_sedation: (sim) => phase(sim, 'sedation', 'Sedation started.'),
  start_procedure: (sim) => act(sim, 'start_surgery', 'Procedure started'),
  end_procedure: (sim) => act(sim, 'end_surgery', 'Procedure ended'),
  end_sedation: (sim) => phase(sim, 'emergence', 'Recovery phase started — plan stop steps run from now.'),
  // ---- airway panel actions
  set_fio2: (sim, v) => act(sim, `set_fio2:${v}`),
  mask_ventilate: (sim) => act(sim, 'mask_ventilate'),
  /** Extubate only when sim.extubationReadiness() is met at the moment of the call (guided gate / full demonstration). */
  extubate: (sim) => {
    const r = sim.extubationReadiness();
    if (!r.ready) return { ok: false, message: `Not ready: ${r.criteria.filter((c) => !c.met).map((c) => c.label).join('; ')}`, readiness: r };
    const res = sim.action('extubate');
    return { ok: res.ok, message: res.message, readiness: r };
  },
  /** The dialog's "Extubate" button (readiness was met when the dialog opened; unchanged manual path). */
  extubateFromDialog: (sim) => { const r = sim.extubationReadiness(); const res = sim.action('extubate'); return { ok: res.ok, message: res.message, readiness: r }; },
  /** The dialog's "Extubate anyway (logged)" path. The automatic runner never calls this. */
  extubateOverride: (sim) => {
    const r = sim.extubationReadiness();
    const unmet = r.criteria.filter((c) => !c.met).map((c) => c.label);
    const res = sim.action('extubate');
    sim.logNote('action', `User confirmed extubation despite unmet readiness criteria: ${unmet.join(', ')}`);
    return { ok: res.ok, message: res.message, readiness: r, unmet };
  },
});

/** Surgery/procedure state derived from the simulation (start → started; end → ended). */
export function surgeryState(sim) {
  const st = sim.stim || {};
  return { started: st.surgeryStartAt !== null && st.surgeryStartAt !== undefined, ended: st.surgeryEndAt !== null && st.surgeryEndAt !== undefined };
}
