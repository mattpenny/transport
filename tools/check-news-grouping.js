/*
 * check-news-grouping.js — mobile traffic-news grouping contract
 * ============================================================================
 * Contract under test (mobile landing + full-screen sheet):
 *
 *   1. The 特別交通消息 heading count counts TODAY's messages only. It used to
 *      count every message the page held (live + archive + localStorage), so it
 *      read as "there is news today" when there was none.
 *   2. The full-screen sheet is GROUPED into 今日 / 過往兩天交通消息. It used to
 *      render one flat list of everything.
 *   3. The 過往兩天交通消息 card on the landing is GONE in the normal case. The
 *      ticker and that card both opened the same sheet, so it was a duplicate
 *      entry point.
 *   4. ...but an entry must still exist when the ticker is absent, or past news
 *      becomes unreachable on mobile. With no today messages the ticker and its
 *      "點擊查看全部" hint do not render, so a fallback entry must appear.
 *
 * We control the data by intercepting the two file sources, then clear
 * localStorage and reload — the page merges its own persisted cache with the
 * fetched data, so replacing the network alone still leaves old rows mixed in.
 *
 * The fixture MUST straddle the day boundary. An all-today fixture cannot
 * detect a partitioning bug: every partition of it looks correct.
 *
 * Usage: node tools/check-news-grouping.js [--url http://127.0.0.1:8000]
 *                                          [--teeth] [--shot <dir>]
 * --teeth : collapse the groups back into one flat list (the old markup) and
 *           assert the probe goes red. An always-green probe is worse than none.
 * --shot  : write <label>-landing.png / <label>-sheet.png so the result can
 *           also be looked at. A passing assertion set proves the properties you
 *           thought to check; it cannot tell you the result LOOKS right.
 */
const PW = 'C:/Users/Ansum/.workbuddy-ai/binaries/node/pwtest/node_modules/playwright-core';
const { chromium } = require(PW);
const fs = require('fs');

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();
const TEETH = process.argv.includes('--teeth');
const shotIdx = process.argv.indexOf('--shot');
const shotDir = shotIdx !== -1 ? process.argv[shotIdx + 1] : null;

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const pad = (n) => String(n).padStart(2, '0');
const stamp = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const msg = (m) =>
  `<message><ID>${m.id}</ID><ANNOUNCEMENT_DATE>${stamp(m.ms)}</ANNOUNCEMENT_DATE>` +
  `<INCIDENT_STATUS_EN>OPEN</INCIDENT_STATUS_EN><INCIDENT_STATUS_CN>生效中</INCIDENT_STATUS_CN>` +
  `<INCIDENT_HEADING_CN>${m.heading}</INCIDENT_HEADING_CN><CONTENT_CN>${m.detail}</CONTENT_CN>` +
  `<LOCATION_CN>${m.location || ''}</LOCATION_CN><DIRECTION_CN></DIRECTION_CN>` +
  `<NEAR_LANDMARK_CN></NEAR_LANDMARK_CN></message>`;

const tdXml = (msgs) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<trafficnews>' +
  msgs.map(msg).join('') + '\n</trafficnews>';

/* One scenario: serve `msgs`, load mobile, open the sheet, report what rendered. */
async function runScenario(browser, { label, msgs, expect }) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });
  await ctx.route('**/traffic-news-archive.json*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ generated: '', retainDays: 3, count: 0, messages: [] }) }));
  await ctx.route('**/trafficnews.xml*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/xml', body: tdXml(msgs) }));

  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await p.goto(`${argUrl}/index.html`, { waitUntil: 'load' });
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(2500);

  const landing = await p.evaluate(() => {
    const heads = [...document.querySelectorAll('.tp-head')].map((h) => ({
      title: (h.querySelector('h3') || {}).textContent?.trim(),
      count: (h.querySelector('.tp-updated') || {}).textContent?.trim(),
    }));
    return {
      heads,
      ticker: [...document.querySelectorAll('.tp-ticker-item')].map((s) => s.textContent.trim()),
      hasTicker: !!document.querySelector('.tp-ticker'),
      hasTapHint: !!document.querySelector('.tp-tap-hint'),
      hasPastCard: !!document.querySelector('.tp-day'),   // the removed duplicate
      hasEmpty: !!document.querySelector('.tp-empty'),
    };
  });

  if (shotDir) await p.screenshot({ path: `${shotDir}/${label}-landing.png` });

  /* Open the sheet the way a user would: the ticker when it exists, else the
     fallback entry. Clicking the wrong one would silently prove nothing. */
  const openedVia = await p.evaluate(() => {
    const ticker = document.querySelector('.tp-ticker');
    if (ticker) { ticker.click(); return 'ticker'; }
    const day = document.querySelector('.tp-day-head');
    if (day) { day.click(); return 'past-card'; }
    return null;
  });
  await p.waitForTimeout(500);

  if (TEETH) {
    /* Reproduce the REPORTED bug, not merely hide a label: the old markup was
       one flat <ul> with no group blocks. Collapse the groups back to that. */
    await p.evaluate(() => {
      const body = document.querySelector('.tp-sheet-body');
      if (!body) return;
      const blocks = [...body.querySelectorAll('.tp-news-group-block')];
      if (!blocks.length) return;
      const items = [...body.querySelectorAll('.tp-news-item')];
      const ul = document.createElement('ul');
      ul.className = 'tp-news-list';
      items.forEach((li) => ul.appendChild(li));
      blocks[0].parentNode.insertBefore(ul, blocks[0]);
      blocks.forEach((b) => b.remove());
    });
    await p.waitForTimeout(200);
  }

  const sheet = await p.evaluate(() => {
    const body = document.querySelector('.tp-sheet-body');
    if (!body) return { open: false };
    return {
      open: true,
      groups: [...body.querySelectorAll('.tp-news-group-block')].map((g) => ({
        label: g.querySelector('.tp-news-group')?.textContent.trim(),
        items: [...g.querySelectorAll('.tp-news-heading')].map((x) => x.textContent.trim()),
      })),
      flat: [...body.querySelectorAll('.tp-news-heading')].map((x) => x.textContent.trim()),
    };
  });

  if (shotDir) await p.screenshot({ path: `${shotDir}/${label}-sheet.png` });
  await ctx.close();

  const todayNames = expect.todayNames;
  const pastNames = expect.pastNames;

  const mainHead = landing.heads.find((h) => h.title === '特別交通消息');
  const c = {
    /* 1. The heading count reflects TODAY. With no today messages the count is
          correctly HIDDEN rather than showing "0 則" — asserting a literal
          "0 則" here would demand the wrong behaviour. */
    headCountToday: todayNames.length
      ? (!!mainHead && mainHead.count === `${todayNames.length} 則`)
      : (!mainHead || !mainHead.count),
    /* 3. the duplicate past card is gone in the normal case, present in the
          edge case (where it is the only entry) */
    pastCardRemoved: expect.pastCardRemoved ? !landing.hasPastCard : landing.hasPastCard,
    /* 4. an entry still exists whenever there is anything to show */
    hasEntry: landing.hasTicker || landing.hasPastCard,
    openedVia,
    sheetOpen: sheet.open === true,
    /* Groups are only rendered when non-empty, so the expected count is the
       number of non-empty partitions — not always 2. */
    sheetGrouped: sheet.open === true &&
      sheet.groups.length === (todayNames.length ? 1 : 0) + (pastNames.length ? 1 : 0),
  };
  const todayGroup = sheet.open ? (sheet.groups.find((g) => g.label === '今日')?.items || []) : [];
  const pastGroup = sheet.open ? (sheet.groups.find((g) => g.label === '過往兩天交通消息')?.items || []) : [];
  c.partitionOk =
    todayGroup.length === todayNames.length &&
    pastGroup.length === pastNames.length &&
    todayGroup.every((h) => todayNames.includes(h)) &&
    pastGroup.every((h) => pastNames.includes(h));
  c.tickerOk = !expect.tickerPresent ||
    (landing.ticker.every((t) => todayNames.some((n) => t.includes(n))) &&
     landing.ticker.some((t) => todayNames.some((n) => t.includes(n))));
  c.noErrors = errs.length === 0;

  return { label, landing, sheet, checks: c, errs };
}

(async () => {
  const now = Date.now();
  const todayMsgs = [
    { id: 'TODAY-A', ms: now - 2 * 3600e3, heading: '今日消息甲', detail: '今日內容甲', location: '中環' },
    { id: 'TODAY-B', ms: now - 1 * 3600e3, heading: '今日消息乙', detail: '今日內容乙', location: '旺角' },
  ];
  const pastMsgs = [
    { id: 'PAST-A', ms: now - 26 * 3600e3, heading: '昨日消息甲', detail: '昨日內容甲', location: '沙田' },
    { id: 'PAST-B', ms: now - 30 * 3600e3, heading: '昨日消息乙', detail: '昨日內容乙', location: '荃灣' },
  ];

  if (shotDir && !fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  const scenarios = [
    /* Normal: today + past. The past card must be GONE (it was the duplicate),
       the ticker is the single entry, and the sheet is grouped. */
    await runScenario(browser, {
      label: 'today-and-past',
      msgs: todayMsgs.concat(pastMsgs),
      expect: {
        todayNames: todayMsgs.map((m) => m.heading),
        pastNames: pastMsgs.map((m) => m.heading),
        pastCardRemoved: true,
        tickerPresent: true,
      },
    }),
    /* Edge: past only, no today. The ticker cannot render, so the fallback
       entry MUST exist or those messages are unreachable on mobile. */
    await runScenario(browser, {
      label: 'past-only',
      msgs: pastMsgs,
      expect: {
        todayNames: [],
        pastNames: pastMsgs.map((m) => m.heading),
        pastCardRemoved: false,          // here the card is the only way in
        tickerPresent: false,
      },
    }),
  ];

  await browser.close();

  const KEYS = ['headCountToday', 'pastCardRemoved', 'hasEntry', 'sheetOpen',
                'sheetGrouped', 'partitionOk', 'tickerOk', 'noErrors'];
  let failed = false;
  let blind = false;

  for (const s of scenarios) {
    const c = s.checks;
    const pass = KEYS.every((k) => c[k] === true) && !!c.openedVia;
    /* In teeth mode a PASS is the wrong outcome: the sabotage had no effect,
       so the probe is not testing what it claims. */
    if (TEETH ? pass : !pass) failed = true;
    if (TEETH && pass) blind = true;

    console.log(`\n### ${s.label}  (opened via: ${c.openedVia})`);
    console.log(`  landing: ${JSON.stringify(s.landing)}`);
    console.log(`  sheet  : ${JSON.stringify(s.sheet)}`);
    console.log(`  ${KEYS.map((k) => `${k}=${c[k]}`).join(' ')}`);
    if (s.errs.length) console.log('  errors:', s.errs.join(' | '));
    console.log(`  => ${pass ? 'PASS' : 'FAIL'}${TEETH ? (pass ? ' (WRONG: stayed green = blind)' : ' (correct: went red)') : ''}`);
  }

  if (TEETH) {
    console.log(blind
      ? '\nTEETH: BROKEN — sabotage had no effect; the probe cannot see the bug.'
      : '\nTEETH: OK — probe went red under sabotage, so it can fail.');
  } else {
    console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
