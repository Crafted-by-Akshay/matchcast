// The Watch Copilot's typed questions go to the agent api through the shell: the shell owns the live match
// and its session, so the Watch asks it over postMessage and gets the checked answer back (or null).
window.mcShellAsk = (question, context) => new Promise((resolve) => {
  if (window.parent === window) { resolve(null); return; }   // Watch on its own: no shell, no api
  const id = Math.random().toString(36).slice(2);
  const done = (text) => { window.removeEventListener('message', onReply); clearTimeout(timer); resolve(text); };
  const onReply = (e) => { const d = e.data || {}; if (d.src === 'matchcast-shell' && d.type === 'copilot-answer' && d.id === id) done(d.text || null); };
  const timer = setTimeout(() => done(null), 16000);   // the shell gives up at 15 s; the Watch falls back a second later
  window.addEventListener('message', onReply);
  window.parent.postMessage({ src: 'matchcast', type: 'copilot-ask', id, question, context }, '*');
});
