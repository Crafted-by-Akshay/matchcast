import { test, expect } from './fixtures';
import { openShell, viewFrame } from './helpers';

// AB#497 (CREW-6.3, the desk side of the six derived feeds). The desk monitors the six English feeds: what each has aired, the lines the Verifier dropped with the reason, and a kill per feed.
// The record shapes are the Feeds lane's proposal for matchcast.onair/1 (AB#498, not merged yet). Derived lines never enter the producer queue.
const post = (page: import('@playwright/test').Page, msg: Record<string, unknown>) =>
  page.evaluate((m) => {
    const frame = document.querySelector('#v-broadcast iframe') as HTMLIFrameElement;
    frame.contentWindow!.postMessage({ src: 'matchcast-shell', ...m }, '*');
  }, msg);

const casual = (publication_id: string, text: string) => ({
  feed: 'casual', publication_id, lang: 'en', text, source_event_ids: ['E12'], claim_ids: [], match_time_ms: 1860000, aired_at: '2026-10-25T14:00:00Z', repair_count: 0,
});

test('the desk monitors the six feeds: what each aired, the Verifier drops with their reason, and a kill per feed', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await expect(f.locator('#mc-feeds')).toBeVisible({ timeout: 240_000 });
  await expect(f.locator('#mc-feeds')).toContainText('simulated');
  await expect(f.locator('#mc-feed-list li')).toHaveCount(6);
  await expect(f.locator('[data-feed="casual"]')).toContainText('0 aired');
  await expect(f.locator('#mc-drop-list')).toContainText('Nothing dropped yet.');

  await post(page, { type: 'feed-air', record: casual('P1', 'Northgate FC press high up the pitch.') });
  await expect(f.locator('[data-feed="casual"]')).toContainText('1 aired');
  await expect(f.locator('[data-feed="casual"]')).toContainText('Northgate FC press high up the pitch.');
  await post(page, { type: 'feed-air', record: casual('P1', 'Northgate FC press high up the pitch.') });   // the same publication twice counts once
  await post(page, { type: 'feed-air', record: { ...casual('S0', 'Sentinel for analyst.'), feed: 'analyst' } });   // a line on another feed proves the handler ran after the duplicate
  await expect(f.locator('[data-feed="analyst"]')).toContainText('1 aired');
  await expect(f.locator('[data-feed="casual"]')).toContainText('1 aired');

  await post(page, { type: 'feed-drop', record: { feed: 'ticker', publication_id: 'P2', source_event_ids: ['E13'], reason_code: 'number_mismatch', repair_count: 1, audit_id: 'A9' } });
  await expect(f.locator('#mc-drop-list')).toContainText('Ticker · number_mismatch');
  // a reconnect replays the drop it already showed: the same audit id shows once
  await post(page, { type: 'feed-drop', record: { feed: 'ticker', publication_id: 'P2', source_event_ids: ['E13'], reason_code: 'number_mismatch', repair_count: 1, audit_id: 'A9' } });
  await post(page, { type: 'feed-air', record: { ...casual('S2', 'Sentinel after the replayed drop.'), feed: 'analyst' } });
  await expect(f.locator('[data-feed="analyst"]')).toContainText('2 aired');
  await expect(f.locator('#mc-drop-list li', { hasText: 'Ticker · number_mismatch' })).toHaveCount(1);

  await expect(f.locator('#mc-pq')).not.toContainText('Northgate FC press');   // derived lines never reach the producer queue

  await f.locator('[data-feed="casual"] [data-kill]').click();
  await expect(f.locator('[data-feed="casual"]')).toContainText('Killed');
  await post(page, { type: 'feed-air', record: casual('P3', 'A line that must not count while the feed is killed.') });
  await post(page, { type: 'feed-air', record: { ...casual('S1', 'Sentinel for analyst again.'), feed: 'analyst' } });
  await expect(f.locator('[data-feed="analyst"]')).toContainText('3 aired');
  await expect(f.locator('[data-feed="casual"]')).toContainText('1 aired');
  await f.locator('[data-feed="casual"] [data-kill]').click();
  await expect(f.locator('[data-feed="casual"]')).not.toContainText('Killed');
});

test('the desk keys its dedupe by match: the same ids from another match both count', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await expect(f.locator('#mc-feeds')).toBeVisible({ timeout: 240_000 });
  const streamA = { session_id: 'match-a', match_id: 'm-a' };
  const streamB = { session_id: 'match-b', match_id: 'm-b' };
  await post(page, { type: 'feed-air', record: { ...casual('P1', 'Match A line.'), stream: streamA } });
  await post(page, { type: 'feed-air', record: { ...casual('P1', 'Match B line.'), stream: streamB } });
  await expect(f.locator('[data-feed="casual"]')).toContainText('2 aired');   // audit and publication ids restart per match
  const drop = { feed: 'ticker', publication_id: 'P2', source_event_ids: ['E13'], reason_code: 'number_mismatch', repair_count: 1, audit_id: 'A9' };
  await post(page, { type: 'feed-drop', record: { ...drop, stream: streamA } });
  await post(page, { type: 'feed-drop', record: { ...drop, stream: streamB } });
  await expect(f.locator('#mc-drop-list li', { hasText: 'Ticker · number_mismatch' })).toHaveCount(2);
});

test('a fixture behind ?feeds=fixture fills the monitor without the orchestration thread', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'broadcast', '?seed=2026&feeds=fixture');
  const f = await viewFrame(page, 'broadcast');
  await expect(f.locator('#mc-feeds')).toContainText('fixture feed', { timeout: 240_000 });
  await expect(f.locator('#mc-feed-list')).toContainText('fixture line', { timeout: 60_000 });   // the first tick lands after 12 s
});
