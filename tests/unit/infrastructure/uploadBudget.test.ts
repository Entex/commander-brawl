import { UploadBudget, type SendSample } from '@commander-brawl/infrastructure/browser';
import { describe, expect, it } from 'vitest';

const fine = (sentBps: number): SendSample => ({ sentBps, fps: 24, limitation: null });
const squeezed = (sentBps: number, fps = 4): SendSample => ({ sentBps, fps, limitation: 'bandwidth' });

function table(now = { t: 0 }) {
  const budget = new UploadBudget({ playerBps: 3_000_000, watcherBps: 1_200_000, now: () => now.t });
  const players = [{}, {}, {}];
  const watcher = {};
  for (const link of players) budget.join(link, false);
  budget.join(watcher, true);
  return { budget, players, watcher, now };
}

describe('sharing out what a player sends across their links', () => {
  it('gives each player the most a player gets, and a watcher less: smaller, fewer frames', () => {
    const { budget, players, watcher } = table();
    expect(budget.planFor(players[0]!)).toEqual({
      maxBitrateBps: 3_000_000,
      maxLongSide: 1920,
      maxFramerate: undefined,
    });
    expect(budget.planFor(watcher)).toEqual({ maxBitrateBps: 1_200_000, maxLongSide: 1280, maxFramerate: 20 });
  });

  it("shares out what gets through when there isn't room for it all, a player's share bigger than a watcher's", () => {
    const { budget, players, watcher } = table();
    // About 5 Mbps getting through in all, one stream held back by bandwidth.
    budget.report(players[0]!, fine(1_500_000));
    budget.report(players[1]!, fine(1_400_000));
    budget.report(watcher, fine(600_000));
    budget.report(players[2]!, squeezed(1_500_000, 18));
    const total = [...players, watcher].reduce<number>((sum, link) => sum + budget.planFor(link).maxBitrateBps, 0);
    expect(total).toBeGreaterThan(4_400_000);
    expect(total).toBeLessThan(4_600_000);
    expect(budget.planFor(players[0]!).maxBitrateBps).toBeGreaterThan(budget.planFor(watcher).maxBitrateBps * 2);
  });

  it('grows back when nothing has been held back for a while', () => {
    const { budget, players, now } = table();
    for (const link of players) budget.report(link, squeezed(1_000_000, 18));
    const tight = budget.planFor(players[0]!).maxBitrateBps;
    const calm = () => {
      now.t += 25_000;
      for (const link of players) budget.report(link, fine(1_000_000));
    };
    calm();
    expect(budget.planFor(players[0]!).maxBitrateBps).toBeGreaterThan(tight);
    // Back to full, given time.
    for (let i = 0; i < 20; i++) calm();
    expect(budget.planFor(players[0]!).maxBitrateBps).toBe(3_000_000);
  });

  it('makes the picture smaller, rather than few frames, when a link keeps struggling; and bigger again after', () => {
    const { budget, players } = table();
    const link = players[0]!;
    for (let i = 0; i < 3; i++) budget.report(link, squeezed(800_000, 3));
    expect(budget.planFor(link).maxLongSide).toBe(1280);
    for (let i = 0; i < 3; i++) budget.report(link, { sentBps: 800_000, fps: 4, limitation: 'cpu' });
    expect(budget.planFor(link).maxLongSide).toBe(960);
    for (let i = 0; i < 10; i++) budget.report(link, fine(800_000));
    expect(budget.planFor(link).maxLongSide).toBe(1280);
  });

  it('sends as sharp as the player chose: a smaller picture, and less', () => {
    const { budget, players, watcher } = table();
    budget.setSentHeight(720);
    expect(budget.planFor(players[0]!)).toEqual({
      maxBitrateBps: 1_800_000,
      maxLongSide: 1280,
      maxFramerate: undefined,
    });
    expect(budget.planFor(watcher)).toMatchObject({ maxLongSide: 1280 });
    budget.setSentHeight(480);
    expect(budget.planFor(players[0]!)).toMatchObject({ maxLongSide: 854, maxBitrateBps: 1_050_000 });
    // A watcher never more than a player.
    expect(budget.planFor(watcher)).toMatchObject({ maxLongSide: 854, maxBitrateBps: 1_050_000 });
  });

  it('forgets a link that stops, and an old report', () => {
    const { budget, players, now } = table();
    budget.leave(players[0]!);
    expect(budget.planFor(players[0]!).maxBitrateBps).toBe(3_000_000);
    // A link that last said it was held back long ago (its camera went off) doesn't hold the others back.
    budget.report(players[1]!, squeezed(1_000_000, 18));
    now.t += 60_000;
    for (let i = 0; i < 20; i++) {
      now.t += 25_000;
      budget.report(players[2]!, fine(1_000_000));
    }
    expect(budget.planFor(players[2]!).maxBitrateBps).toBe(3_000_000);
  });
});
