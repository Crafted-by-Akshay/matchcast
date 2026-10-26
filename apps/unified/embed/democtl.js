// ---- Watch: the player-name modes, the speed buttons and Match data sit behind one "Demo controls" button (audit: a quiet first screen). The seven camera presets are hidden for the sprint (AB#497). Runs in the Watch module after twofans.js. ----
// Nothing is removed: the buttons stay in the page and one click on "Demo controls" shows the speed, names and match data. The camera presets stay hidden for the sprint (AB#497). ?demo=1 (the filming URL) starts with the controls open.
(() => {
  const ctrl = document.getElementById('ctrl');
  if (!ctrl || document.getElementById('bc-view') || document.getElementById('mc-demo')) return;
  let outer = ''; try { outer = parent.location.search; } catch (e) { /* cross-origin parent */ }
  const demoUrl = /[?&]demo=1\b/.test(location.search + outer);
  if (!demoUrl) { const hidePresets = document.createElement('style'); hidePresets.textContent = '#cams{display:none!important}'; document.head.appendChild(hidePresets); }   // the seven camera presets are off the screen for the sprint (AB#497); the buttons stay in the page, and ?demo=1 (the filming URL) brings them back
  const st = document.createElement('style');
  st.textContent = '#ctrl.mc-folded>.grp:not(.mc-demo){display:none}body:not(.mc-demo-open) #wxchip{display:none}#mc-demo{font:600 12px system-ui,sans-serif}';
  document.head.appendChild(st);
  const grp = document.createElement('div'); grp.className = 'grp mc-demo';
  const b = document.createElement('button'); b.id = 'mc-demo'; b.type = 'button'; b.title = 'Player names, speed, match data and the weather chip';
  const paint = () => { const open = !ctrl.classList.contains('mc-folded'); b.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('mc-demo-open', open); b.textContent = 'Demo controls'; b.title = (open ? 'Hide' : 'Show') + ' player names, speed, match data and the weather chip'; };
  b.onclick = () => { ctrl.classList.toggle('mc-folded'); paint(); };
  if (!demoUrl) ctrl.classList.add('mc-folded');
  // CREW (crew UI, on by default, CREW-7.8): a judge sees no weather chip and no camera presets unless ?demo=1, so the Demo controls button goes too (Pause, Vision and Copilot stay)
  let crew = !/[?&]crew=0(&|$)/.test(location.search + '&' + outer);   // default on; ?crew=0 or localStorage mc-crew=0 turns it off, an explicit crew=1 beats a stored 0
  try { if (crew && !/[?&]crew=1(&|$)/.test(location.search + '&' + outer) && localStorage.getItem('mc-crew') === '0') crew = false; } catch (e) { /* storage blocked */ }
  if (crew && !demoUrl) { const hide = document.createElement('style'); hide.textContent = '#mc-demo,#wxchip,#cams{display:none!important}'; document.head.appendChild(hide); b.hidden = true; }
  grp.appendChild(b);
  // Pause stays one tap away: it presses the real button in the folded speed group
  const pz = document.createElement('button'); pz.id = 'mc-pause'; pz.type = 'button'; pz.textContent = '⏯'; pz.title = 'Pause or resume the match'; pz.setAttribute('aria-label', 'Pause or resume the match');
  pz.onclick = () => { const real = document.querySelector('#play button'); if (real) real.click(); };
  grp.appendChild(pz);
  const vis = document.getElementById('visb'); if (vis) grp.appendChild(vis);   // Vision is part of the story (stage 2) and stays on the first screen
  ctrl.insertBefore(grp, ctrl.firstChild); paint();
})();
