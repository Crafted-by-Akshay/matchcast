// Heatmaps tab in the match centre (AB#heatmaps). Where each club and each player spent the match, from the tracking frames.
// Frames are taken every 30 match seconds, so every map is time in a zone, not touches. Positions are turned so the club (or player)
// attacks toward the right in both halves, the same rule as the average positions on the Patterns tab.
const HM = { mid: null, p: 1 };   // the player picked on this match (pids index); reset when a different match opens
const HM_NX = 21, HM_NY = 14;

// the attacking-direction position of pids index i in frame fr, or null when the frame has none
const hmAtk = (fr, i) => {
  const q = fr.p[i]; if (!q) return null;
  const flip = i < 11 ? fr.f === 1 : fr.f === 0;
  return flip ? [105 - q[0], 68 - q[1]] : q;
};

// counts per 5 m x 4.9 m cell for the given pids indices
function hmGrid(m, idxs) {
  const H = new Array(HM_NX * HM_NY).fill(0); let n = 0;
  for (const fr of m.frames || []) for (const i of idxs) {
    const q = hmAtk(fr, i); if (!q) continue;
    const bx = Math.min(HM_NX - 1, Math.max(0, Math.floor(q[0] / 5)));
    const by = Math.min(HM_NY - 1, Math.max(0, Math.floor(q[1] / (68 / HM_NY))));
    H[by * HM_NX + bx]++; n++;
  }
  return { H, n };
}

function hmMap(m, idxs, colour, title) {
  const { H, n } = hmGrid(m, idxs);
  if (!n) return '<div class="empty">No tracking points for this selection.</div>';
  const mx = Math.max(...H) || 1, cw = 5, ch = 68 / HM_NY;
  let inner = '';
  H.forEach((c, k) => { if (!c) return; inner += '<rect x="' + (k % HM_NX) * cw + '" y="' + (Math.floor(k / HM_NX) * ch).toFixed(2) + '" width="' + cw + '" height="' + ch.toFixed(2) + '" fill="' + colour + '" fill-opacity="' + (0.06 + 0.8 * Math.pow(c / mx, 0.7)).toFixed(2) + '"/>'; });
  inner += '<text x="52.5" y="66.5" text-anchor="middle" style="font-size:2.4px;fill:var(--muted)">attacking direction →</text>';
  return pitch(inner, { title });
}

// the share of a player's frames in each third (attacking, middle, defensive) and lane (top, centre, bottom of the drawn pitch)
function hmZones(m, i) {
  const c = new Array(9).fill(0); let n = 0;
  for (const fr of m.frames || []) {
    const q = hmAtk(fr, i); if (!q) continue;
    const t = q[0] < 35 ? 0 : q[0] < 70 ? 1 : 2, l = q[1] < 68 / 3 ? 0 : q[1] < 136 / 3 ? 1 : 2;
    c[t * 3 + l]++; n++;
  }
  return { c, n };
}

// average spot, stay (RMS distance from the average spot, metres) and share of frames in the attacking third
function hmStats(m, i) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, n = 0, att = 0;
  for (const fr of m.frames || []) {
    const q = hmAtk(fr, i); if (!q) continue;
    sx += q[0]; sy += q[1]; sxx += q[0] * q[0]; syy += q[1] * q[1]; n++; if (q[0] >= 70) att++;
  }
  if (!n) return null;
  const x = sx / n, y = sy / n;
  return { x, y, stay: Math.sqrt(Math.max(0, sxx / n - x * x) + Math.max(0, syy / n - y * y)), att: att / n };
}

function hmPlayer(m, i) {
  const p = m.pids[i], st = hmStats(m, i), zn = hmZones(m, i);
  if (!st || !zn.n) return '<div class="empty">No tracking points for this player.</div>';
  const pc = (v) => (100 * v / zn.n).toFixed(1);
  const rows = [['Attacking third', 2], ['Middle third', 1], ['Defensive third', 0]];
  const zt = '<table id="hm-zones"><thead><tr><th>Share of frames</th><th>Top</th><th>Centre</th><th>Bottom</th></tr></thead><tbody>' +
    rows.map(([lbl, t]) => '<tr><th>' + lbl + '</th>' + [0, 1, 2].map((l) => '<td data-pct="' + pc(zn.c[t * 3 + l]) + '">' + pc(zn.c[t * 3 + l]) + '%</td>').join('') + '</tr>').join('') + '</tbody></table>';
  return '<h4 id="hm-head">' + esc(p.name) + '</h4><div class="grid"><div class="s7">' + hmMap(m, [i], mcc(m, p.team), p.name + ' heatmap') + '</div><div class="s5">' +
    '<dl class="kv"><dt>Average spot</dt><dd>' + fmt(st.x, 0) + ' m, ' + fmt(st.y, 0) + ' m</dd><dt>Stay</dt><dd>' + fmt(st.stay, 1) + ' m</dd><dt>Attacking third</dt><dd>' + Math.round(100 * st.att) + '% of frames</dd></dl>' +
    '<div style="height:10px"></div>' + zt + '</div></div>';
}

MC_RENDER.heat = (m) => {
  if (!(m.frames || []).length) return '<div class="empty">This match has no tracking data, so there are no heatmaps.</div>';
  if (HM.mid !== m.id) { HM.mid = m.id; HM.p = 1; }
  const team = (k) => hmMap(m, m.pids.map((p, i) => (p.team === k ? i : -1)).filter((i) => i >= 0), mcc(m, k), clubName(k) + ' heatmap');
  const opts = m.pids.map((p, i) => '<option value="' + i + '" data-name="' + esc(p.name) + '"' + (i === HM.p ? ' selected' : '') + '>' + esc(p.num + ' ' + p.name + ' · ' + clubName(p.team)) + '</option>').join('');
  const rows = m.pids.map((p, i) => ({ p, i, st: hmStats(m, i) })).filter((r) => r.st);
  const cols = [
    { k: 'name', l: 'Player', f: (r) => '<span class="dot" style="background:' + col(r.p.team) + '"></span>' + esc(r.p.name) },
    { k: 'team', l: 'Club', f: (r) => clubTag(r.p.team) },
    { k: 'avg', l: 'Average spot (m)', r: 1, f: (r) => fmt(r.st.x, 0) + ', ' + fmt(r.st.y, 0) },
    { k: 'stay', l: 'Stay (m)', r: 1, f: (r) => fmt(r.st.stay, 1) },
    { k: 'att', l: 'Attacking third', r: 1, f: (r) => Math.round(100 * r.st.att) + '%' },
  ];
  return '<div class="grid" id="hm-teams"><div class="s6">' + card(esc(clubName(m.home)) + ' heatmap', 'Time in each zone, both halves, attacking →. Simulated: tracking frames every 30 match seconds from the season run.', team(m.home)) +
    '</div><div class="s6">' + card(esc(clubName(m.away)) + ' heatmap', 'Same orientation as the home club: each side attacks right.', team(m.away)) + '</div></div>' +
    '<div class="s12">' + card('Player heatmap', 'Pick a player. Stay is how far, on average, he strays from his average spot.', '<label class="field">Player<select id="hm-sel">' + opts + '</select></label><div id="hm-player" style="margin-top:10px">' + hmPlayer(m, HM.p) + '</div>') + '</div>' +
    '<div class="s12">' + card('Stay and average spot, every player', 'Average spot in the attacking direction', tbl(cols, rows, { id: 'hm-all' })) + '</div></div>';
};

MC_BIND.heat = (m, b) => {
  const sel = b.querySelector('#hm-sel'); if (!sel) return;
  sel.onchange = () => { HM.p = +sel.value; b.querySelector('#hm-player').innerHTML = hmPlayer(m, HM.p); };
};
