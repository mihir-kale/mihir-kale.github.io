export const MEDIA_TYPES = ["article", "essay", "book", "film", "album", "podcast"];

export const TYPE_LABELS = {
  article: "Article",
  essay: "Essay",
  book: "Book",
  film: "Film",
  album: "Album",
  podcast: "Podcast"
};

export const KIND_LABELS = {
  article: "Articles",
  essay: "Essays",
  book: "Books",
  film: "Films",
  album: "Albums",
  podcast: "Podcasts"
};

export const COVER_TYPES = new Set(["book", "film", "album"]);

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
    list: LISTS.includes(clean(raw && raw.list).toLowerCase()) ? clean(raw && raw.list).toLowerCase() : "shelf"
  };
  if (!MEDIA_TYPES.includes(item.mediaType)) {
    throw new Error(`unknown media type "${raw.mediaType}"`);
  }
  if (!item.title) {
    throw new Error("missing title");
  }
  return item;
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