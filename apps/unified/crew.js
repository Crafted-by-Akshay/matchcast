/* Crew data layer (Experience lane). Everything the crew panels draw comes through CREW.
   Flag: ?crew=1 (or localStorage mc-crew=1). Off by default until the orchestration frames merge.
   CREW.play() feeds a Simulated fixture. CREW.ingest(frame) is the single place a real SSE adapter plugs in.
   The crew_ledger / crew_spawn / crew_trace adapter below follows a PROPOSAL (vision/interfaces/crew-frames-proposal.md):
   nothing emits those frames yet and names may change before AB#498. Change the shapes here only. */
(function () {
  'use strict';
  var qs = '';
  try { qs = location.search + '&' + ((window.parent !== window && window.parent.location.search) || ''); } catch (e) { /* cross-origin */ }
  var on = /[?&]crew=1/.test(qs);
  try { if (!on && localStorage.getItem('mc-crew') === '1') on = true; } catch (e) { /* storage blocked */ }

  // feed keys and labels from the Feeds lane registry (feeds/450); only casual and analyst are live
  var FEEDS = [
    { key: 'casual', label: 'Casual', live: true },
    { key: 'analyst', label: 'Analyst', live: true },
    { key: 'audio_description', label: 'Audio description', live: false },
    { key: 'catch_me_up', label: 'Catch me up', live: false },
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
    feeds: {},                  // key -> [{publication_id, text, match_time_ms, source_event_ids}]
    score: null                 // {arms:{key:{accuracy,catch_rate,latency_ms,cost,n}}, method}
  };
  FEEDS.forEach(function (f) { S.feeds[f.key] = []; });
  var subs = [];
  function emit() { subs.forEach(function (fn) { try { fn(S); } catch (e) { console.error(e); } }); }

  function moment(id) {
    for (var i = 0; i < S.moments.length; i++) if (S.moments[i].id === id) return S.moments[i];
    var m = { id: id, minute: 0, why: '', routed_by: 'rules', status: 'open', agents: [], claims: [] };
    S.moments.push(m);
    return m;
  }

  var SHOW = ':show';           // id suffix of a moment's Showrunner node
  function minuteOf(ms) { return Math.floor((+ms || 0) / 60000); }
  function showrunner(m) {
    var id = m.id + SHOW;
    for (var i = 0; i < m.agents.length; i++) if (m.agents[i].id === id) return m.agents[i];
    var a = { id: id, role: 'Showrunner', parent: null, status: 'running' };
    m.agents.unshift(a);
    return a;
  }
  function upsert(list, item) {
    for (var i = 0; i < list.length; i++) if (list[i].id === item.id) { Object.assign(list[i], item); return; }
    list.push(item);
  }
  function seen(m, f) { if (!m.minute && f.at_ms != null) m.minute = minuteOf(f.at_ms); }
  function reasonOf(f) { return f.verifier && f.verifier.reason_code || null; }

  /* PROPOSAL shapes (AB#498). crew_ledger: one per moment, after its run ends. */
  function ledger(f) {
    var m = moment(f.moment_id);
    m.minute = minuteOf(f.at_ms); m.why = f.why || m.why; m.routed_by = f.routed_by || m.routed_by;
    m.called = f.called || []; m.skipped = f.skipped || [];
    m.status = 'done';          // sent once the run ends, so the moment is over
    var sh = showrunner(m);
    if (sh.status === 'running') sh.status = 'done';
  }
  /* crew_spawn: one per specialist per status change. The raw status is kept (running, done, no_data, failed, budget_exhausted). */
  function spawn(f) {
    var m = moment(f.moment_id); seen(m, f);
    var sh = showrunner(m);
    var parent = !f.parent_id || f.parent_id === 'showrunner' ? sh.id : f.parent_id;
    var a = { id: f.spawn_id, role: f.role || f.agent_id, parent: parent, status: f.status || 'running', started: f.started_ms, ended: f.ended_ms, tokens: f.tokens || 0 };
    for (var i = 0; i < m.agents.length; i++) if (m.agents[i].id === a.id && !f.why) a.why = m.agents[i].why;   // an empty why keeps the earlier one
    if (f.why) a.why = f.why;
    upsert(m.agents, a);
  }
  /* crew_trace: one per line at a terminal state. Every claim is recorded; only published derived-feed lines air. */
  function trace(f) {
    var m = moment(f.moment_id); seen(m, f);
    var v = f.verifier || {}, reason = reasonOf(f);
    var base = { verdict: v.verdict, reason: reason, repair_of: f.repair_of || null, audit_hash: f.audit_hash, state: f.state, line_id: f.line_id, feed: f.feed };
    if (f.text != null) base.text = f.text;     // a dropped line has no text
    var cs = f.claims && f.claims.length ? f.claims : [{ claim_id: f.line_id }];   // a line with no claims still records its reason
    cs.forEach(function (c) {
      upsert(m.claims, Object.assign({ id: c.claim_id, sources: c.source_event_ids || [], history: c.history_row_ids || [], metric: c.metric, value: c.value }, base));
    });
    if (f.state === 'published' && f.text != null && S.feeds[f.feed]) {
      var line = { publication_id: f.line_id, text: f.text, match_time_ms: f.at_ms, source_event_ids: [].concat.apply([], (f.claims || []).map(function (c) { return c.source_event_ids || []; })), verdict: v.verdict };
      var list = S.feeds[f.feed], k = -1;
      list.forEach(function (x, i) { if (x.publication_id === line.publication_id) k = i; });
      if (k < 0) list.push(line); else list[k] = line;
    }
  }
  var REAL = { crew_ledger: ledger, crew_spawn: spawn, crew_trace: trace };
  var fixtureLoaded = false;

  /* frame kinds: crew_ledger, crew_spawn, crew_trace (proposal) and the older fixture kinds moment, spawn, claim, publish, score.
     opts.simulated marks the fixture's own crew_* frames, which must not clear S.simulated. */
  function ingest(f, opts) {
    if (!f || !f.kind) return;
    if (REAL[f.kind]) {
      if (!(opts && opts.simulated) && S.simulated) {
        S.simulated = false;      // the first real frame: from here the data is not the fixture
        if (fixtureLoaded) { stop(); resetData(); }   // drop fixture moments, lines and score so none shows under a real label
      }
      REAL[f.kind](f);
    } else if (f.kind === 'moment') Object.assign(moment(f.id), f.data || {});
    else if (f.kind === 'spawn') {
      var m = moment(f.moment), a = m.agents.filter(function (x) { return x.id === f.agent.id; })[0];
      if (a) Object.assign(a, f.agent); else m.agents.push(Object.assign({ status: 'running' }, f.agent));
    } else if (f.kind === 'claim') {
      var mm = moment(f.moment), c = mm.claims.filter(function (x) { return x.id === f.claim.id; })[0];
      if (c) Object.assign(c, f.claim); else mm.claims.push(f.claim);
    } else if (f.kind === 'publish') {
      (S.feeds[f.feed] = S.feeds[f.feed] || []).push(f.line);
    } else if (f.kind === 'score') S.score = f.score;
    emit();
  }

  /* A Simulated goal moment: Showrunner fans out, one Stats line is wrong, Verifier catches it, repair airs. */
  function fixtureGoal(minute) {
    var id = 'm-' + minute, ms = minute * 60000, steps = [], ev = 'e-' + minute + '-1';
    function at(t, f) { steps.push([t, f]); }
    var base = { match_id: 'sim', moment_id: id };
    function sp(t, role, status, why) {
      at(t, Object.assign({ kind: 'crew_spawn', at_ms: ms + t, spawn_id: id + ':' + role, agent_id: role, role: role, parent_id: 'showrunner', status: status,
        started_ms: ms, ended_ms: status === 'running' ? null : ms + t, tokens: 0, why: why || '' }, base));
    }
    function tr(t, o) {
      at(t, Object.assign({ kind: 'crew_trace', at_ms: ms, called: ['analyst', 'narrator', 'verifier'], audit_hash: 'sim:' + o.line_id }, base, o));
    }
    var roles = ['Analyst', 'Stats Researcher', 'History', 'Replay', 'Narrator'];
    roles.forEach(function (r, i) { sp(400 + i * 250, r, 'running'); });
    // the Stats line is wrong: the Verifier drops it, the repair airs (the dropped line carries its reason, not its text)
    tr(2400, { line_id: id + ':L1', feed: 'casual', state: 'dropped', claims: [{ claim_id: id + ':c1', metric: 'shots_on_target:home', value: 3, source_event_ids: [ev], history_row_ids: [] }],
      verifier: { verdict: 'rejected', reason_code: 'number_mismatch', checks: ['numbers'] } });
    tr(3800, { line_id: id + ':L2', feed: 'casual', state: 'published', repair_of: id + ':L1', text: 'GOAL! Second shot on target and it counts.',
      claims: [{ claim_id: id + ':c2', metric: 'shots_on_target:home', value: 2, source_event_ids: [ev], history_row_ids: [] }],
      verifier: { verdict: 'verified', reason_code: null, checks: ['numbers', 'names'] } });
    tr(4100, { line_id: id + ':L3', feed: 'analyst', state: 'published', text: 'Second shot on target, first goal; xG 0.31.',
      claims: [{ claim_id: id + ':c3', metric: 'xg:home', value: 0.31, source_event_ids: [ev], history_row_ids: [] }],
      verifier: { verdict: 'verified', reason_code: null, checks: ['numbers'] } });
    roles.forEach(function (r, i) { sp(4300 + i * 20, r, 'done'); });
    at(4600, Object.assign({ kind: 'crew_ledger', at_ms: ms, called: ['analyst', 'narrator', 'verifier'], skipped: [], why: 'goal', routed_by: 'rules' }, base));
    at(4600, { kind: 'score', score: { method: 'Simulated fixture', arms: {
      full_crew: { accuracy: 0.99, catch_rate: 1, latency_ms: 2100, cost: 0.011, n: 30 },
      single_agent: { accuracy: 0.9, catch_rate: 0, latency_ms: 1300, cost: 0.004, n: 30 },
      crew_no_verifier: { accuracy: 0.93, catch_rate: 0, latency_ms: 1800, cost: 0.009, n: 30 } } } });
    return steps;
  }

  var timers = [];
  function play(minute) {
    stop();
    S.simulated = true; fixtureLoaded = true;
    // the fixture goes through the same ingest path as real frames; opts.simulated keeps S.simulated true
    fixtureGoal(minute || 23).forEach(function (s) { timers.push(setTimeout(function () { ingest(s[1], { simulated: true }); }, s[0])); });
  }
  function stop() { timers.forEach(clearTimeout); timers = []; }
  function resetData() { S.moments = []; FEEDS.forEach(function (f) { S.feeds[f.key] = []; }); S.score = null; fixtureLoaded = false; }
  function reset() { stop(); resetData(); emit(); }

  window.CREW = {
    enabled: on, FEEDS: FEEDS, ARMS: ARMS, state: S,
    subscribe: function (fn) { subs.push(fn); fn(S); return function () { subs = subs.filter(function (x) { return x !== fn; }); }; },
    ingest: ingest, play: play, stop: stop, reset: reset
  };
})();
