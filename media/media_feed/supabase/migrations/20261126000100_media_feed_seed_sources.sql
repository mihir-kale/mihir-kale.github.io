-- Initial feeds, carried over from media/data/feed-sources.json.
-- Existing rows are left untouched so `enabled` choices survive re-seeding.
insert into public.sources (name, rss_url, enabled) values
  ('The Atlantic', 'https://www.theatlantic.com/feed/all/', true),
  ('The Economist', 'https://www.economist.com/latest/rss.xml', true),
  ('The New York Times', 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', true),
  ('The New Yorker', 'https://www.newyorker.com/feed/everything', true),
  ('Conversations with Tyler', 'https://conversationswithtyler.com/episodes/feed/', true),
  ('WIRED', 'https://www.wired.com/feed/rss', true)
on conflict (name) do nothing;
