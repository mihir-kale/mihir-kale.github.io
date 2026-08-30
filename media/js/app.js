import { loadLibrary, TYPE_LABELS, KIND_LABELS, FILTER_ORDER, COVER_TYPES, STATUS_LABELS } from "./data.js";
import { resolveCover } from "./covers.js";

const MAX_SPOTLIGHTS = 6;
const FADE_OUT_MS = 350;

const grid = document.getElementById("grid");
const shelf = document.getElementById("shelf");
const shelfSection = document.getElementById("shelf-section");
const filtersNav = document.getElementById("filters");
const chipsNav = document.getElementById("chips");
const searchInput = document.getElementById("search");
const sortSelect = document.getElementById("sort");
const archiveCount = document.getElementById("archive-count");

const state = {
  items: [],
  type: "all",
  tags: new Set(),
  query: "",
  sort: "recent"
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

function externalLink(href, label) {
  const link = el("a", null, label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function formatDate(iso) {
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function currentYears(item) {
  const parts = [];
  if (item.year) parts.push(String(item.year));
  if (!item.year && item.consumed) {
    const date = new Date(`${item.consumed}T00:00:00`);
    if (!Number.isNaN(date.getTime())) parts.push(String(date.getFullYear()));
  }
  return parts.join(" \u00b7 ");
}

function stars(rating) {
  const row = el("span", "stars", null);
  row.setAttribute("role", "img");
  row.setAttribute("aria-label", rating ? `${rating} out of 5` : "Not rated");
  if (!rating) {
    row.classList.add("stars--none");
    row.textContent = "Not rated";
    return row;
  }
  for (let i = 1; i <= 5; i += 1) {
    const cell = el("span", "star");
    if (rating >= i - 0.25) {
      cell.textContent = "\u2605";
      if (rating < i - 0.75) cell.classList.add("star--half");
    } else if (rating >= i - 0.75) {
      cell.textContent = "\u2605";
      cell.classList.add("star--half");
    } else {
      cell.textContent = "\u2606";
    }
    row.append(cell);
  }
  return row;
}

function statusBadge(item) {
  return el("span", `status status--${item.status}`, STATUS_LABELS[item.status] || item.status);
}

function typeLabel(item, plural) {
  return plural ? KIND_LABELS[item.mediaType] : TYPE_LABELS[item.mediaType];
}

/* ---------------------------------- display ---------------------------------- */

function buildDisplayCard(item) {
  const card = el("li", "display-card");
  card.dataset.cardId = item.id;

  const icon = el("span", "display-icon");
  icon.textContent = item.mediaType === "album" ? "\u266B" : "";

  const frame = el("button", "display-frame");
  frame.type = "button";
  frame.setAttribute("aria-label", `Spotlight on ${item.title} — scroll to its entry in the archive`);
  const fallback = el("div", "fallback");
  fallback.append(
    icon,
    el("span", "fb-kind", TYPE_LABELS[item.mediaType]),
    el("span", "fb-title", item.title)
  );
  frame.append(fallback);
  frame.addEventListener("click", () => reveal(item.id));

  const caption = el("div", "display-caption");
  const title = el("h3", "display-title");
  if (isHttpUrl(item.url)) {
    title.append(externalLink(item.url, item.title));
  } else {
    title.textContent = item.title;
  }
  caption.append(title);
  const meta = el("p", "display-meta", [item.creator, item.year ? `(${item.year})` : ""].filter(Boolean).join(" ") || typeLabel(item, false));
  caption.append(meta);
  const rating = stars(item.rating);
  if (rating.getAttribute("aria-label") !== "Not rated") caption.append(rating);

  card.append(frame, caption);
  return card;
}

async function hydrateCover(card, item) {
  const frame = card.querySelector(".display-frame");
  const url = await resolveCover(item);
  if (!url || !frame || !frame.isConnected) return;
  const img = new Image();
  img.alt = `${TYPE_LABELS[item.mediaType]} artwork for ${item.title}`;
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    return;
  }
  if (frame.isConnected) frame.replaceChildren(img);
}

function renderDisplay() {
  const featured = state.items.filter((item) => item.spotlight).slice(0, MAX_SPOTLIGHTS);
  if (!featured.length) {
    shelfSection.hidden = true;
    return;
  }
  shelfSection.hidden = false;
  shelf.replaceChildren();
  featured.forEach((item) => {
    const card = buildDisplayCard(item);
    shelf.append(card);
    if (COVER_TYPES.has(item.mediaType)) hydrateCover(card, item);
  });
}

function reveal(id) {
  state.type = "all";
  state.tags.clear();
  state.query = "";
  if (searchInput) searchInput.value = "";
  renderFilters();
  renderChips();
  renderCatalogue();
  window.setTimeout(() => {
    const target = grid.querySelector(`[data-card-id="${CSS.escape(id)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("is-flash");
    window.setTimeout(() => target.classList.remove("is-flash"), 1600);
  }, FADE_OUT_MS + 80);
}

/* ------------------------------- catalogue -------------------------------- */

function filteredItems() {
  const query = state.query.trim().toLowerCase();
  const tags = [...state.tags];
  const list = state.items.filter((item) => {
    if (state.type !== "all" && item.mediaType !== state.type) return false;
    if (tags.length && !tags.every((tag) => item.tags.includes(tag))) return false;
    if (query) {
      const haystack = [item.title, item.creator, item.notes, item.tags.join(" "), item.year]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const consumed = (item) => (item.consumed ? new Date(`${item.consumed}T00:00:00`).getTime() : -Infinity);
  switch (state.sort) {
    case "rated":
      list.sort((a, b) => (b.rating || 0) - (a.rating || 0) || consumed(b) - consumed(a) || a.title.localeCompare(b.title));
      break;
    case "alpha":
      list.sort((a, b) => a.title.localeCompare(b.title));
      break;
    default:
      list.sort(
        (a, b) => consumed(b) - consumed(a) || (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title)
      );
  }
  return list;
}

function buildNotecard(item) {
  const card = el("article", "card notecard");
  card.dataset.cardId = item.id;

  const head = el("header", "notecard-head");
  const kind = el("span", "notecard-kind", typeLabel(item, false));
  if (item.year) kind.append(` \u00b7 ${item.year}`);
  if (item.spotlight) kind.append(el("span", "featured-tag", "\u2726 featured"));
  head.append(kind, statusBadge(item));

  const title = el("h3", "notecard-title");
  if (isHttpUrl(item.url)) {
    title.append(externalLink(item.url, item.title));
  } else {
    title.textContent = item.title;
  }

  const body = el("div", "notecard-body");
  if (item.creator) body.append(el("p", "notecard-creator", item.creator));
  if (item.notes) body.append(el("p", "notecard-notes", item.notes));
  const rating = stars(item.rating);
  if (rating.getAttribute("aria-label") !== "Not rated") body.append(rating);

  const foot = el("footer", "notecard-foot");
  if (item.tags.length) {
    const tagList = el("ul", "tags");
    item.tags.forEach((tag) => {
      const li = el("li");
      const button = el("button", "tag", `#${tag}`);
      button.type = "button";
      button.setAttribute("aria-label", `Filter the archive by ${tag}`);
      button.dataset.tag = tag;
      button.addEventListener("click", () => {
        state.tags = new Set([tag]);
        activateTag(tag);
        renderChips();
        renderCatalogue();
      });
      li.append(button);
      tagList.append(li);
    });
    foot.append(tagList);
  }
  const consumed = formatDate(item.consumed);
  if (consumed) foot.append(el("time", "notecard-consumed", `Consumed ${consumed}`));

  card.append(head, title, body, foot);
  return card;
}

function renderFiltered(animate) {
  const build = () => {
    const list = filteredItems();
    archiveCount.textContent = list.length === 1 ? "1 entry" : `${list.length} entries`;
    grid.replaceChildren();
    if (!list.length) {
      grid.append(el("p", "notice", "Nothing here yet. Try widening the filters."));
      return;
    }
    list.forEach((item, i) => {
      const card = buildNotecard(item);
      card.style.setProperty("--stagger", Math.min(i, 10));
      grid.append(card);
    });
    layoutBoard();
    grid.classList.remove("is-fading");
  };

  if (!animate) {
    build();
    return;
  }
  grid.classList.add("is-fading");
  window.setTimeout(build, FADE_OUT_MS);
}

/* ------------------------------ control chrome ------------------------------ */

function renderFilters() {
  filtersNav.replaceChildren();
  for (const id of FILTER_ORDER) {
    const count =
      id === "all"
        ? state.items.length
        : state.items.filter((item) => item.mediaType === id).length;
    const button = el("button", "filter-button");
    button.type = "button";
    button.dataset.filter = id;
    button.setAttribute("aria-pressed", String(id === state.type));
    button.append(
      el("span", "filter-label", id === "all" ? "All" : KIND_LABELS[id]),
      el("span", "filter-count", String(count))
    );
    button.addEventListener("click", () => {
      if (id === state.type) return;
      state.type = id;
      renderFilters();
      renderCatalogue();
    });
    filtersNav.append(button);
  }
}

function tagCounts() {
  const counts = new Map();
  state.items.forEach((item) => item.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function activateTag(tag) {
  if (state.tags.has(tag)) {
    state.tags.delete(tag);
  } else {
    state.tags.add(tag);
  }
}

function renderChips() {
  chipsNav.replaceChildren();
  const counts = tagCounts();
  if (!counts.length) return;
  counts.forEach(([tag, count]) => {
    const button = el("button", "chip");
    button.type = "button";
    button.dataset.tag = tag;
    button.setAttribute("aria-pressed", String(state.tags.has(tag)));
    button.append(el("span", "chip-label", `#${tag}`), el("span", "chip-count", String(count)));
    button.addEventListener("click", () => {
      activateTag(tag);
      renderChips();
      renderCatalogue();
    });
    chipsNav.append(button);
  });
}

function renderCatalogue() {
  renderFiltered(true);
}

/* --------------------------------- masonry --------------------------------- */

function boardMetrics() {
  const rootStyle = getComputedStyle(document.documentElement);
  const gapX = parseFloat(rootStyle.getPropertyValue("--gap-x")) || 0;
  const gapY = parseFloat(rootStyle.getPropertyValue("--gap-y")) || 0;
  const cardW = parseFloat(rootStyle.getPropertyValue("--card-w")) || 300;
  const parent = grid.parentElement;
  const parentStyle = getComputedStyle(parent);
  const avail = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
  let cols = Math.floor((avail + gapX) / (cardW + gapX));
  if (cols < 1) cols = 1;
  return { cardW: Math.min(cardW, avail), gapX, gapY, cols };
}

function layoutBoard() {
  const cards = [...grid.children].filter((node) => node.classList && node.classList.contains("card"));
  if (!cards.length) {
    grid.style.width = "";
    grid.style.height = "";
    return;
  }
  const { cardW, gapX, gapY, cols } = boardMetrics();
  cards.forEach((card) => {
    card.style.width = `${cardW}px`;
  });
  const columnHeights = new Array(cols).fill(0);
  cards.forEach((card) => {
    let column = 0;
    for (let i = 1; i < cols; i += 1) {
      if (columnHeights[i] < columnHeights[column]) column = i;
    }
    card.style.left = `${column * (cardW + gapX)}px`;
    card.style.top = `${columnHeights[column]}px`;
    columnHeights[column] += card.offsetHeight + gapY;
  });
  grid.style.width = `${cols * cardW + (cols - 1) * gapX}px`;
  grid.style.height = `${Math.max(...columnHeights) - gapY}px`;
}

let layoutTimer = null;
function scheduleLayout() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(layoutBoard, 120);
}

/* ----------------------------------- init ----------------------------------- */

function initChrome() {
  const updated = document.getElementById("archived-date");
  if (updated) {
    updated.textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
  }
  const year = document.getElementById("colophon-year");
  if (year) year.textContent = String(new Date().getFullYear());
  const shelfTitle = document.getElementById("shelf-count");
  if (shelfTitle && state.items.length) {
    const featured = state.items.filter((item) => item.spotlight).length;
    shelfTitle.textContent = `Showing ${Math.min(featured, MAX_SPOTLIGHTS)} of ${featured}`;
  }
}

function showError(message) {
  grid.replaceChildren();
  const notice = el("section", "notice");
  notice.append(
    el("h2", null, "Catalogue unavailable"),
    el("p", null, message),
    el(
      "p",
      "fine",
      "If you opened index.html directly from disk, serve the folder instead: python3 -m http.server 8000, then visit http://localhost:8000."
    )
  );
  grid.append(notice);
}

if (searchInput) {
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    renderCatalogue();
  });
}
if (sortSelect) {
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    renderCatalogue();
  });
}

window.addEventListener("resize", scheduleLayout);
if (document.fonts) {
  document.fonts.ready.then(layoutBoard);
  document.fonts.addEventListener("loadingdone", layoutBoard);
}

initChrome();
loadLibrary()
  .then((items) => {
    state.items = items;
    renderDisplay();
    renderFilters();
    renderChips();
    renderFiltered({ animate: false });
  })
  .catch((error) => {
    console.error(error);
    showError(error.message);
  });