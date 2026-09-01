/* 2026 Draft Board — rendering + derived draft maths.
 *
 * Everything downstream of a control change flows through render(): the filter
 * row scopes every view, so the numbers on screen always agree with each other.
 */
(function () {
"use strict";

var D = window.NFLDC;
var POS = ["QB", "RB", "WR", "TE"];
var LS_KEY = "nfldc.drafted.v1";

/* Roster assumptions behind replacement level. Flex absorption is folded into
 * the multipliers — the usual 1QB/2RB/3WR/1TE/1FLEX redraft shape. */
var REPL_MULT = { QB: 1.05, RB: 2.5, WR: 3.5, TE: 1.15 };
var REPL_MULT_SF = { QB: 1.8, RB: 2.5, WR: 3.4, TE: 1.15 };

var state = {
  view: "depth",
  fmt: "ppr",
  size: 12,
  pos: "ALL",
  q: "",
  hideDrafted: false,
  sort: { key: "adp", dir: 1 },
  drafted: loadDrafted(),
};

/* ------------------------------------------------------------------ utils */
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

function el(tag, cls, txt) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;      // names are API data — never innerHTML
  return n;
}
function svgEl(tag, attrs) {
  var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  return n;
}
function posColor(p) {
  return getComputedStyle(document.documentElement).getPropertyValue("--p-" + p).trim();
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function rgbOf(hex) {
  var c = (hex || "").trim().replace("#", "");
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  if (c.length < 6) return [0, 0, 0];
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
function relLum(hex) {
  return rgbOf(hex).map(function (v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }).reduce(function (a, v, i) { return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
}
/* A label inside a coloured fill picks white or ink by the fill's own luminance.
 * White on the yellow RB slot is about 1.9:1 and unreadable, and these position
 * letters are exactly the relief the validated palette depends on. */
function inkOn(hex) {
  var L = relLum(hex);
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? "#ffffff" : "#10100f";
}
function mixHex(a, b, t) {
  var x = rgbOf(a), y = rgbOf(b);
  return "#" + [0, 1, 2].map(function (i) {
    return ("0" + Math.round(x[i] * t + y[i] * (1 - t)).toString(16)).slice(-2);
  }).join("");
}
/* Paint a colour onto an element and give it text that clears contrast. */
function paint(node, hex) {
  node.style.background = hex;
  node.style.color = inkOn(hex);
  return node;
}
function num(v, d) { return (v == null || isNaN(v)) ? (d == null ? "—" : d) : v; }
function one(v) { return v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1); }

function loadDrafted() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]")); }
  catch (e) { return new Set(); }
}
function saveDrafted() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(state.drafted))); }
  catch (e) { /* private mode — draft state just won't persist */ }
}

/* Superflex ADP is drafted under PPR scoring, so it reads the PPR curve. */
function scoringOf(fmt) { return fmt === "superflex" ? "ppr" : fmt; }

function adpOf(p) { return p.adp && p.adp[state.fmt] ? p.adp[state.fmt] : null; }
function tierOf(p) { return state.fmt === "superflex" ? p.tier_sf : p.tier; }

/* Market curve: what a player who finishes at positional rank r has historically
 * been worth. Beyond the observed curve, decay gently rather than falling off. */
function curveAt(pos, rank) {
  var arr = D.curve[scoringOf(state.fmt)][pos];
  if (!arr || !arr.length) return 0;
  var i = Math.max(1, Math.round(rank)) - 1;
  if (i < arr.length) return arr[i];
  var last = arr[arr.length - 1];
  return Math.max(0, last - (i - arr.length + 1) * (last / arr.length) * 0.6);
}
function replacementRank(pos) {
  var m = state.fmt === "superflex" ? REPL_MULT_SF : REPL_MULT;
  return Math.round(state.size * m[pos]);
}
/* Value over replacement, in season points, at the current format + league size. */
function vorpOf(p) {
  var a = adpOf(p);
  if (!a || !a.prk) return null;
  return Math.round(curveAt(p.pos, a.prk) - curveAt(p.pos, replacementRank(p.pos)));
}

function pool() {
  var q = state.q.trim().toLowerCase();
  return D.players.filter(function (p) {
    if (state.pos !== "ALL" && p.pos !== state.pos) return false;
    if (state.hideDrafted && state.drafted.has(p.id)) return false;
    if (q) {
      var t = D.teams[p.team];
      var hay = p.name.toLowerCase() + " " + (p.team || "").toLowerCase() +
                " " + (t ? t.name.toLowerCase() : "");
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}
function drafteds() { return D.players.filter(function (p) { return state.drafted.has(p.id); }); }

/* ---------------------------------------------------------------- tooltip */
var tipEl = $("#tip");
function showTip(html, x, y) {
  tipEl.innerHTML = "";
  tipEl.appendChild(html);
  tipEl.hidden = false;
  var r = tipEl.getBoundingClientRect();
  var left = Math.min(x + 14, window.innerWidth - r.width - 10);
  var top = y - r.height - 12;
  if (top < 8) top = y + 18;
  tipEl.style.left = Math.max(8, left) + "px";
  tipEl.style.top = top + "px";
}
function hideTip() { tipEl.hidden = true; }

function tipBox(title, rows) {
  var f = document.createDocumentFragment();
  f.appendChild(el("b", null, title));
  rows.forEach(function (r) {
    if (r[1] == null) return;
    var d = el("div", "trow");
    if (r[2]) { var i = el("i"); i.style.background = r[2]; d.appendChild(i); }
    d.appendChild(el("span", "tv", String(r[1])));
    d.appendChild(el("span", "tl", r[0]));
    f.appendChild(d);
  });
  return f;
}

/* ------------------------------------------------------------ depth charts */
function renderDepth(root) {
  root.appendChild(vhead("Depth charts",
    "Every team's room, ordered the way the coaching staff has it. The bar behind each " +
    "player is his 2025 fantasy points per game measured against the best at his position; " +
    "ADP is the current consensus pick. Click anyone for the full card."));

  var teams = Object.keys(D.teams).sort(function (a, b) {
    return D.teams[a].name.localeCompare(D.teams[b].name);
  });
  var ps = pool();
  var byTeam = {};
  ps.forEach(function (p) { if (p.team) (byTeam[p.team] = byTeam[p.team] || []).push(p); });

  // Position-max PPG sets the bar scale, so bars are comparable across teams.
  var maxPPG = {};
  POS.forEach(function (pos) {
    maxPPG[pos] = Math.max.apply(null, D.players.filter(function (p) {
      return p.pos === pos && p.s25 && p.s25.g >= 6;
    }).map(function (p) { return p.s25.ppg[scoringOf(state.fmt)]; }).concat([1]));
  });

  var grid = el("div", "teamgrid");
  var shown = 0;
  teams.forEach(function (tk) {
    var roster = byTeam[tk];
    if (!roster || !roster.length) return;
    shown++;
    grid.appendChild(teamCard(tk, roster, maxPPG));
  });
  if (!shown) grid.appendChild(el("p", "emptynote", "No players match those filters."));
  root.appendChild(grid);
}

function teamCard(tk, roster, maxPPG) {
  var t = D.teams[tk];
  var card = el("article", "card team");
  card.style.setProperty("--tc1", t.c1);
  card.style.setProperty("--tc2", t.c2);

  var hd = el("div", "team-hd");
  hd.appendChild(paint(el("div", "team-logo", tk), t.c1));
  var nm = el("div", "team-name");
  nm.appendChild(el("b", null, t.name));
  nm.appendChild(el("span", null, t.conf + " " + t.div));
  hd.appendChild(nm);
  var meta = el("div", "team-meta");
  meta.appendChild(el("span", "pill", "Bye " + num(t.bye)));
  if (t.imp != null) {
    var ip = el("span", "pill", one(t.imp) + " ITT");
    ip.title = "Vegas-implied team total, averaged over the priced weeks (" +
               D.meta.impliedWeeks + "). Rank " + t.imprk + " of 32.";
    meta.appendChild(ip);
  }
  hd.appendChild(meta);
  card.appendChild(hd);

  var visible = state.pos === "ALL" ? POS : [state.pos];
  var LIMIT = { QB: 3, RB: 4, WR: 5, TE: 3 };
  visible.forEach(function (pos) {
    var room = roster.filter(function (p) { return p.pos === pos; })
                     .sort(function (a, b) { return (a.depth || 99) - (b.depth || 99); });
    if (!room.length) return;
    var block = el("div", "posblock");
    var bh = el("div", "posblock-hd");
    bh.appendChild(paint(el("span", "tag", pos), posColor(pos)));
    var sos = t.sos[pos];
    if (sos && sos.fpa_rk) {
      var s = el("span", "sostxt", "SOS " + sos.fpa_rk + "/32");
      s.title = "2026 schedule strength for " + pos + "s: opponents allowed " +
                sos.fpa + " PPR pts/gm to the position in 2025. Rank 1 = softest.";
      bh.appendChild(s);
    }
    block.appendChild(bh);
    room.slice(0, state.q ? room.length : LIMIT[pos]).forEach(function (p) {
      block.appendChild(playerChip(p, maxPPG[pos]));
    });
    card.appendChild(block);
  });
  return card;
}

function playerChip(p, maxppg) {
  var a = adpOf(p);
  var btn = el("button", "chip" + (state.drafted.has(p.id) ? " drafted" : ""));
  btn.type = "button";

  var role = el("div", "rolebox " + (p.starter ? "starter" : "bench"), p.role || p.pos);
  if (p.starter) paint(role, posColor(p.pos));
  btn.appendChild(role);

  var mid = el("div", "chipmid");
  mid.appendChild(el("div", "pname", p.name));
  var sub = el("div", "psub");
  var bits = [];
  if (p.slotlab) bits.push(p.slotlab);
  if (p.age) bits.push(p.age + "yo");
  var tr = tierOf(p);
  if (tr) bits.push("T" + tr);
  sub.appendChild(el("span", null, bits.join(" · ")));
  if (p.rookie) sub.appendChild(el("span", "flag rk", "R"));
  if (p.inj) {
    var sev = /out|ir|pup|susp|nfi|doubt/i.test(p.inj) ? "inj" : "q";
    sub.appendChild(el("span", "flag " + sev, p.inj.slice(0, 3).toUpperCase()));
  }
  if (p.cuffs) sub.appendChild(el("span", "flag cuff", "CUFF"));
  mid.appendChild(sub);
  btn.appendChild(mid);

  var right = el("div", "chip-r");
  var ppg = p.s25 ? p.s25.ppg[scoringOf(state.fmt)] : null;
  var adpn = el("div", "adpnum" + (a ? "" : " none"), a ? one(a.adp) : "—");
  right.appendChild(adpn);
  btn.appendChild(right);

  // Production as a wash across the row; the only number on the chip is ADP.
  if (ppg && ppg > 0) {
    var fill = el("i", "rowfill");
    fill.style.width = Math.max(3, Math.min(100, (ppg / maxppg) * 100)) + "%";
    fill.style.background = posColor(p.pos);
    btn.insertBefore(fill, btn.firstChild);
  }

  btn.addEventListener("click", function () { openDrawer(p); });
  btn.addEventListener("pointerenter", function (e) {
    showTip(tipBox(p.name, [
      ["role", (p.role || p.pos) + (p.slotlab ? " · " + p.slotlab : ""), posColor(p.pos)],
      ["ADP (" + state.fmt + ")", a ? one(a.adp) + "  (" + p.pos + String(a.prk) + ")" : "undrafted"],
      ["2025 " + scoringOf(state.fmt).toUpperCase() + " per game", ppg != null ? one(ppg) : null],
      ["2025 games", p.s25 ? p.s25.g : null],
      ["snap share", p.s25 && p.s25.snap != null ? one(p.s25.snap) + "%" : null],
      ["VORP", vorpOf(p)],
    ]), e.clientX, e.clientY);
  });
  btn.addEventListener("pointerleave", hideTip);
  return btn;
}

/* --------------------------------------------------------------- big board */
var COLS = [
  { k: "ork",   t: "#",       l: false, w: 44 },
  { k: "name",  t: "Player",  l: true },
  { k: "pos",   t: "Pos",     l: true },
  { k: "team",  t: "Tm",      l: true },
  { k: "bye",   t: "Bye" },
  { k: "adp",   t: "ADP" },
  { k: "range", t: "Draft range", sortk: "sd" },
  { k: "tier",  t: "Tier" },
  { k: "vorp",  t: "VORP" },
  { k: "ppg",   t: "25 PPG" },
  { k: "snap",  t: "Snap%" },
  { k: "tgt",   t: "Tgt%" },
  { k: "boom",  t: "Boom" },
  { k: "bust",  t: "Bust" },
];

function sortVal(p, k) {
  var a = adpOf(p), s = p.s25;
  switch (k) {
    case "ork":  return a ? a.ork : 1e6;
    case "adp":  return a ? a.adp : 1e6;
    case "sd":   return a ? -a.sd : 1e6;
    case "name": return p.name.toLowerCase();
    case "pos":  return POS.indexOf(p.pos);
    case "team": return p.team || "zzz";
    case "bye":  return p.bye || 99;
    case "tier": return tierOf(p) || 99;
    case "vorp": return -(vorpOf(p) == null ? -1e5 : vorpOf(p));
    case "ppg":  return -(s ? s.ppg[scoringOf(state.fmt)] : -1);
    case "snap": return -(s && s.snap != null ? s.snap : -1);
    case "tgt":  return -(s && s.tgtshare != null ? s.tgtshare : -1);
    case "boom": return -(s ? s.boom : -1);
    case "bust": return -(s ? s.bust : -1);
  }
  return 0;
}

function renderBoard(root) {
  root.appendChild(vhead("Big board",
    "The full pool, sorted however you like — and the table view for every chart on this site. " +
    "Draft range is where this player actually went across " +
    (D.meta.adp[state.fmt].total_drafts || 0).toLocaleString() +
    " mock drafts: the bar spans his earliest to latest pick, the dot is the average. " +
    "A wide bar means the room disagrees, which is where value hides."));

  var ps = pool().filter(adpOf).sort(function (x, y) {
    var a = sortVal(x, state.sort.key), b = sortVal(y, state.sort.key);
    if (a < b) return -state.sort.dir;
    if (a > b) return state.sort.dir;
    return 0;
  });

  root.appendChild(boardTiles(ps));

  var maxAdp = Math.max.apply(null, ps.map(function (p) { return adpOf(p).lo || 200; }).concat([100]));
  var maxV = Math.max.apply(null, ps.map(function (p) { return vorpOf(p) || 0; }).concat([1]));

  var wrap = el("div", "card tablewrap");
  var tb = el("table", "board");
  var thead = el("thead"), tr = el("tr");
  COLS.forEach(function (c) {
    var th = el("th", c.l ? "l" : null, c.t);
    var key = c.sortk || c.k;
    if (state.sort.key === key) th.setAttribute("aria-sort", state.sort.dir === 1 ? "ascending" : "descending");
    th.addEventListener("click", function () {
      if (state.sort.key === key) state.sort.dir *= -1;
      else { state.sort.key = key; state.sort.dir = 1; }
      render();
    });
    tr.appendChild(th);
  });
  thead.appendChild(tr); tb.appendChild(thead);

  var tbody = el("tbody");
  ps.forEach(function (p) {
    var a = adpOf(p), s = p.s25, v = vorpOf(p);
    var row = el("tr", state.drafted.has(p.id) ? "drafted" : null);

    row.appendChild(el("td", null, a.ork));

    var tdN = el("td", "l");
    var nb = el("span", "bname", p.name);
    tdN.appendChild(nb);
    if (p.rookie) { var rf = el("span", "flag rk", " R"); rf.style.marginLeft = "6px"; tdN.appendChild(rf); }
    if (p.inj) {
      var sev = /out|ir|pup|susp|nfi|doubt/i.test(p.inj) ? "inj" : "q";
      var fl = el("span", "flag " + sev, p.inj.slice(0, 3).toUpperCase());
      fl.style.marginLeft = "6px"; tdN.appendChild(fl);
    }
    tdN.style.cursor = "pointer";
    tdN.addEventListener("click", function () { openDrawer(p); });
    row.appendChild(tdN);

    var tdP = el("td", "l");
    tdP.appendChild(paint(el("span", "posbadge", p.pos + (a.prk || "")), posColor(p.pos)));
    row.appendChild(tdP);

    row.appendChild(el("td", "l", p.team || "FA")).classList.add("teamtag");
    row.appendChild(el("td", null, num(p.bye)));
    row.appendChild(el("td", null, one(a.adp)));

    // Draft-range whisker: low→high span with the mean marked.
    var tdR = el("td");
    var w = el("div", "whisker");
    var track = el("div", "track"); track.style.left = "0"; track.style.right = "0";
    w.appendChild(track);
    var lo = Math.min(a.hi || a.adp, a.adp), hi = Math.max(a.lo || a.adp, a.adp);
    var band = el("div", "band");
    band.style.left = (lo / maxAdp * 100) + "%";
    band.style.width = Math.max(1.5, (hi - lo) / maxAdp * 100) + "%";
    band.style.background = posColor(p.pos);
    w.appendChild(band);
    var mean = el("div", "mean");
    mean.style.left = "calc(" + (a.adp / maxAdp * 100) + "% - 4px)";
    mean.style.background = posColor(p.pos);
    w.appendChild(mean);
    w.title = "picks " + lo + "–" + hi + ", average " + one(a.adp) + " (sd " + a.sd + ")";
    tdR.appendChild(w);
    row.appendChild(tdR);

    row.appendChild(el("td", null, tierOf(p) ? "T" + tierOf(p) : "—"));

    var tdV = el("td");
    var vc = el("div", "bar-cell");
    vc.appendChild(el("span", v > 0 ? "vorp-pos" : "vorp-neg", v == null ? "—" : (v > 0 ? "+" : "") + v));
    var mb = el("div", "minibar"), mf = el("i");
    mf.style.width = Math.max(0, Math.min(100, (v || 0) / maxV * 100)) + "%";
    mf.style.background = posColor(p.pos);
    mb.appendChild(mf); vc.appendChild(mb);
    tdV.appendChild(vc);
    row.appendChild(tdV);

    row.appendChild(el("td", null, s ? one(s.ppg[scoringOf(state.fmt)]) : "—"));
    row.appendChild(el("td", null, s && s.snap != null ? one(s.snap) : "—"));
    row.appendChild(el("td", null, s && s.tgtshare != null ? one(s.tgtshare) : "—"));
    row.appendChild(el("td", null, s ? s.boom : "—"));
    row.appendChild(el("td", null, s ? s.bust : "—"));
    tbody.appendChild(row);
  });
  tb.appendChild(tbody);
  wrap.appendChild(tb);
  root.appendChild(wrap);
}

function boardTiles(ps) {
  var tiles = el("div", "tiles");
  function tile(lab, val, sub) {
    var c = el("div", "card tile");
    c.appendChild(el("div", "lab", lab));
    c.appendChild(el("div", "val", val));
    if (sub) c.appendChild(el("div", "sub", sub));
    return c;
  }
  var m = D.meta.adp[state.fmt] || {};
  tiles.appendChild(tile("Players shown", ps.length.toLocaleString(),
    state.pos === "ALL" ? "all positions" : state.pos + " only"));
  tiles.appendChild(tile("Mock drafts", (m.total_drafts || 0).toLocaleString(),
    (m.start_date || "") + " → " + (m.end_date || "")));
  var rep = tile("Replacement level",
    POS.map(function (p) { return p + replacementRank(p); }).join(" · "),
    state.size + "-team " + (state.fmt === "superflex" ? "superflex" : state.fmt));
  $(".val", rep).style.fontSize = "16px";
  tiles.appendChild(rep);

  // The single most disputed player in the pool — the widest draft range.
  var wild = ps.filter(function (p) { return adpOf(p) && adpOf(p).n > 40; })
    .sort(function (a, b) { return adpOf(b).sd - adpOf(a).sd; })[0];
  if (wild) {
    var wa = adpOf(wild);
    var wt = tile("Least agreed-on", wild.name,
      "picks " + wa.hi + "–" + wa.lo + " · sd " + wa.sd);
    $(".val", wt).style.fontSize = "17px";
    tiles.appendChild(wt);
  }
  return tiles;
}

/* --------------------------------------------------------------- value map */
function renderValue(root) {
  root.appendChild(vhead("Value map",
    "Two ways to see what a pick is worth. The curves show how fast each position " +
    "decays — where they cross is where positional scarcity should change your pick. " +
    "The scatter puts last season's production against this season's price."));
  root.appendChild(vorpCurveChart());
  root.appendChild(costProductionChart());
}

function chartCard(title, blurb, legendItems) {
  var c = el("article", "card chartcard");
  var hd = el("div", "chart-hd");
  var tx = el("div");
  tx.appendChild(el("h3", null, title));
  tx.appendChild(el("p", null, blurb));
  hd.appendChild(tx);
  if (legendItems) {
    var lg = el("div", "legend");
    legendItems.forEach(function (it) {
      var s = el("span");
      var i = el("i", it.line ? "ln" : null);
      i.style.background = it.color;
      s.appendChild(i); s.appendChild(document.createTextNode(it.label));
      lg.appendChild(s);
    });
    hd.appendChild(lg);
  }
  c.appendChild(hd);
  return c;
}

function vorpCurveChart() {
  var card = chartCard(
    "Positional value curves",
    "Value over replacement against draft cost, one line per position, at " + state.size +
    "-team " + (state.fmt === "superflex" ? "superflex" : state.fmt) + ". " +
    "A steep stretch is a cliff — the players after it are worth materially less. " +
    "Where a line drops under another, the other position is the better pick.",
    POS.map(function (p) { return { label: p, color: posColor(p), line: true }; }));

  var W = 1000, H = 380, M = { t: 14, r: 18, b: 40, l: 52 };
  var series = {};
  var maxX = 0, maxY = 0;
  POS.forEach(function (pos) {
    var pts = D.players.filter(function (p) {
      return p.pos === pos && adpOf(p) && adpOf(p).prk;
    }).map(function (p) {
      return { x: adpOf(p).adp, y: vorpOf(p), p: p };
    }).filter(function (d) { return d.y != null; })
      .sort(function (a, b) { return a.x - b.x; });
    series[pos] = pts;
    pts.forEach(function (d) { maxX = Math.max(maxX, d.x); maxY = Math.max(maxY, d.y); });
  });
  maxX = Math.min(maxX, 200);
  var minY = 0;
  POS.forEach(function (pos) {
    series[pos].forEach(function (d) { minY = Math.min(minY, d.y); });
  });

  var sx = function (v) { return M.l + (v / maxX) * (W - M.l - M.r); };
  var sy = function (v) { return H - M.b - ((v - minY) / (maxY - minY)) * (H - M.t - M.b); };

  var svg = svgEl("svg", { class: "plot", viewBox: "0 0 " + W + " " + H,
                           role: "img", "aria-label": "Value over replacement by draft pick, per position" });

  // gridlines: solid hairlines, recessive
  var yTicks = niceTicks(minY, maxY, 5);
  yTicks.forEach(function (v) {
    svg.appendChild(svgEl("line", { class: "grid", x1: M.l, x2: W - M.r, y1: sy(v), y2: sy(v) }));
    var t = svgEl("text", { x: M.l - 9, y: sy(v) + 3.5, "text-anchor": "end" });
    t.textContent = v; svg.appendChild(t);
  });
  for (var x = 0; x <= maxX; x += 24) {
    var t2 = svgEl("text", { x: sx(x), y: H - M.b + 17, "text-anchor": "middle" });
    t2.textContent = x === 0 ? "1" : x; svg.appendChild(t2);
  }
  svg.appendChild(svgEl("line", { class: "axis", x1: M.l, x2: W - M.r, y1: sy(0), y2: sy(0) }));

  var xl = svgEl("text", { class: "axlab", x: (M.l + W - M.r) / 2, y: H - 6, "text-anchor": "middle" });
  xl.textContent = "Average draft pick"; svg.appendChild(xl);
  var yl = svgEl("text", { class: "axlab", x: -(H - M.b + M.t) / 2, y: 13,
                           transform: "rotate(-90)", "text-anchor": "middle" });
  yl.textContent = "Points over replacement"; svg.appendChild(yl);

  POS.forEach(function (pos) {
    var pts = series[pos].filter(function (d) { return d.x <= maxX; });
    if (pts.length < 2) return;
    var d = pts.map(function (pt, i) {
      return (i ? "L" : "M") + sx(pt.x).toFixed(1) + " " + sy(pt.y).toFixed(1);
    }).join(" ");
    svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: posColor(pos),
                                    "stroke-width": 2, "stroke-linejoin": "round",
                                    "stroke-linecap": "round" }));
    // Direct-label the line at its start — selective, never a label per point.
    var first = pts[0];
    var lab = svgEl("text", { class: "dotlab", x: sx(first.x) + 7, y: sy(first.y) - 6 });
    lab.textContent = pos; svg.appendChild(lab);
  });

  // Crosshair: the reader aims at a pick number, not at a 2px line.
  var hair = svgEl("line", { class: "axis", y1: M.t, y2: H - M.b, opacity: 0 });
  svg.appendChild(hair);
  var hit = svgEl("rect", { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b,
                            fill: "transparent" });
  hit.style.cursor = "crosshair";
  hit.addEventListener("pointermove", function (e) {
    var r = svg.getBoundingClientRect();
    var px = (e.clientX - r.left) / r.width * W;
    var pick = Math.max(1, Math.min(maxX, Math.round((px - M.l) / (W - M.l - M.r) * maxX)));
    hair.setAttribute("x1", sx(pick)); hair.setAttribute("x2", sx(pick));
    hair.setAttribute("opacity", 1);
    var rows = POS.map(function (pos) {
      var best = null;
      series[pos].forEach(function (d) {
        if (d.x >= pick && (!best || d.x < best.x)) best = d;
      });
      return best ? [pos + " " + best.p.name, (best.y > 0 ? "+" : "") + best.y, posColor(pos)] : null;
    }).filter(Boolean);
    showTip(tipBox("Best available at pick " + pick, rows), e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", function () { hair.setAttribute("opacity", 0); hideTip(); });
  svg.appendChild(hit);

  card.appendChild(svg);
  return card;
}

function costProductionChart() {
  var sc = scoringOf(state.fmt);
  var card = chartCard(
    "Cost against production",
    "2025 " + sc.toUpperCase() + " points per game against 2026 ADP, for players with at least six " +
    "games. Each position gets its own trend line, so a dot is cheap or expensive relative to " +
    "what its position normally costs — quarterbacks outscore everyone, and comparing them to " +
    "the field would just say so. Sitting above your position's line is the interesting place. " +
    "Rookies and role-changers have no dot at all, and that absence is the whole risk.",
    POS.map(function (p) { return { label: p, color: posColor(p) }; }));

  var W = 1000, H = 400, M = { t: 14, r: 20, b: 42, l: 52 };
  var pts = pool().filter(function (p) {
    var a = adpOf(p);
    return a && a.adp <= 190 && p.s25 && p.s25.g >= 6;
  }).map(function (p) { return { x: adpOf(p).adp, y: p.s25.ppg[sc], p: p }; });

  var maxX = 190;
  var maxY = Math.max.apply(null, pts.map(function (d) { return d.y; }).concat([10])) * 1.06;
  var sx = function (v) { return M.l + (v / maxX) * (W - M.l - M.r); };
  var sy = function (v) { return H - M.b - (v / maxY) * (H - M.t - M.b); };

  var svg = svgEl("svg", { class: "plot", viewBox: "0 0 " + W + " " + H,
                           role: "img", "aria-label": "2025 points per game against 2026 ADP" });
  niceTicks(0, maxY, 5).forEach(function (v) {
    svg.appendChild(svgEl("line", { class: "grid", x1: M.l, x2: W - M.r, y1: sy(v), y2: sy(v) }));
    var t = svgEl("text", { x: M.l - 9, y: sy(v) + 3.5, "text-anchor": "end" });
    t.textContent = v; svg.appendChild(t);
  });
  for (var x = 0; x <= maxX; x += 24) {
    var t2 = svgEl("text", { x: sx(x), y: H - M.b + 17, "text-anchor": "middle" });
    t2.textContent = x === 0 ? "1" : x; svg.appendChild(t2);
  }
  svg.appendChild(svgEl("line", { class: "axis", x1: M.l, x2: W - M.r, y1: sy(0), y2: sy(0) }));
  var xl = svgEl("text", { class: "axlab", x: (M.l + W - M.r) / 2, y: H - 8, "text-anchor": "middle" });
  xl.textContent = "Average draft pick"; svg.appendChild(xl);
  var yl = svgEl("text", { class: "axlab", x: -(H - M.b + M.t) / 2, y: 13,
                           transform: "rotate(-90)", "text-anchor": "middle" });
  yl.textContent = "2025 " + sc.toUpperCase() + " per game"; svg.appendChild(yl);

  // One trend per position. A single fit across all four would just rediscover
  // that quarterbacks outscore everyone, and every QB would read as a bargain.
  var fits = {};
  POS.forEach(function (pos) {
    var own = pts.filter(function (d) { return d.p.pos === pos; });
    var fit = leastSquares(own.map(function (d) { return [Math.log(d.x + 1), d.y]; }));
    if (!fit) return;
    fits[pos] = fit;
    var xs = own.map(function (d) { return d.x; });
    var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
    var dd = [];
    for (var xx = lo; xx <= hi; xx += 3) {
      dd.push((dd.length ? "L" : "M") + sx(xx).toFixed(1) + " " +
              sy(Math.max(0, fit.m * Math.log(xx + 1) + fit.b)).toFixed(1));
    }
    if (dd.length > 1) {
      svg.appendChild(svgEl("path", { d: dd.join(" "), fill: "none",
                                      stroke: posColor(pos), "stroke-width": 2,
                                      "stroke-linecap": "round", opacity: .32 }));
    }
  });

  pts.forEach(function (d) {
    var g = svgEl("g", { class: "pt" });
    g.appendChild(svgEl("circle", { cx: sx(d.x), cy: sy(d.y), r: 5,
                                    fill: posColor(d.p.pos),
                                    stroke: "var(--surface-1)", "stroke-width": 2 }));
    // 24px transparent hit area — an 8px dot is a pinpoint nobody lands on.
    var hit = svgEl("circle", { class: "hit", cx: sx(d.x), cy: sy(d.y), r: 13 });
    g.appendChild(hit);
    g.addEventListener("pointerenter", function (e) {
      showTip(tipBox(d.p.name, [
        [d.p.pos + " · " + (d.p.team || "FA"), "", posColor(d.p.pos)],
        ["ADP", one(d.x)],
        ["2025 " + sc.toUpperCase() + "/gm", one(d.y)],
        ["games", d.p.s25.g],
        ["boom / bust weeks", d.p.s25.boom + " / " + d.p.s25.bust],
      ]), e.clientX, e.clientY);
    });
    g.addEventListener("pointerleave", hideTip);
    g.addEventListener("click", function () { openDrawer(d.p); });
    svg.appendChild(g);
  });

  // Label selectively: the two biggest overperformers against each position's own
  // curve. Colliding labels are dropped rather than nudged off their dots.
  var placed = [];
  POS.forEach(function (pos) {
    var fit = fits[pos];
    if (!fit) return;
    pts.filter(function (d) { return d.p.pos === pos; })
      .map(function (d) {
        return { d: d, r: d.y - (fit.m * Math.log(d.x + 1) + fit.b) };
      })
      .sort(function (a, b) { return b.r - a.r; })
      .slice(0, 2)
      .forEach(function (o) {
        var lx = sx(o.d.x) + 9, ly = sy(o.d.y) + 3.5;
        var clash = placed.some(function (q) {
          return Math.abs(q[0] - lx) < 62 && Math.abs(q[1] - ly) < 13;
        });
        if (clash) return;
        placed.push([lx, ly]);
        var t = svgEl("text", { class: "dotlab", x: lx, y: ly });
        t.textContent = o.d.p.name.split(" ").slice(-1)[0];
        svg.appendChild(t);
      });
  });
  card.appendChild(svg);
  return card;
}

function leastSquares(pairs) {
  var n = pairs.length;
  if (n < 3) return null;
  var sx = 0, sy = 0, sxy = 0, sxx = 0;
  pairs.forEach(function (p) { sx += p[0]; sy += p[1]; sxy += p[0] * p[1]; sxx += p[0] * p[0]; });
  var den = n * sxx - sx * sx;
  if (!den) return null;
  var m = (n * sxy - sx * sy) / den;
  return { m: m, b: (sy - m * sx) / n };
}

function niceTicks(lo, hi, want) {
  var span = hi - lo || 1;
  var raw = span / want;
  var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; })
    .filter(function (s) { return s >= raw; })[0] || mag * 10;
  var out = [], v = Math.ceil(lo / step) * step;
  for (; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/* -------------------------------------------------------------- bye planner */
function renderByes(root) {
  root.appendChild(vhead("Bye planner",
    "Where the draftable talent disappears. The grid counts top-" + (state.size * 15) +
    " players by position and bye week, so you can see which weeks are thin before you " +
    "stack three starters on the same one. Your own roster sits underneath."));

  var top = pool().filter(function (p) { return adpOf(p) && adpOf(p).ork <= state.size * 15; });
  var weeks = [];
  Object.keys(D.teams).forEach(function (t) {
    var b = D.teams[t].bye;
    if (b && weeks.indexOf(b) < 0) weeks.push(b);
  });
  weeks.sort(function (a, b) { return a - b; });

  var counts = {}, maxC = 1;
  POS.forEach(function (pos) {
    counts[pos] = {};
    weeks.forEach(function (w) { counts[pos][w] = 0; });
  });
  top.forEach(function (p) {
    if (p.bye && counts[p.pos] && counts[p.pos][p.bye] != null) {
      counts[p.pos][p.bye]++;
      maxC = Math.max(maxC, counts[p.pos][p.bye]);
    }
  });

  var card = chartCard("Draftable players on bye, by week",
    "One hue, light to dark: darker is more of your position pool sitting out that week. " +
    "Counts are in every cell, so the colour is never the only way to read it.", null);
  var scale = el("div", "scalebar");
  scale.appendChild(el("span", null, "fewer"));
  var ramp = el("div", "ramp");
  [1, 2, 3, 4, 5, 6, 7].forEach(function (i) {
    var b = el("i"); b.style.background = "var(--seq-" + i + ")"; ramp.appendChild(b);
  });
  scale.appendChild(ramp);
  scale.appendChild(el("span", null, "more"));
  $(".chart-hd", card).appendChild(scale);

  var wrap = el("div"); wrap.style.overflowX = "auto";
  var tb = el("table", "heatgrid");
  var hr = el("tr");
  hr.appendChild(el("th", "rowh", ""));
  weeks.forEach(function (w) { hr.appendChild(el("th", null, "Wk " + w)); });
  tb.appendChild(hr);
  POS.forEach(function (pos) {
    var tr = el("tr");
    var th = el("th", "rowh");
    th.appendChild(paint(el("span", "posbadge", pos), posColor(pos)));
    tr.appendChild(th);
    weeks.forEach(function (w) {
      var c = counts[pos][w] || 0;
      var td = el("td", null, String(c));
      var step = c === 0 ? 0 : Math.min(7, Math.max(1, Math.ceil(c / maxC * 7)));
      if (step) { paint(td, cssVar("--seq-" + step)); }
      else { td.style.background = cssVar("--surface-2"); td.style.color = cssVar("--text-3"); }
      var teams = Object.keys(D.teams).filter(function (t) { return D.teams[t].bye === w; });
      td.addEventListener("pointerenter", function (e) {
        showTip(tipBox("Week " + w + " · " + pos, [
          ["draftable " + pos + "s on bye", c, posColor(pos)],
          ["teams idle", teams.join(", ")],
        ]), e.clientX, e.clientY);
      });
      td.addEventListener("pointerleave", hideTip);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  wrap.appendChild(tb);
  card.appendChild(wrap);
  root.appendChild(card);

  // Teams idle each week — the plain-text twin of the grid above.
  var listCard = chartCard("Who is off each week", "Every team's 2026 bye.", null);
  var lw = el("div"); lw.style.display = "grid";
  lw.style.gridTemplateColumns = "repeat(auto-fit,minmax(190px,1fr))";
  lw.style.gap = "10px";
  weeks.forEach(function (w) {
    var b = el("div");
    b.appendChild(el("div", "flab", "Week " + w));
    var names = Object.keys(D.teams).filter(function (t) { return D.teams[t].bye === w; });
    var row = el("div"); row.style.display = "flex"; row.style.flexWrap = "wrap"; row.style.gap = "4px";
    row.style.marginTop = "6px";
    names.forEach(function (t) {
      row.appendChild(paint(el("span", "pill", t), D.teams[t].c1));
    });
    b.appendChild(row);
    lw.appendChild(b);
  });
  listCard.appendChild(lw);
  root.appendChild(listCard);

  var mine = drafteds();
  if (mine.length) root.appendChild(rosterByeCard(mine, weeks));
}

function rosterByeCard(mine, weeks) {
  var card = chartCard("Your roster's exposure",
    "Starters you have already taken, by the week they are idle.", null);
  var wrap = el("div"); wrap.style.overflowX = "auto";
  var tb = el("table", "heatgrid");
  var hr = el("tr");
  hr.appendChild(el("th", "rowh", ""));
  weeks.forEach(function (w) { hr.appendChild(el("th", null, "Wk " + w)); });
  tb.appendChild(hr);
  var tr = el("tr");
  tr.appendChild(el("th", "rowh", "Drafted"));
  weeks.forEach(function (w) {
    var who = mine.filter(function (p) { return p.bye === w; });
    var td = el("td", null, who.length || "");
    var step = who.length ? Math.min(7, who.length + 2) : 0;
    if (step) { paint(td, cssVar("--seq-" + step)); }
    else { td.style.background = cssVar("--surface-2"); td.style.color = cssVar("--text-3"); }
    if (who.length) {
      td.addEventListener("pointerenter", function (e) {
        showTip(tipBox("Week " + w + " byes", who.map(function (p) {
          return [p.pos + " · " + p.team, p.name, posColor(p.pos)];
        })), e.clientX, e.clientY);
      });
      td.addEventListener("pointerleave", hideTip);
    }
    tr.appendChild(td);
  });
  tb.appendChild(tr);
  wrap.appendChild(tb);
  card.appendChild(wrap);
  return card;
}

/* ------------------------------------------------------------------- sched */
function renderSos(root) {
  root.appendChild(vhead("Schedule",
    "How friendly each 2026 slate looks. Positional strength is what those opponents gave " +
    "up to the position in 2025 — a blunt instrument, but the extremes are real. The " +
    "implied-total column is the betting market's view of each offence, and it is the " +
    "sharper signal of the two."));

  var teams = Object.keys(D.teams).sort(function (a, b) {
    var x = D.teams[a].imp == null ? -1 : D.teams[a].imp;
    var y = D.teams[b].imp == null ? -1 : D.teams[b].imp;
    return y - x;
  });

  var card = chartCard("Offence environment and positional schedule",
    "Implied team total is the Vegas line for the weeks the market has priced (" +
    D.meta.impliedWeeks + "). The four position columns diverge around the league " +
    "average: blue is a softer-than-average slate, red is harder, grey is neutral.",
    [{ label: "softer slate", color: "var(--div-pos)" },
     { label: "average", color: "var(--surface-3)" },
     { label: "harder slate", color: "var(--div-neg)" }]);

  var maxImp = Math.max.apply(null, teams.map(function (t) { return D.teams[t].imp || 0; }));
  var wrap = el("div", "tablewrap");
  var tb = el("table", "board");
  var head = el("tr");
  ["Team", "Bye", "Implied total", ""].forEach(function (h, i) {
    head.appendChild(el("th", i < 1 ? "l" : null, h));
  });
  POS.forEach(function (p) { head.appendChild(el("th", null, p + " SOS")); });
  // The playoff column reflects whichever position is in scope, and says which.
  var poPos = state.pos === "ALL" ? "RB" : state.pos;
  head.appendChild(el("th", null, "Wk 15-17 " + poPos));
  var thead = el("thead"); thead.appendChild(head); tb.appendChild(thead);

  var tbody = el("tbody");
  teams.forEach(function (tk) {
    var t = D.teams[tk];
    var tr = el("tr");
    var td0 = el("td", "l");
    var tag = paint(el("span", "posbadge", tk), t.c1);
    tag.style.marginRight = "8px";
    td0.appendChild(tag);
    td0.appendChild(el("span", "bname", t.name));
    tr.appendChild(td0);
    tr.appendChild(el("td", null, num(t.bye)));
    tr.appendChild(el("td", null, t.imp == null ? "—" : one(t.imp)));

    var tdb = el("td");
    var mb = el("div", "minibar"); mb.style.width = "70px";
    var mf = el("i");
    mf.style.width = t.imp ? (t.imp / maxImp * 100) + "%" : "0";
    mf.style.background = "var(--seq-4)";
    mb.appendChild(mf); tdb.appendChild(mb);
    tr.appendChild(tdb);

    POS.forEach(function (pos) {
      var s = t.sos[pos];
      var td = el("td", null, s.fpa_rk ? String(s.fpa_rk) : "—");
      if (s.fpa_rk) {
        // Diverging around rank 16.5: two opposite hues, neutral grey midpoint.
        var dev = (16.5 - s.fpa_rk) / 15.5;                 // +1 softest, -1 hardest
        paint(td, divColor(dev));
        td.style.borderRadius = "5px";
        td.title = pos + " schedule rank " + s.fpa_rk + " of 32 — opponents allowed " +
                   s.fpa + " PPR/gm to " + pos + "s in 2025.";
      }
      tr.appendChild(td);
    });
    var po = t.sos[poPos].po_rk;
    var tdpo = el("td", null, po ? String(po) : "—");
    if (po) {
      paint(tdpo, divColor((16.5 - po) / 15.5));
      tdpo.style.borderRadius = "5px";
      tdpo.title = "Fantasy playoff weeks 15-17 " + poPos + " schedule rank " + po +
                   " of 32 — opponents allowed " + t.sos[poPos].po + " PPR/gm to " +
                   poPos + "s in 2025.";
    }
    tr.appendChild(tdpo);
    tbody.appendChild(tr);
  });
  tb.appendChild(tbody);
  wrap.appendChild(tb);
  card.appendChild(wrap);
  root.appendChild(card);
}

/* Diverging around the league average: two opposite hues, neutral grey midpoint. */
function divColor(dev) {
  var a = Math.min(1, Math.abs(dev));
  var base = cssVar("--surface-2");
  if (a < 0.08) return base;
  return mixHex(cssVar(dev > 0 ? "--div-pos" : "--div-neg"), base, 0.18 + a * 0.62);
}

/* -------------------------------------------------------------- draft room */
function renderRoom(root) {
  var mine = drafteds();
  root.appendChild(vhead("Draft room",
    "Mark players as they come off the board — from here, the big board, or any player " +
    "card — and this view keeps track of what is left. Tier counts are the thing to watch: " +
    "when a tier is down to its last one or two, the players after it are a real step down. " +
    "Your board is saved in this browser only."));

  var tiles = el("div", "tiles");
  function tile(l, v, s) {
    var c = el("div", "card tile");
    c.appendChild(el("div", "lab", l)); c.appendChild(el("div", "val", v));
    if (s) c.appendChild(el("div", "sub", s));
    return c;
  }
  tiles.appendChild(tile("Off the board", String(mine.length), "tracked in this browser"));
  var nextPick = mine.length + 1;
  tiles.appendChild(tile("Next pick", "#" + nextPick, "if you are tracking every team"));
  var avail = D.players.filter(function (p) { return adpOf(p) && !state.drafted.has(p.id); });
  var bestNow = avail.sort(function (a, b) { return (vorpOf(b) || -1e5) - (vorpOf(a) || -1e5); })[0];
  if (bestNow) tiles.appendChild(tile("Best available", bestNow.name,
    bestNow.pos + " · " + bestNow.team + " · VORP " + (vorpOf(bestNow) > 0 ? "+" : "") + vorpOf(bestNow)));
  var reach = avail.filter(function (p) { return adpOf(p).adp >= nextPick + 12; })
    .sort(function (a, b) { return (vorpOf(b) || -1e5) - (vorpOf(a) || -1e5); })[0];
  if (reach) tiles.appendChild(tile("Can probably wait", reach.name,
    "ADP " + one(adpOf(reach).adp) + " — likely there next round"));
  root.appendChild(tiles);

  var grid = el("div", "roomgrid");
  POS.forEach(function (pos) {
    var left = avail.filter(function (p) { return p.pos === pos; })
      .sort(function (a, b) { return adpOf(a).adp - adpOf(b).adp; });
    var card = el("article", "card runcard");
    var h = el("h4");
    var tag = paint(el("span", "posbadge", pos), posColor(pos));
    tag.style.marginRight = "7px";
    h.appendChild(tag);
    h.appendChild(document.createTextNode("best available"));
    card.appendChild(h);
    if (!left.length) { card.appendChild(el("p", "emptynote", "None left.")); grid.appendChild(card); return; }

    var curTier = tierOf(left[0]);
    var inTier = left.filter(function (p) { return tierOf(p) === curTier; }).length;
    var warn = el("div", "tierwall",
      inTier + " left in tier " + (curTier || "?") + (inTier <= 2 ? " — the wall is next" : ""));
    if (inTier > 2) warn.style.color = "var(--text-3)";
    card.appendChild(warn);

    left.slice(0, 6).forEach(function (p) {
      var row = el("div", "runrow");
      var td = el("span", "tierdot");
      td.style.background = "var(--seq-" + Math.min(7, Math.max(1, 8 - (tierOf(p) || 7))) + ")";
      row.appendChild(td);
      var n = el("span", "n", p.name);
      row.appendChild(n);
      row.appendChild(el("span", "teamtag", p.team || "FA"));
      row.appendChild(el("span", "adpnum", one(adpOf(p).adp)));
      var b = el("button", "btn");
      b.textContent = "Take";
      b.style.padding = "3px 9px"; b.style.fontSize = "11.5px";
      b.addEventListener("click", function () { toggleDraft(p); });
      row.appendChild(b);
      row.addEventListener("click", function (e) { if (e.target !== b) openDrawer(p); });
      card.appendChild(row);
    });
    grid.appendChild(card);
  });
  root.appendChild(grid);

  if (mine.length) {
    var card = chartCard("Your board", "Everyone you have marked. Click to put one back.", null);
    var list = el("div");
    list.style.display = "flex"; list.style.flexWrap = "wrap"; list.style.gap = "6px";
    mine.sort(function (a, b) {
      return (adpOf(a) ? adpOf(a).adp : 999) - (adpOf(b) ? adpOf(b).adp : 999);
    }).forEach(function (p) {
      var b = el("button", "btn");
      b.style.padding = "5px 10px"; b.style.fontSize = "12.5px";
      var d = el("i", "dot"); d.style.background = posColor(p.pos);
      d.style.marginRight = "7px"; d.style.display = "inline-block";
      b.appendChild(d);
      b.appendChild(document.createTextNode(p.name + "  ×"));
      b.addEventListener("click", function () { toggleDraft(p); });
      list.appendChild(b);
    });
    card.appendChild(list);
    var clear = el("button", "btn");
    clear.textContent = "Clear the whole board";
    clear.style.marginTop = "14px";
    clear.addEventListener("click", function () {
      state.drafted = new Set(); saveDrafted(); render();
    });
    card.appendChild(clear);
    root.appendChild(card);
  }
}

function toggleDraft(p) {
  if (state.drafted.has(p.id)) state.drafted.delete(p.id);
  else state.drafted.add(p.id);
  saveDrafted();
  render();
}

/* ------------------------------------------------------------------ drawer */
function openDrawer(p) {
  var body = $("#drawer-body");
  body.innerHTML = "";
  var a = adpOf(p), s = p.s25, t = D.teams[p.team];
  var sc = scoringOf(state.fmt);

  var hd = el("div", "dhead");
  var badge = el("div", "team-logo", p.team || "FA");
  if (t) { paint(badge, t.c1); badge.style.boxShadow = "inset 0 0 0 2px " + t.c2; }
  hd.appendChild(badge);
  var htx = el("div");
  htx.appendChild(el("h3", null, p.name));
  var sub = [];
  if (p.role) sub.push(p.role + (p.slotlab ? " (" + p.slotlab + ")" : ""));
  if (t) sub.push(t.name);
  if (p.age) sub.push(p.age + " yrs");
  sub.push(p.rookie ? "rookie" : (p.exp || 0) + " yr" + (p.exp === 1 ? "" : "s") + " exp");
  htx.appendChild(el("div", "dsub", sub.join(" · ")));
  hd.appendChild(htx);
  body.appendChild(hd);

  var btns = el("div", "btnrow");
  var take = el("button", "btn primary");
  take.textContent = state.drafted.has(p.id) ? "Put back on the board" : "Mark as drafted";
  take.addEventListener("click", function () { toggleDraft(p); openDrawer(p); });
  btns.appendChild(take);
  body.appendChild(btns);

  var st = el("div", "dstats");
  function ds(l, v) {
    var d = el("div", "dstat");
    d.appendChild(el("div", "l", l)); d.appendChild(el("div", "v", v));
    return d;
  }
  st.appendChild(ds("ADP", a ? one(a.adp) : "—"));
  st.appendChild(ds("Pos rank", a && a.prk ? p.pos + a.prk : "—"));
  st.appendChild(ds("Tier", tierOf(p) ? "T" + tierOf(p) : "—"));
  st.appendChild(ds("VORP", vorpOf(p) == null ? "—" : (vorpOf(p) > 0 ? "+" : "") + vorpOf(p)));
  st.appendChild(ds("Bye", num(p.bye)));
  st.appendChild(ds("2025 " + sc.toUpperCase() + "/g", s ? one(s.ppg[sc]) : "—"));
  body.appendChild(st);

  if (p.inj) {
    var w = el("div", "dsec");
    var fl = el("span", "flag inj", (p.inj + (p.injbody ? " — " + p.injbody : "")).toUpperCase());
    w.appendChild(fl);
    body.appendChild(w);
  }

  if (a) {
    var sec = el("div", "dsec");
    sec.appendChild(el("h4", null, "Where the room drafts him"));
    sec.appendChild(kv("Average pick", one(a.adp)));
    sec.appendChild(kv("Earliest / latest", a.hi + " / " + a.lo));
    sec.appendChild(kv("Spread (sd)", a.sd));
    sec.appendChild(kv("Mock drafts", (a.n || 0).toLocaleString()));
    body.appendChild(sec);
  }

  if (s) {
    var g = el("div", "dsec");
    g.appendChild(el("h4", null, "2025 week by week (PPR points)"));
    g.appendChild(gameLogChart(p, s));
    body.appendChild(g);

    var pr = el("div", "dsec");
    pr.appendChild(el("h4", null, "2025 production"));
    pr.appendChild(kv("Games", s.g));
    pr.appendChild(kv("Season points", one(s.pts[sc])));
    if (s.snap != null) pr.appendChild(kv("Snap share", one(s.snap) + "%"));
    if (p.pos === "QB") {
      pr.appendChild(kv("Pass yards / TD / INT", s.payd + " · " + s.patd + " · " + s.int));
      if (s.ypa) pr.appendChild(kv("Yards per attempt", s.ypa));
      if (s.cmppct) pr.appendChild(kv("Completion %", one(s.cmppct) + "%"));
      pr.appendChild(kv("Rush yards / TD", s.rushyd + " · " + s.rushtd));
    } else {
      if (s.car) pr.appendChild(kv("Carries / yards / TD", s.car + " · " + s.rushyd + " · " + s.rushtd));
      if (s.ypc) pr.appendChild(kv("Yards per carry", s.ypc));
      if (s.tgt) pr.appendChild(kv("Targets / catches", s.tgt + " · " + s.rec));
      if (s.recyd) pr.appendChild(kv("Receiving yards / TD", s.recyd + " · " + s.rectd));
      if (s.tgtshare != null) pr.appendChild(kv("Target share", one(s.tgtshare) + "%"));
      if (s.wopr != null) pr.appendChild(kv("WOPR", s.wopr));
      if (s.adot != null) pr.appendChild(kv("Average depth of target", s.adot));
    }
    pr.appendChild(kv("Boom / bust weeks", s.boom + " / " + s.bust));
    if (s.floor != null) pr.appendChild(kv("Floor / ceiling", s.floor + " – " + s.ceil));
    if (s.cv != null) pr.appendChild(kv("Week-to-week variance", s.cv));
    body.appendChild(pr);
  } else {
    var no = el("div", "dsec");
    no.appendChild(el("h4", null, "2025 production"));
    no.appendChild(el("p", "emptynote",
      p.rookie ? "Rookie — no NFL snaps yet. Price him on draft capital and role, not on this page."
               : "No 2025 regular-season box score on file."));
    body.appendChild(no);
  }

  if (t) {
    var sd = el("div", "dsec");
    sd.appendChild(el("h4", null, "2026 schedule · " + p.pos + " strength rank " +
      (t.sos[p.pos].fpa_rk || "—") + " of 32"));
    sd.appendChild(scheduleStrip(t, p.pos));
    body.appendChild(sd);

    if (p.handcuff || p.cuffs) {
      var other = D.players.filter(function (x) { return x.id === (p.handcuff || p.cuffs); })[0];
      if (other) {
        var hc = el("div", "dsec");
        hc.appendChild(el("h4", null, p.handcuff ? "His handcuff" : "He is the handcuff for"));
        var b = el("button", "btn");
        b.textContent = other.name + " · " + other.role +
          (adpOf(other) ? " · ADP " + one(adpOf(other).adp) : " · undrafted");
        b.addEventListener("click", function () { openDrawer(other); });
        hc.appendChild(b);
        body.appendChild(hc);
      }
    }
  }

  $("#scrim").hidden = false;
  $("#drawer").hidden = false;
  $("#drawer").focus();
}

function kv(k, v) {
  var d = el("div", "kv");
  d.appendChild(el("span", null, k));
  d.appendChild(el("span", null, String(v)));
  return d;
}

function gameLogChart(p, s) {
  var sc = scoringOf(state.fmt);
  var W = 420, H = 120, M = { t: 8, r: 4, b: 20, l: 26 };
  var weeks = [];
  for (var w = 1; w <= 18; w++) weeks.push(w);
  var byWeek = {};
  s.log.forEach(function (r) { byWeek[r.w] = r; });
  // The stored log is PPR; the axis and tooltip both say so.
  var maxV = Math.max.apply(null, s.log.map(function (r) { return r.p; }).concat([10]));
  var svg = svgEl("svg", { class: "plot", viewBox: "0 0 " + W + " " + H,
                           role: "img", "aria-label": "Weekly fantasy points, 2025" });
  var bw = (W - M.l - M.r) / weeks.length;
  niceTicks(0, maxV, 3).forEach(function (v) {
    var y = H - M.b - (v / maxV) * (H - M.t - M.b);
    svg.appendChild(svgEl("line", { class: "grid", x1: M.l, x2: W - M.r, y1: y, y2: y }));
    var tx = svgEl("text", { x: M.l - 6, y: y + 3.5, "text-anchor": "end" });
    tx.textContent = v; svg.appendChild(tx);
  });
  weeks.forEach(function (w, i) {
    var r = byWeek[w];
    var x = M.l + i * bw;
    if (!r) {
      var miss = svgEl("rect", { x: x + 1, y: H - M.b - 3, width: Math.max(2, bw - 4),
                                 height: 3, rx: 1.5, fill: "var(--surface-3)" });
      var mt = w === p.bye ? "bye week" : "did not play";
      miss.addEventListener("pointerenter", mkTip("Week " + w, [[mt, "—"]]));
      miss.addEventListener("pointerleave", hideTip);
      svg.appendChild(miss);
      return;
    }
    var h = Math.max(2, (r.p / maxV) * (H - M.t - M.b));
    // 4px rounded data-end, square at the baseline; 2px surface gap between bars.
    var rect = svgEl("rect", { x: x + 1, y: H - M.b - h, width: Math.max(2, bw - 4),
                               height: h, rx: 2, fill: posColor(p.pos) });
    rect.addEventListener("pointerenter", mkTip("Week " + w + (r.o ? " vs " + r.o : ""),
      [["PPR points", one(r.p), posColor(p.pos)]]));
    rect.addEventListener("pointerleave", hideTip);
    svg.appendChild(rect);
    if (w % 4 === 1) {
      var lb = svgEl("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle" });
      lb.textContent = w; svg.appendChild(lb);
    }
  });
  return svg;
}
function mkTip(title, rows) {
  return function (e) { showTip(tipBox(title, rows), e.clientX, e.clientY); };
}

function scheduleStrip(t, pos) {
  var strip = el("div", "schedstrip");
  t.sched.forEach(function (g, i) {
    var wk = i + 1;
    var d = el("div");
    if (!g) {
      paint(d, cssVar("--surface-3"));
      d.appendChild(el("b", null, "BYE"));
      d.appendChild(el("small", null, "w" + wk));
      strip.appendChild(d);
      return;
    }
    var rank = D.defense.rank[pos][g.opp];
    var dev = (16.5 - rank) / 15.5;
    paint(d, divColor(dev));
    d.appendChild(el("b", null, (g.home ? "" : "@") + g.opp));
    d.appendChild(el("small", null, "w" + wk));
    d.title = "Week " + wk + " " + (g.home ? "vs " : "at ") + g.opp +
      " — allowed " + D.defense.allowed[pos][g.opp] + " PPR/gm to " + pos +
      "s in 2025 (rank " + rank + "/32)" + (g.imp != null ? ", implied total " + g.imp : "");
    strip.appendChild(d);
  });
  return strip;
}

function closeDrawer() {
  $("#drawer").hidden = true;
  $("#scrim").hidden = true;
  hideTip();
}

/* ------------------------------------------------------------------ shell */
function vhead(title, blurb) {
  var d = el("div", "vhead");
  d.appendChild(el("h2", null, title));
  d.appendChild(el("p", null, blurb));
  return d;
}

var VIEWS = { depth: renderDepth, board: renderBoard, value: renderValue,
              byes: renderByes, sos: renderSos, room: renderRoom };

function render() {
  hideTip();
  $$(".view").forEach(function (v) { v.hidden = true; v.innerHTML = ""; });
  var root = $("#v-" + state.view);
  root.hidden = false;
  VIEWS[state.view](root);
  $$("#tabs button").forEach(function (b) {
    b.setAttribute("aria-selected", String(b.dataset.view === state.view));
  });
}

function bind() {
  $$("#tabs button").forEach(function (b) {
    b.addEventListener("click", function () { state.view = b.dataset.view; render(); });
  });
  $$("#fmt button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.fmt = b.dataset.fmt;
      $$("#fmt button").forEach(function (x) {
        x.setAttribute("aria-checked", String(x === b));
      });
      render();
    });
  });
  $$("#size button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.size = +b.dataset.size;
      $$("#size button").forEach(function (x) {
        x.setAttribute("aria-checked", String(x === b));
      });
      render();
    });
  });
  $$("#pos button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.pos = b.dataset.pos;
      $$("#pos button").forEach(function (x) {
        x.setAttribute("aria-pressed", String(x === b));
      });
      render();
    });
  });
  var qt;
  $("#q").addEventListener("input", function (e) {
    clearTimeout(qt);
    qt = setTimeout(function () { state.q = e.target.value; render(); }, 130);
  });
  $("#hidedrafted").addEventListener("change", function (e) {
    state.hideDrafted = e.target.checked; render();
  });
  $("#theme").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme");
    if (!cur) {
      cur = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("nfldc.theme", next); } catch (e) {}
    render();                              // marks re-read the theme's hues
  });
  $("#drawerx").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeDrawer();
    if (e.key === "/" && document.activeElement !== $("#q")) {
      e.preventDefault(); $("#q").focus();
    }
  });
  window.addEventListener("scroll", hideTip, { passive: true });
}

function boot() {
  try {
    var th = localStorage.getItem("nfldc.theme");
    if (th) document.documentElement.setAttribute("data-theme", th);
  } catch (e) {}

  var m = D.meta;
  var adpm = m.adp.ppr || {};
  $("#stamp").textContent = "ADP through " + (adpm.end_date || "—") +
    " · rosters " + m.generated.slice(0, 10);
  $("#sources").textContent = "Sources — " + m.sources.join("  ·  ");

  bind();
  render();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
})();
