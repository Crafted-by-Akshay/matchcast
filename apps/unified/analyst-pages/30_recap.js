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
  if (rc && typeof rc.text === 'string' && rc.text.trim()) { r.result = rc; return rcDraw(card, rc); }
  if (rc) { card.innerHTML = '<h3>Full-time recap</h3><p class="muted">The agents wrote no sentence they could verify, so there is no recap.</p>'; return; }
  if (status !== 404) { card.innerHTML = '<h3>Full-time recap</h3><p class="muted"><span class="chip">Unavailable</span> The api could not return the recap' + (status > 0 ? ' (HTTP ' + status + ')' : '') + '.</p>'; return; }
  if (tries < 12) { card.innerHTML = '<h3>Full-time recap</h3><p class="muted">Being written by the agents…</p>'; setTimeout(() => rcLoad(card, r, tries + 1), 5000); }
  else card.innerHTML = '<h3>Full-time recap</h3><p class="muted"><span class="chip">Planned</span> The recap is not ready. It is written by the api after full time.</p>';
}
function rcDraw(card, rc) {
  const rows = Array.isArray(rc.sentences) ? rc.sentences : [];
  const ok = rows.length && rows.every((s) => s.verdict === 'verified');
  const rules = rc.mode === 'rules';
  card.innerHTML = '<h3>Full-time recap</h3><p id="rc-text">' + esc(rc.text) + '</p><div class="d2-meta">' +
    chip(ok ? (rules ? 'Rules verifier ✓ every sentence' : 'Verifier ✓ every sentence') : 'Not every sentence verified', ok ? 'acc' : '') + chip(esc(String(rc.word_count || 0)) + ' words') + chip(rules ? 'Rules fallback' : 'Agents') + '</div>';
}
