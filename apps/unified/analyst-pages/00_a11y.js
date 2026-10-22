// EXP-14 (Analyst): fixes found by the axe audit in tests/e2e/a11y-analyst.spec.ts, without editing the read-only prototype source.
document.documentElement.lang = 'en';
{
  const st = document.createElement('style');
  // green/amber text on tinted chips measured 4.19:1 and 3.95:1; these darker shades pass 4.5:1 on the same tints
  st.textContent = '.good,.POST{color:#11663d!important}.warn,.lock{color:#855008!important}';
  document.head.appendChild(st);
  const fix = () => {
    document.querySelectorAll('svg[role="img"]:not([aria-label]):not([aria-labelledby])').forEach((s) => {
      const h = s.closest('.card,section,div[class]') && s.closest('.card,section,div[class]').querySelector('h2,h3,h4');
      s.setAttribute('aria-label', (h ? h.textContent.trim() + ' chart' : 'Chart'));
    });
    const m = document.getElementById('main'); if (m && m.getAttribute('tabindex') !== '0') m.setAttribute('tabindex', '0');
    // club colours come from the data; darken a crest until white text on it reaches 4.5:1
    document.querySelectorAll('.mc-crest:not([data-a11y])').forEach((c) => {
      c.dataset.a11y = '1';
      const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      let rgb = (getComputedStyle(c).backgroundColor.match(/\d+/g) || []).slice(0, 3).map(Number);
      if (rgb.length < 3) return;
      for (let i = 0; i < 12 && 1.05 / (lum(rgb) + 0.05) < 4.5; i++) rgb = rgb.map((v) => Math.round(v * 0.92));
      c.style.setProperty('background-color', 'rgb(' + rgb.join(',') + ')', 'important');
    });
  };
  new MutationObserver(fix).observe(document.body, { childList: true, subtree: true });
  fix();
}
