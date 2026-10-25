/* Crew spawn tree (CREW-6.1, AB#439, Experience lane). Mounts a "Crew" section at the top of the Agents tab
   when CREW.enabled (?crew=1). Reads only CREW.state: the latest moment's agents[{id,role,parent,status}].
   The Showrunner fans out to subagents as they appear; the tree fades when the moment is done.
   Simulated while CREW.state.simulated is true. */
(function () {
  'use strict';
  var C = window.CREW;
  var mount = document.getElementById('crew-mount');
  if (!C || !C.enabled || !mount) return;

  var css = document.createElement('style');
  css.textContent =
    '#crew-tree{background:var(--bg2);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;min-width:0}' +
    '#crew-tree h3{margin:0;font-size:14px}' +
    '.ct-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}' +
    '.ct-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0;font-size:13px;color:var(--muted)}' +
    '#ct-label{color:var(--text);font-weight:600}' +
    '.ct-sim{font-size:12px;padding:2px 7px;border-radius:999px;border:1px solid var(--line);color:var(--warn)}' +
    '#ct-tree{transition:opacity .6s ease;overflow-wrap:anywhere}#ct-tree[data-done="true"]{opacity:.5}' +
    '#ct-tree ul{list-style:none;margin:0;padding:0}' +
    '#ct-tree ul ul{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}' +
    '.ct-node{display:inline-flex;flex-direction:column;gap:2px;min-width:0;max-width:100%;padding:6px 10px;border:1px solid var(--line);border-radius:var(--r);background:var(--bg3);font-size:13px;animation:ct-bloom .45s ease-out}' +
    '.ct-node b{font-weight:600}.ct-node small{color:var(--muted)}' +
    '.ct-node[data-status="running"]{border-color:var(--accent)}.ct-node[data-status="running"] small::before{content:"\\25CF  ";color:var(--accent)}' +
    '.ct-node[data-status="done"]{border-color:var(--ok)}.ct-node[data-status="done"] small::before{content:"\\2713  ";color:var(--ok)}' +
    '.ct-empty{margin:0;color:var(--muted);font-size:13px}' +
    '#crew-tree button{min-height:32px}' +
    '@keyframes ct-bloom{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.ct-node{animation:none}#ct-tree{transition:none}}';
  document.head.appendChild(css);

  mount.innerHTML =
    '<section id="crew-tree" class="ag-panel" aria-labelledby="ct-h">' +
    '<div class="ct-head"><h3 id="ct-h">Crew</h3><span class="ct-sim" id="ct-sim">Simulated</span>' +
    '<button type="button" class="pill" id="crew-play">Play Simulated goal</button></div>' +
    '<p class="ct-meta"><span id="ct-label"></span><span id="ct-routed"></span></p>' +
    '<p class="ct-empty" id="ct-empty">No moment yet. Play a Simulated goal to watch the Showrunner spawn its crew.</p>' +
    '<div id="ct-tree" aria-label="Spawn tree for the latest moment"><ul id="ct-root"></ul></div>' +
    '<p id="ct-announce" aria-live="polite" class="muted"></p>' +
    '</section>';
  var $ = function (id) { return document.getElementById(id); };
  $('crew-play').addEventListener('click', function () { C.play(); });

  var nodes = {}, shownMoment = null;

  function make(a) {
    var li = document.createElement('li'), d = document.createElement('div');
    d.className = 'ct-node';
    d.innerHTML = '<b></b><small></small>';
    li.appendChild(d);
    return { li: li, d: d, kids: null };
  }

  function render(S) {
    var m = S.moments.length ? S.moments[S.moments.length - 1] : null;
    $('ct-sim').hidden = !S.simulated;
    $('ct-empty').hidden = !!m;
    $('ct-tree').hidden = !m;
    if (!m) { $('ct-label').textContent = ''; $('ct-routed').textContent = ''; return; }
    if (shownMoment !== m.id) {           // a newer moment replaces the old tree
      $('ct-root').textContent = ''; nodes = {}; shownMoment = m.id;
    }
    $('ct-label').textContent = (m.why || 'moment') + ', ' + m.minute + "'";
    $('ct-routed').textContent = 'routed by ' + (m.routed_by || 'rules');
    var fresh = [];
    m.agents.forEach(function (a) {
      var n = nodes[a.id];
      if (!n) { n = nodes[a.id] = make(a); fresh.push(a.role); }
      n.d.setAttribute('data-agent-id', a.id);
      n.d.setAttribute('data-status', a.status || 'running');
      if (a.parent) n.d.setAttribute('data-parent', a.parent); else n.d.removeAttribute('data-parent');
      n.d.firstChild.textContent = a.role || a.id;
      n.d.lastChild.textContent = a.status === 'done' ? 'done' : 'running';
    });
    m.agents.forEach(function (a) {       // attach under the parent (or the root list if it has not arrived)
      var n = nodes[a.id], p = a.parent && nodes[a.parent], host;
      if (p) { if (!p.kids) { p.kids = document.createElement('ul'); p.li.appendChild(p.kids); } host = p.kids; } else host = $('ct-root');
      if (n.li.parentNode !== host) host.appendChild(n.li);
    });
    $('ct-tree').setAttribute('data-done', m.status === 'done' ? 'true' : 'false');
    if (fresh.length) $('ct-announce').textContent = fresh.join(', ') + ' joined the crew';
  }

  C.subscribe(render);
})();
