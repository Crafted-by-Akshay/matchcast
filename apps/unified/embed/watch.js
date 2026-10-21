// ---- unified shell hook: Watch ----
MCS.view = 'watch';
MCS.progress('Loading the stadium and players');
(() => {
  const Q = new URLSearchParams(location.search);
  const ready = setInterval(() => {
    if (!window.__mc || !players.length || !$('load').hidden || !MCS.clubs.ready) return;
    clearInterval(ready);
    MCS.progress('Setting up the squads and kits');
    if (Q.has('seed')) { MCS.apply(Q); kickOff(); MCS.started(); }
    $('kick').addEventListener('click', () => MCS.started());
    MCS.loop();
    MCS.emit();
  }, 200);
})();
