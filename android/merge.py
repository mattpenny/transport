#!/usr/bin/env python3
"""
merge.py — drop classes.dex into an APK produced by `aapt2 link`.

Why this exists: aapt2 link builds the resources/manifest APK but knows nothing
about Java. d8 compiles the classes to a standalone classes.dex. This stitches
the two together by rewriting the APK's zip so the new classes.dex is the FIRST
entry — Android requires classes.dex to be at the front and uncompressed for
older loaders, and zipalign (run afterwards) wants it 4-byte aligned.

Usage:
    python merge.py <apk> [<dex> ...]
"""

import os
import shutil
import sys
import zipfile

# Entries that aapt2 already put in the APK and that we must keep.
KEEP_PREFIXES = ("res/", "assets/", "META-INF/")
KEEP_EXACT = ("AndroidManifest.xml", "resources.arsc")


def merge(apk_path: str, dex_paths: list[str]) -> None:
    if not os.path.exists(apk_path):
        raise SystemExit(f"[merge] APK not found: {apk_path}")

    for dex in dex_paths:
        if not os.path.exists(dex):
            raise SystemExit(f"[merge] dex not found: {dex}")

    tmp_path = apk_path + ".tmp"

    with zipfile.ZipFile(apk_path, "r") as src:
        entries = src.namelist()

        # Sanity check: the manifest/resource table must be there, or we are
        # about to produce a broken APK.
        for keep in KEEP_EXACT:
            if keep not in entries:
                raise SystemExit(
                    f"[merge] {apk_path} is missing {keep} — "
                    "did aapt2 link run?"
                )

        # Preserve the original order, minus any stale classes.dex.
        ordered = [
            n for n in entries
            if not n.startswith("classes") or not n.endswith(".dex")
        ]

        # --- compression policy ---
        #
        # This is not cosmetic. Android's package parser reads
        # AndroidManifest.xml and resources.arsc by mmapping them straight out
        # of the zip without inflating, so both MUST be STORED uncompressed.
        #
        # `aapt2 link` emits the manifest DEFLATED (its own reader copes, via
        # the AAPT "fallback" heuristic, but strict parsers do not) — which is
        # what produced INSTALL_FAILED_INVALID_APK, surfaced as error -124.
        #
        # Everything else may stay compressed. Keeping the PNGs stored as well
        # matches what the shipping v1.2 did and leaves zipalign free to
        # 4-byte-align them, which is worth a few hundred bytes.
        # jadx/apktool note: they read deflated dex fine, so this does not
        # hurt reverse-engineering workflows.
        MUST_STORE = set(KEEP_EXACT)  # AndroidManifest.xml, resources.arsc

        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as dst:
            # 1. classes.dex first, stored uncompressed (Android requires it
            #    be loadable by a simple mmap).
            for dex in dex_paths:
                dst.write(dex, os.path.basename(dex), zipfile.ZIP_STORED)

            # 2. everything aapt2 produced, in its original order.
            #
            #    A fresh ZipInfo is built rather than mutating the source's —
            #    flipping compress_type on a live ZipInfo desynchronises the
            #    reader's CRC bookkeeping and read() then raises BadZipFile.
            for name in ordered:
                info = src.getinfo(name)
                data = src.read(name)
                store = name in MUST_STORE
                if store and info.compress_type != zipfile.ZIP_STORED:
                    print(f"[merge] forcing {name} to STORED")

                new_info = zipfile.ZipInfo(name, date_time=info.date_time)
                new_info.compress_type = (
                    zipfile.ZIP_STORED if store else info.compress_type
                )
                new_info.external_attr = info.external_attr
                new_info.internal_attr = info.internal_attr
                new_info.create_system = info.create_system
                dst.writestr(new_info, data)

    shutil.move(tmp_path, apk_path)

    with zipfile.ZipFile(apk_path, "r") as check:
        final = check.namelist()
        dexes = [n for n in final if n.startswith("classes") and n.endswith(".dex")]

        # Fail loudly rather than shipping an APK the installer will reject.
        must_store = ["AndroidManifest.xml", "resources.arsc"] + dexes
        bad = [
            n for n in must_store
            if n in final and check.getinfo(n).compress_type != zipfile.ZIP_STORED
        ]
        if bad:
            raise SystemExit(
                "[merge] REFUSING to ship: these entries must be STORED "
                f"uncompressed but are compressed: {bad}"
            )

    print(f"[merge] {apk_path}: {len(final)} entries, dex={dexes} (all STORED)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    merge(sys.argv[1], sys.argv[2:])
