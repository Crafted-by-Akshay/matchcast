// EXP-13: Analyst "Data platform" page. Fabric dashboard clip and the Databricks model card.
// Neither service is connected yet, so each block says so (Planned) until its file exists in shared/.
NAV.find((g) => g[0] === 'Platform')[1].push('data-platform');
ICONS['data-platform'] = ICONS.catalogue;
const dpMissing = (what, ticket) => '<div class="card" data-planned="1"><span class="chip">Planned</span> ' + esc(what) + ' is not available yet (' + ticket + ').</div>';
async function dpJson(url) { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
const dpApi = () => { try { return (window.parent !== window ? window.parent.MATCHCAST_API || '' : '').replace(/\/+$/, ''); } catch (e) { return ''; } };
async function dpHas(url, kind) { try { const r = await fetch(url, { method: 'HEAD' }); return r.ok && (r.headers.get('content-type') || '').startsWith(kind); } catch (e) { return false; } }
page({
  id: 'data-platform', title: 'Data platform', render: async (el) => {
    el.innerHTML = pgHead('Data platform', 'Where the numbers come from: the Fabric real-time dashboard and the Databricks danger model.') +
      '<h2>Fabric real-time dashboard</h2><div id="dp-fab">Loading…</div><h2>Danger model card</h2><div id="dp-mc">Loading…</div>';
    const [clip, shot, got] = await Promise.all([dpHas('../shared/fabric-dashboard.mp4', 'video/'), dpHas('../shared/fabric-dashboard.png', 'image/'), (dpApi() ? dpJson(dpApi() + '/v1/models/danger/card') : Promise.resolve(null)).then((j) => j ? { card: j, from: 'the agent api' } : dpJson('../shared/model-card.json').then((x) => x && { card: x, from: 'a copy shipped with the app' }))]);
    const fab = el.querySelector('#dp-fab'); if (!fab) return;
    fab.innerHTML = (clip || shot)
      ? (clip ? '<video controls muted playsinline preload="metadata" src="../shared/fabric-dashboard.mp4" style="max-width:100%"></video>' : '') +
        (shot ? '<img alt="Fabric real-time dashboard screenshot" src="../shared/fabric-dashboard.png" style="max-width:100%">' : '') +
        '<p class="muted">Paused after filming to save cost. This is a recording, not a live view.</p>'
      : dpMissing('The Fabric dashboard clip and screenshot', 'DAT-8') + '<p class="muted">Fabric will be paused after filming to save cost; judges see the recording once it is filmed.</p>';
    const box = el.querySelector('#dp-mc'); if (!box) return;
    const mc = got && got.card;
    if (!mc) { box.innerHTML = dpMissing('The Databricks model card', 'DAT-6'); return; }
    const m = mc.metrics || {}, cal = Array.isArray(mc.calibration) ? mc.calibration : [];
    const row = (k, v) => '<tr><th scope="row">' + esc(k) + '</th><td>' + esc(String(v == null ? 'n/a' : v)) + '</td></tr>';
    box.innerHTML = '<table class="tbl" id="dp-card"><tbody>' +
      [['Model', mc.name || 'danger'], ['Version', mc.version], ['Predicts', mc.label], ['Training data', mc.training_data || mc.data], ['Trained', mc.trained_at]].filter((r) => r[1] != null).map((r) => row(r[0], r[1])).join('') +
      Object.keys(m).map((k) => row(k, m[k])).join('') + '</tbody></table>' +
      (cal.length ? '<h3>Calibration (held-out matches)</h3><table class="tbl" id="dp-cal"><thead><tr><th>Bin</th><th>Events</th><th>Predicted</th><th>Observed</th></tr></thead><tbody>' +
        cal.map((c) => '<tr><td>' + esc(String(c.bin)) + '</td><td>' + esc(String(c.n)) + '</td><td>' + esc(String(c.predicted)) + '</td><td>' + esc(String(c.observed)) + '</td></tr>').join('') + '</tbody></table>' : '') +
      (mc.limits ? '<p class="muted">Limits: ' + esc(String(mc.limits)) + '.</p>' : '') +
      '<p class="muted">Card read from ' + esc(got.from) + '. A synthetic-data model: it describes the simulator, not real football.</p>';
  },
});
