// Drug-library access. The real library is simulator/data/drugs.js (SPEC §4).
// Every engine entry point accepts an injected `library` (same shape:
// { SOURCES, CONDITIONS, ALLERGIES, MEDICATIONS, DRUGS }) so tests can run
// against a fixture. When none is injected the default library is loaded
// with a guarded dynamic import, so the engine still loads if data/drugs.js
// is missing (the error is reported when a library is actually needed).

let DEFAULT_LIBRARY = null;
let DEFAULT_ERROR = null;
try {
  DEFAULT_LIBRARY = await import('../data/drugs.js');
} catch (err) {
  DEFAULT_ERROR = err;
}

export function getDefaultLibrary() {
  if (!DEFAULT_LIBRARY) {
    throw new Error('Drug library simulator/data/drugs.js could not be loaded' + (DEFAULT_ERROR ? `: ${DEFAULT_ERROR.message}` : ''));
  }
  return DEFAULT_LIBRARY;
}

export function hasDefaultLibrary() { return !!DEFAULT_LIBRARY; }

export function resolveLibrary(library) { return library || getDefaultLibrary(); }

const INDEX = new WeakMap();
function index(lib) {
  let ix = INDEX.get(lib);
  if (!ix) {
    ix = { drugs: new Map((lib.DRUGS || []).map((d) => [d.id, d])) };
    INDEX.set(lib, ix);
  }
  return ix;
}

export function getDrug(library, drugId) {
  return index(resolveLibrary(library)).drugs.get(drugId) || null;
}

export function listDrugs(library) { return resolveLibrary(library).DRUGS || []; }

/** Find a source id whose citation contains `needle` (case-insensitive); null if none. */
export function findSourceId(library, needle) {
  const src = resolveLibrary(library).SOURCES || {};
  const n = needle.toLowerCase();
  for (const [id, s] of Object.entries(src)) {
    if (String(s && s.citation || '').toLowerCase().includes(n)) return id;
  }
  return null;
}
