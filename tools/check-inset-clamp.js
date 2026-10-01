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
 * Usage:  node tools/check-inset-clamp.js [--url http://127.0.0.1:8000] [--teeth]
 * Needs:  a server in the repo root, e.g. python -m http.server 8000
 *
 * --teeth: sabotage mode. Injects a stylesheet that neutralises the resolver
 *          (rebinds the header padding straight to the raw --status-inset), then
 *          asserts the probe goes RED. An always-green probe is worse than no
 *          probe: this proves the assertions can actually fail. Exit code 0 in
 *          teeth mode means "the probe correctly detected the break".
 */
const pwPath = 'C:/Users/Ansum/.workbuddy-ai/binaries/node/pwtest/node_modules/playwright-core';
const { chromium } = require(pwPath);

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();

/* --teeth: run the same assertions against a page whose resolver has been
   neutralised. Every page MUST fail; if any passes, the probe is blind. */
const TEETH = process.argv.includes('--teeth');

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
  const blindPages = [];

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

    /* Teeth mode: undo the protection so a correct probe MUST go red.
       Note we cannot simply reference --status-inset: the resolver already
       clamped it to 28px, so reading it can never reproduce the bug. We must
       reproduce the ORIGINAL shape — the header consuming a large raw number —
       by rebinding padding-top to a literal 132px, exactly what an unclamped
       env()/inset would have produced. */
    if (TEETH) {
      await p.addStyleTag({
        content: `header.app-header { padding-top: ${BAD_INSET}px !important; }`,
      });
      await p.waitForTimeout(150);
    }

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
    /* In teeth mode a "pass" is the WRONG outcome — it means the sabotage had
       no effect and the probe is therefore not testing what it claims.
       We track blindness separately from `failed` so the verdict text can be
       honest about which pages stayed green. */
    const blind = TEETH && pass;
    if (blind) blindPages.push(page);
    if (TEETH ? pass : !pass) failed = true;

    console.log(`${page}: before=${JSON.stringify(before)}${TEETH ? '  [TEETH]' : ''}`);
    console.log(`  afterNativeInject=${JSON.stringify(after)}`);
    console.log(`  survived=${survived} heightOk=${heightOk} bgOk=${bgOk} errors=${errs.length} => ${pass ? 'PASS' : 'FAIL'}${TEETH ? (blind ? ' (WRONG: stayed green = probe blind)' : ' (correct: went red under sabotage)') : ''}`);
    if (errs.length) console.log('  errors:', errs.join(' | '));
    await ctx.close();
  }

  await browser.close();
  if (TEETH) {
    console.log(blindPages.length === 0
      ? '\nTEETH: OK — every page went red under sabotage; the probe can fail.'
      : `\nTEETH: BROKEN — these pages stayed green while sabotaged, so the probe is blind: ${blindPages.join(', ')}`);
  } else {
    console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
