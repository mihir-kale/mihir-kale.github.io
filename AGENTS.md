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

## Dashboard Widgets

| Widget | Source | Notes |
|---|---|---|
| Calendar | `events` table | Today + next 5 days, Eastern Time |
| Tasks | `nodes` table | Links to tracker, group by parent |
| Training | `planned_workouts` + `strava_*` tables | Next workout card + weekly stats (KM, VOLUME, SETS) |
| Nutrition | `planned_meals` + `nutrition` tables | Meal queue with checkboxes, snack quick-add |
| Applications | `applications` table | Status badges: Needs Action, Pending, Offer, Rejected |
| Pomodoro | Local state | 25-min timer, always visible |

Read and Listen widgets are disabled (code preserved, Spotify polling off).

## Key Files

- `dashboard/index.html` — Dashboard app (all CSS/JS inline)
- `tracker/index.html` — Vite/React task planner app (auth-gated)
- `tracker/assets/index-CY4Ktyp3.js` — Compiled tracker bundle (do not edit directly)
- `scripts/fetch_rss.py` — Fetches RSS feeds, writes `dashboard/data/read-feeds.json`

The compiled CRM app (`crm/`), `archon/`, `opencode.json`, and `fetch_calendar.py` were removed from this repo — they live in `mihirOS/tools/` and `mihirOS/opencode.json` instead. The dashboard calendar reads the `events` table directly (no JSON).

## Training module

Training/workout content lives in `mihirOS/training/` (sibling of this repo in the mihirOS monorepo), not here. That includes `workout.md` (training preferences, restrictions, goals), the training app (`app/index.html`), the Strava/Hevy pipeline (`scripts/fetch_strava.py`, `scripts/seed_planned_workouts.sql`, `scripts/migrate_strava_to_supabase.sql`), and a local `.env` copy.

**When to use**: Read `mihirOS/training/workout.md` before creating or modifying `planned_workouts` / `planned_exercises` rows. Respect the constraints (equipment, volume caps, muscle group splits). Never add exercises not in the approved library without asking.

The dashboard still renders its Training widget from `planned_workouts` + `strava_*` tables live from Supabase, so no data changes are needed here.

## Supabase

- Project ID: `heyrtjzntnicqsfemcmi`
- URL: `https://heyrtjzntnicqsfemcmi.supabase.co`
- Anon key is in `dashboard/index.html` and `tracker/index.html` (RLS-protected)
- RLS: all personal-data tables are `authenticated`-only (see `supabase/migrations/20260802100000_secure_rls.sql`). The anon key can read nothing. Sign in is required; `enable_signup = false` recommended.

### Tables

| Table | Purpose |
|---|---|
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

## Scripts & CI

- `.github/workflows/update-fitness-data.yml` — Manual (`workflow_dispatch` only; auto-run removed)
  - Strava step is stubbed out (script moved to `mihirOS/training/scripts/`; CI wiring not yet settled)
  - Calendar/RSS fetch and the data-commit steps were removed (calendar now reads the `events` table; `read-feeds.json` is committed as a static asset)
- Requires GitHub secrets: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

## Resume Engine

**Location:** `mihirOS/career/applications/resume_engine/` (moved out of this repo).

AI-powered resume and cover letter generator that tailors content to specific job descriptions using GPT-4o-mini.

### Quick Start

```bash
# Web UI (recommended)
python app.py
# Open http://localhost:5001

# CLI: basic generation
python main.py job_descriptions/<job>.txt [--cover-letter/--no-cover-letter]

# Two-pass: tailor then verify through skeptical hiring manager lens
python two_pass_analysis.py job_descriptions/<job>.txt
```

### Key Files

| File | Purpose |
|---|---|
| `resume_content.md` | Source of truth for all resume content — edit here first |
| `ai_customizer.py` | GPT-4o-mini prompts for resume + cover letter |
| `docx_generator.py` | Populates `template.docx` with tailored content |
| `cover_letter_generator.py` | Builds cover letter DOCX from scratch |
| `main.py` | CLI entry point, orchestrates pipeline |
| `two_pass_analysis.py` | AI analysis: tailor → verify with skeptical hiring manager |
| `job_descriptions/` | Save job descriptions as `<slug>.txt` here |

### Constraints
- **Education is frozen** — never modified by AI
- **Template is immutable** — `template.docx` is fixed
- **ATS keywords** injected as white font at 1pt (hidden from humans, readable by parsers)
- Output goes to `output/<job_slug>/` as PDF

### Workflow
1. Save job description to `job_descriptions/<slug>.txt`
2. Run `python main.py job_descriptions/<slug>.txt` or use web UI
3. Output appears in `output/<slug>/` as PDF + optional cover letter

## Conventions

- All dates use Eastern Time (`America/New_York`) via `todayEt()` helper
- Node IDs are random 21-char strings via `crypto.getRandomValues`
- Dashboard uses `esc()` for XSS protection on all innerHTML interpolations
- `fetchWithRetry(url, retries)` with exponential backoff for JSON fetches
- Nutrition date check piggybacks on 30-second Spotify interval (now only checks nutrition)
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
