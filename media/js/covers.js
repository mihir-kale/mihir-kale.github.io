const MEMORY_CACHE = new Map();
const STORE_PREFIX = "mk:media:covers:v1:";

function configuredTmdbKey() {
  let key = "";
  try {
    const meta = document.querySelector('meta[name="tmdb-api-key"]');
    key = meta && meta.content ? meta.content.trim() : "";
  } catch {}
  if (!key) {
    try {
      key = (localStorage.getItem("tmdbApiKey") || "").trim();
    } catch {}
  }
  return key;
}

function cacheKey(item) {
  return `${item.mediaType}|${item.title.toLowerCase()}|${(item.creator || "").toLowerCase()}`;
}

function readCache(key) {
  if (MEMORY_CACHE.has(key)) return MEMORY_CACHE.get(key);
  try {
    const stored = sessionStorage.getItem(STORE_PREFIX + key);
    if (stored !== null) {
      MEMORY_CACHE.set(key, stored);
      return stored;
    }
  } catch {}
  return undefined;
}

function writeCache(key, value) {
  MEMORY_CACHE.set(key, value);
  try {
    sessionStorage.setItem(STORE_PREFIX + key, value);
  } catch {}
}

function loadImage(url, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    img.addEventListener("load", () => {
      clearTimeout(timer);
      resolve(url);
    });
    img.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("load failed"));
    });
    img.src = url;
  });
}

async function firstLoadable(urls) {
  for (const url of urls) {
    if (!url) continue;
    try {
      return await loadImage(url);
    } catch {}
  }
  return null;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function googleBookCandidates(title, author) {
  try {
    const query = [`intitle:"${title}"`, author ? `inauthor:"${author}"` : ""]
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("+");
    const data = await fetchJson(
      `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=5&country=US`
    );
    for (const item of data.items || []) {
      const links = item.volumeInfo && item.volumeInfo.imageLinks;
      if (!links) continue;
      const best =
        links.extraLarge || links.large || links.medium || links.small || links.thumbnail || links.smallThumbnail;
      if (!best) continue;
      const secure = best.replace(/^http:\/\//, "https://").replace(/&edge=curl/g, "");
      const zoomed = /([?&])zoom=\d+/.test(secure)
        ? secure.replace(/([?&])zoom=\d+/, "$1zoom=3")
        : `${secure}${secure.includes("?") ? "&" : "?"}zoom=3`;
      return [...new Set([zoomed, secure])];
    }
    return [];
  } catch {
    return [];
  }
}

async function openLibraryCandidates(title, author) {
  try {
    const params = new URLSearchParams({ title, limit: "5", fields: "cover_i" });
    if (author) params.set("author", author);
    const data = await fetchJson(`https://openlibrary.org/search.json?${params}`);
    const hit = (data.docs || []).find((doc) => doc.cover_i);
    return hit ? [`https://covers.openlibrary.org/b/id/${hit.cover_i}-L.jpg`] : [];
  } catch {
    return [];
  }
}

async function tmdbCandidates(title, mediaType) {
  const key = configuredTmdbKey();
  if (!key) return [];
  try {
    const kind = mediaType === "film" ? "movie" : "tv";
    const params = new URLSearchParams({
      query: title,
      include_adult: "false",
      language: "en-US",
      page: "1"
    });
    const data = await fetchJson(`https://api.themoviedb.org/3/search/${kind}?${params}&api_key=${key}`);
    const hit = (data.results || []).find((result) => result.poster_path);
    return hit ? [`https://image.tmdb.org/t/p/w500${hit.poster_path}`] : [];
  } catch {
    return [];
  }
}

function upscaleItunesArtwork(url) {
  return (url || "").replace(/(\d{2,4})x(\d{2,4})bb/, "600x600bb");
}

async function itunesAlbumCandidates(title, artist) {
  try {
    const term = [artist, title].filter(Boolean).join(" ") || title;
    const params = new URLSearchParams({ entity: "album", term, limit: "5", country: "US" });
    const data = await fetchJson(`https://itunes.apple.com/search?${params}`);
    const needle = title.toLowerCase();
    const hit = (data.results || []).find((result) => {
      const name = (result.collectionName || "").toLowerCase();
      return result.artworkUrl100 && (name === needle || name.includes(needle));
    });
    if (!hit) return [];
    return [...new Set([upscaleItunesArtwork(hit.artworkUrl100), hit.artworkUrl100])];
  } catch {
    return [];
  }
}

export async function resolveCover(item) {
  const key = cacheKey(item);
  const cached = readCache(key);
  if (cached !== undefined) return cached || null;

  let candidates = [];
  switch (item.mediaType) {
    case "book": {
      const [google, library] = await Promise.all([
        googleBookCandidates(item.title, item.creator),
        openLibraryCandidates(item.title, item.creator)
      ]);
      candidates = [...google, ...library];
      break;
    }
    case "film":
    case "tv":
      candidates = await tmdbCandidates(item.title, item.mediaType);
      break;
    case "album":
      candidates = await itunesAlbumCandidates(item.title, item.creator);
      break;
    default:
      return null;
  }

  const url = await firstLoadable(candidates);
  if (url) writeCache(key, url);
  return url;
}