// Entry point so that `node --test simulator/tests` works on Node ≥ 22, where a bare
// directory argument is resolved as a module (index.js) rather than searched for tests.
// It loads every *.test.mjs file in this folder into the same node:test run.
// (`node --test simulator/tests/*.test.mjs` runs the same files without this shim.)
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(here).filter((n) => n.endsWith('.test.mjs')).sort()) {
  await import(pathToFileURL(join(here, f)).href);
}
