/*
 * check-inset-clamp.js — regression test for the --status-inset safety clamp.
 *
 * Why this exists: the installed APK shell writes --status-inset straight onto
 * <html> from Java on every onPageFinished, with no clamp. One shell build sent
 * 132 (physical px where CSS px was expected) and made the header 170px tall on
 * a real 1080x2400 phone. The page-side clamp caps that at 28.
 *
 * This probe is deliberately adversarial. It loads the page, then performs the
 * EXACT write the shell performs, and asserts the clamp still holds. A probe
 * that only checked the page's own initial state would go green even when the
 * native overwrite defeats the clamp — which is how the bug shipped twice.
 *
 * Usage:  node tools/check-inset-clamp.js [--url http://127.0.0.1:8000]
 * Needs:  a server in the repo root, e.g. python -m http.server 8000
 */
const pwPath = 'C:/Users/Ansum/.workbuddy-ai/binaries/node/pwtest/node_modules/playwright-core';
const { chromium } = require(pwPath);

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();

const PAGES = [
  ['index.html', '26,61,124'],
  ['gmb.html', '13,94,58'],
  ['rmb.html', '200,16,46'],
];
const BAD_INSET = 132;  // the value that produced the 170px header
const MAX_STATUS = 28;  // must match MAX_STATUS in the clamp IIFE

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  let failed = false;

  for (const [page, rgb] of PAGES) {
    const ctx = await browser.newContext({
      viewport: { width: 372, height: 827 },
      deviceScaleFactor: 3,
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

    await p.goto(`${argUrl}/${page}`, { waitUntil: 'load' });
    await p.waitForTimeout(300);

    const before = await p.evaluate(() => {
      const h = document.querySelector('header.app-header');
      return {
        inset: document.documentElement.style.getPropertyValue('--status-inset'),
        height: Math.round(h.getBoundingClientRect().height),
      };
    });

    /* Exactly what MainActivity.injectSafeArea() evaluates on onPageFinished. */
    await p.evaluate((v) => {
      document.documentElement.style.setProperty('--status-inset', v + 'px');
    }, BAD_INSET);
    await p.waitForTimeout(400);

    const after = await p.evaluate(() => {
      const h = document.querySelector('header.app-header');
      return {
        inset: document.documentElement.style.getPropertyValue('--status-inset'),
        height: Math.round(h.getBoundingClientRect().height),
        bg: getComputedStyle(h).backgroundColor,
      };
    });

    const survived = after.inset === `${MAX_STATUS}px`;
    const heightOk = after.height < 90;   // 170 was the bug; correct is ~66-72
    /* Normalise whitespace on both sides — the computed value is
       "rgb(26, 61, 124)" and a hand-written literal is easy to get wrong. */
    const norm = (s) => s.replace(/\s/g, '');
    const bgOk = norm(after.bg).includes(`rgb(${norm(rgb)})`);
    const pass = survived && heightOk && bgOk && errs.length === 0;
    if (!pass) failed = true;

    console.log(`${page}: before=${JSON.stringify(before)}`);
    console.log(`  afterNativeInject=${JSON.stringify(after)}`);
    console.log(`  survived=${survived} heightOk=${heightOk} bgOk=${bgOk} errors=${errs.length} => ${pass ? 'PASS' : 'FAIL'}`);
    if (errs.length) console.log('  errors:', errs.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
