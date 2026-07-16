#!/usr/bin/env python3
"""Fetch RSS feeds from The Atlantic (via Google News), New Yorker, and Economist."""

import json
import random
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

DATA_DIR = Path(__file__).resolve().parent.parent / "dashboard" / "data"

FEEDS = [
    {
        "name": "The New Yorker",
        "url": "https://www.newyorker.com/feed/everything",
    },
    {
        "name": "The Economist",
        "url": "https://www.economist.com/science-and-technology/rss.xml",
    },
    {
        "name": "The Economist",
        "url": "https://www.economist.com/finance-and-economics/rss.xml",
    },
    {
        "name": "The Economist",
        "url": "https://www.economist.com/international/rss.xml",
    },
    {
        "name": "The Economist",
        "url": "https://www.economist.com/united-states/rss.xml",
    },
]

NAMESPACES = {
    "atom": "http://www.w3.org/2005/Atom",
    "dc": "http://purl.org/dc/elements/1.1/",
    "media": "http://search.yahoo.com/mrss/",
}


def parse_rss(content_bytes, source_name):
    """Parse RSS/Atom feed and return list of articles."""
    root = ET.fromstring(content_bytes)
    articles = []

    items = root.findall(".//item")

    for item in items:
        title_el = item.find("title")
        link_el = item.find("link")
        pub_el = item.find("pubDate")

        if title_el is None or link_el is None:
            continue

        title = (title_el.text or "").strip()
        link = (link_el.text or link_el.get("href", "")).strip()

        # Parse date
        date_str = ""
        if pub_el is not None and pub_el.text:
            try:
                dt = datetime.strptime(pub_el.text.strip(), "%a, %d %b %Y %H:%M:%S %z")
                date_str = dt.strftime("%Y-%m-%d")
            except ValueError:
                pass

        articles.append({
            "title": title,
            "url": link,
            "source": source_name,
            "date": date_str,
        })

    return articles


def main():
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=7)
    all_articles = []

    for feed in FEEDS:
        try:
            resp = requests.get(feed["url"], timeout=15, headers={
                "User-Agent": "Mozilla/5.0 (compatible; RSS Reader/1.0)"
            })
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"Warning: Failed to fetch {feed['name']}: {e}")
            continue

        articles = parse_rss(resp.content, feed["name"])
        print(f"{feed['name']}: {len(articles)} articles parsed")

        # Filter to last 7 days
        for a in articles:
            if a["date"]:
                try:
                    article_date = datetime.strptime(a["date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
                    if article_date >= cutoff:
                        all_articles.append(a)
                except ValueError:
                    all_articles.append(a)
            else:
                all_articles.append(a)

    # Deduplicate by URL
    seen = set()
    unique = []
    for a in all_articles:
        if a["url"] not in seen:
            seen.add(a["url"])
            unique.append(a)

    # Shuffle and pick 5
    random.shuffle(unique)
    selected = unique[:5]

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "last_updated": now.isoformat(),
        "articles": selected,
    }
    out_path = DATA_DIR / "read-feeds.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"Wrote {len(selected)} articles to {out_path}")


if __name__ == "__main__":
    main()
