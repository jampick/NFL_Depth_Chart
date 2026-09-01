"""Download every upstream source into data/ (cached).

Sources
-------
Sleeper  : 2026 player universe + live NFL depth charts
FFC      : consensus ADP (PPR / half / standard / superflex), refreshed daily
nflverse : 2025 weekly box scores, 2025 snap counts, 2026 schedule + Vegas lines
"""
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, os.pardir, "data")
UA = {"User-Agent": "nfl-depth-chart/1.0 (github.com/jampick/NFL_Depth_Chart)"}

NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
ADP_FORMATS = {"ppr": "ppr", "half": "half-ppr", "standard": "standard", "superflex": "2qb"}

SOURCES = [
    ("sleeper_players.json", "https://api.sleeper.app/v1/players/nfl"),
    ("week2025.csv", f"{NFLVERSE}/stats_player/stats_player_week_2025.csv"),
    ("snaps2025.csv", f"{NFLVERSE}/snap_counts/snap_counts_2025.csv"),
    ("games.csv", f"{NFLVERSE}/schedules/games.csv"),
] + [
    (f"adp_{key}.json",
     f"https://fantasyfootballcalculator.com/api/v1/adp/{slug}?teams=12&year=2026&position=all")
    for key, slug in ADP_FORMATS.items()
]


def grab(name, url, tries=3):
    dest = os.path.join(DATA, name)
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=180) as resp:
                blob = resp.read()
            if len(blob) < 500:
                raise ValueError(f"suspiciously small response ({len(blob)}B)")
            with open(dest, "wb") as fh:
                fh.write(blob)
            print(f"  ok   {name:24s} {len(blob):>10,}B")
            return True
        except Exception as exc:                                  # noqa: BLE001
            print(f"  retry {name} ({attempt}/{tries}): {exc}", file=sys.stderr)
            time.sleep(2 * attempt)
    print(f"  FAIL {name}", file=sys.stderr)
    return False


def main():
    os.makedirs(DATA, exist_ok=True)
    print("fetching sources ->", os.path.realpath(DATA))
    ok = all([grab(name, url) for name, url in SOURCES])
    if not ok:
        sys.exit(1)
    stamp = {"fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with open(os.path.join(DATA, "fetched.json"), "w") as fh:
        json.dump(stamp, fh)
    print("all sources ok")


if __name__ == "__main__":
    main()
