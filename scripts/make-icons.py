#!/usr/bin/env python3
"""Fabrique toutes les icônes de l'application à partir de assets/logo-source.jpg.

    python3 scripts/make-icons.py [dossier-android-res]

Le logo (disque bleu et vert sur fond clair) est détouré : le fond et les traits blancs deviennent transparents,
les couleurs reprennent exactement celles du dessin.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'assets', 'logo-source.jpg')
BLUE = np.array([34, 142, 214], float)
GREEN = np.array([110, 188, 66], float)


def cutout() -> Image.Image:
    """Disque détouré, 1024 px, fond et traits blancs transparents."""
    a = np.array(Image.open(SRC).convert('RGB')).astype(float)
    h, w, _ = a.shape
    chroma = a.max(2) - a.min(2)
    blue_side = a[..., 2] > a[..., 1]
    # Un pixel est un mélange « couleur pure + blanc » : on retrouve la part de couleur avec le canal le plus contrasté.
    alpha_b = (255 - a[..., 0]) / (255 - BLUE[0])
    alpha_g = (255 - a[..., 2]) / (255 - GREEN[2])
    alpha = np.where(blue_side, alpha_b, alpha_g)
    alpha = np.clip(alpha, 0, 1)
    alpha[chroma < 9] = 0
    alpha[alpha < 0.06] = 0
    alpha[alpha > 0.96] = 1
    yy, xx = np.mgrid[0:h, 0:w]
    alpha[(xx - 511.5) ** 2 + (yy - 511.5) ** 2 > 344**2] = 0
    rgb = np.where(blue_side[..., None], BLUE, GREEN)
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    img = Image.fromarray(out, 'RGBA')
    return img.crop((166, 166, 858, 858))  # le disque seul, avec une fine marge


LOGO = cutout()


def logo(size: int) -> Image.Image:
    return LOGO.resize((size, size), Image.LANCZOS)


def on_background(size: int, share: float, bg=(255, 255, 255, 255)) -> Image.Image:
    """Le logo centré sur un fond uni ; `share` = part du côté occupée par le disque."""
    img = Image.new('RGBA', (size, size), bg)
    d = round(size * share)
    img.alpha_composite(logo(d), ((size - d) // 2, (size - d) // 2))
    return img


def server_badge(size: int) -> Image.Image:
    """Le logo avec, en bas à droite, une pastille « baie de serveur » : on reconnaît l'application Serveur."""
    base = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = round(size * 0.86)
    base.alpha_composite(logo(d), (0, 0))
    s = 4  # sur-échantillonnage pour des bords nets
    b = round(size * 0.5)
    badge = Image.new('RGBA', (b * s, b * s), (0, 0, 0, 0))
    g = ImageDraw.Draw(badge)
    g.rounded_rectangle((0, 0, b * s - 1, b * s - 1), radius=int(b * s * 0.22), fill=(22, 26, 33, 255), outline=(255, 255, 255, 255), width=int(b * s * 0.06))
    pad = b * s * 0.17
    bar_h = b * s * 0.17
    gap = (b * s - 2 * pad - 3 * bar_h) / 2
    for i in range(3):
        y0 = pad + i * (bar_h + gap)
        g.rounded_rectangle((pad, y0, b * s - pad, y0 + bar_h), radius=int(bar_h * 0.3), fill=(52, 60, 74, 255))
        g.ellipse((b * s - pad - bar_h * 0.78, y0 + bar_h * 0.2, b * s - pad - bar_h * 0.18, y0 + bar_h * 0.8), fill=(70, 217, 133, 255))
    badge = badge.resize((b, b), Image.LANCZOS)
    base.alpha_composite(badge, (size - b, size - b))
    return base


def save(img: Image.Image, *path: str) -> None:
    out = os.path.join(ROOT, *path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, optimize=True)
    print('  ', os.path.relpath(out, ROOT), img.size)


pub = ('web', 'public')
save(logo(256), *pub, 'icons', 'logo.png')                      # marque dans l'interface, favicon
save(logo(64), *pub, 'icons', 'favicon.png')
save(on_background(192, 0.84), *pub, 'icons', 'icon-192.png')
save(on_background(512, 0.84), *pub, 'icons', 'icon-512.png')
save(on_background(512, 0.62), *pub, 'icons', 'icon-maskable-512.png')   # zone sûre des icônes « masquables »
save(on_background(180, 0.80), *pub, 'apple-touch-icon.png')

sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
for name, make in (('icone.ico', lambda: logo(256)), ('icone-serveur.ico', lambda: server_badge(256))):
    out = os.path.join(ROOT, 'assets', name)
    make().save(out, format='ICO', sizes=sizes)
    print('  ', os.path.relpath(out, ROOT))
save(server_badge(256), *pub, 'icons', 'logo-serveur.png')

if len(sys.argv) > 1:  # icône du lanceur Android : premier plan transparent sur fond blanc
    res = sys.argv[1]
    fg = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    d = round(512 * 0.60)
    fg.alpha_composite(logo(d), ((512 - d) // 2, (512 - d) // 2))
    out = os.path.join(res, 'drawable-nodpi', 'ic_launcher_foreground.png')
    fg.save(out, optimize=True)
    print('  ', out)
