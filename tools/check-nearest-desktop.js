/*
 * check-nearest-desktop.js — do BOTH layouts locate the nearest bus stop and
 * show distances?
 * ===========================================================================
 * Reported symptom: "desktop mode can't get the nearest bus stops; it seems not
 * working."
 *
 * Root cause found (2026-10-02): Chromium services only ONE geolocation request
 * at a time per origin. An active `watchPosition` starves a subsequent
 * `getCurrentPosition` — it never calls back, and `options.timeout` does NOT
 * fire either. `autoLocateNearestStop()` called `startGeoWatch()` BEFORE
 * `await getUserPosition()`, and `silentLocateForRegion()` had usually already
 * started a watch at page load, so the await hung forever. Everything after it
 * (distance computation, auto-selection) was skipped, with a clean console.
 *
 * The bug was never desktop-only: the code path is shared, so MOBILE was broken
 * too. This probe therefore checks BOTH viewports — that is the only way to
 * notice a "shared path" bug that a desktop-only report points at.
 *
 * Asserts, per viewport:
 *   1. `.distance` labels appear in the stop list (distances were computed)
 *   2. every label parses, is plausible, and they VARY across stops (proving a
 *      real per-stop computation, not one value copied)
 *   3. a stop got auto-selected (the "auto-locate nearest" contract)
 *   4. no page errors
 *
 * Geolocation is granted AND stubbed: in a headless browser the real API would
 * just fail, which would test "we can't locate" instead of "the UI renders
 * distances". Stubbing isolates the plumbing bug from the absence of a GPS
 * radio.
 *
 * `--teeth` proves this probe can fail: it reloads the page and re-introduces
 * the original ordering bug (start the watch before asking for a position) by
 * stubbing watchPosition to occupy the geolocation channel. Under sabotage the
 * probe MUST go red — an always-green probe is worse than none, because it
 * certifies broken code as fixed.
 *
 * Usage: node tools/check-nearest-desktop.js [--url http://127.0.0.1:8000] [--teeth]
 */
const { chromium } = require('./pw');

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();
const TEETH = process.argv.includes('--teeth');

/* A position in Hong Kong. Note it does NOT need to be near the searched route:
   the contract is that distances are computed correctly for whatever position
   we report, not that they are small. An earlier version of this probe asserted
   "< 5 km" and failed on a correct page — the assertion was wrong, not the app. */
const USER_LAT = 22.3193;   /* 旺角一帶 */
const USER_LNG = 114.1694;

let failed = false;
function check(cond, label, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) failed = true;
  return cond;
}

async function run(browser, label, viewport, mobile) {
  console.log(`\n=== ${label} (${viewport.width}x${viewport.height}, isMobile=${mobile}) ===`);
  const ctx = await browser.newContext({
    viewport, isMobile: mobile, hasTouch: mobile,
    locale: 'zh-HK', timezoneId: 'Asia/Hong_Kong',
    permissions: ['geolocation'],
    geolocation: { latitude: USER_LAT, longitude: USER_LNG, accuracy: 10 },
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  /* --teeth: re-create the original defect so we can prove the probe catches it.
     The defect was "a busy geolocation channel". Emulate it honestly: make
     watchPosition occupy the channel and make getCurrentPosition never call
     back, which is exactly what Chromium did when a watch was already running.
     If the app is correct it will still settle (its own deadline fires) and the
     distance assertions will still fail — which is the point: the probe must go
     RED here. */
  if (TEETH) {
    await p.addInitScript(() => {
      const realGet = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      const realWatch = navigator.geolocation.watchPosition.bind(navigator.geolocation);
      window.__watchActive = false;
      navigator.geolocation.watchPosition = function (ok, err, opts) {
        window.__watchActive = true;
        return realWatch(ok, err, opts);
      };
      navigator.geolocation.getCurrentPosition = function (ok, err, opts) {
        /* Simulate the starvation: once a watch is active, silently swallow the
           call — no success, no error, ever. */
        if (window.__watchActive) return;
        return realGet(ok, err, opts);
      };
    });
  }

  await p.goto(`${argUrl}/index.html`, { waitUntil: 'load' });
  await p.waitForTimeout(2500);

  /* Search a route that definitely has stops: 44M worked in other probes. */
  const route = '44M';
  await p.evaluate((r) => {
    const inp = document.querySelector('.row input');
    if (!inp) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, r);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, route);
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '查詢');
    if (b) b.click();
  });

  /* A route with more than one variant shows a 方向 (direction) picker first and
     NOTHING loads until a direction is chosen — the stop list stays empty and
     the page says "請先選擇巴士站". The probe must pick one, otherwise it tests
     the pre-search state and fails for the wrong reason.

     The picker items are list entries inside the sidebar, not <button>s, so find
     them by their text and click the element itself.
     Retry a few times: on a slow CDN the picker can take a while to appear, and
     on mobile the layout shifts as it renders. */
  let picked = null;
  for (let attempt = 0; attempt < 12 && !picked; attempt++) {
    await p.waitForTimeout(1000);
    picked = await p.evaluate(() => {
      const all = [...document.querySelectorAll('li, .dir-item, .direction-item, .route-item')];
      const rows = all.filter(el => /\s*(→|->|往)\s*/.test(el.textContent || '') && el.offsetParent !== null);
      if (!rows.length) return null;
      const t = (rows[0].textContent || '').trim();
      rows[0].click();
      return t.slice(0, 40);
    });
  }
  console.log(`  direction picked: ${picked || '(none — picker not shown)'}`);
  /* Give autoLocateNearestStop time: it yields the watch, reads a position
     (stubbed, so fast), computes distances, then fetches ETA for the nearest. */
  await p.waitForTimeout(5000);

  /* Give autoLocateNearestStop time: it calls getCurrentPosition (stubbed, so
     fast) then applySelection which fetches ETA. */
  await p.waitForSelector('.stop-list li', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(4000);

  const state = await p.evaluate(() => {
    const list = document.querySelector('.stop-list') || document.querySelector('ul.stop-list') || document.body;
    const distEls = [...document.querySelectorAll('.stop-list .distance')];
    const items = [...document.querySelectorAll('.stop-list li')];
    const named = items.map(li => {
      const n = li.querySelector('.stop-name');
      const d = li.querySelector('.distance');
      return { name: n ? n.textContent.trim() : '', dist: d ? d.textContent.trim() : null };
    }).filter(x => x.name);
    const active = items.find(li => li.classList.contains('active'));
    return {
      listFound: !!document.querySelector('.stop-list'),
      itemCount: items.length,
      distCount: distEls.length,
      distTexts: distEls.map(e => e.textContent.trim()),
      samples: named.slice(0, 6),
      activeName: active ? (active.querySelector('.stop-name') || {}).textContent : null,
      userMarker: !!document.querySelector('.user-marker, .leaflet-marker-icon.user-dot, .my-location'),
      mapCount: document.querySelectorAll('.leaflet-container').length,
    };
  });

  console.log(`  stop list found: ${state.listFound}  items: ${state.itemCount}  maps: ${state.mapCount}`);
  console.log(`  distance labels: ${state.distCount}  -> ${state.distTexts.slice(0, 6).join(', ') || '(none)'}`);
  console.log(`  samples: ${state.samples.map(s => `${s.name}${s.dist ? ' [' + s.dist + ']' : ''}`).join(' | ')}`);
  console.log(`  auto-selected stop: ${state.activeName || '(none)'}`);

  check(state.itemCount > 0, 'stop list rendered');
  check(state.distCount > 0, 'distance labels present (locations were computed)');
  if (state.distCount > 0) {
    const metres = state.distTexts.map(t => {
      const m = /^([\d.]+)\s*m$/.exec(t);
      if (m) return parseFloat(m[1]);
      const k = /^([\d.]+)\s*km$/.exec(t);
      if (k) return parseFloat(k[1]) * 1000;
      return null;
    }).filter(v => v != null);
    const min = metres.length ? Math.min(...metres) : null;
    console.log(`  nearest distance: ${min == null ? '(unparsed)' : Math.round(min) + ' m'}`);

    /* The real contract is not "the nearest stop is within N km" — that depends
       entirely on the route you searched (44M runs in 青衣, ~7 km from the
       stubbed 旺角 position, so 6 km is correct, not a bug). The contract is that
       the nearest distance is SANE and INTERNALLY CONSISTENT:
         - every label parses to a finite positive number
         - all of them are sorted-able / distinct enough to be real computation
         - the minimum is smaller than the maximum (not all identical) */
    const allParse = metres.length === state.distCount;
    const allPositive = metres.every(v => v > 0 && v < 50000);
    const spread = metres.length > 1 ? (Math.max(...metres) - Math.min(...metres)) : 0;
    check(allParse, 'every distance label parses to a number',
          `${metres.length}/${state.distCount}`);
    check(allPositive, 'all distances are plausible (0 < d < 50 km)');
    /* A single route's stops span at least a few hundred metres; identical
       values everywhere would mean we computed one number and copied it. */
    check(spread > 100, 'distances vary across stops (not a constant)',
          `spread=${Math.round(spread)} m`);
  }
  check(!!state.activeName, 'a stop was auto-selected by geolocation');
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
    await run(browser, 'MOBILE', { width: 390, height: 844 }, true);
  } finally {
    await browser.close();
  }

  if (TEETH) {
    /* Under sabotage the probe MUST have gone red. If it still passes, the
       assertions are not actually testing the thing we think they are. */
    if (failed) {
      console.log('\nTEETH: OK — the probe went RED under sabotage, so it can fail.');
      process.exit(0);
    }
    console.log('\nTEETH: BROKEN — the probe PASSED even though the bug was re-introduced.');
    process.exit(1);
  }

  console.log(`\nRESULT: ${failed ? 'FAIL' : 'ALL PASS'}`);
  process.exit(failed ? 1 : 0);
})();
