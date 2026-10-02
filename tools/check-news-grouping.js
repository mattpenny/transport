/*
 * check-news-grouping.js — does mobile separate "today" from "past two days"?
 * ============================================================================
 * Reported bug: in MOBILE mode the 特別交通消息 card shows previous days' news,
 * and 過往兩天交通消息 also shows everything — "all messages showed in both cards".
 *
 * To test this deterministically we must control the data. The page merges
 * three sources (live TD XML + shared archive + localStorage), so we intercept
 * the network for the two file sources and clear localStorage, then serve a
 * known set: 2 messages dated TODAY and 2 dated YESTERDAY.
 *
 * Then we assert, for mobile viewport:
 *   - the 特別交通消息 heading count == number of TODAY's messages only
 *   - the ticker contains only TODAY's messages
 *   - the 過往兩天交通消息 card count == number of PAST messages
 *   - opening the sheet shows both groups, correctly partitioned
 *
 * Usage: node tools/check-news-grouping.js [--url http://127.0.0.1:8000] [--teeth]
 * --teeth: sabotage by removing the grouping so the probe must go red.
 */
const PW = 'C:/Users/Ansum/.workbuddy-ai/binaries/node/pwtest/node_modules/playwright-core';
const { chromium } = require(PW);

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 ? process.argv[i + 1] : 'http://127.0.0.1:8000';
})();
const TEETH = process.argv.includes('--teeth');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/* --- Build a TD-format XML with a known mix of today / yesterday ---------- */
function tdXml(todayMsgs, pastMsgs) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const msg = (m, i) => `
    <message>
      <ID>${m.id}</ID>
      <ANNOUNCEMENT_DATE>${stamp(m.ms)}</ANNOUNCEMENT_DATE>
      <INCIDENT_STATUS_EN>OPEN</INCIDENT_STATUS_EN>
      <INCIDENT_STATUS_CN>生效中</INCIDENT_STATUS_CN>
      <INCIDENT_HEADING_CN>${m.heading}</INCIDENT_HEADING_CN>
      <CONTENT_CN>${m.detail}</CONTENT_CN>
      <LOCATION_CN>${m.location || ''}</LOCATION_CN>
      <DIRECTION_CN></DIRECTION_CN>
      <NEAR_LANDMARK_CN></NEAR_LANDMARK_CN>
    </message>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<trafficnews>` +
    todayMsgs.map(msg).join('') + pastMsgs.map(msg).join('') + `\n</trafficnews>`;
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
  const xml = tdXml(todayMsgs, pastMsgs);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },   // mobile
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });

  /* Serve controlled data for both file sources; let everything else through. */
  await ctx.route('**/traffic-news-archive.json*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ generated: '', retainDays: 3, count: 0, messages: [] }) }));
  await ctx.route('**/trafficnews.xml*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/xml', body: xml }));

  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await p.goto(`${argUrl}/index.html`, { waitUntil: 'load' });
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(2500);   // let the traffic load finish

  /* --- read the mobile landing card --- */
  const landing = await p.evaluate(() => {
    const sec = document.querySelector('.tp-section');
    const heads = [...document.querySelectorAll('.tp-head')].map((h) => ({
      title: (h.querySelector('h3') || {}).textContent?.trim(),
      count: (h.querySelector('.tp-updated') || {}).textContent?.trim(),
    }));
    const ticker = [...document.querySelectorAll('.tp-ticker-item')].map((s) => s.textContent.trim());
    const dayCard = document.querySelector('.tp-day');
    const dayLabel = dayCard ? dayCard.querySelector('.tp-day-date')?.textContent.trim() : null;
    const dayCount = dayCard ? dayCard.querySelector('.tp-day-count')?.textContent.trim() : null;
    return { heads, ticker, dayLabel, dayCount, hasSection: !!sec };
  });

  /* Optional screenshots: a UI bug deserves a look, not only an assertion set.
     `--shot <dir>` writes landing.png (the card) and sheet.png (the panel). */
  const shotIdx = process.argv.indexOf('--shot');
  const shotDir = shotIdx !== -1 ? process.argv[shotIdx + 1] : null;
  const fs = require('fs');
  if (shotDir && !fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true });

  /* --- open the sheet (tap the 過往兩天 card, which is always present here) --- */
  if (shotDir) await p.screenshot({ path: `${shotDir}/landing.png` });
  await p.evaluate(() => {
    const btn = document.querySelector('.tp-day-head');
    if (btn) btn.click();
  });
  await p.waitForTimeout(500);

  if (TEETH) {
    /* Sabotage must reproduce the REPORTED bug, not just hide a label:
       the old markup was one flat <ul> with no group blocks. Collapse the
       groups back into that shape. If the probe cannot see this, it is blind. */
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
    const groups = [...body.querySelectorAll('.tp-news-group-block')].map((g) => ({
      label: g.querySelector('.tp-news-group')?.textContent.trim(),
      items: [...g.querySelectorAll('.tp-news-heading')].map((x) => x.textContent.trim()),
    }));
    const flat = [...body.querySelectorAll('.tp-news-heading')].map((x) => x.textContent.trim());
    const title = document.querySelector('.tp-sheet-title')?.textContent.trim();
    const count = body.querySelector('.tp-updated')?.textContent.trim();
    return { open: true, title, count, groups, flat };
  });

  /* ---------------------------- assertions ------------------------------- */
  const todayNames = todayMsgs.map((m) => m.heading);
  const pastNames = pastMsgs.map((m) => m.heading);

  const mainHead = landing.heads.find((h) => h.title === '特別交通消息');
  const todayCountOk = !!mainHead && mainHead.count === `${todayNames.length} 則`;
  const tickerOk = landing.ticker.every((t) => todayNames.some((n) => t.includes(n)))
    && landing.ticker.some((t) => todayNames.some((n) => t.includes(n)));
  const dayCardOk = landing.dayCount === `${pastNames.length} 則`;

  /* Optional screenshots: a UI bug deserves a look, not only an assertion set. */
  if (shotDir) {
    await p.screenshot({ path: `${shotDir}/sheet.png` });
    console.log(`shots written to ${shotDir}`);
  }

  const sheetOpen = sheet.open === true;
  const sheetGrouped = sheetOpen && sheet.groups.length === 2;
  const sheetTodayGroup = sheetOpen
    ? (sheet.groups.find((g) => g.label === '今日')?.items || [])
    : [];
  const sheetPastGroup = sheetOpen
    ? (sheet.groups.find((g) => g.label === '過往兩天交通消息')?.items || [])
    : [];
  const sheetPartitionOk =
    sheetTodayGroup.length === todayNames.length &&
    sheetPastGroup.length === pastNames.length &&
    sheetTodayGroup.every((h) => todayNames.includes(h)) &&
    sheetPastGroup.every((h) => pastNames.includes(h));

  const pass = todayCountOk && tickerOk && dayCardOk && sheetGrouped &&
               sheetPartitionOk && errs.length === 0;
  const blind = TEETH && pass;

  console.log(`landing: ${JSON.stringify(landing, null, 0)}`);
  console.log(`sheet  : ${JSON.stringify(sheet, null, 0)}`);
  console.log(`  todayCountOk=${todayCountOk} tickerOk=${tickerOk} dayCardOk=${dayCardOk}`);
  console.log(`  sheetOpen=${sheetOpen} grouped=${sheetGrouped} partitionOk=${sheetPartitionOk}`);
  console.log(`  errors=${errs.length} => ${pass ? 'PASS' : 'FAIL'}`);
  if (errs.length) console.log('  errs:', errs.join(' | '));

  await browser.close();
  if (TEETH) {
    console.log(blind
      ? '\nTEETH: BROKEN — sabotage had no effect; the probe cannot see the bug.'
      : '\nTEETH: OK — probe went red under sabotage, so it can fail.');
    process.exit(blind ? 1 : 0);
  }
  console.log(pass ? '\nRESULT: PASS' : '\nRESULT: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
