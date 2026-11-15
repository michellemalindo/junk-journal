(() => {
  const book = document.getElementById("book");
  const cover = document.getElementById("cover");
  const leftPage = document.getElementById("leftPage");
  const rightPage = document.getElementById("rightPage");
  const hint = document.getElementById("hint");
  const trayTabs = document.getElementById("trayTabs");
  const trayBody = document.getElementById("trayBody");
  const trayFoot = document.getElementById("trayFoot");
  const photoInput = document.getElementById("photoInput");

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FLIP_MS = reducedMotion ? 1 : 950;
  const PAGE_RATIO = 0.66; // sheet width / height

  // Sticker sets in the tray: [key in the manifest, tab label, width when dropped (fraction of page width)]
  const SETS = [
    ["cats", "Cats", 0.3],
    ["stickers", "Stickers", 0.22],
    ["scraps", "Scraps", 0.5],
    ["papers", "Papers", 0.5],
  ];
  const PHOTO_WIDTH = 0.5;
  const STYLE_LABELS = { photo: "Photo", clean: "Clean cut", torn: "Torn" };

  const state = {
    open: false,
    busy: false,
    current: null,   // id of the page being shown, or null for the index
    pages: [],       // chronological, oldest first
    stickers: {},    // manifest: set name -> [{src, w, h}]
    tab: "cats",
    selected: null,  // id of the selected element on the current page
    uploading: false,
  };

  // ---------- helpers ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(className, text, action, id) {
    const node = el("button", className, text);
    node.type = "button";
    node.dataset.action = action;
    if (id != null) node.dataset.id = id;
    return node;
  }

  function parseDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  const fmt = (iso, options) => parseDate(iso).toLocaleDateString("en-US", options);
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const currentPage = () => state.pages.find((p) => p.id === state.current);

  async function api(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) throw new Error(`${options?.method || "GET"} ${path} failed (${res.status})`);
    return res.status === 204 ? null : res.json();
  }

  async function loadPages() {
    state.pages = await api("/api/pages");
  }

  // ---------- saving ----------

  let saveTimer = null;
  let dirtyPage = null;

  function saveSoon() {
    dirtyPage = currentPage();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    const page = dirtyPage;
    if (!page) return;
    dirtyPage = null;
    const { notes, background, elements } = page;
    await api(`/api/pages/${page.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes, background, elements }),
      keepalive: true,
    });
  }

  // ---------- stickers on a sheet ----------

  function place(node, element) {
    node.style.left = `${element.x * 100}%`;
    node.style.top = `${element.y * 100}%`;
    node.style.width = `${element.w * 100}%`;
    node.style.aspectRatio = `1 / ${element.aspect}`;
    node.style.setProperty("--rot", `${element.rot}deg`);
  }

  function stickerNode(element) {
    const node = el("div", "sticker");
    node.dataset.el = element.id;
    const img = el("img");
    img.src = element.src;
    img.alt = "";
    img.draggable = false;
    node.append(img);
    place(node, element);
    return node;
  }

  function paint(canvas, page) {
    canvas.style.backgroundImage = page.background ? `url("${page.background}")` : "";
    canvas.replaceChildren(...page.elements.map(stickerNode));
  }

  const sheet = () => rightPage.querySelector(".sheet");
  const canvas = () => rightPage.querySelector(".sheet-canvas");
  const frame = () => rightPage.querySelector(".sel");
  const nodeOf = (id) => canvas().querySelector(`[data-el="${id}"]`);
  const selectedElement = () => currentPage()?.elements.find((e) => e.id === state.selected);

  function refreshSheet() {
    const page = currentPage();
    paint(canvas(), page);
    rightPage.querySelector(".sheet-note").hidden = page.elements.length > 0;
    select(page.elements.some((e) => e.id === state.selected) ? state.selected : null);
  }

  function select(id) {
    state.selected = id;
    const element = selectedElement();
    const box = frame();
    if (box) {
      box.hidden = !element;
      if (element) place(box, element);
    }
    renderFoot();
  }

  function addElement(item, x, y, extra = {}) {
    const page = currentPage();
    const aspect = item.h / item.w;
    // Keep tall pieces from covering the page: at most ~60% of its height.
    const w = Math.min(extra.w, 0.6 / PAGE_RATIO / aspect);
    const element = {
      id: Math.random().toString(36).slice(2, 10),
      src: item.src,
      aspect,
      x: clamp(x, 0.02, 0.98),
      y: clamp(y, 0.02, 0.98),
      rot: 0,
      ...extra,
      w,
    };
    page.elements.push(element);
    state.selected = element.id;
    refreshSheet();
    saveSoon();
  }

  // ---------- page content ----------

  function content(className) {
    return el("div", `face-content ${className}`);
  }

  function indexContent() {
    const root = content("index");

    const head = el("header", "index-head");
    head.append(el("h1", null, "Index"), button("tag-btn", "+ New Page", "new"));
    root.append(head);

    const list = el("div", "index-list");
    root.append(list);

    if (!state.pages.length) {
      list.append(el("p", "empty", "No pages yet — start one with “New Page”."));
      return root;
    }

    const byYear = new Map();
    for (const page of [...state.pages].reverse()) {
      const year = page.date.slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(page);
    }

    for (const [year, pages] of byYear) {
      list.append(el("h2", "year", year));
      const grid = el("div", "thumbs");
      for (const page of pages) {
        const thumb = button("thumb", null, "open", page.id);

        const paper = el("span", "thumb-paper");
        if (page.elements.length || page.background) {
          const mini = el("span", "mini");
          paint(mini, page);
          paper.append(mini);
        } else {
          paper.append(el("span", "thumb-blank", fmt(page.date, { day: "numeric" })));
        }

        const nth = page.id.split("-")[3];
        const label = fmt(page.date, { month: "short", day: "numeric" }) + (nth ? ` · ${nth}` : "");

        const del = el("span", "thumb-del", "×");
        del.dataset.action = "delete";
        del.dataset.id = page.id;
        del.title = "Delete this page";

        thumb.append(paper, el("span", "thumb-label", label), del);
        grid.append(thumb);
      }
      list.append(grid);
    }
    return root;
  }

  // Left-hand side of a journal spread: the date, notes for the day, and the way back.
  function notesContent(page) {
    const root = content("day");

    const head = el("header", "day-head");
    head.append(
      el("div", "date-weekday", fmt(page.date, { weekday: "long" })),
      el("div", "date-day", fmt(page.date, { month: "long", day: "numeric" })),
      el("div", "date-year", fmt(page.date, { year: "numeric" })),
      el("hr", "date-rule"),
    );

    const notes = el("textarea", "notes");
    notes.value = page.notes || "";
    notes.placeholder = "what happened today…";
    notes.spellcheck = false;
    notes.setAttribute("aria-label", "Notes for the day");

    const position = state.pages.findIndex((p) => p.id === page.id);
    const nav = el("nav", "page-nav");
    const earlier = button("link-btn", "‹ earlier", "open", state.pages[position - 1]?.id ?? "");
    const later = button("link-btn", "later ›", "open", state.pages[position + 1]?.id ?? "");
    earlier.disabled = position === 0;
    later.disabled = position === state.pages.length - 1;
    nav.append(earlier, button("link-btn", "index", "index"), later);

    root.append(head, el("div", "notes-label", "notes"), notes, nav);
    return root;
  }

  // Right-hand side: the scrapbook sheet.
  function sheetContent(page) {
    const root = content("sheet");
    const sheetCanvas = el("div", "sheet-canvas");
    paint(sheetCanvas, page);

    const note = el("p", "sheet-note", "drag stickers and photos onto the page");
    note.hidden = page.elements.length > 0;

    const box = el("div", "sel");
    box.hidden = true;
    for (const corner of ["nw", "ne", "se", "sw"]) {
      const handle = el("div", "handle h-resize");
      handle.dataset.corner = corner;
      box.append(handle);
    }
    box.append(el("div", "handle h-rotate"));

    root.append(sheetCanvas, note, box);
    return root;
  }

  // ---------- moving, resizing and rotating ----------

  function startGesture(event, mode, element) {
    event.preventDefault();
    const rect = sheet().getBoundingClientRect();
    const centre = { x: rect.left + element.x * rect.width, y: rect.top + element.y * rect.height };
    const from = { x: event.clientX, y: event.clientY };
    const start = { ...element };
    const distance = (p) => Math.hypot(p.x - centre.x, p.y - centre.y);
    const angle = (p) => (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI;
    const node = nodeOf(element.id);
    let changed = false;

    function move(e) {
      const at = { x: e.clientX, y: e.clientY };
      if (mode === "move") {
        element.x = clamp(start.x + (at.x - from.x) / rect.width, 0, 1);
        element.y = clamp(start.y + (at.y - from.y) / rect.height, 0, 1);
      } else if (mode === "resize") {
        element.w = clamp((start.w * distance(at)) / Math.max(distance(from), 1), 0.05, 2.5);
      } else {
        let rot = start.rot + angle(at) - angle(from);
        rot = ((((rot + 180) % 360) + 360) % 360) - 180;
        element.rot = Math.abs(rot) < 2.5 ? 0 : Math.round(rot * 10) / 10; // settle on upright
      }
      changed = true;
      place(node, element);
      place(frame(), element);
    }

    function end() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.classList.remove("dragging");
      if (changed) saveSoon();
    }

    document.body.classList.add("dragging");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  rightPage.addEventListener("pointerdown", (event) => {
    if (state.busy || state.current === null || event.button !== 0) return;
    const handle = event.target.closest(".handle");
    if (handle) {
      startGesture(event, handle.classList.contains("h-rotate") ? "rotate" : "resize", selectedElement());
      return;
    }
    const node = event.target.closest(".sticker");
    if (!node) {
      select(null);
      return;
    }
    select(node.dataset.el);
    startGesture(event, "move", selectedElement());
  });

  const editingActions = {
    "el-delete"(page, element) {
      page.elements = page.elements.filter((e) => e !== element);
      state.selected = null;
    },
    "el-front"(page, element) {
      page.elements = [...page.elements.filter((e) => e !== element), element];
    },
    "el-back"(page, element) {
      page.elements = [element, ...page.elements.filter((e) => e !== element)];
    },
    "el-style"(page, element, style) {
      // Swap the cutout style, keeping the picture at the same scale on the page.
      const photo = page.photos.find((p) => p.id === element.photo);
      const before = photo.variants[element.style];
      const after = photo.variants[style];
      Object.assign(element, {
        style,
        src: after.src,
        aspect: after.h / after.w,
        w: (element.w * after.w) / before.w,
      });
    },
    background(page, _element, src) {
      page.background = src || null;
    },
  };

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("textarea, input") || !selectedElement()) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      edit("el-delete");
    } else if (event.key === "Escape") {
      select(null);
    }
  });

  function edit(action, value) {
    const page = currentPage();
    if (!page || state.busy) return;
    editingActions[action](page, selectedElement(), value);
    refreshSheet();
    renderTray();
    saveSoon();
  }

  // ---------- tray ----------

  function trayItem(item, extra) {
    const node = el("button", "tray-item");
    node.type = "button";
    const img = el("img");
    img.src = item.src;
    img.alt = "";
    img.loading = "lazy";
    node.append(img);
    node.item = item;
    node.extra = extra;
    return node;
  }

  function renderTray() {
    trayTabs.replaceChildren(
      ...[...SETS, ["photos", "Photos"]].map(([key, label]) => {
        const tab = button("tray-tab" + (state.tab === key ? " on" : ""), label, "tab", key);
        return tab;
      }),
    );

    const page = currentPage();
    const body = [];
    if (state.tab === "photos") {
      const upload = button("tag-btn", state.uploading ? "cutting out…" : "+ Upload photos", "upload");
      upload.disabled = state.uploading;
      body.push(upload);
      const photos = page?.photos || [];
      body.push(el("p", "tray-help", state.uploading
        ? "Finding the subject in each photo. The very first upload also downloads the cutout model, so it can take a minute."
        : photos.length
          ? "Drag a photo onto the page. Select it there to switch between photo, clean cut and torn."
          : "Add today's photos — each one is cut out into a sticker and dropped on the page."));
      const grid = el("div", "tray-grid");
      for (const photo of photos) {
        const style = photo.variants.clean ? "clean" : "photo";
        grid.append(trayItem(photo.variants[style], { w: PHOTO_WIDTH, photo: photo.id, style }));
      }
      body.push(grid);
    } else {
      const [, , width] = SETS.find(([key]) => key === state.tab);
      const items = state.stickers[state.tab] || [];
      if (state.tab === "papers") {
        body.push(el("div", "tray-h", "Page background"));
        const swatches = el("div", "swatches");
        for (const src of ["", ...items.map((i) => i.src)]) {
          const swatch = button("swatch" + ((page?.background || "") === src ? " on" : ""), null, "background", src);
          swatch.title = src ? "Use as the page background" : "Plain cream page";
          if (src) swatch.style.backgroundImage = `url("${src}")`;
          swatches.append(swatch);
        }
        body.push(swatches, el("div", "tray-h", "Paper pieces"));
      }
      body.push(el("p", "tray-help", "Drag onto the page, or click to drop one in the middle."));
      const grid = el("div", "tray-grid");
      grid.append(...items.map((item) => trayItem(item, { w: width })));
      body.push(grid);
    }
    trayBody.replaceChildren(...body);
    renderFoot();
  }

  function renderFoot() {
    const page = currentPage();
    const element = selectedElement();
    if (!element) {
      trayFoot.replaceChildren(el("p", "tray-help", "Click a sticker on the page to resize, rotate or remove it."));
      return;
    }
    const rows = [];
    const photo = element.photo && page.photos.find((p) => p.id === element.photo);
    if (photo && Object.keys(photo.variants).length > 1) {
      const styles = el("div", "foot-row");
      for (const style of Object.keys(STYLE_LABELS)) {
        if (!photo.variants[style]) continue;
        styles.append(button("foot-btn" + (element.style === style ? " on" : ""), STYLE_LABELS[style], "el-style", style));
      }
      rows.push(styles);
    }
    const row = el("div", "foot-row");
    row.append(
      button("foot-btn", "to front", "el-front"),
      button("foot-btn", "to back", "el-back"),
      button("foot-btn danger", "remove", "el-delete"),
    );
    rows.push(row);
    trayFoot.replaceChildren(...rows);
  }

  // Drag a sticker out of the tray; a plain click drops it in the middle of the page.
  trayBody.addEventListener("pointerdown", (event) => {
    const source = event.target.closest(".tray-item");
    if (!source || state.busy || !currentPage() || event.button !== 0) return;
    event.preventDefault();
    const { item, extra } = source;
    const from = { x: event.clientX, y: event.clientY };
    let ghost = null;

    function move(e) {
      if (!ghost) {
        if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < 6) return;
        const rect = sheet().getBoundingClientRect();
        ghost = el("img", "drag-ghost");
        ghost.src = item.src;
        ghost.style.width = `${Math.min(extra.w, 0.6 / PAGE_RATIO / (item.h / item.w)) * rect.width}px`;
        document.body.append(ghost);
      }
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
    }

    function end(e) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const rect = sheet().getBoundingClientRect();
      if (!ghost) {
        const jitter = () => (Math.random() - 0.5) * 0.12;
        addElement(item, 0.5 + jitter(), 0.45 + jitter(), extra);
        return;
      }
      ghost.remove();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      if (e.type === "pointerup" && x >= 0 && x <= 1 && y >= 0 && y <= 1) addElement(item, x, y, extra);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });

  photoInput.addEventListener("change", async () => {
    const page = currentPage();
    const files = [...photoInput.files];
    photoInput.value = "";
    if (!page || !files.length) return;

    const form = new FormData();
    for (const file of files) form.append("photos", file);
    state.uploading = true;
    renderTray();
    try {
      const result = await api(`/api/pages/${page.id}/photos`, { method: "POST", body: form });
      page.photos = [...(page.photos || []), ...result.photos];
      if (state.current === page.id) {
        result.photos.forEach((photo, i) => {
          const style = photo.variants.clean ? "clean" : "photo";
          const spot = 0.3 + 0.2 * (i % 3);
          addElement(photo.variants[style], spot, 0.3 + 0.18 * (i % 4), { w: PHOTO_WIDTH, photo: photo.id, style });
        });
      }
      if (result.skipped.length) alert(`Couldn't read: ${result.skipped.join(", ")}`);
    } catch (err) {
      console.error(err);
      alert(`The upload didn't work: ${err.message}`);
    } finally {
      state.uploading = false;
      renderTray();
    }
  });

  // ---------- page turn ----------

  // Turn one leaf. "forward" lifts the right-hand page over to the left;
  // "back" brings the left-hand page back over to the right.
  // newLeft may be null: the index has only the endpaper to its left.
  async function turn(direction, newLeft, newRight) {
    const leaf = el("div", "leaf");
    const front = el("div", "leaf-face leaf-front paper side-right");
    const back = el("div", "leaf-face leaf-back paper side-left");
    const frontShade = el("div", "leaf-shade");
    const backShade = el("div", "leaf-shade");
    front.append(frontShade);
    back.append(backShade);
    leaf.append(front, back);

    const forward = direction === "forward";
    if (forward) {
      front.prepend(...rightPage.childNodes);
      back.prepend(newLeft);
      rightPage.replaceChildren(newRight);
    } else {
      front.prepend(newRight);
      back.prepend(...leftPage.childNodes);
      if (newLeft) leftPage.replaceChildren(newLeft);
      else leftPage.hidden = true;
    }
    book.insertBefore(leaf, cover);

    const angles = forward ? [0, -180] : [-180, 0];
    const timing = { duration: FLIP_MS, easing: "cubic-bezier(.45, .05, .25, 1)", fill: "forwards" };
    const turning = leaf.animate(
      angles.map((a) => ({ transform: `translateZ(10px) rotateY(${a}deg)` })),
      timing,
    );
    // Each face darkens as it tips away from the light, and clears as it lands.
    const frontOpacity = forward ? [0, 1] : [1, 0];
    frontShade.animate({ opacity: frontOpacity }, timing);
    backShade.animate({ opacity: [...frontOpacity].reverse() }, timing);
    await turning.finished;

    frontShade.remove();
    backShade.remove();
    if (forward) {
      leftPage.replaceChildren(...back.childNodes);
      leftPage.hidden = false;
    } else {
      rightPage.replaceChildren(...front.childNodes);
    }
    leaf.remove();
  }

  function setCurrent(id) {
    state.current = id;
    state.selected = null;
    document.body.classList.toggle("editing", id !== null);
    renderTray();
  }

  async function showPage(id) {
    const page = state.pages.find((p) => p.id === id);
    if (!page || id === state.current) return;
    select(null);
    await saveNow();
    const order = (pageId) => state.pages.findIndex((p) => p.id === pageId); // index = -1
    const direction = order(id) > order(state.current) ? "forward" : "back";
    setCurrent(id);
    await turn(direction, notesContent(page), sheetContent(page));
  }

  async function showIndex() {
    if (state.current === null) return;
    select(null);
    await saveNow();
    setCurrent(null);
    await turn("back", null, indexContent());
  }

  // ---------- open / close ----------

  function setOpen(open) {
    state.open = open;
    book.classList.toggle("open", open);
    book.classList.toggle("closed", !open);
    hint.classList.toggle("gone", open);
    rightPage.inert = !open;
    cover.setAttribute("aria-label", open ? "Close the journal" : "Open the journal");
  }

  // ---------- events ----------

  const actions = {
    async new() {
      const page = await api("/api/pages", { method: "POST" });
      await loadPages();
      await showPage(page.id);
    },
    open: (id) => showPage(id),
    index: () => showIndex(),
    async delete(id) {
      const page = state.pages.find((p) => p.id === id);
      const label = fmt(page.date, { month: "long", day: "numeric", year: "numeric" });
      if (!confirm(`Delete the page for ${label}? This can't be undone.`)) return;
      await api(`/api/pages/${id}`, { method: "DELETE" });
      await loadPages();
      rightPage.replaceChildren(indexContent());
    },
  };

  async function run(action, id) {
    if (state.busy) return;
    state.busy = true;
    try {
      await actions[action](id);
    } catch (err) {
      console.error(err);
      alert(`Something went wrong: ${err.message}`);
    } finally {
      state.busy = false;
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    const { action, id } = target.dataset;
    if (action in actions) run(action, id);
    else if (action in editingActions) edit(action, id);
    else if (action === "upload") photoInput.click();
    else if (action === "tab") {
      state.tab = id;
      renderTray();
    }
  });

  leftPage.addEventListener("input", (event) => {
    if (!event.target.matches(".notes")) return;
    currentPage().notes = event.target.value;
    saveSoon();
  });

  function toggleCover() {
    if (state.busy) return;
    if (!state.open) setOpen(true);
    else if (state.current === null) setOpen(false);
  }
  cover.addEventListener("click", toggleCover);
  cover.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleCover();
    }
  });

  window.addEventListener("pagehide", saveNow);

  // ---------- start ----------

  rightPage.classList.add("paper", "side-right");
  leftPage.classList.add("paper", "side-left");
  setOpen(false);
  renderTray();
  Promise.all([loadPages(), api("/static/stickers/manifest.json")])
    .then(([, stickers]) => {
      state.stickers = stickers;
      rightPage.replaceChildren(indexContent());
      renderTray();
    })
    .catch((err) => {
      console.error(err);
      rightPage.replaceChildren(el("p", "empty", "Couldn't load your pages — is the server running?"));
    });
})();
