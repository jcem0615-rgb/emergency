#!/usr/bin/env python3
"""Verify sw.js precaches exactly the files the app shell needs.

An asset that ships but is not precached breaks the app offline, and a
precache entry that no longer exists makes the service worker install
noisily (or, for a required file, not at all). Both are silent in normal
browsing and only show up when someone is offline — so CI checks them.
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Shipped at the site root and needed to boot.
ROOT_FILES = ["index.html", "offline.html", "manifest.webmanifest"]
# Directories whose every file is part of the shell.
SHELL_DIRS = ["assets", "icons"]
# Referenced by the manifest for install dialogs; the browser fetches these
# itself when needed, so they stay out of the offline bundle on purpose.
EXCLUDED_DIRS = ["screenshots"]


def declared_urls() -> list[str]:
    source = (ROOT / "sw.js").read_text()
    match = re.search(r"const PRECACHE_URLS = \[(.*?)\];", source, re.S)
    if not match:
        sys.exit("sw.js: could not find PRECACHE_URLS")
    return [json.loads(m) for m in re.findall(r'"[^"]*"', match.group(1))]


def expected_urls() -> list[str]:
    urls = ["./"] + ROOT_FILES
    for directory in SHELL_DIRS:
        for path in sorted((ROOT / directory).rglob("*")):
            if path.is_file():
                urls.append(path.relative_to(ROOT).as_posix())
    return urls


def main() -> int:
    declared, expected = declared_urls(), expected_urls()
    missing = [u for u in expected if u not in declared]
    stale = [u for u in declared
             if u != "./" and not (ROOT / u).is_file()]
    excluded = [u for u in declared
                if any(u.startswith(d + "/") for d in EXCLUDED_DIRS)]
    duplicates = sorted({u for u in declared if declared.count(u) > 1})

    problems = False
    for label, items, hint in [
        ("shipped but NOT precached (breaks offline)", missing,
         "add them to PRECACHE_URLS in sw.js"),
        ("precached but missing on disk", stale,
         "remove them from PRECACHE_URLS in sw.js"),
        ("precached but meant to stay out of the bundle", excluded,
         f"these live in {'/, '.join(EXCLUDED_DIRS)}/ and are fetched on demand"),
        ("listed more than once", duplicates, "de-duplicate PRECACHE_URLS"),
    ]:
        if items:
            problems = True
            print(f"\n{len(items)} file(s) {label}:")
            for item in items:
                print(f"  {item}")
            print(f"  -> {hint}")

    if problems:
        print("\nAfter changing the file list, bump VERSION in sw.js so "
              "installed clients pick up the new shell.")
        return 1

    print(f"precache list OK — {len(declared)} entries, "
          f"all present and complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
