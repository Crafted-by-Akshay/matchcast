import { test, expect } from './fixtures';
import { createServer } from 'node:http';

// ADR-0019 (Phases 2 and 4): the Broadcast Copilot asks the api with surface "broadcast" and shows its ranked picks; the production desk strip shows the agents' trace for the lines on air, newest first.
// Watch shows a focus suggestion from Broadcast; "Go to it" moves the camera to that player, and the test checks the button says whether it did.
declare const LV: any;

const PICKS: Record<string, any> = {
  highlights: { highlights: [{ event_id: 'e10', minute: 12, reason: "Goal by Ivan Ruiz for Northgate FC at 12'. A moment worth airing now." }] },
  focus: { focus: { target: 'player', camera: 'player', player_id: 'h9', player: 'Ivan Ruiz', event_id: 'e10', reason: "Goal by Ivan Ruiz for Northgate FC at 12'. A moment worth airing now." } },
  plan: { plan: ['Northgate FC lead: watch for them to drop deeper.', 'Camera: Quiet play. Hold a wide shot of the ball and the shape.'] },
};

test('the Copilot shows picks from the api, and Watch shows a focus suggestion', async ({ page }) => {
  const asks: any[] = [];
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') {
        let b = ''; q.on('data', (c) => (b += c));
        q.on('end', () => {
          if (/\/ask/.test(q.url!)) {
            const body = JSON.parse(b); asks.push(body);
            const pick = body.question.includes('highlights') ? 'highlights' : body.question.includes('camera') ? 'focus' : 'plan';
            r.writeHead(200, { 'Content-Type': 'application/json', ...cors });
            return r.end(JSON.stringify({ answer: 'picks', intent: pick, abstained: false, citations: [{ type: 'event', id: 'e10' }], mode: 'rules', lang: 'en', broadcast: PICKS[pick] }));
          }
          r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}');
        });
        return;
      }
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"live"}\n\n');
    }).listen(0, () => resolve(s));
  });
  try {
    const api = 'http://127.0.0.1:' + (server.address() as any).port;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
    await page.evaluate(() => { LV.persona('club:thr', 'en'); LV.begin('k1', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }); });

    const desk = page.frameLocator('#v-broadcast iframe');
    await expect(desk.locator('#mc-desk')).toBeVisible({ timeout: 60_000 });
    await expect(page.frameLocator('#v-watch iframe').locator('#mc-focus'), 'no focus pill before Broadcast suggests one').toBeHidden();
    await desk.locator('[data-cop="highlights"]').click();
    await expect(desk.locator('#mc-cop-out')).toContainText('Ivan Ruiz', { timeout: 20_000 });
    expect(asks[0].surface, 'the Copilot asks with the broadcast surface').toBe('broadcast');

    await desk.locator('[data-cop="plan"]').click();
    await expect(desk.locator('#mc-cop-out')).toContainText('drop deeper', { timeout: 20_000 });
    expect(asks.at(-1).surface).toBe('broadcast');

    // Hide collapses the desk to its header and Show brings the body back
    const open = await desk.locator('#mc-desk').boundingBox();
    await desk.locator('#mc-desk-hide').click();
    await expect(desk.locator('#mc-desk-body')).toBeHidden();
    expect((await desk.locator('#mc-desk').boundingBox())!.height, 'Hide leaves the header and the replay row, and gives back the body').toBeLessThan(open!.height - 60);
    await desk.locator('#mc-desk-hide').click();
    await expect(desk.locator('#mc-desk-body')).toBeVisible();

    await desk.locator('[data-cop="focus"]').click();
    await expect(desk.locator('#mc-cop-go')).toBeVisible({ timeout: 20_000 });
    await desk.locator('#mc-cop-go').click();
    const watch = page.frameLocator('#v-watch iframe');
    await expect(watch.locator('#mc-focus')).toBeVisible({ timeout: 60_000 });
    await expect(watch.locator('#mc-focus-t')).toContainText('Ivan Ruiz');
    await expect(watch.locator('#mc-focus-go')).toBeEnabled();
    await watch.locator('#mc-focus-go').click();
    await expect(watch.locator('#mc-focus-go')).toHaveText(/Camera (on|not moved)/);
  } finally {
    server.close();
  }
});

test('the production strip shows which agents acted on the last aired line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/index.html#broadcast', { waitUntil: 'domcontentloaded' });
  const desk = page.frameLocator('#v-broadcast iframe');
  await expect(desk.locator('#mc-desk')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => {
    const frame = document.querySelector('#v-broadcast iframe') as HTMLIFrameElement;
    frame.contentWindow!.postMessage({ src: 'matchcast-shell', type: 'air', line: {
      id: 'L1', minute: 12, text: 'Goal for Northgate FC.', verdict: 'verified', alert: null, tr: null,
      steps: [{ agent: 'producer', step: 'pick', mode: 'rules' }, { agent: 'analyst', step: 'claim', mode: 'rules' }, { agent: 'narrator', step: 'draft', mode: 'model' }, { agent: 'verifier', step: 'verdict', mode: 'rules' }],
      numbers: [{ name: 'shots', value: 4 }],
    } }, '*');
  });
  await expect(desk.locator('#mc-orch')).toContainText('Goal for Northgate FC.');
  for (const agent of ['producer', 'analyst', 'narrator', 'verifier']) {
    await expect(desk.locator('#mc-orch .mcd-ch', { hasText: agent })).toBeVisible();
  }
  await expect(desk.locator('#mc-orch .mcd-ch', { hasText: 'shots 4' })).toBeVisible();
  await desk.locator('[data-lens="analyst"]').click();
  await expect(desk.locator('[data-lens="analyst"]')).toHaveAttribute('aria-pressed', 'true');
  await desk.locator('#mc-lens-more').focus();
  await expect(desk.locator('#mc-lens-more optgroup')).toHaveCount(3);
  await expect(desk.locator('#mc-lens-more option[value="metric:xg"]')).toHaveCount(1);
});

test('a plain question on the Watch view keeps the Ask request exactly as it was', async ({ page }) => {
  const asks: any[] = [];
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') {
        let b = ''; q.on('data', (c) => (b += c));
        q.on('end', () => {
          if (/\/ask/.test(q.url!)) { asks.push(JSON.parse(b)); r.writeHead(200, { 'Content-Type': 'application/json', ...cors }); return r.end(JSON.stringify({ answer: 'It is 1-0.', intent: 'score', abstained: false, citations: [], mode: 'rules', lang: 'en' })); }
          r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}');
        });
        return;
      }
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"live"}\n\n');
    }).listen(0, () => resolve(s));
  });
  try {
    const api = 'http://127.0.0.1:' + (server.address() as any).port;
    await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
    await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
    await page.evaluate(() => { LV.persona('club:thr', 'en'); LV.begin('k1', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }); });
    await page.evaluate(() => LV.ask('How many shots?'));
    expect(Object.keys(asks[0]).sort()).toEqual(['lang', 'persona', 'question', 'session_id']);
  } finally {
    server.close();
  }
});
