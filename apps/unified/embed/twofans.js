// ---- Watch: one moment, two viewers, and the Verifier's measured record (audit follow-up; stage e, personalise). Runs in the Watch module after feed.js. ----
// The commentary line the engine says is run through Watch's own two voices (fanVoice in analyst mode and in casual mode), so the two cards are the same event worded for two viewers.
// The casual card is shown in Hindi by hand-written rules for the casual line shapes, checked in the page: every number and name of the English line must survive. A line with no Hindi rule stays English and says so. Not native-reviewed.
(() => {
  const feed = document.getElementById('mcf');
  if (!feed || document.getElementById('bc-view') || typeof fanVoice === 'undefined') return;
  const st = document.createElement('style');
  st.textContent = '#mc-two{padding:6px 10px 8px;border-top:1px solid rgba(140,194,255,.2)}#mc-two[hidden]{display:none}'
    + '#mc-two .mt{font:700 10px system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#8CC2FF;display:flex;justify-content:space-between;gap:8px;margin-bottom:4px}#mc-two .mt span{font-weight:600;text-transform:none;letter-spacing:0;color:#c9d6f0}'
    + '#mc-two .cols{display:grid;grid-template-columns:1fr 1fr;gap:8px}#mc-two section{border:1px solid rgba(140,194,255,.25);border-radius:8px;padding:5px 7px;min-width:0}'
    + '#mc-two h4{margin:0 0 2px;font:700 11px system-ui,sans-serif;color:#8CC2FF}#mc-two p{margin:0;font:12px/1.35 system-ui,sans-serif;color:#e8eefc;overflow-wrap:anywhere}#mc-two .ca h4{color:#F5B942}'
    + '#mc-trust{min-height:28px;padding:2px 8px;border-radius:6px;border:1px solid rgba(91,209,154,.5);background:transparent;color:#5BD19A;font:600 11px system-ui,sans-serif;cursor:pointer;white-space:nowrap}#mc-trust:focus-visible,#cp-evalnote button:focus-visible{outline:2px solid #F5B942;outline-offset:2px}'
    + '#cp-evalnote{margin:0 0 8px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font:12px/1.4 system-ui,sans-serif;color:var(--muted)}#cp-evalnote b{color:var(--ink,#e8eefc)}#cp-evalnote button{margin-top:6px;min-height:32px;padding:2px 10px;border-radius:6px;border:1px solid var(--line);background:transparent;color:inherit;cursor:pointer}'
    + '@media (max-width:560px){#mc-two{display:none}#mc-trust .mc-full{display:none}#mc-trust{padding:2px 6px}}'
    + '@media (max-width:560px) and (max-height:300px){#mcf-sound{display:none!important}#mcf-top{padding-bottom:2px}}';   // a very short frame (a small phone under the shell header): the card must leave room for the Talk control   /* a phone has no room for two cards above the pitch controls: the commentary card stays one line */';
  document.head.appendChild(st);

  // the trust chip: the measured record of the claim Verifier (docs/eval/agents-eval.md), in the commentary header
  const EVAL = '99.3% of 151 planted errors caught (right reason required), 0 false rejects on 34 honest lines';
  const chip = document.createElement('button');
  chip.type = 'button'; chip.id = 'mc-trust'; chip.innerHTML = '✓ <span class="mc-full">Verifier </span>99.3%';   // static text; the word drops on phones so the commentary head stays on one row
  chip.title = 'Verifier record, offline evaluation of the rules agents on a frozen match: ' + EVAL + '. Not a live-model result (docs/eval/agents-eval.md). Click for the Verify tab.';
  chip.setAttribute('aria-label', 'Verifier record: ' + EVAL + '. Opens the Verify tab.');
  const head = feed.querySelector('#mcf-head'); if (head) head.insertBefore(chip, head.lastElementChild);
  const note = document.createElement('div'); note.id = 'cp-evalnote';
  note.innerHTML = '<b>Claim Verifier, measured:</b> ' + EVAL + '. That is an offline evaluation of the rules agents on a frozen match, not a live-model result. The checks below are this match engine\'s own (the Laws and player motion); the claims and the audit chain are on the Agents tab.<br><button type="button">Open the Agents tab</button>';
  note.querySelector('button').onclick = () => MCS.send({ type: 'goto', view: 'agents' });
  const vf = document.getElementById('cp-verify'); if (vf) vf.insertBefore(note, vf.firstChild);
  chip.onclick = () => { if (!CP.open) $('cpbtn').onclick(); setTab('verify'); };

  // the two cards
  const box = document.createElement('div'); box.id = 'mc-two'; box.hidden = true; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'The same moment for two viewers');
  box.innerHTML = '<div class="mt">Same moment, two viewers <span>rules-written, checked in page · Simulated</span></div><div class="cols"><section class="ca" lang="hi"><h4>Casual fan · हिन्दी</h4><p></p></section><section class="an" lang="en"><h4>Analyst · English</h4><p></p></section></div>';
  feed.insertBefore(box, feed.querySelector('#mcf-list'));
  const pCa = box.querySelector('.ca p'), pAn = box.querySelector('.an p'), hCa = box.querySelector('.ca h4');

  // Hindi for the casual line shapes in fanVoice; names, clubs and numbers stay as they are
  const HI = [
    [/^Big chance! (.+) has a go!$/, (x) => 'बड़ा मौका! ' + x[1] + ' ने शॉट मारा!'],
    [/^(.+) has a go!$/, (x) => x[1] + ' ने शॉट मारा!'],
    [/^(.+) reads it and steals the ball!$/, (x) => x[1] + ' ने पास पढ़ लिया और गेंद छीन ली!'],
    [/^(.+) wins the ball back for (.+)\.$/, (x) => x[1] + ' ने ' + x[2] + ' के लिए गेंद वापस जीती।'],
    [/^Offside! (.+) went a moment too early\.$/, (x) => 'ऑफसाइड! ' + x[1] + ' थोड़ा जल्दी आगे निकल गया।'],
    [/^Foul by (.+)\. Penalty!$/, (x) => x[1] + ' का फ़ाउल। पेनल्टी!'],
    [/^Foul by (.+)\. Free kick\.$/, (x) => x[1] + ' का फ़ाउल। फ़्री किक।'],
    [/^Wow! (.+) keeps it out!$/, (x) => 'वाह! ' + x[1] + ' ने गेंद बाहर रोक दी!'],
    [/^⚽ GOAL! (.+?) scores! (.+)\.$/, (x) => '⚽ गोल! ' + x[1] + ' ने गोल किया! ' + x[2] + '।'],
  ];
  const keep = (en, hi) => (en.match(/\d+/g) || []).every((n) => new RegExp('(^|\\D)' + n + '(\\D|$)').test(hi)) && (en.match(/[A-ZÀ-Ý][\wÀ-ÿ'’-]+/g) || []).filter((w) => !/^(Big|Offside|Foul|Wow|GOAL|Penalty|Free)$/.test(w)).every((w) => hi.includes(w));
  const toHindi = (en) => { for (const [re, fn] of HI) { const m = re.exec(en); if (m) { const hi = fn(m); return keep(en, hi) ? hi : null; } } return null; };

  const _fv = fanVoice; let last = 0;   // the original voice; fanVoice itself is replaced below
  const variant = (line, mode) => { const was = FAN.mode; FAN.mode = mode; try { return _fv(line); } finally { FAN.mode = was; } };
  fanVoice = function (line) {
    const out = _fv(line);
    try {
      const L = String(line == null ? '' : line);
      if (S.started && L && performance.now() - last > 1500) {
        const an = variant(L, 'analyst'), ca = variant(L, 'casual');
        if (an && ca && an !== ca) {
          last = performance.now();
          const hi = toHindi(ca);
          pCa.textContent = hi || ca; pCa.lang = hi ? 'hi' : 'en'; hCa.textContent = hi ? 'Casual fan · हिन्दी' : 'Casual fan · English (no Hindi rule)';
          pAn.textContent = an; box.hidden = false;
        }
      }
    } catch (e) { /* the two cards are an extra; the commentary line itself is untouched */ }
    return out;
  };
  window.__mcTwoFans = { toHindi };   // read by tests
})();
