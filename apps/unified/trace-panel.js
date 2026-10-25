// ---- unified console: the trace panel (EXP-6). "How was this made?" for any line: Producer task, Analyst claim and tools, Narrator draft,
// Verifier verdict (and repair), Producer approval and publication, each with the time it took and whether rules or a model did it.
// Data: the claim's own trace (agents.js) and its audit records (contracts.js). Lines from the api show what the stream gave; the server trace arrives with it.
const TP = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmt = (ms) => (ms < 0.01 ? '<0.01 ms' : ms < 1 ? ms.toFixed(2) + ' ms' : ms < 100 ? ms.toFixed(1) + ' ms' : Math.round(ms) + ' ms');
  let dlg = null;
  const build = () => {
    const st = document.createElement('style');
    st.textContent = '#tp{border:1px solid var(--line,#2a3a52);border-radius:12px;background:var(--panel,#101b2c);color:var(--ink,#e8eef7);padding:0;width:min(560px,calc(100% - 32px));max-height:85vh}'
      + '#tp::backdrop{background:rgba(0,0,0,.55)}#tp header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line,#2a3a52)}#tp h3{margin:0;font-size:15px}'
      + '#tp .tp-x{background:transparent;border:1px solid var(--line,#2a3a52);color:inherit;border-radius:6px;padding:4px 10px;cursor:pointer}#tp .tp-b{padding:12px 16px;overflow:auto;max-height:calc(85vh - 56px)}'
      + '#tp .tp-line{margin:0 0 10px;font-size:13px}#tp ol{list-style:none;margin:0;padding:0 0 0 14px;border-left:2px solid var(--line,#2a3a52)}#tp li{position:relative;margin:0 0 12px;padding-left:12px;font-size:13px}'
      + '#tp li::before{content:"";position:absolute;left:-21px;top:5px;width:10px;height:10px;border-radius:50%;background:#8CC2FF}#tp li.bad::before{background:#F5B942}#tp li.ok::before{background:#8EE8B8}'
      + '#tp li b{text-transform:capitalize}#tp .m{color:var(--muted,#9fb0c2);font:11px ui-monospace,monospace}#tp .tag{font:600 10px ui-monospace,monospace;border:1px solid var(--line,#2a3a52);border-radius:4px;padding:0 5px;margin-left:6px}#tp .note{font-size:12px;color:var(--muted,#9fb0c2)}';
    document.head.appendChild(st);
    dlg = document.createElement('dialog'); dlg.id = 'tp'; dlg.setAttribute('aria-labelledby', 'tp-h');
    dlg.innerHTML = '<header><h3 id="tp-h">How was this made?</h3><button class="tp-x" type="button">Close</button></header><div class="tp-b"></div>';
    dlg.querySelector('.tp-x').onclick = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.appendChild(dlg);
  };
  // the steps for one claim, in order, as plain rows (also what the tests read)
  const steps = (c) => (c.trace || []).map((s) => s.agent + ':' + s.step);
  const html = (c) => {
    const rows = (c.trace || []);
    const body = rows.length ? '<ol>' + rows.map((s) => {
      const bad = s.step === 'repair' || s.step === 'hold' || (s.step === 'verdict' && !/^verified/.test(s.detail || ''));
      return '<li class="' + (bad ? 'bad' : s.step === 'verdict' || s.step === 'approval' ? 'ok' : '') + '" data-agent="' + s.agent + '" data-step="' + s.step + '"><b>' + esc(s.agent) + '</b> · ' + esc(s.step)
        + '<span class="tag">' + (s.mode === 'model' ? 'model' : 'rules') + '</span><span class="m"> ' + fmt(s.ms) + (s.tokens != null ? ' · ' + s.tokens + ' tokens' : s.mode === 'model' ? ' · tokens: not reported' : ' · no tokens (rules)') + '</span>'
        + (s.tools && s.tools.length ? '<div class="m">tools: ' + s.tools.map(esc).join(', ') + '</div>' : '') + '<div>' + esc(s.detail || '') + '</div>'
        + (s.was ? '<div class="m">was ' + esc(MCC.canon(s.was)) + ' → now ' + esc(MCC.canon(s.now)) + '</div>' : '') + '</li>';
    }).join('') + '</ol>' : '<p class="note">This line came from the agent api. Planned (AGT-3): the server trace is not connected yet; the claim and verdict below are what the stream carried.</p>';
    const aud = (c.audit || []).map((a) => '#' + a.seq + ' ' + a.hash).join(' · ');
    return '<p class="tp-line"><b>' + esc(c.id) + '</b> · ' + esc(c.text || '') + '</p>' + body
      + '<p class="note">Verdict: ' + esc(c.verdict) + (c.repaired ? ' (repaired once)' : '') + ' · Source: ' + (c.source === 'model' ? 'model' : 'rules') + (aud ? ' · Audit ' + esc(aud) : '') + '</p>';
  };
  // CREW-6.2 (AB#444), behind ?evidence=1: the evidence behind a line. Agents and tool calls come from the claim's trace; data rows are the match events (or the moment) its
  // evidence ids point at; history rows (CREW-2.2) are not built, so the panel says so; audit hashes are checked against the chain. A line from the api carries none of this
  // yet (claim-level event ids arrive with AB#498), and the panel says that instead of showing a guess.
  const FLAG = /[?&]evidence=1(&|$)/.test(location.search);
  // AB#498: a crew_trace frame for a line (proposal: matchcast-v2/vision/interfaces/crew-frames-proposal.md; field names may still change). fromFrame is the only place that knows them.
  const CT = new Map();   // line_id -> the line's trace, in the panel's own words; only for the run on screen, at most CAP lines
  const CAP = 500, ROWS = 50;
  const fromFrame = (f) => {
    const cl = (Array.isArray(f.claims) ? f.claims : []).filter((k) => k && typeof k === 'object'), v = f.verifier && typeof f.verifier === 'object' ? f.verifier : {};
    const id = (x) => (typeof x === 'string' && x) || (Number.isFinite(x) ? String(x) : '');
    const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).map(id).filter(Boolean))];
    return { line: id(f.line_id), state: f.state || '', feed: f.feed || '',
      claims: cl.map((k) => ({ id: id(k.claim_id) })), events: uniq(cl.flatMap((k) => (Array.isArray(k.source_event_ids) ? k.source_event_ids : []))), history: uniq(cl.flatMap((k) => (Array.isArray(k.history_row_ids) ? k.history_row_ids : []))),
      verdict: v.verdict || '', reason: v.reason_code || '', checks: Array.isArray(v.checks) ? v.checks : [], repairOf: id(f.repair_of), called: Array.isArray(f.called) ? f.called : [], audit: f.audit_hash || '' };
  };
  // a published line's card is `pub-<line id>`: match by line id only. A claim card is cited by several lines, so it takes no line's trace (open the trace from the published line).
  const crewFor = (c) => { const t = String(c.id).startsWith('pub-') || c.pub ? CT.get(String(c.id).replace(/^pub-/, '')) : null; return t && t.run === AG.run ? t : null; };
  const histRow = (id) => { const m = /^results:(\d+)$/.exec(id); return m ? { label: 'results row ' + m[1], value: '', dataset: 'data/history/results.csv · the row is not loaded in this page' } : { label: id, value: '', dataset: '' }; };
  // the api's own event ids (live.js numbers only the events it sent) are looked up in live.js's table of what it sent, never matched to the page's own ids, which count every event
  const apiRow = (id) => {
    const e = typeof LV !== 'undefined' && LV.apiEvent ? LV.apiEvent(id) : null;
    return e ? { id, text: Math.floor(e.minute) + "' " + String(e.type).replace(/_/g, ' ') + (e.player ? ' · ' + e.player : '') + (e.team ? ' (' + e.team + ')' : '') } : { id, text: 'an api event id this page did not send' };
  };
  const evidence = (c) => {
    const r = AG.run, chain = MCC.records();
    const tr = c.trace || [], crew = c.api ? crewFor(c) : null;
    const rows = crew ? crew.events.slice(0, ROWS).map(apiRow) : (c.evidence || []).map((id) => {
      const e = r.events.find((x) => x.id === id), m = !e && r.moments.find((x) => x.id === id);
      return e ? { id, text: Math.floor(e.minute) + "' " + String(e.type).replace(/_/g, ' ') + (e.player ? ' · ' + e.player : '') + (e.team ? ' (' + e.team + ')' : '') }
        : m ? { id, text: Math.floor(m.minute) + "' moment · " + (m.title || m.type) } : { id, text: 'not in the event log' };
    });
    const audit = (c.audit || []).map((a) => { const rec = chain[a.seq - 1]; return { seq: a.seq, hash: a.hash, ok: !!rec && typeof a.hash === 'string' && a.hash.length >= 12 && rec.ref === c.id && rec.hash.slice(0, a.hash.length) === a.hash, action: rec ? rec.agent + ' ' + rec.action : '' }; });
    return { api: !!c.api, crew, more: crew ? Math.max(0, crew.events.length - ROWS) : 0, agents: crew ? crew.called : [...new Set(tr.map((s) => s.agent))], tools: [...new Set(tr.flatMap((s) => s.tools || []))], rows, history: crew ? crew.history.map(histRow) : c.history || null, audit };
  };
  // what the frame adds: where the line stands, the server Verifier's verdict and reason, the line it repairs, and the api's audit hash (the api's own chain, which this page cannot recompute)
  const crewHtml = (t) => '<p class="tp-state"><b>State</b> ' + esc(t.state || 'unknown') + (t.feed ? ' · feed ' + esc(t.feed) : '') + (t.state === 'dropped' ? ' <span class="m">· the text is in the audit chain, not shown here</span>' : '') + '</p>'
    + '<p class="tp-verifier"><b>Server Verifier</b> <span class="m">(as the api reports it)</span> ' + esc(t.verdict || 'no verdict sent') + (t.reason ? ' · reason ' + esc(t.reason) : '') + (t.checks.length ? ' <span class="m">· checks ' + t.checks.map(esc).join(', ') + '</span>' : '') + '</p>'
    + (t.repairOf ? '<p class="tp-repair"><b>Repair</b> repairs ' + esc(t.repairOf) + '</p>' : '')
    + (t.audit ? '<p class="tp-crew-audit"><b>Api audit hash</b> <code>' + esc(t.audit) + '</code> <span class="m">· the api\'s chain, not recomputed in this page</span></p>' : '');
  const evidenceHtml = (c) => {
    const x = evidence(c);
    const planned = '<span class="m">Planned (AB#498): the api does not send its agents, tool calls or event ids on the stream yet.</span>';
    return '<section class="tp-evidence"><h4>Evidence</h4>'
      + (x.crew ? crewHtml(x.crew) : '')
      + '<p class="tp-agents"><b>Agents</b> ' + (x.api && !x.crew ? planned : x.agents.length ? x.agents.map(esc).join(' → ') : '<span class="m">none recorded</span>') + '</p>'
      + '<p class="tp-tools"><b>Tool calls</b> ' + (x.api ? (x.crew ? '<span class="m">Planned (AB#498): tool names are in the api\'s audit records, not on the crew_trace frame.</span>' : planned) : x.tools.length ? x.tools.map(esc).join(', ') : '<span class="m">none reported</span>') + '</p>'
      + '<p><b>Data rows</b></p>' + (x.rows.length ? '<ol class="tp-rows">' + x.rows.map((o) => '<li data-id="' + esc(o.id) + '">' + esc(o.text) + ' <span class="m">' + esc(o.id) + '</span></li>').join('') + '</ol>' + (x.more ? '<p class="m">+' + x.more + ' more event ids not listed</p>' : '')
        : '<p class="m">' + (x.api ? (x.crew ? 'The api cites no event for this line.' : 'Planned (AB#498): the api does not send claim-level event ids yet.') : 'This line cites no single event (a running total over the shots up to its minute).') + '</p>')
      + '<p class="tp-history"><b>History rows</b> ' + (x.history && x.history.length ? x.history.map((h) => esc(h.label) + ' ' + esc(h.value) + ' <span class="m">' + esc(h.dataset || '') + '</span>').join(' · ') : x.crew ? '<span class="m">none cited by this line</span>' : '<span class="m">none used. Planned (CREW-2.2): head-to-head and Elo rows are not built yet.</span>') + '</p>'
      + '<p><b>Audit</b></p>' + (x.audit.length ? '<ol class="tp-audit">' + x.audit.map((a) => '<li class="' + (a.ok ? 'ok' : 'bad') + '">#' + esc(a.seq) + ' <code>' + esc(a.hash) + '</code> ' + esc(a.action) + ' · ' + (a.ok ? 'matches the chain record' : 'no matching chain record') + '</li>').join('') + '</ol>' : '<p class="m">no audit record yet (they are written as each agent acts; reopen to refresh)</p>')
      + '<p class="tp-chain note">Checking the chain…</p></section>';
  };
  let cur = null;   // the card the open panel shows, so a frame that arrives late can refresh it
  const open = (id) => {
    const r = AG.run; if (!r) return false;
    const c = r.claims.find((x) => x.id === id); if (!c) return false;
    cur = id;
    if (!dlg) build();
    const body = dlg.querySelector('.tp-b');
    body.innerHTML = html(c) + (FLAG ? evidenceHtml(c) : '');
    if (FLAG) MCC.verify().then((v) => { const el = body.querySelector('.tp-chain'); if (el) el.textContent = v.ok ? 'Chain intact: ' + v.count + ' records (in-page chain, recomputed now)' : 'Chain broken at record #' + v.brokenAt; }).catch(() => { const el = body.querySelector('.tp-chain'); if (el) el.textContent = 'The chain check could not run in this browser'; });
    if (!dlg.open) dlg.showModal();
    return true;
  };
  // the stream hook (live.js calls window.mcCrewTrace for each crew_trace frame): kept only with ?evidence=1 and only for the run on screen
  const crewTrace = (f) => {
    if (!FLAG || !f || typeof f !== 'object') return false;
    const t = fromFrame(f); if (!t.line || !AG.run) return false;
    t.run = AG.run;   // a frame belongs to the run on screen; a new match drops the old ones
    for (const [k, o] of CT) if (o.run !== AG.run) CT.delete(k);
    CT.delete(t.line); CT.set(t.line, t);
    if (CT.size > CAP) CT.delete(CT.keys().next().value);
    const card = cur && dlg && dlg.open && AG.run.claims.find((x) => x.id === cur);
    if (card && crewFor(card) === t) open(cur);   // only the line on screen is redrawn
    return true;
  };
  window.mcCrewTrace = crewTrace;
  return { open, steps, html, evidence, crewTrace };
})();
