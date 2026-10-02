/*
 * probe-mtr-bus.js — can we get MTR Bus (K巴) arrivals into this app?
 * ===================================================================
 * Answers two questions with evidence rather than assertion:
 *
 *   1. Does an official real-time API exist, and can a STATIC page call it?
 *      Yes: POST https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule
 *      CORS is `Access-Control-Allow-Origin: *` and the preflight allows POST,
 *      so GitHub Pages can call it directly — no proxy needed.
 *
 *   2. The API returns only a `busStopId` (e.g. "K51-D010") — no name, no
 *      coordinates. Can we still render it?
 *      Yes: stops-index.min.json already contains those exact ids (676 of them
 *      across 26 routes), each with name.zh / name.en and location lat/lng.
 *      This script joins the two and prints the result, so the join is proven
 *      rather than assumed.
 *
 * Usage: node tools/probe-mtr-bus.js [--route K51] [--limit 8]
 */
const fs = require('fs');
const path = require('path');

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const ROUTE = arg('route', 'K51');
const LIMIT = parseInt(arg('limit', '8'), 10);
const API = 'https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule';
const ROOT = path.resolve(__dirname, '..');

/* 108000 s (= 30 h) is a sentinel: this bus has no arrival estimate at this
   stop (typically the origin stop, where only a departure time is meaningful).
   Treating it as a real number would render "1800 分鐘". */
const NO_DATA = 108000;

(async () => {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'stops-index.min.json'), 'utf8'));
  const stopList = idx.stopList || {};

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'zh', routeName: ROUTE }),
  });
  console.log(`POST ${API}  route=${ROUTE}  ->  HTTP ${res.status}`);
  console.log(`CORS: ${res.headers.get('access-control-allow-origin')}`);
  if (!res.ok) {
    console.log('body:', (await res.text()).slice(0, 300));
    process.exit(1);
  }

  const j = await res.json();
  const stops = j.busStop || [];
  console.log(`routeName=${j.routeName}  stops=${stops.length}  ` +
              `refresh=${j.appRefreshTimeInSecond}s  updated=${j.routeStatusTime}`);

  const joined = stops.map((s) => ({
    id: s.busStopId,
    meta: stopList[s.busStopId] || null,
    etas: (s.bus || []).map((b) => {
      const secs = parseInt(b.arrivalTimeInSecond, 10);
      const hasArrival = Number.isFinite(secs) && secs < NO_DATA;
      return {
        text: hasArrival ? (b.arrivalTimeText || '') : (b.departureTimeText || ''),
        secs: hasArrival ? secs : null,
        bus: b.busId,
      };
    }).filter((e) => e.text && e.text !== 'Departing / Departed').slice(0, 3),
  }));

  const missing = joined.filter((s) => !s.meta);
  console.log(`stop-name lookup: ${joined.length - missing.length}/${joined.length} matched` +
              (missing.length ? `  MISSING: ${missing.map((m) => m.id).join(', ')}` : ''));

  console.log(`\nnext arrivals (first ${LIMIT} stops with data):`);
  let shown = 0;
  for (const s of joined) {
    if (!s.etas.length) continue;
    const name = s.meta ? s.meta.name.zh : '(unknown stop)';
    const en = s.meta ? s.meta.name.en : '';
    const loc = s.meta ? ` ${s.meta.location.lat.toFixed(4)},${s.meta.location.lng.toFixed(4)}` : '';
    console.log(`  ${s.id.padEnd(11)} ${name.padEnd(14)} ${en.slice(0, 22).padEnd(23)}` +
                `${s.etas.map((e) => e.text).join(' | ')}${loc}`);
    if (++shown >= LIMIT) break;
  }

  const withCoords = joined.filter((s) => s.meta && s.meta.location).length;
  console.log(`\nstops with usable coordinates: ${withCoords}/${joined.length}`);
  console.log(missing.length === 0
    ? 'VERDICT: full join — API + existing stops-index is enough to render MTR Bus.'
    : `VERDICT: join works, but ${missing.length} stop(s) are not in stops-index ` +
      '(refresh that file to pick up newly added stops).');
})().catch((e) => { console.error(e); process.exit(1); });
