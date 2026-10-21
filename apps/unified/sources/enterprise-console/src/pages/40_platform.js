// ===================================================================================================
// Platform & access pages: access (users, roles, requests, approvals, SSO), api (REST reference with a
// local "Try it", API keys, webhooks, integrations), usage (session usage + Azure cost model), status
// (live health checks, latency, SLOs, incidents) and settings (org, appearance, AI policy, retention).
// Exposes the global SETTINGS (read by other pages, e.g. SETTINGS.ai.requireVerifier) and pf_watermark().
// ===================================================================================================
const PF_DEFAULTS = {
  org: { name: 'Harbor City FC', dept: 'Analysis department', tenant: 'harborcityfc (demo tenant)', region: 'West Europe (planned)', contact: 'analysis@harborcity.example' },
  theme: 'system',
  lang: 'en-GB', units: 'metric', dateFmt: 'D MMM YYYY',
  retention: { audit: 365, exports: 90, aiRuns: 30, drafts: 180 },
  ai: { requireVerifier: true, minGround: 100, allowClaude: true, allowRules: true },
  watermark: '{org} · Internal · {user} · {date}',
};
const pf_clone = (o) => JSON.parse(JSON.stringify(o));
function pf_loadSettings() {
  const s = pf_clone(PF_DEFAULTS);
  try {
    const raw = JSON.parse(localStorage.getItem('mce.settings') || 'null');
    if (raw && typeof raw === 'object') for (const k in s) { if (raw[k] === undefined) continue; if (s[k] && typeof s[k] === 'object') Object.assign(s[k], raw[k]); else s[k] = raw[k]; }
  } catch (e) {}
  try { const t = localStorage.getItem('mce.theme'); if (t === 'light' || t === 'dark' || t === 'system') s.theme = t; } catch (e) {}
  return s;
}
var SETTINGS = pf_loadSettings();
function pf_applyTheme(t) { if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
pf_applyTheme(SETTINGS.theme);
function pf_saveSettings() { try { localStorage.setItem('mce.settings', JSON.stringify(SETTINGS)); } catch (e) {} }
// watermark text for exports: tokens {org} {user} {date} {role}
function pf_watermark() { return String(SETTINGS.watermark || '').replace(/\{org\}/g, SETTINGS.org.name).replace(/\{user\}/g, me().name).replace(/\{role\}/g, ROLE).replace(/\{date\}/g, new Date().toISOString().slice(0, 10)); }

// ---------------------------------------------------------------- session telemetry: page views and incidents
const PF = {
  views: {}, viewLog: [], incidents: [], t0: Date.now(),
  acc: { tab: 'users', q: '', role: 'all', sort: {}, reqs: null },
  api: { ep: 0, vals: {}, key: '', body: null, resp: null, keys: null, hooks: null },
  st: { res: null, running: false, hist: [] },
  set: { draft: null },
};
const pf_route = route;
route = function (...a) {
  const id = PAGES[a[0]] ? a[0] : 'home';
  PF.views[id] = (PF.views[id] || 0) + 1; PF.viewLog.push({ id, at: Date.now() });
  const r = pf_route(...a);
  const h = document.querySelector('#pg .pg-h h1');
  if (h && h.textContent === 'Something went wrong') pf_incident('Page render failed', (PAGES[id] || {}).title || id, (document.querySelector('#pg .pg-h p') || {}).textContent || '');
  return r;
};
function pf_incident(title, comp, detail) { PF.incidents.unshift({ title, comp, detail: String(detail || '').slice(0, 200), at: new Date().toISOString() }); }
window.addEventListener('error', (e) => pf_incident('Script error', 'Console', e.message));
window.addEventListener('unhandledrejection', (e) => pf_incident('Unhandled promise rejection', 'Console', e.reason && (e.reason.message || String(e.reason))));

// ---------------------------------------------------------------- styles
(function () {
  const s = document.createElement('style');
  s.textContent = `
.pf-col{display:flex;flex-direction:column;gap:14px;min-width:0}
.pf-mx td,.pf-mx th{text-align:center}.pf-mx td:first-child,.pf-mx th:first-child{text-align:left}
.pf-mx .yes{color:var(--good);font-weight:700}.pf-mx .no{color:var(--line-2)}
.pf-mx th.me,.pf-mx td.me{background:var(--accent-soft)}
.pf-av{width:30px;height:30px;border-radius:50%;display:inline-grid;place-items:center;font:600 11px var(--f-mono);background:var(--surface-3);color:var(--ink-2);flex:none}
.pf-u{display:flex;gap:10px;align-items:center;min-width:0}.pf-u b{font-weight:600}.pf-u div{min-width:0}
.pf-form{display:grid;gap:10px}.pf-form .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.pf-checks{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--ink-2)}.pf-checks label{display:inline-flex;gap:6px;align-items:center}
.pf-m{display:inline-block;font:600 10.5px var(--f-mono);padding:3px 6px;border-radius:4px;min-width:42px;text-align:center;letter-spacing:.04em}
.pf-m.GET{background:var(--info-soft);color:var(--info)}.pf-m.POST{background:var(--good-soft);color:var(--good)}
.pf-eps{display:flex;flex-direction:column;gap:2px}
.pf-ep{display:flex;gap:8px;align-items:center;text-align:left;background:none;border:1px solid transparent;border-radius:6px;padding:7px 8px;font:12.5px var(--f-mono);color:var(--ink-2);min-width:0}
.pf-ep span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf-ep:hover{background:var(--surface-2)}.pf-ep[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--line-2);color:var(--ink)}
.pf-url{display:flex;gap:8px;align-items:center;background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:8px 10px;font:12.5px var(--f-mono);overflow-x:auto;white-space:nowrap}
.pf-resp-h{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0 8px}
.pf-resp pre.code{max-height:380px;overflow:auto}
.pf-sec{font:600 10.5px var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px}
.pf-secret{display:flex;gap:8px;align-items:center;background:var(--warn-soft);border:1px solid var(--warn);border-radius:6px;padding:10px;font:12.5px var(--f-mono);overflow-wrap:anywhere;color:var(--ink)}
.pf-trunc{display:inline-block;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;font-size:12px}
.pf-int{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.pf-int .card{box-shadow:none;display:flex;flex-direction:column;gap:6px}
.pf-int h4{margin:0;font-size:13.5px;display:flex;justify-content:space-between;gap:8px;align-items:center}
.pf-int p{margin:0;font-size:12.5px;color:var(--muted)}
.pf-gauge{position:relative;height:16px;border-radius:8px;background:var(--surface-3);overflow:visible;margin:28px 0 30px}
.pf-gauge i{position:absolute;left:0;top:0;bottom:0;border-radius:8px}
.pf-gauge .mk{position:absolute;top:-6px;bottom:-6px;width:2px;background:var(--ink-2)}
.pf-gauge .mk span{position:absolute;top:22px;left:50%;transform:translateX(-50%);font:500 10.5px var(--f-mono);color:var(--muted);white-space:nowrap}
.pf-gauge .val{position:absolute;top:-22px;font:600 12px var(--f-mono);color:var(--ink);transform:translateX(-50%);white-space:nowrap}
.pf-banner{display:flex;gap:12px;align-items:center;border-radius:var(--r);padding:12px 16px;margin-bottom:14px;border:1px solid var(--line)}
.pf-banner.good{background:var(--good-soft);color:var(--good)}.pf-banner.warn{background:var(--warn-soft);color:var(--warn)}.pf-banner.bad{background:var(--bad-soft);color:var(--bad)}
.pf-banner b{font-size:15px}.pf-banner span{color:var(--ink-2);font-size:12.5px}
.pf-sd{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:0}
.pf-sd.good{background:var(--good)}.pf-sd.warn{background:var(--warn)}.pf-sd.bad{background:var(--bad)}
.pf-comp{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,2.4fr) 72px 104px;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line);font-size:13px}
.pf-comp:first-child{border-top:0}.pf-comp .s{color:var(--muted);font-size:12px}
@media (max-width:640px){.pf-comp{grid-template-columns:minmax(0,1fr) auto auto}.pf-comp .s{grid-column:1/-1;order:3}}
.pf-set{display:grid;gap:12px}.pf-set .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.pf-tog{display:flex;gap:10px;align-items:flex-start;font-size:13px;padding:8px 0;border-top:1px solid var(--line)}.pf-tog:first-of-type{border-top:0}
.pf-tog input{margin-top:3px}.pf-tog small{display:block;color:var(--muted);font-size:12px}
.pf-wm{border:1px dashed var(--line-2);border-radius:6px;padding:10px 12px;font:12px var(--f-mono);color:var(--muted);background:var(--surface-2)}
.pf-thm{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.pf-thm button{border:1px solid var(--line-2);border-radius:8px;background:var(--surface);padding:8px;text-align:left;font-size:12.5px;color:var(--ink-2)}
.pf-thm button[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft);color:var(--ink);font-weight:600}
.pf-thm .sw{display:block;height:34px;border-radius:5px;margin-bottom:6px;border:1px solid var(--line)}
.pf-thm .sw.l{background:linear-gradient(90deg,#FFFFFF 50%,#EDF2EF 50%)}.pf-thm .sw.d{background:linear-gradient(90deg,#131C19 50%,#0C1311 50%)}.pf-thm .sw.s{background:linear-gradient(90deg,#FFFFFF 50%,#131C19 50%)}
`;
  document.head.appendChild(s);
})();

// ---------------------------------------------------------------- helpers
const pf_ini = (n) => n.replace(/^Dr\.?\s+/, '').split(' ').map((x) => x[0]).join('').slice(0, 2);
const pf_ago = (iso) => { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const pf_time = (iso) => { const d = new Date(iso); return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 16) + ' UTC'; };
const pf_safe = (f, title) => { try { return f(); } catch (e) { console.error(e); pf_incident('Card failed to render', title, e.message); return card(title, '', '<div class="empty">This card could not be drawn: ' + esc(e.message) + '</div>'); } };
const pf_rand = (n) => { const b = new Uint8Array(n); try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256); } return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };
const pf_copy = (t) => { try { navigator.clipboard.writeText(t).then(() => toast('Copied to clipboard.'), () => toast('Copy isn’t available here. Select the text and copy it.')); } catch (e) { toast('Copy isn’t available here. Select the text and copy it.'); } };
const ROLE_ORDER = ['viewer', 'analyst', 'scout', 'manager', 'admin'];
const ROLE_LBL = { viewer: 'Viewer', analyst: 'Analyst', scout: 'Scout', manager: 'Approver', admin: 'Admin' };
function pf_redraw(el, pageId, f) { if (el.isConnected && R.page === pageId) f(el); }

// ===================================================================================================
// ACCESS
// ===================================================================================================
const PF_STAFF = [
  { name: 'Marcus Okafor', title: 'Assistant coach', group: 'MC-Viewers', role: 'viewer', last: '3 h ago', status: 'Active' },
  { name: 'Sofia Brandt', title: 'Performance analyst', group: 'MC-Analysts', role: 'analyst', last: 'Yesterday', status: 'Active' },
  { name: 'Ben Achterberg', title: 'Academy analyst', group: 'MC-Analysts', role: 'analyst', last: 'Never', status: 'Invited' },
  { name: 'Kenji Watanabe', title: 'Recruitment analyst', group: 'MC-Scouts', role: 'scout', last: '2 d ago', status: 'Active' },
  { name: 'Rachel Dunmore', title: 'Director of football (approver)', group: 'MC-Approvers', role: 'manager', last: '5 h ago', status: 'Active' },
  { name: 'Owen Price', title: 'Data engineer', group: 'MC-Admins', role: 'admin', last: '1 d ago', status: 'Active' },
  { name: 'Dr. Nadia Rahman', title: 'Sports science consultant (external)', group: 'MC-Guests', role: 'viewer', last: '6 d ago', status: 'Guest', guest: true, expires: '2026-12-31' },
];
function pf_users() {
  const demo = Object.entries(USERS).map(([k, u]) => ({ name: u.name, title: u.title, group: u.group, role: k, demo: true, last: k === ROLE ? 'Now · this session' : 'Demo switcher', status: 'Active' }));
  return demo.concat(PF_STAFF);
}
async function pf_loadReqs(el) { try { PF.acc.reqs = await sList('access'); } catch (e) { PF.acc.reqs = []; } pf_redraw(el, 'access', pf_accessDraw); }

function pf_accessDraw(el) {
  const A = PF.acc; const reqs = A.reqs || []; const pend = reqs.filter((r) => r.status === 'pending');
  const users = pf_users(); const groups = [...new Set(users.map((u) => u.group))];
  const signIn = AUD.log.find((e) => e.action === 'auth.sign_in');
  const tabs = [['users', 'Users'], ['roles', 'Roles & permissions'], ['requests', 'Requests' + (pend.length ? ' (' + pend.length + ')' : '')], ['security', 'Sign-in & security']];
  let h = pgHead('Users & access', 'Who can see and do what in the ' + esc(SETTINGS.org.name) + ' tenant. Roles map one-to-one to Entra ID security groups; every change and denial is written to the audit chain.',
    '<button class="btn pri" id="pf-req">Request access</button>');
  h += '<div class="kpis">' + kpi('Members', users.length, users.filter((u) => u.demo).length + ' on the demo switcher') + kpi('Entra groups', groups.length, 'MC-* security groups') + kpi('Pending requests', pend.length, pend.length ? 'Awaiting an admin' : 'Queue is clear', pend.length ? 'warn' : '') + kpi('Guests', users.filter((u) => u.guest).length, 'External, time-limited') + kpi('Your role', ROLE_LBL[ROLE], esc(me().group)) + '</div>';
  h += '<div class="tabs" role="tablist" id="pf-acc-tabs">' + tabs.map(([k, l]) => '<button role="tab" data-t="' + k + '" aria-selected="' + (A.tab === k) + '">' + l + '</button>').join('') + '</div>';
  if (A.tab === 'users') h += pf_safe(() => pf_accUsers(users), 'Users');
  if (A.tab === 'roles') h += pf_safe(() => pf_accRoles(), 'Roles');
  if (A.tab === 'requests') h += pf_safe(() => pf_accReqs(reqs), 'Requests');
  if (A.tab === 'security') h += pf_safe(() => pf_accSec(signIn), 'Security');
  el.innerHTML = h;
  el.querySelectorAll('#pf-acc-tabs button').forEach((b) => { b.onclick = () => { A.tab = b.dataset.t; pf_accessDraw(el); }; });
  el.querySelector('#pf-req').onclick = () => pf_reqModal(el);
  const rq = el.querySelector('#pf-req2'); if (rq) rq.onclick = () => pf_reqModal(el);
  const q = el.querySelector('#pf-uq'); if (q) { q.oninput = () => { A.q = q.value; const pos = q.selectionStart; pf_accessDraw(el); const n = el.querySelector('#pf-uq'); n.focus(); n.setSelectionRange(pos, pos); }; }
  bindSeg(el, 'pf-urole', (v) => { A.role = v; pf_accessDraw(el); });
  bindTbl(el, 'pf-utbl', A.sort, () => pf_accessDraw(el));
  el.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = () => pf_decide(el, b.dataset.id, b.dataset.dec); });
  el.querySelectorAll('[data-wd]').forEach((b) => { b.onclick = async () => { const r = reqs.find((x) => x.id === b.dataset.wd); if (!r) return; await sSet('access', r.id, Object.assign({}, r, { status: 'withdrawn', decidedAt: new Date().toISOString() })); audit('access.request.withdraw', ROLE_LBL[r.role], 'Withdrawn by requester'); toast('Request withdrawn.'); pf_loadReqs(el); }; });
}
function pf_accUsers(users) {
  const A = PF.acc; const q = A.q.trim().toLowerCase();
  const rows = users.filter((u) => (A.role === 'all' || u.role === A.role) && (!q || (u.name + ' ' + u.title + ' ' + u.group).toLowerCase().includes(q)));
  const cols = [
    { k: 'name', l: 'User', f: (u) => '<div class="pf-u"><span class="pf-av">' + esc(pf_ini(u.name)) + '</span><div><b>' + esc(u.name) + '</b>' + (u.role === ROLE && u.demo ? ' ' + chip('You', 'acc') : '') + '<div class="sub">' + esc(u.title) + '</div></div></div>' },
    { k: 'group', l: 'Entra group', f: (u) => '<span class="mono" style="font-size:12px">' + esc(u.group) + '</span>' },
    { k: 'role', l: 'App role', v: (u) => ROLE_ORDER.indexOf(u.role), f: (u) => esc(ROLE_LBL[u.role]) },
    { k: 'status', l: 'Status', f: (u) => chip(esc(u.status), u.status === 'Active' ? 'good' : u.status === 'Guest' ? 'info' : 'warn') + (u.expires ? '<div class="sub">Expires ' + dateLbl(u.expires) + '</div>' : '') },
    { k: 'mfa', l: 'MFA', sort: false, f: (u) => (u.status === 'Invited' ? '<span class="sub">On first sign-in</span>' : chip('Required', '')) },
    { k: 'last', l: 'Last sign-in', sort: false, f: (u) => '<span class="sub">' + esc(u.last) + '</span>' },
    { k: 'demo', l: 'Source', v: (u) => (u.demo ? 1 : 0), f: (u) => (u.demo ? chip('Demo switcher', 'acc') : u.guest ? chip('B2B guest', 'info') : chip('Directory', '')) },
  ];
  return card('Members', rows.length + ' of ' + users.length + ' shown · directory sync simulated in demo (production: Entra ID group membership via Microsoft Graph)',
    '<div class="filters"><label class="field" style="flex:1;min-width:180px">Search<input id="pf-uq" class="inp" placeholder="Name, title or group" value="' + esc(A.q) + '"></label>' +
    '<div class="field">Role' + seg('pf-urole', [['all', 'All']].concat(ROLE_ORDER.map((r) => [r, ROLE_LBL[r]])), A.role) + '</div></div>' +
    tbl(cols, rows, { id: 'pf-utbl', sort: A.sort, empty: 'No members match.' }) +
    '<p class="note" style="margin:10px 0 0">The five <b>Demo switcher</b> users are the identities in the top-bar sign-in switch. The others show how a real department looks; they cannot be signed in as.</p>');
}
function pf_accRoles() {
  const mx = '<div class="tw"><table class="tbl pf-mx"><thead><tr><th>Permission</th>' + ROLE_ORDER.map((r) => '<th class="' + (r === ROLE ? 'me' : '') + '">' + ROLE_LBL[r] + '<div class="sub" style="text-transform:none;letter-spacing:0;font-family:var(--f-mono)">' + esc(USERS[r].group) + '</div></th>').join('') + '</tr></thead><tbody>' +
    Object.keys(PERMS).map((p) => '<tr><td><b>' + esc(PERM_LBL[p]) + '</b><div class="sub mono">' + p + '</div></td>' + ROLE_ORDER.map((r) => '<td class="' + (r === ROLE ? 'me' : '') + '">' + (PERMS[p].includes(r) ? '<span class="yes" aria-label="allowed">✓</span>' : '<span class="no" aria-label="not allowed">—</span>') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  const mine = Object.keys(PERMS).filter((p) => can(p));
  return '<div class="grid">' +
    '<div class="s8 pf-col">' + card('Role and permission matrix', 'Highlighted column: your current role. Enforced in every page through gate(); denials are audited.', mx) + '</div>' +
    '<div class="s4 pf-col">' + card('What you can do', esc(me().name) + ' · ' + esc(me().title), '<div class="list">' + mine.map((p) => '<div class="li"><span class="chip good">✓</span><div><div class="t">' + esc(PERM_LBL[p]) + '</div></div></div>').join('') + '</div>' +
      (mine.length < Object.keys(PERMS).length ? '<button class="btn" id="pf-req2" style="margin-top:10px">Request more access</button>' : '')) +
      card('Separation of duties', '', '<div class="list"><div class="li"><div><div class="t">Authors cannot approve</div><div class="s">Analysts and scouts write reports; only the Approver or Admin can release them.</div></div></div><div class="li"><div><div class="t">No self-approval</div><div class="s">An access request can’t be approved by the person who raised it.</div></div></div><div class="li"><div><div class="t">Keys are admin-only</div><div class="s">API keys and webhooks give machine access, so only Admins create them.</div></div></div></div>', '', 'flat') + '</div>' +
    '</div>';
}
function pf_accReqs(reqs) {
  const pend = reqs.filter((r) => r.status === 'pending'); const mine = reqs.filter((r) => r.user === me().name);
  const st = (s) => chip(s[0].toUpperCase() + s.slice(1), s === 'approved' ? 'good' : s === 'denied' ? 'bad' : s === 'pending' ? 'warn' : '');
  const appr = can('admin')
    ? (pend.length ? '<div class="list">' + pend.map((r) => '<div class="li"><span class="pf-av">' + esc(pf_ini(r.user)) + '</span><div style="flex:1"><div class="t">' + esc(r.user) + ' → ' + esc(ROLE_LBL[r.role]) + ' <span class="sub">(now ' + esc(ROLE_LBL[r.fromRole] || r.fromRole) + ')</span></div><div class="s">' + esc(r.justification) + '</div><div class="s">' + esc(r.duration) + ' · requested ' + pf_ago(r.at) + '</div></div>' +
      (r.user === me().name ? '<span class="sub">Your own request</span>' : '<div class="acts"><button class="btn sm pri" data-dec="approved" data-id="' + esc(r.id) + '">Approve</button><button class="btn sm danger" data-dec="denied" data-id="' + esc(r.id) + '">Deny</button></div>') + '</div>').join('') + '</div>'
      : '<div class="empty">No pending requests. New requests from any role appear here.</div>')
    : '<div class="lock">🔒 Approving access needs the Admin role. ' + pend.length + ' request' + (pend.length === 1 ? '' : 's') + ' waiting.</div>';
  const hist = tbl([
    { k: 'user', l: 'Requester', f: (r) => esc(r.user) },
    { k: 'role', l: 'Role', f: (r) => esc(ROLE_LBL[r.role] || r.role) },
    { k: 'status', l: 'Status', f: (r) => st(r.status) },
    { k: 'decidedBy', l: 'Decided by', f: (r) => (r.decidedBy ? esc(r.decidedBy) : '<span class="sub">–</span>') },
    { k: 'at', l: 'Raised', f: (r) => '<span class="sub">' + pf_ago(r.at) + '</span>' },
  ], reqs.slice(0, 30), { empty: 'No access requests yet.' });
  return '<div class="grid"><div class="s7 pf-col">' + card('Approvals', 'Admin queue · in production an approval adds the user to the Entra group through Microsoft Graph; in the demo it is recorded and audited', appr) +
    card('Request history', 'All requests in the ' + (STORE.mode === 'db' ? 'shared team store' : 'store in this browser'), PF.acc.reqs ? hist : '<div class="empty">Loading…</div>') + '</div>' +
    '<div class="s5 pf-col">' + card('Your requests', esc(me().name), mine.length ? '<div class="list">' + mine.map((r) => '<div class="li"><div style="flex:1"><div class="t">' + esc(ROLE_LBL[r.role]) + ' ' + st(r.status) + '</div><div class="s">' + esc(r.justification) + '</div><div class="s">' + pf_ago(r.at) + (r.decidedBy ? ' · ' + esc(r.status) + ' by ' + esc(r.decidedBy) : '') + '</div></div>' + (r.status === 'pending' ? '<button class="btn sm ghost" data-wd="' + esc(r.id) + '">Withdraw</button>' : '') + '</div>').join('') + '</div>' : '<div class="empty">You have no requests.</div>', '<button class="btn sm" id="pf-req2">New request</button>') +
    card('How requests work', '', '<div class="list"><div class="li"><div><div class="t">1. Request</div><div class="s">Anyone picks a role, a duration and gives a business reason.</div></div></div><div class="li"><div><div class="t">2. Review</div><div class="s">An Admin approves or denies. Self-approval is blocked.</div></div></div><div class="li"><div><div class="t">3. Grant and expire</div><div class="s">Time-bound grants expire automatically (production: Entra ID access reviews).</div></div></div></div>', '', 'flat') + '</div></div>';
}
function pf_accSec(signIn) {
  const sso = '<dl class="kv"><dt>Sign-in</dt><dd>' + chip('Simulated in demo', 'warn') + ' The top-bar switch signs in as one of five demo identities.</dd><dt>Production</dt><dd>Microsoft Entra ID single sign-on (OpenID Connect), one app registration per tenant</dd><dt>MFA</dt><dd>Required for every member through a Conditional Access policy (planned)</dd><dt>Conditional access</dt><dd>Compliant or hybrid-joined device, block legacy auth, sign-in risk ≥ medium → block (planned)</dd><dt>Authorisation</dt><dd>App roles from Entra security groups MC-Viewers, MC-Analysts, MC-Scouts, MC-Approvers, MC-Admins</dd><dt>Service identity</dt><dd>Managed identities for Container Apps, Key Vault and Storage; no stored passwords (planned)</dd></dl>';
  const sess = '<dl class="kv"><dt>Session ID</dt><dd class="mono">' + esc(AUD.session) + '</dd><dt>Signed in as</dt><dd>' + esc(me().name) + ' · ' + esc(me().title) + '</dd><dt>Role / group</dt><dd>' + esc(ROLE_LBL[ROLE]) + ' · <span class="mono">' + esc(me().group) + '</span></dd><dt>Signed in</dt><dd>' + (signIn ? pf_time(signIn.at) + ' (' + pf_ago(signIn.at) + ')' : '–') + '</dd><dt>Session events</dt><dd>' + AUD.log.length + ' audit entries · ' + AI.runs.length + ' agent runs · ' + EXPORTS.length + ' exports</dd><dt>Audit chain</dt><dd id="pf-chain">checking…</dd><dt>Idle timeout</dt><dd>8 h sign-in frequency (planned Conditional Access session control)</dd></dl>';
  const guest = '<div class="list">' + [
    ['B2B guests only', 'External people sign in with their own organisation’s identity through Entra B2B. No local accounts.'],
    ['Viewer role, time-limited', 'Guests get the Viewer role only, with an end date of 90 days or less. Example: Dr. Nadia Rahman, until 31 Dec 2026.'],
    ['No exports, no Copilot', 'Guests can’t export data, create keys or ask agents, so club data can’t leave through them.'],
    ['Sponsor and review', 'Each guest has an internal sponsor. Guest access is reviewed monthly (planned Entra access review).'],
  ].map(([t, s]) => '<div class="li"><div><div class="t">' + t + '</div><div class="s">' + s + '</div></div></div>').join('') + '</div>';
  return '<div class="grid"><div class="s7 pf-col">' + card('Single sign-on and security', 'Sign-in: simulated in demo · Production: Microsoft Entra ID SSO, conditional access, MFA', sso) + card('Guest and external access policy', '', guest) + '</div><div class="s5 pf-col">' + card('Active session', 'This browser', sess) + card('Recent sign-in activity', 'From the audit chain, this session', pf_signins()) + '</div></div>';
}
function pf_signins() {
  const ev = AUD.log.filter((e) => /^auth\.|^access\./.test(e.action)).slice(-8).reverse();
  return ev.length ? '<div class="list">' + ev.map((e) => '<div class="li"><span class="chip ' + (e.outcome === 'denied' ? 'bad' : 'good') + '">' + esc(e.outcome) + '</span><div><div class="t mono" style="font-size:12.5px">' + esc(e.action) + '</div><div class="s">' + esc(e.actor) + ' · ' + esc(e.target) + ' · ' + pf_ago(e.at) + '</div></div></div>').join('') + '</div>' : '<div class="empty">No sign-in events yet.</div>';
}
function pf_reqModal(el) {
  const opts = ROLE_ORDER.filter((r) => r !== ROLE);
  const bg = modal('<h3>Request access</h3><p class="note">Signed in as ' + esc(me().name) + ' (' + esc(ROLE_LBL[ROLE]) + '). An Admin reviews the request.</p><form class="pf-form" id="pf-rf">' +
    '<label class="field">Role<select id="pf-rr">' + opts.map((r) => '<option value="' + r + '">' + ROLE_LBL[r] + ' · ' + esc(USERS[r].group) + '</option>').join('') + '</select></label>' +
    '<div class="note" id="pf-rgain"></div>' +
    '<label class="field">Duration<select id="pf-rd"><option>30 days</option><option>90 days</option><option>Until revoked</option></select></label>' +
    '<label class="field">Business justification<textarea id="pf-rj" placeholder="What you need it for, e.g. Preparing the opposition report for matchday 6"></textarea></label>' +
    '<div class="acts" style="justify-content:flex-end"><button type="button" class="btn ghost" id="pf-rx">Cancel</button><button class="btn pri">Submit request</button></div></form>');
  const sel = bg.querySelector('#pf-rr');
  const gain = () => { const r = sel.value; const g = Object.keys(PERMS).filter((p) => PERMS[p].includes(r) && !can(p)); bg.querySelector('#pf-rgain').innerHTML = g.length ? 'Adds: ' + g.map((p) => esc(PERM_LBL[p].toLowerCase())).join(', ') + '.' : 'This role adds no permissions you don’t already have.'; };
  sel.onchange = gain; gain();
  bg.querySelector('#pf-rx').onclick = closeModal;
  bg.querySelector('#pf-rf').onsubmit = async (e) => {
    e.preventDefault(); const j = bg.querySelector('#pf-rj').value.trim();
    if (j.length < 15) { toast('Give a justification of at least 15 characters.'); return; }
    const r = await sAdd('access', { user: me().name, fromRole: ROLE, role: sel.value, justification: j.slice(0, 400), duration: bg.querySelector('#pf-rd').value, status: 'pending' });
    audit('access.request', ROLE_LBL[r.role], r.duration + ' · ' + j.slice(0, 80));
    closeModal(); toast('Request sent. An Admin will review it.'); PF.acc.tab = 'requests'; pf_loadReqs(el);
  };
}
async function pf_decide(el, id, dec) {
  if (!gate('admin', 'Decide access request')) return;
  const r = (PF.acc.reqs || []).find((x) => x.id === id); if (!r) return;
  if (r.user === me().name) { toast('You can’t decide your own request.'); return; }
  await sSet('access', id, Object.assign({}, r, { status: dec, decidedBy: me().name, decidedAt: new Date().toISOString() }));
  audit('access.request.' + (dec === 'approved' ? 'approve' : 'deny'), r.user + ' → ' + ROLE_LBL[r.role], r.duration);
  toast(dec === 'approved' ? 'Approved. ' + r.user + ' gets the ' + ROLE_LBL[r.role] + ' role (group change simulated in demo).' : 'Request denied.');
  pf_loadReqs(el);
}
page({
  id: 'access', title: 'Users & access',
  render(el) {
    pf_accessDraw(el); pf_loadReqs(el);
    verifyChain().then((c) => { const n = el.querySelector('#pf-chain'); if (n) n.innerHTML = c.ok ? chip('✓ Verified', 'good') + ' ' + c.n + ' entries' : chip('Broken at #' + c.at, 'bad'); }).catch(() => {});
  },
});

// ===================================================================================================
// API & INTEGRATIONS
// ===================================================================================================
const PF_SCOPES = { 'matches:read': 'Read matches and events', 'players:read': 'Read player aggregates', 'table:read': 'Read the league table', 'reports:write': 'Create report drafts' };
const PF_HOOK_EVENTS = { 'match.ingested': 'A match is loaded into the season store', 'report.approved': 'An approver releases a report', 'agent.flagged': 'The Verifier flags an agent answer', 'export.created': 'A user exports data' };
const pf_err = (status, code, message) => ({ status, body: { error: { code, message } } });
const pf_matchRow = (m) => ({ id: m.id, date: m.date, matchday: m.matchday, home: m.home, away: m.away, score: m.score, xg: [m.ts[m.home].xg, m.ts[m.away].xg], href: '/v1/matches/' + m.id });
const PF_EPS = [
  { m: 'GET', path: '/v1/matches', scope: 'matches:read', desc: 'List matches in the season, newest first. Filter by club.', params: [{ n: 'club', in: 'query', ex: 'HAR', d: 'Club key, e.g. HAR' }, { n: 'limit', in: 'query', ex: '10', d: '1–100, default 20' }, { n: 'offset', in: 'query', ex: '0', d: 'Paging offset' }],
    run: (p) => { let ms = D.matches.slice().reverse(); if (p.club) { const c = p.club.toUpperCase(); if (!D.clubs.some((x) => x.key === c)) return pf_err(400, 'invalid_club', 'Unknown club key ' + p.club); ms = ms.filter((m) => m.home === c || m.away === c); } const lim = clamp(parseInt(p.limit || '20', 10) || 20, 1, 100), off = Math.max(0, parseInt(p.offset || '0', 10) || 0); return { status: 200, body: { data: ms.slice(off, off + lim).map(pf_matchRow), page: { limit: lim, offset: off, total: ms.length } } }; } },
  { m: 'GET', path: '/v1/matches/{id}', scope: 'matches:read', desc: 'One match: venue, result, team stats and Verifier pass rate.', params: [{ n: 'id', in: 'path', ex: () => (D.matches[D.matches.length - 1] || {}).id, d: 'Match id, e.g. M001' }],
    run: (p) => { const m = D.match(String(p.id || '').toUpperCase()); if (!m) return pf_err(404, 'not_found', 'No match with id ' + p.id); return { status: 200, body: { id: m.id, date: m.date, matchday: m.matchday, competition: D.league.competition, venue: { stadium: m.setup.stadium, city: m.setup.city, kickoff: m.setup.kickoff }, result: m.sum && m.sum.result, score: m.score, teams: { [m.home]: m.ts[m.home], [m.away]: m.ts[m.away] }, keyMoments: ((m.sum && m.sum.recap && m.sum.recap.keyMoments) || []).map((k) => ({ minute: k.minute, type: k.type, title: k.title })), verifier: { passRatePct: m.verifier && m.verifier.passRatePct }, eventCount: m.events.length, links: { events: '/v1/matches/' + m.id + '/events' } } }; } },
  { m: 'GET', path: '/v1/matches/{id}/events', scope: 'matches:read', desc: 'The match event stream with ball position (x 0–105, y 0–68).', params: [{ n: 'id', in: 'path', ex: () => (D.matches[D.matches.length - 1] || {}).id, d: 'Match id' }, { n: 'type', in: 'query', ex: 'shot', d: 'Event type, e.g. pass, shot, goal' }, { n: 'team', in: 'query', ex: '', d: 'Club key' }, { n: 'limit', in: 'query', ex: '50', d: '1–500, default 50' }],
    run: (p) => { const m = D.match(String(p.id || '').toUpperCase()); if (!m) return pf_err(404, 'not_found', 'No match with id ' + p.id); let ev = m.events.map((e, i) => Object.assign({ seq: i + 1 }, e)); if (p.type) ev = ev.filter((e) => e.type === p.type); if (p.team) ev = ev.filter((e) => e.team === p.team.toUpperCase()); const lim = clamp(parseInt(p.limit || '50', 10) || 50, 1, 500); return { status: 200, body: { match: m.id, data: ev.slice(0, lim), page: { limit: lim, total: ev.length } } }; } },
  { m: 'GET', path: '/v1/players/{name}', scope: 'players:read', desc: 'Season aggregate for one player, with per-match ratings.', params: [{ n: 'name', in: 'path', ex: () => ((D.players.slice().sort(by((p) => p.goals))[0]) || {}).name, d: 'Player name as listed' }],
    run: (p) => { const n = String(p.name || ''); const pl = D.player(n) || D.players.find((x) => x.name.toLowerCase() === n.toLowerCase()); if (!pl) return pf_err(404, 'not_found', 'No player named ' + n); const o = Object.assign({}, pl); delete o.ratingSum; return { status: 200, body: o }; } },
  { m: 'GET', path: '/v1/table', scope: 'table:read', desc: 'The league table computed from every loaded match, with xG.', params: [],
    run: () => ({ status: 200, body: { competition: D.league.competition, season: D.league.season, data: D.table.map((t) => ({ pos: t.pos, club: t.key, p: t.p, w: t.w, d: t.d, l: t.l, gf: t.gf, ga: t.ga, gd: t.gd, pts: t.pts, xg: t.xg, xga: t.xga, form: t.form.slice(-5) })) } }) },
  { m: 'POST', path: '/v1/reports', scope: 'reports:write', desc: 'Create a report draft. It enters the approval workflow; the Verifier checks it first.', params: [], body: () => JSON.stringify({ title: 'Post-match: ' + ((D.matches[D.matches.length - 1] || {}).title || ''), matchId: (D.matches[D.matches.length - 1] || {}).id, audience: 'coaching-staff' }, null, 2),
    run: (p, body, who) => { let b; try { b = JSON.parse(body || ''); } catch (e) { return pf_err(400, 'invalid_json', 'Body is not valid JSON: ' + e.message); } if (!b || !b.title) return pf_err(422, 'validation_failed', 'title is required'); if (b.matchId && !D.match(b.matchId)) return pf_err(422, 'validation_failed', 'matchId ' + b.matchId + ' does not exist'); return { status: 201, body: { id: 'rpt_' + pf_rand(5), status: 'draft', title: String(b.title).slice(0, 140), matchId: b.matchId || null, createdBy: who, verifier: SETTINGS.ai.requireVerifier ? 'pending' : 'not required by policy', approval: 'required (Approver role)', dryRun: true } }; } },
];
const pf_epVals = (i) => { const e = PF_EPS[i]; const v = PF.api.vals[i] || (PF.api.vals[i] = {}); for (const p of e.params) if (v[p.n] === undefined) v[p.n] = typeof p.ex === 'function' ? p.ex() || '' : p.ex; return v; };
function pf_buildPath(e, v) { let path = e.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(v[k] || '')); const q = e.params.filter((p) => p.in === 'query' && v[p.n] !== '' && v[p.n] != null).map((p) => p.n + '=' + encodeURIComponent(v[p.n])); return path + (q.length ? '?' + q.join('&') : ''); }
function pf_trim(o, d = 0) {
  if (Array.isArray(o)) { const lim = d <= 1 ? 6 : 4; const a = o.slice(0, lim).map((x) => pf_trim(x, d + 1)); if (o.length > lim) a.push('… ' + (o.length - lim) + ' more (truncated for display)'); return a; }
  if (o && typeof o === 'object') { const r = {}; for (const k in o) r[k] = pf_trim(o[k], d + 1); return r; }
  return o;
}
async function pf_send(el) {
  const A = PF.api, e = PF_EPS[A.ep], v = pf_epVals(A.ep); const t0 = performance.now(); let res, auth;
  const key = A.key.trim();
  if (key) {
    const hsh = await sha(key); const keys = A.keys || (A.keys = await sList('apikeys').catch(() => []));
    const k = keys.find((x) => x.hash === hsh && x.status === 'active');
    if (!k) res = pf_err(401, 'unauthorized', 'API key not recognised or revoked');
    else if (!(k.scopes || []).includes(e.scope)) res = pf_err(403, 'insufficient_scope', 'Key "' + k.name + '" lacks scope ' + e.scope);
    else { auth = 'API key "' + k.name + '" (…' + k.last4 + ')'; sSet('apikeys', k.id, Object.assign({}, k, { lastUsed: new Date().toISOString() })).catch(() => {}); k.lastUsed = new Date().toISOString(); }
  } else {
    auth = 'Session token · ' + me().name;
    if (e.m === 'POST' && !can('author')) res = pf_err(403, 'forbidden', 'Your role (' + ROLE_LBL[ROLE] + ') can’t create reports. Needs Analyst, Scout or Admin.');
  }
  if (!res) { try { res = e.run(v, A.body ?? (e.body ? e.body() : ''), auth); } catch (err) { res = pf_err(500, 'internal_error', err.message); } }
  const ms = performance.now() - t0; const full = JSON.stringify(res.body);
  A.resp = { status: res.status, ms, bytes: new Blob([full]).size, json: JSON.stringify(pf_trim(res.body), null, 2), path: pf_buildPath(e, v), m: e.m, auth: auth || 'rejected', reqId: 'req_' + pf_rand(6) };
  audit('api.request', e.m + ' ' + A.resp.path, res.status + ' · ' + (auth || 'unauthenticated') + ' · simulated locally', res.status >= 400 ? 'denied' : 'ok');
  pf_redraw(el, 'api', pf_apiDraw);
}
async function pf_loadKeys(el) { try { [PF.api.keys, PF.api.hooks] = await Promise.all([sList('apikeys'), sList('webhooks')]); } catch (e) { PF.api.keys = PF.api.keys || []; PF.api.hooks = PF.api.hooks || []; } pf_redraw(el, 'api', pf_apiDraw); }

function pf_apiDraw(el) {
  const A = PF.api, e = PF_EPS[A.ep], v = pf_epVals(A.ep);
  const keys = A.keys || [], hooks = A.hooks || [];
  let h = pgHead('API & integrations', 'A REST API over the same season store the console uses. "Try it" runs each request in this page against the loaded data. No network call leaves the browser.', '<span class="chip info">Base URL · /v1 · JSON</span>');
  h += '<div class="kpis">' + kpi('Endpoints', PF_EPS.length, PF_EPS.filter((x) => x.m === 'GET').length + ' read · ' + PF_EPS.filter((x) => x.m === 'POST').length + ' write') + kpi('Active API keys', keys.filter((k) => k.status === 'active').length, keys.filter((k) => k.status === 'revoked').length + ' revoked') + kpi('Webhooks', hooks.length, 'Delivery simulated in demo') + kpi('Records served', fmt(D.matches.length) + '<small>matches</small>', fmt(sum(D.matches, (m) => m.events.length)) + ' events') + '</div>';
  // reference + try it
  const list = '<div class="pf-eps" id="pf-eps">' + PF_EPS.map((x, i) => '<button class="pf-ep" data-i="' + i + '" aria-pressed="' + (i === A.ep) + '"><span class="pf-m ' + x.m + '">' + x.m + '</span><span>' + esc(x.path) + '</span></button>').join('') + '</div>' +
    '<div class="pf-sec">Conventions</div><dl class="kv" style="font-size:12px"><dt>Auth</dt><dd>Bearer token: Entra ID (users) or API key (machines)</dd><dt>Errors</dt><dd class="mono">{error:{code,message}}</dd><dt>Paging</dt><dd class="mono">limit, offset</dd><dt>Rate limit</dt><dd>600 req/min per key (planned, APIM)</dd></dl>';
  const params = e.params.length ? '<div class="pf-form"><div class="row">' + e.params.map((p) => '<label class="field">' + esc(p.n) + ' <span class="sub">' + p.in + ' · ' + esc(p.d) + '</span><input class="inp" data-p="' + esc(p.n) + '" value="' + esc(v[p.n]) + '"></label>').join('') + '</div></div>' : '';
  const body = e.m === 'POST' ? '<label class="field" style="margin-top:10px">Request body (JSON)<textarea id="pf-body" class="mono" style="min-height:110px;font-size:12px">' + esc(A.body ?? e.body()) + '</textarea></label>' : '';
  const r = A.resp;
  const resp = r ? '<div class="pf-resp"><div class="pf-resp-h"><span class="chip ' + (r.status < 300 ? 'good' : r.status < 500 ? 'warn' : 'bad') + '">' + r.status + ' ' + ({ 200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 422: 'Unprocessable', 500: 'Server Error' }[r.status] || '') + '</span><span class="chip">' + (r.ms < 1 ? r.ms.toFixed(2) : fmt(r.ms, 1)) + ' ms</span><span class="chip">' + fmt(r.bytes / 1024, 1) + ' KB</span><span class="note mono">' + r.m + ' ' + esc(r.path) + '</span></div>' +
    '<div class="note" style="margin-bottom:6px">Auth: ' + esc(r.auth) + ' · ' + r.reqId + ' · executed locally against the loaded season (no network). Long arrays are truncated for display.</div><pre class="code">' + esc(r.json) + '</pre></div>' : '<div class="empty">Press Send to run the request against the loaded season.</div>';
  const curl = 'curl -X ' + e.m + ' "https://api.matchcast.example' + esc(pf_buildPath(e, v)) + '" \\\n  -H "Authorization: Bearer $MATCHCAST_KEY"' + (e.m === 'POST' ? ' \\\n  -H "Content-Type: application/json" \\\n  -d @report.json' : '');
  const tryit = '<div class="pf-url"><span class="pf-m ' + e.m + '">' + e.m + '</span><span>' + esc(pf_buildPath(e, v)) + '</span></div><p class="note" style="margin:8px 0 10px">' + esc(e.desc) + ' Scope: <span class="mono">' + e.scope + '</span></p>' + params + body +
    '<div class="filters" style="margin:12px 0 0"><label class="field" style="flex:1;min-width:200px">API key (optional; blank uses your session)<input id="pf-key" class="inp mono" placeholder="mck_live_…" value="' + esc(A.key) + '" autocomplete="off"></label><button class="btn pri" id="pf-send">Send request</button></div>' + resp +
    '<div class="pf-sec">Example (illustrative host)</div><pre class="code">' + curl + '</pre>';
  h += '<div class="grid"><div class="s4 pf-col">' + card('Reference', 'Generated from the live data model', list) + '</div><div class="s8 pf-col">' + card('Try it', 'Runs in this browser · status, latency and payload are real', tryit) + '</div></div>';
  // keys + hooks
  const kt = tbl([
    { k: 'name', l: 'Name', f: (k) => '<b style="white-space:nowrap">' + esc(k.name) + '</b><div class="sub">by ' + esc(k.createdBy) + '</div>' },
    { k: 'last4', l: 'Key', f: (k) => '<span class="mono" style="white-space:nowrap">mck_live_…' + esc(k.last4) + '</span>' },
    { k: 'scopes', l: 'Scopes', f: (k) => (k.scopes || []).map((s) => '<span class="chip" style="margin:1px">' + esc(s) + '</span>').join('') },
    { k: 'at', l: 'Created', f: (k) => '<span class="sub">' + pf_ago(k.at) + '</span>' },
    { k: 'lastUsed', l: 'Last used', f: (k) => '<span class="sub">' + (k.lastUsed ? pf_ago(k.lastUsed) : 'Never') + '</span>' },
    { k: 'status', l: 'Status', f: (k) => chip(k.status === 'active' ? 'Active' : 'Revoked', k.status === 'active' ? 'good' : 'bad') },
    { k: 'x', l: '', sort: false, f: (k) => (k.status === 'active' ? '<button class="btn sm danger" data-rv="' + esc(k.id) + '">Revoke' + lockBtn('keys') + '</button>' : '') },
  ], keys, { empty: 'No API keys yet.' });
  const ht = tbl([
    { k: 'url', l: 'Endpoint', f: (w) => '<span class="mono pf-trunc" title="' + esc(w.url) + '">' + esc(w.url.replace(/^https:\/\//, '')) + '</span><div class="sub">https · by ' + esc(w.createdBy || '') + '</div>' },
    { k: 'events', l: 'Events', f: (w) => (w.events || []).map((s) => '<span class="chip" style="margin:1px">' + esc(s) + '</span>').join('') },
    { k: 'lastTest', l: 'Last test', f: (w) => '<span class="sub">' + (w.lastTest ? pf_ago(w.lastTest) + ' · 200 (simulated)' : 'Never') + '</span>' },
    { k: 'x', l: '', sort: false, f: (w) => '<div class="acts" style="flex-wrap:nowrap"><button class="btn sm" data-wt="' + esc(w.id) + '">Send test' + lockBtn('keys') + '</button><button class="btn sm ghost" data-wx="' + esc(w.id) + '" aria-label="Delete webhook">Delete</button></div>' },
  ], hooks, { empty: 'No webhooks yet.' });
  h += '<div class="grid" style="margin-top:14px"><div class="s6 pf-col">' + card('API keys', 'Secrets are shown once. Only a SHA-256 hash and the last 4 characters are stored. Admin only.', A.keys ? kt : '<div class="empty">Loading…</div>', '<button class="btn sm pri" id="pf-nk">New key' + lockBtn('keys') + '</button>') + '</div>' +
    '<div class="s6 pf-col">' + card('Webhooks', 'Signed event callbacks. Delivery simulated in demo: no network request is made.', A.hooks ? ht : '<div class="empty">Loading…</div>', '<button class="btn sm pri" id="pf-nw">Add webhook' + lockBtn('keys') + '</button>') + '</div></div>';
  // integrations
  const ints = [
    ['Microsoft Teams', 'Planned', 'Post approved reports and Verifier flags to a coaching-staff channel through an incoming webhook.'],
    ['SharePoint', 'Planned', 'Archive released reports with their sha256 and approval record in a document library.'],
    ['Power BI', 'Planned', 'DirectQuery-style dataset over /v1/table and /v1/matches; exports from Explorer already load as CSV.'],
    ['Azure Event Hubs', 'Planned', 'Ingest the live simulator event stream (Basic tier, build window only, per the cost plan).'],
    ['Microsoft Fabric', 'Planned', 'Eventstream into a Real-Time dashboard during the build; judges see a snapshot.'],
    ['Azure Databricks', 'Planned', 'Train the tactical model with MLflow on labelled scenes; job clusters stop after the build.'],
    ['Azure MCP server', 'Demo', 'Agents already call MatchCast tools in this console. The MCP server exposes the same tools (' + PF_EPS.filter((x) => x.m === 'GET').length + ' read endpoints) to Foundry agents and GitHub Copilot.'],
  ];
  h += '<div style="margin-top:14px">' + card('Integrations', 'Honest status: Demo = working in this console · Planned = designed, not yet connected', '<div class="pf-int">' + ints.map(([n, s, d]) => '<div class="card"><h4>' + n + chip(s, s === 'Demo' ? 'good' : 'info') + '</h4><p>' + d + '</p></div>').join('') + '</div>') + '</div>';
  el.innerHTML = h;
  // bind
  el.querySelectorAll('#pf-eps .pf-ep').forEach((b) => { b.onclick = () => { A.ep = +b.dataset.i; A.resp = null; A.body = null; pf_apiDraw(el); }; });
  el.querySelectorAll('input[data-p]').forEach((i) => { i.onchange = () => { v[i.dataset.p] = i.value.trim(); pf_apiDraw(el); }; });
  const bd = el.querySelector('#pf-body'); if (bd) bd.oninput = () => { A.body = bd.value; };
  const kk = el.querySelector('#pf-key'); kk.oninput = () => { A.key = kk.value; };
  el.querySelector('#pf-send').onclick = () => { el.querySelectorAll('input[data-p]').forEach((i) => { v[i.dataset.p] = i.value.trim(); }); pf_send(el); };
  el.querySelector('#pf-nk').onclick = () => { if (gate('keys', 'Create API key')) pf_keyModal(el); };
  el.querySelector('#pf-nw').onclick = () => { if (gate('keys', 'Add webhook')) pf_hookModal(el); };
  el.querySelectorAll('[data-rv]').forEach((b) => { b.onclick = async () => { if (!gate('keys', 'Revoke API key')) return; const k = keys.find((x) => x.id === b.dataset.rv); if (!k) return; await sSet('apikeys', k.id, Object.assign({}, k, { status: 'revoked', revokedBy: me().name, revokedAt: new Date().toISOString() })); audit('api.key.revoke', k.name, '…' + k.last4); toast('Key "' + k.name + '" revoked. Requests with it now return 401.'); pf_loadKeys(el); }; });
  el.querySelectorAll('[data-wx]').forEach((b) => { b.onclick = async () => { if (!gate('keys', 'Delete webhook')) return; const w = hooks.find((x) => x.id === b.dataset.wx); if (!w) return; await sDel('webhooks', w.id); audit('api.webhook.delete', w.url, ''); toast('Webhook deleted.'); pf_loadKeys(el); }; });
  el.querySelectorAll('[data-wt]').forEach((b) => { b.onclick = () => { if (gate('keys', 'Send test webhook')) pf_hookTest(el, hooks.find((x) => x.id === b.dataset.wt)); }; });
}
function pf_keyModal(el) {
  const bg = modal('<h3>New API key</h3><p class="note">Machine access to the /v1 API. Pick the fewest scopes the integration needs.</p><form class="pf-form" id="pf-kf"><label class="field">Name<input id="pf-kn" class="inp" placeholder="e.g. Power BI refresh" maxlength="60"></label>' +
    '<div class="field">Scopes<div class="pf-checks">' + Object.entries(PF_SCOPES).map(([s, d]) => '<label title="' + esc(d) + '"><input type="checkbox" value="' + s + '"' + (/read/.test(s) ? ' checked' : '') + '> <span class="mono">' + s + '</span></label>').join('') + '</div></div>' +
    '<div class="acts" style="justify-content:flex-end"><button type="button" class="btn ghost" id="pf-kx">Cancel</button><button class="btn pri">Create key</button></div></form>');
  bg.querySelector('#pf-kx').onclick = closeModal;
  bg.querySelector('#pf-kf').onsubmit = async (ev) => {
    ev.preventDefault(); const name = bg.querySelector('#pf-kn').value.trim(); const scopes = [...bg.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value);
    if (!name) { toast('Give the key a name.'); return; } if (!scopes.length) { toast('Pick at least one scope.'); return; }
    const secret = 'mck_live_' + pf_rand(20); const hash = await sha(secret);
    await sAdd('apikeys', { name, scopes, hash, last4: secret.slice(-4), createdBy: me().name, status: 'active' });
    audit('api.key.create', name, scopes.join(' ') + ' · …' + secret.slice(-4));
    const b2 = modal('<h3>Copy your key now</h3><p class="note">This is the only time the secret is shown. MatchCast stores its SHA-256 hash, not the key.</p><div class="pf-secret"><span style="flex:1;min-width:0">' + esc(secret) + '</span><button class="btn sm" id="pf-kc">Copy</button></div><dl class="kv" style="margin-top:12px"><dt>Name</dt><dd>' + esc(name) + '</dd><dt>Scopes</dt><dd class="mono">' + esc(scopes.join(', ')) + '</dd><dt>Stored hash</dt><dd class="mono" style="font-size:11.5px">' + hash.slice(0, 32) + '…</dd></dl><div class="acts" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="pf-kuse">Use in Try it</button><button class="btn pri" id="pf-kd">Done</button></div>');
    b2.querySelector('#pf-kc').onclick = () => pf_copy(secret);
    b2.querySelector('#pf-kd').onclick = closeModal;
    b2.querySelector('#pf-kuse').onclick = () => { PF.api.key = secret; closeModal(); pf_loadKeys(el); };
    pf_loadKeys(el);
  };
}
function pf_hookModal(el) {
  const bg = modal('<h3>Add webhook</h3><p class="note">MatchCast POSTs a signed JSON payload to your HTTPS endpoint. Delivery is simulated in this demo.</p><form class="pf-form" id="pf-wf"><label class="field">Endpoint URL<input id="pf-wu" class="inp mono" placeholder="https://hooks.example.com/matchcast"></label>' +
    '<div class="field">Events<div class="pf-checks" style="flex-direction:column">' + Object.entries(PF_HOOK_EVENTS).map(([s, d], i) => '<label><input type="checkbox" value="' + s + '"' + (i < 2 ? ' checked' : '') + '> <span class="mono">' + s + '</span> <span class="sub">' + esc(d) + '</span></label>').join('') + '</div></div>' +
    '<div class="acts" style="justify-content:flex-end"><button type="button" class="btn ghost" id="pf-wx">Cancel</button><button class="btn pri">Add webhook</button></div></form>');
  bg.querySelector('#pf-wx').onclick = closeModal;
  bg.querySelector('#pf-wf').onsubmit = async (ev) => {
    ev.preventDefault(); const url = bg.querySelector('#pf-wu').value.trim(); const events = [...bg.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value);
    if (!/^https:\/\/[^\s/]+\.[^\s]+/.test(url)) { toast('Use a full https:// URL.'); return; } if (!events.length) { toast('Pick at least one event.'); return; }
    const secret = 'whsec_' + pf_rand(16);
    await sAdd('webhooks', { url, events, secret, createdBy: me().name, status: 'active' });
    audit('api.webhook.create', url, events.join(' '));
    modal('<h3>Webhook added</h3><p class="note">Verify each delivery with this signing secret: compute sha256(secret + "." + timestamp + "." + body) and compare it with the v1 value in the <span class="mono">MatchCast-Signature</span> header. In production the secret lives in Azure Key Vault; in this demo it is kept in the store so the test can sign.</p><div class="pf-secret">' + esc(secret) + '</div><div class="acts" style="justify-content:flex-end;margin-top:12px"><button class="btn pri" onclick="closeModal()">Done</button></div>');
    pf_loadKeys(el);
  };
}
async function pf_hookTest(el, w) {
  if (!w) return; const type = (w.events || [])[0] || 'match.ingested'; const m = D.matches[D.matches.length - 1];
  const data = { 'match.ingested': { matchId: m.id, title: m.title, events: m.events.length, date: m.date }, 'report.approved': { reportId: 'rpt_test', matchId: m.id, approvedBy: me().name }, 'agent.flagged': { agent: 'Verifier', check: 'grounding', note: 'Number not found in source data (test event)' }, 'export.created': { name: 'season-table.csv', user: me().name, sha256: (EXPORTS[0] || {}).sha || 'n/a' } }[type];
  const ts = Math.floor(Date.now() / 1000); const body = JSON.stringify({ id: 'evt_' + pf_rand(8), type, created: new Date().toISOString(), tenant: SETTINGS.org.name, test: true, data });
  const sig = await sha((w.secret || '') + '.' + ts + '.' + body);
  await sSet('webhooks', w.id, Object.assign({}, w, { lastTest: new Date().toISOString() }));
  audit('api.webhook.test', w.url, type + ' · delivery simulated');
  modal('<h3>Test delivery</h3><p class="note">' + chip('Delivery simulated in demo', 'warn') + ' No network request was made. This is exactly what would be POSTed.</p><div class="pf-sec">Request</div><pre class="code">POST ' + esc(w.url) + '\nContent-Type: application/json\nMatchCast-Event: ' + type + '\nMatchCast-Signature: t=' + ts + ',v1=' + sig + '</pre><div class="pf-sec">Body</div><pre class="code">' + esc(JSON.stringify(JSON.parse(body), null, 2)) + '</pre><div class="acts" style="justify-content:flex-end;margin-top:12px"><button class="btn pri" onclick="closeModal()">Close</button></div>');
  pf_loadKeys(el);
}
page({ id: 'api', title: 'API & integrations', render(el) { pf_apiDraw(el); pf_loadKeys(el); } });

// ===================================================================================================
// USAGE & COST
// ===================================================================================================
// Source: matchcast-v2/cost/azure-cost-and-architecture.md (v3, 18 Oct 2026), worst-case figures in USD
const PF_COST = {
  src: 'matchcast-v2/cost/azure-cost-and-architecture.md · v3 · 18 Oct 2026', cap: 100, total: 92, typical: [55, 75],
  rows: [
    ['Azure AI Foundry (GPT-4.1 mini, four agents)', 10, 5, 'Cache narrations; rate-limit live calls'],
    ['Azure AI Speech (neural TTS)', 10, 5, 'Pre-render fixed lines to Blob'],
    ['Azure Databricks Premium (jobs)', 20, 0, 'Single node, 10-min auto-terminate, stopped after build'],
    ['Microsoft Fabric F2', 11, 0, 'About 30 active hours, then paused'],
    ['Azure Event Hubs Basic', 3, 0, 'Stopped after build'],
    ['Azure Container Apps', 3, 14, 'api at min 1 replica (0.25 vCPU, 0.5 GiB) in judging'],
    ['Azure Container Registry Basic', 2, 4, 'Images for all three apps'],
    ['Storage, Key Vault, Application Insights', 3, 2, ''],
    ['Azure Static Web Apps (Free)', 0, 0, 'Free plan'],
  ],
  assume: ['No free trials or credits counted (Fabric 60-day trial excluded).', 'Build window 18–27 Oct (10 days); judging window 27 Oct–20 Nov (24 days).', 'USD list prices; Container Apps above the free grant and Container Registry rates are unverified estimates.', 'Azure budget alerts at 50%, 80% and 100%. Budgets alert but do not stop spend; 80% is the action point.'],
  units: [['Foundry GPT-4.1 mini', '$0.40 in / $1.60 out per 1M tokens'], ['Speech neural TTS', '~$15–16 per 1M characters'], ['Databricks Premium Jobs', '$0.30 per DBU-hour'], ['Fabric F2', '$0.36 per hour'], ['Event Hubs Basic', '~$11 per month per TU'], ['Container Registry Basic', '~$5 per month']],
};
function pf_usageDraw(el, stored) {
  const runs = AI.runs; const aud = stored && stored.length ? stored : AUD.log;
  const viewRows = Object.entries(PF.views).sort((a, b) => b[1] - a[1]);
  const cats = ['auth', 'data', 'agent', 'access', 'api', 'other']; const catCol = { auth: 'var(--info)', data: 'var(--accent)', agent: 'var(--warn)', access: 'var(--bad)', api: 'var(--ink-2)', other: 'var(--line-2)' };
  const catOf = (a) => { const c = String(a || '').split('.')[0]; return cats.includes(c) ? c : 'other'; };
  let h = pgHead('Usage & cost', 'What this tenant used in this session and the store, and what the planned Azure deployment costs against the $' + PF_COST.cap + ' hard budget.', '<span class="chip">Session ' + esc(AUD.session) + ' · started ' + pf_ago(new Date(PF.t0).toISOString()) + '</span>');
  h += '<div class="kpis">' + kpi('Page views', sum(viewRows, (x) => x[1]), viewRows.length + ' distinct pages this session') + kpi('Agent runs', runs.length, runs.filter((r) => r.src === 'ai').length + ' Claude · ' + runs.filter((r) => r.src !== 'ai').length + ' rules') +
    kpi('Exports', EXPORTS.length, EXPORTS.length ? fmt(sum(EXPORTS, (x) => x.kb), 1) + ' KB, all hashed' : 'None this session') + kpi('Audit events', aud.length, (stored && stored.length ? 'Stored (all sessions)' : 'This session')) + kpi('Forecast spend', '$' + PF_COST.total + '<small>/ $' + PF_COST.cap + '</small>', 'Worst case, whole project', PF_COST.total > PF_COST.cap * 0.9 ? 'warn' : '') + '</div>';
  h += '<div class="grid">';
  h += '<div class="s6 pf-col">' + pf_safe(() => card('Page views', 'Counted by the router this session', viewRows.length ? hbars(viewRows.map(([id, n]) => ({ label: (PAGES[id] || {}).title || id, v: n })), { fmt: (x) => fmt(x) }) : '<div class="empty">No page views yet.</div>'), 'Page views') + '</div>';
  h += '<div class="s6 pf-col">' + pf_safe(() => {
    const groups = ROLE_ORDER.map((r) => ({ label: ROLE_LBL[r], vals: cats.map((c) => ({ v: aud.filter((e) => e.role === r && catOf(e.action) === c).length, color: catCol[c], title: ROLE_LBL[r] + ' · ' + c })) }));
    const any = groups.some((g) => g.vals.some((x) => x.v));
    return card('Audit actions by role', (stored && stored.length ? aud.length + ' stored entries' : 'This session') + ' · grouped by action family', any ? barChart({ groups, stacked: true, h: 210 }) + legend(cats.map((c) => [c, catCol[c]])) : '<div class="empty">No audit events yet.</div>');
  }, 'Audit by role') + '</div>';
  h += '<div class="s6 pf-col">' + pf_safe(() => card('Agent runs', 'AI.runs this session · Claude when granted, otherwise deterministic rules', tbl([
    { k: 'agent', l: 'Agent', f: (r) => esc((AGENTS[r.agent] || {}).name || r.agent) },
    { k: 'q', l: 'Question', cls: 'wrap', f: (r) => '<span class="sub">' + esc(String(r.q || '').slice(0, 70)) + '</span>' },
    { k: 'src', l: 'Engine', f: (r) => chip(r.src === 'ai' ? 'Claude' : 'Rules', r.src === 'ai' ? 'acc' : '') },
    { k: 'ms', l: 'ms', r: 1, f: (r) => fmt(r.ms) },
    { k: 'g', l: 'Grounding', f: (r) => (r.ground && r.ground.rule ? '<span class="sub">n/a (rules)</span>' : groundChip(r.ground)) },
  ], runs.slice(0, 8), { empty: 'No agent runs yet. Ask Copilot or use the AI agents page.' })), 'Agent runs') + '</div>';
  h += '<div class="s6 pf-col">' + pf_safe(() => card('Exports', 'Every export is role-gated, hashed and audited', tbl([
    { k: 'name', l: 'File', f: (x) => '<b>' + esc(x.name) + '</b><div class="sub">' + esc(x.label) + '</div>' },
    { k: 'user', l: 'By', f: (x) => esc(x.user) },
    { k: 'kb', l: 'KB', r: 1, f: (x) => fmt(x.kb, 1) },
    { k: 'sha', l: 'sha256', f: (x) => '<span class="mono sub">' + esc(x.sha.slice(0, 12)) + '…</span>' },
  ], EXPORTS.slice(0, 8), { empty: 'No exports this session.' })), 'Exports') + '</div>';
  h += '</div>';
  // cost model
  h += '<h2 style="font:700 22px var(--f-disp);letter-spacing:.02em;margin:26px 0 4px">Azure cost model</h2><p class="note" style="margin:0 0 12px">Forecast from the project’s cost plan, not billed actuals. Source: <span class="mono">' + esc(PF_COST.src) + '</span>. Production telemetry would come from an Azure Cost Management export.</p>';
  h += '<div class="grid">';
  h += '<div class="s8 pf-col">' + pf_safe(() => {
    const rows = PF_COST.rows.map(([s, b, j, n]) => ({ s, b, j, t: b + j, n }));
    return card('Cost by service', 'Worst case, USD · build 18–27 Oct and judging 27 Oct–20 Nov', tbl([
      { k: 's', l: 'Service', cls: 'wrap', f: (r) => '<b>' + esc(r.s) + '</b>' + (r.n ? '<div class="sub">' + esc(r.n) + '</div>' : '') },
      { k: 'b', l: 'Build', r: 1, f: (r) => '$' + r.b }, { k: 'j', l: 'Judging', r: 1, f: (r) => '$' + r.j }, { k: 't', l: 'Total', r: 1, f: (r) => '<b>$' + r.t + '</b>' },
      { k: 'sh', l: 'Share', sort: false, f: (r) => '<div class="bar" style="width:90px"><i style="width:' + pct(r.t, PF_COST.total) + '%"></i></div>' },
    ], rows.concat([{ s: 'Total', b: sum(rows, (r) => r.b), j: sum(rows, (r) => r.j), t: sum(rows, (r) => r.t), n: 'Typical run about $' + PF_COST.typical[0] + '–' + PF_COST.typical[1] }])));
  }, 'Cost by service') + '</div>';
  h += '<div class="s4 pf-col">' + pf_safe(() => {
    const t = PF_COST.total, cap = PF_COST.cap, p = (t / cap) * 100; const tone = p >= 100 ? 'var(--bad)' : p >= 80 ? 'var(--warn)' : 'var(--good)';
    const build = sum(PF_COST.rows, (r) => r[1]);
    const g = '<div class="pf-gauge" role="img" aria-label="Forecast ' + t + ' of ' + cap + ' dollars"><i style="width:' + Math.min(100, (build / cap) * 100) + '%;background:var(--info);opacity:.85"></i><i style="left:' + (build / cap) * 100 + '%;width:' + Math.min(100 - (build / cap) * 100, ((t - build) / cap) * 100) + '%;background:' + tone + ';border-radius:0 8px 8px 0"></i>' +
      [50, 80, 100].map((m) => '<span class="mk" style="left:calc(' + m + '% - 1px)"><span' + (m === 100 ? ' style="left:auto;right:0;transform:none"' : '') + '>' + m + '%</span></span>').join('') + '<span class="val" style="left:' + Math.min(94, p) + '%">$' + t + '</span></div>';
    return card('Budget', 'Hard cap $' + cap + ' for the whole project', '<div class="kpi" style="border:0;padding:0"><div class="v">' + Math.round(p) + '%<small>of cap</small></div><div class="d">$' + (cap - t) + ' margin · alerts at 50%, 80%, 100%</div></div>' + g + legend([['Build $' + build, 'var(--info)'], ['Judging $' + (t - build), tone]]) +
      '<p class="note" style="margin:10px 0 0">Over 80% of the cap, so the 80% alert is the action point: pause Fabric F2 and stop Databricks and Event Hubs on 27 Oct.</p>');
  }, 'Budget') + '</div>';
  h += '<div class="s6 pf-col">' + card('Assumptions', '', '<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6">' + PF_COST.assume.map((a) => '<li>' + esc(a) + '</li>').join('') + '</ul>') + '</div>';
  h += '<div class="s6 pf-col">' + card('Unit prices used', 'List prices from the plan; some third-party or estimated', '<dl class="kv">' + PF_COST.units.map(([a, b]) => '<dt>' + esc(a) + '</dt><dd class="mono" style="font-size:12px">' + esc(b) + '</dd>').join('') + '</dl>') + '</div>';
  h += '</div>';
  el.innerHTML = h;
}
page({ id: 'usage', title: 'Usage & cost', render(el) { pf_usageDraw(el, null); sList('audit').then((a) => pf_redraw(el, 'usage', (e) => pf_usageDraw(e, a))).catch(() => {}); } });

// ===================================================================================================
// SERVICE STATUS
// ===================================================================================================
const pf_med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
async function pf_runChecks() {
  const S = PF.st; if (S.running) return; S.running = true; const out = []; const lat = {};
  const add = (name, f) => out.push({ name, f });
  // Season data store
  add('Season data store', async () => {
    const res = performance.getEntriesByType('resource').filter((e) => /\/data\/[^/]+\.json/.test(e.name));
    const ms = res.length ? Math.max(...res.map((e) => e.responseEnd)) - Math.min(...res.map((e) => e.startTime)) : null; lat.load = ms;
    const kb = sum(res, (e) => e.encodedBodySize || e.transferSize || 0) / 1024;
    const exp = (D.league && D.league.fixtures.length) || 0;
    const ok = D.loaded && D.matches.length > 0 && D.table.length === D.clubs.length;
    return { st: ok ? (D.matches.length >= exp ? 'good' : 'warn') : 'bad', msg: D.matches.length + '/' + exp + ' matches · ' + D.players.length + ' players · ' + D.clubs.length + ' clubs' + (res.length ? ' · ' + res.length + ' files, ' + fmt(kb) + ' KB' : ''), ms };
  });
  add('Event ingest', async () => {
    const t0 = performance.now(); const n = sum(D.matches, (m) => m.events.length); const ended = D.matches.filter((m) => m.events.some((e) => e.type === 'full_time')).length;
    const pos = D.matches.flatMap((m) => m.events.filter((e) => e.type === 'pass' || e.type === 'shot')); const withPos = pos.filter((e) => e.bx != null).length;
    const ms = performance.now() - t0; const cov = pct(withPos, pos.length);
    return { st: ended === D.matches.length && cov >= 95 ? 'good' : 'warn', msg: fmt(n) + ' events · ' + ended + '/' + D.matches.length + ' matches reached full time · ' + cov + '% passes and shots carry ball position', ms };
  });
  add('Analytics engine', async () => {
    const times = []; let top = null;
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now(); const xg = {}; for (const m of D.matches) for (const e of m.events) if (e.type === 'shot') xg[e.team] = (xg[e.team] || 0) + (e.xg || 0);
      top = D.players.slice().sort(by((p) => p.rating))[0]; derive(Object.assign({}, D.matches[k % D.matches.length])); times.push(performance.now() - t0);
    }
    const ms = pf_med(times); lat.query = ms;
    return { st: ms < 200 ? 'good' : 'warn', msg: 'Sample query (season xG by club + top rated + re-derive a match), median of 5: ' + fmt(ms, 1) + ' ms' + (top ? ' · top rated ' + top.name : ''), ms };
  });
  add('AI agents', async () => {
    const g = ground('Expected goals 1.42 from 7 shots.', { xg: 1.42, shots: 7 }); const bad = ground('Expected goals 9.99.', { xg: 1.42 });
    const ok = g.pass && !bad.pass;
    return { st: !ok ? 'bad' : AI.on ? 'good' : 'warn', msg: (AI.on ? 'Claude connected (Foundry-ready agents)' : 'Rules mode: Claude not granted in this view; every agent falls back to deterministic rules') + ' · grounding self-test ' + (ok ? 'passed' : 'failed'), ms: null, note: AI.on ? '' : 'Degraded by design, not an outage' };
  });
  add('Shared store', async () => {
    const t0 = performance.now(); let ok = false;
    try { const r = await sAdd('health', { probe: true, by: me().name }); const l = await sList('health'); ok = l.some((x) => x.id === r.id); await sDel('health', r.id); } catch (e) { ok = false; }
    const ms = performance.now() - t0; lat.store = ms;
    return { st: ok ? 'good' : 'bad', msg: (STORE.mode === 'db' ? 'Shared team store' : 'This browser (local fallback; shared store not granted)') + ' · write/read/delete round trip ' + (ok ? 'ok' : 'failed'), ms };
  });
  add('Exports', async () => {
    const t0 = performance.now(); const h = await sha('abc'); const ms = performance.now() - t0; lat.sha = ms;
    const ok = h === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    return { st: ok ? 'good' : 'bad', msg: 'SHA-256 self-test ' + (ok ? 'passed (Web Crypto)' : 'failed: fallback hash in use') + ' · ' + EXPORTS.length + ' exports this session · ' + (DL ? 'download capability granted' : window.claude ? 'downloads not granted' : 'browser downloads'), ms };
  });
  add('Audit chain', async () => {
    const t0 = performance.now(); const c = await verifyChain(); const ms = performance.now() - t0; lat.chain = ms; lat.chainN = c.n;
    return { st: c.ok ? 'good' : 'bad', msg: c.ok ? 'Verified ' + c.n + ' entries · head ' + c.head.slice(0, 12) + '…' : 'Chain broken at entry #' + c.at, ms };
  });
  const res = [];
  for (const c of out) { try { res.push(Object.assign({ name: c.name }, await c.f())); } catch (e) { res.push({ name: c.name, st: 'bad', msg: 'Check threw: ' + e.message, ms: null }); } }
  for (const r of res) if (r.st === 'bad') pf_incident('Health check failed', r.name, r.msg);
  S.res = res; S.lat = lat; S.at = new Date().toISOString(); S.hist.push({ at: Date.now(), q: lat.query, s: lat.store, ok: res.filter((r) => r.st !== 'bad').length, n: res.length }); S.running = false;
  audit('status.check', 'Service status', res.filter((r) => r.st === 'good').length + '/' + res.length + ' operational', res.some((r) => r.st === 'bad') ? 'flagged' : 'ok');
}
function pf_statusDraw(el) {
  const S = PF.st, res = S.res || [], lat = S.lat || {};
  const nBad = res.filter((r) => r.st === 'bad').length, nWarn = res.filter((r) => r.st === 'warn').length;
  const ov = !S.res ? ['warn', 'Running checks…', ''] : nBad ? ['bad', 'Partial outage', nBad + ' component' + (nBad > 1 ? 's' : '') + ' failing'] : nWarn ? ['warn', 'Operational, degraded features', nWarn + ' component' + (nWarn > 1 ? 's' : '') + ' running in fallback mode'] : ['good', 'All systems operational', ''];
  let h = pgHead('Service status', 'Live checks run in this page against the running console: data, ingest, analytics, agents, store, exports and the audit chain.', '<button class="btn" id="pf-rc"' + (S.running ? ' disabled' : '') + '>' + (S.running ? 'Checking…' : 'Run checks again') + '</button>');
  h += '<div class="pf-banner ' + ov[0] + '"><span class="pf-sd ' + ov[0] + '"></span><div><b>' + ov[1] + '</b><br><span>' + (ov[2] ? ov[2] + ' · ' : '') + (S.at ? 'Last checked ' + pf_time(S.at) + ' · ' + S.hist.length + ' run' + (S.hist.length > 1 ? 's' : '') + ' this session' : 'Checking now') + '</span></div></div>';
  const ms = (v, d = 0) => (v == null ? '–' : fmt(v, d) + '<small>ms</small>');
  h += '<div class="kpis">' + kpi('Data load', ms(lat.load), 'All season files, from Resource Timing', lat.load > 2000 ? 'warn' : '') + kpi('Analytics query', ms(lat.query, 1), 'Median of 5 runs', lat.query > 200 ? 'warn' : '') + kpi('Store round trip', ms(lat.store, 1), STORE.mode === 'db' ? 'Shared store' : 'Local store') + kpi('SHA-256', ms(lat.sha, 2), 'Hash of a test vector') + kpi('Chain verify', ms(lat.chain, 1), (lat.chainN || 0) + ' entries') + '</div>';
  h += '<div class="grid"><div class="s8 pf-col">' + card('Components', 'Each row is a real check, re-run on demand', res.length ? '<div>' + res.map((r) => '<div class="pf-comp"><div><span class="pf-sd ' + r.st + '"></span><b>' + esc(r.name) + '</b></div><div class="s">' + esc(r.msg) + (r.note ? ' · ' + esc(r.note) : '') + '</div><div class="num sub" style="text-align:right">' + (r.ms == null ? '' : fmt(r.ms, r.ms < 10 ? 2 : 0) + ' ms') + '</div><div>' + chip(r.st === 'good' ? 'Operational' : r.st === 'warn' ? 'Degraded' : 'Down', r.st) + '</div></div>').join('') + '</div>' : '<div class="empty">Running checks…</div>') + '</div>';
  h += '<div class="s4 pf-col">' + pf_safe(() => {
    const pts = S.hist.filter((x) => x.q != null).map((x, i) => [i + 1, x.q]);
    return card('Analytics latency', 'Per check run this session, ms', pts.length > 1 ? lineChart({ series: [{ name: 'query', color: 'var(--accent)', pts, area: true }], h: 160, w: 360, xTicks: pts.map((p) => p[0]).filter((x, i, a) => a.length < 8 || i % Math.ceil(a.length / 6) === 0), xFmt: (v) => '#' + v }) : '<div class="empty">Run the checks again to build a trend.</div>');
  }, 'Latency') + card('Maintenance window', 'Planned for production', pf_maint(), '', 'flat') + '</div>';
  // SLOs
  const runsG = AI.runs.filter((r) => r.src === 'ai'); const gp = runsG.length ? pct(runsG.filter((r) => r.ground && r.ground.pass).length, runsG.length) : null;
  const avail = S.hist.length ? pct(sum(S.hist, (x) => x.ok), sum(S.hist, (x) => x.n)) : null;
  const chain = res.find((r) => r.name === 'Audit chain');
  const slo = [
    { s: 'Component availability', t: '≥ 99.9%', m: avail == null ? '–' : avail + '%', ok: avail == null ? null : avail >= 99.9, how: 'Checks not failing ÷ checks run, this session' },
    { s: 'Season data load', t: '< 2,000 ms', m: lat.load == null ? '–' : fmt(lat.load) + ' ms', ok: lat.load == null ? null : lat.load < 2000, how: 'Resource Timing, first request to last byte' },
    { s: 'Analytics query', t: '< 200 ms', m: lat.query == null ? '–' : fmt(lat.query, 1) + ' ms', ok: lat.query == null ? null : lat.query < 200, how: 'Median of 5 sample queries' },
    { s: 'Store round trip', t: '< 500 ms', m: lat.store == null ? '–' : fmt(lat.store, 1) + ' ms', ok: lat.store == null ? null : lat.store < 500, how: 'Write, read back, delete' },
    { s: 'Audit chain integrity', t: '100%', m: chain ? (chain.st === 'good' ? '100%' : 'Broken') : '–', ok: chain ? chain.st === 'good' : null, how: 'verifyChain() over every entry' },
    { s: 'AI answers grounded', t: '≥ ' + SETTINGS.ai.minGround + '%', m: gp == null ? 'No Claude runs' : gp + '%', ok: gp == null ? null : gp >= SETTINGS.ai.minGround, how: 'Claude runs whose numbers all appear in the data' },
  ];
  h += '<div class="s7 pf-col">' + card('Service level objectives', 'Targets vs measured in this session', tbl([
    { k: 's', l: 'Objective', f: (r) => '<b>' + esc(r.s) + '</b><div class="sub">' + esc(r.how) + '</div>' }, { k: 't', l: 'Target', f: (r) => '<span style="white-space:nowrap">' + esc(r.t) + '</span>' }, { k: 'm', l: 'Measured', f: (r) => '<span style="white-space:nowrap">' + esc(r.m) + '</span>' },
    { k: 'ok', l: 'Status', f: (r) => (r.ok == null ? chip('No data', '') : r.ok ? chip('Met', 'good') : chip('Missed', 'bad')) },
  ], slo)) + '</div>';
  h += '<div class="s5 pf-col">' + card('Incident history', 'This session', PF.incidents.length ? '<div class="list">' + PF.incidents.slice(0, 10).map((i) => '<div class="li"><span class="chip bad">' + esc(i.comp) + '</span><div><div class="t">' + esc(i.title) + '</div><div class="s">' + esc(i.detail) + '</div><div class="s">' + pf_time(i.at) + '</div></div></div>').join('') + '</div>' : '<div class="empty">No incidents recorded in this demo tenant.<br><span class="note">Failed checks, page render errors and script errors in this session would appear here.</span></div>') + '</div>';
  h += '</div>';
  el.innerHTML = h;
  el.querySelector('#pf-rc').onclick = () => { pf_runChecks().then(() => pf_redraw(el, 'status', pf_statusDraw)); pf_statusDraw(el); };
}
function pf_maint() {
  const n = new Date(); const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 2, 0, 0)); const add = (7 - d.getUTCDay()) % 7; d.setUTCDate(d.getUTCDate() + add); if (d <= n) d.setUTCDate(d.getUTCDate() + 7);
  return '<dl class="kv"><dt>Window</dt><dd>Sundays 02:00–04:00 UTC</dd><dt>Next</dt><dd>' + dateLbl(d.toISOString().slice(0, 10)) + ' · 02:00 UTC</dd><dt>Scope</dt><dd>Container Apps revision rollout, season data refresh after each matchday</dd><dt>Impact</dt><dd>Read-only for up to 10 min; zero-downtime revisions planned</dd></dl>';
}
page({ id: 'status', title: 'Service status', render(el) { pf_statusDraw(el); if (!PF.st.res && !PF.st.running) pf_runChecks().then(() => pf_redraw(el, 'status', pf_statusDraw)); } });

// ===================================================================================================
// SETTINGS
// ===================================================================================================
const PF_FIELDS = [
  ['org.name', 'Organisation name'], ['org.dept', 'Department'], ['org.contact', 'Contact'], ['lang', 'Report language'], ['units', 'Units'], ['dateFmt', 'Date format'],
  ['retention.audit', 'Audit log retention (days)'], ['retention.exports', 'Export record retention (days)'], ['retention.aiRuns', 'Agent run retention (days)'], ['retention.drafts', 'Draft report retention (days)'],
  ['ai.requireVerifier', 'Require Verifier pass before approval'], ['ai.minGround', 'Minimum grounding %'], ['ai.allowClaude', 'Allow Claude'], ['ai.allowRules', 'Allow rules fallback'], ['watermark', 'Export watermark'],
];
const pf_get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const pf_put = (o, p, v) => { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]]; a[ks[ks.length - 1]] = v; };
function pf_settingsDraw(el) {
  const S = PF.set; if (!S.draft) S.draft = pf_clone(SETTINGS); const d = S.draft; const ed = can('admin'); const dis = ed ? '' : ' disabled';
  const dirty = PF_FIELDS.filter(([k]) => JSON.stringify(pf_get(d, k)) !== JSON.stringify(pf_get(SETTINGS, k)));
  const inp = (k, type, extra) => '<input class="inp" data-k="' + k + '" type="' + (type || 'text') + '" value="' + esc(pf_get(d, k)) + '"' + dis + (extra || '') + '>';
  const sel = (k, opts) => '<select data-k="' + k + '"' + dis + '>' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(pf_get(d, k)) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
  const tog = (k, t, s) => '<label class="pf-tog"><input type="checkbox" data-k="' + k + '"' + (pf_get(d, k) ? ' checked' : '') + dis + '><span><b>' + t + '</b><small>' + s + '</small></span></label>';
  let h = pgHead('Settings', 'Tenant configuration for ' + esc(SETTINGS.org.name) + '. Everyone can view; only Admins can change organisation settings. Every change is audited.',
    ed ? '<button class="btn" id="pf-sreset">Reset to defaults</button><button class="btn pri" id="pf-ssave"' + (dirty.length ? '' : ' disabled') + '>Save ' + (dirty.length ? dirty.length + ' change' + (dirty.length > 1 ? 's' : '') : 'changes') + '</button>' : chip('🔒 View only · needs Admin to change', 'warn'));
  if (!ed) h += '<div class="lock" style="margin-bottom:14px">🔒 You’re signed in as ' + esc(me().name) + ' (' + esc(ROLE_LBL[ROLE]) + '). Organisation settings are read-only for your role. Appearance is a personal preference and you can change it.</div>';
  h += '<div class="grid">';
  h += '<div class="s6 pf-col">' + card('Organisation profile', 'Shown on reports and exports', '<div class="pf-set"><div class="row"><label class="field">Organisation name' + inp('org.name', 'text', ' maxlength="60"') + '</label><label class="field">Department' + inp('org.dept', 'text', ' maxlength="60"') + '</label></div><div class="row"><label class="field">Contact' + inp('org.contact', 'text', ' maxlength="80"') + '</label><label class="field">Tenant<input class="inp" value="' + esc(d.org.tenant) + '" disabled></label></div><div class="row"><label class="field">Data region<input class="inp" value="' + esc(d.org.region) + '" disabled></label><label class="field">Club key<input class="inp" value="HAR" disabled></label></div></div>') +
    card('Appearance', 'Personal preference for this browser · not audited', '<div class="pf-thm" id="pf-thm">' + [['system', 'System', 's'], ['light', 'Light', 'l'], ['dark', 'Dark', 'd']].map(([v, l, c]) => '<button data-v="' + v + '" aria-pressed="' + (SETTINGS.theme === v) + '"><span class="sw ' + c + '"></span>' + l + '</button>').join('') + '</div>') +
    card('Language and units', 'Applied to reports and exports; the console UI is English (en-GB) in this release', '<div class="pf-set"><div class="row"><label class="field">Report language' + sel('lang', [['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['ta-IN', 'Tamil (planned)']]) + '</label><label class="field">Units' + sel('units', [['metric', 'Metric (km, km/h, m)'], ['imperial', 'Imperial (mi, mph, yd)']]) + '</label><label class="field">Date format' + sel('dateFmt', [['D MMM YYYY', '18 Oct 2026'], ['YYYY-MM-DD', '2026-10-18'], ['MM/DD/YYYY', '10/18/2026']]) + '</label></div></div>') + '</div>';
  h += '<div class="s6 pf-col">' + card('AI policy', 'Read by the reports and agents pages through the global SETTINGS', tog('ai.requireVerifier', 'Require a Verifier pass before a report can be approved', 'Approvers can’t release a report until the Verifier agent has checked every number.') +
    '<div class="pf-tog" style="display:block"><label class="field">Minimum grounding for agent answers <span class="mono" id="pf-mg">' + d.ai.minGround + '%</span><input type="range" min="50" max="100" step="5" data-k="ai.minGround" value="' + d.ai.minGround + '"' + dis + ' style="width:100%"></label><small class="note">Share of numbers in an answer that must be found in the data. Answers below it are flagged in the audit log.</small></div>' +
    tog('ai.allowClaude', 'Allow Claude', 'Agents may call Claude when the viewer grants it (production: Azure AI Foundry).') + tog('ai.allowRules', 'Allow deterministic rules fallback', 'When no model is available, agents answer from rules over the data instead of failing.')) +
    card('Data retention', 'Production: enforced by Storage lifecycle rules and Log Analytics retention', '<div class="pf-set"><div class="row">' + [['retention.audit', 'Audit log'], ['retention.exports', 'Export records'], ['retention.aiRuns', 'Agent runs'], ['retention.drafts', 'Draft reports']].map(([k, l]) => '<label class="field">' + l + ' (days)' + inp(k, 'number', ' min="7" max="3650"') + '</label>').join('') + '</div></div>') +
    card('Export watermark', 'Tokens: {org} {user} {role} {date}', '<label class="field">Watermark text' + inp('watermark', 'text', ' maxlength="120"') + '</label><div class="pf-sec">Preview</div><div class="pf-wm" id="pf-wmp">' + esc(String(d.watermark).replace(/\{org\}/g, d.org.name).replace(/\{user\}/g, me().name).replace(/\{role\}/g, ROLE).replace(/\{date\}/g, new Date().toISOString().slice(0, 10))) + '</div>') + '</div>';
  h += '<div class="s12 pf-col">' + card('Recent setting changes', 'From the audit chain', pf_safe(() => { const ev = AUD.log.filter((e) => /^settings\./.test(e.action)).slice(-10).reverse(); return ev.length ? tbl([{ k: 'at', l: 'When', f: (e) => '<span class="sub">' + pf_time(e.at) + '</span>' }, { k: 'actor', l: 'By', f: (e) => esc(e.actor) }, { k: 'target', l: 'Setting', f: (e) => esc(e.target) }, { k: 'detail', l: 'Change', cls: 'wrap', f: (e) => '<span class="mono" style="font-size:12px">' + esc(e.detail) + '</span>' }], ev) : '<div class="empty">No setting changes this session.</div>'; }, 'Changes'), '', 'flat') + '</div>';
  h += '</div>';
  el.innerHTML = h;
  el.querySelectorAll('[data-k]').forEach((i) => {
    const upd = () => { const k = i.dataset.k; let v = i.type === 'checkbox' ? i.checked : i.value; if (i.type === 'number' || i.type === 'range') v = +v; pf_put(d, k, v); };
    i.oninput = () => { upd(); if (i.dataset.k === 'ai.minGround') el.querySelector('#pf-mg').textContent = i.value + '%'; if (i.dataset.k === 'watermark' || i.dataset.k === 'org.name') { const p = el.querySelector('#pf-wmp'); if (p) p.textContent = String(d.watermark).replace(/\{org\}/g, d.org.name).replace(/\{user\}/g, me().name).replace(/\{role\}/g, ROLE).replace(/\{date\}/g, new Date().toISOString().slice(0, 10)); } };
    i.onchange = () => { upd(); const pos = i.type === 'text' ? i.selectionStart : null; pf_settingsDraw(el); };
  });
  el.querySelectorAll('#pf-thm button').forEach((b) => { b.onclick = () => { SETTINGS.theme = d.theme = b.dataset.v; try { localStorage.setItem('mce.theme', b.dataset.v); } catch (e) {} pf_applyTheme(b.dataset.v); pf_saveSettings(); pf_settingsDraw(el); }; });
  const sv = el.querySelector('#pf-ssave'); if (sv) sv.onclick = () => {
    if (!gate('admin', 'Change settings')) return;
    for (const [k] of PF_FIELDS) { if (!/^retention\./.test(k)) continue; const v = pf_get(d, k); if (!(v >= 7 && v <= 3650)) { toast('Retention must be between 7 and 3,650 days.'); return; } }
    if (!String(d.org.name).trim()) { toast('Organisation name can’t be empty.'); return; }
    const ch = PF_FIELDS.filter(([k]) => JSON.stringify(pf_get(d, k)) !== JSON.stringify(pf_get(SETTINGS, k)));
    for (const [k, l] of ch) audit('settings.update', l, JSON.stringify(pf_get(SETTINGS, k)) + ' → ' + JSON.stringify(pf_get(d, k)));
    for (const [k] of ch) pf_put(SETTINGS, k, pf_get(d, k));
    pf_saveSettings(); S.draft = null; toast(ch.length + ' setting' + (ch.length > 1 ? 's' : '') + ' saved and audited.'); pf_settingsDraw(el);
  };
  const rs = el.querySelector('#pf-sreset'); if (rs) rs.onclick = () => { const keep = d.theme; S.draft = pf_clone(PF_DEFAULTS); S.draft.theme = keep; toast('Defaults loaded. Save to apply.'); pf_settingsDraw(el); };
}
page({ id: 'settings', title: 'Settings', render(el) { PF.set.draft = null; pf_settingsDraw(el); } });
