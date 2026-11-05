// Browser smoke test for the simulator UI (Playwright + Chromium).
// Not part of `node --test simulator/tests` (only *.test.mjs files are loaded there).
// Run:  (cd <repo root> && python3 -m http.server 8765) &   then
//       node --test simulator/tests/ui.smoke.mjs
// Env:  SIM_URL (default http://localhost:8765/simulator/index.html), SHOTS_DIR (optional screenshot folder).
// Skips itself when Playwright or the static server is unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL_ = process.env.SIM_URL || 'http://localhost:8765/simulator/index.html';
const SHOTS = process.env.SHOTS_DIR || null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let chromium = null;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { try { chromium = (await import('playwright')).chromium; } catch { chromium = null; } }
let serverUp = false;
try { const r = await fetch(URL_); serverUp = r.ok; } catch { serverUp = false; }
const skip = !chromium ? 'playwright not installed' : !serverUp ? `no static server at ${URL_}` : false;

const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name), fullPage: full }); };
const simState = (page) => page.evaluate(() => { const s = window.__smartNoa.store.sim; return s ? JSON.parse(JSON.stringify({ t: s.state.tSec, phase: s.state.phase, v: s.state.vitals, il: s.state.interlocks.status, airway: s.state.airway, ready: s.extubationReadiness().ready })) : null; });
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
const autoStatus = (page) => page.evaluate(() => { const a = window.__smartNoa.store.run.auto; const s = window.__smartNoa.store.sim; return a ? JSON.parse(JSON.stringify({ ...a.status(), t: s.state.tSec, phase: s.state.phase, v: s.state.vitals, ready: s.extubationReadiness().ready })) : null; });
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
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`); });
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
      const log = await page.evaluate(() => window.__smartNoa.store.sim.state.log.map((e) => e.message).join('\n'));
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
      const log = await page.evaluate(() => window.__smartNoa.store.sim.state.log.map((e) => e.message).join('\n'));
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
      assert.ok(await page.evaluate(() => window.__smartNoa.store.sim.state.log.some((e) => e.kind === 'auto' && /^AUTO: step 4\/8 — Start surgery \(automatic within the approved phase\)/.test(e.message))), 'surgery started automatically (logged)');
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
        const log = await page.evaluate(() => window.__smartNoa.store.sim.state.log);
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
  }
});
