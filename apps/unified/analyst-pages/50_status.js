// Service status: a card above the console's own in-page checks that reads the agent api's GET /v1/status (docs/architecture/12-api.md).
// Each dependency is labelled live, simulated, planned or unavailable by the api, never guessed here. With no api connected the card says so.
const stApi = () => { try { return window.parent !== window ? window.parent.MATCHCAST_API || '' : ''; } catch (e) { return ''; } };
const ST = { state: 'idle', data: null, at: 0, ok_at: 0, status: 0 };
const ST_LABEL = { live: 'Live', simulated: 'Simulated', planned: 'Planned', unavailable: 'Unavailable' };
const stIsObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function stCardHtml() {
  const head = '<h3>Platform services (agent api)</h3>';
  if (!stApi()) return head + '<p class="muted"><span class="chip">Planned</span> No agent api is connected to this app, so there is nothing to report here. The checks below run inside this page.</p>';
  if (!ST.data) {
    if (ST.state === 'error') return head + '<p class="muted"><span class="chip">Unavailable</span> The api did not return its status' + (ST.status > 0 ? ' (HTTP ' + ST.status + ')' : '') + '.</p>';
    return head + '<p class="muted">Asking the api…</p>';
  }
  const d = ST.data, deps = d.dependencies.filter(stIsObj), counts = stIsObj(d.counts) ? d.counts : {};
  const summary = Object.keys(ST_LABEL).filter((k) => Number(counts[k])).map((k) => chip(esc(String(counts[k])) + ' ' + ST_LABEL[k].toLowerCase(), k === 'live' ? 'acc' : '')).join('');
  const rows = deps.map((x) => '<tr><th scope="row">' + esc(String(x.label || x.key || '')) + '</th><td>' + chip(esc(Object.prototype.hasOwnProperty.call(ST_LABEL, x.status) ? ST_LABEL[x.status] : 'Unknown'), x.status === 'live' ? 'acc' : '') + '</td><td class="muted">' + esc(String(x.detail || '')) + '</td></tr>').join('');
  const stale = ST.state === 'error' ? ' ' + chip('Could not refresh; as of ' + esc(new Date(ST.ok_at).toLocaleTimeString()), '') : '';
  return head + '<p class="muted">Mode <b>' + esc(String(d.mode || 'unknown')) + '</b>, overall <b>' + esc(String(d.overall || 'unknown')) + '</b>. ' + summary + stale + '</p>' +
    (rows ? '<table class="tbl" data-st="table" aria-label="Platform services from the agent api"><thead><tr><th scope="col">Service</th><th scope="col">State</th><th scope="col">Detail</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="muted">The api listed no dependencies.</p>');
}
function stSafeHtml() { try { return stCardHtml(); } catch (e) { return '<h3>Platform services (agent api)</h3><p class="muted"><span class="chip">Unavailable</span> The api status could not be shown.</p>'; } }
function stPaint() { const c = document.getElementById('st-api'); if (c && c.isConnected) c.innerHTML = stSafeHtml(); }
// The card refetches when the page draws (at most every 10 s) and when "Run checks again" is pressed; there is no background timer.
async function stLoad(force) {
  const base = stApi().replace(/\/+$/, '');
  if (!base || ST.state === 'loading' || (!force && Date.now() - ST.at < 10000)) return;
  ST.state = 'loading'; if (!ST.data) stPaint();
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    ST.status = 0;
    const res = await fetch(base + '/v1/status', { signal: ctl.signal }); ST.status = res.status;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (!stIsObj(j) || !Array.isArray(j.dependencies)) throw new Error('unexpected body');
    ST.data = j; ST.state = 'ok'; ST.ok_at = Date.now();
  } catch (e) { ST.state = 'error'; }
  clearTimeout(timer); ST.at = Date.now(); stPaint();
}
const stOrigDraw = pf_statusDraw;
pf_statusDraw = function (el) {
  stOrigDraw(el);
  const card = document.createElement('div'); card.id = 'st-api'; card.className = 'card'; card.style.cssText = 'padding:14px;margin-bottom:12px';
  card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
  card.innerHTML = stSafeHtml();
  const banner = el.querySelector('.pf-banner');   // under the page head, above the console's own overall banner
  if (banner) banner.before(card); else el.prepend(card);
  const rc = el.querySelector('#pf-rc'); if (rc && !rc.dataset.st) { rc.dataset.st = '1'; rc.addEventListener('click', () => stLoad(true)); }
  stLoad(false);
};
