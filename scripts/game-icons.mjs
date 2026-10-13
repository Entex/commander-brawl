// Copies the game-icons.net icons the app uses into src/desktop/src/renderer/icons/gameIcons.ts, so the app
// carries only those (a few dozen, not all 4,000). Add a name to ICONS and run: node scripts/game-icons.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ICONS = [
  // Toolbar and menus
  'anticlockwise-rotation',
  'card-random',
  'scroll-unfurled',
  'abacus',
  'wax-seal',
  'card-draw',
  'tied-scroll',
  'photo-camera',
  'exit-door',
  'cycle',
  'clapperboard',
  'scales',
  'spyglass',
  'castle',
  'open-gate',
  'all-seeing-eye',
  'spell-book',
  'gears',
  'open-book',
  'padlock',
  'tv',
  'network-bars',
  // The turn
  'hand',
  'rolling-dices',
  'next-button',
  'hourglass',
  'knight-banner',
  'sunrise',
  'card-pickup',
  'magic-swirl',
  'crossed-swords',
  'sword-brandish',
  'checked-shield',
  'bloody-sword',
  'night-sleep',
  // Dice, coins, picks
  'dice-twenty-faces-twenty',
  'coinflip',
  'convergence-target',
  // Life and counters
  'hearts',
  'poison-bottle',
  'electric',
  'star-formation',
  'radioactive',
  'speedometer',
  'two-coins',
  'tombstone',
  'mailed-fist',
  // Markers
  'crown',
  'dungeon-gate',
  'ring',
  'sun',
  'moon',
  'lightning-storm',
  'torch',
  'angel-wings',
  // Cards on the battlefield, combos, variants, the end of a game
  'meeple-group',
  'card-play',
  'skull-bolt',
  'magic-portal',
  'daemon-skull',
  'trophy-cup',
  'laurels-trophy',
  'crossed-sabres',
  'hazard-sign',
];

const root = resolve(import.meta.dirname, '..');
const set = JSON.parse(await readFile(resolve(root, 'node_modules/@iconify-json/game-icons/icons.json'), 'utf8'));
const lines = ICONS.map((name) => {
  const icon = set.icons[name];
  if (!icon) throw new Error(`No game icon called ${name}`);
  return `  '${name}': ${JSON.stringify(icon.body)},`;
});
await writeFile(
  resolve(root, 'src/desktop/src/renderer/icons/gameIcons.ts'),
  `// Icons from game-icons.net by Lorc, Delapouite and contributors, under CC BY 3.0
// (https://creativecommons.org/licenses/by/3.0/). Made by scripts/game-icons.mjs: don't edit by hand.

/** SVG contents (512 by 512, filled with the current color) of the game icons the app uses. */
export const GAME_ICONS = {
${lines.join('\n')}
} as const;

export type GameIconName = keyof typeof GAME_ICONS;
`,
);
console.log(`${ICONS.length} game icons`);
