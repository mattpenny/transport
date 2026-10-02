/*
 * check-single-direction.js — a route with only ONE direction must never strand
 * the user on "請先選擇巴士站".
 * ===========================================================================
 * Reported symptom: "if there is only one direction for a bus, the app shows
 * the route but no 最近三班候車時間 is fetched."
 *
 * Root cause found (2026-10-02): the direction picker is gated on
 * `matchedRoutes.length > 1` — with a single direction it renders NOTHING. But
 * `clearDirection()` (fired by clicking the 方向 chip) set
 * `pickingDirection = true` and wiped `selectedDirectionLabel`, so the screen
 * became: no chip, no picker, cleared stops, cleared ETAs — a dead end with no
 * error message and no way back to the only direction that exists.
 *
 * The fix makes `clearDirection()` reselect the sole direction when there is
 * only one (there is nothing to choose, so "clearing" is meaningless).
 *
 * This probe drives the REAL user path for both cases:
 *   A. single direction — search, then click the 方向 chip. The route must stay
 *      loaded (chip present, stops present, ETAs present).
 *   B. multiple directions — clicking the chip must STILL show the picker, and
 *      re-picking a direction must restore stops + ETAs. (A fix for A must not
 *      break B.)
 *
 * `--teeth` proves the probe can fail. Unlike the geolocation probe (where the
 * defect could be emulated by stubbing a browser API), this defect lives inside
 * the app's own `clearDirection()` — a closure we cannot patch from outside. So
 * the honest sabotage is to serve the PRE-FIX page instead of the current one.
 *
 * Prepare the old page first, then run the probe with --teeth:
 *     git show HEAD:index.html > __prefix.html
 *     node tools/check-single-direction.js --teeth
 * The probe serves `__prefix.html` and MUST go red on case A. If it still
 * passes, the assertions are not testing the thing we think they are.
 *
 * (The probe does not shell out to git itself: spawning a shell from the
 * sandbox fails with EBUSY, and a probe that can't start proves nothing.)
 *
 * Usage: node tools/check-single-direction.js [--url http://127.0.0.1:8000] [--teeth]
 */
const { chromium } = require('./pw');
const fs = require('fs');
const path = require('path');

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();
const TEETH = process.argv.includes('--teeth');

/* Under --teeth, test a page the caller prepared (the pre-fix file). */
const TEETH_PAGE = '__prefix.html';
let teethPage = 'index.html';
if (TEETH) {
  const full = path.join(__dirname, '..', TEETH_PAGE);
  if (!fs.existsSync(full)) {
    console.log(`[teeth] ${TEETH_PAGE} not found. Create it first with:`);
    console.log(`         git show HEAD:index.html > ${TEETH_PAGE}`);
    process.exit(2);
  }
  teethPage = TEETH_PAGE;
  console.log(`[teeth] testing the pre-fix page ${TEETH_PAGE} (${fs.statSync(full).size} bytes)`);
}

/* 273 = KMB 粉嶺(華明) → 粉嶺站(循環線), a single-direction route.
   44M = multi-direction, used as the control. */
const SINGLE = '273';
const MULTI = '44M';

let failed = false;
function check(cond, label, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) failed = true;
  return cond;
}

async function search(p, routeNo, { pickFirstDir } = {}) {
  await p.evaluate((r) => {
    const inp = document.querySelector('.row input');
    if (!inp) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, r);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, routeNo);
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '查詢');
    if (b) b.click();
  });
  /* Wait for the direction picker (multi) or the auto-select (single). */
  for (let i = 0; i < 15; i++) {
    await p.waitForTimeout(1000);
    const ready = await p.evaluate(() => ({
      rows: document.querySelectorAll('.direction-picker li').length,
      stops: document.querySelectorAll('.stop-list li').length,
    }));
    if (pickFirstDir && ready.rows > 0) {
      await p.evaluate(() => { document.querySelectorAll('.direction-picker li')[0].click(); });
      await p.waitForTimeout(6000);
      return;
    }
    if (!pickFirstDir && ready.stops > 0) { await p.waitForTimeout(4000); return; }
  }
}

const snap = (p) => p.evaluate(() => ({
  chip: (() => { const e = document.querySelector('.direction-chip'); return e ? e.textContent.trim() : null; })(),
  pickerRows: document.querySelectorAll('.direction-picker li').length,
  stops: document.querySelectorAll('.stop-list li').length,
  etaRows: document.querySelectorAll('.eta-box li .rank').length,
}));

async function run(browser, label, viewport, mobile) {
  console.log(`\n=== ${label} (${viewport.width}x${viewport.height}) ===`);
  const ctx = await browser.newContext({
    viewport, isMobile: mobile, hasTouch: mobile,
    locale: 'zh-HK', timezoneId: 'Asia/Hong_Kong',
    permissions: ['geolocation'],
    geolocation: { latitude: 22.3193, longitude: 114.1694, accuracy: 10 },
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await p.goto(`${argUrl}/${teethPage}`, { waitUntil: 'load' });
  await p.waitForTimeout(2500);

  /* ---------- A. single direction ---------- */
  await search(p, SINGLE);
  const a0 = await snap(p);
  console.log(`  [A] after searching ${SINGLE} (single direction): ${JSON.stringify(a0)}`);
  check(a0.stops > 0, `[A] single-direction route loaded its stops`);
  check(a0.etaRows > 0, `[A] single-direction route fetched ETAs`);

  const hadChip = await p.evaluate(() => {
    const c = document.querySelector('.direction-chip');
    if (!c) return false;
    c.click(); return true;
  });
  await p.waitForTimeout(3500);
  const a1 = await snap(p);
  console.log(`  [A] after clicking the 方向 chip: ${JSON.stringify(a1)}`);
  if (hadChip) {
    check(a1.stops > 0, '[A] stops survive the chip click (no dead end)');
    check(a1.etaRows > 0, '[A] ETAs survive the chip click');
    check(!!a1.chip, '[A] a direction is still shown (chip present)');
  } else {
    console.log('  (no chip to click — skipping; route may not be single-direction)');
  }

  /* ---------- B. multiple directions (control) ---------- */
  await search(p, MULTI, { pickFirstDir: true });
  const b0 = await snap(p);
  console.log(`  [B] after searching ${MULTI} + picking a direction: ${JSON.stringify(b0)}`);
  check(b0.stops > 0 && b0.etaRows > 0, '[B] multi-direction route loaded stops + ETAs');

  const hadChipB = await p.evaluate(() => {
    const c = document.querySelector('.direction-chip');
    if (!c) return false;
    c.click(); return true;
  });
  await p.waitForTimeout(2000);
  const b1 = await snap(p);
  console.log(`  [B] after clicking the 方向 chip: ${JSON.stringify(b1)}`);
  if (hadChipB) {
    check(b1.pickerRows > 1, '[B] multi-direction: picker returns with every direction',
          `${b1.pickerRows} rows`);
  }

  check(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' || '));
  if (errs.length) errs.slice(0, 5).forEach(e => console.log('    err:', e));

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--enable-features=NetworkService'],
  });
  try {
    await run(browser, 'DESKTOP', { width: 1440, height: 900 }, false);
  } finally {
    await browser.close();
  }

  if (TEETH) {
    /* The caller prepared __prefix.html; leave it for them to inspect or delete. */
    if (failed) {
      console.log('\nTEETH: OK — the probe went RED on the pre-fix page, so it can fail.');
      process.exit(0);
    }
    console.log('\nTEETH: BROKEN — the probe PASSED against the pre-fix page, so its assertions prove nothing.');
    process.exit(1);
  }
  console.log(`\nRESULT: ${failed ? 'FAIL' : 'ALL PASS'}`);
  process.exit(failed ? 1 : 0);
})();
