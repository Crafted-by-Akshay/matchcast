// ---- unified console: the live agent api. Posts Watch's events to the api and subscribes to its stream (docs/architecture/12-api.md).
// With no api (MATCHCAST_API empty) nothing is called and the in-page rules agents (agents.js) are the only source: status 'offline'.
// With an api, the rules agents keep running beside it, so if the api never answers the viewer still gets lines: status 'fallback'.
const LV = (() => {
  const WARM_MS = window.MATCHCAST_WARM_MS || 45000, BACKOFF = [1000, 2000, 5000, 10000], BATCH = 50, TENANT_SESSION = 'demo';
  let base = '', st = 'offline', persona = 'fan', run = null, onStatus = () => {}, onClaim = () => {}, onLine = () => {}, timer = null;
  const api = () => base.replace(/\/+$/, '');
  const slug = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'x';
  const set = (s) => { if (s !== st) { st = s; onStatus(s); } };

  // a prototype event to a contract event (only goal and shot carry what the contract needs; the rest are not sent)
  const toPacket = (ev, key, seq, iso) => {
    const t = ev.team ? slug(ev.team) : null, p = ev.player ? slug(ev.player) : null;
    if (!t || !p || (ev.type !== 'goal' && ev.type !== 'shot')) return null;
    const x = Math.max(0, Math.min(105, +ev.x || 52.5)), y = Math.max(0, Math.min(68, +ev.y || 34));
    const ms = Math.max(0, Math.round(ev.minute * 60000));
    const payload = ev.type === 'goal'
      ? { type: 'goal', player_id: p, team_id: t, own_goal: !!ev.ownGoal, position_unit: 'm', position: { x, y, z: 0 } }
      : { type: 'shot', player_id: p, team_id: t, position_unit: 'm', position: { x, y, z: 0 }, on_target: ev.kind === 'penalty' || (+ev.xg || 0) > 0.1 };
    return { kind: 'event', schema_version: '1.0.0', stream: key, event_id: 'e' + seq, stream_sequence: seq, revision: 0, event_time_ms: ms, emitted_at: iso,
      clock: { period: ev.minute < 45 ? 1 : 2, period_elapsed_ms: ev.minute < 45 ? ms : ms - 45 * 60000 }, payload };
  };

  const url = (path, q) => api() + path + '?' + new URLSearchParams(Object.assign({ session_id: run.key.session_id }, q || {}));
  const post = (path, body, q) => fetch(url(path, q), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // a new match from Watch: close the old stream, create the match, open the stream. Cold start is 'warming' until the first claim or 45 s.
  const begin = (matchKey, roster) => {
    stop();
    if (!api()) { set('offline'); return; }
    const id = 'm-' + slug(matchKey).slice(0, 60), ses = TENANT_SESSION + '-' + Date.now().toString(36);
    run = { id, key: { tenant_id: 'demo', session_id: ses, match_id: id }, seq: 0, queue: [], created: false, es: null, tries: 0, last: null, claimed: false, sending: false };
    set('warming');
    timer = setTimeout(() => { if (run && !run.claimed) set('fallback'); }, WARM_MS);
    run.roster = roster ? { kind: 'roster', schema_version: '1.0.0', stream: run.key, pitch: { length_m: 105, width_m: 68 }, ball_id: 'ball', team_ids: roster.teams.map(slug),
      players: roster.players.map((q) => ({ player_id: slug(q.name), team_id: slug(q.team) })) } : null;
    open();
  };
  const open = () => {
    const r = run; if (!r) return;
    try {
      const es = new EventSource(url('/v1/matches/' + r.id + '/stream', { persona, lang: 'en' }));
      r.es = es;
      const on = (name, fn) => es.addEventListener(name, (e) => { r.tries = 0; if (e.lastEventId) r.last = e.lastEventId; try { fn(JSON.parse(e.data)); } catch (err) { /* a bad frame is skipped */ } });
      on('status', (d) => { const s = d && d.status; if (s === 'live') set('live'); else if (s === 'rules_fallback') set('fallback'); else if (s === 'warming_up') set('warming'); });
      on('claim', (d) => { r.claimed = true; if (st === 'warming') set('live'); onClaim(d, st); });
      on('line', (d) => onLine(d, st));
      on('publication', (d) => { r.claimed = true; if (st === 'warming') set('live'); onLine(d, st); });
      es.onerror = () => { es.close(); if (run !== r) return; const wait = BACKOFF[Math.min(r.tries++, BACKOFF.length - 1)]; setTimeout(() => { if (run === r) open(); }, wait); };
    } catch (e) { set('fallback'); }
  };

  const flush = async () => {
    const r = run; if (!r || r.sending || !r.queue.length) return;
    r.sending = true;
    try {
      if (!r.created) {
        const res = await post('/v1/matches', { session_id: r.key.session_id, match_id: r.id, seed: 0, engine_version: 'unified-1', home_team_id: r.roster ? r.roster.team_ids[0] : 'home', away_team_id: r.roster ? r.roster.team_ids[1] : 'away', venue_id: 'v1', kickoff_local: new Date().toISOString().slice(0, 19), approval_mode: 'auto', roster: r.roster });
        if (res.ok || res.status === 409) r.created = true; else throw new Error('create ' + res.status);
      }
      const batch = r.queue.slice(0, BATCH);
      const res = await post('/v1/matches/' + r.id + '/events', { events: batch });
      if (!res.ok) throw new Error('events ' + res.status);
      r.queue.splice(0, batch.length);
    } catch (e) { if (run === r && st === 'warming') { /* keep waiting; the 45 s timer decides */ } }
    r.sending = false;
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
  // the viewer's watch mode (casual, analyst, club:<key>, player:<name>, metric:<name>): the stream is reopened for it
  const setPersona = (p) => { if (p === persona) return; persona = p; if (run) { if (run.es) run.es.close(); open(); } };
  const stop = () => { clearTimeout(timer); if (run && run.es) run.es.close(); run = null; };
  return { configure: (b, cbs) => { base = b || ''; onStatus = cbs.status; onClaim = cbs.claim; onLine = cbs.line; set(base ? 'warming' : 'offline'); if (!base) onStatus('offline'); },
    begin, events, stop, persona: setPersona, toPacket, audit, verifyChain, get status() { return st; }, get enabled() { return !!api(); } };
})();
