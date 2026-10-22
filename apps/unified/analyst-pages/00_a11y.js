// EXP-14 (Analyst): fixes found by the axe audit in tests/e2e/a11y-analyst.spec.ts, without editing the read-only prototype source.
document.documentElement.lang = 'en';
{
  const st = document.createElement('style');
  // The light-theme --good and --warn text measured 4.19:1 and 3.95:1 on their tints. Redefining the tokens (no !important) lets the
  // dark theme's own, more specific token blocks still win, so dark mode is unchanged.
  st.textContent = ':root{--good:#11663d;--warn:#855008}';
  document.head.appendChild(st);
  const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const whiteContrast = (rgb) => 1.05 / (lum(rgb) + 0.05);
  const fixCrest = (c) => {
    const m = getComputedStyle(c).backgroundColor.match(/[\d.]+/g) || [];
    if (m.length < 3 || (m.length > 3 && +m[3] === 0)) return;
    if (c.dataset.a11yFrom === getComputedStyle(c).backgroundColor) return; // already the colour we set
    let rgb = m.slice(0, 3).map(Number), n = 0;
    while (whiteContrast(rgb) < 4.5 && n++ < 40) rgb = rgb.map((v) => Math.round(v * 0.93));
    const css = 'rgb(' + rgb.join(',') + ')';
    c.style.setProperty('background-color', css, 'important');
    c.dataset.a11yFrom = css;
  };
  const label = (s) => {
    const box = s.closest('.card') || s.closest('section');
    const h = box && box.querySelector('h2,h3,h4');
    s.setAttribute('aria-label', h ? h.textContent.trim() + ' chart' : 'Chart');
  };
  let queued = false;
  const fix = () => {
    queued = false;
    const root = document.getElementById('main') || document.body;
    root.querySelectorAll('svg[role="img"]:not([aria-label]):not([aria-labelledby])').forEach(label);
    // #main scrolls, and axe wants a scrollable region reachable by keyboard
    const m = document.getElementById('main'); if (m && m.getAttribute('tabindex') !== '0') m.setAttribute('tabindex', '0');
    // club colours come from the data; darken a crest until white text on it reaches 4.5:1 (reads first, then writes)
    document.querySelectorAll('.mc-crest').forEach(fixCrest);
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(fix); } }).observe(document.body, { childList: true, subtree: true });
  fix();
}
