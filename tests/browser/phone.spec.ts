import { PhoneLinkServer, createIdentity } from '@commander-brawl/infrastructure/node';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { FlakyNetwork } from '../support/flakyNetwork';
import { TestTable } from './testTable';

const TOKEN = 'phone-link-token-for-browser-tests';

let staticDir: string;

test.beforeAll(async () => {
  // The real phone page, built the same way as for the app.
  staticDir = await mkdtemp(join(tmpdir(), 'cb-phone-page-'));
  await build({
    configFile: resolve(import.meta.dirname, '../../src/phone/vite.config.ts'),
    build: { outDir: staticDir, emptyOutDir: true },
    logLevel: 'warn',
  });
});

/**
 * Player p1 links a phone as their camera. p2 is another player at the table.
 * The phone talks only to p1's computer (through a network we can cut); p1 passes the video on to p2.
 */
async function setUp(browser: Browser) {
  const table = new TestTable(browser);
  await table.open('p1');
  await table.page('p1').evaluate(() => window.harness.startPhoneReceiver());
  await table.seat('p1');
  await table.open('p2');
  await table.page('p2').evaluate(() => window.harness.useFakeCamera());
  await table.seat('p2');

  const desktop = table.page('p1');
  const server = await PhoneLinkServer.start(
    { identity: await createIdentity(['127.0.0.1']), staticDir, token: TOKEN, preferredPort: 0, heartbeatMs: 1_000 },
    {
      connected: () => undefined,
      disconnected: () => void desktop.evaluate(() => window.harness.phoneDisconnected()).catch(() => undefined),
      message: (message) =>
        void desktop.evaluate((m) => window.harness.deliverPhone(m), message).catch(() => undefined),
    },
  );
  table.onPhoneMessage = (_from, message) => server.send(message);
  const wifi = await FlakyNetwork.start(server.port);

  const openPhone = async (fragment = TOKEN): Promise<Page> => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const phone = await context.newPage();
    // What the QR code contains, but through the network we control.
    await phone.goto(`https://127.0.0.1:${wifi.port}/#${fragment}`);
    return phone;
  };

  const tearDown = async () => {
    await table.close();
    await wifi.close();
    await server.close();
  };
  return { table, wifi, openPhone, tearDown };
}

test('the phone camera reaches the other players through its own computer', async ({ browser }) => {
  const { table, openPhone, tearDown } = await setUp(browser);
  const phone = await openPhone();

  await expect(phone.locator('#status')).toHaveText('Live', { timeout: 20_000 });
  await expect.poll(() => table.page('p1').evaluate(() => window.harness.phoneState())).toBe('live');
  const [video] = await table.expectLiveVideo('p2', ['p1']);
  expect(video!.width).toBeGreaterThanOrEqual(1280);
  await table.expectLiveVideo('p1', ['p2']);
  await tearDown();
});

test('the phone recovers from a Wi-Fi drop and the others get its video back', async ({ browser }) => {
  const { table, wifi, openPhone, tearDown } = await setUp(browser);
  const phone = await openPhone();
  await expect(phone.locator('#status')).toHaveText('Live', { timeout: 20_000 });
  await table.expectLiveVideo('p2', ['p1']);

  const history = () => table.page('p2').evaluate(() => window.harness.cameraHistory('p1'));
  await expect.poll(history).toEqual(expect.arrayContaining(['live']));
  const before = (await history()).length;

  wifi.cut();

  await expect(phone.locator('#status')).not.toHaveText('Live', { timeout: 10_000 });
  await expect(phone.locator('#status')).toHaveText('Live', { timeout: 20_000 });
  await table.expectLiveVideo('p2', ['p1']);
  // p2 was told p1's camera was reconnecting, and then that it was back.
  await expect.poll(async () => (await history()).slice(before - 1)).toEqual(['live', 'reconnecting', 'live']);
  await tearDown();
});

test('a second phone takes over and the first one is told', async ({ browser }) => {
  const { table, openPhone, tearDown } = await setUp(browser);
  const first = await openPhone();
  await expect(first.locator('#status')).toHaveText('Live', { timeout: 20_000 });

  const second = await openPhone();

  await expect(first.locator('#status')).toHaveText('Another phone took over', { timeout: 10_000 });
  await expect(second.locator('#status')).toHaveText('Live', { timeout: 20_000 });
  await table.expectLiveVideo('p2', ['p1']);
  await tearDown();
});

test('a phone with an incomplete link is told to scan again', async ({ browser }) => {
  const { openPhone, tearDown } = await setUp(browser);
  const phone = await openPhone('');

  await expect(phone.locator('#status')).toHaveText('Camera problem');
  await expect(phone.locator('#hint')).toContainText('Scan the QR code');
  await tearDown();
});
