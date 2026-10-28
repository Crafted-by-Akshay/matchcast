// My Club's conversation surface. Reads existing saved records and delegates live questions
// to the same Ask service as Watch. It never creates a match or changes the selected fixture.
window.MCClubAsk = (() => {
  let config, signature = '', generation = 0;
  const cache = new Map(), $ = (id) => document.getElementById(id);
  const name = (f) => f.home.club + ' v ' + f.away.club;
  const clubMatches = () => config.fixtures.filter((f) => !f.national && !config.upcoming(f) && [f.home.key, f.away.key].includes(config.club())).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const live = () => { const r = config.live(); return r && r.events && r.events.length ? r : null; };
  const clubName = () => { const f = clubMatches()[0]; return f ? (f.home.key === config.club() ? f.home.club : f.away.club) : ''; };
  const record = async (f) => {
    if (cache.has(f.id)) return cache.get(f.id);
    const response = await fetch('analyst/data/' + encodeURIComponent(f.id) + '.json');
    if (!response.ok) throw new Error('The saved match record could not be loaded. Try again.');
    const data = await response.json(); cache.set(f.id, data); return data;
  };
  const suggestions = () => {
    const context = $('club-ask-context').value;
    const questions = context === 'live' ? ['What is the score?', 'Who has the most shots?', 'What is the xG so far?'] : context === 'history' ? ['How has my club done in its past matches?', 'What happened in our last match?', 'Who scored for my club?'] : ['What happened in this match?', 'Who scored?', 'What was the xG?'];
    $('club-ask-suggestions').replaceChildren();
    for (const q of questions) { const button = document.createElement('button'); button.type = 'button'; button.textContent = q; button.onclick = () => { $('club-ask-q').value = q; ask(q); }; $('club-ask-suggestions').append(button); }
  };
  const sync = () => {
    if (!config) return;
    const list = clubMatches(), running = live();
    const sig = config.club() + '|' + list.map((f) => f.id).join(',') + '|' + (running ? running.key : '');
    if (sig === signature) return;
    signature = sig; generation++;
    const selected = $('club-ask-context').value;
    $('club-ask-title').textContent = clubName() ? 'Ask about ' + clubName() : 'Ask about your club';
    $('club-ask-scope').textContent = list.length ? 'Ask about your club’s saved synthetic season, choose a past match, or use the current live match when it is running.' : 'Choose your club above to ask about its saved matches.';
    const context = $('club-ask-context'); context.replaceChildren();
    const option = (value, label) => { const el = document.createElement('option'); el.value = value; el.textContent = label; context.append(el); };
    option('history', clubName() ? clubName() + ' · past matches' : 'Club history');
    for (const f of list) option(f.id, f.date + ' · ' + name(f));
    if (running) option('live', 'Live now · ' + running.names.home + ' v ' + running.names.away);
    if ([...context.options].some((o) => o.value === selected)) context.value = selected;
    $('club-ask-answer').hidden = true; suggestions();
  };
  const show = (text, sources = [], note = 'Saved synthetic season · rules fallback') => {
    const box = $('club-ask-answer'); box.replaceChildren(); box.hidden = false;
    const p = document.createElement('p'); p.style.whiteSpace = 'pre-line'; p.textContent = text; box.append(p);
    if (sources.length) { const links = document.createElement('div'); links.className = 'ask-sources'; for (const f of sources) { const a = document.createElement('a'); a.href = '#match/' + encodeURIComponent(f.id); a.textContent = f.date + ' · ' + name(f); a.onclick = (event) => { event.preventDefault(); config.openMatch(f.id); }; links.append(a); } box.append(links); }
    if (note) { const source = document.createElement('p'); source.className = 'source'; source.textContent = note; box.append(source); }
  };
  // POST /v1/ask/record: the saved match's summary (score, stats, key events) to the same model as Ask. null when the api is
  // not set, is off, or its answer does not pass its checks.
  const recordAnswer = async (f, data, q) => {
    const api = window.MATCHCAST_API;
    if (!api) return null;
    const stats = {};
    for (const key of ['shots', 'xg', 'poss', 'passes']) { const v = data.stats && data.stats[key]; if (Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(+x))) stats[key] = v.map(Number); }
    const body = { session_id: 'club-' + Math.random().toString(36).slice(2, 10), question: q, persona: 'casual', home: f.home.club, away: f.away.club,
      score: (data.score || f.score).map((x) => Math.round(+x)), stats,
      events: (data.events || []).filter((e) => e && e.type).slice(0, 40).map((e) => ({ minute: Math.min(130, Math.max(0, +e.minute || 0)), type: String(e.type).slice(0, 24), player: e.player ? String(e.player).slice(0, 60) : null, team: e.team === 'home' || e.team === 'away' ? e.team : null })) };
    try {
      const res = await fetch(api.replace(/\/+$/, '') + '/v1/ask/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      const j = await res.json();
      return typeof j.answer === 'string' && j.answer ? j.answer : null;
    } catch (e) { return null; }
  };
  const eventText = (e) => Math.floor(+e.minute || 0) + "' · " + (e.type === 'goal' ? 'Goal · ' + (e.player || 'Scorer not recorded') : e.type === 'red_card' ? 'Red card · ' + (e.player || 'Player not recorded') : e.type === 'shot' ? 'Shot · ' + (e.player || 'Player not recorded') : e.text || e.type.replace(/_/g, ' '));
  const matchAnswer = (f, data, q) => {
    const stats = data.stats || {}, events = data.events || [], label = name(f), score = (data.score || f.score).join('–');
    const stat = (key, title, digits = 0) => { const values = stats[key]; return Array.isArray(values) && values.length === 2 ? label + ' · ' + title + ': ' + values.map((v) => Number.isFinite(+v) ? (+v).toFixed(digits) : 'not recorded').join(' – ') + '.' : title + ' was not saved for this match.'; };
    if (/\bxg\b|expected goals/.test(q)) return stat('xg', 'xG', 2);
    if (/possession/.test(q)) { const values = stats.poss, total = values && (+values[0] + +values[1]); return total > 0 ? label + ' · possession share: ' + Math.round(values[0] / total * 100) + '% – ' + Math.round(values[1] / total * 100) + '%. This is the saved estimate from simulated on-ball actions.' : 'Possession was not saved for this match.'; }
    if (/\bshots?\b/.test(q)) return stat('shots', 'Shots');
    if (/\bpasses\b/.test(q)) return stat('passes', 'Passes');
    const minute = /(?:at|around|minute)\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:minutes?|min)\b/.exec(q);
    if (minute) { const m = +(minute[1] || minute[2]), near = events.filter((e) => Math.abs(+e.minute - m) <= 1 && ['goal', 'red_card', 'shot', 'insight'].includes(e.type)); return near.length ? near.slice(0, 8).map(eventText).join('\n') : 'No key event was saved around minute ' + m + '. This record does not contain a continuous video clip.'; }
    if (/scor|\bgoals?\b/.test(q) && !/score\b/.test(q)) { const goals = events.filter((e) => e.type === 'goal'); return goals.length ? goals.map(eventText).join('\n') : 'No scorer events were saved for this match.'; }
    if (/happen|summary|result|score|moment|highlight|last match|past match/.test(q)) { const moments = events.filter((e) => ['goal', 'red_card'].includes(e.type)); return label + ' finished ' + score + ' on ' + f.date + '.' + (moments.length ? '\n' + moments.slice(0, 8).map(eventText).join('\n') : '\nNo goal or red-card events were saved.'); }
    return 'I can’t confirm that from this saved record. You can ask about the result, scorers, xG, possession, shots, passes or key moments.';
  };
  async function ask(question) {
    sync();
    const q = String(question || '').trim().slice(0, 300).toLowerCase(); if (!q) return;
    const token = ++generation, context = $('club-ask-context').value;
    show('Looking through the available match records…', [], '');
    try {
      if (context === 'live') {
        const run = live(); if (!run) { show('The live match is no longer available. Choose a saved match instead.'); return; }
        const key = run.key, answer = await config.askLive(question);
        if (token !== generation || !live() || live().key !== key) return;
        show(answer.text || 'There is no answer in the current match record.', [], 'Current live match · ' + (answer.api ? 'connected Copilot' : 'rules fallback')); return;
      }
      let list = clubMatches();
      if (!list.length) { show('Choose your club above to ask about its past matches.', [], ''); return; }
      if (context !== 'history') {
        const f = list.find((item) => item.id === context); if (!f) { show('That saved match is not available for this club.'); return; }
        const data = await record(f); if (token !== generation) return;
        const modelAnswer = await recordAnswer(f, data, q);   // the model over this record; the record's own text only when it does not answer
        if (token !== generation) return;
        if (modelAnswer) show(modelAnswer, [f], 'Saved synthetic season · connected Copilot');
        else show(matchAnswer(f, data, q), [f]);
        return;
      }
      // An opponent named in the question narrows the same selected club's records.
      const opponents = new Map(); for (const f of list) { const side = f.home.key === config.club() ? f.away : f.home; opponents.set(side.club.toLowerCase(), side.key); }
      const opponent = [...opponents].find(([team]) => q.includes(team));
      if (opponent) list = list.filter((f) => [f.home.key, f.away.key].includes(opponent[1]));
      const last = /\blast\s+(\d+)\s+(?:games|matches)/.exec(q); if (last) list = list.slice(0, Math.min(28, Math.max(1, +last[1])));
      if (/last match|latest match|most recent|\bxg\b|expected goals|possession|\bshots?\b|\bpasses\b|minute|highlight|key moment/.test(q)) {
        const f = list[0], data = await record(f); if (token === generation) show(matchAnswer(f, data, q), [f]); return;
      }
      if (/scor|\bgoals?\b/.test(q) && !/score\b/.test(q)) {
        const records = await Promise.all(list.map(record));
        const lines = records.flatMap((data, i) => (data.events || []).filter((e) => e.type === 'goal' && e.team === config.club()).map((e) => list[i].date + ' · ' + eventText(e)));
        if (token === generation) show(lines.length ? lines.slice(0, 24).join('\n') : 'No scorer events for your club were saved in these records.', list); return;
      }
      if (/record|result|form|done|past|recent|win|los[st]|draw|score|history|head.?to.?head/.test(q)) {
        let wins = 0, draws = 0, losses = 0;
        for (const f of list) { const side = f.home.key === config.club() ? 0 : 1, ours = f.score[side], theirs = f.score[1 - side]; if (ours > theirs) wins++; else if (ours < theirs) losses++; else draws++; }
        show(clubName() + ': ' + list.length + ' matches · ' + wins + ' wins, ' + draws + ' draws, ' + losses + ' losses.\n' + list.map((f) => f.date + ' · ' + name(f) + ' · ' + f.score.join('–')).join('\n'), list); return;
      }
      show('I can’t confirm that from the saved season. Ask about your club’s results, an opponent, scorers, or choose a match for its stats and key moments.');
    } catch (error) { if (token === generation) show(error.message || 'The match record could not be loaded. Try again.', [], ''); }
  }
  const close = () => { document.body.classList.remove('club-copilot-open'); $('club-ask-panel').hidden = true; $('club-ask-open').setAttribute('aria-expanded', 'false'); $('club-ask-open').focus(); };
  const open = () => { sync(); document.body.classList.add('club-copilot-open'); $('club-ask-panel').hidden = false; $('club-ask-open').setAttribute('aria-expanded', 'true'); $('club-ask-q').focus(); };
  const init = (options) => {
    config = options;
    $('club-ask-open').onclick = open;
    $('club-ask-close').onclick = close;
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('club-ask-panel').hidden && !$('v-my-club').hidden) { event.preventDefault(); close(); } });
    $('club-ask-form').onsubmit = (event) => { event.preventDefault(); ask($('club-ask-q').value); };
    $('club-ask-context').onchange = () => { generation++; $('club-ask-answer').hidden = true; suggestions(); };
    sync();
    setInterval(() => { if (!$('v-my-club').hidden) sync(); }, 1000);
  };
  return { init, sync, open, close };
})();
