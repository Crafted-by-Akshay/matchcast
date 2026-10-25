// ---- on-air log and overlay JSON (Broadcast): every approved line that reached air, exportable for external graphics tools.
// Appended after replay.js in the same module (see build.py). Only lines the shell sent as 'air' are here, so a pending or killed line is never in the file.
(() => {
  if (!window.MC_CONSUMER) return;
  const log = [];
  const box = document.createElement('div');
  box.id = 'mc-onair'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'On-air log');
  box.style.cssText = 'position:absolute;right:10px;bottom:10px;z-index:40;display:flex;gap:8px;align-items:center;padding:6px 8px;background:rgba(10,20,40,.92);border-radius:6px;font:600 12px system-ui,sans-serif;color:#e8eefc';
  box.innerHTML = '<button type="button" id="mc-onair-export" style="padding:4px 8px;border-radius:4px;border:1px solid #3aa0ff;background:#12294a;color:#fff;font:inherit;cursor:pointer">Export on-air JSON</button><span id="mc-onair-n">0 lines on air</span><span id="mc-onair-hash" style="font:11px ui-monospace,monospace;opacity:.85"></span>';
  (document.getElementById('bc-view') || document.body).append(box);
  const doc = () => JSON.stringify({ schema: 'matchcast.onair/1', simulated: true, source: 'rules agents in the page', lines: log.map((l) => ({ id: l.id, minute: l.minute, text: l.text, alert: l.alert || null, verdict: l.verdict })) }, null, 2);
  window.MCOnair = { doc };   // the desk's overlay preview (desk-panels.js) shows the same records as the export
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell' || d.type !== 'air' || !d.line || log.some((x) => x.id === d.line.id)) return;
    log.push(d.line);
    box.querySelector('#mc-onair-hash').textContent = ''; delete box.dataset.hash;   // the shown hash belongs to the file exported before this line
    box.querySelector('#mc-onair-n').textContent = log.length + (log.length === 1 ? ' line on air' : ' lines on air');
  });
  box.querySelector('#mc-onair-export').addEventListener('click', async () => {
    const text = doc();
    box.querySelector('#mc-onair-hash').textContent = ''; delete box.dataset.hash;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'matchcast-onair.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    try { const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((n) => n.toString(16).padStart(2, '0')).join(''); box.querySelector('#mc-onair-hash').textContent = 'SHA-256 ' + h.slice(0, 16) + '…'; box.dataset.hash = h; } catch (err) { /* no subtle crypto here: the file is still saved */ }
  });
  window.MCOnAir = { json: doc, get count() { return log.length; } };
})();
