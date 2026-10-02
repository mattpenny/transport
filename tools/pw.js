/*
 * pw.js — resolve playwright-core for the probe scripts.
 * =====================================================
 * The probes originally hard-coded an absolute path:
 *     C:/Users/<user>/.workbuddy-ai/binaries/node/pwtest/node_modules/playwright-core
 * That works on exactly one machine. On any other it dies with MODULE_NOT_FOUND
 * — and because the failure is at require() time, the probe exits before it can
 * print anything, which looks like "the test is broken" rather than "the path is
 * wrong". Five probes were in that state.
 *
 * Resolve by searching the common locations instead, so a probe runs wherever
 * playwright happens to be installed:
 *   1. $WORKBUDDY_PW  — explicit override, for CI or a non-standard layout
 *   2. <home>/.workbuddy-ai/binaries/node/workspace/node_modules   (current)
 *   3. <home>/.workbuddy-ai/binaries/node/pwtest/node_modules      (legacy)
 *   4. whatever bare `require('playwright-core')` finds            (npm i -g etc.)
 *
 * Usage:  const { chromium } = require('./pw');
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function firstExisting(paths) {
  for (const p of paths) {
    try { if (p && fs.existsSync(p)) return p; } catch (e) {}
  }
  return null;
}

function resolvePlaywright() {
  const home = os.homedir();
  const candidates = [
    process.env.WORKBUDDY_PW,
    path.join(home, '.workbuddy-ai', 'binaries', 'node', 'workspace', 'node_modules', 'playwright-core'),
    path.join(home, '.workbuddy-ai', 'binaries', 'node', 'pwtest', 'node_modules', 'playwright-core'),
  ].filter(Boolean);

  const found = firstExisting(candidates);
  if (found) return found;

  /* Last resort: let Node's normal resolution try. */
  try {
    return require.resolve('playwright-core');
  } catch (e) {
    throw new Error(
      'playwright-core not found. Looked in:\n  ' + candidates.join('\n  ') +
      '\nInstall it with:\n' +
      '  cd ~/.workbuddy-ai/binaries/node/workspace && npm i playwright-core\n' +
      'or set WORKBUDDY_PW to its directory.'
    );
  }
}

const pwPath = resolvePlaywright();
module.exports = require(pwPath);
module.exports.__pwPath = pwPath;
