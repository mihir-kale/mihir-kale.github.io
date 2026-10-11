#!/usr/bin/env node
// push_media.mjs — upsert media/data/library.json into the Supabase
// media_entries table (the media page's curated catalogue).
//
//   node media/scripts/push_media.mjs
//
// Reads SUPABASE_SERVICE_ROLE_KEY (and optional SUPABASE_URL) from media/.env,
// the repo root .env, or the environment. Dependency-free (Node 18+ fetch).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

function loadEnv(...paths) {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      if (!(match[1] in process.env)) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

loadEnv(resolve(ROOT, ".env"), resolve(ROOT, "../.env"));

const URL = (process.env.SUPABASE_URL || "https://gzwhuwzmrrmtswyhjheu.supabase.co").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!KEY) {
  console.error("\u2717 Missing SUPABASE_SERVICE_ROLE_KEY (set it in media/.env or the repo .env).");
  process.exit(1);
}

const libraryPath = resolve(ROOT, "data/library.json");
const library = JSON.parse(readFileSync(libraryPath, "utf8"));
if (!Array.isArray(library)) {
  console.error(`\u2717 ${libraryPath} must contain a JSON array.`);
  process.exit(1);
}

const rows = library.map((item) => ({
  id: item.id,
  media_type: item.mediaType,
  title: item.title,
  creator: item.creator || "",
  year: item.year ?? null,
  status: item.status || "finished",
  consumed: item.consumed || null,
  notes: item.notes || "",
  tags: item.tags || [],
  url: item.url || "",
  spotlight: Boolean(item.spotlight),
  list: item.list || "shelf",
  source: item.source || "manual",
  updated_at: new Date().toISOString()
}));

const response = await fetch(`${URL}/rest/v1/media_entries?on_conflict=id`, {
  method: "POST",
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal"
  },
  body: JSON.stringify(rows)
});

if (!response.ok) {
  console.error(`\u2717 Push failed: HTTP ${response.status} ${await response.text()}`);
  process.exit(1);
}
console.log(`Pushed ${rows.length} entr${rows.length === 1 ? "y" : "ies"} to media_entries.`);
