import {
  DUNGEONS,
  DUNGEON_IDS,
  applyEvent,
  canVenture,
  newGame,
  toGameEvent,
  type GameEvent,
  type GameState,
} from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const play = (...events: GameEvent[]): GameState =>
  events.reduce((state, event) => applyEvent(state, event), newGame());
const venture = (room: number, dungeon: 'undercity' | 'lost-mine' | 'mad-mage' | 'tomb' = 'undercity'): GameEvent => ({
  type: 'ventured',
  seat: 1,
  to: { dungeon, room },
});

describe('the dungeons', () => {
  it.each(DUNGEON_IDS)(
    '%s: every room can be reached from the first, and every way ends in the one last room',
    (id) => {
      const { rooms } = DUNGEONS[id];
      const reached = new Set([0]);
      for (const [index, room] of rooms.entries()) {
        for (const next of room.next) {
          // Rooms only lead further down.
          expect(next).toBeGreaterThan(index);
          expect(next).toBeLessThan(rooms.length);
          if (reached.has(index)) reached.add(next);
        }
      }
      expect(reached.size).toBe(rooms.length);
      expect(rooms.filter((room) => room.next.length === 0)).toEqual([rooms.at(-1)]);
    },
  );
});

describe('the monarch and the initiative', () => {
  it('have one holder at a time, or none', () => {
    let game = play({ type: 'monarch-set', seat: 2 }, { type: 'monarch-set', seat: 0 });
    expect(game.monarch).toBe(0);
    game = applyEvent(game, { type: 'monarch-set', seat: null });
    expect(game.monarch).toBeNull();
  });

  it('taking the initiative ventures into Undercity, unless already in a dungeon', () => {
    let game = play({ type: 'initiative-taken', seat: 1 });
    expect(game.initiative).toBe(1);
    expect(game.seats[1]!.dungeon).toEqual({ dungeon: 'undercity', room: 0 });
    // Taking it again later: the player chooses the next room themselves.
    game = applyEvent(game, { type: 'initiative-taken', seat: 3 });
    game = applyEvent(game, { type: 'initiative-taken', seat: 1 });
    expect(game.seats[1]!.dungeon).toEqual({ dungeon: 'undercity', room: 0 });
  });
});

describe('venturing', () => {
  it('goes room by room, only where the room leads, and counts a finished dungeon', () => {
    let game = play(venture(0, 'tomb'));
    // Trapped Entry leads to Veils of Fear or the Oubliette, not straight to the Cradle.
    expect(applyEvent(game, venture(4, 'tomb'))).toBe(game);
    game = applyEvent(game, venture(3, 'tomb'));
    expect(game.seats[1]!.dungeon?.room).toBe(3);
    game = applyEvent(game, venture(4, 'tomb'));
    expect(game.seats[1]).toMatchObject({ dungeon: { dungeon: 'tomb', room: 4 }, completedDungeons: 1 });
    // Done: the next venture enters a dungeon again, any of them.
    expect(canVenture({ dungeon: 'tomb', room: 4 }, { dungeon: 'mad-mage', room: 0 })).toBe(true);
    game = applyEvent(game, venture(0, 'mad-mage'));
    expect(game.seats[1]).toMatchObject({ dungeon: { dungeon: 'mad-mage', room: 0 }, completedDungeons: 1 });
  });

  it("can't switch dungeons halfway", () => {
    const game = play(venture(0, 'lost-mine'));
    expect(applyEvent(game, venture(0, 'undercity'))).toBe(game);
  });
});

describe('the other markers', () => {
  it('the Ring, the city’s blessing, day and night', () => {
    const game = play(
      { type: 'ring-tempted', seat: 0, amount: 1 },
      { type: 'ring-tempted', seat: 0, amount: 1 },
      { type: 'ring-tempted', seat: 2, amount: -1 },
      { type: 'citys-blessing-set', seat: 3, has: true },
      { type: 'day-night-set', value: 'night' },
    );
    expect(game.seats.map((s) => s.ringTempts)).toEqual([2, 0, 0, 0]);
    expect(game.seats[3]!.citysBlessing).toBe(true);
    expect(game.dayNight).toBe('night');
  });

  it('the storm count is for this turn only', () => {
    let game = play({ type: 'turn-order-set', order: [0, 1] }, { type: 'storm-changed', amount: 3 });
    expect(game.storm).toBe(3);
    game = applyEvent(game, { type: 'storm-changed', amount: -5 });
    expect(game.storm).toBe(0);
    game = applyEvent(game, { type: 'storm-changed', amount: 2 });
    expect(applyEvent(game, { type: 'turn-passed', from: 0 }).storm).toBe(0);
  });

  it('all start over with a new game', () => {
    const game = play(
      { type: 'monarch-set', seat: 1 },
      { type: 'initiative-taken', seat: 1 },
      { type: 'ring-tempted', seat: 1, amount: 1 },
      { type: 'day-night-set', value: 'day' },
      { type: 'new-game', startingLife: 40 },
    );
    expect(game).toMatchObject({ monarch: null, initiative: null, dayNight: null, storm: 0 });
    expect(game.seats[1]).toMatchObject({ dungeon: null, ringTempts: 0, completedDungeons: 0, citysBlessing: false });
  });

  it.each([
    ['a monarch in no seat', { type: 'monarch-set', seat: 7 }],
    ['an unknown dungeon', { type: 'ventured', seat: 0, to: { dungeon: 'moria', room: 0 } }],
    ['a room that is no number', { type: 'ventured', seat: 0, to: { dungeon: 'tomb', room: 'cradle' } }],
    ['dusk', { type: 'day-night-set', value: 'dusk' }],
    ['no storm', { type: 'storm-changed', amount: 0 }],
    ['half a blessing', { type: 'citys-blessing-set', seat: 0, has: 'yes' }],
  ])('refuses %s', (_, raw) => {
    expect(toGameEvent(raw)).toBeNull();
  });
});
