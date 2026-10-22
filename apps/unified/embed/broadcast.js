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

// ---- lower-third and teleprompter (EXP-7): only lines the shell has approved for air reach here
const mcL3 = document.createElement('div');
mcL3.id = 'mc-l3'; mcL3.setAttribute('role', 'status'); mcL3.hidden = true;
mcL3.style.cssText = 'position:fixed;left:24px;bottom:84px;max-width:60%;padding:10px 16px;background:rgba(10,20,40,.92);color:#fff;border-left:4px solid #3aa0ff;font:600 15px system-ui,sans-serif;z-index:30;border-radius:4px';
const mcTele = document.createElement('ol');
mcTele.id = 'mc-tele'; mcTele.setAttribute('aria-label', 'Teleprompter: approved lines');
mcTele.style.cssText = 'position:fixed;right:12px;top:64px;width:300px;margin:0;padding:8px 8px 8px 28px;background:rgba(10,20,40,.85);color:#e8eefc;font:13px system-ui,sans-serif;z-index:30;border-radius:4px;max-height:40%;overflow:auto';
document.body.append(mcL3, mcTele);
let mcL3Timer = 0; const mcAired = [];
window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.src !== 'matchcast-shell' || d.type !== 'air' || !d.line) return;
  const l = d.line; if (mcAired.some((x) => x.id === l.id)) return;
  mcAired.push(l); if (mcAired.length > 5) mcAired.shift();
  mcL3.textContent = Math.floor(l.minute) + "' " + l.text; mcL3.hidden = false;
  clearTimeout(mcL3Timer); mcL3Timer = setTimeout(() => { mcL3.hidden = true; }, 8000);
  mcTele.innerHTML = ''; for (const x of mcAired.slice().reverse()) { const li = document.createElement('li'); li.textContent = x.text; mcTele.append(li); }
});
