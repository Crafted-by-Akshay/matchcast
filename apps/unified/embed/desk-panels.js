// ---- Broadcast desk panels: the production desk, the producer section and the Broadcast Copilot.
// A classic script, not part of the desk module (see build.py): it runs before the three.js import, so the queue and the Copilot show while the 3D engine loads.
// It posts { type: 'panels' } to the shell when the panels are up, and the shell lifts its loading card then, not on the pitch's start.
// The desk module reports two things back: window.MC_PLAYERS (the players) and MCDesk.lowerThird (the lower-third it makes).
const framed = window.parent !== window;
const send = (msg) => { if (framed) window.parent.postMessage(Object.assign({ src: 'matchcast', view: 'broadcast' }, msg), '*'); };   // the same message the hook sends (hook.js)

// ---- Production desk (Broadcast): the orchestration strip and the Broadcast Copilot (ADR-0019).
// The strip shows the agents' own trace for the last line on air: who acted, which step, and whether a model or the rules made it.
// The Copilot answers highlight, camera-focus and production-plan questions from the api's ranked picks. Without the api it says so.
// This is a classic script that runs before the 3D module, so the desk shows while the engine loads. Only the consumer desk has it: its pitch is Watch's.
(() => {
  if (!framed) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const style = document.createElement('style');
  style.textContent = '#mc-desk{position:absolute;left:10px;top:10px;bottom:56px;width:min(360px,50%,calc(100% - 20px));z-index:40;display:flex;flex-direction:column;gap:6px;padding:8px;background:rgba(10,20,40,.92);border-radius:8px;font:500 12px system-ui,sans-serif;color:#e8eefc;overflow:hidden}'
    + '#mc-desk button{padding:4px 8px;border-radius:4px;border:1px solid #3aa0ff;background:#12294a;color:#fff;font:inherit;cursor:pointer}'
    + '#mc-desk button:disabled{opacity:.55;cursor:default}'
    + '#mc-desk-body{display:flex;flex-direction:column;gap:6px;min-height:0;overflow:auto}'
    + '#mc-desk-body[hidden]{display:none}'
    + '@media (max-width:480px){#mc-desk{top:64px!important;bottom:auto!important;width:calc(100% - 20px)!important;background:none!important;padding:0!important;overflow:visible!important}#mc-desk>div:first-child,#mc-desk-body{display:none!important}}'   // a phone stage is about 180 px tall: only the replay row shows there, where it was before the desk; the Copilot and the strip need a wider pane
    + '#mc-desk ol,#mc-desk ul{margin:0;padding-left:18px}'
    + '.mcd-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}'
    + '.mcd-ch{padding:2px 6px;border-radius:999px;background:#17283F;border:1px solid #2c4a72;font-size:11px}'
    + '.mcd-line{padding:4px 0;border-bottom:1px solid #22395c}';
  document.head.append(style);
  const box = document.createElement('section');
  box.id = 'mc-desk'; box.setAttribute('aria-label', 'Production desk: orchestration and Broadcast Copilot');
  box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><b>Production desk</b> <span id="mc-pitch">3D pitch: loading</span>'
    + '<button type="button" id="mc-desk-hide" aria-expanded="true" aria-controls="mc-desk-body">Hide</button></div>'
    + '<div id="mc-replay-slot"></div>'   // the instant-replay row (replay.js) sits here, above the body
    + '<div id="mc-desk-body">'
    + '<div id="mc-lens" role="group" aria-label="Steer the agents: who the commentary is written for"><span>Lens</span><button type="button" data-lens="casual">Casual</button><button type="button" data-lens="analyst">Analyst</button><button type="button" data-lens="broadcast">Broadcast</button><select id="mc-lens-more" aria-label="More lenses: a club, a player or a metric" style="max-width:150px;padding:3px;border-radius:4px;background:#12294a;color:#fff;border:1px solid #3aa0ff;font:inherit"></select></div>'
    + '<div id="mc-orch" aria-live="polite"><b>On air</b> <span>Nothing aired yet.</span></div>'
    + '<div id="mc-cop" role="group" aria-label="Ask the Broadcast Copilot">'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" data-cop="highlights">Highlights</button><button type="button" data-cop="focus">Where to focus</button><button type="button" data-cop="plan">Production plan</button></div>'
    + '<div id="mc-cop-out" aria-live="polite" style="margin-top:6px"></div>'
    + '</div>'
    + '<section id="mc-overlay" aria-label="Overlay feed preview, simulated"><div class="mcp-row"><b>Overlay feed preview</b> <span class="mcp-v">simulated</span></div>'
    + '<p class="mcp-v">What a rendering partner would take: the on-air export, matchcast.onair/1. The timed stream endpoint is not built yet.</p>'
    + '<div id="mc-overlay-n" class="mcp-v">Checking the on-air log.</div><pre id="mc-overlay-pre" style="margin:4px 0 0;max-height:120px;overflow:auto;font:12px ui-monospace,monospace;white-space:pre-wrap"></pre></section>'
    + '</div>';
  (document.getElementById('bc-view') || document.body).append(box);
  const $ = (id) => box.querySelector('#' + id);
  // the desk runs down to just above the lower-third while it is on air, and shrinks to its header when Hide collapses it
  let l3 = null;   // the lower-third is made by the desk module after this script runs; MCDesk.lowerThird sets it
  const placeDesk = () => {
    const host = box.offsetParent; if (!host) return;
    let bottom = 56;
    if (l3 && !l3.hidden) bottom = Math.max(bottom, Math.round(host.getBoundingClientRect().bottom - l3.getBoundingClientRect().top + 6));
    box.style.bottom = $('mc-desk-body').hidden ? 'auto' : bottom + 'px';
  };
  placeDesk();
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
  box.querySelectorAll('[data-lens]').forEach((b) => { b.onclick = () => { send({ type: 'persona', persona: b.dataset.lens }); box.querySelectorAll('[data-lens]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; });
  // the other lenses: each club of the match, each player, and the metrics the api can follow (the same grammar Watch uses: club:<key>, player:<name>, metric:<name>)
  const METRIC_LENSES = [['xg', 'xG'], ['shots', 'Shots'], ['shots_on_target', 'Shots on target'], ['tackles_won', 'Tackles won'], ['fouls', 'Fouls']];
  const more = $('mc-lens-more');
  function fillLenses() {
    const list = window.MC_PLAYERS || [];   // the desk module sets this once the players load
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
    send({ type: 'persona', persona: more.value });
    box.querySelectorAll('[data-lens]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
  };

  // the overlay feed preview: the last lines of the on-air export (onair.js, window.MCOnAir.json), refreshed after each line airs
  const overlayN = box.querySelector('#mc-overlay-n'), overlayPre = box.querySelector('#mc-overlay-pre');
  let overlayWaits = 0;
  const renderOverlay = () => {
    if (!window.MCOnAir) {   // onair.js runs in the 3D module, which can finish after the frame's load event: wait a little before saying it is not ready
      if (overlayWaits++ < 80) setTimeout(renderOverlay, 250); else overlayN.textContent = 'Export not ready: the on-air log has not loaded.';
      return;
    }
    const lines = JSON.parse(window.MCOnAir.json()).lines || [];
    overlayN.textContent = lines.length ? lines.length + (lines.length === 1 ? ' line' : ' lines') + ' in the export' : 'Nothing aired yet.';
    overlayPre.textContent = JSON.stringify(lines.slice(-2), null, 2);
  };
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source === window.parent && d.src === 'matchcast-shell' && d.type === 'air') setTimeout(renderOverlay, 0);   // after onair.js has logged the line
  });
  window.addEventListener('load', renderOverlay);   // deferred modules (onair.js) have run by load: shows "Nothing aired yet." or "Export not ready" before any line airs

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
    send({ type: 'ask', id, q: QUESTIONS[intent], surface: 'broadcast' });
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
    if (e.target && e.target.id === 'mc-cop-go' && lastFocus) send({ type: 'focus', player_id: lastFocus.player || '', reason: lastFocus.reason });   // Watch matches the player by name
  });
  // the desk module reports the lower-third it makes, and the players once they load
  window.MCDesk = { lowerThird(el) { l3 = el; new ResizeObserver(placeDesk).observe(el); placeDesk(); }, lenses: fillLenses };
})();

// ---- Producer section of the Broadcast desk: the lines waiting for a person, the Verifier's verdict on each, and the event-to-air time.
// The shell owns the approval gate (agents.js); this section sends approve, kill and the mode, and shows what the shell sends back.
// The producer section: the same classic script, after the Copilot's block, so the desk exists.
(() => {
  if (!framed) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const style = document.createElement('style');
  style.textContent = '#mc-producer{display:flex;flex-direction:column;gap:6px;padding-bottom:6px;border-bottom:1px solid #22395c}'
    + '#mc-producer .mcp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
    + '#mc-pmode button[aria-pressed="true"]{background:#3aa0ff;color:#06182e}'
    + '#mc-pq{margin:0;padding:0;list-style:none}'
    + '.mcp-item{border-left:2px solid #F5B942;padding:2px 0 4px 8px;margin:0 0 4px}'
    + '.mcp-v{font-size:11px;color:#9fb6d6}.mcp-v.bad{color:#F26B6B}'
    + '.mcp-esc{border-left-color:#F26B6B}.mcp-tag{color:#F26B6B;text-transform:uppercase;font-size:11px;letter-spacing:.06em}';
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
  const item = (x) => '<li class="mcp-item' + (x.escalated ? ' mcp-esc' : '') + '" data-id="' + esc(x.id) + '"><div>' + (x.escalated ? '<b class="mcp-tag">Escalated</b> ' : '') + '<b>' + esc(x.minute) + "'</b> " + esc(x.text) + '</div>'
    + (x.escalated ? '<div class="mcp-v bad">The Verifier could not repair this line: ' + esc(x.escalation || 'no reason given') + '. Kill is the only action: nothing airs it.</div>' : '')
    + (x.escalated ? '' : '<div class="mcp-v' + (x.repaired ? ' bad' : '') + '">' + esc(verdict(x)) + '</div>')
    + (x.repaired && x.was ? '<div class="mcp-v">First wording: ' + esc(x.was) + '</div>' : '')
    + '<div>' + (x.escalated ? '' : '<button type="button" data-act="approve">Approve</button> ') + '<button type="button" data-act="kill">Kill</button> <span class="mcp-v">waiting ' + Math.round((x.waiting_ms || 0) / 1000) + ' s</span></div></li>';
  let last = null;
  const render = (d) => {
    for (const b of box.querySelectorAll('#mc-pmode [data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === (d.mode === 'demo' ? 'demo' : 'producer')));
    const items = (Array.isArray(d.items) ? d.items : []).slice().sort((a, b) => !!b.alert - !!a.alert);   // priority 1 alerts first, as in the Agents queue
    list.innerHTML = items.length ? items.map(item).join('') : '<li class="mcp-v">' + (d.mode === 'demo' ? 'Auto-air: verified lines go straight to air.' : 'No booth line is waiting for approval. In Approve each line mode a booth line waits here until you approve it, or switch to Auto-air.') + '</li>';
  };
  const showAired = () => {
    note.textContent = last ? 'Event to air: ' + (last.aired_ms / 1000).toFixed(1) + ' s' + (last.repaired ? ' · the wording was repaired before it aired' : '') : 'Event to air: no line on air yet.';
  };
  box.querySelector('#mc-pmode').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) send({ type: 'producer', action: 'mode', mode: b.dataset.mode }); };
  list.onclick = (e) => { const b = e.target.closest('[data-act]'); if (b) send({ type: 'producer', action: b.dataset.act, id: b.closest('li').dataset.id }); };
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell') return;
    if (d.type === 'queue') render(d);
    if (d.type === 'air' && d.line) { last = d.line; showAired(); }
  });
  send({ type: 'producer', action: 'sync' });   // the shell answers with the queue, so a desk that loads late shows it
})();

// ---- Six-feed monitor (Broadcast): the six English derived feeds, what each has aired, the lines the Verifier dropped and why, and a kill per feed.
// Derived lines never enter the producer queue: booth lines keep it. The record fields are the matchcast.onair/1 1.2.0 onair and feed_drop packets (AB#498, merged; docs/contracts.md).
// The shell forwards the stream's onair and feed_drop records as feed-air and feed-drop (AB#499). A kill is sent to the api, which stops that feed at the air gate, once the match run exists and an api is configured; this desk shows the kill at once either way.
(() => {
  if (!framed) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const FEEDS = [['casual', 'Casual'], ['analyst', 'Analyst'], ['audio_description', 'Audio description'], ['catch_me_up', 'Catch-me-up'], ['half_time', 'Half-time'], ['ticker', 'Ticker']];
  const feeds = Object.fromEntries(FEEDS.map(([k, label]) => [k, { label, on: true, aired: 0, last: '' }]));
  const seen = new Set(), drops = [];
  const feedOf = (k) => (Object.hasOwn(feeds, k) ? feeds[k] : null);
  const style = document.createElement('style');
  style.textContent = '#mc-feeds{display:flex;flex-direction:column;gap:4px;padding-bottom:6px;border-bottom:1px solid #22395c}'
    + '#mc-feeds ul{margin:0;padding:0;list-style:none}'
    + '#mc-feeds li{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid #22395c}'
    + '#mc-feeds li>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '#mc-feeds li[data-off="true"]{opacity:.6}'
    + '#mc-feeds .mcp-v{font-size:11px;color:#9fb6d6}';
  document.head.append(style);
  const box = document.createElement('section');
  box.id = 'mc-feeds'; box.setAttribute('aria-label', 'Six feeds, simulated: what each aired, the drops, and a kill per feed');
  box.innerHTML = '<div class="mcp-row"><b>Feeds</b> <span class="mcp-v">simulated · English · no human approval</span></div>'
    + '<ul id="mc-feed-list">' + FEEDS.map(([k, label]) => '<li data-feed="' + k + '"><b>' + label + '</b><span class="mcp-v"></span><button type="button" data-kill>Kill</button></li>').join('') + '</ul>'
    + '<div><b>Dropped</b> <ul id="mc-drop-list"></ul></div>';
  document.getElementById('mc-overlay').before(box);
  const render = (k) => {
    const s = feeds[k], row = box.querySelector('[data-feed="' + k + '"]');
    row.dataset.off = String(!s.on);
    row.querySelector('span').textContent = (s.on ? '' : 'Killed on this desk · ') + s.aired + ' aired' + (s.last ? ' · ' + s.last : '');
    row.querySelector('[data-kill]').textContent = s.on ? 'Kill' : 'Resume';
  };
  FEEDS.forEach(([k]) => render(k));
  const renderDrops = () => {
    box.querySelector('#mc-drop-list').innerHTML = drops.length
      ? drops.map((r) => '<li class="mcp-v">' + esc(feedOf(r.feed).label) + ' · ' + esc(r.reason_code) + (r.repair_count ? ' · repaired ' + esc(r.repair_count) + (r.repair_count === 1 ? ' time' : ' times') : '') + '</li>').join('')
      : '<li class="mcp-v">Nothing dropped yet.</li>';
  };
  renderDrops();
  // a feed line airs once per publication, in English this sprint, and only while its feed is on; a killed feed airs nothing
  const aired = (rec) => {
    const s = feedOf(rec.feed);
    if (!s || !s.on || rec.lang !== 'en' || !rec.publication_id || seen.has(rec.publication_id)) return;
    seen.add(rec.publication_id); s.aired++; s.last = rec.text || ''; render(rec.feed);
  };
  // the Verifier's drop shows the reason; the line text stays in the audit chain, so the desk shows no text here
  const dropped = (rec) => {
    if (!feedOf(rec.feed)) return;
    drops.unshift(rec); drops.length = Math.min(drops.length, 5); renderDrops();
  };
  box.querySelector('#mc-feed-list').onclick = (e) => {
    const b = e.target.closest('[data-kill]'); if (!b) return;
    const k = b.closest('li').dataset.feed, s = feedOf(k);
    s.on = !s.on; render(k);
    send({ type: 'feed-kill', feed: k, on: s.on });
  };
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell' || !d.record) return;
    if (d.type === 'feed-air') aired(d.record);
    if (d.type === 'feed-drop') dropped(d.record);
  });
})();

send({ type: 'panels' });   // the desk's panels are up: the shell may lift its loading card now, while the pitch still loads
