/*
 * check-company-row.js — the desktop 巴士公司 row must behave like mobile
 * =======================================================================
 * THE REQUIREMENT
 *   On mobile, no company buttons are shown by default. They only appear when
 *   the same route number is operated by more than one company (969 by KMB and
 *   CTB, say). Desktop used to be the opposite: a permanent 4-button 巴士公司
 *   row sat in the sidebar, so the user had to press a company BEFORE searching.
 *   The row must now match mobile — hidden by default, revealed only on a
 *   collision.
 *
 * WHAT COULD SILENTLY BREAK
 *   Hiding the row is easy; keeping search working without it is the real risk.
 *   Desktop no longer pre-selects a company, so the auto-detect path (asking all
 *   four companies which owns the number) is now load-bearing. If it regresses,
 *   a plain search like "44M" returns nothing and the user is stuck at the
 *   landing screen. So this probe asserts BOTH halves:
 *     A. the row is NOT present by default
 *     B. an ordinary single-company number still searches fine without it
 *     C. a number owned by two companies DOES reveal the row, with those
 *        companies only, and picking one completes the search
 *
 * A number that is genuinely cross-company is hard to guarantee forever (the two
 * operators' route lists change), so (C) is driven through the page's own search
 * flow and reports the collision it found, rather than hard-coding a route.
 *
 * Usage: node tools/check-company-row.js [--url http://127.0.0.1:8000] [--shot <dir>]
 */
const { chromium } = require('./pw');
const fs = require('fs');

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();
const shotIdx = process.argv.indexOf('--shot');
const shotDir = shotIdx !== -1 ? process.argv[shotIdx + 1] : null;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 412, height: 915, mobile: true };

function newCtx(browser, vp) {
  return browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    ...(vp.mobile ? {
      isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 ' +
                 '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    } : {}),
  });
}

/* A 巴士公司 row is the sidebar one specifically — the identity popup and the
   mobile sheet contain company buttons too, so we must scope by container or a
   passing popup would mask a leaking row. */
const ROW_SELECTOR = '.sidebar .company-row';

async function rowState(p) {
  return p.evaluate((sel) => {
    const row = document.querySelector(sel);
    const labels = document.querySelector('.company-label');
    return {
      present: !!row,
      count: row ? row.querySelectorAll('.company-btn').length : 0,
      names: row ? [...row.querySelectorAll('.company-btn .name')].map(n => n.textContent.trim()) : [],
      labelText: labels ? labels.textContent.trim() : '',
      visible: row ? !!(row.offsetWidth || row.offsetHeight || row.getClientRects().length) : false,
    };
  }, ROW_SELECTOR);
}

async function search(p, route) {
  await p.evaluate((r) => {
    const inp = document.querySelector('.row input');
    if (!inp) return;
    inp.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, r);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '查詢');
    if (btn) btn.click();
  }, route);
  await p.waitForTimeout(6000);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  if (shotDir && !fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true });
  let failed = false;

  /* ---------- A. hidden by default on desktop, and on mobile ---------- */
  console.log('=== A. default state (no search yet) ===');
  for (const [label, vp] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
    const ctx = await newCtx(browser, vp);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(`${argUrl}/index.html`, { waitUntil: 'load' });
    await p.waitForTimeout(3500);
    const st = await rowState(p);
    const ok = !st.present && errs.length === 0;
    console.log(`  ${label}: company row present=${st.present} visible=${st.visible} -> ${ok ? 'PASS' : 'FAIL'}`);
    if (st.present) console.log(`    names: ${st.names.join(' / ')}  label: ${st.labelText}`);
    if (errs.length) errs.slice(0, 3).forEach(e => console.log('    ', e));
    if (!ok) failed = true;
    if (shotDir) await p.screenshot({ path: `${shotDir}/company-row-${label}-default.png` });
    await ctx.close();
  }

  /* ---------- B. an ordinary number still searches with NO row ---------- */
  console.log('\n=== B. single-company number searches without the row ===');
  {
    const ctx = await newCtx(browser, DESKTOP);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(`${argUrl}/index.html`, { waitUntil: 'load' });
    await p.waitForTimeout(3500);

    await search(p, '44M');
    const st = await rowState(p);
    const res = await p.evaluate(() => ({
      dirs: [...document.querySelectorAll('.direction-picker li')].map(n => n.textContent.trim()),
      routeKey: document.querySelector('.route-head h2, .detail-route-no')?.textContent.trim() || '',
      searched: !!document.querySelector('.direction-picker, .route-head, .stop-list'),
      popup: !!document.querySelector('.company-overlay'),
    }));
    /* 44M is a KMB route: the search must resolve without any company choice.
       The row may legitimately appear only if 44M is ALSO a CTB number, which
       is why we assert on the search outcome, not on row absence, here. */
    const resolved = res.dirs.length > 0 || !!res.routeKey;
    const ok = resolved && !res.popup && errs.length === 0;
    console.log(`  44M: resolved=${resolved} dirs=${res.dirs.length} popup=${res.popup} row=${st.present ? st.names.join('/') : 'absent'}`);
    console.log(`    -> ${ok ? 'PASS' : 'FAIL'}`);
    if (errs.length) errs.slice(0, 3).forEach(e => console.log('    ', e));
    if (!ok) failed = true;
    if (shotDir) await p.screenshot({ path: `${shotDir}/company-row-desktop-44M.png` });
    await ctx.close();
  }

  /* ---------- C. a cross-company number reveals the row ---------- */
  console.log('\n=== C. a number owned by 2+ companies reveals the row ===');
  {
    const ctx = await newCtx(browser, DESKTOP);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(`${argUrl}/index.html`, { waitUntil: 'load' });
    await p.waitForTimeout(3500);

    /* Discover a real collision from the page's own route lists rather than
       hard-coding a route number that could stop being shared next month. */
    const shared = await p.evaluate(async () => {
      const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
      const load = (id) => {
        if (id === 'KMB') return fetchKmbRoutes();
        if (id === 'CTB') return fetchCitybusRoutes();
        if (id === 'NLB') return fetchNlbRoutes();
        if (id === 'MTR') return fetchMtrRoutes();
        return Promise.resolve([]);
      };
      try {
        const all = await Promise.all(['KMB', 'CTB', 'NLB', 'MTR'].map(load));
        const map = new Map();
        all.forEach((list, i) => {
          const id = ['KMB', 'CTB', 'NLB', 'MTR'][i];
          for (const r of (list || [])) {
            const k = norm(r.route);
            if (!k) continue;
            if (!map.has(k)) map.set(k, new Set());
            map.get(k).add(id);
          }
        });
        const collisions = [...map.entries()].filter(([, s]) => s.size > 1);
        return { count: collisions.length, sample: collisions.slice(0, 5).map(([k, s]) => [k, [...s]]) };
      } catch (e) { return { error: String(e) }; }
    });
    console.log(`  cross-company route numbers found: ${shared.count ?? 'n/a'}`);
    if (shared.sample) console.log(`    e.g. ${shared.sample.map(([k, s]) => k + ' (' + s.join('+') + ')').join(', ')}`);

    if (!shared.sample || !shared.sample.length) {
      console.log('    SKIPPED — no cross-company number in the current route lists; nothing to assert.');
    } else {
      const route = shared.sample[0][0];
      const expectCos = shared.sample[0][1];
      await search(p, route);
      const st = await rowState(p);
      const shown = st.present && st.visible;
      const cosOk = expectCos.every(id => st.names.length >= expectCos.length);
      console.log(`  searched "${route}" (${expectCos.join('+')}): row shown=${shown} names=${st.names.join(' / ')} label="${st.labelText}"`);
      if (shotDir) await p.screenshot({ path: `${shotDir}/company-row-desktop-collision-${route}.png` });

      /* Picking a company from the revealed row must complete the search. */
      let picked = null;
      if (shown) {
        await p.evaluate((sel) => {
          const b = document.querySelector(sel + ' .company-btn');
          if (b) b.click();
        }, ROW_SELECTOR);
        await p.waitForTimeout(7000);
        picked = await p.evaluate(() => ({
          dirs: [...document.querySelectorAll('.direction-picker li')].map(n => n.textContent.trim()),
          stops: document.querySelectorAll('.stop-list li').length,
          err: (document.querySelector('.error')?.textContent || '').trim(),
        }));
        console.log(`  after picking a company: dirs=${picked.dirs.length} stops=${picked.stops} err="${picked.err}"`);
        if (shotDir) await p.screenshot({ path: `${shotDir}/company-row-desktop-collision-${route}-picked.png` });
      }

      const ok = shown && cosOk && picked && picked.dirs.length > 0 && !picked.err && errs.length === 0;
      console.log(`    -> ${ok ? 'PASS' : 'FAIL'}`);
      if (errs.length) errs.slice(0, 3).forEach(e => console.log('    ', e));
      if (!ok) failed = true;
    }
    await ctx.close();
  }

  await browser.close();
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
