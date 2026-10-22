// DAT-11 (task 278): live accuracy of Watch's pixel-only tracker, shown at the top of the Tracking lab.
// The numbers come from Watch's scorer (visReport in autoevent.js): the tracker reads pixels only, the scorer compares with engine truth.
// Identity with Azure Read OCR as a second opinion is Planned (tasks 275 and 277), so only the glyph-reader figure is shown.
{
  const num = (v, unit) => (typeof v === 'number' && isFinite(v) ? v + (unit || '') : 'n/a');
  const draw = (box) => {
    const r0 = window.MC_VISION;
    if (!r0 || typeof r0 !== 'object' || !r0.detection) {
      box.innerHTML = '<h3>Live vision accuracy</h3><p class="muted">No vision run yet. Open Watch, press <b>👁 Vision</b> while a match plays, and the scores appear here.</p>';
      return;
    }
    const r = Object.assign({}, r0, { detection: r0.detection || {}, identity: r0.identity || {}, passes: r0.passes || {}, ball: r0.ball || {}, speed: r0.speed || {} });
    const rows = [
      ['Detection recall', num(r.detection.recall, '%'), 'players found of those in view (' + num(r.detection.gt) + ' in view)'],
      ['Detection precision', num(r.detection.precision, '%'), 'detections that were real players'],
      ['Position error', num(r.detection.posErr, ' m'), 'mean distance to the true position'],
      ['Identity, glyph reader only', num(r.identity.accuracy, '%'), 'shirt number read from pixels; ' + num(r.identity.unknownPct, '%') + ' not yet identified, ' + num(r.identity.switches) + ' switches'],
      ['Identity, glyph + Azure OCR', 'Planned', 'second opinion from Azure AI Vision Read (DAT-11, tasks 275 and 277)'],
      ...(r.ocr ? [['OCR crops sent', num(r.ocr.sent), 'answered ' + num(r.ocr.answered) + ', digits read ' + num(r.ocr.read) + ', none found ' + num(r.ocr.no_digits) + '; too small to read ' + num(r.ocr.skipped_small) +
        ', no api ' + num(r.ocr.unavailable) + ', errors ' + num(r.ocr.errors) + '; at most ' + num(r.ocr.per_minute_cap) + ' a minute (task 275)']] : []),
      ['Pass recall / precision', num(r.passes.recall, '%') + ' / ' + num(r.passes.precision, '%'), num(r.passes.gt) + ' real passes, ' + num(r.passes.vis) + ' detected'],
      ['Ball found', num(r.ball.found, '%'), 'while in view; position error ' + num(r.ball.posErr, ' m')],
      ['Speed error', num(r.speed.playerErr, ' m/s'), 'players; ball ' + num(r.speed.ballErr, ' m/s')],
    ];
    box.innerHTML = '<h3>Live vision accuracy</h3><p class="muted">Watch\'s tracker on the <b>' + esc(String(r.camera || '')) + '</b> camera, ' + (r.on ? 'running' : 'switched off (last scores)') + ', ' +
      esc(String(r.captures || 0)) + ' frames at ' + esc(String(r.resolution || '')) + '. Measured against the simulator\'s ground truth; the tracker never reads player positions.</p>' +
      '<table class="tbl" data-vis="table"><tbody>' + rows.map((x) => '<tr><th scope="row">' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td><td class="muted">' + esc(x[2]) + '</td></tr>').join('') + '</tbody></table>';
  };
  window.visRefresh = () => { const b = document.getElementById('vis-panel'); if (b && b.isConnected) draw(b); };
  const orig = PAGES['ds-tracking'].render;
  PAGES['ds-tracking'].render = function (el, arg) {
    orig.call(this, el, arg);
    const box = document.createElement('div'); box.className = 'card'; box.id = 'vis-panel';
    el.insertBefore(box, el.firstChild);
    draw(box);
  };
}
