# 2026 Fantasy Draft Board

Live NFL depth charts joined to consensus ADP, last season's box scores, snap
share and a Vegas-priced schedule — built to be the one page open on draft day.

**→ [jampick.github.io/NFL_Depth_Chart](https://jampick.github.io/NFL_Depth_Chart/)**

Static site, no build step, no backend. A Python pipeline pulls five public
sources and bakes everything into a single `site/data.js`; the page does the rest
in the browser.

## What's in it

| View | What it answers |
|------|-----------------|
| **Depth charts** | All 32 rooms in coach's order — starter/backup slotting, X/Z/slot roles, handcuffs, injuries, rookies, last season's per-game production behind each row |
| **Big board** | The whole pool, sortable on any column, with a draft-range whisker showing where each player actually went across thousands of mock drafts |
| **Value map** | Positional value curves (where the cliffs are, where positions cross) and a cost-vs-production scatter with a separate trend per position |
| **Bye planner** | Which weeks the draftable pool disappears, by position, plus your own roster's exposure |
| **Schedule** | Market-implied team totals and positional strength of schedule, diverging around the league average |
| **Draft room** | Mark players as they go, watch tier counts drain, see best available and who can wait |

Scoring format (PPR / half / standard / superflex) and league size (8–14) are
live controls — every number on the page recomputes, including replacement level
and therefore VORP.

## Sources

| Source | Used for |
|--------|----------|
| [Sleeper](https://docs.sleeper.com/) | 2026 rosters, depth-chart slots and order, injury status, age/experience |
| [Fantasy Football Calculator](https://fantasyfootballcalculator.com/adp) | Consensus ADP in four formats, with high/low/stdev and draft counts |
| [nflverse](https://github.com/nflverse/nflverse-data) | 2025 weekly box scores, snap counts, 2026 schedule and closing betting lines |

## Derived metrics

These are computed here from the sources above. They are **not** third-party
projections, and the site says so:

- **Tiers** — a wall goes up where the gap between consecutive ADPs exceeds the
  market's own noise about those two players (0.8 × the mean of their standard
  deviations), capped so no tier exceeds eight. A tier break means drafters treat
  the two players as different classes, not that a projection separates them.
- **Market value curve** — 2025 actual fantasy points by positional finish,
  smoothed. A player's expected value is that curve read at his current
  positional ADP rank.
- **VORP** — the curve at his rank minus the curve at replacement level, where
  replacement follows league size and roster shape (1QB/2RB/3WR/1TE/1FLEX, with
  flex absorption folded in; superflex moves the QB line).
- **Strength of schedule** — PPR points each 2026 opponent allowed to that
  position per game in 2025, averaged across weeks 1–17 and again across 15–17.
  A blunt instrument; the extremes are still worth knowing.
- **Implied team total** — `total_line / 2 ± spread_line / 2` from the closing
  lines. Only weeks 1–6 are priced this far out, so it reads as an early-season
  scoring environment, not a season-long projection.

## Running it

```bash
python tools/fetch_sources.py   # pull all five sources into data/ (~28 MB)
python tools/build_data.py      # join, derive, write site/data.js
python -m http.server -d site 8777
```

`data/` is gitignored — it is a cache, and `fetch_sources.py` rebuilds it.

## Deployment

`.github/workflows/deploy.yml` publishes `site/` to Pages on every push to
`main`, after sanity-checking that `data.js` still parses and carries 32 teams
and a plausible ADP pool.

`.github/workflows/refresh.yml` re-pulls and rebuilds the data. It is
**manual-dispatch only** by default; uncomment the `schedule:` block in that file
to have it refresh itself daily through draft season.

## Design notes

Position colours are the blue / yellow / magenta / green slots of a validated
categorical palette — the only four-hue subset that clears the colourblind and
normal-vision separation gates in *both* light and dark mode when all pairs can
appear together (as they do in the scatter). Because two of those hues fall under
3:1 against the light surface, **every position mark also carries its literal
letters**, and text inside a coloured fill picks white or ink from that fill's
luminance. Don't strip the letters off the chips — they're the accessibility
relief the palette depends on, not decoration.

## Licence

Code MIT. The underlying data belongs to its respective sources; this is a
personal draft tool, not affiliated with the NFL or any of them.
