import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import { test, expect } from './fixtures';
import { openShell } from './helpers';

// EXP-4: every Watch event type we send is a valid contract event (packages/contracts schema v1.1), so the server Verifier sees the whole log.
declare const LV: any;
const schema = JSON.parse(readFileSync(resolve(__dirname, '../../packages/contracts/matchcast_contracts/schemas/v1.json'), 'utf8'));
const validate = new Ajv({ strict: false, allErrors: true }).compile({ ...schema, oneOf: undefined, $ref: '#/definitions/EventEnvelope' });

const KEY = { tenant_id: 'demo', session_id: 's1', match_id: 'm1' };
const SAMPLES: Record<string, any> = {
  shot: { minute: 13, type: 'shot', team: 'Harbour United', player: 'A One', x: 90, y: 30, xg: 0.2, kind: 'open play' },
  goal: { minute: 12.3, type: 'goal', team: 'Harbour United', player: 'A One', ownGoal: false },   // Watch's goals have no x or y
  shot_save: { minute: 13.1, type: 'shot', team: 'Harbour United', player: 'A One', x: 88, y: 30, xg: 0.04, kind: 'open play', fate: 'save' },
  shot_miss: { minute: 13.2, type: 'shot', team: 'Harbour United', player: 'A One', x: 94, y: 33, xg: 0.45, kind: 'open play', fate: 'miss' },
  shot_goal: { minute: 13.3, type: 'shot', team: 'Harbour United', player: 'A One', x: 94, y: 33, xg: 0.05, kind: 'open play', fate: 'goal' },
  pass: { minute: 14, type: 'pass', team: 'Harbour United', player: 'A One', to: 'B Two', x0: 40.1, y0: 20, x1: 55, y1: 22.5 },
  foul: { minute: 15, type: 'foul', team: 'Harbour United', player: 'A One', on: 'C Three', x: 30, y: 10, kind: 'tackle' },
  yellow_card: { minute: 15, type: 'yellow_card', team: 'Harbour United', player: 'A One', reason: 'a late tackle' },
  red_card: { minute: 70, type: 'red_card', team: 'Harbour United', player: 'A One', reason: 'serious foul play' },
  second_yellow: { minute: 71, type: 'red_card', team: 'Harbour United', player: 'A One', reason: 'second yellow card' },
  turnover: { minute: 16, type: 'turnover', team: 'Harbour United', player: 'A One', from: 'C Three', x: 40, y: 30 },
};

test('events: each event type the shell sends validates against the contract; unsupported ones are skipped', async ({ page }) => {
  await openShell(page, 'agents');
  const out = await page.evaluate(([samples, key]) => {
    LV.begin('k', { teams: ['Harbour United', 'Travel Town'], players: [{ name: 'A One', team: 'Harbour United' }, { name: 'B Two', team: 'Harbour United' }, { name: 'C Three', team: 'Travel Town' }] });
    const r: Record<string, any> = {};
    let n = 0;
    for (const [k, ev] of Object.entries(samples as Record<string, any>)) r[k] = LV.toPacket(ev, key, ++n, new Date().toISOString());
    r.tackle = LV.toPacket({ minute: 1, type: 'slide_tackle', team: 'Harbour United', player: 'A One' }, key, 99, new Date().toISOString());
    r.nopos = LV.toPacket({ minute: 1, type: 'pass', team: 'Harbour United', player: 'A One', to: 'B Two' }, key, 98, new Date().toISOString());
    return r;
  }, [SAMPLES, KEY] as const);
  for (const k of Object.keys(SAMPLES)) {
    expect(out[k], k + ' should be sent').not.toBeNull();
    const ok = validate(out[k]);
    expect(ok, k + ': ' + JSON.stringify(validate.errors)).toBe(true);
  }
  expect(out.goal.payload.position, 'a goal takes the position of the shot before it').toEqual({ x: 90, y: 30, z: 0 });
  expect(out.shot_save.payload.on_target, 'a saved shot was on target even at low xG').toBe(true);
  expect(out.shot_miss.payload.on_target, 'a miss with high xG was off target').toBe(false);
  expect(out.shot_goal.payload.on_target).toBe(true);
  expect(out.second_yellow.payload.colour).toBe('second_yellow');
  expect(out.red_card.payload.colour).toBe('red');
  expect(out.turnover.payload).toMatchObject({ from_team_id: 'travel-town', to_team_id: 'harbour-united', cause: 'loose_ball' });
  expect(out.tackle, 'slide tackles have no target player in Watch, so they are not sent').toBeNull();
  expect(out.nopos, 'a pass without positions is not sent').toBeNull();
});
