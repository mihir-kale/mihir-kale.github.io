-- PostgREST requires table-level SELECT, so column grants alone did not work.
-- Expose a narrow view instead and leave the base tables anon-inaccessible.

revoke all on public.articles from anon;
revoke all on public.sources from anon;

drop policy if exists media_feed_articles_public_read on public.articles;
drop policy if exists media_feed_sources_public_read on public.sources;

drop view if exists public.article_shelf;
create view public.article_shelf as
select
  a.id,
  a.title,
  a.author,
  a.url,
  a.description,
  a.published_at,
  s.name as source
from public.articles a
join public.sources s on s.id = a.source_id
where a.published_at >= now() - interval '7 days';

revoke all on public.article_shelf from anon;
grant select on public.article_shelf to anon;
