"""
make-mtr-icon.py — draw mtr.png, the MTR Bus mode icon.

Matches the existing icon set: bus.png is a flat illustration, rmb.png is a
side-view vehicle on a light background, both roughly 2.3:1 and displayed at
46x30 in the mode list.

MTR Bus (港鐵巴士 / K巴) vehicles are cream/white with a maroon band, so this is
a single-decker in that livery — deliberately NOT another red bus, because
bus.png is already red and rmb.png is a red-roofed minibus.

The roof band is clipped to the body silhouette with a mask, rather than being
drawn as its own rounded rectangle: a rounded band would round its *bottom*
corners too and leave notches where it meets the body.

Drawn at 4x and downsampled, which is the cheapest way to get clean edges
without pulling in a drawing library.

    python tools/make-mtr-icon.py
"""
from PIL import Image, ImageDraw

SS = 4                      # supersample factor
W, H = 512, 226
W_, H_ = W * SS, H * SS

CREAM = (247, 240, 226, 255)
MAROON = (140, 29, 64, 255)
GLASS = (58, 58, 58, 255)
GLASS_HI = (104, 104, 104, 255)
SKIRT = (216, 210, 198, 255)
TYRE = (30, 30, 30, 255)
HUB = (176, 176, 176, 255)
OUTLINE = (28, 28, 28, 255)
SHADOW = (233, 227, 216, 255)
LAMP = (255, 246, 214, 255)

BODY = (18, 58, 494, 184)       # x0, y0, x1, y1
ROOF_H = 34                     # maroon band depth
RADIUS = 20


def s(v):
    return int(round(v * SS))


def box(x0, y0, x1, y1):
    return [s(x0), s(y0), s(x1), s(y1)]


def line(pts, **kw):
    d.line([(s(x), s(y)) for x, y in pts], **kw)


img = Image.new("RGBA", (W_, H_), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# ground shadow
d.ellipse(box(46, 198, 466, 214), fill=SHADOW)

# --- body silhouette, with the maroon roof band clipped to it -------------
mask = Image.new("L", (W_, H_), 0)
ImageDraw.Draw(mask).rounded_rectangle(box(*BODY), radius=s(RADIUS), fill=255)

layer = Image.new("RGBA", (W_, H_), (0, 0, 0, 0))
dl = ImageDraw.Draw(layer)
dl.rectangle(box(*BODY), fill=CREAM)
dl.rectangle(box(BODY[0], BODY[1], BODY[2], BODY[1] + ROOF_H), fill=MAROON)
dl.rectangle(box(BODY[0], 160, BODY[2], BODY[3]), fill=SKIRT)
img.paste(layer, (0, 0), mask)

# --- windscreen (raked) + passenger windows ------------------------------
d.polygon([(s(36), s(146)), (s(58), s(102)), (s(108), s(102)), (s(108), s(146))], fill=GLASS)
for x0 in (120, 214, 308, 392):
    d.rounded_rectangle(box(x0, 102, x0 + 76, 146), radius=s(7), fill=GLASS)
    d.rounded_rectangle(box(x0 + 7, 108, x0 + 69, 118), radius=s(4), fill=GLASS_HI)

# --- door, between the second and third windows --------------------------
d.rounded_rectangle(box(202, 96, 252, 178), radius=s(6), fill=(240, 236, 228, 255),
                    outline=OUTLINE, width=s(2))
line([(227, 96), (227, 178)], fill=OUTLINE, width=s(2))

# --- body outline --------------------------------------------------------
d.rounded_rectangle(box(*BODY), radius=s(RADIUS), outline=OUTLINE, width=s(3))

# --- wheels: arch outline, tyre, hub ------------------------------------
for cx in (134, 380):
    d.ellipse(box(cx - 40, 148, cx + 40, 228), outline=OUTLINE, width=s(3))
    d.ellipse(box(cx - 34, 154, cx + 34, 222), fill=TYRE)
    d.ellipse(box(cx - 14, 174, cx + 14, 202), fill=HUB)

# --- headlight -----------------------------------------------------------
d.rounded_rectangle(box(26, 150, 50, 168), radius=s(5), fill=LAMP,
                    outline=OUTLINE, width=s(2))

img = img.resize((W, H), Image.LANCZOS)
img.save("mtr.png")
print(f"wrote mtr.png {img.size} {len(open('mtr.png','rb').read())} bytes")
