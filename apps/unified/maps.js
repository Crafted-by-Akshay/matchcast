// Live match maps for the shell (the default Analyst live view and the Ask lane). The shell feeds it Watch's roster, pitch
// frames and events (index.html, the 'start', 'frame' and 'events' messages). One position sample is kept per match second.
// window.MC.analysis.render(kind, params, container) draws "heatmap" (params {team: "home" | "away" | "player", player?}),
// "pass_network" ({team}) or "avg_positions" into container, for the live match. Simulated, one match at a time.
const MAPS = (() => {
  const S = { key: null, roster: null, frames: [], events: [], seen: new Set(), last: -1 };
  const LINES = '<rect x="0" y="0" width="105" height="68" fill="none" stroke="#ffffffaa" stroke-width=".5"/><line x1="52.5" y1="0" x2="52.5" y2="68" stroke="#ffffffaa" stroke-width=".5"/><circle cx="52.5" cy="34" r="9.15" fill="none" stroke="#ffffffaa" stroke-width=".5"/>';
  const COL = ['#75AADB', '#F2C400'];   // home, away (the roster's teams take these colours in order)
  const key = (s) => [s.h, s.a, s.seed, s.st, s.month, s.kick, s.half].join('|');
  const reset = (k) => { S.key = k; S.roster = null; S.frames = []; S.events = []; S.seen = new Set(); S.last = -1; };

  function start(setup, roster) { reset(key(setup)); S.roster = roster; }
  function frame(setup, f) {
    if (!f || !f.players || !f.players.length) return;
    const k = key(setup); if (S.key !== k) reset(k);
    const sec = Math.floor(f.mclock || 0);
    if (sec === S.last) return;
    if (sec < S.last) reset(k);   // the clock went back: a new kick-off in the same setup
    S.last = sec;
    S.frames.push({ t: sec, f: (f.half || 1) - 1, p: f.players.map((q) => [q[0], q[1]]) });   // t: the match second, so a view can count by minute
  }
  function events(setup, batch) {
    if (!Array.isArray(batch)) return;
    const k = key(setup); if (S.key !== k) reset(k);
    for (const ev of batch) {
      const id = ev.simT + ':' + ev.type + ':' + (ev.player || '');
      if (S.seen.has(id)) continue;
      S.seen.add(id); S.events.push(ev);
    }
  }

  // the live match in the shape the drawing reads
  function match() {
    const r = S.roster; if (!r || !S.frames.length) return null;
    return { home: r.teams[0], away: r.teams[1], pids: r.players.map((p, i) => ({ name: p.name, team: p.team, num: i < 11 ? i + 1 : i - 10 })), frames: S.frames, events: S.events };
  }
  // the attacking-direction position of player i in a frame: each side attacks toward x = 105
  const atk = (fr, i) => { const q = fr.p[i]; if (!q) return null; const flip = i < 11 ? fr.f === 1 : fr.f === 0; return flip ? [105 - q[0], 68 - q[1]] : q; };
  const side = (m, team) => (team === 'away' ? m.away : m.home);
  const idxOf = (m, team) => m.pids.map((p, i) => (p.team === team ? i : -1)).filter((i) => i >= 0);
  const colour = (m, team) => (team === m.away ? COL[1] : COL[0]);
  const pitch = (inner, title) => '<svg viewBox="-2 -2 109 72" width="100%" role="img" aria-label="' + title + '"><rect x="-2" y="-2" width="109" height="72" rx="1" fill="#2d6a3e"/>' + LINES + inner + '</svg>';

  function avg(m) {
    const acc = m.pids.map(() => ({ x: 0, y: 0, n: 0 }));
    for (const fr of m.frames) m.pids.forEach((_, i) => { const q = atk(fr, i); if (!q) return; acc[i].x += q[0]; acc[i].y += q[1]; acc[i].n++; });
    return acc.map((a, i) => (a.n ? { x: a.x / a.n, y: a.y / a.n, i } : null));
  }

  function heatmap(m, team, player) {
    const NX = 21, NY = 14, H = new Array(NX * NY).fill(0);
    const idxs = team === 'player' ? [player] : idxOf(m, team);
    let n = 0;
    for (const fr of m.frames) for (const i of idxs) {
      const q = atk(fr, i); if (!q) continue;
      const bx = Math.min(NX - 1, Math.max(0, Math.floor(q[0] / 5))), by = Math.min(NY - 1, Math.max(0, Math.floor(q[1] / (68 / NY))));
      H[by * NX + bx]++; n++;
    }
    if (!n) return '<p class="empty">No positions yet.</p>';
    const mx = Math.max(...H), ch = 68 / NY; let inner = '';
    const c = team === 'player' ? COL[0] : colour(m, team);
    H.forEach((v, k) => { if (v) inner += '<rect x="' + (k % NX) * 5 + '" y="' + (Math.floor(k / NX) * ch).toFixed(2) + '" width="5" height="' + ch.toFixed(2) + '" fill="' + c + '" fill-opacity="' + (0.06 + 0.8 * Math.pow(v / mx, 0.7)).toFixed(2) + '"/>'; });
    return pitch(inner, 'Heatmap, time in zone, attacking right');
  }

  function passNetwork(m, team) {
    const A = avg(m), pos = {};
    m.pids.forEach((p, i) => { if (p.team === team && A[i]) pos[p.name] = A[i]; });
    const pairs = {}, recv = {};
    for (const e of m.events) if (e.type === 'pass' && e.team === team && e.to) { const k = [e.player, e.to].sort().join('|'); pairs[k] = (pairs[k] || 0) + 1; recv[e.to] = (recv[e.to] || 0) + 1; }
    const mx = Math.max(1, ...Object.values(pairs), 1), rm = Math.max(1, ...Object.values(recv), 1); let s = '';
    for (const k in pairs) { if (pairs[k] < 3) continue; const [a, b] = k.split('|'); if (!pos[a] || !pos[b]) continue; s += '<line x1="' + pos[a].x.toFixed(1) + '" y1="' + pos[a].y.toFixed(1) + '" x2="' + pos[b].x.toFixed(1) + '" y2="' + pos[b].y.toFixed(1) + '" stroke="' + colour(m, team) + '" stroke-opacity="' + (0.3 + 0.6 * pairs[k] / mx).toFixed(2) + '" stroke-width="' + (0.4 + 1.6 * pairs[k] / mx).toFixed(2) + '"/>'; }
    for (const n in pos) s += '<circle cx="' + pos[n].x.toFixed(1) + '" cy="' + pos[n].y.toFixed(1) + '" r="' + (1.6 + 2.2 * Math.sqrt((recv[n] || 0) / rm)).toFixed(2) + '" fill="' + colour(m, team) + '" stroke="#fff" stroke-width=".4"/>';
    return pitch(s, 'Pass network, passes between a pair (3 or more)');
  }

  // one team's average shape in its attacking frame, the same frame as the heatmap and the pass network
  function avgPositions(m, teamKey) {
    const A = avg(m); let s = '';
    A.forEach((p, i) => { if (!p || m.pids[i].team !== teamKey) return; const x = p.x, y = p.y; s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.3" fill="' + colour(m, teamKey) + '" stroke="#fff" stroke-width=".4"><title>' + m.pids[i].name + '</title></circle>'; });
    return pitch(s, 'Average positions for ' + teamKey + ', attacking right');
  }

  // draws one kind into a container; returns what was drawn (for the Ask card): kind, team, samples, passes
  function render(kind, params, container) {
    const m = match();
    const team = (params && params.team) === 'away' ? 'away' : 'home';
    if (!container) return null;
    if (!m) { container.innerHTML = '<p class="empty">No live match yet. Start the match in Watch: the maps fill in as it plays.</p>'; return { kind, status: 'empty', live: false, citations: [] }; }
    const teamKey = team === 'away' ? m.away : m.home;
    let svg, passes = 0;
    if (kind === 'heatmap') svg = params && params.team === 'player' ? heatmap(m, 'player', Math.max(0, +params.player || 0)) : heatmap(m, teamKey);
    else if (kind === 'pass_network') { svg = passNetwork(m, teamKey); passes = m.events.filter((e) => e.type === 'pass' && e.team === teamKey).length; }
    else if (kind === 'avg_positions') svg = avgPositions(m, teamKey);
    else { container.innerHTML = '<p class="empty">Unknown map: ' + kind + '.</p>'; return { kind, status: 'empty', live: true, error: 'unknown', citations: [] }; }
    container.innerHTML = svg + '<p class="note">Live from Watch · simulated · ' + S.frames.length + ' positions sampled, one per match second' + (passes ? ' · ' + passes + ' passes' : '') + '</p>';
    return { kind, status: 'ok', live: true, team: teamKey, samples: S.frames.length, passes, citations: [] };
  }

  return { start, frame, events, match, render, get samples() { return S.frames.length; } };
})();
window.MAPS = MAPS;
// window.MC.analysis is shared with the shots and momentum modules (crew-analyst-shots.js): this layer takes its own kinds and hands the rest to the layer before it
window.MC = window.MC || {};
const MAP_KINDS = ['heatmap', 'pass_network', 'avg_positions'];
const prevAnalysis = window.MC.analysis || null;
window.MC.analysis = {
  render(kind, params, container) {
    if (MAP_KINDS.includes(kind)) return MAPS.render(kind, params, container);
    if (prevAnalysis) return prevAnalysis.render(kind, params, container);
    if (container) container.textContent = 'Planned: this view is not built yet.';
    return { kind, status: 'planned', citations: [] };
  },
};
