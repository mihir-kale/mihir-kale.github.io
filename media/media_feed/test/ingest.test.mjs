import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl, parseFeed } from "../lib/rss.mjs";
import { buildArticleUpdate } from "../lib/supabase.mjs";

test("canonicalizeUrl produces a stable dedupe key", () => {
  assert.equal(
    canonicalizeUrl("https://www.Example.com/post/?utm_source=rss&b=2&a=1#comments"),
    "https://example.com/post?a=1&b=2"
  );
  assert.equal(canonicalizeUrl("https://example.com/a/"), "https://example.com/a");
  assert.equal(canonicalizeUrl("mailto:someone@example.com"), null);
  assert.equal(canonicalizeUrl("not a url"), null);
});

test("parseFeed normalizes a CDATA RSS 2.0 item", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item>
      <title><![CDATA[A &amp; B]]></title>
      <link>https://www.example.com/a/?utm_source=rss</link>
      <dc:creator><![CDATA[Jane Doe]]></dc:creator>
      <pubDate>Thu, 26 Nov 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
    </item>
  </channel></rss>`;

  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    url: "https://example.com/a",
    title: "A & B",
    author: "Jane Doe",
    description: "Hello world",
    publishedAt: "2026-11-26T12:00:00.000Z"
  });
});

test("parseFeed prefers the Atom alternate link over self/canonical feed links", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title type="html">Atom post</title>
      <link rel="self" href="https://example.com/feed.xml"/>
      <link rel="alternate" href="https://www.example.com/atom?utm_medium=feed"/>
      <updated>2026-11-25T10:00:00Z</updated>
      <author><name>Ada</name></author>
      <summary type="html">&lt;p&gt;Summary&lt;/p&gt;</summary>
    </entry>
  </feed>`;

  const [item] = parseFeed(xml);
  assert.equal(item.url, "https://example.com/atom");
  assert.equal(item.title, "Atom post");
  assert.equal(item.author, "Ada");
  assert.equal(item.description, "Summary");
  assert.equal(item.publishedAt, "2026-11-25T10:00:00.000Z");
});

test("buildArticleUpdate never changes reading state, ranking or reviews", () => {
  const patch = buildArticleUpdate({
    title: "Title",
    author: "Author",
    description: "Description",
    publishedAt: "2026-11-26T00:00:00.000Z"
  });

  assert.deepEqual(Object.keys(patch).sort(), ["author", "description", "published_at", "title"]);
  for (const field of ["id", "source_id", "discovered_at", "status", "priority", "recommendation_reason", "read_at", "article_id", "body"]) {
    assert.ok(!(field in patch), `${field} must not be overwritten by ingestion`);
  }
});
