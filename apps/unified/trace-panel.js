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
        + '<span class="tag">' + (s.mode === 'model' ? 'model' : 'rules') + '</span><span class="m"> ' + fmt(s.ms) + (s.tokens != null ? ' · ' + s.tokens + ' tokens' : ' · no tokens (rules)') + '</span>'
        + (s.tools && s.tools.length ? '<div class="m">tools: ' + s.tools.map(esc).join(', ') + '</div>' : '') + '<div>' + esc(s.detail || '') + '</div>'
        + (s.was ? '<div class="m">was ' + esc(MCC.canon(s.was)) + ' → now ' + esc(MCC.canon(s.now)) + '</div>' : '') + '</li>';
    }).join('') + '</ol>' : '<p class="note">This line came from the agent api. Its step-by-step trace comes with the api stream; the claim and verdict below are what the stream carried.</p>';
    const aud = (c.audit || []).map((a) => '#' + a.seq + ' ' + a.hash).join(' · ');
    return '<p class="tp-line"><b>' + esc(c.id) + '</b> · ' + esc(c.text || '') + '</p>' + body
      + '<p class="note">Verdict: ' + esc(c.verdict) + (c.repaired ? ' (repaired once)' : '') + ' · Source: ' + (c.source === 'model' ? 'model' : 'rules') + (aud ? ' · Audit ' + esc(aud) : '') + '</p>';
  };
  const open = (id) => {
    const r = AG.run; if (!r) return false;
    const c = r.claims.find((x) => x.id === id); if (!c) return false;
    if (!dlg) build();
    dlg.querySelector('.tp-b').innerHTML = html(c);
    if (!dlg.open) dlg.showModal();
    return true;
  };
  return { open, steps, html };
})();
