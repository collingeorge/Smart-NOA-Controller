// Browser smoke test for the simulator UI (Playwright + Chromium).
// Not part of `npm test` (only *.test.mjs files are loaded there). Run it with `npm run test:ui`.
// It starts its own static file server (Node http, no dependencies) on a free port, serving the
// repository root, and opens /simulator/index.html?test=1 (the ?test=1 flag enables the
// read-only window.__smartNoa.snapshot() hook).
// Playwright is required: if it cannot be loaded the test FAILS, unless SMOKE_SKIP=1 is set.
// Env:  SIM_URL (use an already running server instead), SHOTS_DIR (optional screenshot folder),
//       SMOKE_SKIP=1 (skip when Playwright is unavailable), PLAYWRIGHT_BROWSERS_PATH / NODE_PATH as needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, readFile } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.env.SHOTS_DIR || null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let chromium = null;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { try { chromium = (await import('playwright')).chromium; } catch { chromium = null; } }
const skip = !chromium && process.env.SMOKE_SKIP === '1' ? 'playwright not installed (SMOKE_SKIP=1)' : false;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
/** Minimal static server for the repository root (GET/HEAD only; no directory listing; no path traversal). */
function startServer() {
  const server = createServer((req, res) => {
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(403).end(); return; }
    readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
  return new Promise((resolve) => { server.listen(0, '127.0.0.1', () => resolve(server)); });
}
let URL_ = process.env.SIM_URL || null;
let server = null;

const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name), fullPage: full }); };
const snap = (page) => page.evaluate(() => window.__smartNoa.snapshot());
const simState = async (page) => (await snap(page)).sim;
async function waitSim(page, pred, { timeout = 60000, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const s = await simState(page);
    if (s && pred(s)) return s;
    if (Date.now() - t0 > timeout) throw new Error(`Timed out waiting for ${label}; last state ${JSON.stringify(s)}`);
    await page.waitForTimeout(150);
  }
}
async function noHScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}
async function loadCase(page, id) {
  await page.click('#stepper-1');
  await page.waitForSelector('#pf-example');
  await page.selectOption('#pf-example', id);
  await page.click('#pf-load-example');
  await page.waitForSelector('#pf-continue');
}
async function toRun(page) {
  await page.click('#pf-continue'); await page.waitForSelector('#as-continue');
  await page.click('#as-continue'); await page.waitForSelector('#pl-continue');
  await page.click('#pl-continue'); await page.waitForSelector('#mon-play');
}


// ---- guided / automatic modes
const autoStatus = async (page) => { const x = await snap(page); return x.auto ? { ...x.auto, t: x.sim.t, phase: x.sim.phase, v: x.sim.v, ready: x.sim.ready } : null; };
const simLog = async (page) => (await snap(page)).sim.log;
/** Acts as the user when the runner pauses: acknowledge HIGH alarms, release a latched hold, press Resume. */
async function userResolvesPause(page) {
  for (const b of await page.locator('#mon-alarms button[data-ack]:not([disabled])').all()) await b.click();
  if (await page.isEnabled('#mon-resume')) await page.click('#mon-resume');
  if (await page.isEnabled('#auto-resume')) await page.click('#auto-resume');
}
async function waitAuto(page, pred, { timeout = 240000, label = 'auto condition', resolvePauses = true } = {}) {
  const t0 = Date.now();
  for (;;) {
    const s = await autoStatus(page);
    if (s && pred(s)) return s;
    if (s && ['stopped', 'manual'].includes(s.state)) throw new Error(`${label}: runner ${s.state} — ${s.message}`);
    if (s && s.state === 'paused' && resolvePauses) await userResolvesPause(page);
    if (Date.now() - t0 > timeout) throw new Error(`Timed out waiting for ${label}; last ${JSON.stringify(s && { state: s.state, cur: s.current, t: s.t, msg: s.message })}`);
    await page.waitForTimeout(150);
  }
}
/** Waits until the gate button on the page shows `label` and is enabled (resolving pauses as a user), then clicks it. */
async function gate(page, label, { timeout = 240000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const dom = await page.evaluate(() => { const b = document.getElementById('auto-gate'); return b ? { text: b.textContent.trim(), on: !b.disabled && !b.hidden } : null; });
    if (dom && dom.text === label && dom.on) {
      const s = await autoStatus(page);
      await page.click('#auto-gate');
      return s;
    }
    const s = await autoStatus(page);
    if (s && ['stopped', 'manual', 'completed'].includes(s.state)) throw new Error(`gate ${label}: runner ${s.state} — ${s.message}`);
    if (s && s.state === 'paused') await userResolvesPause(page);
    if (Date.now() - t0 > timeout) throw new Error(`Timed out waiting for gate ${label}; DOM ${JSON.stringify(dom)}`);
    await page.waitForTimeout(100);
  }
}
const GUIDED_BANNER = 'Guided mode: each phase runs from your approved plan; you confirm every transition. Educational simulation — not a closed-loop controller or a clinical recommendation.';
const FULL_BANNER = 'Automatic demonstration: scripted sequence, not a closed-loop controller or a clinical recommendation';

test('simulator UI smoke', { skip, timeout: 900000 }, async (t) => {
  assert.ok(chromium, 'Playwright (chromium) could not be loaded: install it (npm i -D playwright; npx playwright install chromium) or set SMOKE_SKIP=1 to skip explicitly');
  if (!URL_) { server = await startServer(); URL_ = `http://127.0.0.1:${server.address().port}/simulator/index.html?test=1`; }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on('request', (r) => { if (!r.url().startsWith(new URL(URL_).origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) problems.push(`external request: ${r.url()}`); });

  try {
    await page.goto(URL_);
    await page.waitForSelector('#pf-continue');
    assert.match(await page.textContent('.sim-banner'), /SIMULATION — fictional patient — educational use only\. Not a medical device\. Not medical advice\./);

    await t.test('validation shows inline messages', async () => {
      await page.fill('#pf-ageYears', '12');
      await page.click('#pf-continue');
      await page.waitForSelector('#pf-error-summary:not([hidden])');
      assert.match(await page.textContent('#pf-ageYears-err'), /between 18 and 90/);
      assert.equal(await page.getAttribute('#pf-ageYears', 'aria-invalid'), 'true');
      await page.fill('#pf-ageYears', '34');
    });

    await t.test('each example case loads and all five steps render', async () => {
      for (const id of ['healthy_adult', 'elderly_cad_ckd', 'obese_osa', 'mh_susceptible']) {
        await loadCase(page, id);
        await toRun(page);
        await page.click('[data-step="60"]');
        await page.click('#mon-debrief'); await page.waitForSelector('#db-download');
        assert.ok(await page.isVisible('#db-totals') || (await page.textContent('main')).includes('No drugs given'), `${id}: debrief`);
      }
      // MH-susceptible: volatile agents and succinylcholine are locked
      await loadCase(page, 'mh_susceptible'); await page.click('#pf-continue'); await page.waitForSelector('#as-continue');
      const as = await page.textContent('main');
      assert.match(as, /Sevoflurane[\s\S]*LOCKED/); assert.match(as, /Succinylcholine/);
    });

    await t.test('GA case: induction → airway → maintenance → emergence → sugammadex → extubation at 60×', async () => {
      await loadCase(page, 'healthy_adult');
      await shot(page, '1-patient.png');
      await page.click('#pf-continue'); await page.waitForSelector('#as-continue'); await shot(page, '2-assessment.png');
      await page.click('#as-continue'); await page.waitForSelector('#pl-continue');
      assert.ok((await page.locator('.src-tag').count()) > 5, 'source tags on plan');
      await shot(page, '3-plan.png');
      await page.click('#pl-continue'); await page.waitForSelector('#mon-play');
      await page.click('[data-speed="60"]');
      await page.click('#ph-induction');
      await page.click('#aw-mask');
      await page.click('#mon-play');
      await waitSim(page, (s) => s.v.tofCount === 0 && s.v.depthIndex < 60, { label: 'paralysis + depth' });
      await shot(page, '4-run-induction.png');
      await page.click('#ph-secure');
      await page.click('#ph-maintenance');
      await page.click('#ph-surgery');
      let s = await waitSim(page, (x) => x.phase === 'maintenance' && x.airway.secured && x.airway.ventilated, { label: 'maintenance' });
      await page.selectOption('#aw-fio2', '0.5'); await page.click('#aw-fio2-set');
      const t0 = s.t;
      await waitSim(page, (x) => x.t > t0 + 600, { label: '10 min maintenance' });
      assert.notEqual((await page.textContent('#tile-mac .tile__value')).trim(), '—', 'total MAC shown');
      await shot(page, '4-run-maintenance.png');
      await page.click('#ph-endsurgery');
      await page.click('#ph-emergence');
      s = await waitSim(page, (x) => x.v.tofRatio >= 0.9, { label: 'TOFR ≥ 0.9 after sugammadex' });
      const log = (await simLog(page)).map((e) => e.message).join('\n');
      assert.match(log, /Sugammadex .* bolus/);
      s = await waitSim(page, (x) => x.ready, { timeout: 90000, label: 'extubation readiness' });
      await page.click('#mon-play'); // pause
      // Readiness can flicker with noise while playing; step until it holds at the paused time.
      for (let i = 0; i < 60 && !(await simState(page)).ready; i++) await page.click('[data-step="10"]');
      assert.ok((await simState(page)).ready, 'readiness met while paused');
      await page.click('#ph-extubate');
      await page.waitForSelector('#ext-confirm');
      await page.click('#ext-confirm');
      s = await simState(page);
      assert.equal(s.airway.secured, false);
      await page.click('#mon-debrief'); await page.waitForSelector('#db-download');
      assert.match(await page.textContent('main'), /Extubated at .* readiness met/);
      await shot(page, '5-debrief.png');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#db-download')]);
      assert.match(dl.suggestedFilename(), /\.json$/);
    });

    await t.test('extubating when not ready asks for confirmation and is logged', async () => {
      await page.click('#stepper-4'); await page.waitForSelector('#mon-play');
      await page.click('#mon-debrief'); await page.click('.actions .btn:has-text("Run again")');
      await page.waitForSelector('#mon-play');
      await page.click('#ph-induction'); await page.click('[data-step="60"]'); await page.click('[data-step="60"]'); await page.click('[data-step="60"]');
      await page.click('#ph-secure');
      await page.click('#ph-extubate');
      await page.waitForSelector('#ext-override');
      await page.click('#ext-override');
      const log = (await simLog(page)).map((e) => e.message).join('\n');
      assert.match(log, /User confirmed extubation despite unmet readiness/);
    });

    await t.test('MAC moderate sedation case runs', async () => {
      await loadCase(page, 'obese_osa');
      await page.click('#pf-continue'); await page.waitForSelector('#as-continue'); await page.click('#as-continue'); await page.waitForSelector('#pl-continue');
      assert.ok(await page.isChecked('#pl-mode-MAC')); assert.ok(await page.isChecked('#pl-target-moderate'));
      assert.match(await page.textContent('#pl-target'), /exhaled-CO2/);
      await page.click('#pl-continue'); await page.waitForSelector('#ph-sedation');
      await page.selectOption('#aw-fio2', '0.4'); await page.click('#aw-fio2-set');
      await page.click('[data-speed="60"]'); await page.click('#ph-sedation'); await page.click('#mon-play');
      const s = await waitSim(page, (x) => x.t > 480, { label: 'MAC 8 min' });
      await page.click('#mon-play');
      assert.equal(s.phase, 'sedation');
      assert.ok(['awake', 'minimal', 'moderate', 'deep', 'general'].includes(s.v.sedationLevel));
    });

    await t.test('sensor fault shows FAULT and RED/HOLD', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      await page.click('#ph-induction'); await page.click('[data-step="10"]');
      await page.click('#sf-hr_sensor_fault');
      await page.click('[data-step="1"]'); await page.click('[data-step="1"]');
      assert.equal((await page.textContent('#tile-hr .tile__value')).trim(), 'FAULT');
      assert.match(await page.textContent('#mon-il-badge'), /RED|HOLD/);
      assert.match(await page.textContent('#mon-alarms'), /HR sensor fault/);
      await shot(page, '4-run-alarm.png');
      await page.click('[data-step="60"]'); await page.click('[data-step="60"]');
      assert.match(await page.textContent('#mon-il-badge'), /HOLD/);
      await page.click('#mon-resume');
      assert.match(await page.textContent('#mon-log'), /Hold released by explicit user action/);
    });

    await t.test('guided mode, GA (elderly example) at 60×: gates in order, intubate/extubate only when conditions met', async () => {
      await loadCase(page, 'elderly_cad_ckd'); await toRun(page);
      await page.click('[data-speed="60"]');
      await page.click('#auto-guided');
      assert.equal((await page.textContent('#auto-banner')).trim(), GUIDED_BANNER);
      assert.equal((await page.textContent('#auto-gate')).trim(), 'Approve & start induction');
      await page.waitForTimeout(1500);
      let s = await autoStatus(page);
      assert.ok(s.t > 20 && s.phase === 'premed', `nothing advances without the gate (t ${s.t}, ${s.phase})`);
      await page.click('#auto-gate');
      s = await waitAuto(page, (x) => x.current && x.current.id === 'secure_airway', { label: 'intubate gate shown' });
      await page.waitForFunction(() => document.getElementById('auto-gate').textContent.trim() === 'Intubate (secure airway)');
      assert.ok(await page.isDisabled('#auto-gate'), 'Intubate disabled before intubating conditions');
      await shot(page, 'auto-guided-induction.png');
      s = await gate(page, 'Intubate (secure airway)');
      assert.ok(s.v.tofCount <= 1 && s.v.depthIndex <= 60, `intubating conditions when enabled: ${JSON.stringify(s.v)}`);
      s = await waitAuto(page, (x) => x.current && x.current.id === 'start_maintenance', { label: 'maintenance gate' });
      const t1 = s.t; await page.waitForTimeout(1000);
      assert.equal((await autoStatus(page)).phase, 'induction', 'maintenance waits for the clinician');
      assert.ok((await autoStatus(page)).t > t1);
      await gate(page, 'Enter maintenance mode');
      s = await waitAuto(page, (x) => x.current && x.current.id === 'end_surgery', { label: 'surgery started automatically' });
      assert.ok((await simLog(page)).some((e) => e.kind === 'auto' && /^AUTO: step 4\/8 — Start surgery \(automatic within the approved phase\)/.test(e.message)), 'surgery started automatically (logged)');
      await shot(page, 'auto-guided-maintenance.png');
      await gate(page, 'End surgery');
      await gate(page, 'Enter emergence / extubation mode');
      s = await waitAuto(page, (x) => x.current && x.current.id === 'extubate', { label: 'extubate gate' });
      if (!s.ready) assert.ok(await page.isDisabled('#auto-gate'), 'Extubate disabled until ready');
      await gate(page, 'Extubate');
      s = await waitAuto(page, (x) => x.state === 'completed', { label: 'guided GA complete' });
      assert.equal(s.v && (await simState(page)).airway.secured, false);
      await page.click('#mon-debrief'); await page.waitForSelector('#db-auto-note');
      assert.match(await page.textContent('#db-auto-note'), /ran in guided mode/);
      assert.match(await page.textContent('main'), /Extubated at .* readiness met/);
      await shot(page, 'auto-guided-debrief.png');
    });

    await t.test('guided mode, MAC (obese OSA example) at 60×', async () => {
      await loadCase(page, 'obese_osa'); await toRun(page);
      await page.click('[data-speed="60"]');
      await page.click('#auto-guided');
      assert.equal((await page.textContent('#auto-banner')).trim(), GUIDED_BANNER);
      await gate(page, 'Approve & start sedation');
      const s = await waitAuto(page, (x) => x.current && x.current.id === 'end_procedure', { label: 'procedure started automatically' });
      assert.equal(s.phase, 'sedation');
      await gate(page, 'End procedure');
      await waitAuto(page, (x) => x.state === 'completed', { label: 'guided MAC complete' });
      await page.click('#mon-debrief'); await page.waitForSelector('#db-auto-note');
      assert.match(await page.textContent('#db-auto-note'), /ran in guided mode/);
    });

    for (const [id, label] of [['mh_susceptible', 'GA (MH-susceptible TIVA)'], ['obese_osa', 'MAC (obese OSA)']]) {
      await t.test(`run full case automatically, ${label} at 60×`, async () => {
        await loadCase(page, id); await toRun(page);
        await page.click('[data-speed="60"]');
        await page.click('#auto-full');
        assert.equal((await page.textContent('#auto-banner')).trim(), FULL_BANNER);
        await shot(page, `auto-full-${id}-running.png`);
        await waitAuto(page, (x) => x.state === 'completed', { label: `full ${id} complete` });
        const log = await simLog(page);
        assert.ok(log.some((e) => e.kind === 'auto' && /^AUTO: step 1\//.test(e.message)));
        assert.ok(!log.some((e) => /despite unmet readiness/.test(e.message)), 'override never used');
        await page.click('#mon-debrief'); await page.waitForSelector('#db-auto-note');
        assert.match(await page.textContent('#db-auto-note'), /ran automatically/);
        await shot(page, `auto-full-${id}-debrief.png`);
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#db-download')]);
        const json = JSON.parse(await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'));
        assert.equal(json.automaticMode.used, true); assert.equal(json.automaticMode.mode, 'full'); assert.equal(json.summary.automatic.outcome, 'completed');
      });
    }

    await t.test('a manual control ends automatic mode', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      await page.click('#auto-full');
      await page.waitForSelector('#auto-takeover:not([hidden])');
      await page.click('[data-step="10"]');
      const s = await autoStatus(page);
      assert.equal(s.state, 'manual');
      assert.match(await page.textContent('#auto-status'), /ended \(manual control\)/);
      assert.match(await page.textContent('#mon-log'), /AUTO: Automatic demonstration ended — manual control used/);
      assert.ok(await page.isVisible('#auto-full'), 'start buttons offered again');
    });

    await t.test('guided gate: a double-click approves only the gate that was shown', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      await page.click('[data-speed="60"]');
      await page.click('#auto-guided');
      await gate(page, 'Approve & start induction');
      for (let i = 0; ; i++) {
        const dom = await page.evaluate(() => { const b = document.getElementById('auto-gate'); return { text: b.textContent.trim(), on: !b.disabled && !b.hidden }; });
        if (dom.text === 'Intubate (secure airway)' && dom.on) break;
        const s = await autoStatus(page);
        if (s.state === 'paused') await userResolvesPause(page);
        if (i > 3000) throw new Error('intubate gate never enabled');
        await page.waitForTimeout(100);
      }
      await page.dblclick('#auto-gate');
      await page.waitForTimeout(800);
      const s = await autoStatus(page);
      const ids = s.history.map((x) => x.id);
      assert.ok(ids.includes('secure_airway'), 'the shown gate was approved');
      assert.ok(!ids.includes('start_maintenance'), `the next gate was NOT approved by the second click: ${ids.join(',')}`);
      assert.equal(s.current.id, 'start_maintenance'); assert.equal(s.phase, 'induction');
    });

    await t.test('extubation dialog pauses the clock and re-checks readiness at confirm', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      await page.click('#ph-induction'); await page.click('[data-step="60"]'); await page.click('[data-step="60"]'); await page.click('[data-step="60"]');
      await page.click('#ph-secure');
      await page.click('[data-speed="60"]'); await page.click('#mon-play');
      await page.waitForTimeout(500);
      await page.click('#ph-extubate'); await page.waitForSelector('#extubate-dialog[open]');
      const a = await simState(page); await page.waitForTimeout(2500); const b = await simState(page);
      assert.equal(a.playing, false, 'clock paused while the dialog is open');
      assert.equal(b.t, a.t, `sim time did not advance (${a.t} → ${b.t})`);
      assert.ok(await page.isVisible('#ext-override'), 'not ready: override path offered');
      await page.click('#extubate-dialog .btn:has-text("Cancel")');
      await page.waitForTimeout(800);
      const c = await simState(page);
      assert.equal(c.playing, true, 'clock resumes after the dialog closes'); assert.ok(c.t > b.t);
      assert.equal(c.airway.secured, true, 'cancel keeps the tube');
      await page.click('#mon-play'); // pause
    });

    await t.test('reading a citation or pre-filling the form does not end automatic mode', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      await page.click('[data-speed="20"]');
      await page.click('#auto-full');
      await waitAuto(page, (x) => x.state === 'running' && x.t > 5, { label: 'auto running' });
      await page.click('#mon-ready-h ~ p .src-tag');
      await page.waitForSelector('#sources-dialog[open]');
      await page.click('#sources-dialog [data-close-dialog]');
      let s = await autoStatus(page);
      assert.notEqual(s.state, 'manual', `source tag did not end automatic mode (${s.state}: ${s.message})`);
      await page.waitForSelector('#mon-drugs button:has-text("Bolus")');
      await page.click('#mon-drugs button:has-text("Bolus")');
      s = await autoStatus(page);
      assert.notEqual(s.state, 'manual', 'drug-row Bolus (pre-fill only) did not end automatic mode');
      await page.click('#ad-give');
      s = await autoStatus(page);
      assert.equal(s.state, 'manual', 'giving a drug is manual control and ends automatic mode');
    });

    // ---- 2026-11 additions: technique templates, fluids, antibiotic checklist
    const toPlan = async (id) => { await loadCase(page, id); await page.click('#pf-continue'); await page.waitForSelector('#as-continue'); await page.click('#as-continue'); await page.waitForSelector('#pl-template'); };
    const elShot = async (sel, name) => { if (SHOTS) await page.locator(sel).screenshot({ path: join(SHOTS, name) }); };
    const planSteps = async () => (await snap(page)).plan.steps;

    await t.test('technique templates: selector, opioid-free plan with POFA note, opioid-based pretreatment, dexmedetomidine MAC', async () => {
      await toPlan('healthy_adult');
      const labels = await page.$$eval('#pl-template option', (o) => o.map((x) => x.textContent));
      for (const l of ['GA — opioid-based (balanced)', 'GA — opioid-free', 'MAC — dexmedetomidine', 'MAC — propofol (existing technique)']) assert.ok(labels.includes(l), l);
      await page.selectOption('#pl-template', 'ga_opioid');
      assert.ok(await page.isVisible('#pl-tpl-opt-lidocainePretreatment'));
      await elShot('#pl-template-card', 'template-selector.png');
      await page.click('#pl-template-apply');
      let st = await planSteps();
      const pre = st.find((x) => x.drugId === 'lidocaine' && x.regimenKey === 'pretreatment'); const pro = st.find((x) => x.drugId === 'propofol' && x.regimenKey === 'induction');
      assert.ok(pre && pro && pre.amount === 10 && pre.atSec < pro.atSec, JSON.stringify(st));
      for (const d of ['cefazolin', 'lactated_ringers', 'fentanyl', 'sevoflurane', 'sugammadex']) assert.ok(st.some((x) => x.drugId === d), d);
      assert.ok(await page.isVisible('#pl-template-notes [data-note="propofolPain"]'));
      assert.match(await page.textContent('#pl-template-notes'), /pH of 7 to 8\.5/);
      await page.selectOption('#pl-template', 'ga_opioid_free'); await page.click('#pl-template-apply');
      st = await planSteps();
      assert.ok(!st.some((x) => ['fentanyl'].includes(x.drugId)) && !st.some((x) => x.regimenKey === 'pretreatment'));
      for (const d of ['dexmedetomidine', 'ketamine', 'lidocaine', 'propofol']) assert.ok(st.some((x) => x.drugId === d), d);
      const pofa = await page.textContent('#pl-template-notes [data-note="pofa"]');
      assert.match(pofa, /POFA/); assert.match(pofa, /severe bradycardia/); assert.match(pofa, /S49/);
      assert.match(await page.textContent('#pl-notice'), /Omitted: lidocaine pretreatment/);
      assert.match(await page.textContent('#pl-summary'), /no blocking issues/);
      await elShot('#pl-template-card', 'opioid-free-pofa-note.png');
      await shot(page, 'opioid-free-plan.png');
      await page.selectOption('#pl-template', 'mac_dex'); await page.click('#pl-template-apply');
      const sp = (await snap(page)).plan;
      assert.equal(sp.mode, 'MAC');
      assert.ok(sp.steps.some((x) => x.drugId === 'dexmedetomidine' && x.kind === 'infusion' && x.rate === 0.5), JSON.stringify(sp.steps));
      assert.ok(await page.isVisible('#pl-template-notes [data-note="dexMac"]')); assert.ok(await page.isVisible('#pl-template-notes [data-note="dexInterlock"]'));
      assert.match(await page.textContent('#pl-template-notes'), /use a GA template/);
      await page.check('#pl-target-deep'); assert.match(await page.textContent('#pl-summary'), /no blocking issues/);
      await shot(page, 'dex-mac-plan.png');
    });

    await t.test('antibiotic checklist in guided mode: warning before Start surgery waits for the clinician; alarm at incision', async () => {
      await toPlan('healthy_adult');
      assert.equal(await page.isChecked('#pl-abx-indicated'), true);
      const card = page.locator('.step-card', { hasText: 'Cefazolin' });
      await card.locator('[data-del]').click();
      assert.ok(!(await planSteps()).some((x) => x.kind === 'antibiotic'));
      await page.click('#pl-continue'); await page.waitForSelector('#mon-play');
      await page.click('[data-speed="60"]');
      await page.click('#auto-guided');
      await gate(page, 'Approve & start induction'); await gate(page, 'Intubate (secure airway)'); await gate(page, 'Enter maintenance mode');
      await waitAuto(page, (s) => s.current && s.current.id === 'start_surgery' && !!s.current.checklist, { label: 'checklist shown' });
      await page.waitForSelector('#auto-checklist:not([hidden])'); await page.waitForSelector('#abx-checklist:not([hidden])');
      const t0 = (await simState(page)).t;
      await waitSim(page, (s) => s.t > t0 + 240, { label: 'time passes while waiting' });
      const s1 = await snap(page);
      assert.equal(s1.auto.current.id, 'start_surgery', 'surgery has not started');
      assert.equal(s1.sim.prophylaxis.checklistAcknowledged, null, 'never auto-acknowledged');
      await elShot('#auto-panel', 'antibiotic-checklist-guided.png');
      await page.click('#auto-abx-ack');
      await waitAuto(page, (s) => s.current && s.current.id === 'end_surgery', { label: 'surgery started after acknowledgement' });
      const s2 = await snap(page);
      assert.ok(s2.sim.prophylaxis.checklistAcknowledged);
      assert.ok(s2.sim.alarms.some((a) => a.id === 'abx_window' && a.priority === 'medium'), JSON.stringify(s2.sim.alarms));
      assert.match(await page.textContent('#mon-alarms'), /Surgery started without antibiotic prophylaxis in the recommended window/);
      await shot(page, 'antibiotic-alarm-guided.png');
      await page.click('#auto-takeover');
    });

    await t.test('fluids panel: type, boluses and maintenance; debrief totals by type and lidocaine pretreatment', async () => {
      await toPlan('healthy_adult');
      await page.selectOption('#pl-template', 'ga_opioid'); await page.click('#pl-template-apply');
      await page.selectOption('#pl-fluid-maintenance', 'sodium_chloride_0_9');
      await page.click('#pl-fluid-bolus-250-maintenance');
      assert.ok((await planSteps()).some((x) => x.kind === 'fluid_bolus' && x.drugId === 'sodium_chloride_0_9' && x.phase === 'maintenance'));
      await page.click('#pl-continue'); await page.waitForSelector('#mon-fluids-panel');
      await page.click('[data-speed="60"]');
      await page.click('[data-step="60"]'); // the planned LR maintenance (premedication 00:00) starts first
      assert.equal((await simState(page)).fluids.maintenance.fluidId, 'lactated_ringers');
      await page.selectOption('#fl-type', 'sodium_chloride_0_9'); await page.click('#fl-500');
      await page.fill('#fl-rate', '150'); await page.click('#fl-maint-set');
      for (let i = 0; i < 2; i++) await page.click('[data-step="60"]');
      const F = (await simState(page)).fluids;
      assert.equal(F.byType.sodium_chloride_0_9.bolusMl, 500);
      assert.equal(F.maintenance.fluidId, 'sodium_chloride_0_9'); assert.equal(F.maintenance.rateMlH, 150);
      assert.ok(F.byType.lactated_ringers.maintenanceMl > 0 || F.byType.sodium_chloride_0_9.maintenanceMl > 0);
      assert.match(await page.textContent('#mon-fluid-totals'), /0\.9% sodium chloride/);
      assert.match(await page.textContent('#fl-maint-state'), /150 mL\/h/);
      await elShot('#mon-fluids-panel', 'fluids-panel.png');
      // run the whole template case as the automatic demonstration (restarts from 00:00 with the plan), then debrief
      await page.click('#auto-full');
      await waitAuto(page, (s) => s.state === 'completed', { label: 'full case with fluids', timeout: 400000 });
      const s = await simState(page);
      assert.equal(s.fluids.byType.sodium_chloride_0_9.bolusMl, 250, 'planned 0.9% NaCl bolus ran');
      assert.ok(s.fluids.byType.lactated_ringers.maintenanceMl > 0, 'LR maintenance from the template ran across phases');
      assert.equal(s.prophylaxis.doses[0].drugId, 'cefazolin');
      await page.click('#mon-debrief'); await page.waitForSelector('#db-fluids');
      assert.match(await page.textContent('#db-fluid-totals'), /Lactated Ringer's/);
      assert.match(await page.textContent('#db-abx'), /in the recommended window/);
      assert.match(await page.textContent('#db-lido'), /including pretreatment 10 mg/);
      await shot(page, 'debrief-totals.png');
    });

    await t.test('panels open', async () => {
      for (const id of ['open-sources', 'open-model', 'open-about']) {
        await page.click(`#${id}`);
        const dlg = id.replace('open-', '') + '-dialog';
        await page.waitForSelector(`#${dlg}[open]`);
        await page.click(`#${dlg} [data-close-dialog]`);
      }
    });

    await t.test('no page-level horizontal overflow at 390 px', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await loadCase(page, 'healthy_adult');
      const names = ['phone-1-patient.png', 'phone-2-assessment.png', 'phone-3-plan.png', 'phone-4-run.png', 'phone-5-debrief.png'];
      assert.ok(await noHScroll(page), 'step 1'); await shot(page, names[0], false);
      await page.click('#pf-continue'); await page.waitForSelector('#as-continue'); assert.ok(await noHScroll(page), 'step 2'); await shot(page, names[1], false);
      await page.click('#as-continue'); await page.waitForSelector('#pl-continue'); assert.ok(await noHScroll(page), 'step 3'); await shot(page, names[2], false);
      await page.click('#pl-continue'); await page.waitForSelector('#mon-play');
      await page.click('#ph-induction'); await page.click('[data-step="60"]'); await page.click('[data-step="60"]');
      assert.ok(await noHScroll(page), 'step 4'); await shot(page, names[3], false);
      await page.click('#mon-debrief'); await page.waitForSelector('#db-download'); assert.ok(await noHScroll(page), 'step 5'); await shot(page, names[4], false);
      await page.click('#open-sources'); assert.ok(await noHScroll(page), 'sources'); await page.click('#sources-dialog [data-close-dialog]');
    });

    assert.deepEqual(problems, [], `console/CSP/network problems:\n${problems.join('\n')}`);
  } finally {
    await browser.close();
    if (server) await new Promise((r) => { server.close(r); });
  }
});
