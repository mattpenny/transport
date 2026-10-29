/*
 * build-fare-data.mjs — refresh the split fare/stop data files
 * =================================================================
 * Source: https://data.hkbus.app/routeFareList.min.json
 * (hkbus.app's crawl of the Transport Department dataset
 *  hk-td-tis_14-route-fare-list, updated upstream roughly daily.)
 *
 * This repo splits that single file in two, so phones don't have to
 * download the stop list just to look up a fare:
 *   routeFareList.min.json  <- holidays, routeList, serviceDayMap
 *                              (+ this repo's own source/copyright meta,
 *                                 which upstream does not carry — preserved
 *                                 from the existing file)
 *   stops-index.min.json    <- stopList, stopMap
 *
 * After running this, also re-run:
 *   node tools/build-mtr-routes.js   (reads routeFareList.min.json)
 *   node tools/build-mtr-stops.js    (reads stops-index.min.json)
 * …or just let the update-fare-data workflow run all three.
 *
 * DATA_VERSION in index.html / gmb.html / rmb.html is bumped to today
 * (Asia/Hong_Kong) so browsers refetch the JSON instead of using a
 * cached copy. Nothing is written if upstream fails validation.
 *
 * Usage: node tools/build-fare-data.mjs [--no-version-bump]
 */
import { readFileSync, writeFileSync } from "node:fs";

const UPSTREAM = "https://data.hkbus.app/routeFareList.min.json";
const bumpVersion = !process.argv.includes("--no-version-bump");

function count(obj) { return obj ? Object.keys(obj).length : 0; }

const res = await fetch(UPSTREAM);
if (!res.ok) throw new Error("upstream HTTP " + res.status);
const up = await res.json();

/* Validate before touching anything: a truncated or reshaped upstream
   must never replace known-good local data. */
for (const k of ["routeList", "stopList", "stopMap", "holidays", "serviceDayMap"]) {
  if (!(k in up)) throw new Error("upstream missing key: " + k);
}
if (count(up.routeList) < 3000) throw new Error("upstream routeList suspiciously small: " + count(up.routeList));
if (count(up.stopList) < 10000) throw new Error("upstream stopList suspiciously small: " + count(up.stopList));

const oldFare = JSON.parse(readFileSync("routeFareList.min.json", "utf8"));
const oldStops = JSON.parse(readFileSync("stops-index.min.json", "utf8"));

/* Preserve the repo's own meta block (source attribution), in the
   existing key order: holidays, routeList, serviceDayMap, then meta. */
const fare = {
  holidays: up.holidays,
  routeList: up.routeList,
  serviceDayMap: up.serviceDayMap,
};
for (const k of ["source", "sourceName", "sourceUrl", "copyright", "licence"]) {
  if (k in oldFare) fare[k] = oldFare[k];
}
const stops = { stopList: up.stopList, stopMap: up.stopMap };

writeFileSync("routeFareList.min.json", JSON.stringify(fare));
writeFileSync("stops-index.min.json", JSON.stringify(stops));

console.log(
  "routeFareList: routes " + count(oldFare.routeList) + " -> " + count(fare.routeList) +
  " | stops-index: stops " + count(oldStops.stopList) + " -> " + count(stops.stopList)
);

if (bumpVersion) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" }); // YYYY-MM-DD
  for (const f of ["index.html", "gmb.html", "rmb.html"]) {
    const src = readFileSync(f, "utf8");
    const out = src.replace(/const DATA_VERSION = "\d{4}-\d{2}-\d{2}";/,
      'const DATA_VERSION = "' + today + '";');
    if (out !== src) { writeFileSync(f, out); console.log(f + ": DATA_VERSION -> " + today); }
  }
}
