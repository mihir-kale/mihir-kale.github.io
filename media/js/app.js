import { loadLibrary, TYPE_LABELS } from "./data.js";

const searchInput = document.getElementById("search");
const railList = document.getElementById("railList");
const railCount = document.getElementById("railCount");
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
  if (!query) return orderedItems();
  return orderedItems().filter((item) => {
    const haystack = [item.title, item.creator, item.tags.join(" "), item.year, TYPE_LABELS[item.mediaType]]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
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
  head.append(el("span", "ri-src", TYPE_LABELS[item.mediaType]));
  if (STATUS_GLYPHS[item.status]) {
    head.append(el("span", `ri-status ri-status--${item.status}`, STATUS_GLYPHS[item.status]));
  }
  link.append(head);

  link.append(el("p", "ri-title", item.title));
  if (item.notes) link.append(el("p", "ri-thoughts", item.notes));

  const foot = el("div", "ri-foot");
  const meta = [item.creator, item.year ? String(item.year) : "", item.consumed ? fmtDate(item.consumed) : ""]
    .filter(Boolean);
  if (meta.length) foot.append(el("span", "ri-meta", meta.join(" · ")));
  const rating = dots(item.rating);
  if (rating) foot.append(rating);
  if (foot.childNodes.length) link.append(foot);

  li.append(link);
  return li;
}

function render() {
  const list = visibleItems();
  railCount.textContent = String(list.length);
  railList.replaceChildren();
  if (!list.length) {
    railList.append(el("li", "rail-empty", "nothing here — try another search"));
    return;
  }
  list.forEach((item) => railList.append(buildItem(item)));
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
    railList.replaceChildren();
    railList.append(el("li", "rail-empty", error.message));
  });
