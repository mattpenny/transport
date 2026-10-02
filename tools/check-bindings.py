#!/usr/bin/env python3
"""
check-bindings.py — catch Vue prod's silent undefined bindings.

WHY THIS EXISTS
---------------
These pages load the PRODUCTION build of Vue 3 from a CDN. In that build, an
identifier used in the template but never returned from setup() does NOT throw
and does NOT warn. Vue resolves it as undefined, so:
  - an {{ expr }} renders as empty
  - a v-if takes the "falsy" branch and the whole block disappears
  - a v-for over undefined renders nothing
...and the browser console stays completely green.

That combination is the worst kind of bug: the page looks fine, no error is
logged, and a feature is simply missing. It has bitten this project before
(the company row, the collision hint).

WHAT IT CHECKS
--------------
For each HTML file:
  1. Parse the in-DOM template (everything between <div id="app"> ... </div>
     at the root, plus <Teleport> blocks) and collect every root identifier
     referenced in a binding context.
  2. Collect every identifier exported from the setup() return object.
  3. Report any root identifier that is used only in the template but never
     exported, is not a JS global, and is not a local v-for/v-slot variable.

Usage:  python tools/check-bindings.py index.html gmb.html rmb.html
Exit 0 = clean, 1 = problems found (or a file could not be parsed).
"""
import re
import sys
import os

# Identifiers that are legitimately available in a Vue template without being
# exported from setup(): the global allow-list, template-local loop vars we
# cannot resolve statically, and JS built-ins commonly used inline.
JS_GLOBALS = {
    "true", "false", "null", "undefined", "this",
    "Math", "Number", "String", "Boolean", "Array", "Object", "JSON", "Date",
    "parseInt", "parseFloat", "isNaN", "isFinite", "NaN", "Infinity",
    "encodeURIComponent", "decodeURIComponent", "console", "window", "document",
    "Set", "Map", "Promise", "RegExp", "Error",
}
# Directives and structural keywords that are not identifiers at all.
KEYWORDS = {
    "in", "of", "if", "else", "return", "typeof", "instanceof", "new", "void",
    "delete", "await", "function", "=>", "as",
}

BINDING_ATTR = re.compile(
    r'''(?:^|\s)(?::|v-bind:|@|v-on:|v-if|v-else-if|v-for|v-show|v-model|v-html|v-text|v-cloak)
        (?:[.\w:\[\]'"-]*)\s*=\s*   # the rest of the directive name, incl. .modifiers
        (?:"([^"]*)"|'([^']*)')     # the expression, quoted
    ''',
    re.X | re.S,
)

IDENT = re.compile(r"[A-Za-z_$][\w$]*")


def strip_comments(html: str) -> str:
    return re.sub(r"<!--.*?-->", "", html, flags=re.S)


def template_region(html: str) -> str:
    """Everything that Vue actually compiles: the #app subtree plus Teleports."""
    parts = []
    m = re.search(r'<div[^>]*\bid="app"[^>]*>', html)
    if m:
        parts.append(html[m.end():])
    for m in re.finditer(r"<Teleport\b.*?</Teleport>", html, re.S):
        parts.append(m.group(0))
    return "\n".join(parts)


def strip_script(html: str) -> str:
    return re.sub(r"<script\b.*?</script>", "", html, flags=re.S)


def setup_exports(html: str):
    """Identifiers in the setup() return {...} object literal.

    ⚠️ Two traps this has already fallen into, both worth remembering:

    1. The HTML header comments in these pages TALK about setup() and about
       `return {}` (they document this very check). Searching the raw file finds
       that prose first and parses garbage — it produced 131 false positives.
       So comments must be stripped first.

    2. But the real setup() lives INSIDE a <script> block, so stripping scripts
       (or using a greedy `<script.*?</script>` that swallows the big inline
       block) removes the very thing we need. So: strip comments for the search,
       then locate the LAST `setup(` occurrence in the comment-free source — the
       documentation prose always precedes the component definition.
    """
    # Strip HTML comments only; keep <script> bodies (that is where setup lives).
    code = strip_comments(html)

    starts = [m.start() for m in re.finditer(r"\bsetup\s*\(", code)]
    if not starts:
        return set()
    si = starts[-1]

    # Walk to the matching close of setup()'s body `{` so we only consider
    # `return {` statements that are at the TOP level of setup — not the many
    # `return { ... }` inside its computeds, which is what a plain
    # `find("return {")` hit (it grabbed a computed's object literal and
    # reported every real export as missing).
    b0 = code.index("{", si)
    depth, j = 0, b0
    while j < len(code):
        c = code[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    setup_body = code[b0 + 1:j]

    # Find top-level `return {` inside setup_body.
    ri, depth = -1, 0
    k = 0
    while k < len(setup_body):
        c = setup_body[k]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif depth == 0 and setup_body.startswith("return", k):
            m = re.match(r"return\s*\{", setup_body[k:])
            if m:
                ri = k + m.end() - 1
                break
        k += 1
    if ri < 0:
        return set()

    # Slice out the returned object literal.
    depth, j = 0, ri
    while j < len(setup_body):
        c = setup_body[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    body = setup_body[ri + 1:j]
    # Keys of the object literal: `name` or `name:` or `name,` at depth 0.
    exports = set()
    depth = 0
    token = ""
    buf = []
    for c in body:
        if c in "{[(":
            depth += 1
        elif c in "}])":
            depth -= 1
        if depth == 0 and c in ",}\n":
            token = token.strip()
            if token:
                m = re.match(r"^([A-Za-z_$][\w$]*)\s*(?::|$)", token)
                if m:
                    exports.add(m.group(1))
            token = ""
        else:
            token += c
    token = token.strip()
    if token:
        m = re.match(r"^([A-Za-z_$][\w$]*)\s*(?::|$)", token)
        if m:
            exports.add(m.group(1))
    return exports


def template_locals(region: str):
    """v-for / v-slot / v-scope introduce names that are legal in the template."""
    locals_ = set()
    for m in re.finditer(r"v-for\s*=\s*(?:\"|')(.*?)(?:\"|')", region, re.S):
        expr = m.group(1)
        _in = re.split(r"\s+(?:in|of)\s+", expr, maxsplit=1)
        if len(_in) == 2:
            lhs = _in[0]
            # "(item, index)" or "item"
            for nm in re.findall(r"[A-Za-z_$][\w$]*", lhs):
                locals_.add(nm)
    for m in re.finditer(r"v-slot(?::[\w-]+)?\s*=\s*(?:\"|')(.*?)(?:\"|')", region, re.S):
        for nm in re.findall(r"[A-Za-z_$][\w$]*", m.group(1)):
            locals_.add(nm)
    return locals_


def refs_in_expr(expr: str):
    """Root identifiers of an expression: `a.b.c` -> a, `f(x)` -> f, x."""
    out = set()
    # remove string literals so their contents are not scanned
    e = re.sub(r"'(?:\\.|[^'\\])*'", "''", expr)
    e = re.sub(r'"(?:\\.|[^"\\])*"', '""', e)
    # Remove JS regex literals: `/\n/g` must not be read as an identifier `g`.
    # Replace with an empty string, not a placeholder token — a placeholder like
    # `/re/` still contains letters and would itself be reported as an identifier.
    e = re.sub(r"/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+/[gimsuy]*", "", e)
    # Remove property accesses: .name  and  ?.name
    e = re.sub(r"\??\.\s*[A-Za-z_$][\w$]*", "", e)
    for m in IDENT.finditer(e):
        nm = m.group(0)
        # skip object-literal keys:  { key: ... }
        after = e[m.end():].lstrip()
        if after.startswith(":"):
            continue
        out.add(nm)
    return out


def check(path: str):
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    region = template_region(html)
    region = strip_script(region)          # in-template <script> is not compiled
    region = strip_comments(region)

    exports = setup_exports(html)
    locals_ = template_locals(region)

    used = {}
    for m in BINDING_ATTR.finditer(region):
        expr = m.group(1) if m.group(1) is not None else m.group(2)
        for nm in refs_in_expr(expr):
            used.setdefault(nm, expr.strip()[:70])

    # Also check mustaches.
    for m in re.finditer(r"\{\{(.*?)\}\}", region, re.S):
        expr = m.group(1)
        for nm in refs_in_expr(expr):
            used.setdefault(nm, "{{" + expr.strip()[:60] + "}}")

    missing = {}
    for nm, expr in used.items():
        if nm in exports or nm in locals_ or nm in JS_GLOBALS or nm in KEYWORDS:
            continue
        if nm.startswith("$") or nm.startswith("_"):
            continue
        missing[nm] = expr

    return exports, missing


def main():
    files = sys.argv[1:]
    if not files:
        print("usage: python tools/check-bindings.py <page.html> [...]")
        return 2
    bad = False
    for f in files:
        if not os.path.exists(f):
            print(f"{f}: MISSING")
            bad = True
            continue
        exports, missing = check(f)
        if missing:
            bad = True
            print(f"{f}: {len(missing)} binding(s) used in the template but NOT exported from setup()")
            print("  These render as undefined in the Vue prod build — no error, no warning:")
            for nm, expr in sorted(missing.items()):
                print(f"    - {nm:<28} in  {expr}")
        else:
            print(f"{f}: OK ({len(exports)} exports, all template bindings resolved)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
