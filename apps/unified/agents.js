// ---- unified console: the agents. One pipeline, shared by Watch, Analyst and Broadcast. The page's rules agents run here; the live api's claims arrive through ingest.
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
  let mode = 'producer', onAir = () => {};   // producer (the default): a person approves each line first; demo: verified lines air at once

  const fresh = (key, names) => ({ key, names, events: [], moments: [], claims: [], feed: [], n: 0,
    roll: { score: [0, 0], xg: [0, 0], nextXg: 0.25 },
    stat: { events: 0, claims: 0, verified: 0, repaired: 0, abstained: 0, moments: 0, predictions: 0, lines: 0, dropped: 0 }, aired: new Set() });
  const teamIx = (k) => (!run || k == null) ? -1 : k === run.names.hk ? 0 : k === run.names.ak ? 1 : -1;
  const teamName = (t) => (t === 0 ? run.names.home : run.names.away);
  const clockOf = (m) => '0:' + String(Math.floor(m * 60 + 1e-6)).padStart(2, '0');   // before minute 1 the match time reads as a clock (0:15), never as minute 0
  const min = (m) => (m < 1 ? clockOf(m) : Math.floor(m) + "'");
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
  let translator = (c, lang) => { const f = TPL[lang] && TPL[lang][c.kind]; return f ? f(Object.assign({ H: run.names.home, A: run.names.away }, c.inputs), c.minute < 1 ? clockOf(c.minute) : Math.floor(c.minute)) : null; };
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
    c.wasText = c.text; Object.assign(c.inputs, rc); c.text = narrate(c);
    trace(c, 'verifier', 'repair', t1, { detail: 'differed from the event log; rewrote the line from the recount', was, now: rc });
    log(c, 'verifier', 'repair', { was, now: rc });
    return { verdict: 'verified', repaired: true, reason: 'differed from the event log; repaired from it once' };
  };

  // wild moments are deterministic triggers; the Producer makes them priority 1 and the line still goes through the Verifier
  const ALERTS = { red_card: 'Red card', turning_point: 'Turning point' };
  // the steps are the agents' own trace (who did what, and whether by a model or the rules): the Broadcast desk shows them as the orchestration strip
  const air = (c) => ({ id: c.id, minute: c.minute, text: c.airText || c.text || (c.escalated ? textNote(c) : c.text), was: c.wasText || null, aired_ms: Math.round(clock() - (c.born || clock())), alert: c.alert || null, verdict: c.verdict, repaired: !!c.repaired, tr: c.airText ? null : (c.tr || null), steps: (c.trace || []).map((s) => ({ agent: s.agent, step: s.step, mode: s.mode })), numbers: Object.entries(c.inputs || {}).filter(([, v]) => typeof v === 'number').slice(0, 4).map(([name, value]) => ({ name, value })) });   // an edited line has no checked translation
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
  // a line the Verifier could not repair never airs: a person can kill it, but not approve or reword it (its numbers are the ones that failed)
  const held = (c) => (c.escalated ? { ok: false, reason: 'the Verifier could not check this line: kill it' } : null);
  const approve = (id, who) => act(id, who, 'line_approved', {}, (c) => {
    if (held(c)) return held(c);
    c.approval = 'approved'; c.approvedBy = who; onAir(air(c)); return { ok: true };
  });
  const kill = (id, who, reason) => act(id, who, 'line_killed', { reason: reason || '' }, (c) => { c.approval = 'killed'; c.approvedBy = who; return { ok: true }; });
  // an edit may reword, but every number in it must already be in the verified line, so it cannot add a fact
  const edit = (id, who, text) => act(id, who, 'line_edited', { text }, (c) => {
    if (held(c)) return held(c);
    const ok = new Set(nums(c.text).concat(nums(min(c.minute))));
    const bad = nums(text).filter((n) => !ok.has(n));
    if (!text.trim() || bad.length) return { ok: false, reason: 'not aired: ' + (bad.length ? 'number ' + bad[0] + ' is not in the verified line' : 'empty line') };
    c.airText = text.trim(); c.approval = 'approved'; c.approvedBy = who; onAir(air(c)); return { ok: true };
  });

  // one claim through the pipeline: Analyst claims it, Narrator writes it, Verifier checks it, Producer routes or holds it
  const pipeline = (c) => {
    let t = clock();
    c.born = t; c.trace = [];   // born: when the pipeline picked the claim; event-to-air counts from here, so it includes any wait for approval
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
  // Ask, counts (rules): "how many passes has Ana made", "shots for Ridgeview", "who has the most fouls". Counted from the event log, with the events it used cited.
  const COUNTS = [[/\b(goals?|scored|scorers?)\b/, ['goal'], 'goal', 'goals'], [/\bshots?\b/, ['shot'], 'shot', 'shots'], [/\bpass(es)?\b/, ['pass'], 'pass', 'passes'], [/\bfouls?\b/, ['foul'], 'foul', 'fouls'],
    [/\bcorners?\b/, ['corner'], 'corner', 'corners'], [/\btackles?\b/, ['slide_tackle'], 'tackle', 'tackles'], [/\b(cards?|booked|booking|bookings)\b/, ['yellow_card', 'red_card'], 'card', 'cards']];
  // a qualifier the counts do not model (long balls, set pieces, halves, a span of minutes): the answer abstains rather than counting everything
  const QUALIFIED = /\b(long|short|crosses?|cross|headers?|free kicks?|penalty|penalties|inside|outside|first half|second half|since)\b|\blast \d+/;
  const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentioned = (s, name) => new RegExp('(^|[^\\p{L}])' + escapeRe(name.toLowerCase()) + '($|[^\\p{L}])', 'u').test(s);
  const countOf = (s, last) => {
    const hit = COUNTS.find(([re]) => re.test(s)); if (!hit) return null;
    const [, types, one, many] = hit, ended = min(last);
    if (QUALIFIED.test(s)) return null;
    if (/\bon target\b/.test(s) && !types.includes('shot')) return null;
    const pool = /\bon target\b/.test(s) ? run.events.filter((e) => e.type === 'shot' && e.data && (e.data.fate === 'goal' || e.data.fate === 'save')) : run.events.filter((e) => types.includes(e.type));
    const players = [...new Set(run.events.map((e) => e.player).filter(Boolean))];
    const full = players.find((p) => mentioned(s, p));
    const bySurname = players.filter((p) => mentioned(s, p.split(' ').slice(-1)[0]));
    const named = full || (bySurname.length === 1 ? bySurname[0] : null);
    if (!named && bySurname.length > 1) return null;   // two players share the surname: ask again with the full name
    const concede = /\bconcede[sd]?\b/.test(s), lead = /\b(most|top|leads?|leading|who)\b/.test(s);
    const sides = [0, 1].filter((i) => mentioned(s, teamName(i)));
    if (named) {
      if (concede) return null;   // a player does not concede goals
      const club = run.events.find((e) => e.player === named), team = club ? teamName(teamIx(club.team)) : '';
      const ids = pool.filter((e) => e.player === named).map((e) => e.id);
      return { text: named + (team ? ' (' + team + ')' : '') + ' has ' + ids.length + ' ' + (ids.length === 1 ? one : many) + ' by ' + ended + '.', verdict: 'verified', source: 'rules', citations: ids };
    }
    if (sides.length > 1) return null;   // two clubs named: the question is about a pairing, which the counts do not answer
    const side = sides.length ? sides[0] : null;
    if (side != null && concede) {   // goals a side conceded are the other side's goals
      if (!types.includes('goal')) return null;
      const ids = run.events.filter((e) => e.type === 'goal' && teamIx(e.team) === 1 - side).map((e) => e.id);
      return { text: teamName(side) + ' have conceded ' + ids.length + ' ' + (ids.length === 1 ? one : many) + ' by ' + ended + '.', verdict: 'verified', source: 'rules', citations: ids };
    }
    if (side != null && !lead) {
      const ids = pool.filter((e) => teamIx(e.team) === side).map((e) => e.id);
      return { text: teamName(side) + ' have ' + ids.length + ' ' + (ids.length === 1 ? one : many) + ' by ' + ended + '.', verdict: 'verified', source: 'rules', citations: ids };
    }
    if (!lead) return null;
    if (side == null && /\bteams?\b/.test(s)) {   // "which team has the most goals": the club totals decide
      const totals = [0, 1].map((i) => pool.filter((e) => teamIx(e.team) === i).map((e) => e.id));
      const top = totals[0].length === totals[1].length ? null : totals[0].length > totals[1].length ? 0 : 1;
      if (top == null) return null;
      return { text: teamName(top) + ' have the most ' + many + ' by ' + ended + ': ' + totals[top].length + '.', verdict: 'verified', source: 'rules', citations: totals[top] };
    }
    const m = new Map(); for (const e of pool) if (e.player && (side == null || teamIx(e.team) === side)) { const k = e.player + '|' + e.team; m.set(k, (m.get(k) || []).concat(e.id)); }
    const best = [...m.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (!best) return null;
    const [p, t] = best[0].split('|');
    return { text: p + ' (' + teamName(teamIx(t)) + ') leads with ' + best[1].length + ' ' + many + ' by ' + ended + '.', verdict: 'verified', source: 'rules', citations: best[1] };
  };
  const ask = (q) => {
    if (!run || !run.events.length) return { text: CANT, verdict: 'abstained', source: 'rules', citations: [] };
    const s = String(q).toLowerCase(), last = run.events[run.events.length - 1].minute, ix = (t) => teamName(teamIx(t));
    let top;
    const counted = countOf(s, last); if (counted) return counted;   // counts first: "scored" is a goal count, not the score
    if (/shots?/.test(s) && /(most|top|more|leads?|who)/.test(s) && (top = tally('shot')).length) {
      const t = top[0]; return { text: t.player + ' (' + ix(t.team) + ') has the most shots: ' + t.n + ' by ' + min(last) + '.', verdict: 'verified', source: 'rules', citations: t.ids };
    }
    if (/\bgoals?\b|\bscor(e|er|ers)\b/.test(s) && /\b(most|top|who|scorer)\b/.test(s) && (top = tally('goal')).length) {
      const t = top[0]; return { text: t.player + ' (' + ix(t.team) + ') leads the scoring with ' + t.n + ' by ' + min(last) + '.', verdict: 'verified', source: 'rules', citations: t.ids };
    }
    if (/\bscore\b|\bwinning\b|\bleading\b/.test(s)) { const g = run.roll.score; return { text: run.names.home + ' ' + g[0] + '–' + g[1] + ' ' + run.names.away + ' at ' + min(last) + '.', verdict: 'verified', source: 'rules', citations: run.events.filter((e) => e.type === 'goal').map((e) => e.id) }; }
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
      run.roll.nextXg = Math.max(5, Math.floor(last / 5) * 5 + 5);   // the first running total comes after 15 match seconds (0:15) so the first checked line is early (first-load budget); the Verifier still recounts it from the event log. Then every five minutes
    }
    changed();
  };

  // A line the server Verifier dropped (contract 1.2.0 `feed_drop`, docs/contracts.md): a card in the Agents tab with the Verifier's closed reason_code and the api's audit_id.
  // Its text is not on the stream (it stays in the audit chain), so the card has none. A line that aired is never turned into a drop: a dropped translation is a note on it (trace-panel.js).
  const sstr = (x, n) => (typeof x === 'string' ? x : Number.isFinite(x) ? String(x) : '').slice(0, n || 120);
  // the onair record names the api events its line cites (source_event_ids): kept by publication id, so the line's Why panel can resolve them
  const noteAired = (id, d) => {
    if (!run || typeof id !== 'string' || !id) return;
    const k = id.slice(0, 200);
    run.aired.add(k);
    if (d && Array.isArray(d.source_event_ids)) { run.lineEvents = run.lineEvents || new Map(); run.lineEvents.set(k, d.source_event_ids.map((x) => sstr(x, 60)).filter(Boolean).slice(0, 50)); }
  };
  const ingestDrop = (d, status) => {
    if (!run || !d || typeof d !== 'object') return false;
    const id = sstr(d.publication_id, 200); if (!id) return false;
    if (d.reason_code === 'translation' || run.aired.has(id)) return false;   // a dropped translation means the English line aired; a line the page has seen air is not a drop
    let c = run.claims.find((x) => x.id === id);
    if (c && !c.dropped) return false;
    if (!c && run.stat.dropped >= 500) return false;
    const code = sstr(d.reason_code, 60), feed = sstr(d.feed, 40), ms = Number(d.match_time_ms);
    const fresh1 = !c;
    if (!c) {
      c = MCC.claim({ id, kind: 'dropped line', minute: Number.isFinite(ms) && ms >= 0 ? ms / 60000 : (run.events.length ? run.events[run.events.length - 1].minute : 0), agent: 'verifier', evidence: [], inputs: {}, source: status === 'live' ? 'model' : 'rules', api: true });
      c.dropped = true; c.pub = false; c.text = ''; c.approval = 'dropped'; c.route = 'dropped, not aired'; c.verdict = 'dropped'; c.seenAt = clock();
      run.claims.push(c); run.stat.dropped = (run.stat.dropped || 0) + 1;
      hop(c, 'verifier', 'dropped');
    }
    c.feed = feed; c.reasonCode = code; c.auditId = sstr(d.audit_id, 200); c.repairs = Number.isInteger(d.repair_count) && d.repair_count >= 0 ? d.repair_count : null;
    c.eventIds = (Array.isArray(d.source_event_ids) ? d.source_event_ids : []).map((x) => sstr(x, 60)).filter(Boolean).slice(0, 50);
    c.reason = 'Verifier dropped' + (code ? ' · ' + code : '') + (c.repairs ? ' after ' + c.repairs + ' repair' : '');
    if (fresh1) say('Verifier', c.minute, 'dropped a line on the ' + (feed || 'unnamed') + ' feed' + (code ? ': ' + code : '') + '. The text stays in the audit chain.', 'warn');
    changed(); return true;
  };

  // why the Verifier could not repair a line, in words a producer can act on (the keys are the api's escalating reason codes)
  const ESCALATION = { number_mismatch: 'a number does not match the event log', unknown_player: 'a player is not in the event log', unknown_source: 'it cites a source the event log does not have', stale_state: 'the match moved on before it was checked' };
  // a new match from Watch (its start, or a fixture change) starts a new run, and the audit chain starts again with it
  // a claim or line from the live api (live.js): shown beside the rules claims, tagged with where it came from ('model' when the api says live, else 'rules')
  // The open stream puts a placeholder where a line's text is withheld ('[awaiting checks]', '[not shown: ...]', '[withheld: ...]'). It is a state, never text:
  // it is dropped here, so no card, feed line, booth line or queue item carries it. A producer's GET /lines has an escalated line's text (loadText below).
  const placeholderOf = (t) => { const m = typeof t === 'string' ? /^\s*\[(withheld: refused by content safety|awaiting checks|not shown: did not pass its checks)\]\s*$/i.exec(t) : null; return m ? { w: 'withheld', a: 'checking', n: 'not_shown' }[m[1][0].toLowerCase()] : ''; };   // the api's three exact forms only: "[awaiting VAR]" is a line
  const isProducer = () => typeof LV !== 'undefined' && /^(Producer|Admin)$/.test(LV.role);
  const TEXT_NOTE = { withheld: 'withheld: refused by Content Safety', hidden: 'Text hidden: producer role needed', unavailable: 'Text not shown: could not be loaded', loading: 'Loading the text…' };
  const textNote = (c) => (c.safetyRefused ? TEXT_NOTE.withheld : TEXT_NOTE[c.textState] || TEXT_NOTE.loading);
  // an escalated card with no text asks the api for it once (cached on the card, so a replayed event adds no request), batched and throttled to one call every 2 s
  const tx = { want: [], timer: null, last: 0 };
  const loadText = (c) => {
    if (c.safetyRefused || c.textState) return;
    if (!isProducer() || run.textDenied) { c.textState = 'hidden'; return; }   // a 401 or 403 earlier in this match: the role is not there, so no more calls   // no request for a viewer who may not read it
    c.textState = 'loading'; tx.want.push({ run, c });
    if (tx.timer) return;
    tx.timer = setTimeout(async () => {
      tx.timer = null; tx.last = Date.now();
      const batch = tx.want.splice(0).filter((w) => w.run === run && w.c.approval === 'pending');   // a card killed before its turn needs no text
      if (!batch.length) return;
      let items = null, err = null;
      try { items = await LV.lineTexts(); } catch (e) { err = e; }
      for (const { run: r, c: card } of batch) {
        if (r !== run) continue;
        const it = items && items.find((x) => x && 'pub-' + x.line_id === card.id);
        if (err && (err.status === 403 || err.status === 401)) { card.textState = 'hidden'; run.textDenied = true; }   // unauthenticated (separate origins send no credentials) reads as no role
        else if (it && (it.reason_code === 'unsafe_content' || placeholderOf(it.text) === 'withheld')) card.safetyRefused = true;
        else if (it && typeof it.text === 'string' && it.text && !placeholderOf(it.text)) { card.text = it.text; card.textState = 'text'; }
        else card.textState = 'unavailable';
      }
      changed();
    }, Math.max(250, tx.last + 2000 - Date.now()));
  };
  const ingest = (d, status) => {
    if (!run || !d) return;
    const ph = placeholderOf(d.text);
    if (ph) d = Object.assign({}, d, { text: '', __ph: ph });
    const src = status === 'live' ? 'model' : 'rules', last = run.events.length ? run.events[run.events.length - 1].minute : 0;
    // The api's stream (docs/architecture/12-api.md): `claim` events are the evidence (metric, value, approval_status);
    // `line` events walk one drafted line through drafted, verified, approved, published (or rejected, killed) for every audience;
    // `publication` events are the line a viewer of this stream's audience sees, published after the server Verifier and approval.
    // Only a claim or a publication becomes a card; a line event updates the publication it belongs to.
    // A line the Verifier could not repair (status 'review', escalated) is the one line event that becomes a card: it waits for a person.
    const isLine = !!d.line_id && !d.publication_id && !d.claim_id;
    const escalated = isLine && !!d.escalated;   // status review alone is an ordinary line the Verifier did not verify: it makes no card
    const id = d.claim_id || d.publication_id || (isLine ? 'pub-' + d.line_id : null) || (d.claim_ids && d.claim_ids[0]);
    if (!id) return;
    let c = run.claims.find((x) => x.id === id);
    if (isLine) {   // a line names the claims behind it: its verdict and approval land on them, whether or not a publication exists yet
      for (const cid of d.claim_ids || []) {
        const e = run.claims.find((x) => x.id === cid && x.api); if (!e) continue;
        if (d.status === 'verified') { hop(e, 'verifier', 'verified'); }
        if (d.status === 'approved') { hop(e, 'producer', 'approved'); e.verdict = 'verified'; e.reason = 'api: line approved'; }
        if (['rejected', 'abstained'].includes(d.status)) { hop(e, 'verifier', 'rejected'); e.verdict = 'abstained'; e.reason = 'api: line ' + d.status; }
        if (d.status === 'killed') { hop(e, 'producer', 'killed'); e.verdict = 'abstained'; e.reason = 'api: line killed'; }
      }
    }
    if (!c && isLine && !escalated) { changed(); return; }
    if (!c) {
      c = MCC.claim({ id, kind: d.metric || 'line', minute: last, agent: 'analyst', evidence: [], inputs: d.metric ? { metric: d.metric, value: d.value, units: d.units } : {}, source: src, api: true });
      if (d.publication_id || isLine) c.pub = true; else run.stat.claims++;   // a publication or a line is the viewer-facing text, not evidence: it stays out of the claims ledger
      run.claims.push(c);
      c.seenAt = clock();
      if (!c.pub) hop(c, 'analyst', 'claim');
    }
    if (d.publication_id) {   // the line aired: the page now knows it, and a drop card made before its publication arrived becomes the published line it is
      run.aired.add(String(d.publication_id).slice(0, 200));
      if (c.dropped) { c.dropped = false; c.pub = true; c.kind = 'line'; c.agent = 'analyst'; c.approval = undefined; c.route = null; c.reasonCode = ''; run.stat.dropped = Math.max(0, run.stat.dropped - 1); }
    }
    // contract 1.2.0 optional claim fields (docs/contracts.md, Derived feed lines): ids only, kept for the evidence trace
    if (Array.isArray(d.tool_call_ids)) c.toolCallIds = d.tool_call_ids.filter((x) => typeof x === 'string').slice(0, 50);
    if (Array.isArray(d.evidence_ids)) c.evidenceIds = d.evidence_ids.filter((x) => typeof x === 'string').slice(0, 50);
    if (typeof d.trace_id === 'string') c.traceId = d.trace_id.slice(0, 120);
    // the claim record's basis (docs/contracts.md): its units, the stream sequence it counts to and its derivation version; a Why panel shows these, since the api sends no event ids on a claim
    if (d.claim_id && d.metric) c.basis = { units: d.units || '', through: Number.isInteger(d.max_evidence_sequence) ? d.max_evidence_sequence : null, derivation: typeof d.derivation_version === 'string' ? d.derivation_version : '', approval: typeof d.approval_status === 'string' ? d.approval_status : '' };
    if (d.approval_status) { c.verdict = d.approval_status === 'approved' ? 'verified' : d.approval_status === 'pending' ? 'pending' : 'abstained'; c.reason = 'api: ' + d.approval_status; if (c.verdict === 'verified') hop(c, 'verifier', 'verified'); }
    if (d.publication_id) { c.verdict = 'verified'; c.reason = 'api: published after the server Verifier'; c.apiClaims = d.claim_ids || [];
      for (const cid of c.apiClaims) { const e = run.claims.find((x) => x.id === cid); if (e && e.api) { e.verdict = 'verified'; e.reason = 'api: published in ' + c.id; hop(e, 'verifier', 'verified'); if (d.text) hop(e, 'narrator', 'draft'); hop(e, 'producer', 'publication'); } } }   // the evidence behind a published line was approved
    if (isLine) {
      if (['abstained', 'rejected', 'killed'].includes(d.status)) { c.verdict = 'abstained'; c.reason = 'api: line ' + d.status; if (c.approval === 'pending') c.approval = 'killed'; }   // the api took it off the queue
      if (d.status === 'verified') hop(c, 'verifier', 'verified');
      if (d.status === 'approved') hop(c, 'producer', 'approved');
      if (escalated) {   // the Verifier could not check it, so it is held: a person may kill it, but nothing airs it (approve and edit refuse it)
        const wasEscalated = !!c.escalated;
        c.escalated = true; c.escalation = ESCALATION[d.reason_code] || 'the Verifier could not repair it';
        c.born = c.born || clock(); c.trace = c.trace || []; c.text = d.text || c.text; c.lineId = String(d.line_id).slice(0, 200); if (d.reason_code === 'unsafe_content' || d.__ph === 'withheld') c.safetyRefused = true; c.verdict = 'abstained'; c.reason = 'api: could not repair';   /* the open stream withholds an unverified line's text (a placeholder starts with '['); the producer's GET /lines has it */
        if (!c.approval) c.approval = 'pending';
        if (!c.text) loadText(c);
        if (!wasEscalated) trace(c, 'verifier', 'escalated', clock(), { detail: c.escalation + ': a person decides' });   // a replayed event does not add a second step
      }
      if (Array.isArray(d.checks) && d.checks.length) c.apiChecks = d.checks;
      changed(); return;
    }
    if (d.audio_url) c.audioUrl = new URL(d.audio_url, LV.base || location.href).href;   // the api's Azure Speech mp3 for this line (EXP-8)
    if (d.text && d.text !== c.text) c.tr = {};   // the shown English line changed, so older translations no longer match it
    if (d.variants && typeof d.variants === 'object') {   // the api's translate-then-verify (PR 118): only checked translations arrive; a missing language keeps the rules fallback
      c.tr = c.tr || {};
      for (const l of Object.keys(d.variants)) if (window.MC_LANGS.includes(l) && typeof d.variants[l] === 'string' && d.variants[l].trim()) c.tr[l] = { ok: true, text: d.variants[l], reason: 'api: translated and re-checked', api: true };   // ADR-0023: every language the api checked
    }
    // the stream repeats a line on every status step and audience: the Live flow and commentary take each distinct line once
    if (d.text) { c.text = d.text; c.said = c.said || new Set(); if (!c.said.has(d.text)) { c.said.add(d.text); run.stat.lines++; hop(c, 'narrator', 'draft'); say('Narrator', c.minute, c.id + ' · ' + d.text, ''); CM.api(d.text, d.event_time_ms != null ? +d.event_time_ms / 60000 : last, d.metric, d.publication_id, typeof d.persona === 'string' && d.persona.startsWith('booth:') ? d.persona.slice(6) : ''); } }   // the api's checked line also joins the commentary
    if (d.status === 'approved') c.route = 'fan';
    changed();   // the claim's source was set when it arrived: a later status change (say, a rules fallback) does not rewrite how its earlier steps were made
  };
  const reset = (key, names) => { run = fresh(key, names); MCC.reset(); changed(); };
  // the handoffs of a claim that came from the api (its rules trace is `trace`): one entry per agent and step, the first time it happens, with the time since the claim arrived
  const hop = (c, agent, step) => {
    c.hops = c.hops || [];
    if (c.hops.some((h) => h.agent === agent && h.step === step)) return;
    c.hops.push({ agent, step, mode: c.source === 'model' ? 'model' : 'rules', ms: c.seenAt != null ? +(clock() - c.seenAt).toFixed(0) : null });
  };
  const queue = () => (run ? run.claims.filter((c) => c.approval === 'pending').map((c) => Object.assign(air(c), { approval: 'pending', waiting_ms: Math.round(clock() - c.born), escalated: !!c.escalated, escalation: c.escalation || null })) : []);
  return { ask, approve, kill, edit, checkTranslation, note: (agent, action, id, detail, minute) => MCC.append(agent, action, id, detail, minute), ...(window.MC_TEST ? { setTranslator: (fn) => { translator = fn || translator; } } : {}), queue, textNote, get mode() { return mode; }, setMode: (m) => { mode = m; if (mode === 'demo' && run) for (const c of run.claims.filter((x) => x.approval === 'pending' && !x.escalated)) approve(c.id, 'Auto-air'); changed(); }, onAir: (fn) => { onAir = fn; }, reset, onWatch, ingest, ingestDrop, noteAired, seedBad: (on) => { seedBad = !!on; }, get seeding() { return seedBad; }, PICK, get run() { return run; }, onChange: (fn) => { changed = fn; } };
})();
