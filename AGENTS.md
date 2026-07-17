# AGENTS.md

## Project Overview

Personal Planning Tree — a hierarchical task planner deployed as a GitHub Pages site.

## Structure

- `tracker/` — The planning tree app, served at `mihir-kale.github.io/tracker/`
- `dashboard/` — Personal dashboard with calendar, tasks, and Strava widgets, served at `mihir-kale.github.io/dashboard/`
- Root (`index.html`, etc.) — Public website profile (WIP)

## Stack

- Frontend: Single-page app in `tracker/index.html` with a Vite-bundled JS/CSS output in `tracker/assets/`
- Backend: Supabase (Postgres + REST API) for cross-device persistence
- Auth: Single-password hardcoded hash for app access
- Hosting: GitHub Pages (`mihir-kale.github.io`)

## Key Files

- `tracker/index.html` — App shell, Supabase config, sync/load functions
- `tracker/assets/index-CY4Ktyp3.js` — Compiled app bundle (do not edit directly)
- `tracker/assets/index-kTQDwIqS.css` — Compiled styles
- `dashboard/index.html` — Personal dashboard (calendar, tasks, Strava placeholder)

## Supabase

- Project ID: `heyrtjzntnicqsfemcmi`
- URL: `https://heyrtjzntnicqsfemcmi.supabase.co`
- Table: `nodes` (with unique index on `id`)
- Anon key is in `tracker/index.html` (client-side only)
- RLS enabled with public read/write policy
- Sync functions: `window.syncToSupabase(state)` and `window.loadFromSupabase()`

## Data Model — `nodes` Table

| Column | Type | Default |
|---|---|---|
| `id` (PK) | text | — |
| `parent_id` | text | — |
| `path` | text | — |
| `title` | text | — |
| `description` | text | `''` |
| `status` | text | `'ready'` |
| `priority` | text | `'medium'` |
| `order_index` | int4 | `0` |
| `estimate_minutes` | int4 | — |
| `due_date` | text | — |
| `hidden_today` | bool | `false` |
| `recurring` | bool | `false` |
| `created_at` | text | — |
| `updated_at` | text | — |

## Conventions

- State is persisted to `localStorage` (key: `ppt-tree-state`) and synced to Supabase on every mutation
- Node IDs are random 21-char strings generated via `crypto.getRandomValues`
- Internal JS uses camelCase; Supabase columns use snake_case (mapped in sync functions)
- Do not commit secrets beyond the Supabase anon key (RLS-protected)
- After editing `tracker/index.html`, commit and push — GitHub Pages auto-deploys on push to `main`
