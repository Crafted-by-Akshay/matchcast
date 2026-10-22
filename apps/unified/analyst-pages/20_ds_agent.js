// AGT-14 (task 139): the Data Scientist page asks the agent api (POST /v1/ds/ask) when one is configured.
// The api returns one verified SELECT, its table and a Vega-Lite spec; we draw the table and a bar chart from the rows.
// Without an api, or when it fails, the prototype's rules answer stands and is labelled as before.
const dsApi = () => { try { return window.parent !== window ? window.parent.MATCHCAST_API || '' : ''; } catch (e) { return ''; } };
const dsSession = (() => { const k = 'mc-ds-session'; try { let s = sessionStorage.getItem(k); if (!s) { s = 'ds' + Math.random().toString(36).slice(2, 12); sessionStorage.setItem(k, s); } return s; } catch (e) { return 'ds' + Math.random().toString(36).slice(2, 12); } })();
function dsShape(r) { // a verified result we can draw: columns, rows of the same width, a non-empty answer
  return r && r.verdict === 'verified' && typeof r.answer === 'string' && r.answer && Array.isArray(r.columns) && r.columns.length && Array.isArray(r.rows) && r.rows.length &&
    r.rows.every((row) => Array.isArray(row) && row.length === r.columns.length) ? r : null;
}
function dsRich(r) {
  const rows = r.rows.slice(0, 12);
  const cell = (v) => esc(String(typeof v === 'number' ? +v.toFixed(3) : v == null ? '' : v));
  const nums = rows.map((row) => row[1]);
  const plot = r.chart_spec && r.columns.length >= 2 && nums.every((v) => typeof v === 'number' && isFinite(v) && v >= 0);
  const mx = Math.max(...nums.filter((v) => typeof v === 'number'), 1e-9);
  const bars = plot ? '<svg role="img" aria-label="Bar chart of ' + esc(r.columns[1]) + '" viewBox="0 0 360 ' + (rows.length * 20 + 6) + '" style="max-width:100%">' +
    rows.map((row, i) => '<text x="0" y="' + (i * 20 + 14) + '" font-size="11" fill="currentColor">' + esc(String(row[0]).slice(0, 18)) + '</text><rect x="120" y="' + (i * 20 + 4) + '" height="12" width="' + Math.max(1, (nums[i] / mx) * 200) + '" fill="#2E7DD7"/><text x="' + (124 + (nums[i] / mx) * 200) + '" y="' + (i * 20 + 14) + '" font-size="11" fill="currentColor">' + esc(String(+nums[i].toFixed(2))) + '</text>').join('') + '</svg>' : '';
  return '<table class="tbl" data-ds="table"><thead><tr>' + r.columns.map((c) => '<th>' + cell(c) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((row) => '<tr>' + row.map((v) => '<td>' + cell(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table>' +
    (r.rows.length > rows.length ? '<div class="note">Showing ' + rows.length + ' of ' + r.rows.length + ' rows.</div>' : '') + bars +
    '<details><summary>SQL</summary><pre data-ds="sql">' + cell(r.sql || '') + '</pre></details>';
}
const dsAskRules = d2_agAsk;
async function dsAskRulesEntry(el, q) { await dsAskRules(el, q); return d2_S.agt.log.pop() || { role: 'a', text: '', src: 'rules' }; }
d2_agAsk = async function (el, q) {
  q = String(q || '').trim();
  if (!q || !dsApi()) return dsAskRules(el, q);
  if (!gate('ask', 'a question to the Data Scientist agent')) return;
  const st = d2_S.agt; if (st.busy) return;
  st.log.push({ role: 'q', text: q }); st.busy = true; if (el.isConnected) d2_agDraw(el);
  let entry; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(dsApi().replace(/\/+$/, '') + '/v1/ds/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: dsSession, question: q.slice(0, 300) }), signal: ctl.signal });
    if (res.status === 429) { st.busy = false; st.log.pop(); const ra = await dsAskRulesEntry(el, q); st.log.push(Object.assign(ra, { note: 'The agent is rate limited, so the rules answered.' })); st.log = st.log.slice(-12); if (el.isConnected) d2_agDraw(el); return; }
    if (!res.ok) throw new Error('api ' + res.status);
    const r = await res.json();
    const ok = dsShape(r);
    // only a verified, well-formed result shows the api's own numbers, table, chart and SQL; anything else is a fixed sentence
    entry = ok ? { role: 'a', text: r.answer, src: 'api', ds: r, verdict: 'verified', steps: r.sql ? ['query_season(' + r.sql + ')'] : [] }
      : { role: 'a', text: r.verdict === 'abstained' && typeof r.answer === 'string' ? r.answer : 'Could not verify this result.', src: 'api', ds: null, verdict: r && r.verdict === 'abstained' ? 'abstained' : 'unverified', steps: [] };
  } catch (e) {
    clearTimeout(timer); st.busy = false; st.log.pop(); return dsAskRules(el, q); // api silent: the rules answer, labelled as rules
  }
  clearTimeout(timer);
  st.log.push(entry); st.log = st.log.slice(-12); st.busy = false; if (el.isConnected) d2_agDraw(el);
};
const dsDrawBase = d2_agDraw;
d2_agDraw = function (el) {
  dsDrawBase(el);
  const answers = el.querySelectorAll('.d2-a'); let i = 0;
  for (const x of d2_S.agt.log) {
    if (x.role !== 'a') continue;
    const box = answers[i++]; if (!box) continue;
    if (x.note) box.insertAdjacentHTML('beforeend', '<div class="note">' + esc(x.note) + '</div>');
    if (x.src !== 'api') continue;
    const meta = box.querySelector('.d2-meta');
    const chipHtml = chip(x.verdict === 'verified' ? 'Data Scientist · agent · verified ✓' : 'Data Scientist · agent · ' + esc(x.verdict || 'unverified'), x.verdict === 'verified' ? 'acc' : '');
    if (meta) meta.innerHTML = chipHtml;
    if (x.ds) { try { box.insertAdjacentHTML('beforeend', dsRich(x.ds)); } catch (e) { console.warn('ds table skipped', e); } }
  }
};
