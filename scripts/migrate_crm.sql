-- CRM: people, events, tasks — person-task-event triad
-- Run in Supabase SQL Editor or via: supabase db execute < scripts/migrate_crm.sql

-- Core: People (contacts with outreach lifecycle)
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  company text,
  role text,
  email text,
  phone text,
  linkedin_url text,
  notes text,
  status text NOT NULL DEFAULT 'cold'
    CHECK (status IN ('cold','contacted','replied','meeting_scheduled','met','nurturing','closed')),
  last_contacted_at timestamptz,
  next_follow_up date,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Core: Events (meetings, phone screens, deadlines)
CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text,
  event_date date NOT NULL,
  start_time time,
  end_time time,
  timezone text DEFAULT 'America/New_York',
  location text,
  event_type text NOT NULL DEFAULT 'meeting'
    CHECK (event_type IN ('phone_screen','interview','meeting','deadline','social','other')),
  status text NOT NULL DEFAULT 'tentative'
    CHECK (status IN ('tentative','confirmed','completed','cancelled')),
  person_id text REFERENCES people(id) ON DELETE SET NULL,
  url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Core: Tasks (flat, no tree — purpose-built for CRM)
CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text DEFAULT '',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','done','cancelled','blocked')),
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','urgent')),
  due_date date,
  estimated_minutes int,
  project text,
  person_id text REFERENCES people(id) ON DELETE SET NULL,
  event_id text REFERENCES events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_tasks_person ON tasks(person_id);
CREATE INDEX IF NOT EXISTS idx_tasks_event ON tasks(event_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_events_person ON events(person_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_people_status ON people(status);

-- RLS: public read/write (same as existing tables)
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "public_all" ON people FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "public_all" ON events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "public_all" ON tasks FOR ALL USING (true) WITH CHECK (true);
