#!/usr/bin/env python3
"""Fetch Google + Outlook ICS feeds, parse events for the next 7 days, output JSON."""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

DATA_DIR = Path(__file__).resolve().parent.parent / "dashboard" / "data"

CALENDARS = [
    {
        "name": "Google",
        "url": "https://calendar.google.com/calendar/ical/mihir.p.kale%40gmail.com/public/basic.ics",
        "color": "#0a84ff",
    },
    {
        "name": "Outlook",
        "url": "https://outlook.office365.com/owa/calendar/9c4adb5e06504c1fa6d0a8fef38f7bd7@unc.edu/769212afd989474696c0f8fc4b21689b1725670238033636484/calendar.ics",
        "color": "#ff9f0a",
    },
]


def parse_ics(text):
    """Minimal ICS parser — extracts VEVENT blocks."""
    events = []
    in_event = False
    current = {}
    current_tzid = {}

    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = line.strip()
        if line == "BEGIN:VEVENT":
            in_event = True
            current = {}
            current_tzid = {}
        elif line == "END:VEVENT":
            in_event = False
            if "dtstart" in current:
                events.append({"props": current, "tzids": current_tzid})
        elif in_event:
            # Detect TZID parameter on dtstart/dtend
            if line.upper().startswith("DTSTART") or line.upper().startswith("DTEND"):
                key_part, _, val = line.partition(":")
                key_lower = key_part.split(";")[0].lower()
                # Check for TZID= in the parameter part
                params = key_part.split(";")[1:]
                tzid = None
                for p in params:
                    if p.upper().startswith("TZID="):
                        tzid = p[5:]
                current[key_lower] = val
                if tzid:
                    current_tzid[key_lower] = tzid
            else:
                key, _, val = line.partition(":")
                key = key.split(";")[0].lower()
                current[key] = val

    return events


TZ_MAP = {
    "Eastern Standard Time": "America/New_York",
    "Eastern Daylight Time": "America/New_York",
    "Central Standard Time": "America/Chicago",
    "Central Daylight Time": "America/Chicago",
    "Pacific Standard Time": "America/Los_Angeles",
    "Pacific Daylight Time": "America/Los_Angeles",
}


def parse_dt(s, tzid=None):
    """Parse ICS datetime string to ISO format."""
    s = s.strip()
    # Try with Z suffix first
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y%m%dT%H%M%S", "%Y%m%d"):
        try:
            dt = datetime.strptime(s, fmt)
            if fmt.endswith("Z"):
                dt = dt.replace(tzinfo=timezone.utc)
            elif tzid:
                # Look up timezone from TZID
                import zoneinfo
                tz_name = TZ_MAP.get(tzid, tzid)
                try:
                    tz = zoneinfo.ZoneInfo(tz_name)
                    dt = dt.replace(tzinfo=tz)
                except Exception:
                    dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def main():
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=1)
    window_end = now + timedelta(days=7)

    all_events = []

    for cal in CALENDARS:
        try:
            resp = requests.get(cal["url"], timeout=15)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"Warning: Failed to fetch {cal['name']}: {e}")
            continue

        raw_events = parse_ics(resp.text)
        print(f"{cal['name']}: {len(raw_events)} events parsed")

        for ev in raw_events:
            props = ev["props"]
            tzids = ev["tzids"]
            start = parse_dt(props.get("dtstart", ""), tzids.get("dtstart"))
            end = parse_dt(props.get("dtend", ""), tzids.get("dtend"))
            if not start:
                continue

            if start > window_end:
                continue
            if end and end < window_start:
                continue
            if not end and start < window_start:
                continue

            summary = props.get("summary", "Untitled")
            location = props.get("location", "")

            all_events.append({
                "title": summary,
                "start": start.isoformat(),
                "end": end.isoformat() if end else None,
                "allDay": "t" not in props.get("dtstart", "").lower(),
                "location": location,
                "calendar": cal["name"],
                "color": cal["color"],
            })

    all_events.sort(key=lambda e: e["start"])

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "last_updated": now.isoformat(),
        "events": all_events,
    }
    out_path = DATA_DIR / "calendar-events.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"Wrote {len(all_events)} events to {out_path}")


if __name__ == "__main__":
    main()
