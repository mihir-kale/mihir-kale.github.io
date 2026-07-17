#!/usr/bin/env python3
"""Fetch Strava activities, parse Hevy workouts, upsert to Supabase."""

import os
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

STRAVA_AUTH_URL = "https://www.strava.com/oauth/token"
STRAVA_API_BASE = "https://www.strava.com/api/v3"

def load_env(env_path=None):
    env = {}
    for key in ("STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REFRESH_TOKEN",
                "SUPABASE_URL", "SUPABASE_ANON_KEY"):
        val = os.environ.get(key)
        if val:
            env[key] = val
    if all(k in env for k in ("STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REFRESH_TOKEN",
                               "SUPABASE_URL", "SUPABASE_ANON_KEY")):
        return env

    if env_path is None:
        env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        print("ERROR: Missing env vars. Set STRAVA_* and SUPABASE_* as env vars or in .env")
        sys.exit(1)
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip()
    return env

def get_access_token(env):
    resp = requests.post(
        STRAVA_AUTH_URL,
        data={
            "client_id": env["STRAVA_CLIENT_ID"],
            "client_secret": env["STRAVA_CLIENT_SECRET"],
            "grant_type": "refresh_token",
            "refresh_token": env["STRAVA_REFRESH_TOKEN"],
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["access_token"], data["refresh_token"]

def fetch_activities(access_token, after_epoch=None):
    headers = {"Authorization": f"Bearer {access_token}"}
    page = 1
    activities = []
    while True:
        params = {"page": page, "per_page": 100}
        if after_epoch:
            params["after"] = after_epoch
        resp = requests.get(
            f"{STRAVA_API_BASE}/athlete/activities",
            headers=headers,
            params=params,
            timeout=15,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        activities.extend(batch)
        page += 1
    return activities

def parse_hevy_description(description):
    """Parse Hevy-formatted workout text from a Strava activity description."""
    if not description:
        return None

    text = description.strip()
    if "hevyapp" not in text.lower() and "Set 1:" not in text:
        return None

    exercises = []
    lines = text.split("\n")
    current_name = None
    current_sets = []

    def flush():
        nonlocal current_name, current_sets
        if not current_name or not current_sets:
            current_name = None
            current_sets = []
            return
        sets_count = len(current_sets)
        weighted = [s for s in current_sets if "weight_kg" in s]
        if weighted:
            best = max(weighted, key=lambda s: s["weight_kg"])
            exercises.append({
                "name": current_name,
                "sets": sets_count,
                "reps": best.get("reps", current_sets[0].get("reps", 0)),
                "weight_kg": best["weight_kg"],
            })
        else:
            total_reps = sum(s.get("reps", 0) for s in current_sets)
            avg_reps = total_reps // sets_count if sets_count else 0
            exercises.append({
                "name": current_name,
                "sets": sets_count,
                "reps": avg_reps,
            })
        current_name = None
        current_sets = []

    for line in lines:
        line = line.strip()
        if not line or "hevyapp" in line.lower():
            continue

        set_match = re.match(r"Set\s+\d+:\s*(.*)", line, re.IGNORECASE)
        if set_match:
            parsed = _parse_hevy_set(set_match.group(1).strip())
            if parsed:
                current_sets.append(parsed)
        else:
            flush()
            current_name = line

    flush()
    return exercises if exercises else None


def _parse_hevy_set(text):
    text = text.strip().lower()

    m = re.match(r"([\d.]+)\s*lbs?\s*x\s*([\d.]+)", text)
    if m:
        w = float(m.group(1))
        r = int(float(m.group(2)))
        result = {"reps": r}
        if w > 0:
            result["weight_kg"] = round(w * 0.453592, 1)
        return result

    m = re.match(r"([\d.]+)\s*reps?", text)
    if m:
        return {"reps": int(float(m.group(1)))}

    m = re.match(r"(\d+)\s*min\s*(\d+)\s*s", text)
    if m:
        return {"duration_seconds": int(m.group(1)) * 60 + int(m.group(2))}

    return None

def process_activities(raw_activities, access_token=None):
    cardio = []
    workouts = []
    headers = {"Authorization": f"Bearer {access_token}"} if access_token else None

    for act in raw_activities:
        start = act.get("start_date_local", "")
        activity_type = act.get("type", "").lower()

        description = act.get("description")

        if access_token and activity_type == "weighttraining":
            try:
                resp = requests.get(
                    f"{STRAVA_API_BASE}/activities/{act['id']}",
                    headers=headers,
                    timeout=15,
                )
                if resp.ok:
                    description = resp.json().get("description") or description
            except requests.RequestException:
                pass

        entry = {
            "id": act["id"],
            "activity_date": start[:10],
            "activity_type": act.get("type", ""),
            "name": act.get("name", ""),
            "distance_km": round((act.get("distance") or 0) / 1000, 2),
            "moving_time_min": round((act.get("moving_time") or 0) / 60, 1),
            "elevation_gain": act.get("total_elevation_gain") or 0,
            "avg_hr": act.get("average_heartrate"),
            "max_hr": act.get("max_heartrate"),
            "avg_speed_kmh": (
                round((act.get("average_speed") or 0) * 3.6, 2)
                if act.get("average_speed")
                else None
            ),
            "description": (description or "")[:500],
        }

        cardio_types = {"run", "ride", "swim", "walk", "hike", "virtualride", "virtualrun"}
        if activity_type in cardio_types:
            cardio.append(entry)

        exercises = parse_hevy_description(description)
        if exercises is not None or activity_type == "weighttraining":
            workouts.append({
                "id": f"stv_{act['id']}",
                "strava_activity_id": act["id"],
                "workout_date": start[:10],
                "name": act.get("name", ""),
                "exercises": exercises or [],
            })

    return cardio, workouts

def upsert_to_supabase(env, cardio, workouts):
    url = env["SUPABASE_URL"]
    key = env["SUPABASE_ANON_KEY"]
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    # Upsert cardio activities
    if cardio:
        resp = requests.post(
            f"{url}/rest/v1/strava_activities",
            headers=headers,
            json=cardio,
            timeout=30,
        )
        if not resp.ok:
            print(f"ERROR upserting activities: {resp.status_code} {resp.text}")
        else:
            print(f"Upserted {len(cardio)} activities")

    # Upsert workouts
    workout_rows = [
        {k: v for k, v in w.items() if k != "exercises"}
        for w in workouts
    ]
    if workout_rows:
        resp = requests.post(
            f"{url}/rest/v1/strava_workouts",
            headers=headers,
            json=workout_rows,
            timeout=30,
        )
        if not resp.ok:
            print(f"ERROR upserting workouts: {resp.status_code} {resp.text}")
        else:
            print(f"Upserted {len(workout_rows)} workouts")

    # Upsert exercises — delete existing then insert fresh
    for w in workouts:
        if not w["exercises"]:
            continue
        # Delete old exercises for this workout
        requests.delete(
            f"{url}/rest/v1/strava_exercises?workout_id=eq.{w['id']}",
            headers=headers,
            timeout=15,
        )
        # Insert new
        exercise_rows = [
            {
                "id": str(uuid.uuid4())[:20],
                "workout_id": w["id"],
                "name": ex["name"],
                "sets": ex.get("sets", 0),
                "reps": ex.get("reps", 0),
                "weight_kg": ex.get("weight_kg"),
                "order_index": i,
            }
            for i, ex in enumerate(w["exercises"])
        ]
        resp = requests.post(
            f"{url}/rest/v1/strava_exercises",
            headers=headers,
            json=exercise_rows,
            timeout=30,
        )
        if not resp.ok:
            print(f"ERROR upserting exercises for {w['id']}: {resp.status_code} {resp.text}")

    total_exercises = sum(len(w["exercises"]) for w in workouts)
    print(f"Upserted {total_exercises} exercises across {len(workouts)} workouts")

def main():
    env = load_env()
    token, new_refresh = get_access_token(env)

    # Update .env locally so the refresh token stays valid
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        env_content = env_path.read_text()
        env_content = re.sub(
            r"^STRAVA_REFRESH_TOKEN=.*",
            f"STRAVA_REFRESH_TOKEN={new_refresh}",
            env_content,
            flags=re.MULTILINE,
        )
        env_path.write_text(env_content)

    # Fetch last 2 years of activities
    two_years_ago = int((datetime.now(timezone.utc) - timedelta(days=730)).timestamp())
    raw = fetch_activities(token, after_epoch=two_years_ago)
    print(f"Fetched {len(raw)} activities from Strava.")

    cardio, workouts = process_activities(raw, access_token=token)
    print(f"Parsed {len(cardio)} cardio activities, {len(workouts)} strength sessions")

    upsert_to_supabase(env, cardio, workouts)
    print("Done.")

if __name__ == "__main__":
    main()
