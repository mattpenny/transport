/*
 * build-mtr-fares.js — generate mtr-fares.min.json from the OFFICIAL MTR CSV
 * ==========================================================================
 * Why this file has to exist
 * --------------------------
 * Until now, MTR Bus (K巴) fares came from routeFareList.min.json under the
 * company key `lrtfeeder`. That looked like it worked — but it silently did not:
 * of the 60 lrtfeeder (route, serviceType, direction) entries, only 45 carry a
 * `fares` array. The other 15 are `fares: null`, and they are not a random 15 —
 * they are exactly the routes a user is most likely to type:
 *
 *     K12  K14  K17  K18   (all 大埔 routes)
 *     K51 s3, K52 s2, K66 s2, K68 s3   (secondary serviceTypes)
 *
 * So 詳請 showed no fare for the entire 大埔 group, and the sidebar fare line
 * stayed blank, with nothing visibly broken — the classic silent failure.
 *
 * Two facts made this fixable from the official open data:
 *
 *   1. The official dataset (data.gov.hk, "MTR Bus routes, fares, barrier-free
 *      facilities") publishes the full adult/child/elderly fare for all 26
 *      routes. Measured against the 45 entries that DID have fare data in the
 *      fare index, the CSV agrees on every single one — so the two sources are
 *      not in conflict, the CSV simply has no holes.
 *
 *   2. MTR Bus fares are FLAT: every stop on a route costs the same. 詳請
 *      existed to show a per-stop ladder for KMB/CTB, where the price genuinely
 *      falls as you travel. For K巴士 there is no ladder to show, so one
 *      adult fare per route is the complete answer.
 *
 * Why a separate data file and not a patch to routeFareList.min.json
 * -----------------------------------------------------------------
 * routeFareList.min.json is a hand-downloaded 3.7 MB upstream artefact. Editing
 * it in place would be lost the next time it is re-downloaded, and would make
 * it impossible to tell upstream data from our own. A small generated file with
 * `source` / `generated` provenance is regenerated in one command and survives
 * every upstream refresh.
 *
 * Shape
 * -----
 *   { source, sourceUrl, generated, note,
 *     routes: { "K12": { adult, child, elderly, joYu, pwd, student }, ... } }
 *
 * adult is FARE_OCTO_ADULT (Octopus/contactless). FARE_SINGLE_* is the
 * cash/ticket price and is identical or blank ("-") in the CSV, so the app
 * shows the Octopus price, which is what a rider actually pays.
 *
 * Rerun after downloading a fresh CSV:
 *   node tools/build-mtr-fares.js [<path-to-mtr_bus_fares.csv>]
 * Default input path is ~/Downloads/mtr_bus_fares.csv.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'mtr-fares.min.json');

const SRC = process.argv[2] ||
  path.join(os.homedir(), 'Downloads', 'mtr_bus_fares.csv');

const SOURCE_URL =
  'https://data.gov.hk/en-data/dataset/mtr-data-routes-fares-barrier-free-facilities';

/* Minimal RFC-4180 CSV reader.
 *
 * Why not split on ','? Several destination names in the related MTR datasets
 * contain commas inside quotes, and the ROUTE_ID column can legally be quoted.
 * A naive split that works on today's file becomes a silent mis-parse the day
 * the publisher adds a quoted field — and a fare mis-parse is invisible, it
 * just prints a wrong number. So parse properly.
 */
function parseCsv(text) {
  /* Strip a UTF-8 BOM: Excel-exported CSVs carry one, and it would otherwise
     become part of the first header name and break every column lookup. */
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* swallow CR of CRLF */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ''));
}

/* "-" is the publisher's "not applicable" marker (child/student/PwD fares that
   do not exist on that route). Treat it as absent rather than 0 — showing
   "小童 $0.0" would be a worse bug than omitting the row. */
function num(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s === '-') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`input CSV not found: ${SRC}`);
    console.error('usage: node tools/build-mtr-fares.js [<mtr_bus_fares.csv>]');
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(SRC, 'utf8'));
  if (!rows.length) { console.error('empty CSV'); process.exit(1); }

  const head = rows[0].map((h) => h.trim());
  const col = (name) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`CSV is missing the column "${name}" (got: ${head.join(', ')})`);
    return i;
  };
  const cRoute = col('ROUTE_ID');
  const cAdult = col('FARE_OCTO_ADULT');
  const cChild = col('FARE_OCTO_CHILD');
  const cElder = col('FARE_OCTO_ELDERLY');
  /* Optional columns — present in the current file, tolerated if dropped. */
  const opt = (name) => { const i = head.indexOf(name); return i < 0 ? -1 : i; };
  const cJoyu = opt('FARE_OCTO_JOYU');
  const cPwd = opt('FARE_OCTO_PWD');
  const cStudent = opt('FARE_OCTO_STUDENT');

  const routes = {};
  const problems = [];

  for (const r of rows.slice(1)) {
    const id = String(r[cRoute] || '').trim();
    if (!id) continue;
    const adult = num(r[cAdult]);
    if (adult == null) { problems.push(`${id}: no adult fare`); continue; }

    const rec = { adult };
    const child = num(r[cChild]);
    const elder = num(r[cElder]);
    if (child != null) rec.child = child;
    if (elder != null) rec.elderly = elder;
    if (cJoyu >= 0) { const v = num(r[cJoyu]); if (v != null) rec.joyu = v; }
    if (cPwd >= 0) { const v = num(r[cPwd]); if (v != null) rec.pwd = v; }
    if (cStudent >= 0) { const v = num(r[cStudent]); if (v != null) rec.student = v; }

    /* Duplicate ROUTE_ID rows exist on purpose (e.g. K51 twice, REFERENCE_ID
       K51 and K51-1/-2) — they are per-journey variants that all share the same
       flat fare. Assert that rather than last-write-wins, because if the
       publisher ever introduces a genuinely different fare for one variant this
       script must stop and say so, not quietly pick one. */
    if (routes[id]) {
      const same = Object.keys(rec).every((k) => routes[id][k] === rec[k]) &&
                   Object.keys(routes[id]).every((k) => routes[id][k] === rec[k]);
      if (!same) {
        problems.push(`${id}: conflicting fares across duplicate rows ` +
                      `(${JSON.stringify(routes[id])} vs ${JSON.stringify(rec)})`);
        continue;
      }
    }
    routes[id] = rec;
  }

  const ids = Object.keys(routes);

  /* Coverage assertion against the route list the app actually ships. A route
     that exists in mtr-routes.min.json but has no fare here is precisely the
     bug this file was written to fix, so fail loudly instead of shipping it. */
  const routesFile = path.join(ROOT, 'mtr-routes.min.json');
  let missing = [];
  if (fs.existsSync(routesFile)) {
    const appRoutes = JSON.parse(fs.readFileSync(routesFile, 'utf8')).routes || [];
    const appIds = [...new Set(appRoutes.map((r) => String(r.route)))];
    missing = appIds.filter((r) => !routes[r]);
  }

  fs.writeFileSync(OUT, JSON.stringify({
    source: path.basename(SRC),
    sourceUrl: SOURCE_URL,
    generated: new Date().toISOString(),
    note: 'Flat adult fare per MTR Bus route, from the official data.gov.hk ' +
          '"MTR Bus routes, fares, barrier-free facilities" dataset ' +
          '(FARE_OCTO_* = Octopus / contactless). MTR Bus charges the same ' +
          'fare at every stop, so one value per route is complete. ' +
          'Rebuild with tools/build-mtr-fares.js.',
    count: ids.length,
    routes,
  }, null, 0));

  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`wrote ${ids.length} routes (${kb} KB) -> mtr-fares.min.json`);
  console.log('routes:', ids.sort().join(' '));
  if (missing.length) {
    console.log(`\nMISSING vs mtr-routes.min.json: ${missing.join(' ')}`);
  } else {
    console.log('coverage: every route in mtr-routes.min.json has a fare');
  }
  if (problems.length) console.log('\nproblems:', problems.join(' | '));

  process.exit(missing.length || problems.length ? 1 : 0);
}

main();
