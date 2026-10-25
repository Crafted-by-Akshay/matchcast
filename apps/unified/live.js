// ---- unified console: the live agent api. Posts Watch's events to the api and subscribes to its stream (docs/architecture/12-api.md).
// With no api (MATCHCAST_API empty) nothing is called and the in-page rules agents (agents.js) are the only source: status 'offline'.
// With an api, the rules agents keep running beside it, so if the api never answers the viewer still gets lines: status 'fallback'.
const LV = (() => {
  const WARM_MS = window.MATCHCAST_WARM_MS || 90000, CLAIM_MS = window.MATCHCAST_WARM_MS || 60000, BACKOFF = [1000, 2000, 5000, 10000], BATCH = 50, TENANT_SESSION = 'demo';
  let badClaim = false, base = '', st = 'offline', persona = 'fan', lang = 'en', run = null, onStatus = () => {}, onClaim = () => {}, onLine = () => {}, onBooth = () => {}, timer = null;
  const vstats = { passes: 0, reads: 0, readsFailed: 0 };   // what Vision has reached the api with: passes accepted, shirt-number reads answered or refused
  const api = () => base.replace(/\/+$/, '');
  const slug = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'x';
  const set = (s, again) => { if (s !== st || again) { st = s; onStatus(s); } };

  // Watch events to the contract's event payloads (docs/contracts.md). Types the contract has no fields for here return null:
  // tackles and pressure need a target player and a distance Watch does not record.
  let teamIds = [];
  const num = (v) => v != null && v !== '' && Number.isFinite(+v);
  const clampX = (v, d) => Math.max(0, Math.min(105, num(v) ? +v : d)), clampY = (v, d) => Math.max(0, Math.min(68, num(v) ? +v : d));
  let lastShot = null;   // Watch's goal events carry no position, so a goal takes the position of the shot before it
  // the shot's drawn fate (goal, save or miss) says whether it was on target; without a fate (an older source) the xG guess stays
  const onTarget = (ev) => ev.fate === 'goal' || ev.fate === 'save' ? true : ev.fate === 'miss' ? false : ev.kind === 'penalty' || (+ev.xg || 0) > 0.1;
  const pos = (x, y) => ({ x: clampX(x, 52.5), y: clampY(y, 34), z: 0 });
  const payloadOf = (ev, t, p) => {
    const other = teamIds.find((id) => id !== t);
    switch (ev.type) {
      case 'goal': { const g = num(ev.x) ? ev : lastShot || ev; return { v: '1.0.0', o: { type: 'goal', player_id: p, team_id: t, own_goal: !!ev.ownGoal, position_unit: 'm', position: pos(g.x, g.y) } }; }
      case 'shot': lastShot = ev; return { v: '1.0.0', o: { type: 'shot', player_id: p, team_id: t, position_unit: 'm', position: pos(ev.x, ev.y), on_target: onTarget(ev) } };
      case 'pass': return ev.to && num(ev.x0) ? { v: '1.0.0', o: { type: 'pass', player_id: p, recipient_player_id: slug(ev.to), team_id: t, position_unit: 'm', start_position: pos(ev.x0, ev.y0), end_position: pos(ev.x1, ev.y1) } } : null;
      case 'foul': return ev.on ? { v: '1.1.0', o: { type: 'foul', player_id: p, team_id: t, victim_player_id: slug(ev.on), advantage: false, position_unit: 'm', position: pos(ev.x, ev.y) } } : null;
      case 'yellow_card': case 'red_card': {
        const second = ev.type === 'red_card' && /second yellow|two yellow/i.test(ev.reason || '');
        return { v: '1.1.0', o: { type: 'card', player_id: p, team_id: t, colour: ev.type === 'yellow_card' ? 'yellow' : second ? 'second_yellow' : 'red', reason: String(ev.reason || ev.type.replace('_', ' ')).slice(0, 256) } };
      }
      case 'turnover': return other && teamIds.includes(t) ? { v: '1.1.0', o: { type: 'possession_change', from_team_id: other, to_team_id: t, cause: 'loose_ball' } } : null;
      default: return null;
    }
  };
  const toPacket = (ev, key, seq, iso) => {
    const t = ev.team ? slug(ev.team) : null, p = ev.player ? slug(ev.player) : null;
    if (!t || !p) return null;
    const m = payloadOf(ev, t, p);
    if (!m) return null;
    const ms = Math.max(0, Math.round(ev.minute * 60000));
    return { kind: 'event', schema_version: m.v, stream: key, event_id: 'e' + seq, stream_sequence: seq, revision: 0, event_time_ms: ms, emitted_at: iso,
      clock: { period: ev.minute < 45 ? 1 : 2, period_elapsed_ms: ev.minute < 45 ? ms : ms - 45 * 60000 }, payload: m.o };
  };

  const url = (path, q) => api() + path + '?' + new URLSearchParams(Object.assign({ session_id: run.key.session_id }, q || {}));
  const post = (path, body, q) => fetch(url(path, q), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // a new match from Watch: close the old stream, create the match, open the stream. Cold start is 'warming' until the first claim. The api is given 90 s to take the first batch, then 60 s from that batch to publish a claim; while batches are accepted and the stream is open it never drops to 'fallback' on its own. Neither timer touches an api that already said 'live': it stays live while it waits for events, and a stream that keeps failing drops it (onerror).
  const begin = (matchKey, roster) => {
    stop();
    teamIds = roster ? roster.teams.map(slug) : [];
    vstats.passes = 0; vstats.reads = 0; vstats.readsFailed = 0;   // Vision counts belong to one match
    if (!api()) { set('offline'); return; }
    const id = 'm-' + slug(matchKey).slice(0, 60), ses = TENANT_SESSION + '-' + Date.now().toString(36);
    run = { id, key: { tenant_id: 'demo', session_id: ses, match_id: id }, seq: 0, queue: [], created: false, es: null, tries: 0, last: null, claimed: false, accepted: false, sending: false };
    set('warming', true);   // repaint even if already warming: the shell restarts its seconds counter with the warm-up timer
    timer = setTimeout(() => { if (run && !run.claimed && st === 'warming') set('fallback'); }, WARM_MS);   // only a silent api falls back: one that already said 'live' stays live while it waits for events (judge re-test: Broadcast read 'Rules fallback' while the api was live)
    run.roster = roster ? { kind: 'roster', schema_version: '1.0.0', stream: run.key, pitch: { length_m: 105, width_m: 68 }, ball_id: 'ball', team_ids: roster.teams.map(slug),
      players: roster.players.map((q) => ({ player_id: slug(q.name), team_id: slug(q.team) })) } : null;
    // the names go on create, so Ask knows the clubs and players by the names the fan sees
    run.clubs = roster ? Object.fromEntries(roster.teams.map((t) => [slug(t), t])) : {};
    run.names = roster ? Object.fromEntries(roster.players.map((q) => [slug(q.name), q.name])) : {};
    open();
    if (!badClaim) create(run).catch(() => { /* the first batch tries again */ });   // eager: the stream's 'live' status reaches the pill without waiting for the engine's first events
  };
  // the booth's own stream (persona=booth): only booth:pbp and booth:colour publications, in speaking order. Its persona is the speaker, which feed.js voices. It is not retried: if it drops, the rules booth carries on
  const openBooth = (r) => {
    if (r.booth) r.booth.close();
    onBooth(null);   // a new match or a reconnect clears the last answer until this one arrives
    // the api says whether the booth is on and, when it is not, why (the watch-mode cap); the card shows it, and the rules booth carries on either way
    fetch(url('/v1/matches/' + r.id + '/booth'), { headers: { Accept: 'application/json' } }).then((res) => (res.ok ? res.json() : null)).then((j) => { if (j && run === r) onBooth(j); }).catch(() => { /* the card keeps its default */ });
    try {
      const es = new EventSource(url('/v1/matches/' + r.id + '/stream', { persona: 'booth', lang }));
      r.booth = es;
      es.addEventListener('publication', (e) => { try { onLine(JSON.parse(e.data), st); } catch (err) { /* a bad frame is skipped */ } });
      es.onerror = () => es.close();
    } catch (e) { /* the rules booth carries on */ }
  };
  const open = () => {
    const r = run; if (!r || !r.created) return;
    if (r.es) r.es.close();   // one stream at a time: a pending retry must not add a second
    openBooth(r);
    // the api only knows the match once it is created; flush opens the stream right after
    try {
      const es = new EventSource(url('/v1/matches/' + r.id + '/stream', { persona, lang }));
      r.es = es;
      const on = (name, fn) => es.addEventListener(name, (e) => { r.tries = 0; if (e.lastEventId) r.last = e.lastEventId; try { fn(JSON.parse(e.data)); } catch (err) { /* a bad frame is skipped */ } });
      on('status', (d) => { const s = d && d.status; r.apiFallback = s === 'rules_fallback'; if (s === 'live') set('live'); else if (s === 'rules_fallback') set('fallback'); else if (s === 'warming_up') set('warming'); });
      on('claim', (d) => { r.claimed = true; if (st === 'warming' || (st === 'fallback' && !r.apiFallback)) set('live'); onClaim(d, st); });   // a claim after the warm-up timed out means the api is live after all, unless the api itself said it is on rules
      on('line', (d) => onLine(d, st));
      on('publication', (d) => { r.claimed = true; if (st === 'warming' || (st === 'fallback' && !r.apiFallback)) set('live'); onLine(d, st); });
      es.onerror = () => { es.close(); if (run !== r || r.es !== es) return; if (r.tries >= 2 && st === 'live') set('fallback');   /* a stream that keeps failing is not live agents; the next status, claim or line brings it back */ const wait = BACKOFF[Math.min(r.tries++, BACKOFF.length - 1)]; setTimeout(() => { if (run === r) open(); }, wait); };
    } catch (e) { set('fallback'); }
  };

  // create the match on the api and open its stream. One create at a time; begin() starts it at once (so the pill can say 'Live agents' within seconds)
  // and flush() waits for it. The demo bad-claim switch is read here, so begin() leaves the create to the first batch while that switch is on.
  const create = (r) => r.creating || (r.creating = (async () => {
    try {
      const bad = badClaim;   // the api takes the demo switch at match creation only
      const res = await post('/v1/matches', { session_id: r.key.session_id, match_id: r.id, seed: 0, engine_version: 'unified-1', home_team_id: r.roster ? r.roster.team_ids[0] : 'home', away_team_id: r.roster ? r.roster.team_ids[1] : 'away', venue_id: 'v1', kickoff_local: new Date().toISOString().slice(0, 19), approval_mode: 'auto', clubs: r.clubs || {}, names: r.names || {}, roster: r.roster, ...(badClaim ? { seed_bad_claim: true } : {}) });
      if (res.ok || res.status === 409) { r.created = true; r.bad = res.ok && bad; open(); } else { const er = new Error('create ' + res.status); er.status = res.status; throw er; }   // a 409 means the match existed and the body was ignored; the stream opens once the match exists
    } finally { r.creating = null; }
  })());

  const flush = async () => {
    const r = run; if (!r || r.sending || !r.queue.length) return;
    r.sending = true;
    try {
      if (!r.created) await create(r);
      const batch = r.queue.slice(0, BATCH);
      const res = await post('/v1/matches/' + r.id + '/events', { events: batch });
      if (res.status === 404) { r.created = false; if (r.es) r.es.close(); }   // the api lost the match (a restart on a store that did not keep it): create it again with the next batch
      if (!res.ok) throw new Error('events ' + res.status);
      r.queue.splice(0, batch.length);
      if (run === r && !r.accepted) { r.accepted = true; clearTimeout(timer); timer = setTimeout(() => { if (run === r && !r.claimed && st === 'warming') set('fallback'); }, CLAIM_MS); }   // the clock for a claim starts at the first accepted batch, not at page load
    } catch (e) { if (run === r && st === 'warming' && !r.created && e.status >= 400 && e.status < 500 && e.status !== 404 && e.status !== 409) set('fallback'); /* the api refused the match: a real failure. A network error or a 5xx on a cold container keeps waiting; the timers decide */ }
    r.sending = false;
  };

  // the chip next to a verified answer, from the api's `intent` and `retrieval`: `local` is the match record for a live question and the built-in knowledge base for a knowledge one
  const chipOf = (j) => j.abstained ? '' : j.retrieval === 'search_fallback' ? 'Search fallback' : j.retrieval === 'search' ? 'from AI Search' : j.retrieval === 'local' ? (j.intent === 'live' ? 'from the match record' : j.intent === 'knowledge' || j.intent === 'both' ? 'from the knowledge base' : '') : '';
  // a question to the agents (EXP-5): the api's Ask router answers with citations and a verdict; throws when it cannot
  // the api's Ask takes one of three audiences and answers {answer, abstained, citations, mode, variants?}
  const audience = () => (persona === 'analyst' || persona === 'broadcast' ? persona : 'casual');
  const ask = async (question, surface = 'ask') => {
    if (!run) throw new Error('no match yet');
    if (!String(question).trim()) throw new Error('empty question');   // the api needs at least one character
    const body = { session_id: run.key.session_id, question: String(question).slice(0, 300), persona: audience(), lang: lang === 'es' || lang === 'hi' ? lang : 'en' };
    if (surface === 'broadcast') body.surface = surface;   // the Copilot's picks; a plain question sends exactly what it always did
    const res = await post('/v1/matches/' + run.id + '/ask', body);
    if (!res.ok) throw Object.assign(new Error('ask ' + res.status), { status: res.status });
    const j = await res.json();
    const t = j.variants && j.variants[lang];
    return { text: typeof t === 'string' && t ? t : j.answer, verdict: j.abstained ? 'abstained' : 'verified', source: j.mode === 'live' ? 'model' : 'rules', citations: j.citations || [], api: true, retrieval: j.retrieval || null, note: chipOf(j), broadcast: j.broadcast || null };
  };

  // a viewer's words to a player or the producer (EXP-16): the api's role agent answers from the stored events and its Verifier checks the reply; position is the sim's code (GK, ST...) so the role guard can bound an order
  const talk = async (target, utterance, position) => {
    if (!run) throw new Error('no match yet');
    if (!String(utterance).trim()) throw new Error('empty utterance');
    const res = await post('/v1/matches/' + run.id + '/talk', { session_id: run.key.session_id, target: slug(target), utterance: String(utterance).slice(0, 300), ...(position ? { position } : {}) });
    if (!res.ok) throw Object.assign(new Error('talk ' + res.status), { status: res.status });
    const j = await res.json();
    return { text: j.reply, verdict: j.verdict, facts: j.facts || {}, order: j.order || null, api: true, audioUrl: j.audio_url ? new URL(j.audio_url, api() + '/').href : null };   // the api's Azure Speech clip of a verified reply (Voice lane)
  };

  // a shirt-number second opinion for a torso crop (DAT-11): throws {status, retry_after} when the api cannot give one
  const identify = async (trackId, team, crop) => {
    if (!run) throw Object.assign(new Error('no match yet'), { status: 0 });
    const res = await fetch(api() + '/v1/matches/' + run.id + '/vision/identify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: run.key.session_id, crop, track_id: trackId, team_hint: team }) });
    if (!res.ok) { vstats.readsFailed++; throw Object.assign(new Error('identify ' + res.status), { status: res.status, retry_after: +res.headers.get('Retry-After') || 0 }); }
    const j = await res.json(); vstats.reads++; return j;
  };

  // the server's audit records for this match (EXP-12), and the same check the server's verifyChain does (packages/contracts/src/audit.ts)
  const GENESIS = '0'.repeat(64);
  const canon = (v) => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
    : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
  const sha = (t) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)).then((b) => [...new Uint8Array(b)].map((n) => n.toString(16).padStart(2, '0')).join(''));
  const verifyChain = async (records) => {
    let prev = GENESIS;
    const stream = records.length ? canon(records[0].stream) : null;
    for (let i = 0; i < records.length; i++) {
      const r = records[i], bad = (reason) => ({ valid: false, count: records.length, first_broken_sequence: Number.isInteger(r && r.sequence) && r.sequence >= 1 ? r.sequence : i + 1, reason });
      if (!r || r.kind !== 'audit_record') return bad('invalid_schema');
      if (canon(r.stream) !== stream) return bad('stream_mismatch');
      if (r.sequence !== i + 1) return bad('sequence_gap');
      if (r.prev_hash !== prev) return bad('prev_hash_mismatch');
      const body = Object.assign({}, r); delete body.hash;
      if (r.hash !== await sha(canon(body))) return bad('hash_mismatch');
      prev = r.hash;
    }
    return { valid: true, count: records.length, final_hash: prev, first_broken_sequence: null, reason: null };
  };
  const audit = async () => {
    if (!run) throw new Error('no match yet');
    const all = [], LIMIT = 1000;
    for (let page = 0; page < 20; page++) {   // the api returns at most 1000 records a call; from_seq is the first sequence wanted
      const res = await fetch(url('/v1/matches/' + run.id + '/audit', { limit: LIMIT, from_seq: all.length + 1 }));
      if (!res.ok) throw new Error('audit ' + res.status);
      const j = await res.json(), got = Array.isArray(j) ? j : (j.records || j.items || []);
      all.push(...got);
      if (got.length < LIMIT) return all;
    }
    throw new Error('more than 20,000 records');
  };

  // Watch's batch, as the shell receives it
  const events = (batch) => {
    if (!run) return;
    for (const ev of batch || []) { const p = toPacket(ev, run.key, run.seq + 1, new Date().toISOString()); if (p) { run.seq++; run.queue.push(p); } }
    flush();
  };
  // Vision derived events (DAT-11 task 277): the tracker's passes, on their own stream `<session>.vision` so they never mix with engine truth.
  // Its own match is created on first use from the same roster; packets are plain contract `pass` events.
  const vstream = (r) => Object.assign({}, r.key, { session_id: r.key.session_id + '.vision' });
  const visionEvents = (batch) => {
    const r = run; if (!r || !r.roster || !batch || !batch.length) return;
    const v = r.vision || (r.vision = { key: vstream(r), seq: 0, queue: [], created: false, sending: false });
    for (const b of batch) {
      if (b.type !== 'pass' || !b.team || !b.from || !b.to) continue;
      const ms = Math.max(0, Math.round(b.minute * 60000)), second = b.minute >= 45;
      v.queue.push({ kind: 'event', schema_version: '1.0.0', stream: v.key, event_id: 'v' + (++v.seq), stream_sequence: v.seq, revision: 0, event_time_ms: ms, emitted_at: new Date().toISOString(),
        clock: { period: second ? 2 : 1, period_elapsed_ms: second ? ms - 45 * 60000 : ms },
        payload: { type: 'pass', player_id: slug(b.from), recipient_player_id: slug(b.to), team_id: slug(b.team), position_unit: 'm',
          start_position: { x: b.start.x, y: b.start.y, z: 0 }, end_position: { x: b.end.x, y: b.end.y, z: 0 } } });
    }
    if (v.queue.length > 2000) v.queue.splice(0, v.queue.length - 2000);   // an api that never accepts the stream does not grow the queue without bound
    sendVision(r, v);
  };
  const sendVision = async (r, v) => {
    if (v.sending || !v.queue.length) return;
    v.sending = true;
    const at = (path) => api() + path + '?' + new URLSearchParams({ session_id: v.key.session_id }), json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      if (!v.created) {
        const res = await fetch(api() + '/v1/matches', json({ session_id: v.key.session_id, match_id: r.id, seed: 0, engine_version: 'unified-1-vision', home_team_id: r.roster.team_ids[0], away_team_id: r.roster.team_ids[1], venue_id: 'v1',
          kickoff_local: new Date().toISOString().slice(0, 19), approval_mode: 'auto', clubs: r.clubs || {}, names: r.names || {}, roster: Object.assign({}, r.roster, { stream: v.key }) }));
        if (res.ok || res.status === 409) v.created = true; else { const er = new Error('create ' + res.status); er.status = res.status; throw er; }
      }
      const batch = v.queue.slice(0, BATCH);
      const res = await fetch(at('/v1/matches/' + r.id + '/events'), json({ events: batch }));
      if (!res.ok) throw new Error('events ' + res.status);
      v.queue.splice(0, batch.length);
      vstats.passes += batch.length;
    } catch (e) { /* kept; the next batch retries */ }
    v.sending = false;
    if (v.queue.length && run === r && v.created) sendVision(r, v);
  };

  // the viewer's watch mode (casual, analyst, club:<key>, player:<name>, metric:<name>): the stream is reopened for it
  const setPersona = (p, l) => { l = l || 'en'; if (p === persona && l === lang) return; persona = p; lang = l; if (run) { if (run.es) run.es.close(); open(); } };
  // the full-time recap for a persona (casual or broadcast): the api writes it after the final whistle, so a 404 means "not yet"
  const recap = async (p, tries) => {
    const r = run; if (!r) return null;
    const path = '/v1/matches/' + r.id + '/recap/' + p;
    const q = '?' + new URLSearchParams({ session_id: r.key.session_id });
    for (let i = 0; i < (tries || 40) && run === r; i++) {   // the recap waits on the final event, the function and the Verifier: about two minutes in all
      let res = null;
      try { res = await fetch(api() + path + q); } catch (e) { return null; }
      if (res.ok) { const j = await res.json(); const ok = (j.sentences || []).filter((x) => x.verdict === 'verified'); return ok.length ? { text: ok.map((x) => x.text).join(' '), sentences: ok.length, partial: ok.length < (j.sentences || []).length, mode: j.mode || 'rules', audioUrl: api() + path + '/audio.mp3' + q } : null; }
      if (res.status !== 404) return null;
      await new Promise((ok) => setTimeout(ok, i < 10 ? 1500 : 4000));
    }
    return null;
  };
  // Vision -> Agents (ADR-0022): the Vision stream's summary for this match (passes in, lines the Verifier passed, the latest such line, agreement with the engine); null with no match or no api
  const visionSummary = async () => {
    const r = run; if (!r || !api()) return null;
    try { const res = await fetch(url('/v1/matches/' + r.id + '/vision/summary'), { cache: 'no-store' }); return res.ok ? await res.json() : null; } catch (e) { return null; }
  };
  const stop = () => { clearTimeout(timer); if (run && run.es) run.es.close(); if (run && run.booth) run.booth.close(); run = null; };
  return { configure: (b, cbs) => { base = b || ''; onStatus = cbs.status; onClaim = cbs.claim; onLine = cbs.line; onBooth = cbs.booth || (() => {}); set(base ? 'warming' : 'offline'); if (!base) onStatus('offline'); },
    begin, events, visionEvents, visionSummary, stop, talk, recap, get vision() { return Object.assign({}, vstats); }, persona: setPersona, seedBad: (on) => { badClaim = !!on; },
    get badState() { return run && run.created && run.bad ? 'sent' : !badClaim ? 'off' : !run || !run.created ? 'pending' : 'late'; },   // pending: goes with the match; late: this match was created without it
     toPacket, ask, identify, audit, verifyChain, get base() { return api(); }, get language() { return lang; }, get auditionUrl() { return api() ? api() + '/v1/voice/audition.mp3' : null; }, get key() { return run ? run.key : null; }, get status() { return st; }, get enabled() { return !!api(); } };
})();
