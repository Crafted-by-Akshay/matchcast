// AGT-15 / task 105: the full-time recap on the Match centre page of a match that came from Watch.
// m.recap = { api, session_id, match_id } is set by the shell hook at full time. The api writes the recap after full time (F8),
// so the card polls for up to a minute and then says it is not ready. Seasons recorded in the library have no recap.
{
  const orig = PAGES.match.render;
  PAGES.match.render = function (el, arg) {
    orig.call(this, el, arg);
    const m = D.match(arg) || D.matches[D.matches.length - 1];
    if (!m || !m.recap) return;
    const body = el.querySelector('#mc-body');
    if (!body) return;
    const card = document.createElement('div'); card.className = 'card'; card.id = 'rc-card'; card.setAttribute('aria-live', 'polite');
    body.parentNode.insertBefore(card, body);
    rcLoad(card, m.recap, 0);
  };
}
async function rcLoad(card, r, tries) {
  if (!card.isConnected) return;
  if (r.result) return rcDraw(card, r.result);
  const url = r.api.replace(/\/+$/, '') + '/v1/matches/' + encodeURIComponent(r.match_id) + '/recap/analyst?session_id=' + encodeURIComponent(r.session_id);
  let status = 0, rc = null;
  try { const res = await fetch(url); status = res.status; if (res.ok) rc = await res.json(); } catch (e) { status = -1; }
  if (!card.isConnected) return;
  if (rc && typeof rc === 'object') { r.result = rc; return rcDraw(card, rc); }
  if (status !== 404) { card.innerHTML = '<h3>Full-time recap</h3><p class="muted"><span class="chip">Unavailable</span> The api could not return the recap' + (status > 0 ? ' (HTTP ' + status + ')' : '') + '.</p>'; return; }
  if (tries < 12) { card.innerHTML = '<h3>Full-time recap</h3><p class="muted">Being written by the agents…</p>'; setTimeout(() => rcLoad(card, r, tries + 1), 5000); }
  else card.innerHTML = '<h3>Full-time recap</h3><p class="muted"><span class="chip">Planned</span> The recap is not ready. It is written by the api after full time.</p>';
}
function rcDraw(card, rc) {
  // Only sentences the Verifier passed are shown; the rest are counted, never displayed.
  const rows = Array.isArray(rc.sentences) ? rc.sentences : [];
  const good = rows.filter((s) => s && s.verdict === 'verified' && typeof s.text === 'string' && s.text.trim());
  const hidden = rows.length - good.length;
  const rules = rc.mode === 'rules';
  if (!good.length) { card.innerHTML = '<h3>Full-time recap</h3><p class="muted">No sentence passed the Verifier, so there is no recap to show.</p>'; return; }
  const words = good.reduce((n, s) => n + s.text.trim().split(/\s+/).length, 0);
  card.innerHTML = '<h3>Full-time recap</h3><p id="rc-text">' + esc(good.map((s) => s.text.trim()).join(' ')) + '</p><div class="d2-meta">' +
    chip(rules ? 'Rules verifier ✓ every sentence shown' : 'Verifier ✓ every sentence shown', 'acc') + chip(words + ' words') + chip(rules ? 'Rules fallback' : 'Agents') +
    (hidden ? chip(hidden + ' unverified hidden') : '') + '</div>';
}
