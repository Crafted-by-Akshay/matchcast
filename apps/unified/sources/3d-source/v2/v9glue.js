// ---- v9 layout glue: the Match Pulse widget stacks under the watch-mode HUD on wide screens, so the two never overlap ----
{ const _hudG = hud; hud = function () { _hudG(); const pu = $('pulse'), fh = $('fan-hud'); if (!pu || !fh) return;
  if (innerWidth > 760 && !fh.hidden) { const r = fh.getBoundingClientRect(); pu.style.top = Math.round((r.height ? r.bottom : 88) + 8) + 'px'; } else pu.style.top = '';
  // the Vision panel sits on the right under the camera and speed controls, clear of the left-hand fan HUD
  const vp = $('visp'), c = $('ctrl'); if (vp && c && !vp.hidden) vp.style.top = innerWidth > 760 ? Math.round(c.getBoundingClientRect().bottom + 8) + 'px' : ''; }; }
