import { expect, test } from '@playwright/test';
import { TestTable } from './testTable';

const others = (ids: string[], self: string) => ids.filter((id) => id !== self);

test('four players all see each other', async ({ browser }) => {
  const table = new TestTable(browser);
  const ids = ['p1', 'p2', 'p3', 'p4'];
  for (const id of ids) {
    await table.open(id);
    await table.page(id).evaluate(() => window.harness.useFakeCamera());
  }
  for (const id of ids) await table.seat(id);

  for (const id of ids) {
    const videos = await table.expectLiveVideo(id, others(ids, id));
    for (const video of videos) {
      expect(await table.page(id).evaluate((m) => window.harness.route(m), video.memberId)).toBe('direct');
    }
  }
  await table.close();
});

test('a player who joins late connects to everyone already playing', async ({ browser }) => {
  const table = new TestTable(browser);
  const first = ['p1', 'p2', 'p3'];
  for (const id of first) {
    await table.open(id);
    await table.page(id).evaluate(() => window.harness.useFakeCamera());
    await table.seat(id);
  }
  for (const id of first) await table.expectLiveVideo(id, others(first, id));

  await table.open('p4');
  await table.page('p4').evaluate(() => window.harness.useFakeCamera());
  await table.seat('p4');

  const all = [...first, 'p4'];
  for (const id of all) await table.expectLiveVideo(id, others(all, id));
  await table.close();
});

test('a player who drops out and rejoins gets video again', async ({ browser }) => {
  const table = new TestTable(browser);
  for (const id of ['p1', 'p2', 'p3']) {
    await table.open(id);
    await table.page(id).evaluate(() => window.harness.useFakeCamera());
    await table.seat(id);
  }
  await table.expectLiveVideo('p1', ['p2', 'p3']);

  await table.remove('p2');
  await table.expectLiveVideo('p1', ['p3']);

  // Back with a new id, like after restarting the app.
  await table.open('p5');
  await table.page('p5').evaluate(() => window.harness.useFakeCamera());
  await table.seat('p5');
  await table.expectLiveVideo('p1', ['p3', 'p5']);
  await table.expectLiveVideo('p5', ['p1', 'p3']);
  await table.close();
});

test('a player without a camera still sees the others', async ({ browser }) => {
  const table = new TestTable(browser);
  await table.open('p1');
  await table.page('p1').evaluate(() => window.harness.useFakeCamera());
  await table.seat('p1');
  await table.open('p2');
  await table.seat('p2');

  await table.expectLiveVideo('p2', ['p1']);

  // Turning the camera on later reaches the others without reconnecting.
  await table.page('p2').evaluate(() => window.harness.useFakeCamera());
  await table.expectLiveVideo('p1', ['p2']);
  await table.close();
});
