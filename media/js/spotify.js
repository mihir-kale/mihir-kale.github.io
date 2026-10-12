import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./data.js?v=20261012e";

// Live Spotify "latest played" for the now rail, served by the public
// `now-playing` Supabase Edge Function. Returns null when unavailable so the
// board silently falls back to curated listening items.

const ENDPOINT = `${SUPABASE_URL}/functions/v1/now-playing`;
const TTL = 20_000;

let cache = { at: 0, value: null };

export async function loadNowPlaying() {
  if (Date.now() - cache.at < TTL) return cache.value;
  let value = null;
  try {
    const response = await fetch(ENDPOINT, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.name) {
        value = {
          playing: Boolean(data.playing),
          name: String(data.name),
          artists: Array.isArray(data.artists) ? data.artists : [],
          url: typeof data.url === "string" ? data.url : ""
        };
      }
    }
  } catch {
    /* offline or function not deployed — stay quiet */
  }
  cache = { at: Date.now(), value };
  return value;
}
