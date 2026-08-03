# Architecture — mihir-kale.github.io

## Overview

This repo is a thin, auth-gated frontend for personal data. The private `mihirOS` monorepo is the source of truth for content and tooling; Supabase is the runtime backend; GitHub Pages hosts the static apps.

```
mihirOS (private monorepo)          mihir-kale.github.io (this repo)
  ├── now/                           ├── dashboard/   (auth-gated SPA)
  ├── career/                        ├── tracker/     (auth-gated SPA)
  ├── training/                      ├── tracker-demo/
  ├── school/                        ├── dashboard-demo/
  ├── tools/ (archon, fetch_calendar)├── index.html   (public profile)
  └── finances/, health/, housing/   └── data (only static read-feeds.json)
                  │
                  ▼
            Supabase (heyrtjzntnicqsfemcmi)
            RLS: all personal tables = authenticated role only
```

## Security model

- **RLS**: every personal-data table (`people`, `events`, `tasks`, `projects`, `applications`, `nodes`, `strava_*`, `planned_*`, `nutrition`, `daily_logs`) requires the `authenticated` role. The anon key in the public HTML can read and write nothing. See `supabase/migrations/20260802100000_secure_rls.sql`.
- **App-level auth**: `dashboard/` and `tracker/` gate on Supabase email/password before loading data (`db.auth.getSession()` / `signInWithPassword`).
- **No personal data in the repo**: calendar data comes from the `events` table; only `read-feeds.json` (public article links) is committed.
- The compiled CRM app (`/crm/`), `archon/`, `opencode.json`, and `fetch_calendar.py` were removed from this repo and moved into `mihirOS/tools/`.

## Data model

The Supabase schema is defined in `supabase/migrations/` (people/events/tasks triad, projects, applications, plus tracker/fitness tables). The dashboard reads live from these tables after authentication; the tracker owns the `nodes` table via full-state sync.

## Components

| Component | Tech | Auth | Data source |
|---|---|---|---|
| `dashboard/` | Static HTML/JS | Yes | Supabase tables via `@supabase/supabase-js` |
| `tracker/` | Vite/React (compiled) | Yes | Supabase `nodes` table |
| `tracker-demo/` | Compiled demo | No | Local/demo data |
| `dashboard-demo/` | Static HTML/JS | No | Local/demo data |
| `index.html` | Static profile | No | Public |

## CI

`.github/workflows/update-fitness-data.yml` is manual-only (`workflow_dispatch`). The Strava fetch is stubbed and deferred until CI wiring is settled in `mihirOS/training`. The calendar/RSS fetch + auto-commit steps were removed.
