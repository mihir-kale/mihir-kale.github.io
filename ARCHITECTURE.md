# Architecture Summary — AI-Assisted Personal CRM & Project Management

## Problem

A personal task tree exists in Supabase (`nodes` table) but is owned by a legacy React tracker app. Adding new data types (people, events) or cross-entity relationships is impossible without breaking the tracker's sync. The system handles tasks but not the *context* around them — who's involved, what events connect to what, and structured outreach workflows.

## Goal

A person-task-event triad managed via natural language conversation with an AI agent (opencode), surfaced through a modern visualization, with calendar events auto-synced from Google Calendar and Outlook.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     THIRD-PARTY SYSTEMS                     │
│  Google Calendar ──┐                                        │
│  Outlook Calendar ─┼── ICS feed ──▶ fetch_calendar.py       │
│                    │                  (daily cron in GHA)    │
│  Strava ───────────┘                                        │
└─────────────────────────────────────────────────────────────┘
         │                                       │
         ▼                                       ▼
┌──────────────────┐                   ┌──────────────────┐
│ dashboard/data/  │                   │  Supabase CRM    │
│ calendar-events  │                   │  ┌──────────┐    │
│ .json (display)  │                   │  │ people   │    │
└──────────────────┘                   │  ├──────────┤    │
                                       │  │ events   │    │
┌──────────────────┐                   │  ├──────────┤    │
│  Legacy Tracker  │                   │  │ tasks    │    │
│  (nodes table)   │                   │  └──────────┘    │
│  independent     │                   │  RLS: public RW │
└──────────────────┘                   └────────┬─────────┘
                                                 │
                    ┌────────────────────────────┤
                    │                            │
                    ▼                            ▼
       ┌─────────────────────┐      ┌─────────────────────┐
       │  Argus/ (SSOT)      │      │  /crm/ (Vite/React) │
       │  Per-project .md    │      │  4-tab CRM viz     │
       │  files in Obsidian  │      │  Projects, People, │
       │  AI reads/writes    │      │  Events, Tasks     │
       │  via conversation   │      │  via Supabase REST │
       └─────────────────────┘      └─────────────────────┘
```

## Data Model

Three new tables, independent from the tracker's `nodes` table.

### `people`

Contacts with outreach lifecycle. Status pipeline: `cold` → `contacted` → `replied` → `meeting_scheduled` → `met` → `nurturing` → `closed`.

Key columns: `id` (21-char PK), `name`, `company`, `role`, `status`, `last_contacted_at`, `next_follow_up`, `source`.

### `events`

Meetings, phone screens, deadlines. FK → people.

Key columns: `id`, `title`, `event_date`, `event_type` (phone_screen, interview, meeting, deadline, social, other), `status` (tentative, confirmed, completed, cancelled), `person_id`.

### `tasks`

Flat tasks (no tree). FK → people and events.

Key columns: `id`, `title`, `status` (pending, in_progress, done, cancelled, blocked), `priority` (low, medium, high, urgent), `project` (string label for grouping), `person_id`, `event_id`.

### Relationships

- tasks.person_id → people.id  (task involves a person)
- tasks.event_id → events.id   (task relates to an event)
- events.person_id → people.id (event involves a person)

This creates the triad: every task can be linked to a person and an event, and every event can be linked to a person. No junction tables needed for the common case.

## System Components

### 1. Argus (Single Source of Truth)

Location: `~/Library/CloudStorage/OneDrive-.../Obsidian Vault/argus/`

Per-project markdown files structured as:
- Project goals
- People table (with CRM IDs)
- Events table (with CRM IDs)
- Active tasks (checklist with CRM IDs)
- Session log (timeline of changes)

An AI agent (opencode) reads these files for context, acts on Supabase CRM via REST API, and logs back to the markdown files. The markdown files are the source of truth for project documentation; the Supabase tables are the source of truth for actionable data (queried by the CRM app).

### 2. AI Agent (opencode)

Configured via `opencode.json` at repo root. References:
- `argus/` directory for project context
- `AGENTS.md` for system instructions

Workflow:
1. User makes a natural language request ("Add a task to message Hrishikesh before the phone screen")
2. Agent reads relevant Argus file for context
3. Agent CRUDs people/events/tasks tables via Supabase REST API
4. Agent writes session notes back to Argus file
5. Agent confirms what changed

Supabase REST API:
- Base: `https://heyrtjzntnicqsfemcmi.supabase.co/rest/v1/`
- Auth: anon key (public, RLS-protected)
- Operations: GET (list), POST (insert/upsert), PATCH (update), DELETE

### 3. Calendar Sync

`scripts/fetch_calendar.py` (run daily via GitHub Actions):
- Fetches ICS feeds from Google Calendar and Outlook
- Parses events for a 7-day-past to 30-day-future window
- Writes JSON to `dashboard/data/calendar-events.json` (legacy dashboard widget)
- Upserts each event into the CRM `events` table (stable ID from ICS UID hash)
- Infers `event_type` from title keywords

### 4. CRM Web App (`/crm/`)

Vite/React single-page app served at `mihir-kale.github.io/crm/`.

Four tabs:
- **Projects** — Tasks grouped by `project` label. Shows active/done counts, linked people and events, active task list with checkboxes and priority badges.
- **People** — Directory of contacts. Shows status badge, company/role, linked tasks and events.
- **Events** — Timeline sorted by date. Shows status, linked person, linked tasks.
- **Tasks** — Full flat task list grouped by project. Shows linked person, event, priority.

All data fetched from Supabase REST API via `@supabase/supabase-js`. Joins done client-side for simplicity.

### 5. Legacy Tracker

The existing `tracker/` app (Vite/React, tree-based task manager) is preserved. It owns the `nodes` table via full-state sync (localStorage ↔ Supabase). The CRM system operates on separate tables and does not interfere.

### 6. Dashboard

The existing `dashboard/` app (static HTML/JS) continues to display calendar events from JSON and tasks from the `nodes` table. It has not been modified to read from the new CRM tables.

## Deployment

- GitHub Pages auto-deploys from `main` branch.
- `/crm/` is served from `crm/index.html` with assets at `crm/assets/`.
- Daily cron via `.github/workflows/update-fitness-data.yml`.
- Current live: [mihir-kale.github.io/crm/](https://mihir-kale.github.io/crm/)

## Design Decisions & Trade-offs

| Decision | Rationale |
|---|---|
| Separate tables from tracker's `nodes` | Tracker uses full-state sync (upsert all + delete orphans). Co-owning `nodes` would cause data loss. |
| Flat tasks instead of tree | The person-task-event use case doesn't need hierarchy. A `project` label is sufficient for grouping. |
| Client-side joins (no PostgREST embedded) | Simpler to implement and debug. Three tables + 12-50 rows each; no performance concern. |
| Anon key in public HTML | Same pattern as dashboard. RLS policies allow all operations; no auth wall needed for a personal tool. |
| ICS-based calendar sync instead of OAuth | ICS feeds are read-only and don't need token refresh. Google and Outlook both publish ICS URLs for public calendars. |
| Vite/React for CRM app | Matches tracker's tech stack. Component model suits the tabbed multi-view layout. |
| Argus in Obsidian vault | User already uses Obsidian. Markdown is portable, versionable, and AI-readable. No new tool required. |

## Current State

- 6 people seeded
- 5 events (3 manual + calendar-synced)
- 12 tasks across 5 projects
- 7 Argus project files
- 53 tracker nodes (untouched)

## Future Considerations

- Supabase as backend-as-a-service is free-tier sufficient at this scale
- If data grows, consider adding PostgREST embedded joins to reduce client-side work
- If auth is needed, Supabase Auth can be added without schema changes
- If the tracker is eventually deprecated, `nodes` data could be migrated into `tasks`
