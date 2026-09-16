// Reading rail — latest articles from selected RSS feeds.
// Fetched via the feeds-proxy edge function (browser CORS blocks direct RSS
// reads); data/read-feeds.json is the committed offline cache fallback.
const SUPABASE_URL = "https://gzwhuwzmrrmtswyhjheu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6d2h1d3ptcnJtdHN3eWhqaGV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NDQ1OTUsImV4cCI6MjEwNDIyMDU5NX0.vARmLV7ttdkTXz45IDUydwEENxFFY4d3PsI1kct08_E";

const FEED_SOURCES = ["The Atlantic", "The New Yorker", "Wired", "The Yale Review"];
const LIST_MAX = 60;

const listEl = document.getElementById("readsList");
const filtersEl = document.getElementById("readsFilters");
const statusEl = document.getElementById("readsStatus");
const countEl = document.getElementById("readsCount");
const refreshBtn = document.getElementById("readsRefresh");

let articles = [];
let source = "all";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtUpdated(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function visibleList() {
  const list = source === "all" ? articles : articles.filter((a) => a.source === source);
  return list.slice(0, LIST_MAX);
}

function renderList() {
  const list = visibleList();
  listEl.replaceChildren();
  if (!list.length) {
    listEl.append(el("li", "reading-empty", "No articles yet"));
    return;
  }
  for (const a of list) {
    const li = el("li", "reading-item");
    const link = el("a");
    link.href = a.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.append(el("span", "ri-src", a.source || ""));
    link.append(el("p", "ri-title", a.title));
    const date = fmtDate(a.date);
    if (date) link.append(el("span", "ri-date", date));
    li.append(link);
    listEl.append(li);
  }
}

function renderFilters() {
  filtersEl.replaceChildren();
  const visible = (src) => (src === "all" ? articles : articles.filter((a) => a.source === src));
  const options = [["all", "all"], ...FEED_SOURCES.filter((s) => articles.some((a) => a.source === s)).map((s) => [s, s])];
  for (const [label, key] of options) {
    const btn = el("button", null, `${label} ${visible(key).length}`);
    btn.setAttribute("aria-pressed", String(source === key));
    btn.addEventListener("click", () => {
      source = key;
      renderFilters();
      renderList();
    });
    filtersEl.append(btn);
  }
}

function render(updatedText) {
  renderFilters();
  renderList();
  countEl.textContent = String(articles.length);
  if (articles.length) statusEl.textContent = updatedText;
}

async function loadCache() {
  try {
    const r = await fetch("data/read-feeds.json");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const body = await r.json();
    if (!Array.isArray(body.articles) || !body.articles.length) return;
    articles = body.articles;
    render("cached " + fmtUpdated(body.last_updated));
  } catch (e) {
    /* live proxy fetch is the fallback */
  }
}

async function loadLive() {
  refreshBtn.classList.add("is-spinning");
  try {
    const r = await fetch(SUPABASE_URL + "/functions/v1/feeds-proxy", {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " },
    });
    if (!r.ok) throw new Error("feeds proxy HTTP " + r.status);
    const body = await r.json();
    if (!Array.isArray(body.articles)) throw new Error("bad feeds payload");
    articles = body.articles;
    render("live " + fmtUpdated(body.last_updated));
  } catch (e) {
    if (!articles.length) render("");
    else statusEl.textContent = "feed offline — cached";
  } finally {
    refreshBtn.classList.remove("is-spinning");
  }
}

refreshBtn.addEventListener("click", loadLive);
loadCache();
loadLive();