-- Tighten the public shelf read to only the columns the page renders.
-- Reading state, ranking, reasons, and reviews stay owner-only for now.

revoke all on public.articles from anon;
revoke all on public.sources from anon;

grant select (id, title, author, url, description, published_at, source_id) on public.articles to anon;
grant select (name) on public.sources to anon;
