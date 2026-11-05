// "Advisory: haemodynamic rescue" card (engine/rescue.js). EDUCATIONAL SIMULATION — not a medical device.
// The card only shows the advisory; "Give suggested bolus" is the clinician's explicit approval
// (advisor.accept) and "Dismiss" is logged (advisor.dismiss). Nothing here runs on its own.
import { h, clear, setText, fmtClock } from './dom.js';
import { srcTags } from './sources.js';
import { ADVISORY_DISCLAIMER } from '../engine/rescue.js';

/**
 * Builds one card. `prefix` makes the ids unique (two copies: Run screen and guided panel).
 * `live`: whether this copy announces changes (aria-live polite); only one copy should.
 * Returns { el, update(view) }.
 */
export function advisoryCard({ prefix, live, onAccept, onDismiss }) {
  const title = h('h3', { id: `${prefix}-h` }, 'Advisory: haemodynamic rescue');
  const disclaimer = h('p', { class: 'advisory__disclaimer', id: `${prefix}-disclaimer` }, ADVISORY_DISCLAIMER);
  const headline = h('p', { class: 'advisory__headline', id: `${prefix}-headline`, role: live ? 'status' : null, 'aria-live': live ? 'polite' : 'off' });
  const countdown = h('p', { class: 'advisory__countdown', id: `${prefix}-countdown`, 'aria-live': 'off' });
  const suggestion = h('div', { class: 'advisory__suggestion', id: `${prefix}-suggestion` });
  const rationale = h('ul', { class: 'list list--tight advisory__rationale', id: `${prefix}-rationale` });
  const checklist = h('ul', { class: 'list list--tight advisory__checklist', id: `${prefix}-checklist` });
  const accept = h('button', { type: 'button', class: 'btn btn--hmi btn--primary', id: `${prefix}-accept` }, 'Give suggested bolus');
  const dismiss = h('button', { type: 'button', class: 'btn btn--hmi', id: `${prefix}-dismiss` }, 'Dismiss');
  accept.addEventListener('click', () => { if (accept.dataset.entry) onAccept(accept.dataset.entry); });
  dismiss.addEventListener('click', () => { if (dismiss.dataset.entry) onDismiss(dismiss.dataset.entry); });
  const el = h('section', { class: 'hmi-panel advisory', id: prefix, role: 'region', 'aria-labelledby': `${prefix}-h`, 'data-auto-safe': 'advisory', hidden: true },
    title, disclaimer, headline, countdown, suggestion,
    h('div', { class: 'btn-row' }, accept, dismiss),
    h('details', { class: 'hmi-details', open: true }, h('summary', {}, 'Why, and what else to check (no doses)'), rationale, checklist));

  function update(v) {
    el.hidden = !v || !v.visible;
    if (el.hidden) return;
    el.dataset.kind = v.kind;
    const head = v.dismissed ? `${v.headline || 'Advisory'} Dismissed at ${fmtClock(v.dismissedAtSec)} — it returns if MAP recovers and falls again.`
      : v.kind === 'hypotension_recovering' ? 'MAP recovering (at or above the trigger) — no dose suggested now; reassess.'
        : v.suppressed && v.suppressed.reason !== 'interval' ? `${v.headline} ${v.suppressed.message}`
          : v.suppressed ? `${v.headline} Reassess before another dose.` : v.headline;
    setText(headline, head);
    setText(countdown, v.suppressed && v.suppressed.reason === 'interval' && !v.dismissed ? v.suppressed.message : '');
    countdown.hidden = !countdown.textContent;
    const s = v.suggestion && !v.dismissed ? v.suggestion : null;
    const sig = s ? `${v.entry && v.entry.id}|${s.drugId}|${s.amount}` : '';
    if (suggestion.dataset.sig !== sig) {
      suggestion.dataset.sig = sig;
      clear(suggestion).append(...(s ? [h('p', {}, h('strong', {}, `Suggested: ${s.name} ${s.amount} ${s.unit} IV bolus `), srcTags(s.sources),
        ` (label rescue range ${s.range.min}–${s.range.max} ${s.unit}${s.capped ? `; ${s.capped}` : ''}).`)] : []));
    }
    accept.hidden = !v.canAccept; dismiss.hidden = !v.canDismiss;
    accept.disabled = !v.canAccept; dismiss.disabled = !v.canDismiss;
    if (v.entry) { accept.dataset.entry = v.entry.id; dismiss.dataset.entry = v.entry.id; } else { delete accept.dataset.entry; delete dismiss.dataset.entry; }
    const rsig = (v.rationale || []).join('|') + (v.checklist || []).join('|');
    if (rationale.dataset.sig !== rsig) {
      rationale.dataset.sig = rsig;
      clear(rationale).append(...(v.rationale || []).map((x) => h('li', {}, x)));
      clear(checklist).append(...(v.checklist || []).map((x) => h('li', {}, '☐ ', x)));
    }
  }
  return { el, update };
}
