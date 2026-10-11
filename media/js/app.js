import { loadEntries, loadFeeds, loadMarks, loadSuggestions, saveEntry, deleteEntry, normalizeItem, SUPABASE_URL, SUPABASE_ANON_KEY, MEDIA_TYPES, TYPE_LABELS, KIND_LABELS, LISTS, LIST_LABELS, COVER_TYPES } from "./data.js?v=20261012";
import { resolveCover } from "./covers.js?v=20261012";
import { signIn, signOut, getSession } from "./auth.js?v=20261012";

const searchInput = document.getElementById("search");
const listsEl = document.getElementById("lists");
const railsEl = document.getElementById("rails");
const authEl = document.getElementById("auth");

const DISMISS_KEY = "media:dismissed:v1";
const PROMOTE_KEY = "media:promoted:v1";

// Curated entries (media_entries) and shelf marks (media_marks) live in
// Supabase; the RSS shelf stays a generated JSON file. Both keys are public and
// RLS-protected (anon read; owner writes entries; the board writes its marks).
const REST = `${SUPABASE_URL}/rest/v1`;
const WRITE_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json"
};

const state = { items: [], query: "", list: "recommend", suggestions: [], dismissed: new Set(), promoted: new Set(), session: null };
const listButtons = new Map();

const STATUS_GLYPHS = { "in-progress": "\u25CF", backlog: "\u25CB" };

const SHELF_LIMIT = 5;
const MIN_COL = 280;
const GAP_MIN = 14;
const GAP_MAX = 22;

let railEls = [];
let formRail = null;
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

  const list = effectiveList(item);
  const actions = el("span", "ri-actions");
  if (item.source === "feed") {
    const checked = state.promoted.has(item.id);
    const box = el("input", "ri-check");
    box.type = "checkbox";
    box.checked = checked;
    box.title = checked ? "move back to shelf" : "save to my recommendations";
    box.setAttribute("aria-label", `Save "${item.title}" to my recommendations`);
    box.addEventListener("change", () => promoteItem(item.id));
    actions.append(box);
    if (list === "shelf") {
      const dismiss = el("button", "ri-dismiss", "\u00D7");
      dismiss.type = "button";
      dismiss.title = "not interested";
      dismiss.setAttribute("aria-label", `Not interested: ${item.title}`);
      dismiss.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        dismissItem(item.id);
      });
      actions.append(dismiss);
    }
  }
  if (state.session && item.source !== "feed" && item.source !== "suggestion") {
    const edit = el("button", "ri-edit", "edit");
    edit.type = "button";
    edit.title = "edit entry";
    edit.setAttribute("aria-label", `Edit ${item.title}`);
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openEditor(item);
    });
    const del = el("button", "ri-del", "del");
    del.type = "button";
    del.title = "delete entry";
    del.setAttribute("aria-label", `Delete ${item.title}`);
    del.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      deleteEntryPrompt(item);
    });
    actions.append(edit, del);
  }
  if (actions.childElementCount) head.append(actions);
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

  if (COVER_TYPES.has(item.mediaType) && list === "recommend") {
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

function pushMark(id) {
  const body = {
    item_id: id,
    dismissed: state.dismissed.has(id),
    promoted: state.promoted.has(id),
    updated_at: new Date().toISOString()
  };
  return fetch(`${REST}/media_marks?on_conflict=item_id`, {
    method: "POST",
    headers: { ...WRITE_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body)
  }).catch(() => null);
}

function dismissItem(id) {
  if (!id) return;
  state.dismissed.add(id);
  persistDismissed();
  pushMark(id);
  render();
}

function readPromoted() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROMOTE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistPromoted() {
  try {
    localStorage.setItem(PROMOTE_KEY, JSON.stringify([...state.promoted]));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

function promoteItem(id) {
  if (!id) return;
  if (state.promoted.has(id)) state.promoted.delete(id);
  else state.promoted.add(id);
  persistPromoted();
  pushMark(id);
  render();
}

function effectiveList(item) {
  if (item.source === "feed" && state.promoted.has(item.id)) return "recommend";
  return item.list;
}

async function sendSuggestion(entry) {
  try {
    const response = await fetch(`${REST}/media_suggestions`, {
      method: "POST",
      headers: { ...WRITE_HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify({ media_type: entry.mediaType, title: entry.title, notes: entry.notes || null })
    });
    return response.ok;
  } catch {
    return false;
  }
}

function buildField(labelText, control, fieldClass = "suggest-field", labelClass = "suggest-label") {
  const label = el("label", fieldClass);
  label.append(el("span", labelClass, labelText), control);
  return label;
}

function makeInput(placeholder, type, required) {
  const node = document.createElement("input");
  node.className = "editor-input";
  node.type = type || "text";
  if (placeholder) node.placeholder = placeholder;
  if (required) node.required = true;
  return node;
}

function makeTextarea(placeholder) {
  const node = document.createElement("textarea");
  node.className = "editor-input";
  node.rows = 3;
  if (placeholder) node.placeholder = placeholder;
  return node;
}

function makeSelect(entries) {
  const node = document.createElement("select");
  node.className = "editor-input";
  for (const [value, label] of entries) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    node.append(option);
  }
  return node;
}

function genId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildFormRail() {
  const rail = el("section", "rail rail--form");
  rail.setAttribute("aria-label", "Recommend something");

  const head = el("header", "rail-head");
  head.append(el("span", "rail-title", "recommend me something"));
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
      mediaType: select.value,
      title,
      notes: whyInput.value.trim()
    };
    suggestForm.reset();
    titleInput.focus();
    const ok = await sendSuggestion(entry);
    suggestStatusEl.textContent = ok ? "sent \u2014 thank you" : "couldn\u2019t reach the server \u2014 try again";
    if (ok && state.session) {
      state.suggestions = await loadSuggestions(state.session.accessToken);
      render();
    }
  });

  rail.append(suggestForm);
  return rail;
}

/* ---------------------------------- auth ---------------------------------- */

let authDialog = null;
let authForm = null;
let authEmail = null;
let authPassword = null;
let authError = null;
let authSubmit = null;

function buildAuthDialog() {
  authDialog = el("dialog", "auth-dialog");
  authDialog.setAttribute("aria-label", "Sign in");

  authForm = el("form", "auth-form");

  authEmail = makeInput("email", "email", true);
  authEmail.className = "auth-input";
  authEmail.autocomplete = "username";

  authPassword = makeInput("password", "password", true);
  authPassword.className = "auth-input";
  authPassword.autocomplete = "current-password";

  authError = el("p", "auth-error", "");

  const cancel = el("button", "auth-cancel", "cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => authDialog.close());
  authSubmit = el("button", "auth-submit", "sign in");
  authSubmit.type = "submit";

  const row = el("div", "auth-row");
  row.append(cancel, authSubmit);

  authForm.append(
    el("p", "auth-title", "sign in"),
    buildField("email", authEmail, "auth-field", "auth-label"),
    buildField("password", authPassword, "auth-field", "auth-label"),
    authError,
    row
  );

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authError.textContent = "";
    authSubmit.disabled = true;
    authSubmit.textContent = "\u2026";
    try {
      state.session = await signIn(authEmail.value.trim(), authPassword.value);
      authDialog.close();
      authForm.reset();
      state.suggestions = await loadSuggestions(state.session.accessToken);
      buildAuth();
      render();
    } catch (error) {
      authError.textContent = error.message;
    } finally {
      authSubmit.disabled = false;
      authSubmit.textContent = "sign in";
    }
  });

  authDialog.append(authForm);
  document.body.append(authDialog);
}

function buildAuth() {
  if (!authEl) return;
  authEl.replaceChildren();
  if (state.session) {
    authEl.append(el("span", "auth-email", state.session.email || "signed in"));
    const add = el("button", "auth-btn", "+ new");
    add.type = "button";
    add.title = "add an entry";
    add.addEventListener("click", () => openEditor(null));
    const out = el("button", "auth-btn", "sign out");
    out.type = "button";
    out.addEventListener("click", async () => {
      await signOut();
      state.session = null;
      state.suggestions = [];
      buildAuth();
      render();
    });
    authEl.append(add, out);
  } else {
    const signin = el("button", "auth-btn", "sign in");
    signin.type = "button";
    signin.addEventListener("click", () => {
      authError.textContent = "";
      authDialog.showModal();
      authEmail.focus();
    });
    authEl.append(signin);
  }
}

/* --------------------------------- editor --------------------------------- */

let editorDialog = null;
let editorForm = null;
let editorError = null;
let editorTitleEl = null;
let editorSubmit = null;
let editorDelete = null;
let editorFields = null;
let editorEditing = null;

function buildEditor() {
  editorDialog = el("dialog", "editor-dialog");
  editorDialog.setAttribute("aria-label", "Edit entry");
  editorForm = el("form", "editor-form");

  const mediaType = makeSelect(MEDIA_TYPES.map((t) => [t, TYPE_LABELS[t]]));
  const title = makeInput("title", "text", true);
  const creator = makeInput("creator");
  const year = makeInput("year", "number");
  const status = makeSelect([
    ["finished", "consumed"],
    ["in-progress", "in progress"],
    ["backlog", "on the list"]
  ]);
  const consumed = makeInput("", "date");
  const url = makeInput("url", "url");
  const tags = makeInput("tags (comma separated)");
  const notes = makeTextarea("notes");
  const list = makeSelect(LISTS.map((id) => [id, LIST_LABELS[id]]));

  const spotlight = document.createElement("input");
  spotlight.type = "checkbox";

  editorFields = { mediaType, title, creator, year, status, consumed, url, tags, notes, list, spotlight };
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
    buildField("url", url, "editor-field editor-span", "editor-label"),
    buildField("tags", tags, "editor-field editor-span", "editor-label"),
    buildField("notes", notes, "editor-field editor-span", "editor-label")
  );

  const check = el("label", "editor-check");
  check.append(spotlight, el("span", null, "spotlight (pin to top)"));

  editorError = el("p", "editor-error", "");
  editorTitleEl = el("p", "editor-title", "new entry");

  const cancel = el("button", "editor-cancel", "cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => editorDialog.close());
  editorDelete = el("button", "editor-delete hidden", "delete");
  editorDelete.type = "button";
  editorDelete.addEventListener("click", () => deleteEntryPrompt(editorEditing));
  editorSubmit = el("button", "editor-submit", "add");
  editorSubmit.type = "submit";

  const row = el("div", "editor-row");
  row.append(editorDelete, cancel, editorSubmit);

  editorForm.append(editorTitleEl, grid, check, editorError, row);

  editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
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
      source: editorEditing ? editorEditing.source : "manual"
    };
    let item;
    try {
      item = normalizeItem(raw);
    } catch (error) {
      editorError.textContent = error.message;
      return;
    }
    const session = await getSession();
    if (!session) {
      editorError.textContent = "session expired \u2014 sign in again";
      return;
    }
    editorSubmit.disabled = true;
    try {
      await saveEntry(item, session.accessToken);
    } catch (error) {
      editorError.textContent = error.message;
      editorSubmit.disabled = false;
      return;
    }
    editorSubmit.disabled = false;
    const index = state.items.findIndex((x) => x.id === item.id);
    if (index >= 0) state.items[index] = item;
    else state.items.unshift(item);
    editorDialog.close();
    render();
  });

  editorDialog.append(editorForm);
  document.body.append(editorDialog);
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
  f.list.value = item ? item.list : state.list;
  editorDelete.classList.toggle("hidden", !item);
  editorTitleEl.textContent = item ? "edit entry" : "new entry";
  editorSubmit.textContent = item ? "save" : "add";
  editorDialog.showModal();
  f.title.focus();
}

function removeEntry(id) {
  state.items = state.items.filter((x) => x.id !== id);
  state.dismissed.delete(id);
  state.promoted.delete(id);
}

async function deleteEntryPrompt(item) {
  if (!item) return;
  if (!window.confirm(`delete \u201C${item.title}\u201D?`)) return;
  const session = await getSession();
  if (!session) {
    window.alert("session expired \u2014 sign in again");
    return;
  }
  try {
    await deleteEntry(item.id, session.accessToken);
  } catch (error) {
    window.alert(error.message);
    return;
  }
  removeEntry(item.id);
  if (editorDialog.open) editorDialog.close();
  render();
}

/* --------------------------------- layout --------------------------------- */

function currentGap() {
  return Math.min(GAP_MAX, Math.max(GAP_MIN, window.innerWidth * 0.02));
}

function layout() {
  const width = railsEl.clientWidth;
  if (!width || !railEls.length) return;
  const gap = currentGap();
  const cols = Math.min(4, Math.max(1, Math.floor((width + gap) / (MIN_COL + gap))));

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
  const pool = state.suggestions.length ? state.items.concat(state.suggestions) : state.items;

  for (const item of ordered(pool)) {
    if (effectiveList(item) !== state.list) continue;
    if (state.dismissed.has(item.id)) continue;
    if (!matches(item, query)) continue;
    if (!byType.has(item.mediaType)) byType.set(item.mediaType, []);
    byType.get(item.mediaType).push(item);
  }

  const categoryRails = [];
  for (const type of MEDIA_TYPES) {
    const items = byType.get(type) || [];
    let shown = items;
    if (state.list === "shelf") {
      // Incoming recommendations stay pinned above the shelf cap so they are
      // never pushed out by feed items.
      const incoming = items.filter((item) => item.source === "suggestion");
      const rest = items.filter((item) => item.source !== "suggestion");
      shown = [...incoming, ...rest.slice(0, SHELF_LIMIT)];
    }
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
buildAuthDialog();
buildEditor();
buildAuth();
state.dismissed = new Set(readDismissed());
state.promoted = new Set(readPromoted());

getSession().then(async (session) => {
  state.session = session;
  buildAuth();
  if (session) state.suggestions = await loadSuggestions(session.accessToken);
  render();
});

Promise.all([loadEntries(), loadFeeds(), loadMarks()])
  .then(([entries, feeds, marks]) => {
    state.items = [...entries, ...feeds];
    if (marks) {
      // The backend is authoritative once it answers; cache it locally.
      state.dismissed = new Set(marks.filter((m) => m.dismissed).map((m) => m.item_id));
      state.promoted = new Set(marks.filter((m) => m.promoted).map((m) => m.item_id));
      persistDismissed();
      persistPromoted();
    }
    render();
  })
  .catch((error) => {
    console.error(error);
    railsEl.replaceChildren();
    railsEl.append(el("p", "notice", error.message));
  });
