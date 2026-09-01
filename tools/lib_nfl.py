"""Shared vocabulary: team identity, name normalisation, fantasy scoring."""
import re
import unicodedata

# Canonical 32. Colours are the primary/secondary used by the site's team cards.
TEAMS = {
    "ARI": ("Arizona Cardinals",      "NFC", "West",  "#97233F", "#FFB612"),
    "ATL": ("Atlanta Falcons",        "NFC", "South", "#A71930", "#000000"),
    "BAL": ("Baltimore Ravens",       "AFC", "North", "#241773", "#9E7C0C"),
    "BUF": ("Buffalo Bills",          "AFC", "East",  "#00338D", "#C60C30"),
    "CAR": ("Carolina Panthers",      "NFC", "South", "#0085CA", "#101820"),
    "CHI": ("Chicago Bears",          "NFC", "North", "#0B162A", "#C83803"),
    "CIN": ("Cincinnati Bengals",     "AFC", "North", "#FB4F14", "#000000"),
    "CLE": ("Cleveland Browns",       "AFC", "North", "#311D00", "#FF3C00"),
    "DAL": ("Dallas Cowboys",         "NFC", "East",  "#041E42", "#869397"),
    "DEN": ("Denver Broncos",         "AFC", "West",  "#FB4F14", "#002244"),
    "DET": ("Detroit Lions",          "NFC", "North", "#0076B6", "#B0B7BC"),
    "GB":  ("Green Bay Packers",      "NFC", "North", "#203731", "#FFB612"),
    "HOU": ("Houston Texans",         "AFC", "South", "#03202F", "#A71930"),
    "IND": ("Indianapolis Colts",     "AFC", "South", "#002C5F", "#A2AAAD"),
    "JAX": ("Jacksonville Jaguars",   "AFC", "South", "#006778", "#D7A22A"),
    "KC":  ("Kansas City Chiefs",     "AFC", "West",  "#E31837", "#FFB81C"),
    "LAC": ("Los Angeles Chargers",   "AFC", "West",  "#0080C6", "#FFC20E"),
    "LAR": ("Los Angeles Rams",       "NFC", "West",  "#003594", "#FFA300"),
    "LV":  ("Las Vegas Raiders",      "AFC", "West",  "#000000", "#A5ACAF"),
    "MIA": ("Miami Dolphins",         "AFC", "East",  "#008E97", "#FC4C02"),
    "MIN": ("Minnesota Vikings",      "NFC", "North", "#4F2683", "#FFC62F"),
    "NE":  ("New England Patriots",   "AFC", "East",  "#002244", "#C60C30"),
    "NO":  ("New Orleans Saints",     "NFC", "South", "#101820", "#D3BC8D"),
    "NYG": ("New York Giants",        "NFC", "East",  "#0B2265", "#A71930"),
    "NYJ": ("New York Jets",          "AFC", "East",  "#125740", "#FFFFFF"),
    "PHI": ("Philadelphia Eagles",    "NFC", "East",  "#004C54", "#A5ACAF"),
    "PIT": ("Pittsburgh Steelers",    "AFC", "North", "#FFB612", "#101820"),
    "SEA": ("Seattle Seahawks",       "NFC", "West",  "#002244", "#69BE28"),
    "SF":  ("San Francisco 49ers",    "NFC", "West",  "#AA0000", "#B3995D"),
    "TB":  ("Tampa Bay Buccaneers",   "NFC", "South", "#D50A0A", "#0A0A08"),
    "TEN": ("Tennessee Titans",       "AFC", "South", "#0C2340", "#4B92DB"),
    "WAS": ("Washington Commanders",  "NFC", "East",  "#5A1414", "#FFB612"),
}

# Every alias any of the four feeds has ever emitted -> canonical.
_ALIAS = {
    "LA": "LAR", "STL": "LAR", "SL": "LAR", "RAM": "LAR", "RAMS": "LAR",
    "SD": "LAC", "SDG": "LAC", "OAK": "LV", "OAK ": "LV", "LVR": "LV", "RAI": "LV",
    "JAC": "JAX", "WSH": "WAS", "WFT": "WAS", "ARZ": "ARI", "BLT": "BAL",
    "CLV": "CLE", "HST": "HOU", "GNB": "GB", "KAN": "KC", "NWE": "NE",
    "NOR": "NO", "SFO": "SF", "TAM": "TB", "TAB": "TB",
}

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
# Feeds disagree on these; map both sides onto one spelling.
_NICK = {
    "kenneth walker iii": "kenneth walker", "marvin harrison jr": "marvin harrison",
    "michael penix jr": "michael penix", "brian thomas jr": "brian thomas",
    "travis etienne jr": "travis etienne", "odell beckham jr": "odell beckham",
    "chig okonkwo": "chigoziem okonkwo", "gabe davis": "gabriel davis",
    "josh palmer": "joshua palmer", "cam ward": "cameron ward",
    "hollywood brown": "marquise brown", "deebo samuel sr": "deebo samuel",
    "tank bigsby": "thomas bigsby", "demario douglas": "demario douglas",
    "tank dell": "nathaniel dell", "scotty miller": "scott miller",
    "mike thomas": "michael thomas", "chris rodriguez jr": "chris rodriguez",
    "tyrone tracy jr": "tyrone tracy", "aj brown": "a j brown",
    "dj moore": "d j moore", "tj hockenson": "t j hockenson",
    "cj stroud": "c j stroud", "jk dobbins": "j k dobbins",
    "dk metcalf": "d k metcalf", "ceedee lamb": "ceedee lamb",
    "aj dillon": "a j dillon", "dj chark": "d j chark",
    "kj osborn": "k j osborn", "jj smith-schuster": "juju smith-schuster",
    "juju smith schuster": "juju smith-schuster",
    "kenneth gainwell": "kenny gainwell",
}

# Feeds label the same role differently: snap counts say HB, box scores say RB.
POS_ALIAS = {"HB": "RB", "FB": "RB", "WR/RB": "WR", "PK": "K", "SS": "S", "FS": "S"}


def team(code):
    """Canonicalise a team abbreviation from any feed."""
    if not code:
        return None
    c = str(code).strip().upper()
    c = _ALIAS.get(c, c)
    return c if c in TEAMS else None


def norm_name(name):
    """Fold a player name to a join key: ascii, lowercase, no punctuation, no suffix."""
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", str(name))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower().replace("&", " and ").replace("-", " ")
    s = re.sub(r"[^a-z0-9 ]", "", s)
    parts = [p for p in s.split() if p]
    while len(parts) > 2 and parts[-1] in SUFFIXES:
        parts.pop()
    s = " ".join(parts)
    s = _NICK.get(s, s)
    # "a j brown" and "aj brown" must land on the same key
    return re.sub(r"\s+", " ", s).strip()


def pos(code):
    """Canonicalise a position label from any feed."""
    c = (code or "").upper().strip()
    return POS_ALIAS.get(c, c)


def key(name, position):
    return f"{norm_name(name)}|{pos(position)}"


# --- fantasy scoring -------------------------------------------------------
# Standard-issue redraft scoring; the only axis that varies is per-reception.
RECEPTION_PTS = {"ppr": 1.0, "half": 0.5, "standard": 0.0}


def fantasy_points(row, fmt="ppr"):
    """Fantasy points for one weekly box-score row (offence only)."""
    g = lambda k: float(row.get(k) or 0)                            # noqa: E731
    pts = (
        g("passing_yards") * 0.04
        + g("passing_tds") * 4
        + g("passing_interceptions") * -2
        + g("rushing_yards") * 0.1
        + g("rushing_tds") * 6
        + g("receiving_yards") * 0.1
        + g("receiving_tds") * 6
        + g("receptions") * RECEPTION_PTS[fmt]
        + (g("rushing_fumbles_lost") + g("receiving_fumbles_lost") + g("sack_fumbles_lost")) * -2
        + (g("passing_2pt_conversions") + g("rushing_2pt_conversions")
           + g("receiving_2pt_conversions")) * 2
        + g("special_teams_tds") * 6
    )
    return round(pts, 2)
