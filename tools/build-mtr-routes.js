/*
 * build-mtr-routes.js — generate the MTR Bus route/direction list
 * =================================================================
 * index.html's route list needs, per (route, direction, serviceType):
 *     route, direction, orig_tc, dest_tc
 *
 * The source is routeFareList.min.json, NOT the MTR API. Two reasons:
 *
 *   1. MTR Bus already exists in that file under the company key `lrtfeeder`
 *      (輕鐵接駁巴士 is 港鐵巴士) — all 26 routes, with fares, headway (`freq`)
 *      and stop sequences. Using it means MTR gets the same fare and 詳請
 *      behaviour as KMB/CTB for free, instead of being a second-class mode.
 *
 *   2. Its `bound` is O/I, which is what lookupFareEntry() compares against.
 *      The API's D/U grouping is a different vocabulary; deriving the list from
 *      the API would leave the two unable to match, and lookupFareEntry would
 *      fall back to "first candidate" — i.e. sometimes the OPPOSITE direction's
 *      fare and stop sequence, with nothing visibly wrong on screen.
 *
 * The page maps O/I -> the API's D/U group by matching stop ids at fetch time
 * (see fetchMtrRouteStops), which stays correct even if either side renames.
 *
 * Re-run after refreshing routeFareList.min.json:
 *   node tools/build-mtr-routes.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'routeFareList.min.json');
const OUT = path.join(ROOT, 'mtr-routes.min.json');
const FARE_CO = 'lrtfeeder';

function main() {
  const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const routeList = raw.routeList || {};
  const routes = [];
  const problems = [];

  for (const key of Object.keys(routeList)) {
    const e = routeList[key];
    if (!e) continue;
    const coList = Array.isArray(e.co) ? e.co : [e.co];
    if (!coList.map((c) => String(c).toLowerCase()).includes(FARE_CO)) continue;

    const bound = (e.bound && (e.bound[FARE_CO] || e.bound[Object.keys(e.bound)[0]])) || '';
    const orig = (e.orig && e.orig.zh) || '';
    const dest = (e.dest && e.dest.zh) || '';
    if (!orig || !dest) { problems.push(`${key}: no orig/dest`); continue; }

    routes.push({
      route: String(e.route || '').trim(),
      serviceType: String(e.serviceType || '1'),
      /* O/I — the vocabulary lookupFareEntry() and stopsMap use. */
      direction: String(bound).toUpperCase() || 'O',
      orig_tc: orig,
      dest_tc: dest,
      /* Kept so the page can sanity-check the direction it picks. */
      stopCount: (e.stops && e.stops[FARE_CO] && e.stops[FARE_CO].length) || 0,
    });
  }

  routes.sort((a, b) => {
    const na = parseInt(String(a.route).replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(String(b.route).replace(/\D/g, ''), 10) || 0;
    if (na !== nb) return na - nb;
    if (a.route !== b.route) return String(a.route).localeCompare(String(b.route));
    if (a.serviceType !== b.serviceType) return Number(a.serviceType) - Number(b.serviceType);
    return a.direction < b.direction ? -1 : 1;
  });

  fs.writeFileSync(OUT, JSON.stringify({
    source: 'routeFareList.min.json',
    fareCompany: FARE_CO,
    generated: new Date().toISOString(),
    note: 'MTR Bus route/direction list, extracted from the fare index where it ' +
          'appears as `lrtfeeder`. direction is O/I to match lookupFareEntry(). ' +
          'Rebuild with tools/build-mtr-routes.js.',
    count: routes.length,
    routes,
  }));

  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  const distinct = [...new Set(routes.map((r) => r.route))];
  console.log(`kept ${routes.length} route-directions across ${distinct.length} routes (${kb} KB)`);
  console.log('routes:', distinct.join(' '));
  const bySt = {};
  for (const r of routes) bySt[r.serviceType] = (bySt[r.serviceType] || 0) + 1;
  console.log('by serviceType:', JSON.stringify(bySt));
  if (problems.length) console.log('problems:', problems.join(' | '));
}

main();
