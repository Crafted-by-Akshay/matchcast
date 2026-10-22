import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// EXP polish: the Watch view and the shell header work at 390 px: no sideways scroll, tap targets of at least 44 px.
const tinyOf = () => [...document.querySelectorAll('button, select, input, textarea, [role=button]')].filter((e) => {
  const el = e as HTMLElement, cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden || el.closest('[hidden]')) return false;
  const b = ((el as HTMLInputElement).type === 'checkbox' && el.closest('label') ? el.closest('label')! : el).getBoundingClientRect();
  return b.width > 0 && b.height > 0 && (b.width < 44 || b.height < 44);
}).map((e) => (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String((e as HTMLElement).className).split(' ')[0]) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));

test('Watch at 390 px: no horizontal scroll and 44 px tap targets', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  const shell = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  const view = await f.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  const small = [...(await page.evaluate(tinyOf)).map((x) => 'shell ' + x), ...(await f.evaluate(tinyOf)).map((x) => 'watch ' + x)];
  console.log('WATCH390', JSON.stringify({ shell, view, small }));
  expect(shell.over).toBeLessThanOrEqual(1);
  expect(view.over).toBeLessThanOrEqual(1);
  expect(small).toEqual([]);
  expect(errs).toEqual([]);
});
