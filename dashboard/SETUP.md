# Personal OS — Set Up Your Own Copy

This is a single-file, framework-free "Personal OS" dashboard: tasks, projects, people, and a time-blocked calendar. The frontend is plain HTML/CSS/JS in one file; the backend is Supabase (auth + Postgres + read-only calendar feed). This document tells an assistant exactly how to copy the UX from this repo and stand up the same backend.

## What you're building

- One static page (`dashboard/index.html`) — no build step, no npm, no framework.
- Supabase back-end with four tables: `tasks`, `projects`, `people`, `calendar_events`.
- Email/password sign-in. Row Level Security (RLS) is the only gate on real data.
- Signed-out visitors see the real dashboard preloaded with hardcoded sample data (demo mode) — nothing is read from or written to Supabase until they sign in.
- A `calendar-proxy` edge function merges read-only events from Outlook/Google into the calendar.

---

## Step 1 — Copy the app

1. Copy `dashboard/index.html` from this repo (source of truth) or from the live site at `https://mihir-kale.github.io/dashboard/`.
2. Keep it as a single file. Do **not** split it into modules, add a framework, or introduce a build step — the app depends on inline CSS/JS and helper functions like `escapeHtml()`, `todayEt()`/`addDaysLocal()`/`weekStartOf()`, and `crypto.getRandomValues`-based ids.
3. Host it somewhere static (GitHub Pages, Netlify, Cloudflare Pages, etc.). On GitHub Pages it serves at `https://<your-user>.github.io/dashboard/`.

## Step 2 — Create the Supabase project

1. Create a project at https://supabase.com (free tier is fine).
2. Open **Authentication → Providers** and enable the **Email** provider (email/password only; no OAuth needed).
3. From **Project Settings → API** grab the **Project URL** and the **anon / publishable key**.
4. Open the app's `<script>` (the `CONFIG` section near the top of `index.html`) and replace:
   - `SUPABASE_URL` → your project URL
   - `SUPABASE_ANON_KEY` → your anon key (it is intentionally public — RLS is the real protection)
   - `TZ` → your IANA timezone (e.g. `America/New_York`)
   - `FEED_CALENDARS` → the read-only calendars you want merged (e.g. `['Outlook', 'Google']`)
   - `BLOCK_COLORS` → optional: your palette for manual time blocks

## Step 3 — Create the schema

Run this in the Supabase SQL editor:

```sql
create extension if not exists pgcrypto;

create table if not exists tasks (
  id text primary key,               -- client-generated (nanoid)
  title text not null,
  status text not null default 'pending',
  due_date date,
  recur text,                        -- 'daily' | 'weekly' | null
  project text,
  people jsonb not null default '[]'::jsonb,   -- array of people ids
  description text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id text primary key,
  name text not null,
  priority text not null default 'medium',   -- low|medium|high|urgent
  status text not null default 'pending',    -- pending|done
  people jsonb not null default '[]'::jsonb,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists people (
  id text primary key,
  name text not null,
  description text,
  last_contact text,
  contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists calendar_events (
  id text primary key,
  external_id text,                  -- feed key: calendar|date|time|title (see Step 6)
  title text not null,
  date date,
  start_time time,
  end_time time,
  all_day boolean not null default false,
  location text,
  calendar text,                     -- e.g. 'Outlook' | 'Google'
  color text,
  recur text,
  source text not null default 'manual',     -- 'manual' editable | 'feed' read-only
  created_at timestamptz not null default now()
);

-- Dedupe feed rows (same event from table + proxy) on external_id.
create unique index if not exists calendar_events_feed_ext_unique
  on calendar_events (external_id)
  where source = 'feed' and external_id is not null;
```

Notes:
- Primary keys are `text`, not `uuid`, because the app generates ids client-side with `nanoid()`.
- `people` is a JSON array of person ids; the app renders them as circles with a name tooltip.
- `calendar_events.source` distinguishes editable manual blocks (`manual`) from read-only feed events (`feed`). The app never edits feed rows.

## Step 4 — RLS (authenticated users only)

```sql
alter table tasks enable row level security;
alter table projects enable row level security;
alter table people enable row level security;
alter table calendar_events enable row level security;

create policy "tasks_me"    on tasks          for all to authenticated using (true) with check (true);
create policy "projects_me" on projects       for all to authenticated using (true) with check (true);
create policy "people_me"   on people         for all to authenticated using (true) with check (true);
create policy "calendar_me" on calendar_events for all to authenticated using (true) with check (true);
```

This is a single-owner app, so `authenticated` == "me". Split into `select/insert/update/delete` policies if you ever add multi-user support.

## Step 5 — The feed-sync RPC

The app calls `sync_calendar_feed(p_payload jsonb)` with
`p_payload = { calendars: ['Outlook','Google'], rows: [ {…feed row…} ] }` to upsert feed rows into `calendar_events` and prune feed events that vanished from a successful fetch. Manual blocks are never touched.

```sql
create or replace function sync_calendar_feed(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  cal text;
begin
  for r in select * from jsonb_array_elements(p_payload->'rows') loop
    insert into calendar_events (
      id, external_id, title, date, start_time, end_time,
      all_day, calendar, color, location, source
    ) values (
      gen_random_uuid()::text,
      r->>'external_id', r->>'title',
      (r->>'date')::date, (r->>'start_time')::time, (r->>'end_time')::time,
      coalesce((r->>'all_day')::boolean, false),
      coalesce(r->>'calendar', ''), coalesce(r->>'color', ''),
      coalesce(r->>'location', ''), 'feed'
    )
    on conflict (external_id) do update set
      title = excluded.title,
      date = excluded.date,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      all_day = excluded.all_day,
      color = excluded.color,
      location = excluded.location;
  end loop;

  if (p_payload->'calendars') is not null and jsonb_array_length(p_payload->'calendars') > 0 then
    for cal in select * from jsonb_array_elements_text(p_payload->'calendars') loop
      delete from calendar_events
      where source = 'feed'
        and calendar = cal
        and external_id is not null
        and not exists (
          select 1 from jsonb_array_elements(p_payload->'rows') x
          where x->>'calendar' = cal and x->>'external_id' = calendar_events.external_id
        );
    end loop;
  end if;
end;
$$;

-- Only signed-in users may run the sync (blocks anon abuse of the definer).
revoke execute on function sync_calendar_feed from anon;
grant execute on function sync_calendar_feed to authenticated;
```

## Step 6 — `calendar-proxy` edge function

`index.html` fetches `SUPABASE_URL/functions/v1/calendar-proxy` on every calendar refresh, with the signed-in user's session token as `Authorization: Bearer <token>`. The function must:

1. Verify the JWT in the `Authorization` header (reject anon).
2. For each calendar in `FEED_CALENDARS`, query the user's read-only events for roughly today through the next 14 days (either Microsoft Graph for Outlook or Google Calendar API for Google — scope them to read-only calendar access and store refresh tokens per user).
3. Return JSON in exactly this shape (the app's `proxyToEvent()`/`feedRow()` consume `start`/`end`/`calendar`/`title`/`allDay`/`location`/`color`):

```json
{
  "last_updated": "2026-09-07T12:00:00.000Z",
  "events": [
    {
      "calendar": "Outlook",
      "title": "1:1 with Sam",
      "start": "2026-09-07T09:00:00-04:00",
      "end": "2026-09-07T09:30:00-04:00",
      "allDay": false,
      "location": "",
      "color": "#ff9f0a"
    }
  ],
  "errors": [
    { "calendar": "Google", "message": "API key invalid" }
  ]
}
```

4. Set provider credentials via `supabase secrets set <NAME> …` and read them from the function environment. Standard env names you can use: `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.

Deploy:

```bash
supabase init
supabase functions new calendar-proxy
supabase functions deploy calendar-proxy
```

A minimal Deno skeleton to adapt (edit the fetch per provider):

```ts
import { createClient } from 'jsr:@supabase/supabase-js';

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer /, '');
  if (!token) return json({ events: [], errors: [] }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return json({ events: [], errors: [] }, 401);

  const events: any[] = [];
  const errors: any[] = [];
  // For each calendar source (Outlook/Google):
  //   - fetch events user.timeMin..timeMax with read-only scopes
  //   - push { calendar, title, start, end, allDay, location, color } per event
  return json({ last_updated: new Date().toISOString(), events, errors });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
```

## Step 7 — Realtime (optional)

The app subscribes to `postgres_changes` on `tasks` and also polls (60s tasks / 5min calendar) as a fallback. To get instant multi-tab task updates:

```sql
alter publication supabase_realtime add table tasks;
```

## Step 8 — Deploy the frontend

Push `dashboard/index.html` (and this file, if you like) to your static host. On GitHub Pages, pushing to `main` deploys automatically and the dashboard lives at `https://<user>.github.io/dashboard/`.

---

## Security checklist

- The anon key is public by design — never rely on it for security.
- RLS is the only guard on real data; keep the policies scoped to `authenticated`.
- `sync_calendar_feed` is a `security definer` — revoke execute from `anon` so only signed-in users can run it.
- Feed events (`source = 'feed'`) are read-only in the UI; the app never issues update/delete on them.
- Demo mode (signed out) uses hardcoded sample arrays (`demoTasksData()`, `demoProjectsData()`, `demoEventsData()`) and every loader/write is guarded by the `demoMode` flag, so nothing touches Supabase until sign-in.

## Wiring the checks after setup

After scaffolding, verify with an assistant:

1. Signed out, the dashboard shows sample data; filters, the Projects hide toggle, Day/Week scales, and drag-drop all work, and nothing is written to Supabase (check the network tab — no `.supabase.co` requests).
2. Sign in creates a session; all four tables load; a created task appears after refresh.
3. `calendar-proxy` returns the schema above; feed events are read-only; manual blocks edit and persist; drag block→reschedule persists; drag event→tasks creates a `TODO:` task.