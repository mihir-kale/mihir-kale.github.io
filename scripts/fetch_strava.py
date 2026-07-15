#!/usr/bin/env python3
"""Fetch Strava activities, parse Hevy workouts from Descriptions, output JSON for the dashboard."""

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

STRAVA_AUTH_URL = "https://www.strava.com/oauth/token"
STRAVA_API_BASE = "https://www.strava.com/api/v3"
DATA_DIR = Path(__file__).resolve().parent.parent / "dashboard" / "data"

def load_env(env_path=None):
    env = {}
    for key in ("STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REFRESH_TOKEN"):
        val = os.environ.get(key)
        if val:
            env[key] = val
    if len(env) == 3:
        return env

    if env_path is None:
        env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        print(f"ERROR: .env not found and STRAVA_* env vars not set. Copy .env.example to .env and fill in your secrets.")
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
    """Parse Hevy-formatted workout text from a Strava activity description.
    Expected format:

        Logged with hevyapp.com

        Exercise Name
        Set 1: 80 lbs x 8
        Set 2: 90 lbs x 5

        Next Exercise
        Set 1: 7 reps
    """
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

        # List endpoint doesn't include descriptions; fetch detail for strength
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
            "date": start[:10],
            "type": act.get("type"),
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
                "date": start[:10],
                "name": act.get("name", ""),
                "strava_id": act["id"],
                "exercises": exercises or [],
            })

    return cardio, workouts

def compute_summary(cardio, workouts):
    monthly_cardio = {}
    for c in cardio:
        month = c["date"][:7]
        monthly_cardio.setdefault(month, {"runs": 0, "distance_km": 0, "time_min": 0, "elevation": 0})
        monthly_cardio[month]["runs"] += 1
        monthly_cardio[month]["distance_km"] += c["distance_km"]
        monthly_cardio[month]["time_min"] += c["moving_time_min"]
        monthly_cardio[month]["elevation"] += c["elevation_gain"]

    monthly_lifting = {}
    for w in workouts:
        month = w["date"][:7]
        monthly_lifting.setdefault(month, {"sessions": 0, "total_volume_kg": 0})
        monthly_lifting[month]["sessions"] += 1
        for ex in w["exercises"]:
            if "weight_kg" in ex:
                monthly_lifting[month]["total_volume_kg"] += ex["weight_kg"] * ex["sets"] * ex["reps"]

    pr_lifts = {}
    for w in workouts:
        for ex in w["exercises"]:
            if "weight_kg" in ex:
                key = ex["name"].lower()
                if key not in pr_lifts or ex["weight_kg"] > pr_lifts[key]["weight_kg"]:
                    pr_lifts[key] = {
                        "name": ex["name"],
                        "weight_kg": ex["weight_kg"],
                        "sets": ex["sets"],
                        "reps": ex["reps"],
                        "date": w["date"],
                    }

    return {
        "monthly_cardio": monthly_cardio,
        "monthly_lifting": monthly_lifting,
        "pr_lifts": pr_lifts,
        "total_cardio_activities": len(cardio),
        "total_strength_sessions": len(workouts),
        "total_distance_km": round(sum(c["distance_km"] for c in cardio), 1),
        "total_time_hours": round(sum(c["moving_time_min"] for c in cardio) / 60, 1),
    }

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

    # Fetch last 2 years of activities (or all if first run)
    two_years_ago = int((datetime.now(timezone.utc) - timedelta(days=730)).timestamp())
    raw = fetch_activities(token, after_epoch=two_years_ago)
    print(f"Fetched {len(raw)} activities from Strava.")

    cardio, workouts = process_activities(raw, access_token=token)
    summary = compute_summary(cardio, workouts)

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    output = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "cardio": cardio,
        "workouts": workouts,
    }

    data_path = DATA_DIR / "fitness-data.json"
    data_path.write_text(json.dumps(output, indent=2, default=str))
    print(f"Data written to {data_path}")
    print(f"  Cardio activities: {len(cardio)}")
    print(f"  Strength sessions: {len(workouts)}")

if __name__ == "__main__":
    main()
