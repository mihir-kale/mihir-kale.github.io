import { LASTFM_API_KEY, LASTFM_USERNAME } from "./data.js?v=20261025";

// Latest track from Last.fm's public `user.getrecenttracks` API — the free,
// read-only source for the now rail's "currently listening to" line. Returns
// null when unreachable or unconfigured so the board silently falls back to
// curated listening items.

const ENDPOINT = "https://ws.audioscrobbler.com/2.0/";
const TTL = 20_000;

let cache = { at: 0, value: null };

export async function loadNowPlaying() {
  if (Date.now() - cache.at < TTL) return cache.value;
  let value = null;
  if (LASTFM_API_KEY && LASTFM_USERNAME) {
    try {
      const params = new URLSearchParams({
        method: "user.getrecenttracks",
        user: LASTFM_USERNAME,
        api_key: LASTFM_API_KEY,
        format: "json",
        limit: "1"
      });
      const response = await fetch(`${ENDPOINT}?${params}`);
      if (response.ok) {
        const data = await response.json();
        const raw = data && data.recenttracks && data.recenttracks.track;
        const first = Array.isArray(raw) ? raw[0] : raw;
        if (first && first.name) {
          const artist = first.artist && first.artist["#text"];
          value = {
            playing: Boolean(first["@attr"] && first["@attr"].nowplaying),
            name: String(first.name),
            artists: artist ? [String(artist)] : [],
            url: typeof first.url === "string" ? first.url : ""
          };
        }
      }
    } catch {
      /* offline or rate-limited — stay quiet */
    }
  }
  cache = { at: Date.now(), value };
  return value;
}
