// Small DOM helpers for the simulator UI (no framework). Event handlers are attached
// with addEventListener only (CSP: script-src 'self'; no inline handlers).

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && (tag === 'input' || tag === 'select' || tag === 'textarea')) { el.value = String(v); el.setAttribute('value', String(v)); }
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function setText(el, text) { const s = String(text); if (el.textContent !== s) el.textContent = s; }

const KEYED = new WeakMap();
/**
 * Keyed list reconciliation (audit 05l, finding 2). Keeps ONE persistent element per key in `container`:
 * `create(item)` builds it once ({ el, ...parts }), `update(parts, item)` changes text/attributes in place on
 * every call. Elements are added/removed only when the set of keys changes and moved only when the order
 * changes, so buttons and inputs inside an item survive re-renders (a click straddling a render is not lost)
 * and focus is kept. `empty()` (optional) builds the placeholder shown when there are no items.
 * The container must not be cleared by other code.
 */
export function reconcileKeyed(container, items, { key, create, update, empty = null }) {
  let st = KEYED.get(container);
  if (!st) { st = { map: new Map(), empty: null }; KEYED.set(container, st); }
  const focused = document.activeElement && container.contains(document.activeElement) ? document.activeElement : null;
  const keys = new Set(items.map(key));
  for (const [k, it] of st.map) if (!keys.has(k)) { it.el.remove(); st.map.delete(k); }
  const want = items.map((x) => {
    const k = key(x); let it = st.map.get(k);
    if (!it) { it = create(x); st.map.set(k, it); }
    update(it, x);
    return it.el;
  });
  if (!items.length && empty) { if (!st.empty) st.empty = empty(); if (!st.empty.isConnected) container.append(st.empty); }
  else if (st.empty) st.empty.remove();
  const have = [...container.children].filter((el) => el !== st.empty);
  if (want.length !== have.length || want.some((el, i) => el !== have[i])) for (const el of want) container.append(el);
  if (focused && focused.isConnected && document.activeElement !== focused && !focused.disabled) focused.focus();
}

/** Replaces `holder`'s children with build() only when `sig` changed (e.g. a source-tag group). */
export function setChildrenIf(holder, sig, build) {
  if (holder.dataset.sig === sig) return;
  holder.dataset.sig = sig; clear(holder);
  for (const c of [build()].flat(Infinity)) if (c !== null && c !== undefined && c !== false) holder.append(c instanceof Node ? c : document.createTextNode(String(c)));
}

let uid = 0;
export function nextId(prefix = 'id') { uid += 1; return `${prefix}-${uid}`; }

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Seconds -> "mm:ss" (or "h:mm:ss" when ≥ 1 h). */
export function fmtClock(sec) {
  if (!isNum(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

/** "h:mm:ss" (as fmtClock prints times ≥ 1 h), "mm:ss", "m:ss" or plain seconds -> seconds, or null if invalid. */
export function parseClock(text) {
  const t = String(text || '').trim();
  if (!t) return 0;
  let m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(t);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,5})$/.exec(t);
  if (m) return Number(m[1]);
  return null;
}

/** Display-friendly number (≤ 4 significant figures, trimmed). */
export function fmtNum(v, maxDp = 2) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  const dp = a >= 100 ? 0 : a >= 10 ? Math.min(1, maxDp) : maxDp;
  return String(Number(v.toFixed(dp)));
}

export function announce(text, assertive = false) {
  const el = document.getElementById(assertive ? 'live-assertive' : 'live-polite');
  if (!el) return;
  el.textContent = '';
  // Re-set on the next frame so repeated identical messages are still announced.
  requestAnimationFrame(() => { el.textContent = text; });
}

export function pluralize(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
