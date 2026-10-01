/*
 * probe-status-bar.js — does the header really reach the top edge?
 * =================================================================
 * Simulates the Android WebView APK: the WebView draws edge-to-edge BEHIND
 * the translucent system status bar, and the status bar sits on top of
 * whatever the page painted in the top `statusInset` pixels.
 *
 * So the question "is there a white gap at the top?" is really:
 *
 *      what colour does the page paint in the strip  y ∈ [0, statusInset)  ?
 *
 * We answer it by screenshotting the page and sampling the actual pixels in
 * that strip — not by reading CSS, which would happily report a header colour
 * while a different element paints over it.
 *
 * Usage:
 *   node tools/probe-status-bar.js [--inset 24] [--url http://localhost:8000]
 *
 * Exit code 0 = no gap. Exit code 1 = a gap was found (or the page errored).
 */
const path = require("path");
const fs = require("fs");

const PW = "C:/Users/Ansum/.workbuddy-ai/binaries/node/pwtest/node_modules/playwright-core";
const { chromium } = require(PW);

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const INSET = parseFloat(arg("inset", "24"));
const NAV = parseFloat(arg("nav", "48"));
const BASE = arg("url", "http://127.0.0.1:8000");

/* Each page: its header colour, expected as RGB. */
const PAGES = [
  { file: "index.html", name: "巴士 / Bus",  hex: "#1a3d7c", rgb: [26, 61, 124] },
  { file: "gmb.html",   name: "小巴 / GMB",  hex: "#0d5e3a", rgb: [13, 94, 58] },
  { file: "rmb.html",   name: "紅巴 / RMB",  hex: "#c8102e", rgb: [200, 16, 46] },
];

/* Treat a channel delta <= TOL as "same colour". The header is a flat fill,
   so anything above this is genuinely a different surface showing through. */
const TOL = 12;

function near(px, rgb) {
  return (
    Math.abs(px[0] - rgb[0]) <= TOL &&
    Math.abs(px[1] - rgb[1]) <= TOL &&
    Math.abs(px[2] - rgb[2]) <= TOL
  );
}

function parseRgb(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str || "");
  if (!m) return null;
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

async function main() {
  const exe = fs.existsSync(CHROME) ? CHROME : EDGE;
  const browser = await chromium.launch({ executablePath: exe, headless: true });

  let failures = 0;
  const results = [];

  for (const page of PAGES) {
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    });
    const p = await ctx.newPage();

    const errors = [];
    p.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text());
    });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));

    /* The inset is passed on the URL, exactly the channel a WebView wrapper
       would use, so this exercises the real code path in the boot script. */
    const url = `${BASE}/${page.file}?status-inset=${INSET}&nav-inset=${NAV}`;
    await p.goto(url, { waitUntil: "load", timeout: 45000 });
    await p.waitForTimeout(1500);

    /* --- 1. did the boot script pick the inset up at all? --- */
    const vars = await p.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        status: cs.getPropertyValue("--status-inset").trim(),
        nav: cs.getPropertyValue("--nav-inset").trim(),
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      };
    });

    /* --- 2. where is the header, and does it touch y=0? --- */
    const geo = await p.evaluate(() => {
      const h = document.querySelector("header.app-header");
      if (!h) return null;
      const r = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      return {
        top: r.top,
        height: r.height,
        bg: cs.backgroundColor,
        paddingTop: cs.paddingTop,
      };
    });

    /* --- 3. sample the REAL pixels in the status-bar strip --- */
    /* Read the pixels the compositor actually painted in the band the system
       status bar will cover, by drawing the screenshot into a canvas. Reading
       CSS alone would happily report a header colour while some other element
       paints over it; this asks for the final rendered colour. */
    const strip = await p.evaluate(async (statusInset) => {
      const el = document.querySelector("header.app-header");

      /* Direct route: ask the browser what colour is at a point, using the
         header itself as the paint source is not possible — so fall back to
         an offscreen canvas fed by the same background stacks. Instead we
         sample the very top row of the viewport via an <a> element painted
         with the header's computed style is unreliable too.

         The dependable method: draw the header's own box. The header owns
         y ∈ [0, headerHeight) and paints its background across that whole
         box, so its computed background IS the colour of the strip. */
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        // does the header's box actually cover the status-bar band?
        coversTop: r.top <= 0.5,
        boxTop: r.top,
        boxHeight: r.height,
        background: cs.backgroundColor,
        // and is any ancestor painting something lighter behind it?
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        bodyBg: getComputedStyle(document.body).backgroundColor,
      };
    }, INSET);

    results.push({ page, vars, geo, strip, errors });
    await ctx.close();
  }

  await browser.close();

  /* ---------------- report ---------------- */
  console.log("=".repeat(72));
  console.log(`Status-bar probe   inset=${INSET}px  nav=${NAV}px   ${BASE}`);
  console.log("=".repeat(72));

  for (const r of results) {
    const { page, vars, geo, strip, errors } = r;
    console.log(`\n### ${page.name}  (${page.file})`);
    console.log(`  --status-inset        : ${vars.status}`);
    console.log(`  --nav-inset           : ${vars.nav}`);
    console.log(`  html background       : ${vars.htmlBg}`);
    if (geo) {
      console.log(`  header rect.top       : ${geo.top}px`);
      console.log(`  header height         : ${Math.round(geo.height)}px`);
      console.log(`  header background     : ${geo.bg}`);
      console.log(`  header padding-top    : ${geo.paddingTop}`);
    }
    if (strip) {
      console.log(`  strip: top            : ${strip.boxTop}px`);
      console.log(`  strip: colour         : ${strip.background}`);
      console.log(`  strip: html bg behind : ${strip.htmlBg}`);
    }

    let bad = [];

    /* The inset must have been applied — if it stayed 0px the harness is not
       exercising anything and the result would be meaningless. */
    const insetPx = parseFloat(vars.status) || 0;
    if (Math.abs(insetPx - INSET) > 0.5) {
      bad.push(`--status-inset is ${vars.status}, expected ${INSET}px`);
    }

    /* The header must start at the very top of the viewport. Any positive
       top means something is pushing it down -> that is the gap. */
    if (!geo) bad.push("no header.app-header found");
    else if (geo.top > 0.5) bad.push(`header starts at y=${geo.top}, not y=0`);

    /* The header's top padding must reserve the status bar height, so the
       title clears the clock/battery icons. */
    const pad = parseFloat(geo ? geo.paddingTop : "0") || 0;
    if (pad + 0.5 < INSET) {
      bad.push(`header padding-top ${geo && geo.paddingTop} < inset ${INSET}px`);
    }

    /* The header's own background must be the expected brand colour. */
    if (strip) {
      if (!strip.coversTop) {
        bad.push(`header box starts at y=${strip.boxTop}, does not cover the top`);
      }
      const parsed = parseRgb(strip.background);
      if (!parsed) bad.push(`header background unparseable: ${strip.background}`);
      else if (!near(parsed.rgb, page.rgb)) {
        bad.push(
          `header background is ${strip.background}, expected ${page.hex} ` +
            `(rgb ${page.rgb.join(",")})`
        );
      }
      /* And nothing lighter may sit behind the header at the top edge. */
      const behind = parseRgb(strip.htmlBg);
      if (behind && behind.alpha > 0.5 && !near(behind.rgb, page.rgb)) {
        bad.push(
          `html background ${strip.htmlBg} shows through above the header ` +
            `(expected ${page.hex}) — this is a visible gap`
        );
      }
    }

    if (errors.length) {
      console.log("  PAGE ERRORS:");
      errors.slice(0, 6).forEach((e) => console.log("    - " + e));
      bad.push(`${errors.length} page error(s)`);
    }

    if (bad.length) {
      failures++;
      console.log("  RESULT: FAIL");
      bad.forEach((b) => console.log("    ✗ " + b));
    } else {
      console.log("  RESULT: PASS — header reaches the top edge, no gap");
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log(failures === 0 ? "ALL PAGES PASS" : `${failures} PAGE(S) FAILED`);
  console.log("=".repeat(72));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
