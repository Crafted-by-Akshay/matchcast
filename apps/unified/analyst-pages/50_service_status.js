// Platform > Service status: the api's own account of what is live, simulated, planned or unavailable (GET /v1/status).
// Shown above the page's checks, which redraw the whole page, so the card is added again after every draw from a cached answer.
// With no api (or no answer) it says the console runs on its in-page stand-ins.
const SS = { doc: undefined, loading: false };
{
  const origDraw = pf_statusDraw;
  pf_statusDraw = function (el) {
    origDraw(el);
    const card = document.createElement('div'); card.className = 'card'; card.id = 'ss-card'; card.setAttribute('aria-live', 'polite');
    el.insertBefore(card, el.firstChild);
    ssPaint(card);
    if (SS.doc === undefined && !SS.loading) ssLoad();
    const rc = el.querySelector('#pf-rc');   // "Run checks again" also asks the api again
    if (rc) rc.addEventListener('click', () => { if (!SS.loading) { SS.doc = undefined; ssLoad(); } });
  };
}
async function ssLoad() {
  SS.loading = true;
  const api = (() => { try { return window.parent !== window ? window.parent.MATCHCAST_API || '' : ''; } catch (e) { return ''; } })().replace(/\/+$/, '');
  let doc = null;
  if (api) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    try { const r = await fetch(api + '/v1/status', { signal: ctl.signal }); if (r.ok) doc = await r.json(); } catch (e) { doc = null; } finally { clearTimeout(t); }
  }
  if (doc && typeof doc === 'object' && Array.isArray(doc.dependencies)) {
    doc.dependencies = doc.dependencies.filter((x) => x && typeof x === 'object').map((x) => ({ status: String(x.status || 'unavailable'), label: String(x.label || x.key || 'Unnamed'), detail: String(x.detail || '') }));
    SS.doc = doc;
  } else SS.doc = { none: true, api: !!api };
  SS.loading = false;
  if (SS.doc.none) { const failed = SS.doc; setTimeout(() => { if (SS.doc === failed) SS.doc = undefined; }, 30000); } // a failed answer is retried on a later redraw
  document.querySelectorAll('#ss-card').forEach(ssPaint);
}
function ssPaint(card) {
  card.textContent = '';
  const h = document.createElement('h3'); h.textContent = 'What is running'; card.append(h);
  const doc = SS.doc;
  if (doc === undefined) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Loading…'; card.append(p); return; }
  if (doc.none) {
    const p = document.createElement('p'); p.className = 'muted';
    p.textContent = doc.api ? 'The api did not return its status. The console is running on in-page stand-ins (simulated).' : 'No api is configured. The console runs on in-page stand-ins (simulated); the Azure parts are not connected.';
    card.append(p); return;
  }
  const tone = { live: 'good', simulated: 'warn', planned: '', unavailable: 'bad' };
  const lbl = { live: 'Live', simulated: 'Simulated', planned: 'Planned', unavailable: 'Unavailable' };
  const t = document.createElement('table'); t.className = 'tbl';
  const hd = t.createTHead().insertRow(); for (const c of ['Dependency', 'State', 'Detail']) { const th = document.createElement('th'); th.textContent = c; hd.append(th); }
  const tb = t.createTBody();
  for (const d of doc.dependencies) {
    const r = tb.insertRow(); r.insertCell().textContent = d.label;
    const chip = document.createElement('span'); chip.className = 'chip ' + (Object.prototype.hasOwnProperty.call(tone, d.status) ? tone[d.status] : ''); chip.textContent = Object.prototype.hasOwnProperty.call(lbl, d.status) ? lbl[d.status] : 'Unknown'; r.insertCell().append(chip);
    r.insertCell().textContent = d.detail;
  }
  const sum = document.createElement('p'); sum.className = 'muted'; sum.textContent = 'Api mode ' + doc.mode + '. Counts: ' + Object.entries(doc.counts || {}).filter(([, n]) => n).map(([k, n]) => n + ' ' + k).join(', ') + '.';
  card.append(sum, t);
}
