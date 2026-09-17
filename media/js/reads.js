// Reading rail — "stack" (recommended/unread) vs "read" articles.
// Three sources merge into one list:
//   - feedArticles: live feed fetch via the feeds-proxy edge function (browser
//     CORS blocks direct RSS reads), seeded from data/read-feeds.json offline.
//   - marks (reading_marks): per-URL stack/read state for feed articles, so a
//     read flag survives feed refreshes.
//   - manualItems (reading_items): entries Mihir adds with title/link/thoughts.
// The rail is public; edits require signing in (same Supabase account as the
// dashboard).
const SUPABASE_URL = "https://gzwhuwzmrrmtswyhjheu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6d2h1d3ptcnJtdHN3eWhqaGV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NDQ1OTUsImV4cCI6MjEwNDIyMDU5NX0.vARmLV7ttdkTXz45IDUydwEENxFFY4d3PsI1kct08_E";

const LIST_MAX = 60;

const listEl = document.getElementById("readsList");
const filtersEl = document.getElementById("readsFilters");
const statusEl = document.getElementById("readsStatus");
const countEl = document.getElementById("readsCount");
const refreshBtn = document.getElementById("readsRefresh");
const entryEl = document.getElementById("readsEntry");
const addForm = document.getElementById("addForm");
const addErrorEl = document.getElementById("addError");
const signInBtn = document.getElementById("mediaSignInBtn");
const signOutBtn = document.getElementById("mediaSignOutBtn");
const loginForm = document.getElementById("mediaLoginForm");
const authForm = document.getElementById("mediaAuthForm");
const authErrorEl = document.getElementById("mediaAuthError");

const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let feedArticles = [];
let manualItems = [];
let marks = new Map();
let signedIn = false;
let statusFilter = "all";

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

function feedStatus(url) {
  return marks.get(url) || "stack";
}

function mergedArticles() {
  const fromFeed = feedArticles.map((a) => ({
    url: a.url,
    title: a.title,
    date: a.date,
    source: a.source || "",
    thoughts: "",
    manual: false,
    status: feedStatus(a.url),
  }));
  const fromManual = manualItems.map((m) => ({
    url: m.url,
    title: m.title,
    date: "",
    source: "add",
    thoughts: m.thoughts,
    manual: true,
    status: m.status,
    id: m.id,
  }));
  const byUrl = new Map();
  for (const a of fromFeed) byUrl.set(a.url, a);
  for (const m of fromManual) byUrl.set(m.url, m);
  return byUrl;
}

function buildList() {
  let list = [...mergedArticles().values()];
  if (statusFilter !== "all") list = list.filter((a) => a.status === statusFilter);
  list.sort((a, b) => {
    if (a.status !== b.status) return a.status === "stack" ? -1 : 1;
    return (b.date || "").localeCompare(a.date || "");
  });
  return list.slice(0, LIST_MAX);
}

function renderList() {
  const list = buildList();
  listEl.replaceChildren();
  if (!list.length) {
    listEl.append(el("li", "reading-empty", "No articles here yet"));
    return;
  }
  for (const a of list) {
    const li = el("li", `reading-item ${a.status === "read" ? "is-read" : "is-stack"}`);
    const link = el("a");
    link.href = a.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.append(el("span", "ri-src", a.source || ""));
    link.append(el("p", "ri-title", a.title));
    if (a.thoughts) link.append(el("p", "ri-thoughts", a.thoughts));
    else if (a.date) link.append(el("span", "ri-date", fmtDate(a.date)));
    li.append(link);
    if (signedIn && a.url) {
      const toggle = el(
        "button",
        "reading-toggle",
        a.status === "stack" ? "mark read" : "back to stack"
      );
      toggle.type = "button";
      toggle.addEventListener("click", () => setStatus(a, a.status === "stack" ? "read" : "stack"));
      li.append(toggle);
    }
    listEl.append(li);
  }
}

function renderFilters() {
  filtersEl.replaceChildren();
  const options = [["all", "all"], ["stack", "stack"], ["read", "read"]];
  const all = [...mergedArticles().values()];
  const counts = {
    all: all.length,
    stack: all.filter((a) => a.status === "stack").length,
    read: all.filter((a) => a.status === "read").length,
  };
  for (const [label, key] of options) {
    const btn = el("button", null, `${label} ${counts[key]}`);
    btn.setAttribute("aria-pressed", String(statusFilter === key));
    btn.addEventListener("click", () => {
      statusFilter = key;
      renderFilters();
      renderList();
    });
    filtersEl.append(btn);
  }
}

function render(updatedText) {
  renderFilters();
  renderList();
  countEl.textContent = String(mergedArticles().size);
  if (statusEl.textContent === "…") statusEl.textContent = "";
  if (updatedText !== undefined) statusEl.textContent = updatedText;
}

async function loadCache() {
  try {
    const r = await fetch("data/read-feeds.json");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const body = await r.json();
    if (!Array.isArray(body.articles) || !body.articles.length) return;
    feedArticles = body.articles;
    render("cached " + fmtUpdated(body.last_updated));
  } catch (e) {
    /* live proxy fetch is the fallback */
  }
}

async function loadSupabaseData() {
  try {
    const [items, rm] = await Promise.all([
      client.from("reading_items").select("id,title,url,thoughts,status").order("created_at", { ascending: false }),
      client.from("reading_marks").select("url,status"),
    ]);
    if (items.error) throw items.error;
    if (rm.error) throw rm.error;
    manualItems = items.data || [];
    marks = new Map((rm.data || []).map((m) => [m.url, m.status]));
  } catch (e) {
    /* rail degrades to feed cache only */
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
    feedArticles = body.articles;
    render("live " + fmtUpdated(body.last_updated));
  } catch (e) {
    if (!feedArticles.length) render("");
    else render("feed offline — cached");
  } finally {
    refreshBtn.classList.remove("is-spinning");
  }
}

async function setStatus(a, status) {
  const prev = a.status;
  if (a.manual) {
    const item = manualItems.find((i) => i.id === a.id);
    if (!item) return;
    const prevItem = item.status;
    item.status = status;
    render();
    const { error } = await client
      .from("reading_items")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", a.id);
    if (error) {
      item.status = prevItem;
      render();
      statusEl.textContent = "save failed";
    }
  } else {
    marks.set(a.url, status);
    render();
    const { error } = await client
      .from("reading_marks")
      .upsert({ url: a.url, status, updated_at: new Date().toISOString() }, { onConflict: "url" });
    if (error) {
      marks.set(a.url, prev);
      render();
      statusEl.textContent = "save failed";
    }
  }
}

async function submitAdd(e) {
  e.preventDefault();
  addErrorEl.textContent = "";
  const title = document.getElementById("addTitle").value.trim();
  const url = document.getElementById("addUrl").value.trim();
  const thoughts = document.getElementById("addThoughts").value.trim();
  const status = addForm.querySelector('input[name="addStatus"]:checked').value;
  if (!title || !url) {
    addErrorEl.textContent = "title and link required";
    return;
  }
  const row = { id: crypto.randomUUID(), title, url, thoughts, status, source: "manual" };
  const { error } = await client.from("reading_items").insert(row);
  if (error) {
    addErrorEl.textContent = error.message;
    return;
  }
  manualItems = [row, ...manualItems];
  addForm.reset();
  render();
}

async function applyAuth() {
  const { data: { session } } = await client.auth.getSession();
  signedIn = !!session;
  signInBtn.classList.toggle("hidden", signedIn);
  signOutBtn.classList.toggle("hidden", !signedIn);
  entryEl.classList.toggle("hidden", !signedIn);
  loginForm.classList.remove("open");
  render();
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authErrorEl.textContent = "";
  const email = document.getElementById("mediaAuthEmail").value.trim();
  const password = document.getElementById("mediaAuthPass").value;
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    authErrorEl.textContent = error.message || "sign in failed";
    return;
  }
  document.getElementById("mediaAuthPass").value = "";
  await loadSupabaseData();
  await applyAuth();
});

signInBtn.addEventListener("click", () => loginForm.classList.add("open"));
document.getElementById("mediaAuthCloseBtn").addEventListener("click", () => loginForm.classList.remove("open"));
signOutBtn.addEventListener("click", async () => {
  await client.auth.signOut();
  await applyAuth();
});
addForm.addEventListener("submit", submitAdd);
refreshBtn.addEventListener("click", () => {
  loadLive();
  loadSupabaseData();
});

applyAuth();
loadCache();
loadSupabaseData();
loadLive();