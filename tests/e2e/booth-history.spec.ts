import { test, expect } from './fixtures';
import { openShell } from './helpers';

// Experience lane, booth: a national fixture opens with the real head to head from the results file (ADR-0020).
declare const CM: any;

const h2h = {
  played: 110, home_wins: 41, draws: 26, away_wins: 43,
  last_meeting: { date: '2025-03-25', score: '4-1', competition: 'International competition' },
};

test('the booth opens a national fixture with the real head to head', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  const texts = await page.evaluate((h) => {
    CM.reset('booth', { home: 'Argentina', away: 'Brazil', hk: 'ARG', ak: 'BRA', history: { h2h: h } });
    return CM.view().map((l: any) => l.text as string);
  }, h2h);
  expect(texts).toContain(
    'Real results: 110 meetings, Argentina 41 wins, 26 draws, Brazil 43 wins. Last meeting: 2025-03-25, Argentina 4-1 Brazil (International competition).',
  );
});

test('a fictional fixture has no head-to-head line', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  const texts = await page.evaluate(() => {
    CM.reset('booth', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    return CM.view().map((l: any) => l.text as string);
  });
  expect(texts.join(' ')).not.toContain('Real results');
});
