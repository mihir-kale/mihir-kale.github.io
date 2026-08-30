import { loadLibrary, TYPE_LABELS, KIND_LABELS, FILTER_ORDER, COVER_TYPES } from "./data.js";
import { resolveCover } from "./covers.js";

const board = document.getElementById("board");
const filtersNav = document.getElementById("filters");
const searchInput = document.getElementById("search");
const totalCount = document.getElementById("total-count");

const state = { items: [], type: "all", query: "" };

const STATUS_GLYPHS = { "in-progress": "\u25CF", backlog: "\u25CB" };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

function tileWrap(item, className) {
  const linked = isHttpUrl(item.url);
  const node = document.createElement(linked ? "a" : "figure");
  node.className = className;
  if (linked) {
    node.href = item.url;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    node.setAttribute("aria-label", `${item.title} — opens in a new tab`);
  }
  return node;
}

function dots(rating) {
  if (!rating) return null;
  const wrap = el("span", "dots");
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", `${rating} of 5`);
  for (let i = 1; i <= 5; i += 1) {
    const dot = el("span", "dot");
    if (rating >= i - 0.25) {
      // full
    } else if (rating >= i - 0.75) {
      dot.classList.add("dot--half");
    } else {
      dot.classList.add("dot--off");
    }
    wrap.append(dot);
  }
  return wrap;
}

function buildTextTile(item) {
  const tile = tileWrap(item, "tile tile--text");

  const top = el("div", "tile-top");
  top.append(el("span", "tile-code", TYPE_LABELS[item.mediaType]));
  if (STATUS_GLYPHS[item.status]) {
    top.append(el("span", `tile-status tile-status--${item.status}`, STATUS_GLYPHS[item.status]));
  }

  const title = el("p", "tile-title", item.title);
  tile.title = `${item.title}${item.creator ? ` — ${item.creator}` : ""}`;

  const bottom = el("div", "tile-bottom");
  const rating = dots(item.rating);
  if (rating) bottom.append(rating);
  if (item.year) bottom.append(el("span", "tile-year", String(item.year)));

  tile.append(top, title, bottom);
  return tile;
}

function buildImageTile(item) {
  const tile = tileWrap(item, "tile tile--image");
  tile.title = `${item.title}${item.creator ? ` — ${item.creator}` : ""}`;

  const frame = el("div", "tile-frame");
  const fallback = el("div", "fallback");
  fallback.append(
    el("span", "fb-kind", TYPE_LABELS[item.mediaType]),
    el("span", "fb-title", item.title)
  );
  frame.append(fallback);

  const caption = el("div", "tile-caption");
  caption.append(el("span", "cap-title", item.title));
  const rating = dots(item.rating);
  if (rating) caption.append(rating);
  caption.classList.toggle("is-pinned", item.status === "in-progress");

  tile.append(frame, caption);
  hydrateCover(frame, item);
  return tile;
}

async function hydrateCover(frame, item) {
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

function consumed(item) {
  return item.consumed ? new Date(`${item.consumed}T00:00:00`).getTime() : -Infinity;
}

function orderedItems() {
  return [...state.items].sort(
    (a, b) =>
      Number(b.spotlight) - Number(a.spotlight) ||
      consumed(b) - consumed(a) ||
      (b.year || 0) - (a.year || 0) ||
      a.title.localeCompare(b.title)
  );
}

function visibleItems() {
  const query = state.query.trim().toLowerCase();
  return orderedItems().filter((item) => {
    if (state.type !== "all" && item.mediaType !== state.type) return false;
    if (query) {
      const haystack = [item.title, item.creator, item.tags.join(" "), item.year]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function renderBoard() {
  const list = visibleItems();
  if (totalCount) {
    totalCount.textContent = String(list.length);
  }
  board.replaceChildren();
  if (!list.length) {
    board.append(el("p", "notice", "nothing here — widen the filters"));
    return;
  }
  list.forEach((item) => {
    const image = item.spotlight && COVER_TYPES.has(item.mediaType);
    board.append(image ? buildImageTile(item) : buildTextTile(item));
  });
}

function renderFilters() {
  filtersNav.replaceChildren();
  for (const id of FILTER_ORDER) {
    const count =
      id === "all" ? state.items.length : state.items.filter((item) => item.mediaType === id).length;
    const button = el("button", "filter-button");
    button.type = "button";
    button.dataset.filter = id;
    button.setAttribute("aria-pressed", String(id === state.type));
    button.append(
      el("span", "filter-label", id === "all" ? "all" : KIND_LABELS[id].toLowerCase()),
      el("sup", "filter-count", String(count))
    );
    button.addEventListener("click", () => {
      if (id === state.type) return;
      state.type = id;
      renderFilters();
      renderBoard();
    });
    filtersNav.append(button);
  }
}

function showError(message) {
  board.replaceChildren();
  const notice = el("p", "notice");
  notice.textContent = message;
  board.append(notice);
}

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  renderBoard();
});

loadLibrary()
  .then((items) => {
    state.items = items;
    renderFilters();
    renderBoard();
  })
  .catch((error) => {
    console.error(error);
    showError(error.message);
  });