#!/usr/bin/env node
// add_media.js — append an entry to media/data/library.json
//
//   node scripts/add_media.js --type book --title "The Great Gatsby" \
//     --creator "F. Scott Fitzgerald" --year 1925 --rating 4.5 \
//     --consumed 2026-08-01 --notes "..." --tag classic --url "..." --spotlight
//
//   echo '{"mediaType":"book","title":"..."}' | node scripts/add_media.js
//
// Flags repeat for multiple tags: --tag sci-fi --tag fiction

import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const MEDIA_TYPES = ["book", "film", "tv", "album", "article", "podcast"];
const STATUSES = ["backlog", "in-progress", "finished"];
const TYPE_ALIASES = { movie: "film", show: "tv", series: "tv", music: "album", essay: "article" };

const args = parseArgs(process.argv.slice(2));
const file = resolve(args.file || "media/data/library.json");

let raw = null;
if (!process.stdin.isTTY) {
  try {
    const input = readFileSync(0, "utf8").trim();
    if (input) raw = JSON.parse(input);
  } catch (error) {
    fail(`Could not parse JSON from stdin: ${error.message}`);
  }
}

if (raw && typeof raw === "object" && !Array.isArray(raw)) {
  raw.tags = raw.tags ?? args.tags;
}
const fromFlags = raw && Object.keys(raw).length ? raw : buildFromFlags(args);
const entry = normalize(fromFlags);

const library = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(library)) fail(`${file} must contain a JSON array of entries.`);

if (library.some((item) => item.id === entry.id)) {
  const previous = library.findIndex((item) => item.id === entry.id);
  library[previous] = entry;
  console.log(`Updated entry "${entry.title}" (${entry.id}) in ${file}`);
} else {
  library.push(entry);
  console.log(`Added "${entry.title}" (${entry.id}) to ${file}`);
}

writeFileSync(file, JSON.stringify(library, null, 2) + "\n");
console.log(`  -> ${library.length} entries total, ${library.filter((i) => i.spotlight).length} spotlighted`);

function buildFromFlags(args) {
  if (!args.title) fail("A --title is required.");
  return {
    id: args.id || randomUUID().replace(/-/g, "").slice(0, 21),
    mediaType: args.type,
    title: args.title,
    creator: args.creator || "",
    year: args.year,
    status: args.status || "finished",
    rating: args.rating,
    consumed: args.consumed || null,
    notes: args.notes || "",
    tags: args.tags || [],
    url: args.url || "",
    spotlight: Boolean(args.spotlight)
  };
}

function normalize(raw) {
  const mediaType = TYPE_ALIASES[String(raw.mediaType).toLowerCase()] || String(raw.mediaType).toLowerCase();
  if (!MEDIA_TYPES.includes(mediaType)) {
    fail(`Unknown media type "${raw.mediaType}". Allowed: ${MEDIA_TYPES.join(", ")}.`);
  }
  if (!raw.title || !String(raw.title).trim()) {
    fail("Missing title.");
  }
  const item = {
    id: String(raw.id || randomUUID().replace(/-/g, "").slice(0, 21)),
    mediaType,
    title: String(raw.title).trim(),
    creator: String(raw.creator || "").trim(),
    year: Number.isFinite(Number(raw.year)) ? Number(raw.year) : null,
    status: STATUSES.includes(raw.status) ? raw.status : "finished",
    rating: Number.isFinite(Number(raw.rating)) ? Math.min(5, Math.max(0, Number(raw.rating))) : null,
    consumed: raw.consumed || null,
    notes: String(raw.notes || "").trim(),
    tags: [...new Set((raw.tags || []).map((tag) => String(tag).trim()).filter(Boolean))],
    url: String(raw.url || "").trim(),
    spotlight: Boolean(raw.spotlight)
  };
  for (const key of Object.keys(item)) {
    if (item[key] === null || item[key] === "" || (Array.isArray(item[key]) && !item[key].length)) delete item[key];
  }
  if (!item.notes) delete item.notes;
  return item;
}

function parseArgs(argv) {
  const out = { tags: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) {
      fail(`Unexpected argument "${arg}"`);
    }
    const key = match[1];
    if (key === "spotlight") {
      out.spotlight = match[2] === undefined ? true : match[2] !== "false";
      continue;
    }
    const value = match[2] !== undefined ? match[2] : argv[++i];
    if (value === undefined) fail(`Missing value for --${key}`);
    if (key === "tag") out.tags.push(value);
    else out[key] = value;
  }
  return out;
}

function fail(message) {
  console.error(`\u2717 ${message}`);
  console.error("Usage: node scripts/add_media.js --type <book|film|tv|album|article|podcast> --title \"...\" [--creator ...] [--year ...] [--status backlog|in-progress|finished] [--rating 0-5] [--consumed YYYY-MM-DD] [--notes ...] [--tag ...] [--url ...] [--spotlight]");
  process.exit(1);
}