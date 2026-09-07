# AGENTS.md — Repo Context

## What This Repo Is
Personal GitHub Pages site (`mihir-kale.github.io`). Static HTML + Supabase backend. No build step, no package.json, no framework. Deploys automatically on push to `main`.

## Structure
- `portfolio/` — Landing page (HTML + CSS, Inter font, profile photo)
- `dashboard/` — "Personal OS" single-page app
  - `index.html` — monolithic: all HTML/CSS/JS in one file (~2350 lines)
  - `data/read-feeds.json` — cached RSS/reading feed data (committed static asset)
- `media/` — Commonplace book (books, films, music): `index.html`, `styles.css`, `js/app.js|covers.js|data.js`, `data/library.json`, `scripts/add_media.js`
- `.github/workflows/update-fitness-data.yml` — GitHub Action (manually dispatched; Strava step stubbed)
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
  - Demo mode (signed-out): the real `#os` dashboard with sample tasks/projects/people/events from `demoTasksData()`/`demoProjectsData()`/`demoEventsData()`; topbar shows `#signInBtn` + `#tourBtn` and a `#demoBanner` notice, Projects hide toggle works. Feature tour (`TOUR_STEPS`) targets real panels (`#projectsPanel`, `#tasksPanel`, `#calPanel`, `#signInBtn`). `demoMode = !signedIn` set in `applyAuthState()`; guarded writes snapshot to local STATE arrays and re-render.
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
