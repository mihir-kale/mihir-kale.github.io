-- Strava data tables for Supabase
-- Run this in the Supabase SQL Editor

-- Cardio activities (runs, rides, swims, etc.)
CREATE TABLE IF NOT EXISTS strava_activities (
  id bigint PRIMARY KEY,
  activity_date text NOT NULL,
  activity_type text NOT NULL,
  name text NOT NULL DEFAULT '',
  distance_km real DEFAULT 0,
  moving_time_min real DEFAULT 0,
  elevation_gain real DEFAULT 0,
  avg_hr real,
  max_hr real,
  avg_speed_kmh real,
  description text DEFAULT '',
  created_at text DEFAULT now()::text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_strava_activities_id ON strava_activities (id);
CREATE INDEX IF NOT EXISTS idx_strava_activities_date ON strava_activities (activity_date);

-- Strength training sessions
CREATE TABLE IF NOT EXISTS strava_workouts (
  id text PRIMARY KEY,
  strava_activity_id bigint,
  workout_date text NOT NULL,
  name text NOT NULL DEFAULT '',
  created_at text DEFAULT now()::text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_strava_workouts_strava_id ON strava_workouts (strava_activity_id);
CREATE INDEX IF NOT EXISTS idx_strava_workouts_date ON strava_workouts (workout_date);

-- Individual exercises within a workout
CREATE TABLE IF NOT EXISTS strava_exercises (
  id text PRIMARY KEY,
  workout_id text NOT NULL REFERENCES strava_workouts(id) ON DELETE CASCADE,
  name text NOT NULL,
  sets int4 DEFAULT 0,
  reps int4 DEFAULT 0,
  weight_kg real,
  order_index int4 DEFAULT 0,
  created_at text DEFAULT now()::text
);

CREATE INDEX IF NOT EXISTS idx_strava_exercises_workout ON strava_exercises (workout_id);

-- RLS policies (public read/write, matching existing tables)
ALTER TABLE strava_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE strava_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE strava_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all" ON strava_activities FOR ALL USING (true);
CREATE POLICY "public_all" ON strava_workouts FOR ALL USING (true);
CREATE POLICY "public_all" ON strava_exercises FOR ALL USING (true);

-- Planned meals for calorie budgeting
CREATE TABLE IF NOT EXISTS planned_meals (
  id text PRIMARY KEY,
  food_name text NOT NULL,
  calories int4 NOT NULL,
  protein int4,
  meal_date text NOT NULL,
  order_index int4 DEFAULT 0,
  logged boolean DEFAULT false,
  logged_at text,
  created_at text DEFAULT now()::text
);

CREATE INDEX IF NOT EXISTS idx_planned_meals_date ON planned_meals (meal_date);
CREATE INDEX IF NOT EXISTS idx_planned_meals_date_logged ON planned_meals (meal_date, logged);

ALTER TABLE planned_meals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON planned_meals FOR ALL USING (true);
