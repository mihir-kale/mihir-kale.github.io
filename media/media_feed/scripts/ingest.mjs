#!/usr/bin/env node
// Ingest every enabled RSS/Atom source into Supabase.
//
//   node scripts/ingest.mjs
//
// Dependency-free (Node 18+ global fetch). Sources live in the `sources`
// table; articles are deduplicated by canonical URL. Re-ingesting a feed only
// refreshes feed-owned metadata, never reading state or reviews.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isPromotionalTitle, isWithinDays, parseFeed } from "../lib/rss.mjs";
import { buildArticleUpdate, createSupabaseClient } from "../lib/supabase.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FETCH_TIMEOUT_MS = Number(process.env.FEED_FETCH_TIMEOUT_MS) > 0
  ? Number(process.env.FEED_FETCH_TIMEOUT_MS)
  : 20000;
const USER_AGENT = process.env.FEED_USER_AGENT || "mihirOS-media-feed-ingest/1.0 (+https://github.com/mihir-kale)";
const RETENTION_DAYS = 7;

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv(resolve(ROOT, ".env"));

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function ingestSource(source, client, existingByCanonical, discoveredAt) {
  const result = {
    source: source.name,
    status: "ok",
    fetched: 0,
    inserted: 0,
    updated: 0,
    duplicates: 0,
    skipped: 0,
    promotions: 0,
    too_old: 0
  };

  try {
    const xml = await fetchText(source.rss_url);
    const seen = new Set();
    const inserts = [];

    for (const item of parseFeed(xml)) {
      if (isPromotionalTitle(item.title)) {
        result.promotions += 1;
        continue;
      }
      if (seen.has(item.url)) {
        result.duplicates += 1;
        continue;
      }
      seen.add(item.url);

      // Undated feed items are treated as discovered now; they age out after
      // the same 7-day window via the prune step.
      const effectivePublishedAt = item.publishedAt ?? discoveredAt;
      if (!isWithinDays(effectivePublishedAt, discoveredAt, RETENTION_DAYS)) {
        result.too_old += 1;
        continue;
      }

      if (!item.title) {
        result.skipped += 1;
        continue;
      }
      result.fetched += 1;

      const storedUrl = existingByCanonical.get(item.url);
      if (!storedUrl) {
        inserts.push({
          source_id: source.id,
          title: item.title,
          author: item.author ?? null,
          url: item.url,
          description: item.description ?? null,
          published_at: effectivePublishedAt,
          discovered_at: discoveredAt
        });
        continue;
      }

      // PATCH sends only feed metadata; reading state, ranking and reviews stay
      // exactly as they were in the database.
      if (await client.updateArticleByUrl(storedUrl, buildArticleUpdate(item))) {
        result.updated += 1;
      }
    }

    result.inserted = await client.insertArticles(inserts);
    for (const row of inserts) {
      if (!existingByCanonical.has(row.url)) existingByCanonical.set(row.url, row.url);
    }
  } catch (error) {
    result.status = "failed";
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

async function main() {
  const startedAt = new Date().toISOString();
  const cutoffAt = new Date(Date.parse(startedAt) - RETENTION_DAYS * 86400000).toISOString();
  const client = createSupabaseClient({
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY
  });

  const sources = await client.getEnabledSources();
  console.log(JSON.stringify({
    event: "run_start",
    at: startedAt,
    retention_days: RETENTION_DAYS,
    cutoff: cutoffAt,
    enabled_sources: sources.length
  }));

  const results = [];
  if (sources.length) {
    const existingByCanonical = await client.getArticleUrlMap();
    console.log(JSON.stringify({ event: "existing_articles", count: existingByCanonical.size }));

    for (const source of sources) {
      console.log(JSON.stringify({ event: "source_start", source: source.name }));
      const result = await ingestSource(source, client, existingByCanonical, startedAt);
      results.push(result);
      console.log(JSON.stringify({ event: "source_result", ...result }));
    }
  }

  // Strict retention: prune even if every feed failed, so the table always
  // converges to the trailing window.
  let pruned = 0;
  let pruneError = null;
  try {
    pruned = (await client.pruneArticlesOlderThan(cutoffAt)) ?? 0;
    console.log(JSON.stringify({ event: "prune_result", cutoff: cutoffAt, deleted: pruned }));
  } catch (error) {
    pruneError = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ event: "prune_failed", error: pruneError }));
  }

  const summary = {
    event: "run_summary",
    enabled_sources: sources.length,
    succeeded: results.filter((result) => result.status === "ok").length,
    failed: results.filter((result) => result.status === "failed").length,
    fetched: results.reduce((sum, result) => sum + result.fetched, 0),
    inserted: results.reduce((sum, result) => sum + result.inserted, 0),
    updated: results.reduce((sum, result) => sum + result.updated, 0),
    duplicates: results.reduce((sum, result) => sum + result.duplicates, 0),
    skipped: results.reduce((sum, result) => sum + result.skipped, 0),
    promotions: results.reduce((sum, result) => sum + result.promotions, 0),
    too_old: results.reduce((sum, result) => sum + result.too_old, 0),
    pruned
  };
  if (pruneError) summary.prune_failed = true;
  console.log(JSON.stringify(summary));

  // One broken feed must not abort the job; total feed failure or a failed
  // retention prune is fatal.
  if ((sources.length && summary.failed === summary.enabled_sources) || pruneError) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "run_failed", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
