import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The whole app, two copies on one computer: main process, IPC, UI and video.
// Needs a display. On a Linux machine without one, run it with `xvfb-run -a npm run test:e2e`.

const appDir = resolve(import.meta.dirname, '../../build/app');

interface Instance {
  readonly app: ElectronApplication;
  readonly page: Page;
  /** Where the app saves files, instead of asking. */
  readonly saveDir: string;
}

const running: Instance[] = [];

test.afterEach(async () => {
  for (const instance of running.splice(0)) await instance.app.close().catch(() => undefined);
});

async function launch(name: string): Promise<Instance> {
  const saveDir = await mkdtemp(join(tmpdir(), 'cb-e2e-save-'));
  const app = await electron.launch({
    args: [appDir, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: {
      ...process.env,
      CB_USER_DATA_DIR: await mkdtemp(join(tmpdir(), 'cb-e2e-')),
      CB_UPNP: 'off',
      CB_LOCAL_ONLY: '1',
      CB_TABLE_PORT: '0',
      CB_PHONE_PORT: '0',
      CB_SAVE_DIR: saveDir,
    },
  });
  const page = await app.firstWindow();
  const instance = { app, page, saveDir };
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
