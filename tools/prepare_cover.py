"""Cut the journal cover photo into the pieces the book animation needs.

  spine.webp  - the spine strip (stays put while the cover swings open)
  board.webp  - the front board, hinged at its left edge
  ribbon.webp - the bookmark ribbon hanging out of the bottom

Run from the repo root:  python tools/prepare_cover.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "src" / "journal-cover.webp"
OUT = ROOT / "static" / "img"

DESKEW_DEG = 3.8   # the photo sits ~4 degrees clockwise; CSS puts the tilt back
JOINT_X = 268      # where the spine meets the front board (deskewed pixels)
BOARD_RIGHT = 945  # right edge of the board, not counting the clasp strap

im = Image.open(SRC).convert("RGBA").rotate(DESKEW_DEG, resample=Image.BICUBIC, expand=True)
a = np.array(im)
a[a[..., 3] < 24] = 0
im = Image.fromarray(a)
solid = a[..., 3] > 128

cols = np.where(solid[600:1000].any(axis=0))[0]          # body rows only
left, right = cols[0], cols[-1] + 1
rows = np.where(solid[:, 500:900].any(axis=1))[0]        # away from the ribbon
top, bottom = rows[0], rows[-1] + 1

spine = im.crop((left, top, JOINT_X, bottom))
board = im.crop((JOINT_X, top, right, bottom))
rib_cols = np.where(solid[bottom + 4:, :JOINT_X + 200].any(axis=0))[0]
rib_rows = np.where(solid[bottom:].any(axis=1))[0]
rx0, rx1 = rib_cols[0] - 2, rib_cols[-1] + 3
ribbon = im.crop((rx0, bottom - 6, rx1, bottom + rib_rows[-1] + 2))

OUT.mkdir(parents=True, exist_ok=True)
for name, piece in (("spine", spine), ("board", board), ("ribbon", ribbon)):
    piece.save(OUT / f"{name}.webp", quality=92, method=6)

bw, bh = BOARD_RIGHT - JOINT_X, bottom - top
print(f"body  left={left} top={top} right={right} bottom={bottom}")
print(f"--ar: {bw / bh:.4f}  (board {bw}x{bh})")
print(f"spine  {spine.size}  width = {spine.size[0] / bh * 100:.2f}% of height")
print(f"board  {board.size}  width = {board.size[0] / bw * 100:.2f}% of board")
print(f"ribbon {ribbon.size} left = {(rx0 - JOINT_X) / bw * 100:.2f}%  width = {ribbon.size[0] / bw * 100:.2f}%  height = {ribbon.size[1] / bh * 100:.2f}%")
