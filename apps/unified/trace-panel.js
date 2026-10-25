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
  const evidence = (c) => {
    const r = AG.run, chain = MCC.records();
    const tr = c.trace || [];
    const rows = (c.evidence || []).map((id) => {
      const e = r.events.find((x) => x.id === id), m = !e && r.moments.find((x) => x.id === id);
      return e ? { id, text: Math.floor(e.minute) + "' " + String(e.type).replace(/_/g, ' ') + (e.player ? ' · ' + e.player : '') + (e.team ? ' (' + e.team + ')' : '') }
        : m ? { id, text: Math.floor(m.minute) + "' moment · " + (m.title || m.type) } : { id, text: 'not in the event log' };
    });
    const audit = (c.audit || []).map((a) => { const rec = chain[a.seq - 1]; return { seq: a.seq, hash: a.hash, ok: !!rec && rec.ref === c.id && rec.hash.slice(0, a.hash.length) === a.hash, action: rec ? rec.agent + ' ' + rec.action : '' }; });
    return { api: !!c.api, agents: [...new Set(tr.map((s) => s.agent))], tools: [...new Set(tr.flatMap((s) => s.tools || []))], rows, history: c.history || null, audit };
  };
  const evidenceHtml = (c) => {
    const x = evidence(c);
    const none = x.api && !x.rows.length;
    return '<section class="tp-evidence"><h4>Evidence</h4>'
      + '<p class="tp-agents"><b>Agents</b> ' + (x.agents.length ? x.agents.map(esc).join(' → ') : '<span class="m">not in the stream (Planned, AGT-3)</span>') + '</p>'
      + '<p class="tp-tools"><b>Tool calls</b> ' + (x.tools.length ? x.tools.map(esc).join(', ') : '<span class="m">none reported</span>') + '</p>'
      + '<p><b>Data rows</b></p>' + (x.rows.length ? '<ol class="tp-rows">' + x.rows.map((o) => '<li data-id="' + esc(o.id) + '">' + esc(o.text) + ' <span class="m">' + esc(o.id) + '</span></li>').join('') + '</ol>'
        : '<p class="m">' + (none ? 'Planned (AB#498): the api does not send claim-level event ids yet.' : 'This line cites no single event (a running total over the whole match).') + '</p>')
      + '<p class="tp-history"><b>History rows</b> ' + (x.history && x.history.length ? x.history.map((h) => esc(h.label) + ' ' + esc(h.value) + ' <span class="m">' + esc(h.dataset || '') + '</span>').join(' · ') : '<span class="m">none used. Planned (CREW-2.2): head-to-head and Elo rows are not built yet.</span>') + '</p>'
      + '<p><b>Audit</b></p>' + (x.audit.length ? '<ol class="tp-audit">' + x.audit.map((a) => '<li class="' + (a.ok ? 'ok' : 'bad') + '">#' + a.seq + ' <code>' + esc(a.hash) + '</code> ' + esc(a.action) + ' · ' + (a.ok ? 'in the chain' : 'not in the chain') + '</li>').join('') + '</ol>' : '<p class="m">no audit record yet</p>')
      + '<p class="tp-chain note">Checking the chain…</p></section>';
  };
  const open = (id) => {
    const r = AG.run; if (!r) return false;
    const c = r.claims.find((x) => x.id === id); if (!c) return false;
    if (!dlg) build();
    const body = dlg.querySelector('.tp-b');
    body.innerHTML = html(c) + (FLAG ? evidenceHtml(c) : '');
    if (FLAG) MCC.verify().then((v) => { const el = body.querySelector('.tp-chain'); if (el) el.textContent = v.ok ? 'Chain intact: ' + v.count + ' records (in-page chain, recomputed now)' : 'Chain broken at record #' + v.brokenAt; });
    if (!dlg.open) dlg.showModal();
    return true;
  };
  return { open, steps, html, evidence };
})();
