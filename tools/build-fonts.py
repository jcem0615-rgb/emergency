#!/usr/bin/env python3
"""Download, subset and consolidate the self-hosted webfonts.

Inter and JetBrains Mono are shipped by Google Fonts as variable fonts, so one
file per family covers every weight the UI uses. Each file is subset to the
characters this app can actually render, which keeps the offline precache small.

Requires: fonttools, brotli  (pip install fonttools brotli)
Writes:   assets/fonts/*.woff2 and build/fonts.css
"""
import io, pathlib, re, subprocess, sys, urllib.request

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets/fonts"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0.0.0 Safari/537.36")

FAMILIES = [
    ("Inter", "inter", "100 900",
     "https://fonts.googleapis.com/css2?family=Inter:wght@400..900&display=swap"),
    ("JetBrains Mono", "jetbrains-mono", "400 800",
     "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400..800&display=swap"),
]

SYMBOLS = ["2013", "2014", "2018", "2019", "201C", "201D", "2022", "2026",
           "2039", "203A", "2122", "2190", "2191", "2192", "2193", "2212",
           "2713", "2714", "00B0", "00D7"]
LATIN = "U+0020-007E,U+00A0-00FF," + ",".join("U+" + c for c in SYMBOLS)
PESO = "U+20B1"          # ₱ ships in the latin-ext slice
LATIN_RANGE = LATIN.replace(",", ", ")


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read() if binary else r.read().decode("utf-8")


def covered(src: bytes, codepoints: set[int]) -> set[int]:
    """Which of these codepoints the source font actually has glyphs for."""
    font = TTFont(io.BytesIO(src))
    cmap = font.getBestCmap() or {}
    font.close()
    return {cp for cp in codepoints if cp in cmap}


def codepoints_of(spec: str) -> set[int]:
    out = set()
    for part in spec.split(","):
        part = part.strip().removeprefix("U+")
        if "-" in part:
            lo, hi = part.split("-")
            out.update(range(int(lo, 16), int(hi, 16) + 1))
        else:
            out.add(int(part, 16))
    return out


def subset(src: bytes, unicodes: str, out: pathlib.Path):
    tmp = out.with_suffix(".src.woff2")
    tmp.write_bytes(src)
    subprocess.run([sys.executable, "-m", "fontTools.subset", str(tmp),
                    f"--unicodes={unicodes}", "--flavor=woff2",
                    "--layout-features=kern,liga,calt", "--no-hinting",
                    "--desubroutinize", f"--output-file={out}"],
                   check=True, capture_output=True)
    tmp.unlink()


def main():
    FONTS.mkdir(parents=True, exist_ok=True)
    for f in FONTS.glob("*.woff2"):
        f.unlink()

    faces = []
    for family, slug, weights, url in FAMILIES:
        css = fetch(url)
        blocks = re.findall(r"/\*\s*([a-z0-9\-]+)\s*\*/\s*(@font-face\s*\{[^}]*\})", css)
        for subset_name, spec in (("latin", LATIN), ("latin-ext", PESO)):
            block = next((b for s, b in blocks if s == subset_name), None)
            if not block:
                raise SystemExit(f"{family}: no {subset_name} slice in Google's CSS")
            src_url = re.search(r"url\((https://fonts\.gstatic\.com[^)]+)\)", block).group(1)
            raw = fetch(src_url, binary=True)

            # Subsetting to codepoints a font does not have yields a font with
            # no cmap, which browsers reject outright — JetBrains Mono has no
            # peso sign, for instance. Skip the face instead of shipping one
            # that cannot load; the text falls back through the font stack.
            wanted = codepoints_of(spec)
            present = covered(raw, wanted)
            if not present:
                print(f"  skip {family} {subset_name}: source has none of "
                      f"{', '.join('U+%04X' % c for c in sorted(wanted))}")
                continue

            name = f"{slug}-{subset_name}.woff2"
            subset(raw, spec, FONTS / name)

            # Guard against emitting a file the browser will refuse.
            check = TTFont(FONTS / name)
            if not (check.getBestCmap() or {}):
                check.close()
                raise SystemExit(f"{name}: subset produced a font with no cmap")
            check.close()

            faces.append((family, weights, name,
                          PESO if subset_name == "latin-ext" else LATIN_RANGE))

    lines = ["/* -----------------------------------------------------------------------------",
             "   Self-hosted Inter + JetBrains Mono, subset to the glyphs this app renders.",
             "   Both are variable fonts, so one file per family serves every weight the UI",
             "   uses — which keeps the offline precache small.",
             "",
             "   A family only gets a latin-ext face if it actually has the peso sign",
             "   (U+20B1): JetBrains Mono does not, so ₱ in monospace text falls back",
             "   through the font stack to a system monospace font.",
             "",
             "   Generated by tools/build-fonts.py — do not edit by hand.",
             "   -------------------------------------------------------------------------- */"]
    for family, weights, name, rng in faces:
        lines += ["@font-face {", f"  font-family: '{family}';", "  font-style: normal;",
                  f"  font-weight: {weights};", "  font-display: swap;",
                  f"  src: url('./fonts/{name}') format('woff2');",
                  f"  unicode-range: {rng};", "}"]
    (ROOT / "build/fonts.css").write_text("\n".join(lines) + "\n")

    total = sum(p.stat().st_size for p in FONTS.glob("*.woff2"))
    print(f"{len(faces)} font files, {total/1024:.0f} KB total -> build/fonts.css")


if __name__ == "__main__":
    main()
