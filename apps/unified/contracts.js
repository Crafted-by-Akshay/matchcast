// ---- unified console: the shared contracts. Every view and every agent reads and writes these three shapes.
// matchcast.event/1  one match event, as Watch emits it
// matchcast.claim/1  one claim an agent makes about the match: its inputs, its evidence and the Verifier's verdict
// matchcast.audit/1  one append-only record of an agent action, hash-chained to the record before it
const MCC = (() => {
  const SCHEMA = { event: 'matchcast.event/1', claim: 'matchcast.claim/1', audit: 'matchcast.audit/1' };
  const LOCALE = 'en', RULES = 'rules-v1';
  // canonical JSON: keys sorted, so the same record always gives the same bytes and the same hash
  const canon = (v) => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x);
  const sha256 = (text) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    .then((b) => [...new Uint8Array(b)].map((n) => n.toString(16).padStart(2, '0')).join(''));

  const event = (ev, id) => ({ schema: SCHEMA.event, id, minute: +(+ev.minute).toFixed(1), type: ev.type, team: ev.team || null, player: ev.player || null, data: ev });
  const claim = (c) => Object.assign({ schema: SCHEMA.claim, locale: LOCALE, rules: RULES, verdict: 'pending', repaired: false, reason: '', route: null, audit: [] }, c);

  // the audit chain: each record holds the hash of the record before it, so an edit anywhere breaks verify()
  let recs = [], tail = Promise.resolve();
  const digest = (r) => sha256(canon({ seq: r.seq, at: r.at, agent: r.agent, action: r.action, ref: r.ref, detail: r.detail, prev: r.prev }));
  const append = (agent, action, ref, detail, at) => {
    const job = tail.then(async () => {
      const prev = recs.length ? recs[recs.length - 1].hash : 'genesis';
      const r = { schema: SCHEMA.audit, seq: recs.length + 1, at, agent, action, ref, detail, prev };
      r.hash = await digest(r); recs.push(r); return r;
    });
    tail = job.catch(() => {});
    return job;
  };
  const verify = () => tail.then(async () => {
    let prev = 'genesis';
    for (const r of recs) {
      if (r.prev !== prev || (await digest(r)) !== r.hash) return { ok: false, brokenAt: r.seq, count: recs.length };
      prev = r.hash;
    }
    return { ok: true, count: recs.length, head: prev };
  });
  const records = () => recs.slice();
  const reset = () => { recs = []; tail = Promise.resolve(); };

  return { SCHEMA, LOCALE, RULES, canon, sha256, event, claim, append, verify, records, reset };
})();
