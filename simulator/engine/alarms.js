// Alarm evaluation with latching (SPEC §5.2). Pure; no DOM.
// Priorities follow IEC 60601-1-8 naming (high/medium/low); the UI pairs colour with text.
// Latching: an alarm stays listed after its condition clears until it is acknowledged;
// acknowledging an active alarm silences it (acknowledged:true) and it is removed once
// the condition clears. "Pulse" alarms (events such as a blocked dose) are active for
// the step in which they are raised, then remain latched until acknowledged.

export const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

export class AlarmManager {
  constructor(log = null) {
    this.map = new Map();
    this.history = [];
    this.pulses = new Set();
    this.log = log;
  }
  _activate(tSec, id, priority, message) {
    let a = this.map.get(id);
    if (!a) {
      a = { id, priority, message, active: true, acknowledged: false, sinceSec: tSec };
      this.map.set(id, a);
      this.history.push({ id, priority, message, sinceSec: tSec, clearedSec: null });
      if (this.log) this.log(tSec, 'alarm', `${priority.toUpperCase()} alarm: ${message}`);
    } else {
      if (!a.active) {
        a.active = true;
        this.history.push({ id, priority, message, sinceSec: tSec, clearedSec: null });
        if (this.log) this.log(tSec, 'alarm', `${priority.toUpperCase()} alarm (re-activated): ${message}`);
      }
      a.priority = priority; a.message = message;
    }
  }
  _clear(tSec, id) {
    const a = this.map.get(id);
    if (!a || !a.active) return;
    a.active = false;
    for (let i = this.history.length - 1; i >= 0; i--) if (this.history[i].id === id && this.history[i].clearedSec === null) { this.history[i].clearedSec = tSec; break; }
    if (a.acknowledged) this.map.delete(id);
  }
  /** conditions: [{ id, priority, message, active }] — level-type alarms evaluated each step. */
  update(tSec, conditions) {
    const seen = new Set();
    for (const c of conditions) {
      seen.add(c.id);
      if (c.active) this._activate(tSec, c.id, c.priority, c.message); else this._clear(tSec, c.id);
    }
    for (const [id, a] of this.map) {
      if (a.active && !seen.has(id) && !this.pulses.has(id)) this._clear(tSec, id);
    }
    this.pulses.clear();
  }
  /** Raise an event-type alarm (active for the current step only, then latched). */
  pulse(tSec, id, priority, message) {
    this._activate(tSec, id, priority, message);
    this.pulses.add(id);
  }
  acknowledge(id) {
    const a = this.map.get(id);
    if (!a) return false;
    a.acknowledged = true;
    if (!a.active) this.map.delete(id);
    return true;
  }
  list() {
    return [...this.map.values()].sort((x, y) => PRIORITY_RANK[y.priority] - PRIORITY_RANK[x.priority] || x.sinceSec - y.sinceSec).map((a) => ({ ...a }));
  }
}
