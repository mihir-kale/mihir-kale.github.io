export const SUPABASE_URL = "https://gzwhuwzmrrmtswyhjheu.supabase.co";

// Public by design (RLS-protected).
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6d2h1d3ptcnJtdHN3eWhqaGV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NDQ1OTUsImV4cCI6MjEwNDIyMDU5NX0.vARmLV7ttdkTXz45IDUydwEENxFFY4d3PsI1kct08_E";

// Last.fm read-only credentials for the live "currently listening to" line.
// Public by design: a Last.fm API key is a client identifier, not a signing
// secret — only the shared secret (kept server-side in .env) can authorize
// writes, and none are made here. Last.fm serves recent tracks with CORS open,
// so the board reads them directly (see js/lastfm.js).
export const LASTFM_API_KEY = "94fa29d52e72dc7361dce8bc5f33e3bc";
export const LASTFM_USERNAME = "mihirpkale";

const REST = `${SUPABASE_URL}/rest/v1`;
const AUTH_HEADERS = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

// Public shelf shows ten articles, rotating through sources so one feed can't
// fill the whole column.
export const SHELF_LIMIT = 10;

// Marketing titles are noise on a reading shelf. Keep the match narrow so
// legitimate articles about discounts still get through.
const PROMOTIONAL_TITLE = /\b(?:coupons?|promo(?:tion)?\s+codes?|discount(?:s)?\s+codes?|deal of the day|\d{1,2}\s?%\s?off)\b|\bsave\s+\d{1,2}\s?%/i;

export function isPromotionalTitle(title) {
  return PROMOTIONAL_TITLE.test(String(title ?? ""));
}

export const MEDIA_TYPES = [
  "fiction",
  "non-fiction",
  "short-fiction",
  "short-non-fiction",
  "film",
  "album",
  "podcast"
];

export const TYPE_LABELS = {
  fiction: "Fiction",
  "non-fiction": "Non-fiction",
  "short-fiction": "Short fiction",
  "short-non-fiction": "Short non-fiction",
  film: "Film",
  album: "Music",
  podcast: "Podcast"
};

export const GROUP_LABELS = {
  books: "Books",
  "short-fiction": "Short fiction",
  essays: "Essays",
  movies: "Movies",
  music: "Music",
  podcasts: "Podcasts"
};

// Several stored media types share one human-facing medium section.
export const MEDIA_TYPE_TO_GROUP = {
  fiction: "books",
  "non-fiction": "books",
  "short-fiction": "short-fiction",
  "short-non-fiction": "essays",
  film: "movies",
  album: "music",
  podcast: "podcasts"
};

export const COVER_TYPES = new Set(["fiction", "non-fiction", "film", "album", "podcast"]);

export const LISTS = ["recommend", "shelf", "now", "syllabi"];

// The top-bar toggle switches among these; "now" powers a dedicated headerless
// rail instead.
export const TOGGLE_LISTS = ["recommend", "shelf", "syllabi"];

export const LIST_LABELS = {
  shelf: "on my shelf",
  recommend: "my recommendations",
  now: "currently",
  syllabi: "syllabi"
};

export const STATUS_LABELS = {
  backlog: "On the list",
  "in-progress": "In progress",
  finished: "Consumed"
};

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedTags(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(clean).filter(Boolean))];
}

export function normalizeItem(raw) {
  const item = {
    id: clean(raw && raw.id) || null,
    mediaType: clean(raw && raw.mediaType).toLowerCase(),
    title: clean(raw && raw.title),
    creator: clean(raw && raw.creator),
    year: Number.isFinite(Number(raw && raw.year)) ? Number(raw.year) : null,
    status: clean(raw && raw.status) || "finished",
    rating: Number.isFinite(Number(raw && raw.rating)) ? Math.min(5, Math.max(0, Number(raw.rating))) : null,
    consumed: clean(raw && raw.consumed) || null,
    notes: clean(raw && raw.notes),
    tags: normalizedTags(raw && raw.tags),
    url: clean(raw && raw.url),
    spotlight: Boolean(raw && raw.spotlight),
    list: LISTS.includes(clean(raw && raw.list).toLowerCase()) ? clean(raw && raw.list).toLowerCase() : "shelf",
    topic: clean(raw && raw.topic),
    source: clean(raw && raw.source)
  };
  if (!MEDIA_TYPES.includes(item.mediaType)) {
    throw new Error(`unknown media type "${raw.mediaType}"`);
  }
  if (!item.title) {
    throw new Error("missing title");
  }
  return item;
}

function fromRow(row) {
  return normalizeItem({
    id: row.id,
    mediaType: row.media_type,
    title: row.title,
    creator: row.creator,
    year: row.year,
    status: row.status,
    consumed: row.consumed,
    notes: row.notes,
    tags: row.tags,
    url: row.url,
    spotlight: row.spotlight,
    list: row.list,
    topic: row.topic,
    source: row.source
  });
}

// Curated entries live in Supabase (media_entries); fall back to the static
// JSON file if the backend is unreachable.
export async function loadEntries() {
  try {
    // Newest first: the syllabi view lays its topic rails out in the order
    // their first entry appears, so a fresh topic floats to the top.
    const response = await fetch(`${REST}/media_entries?select=*&order=created_at.desc`, { headers: AUTH_HEADERS });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("unexpected payload");
    const items = [];
    rows.forEach((row, index) => {
      try {
        items.push(fromRow(row));
      } catch (error) {
        console.warn(`Skipping media_entries row ${index + 1}: ${error.message}`);
      }
    });
    return items;
  } catch (error) {
    console.warn(`media_entries unavailable (${error.message}); using data/library.json`);
    return loadLibrary();
  }
}

function publishedTime(article) {
  const time = Date.parse(article.publishedAt || "");
  return Number.isNaN(time) ? 0 : time;
}

// Round-robin across sources, newest source first, then repeat sources if
// there are fewer than SHELF_LIMIT of them.
export function mixSources(articles, limit = SHELF_LIMIT) {
  const groups = new Map();
  for (const article of articles) {
    const key = article.source || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(article);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => publishedTime(b[0]) - publishedTime(a[0]) || a[0].source.localeCompare(b[0].source)
  );
  const mixed = [];
  for (let index = 0; mixed.length < limit; index++) {
    let added = false;
    for (const group of ordered) {
      if (index >= group.length) continue;
      mixed.push(group[index]);
      added = true;
      if (mixed.length >= limit) break;
    }
    if (!added) break;
  }
  return mixed;
}

// Recent articles pulled by the RSS cron job, read from the public
// `article_shelf` view. Reviews and owner reading state are not exposed.
export async function loadArticles() {
  try {
    const response = await fetch(
      `${REST}/article_shelf?select=id,title,url,published_at,source&order=published_at.desc&limit=200`,
      { headers: AUTH_HEADERS }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("unexpected payload");
    const articles = rows
      .map((row) => ({
        id: row.id,
        title: typeof row.title === "string" ? row.title.trim() : "",
        url: typeof row.url === "string" ? row.url.trim() : "",
        publishedAt: row.published_at || null,
        source: typeof row.source === "string" ? row.source.trim() : ""
      }))
      .filter((article) => article.title || article.url)
      .filter((article) => !isPromotionalTitle(article.title));
    return mixSources(articles);
  } catch (error) {
    console.warn(`articles unavailable (${error.message})`);
    return [];
  }
}

// Shelf marks (dismiss / promote) keyed by feed item id. Returns null when the
// backend is unreachable so the caller can fall back to localStorage.
export async function loadMarks() {
  try {
    const response = await fetch(`${REST}/media_marks?select=item_id,dismissed,promoted`, { headers: AUTH_HEADERS });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

// Incoming "recommend me something" submissions land on the shelf. RLS only
// lets the signed-in owner read them, so this returns [] without a token.
export async function loadSuggestions(token) {
  if (!token) return [];
  try {
    const response = await fetch(
      `${REST}/media_suggestions?select=id,media_type,title,notes,submitter&order=created_at.desc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    const items = [];
    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      try {
        items.push(
          normalizeItem({
            id: `sug-${row.id}`,
            mediaType: row.media_type,
            title: row.title,
            creator: row.submitter || "",
            notes: row.notes || "",
            list: "shelf",
            source: "suggestion"
          })
        );
      } catch (error) {
        console.warn(`Skipping media_suggestions row ${index + 1}: ${error.message}`);
      }
    });
    return items;
  } catch (error) {
    console.warn(`media_suggestions unavailable (${error.message})`);
    return [];
  }
}

function toRow(entry) {
  return {
    id: entry.id,
    media_type: entry.mediaType,
    title: entry.title,
    creator: entry.creator || "",
    year: entry.year ?? null,
    status: entry.status || "finished",
    consumed: entry.consumed || null,
    notes: entry.notes || "",
    tags: entry.tags || [],
    url: entry.url || "",
    spotlight: Boolean(entry.spotlight),
    list: entry.list || "shelf",
    topic: entry.topic || null,
    source: entry.source || "manual",
    updated_at: new Date().toISOString()
  };
}

// Create or update a curated entry. Requires a signed-in session token; RLS
// only lets authenticated (owner) writes through.
export async function saveEntry(entry, token) {
  const response = await fetch(`${REST}/media_entries?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(toRow(entry))
  });
  if (!response.ok) throw new Error(`could not save (HTTP ${response.status})`);
}

export async function deleteEntry(id, token) {
  const response = await fetch(`${REST}/media_entries?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`could not delete (HTTP ${response.status})`);
}

export async function loadFeeds(url = "data/feeds.json") {
  let response;
  try {
    response = await fetch(url);
  } catch {
    return [];
  }
  if (!response.ok) return [];
  let payload;
  try {
    payload = await response.json();
  } catch {
    return [];
  }
  if (!Array.isArray(payload)) return [];
  const items = [];
  payload.forEach((raw, index) => {
    try {
      const item = normalizeItem(raw);
      if (!isPromotionalTitle(item.title)) items.push(item);
    } catch (error) {
      console.warn(`Skipping feed entry ${index + 1}: ${error.message}`);
    }
  });
  return items;
}

export async function loadLibrary(url = "data/library.json") {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(
      "Could not fetch the media catalogue. If you opened this page directly from disk, serve the folder with a local web server instead."
    );
  }
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${url} does not contain valid JSON.`);
  }
  if (!Array.isArray(payload)) {
    throw new Error(`Expected a JSON array in ${url}.`);
  }
  const items = [];
  payload.forEach((raw, index) => {
    try {
      items.push(normalizeItem(raw));
    } catch (error) {
      console.warn(`Skipping entry ${index + 1}: ${error.message}`);
    }
  });
  return items;
}