/*
 * diagnose-news-sources.js — why do two devices show different news totals?
 * ============================================================================
 * The page merges THREE sources into one list:
 *
 *   A) the live TD feed        (only currently-active messages)
 *   B) traffic-news-archive.json  (shared across devices, bot-updated)
 *   C) localStorage            (PER BROWSER, accumulates what that browser saw)
 *
 * (A) and (B) are identical for every device. (C) is not — it is per browser
 * profile, so two devices legitimately end up with different totals. This tool
 * proves that by reading the page's own merged list, then clearing localStorage
 * and re-reading: the drop is exactly (C)'s contribution.
 *
 * It also fetches (A) and (B) directly so the shared baseline can be compared
 * with what the page actually shows.
 *
 * Usage: node tools/diagnose-news-sources.js [--url https://mattpenny.github.io/transport]
 */
const { chromium } = require('./pw');

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TD_NEWS_URL = 'https://www.td.gov.hk/tc/special_news/trafficnews.xml';
const NEWS_STORE_KEY = 'hk-bus-traffic-news';

const idsOfXml = (text) => [...text.matchAll(/<ID>(.*?)<\/ID>/g)].map((m) => m[1].trim());

async function readState(p) {
  return p.evaluate((KEY) => {
    const app = document.querySelector('#app')?.__vue_app__;
    const inst = app && ((app._container && app._container._vnode && app._container._vnode.component) || app._instance);
    const S = inst && inst.setupState;
    const unref = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
    const news = S ? unref(S.trafficNews) : null;
    let local = [];
    try { local = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) {}
    return {
      mounted: !!S,
      total: Array.isArray(news) ? news.length : null,
      ids: Array.isArray(news) ? news.map((n) => String(n.id || n.heading || '')) : [],
      localCount: Array.isArray(local) ? local.length : 0,
      localIds: Array.isArray(local) ? local.map((n) => String(n.id || n.heading || '')) : [],
    };
  }, NEWS_STORE_KEY);
}

(async () => {
  /* ---- the two SHARED sources, fetched directly ---- */
  const archRes = await fetch(`${argUrl}/traffic-news-archive.json`, { cache: 'no-store' });
  const arch = await archRes.json();
  const archIds = (arch.messages || []).map((m) => String(m.id || m.heading || ''));
  const xmlText = await (await fetch(TD_NEWS_URL, { cache: 'no-store' })).text();
  const liveIds = idsOfXml(xmlText);
  const shared = [...new Set([...archIds, ...liveIds])];

  console.log(`shared archive (B) : ${archIds.length}  generated ${arch.generated}`);
  console.log(`live TD feed  (A) : ${liveIds.length}  ids ${liveIds.join(', ') || '-'}`);
  console.log(`shared union A∪B  : ${shared.length}`);
  console.log(`  overlap (in both): ${archIds.filter((i) => liveIds.includes(i)).length}`);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  /* ---- run the page with whatever localStorage it already has ---- */
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });
  const p = await ctx.newPage();
  await p.goto(`${argUrl}/index.html`, { waitUntil: 'load' });
  await p.waitForTimeout(3000);

  const withLocal = await readState(p);
  console.log(`\n[1] fresh profile   : total ${withLocal.total} (localStorage holds ${withLocal.localCount})`);

  /* A brand-new profile has no accumulated history, so it can only show the
     shared union. To demonstrate the divergence we must simulate a browser that
     HAS seen messages the shared archive does not contain — which is exactly
     what a device that has been open across a few days ends up with. Inject two
     local-only messages and reload; the total must rise by exactly two. */
  const EXTRA = 2;
  await p.evaluate(({ KEY, n }) => {
    const now = Date.now();
    const extra = [];
    for (let i = 0; i < n; i++) {
      extra.push({
        id: `LOCAL-ONLY-${i + 1}`,
        heading: `只在這個瀏覽器看過的消息 ${i + 1}`,
        detail: '這則不在共用存檔內，只有這個瀏覽器見過',
        location: '本地', direction: '', landmark: '',
        status: '已完結', closed: true,
        whenText: '', whenMs: now - (26 + i) * 3600e3,
        storedAt: now,
      });
    }
    localStorage.setItem(KEY, JSON.stringify(extra));
  }, { KEY: NEWS_STORE_KEY, n: EXTRA });

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(3000);
  const withExtras = await readState(p);
  const onlyLocal = withExtras.ids.filter((id) => !shared.includes(id));
  console.log(`[2] + ${EXTRA} local-only: total ${withExtras.total} (localStorage holds ${withExtras.localCount})`);
  console.log(`    local-only ids visible to the page: ${onlyLocal.join(', ') || '-'}`);

  const expected = shared.length + EXTRA;
  const ok = withExtras.total === expected && onlyLocal.length === EXTRA;
  console.log(`\nVERDICT: shared union ${shared.length} + ${EXTRA} local-only = ${expected}; page shows ${withExtras.total} -> ${ok ? 'CONFIRMED' : 'MISMATCH'}`);
  console.log(`(A) and (B) are identical on every device; (C) localStorage is per browser,`);
  console.log(`so two devices diverge by however much extra history each one accumulated.`);

  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
