-- Remove the retired jobs/recruiting stack. The dashboard and jobs apps were
-- deleted (8d20aef, 58f5cf3); the lean-jobs tables have no remaining consumer.
-- A pre-drop schema/data dump was saved locally before applying this migration.
--
-- Kept: tasks, projects, calendar_events, media_*, sources, articles, reviews.

-- Views depend on nearly every table below, so remove them first.
drop view if exists public.task_execution_context;
drop view if exists public.job_context;
drop view if exists public.people_context;

-- Legacy sync triggers on the kept task/project tables.
drop trigger if exists tasks_recruiting_people_sync on public.tasks;
drop trigger if exists projects_recruiting_people_sync on public.projects;

-- Child tables before parents (FK order).
drop table if exists public.interactions;
drop table if exists public.job_people;
drop table if exists public.job_competency_maps;
drop table if exists public.calendar_recruiting_links;
drop table if exists public.project_recruiting_links;
drop table if exists public.task_recruiting_links;
drop table if exists public.person_firms;
drop table if exists public.jobs;
drop table if exists public.firms;
drop table if exists public.people;

-- Functions left orphaned once their tables/views/triggers are gone.
drop function if exists public.recruiting_sync_legacy_people();
drop function if exists public.recruiting_set_updated_at();
drop function if exists public.set_updated_at();
