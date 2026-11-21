#!/usr/bin/env python3
"""Generate the E-mergency icon set. Requires Pillow."""
from PIL import Image, ImageDraw
import pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(parents=True, exist_ok=True)

RED, ROSE = (220, 38, 38), (159, 18, 57)
WHITE = (255, 255, 255)

def gradient(size):
    """Diagonal red -> rose gradient."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(RED[i] + (ROSE[i] - RED[i]) * t) for i in range(3))
    return img

def draw_E(d, cx, cy, h, color=WHITE):
    """Blocky 'E' centred on (cx, cy) with total height h."""
    w = h * 0.74
    bar = h * 0.1875          # stroke thickness
    x0, y0 = cx - w / 2, cy - h / 2
    d.rounded_rectangle([x0, y0, x0 + bar, y0 + h], radius=bar * 0.32, fill=color)      # spine
    for yy in (y0, cy - bar / 2, y0 + h - bar):                                         # 3 arms
        length = w if yy != cy - bar / 2 else w * 0.82
        d.rounded_rectangle([x0, yy, x0 + length, yy + bar], radius=bar * 0.32, fill=color)

def build(size, maskable=False, rounded=True):
    ss = 4                                  # supersample for clean edges
    base = gradient(size * ss)
    img = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    mask = Image.new("L", (size * ss, size * ss), 0)
    md = ImageDraw.Draw(mask)
    if rounded and not maskable:
        md.rounded_rectangle([0, 0, size * ss - 1, size * ss - 1],
                             radius=size * ss * 0.22, fill=255)
    else:
        md.rectangle([0, 0, size * ss - 1, size * ss - 1], fill=255)
    img.paste(base, (0, 0), mask)

    d = ImageDraw.Draw(img)
    S = size * ss
    # Maskable icons keep artwork inside the 80% safe zone.
    glyph_h = S * (0.42 if maskable else 0.52)
    cx, cy = S * 0.44, S * 0.52
    draw_E(d, cx, cy, glyph_h)

    # Signal pulse emanating from the top-right, clear of the E
    dot_r = glyph_h * 0.10
    ox = cx + glyph_h * 0.46
    oy = cy - glyph_h * 0.40
    d.ellipse([ox - dot_r, oy - dot_r, ox + dot_r, oy + dot_r], fill=WHITE)
    stroke = max(2, int(glyph_h * 0.075))
    for mult in (2.1, 3.3):
        rr = dot_r * mult
        d.arc([ox - rr, oy - rr, ox + rr, oy + rr],
              start=-72, end=72, fill=WHITE, width=stroke)

    return img.resize((size, size), Image.LANCZOS)

for size in (192, 512):
    build(size).save(OUT / f"icon-{size}.png", optimize=True)
    build(size, maskable=True).save(OUT / f"icon-maskable-{size}.png", optimize=True)
build(180, rounded=False).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
build(32).save(OUT / "favicon-32.png", optimize=True)

# Monochrome shortcut icons
def shortcut(name, glyph):
    S, ss = 96, 4
    img = Image.new("RGBA", (S * ss, S * ss), (15, 23, 42, 255))
    d = ImageDraw.Draw(img)
    if glyph == "E":
        draw_E(d, S * ss / 2, S * ss / 2, S * ss * 0.56)
    elif glyph == "map":
        m = S * ss
        d.rounded_rectangle([m*0.18, m*0.22, m*0.82, m*0.78], radius=m*0.08,
                            outline=WHITE, width=int(m*0.06))
        d.ellipse([m*0.42, m*0.42, m*0.58, m*0.58], fill=WHITE)
    else:  # list / blotter
        m = S * ss
        for i in range(3):
            y = m * (0.3 + i * 0.2)
            d.rounded_rectangle([m*0.22, y, m*0.78, y + m*0.075], radius=m*0.03, fill=WHITE)
    img.resize((S, S), Image.LANCZOS).save(OUT / name, optimize=True)

shortcut("shortcut-sos.png", "E")
shortcut("shortcut-command.png", "map")
shortcut("shortcut-blotter.png", "list")

# Crisp vector favicon
(OUT / "favicon.svg").write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="E-mergency">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#dc2626"/><stop offset="1" stop-color="#9f1239"/>
  </linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <g fill="#fff">
    <rect x="18" y="16" width="6" height="32" rx="2"/>
    <rect x="18" y="16" width="24" height="6" rx="2"/>
    <rect x="18" y="29" width="20" height="6" rx="2"/>
    <rect x="18" y="42" width="24" height="6" rx="2"/>
  </g>
  <circle cx="45" cy="45" r="4" fill="#fff"/>
  <path d="M51.5 38.5a11 11 0 0 1 0 13" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>
</svg>
''')
for p in sorted(OUT.iterdir()):
    print(f"{p.name:28} {p.stat().st_size/1024:6.1f} KB")
