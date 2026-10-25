/* Crew accuracy scoreboard (Experience lane, AB#442). Draws only CREW.state.score:
   {method, arms:{key:{accuracy, catch_rate, latency_ms, cost, n, precomputed?, run_id?}}}.
   Mounts into #crew-score when CREW.enabled (?crew=1). Labelled Simulated while CREW.state.simulated is true.
   No colour-only meaning: each arm has a name, a number and its own bar pattern; a table repeats the values. */
(function () {
  'use strict';
  var root = document.getElementById('crew-score');
  if (!root || !window.CREW || !CREW.enabled) return;

  var CSS = '#crew-score .cs-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:8px 0}' +
    '@media (max-width:700px){#crew-score .cs-grid{grid-template-columns:minmax(0,1fr)}}' +
    '#crew-score .cs-arm{background:var(--bg3);border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-width:0}' +
    '#crew-score .cs-arm h4{margin:0 0 4px;font-size:13px;overflow-wrap:anywhere}' +
    '#crew-score .cs-acc{font-size:28px;font-weight:800;line-height:1.1;display:block}' +
    '#crew-score .cs-acc small{font-size:12px;font-weight:600;color:var(--muted);margin-left:4px}' +
    '#crew-score .cs-bar{height:14px;border:1px solid var(--muted);border-radius:4px;background:var(--bg);overflow:hidden;margin:6px 0 8px}' +
    '#crew-score .cs-fill{height:100%;transition:width .5s ease;border-right:2px solid var(--text)}' +
    '#crew-score .cs-fill[data-pattern=solid]{background:#56B4E9}' +
    '#crew-score .cs-fill[data-pattern=stripes]{background:repeating-linear-gradient(45deg,#E69F00 0 5px,#0A1320 5px 7px)}' +
    '#crew-score .cs-fill[data-pattern=dots]{background:#CC79A7 radial-gradient(circle,#0A1320 1.5px,transparent 2px) 0 0/7px 7px}' +
    '#crew-score dl{display:grid;grid-template-columns:auto auto;justify-content:space-between;gap:2px 8px;margin:0;font-size:12px}' +
    '#crew-score dt{color:var(--muted)}#crew-score dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}' +
    '#crew-score .cs-badge{display:inline-block;font-size:12px;font-weight:700;border:1px solid var(--muted);border-radius:999px;padding:0 8px;margin:0 4px 4px 0}' +
    '#crew-score .cs-badge.sim{border-style:dashed;color:var(--warn)}#crew-score .cs-badge.pre{color:var(--accent)}' +
    '#crew-score details{font-size:12px}#crew-score summary{cursor:pointer;min-height:24px}' +
    '#crew-score .cs-tw{overflow-x:auto;max-width:100%}#crew-score table{border-collapse:collapse;width:100%;font-size:12px}' +
    '#crew-score th,#crew-score td{border-bottom:1px solid var(--line);padding:3px 6px;text-align:left}' +
    '@media (prefers-reduced-motion:reduce){#crew-score .cs-fill{transition:none}}';
  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  var PATTERN = { full_crew: 'solid', single_agent: 'stripes', crew_no_verifier: 'dots' };
  var PATTERN_NAME = { solid: 'solid bar', stripes: 'striped bar', dots: 'dotted bar' };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function pct(v) { return num(v) ? Math.round(v * 100) + '%' : 'n/a'; }
  function secs(v) { return num(v) ? (v / 1000).toFixed(1) + ' s' : 'n/a'; }
  function usd(v) { return num(v) ? '$' + (v < 0.1 ? v.toFixed(3) : v.toFixed(2)) : 'n/a'; }
  function lines(v) { return num(v) ? v + ' lines graded' : 'lines graded: n/a'; }

  function draw(S) {
    var sc = S.score;
    root.textContent = '';
    var sec = el('section', 'ag-panel');
    sec.setAttribute('aria-labelledby', 'cs-h');
    var h = el('h3', null, 'Accuracy scoreboard ');
    h.id = 'cs-h';
    sec.appendChild(h);
    if (S.simulated) sec.appendChild(el('span', 'cs-badge sim', 'Simulated'));
    if (!sc || !sc.arms) {
      sec.appendChild(el('p', 'muted', 'Waiting for graded lines. Each arm is graded against simulator truth.'));
      root.appendChild(sec);
      return;
    }
    var grid = el('div', 'cs-grid');
    var rows = [];
    CREW.ARMS.forEach(function (a) {
      var d = sc.arms[a.key];
      if (!d) return;
      var arm = el('article', 'cs-arm');
      arm.setAttribute('data-arm', a.key);
      arm.appendChild(el('h4', null, a.label));
      if (d.precomputed) arm.appendChild(el('span', 'cs-badge pre', 'Precomputed' + (d.run_id ? ' · ' + d.run_id : '')));
      var acc = el('span', 'cs-acc', pct(d.accuracy));
      arm.appendChild(acc);
      arm.appendChild(el('span', 'muted', 'accuracy vs simulator truth, ' + PATTERN_NAME[PATTERN[a.key]]));
      var bar = el('div', 'cs-bar');
      bar.setAttribute('aria-hidden', 'true');
      var fill = el('div', 'cs-fill');
      fill.setAttribute('data-pattern', PATTERN[a.key]);
      fill.style.width = num(d.accuracy) ? Math.max(0, Math.min(1, d.accuracy)) * 100 + '%' : '0%';
      bar.appendChild(fill);
      arm.appendChild(bar);
      var dl = el('dl');
      [['Catch rate', pct(d.catch_rate)], ['Latency', secs(d.latency_ms)], ['Cost per match', usd(d.cost)], ['Graded', lines(d.n)]].forEach(function (r) {
        dl.appendChild(el('dt', null, r[0]));
        dl.appendChild(el('dd', null, r[1]));
      });
      arm.appendChild(dl);
      grid.appendChild(arm);
      rows.push([a.label, pct(d.accuracy), pct(d.catch_rate), secs(d.latency_ms), usd(d.cost), num(d.n) ? String(d.n) : 'n/a', d.precomputed ? 'Precomputed' : (S.simulated ? 'Simulated' : 'Live')]);
    });
    sec.appendChild(grid);
    sec.appendChild(el('p', 'muted', 'Method: ' + (sc.method || 'not stated')));
    var det = el('details');
    det.appendChild(el('summary', null, 'Show as table'));
    var tw = el('div', 'cs-tw');
    var t = el('table');
    t.appendChild(el('caption', 'sr', 'Accuracy scoreboard values per arm'));
    var hr = el('tr');
    ['Arm', 'Accuracy', 'Catch rate', 'Latency', 'Cost per match', 'Lines graded', 'Source'].forEach(function (c) {
      var th = el('th', null, c); th.setAttribute('scope', 'col'); hr.appendChild(th);
    });
    var thead = el('thead'); thead.appendChild(hr); t.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      r.forEach(function (c, i) { var cell = el(i ? 'td' : 'th', null, c); if (!i) cell.setAttribute('scope', 'row'); tr.appendChild(cell); });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    tw.appendChild(t); det.appendChild(tw); sec.appendChild(det);
    root.appendChild(sec);
  }

  CREW.subscribe(draw);
})();
