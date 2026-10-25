// ---- unified console: the continuous commentary feed (Watch and Broadcast). One ordered feed for both views.
// Every Watch moment and each key event (shots, cards, corners, half and full time) becomes a line. A quiet stretch gets a summary
// counted from the events in it, so the feed does not go silent. A line the agent api writes replaces the rules line for the same
// match minute, or is added beside it. Each line names the agents that made it and where its numbers came from.
const CM = (() => {
  const KEEP = 120, QUIET_MIN = 2, WINDOW_MIN = 2, CHAIN = ['Producer', 'Analyst', 'Narrator', 'Verifier'];
  const SKIP_UPGRADE = ['summary', 'set_piece', 'period', 'tactics', 'play'];   // lines an api line about a moment must not overwrite
  const PBP_GAP = 0.2, RUN_MIN = 1, PLAY = new Set(['pass', 'slide_tackle', 'tackle', 'interception', 'foul']);   // the booth calls the play every 0.2 match minutes (about 12 s); a run of passes is within a minute
  const LABEL = { rules: 'Rules · recounted', live: 'Live agents · verified' };
  const f2 = (x) => (+x || 0).toFixed(2);
  const trim = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  const seenApi = new Set();
  let items = [], events = [], seen = new Set(), score = [0, 0], names = null, n = 0, lastLine = -99, playAt = -1, playFrom = 0, persona = 'casual', changed = () => {};

  const idx = (team) => (!names || team == null) ? -1 : team === names.hk ? 0 : team === names.ak ? 1 : -1;
  const club = (ti) => (ti === 0 ? names.home : names.away);
  const push = (o) => {
    const item = { id: 'l' + (++n), t: Date.now(), minute: o.minute, text: trim(o.text, 240), kind: o.kind, tone: o.tone || '', source: o.source || 'rules', chain: o.chain || CHAIN.slice(), persona, numbers: o.numbers || [] };
    items.push(item); if (items.length > KEEP) items.shift();
    lastLine = o.minute; changed(); return item;
  };

  // one Watch event that deserves a line of its own (goals and red cards come as moments, which carry the reason)
  const lineOf = (ev, ti) => {
    const who = ev.player || 'A player', tc = club(ti);
    switch (ev.type) {
      case 'shot': {
        const outcome = ev.fate === 'save' ? ', and the keeper saves' : ev.fate === 'miss' ? ', off target' : '';
        const big = (+ev.xg || 0) >= 0.25;
        return { minute: ev.minute, kind: 'shot', tone: big ? 'big' : '', numbers: [{ name: 'xG', value: +ev.xg || 0 }], text: (big ? 'Big chance! ' : '') + who + ' shoots for ' + tc + outcome + '. xG ' + f2(ev.xg) + '.' };
      }
      case 'yellow_card': return { minute: ev.minute, kind: 'card', text: 'Yellow card for ' + who + ' (' + tc + ')' + (ev.reason ? ': ' + ev.reason : '') + '.' };
      case 'corner': return { minute: ev.minute, kind: 'set_piece', text: 'Corner to ' + tc + '.' };
      case 'tactical_change': return { minute: ev.minute, kind: 'tactics', text: tc + ' change shape to ' + (ev.formation || 'a new formation') + '.' };
      case 'kickoff': return ev.half === 2 ? { minute: ev.minute, kind: 'period', text: 'The second half is under way.' } : { minute: ev.minute, kind: 'period', text: 'Kick-off: ' + names.home + ' v ' + names.away + '.' };
      case 'half_time': return { minute: ev.minute, kind: 'period', tone: 'big', text: 'Half-time: ' + names.home + ' ' + score[0] + ', ' + names.away + ' ' + score[1] + '.' };
      case 'full_time': return { minute: ev.minute, kind: 'period', tone: 'big', text: 'Full time: ' + names.home + ' ' + score[0] + ', ' + names.away + ' ' + score[1] + '.' };
      default: return null;
    }
  };

  // a quiet stretch: what each side did in the last WINDOW_MIN minutes, counted from the events in that window
  const summary = (at) => {
    const from = at - WINDOW_MIN, passes = [0, 0], shots = [0, 0];
    for (const e of events) {
      if (e.minute <= from || e.minute > at + 1e-9 || e.ti < 0) continue;
      if (e.type === 'pass') passes[e.ti]++;
      if (e.type === 'shot') shots[e.ti]++;
    }
    const busy = passes[0] + passes[1] + shots[0] + shots[1] > 0 ? '' : ' Quiet spell.';
    return { minute: at, kind: 'summary', text: 'Minutes ' + Math.max(0, Math.floor(from)) + ' to ' + Math.floor(at) + ': ' + names.home + ' ' + passes[0] + ' passes, ' + names.away + ' ' + passes[1] + ' passes; shots ' + shots[0] + '–' + shots[1] + '. ' + names.home + ' ' + score[0] + '–' + score[1] + ' ' + names.away + '.' + busy };
  };

  // play-by-play: the booth calls the newest action since its last call, and says how many passes a side made in that stretch.
  // The words come from the events, so the line is checked in page like the rest of the rules lines.
  const callPlay = (at) => {
    if (playAt >= 0 && at >= playAt && at - playAt < PBP_GAP - 1e-9) return;   // the epsilon keeps a call exactly PBP_GAP later from failing on float error
    const fresh = events.slice(playFrom).filter((e) => e.ti >= 0 && e.player && PLAY.has(e.type));
    if (!fresh.length) return;
    const act = fresh[fresh.length - 1], tc = club(act.ti);
    let run = 0;   // the passes this side has made in a row up to the newest action, within RUN_MIN minutes, across earlier calls too; any action by the other side ends it
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.ti < 0) continue;
      if (e.ti !== act.ti || e.type !== 'pass' || act.minute - e.minute > RUN_MIN) break;
      run++;
    }
    const text = act.type === 'pass'
      ? (run >= 3 ? tc + ' keep the ball: ' + run + ' passes, last from ' + act.player + '.' : act.player + ' plays it on for ' + tc + '.')
      : act.type === 'foul' ? act.player + ' commits a foul (' + tc + ').'
      : act.type === 'interception' ? act.player + ' reads it and intercepts for ' + tc + '.'
      : act.player + ' challenges for ' + tc + '.';   // a tackle's outcome is not in the batch, so the line makes no claim about it
    playAt = at; playFrom = events.length;
    push({ minute: act.minute, kind: 'play', text, numbers: act.type === 'pass' && run >= 3 ? [{ name: 'passes', value: run }] : [] });
  };

  // Watch's batch: the events first (so the score and the window are current), then the moments, then a summary if the feed has gone quiet
  const fromWatch = (batch, moments) => {
    if (!names) return;
    let last = null;
    for (const ev of batch || []) {
      if (ev.minute == null) continue;
      const ti = idx(ev.team);
      events.push({ minute: +ev.minute, type: ev.type, ti, player: ev.player || null });
      if (ev.type === 'goal' && ti >= 0) score[ti]++;
      const line = lineOf(ev, ti);
      if (line) push(line);
      last = Math.max(last == null ? -1 : last, +ev.minute);
    }
    for (const m of moments || []) {
      if (!m || seen.has(m.id) || m.minute == null || m.type === 'big_chance') continue;   // a big chance is the shot's own line (its xG and the Big chance tag)
      seen.add(m.id);
      const why = m.why ? ' ' + m.why : '';
      push({ minute: m.minute, kind: m.type, tone: ['goal', 'red_card', 'turning_point'].includes(m.type) ? 'big' : '', text: (m.title || m.type) + '.' + why, chain: CHAIN.slice() });
      last = Math.max(last == null ? -1 : last, +m.minute);
    }
    if (last != null) callPlay(last);
    if (last != null && last - lastLine >= QUIET_MIN && events.length) push(summary(Math.floor(last)));
  };

  // a line the agent api wrote (its Verifier checked it): it replaces the rules line for the same minute, or joins the feed
  const api = (text, minute, kind, key) => {
    if (!names || !String(text || '').trim()) return;
    if (key) { if (seenApi.has(key)) return; seenApi.add(key); }   // a reconnect replays the stream's publications: each one joins the feed once
    const at = +minute || 0, prior = [...items].reverse().find((x) => x.source === 'rules' && !SKIP_UPGRADE.includes(x.kind) && Math.abs(x.minute - at) < 0.5);
    if (prior) { prior.text = trim(String(text), 240); prior.source = 'live'; prior.chain = CHAIN.concat('Live agents'); prior.persona = persona; changed(); return; }
    push({ minute: at, kind: kind || 'line', text: String(text), source: 'live', chain: CHAIN.concat('Live agents') });
  };

  const reset = (key, nm) => { names = nm || null; items = []; seenApi.clear(); events = []; seen = new Set(); score = [0, 0]; lastLine = -99; playAt = -1; playFrom = 0; n = 0; changed(); if (names) push({ minute: 0, kind: 'period', text: 'Players are out. ' + names.home + ' v ' + names.away + ' is about to start.' }); };
  // the feed the views draw: newest last, each with its label
  const view = (count) => items.slice(-(count || 40)).map((x) => ({ id: x.id, t: x.t, minute: x.minute, text: x.text, kind: x.kind, tone: x.tone, source: x.source, label: LABEL[x.source], chain: x.chain, persona: x.persona, numbers: x.numbers }));
  // the persona in effect (casual, analyst, broadcast, or a lens such as club:<key>): each line keeps the one it was written under
  const setPersona = (p) => { persona = p && p !== 'fan' ? p : 'casual'; };
  return { fromWatch, api, reset, view, setPersona, onChange: (fn) => { changed = fn; }, get count() { return items.length; } };
})();
