// The fixture's clubs before the desk draws anything. The shell puts the two keys on the frame URL (h, a), so a national fixture is
// named from the first render: the desk's lineups, labels and commentary never show a season club. build.py places the fetch before
// the TEAMS literal and the naming after it.
// messages that arrive while the club list loads are kept and replayed once the desk's listeners are in place (the rest of the module
// runs in the same task after the await, so the replay in the timeout sees every listener)
const mcEarly = [];
const mcKeep = (e) => mcEarly.push(e);
window.addEventListener('message', mcKeep);
// the module waits for this, so the wait is bounded: a slow club list means the season names, as before
const MC_BOOT_CLUBS = await (async () => {
  const q = new URLSearchParams(location.search), h = q.get('h'), a = q.get('a');
  if (!h || !a) return null;
  const late = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
  const list = Promise.resolve().then(() => fetch('../shared/clubs.json')).then((r) => r.json()).then((j) => j.clubs).catch(() => null);
  const clubs = await Promise.race([list, late]);
  if (!clubs) return null;
  const C = [h, a].map((k) => clubs.find((c) => c.key === k));
  // national fixtures only, with full squads: a season match keeps the season clubs its lineups and labels were built with
  const national = C[0] && C[1] && C.every((c) => c.label === 'synthetic squad' && c.squad && c.squad.length >= 11);
  return national ? C : null;
})();
window.removeEventListener('message', mcKeep);
setTimeout(() => {
  for (const e of mcEarly.splice(0)) window.dispatchEvent(new MessageEvent('message', { data: e.data, origin: e.origin, source: e.source }));
}, 0);
// the squad slots the desk's eleven take, per side (the same map embed/hook.js uses for the 3D players)
const MC_SLOT = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0, 1, 2, 3, 4, 8, 6, 7, 10, 9, 5]];
const mcBootNames = (C) => {
  const contrast = (hex) => { const n = parseInt(hex.slice(1), 16); const L = (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) / 255; return L > 0.7 ? 0x1A1D22 : 0xF2F5F8; };
  const short = (name) => name.split(' ')[0][0] + '. ' + name.split(' ').slice(-1)[0];   // "Tomás Quintana" -> "T. Quintana", the desk's form
  C.forEach((c, ti) => {
    const T = TEAMS[ti], shirt = parseInt(c.color.slice(1), 16);
    Object.assign(T, { key: c.key, club: c.club, css: c.color, kit: shirt, kitSocks: shirt, kitShorts: contrast(c.color), kit2: contrast(c.color) });
    T.players.forEach((row, i) => { const sq = c.squad[MC_SLOT[ti][i]]; if (sq) { row[0] = sq.num; row[1] = short(sq.name); } });
  });
};
