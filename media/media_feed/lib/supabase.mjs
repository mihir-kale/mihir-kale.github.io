// Minimal Supabase REST client for the ingestion job. The service-role key is
// read from the environment (GitHub Actions secret locally from .env) and is
// never logged. No supabase-js dependency is needed for these few calls.

import { canonicalizeUrl } from "./rss.mjs";

const PAGE_SIZE = 1000;

export function createSupabaseClient({ url, key }) {
  const base = String(url ?? "").replace(/\/$/, "");
  if (!base) throw new Error("SUPABASE_URL is required");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

  async function request(path, { method = "GET", body, prefer, range } = {}) {
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json"
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer) headers.Prefer = prefer;
    if (range) headers.Range = `${range[0]}-${range[1]}`;

    const response = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`${method} ${path.split("?")[0]} -> HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const text = await response.text();
    return {
      data: text ? JSON.parse(text) : null,
      contentRange: response.headers.get("content-range")
    };
  }

  return {
    async getEnabledSources() {
      const { data } = await request("sources?select=id,name,rss_url&enabled=eq.true&order=name.asc");
      return data ?? [];
    },

    // Map canonical URL -> the exact URL stored in the DB. Canonicalizing the
    // stored value too means legacy/tracking-laden rows still match new feeds.
    async getArticleUrlMap() {
      const byCanonical = new Map();
      for (let start = 0; ; start += PAGE_SIZE) {
        const { data, contentRange } = await request("articles?select=url&order=url.asc", {
          prefer: "count=exact",
          range: [start, start + PAGE_SIZE - 1]
        });
        const rows = data ?? [];
        for (const row of rows) {
          const stored = row.url;
          const canonical = canonicalizeUrl(stored) ?? stored;
          if (!byCanonical.has(canonical)) byCanonical.set(canonical, stored);
        }
        const total = Number(contentRange?.split("/").pop());
        if (rows.length < PAGE_SIZE || (Number.isFinite(total) && start + rows.length >= total)) break;
      }
      return byCanonical;
    },

    async insertArticles(rows) {
      if (!rows.length) return 0;
      await request("articles", {
        method: "POST",
        body: rows,
        prefer: "resolution=ignore-duplicates,return=minimal"
      });
      return rows.length;
    },

    async updateArticleByUrl(url, patch) {
      if (!Object.keys(patch).length) return false;
      await request(`articles?url=eq.${encodeURIComponent(url)}`, {
        method: "PATCH",
        body: patch,
        prefer: "return=minimal"
      });
      return true;
    },

    async pruneArticlesOlderThan(cutoff) {
      const { contentRange } = await request(`articles?published_at=lt.${encodeURIComponent(cutoff)}`, {
        method: "DELETE",
        prefer: "count=exact,return=minimal"
      });
      const count = Number(contentRange?.split("/").pop());
      return Number.isFinite(count) ? count : null;
    }
  };
}

// Only feed-owned metadata is refreshed. Status, priority (ranking),
// recommendation_reason, read_at, discovered_at and id are never sent, so
// reading state and reviews survive every subsequent ingestion.
export function buildArticleUpdate(incoming) {
  const patch = {};
  if (incoming.title) patch.title = incoming.title;
  if (incoming.author) patch.author = incoming.author;
  if (incoming.description) patch.description = incoming.description;
  if (incoming.publishedAt) patch.published_at = incoming.publishedAt;
  return patch;
}
