// "Advisory: haemodynamic rescue" card (engine/rescue.js). EDUCATIONAL SIMULATION — not a medical device.
// The card only shows the advisory; "Give suggested bolus" is the clinician's explicit approval
// (advisor.accept) and "Dismiss" is logged (advisor.dismiss). Nothing here runs on its own.
import { h, clear, setText, fmtClock } from './dom.js';
import { srcTags } from './sources.js';
import { ADVISORY_DISCLAIMER } from '../engine/rescue.js';
import { DEPTH_LOW_DISCLAIMER } from '../engine/depth-advisory.js';

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
  // Cross-reference when the depth-low card is shown at the same time (set by update(v, crossNote)).
  const cross = h('p', { class: 'advisory__cross', id: `${prefix}-cross`, hidden: true });
  const rationale = h('ul', { class: 'list list--tight advisory__rationale', id: `${prefix}-rationale` });
  const checklist = h('ul', { class: 'list list--tight advisory__checklist', id: `${prefix}-checklist` });
  const accept = h('button', { type: 'button', class: 'btn btn--hmi btn--primary', id: `${prefix}-accept` }, 'Give suggested bolus');
  const dismiss = h('button', { type: 'button', class: 'btn btn--hmi', id: `${prefix}-dismiss` }, 'Dismiss');
  accept.addEventListener('click', () => { if (accept.dataset.entry) onAccept(accept.dataset.entry); });
  dismiss.addEventListener('click', () => { if (dismiss.dataset.entry) onDismiss(dismiss.dataset.entry); });
  const el = h('section', { class: 'hmi-panel advisory', id: prefix, role: 'region', 'aria-labelledby': `${prefix}-h`, 'data-auto-safe': 'advisory', hidden: true },
    title, disclaimer, headline, countdown, suggestion, cross,
    h('div', { class: 'btn-row' }, accept, dismiss),
    h('details', { class: 'hmi-details', open: true }, h('summary', {}, 'Why, and what else to check (no doses)'), rationale, checklist));

  function update(v, crossNote = '') {
    el.hidden = !v || !v.visible;
    if (el.hidden) return;
    el.dataset.kind = v.kind;
    setText(cross, crossNote || ''); cross.hidden = !crossNote;
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

/**
 * "Advisory: depth index below the GA band" card (engine/depth-advisory.js). TEXT ONLY: no drug, dose or
 * rate; not an alarm. The only control is "Dismiss" (logged, advisor.dismiss). Nothing here runs on its own.
 * Returns { el, update(view, crossNote) }.
 */
export function depthAdvisoryCard({ prefix, live, onDismiss }) {
  const title = h('h3', { id: `${prefix}-h` }, 'Advisory: depth index below the GA band');
  const disclaimer = h('p', { class: 'advisory__disclaimer', id: `${prefix}-disclaimer` }, `${DEPTH_LOW_DISCLAIMER} Text only — no drug, dose or rate is suggested.`);
  const headline = h('p', { class: 'advisory__headline', id: `${prefix}-headline`, role: live ? 'status' : null, 'aria-live': live ? 'polite' : 'off' });
  const current = h('p', { class: 'advisory__countdown', id: `${prefix}-current`, 'aria-live': 'off' });
  const cross = h('p', { class: 'advisory__cross', id: `${prefix}-cross`, hidden: true });
  const checklist = h('ul', { class: 'list list--tight advisory__checklist', id: `${prefix}-checklist` });
  const foot = h('p', { class: 'hint hint--hmi advisory__foot', id: `${prefix}-foot` });
  const dismiss = h('button', { type: 'button', class: 'btn btn--hmi', id: `${prefix}-dismiss` }, 'Dismiss');
  dismiss.addEventListener('click', () => { if (dismiss.dataset.entry) onDismiss(dismiss.dataset.entry); });
  const el = h('section', { class: 'hmi-panel advisory advisory--depth', id: prefix, role: 'region', 'aria-labelledby': `${prefix}-h`, 'data-auto-safe': 'advisory', 'data-kind': 'depth_low', hidden: true },
    title, disclaimer, headline, current, cross,
    h('details', { class: 'hmi-details', open: true }, h('summary', {}, 'What to check (no doses)'), checklist),
    foot, h('div', { class: 'btn-row' }, dismiss));
  let fsig = '';
  function update(v, crossNote = '') {
    el.hidden = !v || !v.visible;
    if (el.hidden) return;
    setText(headline, v.headline);
    setText(current, v.current || '');
    setText(cross, crossNote || ''); cross.hidden = !crossNote;
    const sig = `${v.footnote}|${(v.checklist || []).join('|')}`;
    if (sig !== fsig) {
      fsig = sig;
      clear(checklist).append(...(v.checklist || []).map((x) => h('li', {}, '☐ ', x)));
      clear(foot).append(`${v.footnote} `, srcTags(v.sources || []), '.');
    }
    dismiss.hidden = !v.canDismiss; dismiss.disabled = !v.canDismiss;
    if (v.entry) dismiss.dataset.entry = v.entry.id; else delete dismiss.dataset.entry;
  }
  return { el, update };
}
