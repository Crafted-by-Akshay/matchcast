import { test, expect } from './fixtures';
import { openShell, viewFrame } from './helpers';

// AB#475 (CREW-7.6, the producer desk's six-up view). Every feed card shows its last line (or "waiting for a moment"), its Verified count, its Dropped count and its lines per minute;
// the booth row shows the producer queue count. Feeds without a writer (audio description, catch-me-up, half-time, ticker) say Planned, never 0 lines as if live.
const post = (page: import('@playwright/test').Page, msg: Record<string, unknown>) =>
  page.evaluate((m) => {
    const frame = document.querySelector('#v-broadcast iframe') as HTMLIFrameElement;
    frame.contentWindow!.postMessage({ src: 'matchcast-shell', ...m }, '*');
  }, msg);
const line = (feed: string, publication_id: string, text: string, match_time_ms: number) => ({
  feed, publication_id, lang: 'en', text, source_event_ids: ['E12'], claim_ids: [], match_time_ms, aired_at: '2026-10-25T14:00:00Z', repair_count: 0,
});

test('six-up: counts, lines per minute over the last 5 match minutes, waiting state, Planned feeds, booth queue', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await expect(f.locator('#mc-feeds')).toBeVisible({ timeout: 240_000 });
  const card = (k: string) => f.locator('[data-feed="' + k + '"]');

  // a feed with a writer and no line yet is waiting, never blank
  for (const k of ['casual', 'analyst']) {
    await expect(card(k)).toContainText('waiting for a moment');
    await expect(card(k)).toContainText('Verified 0');
    await expect(card(k)).toContainText('Dropped 0');
    await expect(card(k)).toContainText('0.0 lines/min');
    await expect(card(k)).not.toContainText('Planned');
  }
  // the four feeds with no writer are Planned, not live-looking zeros
  for (const k of ['audio_description', 'catch_me_up', 'half_time', 'ticker']) {
    await expect(card(k)).toContainText('Planned');
    await expect(card(k)).not.toContainText('Verified');
    await expect(card(k)).not.toContainText('lines/min');
  }
  // the booth row is the producer queue count
  await expect(f.locator('#mc-booth')).toContainText('0 waiting');
  await post(page, { type: 'queue', mode: 'producer', items: [{ id: 'q1', minute: 12, text: 'Booth line one.', waiting_ms: 1000 }, { id: 'q2', minute: 13, text: 'Booth line two.', waiting_ms: 500 }] });
  await expect(f.locator('#mc-booth')).toContainText('2 waiting for approval');

  // lines per minute: aired lines in the last 5 match minutes (match_time_ms of the newest line seen, minus 5 min, exclusive)
  await post(page, { type: 'feed-air', record: line('casual', 'P0', 'An old line.', 600000) });
  await post(page, { type: 'feed-air', record: line('casual', 'P1', 'Second line.', 1600000) });
  await post(page, { type: 'feed-air', record: line('casual', 'P2', 'Third line.', 1700000) });
  await post(page, { type: 'feed-air', record: line('casual', 'P3', 'Newest <b>line</b> & more.', 1860000) });
  await expect(card('casual')).toContainText('Verified 4');
  await expect(card('casual')).toContainText('0.6 lines/min');
  await expect(card('casual')).toContainText('last 5 match min');
  await expect(card('casual')).not.toContainText('waiting for a moment');
  await expect(card('casual')).toContainText('Newest <b>line</b> & more.');   // escaped: shown as text, not markup
  expect(await card('casual').locator('b').count()).toBe(1);   // only the label is bold
  // a window that moves on: a newer line on another feed ages casual's lines out
  await post(page, { type: 'feed-air', record: line('analyst', 'S1', 'Analyst later.', 2400000) });
  await expect(card('analyst')).toContainText('0.2 lines/min');
  await expect(card('casual')).toContainText('0.0 lines/min');
  await expect(card('casual')).toContainText('Verified 4');

  // drops are counted per feed, once by audit id, and the line text is never shown
  const drop = { feed: 'casual', publication_id: 'P9', source_event_ids: ['E13'], reason_code: 'number_mismatch', repair_count: 1, audit_id: 'A1', text: 'SECRET DROPPED TEXT' };
  await post(page, { type: 'feed-drop', record: drop });
  await post(page, { type: 'feed-drop', record: drop });
  await post(page, { type: 'feed-drop', record: { ...drop, audit_id: 'A2' } });
  await expect(card('casual')).toContainText('Dropped 2');
  await expect(card('analyst')).toContainText('Dropped 0');
  await expect(f.locator('#mc-feeds')).not.toContainText('SECRET DROPPED TEXT');

  // Kill and Resume still work on a six-up card
  await card('casual').locator('[data-kill]').click();
  await expect(card('casual')).toContainText('Killed on this desk');
  await expect(card('casual')).toContainText('Verified 4');
  await card('casual').locator('[data-kill]').click();
  await expect(card('casual')).not.toContainText('Killed');
});

test('six-up in a 320 px desk: two columns, no sideways scroll, nothing under 12 px', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 640, height: 844 });
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await expect(f.locator('#mc-feeds')).toBeVisible({ timeout: 240_000 });
  await post(page, { type: 'feed-air', record: line('casual', 'P1', 'A fairly long casual line that must be cut to one line rather than push the page sideways.', 1860000) });
  await post(page, { type: 'queue', mode: 'producer', items: [] });
  await expect(f.locator('[data-feed="casual"]')).toContainText('Verified 1');
  // the desk is min(360 px, 50% of the pane) wide, so a 640 px pane gives the 320 px desk; at 480 px and below the phone layout hides the desk body by design (desk-panels.js)
  const g = await f.evaluate(() => {
    const box = document.getElementById('mc-feeds')!;
    const lefts = new Set([...box.querySelectorAll('#mc-feed-list > li')].map((li) => Math.round(li.getBoundingClientRect().left)));
    const small: string[] = [];
    for (const el of box.querySelectorAll('*')) {
      const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join('');
      if (t && parseFloat(getComputedStyle(el).fontSize) < 12) small.push(el.tagName + ' ' + t.slice(0, 20));
    }
    return { w: document.getElementById('mc-desk')!.getBoundingClientRect().width, cols: lefts.size, small, fits: box.scrollWidth <= box.clientWidth + 1, page: document.documentElement.scrollWidth <= innerWidth };
  });
  expect(g.w).toBeLessThanOrEqual(321);
  expect(g.cols).toBe(2);
  expect(g.small).toEqual([]);
  expect(g.fits).toBe(true);
  expect(g.page).toBe(true);
});
