// ---- unified console: which parts are live, simulated, planned or unavailable.
// GET {MATCHCAST_API}/v1/status -> {mode, overall, counts, dependencies:[{key, label, status, detail}]} (no Azure call, never 503).
// With no api the console runs alone: the answer is local and says so. Text is set with textContent, never as HTML.
const STX = (() => {
  const api = () => (window.MATCHCAST_API || '').replace(/\/$/, '');
  const ORDER = { live: 0, simulated: 1, planned: 2, unavailable: 3 };
  const LABEL = { live: 'Live', simulated: 'Simulated', planned: 'Planned', unavailable: 'Unavailable' };
  const load = async () => {
    if (!api()) return null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(api() + '/v1/status', { signal: ctl.signal });
      const d = r.ok ? await r.json() : null;
      return d && Array.isArray(d.dependencies) ? d : null;
    } catch (e) { return null; } finally { clearTimeout(t); }
  };
  const summary = (d) => ['live', 'simulated', 'planned', 'unavailable'].filter((k) => d.counts && d.counts[k]).map((k) => d.counts[k] + ' ' + LABEL[k].toLowerCase()).join(', ');
  // fill `box` (an element) with the table; returns the document or null
  const draw = async (box) => {
    box.textContent = 'Loading…';
    const d = await load();
    box.textContent = '';
    if (!d) {
      const p = document.createElement('p');
      p.textContent = api() ? 'The api did not return its status. The console is running on the in-page rules agents (simulated).' : 'No api is configured. Everything runs in the page and is simulated; the Azure parts are not connected.';
      box.append(p); return null;
    }
    const head = document.createElement('p'); head.textContent = 'Mode ' + d.mode + ': ' + summary(d) + '.'; box.append(head);
    const ul = document.createElement('ul'); ul.className = 'st-list';
    for (const x of [...d.dependencies].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9))) {
      const li = document.createElement('li'), tag = document.createElement('strong');
      tag.textContent = LABEL[x.status] || x.status; tag.className = 'st-' + x.status;
      li.append(tag, ' ' + x.label + ' - ' + x.detail); ul.append(li);
    }
    box.append(ul); return d;
  };
  return { load, draw, summary };
})();
