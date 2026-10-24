// ---- Broadcast Copilot focus suggestion, shown in Watch (ADR-0019). Broadcast suggests where the story should go; Watch shows the suggestion beside the match.
// The camera does not move yet: the 3D engine exposes no focus call to these hooks, so the button stays disabled and says Planned.
// Appended after watch.js in the same module (see build.py).
(() => {
  if (!MCS.framed) return;
  const pill = document.createElement('div');
  pill.id = 'mc-focus'; pill.setAttribute('role', 'status'); pill.hidden = true;
  pill.style.cssText = 'position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:45;max-width:min(480px,calc(100% - 24px));display:flex;gap:8px;align-items:center;padding:6px 10px;border-radius:999px;background:rgba(10,20,40,.92);border:1px solid #3aa0ff;color:#e8eefc;font:600 12px system-ui,sans-serif';
  pill.innerHTML = '<span id="mc-focus-t"></span><button type="button" id="mc-focus-go" disabled title="Camera moves are Planned: the 3D engine has no focus call yet" style="padding:3px 8px;border-radius:999px;border:1px solid #2c4a72;background:#17283F;color:#e8eefc;font:inherit">Go to it (Planned)</button>';
  document.body.append(pill);
  let timer = null;
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell' || d.type !== 'focus') return;
    document.getElementById('mc-focus-t').textContent = 'Broadcast suggests: ' + String(d.reason || '').slice(0, 160);
    pill.hidden = false; clearTimeout(timer); timer = setTimeout(() => { pill.hidden = true; }, 15000);
  });
})();
