// Browser smoke test for the simulator UI (Playwright + Chromium).
// Not part of `npm test` (only *.test.mjs files are loaded there). Run it with `npm run test:ui`.
// It starts its own static file server (Node http, no dependencies) on a free port, serving the
// repository root, and opens /simulator/index.html?test=1 (the ?test=1 flag enables the
// window.__smartNoa test hook: snapshot(), lite(), testClock(on) and advance(sec)).
// DETERMINISTIC (2026-11 timing review): the suite switches the test clock on, so simulated time
// moves ONLY through advance(sec) (synchronous; the guided/automatic runner ticks every second) or
// the explicit +1 s / +10 s / +1 min step buttons. Every wait is a condition on simulated state or
// the DOM; no step depends on wall-clock speed. (One test turns the clock off to check that the
// extubation dialog pauses a playing clock, waiting on explicit DOM/state conditions.)
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
const lite = (page) => page.evaluate(() => window.__smartNoa.lite());
const simState = async (page) => (await snap(page)).sim;
/** Advances simulated time synchronously (test hook); returns the lite status. */
const adv = (page, sec) => page.evaluate((n) => window.__smartNoa.advance(n), sec);
/** Advances in `chunk`-second steps until pred(lite) holds (simulated-time limit `maxSec`). */
async function advanceUntil(page, pred, { maxSec = 3600, chunk = 5, label = 'condition', resolvePauses = false } = {}) {
  let s = await lite(page); const t0 = s.t;
  for (;;) {
    if (pred(s)) return s;
    if (s.auto && ['stopped', 'manual'].includes(s.auto.state)) throw new Error(`${label}: runner ${s.auto.state} — ${s.auto.message}`);
    if (resolvePauses && s.auto && s.auto.state === 'paused') { await userResolvesPause(page); s = await lite(page); continue; }
    if (s.t - t0 > maxSec) throw new Error(`Timed out (simulated ${maxSec} s) waiting for ${label}; last ${JSON.stringify({ t: s.t, phase: s.phase, v: s.v, auto: s.auto && { state: s.auto.state, cur: s.auto.current && s.auto.current.id, msg: s.auto.message } })}`);
    s = await adv(page, chunk);
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
/** Waits (wall clock, no simulated time) until the gate button is not in its post-click cooldown. */
const gateIdle = (page) => page.waitForFunction(() => { const b = document.getElementById('auto-gate'); return !b || !b.dataset.busy; });
/** Clicks a button if it is visible and enabled; returns whether it was clicked. */
async function clickIf(page, sel) { const l = page.locator(sel); if (await l.count() && await l.isVisible() && await l.isEnabled()) { await l.click(); return true; } return false; }
/** The clinician's checklist buttons (WHO time out, index below band, missing prophylaxis). */
async function clinicianItems(page) {
  let n = 0;
  for (const sel of ['#auto-timeout', '#auto-depth-ack', '#auto-abx-give']) if (await clickIf(page, sel)) n++;
  return n;
}
/** Acts as the user when the runner pauses: acknowledge HIGH alarms, release a latched hold, clinician items, press Resume. */
async function userResolvesPause(page) {
  for (const b of await page.locator('#mon-alarms button[data-ack]:not([disabled])').all()) await b.click();
  if (await page.isEnabled('#mon-resume')) await page.click('#mon-resume');
  await clinicianItems(page);
  if (await page.isEnabled('#auto-resume')) await page.click('#auto-resume');
}
async function waitAuto(page, pred, { maxSec = 14000, label = 'auto condition', resolvePauses = true } = {}) {
  return advanceUntil(page, (s) => !!s.auto && pred({ ...s.auto, t: s.t, phase: s.phase, v: s.v, ready: s.ready }), { maxSec, chunk: 10, label, resolvePauses });
}
/**
 * Guided gate: advance simulated time until the gate button shows `label` and is enabled (resolving
 * pauses as a user; with clinician:true also pressing the clinician checklist buttons), then click it.
 */
async function gate(page, label, { maxSec = 5000, clinician = false, chunk = 5 } = {}) {
  await gateIdle(page);
  let s = await lite(page); const t0 = s.t;
  for (;;) {
    const dom = await page.evaluate(() => { const b = document.getElementById('auto-gate'); return b ? { text: b.textContent.trim(), on: !b.disabled && !b.hidden } : null; });
    if (dom && dom.text === label && dom.on) { await page.click('#auto-gate'); await gateIdle(page); return s; }
    if (s.auto && ['stopped', 'manual', 'completed'].includes(s.auto.state)) throw new Error(`gate ${label}: runner ${s.auto.state} — ${s.auto.message}`);
    if (s.auto && s.auto.state === 'paused') { await userResolvesPause(page); s = await lite(page); continue; }
    if (clinician && dom && dom.text === label && await clinicianItems(page)) { s = await lite(page); continue; }
    if (s.t - t0 > maxSec) throw new Error(`Timed out (simulated ${maxSec} s) waiting for gate ${label}; DOM ${JSON.stringify(dom)}; ${JSON.stringify(s.auto && s.auto.current && s.auto.current.unmet)}`);
    s = await adv(page, chunk);
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
  // Page-wide guard (05l final review): no text node may ever render as "null", "undefined", "NaN" or "[object …]".
  await page.addInitScript(() => {
    const bad = (txt) => /^\s*(null|undefined|NaN)\s*$/.test(txt) || /\[object [A-Za-z]+\]/.test(txt);
    window.__junkText = [];
    const scan = (n) => {
      if (n.nodeType === 3) { if (bad(n.data)) window.__junkText.push(`${n.parentElement ? n.parentElement.id || n.parentElement.className || n.parentElement.tagName : '?'}: ${n.data.slice(0, 80)}`); return; }
      if (n.nodeType === 1) for (const c of n.childNodes) scan(c);
    };
    new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData') scan(m.target); for (const x of m.addedNodes || []) scan(x); } })
      .observe(document, { subtree: true, childList: true, characterData: true });
  });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on('request', (r) => { if (!r.url().startsWith(new URL(URL_).origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) problems.push(`external request: ${r.url()}`); });

  try {
    await page.goto(URL_);
    await page.waitForSelector('#pf-continue');
    assert.equal(await page.evaluate(() => window.__smartNoa.testClock(true)), true, 'step-driven test clock on');
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
        assert.doesNotMatch(await page.textContent('main'), /\[object /, 'debrief never shows [object …]'); { const rl = await page.$$eval('#db-root .ready-list li, main .ready-list li', (ls) => ls.map((l) => l.textContent)); for (const row of rl) assert.match(row, / — /, `debrief readiness row: ${row}`); }
        assert.ok(await page.isVisible('#db-totals') || (await page.textContent('main')).includes('No drugs given'), `${id}: debrief`);
      }
      // MH-susceptible: volatile agents and succinylcholine are locked
      await loadCase(page, 'mh_susceptible'); await page.click('#pf-continue'); await page.waitForSelector('#as-continue');
      const as = await page.textContent('main');
      assert.match(as, /Sevoflurane[\s\S]*LOCKED/); assert.match(as, /Succinylcholine/);
    });

    await t.test('GA case: induction → airway → maintenance → emergence → sugammadex → extubation (step-driven)', async () => {
      await loadCase(page, 'healthy_adult');
      await shot(page, '1-patient.png');
      await page.click('#pf-continue'); await page.waitForSelector('#as-continue'); await shot(page, '2-assessment.png');
      await page.click('#as-continue'); await page.waitForSelector('#pl-continue');
      assert.ok((await page.locator('.src-tag').count()) > 5, 'source tags on plan');
      await shot(page, '3-plan.png');
      await page.click('#pl-continue'); await page.waitForSelector('#mon-play');
      await adv(page, 760); // pre-op holding: premedication, then transfer/setup/preoxygenation time (manual mode)
      await page.selectOption('#aw-fio2', '1'); await page.click('#aw-fio2-set');
      await page.click('#ph-induction');
      await page.click('#aw-mask');
      await advanceUntil(page, (s) => s.v.tofCount === 0 && s.v.depthIndex < 60, { maxSec: 900, label: 'paralysis + depth' });
      await shot(page, '4-run-induction.png');
      await page.click('#ph-secure');
      await page.click('#ph-maintenance');
      await page.click('#ph-surgery');
      let s = await lite(page);
      assert.ok(s.phase === 'maintenance' && s.airway.secured && s.airway.ventilated, 'maintenance');
      await page.selectOption('#aw-fio2', '0.5'); await page.click('#aw-fio2-set');
      await advanceUntil(page, (x) => x.t > s.t + 600, { maxSec: 700, chunk: 60, label: '10 min maintenance' });
      assert.notEqual((await page.textContent('#tile-mac .tile__value')).trim(), '—', 'total MAC shown');
      // processed-EEG index tile and chart show the GA band (sourced)
      assert.match(await page.textContent('#tile-depth'), /Processed-EEG depth index \(BIS-style, simulated\)/);
      assert.match(await page.textContent('#tile-depth .tile__sub'), /GA band 40–60: (in band|below band|above band)/);
      assert.match(await page.textContent('#mon-charts figcaption >> nth=3'), /GA band 40–60/);
      assert.match(await page.textContent('#mon-depth-band'), /not a BIS value \(BIS is a trademark of its owner\)/);
      assert.ok(await page.locator('#mon-depth-band .src-tag', { hasText: 'S52' }).count());
      await shot(page, '4-run-maintenance.png');
      await page.click('#ph-endsurgery');
      await page.click('#ph-emergence');
      await advanceUntil(page, (x) => x.v.tofRatio >= 0.9, { maxSec: 900, label: 'TOFR ≥ 0.9 after sugammadex' });
      const log = (await simLog(page)).map((e) => e.message).join('\n');
      assert.match(log, /Sugammadex .* bolus/);
      s = await advanceUntil(page, (x) => x.ready, { maxSec: 1800, chunk: 1, label: 'extubation readiness' });
      assert.ok((await simState(page)).ready, 'readiness met (clock does not move between steps)');
      await page.click('#ph-extubate');
      await page.waitForSelector('#ext-confirm');
      await page.click('#ext-confirm');
      assert.equal((await simState(page)).airway.secured, false);
      await page.click('#mon-debrief'); await page.waitForSelector('#db-download');
      assert.doesNotMatch(await page.textContent('main'), /\[object /, 'debrief never shows [object …]'); { const rl = await page.$$eval('#db-root .ready-list li, main .ready-list li', (ls) => ls.map((l) => l.textContent)); for (const row of rl) assert.match(row, / — /, `debrief readiness row: ${row}`); }
      assert.match(await page.textContent('main'), /Extubated at .* readiness met/);
      assert.ok(await page.isVisible('#db-timing'), 'debrief timing check');
      assert.match(await page.textContent('#db-timing'), /Opioid → hypnotic/);
      await shot(page, '5-debrief.png');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#db-download')]);
      assert.match(dl.suggestedFilename(), /\.json$/);
    });

    await t.test('extubating when not ready asks for confirmation and is logged', async () => {
      await page.click('#stepper-4'); await page.waitForSelector('#mon-play');
      await page.click('#mon-debrief'); await page.click('.actions .btn:has-text("Run again")');
      await page.waitForSelector('#mon-play');
      // induction drugs wait for the 2-min premedication; propofol +3:00 and rocuronium +4:00 after fentanyl → asleep after 7 min
      await page.click('#ph-induction'); for (let i = 0; i < 7; i++) await page.click('[data-step="60"]');
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
      await page.click('#ph-sedation');
      const s = await advanceUntil(page, (x) => x.t > 480, { maxSec: 600, chunk: 30, label: 'MAC 8 min' });
      assert.equal(s.phase, 'sedation');
      assert.ok(['awake', 'minimal', 'moderate', 'deep', 'general'].includes(s.v.sedationLevel));
    });

    await t.test('sensor fault: tiles show "—" (accessible label), RED/HOLD, charts gap, restored when the fault clears', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      await page.click('#ph-induction'); await page.click('[data-step="10"]');
      await page.click('#sf-hr_sensor_fault');
      await page.click('[data-step="1"]'); await page.click('[data-step="1"]');
      assert.equal((await page.textContent('#tile-hr .tile__value')).trim(), '—');
      assert.equal(await page.getAttribute('#tile-hr .tile__value', 'aria-label'), 'no valid reading (sensor fault)');
      assert.match(await page.textContent('#tile-hr .tile__sub'), /SENSOR FAULT/);
      assert.match(await page.textContent('#mon-il-badge'), /RED|HOLD/);
      assert.match(await page.textContent('#mon-alarms'), /HR sensor fault/);
      assert.doesNotMatch(await page.textContent('#mon-log'), /NaN/);
      assert.match(await page.textContent('#mon-log'), /HR=unusable/);
      const gap = await snap(page);
      assert.equal(gap.hist.hr[gap.hist.hr.length - 1], null, 'the trend chart holds a gap (NaN sample), not the stale value');
      await shot(page, '4-run-alarm.png');
      // MAP and SpO2 faults: BP tile shows "—" (no stale systolic/diastolic), advisory reads "MAP reading unusable"
      await page.click('#sf-map_sensor_fault'); await page.click('#sf-spo2_probe_off');
      await page.click('[data-step="1"]'); await page.click('[data-step="1"]');
      for (const k of ['bp', 'spo2']) {
        assert.equal((await page.textContent(`#tile-${k} .tile__value`)).trim(), '—', k);
        assert.equal(await page.getAttribute(`#tile-${k} .tile__value`, 'aria-label'), 'no valid reading (sensor fault)', k);
      }
      assert.doesNotMatch(await page.textContent('#tile-bp'), /\d+\/\d+|MAP \d/);
      assert.match(await page.textContent('#adv-headline'), /MAP reading unusable/);
      await page.click('[data-step="60"]'); await page.click('[data-step="60"]');
      assert.match(await page.textContent('#mon-il-badge'), /HOLD/);
      for (const k of ['hr', 'bp', 'spo2']) {
        const v = (await page.textContent(`#tile-${k} .tile__value`)).trim();
        assert.match(v, /^\d+(\/\d+)?$/, `${k} restored after the fault clears: ${v}`);
        assert.equal(await page.getAttribute(`#tile-${k} .tile__value`, 'aria-label'), null, k);
      }
      await page.click('#mon-resume');
      assert.match(await page.textContent('#mon-log'), /Hold released by explicit user action/);
    });

    await t.test('MH patient + sevoflurane example plan: blocking "no maintenance hypnotic" warning; clinician adds propofol TIVA; then Run', async () => {
      await loadCase(page, 'mh_susceptible');
      await page.click('#pf-continue'); await page.waitForSelector('#as-continue'); await page.click('#as-continue'); await page.waitForSelector('#pl-continue');
      await page.selectOption('#pl-example', 'ga_healthy'); await page.click('text=Load example plan');
      await page.waitForSelector('#pl-hypnotic-gap');
      const msg = await page.textContent('#pl-hypnotic-gap');
      assert.match(msg, /No maintenance hypnotic after lockout: Sevoflurane is contraindicated \(.*malignant hyperthermia.*\)\. Add an alternative \(e\.g\. propofol infusion — TIVA\) before approving\./);
      assert.equal(await page.getAttribute('#pl-continue', 'aria-disabled'), 'true');
      const before = await page.locator('#pl-phases .step-card').count();
      await page.click('#pl-continue', { force: true }); // aria-disabled: the click is refused and focuses the warning
      assert.equal(await page.locator('#mon-play').count(), 0, 'Run is not reachable while blocked');
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'pl-add-tiva');
      assert.equal(await page.locator('#pl-phases .step-card').count(), before, 'nothing added automatically');
      await page.click('#pl-add-tiva');
      assert.equal(await page.locator('#pl-hypnotic-gap').count(), 0);
      assert.equal(await page.locator('#pl-phases .step-card').count(), before + 2);
      assert.match(await page.textContent('#pl-notice'), /Clinician added propofol TIVA maintenance/);
      assert.match(await page.textContent('#pl-phase-maintenance'), /Propofol/);
      assert.match(await page.textContent('body'), /Propofol TIVA maintenance added by the clinician/); // "Why this time"
      assert.equal(await page.getAttribute('#pl-continue', 'aria-disabled'), 'false');
      await page.click('#pl-continue'); await page.waitForSelector('#mon-play');
      assert.match(await page.textContent('#mon-log'), /added by the clinician with "Add propofol TIVA maintenance"/);
    });

    await t.test('guided mode, GA (elderly example): gates in order, countdowns, pre-incision verification, intubate/extubate only when conditions met', async () => {
      await loadCase(page, 'elderly_cad_ckd'); await toRun(page);
      await page.click('#auto-guided');
      assert.equal((await page.textContent('#auto-banner')).trim(), GUIDED_BANNER);
      assert.equal((await page.textContent('#auto-gate')).trim(), 'Transfer to OR');
      let s = await adv(page, 30);
      assert.ok(s.t >= 30 && s.phase === 'premed', `nothing advances without the gate (t ${s.t}, ${s.phase})`);
      await gate(page, 'Transfer to OR');
      // OR setup + preoxygenation: the induction gate counts down and stays disabled with the reason shown
      s = await advanceUntil(page, (x) => x.auto.current && x.auto.current.id === 'start_induction', { maxSec: 300, label: 'induction gate' });
      await page.waitForFunction(() => document.getElementById('auto-gate').textContent.trim() === 'Approve & start induction');
      assert.ok(await page.isDisabled('#auto-gate'), 'induction disabled during preoxygenation');
      assert.ok(await page.isVisible('#auto-countdown')); assert.match(await page.textContent('#auto-countdown'), /available in \d+:\d\d/);
      assert.match(await page.textContent('#auto-unmet'), /Preoxygenation 3 min/);
      await gate(page, 'Approve & start induction');
      s = await waitAuto(page, (x) => x.current && x.current.id === 'secure_airway', { label: 'intubate gate shown' });
      await page.waitForFunction(() => document.getElementById('auto-gate').textContent.trim() === 'Intubate (secure airway)');
      assert.ok(await page.isDisabled('#auto-gate'), 'Intubate disabled before intubating conditions');
      await shot(page, 'auto-guided-induction.png');
      s = await gate(page, 'Intubate (secure airway)');
      assert.ok(s.v.tofCount <= 1 && s.v.depthIndex <= 60, `intubating conditions when enabled: ${JSON.stringify(s.v)}`);
      s = await lite(page);
      assert.equal(s.auto.current.id, 'start_maintenance');
      s = await adv(page, 60);
      assert.equal(s.phase, 'induction', 'maintenance waits for the clinician');
      await gate(page, 'Enter maintenance mode');
      // pre-incision verification: no time-based start; the time out is the clinician's
      s = await advanceUntil(page, (x) => x.auto.current && x.auto.current.id === 'start_surgery', { maxSec: 60, label: 'pre-incision gate' });
      await page.waitForSelector('#auto-checklist:not([hidden])');
      assert.match(await page.textContent('#auto-checklist'), /WHO Surgical Safety Checklist “Time Out” confirmed by the clinician/);
      assert.ok(await page.locator('#auto-checklist .src-tag', { hasText: 'S54' }).count());
      s = await adv(page, 300);
      assert.equal(s.auto.current.id, 'start_surgery', 'surgery never starts on time alone');
      assert.ok(await page.isDisabled('#auto-gate'));
      assert.ok(await page.isVisible('#auto-timing-box')); assert.match(await page.textContent('#auto-timing'), /Premedication|Opioid → hypnotic|Antibiotic/);
      await shot(page, 'auto-guided-preincision.png');
      await gate(page, 'Start surgery (incision)', { clinician: true });
      assert.ok((await simLog(page)).some((e) => e.kind === 'auto' && /^AUTO: step 6\/10 — Start surgery \(approved by the clinician\)/.test(e.message)), 'surgery started through the gate (logged)');
      assert.ok((await simLog(page)).some((e) => /time out confirmed by the clinician/.test(e.message)));
      await shot(page, 'auto-guided-maintenance.png');
      await gate(page, 'End surgery');
      await gate(page, 'Enter emergence / extubation mode');
      s = await waitAuto(page, (x) => x.current && x.current.id === 'extubate', { label: 'extubate gate' });
      if (!s.ready) assert.ok(await page.isDisabled('#auto-gate'), 'Extubate disabled until ready');
      await gate(page, 'Extubate', { chunk: 1 });
      s = await waitAuto(page, (x) => x.state === 'completed', { label: 'guided GA complete' });
      assert.equal((await simState(page)).airway.secured, false);
      await page.click('#mon-debrief'); await page.waitForSelector('#db-auto-note');
      assert.match(await page.textContent('#db-auto-note'), /ran in guided mode/);
      assert.match(await page.textContent('main'), /Extubated at .* readiness met/);
      assert.match(await page.textContent('#db-timing'), /Opioid → hypnotic/); // the elderly example plan has no premedication
      assert.equal(await page.getAttribute('#db-timing [data-check="opioid_hypnotic"]', 'data-status'), 'pass');
      await shot(page, 'auto-guided-debrief.png');
    });

    await t.test('guided mode, MAC (obese OSA example) at 60×', async () => {
      await loadCase(page, 'obese_osa'); await toRun(page);
      await page.click('#auto-guided');
      assert.equal((await page.textContent('#auto-banner')).trim(), GUIDED_BANNER);
      await gate(page, 'Transfer to OR');
      await gate(page, 'Approve & start sedation');
      await gate(page, 'Start procedure', { clinician: true });
      const s = await waitAuto(page, (x) => x.current && x.current.id === 'end_procedure', { label: 'procedure started' });
      assert.equal(s.phase, 'sedation');
      await gate(page, 'End procedure');
      await waitAuto(page, (x) => x.state === 'completed', { label: 'guided MAC complete' });
      await page.click('#mon-debrief'); await page.waitForSelector('#db-auto-note');
      assert.match(await page.textContent('#db-auto-note'), /ran in guided mode/);
    });

    for (const [id, label] of [['mh_susceptible', 'GA (MH-susceptible TIVA)'], ['obese_osa', 'MAC (obese OSA)']]) {
      await t.test(`run full case automatically, ${label} at 60×`, async () => {
        await loadCase(page, id); await toRun(page);
        await page.click('#auto-full');
        assert.equal((await page.textContent('#auto-banner')).trim(), FULL_BANNER);
        await shot(page, `auto-full-${id}-running.png`);
        await waitAuto(page, (x) => x.state === 'completed', { label: `full ${id} complete` });
        const log = await simLog(page);
        assert.ok(log.some((e) => /time out confirmed by the clinician/.test(e.message)), 'time out confirmed by the user, not the runner');
        assert.ok(!log.some((e) => e.kind === 'auto' && /^AUTO: step .*time out/i.test(e.message)));
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
      await page.click('#auto-guided');
      await gate(page, 'Transfer to OR'); await gate(page, 'Approve & start induction');
      await advanceUntil(page, (x) => x.auto.current && x.auto.current.id === 'secure_airway' && x.auto.current.enabled, { maxSec: 900, label: 'intubate gate enabled', resolvePauses: true });
      await page.waitForFunction(() => { const b = document.getElementById('auto-gate'); return b.textContent.trim() === 'Intubate (secure airway)' && !b.disabled; });
      await page.dblclick('#auto-gate');
      await gateIdle(page);
      const s = await autoStatus(page);
      const ids = s.history.map((x) => x.id);
      assert.ok(ids.includes('secure_airway'), 'the shown gate was approved');
      assert.ok(!ids.includes('start_maintenance'), `the next gate was NOT approved by the second click: ${ids.join(',')}`);
      assert.equal(s.current.id, 'start_maintenance'); assert.equal(s.phase, 'induction');
    });

    await t.test('extubation dialog pauses the clock and re-checks readiness at confirm', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      // induction drugs wait for the 2-min premedication; propofol +3:00 and rocuronium +4:00 after fentanyl → asleep after 7 min
      await page.click('#ph-induction'); for (let i = 0; i < 7; i++) await page.click('[data-step="60"]');
      await page.click('#ph-secure');
      // This test checks the real play loop: wall clock on, explicit state conditions only.
      await page.evaluate(() => window.__smartNoa.testClock(false));
      await page.click('[data-speed="60"]'); await page.click('#mon-play');
      const t0 = (await lite(page)).t;
      await page.waitForFunction((x) => window.__smartNoa.lite().t > x, t0);
      await page.click('#ph-extubate'); await page.waitForSelector('#extubate-dialog[open]');
      const a = await simState(page);
      assert.equal(a.playing, false, 'clock paused while the dialog is open');
      await page.waitForTimeout(1000); // paused: no simulated time may pass (any advance would be a failure)
      const b = await simState(page);
      assert.equal(b.t, a.t, `sim time did not advance (${a.t} → ${b.t})`);
      assert.ok(await page.isVisible('#ext-override'), 'not ready: override path offered');
      { // regression (05l final review): the dialog lists the real readiness criteria, never "[object Object]"
        const items = await page.$$eval('#extubate-dialog .ready-list li', (ls) => ls.map((l) => l.textContent));
        assert.ok(items.length >= 4, `readiness rows in the dialog: ${items.length}`);
        for (const row of items) { assert.doesNotMatch(row, /\[object /, row); assert.match(row, / — /, row); }
        assert.ok(items.some((row) => /TOF/i.test(row)), 'TOF criterion listed');
      }
      await page.click('#extubate-dialog .btn:has-text("Cancel")');
      await page.waitForFunction((x) => { const l = window.__smartNoa.lite(); return l.playing && l.t > x; }, b.t);
      const c = await simState(page);
      assert.equal(c.playing, true, 'clock resumes after the dialog closes'); assert.ok(c.t > b.t);
      assert.equal(c.airway.secured, true, 'cancel keeps the tube');
      await page.click('#mon-play'); // pause
      await page.waitForFunction(() => !window.__smartNoa.lite().playing);
      await page.evaluate(() => window.__smartNoa.testClock(true));
    });

    await t.test('reading a citation or pre-filling the form does not end automatic mode', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
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

    await t.test('antibiotic in guided mode: a REQUIRED pre-incision item; the gate waits, nothing is given automatically; the clinician gives it', async () => {
      await toPlan('healthy_adult');
      assert.equal(await page.isChecked('#pl-abx-indicated'), true);
      const card = page.locator('.step-card', { hasText: 'Cefazolin' });
      await card.locator('[data-del]').click();
      assert.ok(!(await planSteps()).some((x) => x.kind === 'antibiotic'));
      assert.match(await page.textContent('#pl-timing'), /Antibiotic before incision/);
      assert.equal(await page.getAttribute('#pl-timing [data-check="antibiotic_window"]', 'data-status'), 'warn');
      await page.click('#pl-continue'); await page.waitForSelector('#mon-play');
      await page.click('#auto-guided');
      await gate(page, 'Transfer to OR'); await gate(page, 'Approve & start induction'); await gate(page, 'Intubate (secure airway)'); await gate(page, 'Enter maintenance mode');
      await advanceUntil(page, (s) => s.auto.current && s.auto.current.id === 'start_surgery', { maxSec: 60, label: 'pre-incision gate' });
      await page.waitForSelector('#auto-checklist:not([hidden])'); await page.waitForSelector('#auto-abx-give:not([hidden])');
      assert.equal(await page.getAttribute('#auto-checklist-items [data-item="antibiotic"]', 'data-met'), 'false');
      await clickIf(page, '#auto-timeout'); await clickIf(page, '#auto-depth-ack');
      const s0 = await adv(page, 240);
      const s1 = await snap(page);
      assert.equal(s1.auto.current.id, 'start_surgery', 'surgery has not started');
      assert.equal(s1.sim.prophylaxis.doses.length, 0, 'never given automatically');
      assert.ok(await page.isDisabled('#auto-gate'), `gate closed while the antibiotic is missing (t ${s0.t})`);
      await elShot('#auto-panel', 'antibiotic-checklist-guided.png');
      await page.click('#auto-abx-give');
      await gate(page, 'Start surgery (incision)', { clinician: true });
      const s2 = await snap(page);
      assert.equal(s2.sim.prophylaxis.doses[0].source, 'clinician');
      assert.equal(s2.sim.prophylaxis.window.ok, true);
      assert.ok(!s2.sim.alarms.some((a) => a.id === 'abx_window'), 'no window alarm');
      await shot(page, 'antibiotic-guided.png');
      await page.click('#auto-takeover');
    });

    await t.test('timing: plan Timing check panel, per-step timing rationale, gate countdown in guided mode', async () => {
      await toPlan('healthy_adult');
      await page.selectOption('#pl-template', 'ga_opioid'); await page.click('#pl-template-apply');
      await page.waitForSelector('#pl-timing [data-check="opioid_hypnotic"]');
      assert.equal(await page.getAttribute('#pl-timing [data-check="opioid_hypnotic"]', 'data-status'), 'pass');
      assert.equal(await page.getAttribute('#pl-timing', 'data-warnings'), '0');
      const fent = page.locator('.step-card', { hasText: 'Fentanyl' }).first();
      assert.match(await fent.locator('.timing-why').textContent(), /Why this time: Opioid given ~3 min before the hypnotic.*simulator convention/);
      assert.match(await page.locator('.step-card', { hasText: 'Dexamethasone' }).locator('.timing-why').textContent(), /PONV prophylaxis \(consensus\)/);
      assert.match(await page.locator('.step-card', { hasText: 'Cefazolin' }).locator('.timing-why').textContent(), /within 60 min before incision \(Bratzler\)/);
      assert.ok(await page.locator('.tl-legend li[title*="Why this time"]').count() > 5, 'timeline tooltips');
      // make propofol too early → the Timing check warns
      const pro = page.locator('.step-card', { hasText: 'Propofol' }).filter({ hasText: 'Induction regimen' }).first();
      const tIn = pro.locator('input.input--time'); await tIn.fill('00:30'); await tIn.dispatchEvent('change');
      await page.waitForSelector('#pl-timing [data-check="opioid_hypnotic"][data-status="warn"]');
      await elShot('#pl-timing', 'plan-timing-check.png');
      await tIn.fill('03:00'); await tIn.dispatchEvent('change');
      await page.waitForSelector('#pl-timing [data-check="opioid_hypnotic"][data-status="pass"]');
      // MAC dexmedetomidine: loading 10 min, then maintenance at 10:00 (shown and checked)
      await page.selectOption('#pl-template', 'mac_dex'); await page.click('#pl-template-apply');
      assert.ok((await planSteps()).some((x) => x.drugId === 'dexmedetomidine' && x.kind === 'infusion' && x.atSec === 600));
      assert.equal(await page.getAttribute('#pl-timing [data-check="loading_maintenance"]', 'data-status'), 'pass');
      // guided countdown before Transfer to OR (opioid template has midazolam premedication)
      await page.selectOption('#pl-template', 'ga_opioid'); await page.click('#pl-template-apply');
      await page.click('#pl-continue'); await page.waitForSelector('#mon-play');
      await page.click('#auto-guided');
      await adv(page, 60);
      await page.waitForSelector('#auto-countdown:not([hidden])');
      assert.match(await page.textContent('#auto-countdown'), /Transfer to OR: available in \d+:\d\d/);
      assert.ok(await page.isDisabled('#auto-gate'));
      await elShot('#auto-panel', 'guided-countdown.png');
      await gate(page, 'Transfer to OR');
      const s = await lite(page);
      assert.ok(s.t >= 420, `transfer no earlier than 5 min after the 2-min premedication (t ${s.t})`);
      await page.click('#auto-takeover');
    });

    await t.test('fluids panel: type, boluses and maintenance; debrief totals by type and lidocaine pretreatment', async () => {
      await toPlan('healthy_adult');
      await page.selectOption('#pl-template', 'ga_opioid'); await page.click('#pl-template-apply');
      await page.selectOption('#pl-fluid-maintenance', 'sodium_chloride_0_9');
      await page.click('#pl-fluid-bolus-250-maintenance');
      assert.ok((await planSteps()).some((x) => x.kind === 'fluid_bolus' && x.drugId === 'sodium_chloride_0_9' && x.phase === 'maintenance'));
      await page.click('#pl-continue'); await page.waitForSelector('#mon-fluids-panel');
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
      await waitAuto(page, (s) => s.state === 'completed', { label: 'full case with fluids' });
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

    await t.test('palliative modules: banner, ethics panel from every screen, pain cases, review gate, EOL sedation gate, phone width', async () => {
      const PAL_BANNER = 'Palliative / end-of-life simulation — fictional patient — educational only. Not medical advice. Palliative sedation is not euthanasia or medical aid in dying; laws differ by jurisdiction.';
      const palSnap = () => page.evaluate(() => window.__smartNoa.pal());
      const palAdv = (min) => page.evaluate((n) => window.__smartNoa.palAdvance(n), min);
      const ethicsOpens = async (where) => { await page.click('#open-ethics'); await page.waitForSelector('#ethics-dialog[open]'); assert.match(await page.textContent('#ethics-body'), /Proportionality/, where); assert.ok(await noHScroll(page), `ethics h-scroll ${where}`); await page.click('#ethics-dialog [data-close-dialog]'); };
      /** Decides every pending review item (approve; rotation declined), re-querying after each click. */
      const decideAll = async () => { for (let i = 0; i < 12; i++) { const b = page.locator('#pal-review [data-decide]').first(); if (!(await b.count())) break; const kind = await b.evaluate((el) => el.closest('[data-kind]').dataset.kind); const ack = page.locator('#pal-review input[id^="ack-"]').first(); if (await ack.count()) await ack.check(); await (kind === 'rotation' ? page.locator('#pal-review [data-decide="decline"]').first() : b).click(); } };
      await page.evaluate(() => window.__smartNoa.palTestClock(true));
      for (const mod of ['pain', 'eol']) {
        await page.click(`#mod-${mod}`); await page.waitForSelector('#pal-example');
        assert.equal((await page.textContent('#pal-banner')).trim(), PAL_BANNER); assert.ok(await page.isVisible('#pal-banner')); assert.ok(await page.isVisible('#open-ethics')); assert.ok(!(await page.isVisible('#stepper-list')));
        const ids = await page.$$eval('#pal-example option', (o) => o.map((x) => x.value));
        assert.equal(ids.length, mod === 'pain' ? 4 : 2);
        for (const id of ids) {
          await page.click('#pal-stepper-1'); await page.selectOption('#pal-example', id); await page.click('#pal-load'); await ethicsOpens(`${id} case`);
          await page.click('#pal-continue'); await page.waitForSelector('#pal-approve'); await ethicsOpens(`${id} plan`);
          if (await page.locator('#pal-red').count()) {
            await page.click('#pal-approve'); await page.waitForSelector('#pal-approve-err'); // no reduction entered: blocked
            await page.fill('#pal-red', '25'); await page.click('#pal-convert'); await page.waitForSelector('#pal-conv-result.notice:not(.notice--warn)');
          }
          if (await page.locator('#pal-warn-ack').count()) await page.check('#pal-warn-ack');
          await page.click('#pal-approve'); await page.waitForSelector('#pal-play'); await ethicsOpens(`${id} run`);
          let s = await palAdv(1440 + 30);
          assert.equal(s.sim.tMin, 1440, `${id}: paused at the daily review`); assert.equal(s.sim.paused.reason, 'review');
          const doseBefore = s.sim.regimen.dose;
          s = await palAdv(60); assert.equal(s.sim.tMin, 1440, `${id}: nothing advances while the review is open`); assert.equal(s.sim.regimen.dose, doseBefore);
          await decideAll(); s = await palSnap(); assert.equal(s.sim.pendingReview, null, `${id}: review decided`);
          if (s.sim.paused) { for (const b of await page.locator('#pal-alarms button[data-ack]:not([disabled])').all()) await b.click(); await page.click('#pal-resume'); }
          s = await palAdv(360); assert.ok(s.sim.tMin > 1440, `${id}: runs after the review`);
          await page.click('#pal-debrief'); await page.waitForSelector('#pal-download'); await ethicsOpens(`${id} debrief`);
          const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pal-download')]); assert.match(dl.suggestedFilename(), /palliative/);
        }
      }
      // EOL refractory-delirium case: documentation gate, approvals, opioid-not-for-sedation, free text as text.
      await page.click('#pal-stepper-1'); await page.selectOption('#pal-example', 'refractory_delirium'); await page.click('#pal-load');
      await page.click('#pal-continue'); await page.click('#pal-approve'); await page.waitForSelector('#pal-sed');
      assert.equal(await page.locator('#pal-gate-missing li').count(), 6); assert.ok(await page.isDisabled('#pal-sed-set')); assert.ok(await page.isDisabled('#pal-sed-apply'));
      await page.selectOption('#pd-ref-symptom', 'agitation'); await page.check('#pd-tried-0'); await page.fill('#pd-ref-why', 'Persisting despite reversible-cause review');
      await page.selectOption('#pd-goc-with', 'surrogate'); await page.fill('#pd-goc-summary', 'Comfort is the priority');
      await page.click('#pd-save'); await page.waitForSelector('#pal-gate-missing');
      assert.equal(await page.locator('#pal-gate-missing li').count(), 4); assert.ok(await page.isDisabled('#pal-sed-set'), 'still disabled with 4 missing');
      await page.selectOption('#pd-consent-type', 'surrogate_consent'); await page.check('#pd-consent-depth'); await page.check('#pd-idt-specialist'); await page.fill('#pd-idt-note', 'Palliative team');
      await page.check('#pd-prognosis'); await page.check('#pd-jurisdiction'); await page.click('#pd-save'); await page.waitForSelector('#pal-gate-ok');
      assert.ok(await page.isEnabled('#pal-sed-set'));
      await page.selectOption('#pal-sed-target', '-2'); await page.click('#pal-sed-set'); await page.click('#pal-sed-bolus'); await page.click('#pal-sed-apply');
      let e = await palSnap(); assert.equal(e.sim.sedation.titrations.length, 3); assert.equal(e.sim.sedation.infusionMgH, 1);
      await page.click('#pal-opioid-sedate'); assert.match(await page.textContent('#pal-feedback'), /not used to produce sedation/);
      await page.fill('#pal-family', '<b>bold?</b> Daughter informed');
      await palAdv(600); e = await palSnap(); assert.equal(e.sim.sedation.infusionMgH, 1, 'no automatic escalation'); assert.ok(e.sim.alarms.every((a) => !a.acknowledged || a.active === false), 'never auto-acknowledged');
      await page.click('#pal-debrief'); await page.waitForSelector('#pal-db-doc');
      assert.equal(await page.textContent('#pal-db-family'), '<b>bold?</b> Daughter informed'); assert.equal(await page.locator('#pal-db-family b').count(), 0, 'free text never rendered as HTML');
      assert.ok(await page.locator('#pal-db-titrations tbody tr').count() >= 3);
      // Phone width: every palliative screen without page-level horizontal scroll.
      await page.setViewportSize({ width: 390, height: 844 });
      for (const n of [1, 2, 3, 4]) { await page.click(`#pal-stepper-${n}`); await page.waitForSelector(`#pal-root[data-step="${n}"]`); assert.ok(await noHScroll(page), `pal step ${n} at 390 px`); await shot(page, `phone-pal-${n}.png`, false); }
      await ethicsOpens('phone');
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.click('#mod-periop'); await page.waitForSelector('#stepper-1'); // perioperative case resumes on the step it was on
      assert.ok(!(await page.isVisible('#pal-banner'))); assert.ok(!(await page.isVisible('#open-ethics'))); assert.ok(await page.isVisible('#stepper-list'));
    });

    await t.test('advisory rescue: appears on induced hypotension, accept gives the bolus, dismiss logs, phone width, debrief', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      assert.ok(await page.locator('#adv').isHidden(), 'no advisory at normal MAP');
      await page.selectOption('#cx-select', 'hemorrhage'); await page.click('#cx-inject');
      let s = await lite(page);
      for (let i = 0; i < 200 && !(await page.isVisible('#adv-accept')); i++) s = await adv(page, 5);
      assert.ok(await page.isVisible('#adv-accept'), `advisory accept visible (MAP ${s.v.map})`);
      assert.ok(s.v.map < 65, `MAP ${s.v.map} < 65`);
      assert.equal(await page.getAttribute('#adv', 'role'), 'region');
      assert.equal(await page.getAttribute('#adv-headline', 'aria-live'), 'polite');
      assert.equal((await page.textContent('#adv-disclaimer')).trim(), 'Advisory only — the simulator never gives a vasopressor by itself.');
      assert.match(await page.textContent('#adv-suggestion'), /Suggested: (Phenylephrine 40 mcg|Ephedrine 5 mg) IV bolus/);
      assert.ok(await page.locator('#adv-suggestion .src-tag').count(), 'source tag on the suggestion');
      let log = (await simLog(page)).map((e) => e.message);
      assert.ok(log.some((m) => /^ADVISORY shown: ADV-1/.test(m)));
      assert.ok(!log.some((m) => /^(Phenylephrine|Ephedrine) .* bolus/.test(m)), 'nothing given before accept');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await noHScroll(page), 'advisory card at 390 px'); await shot(page, 'phone-advisory.png', false);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.click('#adv-accept');
      log = (await simLog(page)).map((e) => e.message);
      assert.ok(log.some((m) => /^ADVISORY accepted by the clinician: ADV-1 — (Phenylephrine 40 mcg|Ephedrine 5 mg) IV bolus \(clinician-approved\)/.test(m)));
      assert.ok(log.some((m) => /^(Phenylephrine 40 mcg|Ephedrine 5 mg) bolus/.test(m)), 'bolus given through the engine');
      assert.match(await page.textContent('#adv'), /Reassess|recovering|MAP/);
      // wait for the next suggestion (after the repeat interval, haemorrhage continues) and dismiss it
      for (let i = 0; i < 300 && !(await page.isVisible('#adv-dismiss')); i++) await adv(page, 5);
      assert.ok(await page.isVisible('#adv-dismiss'), 'second advisory');
      await page.click('#adv-dismiss');
      log = (await simLog(page)).map((e) => e.message);
      assert.ok(log.some((m) => /^ADVISORY dismissed by the clinician: ADV-\d+/.test(m)));
      assert.ok(await page.isHidden('#adv-accept'));
      const rec = await page.evaluate(() => window.__smartNoa.advisories());
      assert.equal(rec.accepted, 1); assert.equal(rec.dismissed, 1);
      await page.click('#mon-debrief'); await page.waitForSelector('#db-advisories');
      assert.match(await page.textContent('#db-advisories'), /accepted 1 · dismissed 1/);
      assert.ok(await page.locator('#db-advisory-list li[data-status="accepted"]').count() === 1);
    });

    await t.test('depth-low advisory (text only): sustained index < 40 in a GA run shows the card (Run + panel), Dismiss logs, no alarm/pause, debrief lists it, phone width', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      assert.ok(await page.locator('#dadv').isHidden(), 'no depth advisory before the case');
      await page.click('#auto-full');
      let s = await lite(page); const t0 = s.t;
      while (!(await page.isVisible('#dadv'))) {
        if (s.auto && s.auto.state === 'paused') { await userResolvesPause(page); s = await lite(page); continue; }
        if (s.auto && ['stopped', 'manual', 'completed'].includes(s.auto.state)) throw new Error(`runner ${s.auto.state} before the depth advisory`);
        if (s.t - t0 > 6000) throw new Error('depth advisory not shown within 6000 simulated s');
        s = await adv(page, 10);
      }
      const x = await snap(page);
      assert.equal(x.sim.phase, 'maintenance'); assert.ok(x.sim.v.depthIndex < 42, `index ${x.sim.v.depthIndex}`);
      assert.ok(x.periop && x.periop.depthAck, 'after the pre-incision acknowledgement (gate unchanged)');
      assert.equal(await page.getAttribute('#dadv', 'role'), 'region');
      assert.equal(await page.getAttribute('#dadv-headline', 'aria-live'), 'polite');
      assert.equal(await page.getAttribute('#auto-dadv-headline', 'aria-live'), 'off', 'only one copy announces');
      assert.ok(await page.isVisible('#auto-dadv'), 'guided/automatic panel copy');
      assert.match(await page.textContent('#dadv-headline'), /^Depth index \d+ below the GA target band \(40–60\) for ≥ 300 s — the anaesthetic may be deeper than needed\.$/);
      assert.match(await page.textContent('#dadv-foot'), /Advisory only — the simulator never changes a dose by itself\. Simulated index \(illustrative\); the 40–60 band is the protocol target used in B-Unaware\/BAG-RECALL/);
      for (const id of ['S52', 'S53']) assert.ok(await page.locator('#dadv-foot .src-tag', { hasText: id }).count(), id);
      const card = await page.textContent('#dadv');
      assert.ok(!/\d\s*(mg|mcg|mL\/h|%)/.test(card), `no dose/rate/percentage in the card: ${card}`);
      assert.equal(await page.locator('#dadv button:not(.src-tag)').count(), 1, 'Dismiss is the only control');
      assert.ok(!x.sim.alarms.some((a) => /depth_low/.test(a.id)), 'no alarm added');
      assert.equal((await lite(page)).auto.state, 'running', 'not paused by the advisory');
      let log = (await simLog(page)).map((e) => e.message);
      assert.ok(log.some((m) => /^ADVISORY shown: DEPTH-1 — processed-EEG depth index \d+ below the GA target band/.test(m)));
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await noHScroll(page), 'depth advisory card at 390 px'); await shot(page, 'phone-depth-advisory.png', false);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.click('#dadv-dismiss');
      log = (await simLog(page)).map((e) => e.message);
      assert.ok(log.some((m) => /^ADVISORY dismissed by the clinician: DEPTH-1 \(depth index below the GA band; text only, no dose changed\)\./.test(m)));
      assert.ok(await page.isHidden('#dadv')); assert.ok(await page.isHidden('#auto-dadv'));
      assert.ok((await lite(page)).auto, 'Dismiss does not end automatic mode');
      const rec = await page.evaluate(() => window.__smartNoa.depthAdvisories());
      assert.equal(rec.dismissed, 1); assert.ok(rec.shown >= 1);
      await waitAuto(page, (y) => y.state === 'completed', { label: 'full healthy GA complete' });
      await page.click('#mon-debrief'); await page.waitForSelector('#db-depth-advisories');
      assert.match(await page.textContent('#db-depth-advisories'), /Shown \d+ · dismissed 1 · time below the band \(40\)/);
      assert.ok(await page.locator('#db-depth-advisory-list li[data-status="dismissed"]').count() === 1);
      assert.match(await page.textContent('#db-depth-below'), /^\d{2}:\d{2}/);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await noHScroll(page), 'debrief at 390 px');
      await page.setViewportSize({ width: 1280, height: 900 });
    });

    await t.test('depth-low and hypotension advisories together: both cards shown, each names the other', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      await adv(page, 760);
      await page.selectOption('#aw-fio2', '1'); await page.click('#aw-fio2-set');
      await page.click('#ph-induction'); await page.click('#aw-mask');
      await advanceUntil(page, (x) => x.v.tofCount === 0 && x.v.depthIndex < 60, { maxSec: 900, label: 'paralysis + depth' });
      await page.click('#ph-secure'); await page.click('#ph-maintenance'); await page.click('#ph-surgery');
      for (let i = 0; i < 300 && !(await page.isVisible('#dadv')); i++) await adv(page, 5);
      assert.ok(await page.isVisible('#dadv'), 'depth advisory in manual GA after incision');
      await page.selectOption('#cx-select', 'hemorrhage'); await page.click('#cx-inject');
      for (let i = 0; i < 300 && !((await page.isVisible('#adv')) && (await page.isVisible('#dadv')) && /hypotension/.test(await page.getAttribute('#adv', 'data-kind') || '')); i++) await adv(page, 5);
      assert.ok(await page.isVisible('#adv') && await page.isVisible('#dadv'), 'both cards visible');
      assert.match(await page.textContent('#adv-cross'), /depth-index advisory is also shown/);
      assert.match(await page.textContent('#dadv-cross'), /haemodynamic rescue advisory is also shown/);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await noHScroll(page), 'both cards at 390 px'); await shot(page, 'phone-both-advisories.png', false);
      await page.setViewportSize({ width: 1280, height: 900 });
    });

    await t.test('example plans show "Why this time" rationale', async () => {
      await loadCase(page, 'obese_osa');
      await page.click('#pf-continue'); await page.waitForSelector('#as-continue');
      await page.click('#as-continue'); await page.waitForSelector('#pl-continue');
      const main = await page.textContent('main');
      assert.match(main, /First, given over at least 2 min/);
      assert.match(main, /Started 4 min after the midazolam starts/);
    });

    await t.test('self-pause re-renders the guided/automatic panel at once (no other control clicked)', async () => {
      for (const mode of ['full', 'guided']) {
        await loadCase(page, 'healthy_adult'); await toRun(page);
        await page.click('[data-speed="5"]');
        await page.evaluate(() => window.__smartNoa.testClock(false));
        await page.click(mode === 'full' ? '#auto-full' : '#auto-guided');
        await page.waitForFunction(() => window.__smartNoa.lite().t > 3);
        await page.evaluate(() => window.__smartNoa.inject('spo2_probe_off'));
        await page.waitForFunction(() => { const a = window.__smartNoa.lite().auto; return a && a.state === 'paused'; }, null, { timeout: 30000 });
        // NO click here: the panel must already show the pause, its reason and the action, with Resume enabled.
        await page.waitForSelector('#auto-paused:not([hidden])', { timeout: 5000 });
        const head = await page.textContent('#auto-paused-head');
        assert.match(head, /^Paused — HIGH alarm: .*SpO2|^Paused — HIGH alarm: /, `${mode}: ${head}`);
        assert.match(head, /then press Resume/, `${mode}: ${head}`);
        assert.match(await page.textContent('#auto-status'), /PAUSED/, `${mode} status`);
        assert.ok(await page.isEnabled('#auto-resume'), `${mode}: Resume enabled`);
        assert.ok(await page.isDisabled('#auto-pause'), `${mode}: Pause disabled`);
        assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'auto-resume', `${mode}: focus moved to Resume`);
        await page.waitForFunction(() => /Paused/.test(document.getElementById('live-assertive').textContent), null, { timeout: 5000 });
        assert.ok((await lite(page)).playing === false, `${mode}: clock stopped`);
        await page.evaluate(() => window.__smartNoa.testClock(true));
        await page.click('[data-speed="20"]');
      }
    });

    await t.test('interlock hold pause offers "Continue with hold latched (this hold only)"; explicit, logged, alarms not acknowledged', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      await page.click('#auto-full');
      await adv(page, 5);
      await page.evaluate(() => window.__smartNoa.inject('map_sensor_fault'));
      // first pause: the HIGH sensor-fault alarm (the interlock reads the unusable value on the next second)
      await advanceUntil(page, (x) => x.auto && x.auto.state === 'paused', { maxSec: 30, chunk: 1, label: 'alarm pause' });
      assert.ok(await page.isHidden('#auto-hold-continue'), 'not offered for an alarm-only pause');
      for (const b of await page.locator('#mon-alarms button[data-ack]:not([disabled])').all()) await b.click();
      await page.click('#auto-resume');
      await advanceUntil(page, (x) => x.auto && x.auto.state === 'paused', { maxSec: 30, chunk: 1, label: 'hold pause' });
      await page.waitForSelector('#auto-hold-continue:not([hidden])');
      assert.match(await page.textContent('#auto-paused-head'), /Interlock hold latched/);
      await page.click('#auto-hold-continue');
      const log = await simLog(page);
      assert.ok(log.some((l) => /Clinician chose to continue with hold latched/.test(l.message)));
      const st = await snap(page);
      assert.ok(st.sim.interlocks.holdLatched, 'hold not released');
      const iChoice = log.findIndex((l) => /Clinician chose to continue with hold latched/.test(l.message));
      assert.ok(!log.slice(iChoice).some((l) => /Alarm acknowledged/.test(l.message)), 'the choice acknowledges no alarm');
      if (st.auto.state === 'paused') { for (const b of await page.locator('#mon-alarms button[data-ack]:not([disabled])').all()) await b.click(); await page.click('#auto-resume'); }
      const after = await adv(page, 20);
      assert.equal(after.auto.state, 'running', 'the same hold does not pause again');
      await page.click('#auto-takeover');
    });

    await t.test('user pause banner reads cleanly (no double period)', async () => {
      await loadCase(page, 'healthy_adult'); await toRun(page);
      await page.click('#auto-guided'); await page.click('#auto-pause');
      await page.waitForSelector('#auto-paused:not([hidden])', { timeout: 5000 });
      const head = await page.textContent('#auto-paused-head');
      assert.match(head, /^Paused — Paused by the user\. Press Resume/, head);
      assert.ok(!/\.\./.test(head), `no double period: ${head}`);
    });

    await t.test('alarm list is reconciled by id (audit 05l): the Acknowledge button of a HIGH alarm survives renders while its text changes; focus kept; a click acknowledges at 20x', async () => {
      await loadCase(page, 'elderly_cad_ckd'); await toRun(page);
      await page.evaluate(() => { window.__smartNoa.inject('hemorrhage'); window.__smartNoa.inject('anaphylaxis_hypotension'); });
      const crit = (x) => x.alarms && x.alarms.some((a) => a.id === 'map_critical' && a.active && !a.acknowledged);
      let x = await simState(page);
      for (let i = 0; i < 400 && !crit(x); i++) { await adv(page, 5); x = await simState(page); }
      assert.ok(crit(x), 'HIGH map_critical alarm active and unacknowledged');
      const sel = '#mon-alarms button[data-ack="map_critical"]';
      const btn = await page.$(sel);
      assert.ok(btn && await btn.isEnabled());
      const same = () => btn.evaluate((el, q) => el.isConnected && document.querySelector(q) === el, sel);
      const msgOf = (q) => { const el = document.querySelector(q); return el ? el.closest('li').querySelector('.alarm__msg').firstChild.textContent : null; };
      const msg = () => page.evaluate(msgOf, sel);
      // Other live lists with controls are keyed too: a source-tag button in the extubation readiness list
      // (its values change every render) is the same element across renders.
      const rtag = await page.$('#mon-ready .src-tag');
      const readyText = () => page.textContent('#mon-ready');
      const r0 = await readyText();
      await btn.focus();
      // Step-driven: several renders, the message text changes, the element (and focus) stays.
      const texts = new Set([await msg()]);
      for (let i = 0; i < 60 && texts.size < 4; i++) { await adv(page, 1); assert.ok(await same(), `same element after render ${i + 1}`); texts.add(await msg()); }
      assert.ok(texts.size >= 3, `message text changed across renders (${[...texts].join(' | ')})`);
      assert.ok(rtag, 'readiness list has a source-tag button'); assert.ok(await rtag.evaluate((el) => el.isConnected), 'readiness source-tag button kept'); assert.notEqual(await readyText(), r0, 'readiness values changed meanwhile');
      assert.ok(await btn.evaluate((el) => document.activeElement === el), 'focus kept on the Acknowledge button');
      // Real time at 20x (150 ms renders): the handle survives while the reading changes, then a click acknowledges.
      await page.click('[data-speed="20"]');
      await page.evaluate(() => window.__smartNoa.testClock(false));
      if (!(await lite(page)).playing) await page.click('#mon-play');
      const live = new Set([await msg()]);
      for (let i = 0; i < 40 && live.size < 4; i++) {
        await page.waitForFunction(([q, prev]) => { const el = document.querySelector(q); return !el || el.closest('li').querySelector('.alarm__msg').firstChild.textContent !== prev; }, [sel, await msg()], { timeout: 10000 });
        assert.ok(await same(), `same element while playing at 20x (text ${live.size})`);
        live.add(await msg());
      }
      assert.ok(live.size >= 3, `text changed while playing (${[...live].join(' | ')})`);
      assert.ok((await lite(page)).playing, 'clock still running');
      await btn.click();
      assert.ok(await same(), 'still the same element after the click');
      await page.waitForFunction((q) => document.querySelector(q).disabled, sel, { timeout: 5000 });
      x = await simState(page);
      assert.ok(x.alarms.some((a) => a.id === 'map_critical' && a.acknowledged), 'map_critical acknowledged by the click');
      assert.equal(await btn.textContent(), 'Acknowledged');
      if ((await lite(page)).playing) await page.click('#mon-play');
      await page.evaluate(() => window.__smartNoa.testClock(true));
      const log = (await simLog(page)).map((e) => e.message);
      assert.equal(log.filter((m) => m === 'Alarm acknowledged: map_critical').length, 1, 'acknowledged once, by the click');
    });

    await t.test('palliative alarm list is reconciled by id (audit 05l): the Acknowledge button survives refreshes (step-driven and on the 250 ms timer); focus kept; a click acknowledges', async () => {
      const palSnap = () => page.evaluate(() => window.__smartNoa.pal());
      const palAdv = (min) => page.evaluate((n) => window.__smartNoa.palAdvance(n), min);
      await page.evaluate(() => window.__smartNoa.palTestClock(true));
      await page.click('#mod-pain'); await page.waitForSelector('#pal-example');
      await page.click('#pal-stepper-1'); await page.selectOption('#pal-example', 'naive_ckd_inpatient'); await page.click('#pal-load');
      await page.click('#pal-continue'); await page.waitForSelector('#pal-approve');
      if (await page.isChecked('#pal-bowel')) await page.uncheck('#pal-bowel'); // scheduled opioid without a bowel regimen → LOW alarm (no pause)
      if (await page.locator('#pal-red').count()) { await page.fill('#pal-red', '25'); await page.click('#pal-convert'); }
      if (await page.locator('#pal-warn-ack').count()) await page.check('#pal-warn-ack');
      await page.click('#pal-approve'); await page.waitForSelector('#pal-play');
      let s = await palAdv(5);
      for (let i = 0; i < 60 && !s.sim.alarms.some((a) => !a.acknowledged); i++) s = await palAdv(5);
      const al = s.sim.alarms.find((a) => !a.acknowledged);
      assert.ok(al, `an unacknowledged palliative alarm (${JSON.stringify(s.sim.alarms.map((a) => a.id))})`);
      assert.equal(s.sim.paused, null, 'not paused (non-HIGH alarm), so the timer keeps refreshing the list');
      const sel = `#pal-alarms button[data-ack="${al.id}"]`;
      const btn = await page.$(sel);
      const same = () => btn.evaluate((el, q) => el.isConnected && document.querySelector(q) === el, sel);
      await btn.focus();
      for (let i = 0; i < 5; i++) { await palAdv(1); assert.ok(await same(), `same element after refresh ${i + 1}`); }
      assert.ok(await btn.evaluate((el) => document.activeElement === el), 'focus kept on the Acknowledge button');
      // Real 250 ms timer: several refreshes (the clock text changes), the element and focus stay.
      await page.evaluate(() => window.__smartNoa.palTestClock(false));
      const t0 = (await palSnap()).sim.tMin;
      await page.click('#pal-play'); await btn.focus(); // the click moved focus to Play; put it back on the button
      const t1 = (await palSnap()).sim.tMin;
      await page.waitForFunction((m) => window.__smartNoa.pal().sim.tMin > m + 3, Math.max(t0, t1), { timeout: 10000 });
      assert.ok(await same(), 'same element after timer refreshes');
      assert.ok(await btn.evaluate((el) => document.activeElement === el), 'focus kept while playing');
      await btn.click();
      await page.waitForFunction((q) => { const el = document.querySelector(q); return !el || el.disabled; }, sel, { timeout: 5000 });
      s = await palSnap();
      assert.ok(!s.sim.alarms.some((a) => a.id === al.id && !a.acknowledged), `${al.id} acknowledged by the click`);
      if ((await page.textContent('#pal-play')).trim() === 'Pause') await page.click('#pal-play');
      await page.evaluate(() => window.__smartNoa.palTestClock(true));
      await page.click('#mod-periop'); await page.waitForSelector('#stepper-1');
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

    const junk = await page.evaluate(() => [...new Set(window.__junkText)]);
    assert.deepEqual(junk, [], `text rendered as null/undefined/NaN/[object …]:\n${junk.join('\n')}`);
    assert.deepEqual(problems, [], `console/CSP/network problems:\n${problems.join('\n')}`);
  } finally {
    await browser.close();
    if (server) await new Promise((r) => { server.close(r); });
  }
});
