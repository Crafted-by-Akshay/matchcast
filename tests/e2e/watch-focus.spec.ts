import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, stepSim, viewFrame } from './helpers';

// Broadcast's "Go to it" asks Watch to move its camera: window.MCWatch.focus({ player_id } | { zone }) uses Watch's player mode and says whether it moved.
test('MCWatch.focus: a player id or a zone moves the camera (player mode); unknown targets do not', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await stepSim(f, 400);
  const r = await f.evaluate(() => {
    const w = window as any, ps = w.__mc.players as any[];
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const target = ps.find((q) => !q.gk && q.ti === 1);
    const out: Record<string, any> = { has: typeof w.MCWatch?.focus };
    out.player = w.MCWatch.focus({ player_id: slug(target.name) });
    out.playerMode = document.body.classList.contains('fm-player');
    out.chip = document.getElementById('fan-chip')!.textContent;
    out.num = String(target.num);
    out.zones = ['box', 'midfield', 'wide'].map((z) => w.MCWatch.focus({ zone: z }));
    out.unknownPlayer = w.MCWatch.focus({ player_id: 'nobody-here' });
    out.unknownZone = w.MCWatch.focus({ zone: 'moon' });
    out.empty = w.MCWatch.focus({});
    return out;
  });
  expect(r.has).toBe('function');
  expect(r.player).toBe(true);
  expect(r.playerMode).toBe(true);
  expect(r.chip).toContain('Player focus');
  expect(r.chip).toContain(r.num);   // the chip shows the followed player's number
  expect(r.zones.every((z: unknown) => typeof z === 'boolean')).toBe(true);
  expect(r.zones[1]).toBe(true);   // there is always someone in the middle third
  expect(r.unknownPlayer).toBe(false);
  expect(r.unknownZone).toBe(false);
  expect(r.empty).toBe(false);
  expect(errs).toEqual([]);
});
