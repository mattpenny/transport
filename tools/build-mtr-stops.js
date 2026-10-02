/*
 * build-mtr-stops.js — extract just the MTR Bus stops from the full stop index
 * ============================================================================
 * Why this exists: the MTR Bus API returns only a busStopId (e.g. "K51-D010").
 * The names and coordinates live in stops-index.min.json — but that file is
 * 3.4 MB because it covers every stop in Hong Kong (15,267 of them). Making a
 * phone download 3.4 MB to display ~676 MTR Bus stops is absurd, so we extract
 * the subset once and ship a small file.
 *
 * The stop ids are NOT consistently cased: K51-D010 but K52-nD010 (lowercase
 * "n"). An [A-Z] pattern silently drops all 60 of K52's stops — so match
 * [A-Za-z] and let the join decide.
 *
 * Run after refreshing stops-index.min.json:
 *   node tools/build-mtr-stops.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'stops-index.min.json');
const OUT = path.join(ROOT, 'mtr-stops.min.json');

/* MTR Bus stop ids look like: K51-D010, K51-U065, K52-nD010, 506-D010.
   Route prefix is everything before the dash; the tail is an optional letter
   run, then D (down/去程) or U (up/回程), then digits. */
const STOP_ID = /^(.+?)-([A-Za-z]{0,2})([DU])(\d+)$/;

function main() {
  const idx = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const stopList = idx.stopList || {};

  const stops = {};
  let scanned = 0;
  for (const id of Object.keys(stopList)) {
    scanned++;
    const m = STOP_ID.exec(id);
    if (!m) continue;
    const v = stopList[id];
    if (!v || !v.location || !v.name) continue;
    /* Mirror stops-index.min.json's shape exactly ({name:{zh,en},
       location:{lat,lng}}) rather than flattening it. The extract is meant to
       be a drop-in subset of the source, so code written against one works
       against the other — a flattened copy invites a silent `undefined` read
       the first time someone copies a lookup from elsewhere. */
    stops[id] = {
      name: { zh: v.name.zh, en: v.name.en },
      location: { lat: v.location.lat, lng: v.location.lng },
    };
  }

  /* Group by route so the page can build its route list without scanning. */
  const byRoute = {};
  for (const id of Object.keys(stops)) {
    const route = STOP_ID.exec(id)[1];
    (byRoute[route] = byRoute[route] || []).push(id);
  }
  for (const r of Object.keys(byRoute)) {
    byRoute[r].sort((a, b) => {
      const ma = STOP_ID.exec(a), mb = STOP_ID.exec(b);
      if (ma[2] !== mb[2]) return ma[2] < mb[2] ? -1 : 1;   // D before U
      if (ma[3] !== mb[3]) return ma[3] < mb[3] ? -1 : 1;
      return parseInt(ma[4], 10) - parseInt(mb[4], 10);
    });
  }

  const payload = {
    source: 'stops-index.min.json',
    generated: new Date().toISOString(),
    note: 'MTR Bus stops only. Names/coords keyed by the busStopId the ' +
          'rt.data.gov.hk MTR Bus API returns. Rebuild with tools/build-mtr-stops.js.',
    count: Object.keys(stops).length,
    routes: Object.keys(byRoute).sort(),
    byRoute,
    stops,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload));

  const srcKB = (fs.statSync(SRC).size / 1024).toFixed(0);
  const outKB = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`scanned ${scanned} stops in ${path.basename(SRC)} (${srcKB} KB)`);
  console.log(`kept ${payload.count} MTR Bus stops across ${payload.routes.length} routes`);
  console.log(`wrote ${path.basename(OUT)} (${outKB} KB) — ` +
              `${(100 * outKB / srcKB).toFixed(1)}% of the source`);
  console.log('routes:', payload.routes.join(' '));
}

main();
