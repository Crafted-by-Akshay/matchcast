// DAT-4 task 272: control, chaos and tempo for the match Watch is playing, at the top of the Match centre.
// Computed in Watch from the engine's events over a rolling 5 minutes (docs/metrics.md) and sent through the shell; nothing here is guessed.
{
  const fin = (v) => typeof v === 'number' && isFinite(v);
  const spark = (pts, key, max, color, label) => {
    if (!Array.isArray(pts) || pts.length < 2) return '<span class="muted">too early</span>';
    const W = 160, H = 28, ok = pts.filter((p) => p && fin(p[key]));
    if (ok.length < 2) return '<span class="muted">too early</span>';
    const line = ok.map((p, i) => (i / (ok.length - 1) * W).toFixed(1) + ',' + (H - Math.max(0, Math.min(1, p[key] / max)) * (H - 3) - 1.5).toFixed(1)).join(' ');
    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + ' by minute, ' + ok.length + ' points, latest ' + esc(String(Math.round(ok[ok.length - 1][key] * 10) / 10)) + '"><polyline fill="none" stroke="' + color + '" stroke-width="2" points="' + line + '"/></svg>';
  };
  const draw = (box) => {
    const d = window.MC_INDICES;
    if (!d || typeof d !== 'object' || !fin(d.control)) {
      box.innerHTML = '<h3>Control, chaos and tempo</h3><p class="muted">No live match yet. Kick off in Watch and the three indices appear here, one point a minute.</p>';
      return;
    }
    const rows = [['Control', 'control', 100, 'var(--good, #6BD08A)', Math.round(d.control), 'possession stability, pass completion and territory'],
      ['Chaos', 'chaos', 100, 'var(--warn, #F5B942)', Math.round(d.chaos), 'turnovers, duels and how spread out the passes are'],
      ['Tempo', 'tempo', 12, 'var(--acc, #8CC2FF)', fin(d.tempo) ? d.tempo.toFixed(1) + ' / min' : 'n/a', 'passes a minute']];
    box.innerHTML = '<h3>Control, chaos and tempo</h3><p class="muted">Rolling 5 minutes from Watch\'s events (' + esc(String(d.passes || 0)) + ' passes so far). Pass completion is inferred: a pass is completed unless the other side wins the ball within 6 s.</p>' +
      '<table class="tbl" data-idx="table"><tbody>' + rows.map((r) => '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(String(r[4])) + '</td><td>' + spark(d.series, r[1], r[2], r[3], r[0]) + '</td><td class="muted">' + esc(r[5]) + '</td></tr>').join('') + '</tbody></table>';
  };
  window.idxRefresh = () => { const b = document.getElementById('idx-panel'); if (b && b.isConnected) draw(b); };
  const orig = PAGES.match.render;
  PAGES.match.render = function (el, arg) {
    orig.call(this, el, arg);
    const box = document.createElement('div'); box.className = 'card'; box.id = 'idx-panel'; box.style.cssText = 'padding:14px;margin-bottom:12px';
    el.insertBefore(box, el.firstChild);
    draw(box);
  };
}
