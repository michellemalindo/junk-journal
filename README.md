# Junk Journal

A personal, local digital junk journal. Flask backend, plain HTML/CSS/JS frontend,
no login and no database: each page is a JSON file in `data/pages/`.

## Run it

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Windows (PowerShell):

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Then open http://127.0.0.1:5050.

The first photo upload downloads the background-removal model (about 170 MB), so it
takes a minute; after that cutouts take a few seconds each.

## What's built so far

- The leather journal on the desk; click it and the cover swings open.
- The index (pages grouped by year, then date, as live thumbnails), "New Page",
  and the page-turn.
- Sticker tray with cats, stickers, paper scraps and patterned papers: drag them
  onto the page, then move, resize and rotate them.
- Photo upload: each photo is cut out with `rembg` and can be switched between
  the original photo, a clean cut and a torn-paper edge.
- A notes page for each day. Everything saves automatically to `data/pages/`.

Still to come: free text boxes, a date stamp, and exporting the page as a flat image.

## Layout

- `app.py` - Flask app and the JSON page API
- `cutouts.py` - photo cutouts (clean and torn)
- `templates/index.html`, `static/css/style.css`, `static/js/app.js` - the book
- `static/img/` - the cover photo cut into spine, front board and ribbon
- `tools/prepare_cover.py` - re-cuts those pieces from `tools/src/journal-cover.webp`
  (needs `pillow` and `numpy`; only run it if you change the cover photo)
- `static/stickers/` - the stickers, cut from the sheets in `tools/src/` by
  `tools/extract_stickers.py` (needs `opencv-python-headless`; only run it to add sheets)
- `data/` - your pages and uploaded photos (created on first use, not committed)
