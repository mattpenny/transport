/*
 * check-empty-stops.js — when the upstream API returns NO stops, the page must
 * explain itself instead of showing a blank panel.
 * ===========================================================================
 * Reported symptom (2026-10-02): "I inputted mtr bus K75S, there is only 1
 * route, but there is no response — 最近三班候車時間 / 請先選擇巴士站."
 *
 * Root cause: some MTR Bus routes come back from the official API with
 * `busStop: []` — K14, K52P, K75S and K506 at the time of writing, and this
 * set DRIFTS: a route can be empty today and populated tomorrow. The API
 * announces this itself with `routeStatus: "1"` plus a human-readable
 * `routeStatusRemarkTitle` ("到站時間暫時未能提供"); healthy routes carry
 * `routeStatus: "0"` and a null remark.
 *
 * The page ignored that. `selectDirection()` did
 *     stops.value = detailed.filter(s => isValidCoord(s.lat, s.lng));
 * which for an empty list produced `[]`. Both the stop heading and the stop
 * list are gated on `v-if="stops.length"`, so both vanished, `error` was never
 * set, and the Console stayed clean. The user saw a working direction chip,
 * then nothing, then "請先選擇巴士站" forever — which reads as a broken app
 * when it is actually a data gap upstream.
 *
 * The fix surfaces the official message (never a hardcoded route list, or it
 * goes stale the moment the MTR fixes or renames a route).
 *
 * What this probe asserts (the two ways this can be wrong):
 *   A. Empty stop table  → the official notice IS shown, and the ETA panel
 *      does not say the useless "請先選擇巴士站" (the user has nothing to pick).
 *   B. Route with stops  → the notice is GONE. This is the stale-state trap:
 *      Vue does not clear a ref for us, so a missed reset leaves last route's
 *      "temporarily unavailable" glued onto a perfectly healthy route.
 *   C. A route whose rows are missing from stops-index still must not crash —
 *      no page errors anywhere.
 *
 * `--teeth` proves the probe can fail. The defect lives inside `setup()`'s
 * closures, so it cannot be stubbed from outside; the honest sabotage is to
 * serve the PRE-FIX page. Prepare it first, then run with --teeth:
 *     git show HEAD:index.html > __prefix.html
 *     node tools/check-empty-stops.js --teeth
 * Pre-fix, case A must go RED. (The probe does not shell out to git itself:
 * spawning a shell from the sandbox fails with EBUSY, and a probe that cannot
 * start proves nothing.)
 *
 * NOTE: this probe depends on live upstream data. If the MTR brings K75S back,
 * case A will fail for the RIGHT reason (no empty route to test) and the probe
 * will say so loudly rather than silently passing — see the guard below.
 *
 * Usage: node tools/check-empty-stops.js [--url http://127.0.0.1:8000] [--teeth]
 */
const { chromium } = require('./pw');
const fs = require('fs');
const path = require('path');

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();
const TEETH = process.argv.includes('--teeth');

const TEETH_PAGE = '__prefix.html';
let page = 'index.html';
if (TEETH) {
  const full = path.join(__dirname, '..', TEETH_PAGE);
  if (!fs.existsSync(full)) {
    console.log(`[teeth] ${TEETH_PAGE} not found. Create it first with:`);
    console.log(`         git show HEAD:index.html > ${TEETH_PAGE}`);
    process.exit(2);
  }
  page = TEETH_PAGE;
  console.log(`[teeth] testing the pre-fix page ${TEETH_PAGE} (${fs.statSync(full).size} bytes)`);
}

/* EMPTY = MTR Bus route whose upstream stop table is empty at the time of
   writing. Control = a route on the same API/company that HAS stops, so any
   difference we see is attributable to the data, not to the company path. */
const EMPTY = 'K75S';
const CONTROL = 'K54';

let failed = false;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failed = true;
};

async function searchMtr(p, route) {
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.company-btn')].find(x => (x.textContent || '').includes('港鐵巴士'));
    if (b) b.click();
  });
  await p.waitForTimeout(1000);
  await p.evaluate((r) => {
    const inp = document.querySelector('.row input');
    inp.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, r);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '查詢');
    if (btn) btn.click();
  }, route);
  /* The MTR API is a live POST; give it room. */
  await p.waitForTimeout(7000);
}

const snapshot = (p) => p.evaluate(() => {
  const vis = (sel) => {
    const n = document.querySelector(sel);
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const txt = (sel) => {
    const n = document.querySelector(sel);
    return n ? (n.textContent || '').replace(/\s+/g, ' ').trim() : null;
  };
  return {
    noticeVisible: vis('.stops-notice'),
    noticeText: txt('.stops-notice'),
    stopCount: document.querySelectorAll('.stop-list li').length,
    etaHint: txt('.hint'),
    directionChip: txt('.direction-chip'),
  };
});

(async () => {
  const browser = await chromium.launch({ executablePath: require('./pw').CHROME, headless: true });

  /* ---------- A + B share one page: search EMPTY, then search CONTROL.
         Doing both in sequence is the point — B is only meaningful as the
         transition away from A. ---------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await p.goto(`${argUrl}/${page}`, { waitUntil: 'load' });
  await p.waitForTimeout(2500);

  console.log(`\n=== A) empty stop table: ${EMPTY} ===`);
  await searchMtr(p, EMPTY);
  const a = await snapshot(p);
  console.log('  state:', JSON.stringify(a));

  if (a.stopCount > 0) {
    /* The upstream brought the route back — the fixture is gone. Say so
       instead of quietly passing a test that tested nothing. */
    check(false, `fixture still valid — ${EMPTY} must come back with an EMPTY stop table`,
      `(got ${a.stopCount} stops; upstream has recovered, pick another empty route)`);
  } else {
    check(a.noticeVisible, 'empty stop table shows an explanation (not a blank panel)');
    check(!!a.noticeText && /未能提供|暫無|暫時|無法/.test(a.noticeText),
      'the explanation is the official wording', JSON.stringify(a.noticeText));
    check(a.etaHint !== '請先選擇巴士站',
      'ETA panel does not tell the user to pick a stop that does not exist',
      JSON.stringify(a.etaHint));
    check(a.directionChip !== null, 'the route itself still shows (direction chip present)',
      JSON.stringify(a.directionChip));
  }

  console.log(`\n=== B) route WITH stops: ${CONTROL} (stale-state trap) ===`);
  await searchMtr(p, CONTROL);
  const b = await snapshot(p);
  console.log('  state:', JSON.stringify(b));
  check(b.stopCount > 0, 'control route loaded its stops', `stops=${b.stopCount}`);
  check(!b.noticeVisible,
    'notice from the previous route is CLEARED (Vue will not clear the ref for us)',
    `noticeText=${JSON.stringify(b.noticeText)}`);
  check(b.etaHint === '請先選擇巴士站',
    'control route shows the normal pick-a-stop hint again', JSON.stringify(b.etaHint));

  check(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));

  await ctx.close();
  await browser.close();

  console.log('');
  if (TEETH) {
    /* Pre-fix, case A had no notice at all → the probe must be RED. */
    if (failed) console.log('TEETH: OK — the probe went RED on the pre-fix page, so it can fail.');
    else {
      console.log('TEETH: BROKEN — the probe PASSED on the pre-fix page, so its assertions are not');
      console.log('       testing what we think. Do not trust a green run.');
    }
    process.exit(failed ? 0 : 1);
  }
  console.log(`RESULT: ${failed ? 'FAIL' : 'ALL PASS'}`);
  process.exit(failed ? 1 : 0);
})();
