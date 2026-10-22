// EXP-13: Analyst "Data platform" page. Fabric dashboard clip and the Databricks model card.
// Neither service is connected yet, so each block says so (Planned) until its file exists in shared/.
NAV[NAV.length - 1][1].push('data-platform');
ICONS['data-platform'] = ICONS.catalogue;
const dpMissing = (what, ticket) => '<div class="card" data-planned="1"><span class="chip">Planned</span> ' + esc(what) + ' is not available yet (' + ticket + ').</div>';
async function dpJson(url) { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
async function dpHas(url) { try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch (e) { return false; } }
page({
  id: 'data-platform', title: 'Data platform', render: async (el) => {
    el.innerHTML = pgHead('Data platform', 'Where the numbers come from: the Fabric real-time dashboard and the Databricks danger model.') +
      '<h2>Fabric real-time dashboard</h2><div id="dp-fab">Loading…</div><h2>Databricks model card</h2><div id="dp-mc">Loading…</div>';
    const [clip, shot, mc] = await Promise.all([dpHas('../shared/fabric-dashboard.mp4'), dpHas('../shared/fabric-dashboard.png'), dpJson('../shared/model-card.json')]);
    const fab = el.querySelector('#dp-fab'); if (!fab) return;
    fab.innerHTML = (clip || shot)
      ? (clip ? '<video controls muted playsinline preload="metadata" src="../shared/fabric-dashboard.mp4" style="max-width:100%"></video>' : '') +
        (shot ? '<img alt="Fabric real-time dashboard screenshot" src="../shared/fabric-dashboard.png" style="max-width:100%">' : '') +
        '<p class="muted">Paused after filming to save cost. This is a recording, not a live view.</p>'
      : dpMissing('The Fabric dashboard clip and screenshot', 'DAT-8') + '<p class="muted">Fabric is paused after filming to save cost; judges see the recording once it is filmed.</p>';
    const box = el.querySelector('#dp-mc');
    if (!mc) { box.innerHTML = dpMissing('The Databricks model card', 'DAT-6'); return; }
    const m = mc.metrics || {};
    box.innerHTML = '<table class="tbl" id="dp-card"><tbody>' +
      [['Model', mc.name || 'danger'], ['Version', mc.version], ['Trained', mc.trained_at], ['Training data', mc.data]].map(([k, v]) => '<tr><th scope="row">' + esc(k) + '</th><td>' + esc(String(v == null ? 'n/a' : v)) + '</td></tr>').join('') +
      Object.keys(m).map((k) => '<tr><th scope="row">' + esc(k) + '</th><td>' + esc(String(m[k])) + '</td></tr>').join('') + '</tbody></table>';
  },
});
