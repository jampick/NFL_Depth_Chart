"""Join every source into site/data.js.

Produces one global, window.NFLDC, holding:
  meta     provenance + freshness stamps
  teams    32 teams: bye, 2026 schedule, Vegas-implied totals, positional SOS
  players  fantasy-relevant players: depth-chart slot, ADP in 4 formats,
           2025 production, weekly game log, snap share, boom/bust profile
  curve    2025 points-by-positional-finish, so the page can recompute
           replacement level (and therefore VORP) for any league size
"""
import csv
import json
import math
import os
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_nfl as L                                               # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, os.pardir, "data")
SITE = os.path.join(HERE, os.pardir, "site")

SEASON, PRIOR = 2026, 2025
FMTS = ("ppr", "half", "standard", "superflex")
SCORING = ("ppr", "half", "standard")
FPOS = ("QB", "RB", "WR", "TE")
# Fresh ADP is only used if it is preseason and has volume behind it. Once a
# format's window runs past kickoff, or falls under this many drafts (in-season
# FFC drops to ~100 drafts covering a few dozen players), the build keeps the
# ADP already baked into site/data.js instead. August pulls ran 1,884 to 8,161.
MIN_ADP_DRAFTS = 1000
# Fantasy regular season. Byes and SOS are judged over these weeks only.
FANTASY_WEEKS = range(1, 18)
PLAYOFF_WEEKS = (15, 16, 17)

csv.field_size_limit(10_000_000)


def load_csv(name):
    with open(os.path.join(DATA, name), newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def load_json(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as fh:
        return json.load(fh)


def num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def load_previous():
    """The payload in the current site/data.js, or {} if there isn't one."""
    try:
        with open(os.path.join(SITE, "data.js"), encoding="utf-8") as fh:
            src = fh.read()
        return json.loads(src[src.index("{"):src.rindex("}") + 1])
    except (OSError, ValueError):
        return {}


def rank_map(values, high_is_good=True):
    """{key: 1-based rank} over a {key: value} mapping."""
    order = sorted(values, key=lambda k: values[k], reverse=high_is_good)
    return {k: i + 1 for i, k in enumerate(order)}


# ---------------------------------------------------------------- schedule --
def build_schedule():
    """2026 byes, per-week opponents, and Vegas-implied team totals."""
    games = [g for g in load_csv("games.csv")
             if g["season"] == str(SEASON) and g["game_type"] == "REG"]
    sched = defaultdict(dict)
    implied = defaultdict(list)

    for g in games:
        wk = int(g["week"])
        home, away = L.team(g["home_team"]), L.team(g["away_team"])
        if not home or not away:
            continue
        total, spread = g.get("total_line"), g.get("spread_line")
        h_imp = a_imp = None
        if total and spread:
            # nflverse spread_line is positive when the home side is favoured.
            t, s = num(total), num(spread)
            h_imp, a_imp = round(t / 2 + s / 2, 2), round(t / 2 - s / 2, 2)
            implied[home].append(h_imp)
            implied[away].append(a_imp)
        sched[home][wk] = {"wk": wk, "opp": away, "home": 1, "imp": h_imp}
        sched[away][wk] = {"wk": wk, "opp": home, "home": 0, "imp": a_imp}

    byes = {}
    for t in L.TEAMS:
        played = set(sched[t])
        missing = [w for w in FANTASY_WEEKS if w not in played]
        byes[t] = missing[0] if missing else None
    return sched, byes, implied


# --------------------------------------------------------------- 2025 form --
def build_prior_season():
    """Per-player 2025 aggregates + game log, and per-defence points allowed."""
    rows = [r for r in load_csv("week2025.csv")
            if r.get("season_type") == "REG" and r.get("season") == str(PRIOR)]

    agg = defaultdict(lambda: {
        "g": 0, "pts": {f: 0.0 for f in SCORING}, "log": [],
        "tgt": 0.0, "rec": 0.0, "recyd": 0.0, "rectd": 0.0,
        "car": 0.0, "rushyd": 0.0, "rushtd": 0.0,
        "payd": 0.0, "patd": 0.0, "int": 0.0, "cmp": 0.0, "att": 0.0,
        "tgtshare": [], "wopr": [], "recepa": 0.0, "rushepa": 0.0, "airyd": 0.0,
        "team": None, "pos": None, "name": None,
    })
    # (defence, position, week) -> PPR points surrendered
    fpa_week = defaultdict(float)
    fpa = defaultdict(lambda: defaultdict(list))

    for r in rows:
        pos = L.pos(r.get("position"))
        if pos not in FPOS:
            continue
        name = r.get("player_display_name") or r.get("player_name")
        k = L.key(name, pos)
        a = agg[k]
        a["name"] = a["name"] or name
        a["pos"] = pos
        tm = L.team(r.get("team"))
        if tm:
            a["team"] = tm

        ppr = L.fantasy_points(r, "ppr")
        a["g"] += 1
        for f in SCORING:
            a["pts"][f] += L.fantasy_points(r, f)
        a["log"].append({"w": int(r["week"]), "o": L.team(r.get("opponent_team")),
                         "p": ppr})

        for dst, src in (("tgt", "targets"), ("rec", "receptions"),
                         ("recyd", "receiving_yards"), ("rectd", "receiving_tds"),
                         ("car", "carries"), ("rushyd", "rushing_yards"),
                         ("rushtd", "rushing_tds"), ("payd", "passing_yards"),
                         ("patd", "passing_tds"), ("int", "passing_interceptions"),
                         ("cmp", "completions"), ("att", "attempts"),
                         ("recepa", "receiving_epa"), ("rushepa", "rushing_epa"),
                         ("airyd", "receiving_air_yards")):
            a[dst] += num(r.get(src))
        for dst, src in (("tgtshare", "target_share"), ("wopr", "wopr")):
            v = r.get(src)
            if v not in (None, "", "NA"):
                a[dst].append(num(v))

        opp = L.team(r.get("opponent_team"))
        if opp:
            fpa_week[(opp, pos, int(r["week"]))] += ppr

    for (opp, pos, _wk), pts in fpa_week.items():
        fpa[opp][pos].append(pts)

    # Snap share: mean offensive snap % across games the player appeared in.
    snaps = defaultdict(list)
    for r in load_csv("snaps2025.csv"):
        if r.get("season") != str(PRIOR) or r.get("game_type") != "REG":
            continue
        pos = L.pos(r.get("position"))
        if pos not in FPOS:
            continue
        pct = r.get("offense_pct")
        if pct not in (None, "", "NA"):
            snaps[L.key(r.get("player"), pos)].append(num(pct))

    for k, a in agg.items():
        s = snaps.get(k)
        a["snap"] = round(statistics.mean(s) * 100, 1) if s else None
    return agg, fpa


def summarise_player_season(a):
    """Condense one player's 2025 into the shape the page renders."""
    g = a["g"]
    if not g:
        return None
    log = sorted(a["log"], key=lambda x: x["w"])
    vals = [x["p"] for x in log]
    out = {
        "g": g,
        "ppg": {f: round(a["pts"][f] / g, 2) for f in SCORING},
        "pts": {f: round(a["pts"][f], 1) for f in SCORING},
        "tgt": int(a["tgt"]), "rec": int(a["rec"]), "recyd": int(a["recyd"]),
        "rectd": int(a["rectd"]), "car": int(a["car"]), "rushyd": int(a["rushyd"]),
        "rushtd": int(a["rushtd"]), "payd": int(a["payd"]), "patd": int(a["patd"]),
        "int": int(a["int"]), "snap": a["snap"],
        "log": log,
    }
    out["tds"] = int(a["rectd"] + a["rushtd"])
    if a["tgtshare"]:
        out["tgtshare"] = round(statistics.mean(a["tgtshare"]) * 100, 1)
    if a["wopr"]:
        out["wopr"] = round(statistics.mean(a["wopr"]), 3)
    if a["tgt"]:
        out["ypt"] = round(a["recyd"] / a["tgt"], 2)
        out["adot"] = round(a["airyd"] / a["tgt"], 1) if a["airyd"] else None
    if a["car"]:
        out["ypc"] = round(a["rushyd"] / a["car"], 2)
    if a["att"]:
        out["ypa"] = round(a["payd"] / a["att"], 2)
        out["cmppct"] = round(a["cmp"] / a["att"] * 100, 1)
    out["epa"] = round(a["recepa"] + a["rushepa"], 1)

    # Consistency: how often a week cleared a startable line, and how often it
    # cratered. Thresholds are the usual positional rules of thumb.
    boom = {"QB": 24, "RB": 18, "WR": 18, "TE": 14}.get(a["pos"], 18)
    bust = {"QB": 12, "RB": 8, "WR": 8, "TE": 6}.get(a["pos"], 8)
    out["boom"] = sum(1 for v in vals if v >= boom)
    out["bust"] = sum(1 for v in vals if v < bust)
    out["best"] = round(max(vals), 1)
    if len(vals) >= 4:
        srt = sorted(vals)
        out["floor"] = round(srt[max(0, int(len(srt) * 0.2) - 1)], 1)
        out["ceil"] = round(srt[min(len(srt) - 1, int(len(srt) * 0.8))], 1)
        m = statistics.mean(vals)
        out["cv"] = round(statistics.pstdev(vals) / m, 2) if m > 0 else None
    return out


# -------------------------------------------------------------------- SOS ---
def build_sos(fpa, sched):
    """Rank each 2026 schedule by the defences it faces, per position.

    Defence quality is 2025 PPR points allowed per game to that position.
    A soft schedule (lots of generous defences) ranks 1.
    """
    allowed, drank = {}, {}
    for pos in FPOS:
        per_team = {}
        for t in L.TEAMS:
            games = fpa.get(t, {}).get(pos, [])
            per_team[t] = round(statistics.mean(games), 2) if games else None
        vals = [v for v in per_team.values() if v is not None]
        league = statistics.mean(vals) if vals else 0.0
        per_team = {t: (v if v is not None else round(league, 2))
                    for t, v in per_team.items()}
        allowed[pos] = per_team
        drank[pos] = rank_map(per_team, high_is_good=True)   # 1 = most generous

    sos = {}
    for t in L.TEAMS:
        entry = {}
        for pos in FPOS:
            season, playoffs = [], []
            for wk in FANTASY_WEEKS:
                gm = sched[t].get(wk)
                if not gm:
                    continue
                v = allowed[pos][gm["opp"]]
                season.append(v)
                if wk in PLAYOFF_WEEKS:
                    playoffs.append(v)
            entry[pos] = {
                "fpa": round(statistics.mean(season), 2) if season else None,
                "po": round(statistics.mean(playoffs), 2) if playoffs else None,
            }
        sos[t] = entry

    for pos in FPOS:
        for scope in ("fpa", "po"):
            vals = {t: sos[t][pos][scope] for t in L.TEAMS
                    if sos[t][pos][scope] is not None}
            rk = rank_map(vals, high_is_good=True)
            for t in L.TEAMS:
                sos[t][pos][scope + "_rk"] = rk.get(t)
    return sos, allowed, drank


# -------------------------------------------------------------------- ADP ---
def previous_adp(fmt, kickoff):
    """One format's ADP out of the current site/data.js, in FFC's own shape.

    data/ is a throwaway cache (and empty in CI), so the last build is the only
    place the preseason ADP survives once FFC's in-season pool dries up.
    """
    old = load_previous()
    meta = old.get("meta", {}).get("adp", {}).get(fmt)
    if not meta or not usable_adp(meta, kickoff):
        return None
    rows = []
    for p in old.get("players", []):
        a = p.get("adp", {}).get(fmt)
        if a:
            rows.append({"name": p["name"], "position": p["pos"], "team": a.get("team"),
                         "adp": a["adp"], "high": a.get("hi"), "low": a.get("lo"),
                         "stdev": a.get("sd"), "times_drafted": a.get("n"),
                         "bye": a.get("bye")})
    return {"meta": meta, "players": rows}


def usable_adp(meta, kickoff):
    return ((meta.get("total_drafts") or 0) >= MIN_ADP_DRAFTS
            and (meta.get("end_date") or "") < kickoff)


def build_adp():
    """{playerkey: {fmt: {...}}} plus per-format overall and positional ranks."""
    kickoff = min(g["gameday"] for g in load_csv("games.csv")
                  if g["season"] == str(SEASON) and g["game_type"] == "REG")
    adp = defaultdict(dict)
    meta = {}
    for fmt in FMTS:
        blob = load_json("adp_%s.json" % fmt)
        fresh = blob.get("meta", {})
        if not usable_adp(fresh, kickoff):
            kept = previous_adp(fmt, kickoff)
            if kept:
                print("  adp %s: fresh pull is %d drafts ending %s, keeping %d from the last build"
                      % (fmt, fresh.get("total_drafts") or 0, fresh.get("end_date"),
                         kept["meta"].get("total_drafts") or 0))
                blob = kept
        meta[fmt] = blob.get("meta", {})
        for r in blob.get("players", []):
            pos = L.pos(r.get("position"))
            if pos not in FPOS:
                continue
            k = L.key(r.get("name"), pos)
            adp[k][fmt] = {
                "adp": round(num(r.get("adp")), 1),
                "hi": r.get("high"), "lo": r.get("low"),
                "sd": round(num(r.get("stdev")), 2),
                "n": r.get("times_drafted"),
                "team": L.team(r.get("team")),
                "bye": r.get("bye"),
            }
    for fmt in FMTS:
        pool = defaultdict(list)
        for k, per in adp.items():
            if fmt in per:
                pool[k.split("|")[1]].append((per[fmt]["adp"], k))
        for _pos, lst in pool.items():
            for i, (_a, k) in enumerate(sorted(lst)):
                adp[k][fmt]["prk"] = i + 1
        allp = sorted((per[fmt]["adp"], k) for k, per in adp.items() if fmt in per)
        for i, (_a, k) in enumerate(allp):
            adp[k][fmt]["ork"] = i + 1
    return adp, meta


def build_tiers(players, fmt="ppr", k=0.8, max_size=8):
    """Tier walls where the market separates two players beyond its own noise.

    Consecutive ADPs are compared against the spread of the picks they actually
    went at: if the gap between two players is wider than ``k`` times their
    typical disagreement, drafters are treating them as different classes of
    player. ``max_size`` stops a flat stretch of the board becoming one tier
    nobody can act on.
    """
    tiers = {}
    for pos in FPOS:
        pool = sorted((p["adp"][fmt]["adp"], p["adp"][fmt].get("sd") or 0.0, p["id"])
                      for p in players
                      if p["pos"] == pos and p.get("adp", {}).get(fmt))
        n = len(pool)
        tier, size = 1, 0
        for i, (adp, sd, pid) in enumerate(pool):
            tiers[pid] = tier
            size += 1
            if i == n - 1:
                continue
            nxt_adp, nxt_sd = pool[i + 1][0], pool[i + 1][1]
            noise = max(1.0, (sd + nxt_sd) / 2)
            if (nxt_adp - adp) >= k * noise or size >= max_size:
                tier, size = tier + 1, 0
    return tiers


def build_curve(prior):
    """2025 points-by-positional-finish, smoothed. Feeds live VORP in the page."""
    curve = {}
    for fmt in SCORING:
        for pos in FPOS:
            season = sorted((a["pts"][fmt] for a in prior.values()
                             if a["pos"] == pos and a["g"] >= 4), reverse=True)
            # 3-wide rolling mean flattens noise between adjacent finishes.
            sm = [round(statistics.mean(season[max(0, i - 1):min(len(season), i + 2)]), 1)
                  for i in range(len(season))]
            curve.setdefault(fmt, {})[pos] = sm[:80]
    return curve


# ---------------------------------------------------------------- roster ----
# Sleeper slots the three receiver spots separately; fantasy cares about the
# merged ordering, so LWR/RWR/SWR all fold into WR.
SLOT_TO_POS = {"QB": "QB", "RB": "RB", "TE": "TE",
               "LWR": "WR", "RWR": "WR", "SWR": "WR", "WR": "WR"}
SLOT_LABEL = {"LWR": "X", "RWR": "Z", "SWR": "Slot"}


def build_players(adp, byes):
    """The fantasy-relevant player universe, with depth-chart slotting."""
    raw = load_json("sleeper_players.json")
    out = []
    for pid, p in raw.items():
        pos = L.pos(p.get("position"))
        if pos not in FPOS:
            # Two-way players (Travis Hunter) carry a defensive primary position
            # but a fantasy one too. Only follow it for players being drafted,
            # or every fullback lands in the RB room.
            alt = [L.pos(f) for f in p.get("fantasy_positions") or []]
            pos = next((f for f in alt if f in FPOS
                        and L.key(p.get("full_name"), f) in adp), None)
            if pos is None:
                continue
        tm = L.team(p.get("team"))
        k = L.key(p.get("full_name"), pos)
        has_adp = k in adp
        # Keep anyone rostered on a real depth chart, plus anyone being drafted
        # (covers free agents and players Sleeper has not slotted yet).
        if not tm and not has_adp:
            continue
        if tm and not has_adp and p.get("depth_chart_order") is None:
            if (p.get("search_rank") or 9999) > 400:
                continue
        slot = p.get("depth_chart_position")
        rec = {
            "id": pid,
            "name": p.get("full_name") or "%s %s" % (p.get("first_name"), p.get("last_name")),
            "pos": pos,
            "team": tm,
            "slot": slot if slot in SLOT_TO_POS else None,
            "slotlab": SLOT_LABEL.get(slot),
            "dord": p.get("depth_chart_order"),
            "age": p.get("age"),
            "exp": p.get("years_exp"),
            "num": p.get("number"),
            "ht": p.get("height"),
            "wt": p.get("weight"),
            "col": p.get("college"),
            "srank": p.get("search_rank"),
            "inj": p.get("injury_status"),
            "injbody": p.get("injury_body_part"),
            "status": p.get("status"),
            "bye": byes.get(tm),
            "adp": adp.get(k, {}),
            "_k": k,
        }
        rec["rookie"] = (rec["exp"] == 0)
        out.append(rec)
    return out


def assign_depth(players):
    """Order each team's room at each fantasy position, then badge the roles.

    Sleeper's slot order is the authority on who starts; ADP breaks ties and
    places anyone Sleeper has not slotted.
    """
    rooms = defaultdict(list)
    for p in players:
        if p["team"]:
            rooms[(p["team"], p["pos"])].append(p)

    for (_tm, pos), room in rooms.items():
        def sortkey(p):
            adp = p["adp"].get("ppr", {}).get("adp")
            return (
                p["dord"] if p["dord"] is not None else 99,
                adp if adp is not None else 999,
                p["srank"] if p["srank"] is not None else 9999,
                p["name"],
            )
        room.sort(key=sortkey)
        for i, p in enumerate(room):
            p["depth"] = i + 1
            p["role"] = "%s%d" % (pos, i + 1)
            p["starter"] = i < {"QB": 1, "RB": 1, "WR": 3, "TE": 1}[pos]

    # A team's RB1 has a handcuff: the next back in the room.
    for (_tm, pos), room in rooms.items():
        if pos == "RB" and len(room) > 1:
            room[0]["handcuff"] = room[1]["id"]
            room[1]["cuffs"] = room[0]["id"]
    for p in players:
        p.setdefault("depth", None)
        p.setdefault("role", None)
        p.setdefault("starter", False)
    return players


def main():
    print("building %s draft data" % SEASON)
    sched, byes, implied = build_schedule()
    print("  schedule: %d teams, byes %d..%d" % (
        len(sched), min(v for v in byes.values() if v), max(v for v in byes.values() if v)))

    prior, fpa = build_prior_season()
    print("  2025: %d players with box scores" % len(prior))

    sos, allowed, drank = build_sos(fpa, sched)
    adp, adpmeta = build_adp()
    print("  adp: %d drafted players across %d formats" % (len(adp), len(FMTS)))

    players = assign_depth(build_players(adp, byes))
    print("  players: %d in the universe" % len(players))

    # Attach 2025 production by the same name+position key used everywhere else.
    matched = 0
    for p in players:
        a = prior.get(p["_k"])
        if a:
            s = summarise_player_season(a)
            if s:
                p["s25"] = s
                matched += 1
        p.pop("_k", None)
    print("  joined 2025 production onto %d players" % matched)

    tiers = build_tiers(players, "ppr")
    tiers_sf = build_tiers(players, "superflex")
    for p in players:
        if tiers.get(p["id"]):
            p["tier"] = tiers[p["id"]]
        if tiers_sf.get(p["id"]):
            p["tier_sf"] = tiers_sf[p["id"]]

    # Team-level offence environment from the Vegas board (weeks 1-6 are priced).
    team_imp = {t: round(statistics.mean(v), 2) for t, v in implied.items() if v}
    imp_rank = rank_map(team_imp, high_is_good=True)

    teams = {}
    for t, (name, conf, div, c1, c2) in L.TEAMS.items():
        teams[t] = {
            "name": name, "conf": conf, "div": div, "c1": c1, "c2": c2,
            "bye": byes.get(t),
            "imp": team_imp.get(t),
            "imprk": imp_rank.get(t),
            "sos": sos[t],
            "sched": [sched[t].get(w) for w in FANTASY_WEEKS],
        }

    payload = {
        "meta": {
            "season": SEASON,
            "prior": PRIOR,
            "generated": json.load(open(os.path.join(DATA, "fetched.json")))["fetched_utc"],
            "adp": {f: adpmeta.get(f, {}) for f in FMTS},
            "impliedWeeks": "1-6 (the weeks the market has priced)",
            "sources": [
                "Sleeper — 2026 rosters, depth charts, injuries",
                "Fantasy Football Calculator — consensus ADP, 12-team",
                "nflverse — 2025 box scores, snap counts, 2026 schedule + closing lines",
            ],
        },
        "teams": teams,
        "players": players,
        "curve": build_curve(prior),
        "defense": {"allowed": allowed, "rank": drank},
    }

    # The fetch stamp changes every run. If nothing else did, keep the old one so
    # data.js stays byte-identical and the daily refresh has nothing to commit.
    prev = load_previous()
    if prev.get("meta", {}).get("generated"):
        payload["meta"]["generated"], stamp = prev["meta"]["generated"], payload["meta"]["generated"]
        if json.loads(json.dumps(payload)) != prev:
            payload["meta"]["generated"] = stamp

    os.makedirs(SITE, exist_ok=True)
    dest = os.path.join(SITE, "data.js")
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write("// Generated by tools/build_data.py - do not edit by hand.\n")
        fh.write("window.NFLDC = ")
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write(";\n")
    print("  wrote %s (%.1f KB)" % (dest, os.path.getsize(dest) / 1024))


if __name__ == "__main__":
    main()
