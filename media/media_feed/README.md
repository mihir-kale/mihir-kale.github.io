# media_feed

Persistent RSS reading queue: a GitHub Actions cron job pulls every enabled
feed and upserts normalized articles into Supabase. No npm dependencies or
build step — Node 18+ and `fetch` are enough.

## Layout

- `supabase/migrations/` — `sources`, `articles`, `reviews` tables, RLS, indexes, and seed feeds.
- `lib/rss.mjs` — dependency-free RSS 2.0 / Atom parsing and canonical URL normalization.
- `lib/supabase.mjs` — small Supabase REST client and the metadata-only update builder.
- `scripts/ingest.mjs` — the ingestion job.
- `../../.github/workflows/media-feed-ingest.yml` — runs the job every six hours and on demand (workflows must live at the repo root, which is the parent `mihir-kale.github.io` repo today).
- `test/ingest.test.mjs` — `node --test` unit tests.

## Setup

1. Apply the migrations to your Supabase project (SQL Editor, `supabase db push --linked`, etc.).
   The first migration creates the tables; the second seeds the feeds carried over from
   `media/data/feed-sources.json`; `20261127000000_media_feed_sources.sql` replaces that
   list with the current 13 enabled sources. This directory is linked to
   `gzwhuwzmrrmtswyhjheu`.
   The seven `*_baseline.sql` files are no-op markers matching migration versions that
   already exist on that remote project; they let `supabase db push --linked` work from
   this standalone repo without reapplying anything.
2. Add repository secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service-role
   key bypasses RLS for ingestion and must never be committed.
3. Manage feeds in the `sources` table (`name`, `rss_url`, `enabled`). Only `enabled = true`
   rows are fetched. Re-running the seed migration will not overwrite changes to `enabled`.
4. Optionally run the workflow manually with `workflow_dispatch`.

For a local run, copy `.env.example` to `.env`, fill in the two values, then:

```sh
node scripts/ingest.mjs
node --test
```

## Data model

- `sources`: `id`, `name` (unique), `rss_url`, `enabled`, timestamps.
- `articles`: `id`, `source_id`, `title`, `author`, `url` (unique), `description`,
  `published_at`, `discovered_at`, `status`, `priority`, `recommendation_reason`,
  `read_at`, `updated_at`.
  - Statuses: `unreviewed` (default), `queued`, `dismissed`, `read`.
  - `priority` is a nullable ranking; lower numbers rank higher.
- `reviews`: `id`, `article_id` (unique), `body` (Markdown), `status`, `created_at`,
  `updated_at`, `published_at`. Statuses: `draft` (default), `published`.

RLS is enabled on all three tables. The public media page reads `articles`
through the `article_shelf` view (last 7 days, with source name only); the base
tables, reading state, ranking, reasons, `reviews`, and all writes remain
owner-only. The ingestion job uses the service role.

## Ingestion behavior

- Canonical URL (stored in `articles.url`) is lowercased-host, `www.`-stripped, fragment-free,
  tracking-param-free (`utm_*`, `fbclid`, `gclid`, etc.), trailing-slash-stripped, and has
  sorted query params. FeedBurner `origLink`, explicit `rel="canonical"`, Atom `alternate`,
  RSS `<link>`, then a permalink `<guid>` are tried in that order. This is the dedupe key,
  both within and across feeds (first feed by name wins).
- Feeds are processed in alphabetical order. A failed fetch/parse for one feed is logged and
  skipped; the remaining feeds still ingest. The job exits non-zero only if every enabled
  feed fails or the retention prune fails.
- Promotional titles (coupon/promo/discount codes, `deal of the day`, `N% off`, `save N%`)
  are skipped before dedupe. Legitimate articles that merely discuss discounts are kept.
- Strict 7-day retention: items older than the run start minus 7 days are skipped on pull,
  and every existing `articles` row older than that cutoff is deleted after ingestion
  (reviews cascade). Undated items are treated as discovered now, so they age out after
  the same window. Reading state is preserved for rows still inside the window.
- New articles get `status = 'unreviewed'`, empty ranking/reason, and `discovered_at` set to
  the run start time. Re-ingestion sends `PATCH` updates containing **only** feed-owned
  metadata (title, author, description, published_at when available). `id`, `source_id`,
  `discovered_at`, `status`, `priority`, `recommendation_reason`, `read_at`, and all reviews
  are never touched. Missing metadata on a later fetch does not erase existing values.
- Results are logged as JSON lines: `run_start` (with cutoff), `existing_articles`,
  `source_start`, `source_result` (per-feed fetched/inserted/updated/duplicates/skipped/
  promotions/too_old/error), `prune_result`, and `run_summary`. GitHub Actions retains these logs;
  no secrets are printed.
