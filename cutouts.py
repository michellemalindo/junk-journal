"""Turn an uploaded photo into sticker cutouts.

  photo - the picture as uploaded (resized)
  clean - subject isolated with rembg, smooth anti-aliased edge
  torn  - the same silhouette on a scrap of paper with a rough, hand-torn edge
"""
import numpy as np
from PIL import Image, ImageFilter, ImageOps

MAX_SIDE = 1200
_session = None


def _remove_background(photo):
    """Return the RGBA cutout, or None if rembg isn't installed."""
    global _session
    try:
        from rembg import new_session, remove
    except ImportError:
        return None
    if _session is None:
        _session = new_session("u2net")  # downloads the model (~170 MB) on first use
    return remove(photo, session=_session, post_process_mask=True)


def _noise(rng, size, cell):
    """Smooth random field in 0..1 with blobs roughly `cell` pixels across."""
    w, h = size
    small = rng.random((max(2, h // cell + 2), max(2, w // cell + 2))).astype(np.float32)
    field = Image.fromarray(small, mode="F").resize((w, h), Image.BICUBIC)
    return np.clip(np.asarray(field), 0, 1)


def _torn(cutout):
    """Place the cutout on off-white paper whose outline is torn around the silhouette."""
    margin = max(14, round(max(cutout.size) * 0.05))
    canvas = Image.new("RGBA", (cutout.width + margin * 2, cutout.height + margin * 2), (0, 0, 0, 0))
    canvas.paste(cutout, (margin, margin))
    alpha = canvas.getchannel("A")
    rng = np.random.default_rng()

    # Grow the silhouette by blurring it, then move the cut-off line with noise:
    # big slow wobbles for the tear, fine grain for the ragged paper fibres.
    spread = alpha.point(lambda v: 255 if v > 40 else 0).filter(ImageFilter.GaussianBlur(margin * 0.5))
    spread = np.asarray(spread, dtype=np.float32) / 255
    wobble = _noise(rng, canvas.size, round(margin * 1.6))
    grain = _noise(rng, canvas.size, 3)
    paper = spread > 0.2 + 0.26 * (wobble - 0.5) + 0.12 * (grain - 0.5)
    paper = Image.fromarray((paper * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    paper = np.maximum(np.asarray(paper, dtype=np.float32) / 255, np.asarray(alpha, dtype=np.float32) / 255)

    # Paper colour, a touch darker and rougher toward the torn edge.
    inner = np.asarray(Image.fromarray((paper * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)),
                       dtype=np.float32) / 255
    shade = 0.9 + 0.1 * np.clip((inner - 0.5) * 2.5, 0, 1) - 0.03 * grain
    paper_rgb = np.array([252, 249, 241], dtype=np.float32) * shade[..., None]

    rgba = np.asarray(canvas, dtype=np.float32)
    a = rgba[..., 3:4] / 255
    rgb = rgba[..., :3] * a + paper_rgb * (1 - a)
    out = np.dstack([rgb, paper * 255]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out)


def make_variants(image):
    """Return {"photo": Image, "clean": Image, "torn": Image}; only "photo" without rembg."""
    photo = ImageOps.exif_transpose(image).convert("RGB")
    photo.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    variants = {"photo": photo}

    cutout = _remove_background(photo)
    if cutout is None:
        return variants
    box = cutout.getchannel("A").point(lambda v: 255 if v > 16 else 0).getbbox()
    if box is None:  # nothing found in the picture
        return variants
    clean = cutout.crop(box)
    variants["clean"] = clean
    variants["torn"] = _torn(clean)
    return variants
