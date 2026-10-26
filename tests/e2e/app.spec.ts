import { chromium, _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DesktopApi } from '../../src/desktop/src/shared/api';
import type { CropRect } from '@commander-brawl/application';
import { RHYSTIC_STUDY, drawCardPicture } from '../support/cardPicture';
import { startFakeGitHub } from '../support/fakeGitHub';
import { startFakeScryfall, type FakeScryfall } from '../support/fakeScryfall';
import { startFakeSpellbook, type FakeSpellbook } from '../support/fakeSpellbook';

// The whole app, two copies on one computer: main process, IPC, UI and video.
// Needs a display. On a Linux machine without one, run it with `xvfb-run -a npm run test:e2e`.

const appDir = resolve(import.meta.dirname, '../../build/app');
/** Electron itself, to start a second copy the way the system does when a link is opened. */
const electronPath = createRequire(import.meta.url)('electron') as string;

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
let spellbook: FakeSpellbook;

test.beforeAll(async () => {
  scryfall = await startFakeScryfall();
  spellbook = await startFakeSpellbook();
});

test.afterAll(async () => {
  await scryfall.close();
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

async function launch(
  name: string,
  options: {
    userDataDir?: string;
    camera?: string;
    openFile?: string;
    env?: Record<string, string>;
    /** More arguments, like an invite link the app is opened with. */
    args?: string[];
  } = {},
): Promise<Instance> {
  const saveDir = await temporaryDir('cb-e2e-save-');
  const dataDir = options.userDataDir ?? (await temporaryDir('cb-e2e-'));
  const app = await electron.launch({
    args: [
      appDir,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      // WebGL without a graphics card (CI has none): Chromium's software renderer, which it only offers for WebGL
      // when asked. Set CB_E2E_NO_GPU=1 to test like CI on a computer that has one.
      '--enable-unsafe-swiftshader',
      ...(process.env.CB_E2E_NO_GPU ? ['--disable-gpu'] : []),
      // A picture for the fake camera to show, instead of its moving test pattern.
      ...(options.camera ? [`--use-file-for-fake-video-capture=${options.camera}`] : []),
      ...(options.args ?? []),
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
      CB_SPELLBOOK_API: spellbook.apiUrl,
      // Not asked for a deck when a game starts: most tests don't need one. The test of it turns it on.
      CB_DECK_PROMPT: 'off',
      ...(options.openFile ? { CB_OPEN_FILE: options.openFile } : {}),
      ...options.env,
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
  await page.getByRole('combobox', { name: 'Webcam' }).selectOption({ index: 1 });
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

/** A modified client can bypass request-side crop clamping and ask any table member for a snapshot. */
async function craftedSnapshot(page: Page, to: string, crop: CropRect): Promise<{ kind: string; message?: string }> {
  return page.evaluate(
    ({ to, crop }) => {
      const { brawl } = window as unknown as { brawl: DesktopApi };
      const id = crypto.randomUUID();
      return new Promise<{ kind: string; message?: string }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          off();
          reject(new Error('No snapshot response'));
        }, 5_000);
        const off = brawl.table.onEvent((event) => {
          if (event.type !== 'signal' || event.from !== to) return;
          const data = event.data as { snapshot?: { id: string; kind: string; message?: string } };
          if (data.snapshot?.id !== id) return;
          clearTimeout(timeout);
          off();
          resolve({ kind: data.snapshot.kind, message: data.snapshot.message });
        });
        brawl.table.send(to, { snapshot: { kind: 'request', id, crop } });
      });
    },
    { to, crop },
  );
}

async function ownMemberId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const { brawl } = window as unknown as { brawl: DesktopApi };
    const welcome = (await brawl.table.snapshot()).find((event) => event.type === 'welcome');
    if (!welcome || welcome.type !== 'welcome') throw new Error('No table welcome');
    return welcome.selfId;
  });
}

test('a host and a friend see each other', async () => {
  const host = await launch('Host');
  await host.page.getByTestId('host').click();
  // The invite link, pasted (not opened) on the friend's side.
  const invite = await host.page.getByTestId('invite-code').inputValue();
  expect(invite).toMatch(/^https:\/\/entex\.github\.io\/commander-brawl\/join\/#CB1-/);

  const friend = await launch('Friend');
  await friend.page.getByTestId('invite-input').fill(invite);
  await friend.page.getByTestId('join').click();

  await expectVideoFrom(host.page, 'Friend');
  await expectVideoFrom(friend.page, 'Host');

  // Stats: the video from them, and the video sent to them.
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitemcheckbox', { name: 'Show stats' }).click();
  await host.page.keyboard.press('Escape');
  const stats = host.page.locator('.seat', { hasText: 'Friend' }).getByTestId('seat-stats');
  await expect(stats).toContainText(/↓ \d+×\d+ · \d+ fps/, { timeout: 10_000 });
  await expect(stats).toContainText(/↑ \d+×\d+ · \d+ fps/);

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

test('a wrong invite is explained', async () => {
  const friend = await launch('Friend');
  await friend.page.getByTestId('invite-input').fill('not an invite');
  await friend.page.getByTestId('join').click();
  await expect(friend.page.getByText('That invite is not valid.', { exact: false })).toBeVisible();
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

  // The player who's waiting has the active player's seat take most of the screen.
  await second.page.getByRole('button', { name: 'Menu' }).click();
  const enlarge = second.page.getByRole('menuitemcheckbox', { name: 'Enlarge the active player' });
  await expect(enlarge).toHaveAttribute('aria-checked', 'false');
  await enlarge.click();
  await expect(enlarge).toHaveAttribute('aria-checked', 'true');
  await second.page.screenshot({ path: test.info().outputPath('menu.png') });
  await second.page.keyboard.press('Escape');
  const firstName = first === host ? 'Host' : 'Friend';
  const big = second.page.locator('.seat[data-focused="true"]');
  await expect(big).toContainText(firstName);
  await expect(second.page.locator('.seat-free')).toHaveCount(0);
  const bigBox = (await big.boundingBox())!;
  const smallBox = (await second.page.locator('.seat:not([data-focused])').boundingBox())!;
  expect(bigBox.width).toBeGreaterThan(smallBox.width * 2);
  await second.page.screenshot({ path: test.info().outputPath('enlarged.png') });

  await first.page.getByRole('button', { name: 'Pass turn' }).click();

  // On your own turn, it's your seat.
  await expect(second.page.getByTestId('turn')).toContainText('Turn 2 · Round 1 · Your turn');
  await expect(second.page.locator('.seat[data-focused="true"]')).toContainText(first === host ? 'Friend' : 'Host');
  await expect(first.page.getByRole('button', { name: 'Pass turn' })).toHaveCount(0);
  await expect(first.page.locator('.seat[data-active="true"]')).toHaveCount(1);
});

test('a turn order set by hand, or a random first player in that order', async () => {
  const { host, friend } = await hostAndFriend();

  await friend.page.getByRole('button', { name: 'Set the order…' }).click();
  const panel = friend.page.getByRole('dialog', { name: 'Turn order' });
  // All of it inside the panel: its text wraps, though it's opened from the status bar, which doesn't.
  const overflowing = await panel.evaluate((dialog) =>
    [...dialog.querySelectorAll<HTMLElement>('.panel, .panel *')]
      .filter((element) => element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0)
      .map((element) => element.className || element.tagName),
  );
  expect(overflowing).toEqual([]);
  await panel.getByRole('button', { name: 'Move Friend up' }).click();
  await expect(panel.locator('li')).toHaveText([/Friend/, /Host/]);
  await panel.getByRole('button', { name: 'Friend goes first' }).click();

  await expect(host.page.getByTestId('turn')).toContainText("Friend's turn");
  await expect(friend.page.getByTestId('turn')).toContainText('Your turn');
  await expect(host.page.getByTestId('last-change')).toHaveText('Friend set the turn order: Friend → Host');

  // Chosen, not rolled: it can be taken back.
  await friend.page.getByRole('button', { name: 'Undo' }).click();
  await expect(host.page.getByRole('button', { name: 'Set the order…' })).toBeVisible();

  await host.page.getByRole('button', { name: 'Set the order…' }).click();
  await host.page
    .getByRole('dialog', { name: 'Turn order' })
    .getByRole('button', { name: 'A random player goes first' })
    .click();
  await expect(friend.page.getByTestId('turn')).toContainText('Turn 1 · Round 1');
  await expect(friend.page.getByTestId('last-change')).toHaveText(
    /^Host picked a random first player: (Host → Friend|Friend → Host)$/,
  );
});

// Keys as Windows hands them to the window: Playwright's own key presses go straight to the page, never past the
// window, where the menu bar and the window's own keys are.
test("no menu bar for Alt to show (Alt+click and Alt+drag are the app's); F11 still makes it full screen", async () => {
  test.skip(process.platform !== 'win32', 'Posts keys to the window the way Windows does');
  const { app, page } = await launch('Host');
  const window = () =>
    app.evaluate(({ BrowserWindow }) => {
      const shown = BrowserWindow.getAllWindows()[0]!;
      return {
        menuBar: shown.isMenuBarVisible(),
        fullScreen: shown.isFullScreen(),
        handle: shown.getNativeWindowHandle().readBigUInt64LE(0).toString(),
      };
    });
  const { handle } = await window();
  /** Windows messages (a key down and up), each [message, key, details]. */
  const post = async (messages: readonly (readonly [number, number, number])[]) => {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      [
        'Add-Type -Name Post -Namespace W -MemberDefinition \'[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);\'',
        ...messages.map(
          ([message, key, details]) =>
            `[W.Post]::PostMessage([IntPtr]${handle}, ${message}, [IntPtr]${key}, [IntPtr]([long]${details})) | Out-Null; Start-Sleep -Milliseconds 50`,
        ),
      ].join('; '),
    ]);
    await page.waitForTimeout(500);
  };
  // Alt, down and up (WM_SYSKEYDOWN, WM_SYSKEYUP).
  await post([
    [0x104, 0x12, 0x20380001],
    [0x105, 0x12, 0xe0380001],
  ]);
  expect((await window()).menuBar).toBe(false);
  // F11, down and up (WM_KEYDOWN, WM_KEYUP).
  const f11 = [
    [0x100, 0x7a, 0x00570001],
    [0x101, 0x7a, 0xc0570001],
  ] as const;
  await post(f11);
  await expect.poll(async () => (await window()).fullScreen).toBe(true);
  await post(f11);
  await expect.poll(async () => (await window()).fullScreen).toBe(false);
});

test('keyboard shortcuts at the table', async () => {
  const { host, friend } = await hostAndFriend();
  const page = host.page;

  // ? lists them.
  await page.keyboard.press('?');
  const list = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(list).toContainText('Roll a d20');
  await list.getByRole('button', { name: 'Close' }).click();

  // Your life: + and − by one, Page Down by five.
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await page.keyboard.press('-');
  await expect(friend.page.getByTestId('life-total-0')).toHaveText('41');
  await page.keyboard.press('PageDown');
  await expect(friend.page.getByTestId('life-total-0')).toHaveText('36');

  // D rolls a d20; R opens the Roll menu.
  await page.keyboard.press('d');
  await expect(friend.page.getByTestId('roll-banner')).toContainText('Host rolled a d20');
  await page.keyboard.press('r');
  await expect(page.getByRole('menuitem', { name: 'Flip a coin' })).toBeVisible();
  await page.keyboard.press('Escape');

  // 2 enlarges the second seat (the friend's), and again goes back.
  await page.keyboard.press('2');
  await expect(page.locator('.seat[data-focused="true"]')).toContainText('Friend');
  await page.keyboard.press('2');
  await expect(page.locator('.seat[data-focused="true"]')).toHaveCount(0);

  // L shows the log and hides it again.
  await page.keyboard.press('l');
  await expect(page.getByTestId('log-panel')).toBeVisible();
  await page.keyboard.press('l');
  await expect(page.getByTestId('log-panel')).toHaveCount(0);

  // Enter resolves the newest call.
  await friend.page.keyboard.press('w');
  await expect(page.getByTestId('call')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(friend.page.getByTestId('call')).toHaveCount(0);

  // T: a reminder for the phase the turn is in.
  await page.getByRole('button', { name: 'Random turn order' }).click();
  await expect(page.getByTestId('turn')).toBeVisible();
  await page.keyboard.press('t');
  await expect(page.getByRole('dialog', { name: 'Reminders' }).getByLabel('Phase')).toHaveValue('upkeep');
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

  await panel.getByTestId('deck-Atraxa').getByRole('button', { name: 'Play this deck' }).click();
  await expect(panel.getByTestId('deck-Atraxa')).toContainText('Playing');
  await panel.getByRole('button', { name: 'Done' }).click();

  await expect(friend.page.getByTestId('last-change')).toHaveText('Host is playing Atraxa');
  await friend.page.getByRole('button', { name: "Host's details" }).click();
  await expect(friend.page.getByTestId('seat-details-0')).toContainText('Atraxa · 3 cards');
  await friend.page.getByTestId('seat-details-0').getByRole('button', { name: 'Close' }).click();

  // The commander's art shows on the host's seat, crediting the artist; clicking it shows the card.
  const badge = friend.page.getByTestId('commanders-0').getByRole('button', { name: "Atraxa, Praetors' Voice" });
  await expect(badge).toBeEnabled();
  await expect(badge).toHaveAttribute('title', /Art by Atraxa Painter · © Wizards of the Coast/);
  // Small, beside the player's name: the art, and the name only while the pointer is on it.
  await expect(friend.page.locator('.seat-label', { hasText: 'Host' }).getByTestId('commanders-0')).toBeVisible();
  await expect(badge.locator('.commander-name')).toBeHidden();
  await badge.hover();
  await expect(badge.locator('.commander-name')).toBeVisible();
  await friend.page.screenshot({ path: test.info().outputPath('commander.png') });
  await badge.click();
  const view = friend.page.getByTestId('card-view');
  await expect(view).toContainText('proliferate');
  // Its keywords, explained: listed, and marked in its text.
  const keywords = view.getByTestId('card-keywords');
  await expect(keywords).toContainText('Deathtouch');
  await expect(keywords).toContainText(
    'Any amount of damage it deals to a creature is enough to destroy that creature.',
  );
  await expect(view.locator('abbr.keyword', { hasText: 'Flying' }).first()).toHaveAttribute(
    'title',
    /can't be blocked/,
  );
});

test('asked for your deck when a game starts, with the choice to go on without', async () => {
  const host = await launch('Host', { env: { CB_DECK_PROMPT: 'on' } });
  await cardsReady(host.page);
  await host.page.getByTestId('host').click();

  const prompt = host.page.getByRole('dialog', { name: 'Which deck are you playing?' });
  await expect(prompt).toContainText('close-ups of your cards are recognized much better');
  await expect(prompt).toContainText("You haven't imported a deck yet.");
  await prompt.getByRole('button', { name: 'Continue without a deck' }).click();
  await expect(prompt).toHaveCount(0);

  // Asked again when the next game starts.
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'New game' }).click();
  await host.page.getByRole('menuitem', { name: 'Start a new game?' }).click();
  await expect(prompt).toBeVisible();

  // Importing one from there, then playing it.
  await prompt.getByRole('button', { name: 'Import a deck…' }).click();
  const panel = host.page.getByTestId('decks-panel');
  await panel.getByLabel('Deck link or list').fill('https://moxfield.com/decks/Y8dZ7');
  await panel.getByRole('button', { name: 'Import' }).click();
  await panel.getByRole('button', { name: 'Save deck' }).click();
  await panel.getByRole('button', { name: 'Done' }).click();
  await host.page.screenshot({ path: test.info().outputPath('deck-prompt.png') });
  await prompt.getByTestId('prompt-deck-Atraxa').getByRole('button', { name: 'Play this deck' }).click();
  await expect(prompt).toHaveCount(0);
  await expect(host.page.getByTestId('last-change')).toHaveText('Host is playing Atraxa');

  // Playing a deck, nobody asks: not in the next game either (the deck stays).
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'New game' }).click();
  await host.page.getByRole('menuitem', { name: 'Start a new game?' }).click();
  await expect(host.page.getByTestId('last-change')).toHaveText('Host started a new game');
  await expect(prompt).toHaveCount(0);
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

  // It's in Cards seen too, for everyone.
  await friend.page.getByTestId('seen-toggle').click();
  const lookup = friend.page.getByTestId('card-rail').getByTestId('lookup');
  await expect(lookup.getByTestId('lookup-name')).toHaveText('Rhystic Study');
  await expect(lookup).toContainText('Host cast it');

  // Cast another: the first is under Earlier, and can go to the graveyard from there.
  await host.page.getByRole('button', { name: 'Cards' }).click();
  await panel.getByLabel('Search for a card').fill('sol ring');
  await panel.getByRole('button', { name: 'Sol Ring' }).click();
  await panel.getByRole('button', { name: 'Cast it' }).click();
  await expect(lookup.getByTestId('lookup-name')).toHaveText('Sol Ring');
  const earlier = friend.page.getByTestId('card-rail').getByRole('region', { name: 'Earlier' });
  await friend.page.screenshot({ path: test.info().outputPath('rail.png') });
  await earlier.getByRole('button', { name: 'Put Rhystic Study in the graveyard' }).click();
  await expect(earlier).toHaveCount(0);
  await expect(host.page.getByTestId('last-change')).toHaveText("Friend put Rhystic Study in Host's graveyard");
});

test("clicking a card on a player's video, yours too: outlined there, and which card it is beside the table", async () => {
  const host = await launch('Host', { camera: await cardCamera() });
  await host.page.getByTestId('host').click();
  const invite = await host.page.getByTestId('invite-code').inputValue();
  const friend = await launch('Friend');
  await friend.page.getByTestId('invite-input').fill(invite);
  await friend.page.getByTestId('join').click();
  await expectVideoFrom(friend.page, 'Host');
  await cardsReady(friend.page);

  // The card is in the middle of the host's camera picture. Clicked near its top right corner, it's still
  // all of the card that's looked at, not a box around the click.
  const video = friend.page.locator('.seat', { hasText: 'Host' }).getByTestId('seat-video');
  const nearCorner = await onPicture(video, 0.54, 0.36);
  await friend.page.mouse.click(nearCorner.x, nearCorner.y);

  // Outlined on the video, and shown beside the table with which card it is.
  await expect(friend.page.getByTestId('card-outline')).toBeVisible();
  const lookup = friend.page.getByTestId('card-rail').getByTestId('lookup');
  await expect(lookup.getByTestId('lookup-name')).toHaveText('Rhystic Study', { timeout: 30_000 });
  await expect(lookup).toContainText('Likely');
  await expect(friend.page.getByTestId('card-outline')).toContainText('Rhystic Study');
  // What their camera saw: the whole card, cut out and straightened.
  const photo = lookup.locator('img[alt="Host\'s camera"]').first();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalHeight / img.naturalWidth))
    .toBeCloseTo(88 / 63, 1);
  await friend.page.screenshot({ path: test.info().outputPath('close-up.png') });

  // Known for sure, but only on the battlefield once it's put there.
  const put = lookup.getByRole('button', { name: 'Put Rhystic Study on the battlefield' });
  await expect(put).toBeEnabled();
  // The cards on the videos are hidden at first (B shows them). Put there, it's shown as the card, as big as the card
  // the close-up found there.
  await friend.page.keyboard.press('b');
  await put.click();
  await expect(lookup.getByRole('button', { name: 'Rhystic Study is on the battlefield' })).toBeDisabled();
  const found = (await friend.page.locator('polygon.card-outline-line').boundingBox())!;
  const shown = friend.page.getByTestId('board-card');
  await expect.poll(async () => ((await shown.boundingBox())?.width ?? 0) / found.width).toBeGreaterThan(0.9);
  expect((await shown.boundingBox())!.width / found.width).toBeLessThan(1.1);

  // On the host's battlefield, for everyone: with the cards on the videos shown, on the video where it is.
  await host.page.keyboard.press('b');
  const label = host.page.getByTestId('board-card');
  await expect(label).toHaveAccessibleName('Rhystic Study');
  // Shown as the card, like a token, not as a label.
  await expect(label).toHaveClass(/board-virtual/);
  await expect(label).not.toHaveAttribute('data-virtual');
  // The friend found it: the host gets it suggested for their Cards seen.
  await expect(host.page.getByTestId('seen-suggestions')).toHaveText('1');
  await host.page.getByTestId('seen-toggle').click();
  const suggested = host.page.getByTestId('card-rail').getByRole('region', { name: 'Suggested' });
  await expect(suggested).toContainText('Rhystic Study');
  await expect(suggested).toContainText('Friend found it on your battlefield');
  await suggested.getByRole('button', { name: 'Let Rhystic Study go' }).click();
  await expect(host.page.getByTestId('card-rail')).toHaveCount(0);
  await expect(host.page.getByTestId('seen-toggle')).toHaveCount(0);
  const ownVideo = host.page.locator('.seat', { hasText: 'Host (you)' }).getByTestId('seat-video');
  const middle = await onPicture(ownVideo, 0.5, 0.5);
  const labelAt = await centerOf(label);
  expect(Math.abs(labelAt.x - middle.x)).toBeLessThan(30);
  expect(Math.abs(labelAt.y - middle.y)).toBeLessThan(30);
  await host.page.getByRole('button', { name: "Host's details" }).click();
  await expect(host.page.getByTestId('permanent-Rhystic Study')).toBeVisible();
  await host.page.getByTestId('seat-details-0').getByRole('button', { name: 'Close' }).click();

  // Its text and rulings.
  await lookup.getByRole('button', { name: 'Details' }).click();
  await expect(friend.page.getByTestId('cards-panel')).toContainText('Whenever an opponent casts a spell');
  await friend.page.getByTestId('cards-panel').getByRole('button', { name: 'Close' }).click();

  // Saying it's another card, by searching for it; then back to the guess with its button.
  await lookup.getByRole('button', { name: 'Search…' }).click();
  const search = friend.page.getByTestId('cards-panel');
  await expect(search).toContainText('Which card is it?');
  await search.getByLabel('Search for a card').fill('sol ring');
  await search.getByRole('button', { name: "It's this card" }).click();
  await expect(search).toHaveCount(0);
  await expect(lookup.getByTestId('lookup-name')).toHaveText('Sol Ring');
  await expect(lookup).toContainText('Your pick');
  // On the battlefield, it's that card now too.
  await expect(label).toHaveAccessibleName('Sol Ring');
  await lookup.getByTestId('lookup-others').getByRole('button', { name: 'Rhystic Study' }).click();
  await expect(lookup.getByTestId('lookup-name')).toHaveText('Rhystic Study');
  await expect(label).toHaveAccessibleName('Rhystic Study');

  // Shown over itself on the video, the card is Alt+clicked for what can be done with it. To look at it again, the
  // cards on the videos go out of the way first (B).
  await shown.click({ modifiers: ['Alt'] });
  await expect(friend.page.getByRole('group', { name: 'Rhystic Study: what to do' })).toBeVisible();
  await shown.click({ modifiers: ['Alt'] });
  await friend.page.keyboard.press('b');
  await expect(shown).toHaveCount(0);

  // Another look at the same card: it's the newest again, not in the list twice.
  const lower = await onPicture(video, 0.5, 0.6);
  await friend.page.mouse.click(lower.x, lower.y);
  const rail = friend.page.getByTestId('card-rail');
  await expect(lookup.getByTestId('lookup-name')).toHaveText('Rhystic Study', { timeout: 30_000 });
  await expect(rail.getByRole('region', { name: 'Earlier' })).toHaveCount(0);
  // Put on the battlefield again: the same card, one of a kind, so it's still the one there, moved where it was
  // clicked.
  await put.click();
  await expect(lookup.getByRole('button', { name: 'Rhystic Study is on the battlefield' })).toBeDisabled();
  await expect(host.page.getByTestId('board-card')).toHaveCount(1);

  // Or a box drawn around the card (Ctrl+drag): just that, when a click would pick the wrong thing.
  const topLeft = await onPicture(video, 0.41, 0.28);
  const bottomRight = await onPicture(video, 0.59, 0.72);
  await friend.page.keyboard.down('Control');
  await friend.page.mouse.move(topLeft.x, topLeft.y);
  await friend.page.mouse.down();
  await friend.page.mouse.move(bottomRight.x, bottomRight.y, { steps: 6 });
  await expect(friend.page.getByTestId('area-preview')).toBeVisible();
  await friend.page.mouse.up();
  await friend.page.keyboard.up('Control');
  await expect(friend.page.getByTestId('area-preview')).toHaveCount(0);
  await expect(lookup.getByTestId('lookup-name')).toHaveText('Rhystic Study', { timeout: 30_000 });
  await expect(rail.getByRole('region', { name: 'Earlier' })).toHaveCount(0);
  await expect(host.page.getByTestId('arrow')).toHaveCount(0);
  // The cards on the videos back.
  await friend.page.keyboard.press('b');
  await expect(shown).toHaveCount(1);

  // Out of the way and back.
  await rail.getByRole('button', { name: 'Hide cards seen' }).click();
  await expect(rail).toHaveCount(0);
  await friend.page.getByTestId('seen-toggle').click();
  await expect(friend.page.getByTestId('card-rail')).toBeVisible();
  // Your own cards too, straight from your own camera. The card is shown over itself on the video (clicked, it's what
  // can be done with it), so the cards on the videos go out of the way first (B).
  await host.page.keyboard.press('b');
  await expect(host.page.getByTestId('board-card')).toHaveCount(0);
  const own = host.page.locator('.seat', { hasText: 'Host (you)' }).getByTestId('seat-video');
  const ownSpot = await onPicture(own, 0.5, 0.45);
  await host.page.mouse.click(ownSpot.x, ownSpot.y);
  const ownLookup = host.page.getByTestId('card-rail').getByTestId('lookup');
  await expect(ownLookup.getByTestId('lookup-name')).toHaveText('Rhystic Study', { timeout: 30_000 });
  await expect(ownLookup).toContainText('Your camera');

  // Into the graveyard, from Cards seen: off the battlefield, and out of the list.
  await ownLookup.getByRole('button', { name: 'Put Rhystic Study in the graveyard' }).click();
  await expect(host.page.getByTestId('card-rail')).toHaveCount(0);
  await expect(friend.page.getByTestId('board-card')).toHaveCount(0);
  await expect(friend.page.getByTestId('last-change')).toHaveText('Host put Rhystic Study in their graveyard');

  // Cards the host casts come in too, newest first.
  const cardsPanel = host.page.getByTestId('cards-panel');
  for (const [search, name] of [
    ['sol ring', 'Sol Ring'],
    ['demonic', 'Demonic Consultation'],
  ]) {
    await host.page.getByRole('button', { name: 'Cards', exact: true }).click();
    await cardsPanel.getByLabel('Search for a card').fill(search!);
    await cardsPanel.getByRole('button', { name: name! }).click();
    await cardsPanel.getByRole('button', { name: 'Cast it' }).click();
    await expect(lookup.getByTestId('lookup-name')).toHaveText(name!);
    await friend.page.getByTestId('spotlight').getByRole('button', { name: 'Close' }).click();
  }

  // Cards from two players: everyone's, or just one player's.
  const friendOwn = friend.page.locator('.seat', { hasText: 'Friend (you)' }).getByTestId('seat-video');
  const friendSpot = await onPicture(friendOwn, 0.5, 0.5);
  await friend.page.mouse.click(friendSpot.x, friendSpot.y);
  const earlier = rail.getByRole('region', { name: 'Earlier' });
  await expect(earlier.locator('.lookup-row')).toHaveCount(3);
  const whose = rail.getByRole('group', { name: 'Whose cards' });
  await whose.getByRole('button', { name: 'Host' }).click();
  await expect(lookup.getByTestId('lookup-name')).toHaveText('Demonic Consultation');
  await expect(earlier.locator('.lookup-row')).toHaveCount(2);
  await whose.getByRole('button', { name: 'You' }).click();
  await expect(lookup).toContainText('Your camera');
  await expect(earlier).toHaveCount(0);
  await whose.getByRole('button', { name: 'All' }).click();
  await expect(earlier.locator('.lookup-row')).toHaveCount(3);

  // Taken out of the list one at a time, or all at once.
  await earlier.getByRole('button', { name: 'Remove Rhystic Study' }).first().click();
  await expect(earlier.locator('.lookup-row')).toHaveCount(2);
  await lookup.getByRole('button', { name: /^Remove / }).click();
  await expect(whose).toHaveCount(0);
  await expect(lookup.getByTestId('lookup-name')).toHaveText('Demonic Consultation');
  await expect(earlier.locator('.lookup-row')).toHaveCount(1);
  await earlier.getByRole('button', { name: 'Remove all' }).click();
  await expect(friend.page.getByTestId('card-rail')).toHaveCount(0);
  await expect(friend.page.getByTestId('seen-toggle')).toHaveCount(0);
});

test('on the battlefield, on the videos: tokens, counters and notes, moved, put on cards and taken away', async () => {
  const { host, friend } = await hostAndFriend();
  await cardsReady(friend.page);
  await expectVideoFrom(host.page, 'Friend');
  const seatVideo = (page: Page, name: string) => page.locator('.seat', { hasText: name }).getByTestId('seat-video');

  // Three Soldier tokens on the host's battlefield, from the friend's screen.
  const hostSeat = friend.page.locator('.seat', { hasText: 'Host' });
  await hostSeat.hover();
  await hostSeat.getByRole('button', { name: "Add to Host's battlefield" }).click();
  const add = friend.page.getByRole('dialog', { name: "Add to Host's battlefield" });
  await add.getByRole('button', { name: 'Token' }).click();
  await friend.page.screenshot({ path: test.info().outputPath('token-picker.png') });
  // Common tokens are offered before anything is typed.
  await add.getByLabel('How many tokens').fill('3');
  await add.getByRole('button', { name: '1/1 Soldier' }).click();
  // The cards on the videos are hidden at first: the seat lists them. Shown (B), a token is the card itself.
  await expect(friend.page.getByTestId('chips-0')).toContainText('Soldier ×3');
  await expect(friend.page.getByTestId('board-card')).toHaveCount(0);
  await friend.page.keyboard.press('b');
  await expect(friend.page.getByTestId('board-card')).toHaveAccessibleName('Soldier');
  await expect(friend.page.getByTestId('board-card')).toHaveAttribute('data-virtual', 'true');
  await expect(friend.page.getByTestId('board-card')).toContainText('×3');

  // The host Alt+clicks a spot on their own video for a +1/+1 counter: there for the friend too. A counter is only
  // seen on the videos, so they're shown for the host now too.
  const tokens = host.page.getByTestId('board-card');
  await expect(tokens).toHaveCount(0);
  await host.page.keyboard.down('Alt');
  const spot = await onPicture(seatVideo(host.page, 'Host (you)'), 0.3, 0.3);
  await host.page.mouse.click(spot.x, spot.y);
  await host.page.keyboard.up('Alt');
  const hostAdd = host.page.getByRole('dialog', { name: 'Add to your battlefield' });
  await hostAdd.getByRole('button', { name: 'Counter' }).click();
  await hostAdd.getByRole('button', { name: '+1/+1' }).click();
  await expect(host.page.getByTestId('board-marker')).toHaveAccessibleName('1 +1/+1 counters');
  await expect(tokens).toHaveAccessibleName('Soldier');
  const counter = friend.page.getByTestId('board-marker');
  await expect(counter).toHaveAccessibleName('1 +1/+1 counters');
  const counterAt = await centerOf(counter);
  const expected = await onPicture(seatVideo(friend.page, 'Host'), 0.3, 0.3);
  expect(Math.abs(counterAt.x - expected.x)).toBeLessThan(4);
  expect(Math.abs(counterAt.y - expected.y)).toBeLessThan(4);
  // The wheel counts it up; scrolling sideways doesn't count it down.
  await counter.hover();
  await friend.page.mouse.wheel(100, 0);
  await friend.page.mouse.wheel(0, -100);
  await expect(host.page.getByTestId('board-marker')).toHaveAccessibleName('2 +1/+1 counters');

  // Dragged from, it's an arrow, and it stays where it is. Alt+dragged onto the tokens, they're the tokens' counters.
  const onto = await centerOf(friend.page.getByTestId('board-card'));
  const dragCounter = async () => {
    await friend.page.mouse.move(counterAt.x, counterAt.y);
    await friend.page.mouse.down();
    await friend.page.mouse.move(onto.x, onto.y, { steps: 8 });
    await friend.page.mouse.up();
  };
  await dragCounter();
  await expect(host.page.getByTestId('arrow')).toHaveCount(1);
  await expect(host.page.getByTestId('board-marker')).toHaveCount(1);
  await friend.page.keyboard.down('Alt');
  await dragCounter();
  await friend.page.keyboard.up('Alt');
  await expect(host.page.getByTestId('board-marker')).toHaveCount(0);
  await expect(tokens).toContainText('2 +1/+1');

  // A note, and Del with the pointer on it takes it away.
  await hostSeat.hover();
  await hostSeat.getByRole('button', { name: "Add to Host's battlefield" }).click();
  await add.getByRole('button', { name: 'Note' }).click();
  await add.getByRole('button', { name: 'Attacking' }).click();
  const note = host.page.getByTestId('board-marker');
  await expect(note).toHaveAccessibleName('Note: Attacking');
  // Alt+clicked: what can be done with it.
  await friend.page.getByTestId('board-marker').click({ modifiers: ['Alt'] });
  await expect(friend.page.getByRole('group', { name: '“Attacking”: what to do' })).toBeVisible();
  await friend.page.getByTestId('board-marker').hover();
  await friend.page.keyboard.press('Delete');
  await expect(note).toHaveCount(0);

  // Clicked, it's in Cards seen, the newest; Alt+clicked, what can be done with it. Tap one.
  await friend.page.getByTestId('board-card').click();
  const seen = friend.page.getByTestId('card-rail').getByTestId('lookup');
  await expect(seen.getByTestId('lookup-name')).toHaveText('Soldier');
  await expect(seen).toContainText("On Host's battlefield");
  await expect(friend.page.getByRole('group', { name: 'Soldier: what to do' })).toHaveCount(0);
  await friend.page.getByTestId('board-card').click({ modifiers: ['Alt'] });
  await friend.page
    .getByRole('group', { name: 'Soldier: what to do' })
    .getByRole('button', { name: 'Tap one Soldier', exact: true })
    .click();
  await expect(tokens).toContainText('1 tapped');
  // A token isn't a card to put in a graveyard.
  await expect(
    friend.page.getByRole('group', { name: 'Soldier: what to do' }).getByRole('button', { name: 'Graveyard' }),
  ).toHaveCount(0);
  await friend.page.screenshot({ path: test.info().outputPath('battlefield.png') });
  // Another card comes into Cards seen; clicked again, the token is the newest again, not in the list twice.
  await friend.page.getByRole('button', { name: 'Cards', exact: true }).click();
  const cardsPanel = friend.page.getByTestId('cards-panel');
  await cardsPanel.getByLabel('Search for a card').fill('sol ring');
  await cardsPanel.getByRole('button', { name: 'Sol Ring' }).click();
  await cardsPanel.getByRole('button', { name: 'Cast it' }).click();
  await friend.page.getByTestId('spotlight').getByRole('button', { name: 'Close' }).click();
  await expect(seen.getByTestId('lookup-name')).toHaveText('Sol Ring');
  await friend.page.getByTestId('board-card').click();
  await expect(seen.getByTestId('lookup-name')).toHaveText('Soldier');
  const earlierSeen = friend.page.getByTestId('card-rail').getByRole('region', { name: 'Earlier' });
  await expect(earlierSeen.locator('.lookup-row')).toHaveCount(1);
  await expect(earlierSeen).toContainText('Sol Ring');

  // Pointed at like the video under it, for everyone: an arrow from it, an arrow to it, and a ping on it.
  await expect(host.page.getByTestId('arrow')).toHaveCount(0, { timeout: 10_000 });
  const token = await centerOf(friend.page.getByTestId('board-card'));
  const elsewhere = await onPicture(seatVideo(friend.page, 'Friend (you)'), 0.5, 0.5);
  const arrow = async (start: { x: number; y: number }, end: { x: number; y: number }) => {
    await friend.page.mouse.move(start.x, start.y);
    await friend.page.mouse.down();
    await friend.page.mouse.move(end.x, end.y, { steps: 8 });
    await friend.page.mouse.up();
  };
  await arrow(token, elsewhere);
  await arrow(elsewhere, token);
  await expect(host.page.getByTestId('arrow')).toHaveCount(2);
  await friend.page.getByTestId('board-card').click({ button: 'right' });
  await expect(host.page.getByTestId('ping')).toHaveCount(1);
  // Not moved by any of it.
  await expect
    .poll(async () => Math.round(Math.abs((await centerOf(friend.page.getByTestId('board-card'))).x - token.x)))
    .toBe(0);

  // Alt+dragged to where it is now, for everyone.
  const from = await centerOf(friend.page.getByTestId('board-card'));
  const to = await onPicture(seatVideo(friend.page, 'Host'), 0.8, 0.7);
  await friend.page.keyboard.down('Alt');
  await friend.page.mouse.move(from.x, from.y);
  await friend.page.mouse.down();
  await friend.page.mouse.move(to.x, to.y, { steps: 8 });
  await friend.page.mouse.up();
  await friend.page.keyboard.up('Alt');
  const moved = await onPicture(seatVideo(host.page, 'Host (you)'), 0.8, 0.7);
  await expect.poll(async () => Math.round(Math.abs((await centerOf(tokens)).x - moved.x) / 4)).toBe(0);

  // Out of the way with one setting: the seat lists them instead.
  await friend.page.getByRole('button', { name: 'Menu' }).click();
  await friend.page.getByRole('menuitemcheckbox', { name: 'Cards and counters on the videos' }).click();
  await friend.page.keyboard.press('Escape');
  await expect(friend.page.getByTestId('board-card')).toHaveCount(0);
  await expect(friend.page.getByTestId('chips-0')).toContainText('Soldier ×3');
  await expect(tokens).toHaveCount(1);
});

test("a player's graveyard: cards put there from the battlefield or by hand, searched, and returned", async () => {
  const { host, friend } = await hostAndFriend();
  await cardsReady(friend.page);

  // Sol Ring on the host's battlefield, then into their graveyard.
  const hostSeat = friend.page.locator('.seat', { hasText: 'Host' });
  await hostSeat.hover();
  await hostSeat.getByRole('button', { name: "Add to Host's battlefield" }).click();
  const add = friend.page.getByRole('dialog', { name: "Add to Host's battlefield" });
  await add.getByRole('button', { name: 'Card' }).click();
  await add.getByLabel('Card', { exact: true }).fill('sol ring');
  await add.getByRole('button', { name: 'Sol Ring' }).click();
  await friend.page.keyboard.press('b');
  await friend.page.getByTestId('board-card').click({ modifiers: ['Alt'] });
  await friend.page
    .getByRole('group', { name: 'Sol Ring: what to do' })
    .getByRole('button', { name: 'Graveyard' })
    .click();
  await expect(friend.page.getByTestId('board-card')).toHaveCount(0);

  // Looked through by anyone: the host opens it from their details.
  await host.page.getByRole('button', { name: "Host's details" }).click();
  await host.page.getByTestId('seat-details-0').getByRole('button', { name: 'Graveyard (1)' }).click();
  const graveyard = host.page.getByRole('dialog', { name: "Host's graveyard" });
  const list = graveyard.getByTestId('graveyard-list');
  await expect(list).toContainText('Sol Ring');
  await expect(list).toContainText('Artifact');

  // Put in by hand too, and searched by type.
  await graveyard.getByLabel('Put a card in the graveyard').fill('rhystic');
  await graveyard.getByRole('button', { name: 'Rhystic Study' }).click();
  await expect(list.locator('li')).toHaveCount(2);
  await graveyard.getByLabel('Search the graveyard').fill('artifact');
  await expect(list.locator('li')).toHaveCount(1);
  await graveyard.getByLabel('Search the graveyard').fill('enchant');
  await expect(list).toContainText('Rhystic Study');
  await expect(list.locator('li')).toHaveCount(1);

  // Back to the battlefield.
  await graveyard.getByLabel('Search the graveyard').fill('');
  await graveyard.getByRole('button', { name: 'Return Sol Ring' }).click();
  await expect(list.locator('li')).toHaveCount(1);
  await expect(friend.page.getByTestId('last-change')).toHaveText(
    'Host: Sol Ring back from the graveyard to the battlefield',
  );
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

test('"Wait, I have a response!" on every screen until someone says it\'s resolved', async () => {
  const { host, friend } = await hostAndFriend();

  await friend.page.keyboard.press('w');

  const call = host.page.getByTestId('call');
  await expect(call).toHaveText(/^Friend: “Wait, I have a response!”\s*Resolved$/);
  await expect(host.page.locator('.seat-responding')).toContainText('Friend');
  await host.page.screenshot({ path: test.info().outputPath('response.png') });
  await expect(friend.page.getByTestId('call')).toContainText('You asked everyone to wait');
  // No calling again right away, and nothing to undo: it's not a change to the game.
  await expect(friend.page.getByRole('button', { name: 'Wait!' })).toBeDisabled();
  await expect(friend.page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(host.page.getByTestId('last-change')).toHaveText('Friend: “Wait, I have a response!”');

  // It doesn't get in the way of the buttons under it, and doesn't go by itself.
  await host.page.getByRole('button', { name: 'Random turn order' }).click();
  await expect(host.page.getByTestId('last-change')).toContainText('shuffled the turn order');
  await expect(friend.page.getByRole('button', { name: 'Wait!' })).toBeEnabled({ timeout: 5_000 });
  await host.page.waitForTimeout(8_500);
  await expect(call).toHaveCount(1);
  await expect(friend.page.getByTestId('call')).toHaveCount(1);

  await call.getByRole('button', { name: 'Resolved' }).click();
  await expect(friend.page.getByTestId('call')).toHaveCount(0);
  await expect(friend.page.getByTestId('last-change')).toHaveText("Host resolved Friend's wait");
  await expect(host.page.locator('.seat-responding')).toHaveCount(0);
});

test("stops on someone else's phase, and trigger reminders", async () => {
  const { host, friend } = await hostAndFriend();
  await host.page.getByRole('button', { name: 'Set the order…' }).click();
  await host.page.getByRole('dialog', { name: 'Turn order' }).getByRole('button', { name: 'Host goes first' }).click();
  await expect(friend.page.getByTestId('turn')).toContainText("Host's turn");

  // The friend asks the host to stop at combat. Only the friend sees it coming.
  await friend.page.getByTestId('phases').getByRole('button', { name: 'Stop at combat' }).click();
  await expect(friend.page.getByTestId('phases').getByTestId('phase-stop')).toHaveCount(1);
  await expect(friend.page.getByTestId('phases').getByRole('button', { name: "Don't stop at combat" })).toBeVisible();
  await expect(host.page.getByTestId('last-change')).not.toContainText('stop');
  await expect(host.page.getByTestId('phases').getByTestId('phase-stop')).toHaveCount(0);

  // Passing the turn ends at combat instead, until the stop is resolved.
  await host.page.keyboard.press('Space');
  await expect(host.page.getByTestId('phases').locator('.phase-current')).toHaveText('Combat');
  await expect(host.page.getByTestId('turn')).toContainText('Your turn');
  await expect(host.page.getByTestId('call')).toContainText('Friend asked to stop at your combat');
  await expect(friend.page.getByTestId('call')).toContainText("You asked to stop at Host's combat");
  await host.page.keyboard.press('Space');
  const unresolved = host.page.getByRole('dialog', { name: 'Not resolved yet' });
  await expect(unresolved).toContainText('Friend asked to stop at your combat');
  // On top of everything, the calls in the middle of the table too: nothing covers its buttons.
  const covered = await unresolved.evaluate((dialog) =>
    [...dialog.querySelectorAll('button')].flatMap((button) => {
      const box = button.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top && button.contains(top) ? [] : [button.textContent];
    }),
  );
  expect(covered).toEqual([]);
  // And the call shows behind the dialog's backdrop, not over it. (It lets clicks through, so for finding what's
  // on top it's made to catch them for a moment.)
  const callOnTop = await host.page.getByTestId('call').evaluate((call) => {
    const calls = call.closest<HTMLElement>('.calls')!;
    calls.style.pointerEvents = 'auto';
    const box = call.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    calls.style.pointerEvents = '';
    return top !== null && calls.contains(top);
  });
  expect(callOnTop).toBe(false);
  await unresolved.getByRole('button', { name: 'Keep waiting' }).click();
  await expect(unresolved).toHaveCount(0);
  await friend.page.getByTestId('call').getByRole('button', { name: 'Resolved' }).click();
  await expect(host.page.getByTestId('call')).toHaveCount(0);

  // A reminder on every upkeep, set by the host: it comes up when the friend's turn starts.
  await host.page.getByRole('button', { name: /^Reminders/ }).click();
  const reminders = host.page.getByRole('dialog', { name: 'Reminders' });
  await reminders.getByLabel('Phase').selectOption('upkeep');
  await reminders.getByLabel('Reminder text').fill('Rhystic Study: pay 1?');
  await reminders.getByLabel("My opponents'").check();
  await expect(reminders.getByLabel("Friend's")).toBeChecked();
  await expect(reminders.getByLabel("Everyone's")).not.toBeChecked();
  await expect(reminders.getByLabel('Until removed')).toBeChecked();
  await host.page.screenshot({ path: test.info().outputPath('reminder-form.png') });
  await reminders.getByRole('button', { name: 'Add the reminder' }).click();
  await expect(friend.page.getByRole('button', { name: 'Reminders (1)' })).toBeVisible();
  await host.page.keyboard.press('Space');
  await expect(friend.page.getByTestId('turn')).toContainText('Your turn');
  await expect(friend.page.getByTestId('call')).toHaveText(
    /Reminder \(your upkeep\): Rhystic Study: pay 1\? · set by Host/,
  );
  await friend.page.screenshot({ path: test.info().outputPath('reminder.png') });

  // Moving on with it open: asked first, and going on resolves it.
  await friend.page.keyboard.press('Control+Space');
  await friend.page
    .getByRole('dialog', { name: 'Not resolved yet' })
    .getByRole('button', { name: 'Resolve and go on' })
    .click();
  await expect(host.page.getByTestId('phases').locator('.phase-current')).toHaveText('Draw');
  await expect(host.page.getByTestId('call')).toHaveCount(0);

  // Taken away again.
  await friend.page.getByRole('button', { name: 'Reminders (1)' }).click();
  await friend.page
    .getByRole('dialog', { name: 'Reminders' })
    .getByRole('button', { name: "Take away the reminder for Friend's upkeep" })
    .click();
  await expect(host.page.getByRole('button', { name: 'Reminders', exact: true })).toBeVisible();
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
  await expect(friend.page.getByTestId('card-rail')).toHaveCount(0);

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
    await expect(page.getByTestId('clock')).toContainText(/(2:00|1:5\d)/);
    await expect(page.getByTestId('phases').locator('.phase-current')).toHaveText('Upkeep');
  }

  // The active player moves on (Ctrl+Space: the next phase); everyone sees where they are.
  await active.page.keyboard.press('Control+Space');
  await expect(other.page.getByTestId('phases').locator('.phase-current')).toHaveText('Draw');
  // Space and Ctrl+Space do nothing on someone else's turn.
  await other.page.keyboard.press('Space');
  await other.page.keyboard.press('Control+Space');
  await expect(active.page.getByTestId('turn')).toContainText('Your turn');
  await expect(active.page.getByTestId('phases').locator('.phase-current')).toHaveText('Draw');
  // Only the active player moves the turn along; the others can only ask them to stop at a phase still to come.
  await expect(other.page.getByTestId('phases').getByRole('button')).toHaveCount(4);
  await expect(other.page.getByTestId('phases').getByRole('button', { name: /^Stop at / })).toHaveCount(4);

  // "Wait, I have a response!" stops the clock until it's resolved: moving on asks first.
  await other.page.keyboard.press('w');
  await expect(active.page.getByTestId('clock')).toContainText('Paused');
  const paused = await active.page.getByTestId('clock').textContent();
  await active.page.waitForTimeout(1_500);
  await expect(active.page.getByTestId('clock')).toHaveText(paused!);
  await active.page.getByTestId('phases').getByRole('button', { name: 'Combat' }).click();
  await active.page
    .getByRole('dialog', { name: 'Not resolved yet' })
    .getByRole('button', { name: 'Resolve and go on' })
    .click();
  await expect(other.page.getByTestId('clock')).not.toContainText('Paused');
  await expect(other.page.getByTestId('phases')).toContainText('Attackers');
  await other.page.screenshot({ path: test.info().outputPath('turn.png') });

  // Next turn (Space passes it): the other player's, from the upkeep, with a fresh two minutes. Space doesn't
  // also press the button clicked last.
  const activeSeat = hostFirst ? 0 : 1;
  await active.page.getByTestId(`life-${activeSeat}`).getByRole('button', { name: 'Lose 1 life' }).click();
  await active.page.keyboard.press('Space');
  await expect(other.page.getByTestId('turn')).toContainText('Your turn');
  await expect(other.page.getByTestId('phases').locator('.phase-current')).toHaveText('Upkeep');
  await expect(other.page.getByTestId('clock')).toContainText(/(2:00|1:5\d)/);
  await expect(other.page.getByTestId(`life-total-${activeSeat}`)).toHaveText('39');

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
  await markers.getByRole('button', { name: 'Monarch' }).click();
  await markers.getByRole('button', { name: 'Initiative' }).click();
  const hostChips = host.page.getByTestId('chips-0');
  await expect(hostChips).toContainText('Monarch');
  await expect(hostChips).toContainText('Initiative');
  // They don't get in the way of the video: clicks go through, and after a few seconds they're just icons.
  await expect(hostChips).toHaveCSS('pointer-events', 'none');
  await expect(hostChips.locator('.chip-monarch')).toHaveClass(/chip-collapsed/, { timeout: 6_000 });
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
  await host.page
    .getByRole('group', { name: 'Day or night' })
    .getByRole('button', { name: 'Day', exact: true })
    .click();
  await host.page.getByRole('button', { name: 'Add 1 to the storm count' }).click();
  await host.page.getByRole('button', { name: 'Done' }).click();
  const bar = friend.page.getByTestId('table-counters');
  await expect(bar.getByTestId('day-night')).toHaveText('Day');
  await expect(bar).toContainText('Storm count');
  await bar.getByTestId('day-night').click();
  await expect(host.page.getByTestId('day-night')).toHaveText('Night');

  // The storm count is for one turn: the first turn starts it over.
  await host.page.getByRole('button', { name: 'Random turn order' }).click();
  await expect(bar).not.toContainText('Storm count');
});

test('dice, coin flips and random picks, rolled by the host and shown to everyone', async () => {
  const { host, friend } = await hostAndFriend();

  await friend.page.getByRole('button', { name: 'Roll', exact: true }).click();
  await friend.page.getByRole('menuitem', { name: 'd20' }).click();
  const banner = host.page.getByTestId('roll-banner');
  await expect(banner).toHaveText(/Friend rolled a d20: ([1-9]|1[0-9]|20)$/);
  const roll = await banner.textContent();
  // The same result for everyone.
  await expect(friend.page.getByTestId('roll-banner')).toHaveText(roll!);

  await host.page.getByRole('button', { name: 'Roll', exact: true }).click();
  await host.page.getByLabel('How many dice').fill('3');
  await host.page.getByLabel('Sides').fill('6');
  await host.page.locator('.custom-roll').getByRole('button', { name: 'Roll' }).click();
  await expect(friend.page.getByTestId('roll-banner')).toContainText(/Host rolled 3d6: \d, \d, \d \(\d+\)/);

  await host.page.getByRole('button', { name: 'Roll', exact: true }).click();
  await host.page.getByRole('menuitem', { name: 'Random opponent' }).click();
  await expect(friend.page.getByTestId('roll-banner')).toContainText('Host picked a random opponent: Friend');
  await friend.page.screenshot({ path: test.info().outputPath('rolls.png') });

  await friend.page.getByRole('button', { name: 'Roll', exact: true }).click();
  await friend.page.getByRole('menuitem', { name: 'Flip a coin' }).click();
  await expect(host.page.getByTestId('roll-banner')).toContainText(/Friend flipped a coin: (heads|tails)/);
  // In the log too, and nothing to undo.
  await expect(friend.page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  // In the smallest window, the menu stays inside it, though Roll is near the window's left edge.
  await friend.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 600));
  await expect.poll(() => friend.page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(900);
  await friend.page.getByRole('button', { name: 'Roll', exact: true }).click();
  const menu = (await friend.page.getByRole('menu').boundingBox())!;
  const view = await friend.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(view.width);
  expect(menu.y + menu.height).toBeLessThanOrEqual(view.height);
  await expect(friend.page.getByRole('menuitem', { name: 'Random player' })).toBeVisible();
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

  // Their tokens untap when their turn starts: pass turns until it's the host's (not the first one, if it's theirs).
  await host.page.getByRole('button', { name: 'Random turn order' }).click();
  await expect(host.page.getByTestId('turn')).toBeVisible();
  if ((await host.page.getByTestId('turn').textContent())!.includes('Your turn')) {
    await host.page.getByRole('button', { name: 'Pass turn' }).click();
    await expect(friend.page.getByTestId('turn')).toContainText('Your turn');
  }
  await friend.page.getByRole('button', { name: 'Pass turn' }).click();
  await expect(host.page.getByTestId('turn')).toContainText('Your turn');
  await expect(chips).toContainText('Goblin ×3');
  await expect(chips).not.toContainText('tapped');
});

test('straightening a camera that looks at the table at an angle', async () => {
  const { host, friend } = await hostAndFriend();
  const shapeOf = (video: ReturnType<Page['locator']>) =>
    video.evaluate((v: HTMLVideoElement) => v.videoWidth / v.videoHeight);

  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'Camera' }).click();
  await host.page.getByRole('button', { name: 'Straighten the view' }).click();
  // The playmat's corners, as the camera sees it from an angle: the corners are dragged there, one is clicked
  // near (the nearest corner moves there), and one is fine-tuned with the arrow keys.
  const frame = host.page.getByTestId('corner-frame');
  await expect(frame).toBeInViewport({ ratio: 1 });
  const box = (await frame.boundingBox())!;
  const at = (x: number, y: number) => [box.x + x * box.width, box.y + y * box.height] as const;
  const drag = async (corner: string, x: number, y: number) => {
    const handle = (await frame.getByRole('button', { name: corner }).boundingBox())!;
    await host.page.mouse.move(handle.x + handle.width / 2 + 2, handle.y + handle.height / 2 + 2);
    await host.page.mouse.down();
    await host.page.mouse.move(...at(x, y), { steps: 8 });
    // A magnifier shows the picture around the corner while it's dragged.
    await expect(frame.locator('.corner-loupe')).toBeVisible();
    await host.page.mouse.up();
  };
  await drag('Top left corner', 0.2, 0.2);
  await drag('Bottom left corner', 0.1, 0.85);
  await frame.click({ position: { x: 0.85 * box.width, y: 0.9 * box.height } });
  await drag('Top right corner', 0.74, 0.15);
  await frame.getByRole('button', { name: 'Top right corner' }).focus();
  for (let i = 0; i < 5; i++) await host.page.keyboard.press('ArrowRight');
  await expect(frame.locator('.corner-loupe')).toHaveCount(0);
  await host.page.getByRole('button', { name: 'Straighten', exact: true }).click();
  await expect(host.page.getByText('Straightened to your playmat.')).toBeVisible();
  await host.page.getByRole('button', { name: 'Done' }).click();

  // The others get the straight picture: a playmat's shape (24 by 14).
  const hostVideo = friend.page.locator('.seat', { hasText: 'Host' }).getByTestId('seat-video');
  await expect.poll(() => shapeOf(hostVideo), { timeout: 15_000 }).toBeCloseTo(24 / 14, 1);
  await expectVideoFrom(friend.page, 'Host');
  await friend.page.screenshot({ path: test.info().outputPath('straightened.png') });

  const hostId = await ownMemberId(host.page);
  for (const crop of [
    { x: -0.5, y: 0, width: 1, height: 1 },
    { x: 0.5, y: 0.5, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 0.5 },
  ]) {
    await expect(craftedSnapshot(friend.page, hostId, crop)).resolves.toMatchObject({ kind: 'error' });
  }

  // A close-up of the straight picture comes from the camera, straightened the same way.
  await hostVideo.click();
  await expect(friend.page.getByTestId('lookup').locator('img[alt="Host\'s camera"]').first()).toBeVisible({
    timeout: 20_000,
  });

  // Not straightening any more: back to the camera's own shape.
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'Camera' }).click();
  await host.page.getByRole('button', { name: "Don't straighten" }).click();
  await expect.poll(() => shapeOf(hostVideo), { timeout: 15_000 }).not.toBeCloseTo(24 / 14, 1);
});

test('how sharp the video sent to the others is, apart from how sharp the camera films; your own stats', async () => {
  const { host, friend } = await hostAndFriend();
  await expectVideoFrom(host.page, 'Friend');
  for (const { page } of [host, friend]) {
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show stats' }).click();
    await page.keyboard.press('Escape');
  }
  // Your own seat: what your camera films, and what you send.
  const own = host.page.getByTestId('own-stats');
  await expect(own).toContainText('Camera 1920×1080');
  await expect(own).toContainText(/↑ \d+×\d+ · \d+ fps · [\d.]+ Mbps to 1/, { timeout: 10_000 });

  // 480p sent: the friend gets a smaller picture, while the camera still films at 1080p for close-ups.
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'Camera' }).click();
  await expect(
    host.page.getByText('What the camera films and what the others watch can, and should, differ'),
  ).toBeVisible();
  await host.page.getByLabel('Sent to the others').selectOption('480');
  await host.page.getByRole('button', { name: 'Done' }).click();
  const received = friend.page.locator('.seat', { hasText: 'Host' }).getByTestId('seat-stats');
  await expect
    .poll(
      async () => {
        const height = (await received.textContent())?.match(/↓ \d+×(\d+)/)?.[1];
        return height === undefined ? Infinity : Number(height);
      },
      { timeout: 20_000 },
    )
    .toBeLessThanOrEqual(480);
  await expect(own).toContainText('Camera 1920×1080');
  await host.page.screenshot({ path: test.info().outputPath('own-stats.png') });
});

test('picking the camera resolution', async () => {
  const host = await launch('Host');
  await host.page.getByRole('button', { name: 'Set up camera' }).click();
  const preview = host.page.getByTestId('camera-preview');
  const hint = host.page.getByTestId('camera-resolution-hint');
  const shown = () => preview.evaluate((v: HTMLVideoElement) => `${v.videoWidth}x${v.videoHeight}`);
  await expect.poll(shown).toBe('1920x1080');
  await expect(hint).toContainText('filming at 1920×1080');

  await host.page.getByLabel('Resolution').selectOption('720');
  await expect.poll(shown).toBe('1280x720');
  await expect(hint).toContainText('filming at 1280×720');

  // At 4K, the others still get 1080p: the picture is shrunk for them.
  await host.page.getByLabel('Resolution').selectOption('2160');
  await expect(hint).toContainText('filming at 3840×2160');
  await expect.poll(shown).toBe('1920x1080');
  await host.page.getByRole('button', { name: 'Done' }).click();

  // Remembered.
  await host.page.getByRole('button', { name: 'Set up camera' }).click();
  await expect(host.page.getByLabel('Resolution')).toHaveValue('2160');
});

test('a warning for everyone when a player has most of a combo from their deck on the battlefield', async () => {
  const { host, friend } = await hostAndFriend();
  await cardsReady(host.page);
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'Decks' }).click();
  const decks = host.page.getByTestId('decks-panel');
  await decks.getByLabel('Deck link or list').fill('https://moxfield.com/decks/Y8dZ7');
  await decks.getByRole('button', { name: 'Import' }).click();
  await decks.getByRole('button', { name: 'Save deck' }).click();
  await decks.getByTestId('deck-Atraxa').getByRole('button', { name: 'Play this deck' }).click();
  await decks.getByRole('button', { name: 'Done' }).click();

  // The host's Sol Ring and Rhystic Study are on the battlefield: two of the three pieces.
  await host.page.getByRole('button', { name: "Host's details" }).click();
  const battlefield = host.page.getByTestId('permanents');
  for (const [query, name] of [
    ['sol ring', 'Sol Ring'],
    ['rhystic', 'Rhystic Study'],
  ]) {
    await battlefield.getByLabel('Card or token to keep track of').fill(query!);
    await battlefield.getByRole('button', { name: name!, exact: true }).click();
  }

  const warnings = friend.page.getByTestId('combo-warnings');
  await expect(warnings).toHaveText(
    "Host has 2 of 3 pieces of Sol Ring + Rhystic Study + Atraxa, Praetors' Voice (Infinite test mana): missing Atraxa, Praetors' Voice",
  );
  await expect(friend.page.getByTestId('chips-0')).toContainText('Combo 2/3');

  // A combo piece in Cards seen says so, with the other cards it takes and which of them are on the battlefield.
  await host.page.getByTestId('seat-details-0').getByRole('button', { name: 'Close' }).click();
  await host.page.getByRole('button', { name: 'Cards' }).click();
  const cards = host.page.getByTestId('cards-panel');
  await cards.getByLabel('Search for a card').fill('atraxa');
  await cards.getByRole('button', { name: "Atraxa, Praetors' Voice" }).click();
  await cards.getByRole('button', { name: 'Show everyone' }).click();
  await friend.page.getByTestId('seen-toggle').click();
  const pieces = friend.page.getByTestId('card-rail').getByTestId('combo-pieces');
  await expect(pieces).toContainText('+ Sol Ring');
  await expect(pieces).toContainText('+ Rhystic Study');
  await expect(pieces).toContainText('on the battlefield');
  await expect(pieces).toContainText('Infinite test mana');
});

test('a recap when a game is decided, and finished games kept: stats, the games, sharing them as a file', async () => {
  const host = await launch('Host');
  await host.page.getByTestId('host').click();
  const invite = await host.page.getByTestId('invite-code').inputValue();
  // The friend will import the history the host exports.
  const exported = join(host.saveDir, `commander-brawl-history-${new Date().toISOString().slice(0, 10)}.json`);
  const friend = await launch('Friend', { openFile: exported });
  await friend.page.getByTestId('invite-input').fill(invite);
  await friend.page.getByTestId('join').click();
  await expectVideoFrom(friend.page, 'Host');

  // A short game: the friend's commander deals the host 21.
  await host.page.getByRole('button', { name: 'Random turn order' }).click();
  await friend.page.getByRole('button', { name: "Host's details" }).click();
  const details = friend.page.getByTestId('seat-details-0');
  for (let i = 0; i < 4; i++)
    await details.getByRole('button', { name: "Add 5 damage from Friend's commander" }).click();
  await details.getByRole('button', { name: "Add 1 damage from Friend's commander" }).click();
  await expect(host.page.getByTestId('out-0')).toBeVisible();

  // Decided: everyone hears who won, and the recap is a click away.
  await expect(friend.page.getByTestId('game-over')).toContainText('Friend won');
  await host.page.getByTestId('game-over').getByRole('button', { name: 'Recap' }).click();
  await friend.page.getByTestId('game-over').getByRole('button', { name: 'Recap' }).click();
  const recap = host.page.getByTestId('recap');
  await expect(recap.getByRole('heading', { level: 2 })).toHaveText('Friend won');
  await expect(recap).toContainText('Turn 1: Host lost 21 life');
  await expect(recap).toContainText('Turn 1: Friend knocked out Host (commander damage)');
  await expect(friend.page.getByTestId('recap')).toContainText('Friend won');
  await host.page.screenshot({ path: test.info().outputPath('recap.png') });
  await recap.getByRole('button', { name: 'Save as file' }).click();
  await expect(recap).toContainText('Saved.');
  const saved = await readFile(
    join(host.saveDir, `commander-brawl-recap-${new Date().toISOString().slice(0, 10)}.txt`),
    'utf8',
  );
  expect(saved).toContain('1. Friend: winner');
  expect(saved).toContain('2. Host: out on turn 1, commander damage (Friend)');
  await recap.getByRole('button', { name: 'Close' }).click();
  await friend.page.getByTestId('recap').getByRole('button', { name: 'Close' }).click();
  // Until the next game, it's a click away.
  await expect(host.page.getByRole('button', { name: 'Recap' })).toBeVisible();

  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'New game' }).click();
  await host.page.getByRole('menuitem', { name: 'Start a new game?' }).click();
  await expect(friend.page.getByText('Game 2')).toBeVisible();
  await expect(host.page.getByRole('button', { name: 'Recap' })).toHaveCount(0);

  await friend.page.getByRole('button', { name: 'Menu' }).click();
  await friend.page.getByRole('menuitem', { name: 'History' }).click();
  const history = friend.page.getByTestId('history-panel');
  const players = history.getByRole('table', { name: 'Players' });
  await expect(players.getByRole('row', { name: /Friend/ })).toContainText('Friend11100%');
  await expect(players.getByRole('row', { name: /Host/ })).toContainText('Host100%');
  await expect(history).toContainText('Friend → Host: 1×');
  await friend.page.screenshot({ path: test.info().outputPath('history.png') });
  await history.getByRole('tab', { name: 'Games (1)' }).click();
  await expect(history.getByRole('list', { name: 'Games' })).toContainText('Friend won');
  await expect(history.getByRole('list', { name: 'Games' })).toContainText(
    'out on turn 1 (commander damage, by Friend)',
  );

  // The host shares theirs; the friend has that game already, so nothing is counted twice.
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'History' }).click();
  await host.page.getByTestId('history-panel').getByRole('button', { name: 'Export' }).click();
  await expect(host.page.getByTestId('history-panel')).toContainText('Saved.');
  const file = JSON.parse(await readFile(exported, 'utf8')) as { games: unknown[] };
  expect(file.games).toHaveLength(1);
  await history.getByRole('button', { name: 'Import…' }).click();
  await expect(history).toContainText('Those games were all here already.');
});

test('saving the last half minute of the table as a video', async () => {
  const { host } = await hostAndFriend();
  // Off until switched on.
  await expect(host.page.getByRole('button', { name: /Last 30 s/ })).toHaveCount(0);
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitemcheckbox', { name: 'Record clips' }).click();
  await host.page.waitForTimeout(3_000);
  await host.page.getByRole('button', { name: 'Last 30 s' }).click();
  await expect(host.page.getByTestId('clip-note')).toHaveText('Saved the clip.', { timeout: 10_000 });

  const [name] = (await readdir(host.saveDir)).filter((file) => file.endsWith('.webm'));
  expect(name).toMatch(/^commander-brawl-clip-.*\.webm$/);
  const clip = await readFile(join(host.saveDir, name!));
  expect([...clip.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  expect(clip.length).toBeGreaterThan(10_000);

  // Switched off again: no more recording.
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitemcheckbox', { name: 'Record clips' }).click();
  await expect(host.page.getByRole('button', { name: /Last 30 s/ })).toHaveCount(0);
});

test('a spectator watches without a seat, and the clean view for streaming', async () => {
  const { host, friend } = await hostAndFriend();
  const invite = await host.page.getByTestId('invite-code').inputValue();
  const sam = await launch('Sam');
  await sam.page.getByTestId('invite-input').fill(invite);
  await sam.page.getByTestId('watch').click();

  // Sam sees both players, takes no seat, and has nothing to change the game with.
  await expectVideoFrom(sam.page, 'Host');
  await expectVideoFrom(sam.page, 'Friend');
  await expect(sam.page.getByText('Watching', { exact: true })).toBeVisible();
  await expect(sam.page.locator('.seat:not(.seat-free)')).toHaveCount(2);
  for (const name of ['Undo', 'Wait!', 'Roll', 'Counters', 'Lose 1 life', "Host's details"]) {
    await expect(sam.page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(host.page.getByTestId('spectators')).toHaveText('1 watching');

  // launch() enabled Sam's webcam before joining. Watch mode must also deny the snapshot responder.
  const samId = await ownMemberId(sam.page);
  const wholeView = { x: 0, y: 0, width: 1, height: 1 };
  await expect(craftedSnapshot(host.page, samId, wholeView)).resolves.toMatchObject({ kind: 'error' });
  // Spectators can request close-ups of players, but cannot extend beyond their shared view either.
  const hostId = await ownMemberId(host.page);
  await expect(craftedSnapshot(sam.page, hostId, { ...wholeView, x: -0.5 })).resolves.toMatchObject({ kind: 'error' });
  await expect(craftedSnapshot(sam.page, hostId, wholeView)).resolves.toMatchObject({ kind: 'result' });

  // The game, as it happens.
  await friend.page.getByTestId('life-0').getByRole('button', { name: 'Lose 5 life' }).click();
  await expect(sam.page.getByTestId('life-total-0')).toHaveText('35');

  // The host streams it: a clean view, without the buttons; Escape brings them back.
  await host.page.getByRole('button', { name: 'Menu' }).click();
  await host.page.getByRole('menuitem', { name: 'Clean view for streaming' }).click();
  await expect(host.page.getByRole('button', { name: 'Menu' })).toBeHidden();
  await expect(host.page.getByTestId('life-total-0')).toHaveText('35');
  await expect(host.page.getByRole('button', { name: 'Lose 1 life' })).toHaveCount(0);
  await host.page.screenshot({ path: test.info().outputPath('clean-view.png') });
  await host.page.keyboard.press('Escape');
  await expect(host.page.getByRole('button', { name: 'Menu' })).toBeVisible();
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
  await decks.getByTestId('deck-Atraxa').getByRole('button', { name: 'Play this deck' }).click();
  await decks.getByRole('button', { name: 'Done' }).click();

  await host.page.getByRole('button', { name: 'Rule 0' }).click();
  const rule0 = host.page.getByTestId('rule0-panel');
  await expect(rule0.getByTestId('rule0-0')).toContainText('Game Changers (1): Rhystic Study');
  await expect(rule0.getByTestId('combos')).toHaveText(
    "Sol Ring + Rhystic Study + Atraxa, Praetors' Voice → Infinite test mana",
  );
  await rule0.getByLabel('Your bracket').selectOption('2');
  await expect(rule0.getByTestId('rule0-0')).toContainText('1 Game Changer (brackets 1–2 have none): Rhystic Study');
  await rule0.getByRole('button', { name: 'Done' }).click();

  await expect(friend.page.getByTestId('seat-0').locator('.badge-warn')).toHaveText('Bracket 2');
  await friend.page.getByRole('button', { name: 'Rule 0' }).click();
  await expect(friend.page.getByTestId('rule0-0')).toContainText('1 Game Changer (brackets 1–2 have none)');
});

test('a newer version on the start screen, and afterwards whether updating to it worked', async () => {
  const github = await startFakeGitHub({ version: '9.9.9', files: { SHA256SUMS: Buffer.from('') } });
  const noReleases = await startFakeGitHub(null);
  try {
    // Run from the build, not installed by the install script: it can't update itself, so it points to the release.
    const fresh = await launch('Host', { env: { CB_UPDATES_API: github.apiUrl } });
    const notice = fresh.page.getByTestId('update-notice');
    await expect(notice).toContainText('Commander Brawl 9.9.9 is out');
    await expect(notice).toContainText("This copy of the app can't update itself");
    await expect(notice.getByRole('link', { name: "What's new" })).toHaveAttribute('href', /releases\/tag\/v9\.9\.9$/);
    await notice.getByRole('button', { name: 'Not now' }).click();
    await expect(notice).toHaveCount(0);

    // Opened again after an update that didn't work: why, from what the install script wrote.
    const failedDir = await temporaryDir('cb-e2e-');
    await mkdir(join(failedDir, 'update'));
    const url = 'https://github.com/Entex/commander-brawl/releases/tag/v9.9.9';
    await writeFile(join(failedDir, 'update-attempt.json'), JSON.stringify({ version: '9.9.9', url }));
    await writeFile(
      join(failedDir, 'update', 'install.log'),
      'Unpacking...\nError: Could not unpack the new version.\n',
    );
    const failed = await launch('Host', { userDataDir: failedDir, env: { CB_UPDATES_API: github.apiUrl } });
    const failedNotice = failed.page.getByTestId('update-notice');
    await expect(failedNotice).toContainText("Updating to 9.9.9 didn't work");
    await expect(failedNotice).toContainText('Could not unpack the new version.');
    // The download it no longer needs is gone.
    expect(existsSync(join(failedDir, 'update'))).toBe(false);

    // And after one that worked.
    const { version } = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8')) as { version: string };
    const updatedDir = await temporaryDir('cb-e2e-');
    await writeFile(join(updatedDir, 'update-attempt.json'), JSON.stringify({ version, url }));
    const updated = await launch('Host', { userDataDir: updatedDir, env: { CB_UPDATES_API: noReleases.apiUrl } });
    await expect(updated.page.getByTestId('update-notice')).toContainText(`Updated to Commander Brawl ${version}`);
  } finally {
    await Promise.all([github.close(), noReleases.close()]);
  }
});

test("an invite link opens the app with the invite filled in, or goes to the app that's running", async () => {
  const host = await launch('Host');
  await host.page.getByTestId('host').click();
  // What the host copies: a link to the page that opens the app.
  const link = await host.page.getByTestId('invite-code').inputValue();
  expect(link).toMatch(/^https:\/\/entex\.github\.io\/commander-brawl\/join\/#CB1-/);
  const code = link.split('#')[1]!;
  const appLink = `commander-brawl://join/${code}`;

  // The page opens the app's own link, which starts the app with the invite, ready to join.
  const friendDir = await temporaryDir('cb-e2e-');
  const friend = await launch('Friend', { userDataDir: friendDir, args: [appLink] });
  await expect(friend.page.getByTestId('invite-input')).toHaveValue(code);
  await friend.page.getByTestId('join').click();
  await expectVideoFrom(friend.page, 'Host');

  // Another invite while the app runs: the system starts a second copy, which hands it over and closes. At a
  // table, the app offers to leave it for the other one.
  const second = spawn(electronPath, [appDir, appLink], {
    env: { ...process.env, CB_USER_DATA_DIR: friendDir, CB_UPNP: 'off', CB_LOCAL_ONLY: '1' },
    stdio: 'ignore',
  });
  expect(await new Promise((resolve) => second.once('exit', resolve))).toBe(0);
  const banner = friend.page.getByTestId('invite-banner');
  await expect(banner).toContainText('You opened an invite to another table');
  await banner.getByRole('button', { name: 'Leave and join' }).click();
  await expect(friend.page.getByTestId('invite-input')).toHaveValue(code);
});
