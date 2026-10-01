#!/usr/bin/env python3
"""
apply-inset-clamp.py — add the STATUS-INSET SAFETY CLAMP to the three pages,
idempotently.

Background: the installed APK shell writes --status-inset straight onto <html>
from Java on every onPageFinished, with no clamp. A shell build that passed
physical px where CSS px was expected sent 132 and made the header 170px tall.
The page must therefore be authoritative about that variable.

This script inserts the clamp IIFE immediately before the BOOT COORDINATION
script. It is idempotent and safe to re-run: if the clamp is already present it
does nothing. That matters because an external uploader periodically overwrites
these files with an older snapshot.

Usage:  python tools/apply-inset-clamp.py index.html gmb.html rmb.html
Exit 0 on success (added or already-present), 1 if the anchor was not found.
"""

import sys

ANCHOR = """<script>
/* ==================== BOOT COORDINATION ==================== */"""

CLAMP = """<script>
/* ==================== STATUS-INSET SAFETY CLAMP ====================
   Defensive only - it does not replace the CSS var / env(safe-area-inset-*)
   scheme, it just bounds it.

   Why it is needed: the installed APK shell writes --status-inset straight
   onto <html> from Java (evaluateJavascript on every onPageFinished), with no
   clamp of its own. A shell build that passed PHYSICAL px where CSS px was
   expected sent 132, and the header became 170px tall on a real 1080x2400
   phone. Nothing in the page could stop it, because the native write lands
   after the page has settled.

   A real status bar is 24 CSS px on almost every device and never more than
   ~40. So: cap the variable, and re-cap it whenever anything writes to it.
   The page becomes authoritative, which means this fix protects
   ALREADY-INSTALLED APKs - no reinstall required. */
(function () {
  var MAX_STATUS = 28;   /* CSS px; 24 is the real value, 28 leaves headroom */
  var MAX_NAV = 72;

  function cap(name, limit) {
    var v = parseFloat(document.documentElement.style.getPropertyValue(name));
    if (!isFinite(v) || v < 0) v = 0;
    if (v > limit) {
      document.documentElement.style.setProperty(name, limit + "px");
      return true;
    }
    return false;
  }
  function enforce() { cap("--status-inset", MAX_STATUS); cap("--nav-inset", MAX_NAV); }

  /* Re-cap on every write. The observer callback fires async (microtask), so a
     flag alone is not enough - the work is coalesced onto the next frame and
     the live value is re-read rather than trusting a stale one. */
  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(function () { queued = false; enforce(); }, 0);
  }
  if (typeof MutationObserver === "function") {
    new MutationObserver(schedule).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }
  /* Catch writes that land before the observer attaches, and re-assert after
     onPageFinished has had time to fire. */
  window.addEventListener("load", enforce);
  enforce();
  setTimeout(enforce, 1200);
  setTimeout(enforce, 3000);
})();
</script>

"""


def patch(path: str) -> bool:
    src = open(path, encoding="utf-8").read()
    if "STATUS-INSET SAFETY CLAMP" in src:
        print(f"{path}: already has clamp")
        return True
    if src.count(ANCHOR) != 1:
        print(f"{path}: ERROR - anchor found {src.count(ANCHOR)} times, expected 1")
        return False
    src = src.replace(ANCHOR, CLAMP + ANCHOR, 1)
    open(path, "w", encoding="utf-8").write(src)
    print(f"{path}: clamp inserted")
    return True


def main() -> int:
    files = sys.argv[1:] or ["index.html", "gmb.html", "rmb.html"]
    return 0 if all(patch(f) for f in files) else 1


if __name__ == "__main__":
    raise SystemExit(main())
