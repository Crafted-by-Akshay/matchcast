/* Crew spawn tree (CREW-6.1, AB#439, Experience lane). Mounts a "Crew" section at the top of the Agents tab
   when CREW.enabled (?crew=1). Reads only CREW.state: the latest moment's agents[{id,role,parent,status}].
   The Showrunner fans out to subagents as they appear; the tree fades when the moment is done.
   Simulated while CREW.state.simulated is true. */
(function () {
  'use strict';
  var C = window.CREW;
  var mount = document.getElementById('crew-mount');
  if (!C || !C.enabled || !mount) return;
  mount.hidden = false;   // hidden in the html so the flag-off Agents tab keeps its layout

  var css = document.createElement('style');
  css.textContent =
    '#crew-tree{background:var(--bg2);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;min-width:0}' +
    '#crew-tree h3{margin:0;font-size:14px}' +
    '.ct-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}' +
    '.ct-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0;font-size:13px;color:var(--muted)}' +
    '#ct-label{color:var(--text);font-weight:600}' +
    '.ct-sim{font-size:12px;padding:2px 7px;border-radius:999px;border:1px solid var(--line);color:var(--warn)}' +
    '#ct-tree{overflow-wrap:anywhere;min-width:0}#ct-tree li{min-width:0;max-width:100%}' +
    '.ct-node{transition:border-color .6s ease,background-color .6s ease}#ct-tree[data-done="true"] .ct-node{background:transparent;border-color:var(--line)}' +
    '#ct-state{color:var(--ok);font-weight:600}' +
    '#ct-tree ul{list-style:none;margin:0;padding:0}' +
    '#ct-tree ul ul{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}' +
    '.ct-node{display:inline-flex;flex-direction:column;gap:2px;min-width:0;max-width:100%;padding:6px 10px;border:1px solid var(--line);border-radius:var(--r);background:var(--bg3);font-size:13px;animation:ct-bloom .45s ease-out}' +
    '.ct-node b{font-weight:600}.ct-node small{color:var(--muted)}' +
    '.ct-node[data-status="running"]{border-color:var(--accent)}.ct-node[data-status="running"] small::before{content:"\\25CF  ";color:var(--accent)}' +
    '.ct-node[data-status="failed"]{border-color:var(--bad)}.ct-node[data-status="failed"] small::before{content:"\\2717  ";color:var(--bad)}' +
    '.ct-node[data-status="done"]{border-color:var(--ok)}.ct-node[data-status="done"] small::before{content:"\\2713  ";color:var(--ok)}' +
    '.ct-node[data-status="no_data"],.ct-node[data-status="budget_exhausted"]{border-style:dashed;border-color:var(--warn)}.ct-node[data-status="no_data"] small::before,.ct-node[data-status="budget_exhausted"] small::before{content:"\\2013  ";color:var(--warn)}' +
    '#ct-more[hidden]{display:none}#ct-more{margin-top:8px}' +
    '.ct-empty{margin:0;color:var(--muted);font-size:13px}' +
    '#crew-tree button{min-height:32px}' +
    '@keyframes ct-bloom{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.ct-node{animation:none;transition:none}}';
  document.head.appendChild(css);

  mount.innerHTML =
    '<section id="crew-tree" class="ag-panel" aria-labelledby="ct-h">' +
    '<div class="ct-head"><h3 id="ct-h">Crew</h3><span class="ct-sim" id="ct-sim">Simulated</span>' +
    '<button type="button" class="pill" id="crew-play">Play Simulated goal</button></div>' +
    '<p class="ct-meta"><span id="ct-label"></span><span id="ct-routed"></span><span id="ct-state"></span></p>' +
    '<p class="ct-empty" id="ct-empty">No moment yet. Play a Simulated goal to watch the Showrunner spawn its crew.</p>' +
    '<div id="ct-tree" role="group" aria-label="Spawn tree for the latest moment"><ul id="ct-root" role="list" aria-label="Showrunner and subagents"></ul>' +
    '<button type="button" class="pill" id="ct-more" hidden aria-expanded="false"></button></div>' +
    '<p id="ct-announce" aria-live="polite" class="muted"></p>' +
    '</section>';
  var $ = function (id) { return document.getElementById(id); };
  var CAP = 12, DEPTH = 8, LABELS = { running: 'running', done: 'done', failed: 'failed', queued: 'queued', no_data: 'no data', budget_exhausted: 'budget exhausted' };
  var nodes = {}, shownMoment = null, expanded = false, pending = [], flushT = null, lastStatus = {}, doneSaid = {};

  $('crew-play').addEventListener('click', function () { C.reset(); C.play(); });   // reset first: a replay of the same moment fans out again
  $('ct-more').addEventListener('click', function () { expanded = !expanded; render(C.state); });

  function say(msg) {            // one announcement per tick: joins in the same tick share a sentence
    pending.push(msg);
    if (flushT) return;
    flushT = setTimeout(function () {
      var el = $('ct-announce'), text = pending.join('. ');
      pending = []; flushT = null;
      el.textContent = '';       // clear, then set, so an identical message is read again
      setTimeout(function () { el.textContent = text; }, 30);
    }, 100);
  }

  function make() {
    var li = document.createElement('li'), d = document.createElement('div');
    d.className = 'ct-node';
    d.innerHTML = '<b></b><small></small>';
    li.appendChild(d);
    return { li: li, d: d, kids: null };
  }

  function clearAll() {
    $('ct-root').textContent = ''; nodes = {}; lastStatus = {}; doneSaid = {}; expanded = false; shownMoment = null;
    pending = []; if (flushT) { clearTimeout(flushT); flushT = null; }
    $('ct-announce').textContent = '';
  }

  // the parent a node hangs under: none if it is missing, points at itself, or sits in a cycle / a chain deeper than DEPTH
  function parentOf(a, byId) {
    if (!a.parent || !byId[a.parent]) return null;
    var cur = a, seen = {};
    seen[a.id] = true;
    for (var i = 0; i < DEPTH; i++) {
      var p = byId[cur.parent];
      if (!p) return a.parent;
      if (seen[p.id]) return null;
      seen[p.id] = true; cur = p;
    }
    return null;
  }

  function statusOf(a, m) {
    var st = a.status || 'unknown';
    if (m.status === 'done' && (st === 'running' || st === 'unknown')) st = 'done';   // the moment is over, so nothing is still running
    return st;
  }

  function render(S) {
    var m = S.moments.length ? S.moments[S.moments.length - 1] : null;
    $('ct-sim').hidden = !S.simulated;
    $('ct-empty').hidden = !!m;
    $('ct-tree').hidden = !m;
    if (!m) { clearAll(); $('ct-label').textContent = ''; $('ct-routed').textContent = ''; $('ct-state').textContent = ''; $('ct-more').hidden = true; return; }
    if (shownMoment !== m.id) { clearAll(); shownMoment = m.id; }   // a newer moment replaces the old tree
    $('ct-label').textContent = (m.why || 'moment') + ', ' + m.minute + "'";
    $('ct-routed').textContent = 'routed by ' + (m.routed_by || 'rules');
    $('ct-state').textContent = m.status === 'done' ? 'Moment done' : '';
    var byId = {}, fresh = [], failed = [];
    m.agents.forEach(function (a) { byId[a.id] = a; });
    Object.keys(nodes).forEach(function (id) {      // prune nodes the state no longer has
      if (!byId[id]) { nodes[id].li.remove(); delete nodes[id]; delete lastStatus[id]; }
    });
    m.agents.forEach(function (a, i) {
      var n = nodes[a.id];
      if (!n) { n = nodes[a.id] = make(); fresh.push(a.role || a.id); }
      var st = statusOf(a, m);
      if (st === 'failed' && lastStatus[a.id] !== 'failed') failed.push(a.role || a.id);
      lastStatus[a.id] = st;
      n.d.setAttribute('data-agent-id', a.id);
      n.d.setAttribute('data-status', st);
      if (a.parent) n.d.setAttribute('data-parent', a.parent); else n.d.removeAttribute('data-parent');
      n.d.firstChild.textContent = a.role || a.id;
      n.d.lastChild.textContent = LABELS[st] || 'status: ' + st;
      n.li.hidden = !expanded && i >= CAP;
    });
    m.agents.forEach(function (a) {       // attach under the parent (or the root list)
      var n = nodes[a.id], pid = parentOf(a, byId), p = pid && nodes[pid], host;
      if (p) { if (!p.kids) { p.kids = document.createElement('ul'); p.kids.setAttribute('role', 'list'); p.li.appendChild(p.kids); } host = p.kids; } else host = $('ct-root');
      if (n.li.parentNode !== host) host.appendChild(n.li);
    });
    Object.keys(nodes).forEach(function (id) {    // no empty child lists (they drew a stripe)
      var n = nodes[id];
      if (n.kids && !n.kids.childElementCount) { n.kids.remove(); n.kids = null; }
    });
    var extra = Math.max(0, m.agents.length - CAP), more = $('ct-more');
    more.hidden = !extra;
    more.setAttribute('aria-expanded', String(expanded));
    more.textContent = expanded ? 'Show fewer' : '+' + extra + ' more';
    $('ct-tree').setAttribute('data-done', m.status === 'done' ? 'true' : 'false');
    if (fresh.length) say(fresh.join(', ') + ' joined the crew');
    if (failed.length) say(failed.join(', ') + ' failed');
    if (m.status === 'done' && !doneSaid[m.id]) { doneSaid[m.id] = true; say('Moment done'); }
  }

  C.subscribe(render);
})();
