// Sources panel (built from SOURCES in data/drugs.js) and inline source tags.
import { h, clear } from './dom.js';

let LIB = null;

export function initSources(lib) {
  LIB = lib;
  const body = document.getElementById('sources-body');
  clear(body);
  const filter = h('input', { type: 'search', id: 'sources-filter', class: 'input', placeholder: 'Filter by id, author, drug…', autocomplete: 'off' });
  const list = h('div', { class: 'sources-list', id: 'sources-list' });
  body.append(
    h('p', { class: 'muted' }, 'Every dose, range, ceiling, threshold and score cut-off in the simulator traces to one of these entries. ',
      '“Verified via” records exactly how each was confirmed. Full registry, including drugs that were left out and why, and the illustrative model assumptions: ',
      h('a', { href: 'SOURCES.md' }, 'SOURCES.md'), '.'),
    h('label', { for: 'sources-filter', class: 'label' }, 'Filter sources'), filter, list,
  );
  const ids = Object.keys(lib.SOURCES).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  for (const id of ids) {
    const s = lib.SOURCES[id];
    const url = typeof s.url === 'string' && /^https:\/\//.test(s.url) ? h('a', { href: s.url, rel: 'noopener noreferrer', target: '_blank' }, s.url) : (s.url ? h('code', {}, s.url) : null);
    list.append(h('article', { class: 'source', id: `src-${id}`, tabindex: '-1', dataset: { text: `${id} ${s.citation} ${s.supports}`.toLowerCase() } },
      h('h3', {}, h('span', { class: 'source__id' }, `[${id}]`), ' ', s.type ? h('span', { class: 'source__type' }, s.type) : null),
      h('p', { class: 'source__citation' }, s.citation),
      h('dl', { class: 'source__meta' },
        h('dt', {}, 'Supports'), h('dd', {}, s.supports || '—'),
        h('dt', {}, 'Identifiers'), h('dd', {}, s.identifiers || 'none'),
        url ? [h('dt', {}, 'Link'), h('dd', {}, url)] : null,
        h('dt', {}, 'Verified via'), h('dd', {}, s.verifiedVia || '—')),
    ));
  }
  const notes = lib.LIBRARY_NOTES || {};
  if (Object.keys(notes).length) {
    list.append(h('article', { class: 'source source--notes' }, h('h3', {}, 'Library notes'),
      h('ul', {}, Object.values(notes).map((n) => h('li', {}, n)))));
  }
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    for (const a of list.querySelectorAll('article.source[data-text]')) a.hidden = !!q && !a.dataset.text.includes(q);
  });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-src]');
    if (t) { e.preventDefault(); openSource(t.dataset.src, t); }
  });
}

export function openSource(id, returnFocus = null) {
  const dlg = document.getElementById('sources-dialog');
  if (!dlg.open) dlg.showModal();
  const list = document.getElementById('sources-list');
  const f = document.getElementById('sources-filter');
  if (f && f.value) { f.value = ''; f.dispatchEvent(new Event('input')); }
  for (const a of list.querySelectorAll('.source--hl')) a.classList.remove('source--hl');
  const el = id ? document.getElementById(`src-${id}`) : null;
  if (el) { el.classList.add('source--hl'); el.scrollIntoView({ block: 'start' }); el.focus({ preventScroll: true }); }
  if (returnFocus) dlg.addEventListener('close', () => { if (document.contains(returnFocus)) returnFocus.focus(); }, { once: true });
}

/** Inline tags for a list of source ids. Non-source markers (e.g. 'illustrative') render as plain badges. */
export function srcTags(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return null;
  return h('span', { class: 'src-tags' }, list.map((id) => {
    const s = LIB && LIB.SOURCES[id];
    if (!s) return h('span', { class: 'badge badge--illustrative' }, String(id));
    const short = s.citation.length > 110 ? `${s.citation.slice(0, 107)}…` : s.citation;
    return h('button', { type: 'button', class: 'src-tag', dataset: { src: id }, title: short, 'aria-label': `Source ${id}: ${short}` }, `[${id}]`);
  }));
}

/** Pull "[S7]" / "[S7, S9]" / "(S35)" references out of a free-text message for tagging. */
export function sourcesInText(text) {
  const out = [];
  const re = /\bS(\d{1,2})\b/g; let m;
  while ((m = re.exec(String(text || '')))) { const id = `S${m[1]}`; if (LIB && LIB.SOURCES[id] && !out.includes(id)) out.push(id); }
  return out;
}
