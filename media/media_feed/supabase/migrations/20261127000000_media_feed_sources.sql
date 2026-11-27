-- Current source list for the ingestion job. Upsert by name so URLs can be
-- corrected without changing ids; sources no longer in the list are disabled
-- rather than deleted, preserving article foreign keys.

insert into public.sources (name, rss_url, enabled) values
  ('The Atlantic', 'https://www.theatlantic.com/feed/all/', true),
  ('The New Yorker', 'https://www.newyorker.com/feed/rss', true),
  ('Financial Times', 'https://www.ft.com/rss/home/international', true),
  ('The Economist', 'https://www.economist.com/finance-and-economics/rss.xml', true),
  ('Foreign Affairs', 'https://www.foreignaffairs.com/rss.xml', true),
  ('Aeon', 'https://aeon.co/essays/feed.rss', true),
  ('Psyche', 'https://psyche.co/feed', true),
  ('Works in Progress', 'https://worksinprogress.co/rss.xml', true),
  ('Noema', 'https://www.noemamag.com/feed/', true),
  ('Palladium', 'https://www.palladiummag.com/feed/index.xml', true),
  ('London Review of Books', 'https://www.lrb.co.uk/feeds/rss', true),
  ('New York Review of Books', 'https://feeds.feedburner.com/nybooks', true),
  ('Persuasion', 'https://www.persuasion.community/feed', true)
on conflict (name) do update
  set rss_url = excluded.rss_url,
      enabled = true;

update public.sources
set enabled = false
where name not in (
  'The Atlantic',
  'The New Yorker',
  'Financial Times',
  'The Economist',
  'Foreign Affairs',
  'Aeon',
  'Psyche',
  'Works in Progress',
  'Noema',
  'Palladium',
  'London Review of Books',
  'New York Review of Books',
  'Persuasion'
);
