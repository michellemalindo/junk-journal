"""Junk Journal - a personal, local scrapbook journal.

Run:  python app.py   then open http://127.0.0.1:5050
Pages are stored as JSON files in data/pages/ (no database, no login).
"""
import json
import re
import shutil
import uuid
from datetime import date, datetime
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_from_directory
from PIL import Image, UnidentifiedImageError

from cutouts import make_variants

ROOT = Path(__file__).resolve().parent
PAGES_DIR = ROOT / "data" / "pages"
EXPORTS_DIR = ROOT / "data" / "exports"
UPLOADS_DIR = ROOT / "data" / "uploads"
PAGE_ID = re.compile(r"^\d{4}-\d{2}-\d{2}(-\d+)?$")
EDITABLE = ("notes", "background", "elements")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024


def page_path(page_id):
    if not PAGE_ID.match(page_id):
        abort(404)
    return PAGES_DIR / f"{page_id}.json"


def read_page(page_id):
    path = page_path(page_id)
    if not path.exists():
        abort(404)
    return json.loads(path.read_text(encoding="utf-8"))


def write_page(page):
    page["updated"] = datetime.now().isoformat(timespec="seconds")
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    page_path(page["id"]).write_text(json.dumps(page, indent=2), encoding="utf-8")


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/api/pages")
def list_pages():
    pages = [json.loads(p.read_text(encoding="utf-8")) for p in PAGES_DIR.glob("*.json")]
    pages.sort(key=lambda p: (p["date"], p["created"]))
    return jsonify(pages)


@app.post("/api/pages")
def create_page():
    """Create a blank page for today (a second page on the same day gets -2, -3, ...)."""
    today = date.today().isoformat()
    page_id, n = today, 1
    while (PAGES_DIR / f"{page_id}.json").exists():
        n += 1
        page_id = f"{today}-{n}"
    page = {
        "id": page_id,
        "date": today,
        "created": datetime.now().isoformat(timespec="seconds"),
        "notes": "",
        "background": None,
        "elements": [],
        "photos": [],
    }
    write_page(page)
    return jsonify(page), 201


@app.put("/api/pages/<page_id>")
def update_page(page_id):
    page = read_page(page_id)
    changes = request.get_json()
    page.update({key: changes[key] for key in EDITABLE if key in changes})
    write_page(page)
    return "", 204


@app.delete("/api/pages/<page_id>")
def delete_page(page_id):
    path = page_path(page_id)
    if not path.exists():
        abort(404)
    path.unlink()
    (EXPORTS_DIR / f"{page_id}.png").unlink(missing_ok=True)
    shutil.rmtree(UPLOADS_DIR / page_id, ignore_errors=True)
    return "", 204


@app.post("/api/pages/<page_id>/photos")
def upload_photos(page_id):
    """Save each uploaded photo with its sticker cutouts; returns the new photo records."""
    page = read_page(page_id)
    folder = UPLOADS_DIR / page_id
    folder.mkdir(parents=True, exist_ok=True)
    added, skipped = [], []
    for upload in request.files.getlist("photos"):
        try:
            image = Image.open(upload.stream)
            image.load()
        except (UnidentifiedImageError, OSError):
            skipped.append(upload.filename)
            continue
        photo_id = uuid.uuid4().hex[:10]
        variants = {}
        for style, picture in make_variants(image).items():
            name = f"{photo_id}-{style}.webp"
            picture.save(folder / name, quality=90)
            variants[style] = {"src": f"/uploads/{page_id}/{name}", "w": picture.width, "h": picture.height}
        added.append({"id": photo_id, "variants": variants})
    page.setdefault("photos", []).extend(added)
    write_page(page)
    return jsonify({"photos": added, "skipped": skipped})


@app.get("/uploads/<page_id>/<filename>")
def uploads(page_id, filename):
    if not PAGE_ID.match(page_id):
        abort(404)
    return send_from_directory(UPLOADS_DIR / page_id, filename)


if __name__ == "__main__":
    # 5050 rather than Flask's default 5000, which macOS uses for AirPlay.
    app.run(host="127.0.0.1", port=5050, debug=True)
