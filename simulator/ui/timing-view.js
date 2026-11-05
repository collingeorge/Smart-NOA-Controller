// Timing views shared by the plan editor, the Run screen (guided/automatic panel) and the debrief.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device.
import { h } from './dom.js';
import { srcTags } from './sources.js';
import { PROVENANCE_TEXT } from '../engine/timing.js';

/** Timing-check list items: status mark + text + sources or provenance (colour is never the only signal). */
export function timingCheckItems(checks) {
  const mark = { pass: '✓', warn: '⚠', info: 'ℹ' }; const word = { pass: 'Pass', warn: 'Warning', info: 'Info' };
  return checks.map((c) => h('li', { class: `tcheck tcheck--${c.status}`, dataset: { check: c.id, status: c.status } },
    h('span', { class: 'tcheck__mark', 'aria-hidden': 'true' }, mark[c.status] || '•'), h('span', { class: 'sr-only' }, `${word[c.status] || c.status}: `),
    h('strong', {}, c.label), ` — ${c.message} `, c.sources && c.sources.length ? srcTags(c.sources) : null,
    h('span', { class: 'tcheck__prov' }, ` (${PROVENANCE_TEXT[c.provenance] || c.provenance})`)));
}

/** "Why this time" line for a plan step's timingRationale ({ text, provenance, sources }). */
export function rationaleLine(r, { id = null } = {}) {
  if (!r) return null;
  return h('p', { class: 'hint timing-why', ...(id ? { id } : {}), dataset: { provenance: r.provenance } },
    h('strong', {}, 'Why this time: '), r.text, ' ', r.sources && r.sources.length ? srcTags(r.sources) : null, h('span', { class: 'badge badge--illustrative' }, r.provenance));
}

/** Plain-text form for tooltips (title attributes). */
export function rationaleText(r) { return r ? `Why this time: ${r.text} (${r.provenance}${r.sources && r.sources.length ? `; ${r.sources.join(', ')}` : ''})` : ''; }
