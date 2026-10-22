// AGT-14 (task 139): the Data Scientist page asks the agent api (POST /v1/ds/ask) when one is configured.
// The api returns one verified SELECT, its table and a Vega-Lite spec; we draw the table and a bar chart from the rows.
// Without an api, or when it fails, the prototype's rules answer stands and is labelled as before.
const dsApi = () => { try { return window.parent !== window ? window.parent.MATCHCAST_API || '' : ''; } catch (e) { return ''; } };
const dsSession = (() => { const k = 'mc-ds-session'; try { let s = sessionStorage.getItem(k); if (!s) { s = 'ds' + Math.random().toString(36).slice(2, 12); sessionStorage.setItem(k, s); } return s; } catch (e) { return 'ds' + Math.random().toString(36).slice(2, 12); } })();
function dsRich(r) {
  const head = r.columns.map((c) => '<th>' + esc(c) + '</th>').join('');
  const body = r.rows.slice(0, 12).map((row) => '<tr>' + row.map((v) => '<td>' + esc(String(typeof v === 'number' ? +v.toFixed(3) : v)) + '</td>').join('') + '</tr>').join('');
  const nums = r.rows.slice(0, 12).map((row) => +row[1]);
  const mx = Math.max(...nums, 1e-9);
  const bars = r.chart_spec ? '<svg role="img" aria-label="Bar chart of ' + esc(r.columns[1] || '') + '" viewBox="0 0 360 ' + (r.rows.slice(0, 12).length * 20 + 6) + '" style="max-width:100%">' +
    r.rows.slice(0, 12).map((row, i) => '<text x="0" y="' + (i * 20 + 14) + '" font-size="11" fill="currentColor">' + esc(String(row[0]).slice(0, 18)) + '</text><rect x="120" y="' + (i * 20 + 4) + '" height="12" width="' + Math.max(1, (nums[i] / mx) * 200) + '" fill="#2E7DD7"/><text x="' + (124 + (nums[i] / mx) * 200) + '" y="' + (i * 20 + 14) + '" font-size="11" fill="currentColor">' + esc(String(+nums[i].toFixed(2))) + '</text>').join('') + '</svg>' : '';
  return '<table class="tbl" data-ds="table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>' + bars +
    '<details><summary>SQL</summary><pre data-ds="sql">' + esc(r.sql || '') + '</pre></details>';
}
const dsAskRules = d2_agAsk;
d2_agAsk = async function (el, q) {
  q = String(q || '').trim();
  if (!q || !dsApi()) return dsAskRules(el, q);
  if (!gate('ask', 'a question to the Data Scientist agent')) return;
  const st = d2_S.agt; if (st.busy) return;
  st.log.push({ role: 'q', text: q }); st.busy = true; if (el.isConnected) d2_agDraw(el);
  let entry;
  try {
    const res = await fetch(dsApi() + '/v1/ds/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: dsSession, question: q.slice(0, 300) }) });
    if (!res.ok) throw new Error('api ' + res.status);
    const r = await res.json();
    entry = { role: 'a', text: r.verdict === 'verified' ? r.answer : r.answer || 'Could not verify this result.', src: 'api', ds: r.verdict === 'verified' && r.rows && r.rows.length ? r : null, verdict: r.verdict, steps: r.sql ? ['query_season(' + r.sql + ')'] : [] };
  } catch (e) {
    st.busy = false; st.log.pop(); return dsAskRules(el, q); // api silent: the rules answer, labelled as rules
  }
  st.log.push(entry); st.log = st.log.slice(-12); st.busy = false; if (el.isConnected) d2_agDraw(el);
};
const dsDrawBase = d2_agDraw;
d2_agDraw = function (el) {
  dsDrawBase(el);
  const answers = el.querySelectorAll('.d2-a'); let i = 0;
  for (const x of d2_S.agt.log) {
    if (x.role !== 'a') continue;
    const box = answers[i++]; if (!box || x.src !== 'api') continue;
    const meta = box.querySelector('.d2-meta');
    const chipHtml = chip(x.verdict === 'verified' ? 'Data Scientist · agent · verified ✓' : 'Data Scientist · agent · ' + esc(x.verdict || 'unverified'), x.verdict === 'verified' ? 'acc' : '');
    if (meta) meta.innerHTML = chipHtml;
    if (x.ds) box.insertAdjacentHTML('beforeend', dsRich(x.ds));
  }
};
