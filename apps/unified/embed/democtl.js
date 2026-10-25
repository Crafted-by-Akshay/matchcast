// ---- Watch: the seven camera presets, the player-name modes, the speed buttons and Match data sit behind one "Demo controls" button (audit: a quiet first screen). Runs in the Watch module after twofans.js. ----
// Nothing is removed: the buttons stay in the page and one click on "Demo controls" shows them. ?demo=1 (the filming URL) starts with them open.
(() => {
  const ctrl = document.getElementById('ctrl');
  if (!ctrl || document.getElementById('bc-view') || document.getElementById('mc-demo')) return;
  const st = document.createElement('style');
  st.textContent = '#ctrl.mc-folded>.grp:not(.mc-demo){display:none}body:not(.mc-demo-open) #wxchip{display:none}#mc-demo{font:600 12px system-ui,sans-serif}';
  document.head.appendChild(st);
  const grp = document.createElement('div'); grp.className = 'grp mc-demo';
  const b = document.createElement('button'); b.id = 'mc-demo'; b.type = 'button'; b.title = 'Camera presets, player names, speed and match data';
  const paint = () => { const open = !ctrl.classList.contains('mc-folded'); b.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('mc-demo-open', open); b.textContent = 'Demo controls'; b.title = (open ? 'Hide' : 'Show') + ' the camera presets, player names, speed, match data and the weather chip'; };
  b.onclick = () => { ctrl.classList.toggle('mc-folded'); paint(); };
  let outer = ''; try { outer = parent.location.search; } catch (e) { /* cross-origin parent */ }
  if (!/[?&]demo=1\b/.test(location.search + outer)) ctrl.classList.add('mc-folded');
  grp.appendChild(b);
  // Pause stays one tap away: it presses the real button in the folded speed group
  const pz = document.createElement('button'); pz.id = 'mc-pause'; pz.type = 'button'; pz.textContent = '⏯'; pz.title = 'Pause or resume the match'; pz.setAttribute('aria-label', 'Pause or resume the match');
  pz.onclick = () => { const real = document.querySelector('#play button'); if (real) real.click(); };
  grp.appendChild(pz);
  const vis = document.getElementById('visb'); if (vis) grp.appendChild(vis);   // Vision is part of the story (stage 2) and stays on the first screen
  ctrl.insertBefore(grp, ctrl.firstChild); paint();
})();
