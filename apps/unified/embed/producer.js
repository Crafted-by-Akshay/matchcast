// ---- Producer section of the Broadcast desk: the lines waiting for a person, the Verifier's verdict on each, and the event-to-air time.
// The shell owns the approval gate (agents.js); this section sends approve, kill and the mode, and shows what the shell sends back.
// Appended after copilot.js in the same module (see build.py), so the desk exists.
(() => {
  if (!window.MC_CONSUMER) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const style = document.createElement('style');
  style.textContent = '#mc-producer{display:flex;flex-direction:column;gap:6px;padding-bottom:6px;border-bottom:1px solid #22395c}'
    + '#mc-producer .mcp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
    + '#mc-pmode button[aria-pressed="true"]{background:#3aa0ff;color:#06182e}'
    + '#mc-pq{margin:0;padding:0;list-style:none}'
    + '.mcp-item{border-left:2px solid #F5B942;padding:2px 0 4px 8px;margin:0 0 4px}'
    + '.mcp-v{font-size:11px;color:#9fb6d6}.mcp-v.bad{color:#F26B6B}';
  document.head.append(style);
  const box = document.createElement('section');
  box.id = 'mc-producer'; box.setAttribute('aria-label', 'Producer: approve each line before it airs');
  box.innerHTML = '<div class="mcp-row"><b>Producer</b>'
    + '<div id="mc-pmode" role="group" aria-label="Approval mode"><button type="button" data-mode="producer" aria-pressed="true">Approve each line</button><button type="button" data-mode="demo" aria-pressed="false">Auto-air</button></div></div>'
    + '<ol id="mc-pq" aria-live="polite"></ol>'
    + '<div id="mc-pt" class="mcp-v">Event to air: no line on air yet.</div>';
  const body = document.getElementById('mc-desk-body');
  if (body) body.prepend(box); else (document.getElementById('bc-view') || document.body).append(box);
  const list = box.querySelector('#mc-pq'), note = box.querySelector('#mc-pt');
  // what the Verifier did, in words: a wording it rejected is kept, and the line shows the repaired one
  const verdict = (x) => {
    if (x.repaired) return 'Verifier rejected a wrong number and repaired the line from the event log';
    if (x.verdict === 'verified') return 'Verifier: verified against the event log';
    return 'Verifier: ' + (x.verdict || 'not checked') + (x.reason ? ' · ' + x.reason : '');
  };
  const item = (x) => '<li class="mcp-item" data-id="' + esc(x.id) + '"><div><b>' + esc(x.minute) + "'</b> " + esc(x.text) + '</div>'
    + '<div class="mcp-v' + (x.repaired ? ' bad' : '') + '">' + esc(verdict(x)) + '</div>'
    + (x.repaired && x.was ? '<div class="mcp-v">First wording: ' + esc(x.was) + '</div>' : '')
    + '<div><button type="button" data-act="approve">Approve</button> <button type="button" data-act="kill">Kill</button> <span class="mcp-v">waiting ' + Math.round((x.waiting_ms || 0) / 1000) + ' s</span></div></li>';
  let last = null;
  const render = (d) => {
    for (const b of box.querySelectorAll('#mc-pmode [data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === (d.mode === 'demo' ? 'demo' : 'producer')));
    const items = Array.isArray(d.items) ? d.items : [];
    list.innerHTML = items.length ? items.map(item).join('') : '<li class="mcp-v">' + (d.mode === 'demo' ? 'Auto-air: verified lines go straight to air.' : 'No lines waiting for approval.') + '</li>';
  };
  const showAired = () => {
    note.textContent = last ? 'Event to air: ' + (last.aired_ms / 1000).toFixed(1) + ' s' + (last.repaired ? ' · the wording was repaired before it aired' : '') : 'Event to air: no line on air yet.';
  };
  box.querySelector('#mc-pmode').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) MCS.send({ type: 'producer', action: 'mode', mode: b.dataset.mode }); };
  list.onclick = (e) => { const b = e.target.closest('[data-act]'); if (b) MCS.send({ type: 'producer', action: b.dataset.act, id: b.closest('li').dataset.id }); };
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell') return;
    if (d.type === 'queue') render(d);
    if (d.type === 'air' && d.line) { last = d.line; showAired(); }
  });
})();
