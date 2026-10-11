export const SUPABASE_URL = "https://gzwhuwzmrrmtswyhjheu.supabase.co";

// Public by design (RLS-protected).
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6d2h1d3ptcnJtdHN3eWhqaGV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NDQ1OTUsImV4cCI6MjEwNDIyMDU5NX0.vARmLV7ttdkTXz45IDUydwEENxFFY4d3PsI1kct08_E";

const REST = `${SUPABASE_URL}/rest/v1`;
const AUTH_HEADERS = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

export const MEDIA_TYPES = ["article", "essay", "book", "film", "album", "podcast"];

export const TYPE_LABELS = {
  article: "Article",
  essay: "Essay",
  book: "Book",
  film: "Film",
  album: "Music",
  podcast: "Podcast"
};

export const KIND_LABELS = {
  article: "Articles",
  essay: "Essays",
  book: "Books",
  film: "Films",
  album: "Music",
  podcast: "Podcasts"
};

export const COVER_TYPES = new Set(["book", "film", "album", "podcast"]);

export const LISTS = ["recommend", "shelf"];

export const LIST_LABELS = {
  shelf: "on my shelf",
  recommend: "my recommendations"
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
    source: row.source
  });
}

// Curated entries live in Supabase (media_entries); fall back to the static
// JSON file if the backend is unreachable.
export async function loadEntries() {
  try {
    const response = await fetch(`${REST}/media_entries?select=*`, { headers: AUTH_HEADERS });
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
      items.push(normalizeItem(raw));
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