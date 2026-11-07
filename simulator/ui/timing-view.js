// Timing views shared by the plan editor, the Run screen (guided/automatic panel) and the debrief.
// EDUCATIONAL SIMULATION — fictional patients — not a medical device.
import { h, setText, setChildrenIf } from './dom.js';
import { srcTags } from './sources.js';
import { PROVENANCE_TEXT } from '../engine/timing.js';

/** Timing-check list items: status mark + text + sources or provenance (colour is never the only signal). */
const TC_MARK = { pass: '✓', warn: '⚠', info: 'ℹ' }; const TC_WORD = { pass: 'Pass', warn: 'Warning', info: 'Info' };
/** One timing-check row, built once ({ el, ...parts }); updateTimingCheckItem() changes it in place (keyed lists, audit 05l). */
export function timingCheckItem() {
  const mark = h('span', { class: 'tcheck__mark', 'aria-hidden': 'true' }); const sr = h('span', { class: 'sr-only' });
  const label = h('strong', {}); const msg = h('span', {}); const src = h('span', {}); const prov = h('span', { class: 'tcheck__prov' });
  return { el: h('li', {}, mark, sr, label, msg, src, prov), mark, sr, label, msg, src, prov };
}
export function updateTimingCheckItem(it, c) {
  const cls = `tcheck tcheck--${c.status}`; if (it.el.className !== cls) it.el.className = cls;
  it.el.dataset.check = c.id; it.el.dataset.status = c.status;
  setText(it.mark, TC_MARK[c.status] || '•'); setText(it.sr, `${TC_WORD[c.status] || c.status}: `);
  setText(it.label, c.label); setText(it.msg, ` — ${c.message} `);
  setChildrenIf(it.src, (c.sources || []).join(','), () => (c.sources && c.sources.length ? srcTags(c.sources) : null));
  setText(it.prov, ` (${PROVENANCE_TEXT[c.provenance] || c.provenance})`);
}
/** Static list (plan editor, debrief): same rows, built fresh. */
export function timingCheckItems(checks) {
  return checks.map((c) => { const it = timingCheckItem(); updateTimingCheckItem(it, c); return it.el; });
}

/** "Why this time" line for a plan step's timingRationale ({ text, provenance, sources }). */
export function rationaleLine(r, { id = null } = {}) {
  if (!r) return null;
  return h('p', { class: 'hint timing-why', ...(id ? { id } : {}), dataset: { provenance: r.provenance } },
    h('strong', {}, 'Why this time: '), r.text, ' ', r.sources && r.sources.length ? srcTags(r.sources) : null, h('span', { class: 'badge badge--illustrative' }, r.provenance));
}

/** Plain-text form for tooltips (title attributes). */
export function rationaleText(r) { return r ? `Why this time: ${r.text} (${r.provenance}${r.sources && r.sources.length ? `; ${r.sources.join(', ')}` : ''})` : ''; }
