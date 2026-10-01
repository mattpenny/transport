/*
 * repro-flash.js — reproduce the "header starts perfect, then flashes lower" bug
 * =============================================================================
 * The user reported: on opening the app the header sits exactly right, just
 * below the status bar, then it FLASHES LOWER and stays tall.
 *
 * That signature means the page's FIRST paint is correct and something later
 * makes the header taller. We need to know: (a) what the header is before the
 * resolver runs, (b) after, and (c) how big the jump is.
 *
 * Key setup fact being modelled: the APK's theme is
 * Theme.Material.Light.NoActionBar with NO edge-to-edge flags, so Android lays
 * the WebView out BELOW the status bar. The WebView therefore reports
 * env(safe-area-inset-top) = 0, and any page-side padding for the status bar
 * DOUBLE-COUNTS it.
 *
 * Usage: node tools/repro-flash.js [--url http://127.0.0.1:8000]
 */
const PW = 'C:/Users/Ansum/.workbuddy-ai/binaries/node/pwtest/node_modules/playwright-core';
const { chromium } = require(PW);

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  for (const page of ['index.html', 'gmb.html', 'rmb.html']) {
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.6,
      isMobile: true,
      hasTouch: true,
    });
    const p = await ctx.newPage();

    /* Sample --inset-top and the header height on EVERY frame, so we see the
       jump rather than only the settled value. Re-installed after each nav. */
    await p.addInitScript(() => {
      window.__samples = [];
      const tick = () => {
        const h = document.querySelector('header.app-header');
        if (h) {
          window.__samples.push({
            t: Math.round(performance.now()),
            insetTop: getComputedStyle(document.documentElement)
              .getPropertyValue('--inset-top').trim(),
            padTop: getComputedStyle(h).paddingTop,
            h: Math.round(h.getBoundingClientRect().height),
          });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await p.goto(`${argUrl}/${page}`, { waitUntil: 'load' });

    /* Now replay the APK shell EXACTLY: MainActivity.injectSafeArea() fires on
       onPageFinished (then +60ms) and writes --status-inset/--nav-inset onto
       <html> with NO clamp. Without this step a plain browser writes nothing
       and --status-inset stays 0, which is why the flash never reproduces in
       the browser alone. */
    const SHELL_INSET = parseInt(process.argv[process.argv.indexOf('--inset') + 1] || '24', 10);
    await p.waitForTimeout(60);
    await p.evaluate((v) => {
      document.documentElement.style.setProperty('--status-inset', v + 'px');
      document.documentElement.style.setProperty('--nav-inset', '48px');
    }, SHELL_INSET);

    await p.waitForTimeout(1600);   // past the 1200ms re-assert

    const s = await p.evaluate(() => window.__samples);
    /* Find the first sample, the last, and the biggest upward jump in height. */
    const first = s.find((x) => x.h > 0);
    const last = s[s.length - 1];
    let maxJump = 0, jumpAt = null;
    for (let i = 1; i < s.length; i++) {
      const d = s[i].h - s[i - 1].h;
      if (d > maxJump) { maxJump = d; jumpAt = s[i]; }
    }

    console.log(`\n### ${page}`);
    console.log(`  samples           : ${s.length}`);
    console.log(`  FIRST paint       : ${JSON.stringify(first)}`);
    console.log(`  LAST  (settled)   : ${JSON.stringify(last)}`);
    console.log(`  BIGGEST JUMP      : +${maxJump}px  ${JSON.stringify(jumpAt)}`);
    console.log(`  flash?            : ${maxJump >= 6 ? 'YES — header jumps down ' + maxJump + 'px' : 'no'}`);

    await ctx.close();
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
