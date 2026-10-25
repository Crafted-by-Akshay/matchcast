// ---- Production desk (Broadcast): the orchestration strip and the Broadcast Copilot (ADR-0019).
// The strip shows the agents' own trace for the last line on air: who acted, which step, and whether a model or the rules made it.
// The Copilot answers highlight, camera-focus and production-plan questions from the api's ranked picks. Without the api it says so.
// Appended after onair.js in the same module (see build.py). Only the consumer desk has it: its pitch is Watch's.
(() => {
  if (!window.MC_CONSUMER) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const style = document.createElement('style');
  style.textContent = '#mc-desk{position:absolute;left:10px;top:10px;bottom:56px;width:min(360px,50%,calc(100% - 20px));z-index:40;display:flex;flex-direction:column;gap:6px;padding:8px;background:rgba(10,20,40,.92);border-radius:8px;font:500 12px system-ui,sans-serif;color:#e8eefc;overflow:hidden}'
    + '#mc-desk button{padding:4px 8px;border-radius:4px;border:1px solid #3aa0ff;background:#12294a;color:#fff;font:inherit;cursor:pointer}'
    + '#mc-desk button:disabled{opacity:.55;cursor:default}'
    + '#mc-desk-body{display:flex;flex-direction:column;gap:6px;min-height:0;overflow:auto}'
    + '#mc-desk-body[hidden]{display:none}'
    + '@media (max-width:480px){#mc-desk{top:64px!important;bottom:auto!important;width:calc(100% - 20px)!important;background:none!important;padding:0!important;overflow:visible!important}#mc-desk>div:first-child,#mc-desk-body{display:none!important}#mc-replay{order:-1}}'   // a phone stage is about 180 px tall: only the replay row shows there, where it was before the desk; the Copilot and the strip need a wider pane
    + '#mc-desk ol,#mc-desk ul{margin:0;padding-left:18px}'
    + '.mcd-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}'
    + '.mcd-ch{padding:2px 6px;border-radius:999px;background:#17283F;border:1px solid #2c4a72;font-size:11px}'
    + '.mcd-line{padding:4px 0;border-bottom:1px solid #22395c}';
  document.head.append(style);
  const box = document.createElement('section');
  box.id = 'mc-desk'; box.setAttribute('aria-label', 'Production desk: orchestration and Broadcast Copilot');
  box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><b>Production desk</b>'
    + '<button type="button" id="mc-desk-hide" aria-expanded="true" aria-controls="mc-desk-body">Hide</button></div>'
    + '<div id="mc-desk-body">'
    + '<div id="mc-lens" role="group" aria-label="Steer the agents: who the commentary is written for"><span>Lens</span><button type="button" data-lens="casual">Casual</button><button type="button" data-lens="analyst">Analyst</button><button type="button" data-lens="broadcast">Broadcast</button><select id="mc-lens-more" aria-label="More lenses: a club, a player or a metric" style="max-width:150px;padding:3px;border-radius:4px;background:#12294a;color:#fff;border:1px solid #3aa0ff;font:inherit"></select></div>'
    + '<div id="mc-orch" aria-live="polite"><b>On air</b> <span>Nothing aired yet.</span></div>'
    + '<div id="mc-cop" role="group" aria-label="Ask the Broadcast Copilot">'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" data-cop="highlights">Highlights</button><button type="button" data-cop="focus">Where to focus</button><button type="button" data-cop="plan">Production plan</button></div>'
    + '<div id="mc-cop-out" aria-live="polite" style="margin-top:6px"></div>'
    + '</div></div>';
  (document.getElementById('bc-view') || document.body).append(box);
  // instant replay is a row of the desk, above its body: the desk covered the bar on the left, and a split pane has no free corner for it
  const rb = document.getElementById('mc-replay');
  if (rb) { rb.style.cssText += ';position:static;box-sizing:border-box;width:100%;max-width:none;flex-wrap:wrap'; box.querySelector('#mc-desk-body').before(rb); }
  const $ = (id) => box.querySelector('#' + id);
  // the desk runs down to just above the lower-third while it is on air, and shrinks to its header when Hide collapses it
  const l3 = document.getElementById('mc-l3');
  const placeDesk = () => {
    const host = box.offsetParent; if (!host) return;
    let bottom = 56;
    if (l3 && !l3.hidden) bottom = Math.max(bottom, Math.round(host.getBoundingClientRect().bottom - l3.getBoundingClientRect().top + 6));
    box.style.bottom = $('mc-desk-body').hidden ? 'auto' : bottom + 'px';
  };
  placeDesk();
  if (l3) new ResizeObserver(placeDesk).observe(l3);
  window.addEventListener('resize', placeDesk);

  // the production strip: the last five lines on air, newest first. Each shows the numbers it was built on and one chip per agent that acted on it
  const flow = [];
  const lineHtml = (line) => {
    const seen = new Map();
    for (const s of line.steps || []) seen.set(s.agent, s);   // one chip per agent, in the order it first acted, with its last step
    const chips = [...seen.values()].map((s) => '<span class="mcd-ch">' + esc(s.agent) + ' · ' + esc(s.step) + ' · ' + (s.mode === 'model' ? 'model' : 'rules') + '</span>').join('');
    const nums = (line.numbers || []).map((n) => '<span class="mcd-ch">' + esc(n.name) + ' ' + esc(n.value) + '</span>').join('');
    return '<div class="mcd-line"><b>' + esc(line.minute) + "'" + (line.verdict ? ' · ' + esc(line.verdict) : '') + '</b> ' + esc(line.text || '')
      + '<div class="mcd-chips">' + (chips || '<span class="mcd-ch">No agent trace for this line.</span>') + nums + '</div></div>';
  };
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell' || d.type !== 'air' || !d.line) return;
    flow.unshift(d.line); flow.length = Math.min(flow.length, 5);
    $('mc-orch').innerHTML = '<b>On air, newest first</b>' + flow.map(lineHtml).join('');
  });
  // the lens steers what the agents write for: the same personas the api takes (casual, analyst, broadcast)
  box.querySelectorAll('[data-lens]').forEach((b) => { b.onclick = () => { MCS.send({ type: 'persona', persona: b.dataset.lens }); box.querySelectorAll('[data-lens]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; });
  // the other lenses: each club of the match, each player, and the metrics the api can follow (the same grammar Watch uses: club:<key>, player:<name>, metric:<name>)
  const METRIC_LENSES = [['xg', 'xG'], ['shots', 'Shots'], ['shots_on_target', 'Shots on target'], ['tackles_won', 'Tackles won'], ['fouls', 'Fouls']];
  const more = $('mc-lens-more');
  function fillLenses() {
    const list = typeof players !== 'undefined' ? players : [];
    const clubs = [...new Set(list.map((q) => q.T.key))], names = [...new Set(list.map((q) => q.name))].sort();
    const key = clubs.join('|') + '#' + names.length;
    if (more.dataset.key === key) return;
    more.dataset.key = key;
    const opt = (value, label) => '<option value="' + esc(value) + '">' + esc(label) + '</option>';
    more.innerHTML = '<option value="">More lenses…</option>'
      + '<optgroup label="Club">' + clubs.map((c) => opt('club:' + c, c)).join('') + '</optgroup>'
      + '<optgroup label="Player">' + names.map((x) => opt('player:' + x, x)).join('') + '</optgroup>'
      + '<optgroup label="Metric">' + METRIC_LENSES.map(([m, l]) => opt('metric:' + m, l)).join('') + '</optgroup>';
  }
  more.onfocus = fillLenses; fillLenses();
  more.onchange = () => {
    if (!more.value) return;
    MCS.send({ type: 'persona', persona: more.value });
    box.querySelectorAll('[data-lens]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
  };

  // the Broadcast Copilot: each question is asked of the api with surface "broadcast"; only the newest answer is shown
  const QUESTIONS = { highlights: 'What are the highlights so far?', focus: 'Where should the camera go next?', plan: 'What is the production plan for the next few minutes?' };
  const pending = new Map(); let n = 0, latest = null, lastFocus = null;
  const out = (html) => { $('mc-cop-out').innerHTML = html; };
  box.querySelectorAll('[data-cop]').forEach((b) => { b.onclick = () => ask(b.dataset.cop); });
  $('mc-desk-hide').onclick = (e) => {
    const shut = !$('mc-desk-body').hidden; $('mc-desk-body').hidden = shut; e.currentTarget.textContent = shut ? 'Show' : 'Hide'; e.currentTarget.setAttribute('aria-expanded', String(!shut)); placeDesk();
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
    if (e.target && e.target.id === 'mc-cop-go' && lastFocus) MCS.send({ type: 'focus', player_id: lastFocus.player || '', reason: lastFocus.reason });   // Watch matches the player by name
  });
})();
