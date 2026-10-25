// ---- unified console: Azure Speech in the browser (EXP-8 voices, EXP-16 talk).
// GET {MATCHCAST_API}/v1/speech/token -> {token, region, expires_at}; the token is Speech-only and lasts 10 minutes, so it is refetched a minute before expiry.
// 503 not_ready (no Speech resource) or 429 rate_limited (Retry-After) keep the browser voice; no key ever reaches the page.
// The SDK is loaded only once a token was issued, so an offline console never calls out.
const SPX = (() => {
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk@1.40.0/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js';
  let tok = null, got = 0, inflight = null, sdkP = null, sdkBad = 0, blockedUntil = 0, state = 'unknown', reason = '', dest = null;
  const api = () => (window.MATCHCAST_API || '').replace(/\/$/, '');
  // the token's life is counted from when it arrived (the api issues 9 minutes), not from the server's clock
  const fetchToken = async () => {
    try {
      const r = await fetch(api() + '/v1/speech/token');
      if (r.status === 429) { blockedUntil = Date.now() + 1000 * (+r.headers.get('Retry-After') || 60); state = 'limited'; reason = 'rate limited'; return null; }
      if (!r.ok) { blockedUntil = Date.now() + 60000; state = 'off'; reason = r.status === 503 ? 'no Speech resource configured' : 'token error ' + r.status; return null; }
      tok = await r.json(); got = Date.now(); state = 'on'; reason = ''; return tok;
    } catch (e) { blockedUntil = Date.now() + 60000; state = 'off'; reason = 'api unreachable'; return null; }
  };
  const token = async () => {
    if (!api() || Date.now() < blockedUntil) return null;
    if (tok && Date.now() - got < 8 * 60000) return tok;
    tok = null; return inflight || (inflight = fetchToken().finally(() => { inflight = null; }));
  };
  const sdk = () => {
    if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
    if (Date.now() < sdkBad) return Promise.reject(new Error('Speech SDK unavailable'));
    return sdkP || (sdkP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = SDK_URL; s.onload = () => res(window.SpeechSDK); s.onerror = () => { sdkP = null; sdkBad = Date.now() + 60000; s.remove(); rej(new Error('Speech SDK failed to load')); };
      document.head.append(s);
    }));
  };
  const config = async (lang, voice) => {
    const t = await token(); if (!t) return null;
    const S = await sdk(), c = S.SpeechConfig.fromAuthorizationToken(t.token, t.region);   // token as issued, no prefix
    c.speechRecognitionLanguage = lang; if (voice) c.speechSynthesisVoiceName = voice; return { S, c };
  };
  // SSML for one line (EXP-8 voice). The tone sets the energy: calm (a pass, a summary), hot (a shot or a build-up: faster, higher, more
  // expression) and big (a goal, a red card, a score claim: the fastest, highest, with emphasis). Azure ignores a style the voice does not have.
  const ssml = (text, voice, lang, tone) => {
    const esc = String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
    const big = tone === 'big', hot = tone === 'hot';
    const degree = big ? 2 : hot ? 1.5 : 1, rate = big ? '+3%' : hot ? '0%' : '-4%', pitch = big ? '+8%' : hot ? '+5%' : '+2%';
    return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='" + lang + "'>"
      + "<voice name='" + (voice || 'en-GB-RyanNeural') + "'><mstts:express-as style='cheerful' styledegree='" + degree + "'>"
      + "<prosody rate='" + rate + "' pitch='" + pitch + "'>" + (big ? '<emphasis level="strong">' + esc + '</emphasis>' : esc) + '</prosody>'
      + '</mstts:express-as></voice></speak>';
  };
  // speak text with a named voice; resolves true when Azure finished playing it, false when the caller should use the browser voice
  const speak = async (text, voice, lang, tone) => {
    try {
      const k = await config(lang || 'en-GB', voice); if (!k) return false;
      const d = new k.S.SpeakerAudioDestination(), syn = new k.S.SpeechSynthesizer(k.c, k.S.AudioConfig.fromSpeakerOutput(d));
      dest = d;
      return await new Promise((res) => {
        d.onAudioEnd = () => { syn.close(); if (dest === d) dest = null; res(true); };   // playback ended, not just synthesis
        syn.speakSsmlAsync(ssml(text, voice, lang || 'en-GB', tone), (r) => { if (r.reason !== k.S.ResultReason.SynthesizingAudioCompleted) { syn.close(); if (dest === d) dest = null; if (r.reason === k.S.ResultReason.Canceled) tok = null; res(false); } },
          () => { syn.close(); if (dest === d) dest = null; tok = null; res(false); });
      });
    } catch (e) { return false; }
  };
  const stop = () => { if (dest) { try { dest.pause(); dest.close(); } catch (e) { /* already closed */ } dest = null; } };
  // one spoken phrase to text (push-to-talk); resolves the text, '' when nothing was recognised, or null when Azure is not available
  const listen = async (lang) => {
    try {
      const k = await config(lang || 'en-GB'); if (!k) return null;
      const rec = new k.S.SpeechRecognizer(k.c, k.S.AudioConfig.fromDefaultMicrophoneInput());
      return await new Promise((res) => rec.recognizeOnceAsync((r) => { rec.close(); res(r.reason === k.S.ResultReason.RecognizedSpeech ? r.text : ''); }, () => { rec.close(); res(''); }));
    } catch (e) { return null; }
  };
  // a call (EXP-18): keep listening until the handle is stopped. onSpeech fires as soon as the fan's voice is heard (a cut-in);
  // onText gets each finished phrase. Resolves a handle, or null when Azure is not available so the caller uses the browser.
  const listenOn = async (lang, onSpeech, onText) => {
    try {
      const k = await config(lang || 'en-GB'); if (!k) return null;
      const rec = new k.S.SpeechRecognizer(k.c, k.S.AudioConfig.fromDefaultMicrophoneInput());
      rec.recognizing = (s, e) => { if (e.result.text && e.result.text.trim().split(/\s+/).length >= 2) onSpeech(); };
      rec.recognized = (s, e) => { if (e.result.reason === k.S.ResultReason.RecognizedSpeech && e.result.text) onText(e.result.text); };
      await new Promise((res, rej) => rec.startContinuousRecognitionAsync(res, rej));
      return { stop: () => rec.stopContinuousRecognitionAsync(() => rec.close(), () => rec.close()) };
    } catch (e) { return null; }
  };
  return { token, speak, stop, listen, listenOn, get state() { return state; }, get reason() { return reason; } };
})();
window.SPX = SPX;   // the Broadcast and Watch frames (same origin) reach it as window.parent.SPX
