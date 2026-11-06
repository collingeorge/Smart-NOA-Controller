// Published files must not contain build-machine paths (live-site audit, November 2026): every tracked (and new, not ignored) text
// file in the repository is scanned for absolute home / temp / root directory paths. Repo-relative references
// (e.g. `Smart-NOA-Controller/config.yaml`) are used instead. No allow-list is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// Built from pieces so this file does not match itself.
const PATTERN = new RegExp(['/' + 'home/', '/' + 'tmp/claude', '/' + 'root/'].map((x) => x.replace(/[/]/g, '\\/')).join('|'));
const ALLOW = []; // genuinely needed strings would be listed here (none)

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  } catch {
    // No git (e.g. an exported copy): walk the tree, skipping dependency, VCS and tool folders.
    const out = [];
    const walk = (d) => { for (const n of readdirSync(d)) { if (['node_modules', '.git', '.claude', '__pycache__'].includes(n)) continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out.push(relative(ROOT, p)); } };
    walk(ROOT); return out;
  }
}

test('no tracked text file contains a build-machine path (home, temp or root directory)', () => {
  const hits = [];
  const files = trackedFiles();
  assert.ok(files.length > 50, `found ${files.length} files`);
  for (const f of files) {
    let buf; try { buf = readFileSync(join(ROOT, f)); } catch { continue; }
    if (buf.subarray(0, 8192).includes(0)) continue; // binary (PDF, images)
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((l, i) => { if (PATTERN.test(l) && !ALLOW.some((a) => l.includes(a))) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});
