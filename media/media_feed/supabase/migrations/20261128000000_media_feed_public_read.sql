-- Public shelf view for the media page. Base tables stay owner-only; anon can
-- read only these seven-day article columns plus the source name.

create or replace view public.article_shelf as
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
