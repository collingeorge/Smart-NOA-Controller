// Run from Node 20+: node simulator/tools/verify-live.mjs <full Smart NOA commit SHA>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const revision = process.argv[2];
assert.match(revision ?? '', /^[a-f0-9]{40}$/, 'Supply the full expected Smart NOA commit SHA.');
const origin = 'https://collinbgeorge.com';

async function get(path) {
  const response = await fetch(new URL(path, origin), {
    redirect: 'error',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok(response.ok, `${path} returned HTTP ${response.status}`);
  return response;
}

const pins = await (await get('/source-pins.json')).json();
assert.equal(pins.find((item) => item.name === 'Smart-NOA-Controller')?.sha, revision, 'Public Smart NOA revision');

for (const path of ['/simulator/', '/about']) {
  const { headers } = await get(path);
  const csp = headers.get('content-security-policy') ?? '';
  for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) {
    assert.ok(csp.split(';').some((entry) => entry.trim() === directive), `${path}: missing CSP directive ${directive}`);
  }
  assert.match(headers.get('strict-transport-security') ?? '', /\bmax-age=[1-9]\d*/i, `${path}: missing HSTS`);
  assert.equal(headers.get('x-content-type-options'), 'nosniff', `${path}: MIME sniffing protection`);
}

// Compare the sensitive runtime files from the canonical URLs used by the browser.
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const path of ['engine/sim.js', 'ui/plan-model.js', 'ui/app.js', 'ui/monitor.js', 'ui/debrief.js']) {
  const local = await readFile(new URL(`../${path}`, import.meta.url));
  const published = Buffer.from(await (await get(`/simulator/${path}`)).arrayBuffer());
  assert.equal(hash(published), hash(local), `Public /simulator/${path} differs from this checkout`);
}

console.log(`Verified public Smart NOA ${revision}, runtime files, and security headers.`);
