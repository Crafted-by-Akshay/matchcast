// UX review pass 1 (24 Oct): presentation only. Labels where a line has no stated source, and phone layouts for the Analyst.
{
  const st = document.createElement('style');
  st.textContent = '.mc-src{margin-left:6px;white-space:nowrap}'
    + '#top .brand em,#live-recorded .chip,#top .tenant small,#top #search kbd,#top .envtag,#nav .ng,.kpi .k,.chip,.tbl th,.mc-sc small{font-size:12px!important}'   // type floor: 12 px for the text that was 10 to 11 px (UX review pass 6, finding 18)
    // phone: the indices table stacks label and value, the sparkline fills the row; the Copilot button keeps its name
    + '@media (max-width:560px){'
    + '#idx-panel .tbl tr{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;padding:8px 0;border-top:1px solid var(--line)}'
    + '#idx-panel .tbl th,#idx-panel .tbl td{display:block;padding:0;border:0;text-align:left}'
    + '#idx-panel .tbl td:nth-child(3),#idx-panel .tbl td:nth-child(4){grid-column:1/3}'
    + '#idx-panel .tbl svg{max-width:100%}'
    + '#copbtn span{display:inline;font-size:0}#copbtn span::before{content:"Ask";font-size:13px}#copbtn{padding:0 8px;gap:4px}.who select{max-width:70px}'   // a short "Ask" on a phone
    + '}';
  document.head.appendChild(st);
  // the recap sentence under the scoreboard is written by the simulator's template, not a model: say so
  const mini0 = mcMini;
  mcMini = (m) => mini0(m).replace(/<\/p>$/, '<span class="chip warn mc-src" title="Written by the simulator\'s template from the recorded match numbers, not by a model">Template recap · simulated</span></p>');
  // the visible label shortens on a phone, so the accessible name is set outright (it still contains the visible word)
  const cb = document.getElementById('copbtn'); if (cb) cb.setAttribute('aria-label', 'Ask Copilot');
}
