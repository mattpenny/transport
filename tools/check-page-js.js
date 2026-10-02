/*
 * check-page-js.js — syntax-check every inline <script> in a set of pages.
 *
 * Why this is not a one-liner: a naive /<script[^>]*>([\s\S]*?)<\/script>/ also
 * matches a `<script>` that appears *inside an HTML comment* (index.html has
 * one in its header comment: "The library <script> tags live at the END of
 * <body>"). That produces a garbage "block" which fails to parse and looks
 * like a broken page. Strip HTML comments first, then extract.
 *
 * Also: a template identifier missing from setup()'s return {} is invisible in
 * the prod build, so this checks the JS parses AND that every identifier the
 * template uses is exported.
 *
 * Usage: node tools/check-page-js.js index.html gmb.html rmb.html mtr.html
 */
const fs = require('fs');
const vm = require('vm');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/check-page-js.js <page.html> [...]');
  process.exit(2);
}

let failed = false;

for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  /* Strip HTML comments AND <style> blocks before extracting scripts. Both can
     contain the literal text "<script>": index.html's CSS comment mentions the
     library script tags, and a naive regex then captures from there to the
     first </script>, producing a garbage "block" that fails to parse and looks
     like a broken page. */
  const html = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]);

  /* Compile in-process. Spawning `node --check` on a temp file hits EBUSY on
     Windows because the file is still locked by this process. */
  let syntaxOk = true, err = '';
  try { new vm.Script(blocks.join('\n;\n'), { filename: f }); }
  catch (e) { syntaxOk = false; err = String(e.message || e).split('\n').slice(0, 3).join(' '); }

  /* Template identifiers vs setup()'s return {} — the silent prod-build trap. */
  let missing = [];
  const m = html.match(/<div id="app"[\s\S]*?<\/div>\s*<script>/);
  const ret = html.match(/return\s*\{([\s\S]*?)\}\s*;?\s*\}\)\s*\.mount/);
  if (m && ret) {
    const used = new Set();
    for (const x of m[0].matchAll(/\{\{\s*([A-Za-z_$][\w$]*)/g)) used.add(x[1]);
    for (const x of m[0].matchAll(/\bv-if="([A-Za-z_$][\w$]*)/g)) used.add(x[1]);
    for (const x of m[0].matchAll(/\bv-for="\w+\s+in\s+([A-Za-z_$][\w$]*)/g)) used.add(x[1]);
    for (const x of m[0].matchAll(/\bv-model="([A-Za-z_$][\w$]*)/g)) used.add(x[1]);
    for (const x of m[0].matchAll(/@click="([A-Za-z_$][\w$]*)/g)) used.add(x[1]);
    const exported = new Set([...ret[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((y) => y[0]));
    missing = [...used].filter((u) => !exported.has(u));
  }

  const ok = syntaxOk && missing.length === 0;
  if (!ok) failed = true;
  console.log(`${f.padEnd(12)} scripts=${blocks.length} syntax=${syntaxOk ? 'OK' : 'FAIL'} ` +
              `unexported=${missing.length ? missing.join(',') : 'none'} => ${ok ? 'PASS' : 'FAIL'}`);
  if (err) console.log('   ', err);
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
process.exit(failed ? 1 : 0);
