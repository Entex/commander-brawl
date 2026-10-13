import { chromium, _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DesktopApi } from '../../src/desktop/src/shared/api';
import { RHYSTIC_STUDY, drawCardPicture } from '../support/cardPicture';
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
/** Folders the tests made, removed at the end. */
const temporary: string[] = [];
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
  await Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}

test.afterEach(async () => {
  for (const instance of running.splice(0)) await instance.app.close().catch(() => undefined);
});

async function launch(name: string, options: { userDataDir?: string; camera?: string } = {}): Promise<Instance> {
  const saveDir = await temporaryDir('cb-e2e-save-');
  const dataDir = options.userDataDir ?? (await temporaryDir('cb-e2e-'));
  const app = await electron.launch({
    args: [
      appDir,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      // A picture for the fake camera to show, instead of its moving test pattern.
      ...(options.camera ? [`--use-file-for-fake-video-capture=${options.camera}`] : []),
    ],
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
  const again = await launch('Host', { userDataDir: host.userDataDir });
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

test("clicking a card on another player's video: a sharp picture of it, and which card it is", async () => {
  const host = await launch('Host', { camera: await cardCamera() });
  await host.page.getByTestId('host').click();
  const invite = await host.page.getByTestId('invite-code').inputValue();
  const friend = await launch('Friend');
  await friend.page.getByTestId('invite-input').fill(invite);
  await friend.page.getByTestId('join').click();
  await expectVideoFrom(friend.page, 'Host');
  await cardsReady(friend.page);

  // The card is in the middle of the host's camera picture.
  await friend.page.locator('.seat', { hasText: 'Host' }).getByTestId('seat-video').click();

  const snapshot = friend.page.getByTestId('snapshot');
  await expect(snapshot).toContainText("From Host's camera");
  const image = snapshot.getByRole('img', { name: 'Close-up' });
  await expect(image).toBeVisible({ timeout: 20_000 });
  const size = await image.evaluate((img: HTMLImageElement) => ({
    width: img.naturalWidth,
    height: img.naturalHeight,
  }));
  // A card-sized part of the host's camera picture, portrait like a card.
  expect(size.height).toBeGreaterThan(size.width);
  const guesses = snapshot.getByTestId('snapshot-guesses');
  await expect(guesses).toContainText('Rhystic Study', { timeout: 30_000 });
  await friend.page.screenshot({ path: test.info().outputPath('close-up.png') });

  // Keeping track of it, on the host's side.
  await guesses.getByRole('button', { name: 'Track Rhystic Study' }).click();
  await expect(snapshot).toHaveCount(0);
  await host.page.getByRole('button', { name: "Host's details" }).click();
  await expect(host.page.getByTestId('permanent-Rhystic Study')).toBeVisible();
  await host.page.getByTestId('seat-details-0').getByRole('button', { name: 'Close' }).click();

  // Picking the card shows it, with its text.
  await friend.page.locator('.seat', { hasText: 'Host' }).getByTestId('seat-video').click();
  await expect(guesses).toContainText('Rhystic Study', { timeout: 30_000 });
  await guesses
    .getByRole('button', { name: /Rhystic Study/ })
    .first()
    .click();
  await expect(snapshot).toHaveCount(0);
  await expect(friend.page.getByTestId('cards-panel')).toContainText('Whenever an opponent casts a spell');
  // Your own video isn't for looking at close up.
  await expect(host.page.locator('.seat-video-look')).toHaveCount(1);
});

/** A camera picture of a (made-up) Rhystic Study on a playmat, for the fake camera to show. */
async function cardCamera(): Promise<string> {
  const browser = await chromium.launch({ executablePath: process.env.CB_CHROMIUM || undefined });
  try {
    const page = await browser.newPage();
    const picture = await page.evaluate(drawCardPicture, {
      width: 1920,
      height: 1080,
      cardWidth: 300,
      angle: 3,
      ...RHYSTIC_STUDY,
    });
    // Chromium's fake camera plays an MJPEG file: one JPEG is a one-frame video.
    const file = join(await temporaryDir('cb-e2e-camera-'), 'card.mjpeg');
    await writeFile(file, Buffer.from(picture.split(',')[1]!, 'base64'));
    return file;
  } finally {
    await browser.close();
  }
}

test('"Wait, I have a response!" flashes on every screen', async () => {
  const { host, friend } = await hostAndFriend();

  await friend.page.keyboard.press('w');

  await expect(host.page.getByTestId('response-banner')).toHaveText('✋ Friend: “Wait, I have a response!”');
  await expect(host.page.locator('.seat-responding')).toContainText('Friend');
  await host.page.screenshot({ path: test.info().outputPath('response.png') });
  await expect(friend.page.getByTestId('response-banner')).toHaveText('✋ You asked everyone to wait');
  // No calling again right away, and nothing to undo: it didn't change the game.
  await expect(friend.page.getByRole('button', { name: '✋ Wait!' })).toBeDisabled();
  await expect(friend.page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(host.page.getByTestId('last-change')).toHaveText('Friend: “Wait, I have a response!”');

  // It doesn't get in the way of the buttons under it, and goes by itself after a few seconds.
  await host.page.getByRole('button', { name: 'Random turn order' }).click();
  await expect(host.page.getByTestId('last-change')).toContainText('shuffled the turn order');
  await expect(host.page.getByTestId('response-banner')).toHaveCount(0, { timeout: 10_000 });
  await expect(friend.page.getByTestId('response-banner')).toHaveCount(0);
  await expect(friend.page.getByRole('button', { name: '✋ Wait!' })).toBeEnabled();
});

test('pings and arrows on the videos, in the same spot for everyone, also on a flipped video', async () => {
  const { host, friend } = await hostAndFriend();
  await expectVideoFrom(host.page, 'Friend');
  const seatVideo = (page: Page, name: string) => page.locator('.seat', { hasText: name }).getByTestId('seat-video');
  // The friend sees the host's video upside down.
  await friend.page.locator('.seat', { hasText: 'Host' }).getByRole('button', { name: 'Flip' }).click();

  // The host right-clicks a spot on their own picture, near its top left.
  const spot = await onPicture(seatVideo(host.page, 'Host (you)'), 0.25, 0.3);
  await host.page.mouse.click(spot.x, spot.y, { button: 'right' });

  // The friend sees it there on the host's picture, which for them is near the bottom right.
  const ping = friend.page.getByTestId('ping');
  await expect(ping).toHaveCount(1);
  await expect(ping).toContainText('Host');
  const expected = await onPicture(seatVideo(friend.page, 'Host'), 0.25, 0.3);
  const shown = await centerOf(ping.locator('circle').first());
  expect(Math.abs(shown.x - expected.x)).toBeLessThan(3);
  expect(Math.abs(shown.y - expected.y)).toBeLessThan(3);
  const box = (await seatVideo(friend.page, 'Host').boundingBox())!;
  expect(shown.x).toBeGreaterThan(box.x + box.width / 2);
  expect(shown.y).toBeGreaterThan(box.y + box.height / 2);

  // An arrow: dragged from the host's picture to a spot on the friend's.
  const from = await onPicture(seatVideo(host.page, 'Host (you)'), 0.5, 0.5);
  const to = await onPicture(seatVideo(host.page, 'Friend'), 0.6, 0.4);
  await host.page.mouse.move(from.x, from.y);
  await host.page.mouse.down();
  await host.page.mouse.move(to.x, to.y, { steps: 8 });
  await host.page.mouse.up();
  await expect(friend.page.getByTestId('arrow')).toHaveCount(1);
  await expect(host.page.getByTestId('arrow')).toContainText('You');
  await friend.page.screenshot({ path: test.info().outputPath('pointers.png') });

  // A drag within one video draws an arrow too, and isn't taken for a click (no close-up).
  const a = await onPicture(seatVideo(friend.page, 'Host'), 0.3, 0.5);
  await friend.page.mouse.move(a.x, a.y);
  await friend.page.mouse.down();
  await friend.page.mouse.move(a.x + 60, a.y + 20, { steps: 5 });
  await friend.page.mouse.up();
  await expect(host.page.getByTestId('arrow')).toHaveCount(2);
  await expect(friend.page.getByTestId('snapshot')).toHaveCount(0);

  // They go away after a few seconds.
  await expect(friend.page.getByTestId('ping')).toHaveCount(0, { timeout: 10_000 });
});

/** Where a point of a video's picture (as fractions) is on the page, allowing for bars and a flipped video. */
async function onPicture(video: ReturnType<Page['locator']>, x: number, y: number): Promise<{ x: number; y: number }> {
  return video.evaluate(
    (element: HTMLVideoElement, [px, py]) => {
      const box = element.getBoundingClientRect();
      const scale = Math.min(box.width / element.videoWidth, box.height / element.videoHeight);
      const width = element.videoWidth * scale;
      const height = element.videoHeight * scale;
      let ex = (box.width - width) / 2 + px! * width;
      let ey = (box.height - height) / 2 + py! * height;
      if (element.dataset.rotation === '180') [ex, ey] = [box.width - ex, box.height - ey];
      return { x: box.left + ex, y: box.top + ey };
    },
    [x, y],
  );
}

async function centerOf(locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('phases of the turn, a turn timer that a response pauses, and a chess clock', async () => {
  const { host, friend } = await hostAndFriend();
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'Clock' }).click();
  await host.page.getByLabel(/Turn timer/).check();
  await host.page.getByLabel('Minutes per turn').fill('2');
  await host.page.getByRole('button', { name: 'Use this clock' }).click();
  await expect(friend.page.getByTestId('last-change')).toHaveText('Host started a turn timer, 2 min a turn');

  await host.page.getByRole('button', { name: 'Random turn order' }).click();
  await expect(host.page.getByTestId('turn')).toBeVisible();
  const hostFirst = (await host.page.getByTestId('turn').textContent())!.includes('Your turn');
  const [active, other] = hostFirst ? [host, friend] : [friend, host];

  // The clock runs for the active player, the same for everyone.
  for (const { page } of [active, other]) {
    await expect(page.getByTestId('clock')).toContainText(/⏱ (2:00|1:5\d)/);
    await expect(page.getByTestId('phases').locator('.phase-current')).toHaveText('Upkeep');
  }

  // The active player moves on; everyone sees where they are.
  await active.page.getByTestId('phases').getByRole('button', { name: 'Draw' }).click();
  await expect(other.page.getByTestId('phases').locator('.phase-current')).toHaveText('Draw');
  // Only the active player moves the turn along.
  await expect(other.page.getByTestId('phases').getByRole('button')).toHaveCount(0);

  // "Wait, I have a response!" stops the clock until the active player moves on.
  await other.page.keyboard.press('w');
  await expect(active.page.getByTestId('clock')).toContainText('Paused');
  const paused = await active.page.getByTestId('clock').textContent();
  await active.page.waitForTimeout(1_500);
  await expect(active.page.getByTestId('clock')).toHaveText(paused!);
  await active.page.getByTestId('phases').getByRole('button', { name: 'Combat' }).click();
  await expect(other.page.getByTestId('clock')).not.toContainText('Paused');
  await expect(other.page.getByTestId('phases')).toContainText('Attackers');
  await other.page.screenshot({ path: test.info().outputPath('turn.png') });

  // Next turn: the other player's, from the upkeep, with a fresh two minutes.
  await active.page.getByRole('button', { name: 'Pass turn' }).click();
  await expect(other.page.getByTestId('turn')).toContainText('Your turn');
  await expect(other.page.getByTestId('phases').locator('.phase-current')).toHaveText('Upkeep');
  await expect(other.page.getByTestId('clock')).toContainText(/⏱ (2:00|1:5\d)/);

  // A chess clock instead: everyone's time bank on their seat.
  await other.page.getByRole('button', { name: 'Menu' }).click();
  await other.page.getByRole('menuitem', { name: 'Clock' }).click();
  await other.page.getByLabel(/Chess clock/).check();
  await expect(other.page.getByLabel('Minutes per player')).toHaveValue('25');
  await other.page.getByRole('button', { name: 'Start over with this clock' }).click();
  await expect(active.page.getByTestId('seat-clock')).toHaveCount(2);
  await expect(active.page.locator('.seat-clock-running')).toHaveCount(1);
});

test('markers: monarch, initiative and the Undercity, day and night, the storm count', async () => {
  const { host, friend } = await hostAndFriend();

  // The friend marks the host as the monarch, and gives them the initiative.
  await friend.page.getByRole('button', { name: "Host's details" }).click();
  const markers = friend.page.getByTestId('seat-markers');
  await markers.getByRole('button', { name: '👑 Monarch' }).click();
  await markers.getByRole('button', { name: 'Initiative' }).click();
  const hostChips = host.page.getByTestId('chips-0');
  await expect(hostChips).toContainText('👑 Monarch');
  await expect(hostChips).toContainText('Initiative');
  // The initiative took them into Undercity; on to the Forge.
  await expect(hostChips).toContainText('Undercity Secret Entrance');
  await markers.getByRole('button', { name: 'Forge' }).click();
  await expect(hostChips).toContainText('Undercity Forge');
  await expect(markers.getByTestId('dungeon')).toContainText('Put two +1/+1 counters on target creature.');
  await markers.scrollIntoViewIfNeeded();
  await friend.page.screenshot({ path: test.info().outputPath('markers.png') });
  await expect(host.page.getByTestId('last-change')).toHaveText('Friend: Host ventured into Forge (Undercity)');

  // Day and night, and the storm count, for the whole table.
  await host.page.getByRole('button', { name: 'Counters' }).click();
  await host.page.getByRole('group', { name: 'Day or night' }).getByRole('button', { name: '☀ Day' }).click();
  await host.page.getByRole('button', { name: 'Add 1 to the storm count' }).click();
  await host.page.getByRole('button', { name: 'Done' }).click();
  const bar = friend.page.getByTestId('table-counters');
  await expect(bar.getByTestId('day-night')).toHaveText('☀ Day');
  await expect(bar).toContainText('Storm count');
  await bar.getByTestId('day-night').click();
  await expect(host.page.getByTestId('day-night')).toHaveText('☾ Night');

  // The storm count is for one turn: the first turn starts it over.
  await host.page.getByRole('button', { name: 'Random turn order' }).click();
  await expect(bar).not.toContainText('Storm count');
});

test('dice, coin flips and random picks, rolled by the host and shown to everyone', async () => {
  const { host, friend } = await hostAndFriend();

  await friend.page.getByRole('button', { name: '🎲 Roll' }).click();
  await friend.page.getByRole('menuitem', { name: 'd20' }).click();
  const banner = host.page.getByTestId('roll-banner');
  await expect(banner).toHaveText(/🎲 Friend rolled a d20: ([1-9]|1[0-9]|20)$/);
  const roll = await banner.textContent();
  // The same result for everyone.
  await expect(friend.page.getByTestId('roll-banner')).toHaveText(roll!);

  await host.page.getByRole('button', { name: '🎲 Roll' }).click();
  await host.page.getByLabel('How many dice').fill('3');
  await host.page.getByLabel('Sides').fill('6');
  await host.page.getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(friend.page.getByTestId('roll-banner')).toContainText(/Host rolled 3d6: \d, \d, \d \(\d+\)/);

  await host.page.getByRole('button', { name: '🎲 Roll' }).click();
  await host.page.getByRole('menuitem', { name: 'Random opponent' }).click();
  await expect(friend.page.getByTestId('roll-banner')).toContainText('Host picked a random opponent: Friend');
  await friend.page.screenshot({ path: test.info().outputPath('rolls.png') });

  await friend.page.getByRole('button', { name: '🎲 Roll' }).click();
  await friend.page.getByRole('menuitem', { name: 'Flip a coin' }).click();
  await expect(host.page.getByTestId('roll-banner')).toContainText(/Friend flipped a coin: (heads|tails)/);
  // In the log too, and nothing to undo.
  await expect(friend.page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('Planechase and Archenemy: a shared planar deck and the planar die, a scheme deck for the archenemy', async () => {
  const { host, friend } = await hostAndFriend();
  await cardsReady(host.page);
  const planes = ['Tolaria Test Grounds', 'Bant of Tests', 'Test Phenomenon'];

  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'Planechase and Archenemy' }).click();
  await host.page.getByRole('button', { name: 'Start Planechase (3 planes)' }).click();

  // Everyone sees the first plane, big, and then in the bar.
  const spotlight = friend.page.getByTestId('variant-spotlight');
  await expect(spotlight).toBeVisible();
  const first = (await friend.page.getByTestId('plane').textContent())!;
  expect(planes).toContain(first);
  await expect(spotlight).toContainText(first === 'Test Phenomenon' ? 'each player draws a card' : 'draw a card');
  await spotlight.getByRole('button', { name: 'Close' }).click();

  // Planeswalking moves everyone to the next plane.
  await friend.page.getByRole('button', { name: 'Planeswalk' }).click();
  await expect(host.page.getByTestId('plane')).not.toHaveText(first);
  // The planar die: the first roll in a turn is free, the next one costs {1}.
  await host.page.getByRole('button', { name: 'Roll the planar die (free)' }).click();
  await expect(friend.page.getByTestId('roll-banner')).toContainText(
    /Host rolled the planar die: (nothing|chaos|planeswalk)/,
  );
  await expect(host.page.getByRole('button', { name: 'Roll the planar die (costs {1})' })).toBeVisible();

  // Archenemy, with the friend as the archenemy.
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'Planechase and Archenemy' }).click();
  await host.page.getByLabel('Archenemy', { exact: true }).selectOption({ label: 'Friend' });
  await host.page.getByRole('button', { name: 'Start Archenemy (2 schemes)' }).click();
  await expect(friend.page.getByTestId('variants-bar')).toContainText('You are the archenemy');
  await expect(host.page.getByTestId('variants-bar')).toContainText('Friend is the archenemy');
  // Only the archenemy sets schemes in motion; everyone sees which.
  await expect(host.page.getByRole('button', { name: 'Set a scheme in motion' })).toHaveCount(0);
  await friend.page.getByRole('button', { name: 'Set a scheme in motion' }).click();
  await expect(host.page.getByTestId('scheme')).toHaveText(/My Test Plan|Ongoing Test Plan/);
  await expect(host.page.getByTestId('last-change')).toContainText(
    /Friend set (My Test Plan|Ongoing Test Plan) in motion/,
  );
});

test('counters on cards and groups of tokens, untapped when their turn starts', async () => {
  const { host, friend } = await hostAndFriend();
  await cardsReady(friend.page);

  // The friend keeps track of the host's Atraxa and three Goblin tokens.
  await friend.page.getByRole('button', { name: "Host's details" }).click();
  const battlefield = friend.page.getByTestId('permanents');
  const name = battlefield.getByLabel('Card or token to keep track of');
  await name.fill('atraxa');
  await battlefield.getByRole('button', { name: "Atraxa, Praetors' Voice" }).click();
  await battlefield.getByLabel("Put a counter on Atraxa, Praetors' Voice").selectOption('+1/+1');
  await battlefield.getByRole('button', { name: "Add a +1/+1 counter to Atraxa, Praetors' Voice" }).click();
  await battlefield.getByLabel('How many tokens').fill('3');
  await name.fill('Goblin');
  await battlefield.getByRole('button', { name: '“Goblin” as 3 tokens' }).click();
  await battlefield.getByRole('button', { name: 'Tap one Goblin', exact: true }).click();

  const chips = host.page.getByTestId('chips-0');
  await expect(chips).toContainText("Atraxa, Praetors' Voice, +1/+1 2");
  await expect(chips).toContainText('Goblin ×3 (1 tapped)');
  await battlefield.scrollIntoViewIfNeeded();
  await friend.page.screenshot({ path: test.info().outputPath('battlefield.png') });
  await expect(host.page.getByTestId('last-change')).toHaveText('Friend: Host tapped Goblin');

  // Their tokens untap when their turn starts.
  await host.page.getByRole('button', { name: 'Random turn order' }).click();
  for (let pass = 0; pass < 2; pass++) {
    const active = (await host.page.getByTestId('turn').textContent())!.includes('Your turn') ? host : friend;
    await active.page.getByRole('button', { name: 'Pass turn' }).click();
    if (active === friend) break;
  }
  await expect(host.page.getByTestId('turn')).toContainText('Your turn');
  await expect(chips).toContainText('Goblin ×3');
  await expect(chips).not.toContainText('tapped');
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
