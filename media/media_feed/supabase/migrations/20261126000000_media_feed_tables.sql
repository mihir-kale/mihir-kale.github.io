-- media_feed: persistent RSS reading queue.
--
-- sources   — feeds the ingestion job pulls (enabled rows only)
-- articles  — deduplicated feed items plus the owner's reading state
-- reviews   — one Markdown review per article
--
-- The ingestion job authenticates as the service role (bypassing RLS) and only
-- updates feed-owned metadata on conflict. Owner reads/writes use the
-- authenticated role; anon has no access.

create extension if not exists pgcrypto;

create table if not exists public.sources (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(name) between 1 and 200),
  rss_url text not null check (rss_url ~ '^https?://'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  source_id bigint not null references public.sources (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 500),
  author text check (author is null or char_length(author) <= 200),
  -- Canonical permalink: tracking params, fragments, www. and trailing slash
  -- are stripped before insert, so this is also the deduplication key.
  url text not null unique check (char_length(url) <= 2048),
  description text,
  published_at timestamptz not null default now(),
  discovered_at timestamptz not null default now(),
  status text not null default 'unreviewed'
    check (status in ('unreviewed', 'queued', 'dismissed', 'read')),
  -- Nullable ranking; lower numbers rank higher. Never written by ingestion.
  priority integer,
  recommendation_reason text,
  read_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null unique references public.articles (id) on delete cascade,
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists articles_status_priority_idx
  on public.articles (status, priority desc nulls last, published_at desc);
create index if not exists articles_source_published_idx
  on public.articles (source_id, published_at desc);
create index if not exists articles_published_at_idx
  on public.articles (published_at desc);
create index if not exists reviews_status_published_idx
  on public.reviews (status, published_at desc);

create or replace function public.media_feed_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists media_feed_sources_updated_at on public.sources;
create trigger media_feed_sources_updated_at
  before update on public.sources
  for each row execute function public.media_feed_set_updated_at();

drop trigger if exists media_feed_articles_updated_at on public.articles;
create trigger media_feed_articles_updated_at
  before update on public.articles
  for each row execute function public.media_feed_set_updated_at();

drop trigger if exists media_feed_reviews_updated_at on public.reviews;
create trigger media_feed_reviews_updated_at
  before update on public.reviews
  for each row execute function public.media_feed_set_updated_at();

alter table public.sources enable row level security;
alter table public.articles enable row level security;
alter table public.reviews enable row level security;

revoke all on public.sources from anon;
revoke all on public.articles from anon;
revoke all on public.reviews from anon;

grant select, insert, update, delete on public.sources to authenticated;
grant select, insert, update, delete on public.articles to authenticated;
grant select, insert, update, delete on public.reviews to authenticated;

drop policy if exists media_feed_sources_owner on public.sources;
create policy media_feed_sources_owner on public.sources
  for all to authenticated using (true) with check (true);

drop policy if exists media_feed_articles_owner on public.articles;
create policy media_feed_articles_owner on public.articles
  for all to authenticated using (true) with check (true);

drop policy if exists media_feed_reviews_owner on public.reviews;
create policy media_feed_reviews_owner on public.reviews
  for all to authenticated using (true) with check (true);
