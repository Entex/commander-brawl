/**
 * Markers that belong to one player or the whole table: the monarch, the initiative and dungeons, the Ring,
 * day and night, the city's blessing, the storm count.
 */

export interface DungeonRoom {
  readonly name: string;
  /** What the room does, as printed. */
  readonly effect: string;
  /** The rooms it leads to, by position in the dungeon. None for the last room. */
  readonly next: readonly number[];
}

export interface Dungeon {
  readonly name: string;
  readonly rooms: readonly DungeonRoom[];
}

export type DungeonId = 'lost-mine' | 'mad-mage' | 'tomb' | 'undercity';

/** The dungeons of paper Magic, room by room as printed (Scryfall's oracle text). */
export const DUNGEONS: Readonly<Record<DungeonId, Dungeon>> = {
  'lost-mine': {
    name: 'Lost Mine of Phandelver',
    rooms: [
      { name: 'Cave Entrance', effect: 'Scry 1.', next: [1, 2] },
      { name: 'Goblin Lair', effect: 'Create a 1/1 red Goblin creature token.', next: [3, 4] },
      { name: 'Mine Tunnels', effect: 'Create a Treasure token.', next: [4, 5] },
      { name: 'Storeroom', effect: 'Put a +1/+1 counter on target creature.', next: [6] },
      { name: 'Dark Pool', effect: 'Each opponent loses 1 life and you gain 1 life.', next: [6] },
      { name: 'Fungi Cavern', effect: 'Target creature gets -4/-0 until your next turn.', next: [6] },
      { name: 'Temple of Dumathoin', effect: 'Draw a card.', next: [] },
    ],
  },
  'mad-mage': {
    name: 'Dungeon of the Mad Mage',
    rooms: [
      { name: 'Yawning Portal', effect: 'You gain 1 life.', next: [1] },
      { name: 'Dungeon Level', effect: 'Scry 1.', next: [2, 3] },
      { name: 'Goblin Bazaar', effect: 'Create a Treasure token.', next: [4] },
      { name: 'Twisted Caverns', effect: "Target creature can't attack until your next turn.", next: [4] },
      { name: 'Lost Level', effect: 'Scry 2.', next: [5, 6] },
      { name: 'Runestone Caverns', effect: 'Exile the top two cards of your library. You may play them.', next: [7] },
      { name: "Muiral's Graveyard", effect: 'Create two 1/1 black Skeleton creature tokens.', next: [7] },
      { name: 'Deep Mines', effect: 'Scry 3.', next: [8] },
      {
        name: "Mad Wizard's Lair",
        effect: 'Draw three cards and reveal them. You may cast one of them without paying its mana cost.',
        next: [],
      },
    ],
  },
  tomb: {
    name: 'Tomb of Annihilation',
    rooms: [
      { name: 'Trapped Entry', effect: 'Each player loses 1 life.', next: [1, 3] },
      { name: 'Veils of Fear', effect: 'Each player loses 2 life unless they discard a card.', next: [2] },
      {
        name: 'Sandfall Cell',
        effect: 'Each player loses 2 life unless they sacrifice a creature, artifact, or land of their choice.',
        next: [4],
      },
      { name: 'Oubliette', effect: 'Discard a card and sacrifice a creature, an artifact, and a land.', next: [4] },
      {
        name: 'Cradle of the Death God',
        effect: 'Create The Atropal, a legendary 4/4 black God Horror creature token with deathtouch.',
        next: [],
      },
    ],
  },
  undercity: {
    name: 'Undercity',
    rooms: [
      {
        name: 'Secret Entrance',
        effect: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
        next: [1, 2],
      },
      { name: 'Forge', effect: 'Put two +1/+1 counters on target creature.', next: [3, 4] },
      { name: 'Lost Well', effect: 'Scry 2.', next: [4, 5] },
      { name: 'Trap!', effect: 'Target player loses 5 life.', next: [6] },
      { name: 'Arena', effect: 'Goad target creature.', next: [6, 7] },
      { name: 'Stash', effect: 'Create a Treasure token.', next: [7] },
      { name: 'Archives', effect: 'Draw a card.', next: [8] },
      { name: 'Catacombs', effect: 'Create a 4/1 black Skeleton creature token with menace.', next: [8] },
      {
        name: 'Throne of the Dead Three',
        effect:
          'Reveal the top ten cards of your library. Put a creature card from among them onto the battlefield with three +1/+1 counters on it. It gains hexproof until your next turn. Then shuffle.',
        next: [],
      },
    ],
  },
};

export const DUNGEON_IDS = Object.keys(DUNGEONS) as DungeonId[];

/** Where a player is in a dungeon. */
export interface DungeonPosition {
  readonly dungeon: DungeonId;
  readonly room: number;
}

export function isDungeonId(value: unknown): value is DungeonId {
  return typeof value === 'string' && value in DUNGEONS;
}

/** The player finished this dungeon: they're in its last room. */
export function isLastRoom(position: DungeonPosition): boolean {
  return DUNGEONS[position.dungeon].rooms[position.room]?.next.length === 0;
}

/**
 * Whether venturing from where the player is (null: not in a dungeon) can take them to this room. Out of a
 * dungeon, or done with one, they enter a dungeon at its first room; inside one, they go to a room this one
 * leads to.
 */
export function canVenture(from: DungeonPosition | null, to: DungeonPosition): boolean {
  if (!from || isLastRoom(from)) return to.room === 0 && DUNGEONS[to.dungeon].rooms.length > 0;
  return from.dungeon === to.dungeon && (DUNGEONS[from.dungeon].rooms[from.room]?.next.includes(to.room) ?? false);
}

export type DayNight = 'day' | 'night';

/** Times the Ring has tempted a player that give their Ring-bearer an ability; more still count for some cards. */
export const RING_ABILITIES = 4;
