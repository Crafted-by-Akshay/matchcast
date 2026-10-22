// Service status: a card above the console's own in-page checks that reads the agent api's GET /v1/status (docs/architecture/12-api.md).
// Each dependency is labelled live, simulated, planned or unavailable by the api, never guessed here. With no api connected the card says so.
const stApi = () => { try { return window.parent !== window ? window.parent.MATCHCAST_API || '' : ''; } catch (e) { return ''; } };
const ST = { state: 'idle', data: null, at: 0, status: 0 };
const ST_LABEL = { live: 'Live', simulated: 'Simulated', planned: 'Planned', unavailable: 'Unavailable' };
function stCardHtml() {
  const head = '<h3>Platform services (agent api)</h3>';
  if (!stApi()) return head + '<p class="muted"><span class="chip">Planned</span> No agent api is connected to this app, so there is nothing to report here. The checks below run inside this page.</p>';
  if (ST.state === 'loading' && !ST.data) return head + '<p class="muted">Asking the api…</p>';
  if (ST.state === 'error' && !ST.data) return head + '<p class="muted"><span class="chip">Unavailable</span> The api did not return its status' + (ST.status > 0 ? ' (HTTP ' + ST.status + ')' : '') + '.</p>';
  const d = ST.data || {}, deps = Array.isArray(d.dependencies) ? d.dependencies : [], counts = d.counts && typeof d.counts === 'object' ? d.counts : {};
  const summary = Object.keys(ST_LABEL).filter((k) => counts[k]).map((k) => chip(esc(String(counts[k])) + ' ' + ST_LABEL[k].toLowerCase(), k === 'live' ? 'acc' : '')).join('');
  const rows = deps.map((x) => '<tr><th scope="row">' + esc(String(x.label || x.key || '')) + '</th><td>' + chip(esc(ST_LABEL[x.status] || 'Unknown'), x.status === 'live' ? 'acc' : '') + '</td><td class="muted">' + esc(String(x.detail || '')) + '</td></tr>').join('');
  return head + '<p class="muted">Mode <b>' + esc(String(d.mode || 'unknown')) + '</b>, overall <b>' + esc(String(d.overall || 'unknown')) + '</b>. ' + summary + (ST.state === 'error' ? ' ' + chip('Could not refresh', '') : '') + '</p>' +
    (rows ? '<table class="tbl" data-st="table"><tbody>' + rows + '</tbody></table>' : '<p class="muted">The api listed no dependencies.</p>');
}
function stPaint() { const c = document.getElementById('st-api'); if (c && c.isConnected) c.innerHTML = stCardHtml(); }
async function stLoad() {
  const base = stApi().replace(/\/+$/, '');
  if (!base || ST.state === 'loading' || Date.now() - ST.at < 10000) return;
  ST.state = 'loading'; stPaint();
  try {
    const res = await fetch(base + '/v1/status'); ST.status = res.status;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    ST.data = await res.json(); ST.state = 'ok';
  } catch (e) { ST.state = 'error'; }
  ST.at = Date.now(); stPaint();
}
const stOrigDraw = pf_statusDraw;
pf_statusDraw = function (el) {
  stOrigDraw(el);
  const card = document.createElement('div'); card.id = 'st-api'; card.className = 'card'; card.style.cssText = 'padding:14px;margin-bottom:12px';
  card.innerHTML = stCardHtml();
  const banner = el.querySelector('.pf-banner');   // under the page head, above the console's own overall banner
  if (banner) banner.before(card); else el.prepend(card);
  stLoad();
};
