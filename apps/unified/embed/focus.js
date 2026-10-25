// ---- Broadcast Copilot focus suggestion, shown in Watch (ADR-0019). Broadcast suggests where the story should go; Watch shows it beside the match.
// "Go to it" calls Watch's focus call (MCWatch.focus, the player mode) and moves the camera only when the player is on the pitch.
// Appended after watch.js in the same module (see build.py).
(() => {
  if (!MCS.framed) return;
  const pill = document.createElement('div');
  pill.id = 'mc-focus'; pill.setAttribute('role', 'status'); pill.hidden = true;
  pill.style.cssText = 'position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:45;max-width:min(480px,calc(100% - 24px));display:flex;gap:8px;align-items:center;padding:6px 10px;border-radius:999px;background:rgba(10,20,40,.92);border:1px solid #3aa0ff;color:#e8eefc;font:600 12px system-ui,sans-serif';
  pill.innerHTML = '<span id="mc-focus-t"></span><button type="button" id="mc-focus-go" disabled style="padding:3px 8px;border-radius:999px;border:1px solid #2c4a72;background:#17283F;color:#e8eefc;font:inherit;cursor:pointer">Go to it</button>';
  document.body.append(pill);
  const hide = document.createElement('style'); hide.textContent = '#mc-focus[hidden]{display:none}'; document.head.append(hide);
  const text = document.getElementById('mc-focus-t'), go = document.getElementById('mc-focus-go');
  let timer = null, player = '';
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell' || d.type !== 'focus') return;
    player = String(d.player_id || '');
    text.textContent = 'Broadcast suggests: ' + String(d.reason || '').slice(0, 160);
    go.disabled = !player; go.title = player ? '' : 'Only a player can be followed; a wide shot needs no camera move';
    go.textContent = 'Go to it';
    pill.hidden = false; clearTimeout(timer); timer = setTimeout(() => { pill.hidden = true; }, 15000);
  });
  go.addEventListener('click', () => {
    const moved = !!(window.MCWatch && player && window.MCWatch.focus({ player_id: player }));
    go.textContent = moved ? 'Camera on ' + player : 'Camera not moved';
    go.title = moved ? '' : 'The match is not running on the pitch yet, or the player is not on it';
    go.disabled = true;
  });
})();
