# AGENTS.md — Repo Context

## What This Repo Is
Personal GitHub Pages site (`mihir-kale.github.io`). Static HTML + Supabase backend. No build step, no package.json, no framework. Deploys automatically on push to `main`.

## Structure
- `portfolio/` — Landing page (HTML + CSS, Inter font, profile photo)
- `dashboard/` — "Personal OS" single-page app
  - `index.html` — monolithic: all HTML/CSS/JS in one file (~2760 lines)
- `media/` — Commonplace book: `index.html`, `styles.css`, `js/app.js|covers.js|data.js`, `data/library.json`, `data/feed-sources.json`, `data/feeds.json`, `scripts/add_media.js`, `scripts/push_media.mjs`, `scripts/sync_feeds.mjs`, `.github/workflows/sync-feeds.yml`. Curated entries live in the Supabase `media_entries` table (read by `loadEntries()` in `js/data.js`, which falls back to `data/library.json` if the backend is unreachable); RSS articles/podcasts load from `data/feeds.json`; both merge in `js/app.js`. `scripts/push_media.mjs` (dependency-free Node, service-role key from `.env`) upserts `library.json` into `media_entries`. `scripts/sync_feeds.mjs` (dependency-free Node) fetches `feed-sources.json`, parses RSS/Atom, excludes promo/coupon titles, caps per source, and rewrites `feeds.json`; a scheduled GitHub Action (`.github/workflows/sync-feeds.yml`, daily + `workflow_dispatch`) runs it and commits changes. Feed items always get `list: "shelf"`, `mediaType` from their source, and `source: "feed"`; the shelf displays at most 5 items per category (`SHELF_LIMIT` in `js/app.js`); articles/podcasts arrive via feeds, though manual entries (e.g. a recommended article) can be added with `scripts/add_media.js --list recommend`. Each shelf feed item has a small `×` (dismiss) that hides it via the Supabase `media_marks` table (keyed on the stable feed item id; `localStorage` under `media:dismissed:v1` is a local cache/fallback) plus a checkbox that promotes it into "my recommendations" (same `media_marks` row, `promoted` column; `media:promoted:v1` is the local fallback; the item renders in the recommend view — checked, no `×` — and unchecking sends it back to the shelf). Backend tables: `media_entries` (public read, owner/authenticated write), `media_marks` (public read + anon insert/update — the board has no login), and `media_suggestions` (the "recommend me something" form, anon insert-only) — per-type rails styled like reading lists (articles · essays · books · films · albums · podcasts) packed masonry-style: `js/app.js` measures each rail and drops it under the shortest column with a fixed gap, recomputing on resize. A global top-bar toggle switches every rail between `list: "recommend"` (default) and `list: "shelf"`; each `media_entries` row carries a `list` field. All six category rails always render, showing "nothing here yet" when empty. Search and spotlight-first ordering; no rating display. Also includes a "recommend me something" form rail (category dropdown, required title, why) that is always visible: on submit it POSTs to the Supabase `media_suggestions` table (anon insert-only RLS, no anon read; public anon key hardcoded in `js/data.js`, tables defined in gitignored `supabase/migrations/`) and keeps a localStorage echo under `media:suggestions:v1` so the submitter sees their own entries. Types: `article`, `essay`, `book`, `film`, `album`, `podcast` (`tv` retired). For `book`/`film`/`album` entries in `list: "recommend"` only, `js/covers.js` (`resolveCover`, with a `tmdb-api-key` meta) resolves cover art async — Google Books + Open Library for books, TMDb for films, iTunes for albums — rendered as a thumbnail on the right of the entry with the text squeezing left; shelf entries and entries with no image found stay full-width and text-only. Notes are clamped to two lines with a "more…" control that expands the entry; "more…" is hidden when the note already fits. Negative cover lookups are cached too.
- `.env` — secrets (gitignored)
- `supabase/` — gitignored (migrations)

## Dashboard App Details
- **Backend**: Supabase. Tables: `tasks`, `projects`, `people`, `calendar_events`
- **Auth**: Email/password via Supabase Auth (`signInWithPassword`). RLS gates all real data. Signed-out visitors get demo mode: the real dashboard preloaded with hardcoded sample data (via `loadDemoData()`), so every control — filters, Projects toggle, calendar, drag-drop — behaves exactly like the live app. While signed out nothing is fetched from or written to Supabase; edits mutate in-memory arrays only (`demoMode` guards every loader/write path).
- **Calendar**: Reads `calendar_events` table + live feed from the `calendar-proxy` edge function. Feed rows come from Outlook/Google, persist via RPC `sync_calendar_feed`, and dedupe by `external_id`. Each row has a `source` (`'feed'` = read-only, `'manual'` = editable time block).
- **Features**:
  - Tasks: title, due date, project, people, description, recurrence (daily/same-day weekly). No priority on tasks (projects keep priority).
  - Calendar: Day/Week views, time-blocking, feed events (read-only), recurrence for manual blocks, drag task→calendar to create a 1h block, drag calendar event→tasks creates a `TODO:` task, drag block→reschedule.
  - People: name, contact, last contact, description; multi-tag onto tasks/projects.
  - Projects: name, priority (low/medium/high/urgent), status (pending/done), people, description; bundles its tasks.
  - "NOW" panel (mobile): next imminent event or next active task.
  - Demo mode (signed-out): the real `#os` dashboard with sample tasks/projects/people/events from `demoTasksData()`/`demoProjectsData()`/`demoEventsData()`; topbar shows `#signInBtn` + `#tourBtn` and a `#demoBanner` notice, Projects hide toggle works. Feature tour (`TOUR_STEPS`) targets real panels (`#projectsPanel`, `#tasksPanel`, `#calPanel`). `demoMode = !signedIn` set in `applyAuthState()`; guarded writes snapshot to local STATE arrays and re-render.
- **Theme**: Light/dark mode (CSS custom properties, `data-theme="dark"` on root, persisted in localStorage under `personalOSTheme`).
- **Timezone**: `America/New_York` (constant `TZ`).
- **No frameworks** — vanilla JS, vanilla CSS, monospace font aesthetic.

## Key Patterns
- All JS is inline in a `<script>` tag at the bottom of `dashboard/index.html`.
- Supabase client initialized with hardcoded `SUPABASE_URL` + `SUPABASE_ANON_KEY` in JS (anon key is public by design; RLS protects data).
- Date helpers use `toLocaleDateString('en-CA', { timeZone: TZ })` for YYYY-MM-DD; `todayEt()`, `addDaysLocal()`, `weekStartOf()` (Monday start).
- IDs are nanoid-generated client-side via `crypto.getRandomValues`.
- Hidden events persisted in localStorage under `personalOSHiddenEvents`; `evKey()` = `ext:<external_id>` for feed, `id:<id>` for manual.
- Escaping via `escapeHtml()` on all innerHTML interpolation.
- Recurring manual blocks: DB stores an anchor row; render-time `expandRecurring()` clones virtual occurrences into the visible range. DB row never mutated.
- Drag-and-drop for tasks and calendar blocks.
- Other localStorage keys: `personalOSProjectsOpen`, `personalOSPeopleCollapsed`.
- Realtime: `postgres_changes` on `tasks` (if in realtime publication) + 60s task / 5min calendar polling fallback.

## Don'ts
- Don't add npm/node/build tooling or frameworks.
- Don't commit `.env` or `supabase/`.
- Don't expose secrets (Supabase anon key is public by design).
- Feed events (`source === 'feed'`) are read-only — never edit them in the DB.
