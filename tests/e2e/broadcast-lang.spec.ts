import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame, openView } from './helpers';

// Broadcast desk script: English, Spanish and Hindi (Tamil is out until a native speaker reviews it); every translation is re-checked.
test('desk script has EN, ES and HI, keeps names and numbers, and the re-check rejects a bad translation', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await openView(page, 'broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await expect(bc.locator('#bc-lang button')).toHaveText(['EN', 'ES', 'हिन्दी']);
  expect(await bc.locator('#bc-lang').textContent()).not.toContain('தமிழ்');
  await expect.poll(() => bc.evaluate(() => !!(window as any).__mc?.S.started && !!(window as any).__bcLang), { timeout: 240_000 }).toBe(true);

  // a goal from Watch (the shell forwards its events to Broadcast; here the parent posts one)
  const who = await bc.evaluate(() => { const p = (window as any).__mc.players[9]; return { team: p.T.key, name: p.name }; });
  await page.evaluate((w) => {
    (document.querySelector('#v-broadcast iframe') as HTMLIFrameElement).contentWindow!.postMessage({ src: 'matchcast-shell', type: 'events', batch: [{ type: 'goal', team: w.team, player: w.name, score: '1-0', minute: 12.4 }] }, '*');
  }, who);
  await bc.locator('#bc-tabs button[data-p="script"]').click();
  await expect(bc.locator('#sc-now')).toContainText('GOAL!');
  await bc.locator('#bc-lang button[data-l="es"]').click();
  await expect(bc.locator('#sc-now')).toContainText('marca para');
  await expect(bc.locator('#sc-now')).toContainText(who.name);
  await expect(bc.locator('#sc-now')).toContainText('1-0');
  await expect(bc.locator('#sc-lines')).toContainText('ES translated, re-checked ✓');
  await bc.locator('#bc-lang button[data-l="hi"]').click();
  await expect(bc.locator('#sc-now')).toContainText('के लिए');
  await expect(bc.locator('#sc-now')).toContainText(who.name);
  await bc.locator('#bc-lang button[data-l="en"]').click();
  await expect(bc.locator('#sc-now')).toContainText('GOAL!');

  // the Verifier step: a changed number, a swapped name order and an invented name are all rejected
  const r = await bc.evaluate(() => {
    const c = (window as any).__bcLang.check, names = ['Harbor City', 'Ridgeview', 'A One'];
    return [c('Goal for A One. 1-0.', 'Gol de A One. 1-0.', names).ok, c('Goal for A One. 1-0.', 'Gol de A One. 2-0.', names).ok, c('Goal. Harbor City 1-0 Ridgeview.', 'Gol. Ridgeview 1-0 Harbor City.', names).ok, c('Goal for A One. 1-0.', 'Gol de Zed Quill. 1-0.', names).ok];
  });
  expect(r).toEqual([true, false, false, false]);
  expect(errs).toEqual([]);
});
