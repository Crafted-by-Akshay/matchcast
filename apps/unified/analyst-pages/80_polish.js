// UX review pass 1 (24 Oct): presentation only. Labels where a line has no stated source, and phone layouts for the Analyst.
{
  const st = document.createElement('style');
  st.textContent = '.mc-src{margin-left:6px;white-space:nowrap}'
    // phone: the indices table stacks label and value, the sparkline fills the row; the Copilot button keeps its name
    + '@media (max-width:560px){'
    + '#idx-panel .tbl tr{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;padding:8px 0;border-top:1px solid var(--line)}'
    + '#idx-panel .tbl th,#idx-panel .tbl td{display:block;padding:0;border:0;text-align:left}'
    + '#idx-panel .tbl td:nth-child(3),#idx-panel .tbl td:nth-child(4){grid-column:1/3}'
    + '#idx-panel .tbl svg{width:100%;height:28px}'
    + '#copbtn span{display:inline;font-size:0}#copbtn span::before{content:"Ask";font-size:13px}#copbtn{padding:0 8px;gap:4px}.who select{max-width:70px}'   // the name is a short "Ask" on a phone; the accessible name stays Copilot
    + '}';
  document.head.appendChild(st);
  // the recap sentence under the scoreboard is written by the simulator's template, not a model: say so
  const mini0 = mcMini;
  mcMini = (m) => mini0(m).replace(/<\/p>$/, '<span class="chip warn mc-src" title="Written by the simulator\'s template from the recorded match numbers, not by a model">Template recap · simulated</span></p>');
}
