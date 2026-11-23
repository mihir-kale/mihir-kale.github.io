import { loadEntries, loadFeeds, loadMarks, loadSuggestions, saveEntry, deleteEntry, normalizeItem, SUPABASE_URL, SUPABASE_ANON_KEY, LASTFM_USERNAME, MEDIA_TYPES, TYPE_LABELS, LISTS, LIST_LABELS, TOGGLE_LISTS, COVER_TYPES } from "./data.js?v=20261122a";
import { resolveCover } from "./covers.js?v=20261026f";
import { signIn, signOut, getSession } from "./auth.js?v=20261026f";
import { loadNowPlaying } from "./lastfm.js?v=20261026f";

const searchInput = document.getElementById("search");
const authEl = document.getElementById("auth");
const themeToggle = document.getElementById("themeToggle");
const helpToggle = document.getElementById("helpToggle");
const indexScroll = document.getElementById("indexScroll");
const galleryScroll = document.getElementById("galleryScroll");
const indexPanel = document.getElementById("indexPanel");
const galleryPanel = document.getElementById("galleryPanel");
const categoryNav = document.getElementById("categoryNav");
const mobileNav = document.getElementById("mobileNav");
const mobileIndexBtn = document.getElementById("mobileIndexBtn");
const mobileGalleryBtn = document.getElementById("mobileGalleryBtn");

const THEME_KEY = "media:theme:v1";

const REST = `${SUPABASE_URL}/rest/v1`;
const WRITE_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json"
};

const state = {
  items: [],
  query: "",
  category: "ALL",
  selectedMediaId: null,
  expandedId: null,
  mobileView: "index",
  session: null,
  suggestions: [],
  dismissed: new Set(),
  promoted: new Set(),
  nowPlaying: null
};

const DISMISS_KEY = "media:dismissed:v1";
const PROMOTE_KEY = "media:promoted:v1";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

function consumed(item) {
  return item.consumed ? new Date(`${item.consumed}T00:00:00`).getTime() : -Infinity;
}

function ordered(items) {
  return [...items].sort(
    (a, b) =>
      Number(b.spotlight) - Number(a.spotlight) ||
      consumed(b) - consumed(a) ||
      (b.year || 0) - (a.year || 0) ||
      a.title.localeCompare(b.title)
  );
}

function matches(item, query) {
  if (!query) return true;
  const haystack = [item.title, item.creator, (item.tags || []).join(" "), item.year, TYPE_LABELS[item.mediaType], item.topic]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function readDismissed() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function persistDismissed() {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...state.dismissed])); } catch {}
}
function readPromoted() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROMOTE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function persistPromoted() {
  try { localStorage.setItem(PROMOTE_KEY, JSON.stringify([...state.promoted])); } catch {}
}

function effectiveList(item) {
  if (item.source === "feed" && state.promoted.has(item.id)) return "recommend";
  return item.list;
}

// ---------------- review preview ----------------
function reviewWords(item) {
  const r = (item.notes || "").trim();
  return r;
}
function previewText(full) {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 30) return full.trim();
  return words.slice(0, 30).join(" ") + "\u2026";
}
function hasReview(item) {
  return !!(item.notes && item.notes.trim());
}
function isLongReview(item) {
  if (!hasReview(item)) return false;
  return item.notes.trim().split(/\s+/).filter(Boolean).length > 30;
}

// ---------------- filtering ----------------
function filteredItems() {
  const query = state.query.trim().toLowerCase();
  const pool = state.items.concat(state.suggestions || []);
  const out = [];
  for (const item of ordered(pool)) {
    if (state.dismissed.has(item.id)) continue;
    if (state.category !== "ALL" && item.mediaType !== state.category) continue;
    if (!matches(item, query)) continue;
    out.push(item);
  }
  return out;
}

// ---------------- category nav ----------------
function buildCategoryNav() {
  categoryNav.replaceChildren();
  const cats = ["ALL", ...MEDIA_TYPES];
  for (const c of cats) {
    const btn = el("button", "cat-btn", c === "ALL" ? "ALL" : (TYPE_LABELS[c] || c).toUpperCase());
    btn.type = "button";
    btn.dataset.cat = c;
    btn.addEventListener("click", () => setCategory(c));
    categoryNav.append(btn);
  }
  syncCategoryNav();
}
function syncCategoryNav() {
  categoryNav.querySelectorAll(".cat-btn").forEach((b) => {
    const active = b.dataset.cat === state.category;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-pressed", String(active));
  });
}
function setCategory(c) {
  const prev = state.category;
  state.category = c;
  if (prev !== c) {
    // cleanup selection/expanded
    const ids = new Set(filteredItems().map((i) => i.id));
    if (state.selectedMediaId && !ids.has(state.selectedMediaId)) state.selectedMediaId = null;
    if (state.expandedId && !ids.has(state.expandedId)) state.expandedId = null;
    // reset scrolls
    indexScroll.scrollTop = 0;
    galleryScroll.scrollTop = 0;
  }
  syncCategoryNav();
  renderAll();
}

// ---------------- index rendering ----------------
function createEntry(item) {
  const entry = el("div", "media-entry");
  entry.dataset.id = item.id;
  entry.dataset.selected = String(state.selectedMediaId === item.id);

  const titleBtn = el("button", "media-title", item.title);
  titleBtn.type = "button";
  titleBtn.setAttribute("aria-pressed", String(state.selectedMediaId === item.id));
  titleBtn.addEventListener("click", () => selectFromIndex(item.id));
  entry.append(titleBtn);

  if (hasReview(item)) {
    const review = el("p", "media-review");
    review.id = `review-${item.id}`;
    const expanded = state.expandedId === item.id;
    if (expanded) review.textContent = item.notes.trim();
    else review.textContent = previewText(item.notes);
    entry.append(review);

    if (isLongReview(item)) {
      const toggle = el("button", "review-toggle", expanded ? "<<<" : ">>>");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute("aria-controls", review.id);
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleReview(item.id);
      });
      entry.append(toggle);
    }
  }

  return entry;
}

function renderIndex(items) {
  indexScroll.replaceChildren();
  if (!items.length) {
    const msg = el("p", "empty-msg", "No works found.");
    indexScroll.append(msg);
    return;
  }
  for (const item of items) {
    indexScroll.append(createEntry(item));
  }
}

// ---------------- gallery rendering + masonry ----------------
let galleryNodes = new Map(); // id -> button
let galleryItemOrder = []; // ids
let masonryTimer = null;

function colCount(width) {
  if (width >= 1100) return 5;
  if (width >= 700) return 4;
  if (width >= 400) return 3;
  return 2;
}

function createGalleryItem(item) {
  const btn = el("button", "gallery-item");
  btn.type = "button";
  btn.dataset.id = item.id;
  btn.setAttribute("aria-label", item.title);
  btn.setAttribute("aria-pressed", String(state.selectedMediaId === item.id));
  btn.dataset.selected = String(state.selectedMediaId === item.id);
  btn.addEventListener("click", () => selectFromGallery(item.id));

  // cover image
  const img = document.createElement("img");
  img.className = "cover-image";
  img.alt = item.title;
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("load", () => {
    // update aspect ratio and schedule recompute
    if (img.naturalWidth && img.naturalHeight) {
      aspectRatios.set(item.id, img.naturalWidth / img.naturalHeight);
      scheduleMasonry();
    }
  });
  img.addEventListener("error", () => {
    // render placeholder
    btn.replaceChildren();
    const ph = el("div", "cover-placeholder");
    ph.style.aspectRatio = "2 / 3";
    ph.style.background = "#e8e6e0";
    const t = el("span", "placeholder-title", item.title);
    ph.append(t);
    btn.append(ph);
    // keep interactive
  });
  btn.append(img);

  // resolve cover async
  resolveCover(item).then((url) => {
    if (!url) {
      // placeholder
      if (img.isConnected) {
        img.remove();
        const ph = el("div", "cover-placeholder");
        ph.style.aspectRatio = "2 / 3";
        ph.style.background = "#e8e6e0";
        const t = el("span", "placeholder-title", item.title);
        ph.append(t);
        btn.append(ph);
      }
      return;
    }
    img.src = url;
  });

  return btn;
}

const aspectRatios = new Map(); // id -> ratio

function scheduleMasonry() {
  if (masonryTimer) return;
  masonryTimer = setTimeout(() => {
    masonryTimer = null;
    doMasonry();
  }, 80);
}

function doMasonry() {
  const container = galleryScroll;
  const width = container.clientWidth;
  const cols = colCount(width);
  const contentWidth = Math.max(0, width - 40);
  const colWidth = cols > 0 ? (contentWidth - (cols - 1) * 12) / cols : contentWidth;
  // ensure column containers
  let columnsWrap = container.querySelector(".gallery-columns");
  if (!columnsWrap || columnsWrap.dataset.cols !== String(cols)) {
    columnsWrap = el("div", "gallery-columns");
    columnsWrap.dataset.cols = String(cols);
    // move existing nodes? We'll rebuild container
    container.replaceChildren(columnsWrap);
    for (let i = 0; i < cols; i++) {
      const c = el("div", "gallery-col");
      columnsWrap.append(c);
    }
  }
  const colEls = [...columnsWrap.querySelectorAll(".gallery-col")];
  // reset
  colEls.forEach((c) => c.replaceChildren());
  const heights = new Array(cols).fill(0);
  for (const id of galleryItemOrder) {
    const node = galleryNodes.get(id);
    if (!node) continue;
    const item = (filteredCache || []).find((x) => x.id === id);
    const ratio = aspectRatios.get(id) || 2 / 3;
    const imgHeight = colWidth > 0 ? colWidth / ratio : 0;
    // choose column
    let target = 0;
    for (let i = 1; i < cols; i++) {
      if (heights[i] < heights[target]) target = i;
    }
    colEls[target].append(node);
    heights[target] += imgHeight + 12;
  }
  // empty state
  if (!galleryItemOrder.length) {
    const msg = el("p", "empty-msg", "No works found.");
    container.replaceChildren(msg);
  }
}

let filteredCache = [];

function renderGallery(items) {
  filteredCache = items;
  galleryNodes = new Map();
  galleryItemOrder = items.map((i) => i.id);
  // create nodes
  const nodes = new Map();
  for (const item of items) {
    nodes.set(item.id, createGalleryItem(item));
  }
  galleryNodes = nodes;
  // reset aspect ratios for new items? keep existing
  if (!items.length) {
    galleryScroll.replaceChildren(el("p", "empty-msg", "No works found."));
    return;
  }
  doMasonry();
}

function renderAll() {
  const items = filteredItems();
  filteredCache = items;
  // cleanup selected/expanded already handled in setCategory; also on search? ensure
  const ids = new Set(items.map((i) => i.id));
  if (state.selectedMediaId && !ids.has(state.selectedMediaId)) state.selectedMediaId = null;
  if (state.expandedId && !ids.has(state.expandedId)) state.expandedId = null;

  renderIndex(items);
  renderGallery(items);
  applySelectionStyles();
  // mobile nav state
  applyMobileView();
}

// ---------------- selection ----------------
function applySelectionStyles() {
  // index entries
  indexScroll.querySelectorAll(".media-entry").forEach((entry) => {
    const id = entry.dataset.id;
    const sel = id === state.selectedMediaId;
    entry.dataset.selected = String(sel);
    const titleBtn = entry.querySelector(".media-title");
    if (titleBtn) titleBtn.setAttribute("aria-pressed", String(sel));
  });
  // gallery items
  galleryScroll.querySelectorAll(".gallery-item").forEach((g) => {
    const id = g.dataset.id;
    const sel = id === state.selectedMediaId;
    g.dataset.selected = String(sel);
    g.setAttribute("aria-pressed", String(sel));
  });
}

function isReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollIfNeeded(container, targetTop, offset) {
  // targetTop: element's top relative to container content
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;
  const elTop = targetTop;
  const elBottom = targetTop + 0; // for title target we just need title visible; use entry
  // We'll handle per caller with element rects
}

function completelyVisible(container, el) {
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  return eRect.top >= cRect.top && eRect.bottom <= cRect.bottom;
}

function selectFromIndex(id) {
  state.selectedMediaId = id;
  applySelectionStyles();
  // gallery scroll
  const gItem = galleryScroll.querySelector(`.gallery-item[data-id="${CSS.escape(id)}"]`);
  if (gItem) {
    if (!completelyVisible(galleryScroll, gItem)) {
      const top = gItem.getBoundingClientRect().top - galleryScroll.getBoundingClientRect().top + galleryScroll.scrollTop;
      galleryScroll.scrollTo({ top: top - 20, behavior: isReducedMotion() ? "auto" : "smooth" });
    }
  }
  // mobile switch
  if (window.innerWidth < 600) {
    state.mobileView = "gallery";
    applyMobileView();
  }
}

function selectFromGallery(id) {
  state.selectedMediaId = id;
  applySelectionStyles();
  // index scroll: target entry title
  const entry = indexScroll.querySelector(`.media-entry[data-id="${CSS.escape(id)}"]`);
  if (entry) {
    const title = entry.querySelector(".media-title");
    const target = title || entry;
    if (!completelyVisible(indexScroll, target)) {
      const top = target.getBoundingClientRect().top - indexScroll.getBoundingClientRect().top + indexScroll.scrollTop;
      indexScroll.scrollTo({ top: top - 16, behavior: isReducedMotion() ? "auto" : "smooth" });
    }
  }
  if (window.innerWidth < 600) {
    state.mobileView = "index";
    applyMobileView();
  }
}

function toggleReview(id) {
  state.selectedMediaId = id;
  if (state.expandedId === id) state.expandedId = null;
  else state.expandedId = id;
  renderIndex(filteredItems());
  applySelectionStyles();
  // reveal selected artwork in gallery if needed
  const gItem = galleryScroll.querySelector(`.gallery-item[data-id="${CSS.escape(id)}"]`);
  if (gItem && !completelyVisible(galleryScroll, gItem)) {
    const top = gItem.getBoundingClientRect().top - galleryScroll.getBoundingClientRect().top + galleryScroll.scrollTop;
    galleryScroll.scrollTo({ top: top - 20, behavior: isReducedMotion() ? "auto" : "smooth" });
  }
}

// ---------------- mobile view ----------------
function applyMobileView() {
  const isMobile = window.innerWidth < 600;
  if (mobileNav) mobileNav.style.display = isMobile ? "flex" : "none";
  if (isMobile) {
    indexPanel.classList.toggle("is-active", state.mobileView === "index");
    galleryPanel.classList.toggle("is-active", state.mobileView === "gallery");
    if (mobileIndexBtn) mobileIndexBtn.classList.toggle("is-active", state.mobileView === "index");
    if (mobileGalleryBtn) mobileGalleryBtn.classList.toggle("is-active", state.mobileView === "gallery");
  } else {
    indexPanel.classList.add("is-active");
    galleryPanel.classList.add("is-active");
  }
}

// ---------------- theme ----------------
function applyTheme(dark) {
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  if (themeToggle) {
    themeToggle.textContent = dark ? "light" : "dark";
    themeToggle.setAttribute("aria-pressed", String(dark));
  }
}
function setupTheme() {
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark");
  if (!themeToggle) return;
  themeToggle.addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") !== "dark";
    applyTheme(dark);
    try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch {}
  });
}

// ---------------- auth (preserved) ----------------
let authDialog = null, authForm = null, authEmail = null, authPassword = null, authError = null, authSubmit = null;
function buildAuthDialog() {
  authDialog = el("dialog", "auth-dialog");
  authDialog.setAttribute("aria-label", "Sign in");
  authForm = el("form", "auth-form");
  authEmail = document.createElement("input"); authEmail.className = "auth-input"; authEmail.type = "email"; authEmail.autocomplete = "username"; authEmail.required = true;
  authPassword = document.createElement("input"); authPassword.className = "auth-input"; authPassword.type = "password"; authPassword.autocomplete = "current-password"; authPassword.required = true;
  authError = el("p", "auth-error", "");
  const cancel = el("button", "auth-cancel", "cancel"); cancel.type = "button";
  cancel.addEventListener("click", () => authDialog.close());
  authSubmit = el("button", "auth-submit", "sign in"); authSubmit.type = "submit";
  const row = el("div", "auth-row"); row.append(cancel, authSubmit);
  authForm.append(el("p", "auth-title", "sign in"),
    buildField("email", authEmail, "auth-field", "auth-label"),
    buildField("password", authPassword, "auth-field", "auth-label"),
    authError, row);
  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authError.textContent = "";
    authSubmit.disabled = true; authSubmit.textContent = "\u2026";
    try {
      state.session = await signIn(authEmail.value.trim(), authPassword.value);
      authDialog.close(); authForm.reset();
      state.suggestions = await loadSuggestions(state.session.accessToken);
      buildAuth(); renderAll();
    } catch (err) { authError.textContent = err.message; }
    finally { authSubmit.disabled = false; authSubmit.textContent = "sign in"; }
  });
  authDialog.append(authForm);
  document.body.append(authDialog);
}
function buildField(labelText, control, fieldClass = "suggest-field", labelClass = "suggest-label") {
  const label = el("label", fieldClass);
  label.append(el("span", labelClass, labelText), control);
  return label;
}
function buildAuth() {
  if (!authEl) return;
  authEl.replaceChildren();
  if (state.session) {
    authEl.append(el("span", "auth-email", state.session.email || "signed in"));
    const add = el("button", "auth-btn", "+ new"); add.type = "button";
    add.addEventListener("click", () => openEditor(null));
    const out = el("button", "auth-btn", "sign out"); out.type = "button";
    out.addEventListener("click", async () => {
      await signOut(); state.session = null; state.suggestions = [];
      buildAuth(); renderAll();
    });
    authEl.append(add, out);
  } else {
    const signin = el("button", "auth-btn", "sign in"); signin.type = "button";
    signin.addEventListener("click", () => { authError.textContent = ""; authDialog.showModal(); authEmail.focus(); });
    authEl.append(signin);
  }
}

// ---------------- editor (preserved) ----------------
let editorDialog = null, editorForm = null, editorError = null, editorTitleEl = null, editorSubmit = null, editorDelete = null, editorFields = null, editorEditing = null;
function buildEditor() {
  editorDialog = el("dialog", "editor-dialog");
  editorDialog.setAttribute("aria-label", "Edit entry");
  editorForm = el("form", "editor-form");
  const makeInput = (ph, type, req) => { const n = document.createElement("input"); n.className = "editor-input"; n.type = type || "text"; if (ph) n.placeholder = ph; if (req) n.required = true; return n; };
  const makeSelect = (entries) => { const n = document.createElement("select"); n.className = "editor-input"; for (const [v, l] of entries) { const o = document.createElement("option"); o.value = v; o.textContent = l; n.append(o); } return n; };
  const makeTextarea = (ph) => { const n = document.createElement("textarea"); n.className = "editor-input"; n.rows = 3; if (ph) n.placeholder = ph; return n; };
  const mediaType = makeSelect(MEDIA_TYPES.map((t) => [t, TYPE_LABELS[t]]));
  const title = makeInput("title", "text", true);
  const creator = makeInput("creator");
  const year = makeInput("year", "number");
  const status = makeSelect([["finished", "consumed"], ["in-progress", "in progress"], ["backlog", "on the list"]]);
  const consumed = makeInput("", "date");
  const url = makeInput("url", "url");
  const tags = makeInput("tags (comma separated)");
  const notes = makeTextarea("notes");
  const list = makeSelect(LISTS.map((id) => [id, LIST_LABELS[id]]));
  const topic = makeInput("e.g. cold war");
  const spotlight = document.createElement("input"); spotlight.type = "checkbox";
  editorFields = { mediaType, title, creator, year, status, consumed, url, tags, notes, list, topic, spotlight };
  for (const [name, control] of Object.entries(editorFields)) control.name = name;
  const grid = el("div", "editor-grid");
  grid.append(
    buildField("category", mediaType, "editor-field", "editor-label"),
    buildField("status", status, "editor-field", "editor-label"),
    buildField("title", title, "editor-field editor-span", "editor-label"),
    buildField("creator", creator, "editor-field", "editor-label"),
    buildField("year", year, "editor-field", "editor-label"),
    buildField("consumed", consumed, "editor-field", "editor-label"),
    buildField("list", list, "editor-field", "editor-label"),
    buildField("topic", topic, "editor-field", "editor-label"),
    buildField("url", url, "editor-field editor-span", "editor-label"),
    buildField("tags", tags, "editor-field editor-span", "editor-label"),
    buildField("notes", notes, "editor-field editor-span", "editor-label")
  );
  const check = el("label", "editor-check"); check.append(spotlight, el("span", null, "spotlight (pin to top)"));
  editorError = el("p", "editor-error", "");
  editorTitleEl = el("p", "editor-title", "new entry");
  const cancel = el("button", "editor-cancel", "cancel"); cancel.type = "button";
  cancel.addEventListener("click", () => editorDialog.close());
  editorDelete = el("button", "editor-delete hidden", "delete"); editorDelete.type = "button";
  editorDelete.addEventListener("click", () => deleteEntryPrompt(editorEditing));
  editorSubmit = el("button", "editor-submit", "add"); editorSubmit.type = "submit";
  const row = el("div", "editor-row"); row.append(editorDelete, cancel, editorSubmit);
  editorForm.append(editorTitleEl, grid, check, editorError, row);
  editorForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    editorError.textContent = "";
    const raw = {
      id: editorEditing ? editorEditing.id : genId(),
      mediaType: editorFields.mediaType.value,
      title: editorFields.title.value.trim(),
      creator: editorFields.creator.value.trim(),
      year: editorFields.year.value ? Number(editorFields.year.value) : null,
      status: editorFields.status.value,
      consumed: editorFields.consumed.value || null,
      url: editorFields.url.value.trim(),
      tags: editorFields.tags.value.split(",").map((s) => s.trim()).filter(Boolean),
      notes: editorFields.notes.value.trim(),
      spotlight: editorFields.spotlight.checked,
      list: editorFields.list.value,
      topic: editorFields.topic.value.trim(),
      source: editorEditing ? editorEditing.source : "manual"
    };
    let item;
    try { item = normalizeItem(raw); }
    catch (err) { editorError.textContent = err.message; return; }
    const session = await getSession();
    if (!session) { editorError.textContent = "session expired \u2014 sign in again"; return; }
    editorSubmit.disabled = true;
    try { await saveEntry(item, session.accessToken); }
    catch (err) { editorError.textContent = err.message; editorSubmit.disabled = false; return; }
    editorSubmit.disabled = false;
    const index = state.items.findIndex((x) => x.id === item.id);
    if (index >= 0) state.items[index] = item;
    else state.items.unshift(item);
    editorDialog.close();
    renderAll();
  });
  editorDialog.append(editorForm);
  document.body.append(editorDialog);
}
function genId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function openEditor(item) {
  editorEditing = item || null;
  editorError.textContent = "";
  const f = editorFields;
  f.mediaType.value = item ? item.mediaType : "non-fiction";
  f.title.value = item ? item.title : "";
  f.creator.value = item ? item.creator : "";
  f.year.value = item && item.year ? item.year : "";
  f.status.value = item ? item.status : "finished";
  f.consumed.value = item && item.consumed ? item.consumed : "";
  f.url.value = item ? item.url : "";
  f.tags.value = item ? item.tags.join(", ") : "";
  f.notes.value = item ? item.notes : "";
  f.spotlight.checked = item ? item.spotlight : false;
  f.list.value = item ? item.list : "recommend";
  f.topic.value = item ? item.topic || "" : "";
  editorDelete.classList.toggle("hidden", !item);
  editorTitleEl.textContent = item ? "edit entry" : "new entry";
  editorSubmit.textContent = item ? "save" : "add";
  editorDialog.showModal();
  f.title.focus();
}
async function deleteEntryPrompt(item) {
  if (!item) return;
  if (!window.confirm(`delete \u201C${item.title}\u201D?`)) return;
  const session = await getSession();
  if (!session) { window.alert("session expired \u2014 sign in again"); return; }
  try { await deleteEntry(item.id, session.accessToken); }
  catch (err) { window.alert(err.message); return; }
  state.items = state.items.filter((x) => x.id !== item.id);
  state.dismissed.delete(item.id);
  state.promoted.delete(item.id);
  if (editorDialog.open) editorDialog.close();
  renderAll();
}

// help dialog
let helpDialog = null;
function buildHelpDialog() {
  helpDialog = el("dialog", "help-dialog");
  helpDialog.setAttribute("aria-label", "What is this?");
  const body = el("div", "help-body");
  body.append(el("p", "auth-title", "what is this?"), el("p", null, "my commonplace book \u2014 a running catalogue of the fiction, non-fiction, short fiction, short non-fiction, films, music, and podcasts i've consumed, plus the things i still want to get to."));
  const close = el("button", "help-close", "close"); close.type = "button";
  close.addEventListener("click", () => helpDialog.close());
  body.append(close);
  helpDialog.append(body);
  document.body.append(helpDialog);
}
function setupHelp() {
  if (!helpToggle) return;
  buildHelpDialog();
  helpToggle.addEventListener("click", () => helpDialog.showModal());
}

// ---------------- init ----------------
searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  renderAll();
});

window.addEventListener("resize", () => {
  applyMobileView();
  // recompute masonry if width changed
  scheduleMasonry();
});

mobileIndexBtn.addEventListener("click", () => { state.mobileView = "index"; applyMobileView(); });
mobileGalleryBtn.addEventListener("click", () => { state.mobileView = "gallery"; applyMobileView(); });

setupTheme();
setupHelp();
buildCategoryNav();
buildAuthDialog();
buildEditor();
buildAuth();

state.dismissed = new Set(readDismissed());
state.promoted = new Set(readPromoted());

getSession().then(async (session) => {
  state.session = session;
  buildAuth();
  if (session) state.suggestions = await loadSuggestions(session.accessToken);
  renderAll();
});

Promise.all([loadEntries(), loadFeeds(), loadMarks()])
  .then(([entries, feeds, marks]) => {
    state.items = [...entries, ...feeds];
    if (marks) {
      state.dismissed = new Set(marks.filter((m) => m.dismissed).map((m) => m.item_id));
      state.promoted = new Set(marks.filter((m) => m.promoted).map((m) => m.item_id));
      persistDismissed();
      persistPromoted();
    }
    renderAll();
  })
  .catch((error) => {
    console.error(error);
    indexScroll.replaceChildren();
    indexScroll.append(el("p", "notice", error.message));
  });

// initial mobile view
applyMobileView();