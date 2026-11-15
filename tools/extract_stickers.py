"""Cut the sticker sheets in tools/src/ into individual transparent stickers.

Writes static/stickers/<set>/NN.webp and static/stickers/manifest.json.
Needs: pip install opencv-python-headless pillow numpy
Run from the repo root:  python tools/extract_stickers.py
"""
import json
import shutil
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "src"
OUT = ROOT / "static" / "stickers"
SCALE = 2          # sheets are small; upscale so stickers stay smooth when enlarged
WHITE = 236        # background is anything this bright and nearly colourless
MIN_AREA = 250     # ignore specks (source pixels)

# Stickers that touch on the sheet: cut them apart along these lines (source pixels).
# Pieces that don't separate cleanly (white on white), by position in reading order.
SKIP = {"stickers": [4]}

CUTS = {
    "cats": [[(408, 1162), (515, 1152), (556, 1130), (580, 1102), (592, 1085)]],
}


def cut_out(name):
    img = cv2.imread(str(SRC / f"sheet-{name}.jpg"))
    lo, hi = img.min(axis=2), img.max(axis=2)
    white = ((lo >= WHITE) & (hi - lo <= 20)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(white, connectivity=4)
    background = np.isin(labels, [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 1500])
    fg = (~background).astype(np.uint8)
    for line in CUTS.get(name, []):
        cv2.polylines(fg, [np.array(line, np.int32)], False, 0, thickness=3)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)

    big = cv2.resize(img, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_LANCZOS4)
    big = cv2.cvtColor(big, cv2.COLOR_BGR2RGB)
    pieces = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < MIN_AREA:
            continue
        mask = (labels[y:y + h, x:x + w] == i).astype(np.float32)
        mask = cv2.copyMakeBorder(mask, 2, 2, 2, 2, cv2.BORDER_CONSTANT, value=0)
        mask = cv2.resize(mask, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_CUBIC)
        mask = cv2.erode((mask > .5).astype(np.float32), np.ones((3, 3), np.uint8))
        alpha = np.clip(cv2.GaussianBlur(mask, (0, 0), .8) * 255, 0, 255).astype(np.uint8)
        rgb = cv2.copyMakeBorder(big[y * SCALE:(y + h) * SCALE, x * SCALE:(x + w) * SCALE],
                                 4, 4, 4, 4, cv2.BORDER_REPLICATE)
        pieces.append(((round(y / 110), x), Image.fromarray(np.dstack([rgb, alpha]))))
    pieces.sort(key=lambda p: p[0])
    return [p[1] for k, p in enumerate(pieces, 1) if k not in SKIP.get(name, [])]


def cut_grid(name, cols, rows, inset=5):
    img = Image.open(SRC / f"sheet-{name}.jpg").convert("RGB")
    out = []
    for y0, y1 in zip(rows, rows[1:]):
        for x0, x1 in zip(cols, cols[1:]):
            tile = img.crop((x0 + inset, y0 + inset, x1 - inset, y1 - inset))
            out.append(tile.resize((tile.width * SCALE, tile.height * SCALE), Image.LANCZOS))
    return out


def main():
    sets = {
        "cats": cut_out("cats"),
        "stickers": cut_out("stickers"),
        "scraps": cut_out("scraps"),
        "papers": cut_grid("papers", [0, 250, 499, 736], [0, 433, 873, 1308]),
    }
    if OUT.exists():
        shutil.rmtree(OUT)
    manifest = {}
    for name, images in sets.items():
        (OUT / name).mkdir(parents=True)
        manifest[name] = []
        for k, im in enumerate(images, 1):
            rel = f"{name}/{k:02d}.webp"
            im.save(OUT / rel, quality=88, method=6)
            manifest[name].append({"src": f"/static/stickers/{rel}", "w": im.width, "h": im.height})
        print(f"{name}: {len(images)}")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
