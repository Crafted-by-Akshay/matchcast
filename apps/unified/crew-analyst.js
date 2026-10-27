/* Analyst live view (CREW-7.8, AB#501). With CREW.enabled (on by default, ?crew=0 turns it off) the Analyst tab is a compact view drawn from the shell's own data:
   AG.run (events, verified claims), CREW.state.feeds.analyst (the crew fixture) and M.indices (Watch's control/chaos/tempo).
   The 27-page console stays one click away behind "Full console" (same iframe, same routing as before, see routeAnalyst in index.html).
   The match is the browser simulator, so every panel says Simulated. Nothing here is estimated: a panel with no honest source says so. */
const ALV = (() => {
  const FAV_KEY = 'mc-crew-fav';
  let full = false, favName = null, hostEl = null, headSig = '', bodySig = '';
  const on = () => !!(window.CREW && window.CREW.enabled);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const f2 = (x) => (+x || 0).toFixed(2);
  const mn = (m) => Math.floor(+m || 0) + "'";
  const num = (v) => v != null && v !== '' && Number.isFinite(+v);

  const css = '#al{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;padding:12px var(--gut,16px) 20px;background:var(--bg);color:var(--text);font:13px/1.45 var(--font,system-ui,sans-serif)}'
    + '#al[hidden]{display:none}#al *{box-sizing:border-box;min-width:0}'
    + '#al .alh{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-bottom:10px}#al h2{margin:0;font-size:16px}'
    + '#al .sim{font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid rgba(245,185,66,.5);color:var(--warn)}'
    + '#al .alh label{font-size:12px;color:var(--muted);display:inline-flex;gap:6px;align-items:center}'
    + '#al select,#al button{font:inherit;font-size:12px;min-height:32px;background:var(--bg3);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:4px 10px;max-width:100%}'
    + '#al button{cursor:pointer}#al .alh .sp{flex:1 1 0}'
    + '#al .grid{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}@media(min-width:900px){#al .grid{grid-template-columns:repeat(2,minmax(0,1fr))}#al .wide{grid-column:1/3}}'
    + '#al section{background:var(--bg2);border:1px solid var(--line);border-radius:var(--r,12px);padding:10px 12px}'
    + '#al h3{margin:0 0 6px;font-size:13px;display:flex;gap:8px;justify-content:space-between;align-items:baseline;flex-wrap:wrap}#al h3 small,#al h4 small{font-weight:400;color:var(--muted);font-size:12px}#al h4{margin:10px 0 4px;font-size:13px}'
    + '#al ul{list-style:none;margin:0;padding:0}#al li{padding:4px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}#al li:first-child{border-top:0}'
    + '#al .m{color:var(--muted);font-size:12px}#al .ok{color:var(--ok)}#al .empty{color:var(--muted)}'
    + '#al table{width:100%;border-collapse:collapse;font-size:12px}#al th,#al td{text-align:left;padding:4px 6px 4px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}#al th{color:var(--muted);font-weight:600;border-top:0}'
    + '#al svg{display:block;width:100%;height:auto;max-width:100%}'
    + '#al [data-side="0"]{--side:var(--accent)}#al [data-side="1"]{--side:var(--hot)}'
    + '#al .key{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}#al .key span{font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--side);color:var(--text)}#al .key span[data-fav="1"]{background:var(--side);color:#fff;font-weight:700}'
    + '#al [data-fav="1"]{font-weight:700}#al tr[data-fav="1"] td:first-child::before,#al li[data-fav="1"] b::before{content:"\\2605  ";color:var(--side)}'
    + '#al .gauge{height:10px;border-radius:6px;background:var(--bg3);overflow:hidden;margin:3px 0 8px}#al .gauge i{display:block;height:100%;background:var(--ok)}#al .gauge.chaos i{background:var(--warn)}'
    + '#al .share{display:flex;height:10px;border-radius:6px;overflow:hidden;margin:3px 0 4px}#al .share i{display:block;background:var(--side)}'
    + '.view.alv .wait{display:none}#al-bar{position:absolute;top:0;left:0;right:0;height:40px;z-index:3;display:flex;align-items:center;padding:0 12px;background:var(--bg2);border-bottom:1px solid var(--line)}#al-bar[hidden]{display:none}#al-back{font:600 12px var(--font,system-ui,sans-serif);min-height:32px;padding:4px 12px;border-radius:999px;background:var(--bg3);color:var(--text);border:1px solid var(--accent);cursor:pointer}';

  const run = () => (typeof AG !== 'undefined' && AG.run) || null;
  const sideOf = (r, team) => (!r || team == null ? -1 : team === r.names.hk ? 0 : team === r.names.ak ? 1 : -1);
  // the two clubs: the run's names, else the picked fixture's
  function clubs() {
    const r = run();
    if (r) return [r.names.home, r.names.away];
    const fx = typeof M !== 'undefined' && M.fixture && typeof byId === 'function' ? byId(M.fixture) : null;
    return fx ? [fx.home.club, fx.away.club] : null;
  }
  function favSide(cl) {
    let want = favName; try { want = localStorage.getItem(FAV_KEY) || favName; } catch (e) { /* storage blocked: the in-memory choice stands */ }
    const i = cl ? cl.indexOf(want) : -1;
    return i >= 0 ? i : 0;
  }
  const fav = (side, f) => (side === f ? ' data-fav="1"' : '');

  // the live match's maps, drawn by MAPS (maps.js) through window.MC.analysis; the team and map choice are buttons
  let mapTeam = 'home', mapKind = 'heatmap', mapAt = 0;
  const mapPanel = (cl) => '<section class="wide" id="al-maps"><h3>Maps <small>live match, simulated: ' + esc(cl[0]) + ' v ' + esc(cl[1]) + '</small></h3>' +
    '<div class="key" role="group" aria-label="Team">' + [['home', cl[0]], ['away', cl[1]]].map(([t, n]) => '<button type="button" data-team="' + t + '" aria-pressed="' + (mapTeam === t) + '">' + esc(n) + '</button>').join('') + '</div>' +
    '<div class="key" role="group" aria-label="Map">' + [['heatmap', 'Heatmap'], ['pass_network', 'Pass network'], ['avg_positions', 'Average positions']].map(([k, l]) => '<button type="button" data-map="' + k + '" aria-pressed="' + (mapKind === k) + '">' + l + '</button>').join('') + '</div>' +
    '<div id="al-map"></div></section>';
  function drawMap(force) {
    const el = hostEl && hostEl.querySelector('#al-map');
    if (!el || !window.MC || !window.MC.analysis || (!force && Date.now() - mapAt < 2000)) return;
    mapAt = Date.now(); window.MC.analysis.render(mapKind, { team: mapTeam }, el);
  }

  // ---- panels, each a string of html built from the data the shell already holds
  function feedPanel(r) {
    const ver = [], sim = [];
    if (r) for (const c of r.claims) if (c.verdict === 'verified' && c.text) ver.push({ m: +c.minute || 0, text: c.text, tag: c.source === 'model' ? 'Live agents' : 'Rules' });
    for (const l of (window.CREW.state.feeds.analyst || [])) sim.push({ m: (+l.match_time_ms || 0) / 60000, text: l.text, verdict: l.verdict });
    ver.sort((a, b) => b.m - a.m); sim.sort((a, b) => b.m - a.m);
    const lv = ver.slice(0, 8).map((x) => '<li><b>' + mn(x.m) + '</b> ' + esc(x.text) + ' <span class="m"><span class="ok">&#10003; verified</span> · ' + esc(x.tag) + ', recounted from the event log</span></li>').join('');
    const real = !window.CREW.state.simulated;   // real crew frames carry the Verifier's verdict; only the fixture is labelled Simulated
    const ls = sim.slice(0, 5).map((x) => '<li><b>' + mn(x.m) + '</b> ' + esc(x.text) + ' <span class="m">' + (!real ? 'Simulated, not recounted'
      : x.verdict === 'verified' ? '<span class="ok">&#10003; verified</span> · Crew, recounted by the Verifier' : 'Crew line, no Verifier verdict') + '</span></li>').join('');
    return '<section data-panel="feed" class="wide"><h3>Analyst feed <small>Simulated match</small></h3>'
      + (lv ? '<ul data-group="verified">' + lv + '</ul>' : '<p class="empty">No verified lines yet. They appear after the kick-off in Watch.</p>')
      + (ls ? (real ? '<h4>Crew lines <small>from the live crew</small></h4><ul data-group="crew">' : '<h4>Crew fixture <small>Simulated, not checked by the Verifier</small></h4><ul data-group="fixture">')  + ls + '</ul>' : '') + '</section>';
  }

  function controlPanel(r, cl, f) {
    const ix = typeof M !== 'undefined' ? M.indices : null;
    let h = '<section data-panel="control"><h3>Control vs chaos <small>Simulated · Watch, last 5 min</small></h3>';
    if (ix && num(ix.control) && num(ix.chaos)) {
      const c = Math.round(ix.control), k = Math.round(ix.chaos);
      h += '<div>Control <b>' + c + '</b> / 100</div><div class="gauge" data-gauge="control" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + c + '" aria-label="Control ' + c + ' out of 100, whole match, last 5 minutes"><i style="width:' + c + '%"></i></div>'
        + '<div>Chaos <b>' + k + '</b> / 100</div><div class="gauge chaos" data-gauge="chaos" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + k + '" aria-label="Chaos ' + k + ' out of 100, whole match, last 5 minutes"><i style="width:' + k + '%"></i></div>'
        + '<p class="m">Tempo ' + f2(ix.tempo) + ' passes a minute. Both indices describe the match, not one club (docs/metrics.md).</p>';
    } else h += '<p class="empty">No control or chaos index yet. Watch reports one after about two minutes of play; nothing is estimated here.</p>';
    if (r && cl) {
      const last = r.events.length ? r.events[r.events.length - 1].minute : 0, p = [0, 0];
      for (const e of r.events) if (e.type === 'pass' && e.minute > last - 5) { const s = sideOf(r, e.team); if (s >= 0) p[s]++; }
      const t = p[0] + p[1];
      if (t) {
        const a = Math.round((100 * p[0]) / t);
        h += '<div class="m">Share of passes, last 5 min (a stand-in for possession, which the events do not record)</div>'
          + '<div class="share" role="img" aria-label="Share of passes in the last 5 minutes: ' + esc(cl[0]) + ' ' + a + ' percent, ' + esc(cl[1]) + ' ' + (100 - a) + ' percent"><i data-side="0" style="width:' + a + '%"></i><i data-side="1" style="width:' + (100 - a) + '%"></i></div>'
          + '<div class="m"><span data-side="0"' + fav(0, f) + '>' + esc(cl[0]) + ' ' + a + '%</span> · <span data-side="1"' + fav(1, f) + '>' + esc(cl[1]) + ' ' + (100 - a) + '%</span></div>';
      }
    }
    return h + '</section>';
  }

  function passPanel(r, cl, f) {
    let h = '<section data-panel="passes"><h3>Pass quality <small>Simulated · counted from the pass events</small></h3>';
    const ps = r ? r.events.filter((e) => e.type === 'pass' && sideOf(r, e.team) >= 0) : [];
    if (!ps.length) return h + '<p class="empty">No passes yet.</p></section>';
    const row = [0, 1].map(() => ({ n: 0, ok: 0, len: 0, nl: 0 }));
    const tov = new Map();   // turnovers by tenth of a minute, so each pass looks at two buckets instead of the whole log
    for (const t of r.events) if (t.type === 'turnover') { const k = Math.floor(t.minute * 10); (tov.get(k) || tov.set(k, []).get(k)).push(t); }
    const won = (e) => { const k = Math.floor(e.minute * 10); for (let b = k; b <= k + 1; b++) for (const t of tov.get(b) || []) if (t.team !== e.team && t.minute > e.minute && t.minute <= e.minute + 0.1) return true; return false; };
    for (const e of r.events) {
      if (e.type !== 'pass') continue;
      const s = sideOf(r, e.team); if (s < 0) continue;
      const o = row[s]; o.n++;
      // inferred like Watch's indices: completed unless the other side wins the ball within 6 s
      if (!won(e)) o.ok++;
      const d = e.data || {}; if (num(d.x0) && num(d.y0) && num(d.x1) && num(d.y1)) { o.len += Math.hypot(d.x1 - d.x0, d.y1 - d.y0); o.nl++; }
    }
    h += '<table><thead><tr><th>Club</th><th>Passes</th><th>Completed (inferred)</th><th>Avg length</th></tr></thead><tbody>'
      + row.map((o, s) => '<tr data-side="' + s + '"' + fav(s, f) + '><td>' + esc(cl[s]) + '</td><td>' + o.n + '</td><td>' + (o.n ? Math.round((100 * o.ok) / o.n) + '%' : '-') + '</td><td>' + (o.nl ? (o.len / o.nl).toFixed(1) + ' m' : '-') + '</td></tr>').join('')
      + '</tbody></table><p class="m">Completion is inferred: a pass counts unless the other side wins the ball within 6 s.</p>';
    return h + '</section>';
  }

  function storyPanel(r, cl, f) {
    let h = '<section data-panel="story"><h3>Storyline ledger <small>lines already said, per club and player</small></h3>';
    const per = new Map(), clubN = [0, 0].map(() => ({ said: 0, aired: 0 }));
    if (r) for (const c of r.claims) {
      if (c.verdict !== 'verified' || !c.inputs) continue;
      const side = cl.indexOf(c.inputs.teamName), who = c.inputs.scorer || c.inputs.player;
      if (side < 0) continue;
      const air = c.approval === 'approved' ? 1 : 0;
      clubN[side].said++; clubN[side].aired += air;
      if (who) { const k = side + '|' + who, o = per.get(k) || { side, who, said: 0, aired: 0, last: c }; o.said++; o.aired += air; if (c.minute >= o.last.minute) o.last = c; per.set(k, o); }
    }
    if (!clubN[0].said && !clubN[1].said) return h + '<p class="empty">Nothing has been said yet.</p></section>';
    const li = [0, 1].filter((s) => clubN[s].said).map((s) => '<li data-side="' + s + '"' + fav(s, f) + '><b>' + esc(cl[s]) + '</b> <span class="m">' + clubN[s].said + ' verified · ' + clubN[s].aired + ' aired</span><ul>'
      + [...per.values()].filter((o) => o.side === s).sort((a, b) => b.said - a.said).map((o) => '<li><b>' + esc(o.who) + '</b> <span class="m">' + o.said + ' verified · ' + o.aired + ' aired · last ' + mn(o.last.minute) + '</span><br>' + esc(o.last.text) + '</li>').join('') + '</ul></li>').join('');
    return h + '<ul>' + li + '</ul><p class="m">Verified by the Verifier; aired means a producer approved it for the commentary.</p></section>';
  }

  // ---- build and keep the view in step with the shell
  function ensureHost() {
    if (hostEl) return hostEl;
    const sec = document.getElementById('v-analyst'); if (!sec) return null;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    hostEl = document.createElement('div'); hostEl.id = 'al'; hostEl.setAttribute('role', 'region'); hostEl.setAttribute('aria-label', 'Analyst live view');
    hostEl.innerHTML = '<div class="alh"><h2>Analyst live view</h2><span class="sim" title="The match is the browser simulator, not a real fixture">Simulated</span><label>Favourite club <select id="al-fav"></select></label><span class="sp"></span><button type="button" id="al-full" title="Open the 27-page enterprise console">Full console</button></div><div id="al-body" class="grid"></div>';
    sec.insertBefore(hostEl, sec.firstChild);
    hostEl.addEventListener('click', (e) => {   // the Maps section's team and map buttons
      const t = e.target.closest && e.target.closest('#al-maps [data-team],#al-maps [data-map]'); if (!t) return;   // only the Maps buttons: other panels mark their svgs with data-map too
      if (t.dataset.team) mapTeam = t.dataset.team;
      if (t.dataset.map) mapKind = t.dataset.map;
      bodySig = ''; render(); drawMap(true);
    });
    const bar = document.createElement('div'); bar.id = 'al-bar'; bar.hidden = true;
    const back = document.createElement('button'); back.type = 'button'; back.id = 'al-back'; back.textContent = 'Live view'; back.title = 'Back to the compact live view';
    bar.appendChild(back); sec.appendChild(bar);
    hostEl.querySelector('#al-full').onclick = () => {
      if (typeof M === 'undefined' || !M.fixture) { if (typeof toast === 'function') toast('Pick a season fixture to open the full console'); return; }   // the console needs a match to route to; without one it would sit on a spinner
      full = true; sync(); if (typeof routeAnalyst === 'function') routeAnalyst(); sync(); back.focus();
    };
    back.onclick = () => { full = false; sync(); hostEl.querySelector('#al-full').focus(); };
    hostEl.querySelector('#al-fav').onchange = (e) => { const cl = clubs(); if (cl) { favName = cl[+e.target.value]; try { localStorage.setItem(FAV_KEY, favName); } catch (x) { /* storage blocked: favName keeps it for this visit */ } } bodySig = ''; render(); };
    return hostEl;
  }
  function render() {
    if (!on() || (typeof current !== 'undefined' && current !== 'analyst') || !ensureHost()) return;
    const r = run(), cl = clubs(), f = favSide(cl), sel = hostEl.querySelector('#al-fav');
    const hs = cl ? cl.join('|') + '|' + f : '';
    if (hs !== headSig) { headSig = hs; sel.innerHTML = cl ? cl.map((c, i) => '<option value="' + i + '"' + (i === f ? ' selected' : '') + '>' + esc(c) + '</option>').join('') : ''; sel.disabled = !cl; }
    let body;
    if (!cl) body = '<section class="wide"><p class="empty">Pick a fixture to see its live view.</p></section>';
    else body = feedPanel(r) + mapPanel(cl) + controlPanel(r, cl, f) + ALX.panel(r, cl, f, null, hostEl) + ALM.panel(r, cl, hostEl) + ALP.panel(r, cl, hostEl) + ALG.panel(r, cl, hostEl) + ALS.panel(r, cl, hostEl) + ALR.panel(r, cl, hostEl) + passPanel(r, cl, f) + storyPanel(r, cl, f);
    if (body !== bodySig) { bodySig = body; ALX.setHtml(hostEl.querySelector('#al-body'), body); mapAt = 0; }
    ALX.mounted(hostEl);   // the shot replay (crew-analyst-shots.js) draws into the fresh svg, or starts after a tap
    drawMap();
  }
  // which of the live view and the console shows; the console iframe is created only when asked for
  function sync() {
    if (!on() || !ensureHost()) return;
    const sec = document.getElementById('v-analyst'), live = !full, fr = typeof FR !== 'undefined' && FR.analyst && FR.analyst.el;
    hostEl.hidden = !live;
    sec.classList.toggle('alv', live);
    sec.setAttribute('aria-label', live ? 'Analyst: live view' : 'Analyst: enterprise console');
    if (fr) { fr.style.display = live ? 'none' : ''; fr.style.marginTop = live ? '' : '40px'; fr.style.height = live ? '' : 'calc(100% - 40px)'; }   // the Live view bar sits above the console, covering none of it
    document.getElementById('al-bar').hidden = live;
    if (live) render();
  }
  if (on()) { setInterval(() => { if (typeof current !== 'undefined' && current === 'analyst') { sync(); } }, 500); window.CREW.subscribe(() => { bodySig = ''; if (hostEl && !full) render(); }); }
  return { sync, render, live: () => on() && !full, get full() { return full; } };
})();
