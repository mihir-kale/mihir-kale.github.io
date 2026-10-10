import { loadLibrary, MEDIA_TYPES, TYPE_LABELS, KIND_LABELS } from "./data.js";

const searchInput = document.getElementById("search");
const railsEl = document.getElementById("rails");
const emptyNotice = document.getElementById("emptyNotice");
const totalCount = document.getElementById("total-count");

const state = { items: [], query: "" };

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

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

  const foot = el("div", "ri-foot");
  const meta = [item.year ? String(item.year) : "", item.consumed ? fmtDate(item.consumed) : ""].filter(Boolean);
  if (meta.length) foot.append(el("span", "ri-meta", meta.join(" · ")));
  const rating = dots(item.rating);
  if (rating) foot.append(rating);
  if (foot.childNodes.length) link.append(foot);

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

function render() {
  const query = state.query.trim().toLowerCase();
  const counts = {};
  let total = 0;
  const byType = new Map();

  for (const item of ordered(state.items)) {
    if (!matches(item, query)) continue;
    counts[item.mediaType] = (counts[item.mediaType] || 0) + 1;
    if (!byType.has(item.mediaType)) byType.set(item.mediaType, []);
    byType.get(item.mediaType).push(item);
    total += 1;
  }

  railsEl.replaceChildren();
  for (const type of MEDIA_TYPES) {
    const items = byType.get(type);
    if (items && items.length) railsEl.append(buildRail(type, items));
  }

  emptyNotice.classList.toggle("hidden", total > 0);
}

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  render();
});

loadLibrary()
  .then((items) => {
    state.items = items;
    if (totalCount) totalCount.textContent = String(items.length);
    render();
  })
  .catch((error) => {
    console.error(error);
    railsEl.replaceChildren();
    emptyNotice.textContent = error.message;
    emptyNotice.classList.remove("hidden");
  });
