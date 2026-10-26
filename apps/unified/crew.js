/* Crew data layer (Experience lane). Everything the crew panels draw comes through CREW.
   Flag: ON by default. Off with ?crew=0 (or localStorage mc-crew=0); the shell forwards crew=1 or crew=0 to the Watch iframe.
   CREW.play() feeds a Simulated fixture. CREW.ingest(frame) is the single place a real SSE adapter plugs in.
   crew_ledger / crew_spawn follow contract 1.3.0 (PR #379), onair / feed_drop contract 1.2.0; the scoreboard is a GET (fetchScore). Change the shapes here only. */
(function () {
  'use strict';
  // the page's own query first; the parent's is appended in its own try, so a cross-origin parent never hides ?crew=0 on this page (the same lines are inlined in embed/feedpick.js, langpick.js and democtl.js)
  var qs = location.search;
  try { if (window.parent !== window) qs += '&' + window.parent.location.search; } catch (e) { /* cross-origin parent */ }
  // default ON (judges add no query flag): ?crew=0 on the page or its parent, or localStorage mc-crew=0, turns it off; an explicit ?crew=1 beats a stored 0
  var on = !/[?&]crew=0(&|$)/.test(qs);
  try { if (on && !/[?&]crew=1(&|$)/.test(qs) && localStorage.getItem('mc-crew') === '0') on = false; } catch (e) { /* storage blocked: the default stands */ }

  // feed keys and labels from the Feeds lane registry (feeds/450); casual, analyst and catch_me_up (CREW-7.3, read on demand) are live
  var FEEDS = [
    { key: 'casual', label: 'Casual', live: true },
    { key: 'analyst', label: 'Analyst', live: true },
    { key: 'audio_description', label: 'Audio description', live: false },
    { key: 'catch_me_up', label: 'Catch me up', live: true },
    { key: 'half_time', label: 'Half-time explainer', live: false },
    { key: 'ticker', label: 'News ticker', live: false }
  ];
  var ARMS = [
    { key: 'full_crew', label: 'Full crew' },
    { key: 'single_agent', label: 'Single agent' },
    { key: 'crew_no_verifier', label: 'Crew without Verifier' }
  ];

  var S = {
    simulated: true,            // true while the data is the fixture, not the api
    moments: [],                // {id, minute, why, routed_by, status, agents:[{id,role,parent,status,t0,t1}], claims:[claim]}
    feeds: {},                  // key -> [{publication_id, text, match_time_ms, source_event_ids, verdict, lang, repair_count, claim_ids, aired_at, translations?}]
    lines: [],                  // claim entries (aired or dropped) for frames that carry no moment_id
    score: null,                // {arms:{key:{accuracy,catch_rate,latency_ms,cost,n,precomputed?,run_id?}}, method}
    scoreSource: null,          // 'fixture' (Simulated) or 'api' (the real GET /v1/matches/{id}/scoreboard)
    scoreNote: ''               // shown instead of the scoreboard when the api has none yet
  };
  FEEDS.forEach(function (f) { S.feeds[f.key] = []; });
  var subs = [];
  function emit() { subs.forEach(function (fn) { try { fn(S); } catch (e) { console.error(e); } }); }

  function moment(id, stream) {   // keyed by stream + moment_id when the frame has a stream, by id alone otherwise
    for (var i = 0; i < S.moments.length; i++) if (S.moments[i].id === id && (!stream || !S.moments[i].stream || S.moments[i].stream === stream.key)) {
      var f = S.moments[i];
      if (stream && !f.stream) { f.stream = stream.key; f.match_id = stream.match; }   // a moment first seen without a stream adopts the first stream that names it
      return f;
    }
    var m = { id: id, minute: 0, why: '', routed_by: 'rules', status: 'open', agents: [], claims: [] };
    if (stream) { m.stream = stream.key; m.match_id = stream.match; }
    S.moments.push(m);
    return m;
  }

  var SHOW = ':show';           // id suffix of a moment's Showrunner node
  var TERMINAL = { done: 1, failed: 1, no_data: 1, budget_exhausted: 1 };
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function minuteOf(ms) { return Math.floor((+ms || 0) / 60000); }
  function idOf(v) { return typeof v === 'string' && v ? v : (typeof v === 'number' && isFinite(v) ? String(v) : null); }
  /* a frame's stream identity {tenant_id, session_id, match_id} (contract 1.3.0): the key is all three, so two sessions of one match stay apart */
  function streamOf(v) {
    if (!obj(v) || !idOf(v.match_id)) return null;
    return { key: [idOf(v.tenant_id) || '', idOf(v.session_id) || '', idOf(v.match_id)].join('/'), match: idOf(v.match_id) };
  }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function strs(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : []; }
  function showrunner(m) {
    var id = m.id + SHOW;
    for (var i = 0; i < m.agents.length; i++) if (m.agents[i].id === id) return m.agents[i];
    var a = { id: id, role: 'Showrunner', parent: null, status: 'running' };
    m.agents.unshift(a);
    return a;
  }
  // merge a frame's fields into an existing item: an omitted (undefined) field never erases a value already held
  function merge(dst, src) { Object.keys(src).forEach(function (k) { if (src[k] !== undefined) dst[k] = src[k]; }); }
  function upsert(list, item) {
    for (var i = 0; i < list.length; i++) if (list[i].id === item.id) { merge(list[i], item); return list[i]; }
    list.push(item);
    return item;
  }

  /* PROPOSAL shapes (AB#498). Each handler validates first and returns an apply function, or null for a malformed frame:
     nothing is touched until the whole frame is known good. */
  /* crew_ledger (contract 1.3.0): kind, schema_version, stream, moment_id, at_ms, called, skipped, why, routed_by (rules|model|fallback). One per moment, after its run ends. */
  function ledger(f) {
    var id = idOf(f.moment_id);
    if (!id) return null;
    return function () {
      var m = moment(id, streamOf(f.stream));
      m.minute = minuteOf(f.at_ms); m.why = typeof f.why === 'string' ? f.why : m.why; m.routed_by = typeof f.routed_by === 'string' ? f.routed_by : m.routed_by;
      m.called = strs(f.called); m.skipped = strs(f.skipped);
      if (typeof f.spawn_reason === 'string' && f.spawn_reason) m.spawn_reason = f.spawn_reason.slice(0, 200);   // why the planner spawned no specialists (the rundown entry's spawn_reason)
      m.status = 'done';          // sent once the run ends, so the moment is over
      var sh = showrunner(m);
      if (sh.status === 'running') sh.status = 'done';
    };
  }
  /* crew_spawn (contract 1.3.0): kind, schema_version, stream, moment_id, spawn_id, agent_id, role, parent_id, status, started_ms, ended_ms, tokens, why.
     No at_ms: the minute comes from started_ms. One per specialist per status change. The raw status is kept (running, done, no_data, failed, budget_exhausted);
     a terminal status never goes back to running on a late or duplicate frame. */
  function spawn(f) {
    var mid = idOf(f.moment_id), sid = idOf(f.spawn_id);
    if (!mid || !sid) return null;
    return function () {
      var m = moment(mid, streamOf(f.stream));
      if (!m.minute && f.started_ms != null) m.minute = minuteOf(f.started_ms);
      var sh = showrunner(m), pid = idOf(f.parent_id);
      var a = { id: sid, role: idOf(f.role) || idOf(f.agent_id) || undefined, parent: !pid || pid === 'showrunner' ? sh.id : pid,
        status: typeof f.status === 'string' ? f.status : 'running', started: f.started_ms, ended: f.ended_ms, tokens: f.tokens, why: f.why || undefined };
      var old = m.agents.filter(function (x) { return x.id === sid; })[0];
      if (old && TERMINAL[old.status] && !TERMINAL[a.status]) { delete a.status; delete a.ended; }
      if (a.tokens == null) delete a.tokens;
      if (!old) { if (!a.role) a.role = sid; if (a.ended === undefined) a.ended = null; if (a.tokens === undefined) a.tokens = 0; }
      upsert(m.agents, a);
    };
  }
  /* onair / feed_drop: the FINAL contract 1.2.0 records (docs/contracts.md, "Derived feed lines"), not a proposal.
     onair: one verified derived-feed line that aired, so it carries the verdict 'verified' by contract. A translated row (another lang) shares the
     publication_id and is kept under the English row's translations; it never edits the English text and is ignored if no English row exists.
     feed_drop: a line that did not air. Only the reason and audit_id are kept: the text stays in the audit chain and is never stored here.
     The frames name no moment, so these claim entries go in the flat S.lines (newest 200 kept); moment claims stay empty. */
  var LINES_CAP = 200, PENDING_CAP = 100, pending = Object.create(null);   // translated rows that arrived before their English row
  function feedOk(v) { return typeof v === 'string' && has(S.feeds, v); }
  function note(f, entry) {
    var list = S.lines;
    var old = list.filter(function (x) { return x.id === entry.id; })[0];
    if (old && old.verdict === 'verified' && entry.verdict === 'dropped') return;   // an aired line stays aired
    if (old && entry.verdict === 'verified') { Object.keys(old).forEach(function (k) { delete old[k]; }); Object.assign(old, entry); return; }
    upsert(list, entry);
    if (list.length > LINES_CAP) list.splice(0, list.length - LINES_CAP);
  }
  function onair(f) {
    var pid = idOf(f.publication_id), src = strs(f.source_event_ids);
    if (!pid || !feedOk(f.feed) || typeof f.text !== 'string' || !Array.isArray(f.source_event_ids) || !src.length || src.length !== f.source_event_ids.length) return null;
    var lang = typeof f.lang === 'string' && f.lang ? f.lang : 'en';
    return function () {
      var list = S.feeds[f.feed], k = -1;
      list.forEach(function (x, j) { if (x.publication_id === pid) k = j; });
      if (lang !== 'en') {   // a translated row: attach to the English line, never replace it; one that comes first waits for its English row
        if (k >= 0) { list[k].translations = list[k].translations || {}; list[k].translations[lang] = f.text; }
        else {
          var pk = f.feed + '|' + pid;
          if (!has(pending, pk)) { if (Object.keys(pending).length >= PENDING_CAP) delete pending[Object.keys(pending)[0]]; pending[pk] = Object.create(null); }
          pending[pk][lang] = f.text;
        }
        return;
      }
      var line = { publication_id: pid, text: f.text, match_time_ms: f.match_time_ms, source_event_ids: src, verdict: 'verified', lang: 'en',
        repair_count: f.repair_count, claim_ids: Array.isArray(f.claim_ids) ? strs(f.claim_ids) : undefined, aired_at: f.aired_at };
      var pk2 = f.feed + '|' + pid;
      if (has(pending, pk2)) { line.translations = Object.assign({}, pending[pk2]); delete pending[pk2]; }
      if (k < 0) list.push(line);
      else { if (list[k].translations) line.translations = Object.assign({}, list[k].translations, line.translations); merge(list[k], line); }
      note(f, { id: pid, verdict: 'verified', state: 'aired', feed: f.feed, text: f.text, sources: src, claim_ids: Array.isArray(f.claim_ids) ? strs(f.claim_ids) : undefined, repair_count: f.repair_count, aired_at: f.aired_at });
    };
  }
  function feedDrop(f) {
    var pid = idOf(f.publication_id);
    if (!pid || !feedOk(f.feed) || typeof f.reason_code !== 'string' || !f.reason_code) return null;
    return function () {
      note(f, { id: pid, verdict: 'dropped', state: 'dropped', feed: f.feed, reason: f.reason_code, audit_id: idOf(f.audit_id) || undefined, repair_count: f.repair_count, sources: strs(f.source_event_ids) });
    };
  }
  var REAL = Object.create(null);
  REAL.crew_ledger = ledger; REAL.crew_spawn = spawn; REAL.onair = onair; REAL.feed_drop = feedDrop;
  var fixtureLoaded = false;

  /* frame kinds: crew_ledger, crew_spawn (1.3.0), onair, feed_drop (final contract 1.2.0) and the older fixture kinds moment, spawn, claim, publish, score.
     opts.simulated marks the fixture's own crew_* frames, which must not clear S.simulated. Inert while the flag is off.
     Never throws: a malformed frame is skipped whole. */
  function ingest(f, opts) {
    if (!on || !obj(f) || typeof f.kind !== 'string') return;
    try {
      if (REAL[f.kind]) {
        var apply = REAL[f.kind](f);
        if (!apply) return;
        if (!(opts && opts.simulated) && S.simulated) {
          S.simulated = false;      // the first valid real frame: from here the data is not the fixture
          if (fixtureLoaded) { stop(); resetData(); }   // drop fixture moments, lines and score so none shows under a real label
        }
        apply();
      } else if (f.kind === 'moment') Object.assign(moment(f.id), f.data || {});
      else if (f.kind === 'spawn') {
        var m = moment(f.moment), a = m.agents.filter(function (x) { return x.id === f.agent.id; })[0];
        if (a) Object.assign(a, f.agent); else m.agents.push(Object.assign({ status: 'running' }, f.agent));
      } else if (f.kind === 'claim') {
        var mm = moment(f.moment), c = mm.claims.filter(function (x) { return x.id === f.claim.id; })[0];
        if (c) Object.assign(c, f.claim); else mm.claims.push(f.claim);
      } else if (f.kind === 'publish') {
        (S.feeds[f.feed] = S.feeds[f.feed] || []).push(f.line);
      } else if (f.kind === 'score') { S.score = f.score; S.scoreSource = 'fixture'; S.scoreNote = ''; }
      else return;
    } catch (e) { console.warn('CREW.ingest skipped a malformed ' + f.kind + ' frame'); return; }
    emit();
  }

  /* A Simulated goal moment: Showrunner fans out, one Stats line is wrong, Verifier catches it, repair airs. */
  function fixtureGoal(minute) {
    var id = 'm-' + minute, ms = minute * 60000, steps = [], ev = 'e-' + minute + '-1';
    function at(t, f) { steps.push([t, f]); }
    var base = { schema_version: '1.3.0', stream: { tenant_id: 'demo', session_id: 'sim', match_id: 'sim' }, moment_id: id };
    function sp(t, role, status, why) {
      at(t, Object.assign({ kind: 'crew_spawn', spawn_id: id + ':' + role, agent_id: role, role: role, parent_id: 'showrunner', status: status,
        started_ms: ms, ended_ms: status === 'running' ? null : ms + t, tokens: 0, why: why || '' }, base));
    }
    function oa(t, o) {   // the fixture airs through onair
      at(t, Object.assign({ kind: 'onair', lang: 'en', source_event_ids: [ev], claim_ids: [], match_time_ms: ms, aired_at: 'sim', repair_count: 0 }, o));
    }
    var roles = ['Analyst', 'Stats Researcher', 'History', 'Replay', 'Narrator'];
    roles.forEach(function (r, i) { sp(400 + i * 250, r, 'running'); });
    // the Stats line is wrong: the Verifier catches it and the line airs after its single repair (repair_count 1). A dropped first attempt is
    // not how the contract works for booth lines, so no feed_drop is simulated here.
    oa(3800, { publication_id: id + ':L2', feed: 'casual', text: 'GOAL! Second shot on target and it counts.', claim_ids: [id + ':c2'], repair_count: 1 });
    oa(4100, { publication_id: id + ':L3', feed: 'analyst', text: 'Second shot on target, first goal; xG 0.31.', claim_ids: [id + ':c3'] });
    roles.forEach(function (r, i) { sp(4300 + i * 20, r, 'done'); });
    at(4600, Object.assign({ kind: 'crew_ledger', at_ms: ms, called: ['analyst', 'narrator', 'verifier'], skipped: [], why: 'goal', routed_by: 'rules' }, base));
    at(4600, { kind: 'score', score: { method: 'Simulated fixture', arms: {
      full_crew: { accuracy: 0.99, catch_rate: 1, latency_ms: 2100, cost: 0.011, n: 30 },
      single_agent: { accuracy: 0.9, catch_rate: 0, latency_ms: 1300, cost: 0.004, n: 30 },
      crew_no_verifier: { accuracy: 0.93, catch_rate: 0, latency_ms: 1800, cost: 0.009, n: 30 } } } });
    return steps;
  }

  /* The scoreboard is a GET, not a frame (contract 1.3.0): /v1/matches/{match_id}/scoreboard, the dict of grading.scoreboard().
     Its arms nest their figures ({accuracy:{wrong_rate}, catch_rate:{rate}, latency_ms:{p50}, lines_aired}); a flat number is taken as is.
     Cost stays n/a: the api states model calls and no price. The data is real, so it carries no Simulated badge. */
  function fin(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function mapScore(j) {
    if (!obj(j) || !obj(j.arms)) return null;
    var arms = {}, any = false;
    ARMS.forEach(function (a) {
      var d = j.arms[a.key];
      if (!obj(d)) return;
      var acc = fin(d.accuracy), cr = fin(d.catch_rate), lat = fin(d.latency_ms);
      if (acc === null && obj(d.accuracy) && fin(d.accuracy.wrong_rate) !== null) acc = 1 - d.accuracy.wrong_rate;
      if (cr === null && obj(d.catch_rate)) cr = fin(d.catch_rate.rate);
      if (lat === null && obj(d.latency_ms)) lat = fin(d.latency_ms.p50);
      var n = fin(d.n); if (n === null) n = fin(d.lines_aired);
      arms[a.key] = { accuracy: acc, catch_rate: cr, latency_ms: lat, cost: fin(d.cost), n: n };
      if (typeof d.mode === 'string') arms[a.key].mode = d.mode;
      if (d.precomputed === true || d.mode === 'precomputed') arms[a.key].precomputed = true;
      if (typeof d.run_id === 'string' && d.run_id) arms[a.key].run_id = d.run_id;
      any = true;
    });
    if (!any) return null;
    var method = typeof j.method === 'string' && j.method ? j.method : 'Accuracy is the share of aired numbers that were right, graded against simulator truth (rules-mode arms)' + (typeof j.run_date === 'string' ? ', run ' + j.run_date : '') + (fin(j.seed) !== null ? ', seed ' + j.seed : '');
    if (obj(j.difference) && typeof j.difference.note === 'string') method += '. ' + j.difference.note;
    return { method: method, arms: arms };
  }
  var scoreBusy = false, scoreFor = '', noteFor = '', gen = 0, NOTE_404 = 'The scoreboard is not available yet. It appears once the api has graded lines for this match.';
  function keyOf(lv) { var k = lv && lv.key; return k && k.match_id ? [k.session_id || '', k.match_id].join('/') : ''; }
  function dropApiScore() {   // the api score belongs to one match and session
    if (S.scoreSource === 'api') { S.score = null; S.scoreSource = null; S.scoreNote = ''; scoreFor = ''; emit(); }
  }
  function fetchScore() {
    if (!on || scoreBusy || fixtureLoaded) return Promise.resolve(false);
    var lv = typeof LV !== 'undefined' ? LV : null, key = lv && lv.key, base = lv && lv.base;
    if (!base || !key || !key.match_id) return Promise.resolve(false);
    var asked = keyOf(lv), g = gen, opts = { headers: { Accept: 'application/json' }, cache: 'no-store' };
    var stale = function () { return g !== gen || asked !== keyOf(typeof LV !== 'undefined' ? LV : null) || fixtureLoaded; };   // a reset, another match or the fixture took over while it was in flight
    try { if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(8000); } catch (e) { /* no timeout support */ }
    scoreBusy = true;
    var req;
    try { req = fetch(base + '/v1/matches/' + encodeURIComponent(key.match_id) + '/scoreboard?' + new URLSearchParams({ session_id: key.session_id }), opts)
      .then(function (res) {
        if (stale()) return false;
        if (res.status === 404) {   // keep the last good score; the note only matters while there is none, and only a changed note emits
          if (!S.score) { noteFor = asked; if (S.scoreNote !== NOTE_404) { S.scoreNote = NOTE_404; emit(); } }
          return false;
        }
        if (!res.ok) return false;
        return res.json().then(function (j) {
          var sc = mapScore(j);
          if (!sc || stale()) return false;
          S.score = sc; S.scoreSource = 'api'; S.scoreNote = ''; scoreFor = asked; emit();
          return true;
        });
      }); } catch (e) { scoreBusy = false; return Promise.resolve(false); }
    return req.catch(function () { return false; }).then(function (ok) { scoreBusy = false; return ok; });
  }
  var lastPoll = 0, lastKey = '';
  function pollScore() {   // gently: at most one GET per interval, only while the api match is live
    var lv = typeof LV !== 'undefined' ? LV : null;
    if (S.scoreSource === 'api' && keyOf(lv) !== scoreFor) dropApiScore();   // a new match or session
    var k = keyOf(lv);
    if (S.scoreNote && !S.score && k !== noteFor) { S.scoreNote = ''; noteFor = ''; emit(); }   // the note belongs to the match that was asked
    if (k !== lastKey) { lastKey = k; lastPoll = 0; }   // a new match polls at once
    if (!lv || !lv.key || lv.status !== 'live') { lastPoll = 0; return; }
    if (document.visibilityState === 'hidden' || (typeof current !== 'undefined' && current !== 'agents')) return;   // the scoreboard lives in the Agents tab (the Crew button opens it): no GET while it is not on screen
    var gap = +window.MATCHCAST_SCORE_MS || 15000, now = Date.now();
    if (lastPoll && now - lastPoll < gap) return;
    lastPoll = now;
    fetchScore();
  }
  if (on) setInterval(pollScore, 1000);

  /* CREW-7.3 catch-me-up. Asked only when the viewer picks the feed or presses Update (never polled). One GET at a time; a second ask inside the gap
     (MATCHCAST_CATCHUP_MS, default 5 s) gets the last answer; after a 429 nothing is sent until the api's Retry-After has passed. LV.catchMeUp does the GET. */
  function freshCu(k) { return { key: k, rec: null, at: 0, until: 0, busy: null, busyLang: '', gen: 0, want: null, timer: 0, pend: null }; }
  var cu = freshCu('');
  var NONE = function (m, l) { return { state: 'none', minute: m, lang: l }; };
  // One generation counter per match. A queued follow-up (a language asked while the gap or another language's read was in the way) is one pending ask, one wanted {minute, lang} and one timer.
  // supersede() drops all three and bumps the generation, so every continuation still attached (the timer, a .then on the in-flight read) sees a stale generation and returns; the dropped ask's promise is always settled.
  function supersede(c) {
    c.gen++;
    if (c.timer) clearTimeout(c.timer);
    c.timer = 0; c.want = null;
    var p = c.pend; c.pend = null;
    if (p) p.res(c.rec || NONE(0, 'en'));
  }
  function cancelWait() { supersede(cu); }   // the viewer left the feed, or Watch reloaded
  function queue(m, l) {
    var c = cu, gen = c.gen, gap = typeof window.MATCHCAST_CATCHUP_MS === 'number' ? window.MATCHCAST_CATCHUP_MS : 5000;
    c.want = { minute: m, lang: l };   // the latest ask wins
    if (c.pend) return c.pend.promise;
    var p = { res: null, promise: null };
    p.promise = new Promise(function (res) { p.res = res; });
    c.pend = p;
    function fire() {
      c.timer = 0;
      if (gen !== c.gen || c !== cu || c.pend !== p) return;
      var w = c.want; c.want = null; c.pend = null;
      if (!w || keyOf(typeof LV !== 'undefined' ? LV : null) !== c.key) { p.res(c.rec || NONE(m, l)); return; }   // nothing wanted any more, or another match
      catchUp(w.minute, w.lang).then(p.res, function () { p.res({ state: 'error', minute: w.minute, lang: w.lang }); });
    }
    function arm() {
      if (gen !== c.gen || c !== cu || c.pend !== p) return;
      if (c.timer) clearTimeout(c.timer);
      c.timer = setTimeout(fire, Math.max(0, gap - (Date.now() - c.at)) + 1);
    }
    if (c.busy) c.busy.then(arm, arm); else arm();
    return p.promise;
  }
  function catchUp(minute, lng) {
    var lv = typeof LV !== 'undefined' ? LV : null, k = keyOf(lv), m = Math.max(0, Math.min(200, Math.floor(+minute) || 0)), l = lng || 'en';
    if (!on || !lv || typeof lv.catchMeUp !== 'function') return Promise.resolve(NONE(m, l));
    if (cu.key !== k) { supersede(cu); cu = freshCu(k); }   // another match or session: the old recap and any waiting read are not this one's
    var now = Date.now();
    if (cu.busy) {
      if (cu.busyLang === l) { supersede(cu); return cu.busy; }
      return queue(m, l);   // the read in flight is for another language: ask again in this one when it lands
    }
    if (cu.until > now) return Promise.resolve({ state: 'limited', minute: m, lang: l, wait_s: Math.ceil((cu.until - now) / 1000) });
    var gap = typeof window.MATCHCAST_CATCHUP_MS === 'number' ? window.MATCHCAST_CATCHUP_MS : 5000;
    if (cu.rec && now - cu.at < gap) {
      if ((cu.rec.lang || 'en') === l) { supersede(cu); return Promise.resolve(cu.rec); }
      return queue(m, l);
    }
    supersede(cu);   // a read now makes any waiting one obsolete
    var mine = cu;
    cu.at = now; cu.busyLang = l;
    cu.busy = lv.catchMeUp(m, l).then(function (rec) {
      if (mine !== cu) return rec;   // the match changed while it was in flight: do not keep it
      cu.busy = null;
      if (rec.state === 'none') { cu.at = 0; return rec; }   // no api or no match yet: ask again freely
      cu.rec = rec;
      if (rec.state === 'limited') cu.until = Date.now() + rec.wait_s * 1000;
      return rec;
    }, function () { if (mine === cu) cu.busy = null; return { state: 'error', minute: m, lang: l }; });
    return cu.busy;
  }

  var timers = [];
  function play(minute) {
    stop();
    resetData(); S.simulated = true; fixtureLoaded = true; emit();   // never merge fixture lines with real data
    // the fixture goes through the same ingest path as real frames; opts.simulated keeps S.simulated true
    fixtureGoal(minute || 23).forEach(function (s) { timers.push(setTimeout(function () { ingest(s[1], { simulated: true }); }, s[0])); });
  }
  function stop() { timers.forEach(clearTimeout); timers = []; }
  function resetData() { S.moments = []; S.lines = []; FEEDS.forEach(function (f) { S.feeds[f.key] = []; }); S.score = null; S.scoreSource = null; S.scoreNote = ''; scoreFor = ''; noteFor = ''; gen++; pending = Object.create(null); fixtureLoaded = false; }
  function reset() { stop(); resetData(); emit(); }

  window.CREW = {
    enabled: on, FEEDS: FEEDS, ARMS: ARMS, state: S,
    subscribe: function (fn) { subs.push(fn); fn(S); return function () { subs = subs.filter(function (x) { return x !== fn; }); }; },
    ingest: ingest, fetchScore: fetchScore, catchUp: catchUp, catchCancel: function () { cancelWait(); }, get playing() { return fixtureLoaded; }, play: play, stop: stop, reset: reset
  };
})();
