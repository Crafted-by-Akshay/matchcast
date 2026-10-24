// ---- Production desk (Broadcast): the orchestration strip and the Broadcast Copilot (ADR-0019).
// The strip shows the agents' own trace for the last line on air: who acted, which step, and whether a model or the rules made it.
// The Copilot answers highlight, camera-focus and production-plan questions from the api's ranked picks. Without the api it says so.
// Appended after onair.js in the same module (see build.py). Only the consumer desk has it: its pitch is Watch's.
(() => {
  if (!window.MC_CONSUMER) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const style = document.createElement('style');
  style.textContent = '#mc-desk{position:absolute;left:10px;top:10px;bottom:56px;width:min(360px,calc(100% - 20px));z-index:40;display:flex;flex-direction:column;gap:6px;padding:8px;background:rgba(10,20,40,.92);border-radius:8px;font:500 12px system-ui,sans-serif;color:#e8eefc;overflow:hidden}'
    + '#mc-desk button{padding:4px 8px;border-radius:4px;border:1px solid #3aa0ff;background:#12294a;color:#fff;font:inherit;cursor:pointer}'
    + '#mc-desk button:disabled{opacity:.55;cursor:default}'
    + '#mc-desk-body{display:flex;flex-direction:column;gap:6px;min-height:0;overflow:auto}'
    + '#mc-desk ol,#mc-desk ul{margin:0;padding-left:18px}'
    + '.mcd-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}'
    + '.mcd-ch{padding:2px 6px;border-radius:999px;background:#17283F;border:1px solid #2c4a72;font-size:11px}';
  document.head.append(style);
  const box = document.createElement('section');
  box.id = 'mc-desk'; box.setAttribute('aria-label', 'Production desk: orchestration and Broadcast Copilot');
  box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><b>Production desk</b>'
    + '<button type="button" id="mc-desk-hide" aria-expanded="true" aria-controls="mc-desk-body">Hide</button></div>'
    + '<div id="mc-desk-body">'
    + '<div id="mc-orch" aria-live="polite"><b>On air</b> <span>Nothing aired yet.</span></div>'
    + '<div id="mc-cop" role="group" aria-label="Ask the Broadcast Copilot">'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" data-cop="highlights">Highlights</button><button type="button" data-cop="focus">Where to focus</button><button type="button" data-cop="plan">Production plan</button></div>'
    + '<div id="mc-cop-out" aria-live="polite" style="margin-top:6px"></div>'
    + '</div></div>';
  (document.getElementById('bc-view') || document.body).append(box);
  const $ = (id) => box.querySelector('#' + id);

  // the orchestration strip: the last aired line, and one chip per agent that acted on it
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell' || d.type !== 'air' || !d.line) return;
    const line = d.line, seen = new Map();
    for (const s of line.steps || []) seen.set(s.agent, s);   // one chip per agent, in the order it first acted, with its last step
    const chips = [...seen.values()].map((s) => '<span class="mcd-ch">' + esc(s.agent) + ' · ' + esc(s.step) + ' · ' + (s.mode === 'model' ? 'model' : 'rules') + '</span>').join('');
    $('mc-orch').innerHTML = '<b>On air' + (line.verdict ? ' · ' + esc(line.verdict) : '') + '</b> <span>' + esc(line.text || '') + '</span>'
      + '<div class="mcd-chips">' + (chips || '<span class="mcd-ch">No agent trace for this line.</span>') + '</div>';
  });

  // the Broadcast Copilot: each question is asked of the api with surface "broadcast"; only the newest answer is shown
  const QUESTIONS = { highlights: 'What are the highlights so far?', focus: 'Where should the camera go next?', plan: 'What is the production plan for the next few minutes?' };
  const pending = new Map(); let n = 0, latest = null, lastFocus = null;
  const out = (html) => { $('mc-cop-out').innerHTML = html; };
  box.querySelectorAll('[data-cop]').forEach((b) => { b.onclick = () => ask(b.dataset.cop); });
  $('mc-desk-hide').onclick = (e) => {
    const shut = !$('mc-desk-body').hidden; $('mc-desk-body').hidden = shut; e.currentTarget.textContent = shut ? 'Show' : 'Hide'; e.currentTarget.setAttribute('aria-expanded', String(!shut));
  };
  function ask(intent) {
    const id = 'c' + Date.now().toString(36) + (++n); latest = id; pending.set(id, intent);
    out('Checking the match…');
    MCS.send({ type: 'ask', id, q: QUESTIONS[intent], surface: 'broadcast' });
    setTimeout(() => { if (pending.delete(id) && id === latest) out('No answer from the agent api. Live picks need it; the strip above still shows what the agents did.'); }, 25000);
  }
  function render(intent, b) {
    if (b.highlights) return b.highlights.length ? '<ol>' + b.highlights.map((p) => '<li>' + esc(p.reason) + '</li>').join('') + '</ol>' : 'No moment worth airing yet.';
    if (b.plan) return '<ul>' + b.plan.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>';
    lastFocus = b.focus;
    return '<p>' + esc(b.focus.reason) + '</p>' + (b.focus.target === 'player' ? '<button type="button" id="mc-cop-go">Suggest to Watch</button>' : '');
  }
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell' || d.type !== 'answer' || !pending.has(d.id)) return;
    const intent = pending.get(d.id); pending.delete(d.id);
    if (d.id !== latest) return;
    const b = (d.answer || {}).broadcast;
    out(b ? render(intent, b) : 'Live picks need the agent api. The strip above still shows what the agents did.');
  });
  $('mc-cop').addEventListener('click', (e) => {
    if (e.target && e.target.id === 'mc-cop-go' && lastFocus) MCS.send({ type: 'focus', player_id: lastFocus.player_id || '', reason: lastFocus.reason });
  });
})();
