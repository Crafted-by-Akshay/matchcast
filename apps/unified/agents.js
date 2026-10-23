// ---- unified console: the agents. One pipeline, shared by Watch, Analyst and Broadcast. Rules-based and simulated: no Foundry call yet.
// Producer picks moments and routes approved lines. Analyst turns events into claims. Narrator writes each line from the claim's inputs.
// Verifier recounts every claim from the raw event log, repairs it once from that recount, or abstains. Predictor is a tool; the Data Scientist runs on demand.
const AG = (() => {
  const PICK = ['goal', 'red_card', 'big_chance', 'turning_point', 'milestone'];   // the moments the Producer airs
  let run = null, changed = () => {};
  let seedBad = false;   // demo switch: the next score claim is stated wrongly, so the Verifier rejects it and repairs it from the log
  const TOOLS = { score: ['event_log.goals', 'score_counter'], shot: ['event_log.shot', 'xg_lookup'], xg_total: ['event_log.shots', 'xg_sum'], moment: ['explain.moment'] };
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // one trace step per agent action: who, what, how long it took (ms), and whether rules or a model did it
  const trace = (c, agent, step, t0, extra) => c.trace.push(Object.assign({ agent, step, ms: +(clock() - t0).toFixed(3), mode: c.source === 'model' ? 'model' : 'rules', tokens: null }, extra || {}));
  let mode = 'demo', onAir = () => {};   // demo: verified lines air at once; producer: a person approves each line first

  const fresh = (key, names) => ({ key, names, events: [], moments: [], claims: [], feed: [], n: 0,
    roll: { score: [0, 0], xg: [0, 0], nextXg: 5 },
    stat: { events: 0, claims: 0, verified: 0, repaired: 0, abstained: 0, moments: 0, predictions: 0, lines: 0 } });
  const teamIx = (k) => (!run || k == null) ? -1 : k === run.names.hk ? 0 : k === run.names.ak ? 1 : -1;
  const teamName = (t) => (t === 0 ? run.names.home : run.names.away);
  const min = (m) => Math.floor(m) + "'";
  const f2 = (x) => (+x).toFixed(2);
  const say = (who, minute, text, tone) => { run.feed.push({ minute, who, text, tone: tone || '' }); if (run.feed.length > 200) run.feed.shift(); };
  // every agent action goes to the audit chain; the claim keeps the sequence number and a short hash of each record
  const log = (c, agent, action, detail) => MCC.append(agent, action, c.id, detail, c.minute).then((r) => { c.audit.push({ seq: r.seq, hash: r.hash.slice(0, 12) }); changed(); });

  // Narrator: the English line, written only from the claim's inputs
  const narrate = (c) => {
    const i = c.inputs, H = run.names.home, A = run.names.away;
    if (c.kind === 'score') return 'Goal for ' + i.teamName + ' (' + i.scorer + ') at ' + min(c.minute) + '. ' + H + ' ' + i.score[0] + '–' + i.score[1] + ' ' + A + '.';
    if (c.kind === 'shot') return i.player + ' shoots from ' + i.kind + ' for ' + i.teamName + ' at ' + min(c.minute) + '. xG ' + f2(i.xg) + '.';
    if (c.kind === 'xg_total') return 'After ' + min(c.minute) + ': ' + H + ' ' + f2(i.xg[0]) + ' xG, ' + A + ' ' + f2(i.xg[1]) + ' xG.';
    return i.title + '. ' + String(i.why).slice(0, 200);   // a moment: Watch's explain module wrote the reason, the Narrator copies it
  };

  // Translator (rules): fixed Spanish and Hindi templates over the same claim inputs, names and numbers copied untouched.
  // Anything the templates cannot say (a moment's prose from Watch) is not translated; the English line stays with a note.
  const KIND = { es: { 'open play': 'jugada abierta', penalty: 'penalti', 'free kick': 'tiro libre', header: 'cabezazo' }, hi: { 'open play': 'खुले खेल से', penalty: 'पेनल्टी', 'free kick': 'फ्री किक', header: 'हेडर' } };
  const TPL = {
    es: {
      score: (i, m) => 'Gol de ' + i.teamName + ' (' + i.scorer + ') en el min ' + m + '. ' + i.H + ' ' + i.score[0] + '–' + i.score[1] + ' ' + i.A + '.',
      shot: (i, m) => i.player + ' dispara (' + (KIND.es[i.kind] || i.kind) + ') para ' + i.teamName + ' en el min ' + m + '. xG ' + f2(i.xg) + '.',
      xg_total: (i, m) => 'Tras el min ' + m + ': ' + i.H + ' ' + f2(i.xg[0]) + ' xG, ' + i.A + ' ' + f2(i.xg[1]) + ' xG.'
    },
    hi: {
      score: (i, m) => i.teamName + ' का गोल (' + i.scorer + '), ' + m + ' मिनट पर। ' + i.H + ' ' + i.score[0] + '–' + i.score[1] + ' ' + i.A + '।',
      shot: (i, m) => i.player + ' का शॉट (' + (KIND.hi[i.kind] || i.kind) + '), ' + i.teamName + ', ' + m + ' मिनट पर। xG ' + f2(i.xg) + '।',
      xg_total: (i, m) => m + ' मिनट के बाद: ' + i.H + ' ' + f2(i.xg[0]) + ' xG, ' + i.A + ' ' + f2(i.xg[1]) + ' xG।'
    }
  };
  let translator = (c, lang) => { const f = TPL[lang] && TPL[lang][c.kind]; return f ? f(Object.assign({ H: run.names.home, A: run.names.away }, c.inputs), Math.floor(c.minute)) : null; };
  const numbers = (t) => String(t).match(/\d+(?:\.\d+)?/g) || [];
  // every name the run knows: the clubs, the players in the event log and in this claim
  const knownNames = (c) => [...new Set([run.names.home, run.names.away, c.inputs.scorer, c.inputs.player, c.inputs.teamName].concat(run.events.map((e) => e.player)).filter(Boolean))].sort((x, y) => y.length - x.length);
  // the line's facts in the order they are said: each known name and each number, with its position
  const facts = (text, names) => {
    const out = [], taken = [];
    for (const n of names) for (let at = text.indexOf(n); at >= 0; at = text.indexOf(n, at + n.length)) { if (!taken.some(([s, e]) => at < e && at + n.length > s)) { taken.push([at, at + n.length]); out.push([at, n]); } }
    for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) if (!taken.some(([s, e]) => m.index >= s && m.index < e)) out.push([m.index, m[0]]);
    return out.sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  };
  // Verifier re-check on a translation: the same names and numbers, in the same order, and no name that is not in the English line
  const checkTranslation = (c, text) => {
    const names = knownNames(c), en = facts(c.text, names), tr = facts(text, names);
    if (numbers(c.text).join() !== numbers(text).join()) return { ok: false, reason: 'numbers differ from the English line' };
    if (en.join('|') !== tr.join('|')) return { ok: false, reason: 'names or numbers are in a different order than the English line' };
    const cap = /(?<![\p{L}\d'’-])\p{Lu}[\p{L}'’-]*/gu, inEn = new Set(c.text.match(cap) || []);
    const extra = [...text.matchAll(cap)].filter((m) => m.index > 0 && !/(^|[.!?]\s)$/.test(text.slice(0, m.index)) && !inEn.has(m[0]) && !names.some((n) => n.includes(m[0]))).map((m) => m[0])[0];
    return extra ? { ok: false, reason: 'name not in the English line: ' + extra } : { ok: true, reason: 'names and numbers match the English line' };
  };
  // only verified lines are translated; a rejected translation is audited and the viewer keeps the English line
  const translateClaim = (c) => {
    c.tr = {};
    for (const lang of ['es', 'hi']) {
      const text = translator(c, lang);
      if (text == null) { c.tr[lang] = { ok: false, reason: 'no template for this line' }; continue; }
      const v = checkTranslation(c, text);
      c.tr[lang] = { ok: v.ok, reason: v.reason, text: v.ok ? text : null };
      if (!v.ok) log(c, 'verifier', 'translation_rejected', { lang, reason: v.reason });
    }
  };

  // Verifier: recount the claim from the raw event log, never from the Analyst's rolling counters
  const recount = (c) => {
    const i = c.inputs, upTo = (r) => r.minute <= c.minute + 1e-9;
    if (c.kind === 'score') { const s = [0, 0]; for (const r of run.events) if (r.type === 'goal' && upTo(r) && teamIx(r.team) >= 0) s[teamIx(r.team)]++; return { score: s }; }
    if (c.kind === 'shot') { const e = run.events.find((r) => r.type === 'shot' && r.player === i.player && Math.abs(r.minute - c.minute) < 0.05); return { xg: e ? e.data.xg : null }; }
    if (c.kind === 'xg_total') { const x = [0, 0]; for (const r of run.events) if (r.type === 'shot' && upTo(r) && teamIx(r.team) >= 0) x[teamIx(r.team)] += r.data.xg || 0; return { xg: x }; }
    const m = run.moments.find((q) => q.id === i.momentId);
    return { title: m ? m.title : null, why: m ? m.why : null };
  };
  const same = (a, b) => Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((x, k) => same(x, b[k]))
    : (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) < 0.01 : a === b;
  const agrees = (c, rc) => Object.keys(rc).every((k) => same(c.inputs[k], rc[k]));
  const verify = (c) => {
    const rc = recount(c);
    if (Object.values(rc).some((v) => v == null)) return { verdict: 'abstained', repaired: false, reason: 'no matching event in the log' };
    if (agrees(c, rc)) return { verdict: 'verified', repaired: false, reason: 'recount from the event log matches' };
    // one repair: the log is the source, so the inputs take the recount and the line is written again
    const was = Object.assign({}, c.inputs), t1 = clock();
    Object.assign(c.inputs, rc); c.text = narrate(c);
    trace(c, 'verifier', 'repair', t1, { detail: 'differed from the event log; rewrote the line from the recount', was, now: rc });
    log(c, 'verifier', 'repair', { was, now: rc });
    return { verdict: 'verified', repaired: true, reason: 'differed from the event log; repaired from it once' };
  };

  // wild moments are deterministic triggers; the Producer makes them priority 1 and the line still goes through the Verifier
  const ALERTS = { red_card: 'Red card', turning_point: 'Turning point' };
  const air = (c) => ({ id: c.id, minute: c.minute, text: c.airText || c.text, alert: c.alert || null, verdict: c.verdict, tr: c.airText ? null : (c.tr || null) });   // an edited line has no checked translation
  const nums = (t) => String(t).match(/\d+(?:\.\d+)?/g) || [];
  // a person's action on a queued line; every one lands in the audit chain with the person's name
  const act = (id, who, action, detail, fn) => {
    const c = run && run.claims.find((x) => x.id === id);
    if (!c || c.approval !== 'pending') return { ok: false, reason: 'not waiting for approval' };
    const r = fn(c); if (!r.ok) return r;
    log(c, 'producer', action, Object.assign({ by: who }, detail)); changed();
    const t = clock();
    trace(c, 'producer', 'approval', t, { detail: action === 'line_killed' ? 'killed by ' + who : (action === 'line_edited' ? 'edited and approved by ' : 'approved by ') + who });
    if (c.approval === 'approved') trace(c, 'producer', 'publication', t, { detail: 'line published to the ' + c.route + ' view' });
    return r;
  };
  const approve = (id, who) => act(id, who, 'line_approved', {}, (c) => { c.approval = 'approved'; c.approvedBy = who; onAir(air(c)); return { ok: true }; });
  const kill = (id, who, reason) => act(id, who, 'line_killed', { reason: reason || '' }, (c) => { c.approval = 'killed'; c.approvedBy = who; return { ok: true }; });
  // an edit may reword, but every number in it must already be in the verified line, so it cannot add a fact
  const edit = (id, who, text) => act(id, who, 'line_edited', { text }, (c) => {
    const ok = new Set(nums(c.text).concat(nums(min(c.minute))));
    const bad = nums(text).filter((n) => !ok.has(n));
    if (!text.trim() || bad.length) return { ok: false, reason: 'not aired: ' + (bad.length ? 'number ' + bad[0] + ' is not in the verified line' : 'empty line') };
    c.airText = text.trim(); c.approval = 'approved'; c.approvedBy = who; onAir(air(c)); return { ok: true };
  });

  // one claim through the pipeline: Analyst claims it, Narrator writes it, Verifier checks it, Producer routes or holds it
  const pipeline = (c) => {
    let t = clock();
    c.trace = [];
    trace(c, 'producer', 'task', t, { detail: 'picked a ' + c.kind + ' claim for the match' });
    t = clock();
    run.claims.push(c); run.stat.claims++;
    if (seedBad && c.kind === 'score') { seedBad = false; c.inputs.score = [c.inputs.score[0] + 1, c.inputs.score[1]]; c.seeded = true; }   // demo: a wrong number
    if (c.kind === 'moment' && ALERTS[c.inputs.type]) { c.alert = ALERTS[c.inputs.type]; say('Producer', c.minute, c.id + ' priority 1: ' + c.alert.toLowerCase(), 'warn'); }
    log(c, 'analyst', 'claim', { kind: c.kind, inputs: c.inputs, evidence: c.evidence, basis: c.basis || null });
    trace(c, 'analyst', 'claim', t, { tools: TOOLS[c.kind] || [], detail: c.seeded ? 'claimed a score one goal too high (seeded for the demo)' : 'claim from ' + c.evidence.length + ' source event(s)' });
    t = clock();
    c.text = narrate(c); run.stat.lines++;
    trace(c, 'narrator', 'draft', t, { detail: 'wrote the line from the claim inputs' });
    say('Analyst', c.minute, c.id + ' · ' + c.text, '');
    t = clock();
    const v = verify(c);
    trace(c, 'verifier', 'verdict', t, { detail: v.verdict + ': ' + v.reason });
    Object.assign(c, { verdict: v.verdict, repaired: v.repaired, reason: v.reason });
    log(c, 'verifier', 'verdict', { verdict: v.verdict, repaired: v.repaired });
    if (v.repaired) run.stat.repaired++;
    say('Verifier', c.minute, c.id + ' ' + v.verdict + ': ' + v.reason, v.verdict === 'verified' ? 'ok' : 'warn');
    if (v.verdict === 'verified') {
      run.stat.verified++;
      translateClaim(c);
      c.route = c.kind === 'xg_total' ? 'analyst' : c.kind === 'shot' ? 'fan' : 'broadcast';
      t = clock();
      if (c.route === 'broadcast' && mode === 'producer') {
        c.approval = 'pending';
        log(c, 'producer', 'queue', { route: c.route });
        trace(c, 'producer', 'approval', t, { detail: 'queued for a person to approve' });
        say('Producer', c.minute, c.id + ' queued for a person to approve', 'warn');
      } else {
        c.approval = 'approved';
        log(c, 'producer', 'approve', { route: c.route });
        trace(c, 'producer', 'approval', t, { detail: 'approved for the ' + c.route + ' view' });
        trace(c, 'producer', 'publication', clock(), { detail: 'line published to the ' + c.route + ' view' });
        say('Producer', c.minute, c.id + ' approved for the ' + c.route + ' view', 'ok');
        if (c.route === 'broadcast') onAir(air(c));
      }
    } else {
      run.stat.abstained++;
      log(c, 'producer', 'hold', { reason: v.reason });
      trace(c, 'producer', 'hold', clock(), { detail: v.reason });
      say('Producer', c.minute, c.id + ' held: ' + v.reason, 'warn');
    }
  };
  // Ask (rules): the question types the event log can answer. Each answer is counted from the log and names the events it used; anything else abstains.
  const CANT = "I can't confirm that from the match data yet.";
  const tally = (type) => { const m = new Map(); for (const e of run.events) if (e.type === type && e.player) { const k = e.player + '|' + e.team; m.set(k, (m.get(k) || []).concat(e.id)); } return [...m.entries()].map(([k, ids]) => ({ player: k.split('|')[0], team: k.split('|')[1], n: ids.length, ids })).sort((a, b) => b.n - a.n); };
  const ask = (q) => {
    if (!run || !run.events.length) return { text: CANT, verdict: 'abstained', source: 'rules', citations: [] };
    const s = String(q).toLowerCase(), last = run.events[run.events.length - 1].minute, ix = (t) => teamName(teamIx(t));
    let top;
    if (/shots?/.test(s) && /(most|top|more|leads?|who)/.test(s) && (top = tally('shot')).length) {
      const t = top[0]; return { text: t.player + ' (' + ix(t.team) + ') has the most shots: ' + t.n + ' by ' + min(last) + '.', verdict: 'verified', source: 'rules', citations: t.ids };
    }
    if (/(goal|scor)/.test(s) && /(most|top|who|scorer)/.test(s) && (top = tally('goal')).length) {
      const t = top[0]; return { text: t.player + ' (' + ix(t.team) + ') leads the scoring with ' + t.n + ' by ' + min(last) + '.', verdict: 'verified', source: 'rules', citations: t.ids };
    }
    if (/score|winning|leading/.test(s)) { const g = run.roll.score; return { text: run.names.home + ' ' + g[0] + '–' + g[1] + ' ' + run.names.away + ' at ' + min(last) + '.', verdict: 'verified', source: 'rules', citations: run.events.filter((e) => e.type === 'goal').map((e) => e.id) }; }
    if (/xg|expected goals/.test(s)) { const x = run.roll.xg; return { text: 'xG so far: ' + run.names.home + ' ' + f2(x[0]) + ', ' + run.names.away + ' ' + f2(x[1]) + ' at ' + min(last) + '.', verdict: 'verified', source: 'rules', citations: run.events.filter((e) => e.type === 'shot').map((e) => e.id) }; }
    return { text: CANT, verdict: 'abstained', source: 'rules', citations: [] };
  };
  const claim = (kind, minute, evidence, inputs, extra) => { run.n++; return MCC.claim(Object.assign({ id: 'c' + run.n, kind, minute, agent: 'analyst', evidence, inputs, source: 'rules' }, extra)); };

  // Watch's batch: the events first (so every recount sees the whole batch), then the moments, then the claims
  const onWatch = (key, events, moments) => {
    if (!run || key !== run.key) return;
    const rows = (events || []).map((ev) => { const r = MCC.event(ev, 'e' + (run.events.length + 1)); run.events.push(r); run.stat.events++; return r; });
    for (const m of moments || []) {
      run.moments.push(m); run.stat.moments++;
      if (PICK.includes(m.type)) { say('Producer', m.minute, 'Picked the ' + m.type.replace('_', ' ') + ' moment from Watch', ''); pipeline(claim('moment', m.minute, [m.id], { momentId: m.id, type: m.type, title: m.title, why: m.why })); }
    }
    for (const r of rows) {
      const t = teamIx(r.team);
      if (r.type === 'prediction') run.stat.predictions++;
      if (r.type === 'shot' && t >= 0) run.roll.xg[t] += r.data.xg || 0;
      if (r.type === 'goal' && t >= 0) { run.roll.score[t]++; pipeline(claim('score', r.minute, [r.id], { score: run.roll.score.slice(), scorer: r.player, teamName: teamName(t) })); }
      if (r.type === 'shot' && t >= 0 && r.data.xg >= 0.2) pipeline(claim('shot', r.minute, [r.id], { player: r.player, teamName: teamName(t), xg: r.data.xg, kind: r.data.kind || 'open play' }));
    }
    const last = rows.length ? rows[rows.length - 1].minute : null;
    if (last != null && last >= run.roll.nextXg) {
      pipeline(claim('xg_total', last, [], { xg: run.roll.xg.slice() }, { basis: 'every shot up to ' + min(last) }));
      run.roll.nextXg = Math.floor(last / 5) * 5 + 5;
    }
    changed();
  };

  // a new match from Watch (its start, or a fixture change) starts a new run, and the audit chain starts again with it
  // a claim or line from the live api (live.js): shown beside the rules claims, tagged with where it came from ('model' when the api says live, else 'rules')
  const ingest = (d, status) => {
    if (!run || !d) return;
    const src = status === 'live' ? 'model' : 'rules', last = run.events.length ? run.events[run.events.length - 1].minute : 0;
    // The api's stream (docs/architecture/12-api.md): `claim` events are the evidence (metric, value, approval_status);
    // `line` events walk one drafted line through drafted, verified, approved, published (or rejected, killed) for every audience;
    // `publication` events are the line a viewer of this stream's audience sees, published after the server Verifier and approval.
    // Only a claim or a publication becomes a card; a line event updates the publication it belongs to.
    const isLine = !!d.line_id && !d.publication_id && !d.claim_id;
    const id = d.claim_id || d.publication_id || (isLine ? 'pub-' + d.line_id : null) || (d.claim_ids && d.claim_ids[0]);
    if (!id) return;
    let c = run.claims.find((x) => x.id === id);
    if (!c && isLine) return;
    if (!c) {
      c = MCC.claim({ id, kind: d.metric || 'line', minute: last, agent: 'analyst', evidence: [], inputs: d.metric ? { metric: d.metric, value: d.value, units: d.units } : {}, source: src, api: true });
      if (d.publication_id) c.pub = true; else run.stat.claims++;   // a publication is the viewer-facing line, not evidence: it stays out of the claims ledger
      run.claims.push(c);
    }
    if (d.approval_status) { c.verdict = d.approval_status === 'approved' ? 'verified' : d.approval_status === 'pending' ? 'pending' : 'abstained'; c.reason = 'api: ' + d.approval_status; }
    if (d.publication_id) { c.verdict = 'verified'; c.reason = 'api: published after the server Verifier'; c.apiClaims = d.claim_ids || [];
      for (const cid of c.apiClaims) { const e = run.claims.find((x) => x.id === cid); if (e && e.api) { e.verdict = 'verified'; e.reason = 'api: published in ' + c.id; } } }   // the evidence behind a published line was approved
    if (isLine) {
      if (['abstained', 'rejected', 'killed'].includes(d.status)) { c.verdict = 'abstained'; c.reason = 'api: line ' + d.status; }
      if (Array.isArray(d.checks) && d.checks.length) c.apiChecks = d.checks;
      changed(); return;
    }
    if (d.audio_url) c.audioUrl = new URL(d.audio_url, LV.base || location.href).href;   // the api's Azure Speech mp3 for this line (EXP-8)
    if (d.text && d.text !== c.text) c.tr = {};   // the shown English line changed, so older translations no longer match it
    if (d.variants && typeof d.variants === 'object') {   // the api's translate-then-verify (PR 118): only checked translations arrive; a missing language keeps the rules fallback
      c.tr = c.tr || {};
      for (const l of ['es', 'hi']) if (typeof d.variants[l] === 'string' && d.variants[l].trim()) c.tr[l] = { ok: true, text: d.variants[l], reason: 'api: translated and re-checked', api: true };
    }
    if (d.text) { c.text = d.text; run.stat.lines++; say('Narrator', c.minute, c.id + ' · ' + d.text, ''); }
    if (d.status === 'approved') c.route = 'fan';
    c.source = src; changed();
  };
  const reset = (key, names) => { run = fresh(key, names); MCC.reset(); changed(); };
  return { ask, approve, kill, edit, checkTranslation, note: (agent, action, id, detail, minute) => MCC.append(agent, action, id, detail, minute), ...(window.MC_TEST ? { setTranslator: (fn) => { translator = fn || translator; } } : {}), get mode() { return mode; }, setMode: (m) => { mode = m; changed(); }, onAir: (fn) => { onAir = fn; }, reset, onWatch, ingest, seedBad: (on) => { seedBad = !!on; }, get seeding() { return seedBad; }, PICK, get run() { return run; }, onChange: (fn) => { changed = fn; } };
})();
