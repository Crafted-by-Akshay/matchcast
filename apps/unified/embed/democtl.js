// ---- Watch: advanced simulation settings sit behind one button; a visible label explains why the synthetic pitch has weather. Runs after twofans.js. ----
(() => {
  const ctrl = document.getElementById('ctrl');
  if (!ctrl || document.getElementById('bc-view') || document.getElementById('mc-demo')) return;
  let outer = ''; try { outer = parent.location.search; } catch (e) { /* cross-origin parent */ }
  const demoUrl = /[?&]demo=1\b/.test(location.search + outer);
  if (!demoUrl) { const hidePresets = document.createElement('style'); hidePresets.textContent = '#cams{display:none!important}'; document.head.appendChild(hidePresets); }   // the seven camera presets are off the screen for the sprint (AB#497); the buttons stay in the page, and ?demo=1 (the filming URL) brings them back
  const st = document.createElement('style');
  st.textContent = '#ctrl.mc-folded>.grp:not(.mc-demo){display:none}body:not(.mc-demo-open) #wxchip{display:none}#mc-demo{font:600 12px system-ui,sans-serif}.mc-weather-note{position:fixed;z-index:6;top:calc(52px + env(safe-area-inset-top,0px));right:calc(14px + env(safe-area-inset-right,0px));max-width:min(220px,calc(100vw - 28px));padding:5px 9px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(4,13,17,.82);color:#d9e8e2;font:700 10px/1.2 system-ui,sans-serif;letter-spacing:.04em;pointer-events:none}.mc-weather-note[hidden]{display:none!important}';
  document.head.appendChild(st);
  const grp = document.createElement('div'); grp.className = 'grp mc-demo';
  const b = document.createElement('button'); b.id = 'mc-demo'; b.type = 'button'; b.title = 'Simulation settings: player labels, speed, match data and weather';
  const paint = () => { const open = !ctrl.classList.contains('mc-folded'); b.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('mc-demo-open', open); b.textContent = 'Simulation settings'; b.title = (open ? 'Hide' : 'Show') + ' player labels, speed, match data and weather settings'; };
  b.onclick = () => { ctrl.classList.toggle('mc-folded'); paint(); };
  if (!demoUrl) ctrl.classList.add('mc-folded');
  // CREW (crew UI, on by default, CREW-7.8): a judge sees no weather chip and no camera presets unless ?demo=1, so the Demo controls button goes too (Pause, Vision and Copilot stay)
  let crew = !/[?&]crew=0(&|$)/.test(location.search + '&' + outer);   // default on; ?crew=0 or localStorage mc-crew=0 turns it off, an explicit crew=1 beats a stored 0
  try { if (crew && !/[?&]crew=1(&|$)/.test(location.search + '&' + outer) && localStorage.getItem('mc-crew') === '0') crew = false; } catch (e) { /* storage blocked */ }
  if (crew && !demoUrl) { const hide = document.createElement('style'); hide.textContent = '#mc-demo,#wxchip,#cams{display:none!important}'; document.head.appendChild(hide); b.hidden = true; }
  const weather = document.getElementById('wxchip');
  if (weather) {
    const note = document.createElement('span'); note.id = 'mc-weather-note'; note.className = 'mc-weather-note'; note.setAttribute('role', 'note');
    const updateWeather = () => {
      const text = weather.textContent || '';
      const condition = /⛈|🌧|rain/i.test(text) ? 'RAIN' : /❄|snow/i.test(text) ? 'SNOW' : /☀|clear|sun/i.test(text) ? 'CLEAR' : /cloud/i.test(text) ? 'CLOUDY' : 'CONDITIONS SET';
      note.textContent = 'SIMULATED WEATHER · ' + condition;
      note.hidden = getComputedStyle(weather).display !== 'none';
    };
    (weather.parentElement || document.body).appendChild(note); updateWeather();
    new MutationObserver(updateWeather).observe(weather, { childList: true, subtree: true, characterData: true });
    new MutationObserver(updateWeather).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  grp.appendChild(b);
  // Pause stays one tap away: it presses the real button in the folded speed group
  const pz = document.createElement('button'); pz.id = 'mc-pause'; pz.type = 'button'; pz.textContent = '⏯'; pz.title = 'Pause or resume the match'; pz.setAttribute('aria-label', 'Pause or resume the match');
  pz.onclick = () => { const real = document.querySelector('#play button'); if (real) real.click(); };
  grp.appendChild(pz);
  const vis = document.getElementById('visb'); if (vis) grp.appendChild(vis);   // Vision is part of the story (stage 2) and stays on the first screen
  ctrl.insertBefore(grp, ctrl.firstChild); paint();
})();
