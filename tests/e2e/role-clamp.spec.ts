import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// EXP-16 follow-up: the engine itself ignores an order the player's role does not allow, whoever sets it (the table is packages/agents/matchcast_agents/roles/orders.py).
test('role clamp: setOrder in the engine drops orders outside the role, keeps the ones inside, and clear always works', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  const r = await f.evaluate(() => {
    const w = window as any, ps = w.__mc.players as any[];
    const gk = ps.find((q) => q.pos === 'GK'), cb = ps.find((q) => q.pos === 'CB'), st = ps.find((q) => q.pos === 'ST');
    const order = (p: any, k: string) => { w.__mcSetOrder(p, k); return p.orders && p.orders.k; };
    const out: Record<string, any> = {};
    out.gkPress = order(gk, 'press');          // never sent upfield
    out.gkPush = order(gk, 'push');
    out.gkRest = order(gk, 'rest');            // allowed
    out.gkClear = (w.__mcSetOrder(gk, 'clear'), gk.orders);
    out.cbShoot = order(cb, 'shoot');
    out.cbMark = order(cb, 'mark');
    out.stPress = order(st, 'press');
    out.stDeep = order(st, 'deep');
    return out;
  });
  expect(r).toEqual({ gkPress: null, gkPush: null, gkRest: 'rest', gkClear: null, cbShoot: null, cbMark: 'mark', stPress: 'press', stDeep: 'deep' });
  expect(errs).toEqual([]);
});
