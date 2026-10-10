import { loadLibrary, MEDIA_TYPES, TYPE_LABELS, KIND_LABELS, LISTS, LIST_LABELS } from "./data.js";

const searchInput = document.getElementById("search");
const listsEl = document.getElementById("lists");
const railsEl = document.getElementById("rails");
const emptyNotice = document.getElementById("emptyNotice");

const SUGGEST_KEY = "media:suggestions:v1";

const state = { items: [], query: "", list: "recommend", suggestions: [] };
const listButtons = new Map();

const STATUS_GLYPHS = { "in-progress": "\u25CF", backlog: "\u25CB" };

const MIN_COL = 280;
const GAP_MIN = 14;
const GAP_MAX = 22;

let railEls = [];
let formRail = null;
let suggestListEl = null;
let suggestCountEl = null;
let suggestErrorEl = null;
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

function buildItem(item) {
  const li = el("li", `rail-item rail-item--${item.mediaType}`);
  if (item.status) li.classList.add(`is-${item.status}`);

  const linked = isHttpUrl(item.url);
  const link = document.createElement(linked ? "a" : "div");
  link.className = "rail-link";
  if (linked) {
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  const head = el("div", "ri-head");
  const kicker = item.creator || TYPE_LABELS[item.mediaType];
  head.append(el("span", "ri-src", kicker));
  if (STATUS_GLYPHS[item.status]) {
    head.append(el("span", `ri-status ri-status--${item.status}`, STATUS_GLYPHS[item.status]));
  }
  link.append(head);

  link.append(el("p", "ri-title", item.title));
  if (item.notes) link.append(el("p", "ri-thoughts", item.notes));

  li.append(link);
  return li;
}

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
  items.forEach((item) => list.append(buildItem(item)));
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

function persistSuggestions() {
  try {
    localStorage.setItem(SUGGEST_KEY, JSON.stringify(state.suggestions));
  } catch {
    /* storage unavailable — keep in-memory only */
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

  suggestForm.append(
    buildField("category", select),
    buildField("title", titleInput),
    buildField("why", whyInput)
  );

  const row = el("div", "suggest-row");
  suggestErrorEl = el("span", "suggest-error", "");
  const submit = el("button", "suggest-submit", "recommend");
  submit.type = "submit";
  row.append(suggestErrorEl, submit);
  suggestForm.append(row);

  suggestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      suggestErrorEl.textContent = "a title is required";
      titleInput.focus();
      return;
    }
    suggestErrorEl.textContent = "";
    state.suggestions.unshift({
      id: `sug-${Date.now()}`,
      mediaType: select.value,
      title,
      notes: whyInput.value.trim(),
      creator: "recommended"
    });
    persistSuggestions();
    renderSuggestions();
    suggestForm.reset();
    titleInput.focus();
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
    if (!matches(item, query)) continue;
    if (!byType.has(item.mediaType)) byType.set(item.mediaType, []);
    byType.get(item.mediaType).push(item);
  }

  const categoryRails = [];
  for (const type of MEDIA_TYPES) {
    const items = byType.get(type);
    if (items && items.length) categoryRails.push(buildRail(type, items));
  }

  const total = categoryRails.reduce((sum, rail) => sum + rail.querySelectorAll(".rail-item").length, 0);
  emptyNotice.classList.toggle("hidden", total > 0);

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
renderSuggestions();

loadLibrary()
  .then((items) => {
    state.items = items;
    render();
  })
  .catch((error) => {
    console.error(error);
    railsEl.replaceChildren();
    emptyNotice.textContent = error.message;
    emptyNotice.classList.remove("hidden");
  });
