#!/usr/bin/env python3
"""
apply-brand-chrome.py — restore the per-page theme colour and first-frame
background, idempotently.

Why: the page's very first painted frame is `html { background }`, which is what
shows through the strip behind the system status bar before the header renders.
If that is the light page colour (#f5f7fb) while the header is dark, the user
sees a pale band above the header. `<meta name="theme-color">` additionally tells
the browser/WebView which colour to use for its own chrome.

The external uploader that periodically re-uploads these pages has reverted both
to #f5f7fb, so this script puts them back and can be re-run at any time.

Usage:  python tools/apply-brand-chrome.py
"""

import re
import pathlib

PAGES = {
    "index.html": "#1a3d7c",   # bus  - deep blue
    "gmb.html":   "#0d5e3a",   # GMB  - green
    "rmb.html":   "#c8102e",   # RMB  - red
}

THEME_TAG = '<meta name="theme-color" content="{c}" />\n'
ANCHOR = '<meta name="format-detection" content="telephone=no" />'


def patch(path: str, color: str) -> None:
    p = pathlib.Path(path)
    src = p.read_text(encoding="utf-8")
    changed = []

    # 1. theme-color meta, right before format-detection (stable anchor).
    if 'name="theme-color"' not in src:
        if src.count(ANCHOR) == 1:
            src = src.replace(
                ANCHOR,
                THEME_TAG.format(c=color)
                + "<!-- Status bar / task-switcher colour. Must stay in sync with the\n"
                "     header background and with the bar colours set in the APK shell,\n"
                "     or the top strip shows as a differently-coloured band. -->\n"
                + ANCHOR,
                1,
            )
            changed.append("theme-color added")

    # 2. first-frame background must be the header colour, not the page colour.
    new_html = re.sub(
        r"html \{ background: #[0-9a-fA-F]{6}; \}",
        f"html {{ background: {color}; }}",
        src,
        count=1,
    )
    if new_html != src:
        src = new_html
        changed.append("html background")

    if changed:
        p.write_text(src, encoding="utf-8")
        print(f"{path}: {', '.join(changed)}")
    else:
        print(f"{path}: already correct")


def main() -> int:
    for path, color in PAGES.items():
        patch(path, color)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
