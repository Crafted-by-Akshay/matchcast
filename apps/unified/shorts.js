// ---- unified console: auto Shorts (Highlights tab). Each key-moment clip is replayed as a vertical 9:16 short on a canvas: a
// top-down pitch drawn from the clip's recorded Watch frames (player and ball positions), with the moment's commentary as the caption.
// Simulated: a 2D replay from the engine's recorded positions, not a video file. Nothing is stored: a clip lives in this page's memory.
const SH = (() => {
  const W = 270, H = 480, PITCH = { x0: 10, y0: 20, w: 250, h: 386 }, FRAME_MS = 250;   // 68 m across, 105 m long, one frame a quarter second
  const dot = (ctx, x, y, r, col) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); };
  // the pitch: the long side runs down the short, so the frame reads as a phone screen
  const draw = (ctx, frame) => {
    ctx.fillStyle = '#0b3d2a'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(PITCH.x0, PITCH.y0, PITCH.w, PITCH.h);
    ctx.beginPath(); ctx.moveTo(PITCH.x0, PITCH.y0 + PITCH.h / 2); ctx.lineTo(PITCH.x0 + PITCH.w, PITCH.y0 + PITCH.h / 2); ctx.stroke();
    if (!frame) return;
    const sx = (y) => PITCH.x0 + (+y / 68) * PITCH.w, sy = (x) => PITCH.y0 + (+x / 105) * PITCH.h;
    (frame.players || []).forEach((q, i) => { if (q && Number.isFinite(+q[0]) && Number.isFinite(+q[1])) dot(ctx, sx(q[1]), sy(q[0]), 4, i < 11 ? '#3aa0ff' : '#ffd166'); });
    if (frame.ball && Number.isFinite(+frame.ball[0]) && Number.isFinite(+frame.ball[1])) dot(ctx, sx(frame.ball[1]), sy(frame.ball[0]), 3, '#ffffff');
    ctx.fillStyle = '#fff'; ctx.font = '600 12px system-ui,sans-serif';
    ctx.fillText((frame.score ? frame.score.join('-') : '') + "  " + (frame.mclock != null ? Math.floor(frame.mclock / 60) + "'" : ''), 12, 16);
  };
  // play(canvas, clip, onEnd): plays the clip's frames once at the recorded pace; returns stop()
  const play = (canvas, frames, onEnd) => {
    const ctx = canvas.getContext('2d');
    let i = 0, timer = 0, stopped = false;
    const tick = () => {
      if (stopped) return;
      if (i >= frames.length) { draw(ctx, frames[frames.length - 1]); onEnd && onEnd(); return; }
      draw(ctx, frames[i]); i += 1;
      timer = setTimeout(tick, FRAME_MS);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  };
  const still = (canvas, label) => { const ctx = canvas.getContext('2d'); draw(ctx, null); ctx.fillStyle = '#fff'; ctx.font = '600 12px system-ui,sans-serif'; ctx.fillText(label || 'No frames for this moment', 12, 16); };
  return { W, H, play, still };
})();
if (typeof window !== 'undefined') window.SH = SH;
