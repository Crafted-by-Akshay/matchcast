import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';

// The shape view names its minutes as a broadcaster does: the second half from its kick-off reads "2nd half 45'", and
// the first half's added time reads "45+k'". The scrubber's aria text carries the same name.
type Case = { firstTo: number; secondFrom: number; secondTo: number; scrub: number[] };

async function openWatch(page: import('@playwright/test').Page) {
  await openShell(page, 'watch');
  // the shape view needs the live run (AG.run) before it draws; wait for Watch to start it
  await page.waitForFunction("typeof AG !== 'undefined' && AG.run", null, { timeout: 60_000 });
}

// one evaluate: the feed, the render and the scrubs run in the same tick, so Watch's own frames cannot interleave
async function labels(page: import('@playwright/test').Page, c: Case) {
  return page.evaluate((c: Case) => {
    const setup = { h: 'ARG', a: 'BRA', seed: 2026, st: 4, month: 7, kick: '17:00', half: 15 };
    const names = Array.from({ length: 22 }, (_, i) => 'P' + i);
    const roster = { teams: ['ARG', 'BRA'], players: names.map((n, i) => ({ name: n, team: i < 11 ? 'ARG' : 'BRA' })) };
    const M = (window as any).MAPS;
    const at = (s: number) => names.map((_, i) => [(i * 4 + s * 0.4) % 105, 10 + (i * 3) % 50, 0, 0, 0, 0]);
    M.start(setup, roster);
    for (let s = 2600; s <= c.firstTo; s++) M.frame(setup, { mclock: s, half: 1, players: at(s) });
    for (let s = c.secondFrom; s <= c.secondTo; s++) M.frame(setup, { mclock: s, half: 2, players: at(s) });
    const el = document.createElement('div');
    document.body.appendChild(el);
    (window as any).MC.analysis.render('shape', {}, el);
    const sc = el.querySelector('[data-shape-scrub]') as HTMLInputElement;
    return c.scrub.map((m) => {
      sc.value = String(m);
      sc.dispatchEvent(new Event('input', { bubbles: true }));
      return sc.getAttribute('aria-valuetext');
    });
  }, c);
}

const head = (s: string | null) => (s || '').split(':')[0];

test('analyst shape view: added time reads 45+k\', and the second half reads 2nd half 45\' from its kick-off', async ({ page }) => {
  const errs = collectErrors(page);
  await openWatch(page);
  // first half to 47:20, second half from 45:00 to 49:00
  const [first, regular, added, kick, next] = await labels(page, { firstTo: 2879, secondFrom: 2700, secondTo: 2760, scrub: [44, 45, 47, 48, 49] });
  expect(head(first)).toBe("45'");
  expect(head(regular)).toBe("45+1'");
  expect(head(added)).toBe("45+3'");
  expect(head(kick)).toBe("2nd half 45'");
  expect(head(next)).toBe("2nd half 46'");
  expect(errs).toEqual([]);
});

test('analyst shape view: a first half that ends on a whole minute keeps its last minute apart from the second half', async ({ page }) => {
  const errs = collectErrors(page);
  await openWatch(page);
  // the first half's last sample is 48:00 itself, so the second half starts at 49:00 and the two never share a minute
  const [added, kick] = await labels(page, { firstTo: 2880, secondFrom: 2700, secondTo: 2760, scrub: [48, 49] });
  expect(head(added)).toBe("45+4'");
  expect(head(kick)).toBe("2nd half 45'");
  expect(errs).toEqual([]);
});

test('analyst shape view: a late first sample of the second half does not move its kick-off minute', async ({ page }) => {
  const errs = collectErrors(page);
  await openWatch(page);
  // the second half's first sample is a minute late (46:00 on its clock); the kick-off minute is still 2nd half 45'
  const [kick, next] = await labels(page, { firstTo: 2879, secondFrom: 2760, secondTo: 2765, scrub: [48, 49] });
  expect(head(kick)).toBe("2nd half 45'");
  expect(head(next)).toBe("2nd half 46'");
  expect(errs).toEqual([]);
});

test('analyst shape view: the second half runs on to 90+ added time', async ({ page }) => {
  const errs = collectErrors(page);
  await openWatch(page);
  // the second half runs to 90:00 on its clock: the minute before the 90th reads 2nd half 89', the first minute past it 2nd half 90+1'
  const [late, last] = await labels(page, { firstTo: 2879, secondFrom: 2700, secondTo: 5400, scrub: [92, 93] });
  expect(head(late)).toBe("2nd half 89'");
  expect(head(last)).toBe("2nd half 90+1'");
  expect(errs).toEqual([]);
});
