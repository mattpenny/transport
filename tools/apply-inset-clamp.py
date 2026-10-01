#!/usr/bin/env python3
"""
apply-inset-clamp.py — install the --status-inset / --inset-top resolver into
the three pages, idempotently.

Why this is needed (two independent bugs, both page-side):

1. The installed APK shell writes --status-inset straight onto <html> from Java
   on every onPageFinished, with no clamp. A shell build that passed physical px
   where CSS px was expected sent 132 and made the header ~170px tall.

2. `padding-top: max(8px, env(safe-area-inset-top), var(--status-inset))` takes
   the LARGEST of the three, so capping the variable achieved nothing whenever
   the WebView reported a large env(safe-area-inset-top) - the env value won and
   the header stayed ~100 CSS px tall on a real device.

Fix: resolve BOTH inputs in one place, cap each, and expose a single
`--inset-top` that the header padding consumes. The CSS rules are rewritten from
`max(..., env(...), var(--status-inset))` to `max(..., var(--inset-top))`, so a
large env() can no longer out-vote the cap.

Usage:  python tools/apply-inset-clamp.py index.html gmb.html rmb.html
Exit 0 on success (added or already-present), 1 if an anchor was not found.
"""

import sys

CLAMP_HEAD = "/* ==================== STATUS-INSET SAFETY CLAMP ===================="

ANCHOR = """<script>
/* ==================== BOOT COORDINATION ==================== */"""

CLAMP = """<script>
/* ==================== STATUS-INSET RESOLVER ====================
   Resolves --inset-top: the single value the header's top padding consumes.

   Two failure modes this closes:

   1. The installed APK shell writes --status-inset straight onto <html> from
      Java (evaluateJavascript on every onPageFinished), with no clamp of its
      own. A shell build that passed PHYSICAL px where CSS px was expected sent
      132, and the header became ~170px tall on a real 1080x2400 phone.

   2. The header padding used to be
          max(8px, env(safe-area-inset-top), var(--status-inset))
      and max() takes the LARGEST. So clamping --status-inset did nothing when
      the WebView reported a large env(safe-area-inset-top) - the env value
      simply won and the header stayed ~100 CSS px tall.

   Resolving both here means one capped number governs the padding, whatever the
   shell sends and whatever env() reports. Because it is page-side, it repairs
   ALREADY-INSTALLED APKs with no reinstall. */
(function () {
  var MAX_STATUS = 28;   /* CSS px; 24 is the real value, 28 leaves headroom */
  var MAX_NAV = 72;

  function readPx(prop, limit) {
    var v = parseFloat(document.documentElement.style.getPropertyValue(prop));
    if (!isFinite(v) || v < 0) v = 0;
    return Math.min(v, limit);
  }

  /* Measure env(safe-area-inset-top) as the browser resolves it, then cap it
     too - a bad shell can inflate this just as easily as the variable. */
  function envTop() {
    var probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;top:0;left:0;width:0;height:env(safe-area-inset-top);" +
      "visibility:hidden;pointer-events:none";
    document.documentElement.appendChild(probe);
    var h = probe.getBoundingClientRect().height || 0;
    probe.parentNode.removeChild(probe);
    return isFinite(h) && h > 0 ? Math.min(h, MAX_STATUS) : 0;
  }

  function cap(name, limit) {
    var cur = parseFloat(document.documentElement.style.getPropertyValue(name));
    if (isFinite(cur) && cur > limit) {
      document.documentElement.style.setProperty(name, limit + "px");
    }
  }

  function enforce() {
    cap("--status-inset", MAX_STATUS);
    cap("--nav-inset", MAX_NAV);
    var top = Math.max(readPx("--status-inset", MAX_STATUS), envTop());
    document.documentElement.style.setProperty("--inset-top", top + "px");
    var nav = parseFloat(document.documentElement.style.getPropertyValue("--nav-inset"));
    document.documentElement.style.setProperty(
      "--inset-bottom", (isFinite(nav) && nav > 0 ? Math.min(nav, MAX_NAV) : 0) + "px");
  }

  /* Coalesce onto the next frame: a MutationObserver callback fires as a
     microtask, so a synchronously set/cleared flag would not prevent re-entry. */
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
  window.addEventListener("load", enforce);
  enforce();
  setTimeout(enforce, 1200);
  setTimeout(enforce, 3000);
})();
</script>

"""

# CSS rewrites: stop letting a large env() out-vote the capped variable.
CSS_REWRITES = [
    ("padding-top: max(10px, env(safe-area-inset-top), var(--status-inset));",
     "padding-top: max(10px, var(--inset-top));"),
    ("padding-top: max(8px, env(safe-area-inset-top), var(--status-inset));",
     "padding-top: max(8px, var(--inset-top));"),
]


def patch(path: str) -> bool:
    src = open(path, encoding="utf-8").read()
    changed = False

    for old, new in CSS_REWRITES:
        if old in src:
            src = src.replace(old, new)
            changed = True

    if CLAMP_HEAD in src:
        print(f"{path}: resolver already present")
    else:
        if src.count(ANCHOR) != 1:
            print(f"{path}: ERROR - anchor found {src.count(ANCHOR)} times, expected 1")
            return False
        src = src.replace(ANCHOR, CLAMP + ANCHOR, 1)
        changed = True
        print(f"{path}: resolver inserted")

    if changed:
        open(path, "w", encoding="utf-8").write(src)
        print(f"{path}: css rewritten")
    return True


def main() -> int:
    files = sys.argv[1:] or ["index.html", "gmb.html", "rmb.html"]
    return 0 if all(patch(f) for f in files) else 1


if __name__ == "__main__":
    raise SystemExit(main())
