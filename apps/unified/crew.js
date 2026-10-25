/* Crew data layer (Experience lane). Everything the crew panels draw comes through CREW.
   Flag: ?crew=1 (or localStorage mc-crew=1). Off by default until the orchestration frames merge.
   Until then CREW.play() feeds a Simulated fixture; CREW.ingest(frame) is the single place a real
   SSE adapter plugs in (shapes are a guess: AB#498/499 will settle them, change only here). */
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

  /* frame kinds: spawn, agent, claim, publish, score, moment. Placeholder shapes. */
  function ingest(f) {
    if (!f || !f.kind) return;
    if (f.kind === 'moment') Object.assign(moment(f.id), f.data || {});
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
    var id = 'm-' + minute, t = 0, steps = [];
    function at(ms, f) { steps.push([ms, f]); }
    at(t, { kind: 'moment', id: id, data: { minute: minute, why: 'goal', routed_by: 'rules', status: 'open' } });
    at(t, { kind: 'spawn', moment: id, agent: { id: id + ':show', role: 'Showrunner', parent: null } });
    ['Analyst', 'Stats Researcher', 'History', 'Replay', 'Narrator'].forEach(function (r, i) {
      at(t + 400 + i * 250, { kind: 'spawn', moment: id, agent: { id: id + ':' + r, role: r, parent: id + ':show' } });
    });
    at(2400, { kind: 'claim', moment: id, claim: { id: id + ':c1', text: 'Goal at ' + minute + "'. Third shot on target.", verdict: 'checking', sources: ['e-' + minute + '-1'], repair_of: null } });
    at(3200, { kind: 'claim', moment: id, claim: { id: id + ':c1', verdict: 'rejected', reason: 'number_mismatch: engine says 2 shots on target' } });
    at(3800, { kind: 'claim', moment: id, claim: { id: id + ':c2', text: 'Goal at ' + minute + "'. Second shot on target.", verdict: 'verified', sources: ['e-' + minute + '-1'], repair_of: id + ':c1' } });
    at(4000, { kind: 'publish', feed: 'casual', line: { publication_id: id + ':p1', text: 'GOAL! Second shot on target and it counts.', match_time_ms: minute * 60000, source_event_ids: ['e-' + minute + '-1'] } });
    at(4100, { kind: 'publish', feed: 'analyst', line: { publication_id: id + ':p2', text: 'Second shot on target, first goal; xG 0.31.', match_time_ms: minute * 60000, source_event_ids: ['e-' + minute + '-1'] } });
    at(4600, { kind: 'moment', id: id, data: { status: 'done' } });
    at(4600, { kind: 'score', score: { method: 'Simulated fixture', arms: {
      full_crew: { accuracy: 0.99, catch_rate: 1, latency_ms: 2100, cost: 0.011, n: 30 },
      single_agent: { accuracy: 0.9, catch_rate: 0, latency_ms: 1300, cost: 0.004, n: 30 },
      crew_no_verifier: { accuracy: 0.93, catch_rate: 0, latency_ms: 1800, cost: 0.009, n: 30 } } } });
    return steps;
  }

  var timers = [];
  function play(minute) {
    stop();
    S.simulated = true;
    fixtureGoal(minute || 23).forEach(function (s) { timers.push(setTimeout(function () { ingest(s[1]); }, s[0])); });
  }
  function stop() { timers.forEach(clearTimeout); timers = []; }
  function reset() { stop(); S.moments = []; FEEDS.forEach(function (f) { S.feeds[f.key] = []; }); S.score = null; emit(); }

  window.CREW = {
    enabled: on, FEEDS: FEEDS, ARMS: ARMS, state: S,
    subscribe: function (fn) { subs.push(fn); fn(S); return function () { subs = subs.filter(function (x) { return x !== fn; }); }; },
    ingest: ingest, play: play, stop: stop, reset: reset
  };
})();
