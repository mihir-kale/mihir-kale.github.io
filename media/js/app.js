import { loadLibrary, loadFeeds, MEDIA_TYPES, TYPE_LABELS, KIND_LABELS, LISTS, LIST_LABELS, COVER_TYPES } from "./data.js";
import { resolveCover } from "./covers.js";

const searchInput = document.getElementById("search");
const listsEl = document.getElementById("lists");
const railsEl = document.getElementById("rails");

const SUGGEST_KEY = "media:suggestions:v1";
const DISMISS_KEY = "media:dismissed:v1";

// Public by design (RLS-protected); the media catalogue itself stays a static JSON file.
const SUPABASE_URL = "https://gzwhuwzmrrmtswyhjheu.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6d2h1d3ptcnJtdHN3eWhqaGV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NDQ1OTUsImV4cCI6MjEwNDIyMDU5NX0.vARmLV7ttdkTXz45IDUydwEENxFFY4d3PsI1kct08_E";

const state = { items: [], query: "", list: "recommend", suggestions: [], dismissed: new Set() };
const listButtons = new Map();

const STATUS_GLYPHS = { "in-progress": "\u25CF", backlog: "\u25CB" };

const SHELF_LIMIT = 15;
const MIN_COL = 280;
const GAP_MIN = 14;
const GAP_MAX = 22;

let railEls = [];
let formRail = null;
let suggestListEl = null;
let suggestCountEl = null;
let suggestErrorEl = null;
let suggestStatusEl = null;
let suggestForm = null;

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
  const haystack = [item.title, item.creator, item.tags.join(" "), item.year, TYPE_LABELS[item.mediaType]]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/* --------------------------------- entries -------------------------------- */

function coverWrap(item) {
  const node = document.createElement(isHttpUrl(item.url) ? "a" : "figure");
  node.className = "ri-cover";
  if (node.tagName === "A") {
    node.href = item.url;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
  }
  return node;
}

async function hydrateCover(frame, item, li) {
  const url = await resolveCover(item);
  if (!url || !frame.isConnected) return;
  const img = new Image();
  img.alt = `${TYPE_LABELS[item.mediaType]} cover for ${item.title}`;
  img.decoding = "async";
  img.loading = "lazy";
  img.src = url;
  frame.replaceChildren(img);
  li.classList.add("has-cover");
  scheduleLayout();
}

function buildItem(item) {
  const li = el("li", `rail-item rail-item--${item.mediaType}`);
  if (item.status) li.classList.add(`is-${item.status}`);

  const main = el("div", "ri-main");

  const head = el("div", "ri-head");
  const headMain = el("span", "ri-head-main");
  headMain.append(el("span", "ri-src", item.creator || TYPE_LABELS[item.mediaType]));
  if (STATUS_GLYPHS[item.status]) {
    headMain.append(el("span", `ri-status ri-status--${item.status}`, STATUS_GLYPHS[item.status]));
  }
  head.append(headMain);
  if (item.source === "feed") {
    const dismiss = el("button", "ri-dismiss", "\u00D7");
    dismiss.type = "button";
    dismiss.title = "not interested";
    dismiss.setAttribute("aria-label", `Not interested: ${item.title}`);
    dismiss.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dismissItem(item.id);
    });
    head.append(dismiss);
  }
  main.append(head);

  const title = el("p", "ri-title");
  if (isHttpUrl(item.url)) {
    const link = el("a", null, item.title);
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    title.append(link);
  } else {
    title.textContent = item.title;
  }
  main.append(title);

  if (item.notes) {
    main.append(el("p", "ri-thoughts is-clamped", item.notes));
    const more = el("button", "ri-more hidden", "more\u2026");
    more.type = "button";
    more.addEventListener("click", () => {
      const expanded = li.classList.toggle("is-expanded");
      more.textContent = expanded ? "less" : "more\u2026";
      scheduleLayout();
    });
    main.append(more);
  }

  const row = el("div", "ri-row");
  row.append(main);

  if (COVER_TYPES.has(item.mediaType) && item.list === "recommend") {
    const frame = coverWrap(item);
    row.append(frame);
    hydrateCover(frame, item, li);
  }

  li.append(row);
  return li;
}

function finalizeClamps() {
  railsEl.querySelectorAll(".rail-item:not(.is-expanded) .ri-thoughts.is-clamped").forEach((p) => {
    const more = p.parentElement.querySelector(".ri-more");
    if (more) more.classList.toggle("hidden", p.scrollHeight <= p.clientHeight + 1);
  });
}

/* ---------------------------------- rails --------------------------------- */

function buildRail(type, items) {
  const rail = el("section", "rail");
  rail.setAttribute("aria-label", `${KIND_LABELS[type]} entries`);

  const head = el("header", "rail-head");
  head.append(
    el("span", "rail-title", KIND_LABELS[type].toLowerCase()),
    el("span", "rail-count", String(items.length))
  );
  rail.append(head);

  const list = el("ul", "rail-list");
  if (items.length) items.forEach((item) => list.append(buildItem(item)));
  else list.append(el("li", "rail-empty", "nothing here yet"));
  rail.append(list);
  return rail;
}

/* ----------------------------- recommend rail ----------------------------- */

function readSuggestions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SUGGEST_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readDismissed() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...state.dismissed]));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

function dismissItem(id) {
  if (!id) return;
  state.dismissed.add(id);
  persistDismissed();
  render();
}

function persistSuggestions() {
  try {
    localStorage.setItem(SUGGEST_KEY, JSON.stringify(state.suggestions));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

async function sendSuggestion(entry) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/media_suggestions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ media_type: entry.mediaType, title: entry.title, notes: entry.notes || null })
    });
    return response.ok;
  } catch {
    return false;
  }
}

function renderSuggestions() {
  if (!suggestListEl) return;
  suggestListEl.replaceChildren();
  state.suggestions.forEach((s) => suggestListEl.append(buildItem(s)));
  suggestListEl.classList.toggle("hidden", state.suggestions.length === 0);
  if (suggestCountEl) suggestCountEl.textContent = String(state.suggestions.length);
}

function buildField(labelText, control) {
  const label = el("label", "suggest-field");
  label.append(el("span", "suggest-label", labelText), control);
  return label;
}

function buildFormRail() {
  const rail = el("section", "rail rail--form");
  rail.setAttribute("aria-label", "Recommend something");

  const head = el("header", "rail-head");
  head.append(el("span", "rail-title", "recommend me something"));
  suggestCountEl = el("span", "rail-count", "0");
  head.append(suggestCountEl);
  rail.append(head);

  suggestForm = document.createElement("form");
  suggestForm.className = "suggest-form";
  suggestForm.autocomplete = "off";

  const select = document.createElement("select");
  select.className = "suggest-input";
  select.id = "suggestCategory";
  for (const type of MEDIA_TYPES) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = TYPE_LABELS[type];
    select.append(option);
  }

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "suggest-input";
  titleInput.id = "suggestTitle";
  titleInput.placeholder = "title";
  titleInput.maxLength = 200;
  titleInput.required = true;

  const whyInput = document.createElement("textarea");
  whyInput.className = "suggest-input";
  whyInput.id = "suggestWhy";
  whyInput.rows = 3;
  whyInput.placeholder = "why should i read / watch / listen to it?";
  whyInput.maxLength = 500;

  const honeypot = document.createElement("input");
  honeypot.type = "text";
  honeypot.name = "website";
  honeypot.className = "suggest-honeypot";
  honeypot.tabIndex = -1;
  honeypot.autocomplete = "off";
  honeypot.setAttribute("aria-hidden", "true");

  suggestForm.append(
    buildField("category", select),
    buildField("title", titleInput),
    buildField("why", whyInput),
    honeypot
  );

  const row = el("div", "suggest-row");
  const msg = el("span", "suggest-msg");
  suggestErrorEl = el("span", "suggest-error", "");
  suggestStatusEl = el("span", "suggest-status", "");
  msg.append(suggestErrorEl, suggestStatusEl);
  const submit = el("button", "suggest-submit", "recommend");
  submit.type = "submit";
  row.append(msg, submit);
  suggestForm.append(row);

  suggestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (honeypot.value) return;
    const title = titleInput.value.trim();
    if (!title) {
      suggestErrorEl.textContent = "a title is required";
      suggestStatusEl.textContent = "";
      titleInput.focus();
      return;
    }
    suggestErrorEl.textContent = "";
    suggestStatusEl.textContent = "sending\u2026";
    const entry = {
      id: `sug-${Date.now()}`,
      mediaType: select.value,
      title,
      notes: whyInput.value.trim(),
      creator: "recommended",
      list: "recommend"
    };
    state.suggestions.unshift(entry);
    persistSuggestions();
    renderSuggestions();
    suggestForm.reset();
    titleInput.focus();
    const ok = await sendSuggestion(entry);
    suggestStatusEl.textContent = ok ? "sent \u2014 thank you" : "saved locally \u2014 couldn\u2019t reach the server";
  });

  rail.append(suggestForm);

  suggestListEl = el("ul", "rail-list");
  rail.append(suggestListEl);
  return rail;
}

/* --------------------------------- layout --------------------------------- */

function currentGap() {
  return Math.min(GAP_MAX, Math.max(GAP_MIN, window.innerWidth * 0.02));
}

function layout() {
  const width = railsEl.clientWidth;
  if (!width || !railEls.length) return;
  const gap = currentGap();
  const cols = Math.max(1, Math.floor((width + gap) / (MIN_COL + gap)));

  const columns = [];
  railsEl.replaceChildren();
  for (let i = 0; i < cols; i += 1) {
    const node = el("div", "rail-col");
    railsEl.append(node);
    columns.push({ el: node, height: 0 });
  }

  const heights = railEls.map((rail) => {
    columns[0].el.append(rail);
    const h = rail.getBoundingClientRect().height;
    rail.remove();
    return h;
  });

  railEls.forEach((rail, index) => {
    let target = columns[0];
    for (const col of columns) {
      if (col.height < target.height) target = col;
    }
    target.el.append(rail);
    target.height += heights[index] + gap;
  });

  finalizeClamps();
}

let resizeTimer = null;
function scheduleLayout() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layout, 120);
}

/* --------------------------------- toggle --------------------------------- */

function buildToggle() {
  listsEl.replaceChildren();
  listButtons.clear();
  for (const id of LISTS) {
    const button = el("button", "list-button", LIST_LABELS[id]);
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.list === id));
    button.addEventListener("click", () => {
      if (state.list === id) return;
      state.list = id;
      syncToggle();
      render();
    });
    listButtons.set(id, button);
    listsEl.append(button);
  }
}

function syncToggle() {
  for (const [id, button] of listButtons) {
    button.setAttribute("aria-pressed", String(state.list === id));
  }
}

/* --------------------------------- render --------------------------------- */

function render() {
  const query = state.query.trim().toLowerCase();
  const byType = new Map();

  for (const item of ordered(state.items)) {
    if (item.list !== state.list) continue;
    if (state.dismissed.has(item.id)) continue;
    if (!matches(item, query)) continue;
    if (!byType.has(item.mediaType)) byType.set(item.mediaType, []);
    byType.get(item.mediaType).push(item);
  }

  const categoryRails = [];
  for (const type of MEDIA_TYPES) {
    const items = byType.get(type) || [];
    const shown = state.list === "shelf" ? items.slice(0, SHELF_LIMIT) : items;
    categoryRails.push(buildRail(type, shown));
  }

  railEls = [...categoryRails, formRail];
  layout();
}

/* ---------------------------------- init ---------------------------------- */

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  render();
});

window.addEventListener("resize", scheduleLayout);
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => layout());
}

buildToggle();
formRail = buildFormRail();
state.suggestions = readSuggestions();
state.dismissed = new Set(readDismissed());
renderSuggestions();

Promise.all([loadLibrary(), loadFeeds()])
  .then(([library, feeds]) => {
    state.items = [...library, ...feeds];
    render();
  })
  .catch((error) => {
    console.error(error);
    railsEl.replaceChildren();
    railsEl.append(el("p", "notice", error.message));
  });
