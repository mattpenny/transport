/*
 * check-inset-clamp.js — regression test for the status-inset contract.
 *
 * THE CONTRACT (current, correct):
 *   The app is NOT edge-to-edge (Theme.Material.Light.NoActionBar, no
 *   FLAG_LAYOUT_NO_LIMITS), so Android already lays the WebView out BELOW the
 *   status bar. The bar occupies zero pixels of the page and the header must
 *   therefore gain NO padding for it.
 *
 *   The shell still injects --status-inset on every onPageFinished, AFTER
 *   first paint. The page must therefore IGNORE that claim: neutralise
 *   --status-inset to 0px and derive --inset-top from env() only.
 *
 * What went wrong before, twice:
 *   1. An unclamped 132 (physical px where CSS px was expected) made the header
 *      170px tall.
 *   2. "Fixing" it by clamping --status-inset to 28 still ADDED 24-28px of
 *      padding the page did not need — the header started correct and then
 *      flashed ~16-20px lower when the shell's write landed. Clamping a wrong
 *      number is not the same as discarding it.
 *
 * This probe is deliberately adversarial: it performs the EXACT write the shell
 * performs, after load, and asserts the header does not move. A probe that only
 * checked initial state would go green while the overwrite defeats it.
 *
 * Usage:  node tools/check-inset-clamp.js [--url http://127.0.0.1:8000] [--teeth]
 * Needs:  a server in the repo root, e.g. python -m http.server 8000
 *
 * --teeth: sabotage mode. Restores the OLD behaviour (honour the shell claim as
 *          padding) and asserts the probe goes RED. An always-green probe is
 *          worse than no probe: this proves the assertions can actually fail.
 */
const { chromium } = require('./pw');

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();

/* --teeth: run the same assertions against a page whose protection has been
   reverted to the OLD (wrong) behaviour. Every page MUST fail; if any passes,
   the probe is blind. */
const TEETH = process.argv.includes('--teeth');

const PAGES = [
  ['index.html', '26,61,124', 46],   // 46px is the correct, settled header height
  ['gmb.html', '13,94,58', 46],
  ['rmb.html', '200,16,46', 54],
];
/* The two values the shell has actually sent, both of which must now be
   DISCARDED rather than honoured:
     132 — the physical-px bug that made the header 170px tall
      24 — the double-count that produced the 16px downward flash */
const SHELL_CLAIMS = [132, 24];

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  let failed = false;
  const blindPages = [];

  for (const [page, rgb, correctH] of PAGES) {
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

    /* TEETH: restore the old behaviour — let the shell's claim become padding,
       capped rather than discarded. This is precisely the code that produced
       the flash, so the probe MUST go red. */
    if (TEETH) {
      await p.evaluate(() => {
        window.__teeth = true;
        /* Re-bind the header to consume whatever the shell claims. */
        const st = document.createElement('style');
        st.textContent =
          'header.app-header { padding-top: max(8px, var(--status-inset)) !important; }';
        document.head.appendChild(st);
        /* Freeze --status-inset so the resolver cannot neutralise it. */
        const obs = new MutationObserver(() => {
          const v = window.__claim || '0px';
          if (document.documentElement.style.getPropertyValue('--status-inset') !== v) {
            document.documentElement.style.setProperty('--status-inset', v);
          }
        });
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
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

    /* Replay BOTH shell claims in turn. Each is exactly what
       MainActivity.injectSafeArea() evaluates on onPageFinished. */
    const afterEach = [];
    for (const claim of SHELL_CLAIMS) {
      await p.evaluate((v) => {
        window.__claim = v + 'px';
        document.documentElement.style.setProperty('--status-inset', v + 'px');
      }, claim);
      await p.waitForTimeout(400);
      afterEach.push(await p.evaluate((v) => {
        const h = document.querySelector('header.app-header');
        return {
          claim: v,
          inset: document.documentElement.style.getPropertyValue('--status-inset'),
          height: Math.round(h.getBoundingClientRect().height),
          bg: getComputedStyle(h).backgroundColor,
        };
      }, claim));
    }

    /* Assertions under the CURRENT contract:
       - the shell's claim is discarded (--status-inset back to 0px)
       - the header height does not move from its correct value
       - the brand colour is right; no page errors */
    const clamped = afterEach.every((a) => a.inset === '0px');
    const heightOk = afterEach.every((a) => Math.abs(a.height - correctH) <= 2);
    const notTall = afterEach.every((a) => a.height < 90);   // 170 was the bug
    const norm = (s) => s.replace(/\s/g, '');
    const bgOk = afterEach.every((a) => norm(a.bg).includes(`rgb(${norm(rgb)})`));
    const pass = clamped && heightOk && notTall && bgOk && errs.length === 0;

    /* In teeth mode a "pass" is the WRONG outcome — the sabotage had no effect,
       so the probe is not testing what it claims. */
    const blind = TEETH && pass;
    if (blind) blindPages.push(page);
    if (TEETH ? pass : !pass) failed = true;

    console.log(`${page}: before=${JSON.stringify(before)} (correct height ${correctH})${TEETH ? '  [TEETH]' : ''}`);
    for (const a of afterEach) {
      console.log(`  shell claims ${a.claim}px -> inset=${a.inset} height=${a.height} bg=${a.bg}`);
    }
    console.log(`  discarded=${clamped} heightStable=${heightOk} notTall=${notTall} bgOk=${bgOk} errors=${errs.length} => ${pass ? 'PASS' : 'FAIL'}${TEETH ? (blind ? ' (WRONG: stayed green = probe blind)' : ' (correct: went red under sabotage)') : ''}`);
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
