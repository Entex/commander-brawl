import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The whole app, two copies on one computer: main process, IPC, UI and video.
// Needs a display. On a Linux machine without one, run it with `xvfb-run -a npm run test:e2e`.

const appDir = resolve(import.meta.dirname, '../../build/app');

interface Instance {
  readonly app: ElectronApplication;
  readonly page: Page;
}

const running: Instance[] = [];

test.afterEach(async () => {
  for (const instance of running.splice(0)) await instance.app.close().catch(() => undefined);
});

async function launch(name: string): Promise<Instance> {
  const app = await electron.launch({
    args: [appDir, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: {
      ...process.env,
      CB_USER_DATA_DIR: await mkdtemp(join(tmpdir(), 'cb-e2e-')),
      CB_UPNP: 'off',
      CB_LOCAL_ONLY: '1',
      CB_TABLE_PORT: '0',
      CB_PHONE_PORT: '0',
    },
  });
  const page = await app.firstWindow();
  const instance = { app, page };
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

  await friend.page.getByRole('button', { name: 'Leave' }).click();
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

  await host.page.getByRole('button', { name: 'Close table' }).click();

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

  await host.page.getByRole('button', { name: 'New game' }).click();
  await host.page.getByRole('button', { name: 'Start a new game?' }).click();
  await expect(friend.page.getByTestId('life-total-0')).toHaveText('40');
  await expect(friend.page.getByText('Game 2')).toBeVisible();
});
