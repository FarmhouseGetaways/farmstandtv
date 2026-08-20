#!/usr/bin/env python3
"""Draw the farm-stand map pin.

    python3 tools/make-pin.py

Writes images/pin.png (26x35) and images/pin@2x.png (52x70), the sizes
js/map.js asks for. Both were missing from the repo, which is why every stand
rendered as a broken image once the map had data to draw.

The shape is a plain teardrop in the site's screen-green so stands read
clearly against the dark ink circles used for landmarks. It is deliberately
simple - if a proper drawn pin ever arrives, drop it in at these two sizes
and delete this script.
"""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
W, H = 26, 35            # must match iconSize in js/map.js
SS = 8                   # supersample, then downscale, for clean edges

GREEN = (61, 224, 74, 255)     # --screen
INK = (23, 26, 21, 255)        # --ink
BONE = (247, 244, 234, 255)    # --bone


def teardrop(draw, cx, cy, r, tip_y, colour):
    """A circle with a tapering tail down to a point - the classic map pin."""
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour)
    # Where the tail meets the circle. Kept above the equator so the join is
    # hidden inside the disc and the silhouette stays smooth.
    spread = r * 0.74
    draw.polygon([(cx, tip_y), (cx - spread, cy + r * 0.58),
                  (cx + spread, cy + r * 0.58)], fill=colour)


def build(scale):
    w, h = W * scale * SS, H * scale * SS
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    unit = scale * SS
    cx = 13 * unit
    cy = 13 * unit
    tip = 34.4 * unit

    # Dark silhouette first, then the green inset on top of it - cheaper and
    # more even than stroking an outline around a compound shape.
    teardrop(d, cx, cy, 11.2 * unit, tip, INK)
    teardrop(d, cx, cy, 9.5 * unit, 32.4 * unit, GREEN)

    # The hole, so a pin still reads as a pin at 26px.
    r = 3.6 * unit
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=INK)
    r = 2.4 * unit
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BONE)

    return img.resize((W * scale, H * scale), Image.LANCZOS)


for scale, name in ((1, "pin.png"), (2, "pin@2x.png")):
    out = ROOT / "images" / name
    build(scale).save(out, optimize=True)
    print(f"  wrote images/{name}  ({W * scale}x{H * scale}, {out.stat().st_size} bytes)")
