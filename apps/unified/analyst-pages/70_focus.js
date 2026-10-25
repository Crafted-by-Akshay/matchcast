// Focused Analyst mode. The nav shows five entries under "This match" and the rest under "More".
// Data science and Platform pages stay registered and open by route (go('ds-query')), but are not in the nav.
// The Live match page reads the shell's feed (Watch's score, minute, stats and last events) when Watch runs the shared match,
// and the season run for the fixture otherwise. It says which one it shows.
ICONS.live = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2';
ICONS.ask = 'M4 5h16v11H9l-5 4z';
ICONS.trace = 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5';
NAV.splice(0, NAV.length,
  ['This match', ['live', 'match', 'ask', 'trace', 'library']],
  ['More', ['scouting', 'opposition', 'setpieces', 'board', 'explorer', 'reports', 'audit', 'agents', 'access']],
);

// Five tabs in the match centre. Patterns puts the pass network and the average shape on one tab.
MC_RENDER.pat = (m) => MC_RENDER.pass(m) + '<div style="height:14px"></div>' + MC_RENDER.shape(m);
MC_TABS.splice(0, MC_TABS.length, ['ov', 'Overview'], ['shots', 'Shots'], ['pat', 'Patterns'], ['ply', 'Players'], ['trust', 'Verifier']);

const focusLive = () => (window.MC_FEED && window.MC_FEED.on ? window.MC_FEED : null);
const focusMatch = (arg) => D.match(arg || (focusLive() || {}).fixture) || D.matches[D.matches.length - 1];
// the season match a feed belongs to, or null for a custom setup (no season fixture to compare with)
const focusFeedMatch = (f) => (f && f.fixture ? D.match(f.fixture) : null);

// Watch's own bookkeeping line ("vision on") is not a match event; at 0' the list then says it is waiting for kick-off instead of showing it (UX review pass 7)
const focusEvents = (f) => (f && f.last ? f.last.filter((e) => e.type !== 'vision_on') : []);
const focusWaiting = (f) => !!f && !f.over && f.minute < 1 && !focusEvents(f).length;
const WAIT_NOTE = '<p id="live-wait" class="note">Waiting for kick-off in Watch. These numbers fill in as the match plays; the Match centre shows the recorded run now.</p>';

function drawCustomLive(el, f) {
  const last = focusEvents(f).length
    ? '<ol class="list">' + focusEvents(f).map((e) => '<li>' + minLbl(e.minute) + ' ' + esc(String(e.type).replace(/_/g, ' ')) + (e.player ? ' · ' + esc(e.player) : '') + '</li>').join('') + '</ol>'
    : '<div class="empty">' + (focusWaiting(f) ? 'Waiting for kick-off. Events appear here as Watch plays.' : 'No events yet.') + '</div>';
  el.innerHTML = pgHead('Live match', 'Custom setup · no season fixture to compare with') +
    '<p id="live-source" class="note">Live from Watch · the simulated match engine. Only the live score, time and events show for a custom setup.</p>' + (focusWaiting(f) ? WAIT_NOTE : '') +
    '<div class="kpis">' + kpi('Score', esc(f.score.join('–')), 'Watch') + kpi('Time', f.over ? 'Full time' : Math.floor(f.minute) + '′', 'Watch clock') + '</div>' +
    card('Last five events', 'From the live match, newest last', last);
}

function drawLive(el, arg) {
  const f = focusLive();
  if (f && !focusFeedMatch(f)) { drawCustomLive(el, f); return; }
  const m = f ? focusFeedMatch(f) : focusMatch(arg), H = m.ts[m.home], A = m.ts[m.away];   // a feed always shows its own fixture, never a route argument
  // Live numbers come from Watch only: with the feed on, a stat Watch has not sent yet shows a dash, never the season run's figure
  const st = f ? f.stats || null : null;
  const sv = (k, i) => (st && st[k] ? st[k][i] : null);
  const liveOr = (live, season) => (f ? live : season);
  const pair = (a, b, fn) => fn(a) + ' – ' + fn(b);
  const n = (v) => (v == null ? '–' : v);
  const rows = [
    ['Expected goals (xG)', 'Chance quality. Each shot counts for the share of goals it would be expected to score, summed.', pair(liveOr(sv('xg', 0), H.xg), liveOr(sv('xg', 1), A.xg), (v) => (v == null ? '–' : fmt(v, 2)))],
    ['Shots', 'Attempts at goal, home – away.', pair(liveOr(sv('shots', 0), H.shots), liveOr(sv('shots', 1), A.shots), n)],
    ['Possession', 'Share of the match with the ball.', pair(liveOr(sv('poss', 0), H.poss), liveOr(sv('poss', 1), A.poss), (v) => (v == null ? '–' : v + '%'))],
    ['Passes completed', 'Completed passes, home – away.', pair(liveOr(sv('done', 0), H.done), liveOr(sv('done', 1), A.done), n)],
    ['PPDA', 'Passes allowed per defensive action. Lower means a higher press. Only in the recorded run, so a dash while Watch is live.', f ? '–' : pair(H.ppda, A.ppda, n)],
  ];
  const score = f ? f.score.join('–') : m.score.join('–');
  const when = f ? (f.over ? 'Full time' : Math.floor(f.minute) + '′') : (m.sum.ended || 'Full time');
  const source = f ? 'Live from Watch · the simulated match engine' : 'Season run for this fixture · recorded (Simulated)';
  const last = f && focusEvents(f).length
    ? '<ol class="list">' + focusEvents(f).map((e) => '<li>' + minLbl(e.minute) + ' ' + esc(String(e.type).replace(/_/g, ' ')) + (e.player ? ' · ' + esc(e.player) : '') + '</li>').join('') + '</ol>'
    : '<div class="empty">' + (f ? (focusWaiting(f) ? 'Waiting for kick-off. Events appear here as Watch plays.' : 'No events yet.') : 'The live feed is off. Start a match in Watch to follow it here.') + '</div>';
  el.innerHTML = pgHead('Live match', esc(clubName(m.home)) + ' v ' + esc(clubName(m.away)) + ' · ' + esc(m.title), '<button class="btn" data-go="ask">Ask the match</button><button class="btn" data-go="match.' + m.id + '">Match centre</button>') +
    '<p id="live-source" class="note">' + esc(source) + '</p>' + (focusWaiting(f) ? WAIT_NOTE : '') +
    '<div class="kpis">' + kpi('Score', esc(score), esc(clubName(m.home)) + ' – ' + esc(clubName(m.away))) + kpi('Time', esc(when), f ? 'Watch clock' : 'Season run') + '</div>' +
    '<div class="grid"><div class="s7">' + card('Stats, explained', 'Each line says what the number means', '<dl class="kv" id="live-stats">' + rows.map((r) => '<dt>' + esc(r[0]) + ' <b>' + esc(r[2]) + '</b></dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>') + '</div>' +
    '<div class="s5">' + card('Last five events', 'From the shared match, newest last', last) + '</div></div>';
  el.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { const [p, a] = b.dataset.go.split('.'); go(p, a); }; });
}

page({ id: 'live', title: 'Live match', render(el, arg) { drawLive(el, arg); } });
window.mcLiveRefresh = () => { const el = document.getElementById('pg'); if (R.page === 'live' && el) drawLive(el, R.arg); };

page({
  id: 'ask', title: 'Ask the match', render(el) {
    el.innerHTML = pgHead('Ask the match', 'Ask about the shared match. The answer comes from the agent api when it is live, or from the in-page rules (Simulated) when it is not. Each answer says whether the Verifier checked it.') +
      '<div class="card"><label for="ask-q"><b>Your question</b></label><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
      '<input id="ask-q" maxlength="300" placeholder="e.g. Who had the most shots?" style="flex:1;min-width:220px;min-height:44px">' +
      '<button class="btn pri" id="ask-go">Ask</button></div>' +
      '<div id="ask-out" data-state="idle" aria-live="polite" style="margin-top:14px"></div></div>';
    const out = el.querySelector('#ask-out');
    const run = async () => {
      const q = el.querySelector('#ask-q').value.trim();
      if (!q || out.dataset.state === 'asking') return;   // one question at a time, so an older answer cannot overwrite a newer one
      out.dataset.state = 'asking'; out.textContent = 'Checking with the agents…';
      const a = window.mcAskShell ? await window.mcAskShell(q) : { text: 'Ask is not connected in this view.', verdict: 'abstained' };
      out.dataset.state = 'answered';
      out.innerHTML = '<p>' + esc(a.text || '') + '</p><p class="muted">' + (a.verdict === 'verified' ? '✓ Verified by the Verifier' : 'Not confirmed') + (a.note ? ' · ' + esc(a.note) : '') + '</p>';
    };
    el.querySelector('#ask-go').onclick = run;
    el.querySelector('#ask-q').onkeydown = (e) => { if (e.key === 'Enter') run(); };
  },
});

page({
  id: 'trace', title: 'How was this made?', render(el, arg) {
    const m = focusMatch(arg), ins = m.events.filter((e) => e.type === 'insight');
    el.innerHTML = pgHead('How was this made?', 'Each agent line in ' + esc(m.title) + ' (recorded run, Simulated), with the steps that made it. The in-page rules agents wrote them, and the Verifier recounts each one from the event log.') +
      '<div class="card" id="trace-list">' + (ins.length
        ? '<div class="list">' + ins.map((e) => '<div class="li"><span class="chip ' + (e.status === 'verified' ? 'good' : e.status === 'rejected' ? 'bad' : 'warn') + '">' + esc(e.status) + '</span><div><div class="t">' + esc(e.text) + '</div><div class="s">' + minLbl(e.minute) + ' · Analyst (' + esc(e.agent || 'rules') + ') made the claim · Narrator wrote the line · Verifier ' + esc(e.status) + ' it against the event log (Simulated)</div></div></div>').join('') + '</div>'
        : '<div class="empty">No agent lines in this match.</div>') + '</div>';
  },
});
