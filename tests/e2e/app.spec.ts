import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DesktopApi } from '../../src/desktop/src/shared/api';
import { startFakeDeckSites, type FakeDeckSites } from '../support/fakeDeckSites';
import { startFakeScryfall, type FakeScryfall } from '../support/fakeScryfall';
import { startFakeSpellbook, type FakeSpellbook } from '../support/fakeSpellbook';

// The whole app, two copies on one computer: main process, IPC, UI and video.
// Needs a display. On a Linux machine without one, run it with `xvfb-run -a npm run test:e2e`.

const appDir = resolve(import.meta.dirname, '../../build/app');

interface Instance {
  readonly app: ElectronApplication;
  readonly page: Page;
  /** Where the app saves files, instead of asking. */
  readonly saveDir: string;
  /** The app's settings folder. Launching again with it is like reopening the app. */
  readonly userDataDir: string;
}

const running: Instance[] = [];
// Card data comes from a stand-in, so the tests never download from the real Scryfall.
let scryfall: FakeScryfall;
let deckSites: FakeDeckSites;
let spellbook: FakeSpellbook;

test.beforeAll(async () => {
  scryfall = await startFakeScryfall();
  deckSites = await startFakeDeckSites();
  spellbook = await startFakeSpellbook();
});

test.afterAll(async () => {
  await scryfall.close();
  await deckSites.close();
  await spellbook.close();
});

test.afterEach(async () => {
  for (const instance of running.splice(0)) await instance.app.close().catch(() => undefined);
});

async function launch(name: string, userDataDir?: string): Promise<Instance> {
  const saveDir = await mkdtemp(join(tmpdir(), 'cb-e2e-save-'));
  const dataDir = userDataDir ?? (await mkdtemp(join(tmpdir(), 'cb-e2e-')));
  const app = await electron.launch({
    args: [appDir, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: {
      ...process.env,
      CB_USER_DATA_DIR: dataDir,
      CB_UPNP: 'off',
      CB_LOCAL_ONLY: '1',
      CB_TABLE_PORT: '0',
      CB_PHONE_PORT: '0',
      CB_SAVE_DIR: saveDir,
      CB_SCRYFALL_API: scryfall.apiUrl,
      CB_MOXFIELD_API: deckSites.moxfieldApi,
      CB_ARCHIDEKT_API: deckSites.archidektApi,
      CB_SPELLBOOK_API: spellbook.apiUrl,
    },
  });
  const page = await app.firstWindow();
  const instance = { app, page, saveDir, userDataDir: dataDir };
  running.push(instance);
  await page.getByTestId('name').fill(name);
  await useWebcam(page);
  return instance;
}

async function useWebcam(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Set up camera' }).click();
  await page.getByRole('combobox').selectOption({ index: 1 });
  await expect(page.getByTestId('camera-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
}

/** A host with one friend at the table, both seeing each other. */
async function hostAndFriend(): Promise<{ host: Instance; friend: Instance }> {
  const host = await launch('Host');
  await host.page.getByTestId('host').click();
  const invite = await host.page.getByTestId('invite-code').inputValue();
  const friend = await launch('Friend');
  await friend.page.getByTestId('invite-input').fill(invite);
  await friend.page.getByTestId('join').click();
  await expectVideoFrom(friend.page, 'Host');
  return { host, friend };
}

/** The app downloads the cards when it starts; deck import needs them. */
async function cardsReady(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { brawl } = window as unknown as { brawl: DesktopApi };
        return (await brawl.cards.status()).state;
      }),
    )
    .toBe('ready');
}

async function expectVideoFrom(page: Page, name: string): Promise<void> {
  const seat = page.locator('.seat[data-link="connected"]', { hasText: name });
  await expect(seat).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => seat.locator('video').evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames), {
      timeout: 20_000,
    })
    .toBeGreaterThan(10);
}

test('a host and a friend see each other', async () => {
  const host = await launch('Host');
  await host.page.getByTestId('host').click();
  const invite = await host.page.getByTestId('invite-code').inputValue();
  expect(invite).toMatch(/^CB1-/);

  const friend = await launch('Friend');
  await friend.page.getByTestId('invite-input').fill(invite);
  await friend.page.getByTestId('join').click();

  await expectVideoFrom(host.page, 'Friend');
  await expectVideoFrom(friend.page, 'Host');

  await friend.page.getByRole('button', { name: 'Menu' }).click();
  await friend.page.getByRole('menuitem', { name: 'Leave' }).click();
  await expect(host.page.locator('.seat:not(.seat-free)')).toHaveCount(1);
});

test('closing the table tells the friends', async () => {
  const host = await launch('Host');
  await host.page.getByTestId('host').click();
  const invite = await host.page.getByTestId('invite-code').inputValue();
  const friend = await launch('Friend');
  await friend.page.getByTestId('invite-input').fill(invite);
  await friend.page.getByTestId('join').click();
  await expectVideoFrom(friend.page, 'Host');

  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'Close table' }).click();

  await expect(friend.page.getByText('The host closed the table.')).toBeVisible();
});

test('a wrong invite code is explained', async () => {
  const friend = await launch('Friend');
  await friend.page.getByTestId('invite-input').fill('not an invite');
  await friend.page.getByTestId('join').click();
  await expect(friend.page.getByText('That invite code is not valid.', { exact: false })).toBeVisible();
});

test('a player who joined can quit right away', async () => {
  const host = await launch('Host');
  await host.page.getByTestId('host').click();
  const invite = await host.page.getByTestId('invite-code').inputValue();
  const friend = await launch('Friend');
  await friend.page.getByTestId('invite-input').fill(invite);
  await friend.page.getByTestId('join').click();
  await expectVideoFrom(friend.page, 'Host');

  // Once hung forever: a quick cleanup asked Electron to quit again before it had finished the first attempt.
  const started = Date.now();
  await friend.app.close();
  expect(Date.now() - started).toBeLessThan(5_000);
});

test('life totals are shared, and everyone sees who changed what', async () => {
  const host = await launch('Host');
  await host.page.getByTestId('host').click();
  const invite = await host.page.getByTestId('invite-code').inputValue();
  const friend = await launch('Friend');
  await friend.page.getByTestId('invite-input').fill(invite);
  await friend.page.getByTestId('join').click();
  await expectVideoFrom(friend.page, 'Host');

  // The friend takes 3 life from the host. Quick clicks are grouped into one change.
  const hostLifeOnFriend = friend.page.getByTestId('life-0');
  for (let i = 0; i < 3; i++) await hostLifeOnFriend.getByRole('button', { name: 'Lose 1 life' }).click();

  await expect(host.page.getByTestId('life-total-0')).toHaveText('37');
  await expect(friend.page.getByTestId('life-total-0')).toHaveText('37');
  await expect(host.page.getByTestId('last-change')).toHaveText('Friend: Host −3 life');

  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'New game' }).click();
  await host.page.getByRole('menuitem', { name: 'Start a new game?' }).click();
  await expect(friend.page.getByTestId('life-total-0')).toHaveText('40');
  await expect(friend.page.getByText('Game 2')).toBeVisible();
});

test('typing a life total sets it for everyone', async () => {
  const { host, friend } = await hostAndFriend();

  await host.page.getByTestId('life-total-0').click();
  await host.page.getByLabel('Life total').fill('25');
  await host.page.getByLabel('Life total').press('Enter');

  await expect(friend.page.getByTestId('life-total-0')).toHaveText('25');
  await expect(friend.page.getByTestId('last-change')).toHaveText('Host −15 life');
});

test('21 commander damage knocks a player out, and they can say they are still in', async () => {
  const { host, friend } = await hostAndFriend();

  // The friend names their commander.
  await friend.page.getByRole('button', { name: "Friend's details" }).click();
  await friend.page.getByTestId('seat-details-1').getByLabel('Commander', { exact: true }).fill('Atraxa');
  await friend.page.getByTestId('seat-details-1').getByRole('button', { name: 'Save' }).click();
  await expect(host.page.getByTestId('last-change')).toHaveText("Friend: Friend's commander is Atraxa");

  // Then hits the host with it, 21 in total.
  await friend.page.getByRole('button', { name: "Host's details" }).click();
  const details = friend.page.getByTestId('seat-details-0');
  for (let i = 0; i < 4; i++) await details.getByRole('button', { name: 'Add 5 damage from Atraxa' }).click();
  await details.getByRole('button', { name: 'Add 1 damage from Atraxa' }).click();

  await expect(host.page.getByTestId('out-0')).toContainText('21 commander damage from Atraxa');
  await expect(host.page.getByTestId('life-total-0')).toHaveText('19');
  await expect(host.page.getByTestId('last-change')).toHaveText('Friend: Host took 21 commander damage from Atraxa');

  // A card keeps the host in the game.
  await host.page.getByRole('button', { name: "Host's details" }).click();
  await host.page.getByTestId('seat-details-0').getByRole('button', { name: 'Still in' }).click();
  await expect(friend.page.getByTestId('out-0')).toHaveCount(0);
});

test('poison, other counters and commander tax show on the seat for everyone', async () => {
  const { host, friend } = await hostAndFriend();

  await friend.page.getByRole('button', { name: "Host's details" }).click();
  const details = friend.page.getByTestId('seat-details-0');
  for (let i = 0; i < 3; i++) await details.getByRole('button', { name: 'Add 1 energy' }).click();
  await details.getByRole('button', { name: "Cast Host's commander" }).click();
  await details.getByRole('button', { name: "Cast Host's commander" }).click();

  const chips = host.page.getByTestId('chips-0');
  await expect(chips).toContainText('Energy 3');
  await expect(chips).toContainText("Host's commander tax +4");

  for (let i = 0; i < 10; i++) await details.getByRole('button', { name: 'Add 1 poison' }).click();
  await expect(host.page.getByTestId('out-0')).toContainText('10 poison counters');
});

test('custom counters: made by one player, used by everyone', async () => {
  const { host, friend } = await hostAndFriend();

  // The host makes a per-player counter you lose at 3.
  await host.page.getByRole('button', { name: 'Counters' }).click();
  await host.page.getByRole('button', { name: 'New counter' }).click();
  const form = host.page.getByRole('form', { name: 'Counter' });
  await form.getByLabel('Name').fill('Bounty');
  await form.getByRole('radio', { name: 'red' }).click();
  await form.getByLabel('Lose at').fill('3');
  await form.getByRole('button', { name: 'Save' }).click();

  // And one for the whole table.
  await host.page.getByRole('button', { name: 'New counter' }).click();
  await form.getByLabel('Name').fill('Storm');
  await form.getByLabel('The whole table').check();
  await form.getByRole('button', { name: 'Save' }).click();
  await host.page.getByRole('button', { name: 'Done' }).click();

  // The friend uses both.
  await friend.page.getByTestId('table-counters').getByRole('button', { name: 'Add 1 Storm' }).click();
  await expect(host.page.getByTestId('table-counters').locator('.stepper-value')).toHaveText('1');

  await friend.page.getByRole('button', { name: "Host's details" }).click();
  for (let i = 0; i < 3; i++) {
    await friend.page.getByTestId('seat-details-0').getByRole('button', { name: 'Add 1 Bounty' }).click();
  }
  await expect(host.page.getByTestId('out-0')).toContainText('Bounty reached 3');
  await expect(host.page.getByTestId('chips-0')).toContainText('Bounty 3');
});

test('a shuffled turn order, passed around the table', async () => {
  const { host, friend } = await hostAndFriend();

  await friend.page.getByRole('button', { name: 'Random turn order' }).click();
  await expect(host.page.getByTestId('turn')).toContainText('Turn 1 · Round 1');

  // Whoever got the first turn passes it.
  const [first, second] = (await host.page.getByTestId('turn').innerText()).includes('Your turn')
    ? [host, friend]
    : [friend, host];
  await expect(second.page.getByTestId('turn')).not.toContainText('Your turn');
  await first.page.getByRole('button', { name: 'Pass turn' }).click();

  await expect(second.page.getByTestId('turn')).toContainText('Turn 2 · Round 1 · Your turn');
  await expect(first.page.getByRole('button', { name: 'Pass turn' })).toHaveCount(0);
  await expect(first.page.locator('.seat[data-active="true"]')).toHaveCount(1);
});

test('undo, the game log, and saving it', async () => {
  const { host, friend } = await hostAndFriend();
  for (let i = 0; i < 3; i++) {
    await friend.page.getByTestId('life-0').getByRole('button', { name: 'Lose 1 life' }).click();
  }
  await expect(host.page.getByTestId('life-total-0')).toHaveText('37');

  await friend.page.keyboard.press('Control+z');
  await expect(host.page.getByTestId('life-total-0')).toHaveText('40');
  await expect(host.page.getByTestId('last-change')).toHaveText('Friend undid “Friend: Host −3 life”');
  // The host can't undo the friend's change.
  await expect(host.page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  await friend.page.getByRole('button', { name: 'Log' }).click();
  const log = friend.page.getByTestId('log-panel');
  await expect(log.locator('li')).toHaveCount(2);
  await expect(log.locator('li.undone')).toContainText('Friend: Host −3 life');

  await log.getByLabel('Show').selectOption({ label: 'Host' });
  await expect(log.locator('li')).toHaveCount(1);

  await log.getByRole('button', { name: 'Save as text' }).click();
  await expect(log.getByText('Saved.')).toBeVisible();
  const [file] = await readdir(friend.saveDir);
  const text = await readFile(join(friend.saveDir, file!), 'utf8');
  expect(text).toContain('Friend: Host −3 life  (undone)');
  expect(text).toContain('Players: Host, Friend');
});

test("the host's app crashing mid-game, and the table resumed with everyone in their seats", async () => {
  const { host, friend } = await hostAndFriend();
  await friend.page.getByTestId('life-0').getByRole('button', { name: 'Lose 5 life' }).click();
  await host.page.getByTestId('life-1').getByRole('button', { name: 'Lose 1 life' }).click();
  await expect(friend.page.getByTestId('life-total-1')).toHaveText('39');
  await expect(friend.page.getByTestId('life-total-0')).toHaveText('35');
  await expect(host.page.getByTestId('life-total-0')).toHaveText('35');

  // The host's app dies without a goodbye.
  running.splice(running.indexOf(host), 1);
  host.app.process().kill('SIGKILL');
  await expect(friend.page.getByText('Reconnecting to the host')).toBeVisible({ timeout: 30_000 });

  // The host opens the app again and resumes the table.
  const again = await launch('Host', host.userDataDir);
  await expect(again.page.getByTestId('resume')).toContainText('with Friend');
  await again.page.getByRole('button', { name: 'Resume table' }).click();

  // The friend's app comes back by itself, to the same seats and the same game.
  await expect(friend.page.getByText('Reconnecting to the host')).toHaveCount(0, { timeout: 30_000 });
  await expect(again.page.getByTestId('life-total-0')).toHaveText('35');
  await expect(again.page.getByTestId('life-total-1')).toHaveText('39');
  await expect(friend.page.getByTestId('life-total-0')).toHaveText('35');
  await expect(again.page.getByTestId('seat-0')).toContainText('Host (you)');
  await expectVideoFrom(again.page, 'Friend');
  await expectVideoFrom(friend.page, 'Host');

  // And the game goes on.
  await friend.page.getByTestId('life-0').getByRole('button', { name: 'Gain 1 life' }).click();
  await expect(again.page.getByTestId('life-total-0')).toHaveText('36');
});

test('looking up a card', async () => {
  const host = await launch('Host');
  await host.page.getByTestId('host').click();
  await expect(host.page.getByTestId('seat-0')).toBeVisible();

  await host.page.keyboard.press('Control+k');
  const panel = host.page.getByTestId('cards-panel');
  await panel.getByLabel('Search for a card').fill('rhystc');
  await panel.getByRole('button', { name: 'Rhystic Study' }).click();

  const card = panel.getByTestId('card-view');
  await expect(card).toContainText('Whenever an opponent casts a spell');
  await expect(card).toContainText('Game Changer');
  await expect(card).toContainText('It triggers on every spell.');

  await panel.getByLabel('Search for a card').fill('insectile');
  await panel.getByRole('button', { name: 'Delver of Secrets // Insectile Aberration' }).click();
  await expect(card).toContainText('Flying');
  await expect(card).toContainText('3/2');
});

test('importing decks and playing one', async () => {
  const { host, friend } = await hostAndFriend();
  await cardsReady(host.page);
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'Decks' }).click();
  const panel = host.page.getByTestId('decks-panel');

  // A pasted list that doesn't say which card is the commander, with a typo.
  await panel
    .getByLabel('Deck link or list')
    .fill("1 Atraxa, Praetors' Voice\n1 Sol Ring\n1 Rhystic Study\n1 Sol Rinng");
  await panel.getByRole('button', { name: 'Import' }).click();
  await expect(panel.getByText('Not found, so left out: Sol Rinng')).toBeVisible();
  await panel.getByLabel("Atraxa, Praetors' Voice").check();
  await panel.getByRole('button', { name: 'Save deck' }).click();
  await expect(panel.getByTestId('deck-Imported deck')).toContainText("Atraxa, Praetors' Voice · 3 cards");

  // A Moxfield link.
  await panel.getByLabel('Deck link or list').fill('https://moxfield.com/decks/Y8dZ7');
  await panel.getByRole('button', { name: 'Import' }).click();
  await expect(panel.getByLabel('Imported deck')).toContainText("Commander: Atraxa, Praetors' Voice");
  await panel.getByRole('button', { name: 'Save deck' }).click();

  await panel.getByTestId('deck-Atraxa Counters').getByRole('button', { name: 'Play this deck' }).click();
  await expect(panel.getByTestId('deck-Atraxa Counters')).toContainText('Playing');
  await panel.getByRole('button', { name: 'Done' }).click();

  await expect(friend.page.getByTestId('last-change')).toHaveText('Host is playing Atraxa Counters');
  await friend.page.getByRole('button', { name: "Host's details" }).click();
  await expect(friend.page.getByTestId('seat-details-0')).toContainText('Atraxa Counters · 3 cards');
  await friend.page.getByTestId('seat-details-0').getByRole('button', { name: 'Close' }).click();

  // The commander shows on the host's seat; clicking it shows the card.
  const badge = friend.page.getByTestId('commanders-0').getByRole('button', { name: "Atraxa, Praetors' Voice" });
  await expect(badge).toBeEnabled();
  await badge.click();
  await expect(friend.page.getByTestId('card-view')).toContainText('proliferate');
});

test('casting a card puts it in the spotlight for everyone', async () => {
  const { host, friend } = await hostAndFriend();
  await cardsReady(host.page);

  await host.page.getByRole('button', { name: 'Cards' }).click();
  const panel = host.page.getByTestId('cards-panel');
  await panel.getByLabel('Search for a card').fill('rhystic');
  await panel.getByRole('button', { name: 'Rhystic Study' }).click();
  await panel.getByRole('button', { name: 'Cast it' }).click();

  const spotlight = friend.page.getByTestId('spotlight');
  await expect(spotlight).toContainText('Host cast');
  await expect(spotlight).toContainText('Whenever an opponent casts a spell');
  await expect(friend.page.getByTestId('last-change')).toHaveText('Host cast Rhystic Study');

  await spotlight.getByRole('button', { name: 'Close' }).click();
  await expect(spotlight).toHaveCount(0);
});

test('Rule 0: brackets, and the deck check pointing out what does not fit', async () => {
  const { host, friend } = await hostAndFriend();
  await cardsReady(host.page);

  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'Decks' }).click();
  const decks = host.page.getByTestId('decks-panel');
  await decks.getByLabel('Deck link or list').fill('https://moxfield.com/decks/Y8dZ7');
  await decks.getByRole('button', { name: 'Import' }).click();
  await decks.getByRole('button', { name: 'Save deck' }).click();
  await decks.getByTestId('deck-Atraxa Counters').getByRole('button', { name: 'Play this deck' }).click();
  await decks.getByRole('button', { name: 'Done' }).click();

  await host.page.getByRole('button', { name: 'Rule 0' }).click();
  const rule0 = host.page.getByTestId('rule0-panel');
  await expect(rule0.getByTestId('rule0-0')).toContainText('Game Changers (1): Rhystic Study');
  await expect(rule0.getByTestId('rule0-0')).toContainText('No two-card combos');
  await rule0.getByLabel('Your bracket').selectOption('2');
  await expect(rule0.getByTestId('rule0-0')).toContainText('1 Game Changer (brackets 1–2 have none): Rhystic Study');
  await rule0.getByRole('button', { name: 'Done' }).click();

  await expect(friend.page.getByTestId('seat-0')).toContainText('Bracket 2 ⚠');
  await friend.page.getByRole('button', { name: 'Rule 0' }).click();
  await expect(friend.page.getByTestId('rule0-0')).toContainText('1 Game Changer (brackets 1–2 have none)');
});
