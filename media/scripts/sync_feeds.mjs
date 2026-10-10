#!/usr/bin/env node
// sync_feeds.mjs — fetch the RSS/Atom feeds in media/data/feed-sources.json and
// write normalized article/podcast entries to media/data/feeds.json.
//
//   node media/scripts/sync_feeds.mjs
//
// Dependency-free (Node 18+ global fetch). Feed items always land in the
// "shelf" list; books/films/albums/essays stay manual in library.json. If a
// source fails to fetch, its previously-cached items are kept.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(HERE, "../data/feed-sources.json");
const OUTPUT_PATH = resolve(HERE, "../data/feeds.json");
const FETCH_TIMEOUT_MS = 20000;

function hash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unwrapCdata(text) {
  return String(text || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

function decodeEntities(text) {
  return String(text || "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match;
  });
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function clean(text) {
  return decodeEntities(stripHtml(unwrapCdata(text))).replace(/\s+/g, " ").trim();
}

function summarize(text, max = 280) {
  const value = clean(text);
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > 80 ? cut.slice(0, space) : cut}\u2026`;
}

function extractBlocks(xml) {
  const blocks = [];
  for (const re of [/<item\b[\s\S]*?<\/item>/gi, /<entry\b[\s\S]*?<\/entry>/gi]) {
    for (const match of xml.matchAll(re)) blocks.push(match[0]);
  }
  return blocks;
}

function extractLink(block) {
  const atom = [...block.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/gi)].map((m) => ({ href: m[1], tag: m[0] }));
  if (atom.length) {
    const alternate = atom.find((entry) => /rel="alternate"/i.test(entry.tag)) || atom[0];
    return alternate.href.trim();
  }
  const rss = block.match(/<link>([\s\S]*?)<\/link>/i);
  return rss ? clean(rss[1]) : "";
}

function extractDate(block) {
  const patterns = [
    /<pubDate>([\s\S]*?)<\/pubDate>/i,
    /<published>([\s\S]*?)<\/published>/i,
    /<updated>([\s\S]*?)<\/updated>/i,
    /<dc:date>([\s\S]*?)<\/dc:date>/i
  ];
  for (const re of patterns) {
    const match = block.match(re);
    if (match) {
      const time = Date.parse(clean(match[1]));
      if (Number.isFinite(time)) return new Date(time);
    }
  }
  return null;
}

function extractSummary(block) {
  const patterns = [
    /<content:encoded>([\s\S]*?)<\/content:encoded>/i,
    /<description>([\s\S]*?)<\/description>/i,
    /<summary[^>]*>([\s\S]*?)<\/summary>/i,
    /<content\b[^>]*>([\s\S]*?)<\/content>/i
  ];
  for (const re of patterns) {
    const match = block.match(re);
    if (match) {
      const value = clean(match[1]);
      if (value) return value;
    }
  }
  return "";
}

function extractAuthor(block) {
  let match = block.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i);
  if (match) return clean(match[1]);
  match = block.match(/<author>([\s\S]*?)<\/author>/i);
  if (match) {
    const name = match[1].match(/<name>([\s\S]*?)<\/name>/i);
    return clean(name ? name[1] : match[1]);
  }
  return "";
}

function extractId(block, link) {
  for (const re of [/<guid[^>]*>([\s\S]*?)<\/guid>/i, /<id>([\s\S]*?)<\/id>/i]) {
    const match = block.match(re);
    if (match) {
      const value = clean(match[1]);
      if (value) return value;
    }
  }
  return link;
}

function buildItem(source, block) {
  const title = clean((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  if (!title) return null;
  const link = extractLink(block);
  const date = extractDate(block);
  const author = extractAuthor(block);
  const summary = extractSummary(block);
  const key = extractId(block, link) || title;

  const tags = [slug(source.name)];
  if (author) tags.push(slug(author));

  return {
    id: `feed-${hash(key)}`,
    mediaType: source.type,
    title,
    creator: source.name,
    year: date ? date.getUTCFullYear() : null,
    status: "finished",
    consumed: date ? date.toISOString().slice(0, 10) : null,
    notes: summarize(summary),
    tags: [...new Set(tags.filter(Boolean))],
    url: link,
    spotlight: false,
    list: "shelf",
    source: "feed"
  };
}

async function fetchText(url, userAgent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function isExcluded(title, terms) {
  const value = title.toLowerCase();
  return terms.some((term) => term && value.includes(String(term).toLowerCase()));
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const config = readJson(CONFIG_PATH, null);
  if (!config || !Array.isArray(config.sources)) {
    console.error(`\u2717 Could not read sources from ${CONFIG_PATH}`);
    process.exit(1);
  }

  const previous = readJson(OUTPUT_PATH, []);
  const prevBySource = new Map();
  for (const item of Array.isArray(previous) ? previous : []) {
    const key = item.creator || "";
    if (!prevBySource.has(key)) prevBySource.set(key, []);
    prevBySource.get(key).push(item);
  }

  const userAgent = config.user_agent || "mihirOS-media-feed-sync/1.0";
  const limit = Number(config.per_source_limit) > 0 ? Number(config.per_source_limit) : 8;
  const exclude = Array.isArray(config.title_exclude) ? config.title_exclude : [];
  const results = [];

  for (const source of config.sources) {
    if (source.enabled === false || !source.url) {
      console.log(`- ${source.name}: disabled`);
      continue;
    }
    try {
      const xml = await fetchText(source.url, userAgent);
      const blocks = extractBlocks(xml);
      const seen = new Set();
      let items = blocks
        .map((block) => buildItem(source, block))
        .filter((item) => item && !isExcluded(item.title, exclude) && !seen.has(item.id) && seen.add(item.id));
      items.sort((a, b) => String(b.consumed || "").localeCompare(String(a.consumed || "")));
      items = items.slice(0, limit);
      results.push(...items);
      console.log(`- ${source.name}: ${items.length} items`);
    } catch (error) {
      const kept = prevBySource.get(source.name) || [];
      results.push(...kept);
      console.warn(`- ${source.name}: FAILED (${error.message}); kept ${kept.length} cached`);
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of results) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  unique.sort(
    (a, b) => String(b.consumed || "").localeCompare(String(a.consumed || "")) || a.title.localeCompare(b.title)
  );

  const json = `${JSON.stringify(unique, null, 2)}\n`;
  const existing = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, "utf8") : "";
  if (json === existing) {
    console.log(`No changes (${unique.length} items).`);
  } else {
    writeFileSync(OUTPUT_PATH, json);
    console.log(`Wrote ${unique.length} items to ${OUTPUT_PATH}`);
  }
}

main().catch((error) => {
  console.error(`\u2717 ${error.message}`);
  process.exit(1);
});
