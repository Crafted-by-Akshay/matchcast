// ---- unified console: the agents. One pipeline, shared by Watch, Analyst and Broadcast. Rules-based and simulated: no Foundry call yet.
// Producer picks moments and routes approved lines. Analyst turns events into claims. Narrator writes each line from the claim's inputs.
// Verifier recounts every claim from the raw event log, repairs it once from that recount, or abstains. Predictor is a tool; the Data Scientist runs on demand.
const AG = (() => {
  const PICK = ['goal', 'red_card', 'big_chance', 'turning_point', 'milestone'];   // the moments the Producer airs
  let run = null, changed = () => {};

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
    const was = Object.assign({}, c.inputs);
    Object.assign(c.inputs, rc); c.text = narrate(c);
    log(c, 'verifier', 'repair', { was, now: rc });
    return { verdict: 'verified', repaired: true, reason: 'differed from the event log; repaired from it once' };
  };

  // one claim through the pipeline: Analyst claims it, Narrator writes it, Verifier checks it, Producer routes or holds it
  const pipeline = (c) => {
    run.claims.push(c); run.stat.claims++;
    log(c, 'analyst', 'claim', { kind: c.kind, inputs: c.inputs, evidence: c.evidence, basis: c.basis || null });
    c.text = narrate(c); run.stat.lines++;
    say('Analyst', c.minute, c.id + ' · ' + c.text, '');
    const v = verify(c);
    Object.assign(c, { verdict: v.verdict, repaired: v.repaired, reason: v.reason });
    log(c, 'verifier', 'verdict', { verdict: v.verdict, repaired: v.repaired });
    if (v.repaired) run.stat.repaired++;
    say('Verifier', c.minute, c.id + ' ' + v.verdict + ': ' + v.reason, v.verdict === 'verified' ? 'ok' : 'warn');
    if (v.verdict === 'verified') {
      run.stat.verified++;
      c.route = c.kind === 'xg_total' ? 'analyst' : c.kind === 'shot' ? 'fan' : 'broadcast';
      log(c, 'producer', 'approve', { route: c.route });
      say('Producer', c.minute, c.id + ' approved for the ' + c.route + ' view', 'ok');
    } else {
      run.stat.abstained++;
      log(c, 'producer', 'hold', { reason: v.reason });
      say('Producer', c.minute, c.id + ' held: ' + v.reason, 'warn');
    }
  };
  const claim = (kind, minute, evidence, inputs, extra) => { run.n++; return MCC.claim(Object.assign({ id: 'c' + run.n, kind, minute, agent: 'analyst', evidence, inputs }, extra)); };

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
  const reset = (key, names) => { run = fresh(key, names); MCC.reset(); changed(); };
  return { reset, onWatch, PICK, get run() { return run; }, onChange: (fn) => { changed = fn; } };
})();
