/*
 * check-mtr-page.js — does mtr.html actually show MTR Bus arrivals?
 * =================================================================
 * mtr.html is a new page, so "it renders" is not enough. Assert the things
 * that would be silently wrong:
 *
 *   1. no console errors / no unhandled rejections
 *   2. the boot shell is gone and #app is visible (Vue mounted)
 *   3. picking a route issues the API call and real ETAs appear
 *   4. stop NAMES resolve — the API returns only ids, so a join failure shows
 *      raw ids like "K51-D010" instead of "大欖". Assert we never render a bare id.
 *   5. both directions exist and differ (the API returns D and U in one payload)
 *   6. the 108000 sentinel never renders as a number ("1800 分鐘")
 *   7. K52 works — its ids are "K52-nD010" with a lowercase n, which a
 *      [A-Z] pattern silently drops
 *   8. mobile viewport also renders
 *
 * Usage: node tools/check-mtr-page.js [--url http://127.0.0.1:8000] [--shot <dir>]
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

async function run(browser, { label, viewport, mobile, routes }) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 2, isMobile: !!mobile, hasTouch: !!mobile,
    ...(mobile ? {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 ' +
                 '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    } : {}),
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await p.goto(`${argUrl}/mtr.html`, { waitUntil: 'load' });
  await p.waitForTimeout(2500);

  const boot = await p.evaluate(() => ({
    shellGone: !document.getElementById('boot-screen'),
    appVisible: !document.getElementById('app').hasAttribute('data-booting'),
    appDisplay: getComputedStyle(document.getElementById('app')).display,
  }));

  const out = { label, boot, routes: [], errs };

  for (const route of routes) {
    /* Click the route button rather than poking internals, so this exercises
       the real interaction path. */
    const clicked = await p.evaluate((r) => {
      const btn = [...document.querySelectorAll('.route-btn')]
        .find((b) => b.querySelector('.route-no')?.textContent.trim() === r);
      if (btn) { btn.click(); return true; }
      return false;
    }, route);
    if (!clicked) { out.routes.push({ route, error: 'route button not found' }); continue; }

    await p.waitForTimeout(2200);

    const info = await p.evaluate(() => {
      const names = [...document.querySelectorAll('.stop-name')].map((n) => n.textContent.trim());
      const en = [...document.querySelectorAll('.stop-en')].map((n) => n.textContent.trim());
      const etas = [...document.querySelectorAll('.eta')].map((n) => n.textContent.trim());
      const tabs = [...document.querySelectorAll('.dir-tab')].map((n) => n.textContent.trim());
      const heading = document.querySelector('.route-head h2')?.textContent.trim();
      const notice = document.querySelector('.notice.err')?.textContent.trim() || '';
      return { heading, tabs, names, en, etas, notice,
               updated: document.querySelector('.updated')?.textContent.trim() };
    });

    /* A stop whose name could not be resolved must NOT render as a bare
       busStopId — that reads as a broken page. It should fall back to a
       readable placeholder, with the id demoted to the secondary line.
       Separately, the great majority must actually resolve, or the join is
       broken rather than merely incomplete. */
    const unresolved = info.names.filter((n) => /^[A-Za-z0-9 ]+-[A-Za-z]{0,2}[DU]\d+$/.test(n));
    const placeholders = info.names.filter((n) => n === '（未命名站）').length;
    const resolvedRatio = info.names.length ? (info.names.length - placeholders) / info.names.length : 0;
    const sentinel = info.etas.filter((t) => /1800|108000/.test(t));
    const numericEta = info.etas.filter((t) => /^\d+\s*(分鐘|minutes)$/i.test(t));

    /* Both directions must exist and be labelled with real stop names. */
    const dirsOk = info.tabs.length >= 2 &&
      info.tabs.every((t) => /→/.test(t) || /去程|回程|全部站/.test(t));

    /* Switch to the second direction and confirm the stop list changes. */
    let dirChanged = null;
    if (info.tabs.length >= 2) {
      const before = info.names.join('|');
      await p.evaluate(() => document.querySelectorAll('.dir-tab')[1].click());
      await p.waitForTimeout(400);
      const after = await p.evaluate(() =>
        [...document.querySelectorAll('.stop-name')].map((n) => n.textContent.trim()).join('|'));
      dirChanged = after !== before && after.length > 0;
    }

    if (shotDir) await p.screenshot({ path: `${shotDir}/${label}-${route}.png` });

    out.routes.push({
      route,
      heading: info.heading,
      tabs: info.tabs,
      stops: info.names.length,
      sample: info.names.slice(0, 3),
      sampleEn: info.en.slice(0, 2),
      etaSample: info.etas.slice(0, 4),
      updated: info.updated,
      unresolved: unresolved.length,
      placeholders,
      resolvedRatio,
      sentinel: sentinel.length,
      numericEta: numericEta.length,
      dirsOk, dirChanged,
      notice: info.notice,
    });
  }

  await ctx.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  if (shotDir && !fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true });

  const results = [
    await run(browser, {
      label: 'desktop', viewport: { width: 1440, height: 900 },
      routes: ['K51', 'K52', 'K12'],
    }),
    await run(browser, {
      label: 'mobile', viewport: { width: 412, height: 915 }, mobile: true,
      routes: ['K51'],
    }),
  ];
  await browser.close();

  let failed = false;
  for (const r of results) {
    console.log(`\n### ${r.label}`);
    console.log(`  boot: ${JSON.stringify(r.boot)}`);
    if (!r.boot.shellGone || !r.boot.appVisible) failed = true;

    for (const x of r.routes) {
      if (x.error) { console.log(`  ${x.route}: ERROR ${x.error}`); failed = true; continue; }
      const ok = x.stops > 0 && x.unresolved === 0 && x.resolvedRatio >= 0.9 &&
                 x.sentinel === 0 && x.numericEta > 0 && x.dirsOk &&
                 x.dirChanged !== false && !x.notice;
      if (!ok) failed = true;
      console.log(`  ${x.route}: ${x.stops} stops, ${x.tabs.length} dirs [${x.tabs.join(' / ')}]`);
      console.log(`      first stops: ${x.sample.join(' / ')}`);
      console.log(`      en: ${x.sampleEn.join(' / ')}`);
      console.log(`      etas: ${x.etaSample.join(' | ')}   ${x.updated || ''}`);
      console.log(`      resolved=${(x.resolvedRatio * 100).toFixed(0)}% ` +
                  `placeholders=${x.placeholders} bareIds=${x.unresolved} ` +
                  `sentinel=${x.sentinel} numericEta=${x.numericEta} ` +
                  `dirsOk=${x.dirsOk} dirChanged=${x.dirChanged}` +
                  (x.notice ? `  NOTICE=${x.notice}` : ''));
      console.log(`      => ${ok ? 'PASS' : 'FAIL'}`);
    }
    if (r.errs.length) { console.log('  console errors:'); r.errs.slice(0, 6).forEach((e) => console.log('   ', e)); failed = true; }
    else console.log('  console errors: none');
  }

  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
