# AGENTS.md

## Project Overview

Personal dashboard + task planner deployed as a GitHub Pages site.

## Structure

- `dashboard/` — Main dashboard app, served at `mihir-kale.github.io/dashboard/`
- `tracker/` — Hierarchical task planner, served at `mihir-kale.github.io/tracker/`
- `scripts/` — Data fetch scripts (Strava, calendar, RSS)
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
| Calendar | `calendar-events.json` (GitHub Action) | Today + next 5 days, Eastern Time |
| Tasks | `nodes` table | Links to tracker, group by parent |
| Training | `planned_workouts` + `strava_*` tables | Next workout card + weekly stats (KM, VOLUME, SETS) |
| Nutrition | `planned_meals` + `nutrition` tables | Meal queue with checkboxes, snack quick-add |
| Pomodoro | Local state | 25-min timer, always visible |

Read and Listen widgets are disabled (code preserved, Spotify polling off).

## Key Files

- `dashboard/index.html` — Dashboard app (all CSS/JS inline)
- `tracker/index.html` — Vite/React task planner app
- `tracker/assets/index-CY4Ktyp3.js` — Compiled tracker bundle (do not edit directly)
- `scripts/fetch_strava.py` — Fetches Strava activities, parses Hevy workouts, upserts to Supabase
- `scripts/fetch_calendar.py` — Parses ICS feeds, writes `dashboard/data/calendar-events.json`
- `scripts/fetch_rss.py` — Fetches RSS feeds, writes `dashboard/data/read-feeds.json`
- `scripts/migrate_strava_to_supabase.sql` — SQL migration for Supabase tables
- `workout.md` — Training preferences, restrictions, and goals (gitignored, local only)

## workout.md

Reference file for generating or updating planned workouts in Supabase. Contains:

- **Daily non-negotiables**: pull-ups + push-ups every day (separate from strength sessions)
- **Weekly schedule**: Sun rest, Mon/Wed/Fri strength, Tue/Thu/Sat runs
- **Strength rules**: 2 sets to failure per exercise, max 14 sets/session, varied exercises across days, each day covers chest/back/shoulders/abs
- **Running rules**: zone 2 base, tempo intervals for quality, builds medium → long → longest
- **Equipment**: DBs, KBs, barbell, pull-up bar, bench (no cables)
- **Approved exercise library**: by muscle group

**When to use**: Read `workout.md` before creating or modifying `planned_workouts` / `planned_exercises` rows. Respect the constraints (equipment, volume caps, muscle group splits). Never add exercises not in the approved library without asking.

## Supabase

- Project ID: `heyrtjzntnicqsfemcmi`
- URL: `https://heyrtjzntnicqsfemcmi.supabase.co`
- Anon key is in `dashboard/index.html` (RLS-protected)
- RLS enabled with public read/write policy on all tables

### Tables

| Table | Purpose |
|---|---|
| `nodes` | Task tree (tracker) |
| `planned_workouts` | Upcoming workout sessions |
| `planned_exercises` | Exercises within planned workouts |
| `strava_activities` | Cardio activities from Strava |
| `strava_workouts` | Strength sessions from Strava |
| `strava_exercises` | Parsed Hevy exercises (sets, reps, weight_kg) |
| `planned_meals` | Daily meal calorie budgets |
| `nutrition` | Logged food intake |
| `daily_logs` | Daily task completion stats |

## Scripts & CI

- `.github/workflows/update-fitness-data.yml` — Daily cron at 6am UTC
  - Runs `fetch_strava.py` (upserts to Supabase)
  - Runs `fetch_calendar.py` (writes JSON)
  - Runs `fetch_rss.py` (writes JSON)
  - Commits calendar/RSS JSON to repo
- Requires GitHub secrets: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

## Conventions

- All dates use Eastern Time (`America/New_York`) via `todayEt()` helper
- Node IDs are random 21-char strings via `crypto.getRandomValues`
- Dashboard uses `esc()` for XSS protection on all innerHTML interpolations
- `fetchWithRetry(url, retries)` with exponential backoff for JSON fetches
- Nutrition date check piggybacks on 30-second Spotify interval (now only checks nutrition)
- After editing `dashboard/index.html`, commit and push — GitHub Pages auto-deploys on push to `main`
