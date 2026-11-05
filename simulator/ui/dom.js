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
