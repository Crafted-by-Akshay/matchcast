// ---- unified shell hook: Broadcast ----
MCS.view = 'broadcast';
MCS.progress('Loading the stadium and players');
// called by the desk once the players have loaded (replaces bcNewMatch(seed) at boot)
function bcEmbedStart(q) {
  MCS.progress('Setting up the match');
  const go = () => { if (q.get('seed')) { MCS.apply(q); bcNewMatch(q.get('seed')); } else bcNewMatch(); MCS.started(); };
  if (MCS.clubs.ready) go(); else MCS.clubs.load.then(go);
}
$('bc-new').addEventListener('click', () => MCS.started());
MCS.loop();

// the shared score: while Watch runs the shared match, the scoreboard shows Watch's score and minute.
// The pitch still runs the desk's own engine, so its goals can differ until the single-engine refactor.
let shellFeed = null;
window.addEventListener('message', (e) => { const d = e.data || {}; if (d.src === 'matchcast-shell' && d.type === 'feed') shellFeed = d; });
const bcHeaderOwn = bcHeader;
bcHeader = function () {
  bcHeaderOwn();
  if (shellFeed && shellFeed.on) { $('bc-score').textContent = shellFeed.score.join('–'); $('bc-clk').textContent = shellFeed.over ? 'FT' : shellFeed.minute + "'"; }
};
