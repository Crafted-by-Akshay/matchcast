// ---- DAT-11 task 275 (browser side): shirt-number crops for the api's OCR second opinion (docs/architecture/09, ADR-0010).
// While Vision is on, a confirmed track whose identity is not yet held (confidence proxy below 0.8) gets a 128x128 PNG of its shirt
// sent to the shell, which relays it to POST /v1/matches/{id}/vision/identify. At most 15 a minute (the api enforces it too), one in
// flight, lowest confidence first. Nothing is stored. The answer is kept per track in mcOcr for the identity combiner (task 277).
(() => {
  const SIDE = 128, MAX_BYTES = 40 * 1024, PER_MIN = 15, CONF_BELOW = 0.8, HOLD_FRAMES = 6;
  // a shirt number needs pixels: below minPx tall the crop cannot hold digits, so the track is counted as too small and never sent.
  // (Tests lower these to drive the pipeline; the Broadcast camera's players are about 10 px tall, so in practice most are skipped.)
  const CFG = window.mcOcrCfg = { minPx: 24, minHits: 6 };
  const stats = { sent: 0, answered: 0, read: 0, no_digits: 0, unavailable: 0, errors: 0, skipped_small: 0, skipped_big: 0, backoff_until: 0 };
  const sentAt = [], results = new Map(), tooSmall = new Set(), tries = new Map();
  let inflight = null, lastSend = 0, lastNextId = 0, askN = 0, canvas = null, scratch = null;
  const conf = (k) => Math.min(1, k.stable / HOLD_FRAMES);   // identity-hold proxy: frames the same player has stayed assigned to this track

  // the shirt box of a track, as a square in pixel space (the detector's shirt blob, widened so the number and collar fit)
  const squareOf = (k) => {
    const z = k.det; if (!z || !(z.u1 > z.u0) || !(z.sv1 > z.sv0)) return null;
    const cu = (z.u0 + z.u1) / 2, cv = VIS.H - 1 - (z.sv0 + z.sv1) / 2,   // detector rows count from the bottom; the buffer is drawn top row first
       side = Math.max(z.u1 - z.u0, z.sv1 - z.sv0) * 1.4, hp = +z.hp || 0;
    return { cu, cv, side: Math.max(side, hp * 0.7, 12) };   // the shirt blob can be a few pixels wide: take at least most of a player's height
  };
  // the detector's v counts rows from the bottom while VIS.buf, drawn as is, shows the stands at the bottom (checked by overlaying boxes on the drawn frame)
  const cropPng = (k) => {
    const sq = squareOf(k); if (!sq || !VIS.buf) return null;
    const W = VIS.W, H = VIS.H;
    scratch = scratch || document.createElement('canvas'); canvas = canvas || document.createElement('canvas');
    if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
    scratch.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(VIS.buf.buffer, VIS.buf.byteOffset, W * H * 4), W, H), 0, 0);
    canvas.width = canvas.height = SIDE;
    const g = canvas.getContext('2d'); g.imageSmoothingEnabled = true; g.fillStyle = '#000'; g.fillRect(0, 0, SIDE, SIDE);
    g.drawImage(scratch, sq.cu - sq.side / 2, sq.cv - sq.side / 2, sq.side, sq.side, 0, 0, SIDE, SIDE);
    return canvas.toDataURL('image/png').split(',')[1];
  };

  const pick = () => {
    const c = VIS.tracks.filter((k) => k.hits >= CFG.minHits && k.missT === 0 && k.inView && k.pid >= 0 && k.cls >= 1 && k.cls <= 4 && conf(k) < CONF_BELOW && !results.has(k.id) && !tooSmall.has(k.id) && (tries.get(k.id) || 0) < 2);
    c.sort((a, b) => conf(a) - conf(b) || ((b.det && b.det.hp) || 0) - ((a.det && a.det.hp) || 0));
    return c[0] || null;
  };
  const tick = () => {
    const now = Date.now();
    // between jobs, VIS.buf is the frame the tracks' detections came from; mid-job it may already hold the next capture
    if (!MCS.framed || typeof VIS === 'undefined' || !VIS.on || VIS.job || inflight || now < stats.backoff_until || now - lastSend < 4100) return;
    while (sentAt.length && now - sentAt[0] > 60000) sentAt.shift();
    if (sentAt.length >= PER_MIN) return;
    if (VIS.nextId < lastNextId) { results.clear(); tooSmall.clear(); tries.clear(); }   // the tracker restarted: its track ids start again
    lastNextId = VIS.nextId;
    for (const t of VIS.tracks) if (t.hits >= CFG.minHits && t.missT === 0 && t.inView && t.pid >= 0 && t.cls >= 1 && t.cls <= 4 && !results.has(t.id)) { if (t.det && t.det.hp >= CFG.minPx) tooSmall.delete(t.id); else tooSmall.add(t.id); }
    stats.skipped_small = tooSmall.size;
    const k = pick(); if (!k) return;
    const b64 = cropPng(k);
    if (!b64) { results.set(k.id, { skipped: true }); return; }
    if (b64.length * 0.75 > MAX_BYTES) { stats.skipped_big++; results.set(k.id, { skipped: true }); return; }
    const id = ++askN, team = k.cls === 1 || k.cls === 3 ? 'home' : 'away';
    tries.set(k.id, (tries.get(k.id) || 0) + 1); inflight = { id, track: k.id, t: now }; lastSend = now; sentAt.push(now); stats.sent++;
    MCS.send({ type: 'vision-crop', id, track_id: 't' + k.id, team_hint: team, crop: b64 });
  };
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.src !== 'matchcast-shell' || d.type !== 'vision-ocr' || !inflight || d.id !== inflight.id) return;
    const track = inflight.track; inflight = null; stats.answered++;
    if (d.error === 'unavailable') { stats.unavailable++; stats.backoff_until = Date.now() + 30000; return; }   // no live api: try again later
    if (d.error) { stats.errors++; stats.backoff_until = Date.now() + (d.retry_after ? d.retry_after * 1000 : 10000); return; }
    const r = d.result || {};
    if (r.shirt) { stats.read++; results.set(track, { shirt: String(r.shirt), confidence: +r.confidence || 0, t: Date.now() }); } else { stats.no_digits++; results.set(track, { shirt: null, confidence: 0, t: Date.now() }); }
  });
  setInterval(() => { if (inflight && Date.now() - inflight.t > 8000) { inflight = null; stats.errors++; stats.backoff_until = Date.now() + 10000; } tick(); }, 250);   // sends are 4.1 s apart = 14 a minute at most; the 250 ms poll waits for a gap between tracker jobs
  window.mcOcrStats = () => ({ ...stats, per_minute_cap: PER_MIN, tracks_with_result: results.size, tracks_too_small: tooSmall.size });
  window.mcOcr = { results, conf, cropPng, pick };
})();
