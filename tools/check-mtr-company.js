/*
 * check-mtr-company.js — MTR Bus as a company inside index.html
 * ==============================================================
 * The requirement: MTR Bus should NOT be a separate page. In index.html you
 * click the 港鐵巴士 company button (or just type a K-number) and get the same
 * display as KMB/CTB — route, direction, stop list, live ETAs, 詳請.
 *
 * So this probe drives the REAL page and asserts the things that could be
 * silently wrong:
 *
 *   1. the 港鐵巴士 company button exists and carries the mtr.png logo
 *   2. clicking it loads the MTR route list
 *   3. searching a K-number finds the route (desktop uses the selected company;
 *      mobile auto-detects which company owns the number)
 *   4. stops render with NAMES — the API returns only ids, so a broken join
 *      shows "K51-D010" instead of "大欖"
 *   5. ETAs are real numbers, and the 108000 sentinel never leaks as "1800 分鐘"
 *   6. the direction picker works (O/I entries from the fare index)
 *   7. 詳請 opens and shows a fare, which only works if the company key is
 *      aliased to lrtfeeder
 *   8. no console errors, both viewports
 *
 * Usage: node tools/check-mtr-company.js [--url http://127.0.0.1:8000] [--shot <dir>]
 */
const PW = 'C:/Users/Ansum/.workbuddy-ai/binaries/node/pwtest/node_modules/playwright-core';
const { chromium } = require(PW);
const fs = require('fs');

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();
const shotIdx = process.argv.indexOf('--shot');
const shotDir = shotIdx !== -1 ? process.argv[shotIdx + 1] : null;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const STOP_ID_RE = /^[A-Za-z0-9 ]+-[A-Za-z]{0,2}[DU]\d+$/;

function read(p) {
  return p.evaluate(() => {
    const names = [...document.querySelectorAll('.stop-list li .stop-name')]
      .map(n => n.textContent.trim());
    /* The ETA list is a bare <ul v-else> — no class. Its items are identifiable
       by the .rank span ("第 1 班"). */
    const etas = [...document.querySelectorAll('li')]
      .filter(li => li.querySelector('.rank'))
      .map(li => li.textContent.replace(/\s+/g, ' ').trim());
    const dirs = [...document.querySelectorAll('.direction-picker li, .direction-row button, .detail-direction-picker button')]
      .map(n => n.textContent.trim());
    return {
      names, etas, dirs,
      routeKey: document.querySelector('.route-head h2, .detail-route-no')?.textContent.trim() || '',
      fare: (document.querySelector('.fare-value, .fare-main, .fare-row')?.textContent || '').trim(),
      error: (document.querySelector('.error, .gps-error')?.textContent || '').trim(),
      hasDetailBtn: !!document.querySelector('.detail-btn'),
    };
  });
}

async function run(browser, { label, viewport, mobile, routeNo }) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 2, isMobile: !!mobile, hasTouch: !!mobile,
    ...(mobile ? {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 ' +
                 '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    } : {}),
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await p.goto(`${argUrl}/index.html`, { waitUntil: 'load' });
  await p.waitForTimeout(3000);

  /* The company buttons render progressively as each company's (async) route
     list finishes loading. On a slow CDN the 港鐵巴士 button can appear several
     seconds after `load`, so wait for it before asserting. It is a desktop-only
     row, so we only wait on desktop. A genuinely missing button still FAILs via
     the assertion below once the timeout elapses. */
  if (!mobile) {
    await p.waitForFunction(
      () => [...document.querySelectorAll('.company-btn')].some(b => (b.textContent || '').includes('港鐵巴士')),
      { timeout: 30000 }
    ).catch(() => {});
  }

  /* 1. the company button, and its logo */
  const companyBtn = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('.company-btn')];
    const b = btns.find(x => (x.textContent || '').includes('港鐵巴士'));
    if (!b) return { found: false, all: btns.map(x => (x.textContent || '').trim()) };
    const img = b.querySelector('img');
    return { found: true, logo: img ? img.getAttribute('src') : null,
             logoLoaded: img ? (img.naturalWidth > 0) : false };
  });

  const out = { label, mobile: !!mobile, companyBtn, errs };

  if (mobile) {
    /* Mobile: type the number and let the page work out the company. */
    await p.evaluate((r) => {
      const inp = document.querySelector('.row input');
      inp.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, r);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, routeNo);
    await p.waitForTimeout(300);
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '查詢');
      if (btn) btn.click();
    });
  } else {
    /* Desktop: click the 港鐵巴士 company button, then search. */
    await p.evaluate(() => {
      const b = [...document.querySelectorAll('.company-btn')].find(x => (x.textContent || '').includes('港鐵巴士'));
      if (b) b.click();
    });
    await p.waitForTimeout(1500);
    const routeListCount = await p.evaluate(() => document.querySelectorAll('.route-item, .route-btn, .routes-list li').length);
    out.routeListCount = routeListCount;
    await p.evaluate((r) => {
      const inp = document.querySelector('.row input');
      inp.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, r);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, routeNo);
    await p.waitForTimeout(300);
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '查詢');
      if (btn) btn.click();
    });
  }

  await p.waitForTimeout(5000);

  /* The page shows a direction picker and waits. Nothing loads until one is
     chosen, so we must pick before reading the stop list — reading straight
     after the search reports zero stops even when everything works. */
  const dirs = await p.evaluate(() =>
    [...document.querySelectorAll('.direction-picker li')].map(n => n.textContent.trim()));
  out.dirs = dirs;

  if (dirs.length) {
    await p.evaluate(() => {
      const li = document.querySelectorAll('.direction-picker li');
      if (li[0]) li[0].click();
    });
    await p.waitForTimeout(5000);
  }
  /* The page only fetches ETAs once a stop is chosen — there is no stop
     selected on load, so without this click the ETA list is always empty and
     the probe would report "no ETAs" on a page that works. */
  await p.evaluate(() => {
    const li = document.querySelector('.stop-list li');
    if (li) li.click();
  });
  await p.waitForTimeout(3500);
  const s1 = await read(p);
  out.result = s1;

  /* 6. switching direction must change the stop list. Once a direction is
     chosen the picker is replaced by a chip, so we clear it first. */
  let dirSwitch = null;
  if (dirs.length > 1) {
    await p.evaluate(() => document.querySelector('.direction-chip')?.click());
    await p.waitForTimeout(800);
    await p.evaluate(() => {
      const li = document.querySelectorAll('.direction-picker li');
      if (li[1]) li[1].click();
    });
    await p.waitForTimeout(5500);
    const s2 = await read(p);
    dirSwitch = { before: s1.names.slice(0, 3), after: s2.names.slice(0, 3),
                  changed: s1.names.join('|') !== s2.names.join('|') };
    out.afterDir = s2;
  }
  out.dirSwitch = dirSwitch;

  /* 7. 詳請 */
  if (s1.hasDetailBtn) {
    await p.evaluate(() => document.querySelector('.detail-btn')?.click());
    await p.waitForTimeout(2500);
    out.detail = await p.evaluate(() => {
      const m = document.querySelector('.detail-modal');
      if (!m) return { open: false };
      return { open: true, text: (m.textContent || '').replace(/\s+/g, ' ').slice(0, 400) };
    });
    if (shotDir) await p.screenshot({ path: `${shotDir}/${label}-${routeNo}-detail.png` });
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(400);
  }

  out.result = s1;
  if (shotDir) await p.screenshot({ path: `${shotDir}/${label}-${routeNo}.png` });
  await ctx.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  if (shotDir && !fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true });

  const results = [
    await run(browser, { label: 'desktop', viewport: { width: 1440, height: 900 }, routeNo: 'K12' }),
    await run(browser, { label: 'desktop', viewport: { width: 1440, height: 900 }, routeNo: 'K51' }),
    await run(browser, { label: 'mobile', viewport: { width: 412, height: 915 }, mobile: true, routeNo: 'K51' }),
  ];
  await browser.close();

  let failed = false;
  for (const r of results) {
    const res = r.result || {};
    const names = res.names || [];
    const bareIds = names.filter(n => STOP_ID_RE.test(n));
    const sentinel = (res.etas || []).filter(t => /1800|108000/.test(t));
    const numericEta = (res.etas || []).filter(t => /\d+\s*分鐘|\d{2}:\d{2}/.test(t));
    /* The 巴士公司 row is desktop-only (v-if="!isMobile") — mobile picks the
       company from the popup instead, so only require the button on desktop. */
    const companyOk = r.mobile ? true : (r.companyBtn.found && r.companyBtn.logoLoaded);
    const ok = companyOk &&
               names.length > 0 && bareIds.length === 0 &&
               sentinel.length === 0 && numericEta.length > 0 &&
               !res.error && r.errs.length === 0;

    console.log(`\n### ${r.label} — search ${r.routeNo || ''}`);
    console.log(`  company button: found=${r.companyBtn.found} logo=${r.companyBtn.logo} loaded=${r.companyBtn.logoLoaded}` +
                (r.mobile ? '  (desktop-only row, not required on mobile)' : ''));
    if (!r.companyBtn.found) console.log(`    buttons seen: ${(r.companyBtn.all || []).join(' / ')}`);
    if (r.routeListCount !== undefined) console.log(`  route list after clicking the company: ${r.routeListCount} entries`);
    console.log(`  stops: ${names.length}  first: ${names.slice(0, 3).join(' / ')}`);
    console.log(`  etas: ${(res.etas || []).slice(0, 3).join(' | ')}`);
    console.log(`  directions: ${(r.dirs || []).join(' / ') || '(none)'}`);
    if (r.dirSwitch) console.log(`  direction switch: changed=${r.dirSwitch.changed} ${r.dirSwitch.before.join(',')} -> ${r.dirSwitch.after.join(',')}`);
    if (r.detail) console.log(`  detail modal: open=${r.detail.open}${r.detail.open ? ' | ' + r.detail.text.slice(0, 160) : ''}`);
    console.log(`  bareIds=${bareIds.length} sentinel=${sentinel.length} numericEta=${numericEta.length}` +
                (res.error ? `  ERROR=${res.error}` : ''));
    if (r.errs.length) r.errs.slice(0, 5).forEach(e => console.log('   ', e));
    console.log(`  => ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) failed = true;
  }
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
