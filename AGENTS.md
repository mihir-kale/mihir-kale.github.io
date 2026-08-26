# AGENTS.md — mihir-kale.github.io

## Project Overview

Personal dashboard + task planner deployed as a GitHub Pages site.

## Structure

- `dashboard/` — Main dashboard app, served at `mihir-kale.github.io/dashboard/`
- `tracker/` — Hierarchical task planner, served at `mihir-kale.github.io/tracker/`
- `scripts/` — Data fetch scripts (calendar, RSS; Strava moved to mihirOS/training)
- `.github/workflows/` — Daily cron to fetch external data
- Root (`index.html`, etc.) — Public website profile (WIP)

## Stack

- Frontend: Single-page app in `dashboard/index.html` (inline CSS/JS, no build step)
- Backend: Supabase (Postgres + REST API) for all persistence
- Auth: Supabase email/password auth
- Hosting: GitHub Pages (`mihir-kale.github.io`)

## Dashboard Layout

Single auth-gated page with two panels (all dark theme, Eastern Time):

| Panel | Source | Notes |
|---|---|---|
| Timeline (left) | `actionables` + Outlook ICS (via `calendar-proxy` edge function) | 6 AM – 10 PM day view; blocks positioned by time; drag to move/resize; click to edit; calendar events auto-populate as read-only blocks |
| Backlog (right) | `actionables` table | Unscheduled actionables with filter tabs (All/Scheduled/Pending); drag to timeline to schedule; + button to add new |

The dashboard is built around one concept: **actionables** (title + time block + completed). No goals, no cycles, no taxonomy. Calendar events from the `calendar-proxy` edge function auto-appear on the timeline as reference blocks.

## Key Files

- `dashboard/index.html` — Dashboard app (all CSS/JS inline)
- `goals/index.html` — Goals app (cycle management + daily allocations)
- `tracker/index.html` — Vite/React task planner app (auth-gated)
- `tracker/assets/index-CY4Ktyp3.js` — Compiled tracker bundle (do not edit directly)
- `scripts/fetch_rss.py` — Fetches RSS feeds, writes `dashboard/data/read-feeds.json`

The compiled CRM app (`crm/`), `archon/`, `opencode.json`, and `fetch_calendar.py` were removed from this repo — they live in `mihirOS/tools/` and `mihirOS/opencode.json` instead. The dashboard calendar merges the `events` table with the Outlook ICS feed from the `calendar-proxy` edge function.

## Training module

Training/workout content lives in `mihirOS/training/` (sibling of this repo in the mihirOS monorepo), not here. That includes `workout.md` (training preferences, restrictions, goals), the training app (`app/index.html`), the Strava/Hevy pipeline (`scripts/fetch_strava.py`, `scripts/seed_planned_workouts.sql`, `scripts/migrate_strava_to_supabase.sql`), and a local `.env` copy.

**When to use**: Read `mihirOS/training/workout.md` before creating or modifying `planned_workouts` / `planned_exercises` rows. Respect the constraints (equipment, volume caps, muscle group splits). Never add exercises not in the approved library without asking.

The rebuilt dashboard (tasks + calendar only) does not read training tables. No data changes are needed here.

## Supabase

- Project ID: `heyrtjzntnicqsfemcmi`
- URL: `https://heyrtjzntnicqsfemcmi.supabase.co`
- Anon key is in `dashboard/index.html` and `tracker/index.html` (RLS-protected)
- RLS: all personal-data tables are `authenticated`-only (see `supabase/migrations/20260802100000_secure_rls.sql` and `supabase/migrations/20260826000000_actionables.sql`). The anon key can read nothing. Sign in is required; `enable_signup = false` recommended.

### Tables

| Table | Purpose |
|---|---|
| `actionables` | Core dashboard items: title + time block + completed |
| `nodes` | Task tree (tracker) |
| `people` | Contacts with outreach lifecycle |
| `events` | Phone screens, meetings, deadlines |
| `tasks` | Flat tasks linked to people & events |
| `projects` | Project registry with active/dormant status |
| `applications` | Job application tracking (saved → → offer/rejected) |
| `planned_workouts` | Upcoming workout sessions |
| `planned_exercises` | Exercises within planned workouts |
| `strava_activities` | Cardio activities from Strava |
| `strava_workouts` | Strength sessions from Strava |
| `strava_exercises` | Parsed Hevy exercises (sets, reps, weight_kg) |
| `planned_meals` | Daily meal calorie budgets |
| `nutrition` | Logged food intake |
| `daily_logs` | Daily task completion stats |
| `goals` | Macro/meso/micro cycle goals |
| `goal_tasks` | Daily allocations within a microcycle |

## Scripts & CI

- `.github/workflows/update-fitness-data.yml` — Manual (`workflow_dispatch` only; auto-run removed)
  - Strava step is stubbed out (script moved to `mihirOS/training/scripts/`; CI wiring not yet settled)
  - Calendar/RSS fetch and the data-commit steps were removed (calendar now reads the `events` table; `read-feeds.json` is committed as a static asset)
- Requires GitHub secrets: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

## Resume Engine

**Location:** `resume_engine/` (sibling of this repo, at `~/repos/resume_engine/`).

Simple deterministic JSON → PDF resume renderer. No AI, no API keys, no DOCX. All AI tailoring scripts (generate.py, direct_ask.py, fit_review.py) and the duplicate ApplyAI copies were removed.

### Quick Start

```bash
python3.12 render.py                      # input/content.json -> output/<name>.pdf
python3.12 render.py input/content.json   # explicit file
python3.12 render.py --jd input/job.txt   # inject ATS keywords (white font) from a JD
```

Edit `input/content.json`, then run `render.py`. Output filename is derived from the `header.name` + `output.company` / `output.job_id` fields.

### Key Files

| File | Purpose |
|---|---|
| `render.py` | CLI entry point: JSON → PDF |
| `pdf_generator.py` | Direct PDF layout (Times New Roman, 0.5" margins) |
| `sections.py` | Section schema (education / experience / leadership) |
| `ats_keywords.py` | Deterministic ATS keyword extraction (used with `--jd`) |
| `parser.py` | Parses JD files (TXT/PDF/DOCX) for ATS extraction |
| `input/content.json` | Resume content to render |

### Content JSON Schema
- `header` — `name`, `contact`, `email`, `linkedin`
- `education[]` — `institution`, `location`, `date`, `degree`, `details[]`
- `experience[]` — `company`, `location`, `dates`, `title`, `bullets[]`, optional `future`
- `leadership[]` — `organization`, `location`, `dates`, `title`, `bullets[]`, optional `future`
- `additional` — `bullets[]`
- `output` — `company`, `job_id` (used only for the filename)

## Conventions

- All dates use Eastern Time (`America/New_York`) via `todayEt()` helper
- Node IDs are random 21-char strings via `crypto.getRandomValues`
- Dashboard uses `esc()` for XSS protection on all innerHTML interpolations
- Dashboard and tracker are both auth-gated (Supabase email/password); all Supabase tables require `authenticated` role
- After editing `dashboard/index.html`, commit and push — GitHub Pages auto-deploys on push to `main`

## Argus — AI Project Management

Retired. Argus per-project markdown files and the Obsidian vault references were removed; live project tracking moved to `mihirOS/now/` and `mihirOS/career/`. The Supabase REST API below still applies for CRM data.

### NL Workflow

You talk to me in natural language. I:

1. **Read** the relevant project file in `mihirOS/now/`, `mihirOS/career/`, or `mihirOS/training/` for context
2. **Act** via Supabase REST API (CRUD on `nodes`, `planned_workouts`, `planned_meals`, etc.)
3. **Write** session notes back to the relevant markdown file
4. **Confirm** what changed

### Supabase REST API

Base URL: `https://heyrtjzntnicqsfemcmi.supabase.co/rest/v1/`
Headers: `apikey` + `Authorization: Bearer`. The anon key can no longer read or write personal tables (RLS = `authenticated` only). Use a user session token (JWT from `supabase.auth`) or the service-role key for scripted access.

| Operation | Method | Endpoint |
|---|---|---|
| List rows | `GET` | `/table?select=*&column=eq.value` |
| Insert | `POST` | `/table` |
| Upsert | `POST` | `/table?on_conflict=id` |
| Update | `PATCH` | `/table?column=eq.value` |
| Delete | `DELETE` | `/table?column=eq.value` |

### Project Markdown Convention

```markdown
# Project Name

## Goals
- ...

## Active Tasks
- [ ] Task title (tracker node: `{id}`)
- [x] Done task (tracker node: `{id}`)

## Session Log
### 2026-07-29
- What was done
- Decisions made
```

### CRM Entity Schemas

The `people`, `events`, and `tasks` tables are the core CRM. They are managed by me (the AI) via REST API and are independent of the tracker's `nodes` table.

#### people

| Field | Type | Notes |
|---|---|---|
| `id` | text (21-char PK) | Generated at creation |
| `name` | text | Required |
| `company` | text | |
| `role` | text | |
| `email` | text | |
| `phone` | text | |
| `linkedin_url` | text | |
| `notes` | text | |
| `status` | text | `cold`, `contacted`, `replied`, `meeting_scheduled`, `met`, `nurturing`, `closed` |
| `last_contacted_at` | timestamptz | |
| `next_follow_up` | date | |
| `source` | text | How we found them |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### events

| Field | Type | Notes |
|---|---|---|
| `id` | text (21-char PK) | |
| `title` | text | Required |
| `description` | text | |
| `event_date` | date | Required |
| `start_time` | time | |
| `end_time` | time | |
| `timezone` | text | Default `America/New_York` |
| `location` | text | |
| `event_type` | text | `phone_screen`, `interview`, `meeting`, `deadline`, `social`, `other` |
| `status` | text | `tentative`, `confirmed`, `completed`, `cancelled` |
| `person_id` | text | FK → people |
| `url` | text | Zoom/Meet link |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### projects

| Field | Type | Notes |
|---|---|---|
| `id` | text (PK) | MD5 hash |
| `name` | text | Unique project label matching `tasks.project` |
| `status` | text | `active` or `dormant` — dormant projects hidden from dashboard |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### applications

| Field | Type | Notes |
|---|---|---|
| `id` | text (21-char PK) | |
| `company` | text | Required |
| `role` | text | Required |
| `location` | text | |
| `posting_url` | text | |
| `status` | text | `Needs Action`, `Pending`, `Rejected`, `Offer` |
| `priority` | text | `low`, `medium`, `high`, `urgent` |
| `applied_date` | date | |
| `person_id` | text | FK → people (recruiter/hiring manager) |
| `notes` | text | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### tasks

| Field | Type | Notes |
|---|---|---|
| `id` | text (21-char PK) | |
| `title` | text | Required |
| `description` | text | Default `''` |
| `status` | text | `pending`, `in_progress`, `done`, `cancelled`, `blocked` |
| `priority` | text | `low`, `medium`, `high`, `urgent` |
| `due_date` | date | |
| `estimated_minutes` | int | |
| `project` | text | Label for grouping, matches `projects.name` |
| `person_id` | text | FK → people |
| `event_id` | text | FK → events |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### goals

| Field | Type | Notes |
|---|---|---|
| `id` | text (21-char PK) | |
| `title` | text | Required |
| `description` | text | Qualitative goal description |
| `cycle_type` | text | `micro` (2wk), `meso` (6wk), `macro` (12wk) |
| `start_date` | date | Required |
| `end_date` | date | Required |
| `status` | text | `active`, `completed`, `archived` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### goal_tasks

| Field | Type | Notes |
|---|---|---|
| `id` | text (21-char PK) | |
| `goal_id` | text | FK → goals (CASCADE delete) |
| `day_date` | date | Which day this allocation is for |
| `description` | text | What to do that day |
| `status` | text | `pending`, `done` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
