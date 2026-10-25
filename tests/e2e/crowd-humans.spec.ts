import { test, expect } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// The stands hold human-shaped fans (head, hair, torso with arms, legs), not capsules. Every fan is drawn by
// instanced meshes with the same instance order, so each body part of one fan moves together; far stands drop to a
// lower-detail level so the crowd stays cheap on laptops and phones.
test('the stands show instanced human fans with two levels of detail', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  const w = await viewFrame(page, 'watch');
  await expect.poll(() => w.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  const c = await w.evaluate(() => {
    const k = (window as any).__mc.crowd;
    return k && { kind: k.kind, fans: k.fans, parts: k.parts, lod: k.lod, trisPerFan: k.trisPerFan, lowTrisPerFan: k.lowTrisPerFan, chunks: k.chunks };
  });
  expect(c, 'the crowd is exposed for the test').toBeTruthy();
  expect(c!.kind).toBe('humanoid');
  expect(c!.fans).toBeGreaterThanOrEqual(15000);
  expect(c!.parts).toEqual(['body', 'legs', 'head', 'hair']);
  expect(c!.lod).toBe(2);
  // a fan costs about what a capsule did, and the far level is cheaper again
  expect(c!.trisPerFan).toBeLessThanOrEqual(160);
  expect(c!.lowTrisPerFan).toBeLessThan(c!.trisPerFan);
  // every body part of a chunk draws the same instances, so the parts of one fan always move together
  expect(c!.chunks.length).toBeGreaterThan(0);
  for (const ch of c!.chunks) expect(ch.parts.every((n: number) => n === ch.count)).toBe(true);
  expect(errs).toEqual([]);
});
