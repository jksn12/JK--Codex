#!/usr/bin/env python3
"""Generate the 即客-Codex application icon set.

The mark combines a cyan C-shaped workflow ring, a white J-shaped command path,
and an amber lightning bolt for 即时/即客. The output is deterministic and does
not require network access.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "src-tauri" / "icons"
SCALE = 4
MASTER = 1024


def rounded_mask(size: int, inset: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=radius,
        fill=255,
    )
    return mask


def gradient(size: int, start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGB", (size, size))
    px = image.load()
    for y in range(size):
        for x in range(size):
            t = min(1.0, max(0.0, (x * 0.46 + y * 0.54) / (size - 1)))
            glow = max(0.0, 1.0 - math.hypot(x - size * 0.28, y - size * 0.18) / (size * 0.82))
            px[x, y] = tuple(
                max(0, min(255, round(start[i] * (1 - t) + end[i] * t + glow * (12 if i == 2 else 4))))
                for i in range(3)
            )
    return image


def draw_icon() -> Image.Image:
    size = MASTER * SCALE
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inset = 62 * SCALE
    radius = 218 * SCALE
    mask = rounded_mask(size, inset, radius)

    shadow_mask = mask.filter(ImageFilter.GaussianBlur(24 * SCALE))
    shadow = Image.new("RGBA", (size, size), (5, 10, 35, 0))
    shadow.putalpha(shadow_mask.point(lambda value: int(value * 0.55)))
    canvas.alpha_composite(shadow, (0, 18 * SCALE))

    bg = gradient(size, (9, 20, 53), (67, 37, 148)).convert("RGBA")
    bg.putalpha(mask)
    canvas.alpha_composite(bg)

    sheen = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sheen_draw = ImageDraw.Draw(sheen)
    sheen_draw.ellipse(
        (-180 * SCALE, -300 * SCALE, 820 * SCALE, 520 * SCALE),
        fill=(77, 213, 255, 42),
    )
    sheen = sheen.filter(ImageFilter.GaussianBlur(70 * SCALE))
    sheen.putalpha(Image.composite(sheen.getchannel("A"), Image.new("L", (size, size), 0), mask))
    canvas.alpha_composite(sheen)

    mark_shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ms = ImageDraw.Draw(mark_shadow)
    ring_box = (245 * SCALE, 230 * SCALE, 785 * SCALE, 770 * SCALE)
    ms.arc(ring_box, 38, 322, fill=(0, 0, 0, 155), width=98 * SCALE)
    j_points = []
    for step in range(65):
        t = step / 64
        if t < 0.52:
            x = 560
            y = 250 + (630 - 250) * (t / 0.52)
        else:
            u = (t - 0.52) / 0.48
            x = 560 - 185 * (u ** 0.82)
            y = 630 + 105 * math.sin(u * math.pi / 2)
        j_points.append((int(x * SCALE), int(y * SCALE)))
    ms.line(j_points, fill=(0, 0, 0, 150), width=105 * SCALE, joint="curve")
    mark_shadow = mark_shadow.filter(ImageFilter.GaussianBlur(22 * SCALE))
    canvas.alpha_composite(mark_shadow, (0, 15 * SCALE))

    ring_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ring = ImageDraw.Draw(ring_layer)
    # Layered cyan ring provides depth while remaining legible at 32px.
    ring.arc(ring_box, 38, 322, fill=(57, 229, 231, 255), width=94 * SCALE)
    ring.arc(ring_box, 198, 322, fill=(52, 154, 255, 255), width=94 * SCALE)
    canvas.alpha_composite(ring_layer)

    j_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    jd = ImageDraw.Draw(j_layer)
    jd.line(j_points, fill=(248, 251, 255, 255), width=88 * SCALE, joint="curve")
    jd.ellipse(
        ((560 - 44) * SCALE, (250 - 44) * SCALE, (560 + 44) * SCALE, (250 + 44) * SCALE),
        fill=(248, 251, 255, 255),
    )
    canvas.alpha_composite(j_layer)

    bolt_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bolt_layer)
    bolt = [
        (724 * SCALE, 254 * SCALE),
        (662 * SCALE, 431 * SCALE),
        (735 * SCALE, 431 * SCALE),
        (674 * SCALE, 594 * SCALE),
        (842 * SCALE, 374 * SCALE),
        (758 * SCALE, 374 * SCALE),
    ]
    bd.polygon(bolt, fill=(255, 180, 53, 255))
    bd.line(bolt + [bolt[0]], fill=(255, 220, 113, 255), width=7 * SCALE, joint="curve")
    bolt_glow = bolt_layer.filter(ImageFilter.GaussianBlur(18 * SCALE))
    glow_alpha = bolt_glow.getchannel("A").point(lambda value: int(value * 0.42))
    bolt_glow.putalpha(glow_alpha)
    canvas.alpha_composite(bolt_glow)
    canvas.alpha_composite(bolt_layer)

    border = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=radius,
        outline=(180, 218, 255, 115),
        width=5 * SCALE,
    )
    canvas.alpha_composite(border)

    return canvas.resize((MASTER, MASTER), Image.Resampling.LANCZOS)


def save_sizes(master: Image.Image) -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    master.save(ICON_DIR / "codex-x.png")
    master.resize((512, 512), Image.Resampling.LANCZOS).save(ICON_DIR / "icon.png")

    outputs = {
        "32x32.png": 32,
        "64x64.png": 64,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for filename, size in outputs.items():
        master.resize((size, size), Image.Resampling.LANCZOS).save(ICON_DIR / filename)

    master.save(
        ICON_DIR / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    master.save(
        ICON_DIR / "icon.icns",
        format="ICNS",
        sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)],
    )


def write_svg() -> None:
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#091435"/><stop offset="1" stop-color="#432594"/></linearGradient>
    <linearGradient id="ring" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#349AFF"/><stop offset="1" stop-color="#39E5E7"/></linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#050A23" flood-opacity=".6"/></filter>
  </defs>
  <rect x="62" y="62" width="900" height="900" rx="218" fill="url(#bg)" stroke="#B4DAFF" stroke-opacity=".45" stroke-width="5"/>
  <g filter="url(#shadow)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M726 338a270 270 0 1 0 0 348" stroke="url(#ring)" stroke-width="94"/>
    <path d="M560 250v380c0 58-78 105-185 105" stroke="#F8FBFF" stroke-width="88"/>
  </g>
  <path d="M724 254l-62 177h73l-61 163 168-220h-84z" fill="#FFB435" stroke="#FFDC71" stroke-width="7" stroke-linejoin="round"/>
</svg>\n'''
    (ICON_DIR / "jike-codex-icon.svg").write_text(svg, encoding="utf8")


if __name__ == "__main__":
    save_sizes(draw_icon())
    write_svg()
    print(f"Generated 即客-Codex icons in {ICON_DIR}")
