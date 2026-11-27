// Dependency-free RSS 2.0 / Atom parsing for the feed ingestion job.
// Node 18+ is enough: no XML package, no build step.

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  copy: "\u00a9",
  trade: "\u2122",
  reg: "\u00ae",
  euros: "\u20ac",
  pound: "\u00a3"
};

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "igshid",
  "vero_id",
  "spm",
  "cmpid"
]);

const DESCRIPTION_LIMIT = 4000;
const TITLE_LIMIT = 500;
const AUTHOR_LIMIT = 200;

export function decodeEntities(value) {
  return String(value ?? "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, entity) ? ENTITIES[entity] : match;
  });
}

export function unwrapCdata(value) {
  return String(value ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

export function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

export function cleanText(value) {
  // Decode first so escaped markup (&lt;p&gt;) is stripped like real markup.
  return stripHtml(decodeEntities(unwrapCdata(value))).replace(/\s+/g, " ").trim();
}

function isTrackingParam(key) {
  const name = String(key).toLowerCase();
  return name.startsWith("utm_") || TRACKING_PARAMS.has(name);
}

// Canonical URL = the permalink with volatile tracking/fragment noise removed.
// This is the dedupe key stored in articles.url, so it must be stable across runs.
export function canonicalizeUrl(value) {
  const raw = cleanText(value);
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...url.searchParams.keys()]) {
    if (isTrackingParam(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  const path = url.pathname.replace(/\/+$/, "") || "/";
  url.pathname = path;
  return url.toString();
}

// Replace CDATA payloads with same-length blanks so block offsets still line up
// with the original document, without accidentally matching tags inside CDATA.
function maskCdata(xml) {
  return xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body) => `<![CDATA[${" ".repeat(body.length)}]]>`);
}

function structural(block) {
  return block.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagContent(block, tag) {
  const name = escapeRegExp(tag);
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? match[1] : "";
}

function parseAttrs(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function extractCanonicalUrl(xml) {
  let href = "";

  // FeedBurner and explicit canonical links outrank the generic item link.
  for (const tag of ["feedburner:origLink", "origLink"]) {
    href = cleanText(tagContent(xml, tag));
    const canonical = canonicalizeUrl(href);
    if (canonical) return canonical;
  }

  const links = [];
  for (const match of xml.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.href) continue;
    links.push(attrs);
  }

  const canonical = links.find((attrs) => (attrs.rel || "").toLowerCase() === "canonical")?.href;
  const alternate = links.find((attrs) => (attrs.rel || "alternate").toLowerCase() === "alternate")?.href;
  const first = links[0]?.href;
  for (const candidate of [canonical, alternate, first]) {
    const normalized = canonicalizeUrl(candidate);
    if (normalized) return normalized;
  }

  const rssLink = canonicalizeUrl(tagContent(xml, "link"));
  if (rssLink) return rssLink;

  const guidMatch = xml.match(/<guid\b([^>]*)>([\s\S]*?)<\/guid>/i);
  if (guidMatch) {
    const attrs = parseAttrs(guidMatch[1]);
    if ((attrs.ispermalink ?? "true").toLowerCase() !== "false") {
      return canonicalizeUrl(tagContent(xml, "guid"));
    }
  }

  return null;
}

function extractPublishedAt(xml) {
  for (const tag of ["pubDate", "published", "dc:date", "updated", "lastBuildDate"]) {
    const value = cleanText(tagContent(xml, tag));
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return null;
}

function extractAuthor(xml) {
  for (const tag of ["dc:creator", "author", "itunes:author", "by"]) {
    const raw = tagContent(xml, tag);
    const nested = raw.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i);
    const value = cleanText(nested ? nested[1] : raw);
    if (value) return value.slice(0, AUTHOR_LIMIT);
  }
  return null;
}

function extractDescription(raw) {
  for (const tag of ["content:encoded", "description", "summary", "content"]) {
    const value = cleanText(tagContent(raw, tag));
    if (!value) continue;
    return value.length > DESCRIPTION_LIMIT ? `${value.slice(0, DESCRIPTION_LIMIT - 1)}\u2026` : value;
  }
  return null;
}

function normalizeItem({ raw, xml }) {
  const url = extractCanonicalUrl(xml);
  if (!url) return null;

  const title = cleanText(tagContent(raw, "title"));
  return {
    url,
    title: title ? title.slice(0, TITLE_LIMIT) : null,
    author: extractAuthor(raw),
    description: extractDescription(raw),
    publishedAt: extractPublishedAt(xml)
  };
}

export function parseFeed(xml) {
  const source = String(xml ?? "");
  const masked = maskCdata(source);
  const blocks = [];

  for (const pattern of [/<item\b[\s\S]*?<\/item>/gi, /<entry\b[\s\S]*?<\/entry>/gi]) {
    for (const match of masked.matchAll(pattern)) {
      const raw = source.slice(match.index, match.index + match[0].length);
      blocks.push(normalizeItem({ raw, xml: structural(raw) }));
    }
  }

  return blocks.filter(Boolean);
}
