/*
 * build-mtr-freq.js — add MTR Bus headways to bus-detail.json
 * =============================================================
 * 「詳請」shows 收費 (from the fare index) and 班次/班距 (from bus-detail.json).
 * bus-detail.json was generated from routeFareList.min.json but only kept
 * KMB/CTB — its 1,340 `freq` entries contain no MTR Bus route, so opening 詳請
 * on a K route said 「暫無班次資料」even though the source data has headways.
 *
 * The two files store freq differently for the same key:
 *
 *   routeFareList:  freq[key][day] = { "0535": ["0705", "900"], ... }
 *                   (object keyed by start time)
 *
 *   bus-detail:     freq[key][day] = [ ["0535","0705","900"], ... ]
 *                   (array of [start, end, headwaySeconds], sorted by start)
 *
 * So this converts rather than copies. Idempotent: existing keys are left
 * alone, and running it twice changes nothing.
 *
 * Re-run after refreshing either file:
 *   node tools/build-mtr-freq.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FARE = path.join(ROOT, 'routeFareList.min.json');
const DETAIL = path.join(ROOT, 'bus-detail.json');
const FARE_CO = 'lrtfeeder';

function main() {
  const fare = JSON.parse(fs.readFileSync(FARE, 'utf8'));
  const detail = JSON.parse(fs.readFileSync(DETAIL, 'utf8'));
  const routeList = fare.routeList || {};
  if (!detail.freq) detail.freq = {};

  let added = 0, skipped = 0, withFreq = 0;
  const missingDays = new Set();

  for (const key of Object.keys(routeList)) {
    const e = routeList[key];
    if (!e) continue;
    const coList = Array.isArray(e.co) ? e.co : [e.co];
    if (!coList.map(c => String(c).toLowerCase()).includes(FARE_CO)) continue;
    if (!e.freq || !Object.keys(e.freq).length) continue;
    withFreq++;
    if (detail.freq[key]) { skipped++; continue; }

    /* object-of-start -> sorted array of [start, end, headway] */
    const byDay = {};
    for (const day of Object.keys(e.freq)) {
      const src = e.freq[day];
      if (!src || typeof src !== 'object') continue;
      const arr = Object.keys(src)
        .map(start => {
          const v = src[start];
          const end = Array.isArray(v) ? v[0] : null;
          const headway = Array.isArray(v) ? v[1] : null;
          return (end != null && headway != null) ? [String(start), String(end), String(headway)] : null;
        })
        .filter(Boolean)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      if (arr.length) byDay[day] = arr;
      if (!detail.days || !detail.days[day]) missingDays.add(day);
    }
    if (!Object.keys(byDay).length) continue;
    detail.freq[key] = byDay;
    added++;
  }

  fs.writeFileSync(DETAIL, JSON.stringify(detail));

  const kb = (fs.statSync(DETAIL).size / 1024).toFixed(0);
  console.log(`MTR Bus route entries with freq in the fare index: ${withFreq}`);
  console.log(`added ${added} to bus-detail.json (${skipped} already present)`);
  console.log(`bus-detail.json now ${Object.keys(detail.freq).length} freq entries (${kb} KB)`);
  if (missingDays.size) {
    console.log(`note: these day codes are not in bus-detail.days: ${[...missingDays].join(', ')}`);
  }
}

main();
