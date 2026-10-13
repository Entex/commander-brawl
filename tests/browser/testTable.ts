import type { SignalingEvent } from '@commander-brawl/application';
import { MAX_SEATS, type Player, type SeatIndex } from '@commander-brawl/domain';
import type { DesktopToPhone } from '@commander-brawl/infrastructure/protocol';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { HarnessOutbound, VideoReport } from './harness/harness';

interface Seated {
  readonly page: Page;
  readonly context: BrowserContext;
  member: Player | null;
  queue: Promise<unknown>;
}

/**
 * Plays the part of the table host for browser tests: seats players (each in its own browser)
 * and relays their connection details, so the real WebRTC code connects them directly.
 */
export class TestTable {
  private readonly players = new Map<string, Seated>();
  onPhoneMessage: (from: string, message: DesktopToPhone) => void = () => undefined;

  constructor(private readonly browser: Browser) {}

  async open(id: string): Promise<Page> {
    const context = await this.browser.newContext();
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') console.log(`[${id}] ${message.text()}`);
    });
    await page.exposeFunction('toNode', (message: HarnessOutbound) => this.route(id, message));
    await page.goto('http://localhost:5180/');
    await page.waitForFunction(() => window.harness !== undefined);
    this.players.set(id, { page, context, member: null, queue: Promise.resolve() });
    return page;
  }

  page(id: string): Page {
    return this.get(id).page;
  }

  async seat(id: string): Promise<void> {
    const seated = [...this.players.values()].flatMap((p) => (p.member ? [p.member] : []));
    const taken = new Set(seated.map((m) => m.seat));
    const seat = Array.from({ length: MAX_SEATS }, (_, i) => i as SeatIndex).find((i) => !taken.has(i));
    if (seat === undefined) throw new Error('table full');
    const member: Player = { id, name: id, seat };
    this.get(id).member = member;
    await this.deliver(id, { type: 'welcome', selfId: id, members: [...seated, member] });
    for (const other of seated) await this.deliver(other.id, { type: 'member-joined', member });
  }

  /** The player closes the app. */
  async remove(id: string): Promise<void> {
    const player = this.get(id);
    this.players.delete(id);
    await player.context.close();
    for (const [otherId, other] of this.players) {
      if (other.member) await this.deliver(otherId, { type: 'member-left', memberId: id });
    }
  }

  async close(): Promise<void> {
    for (const player of this.players.values()) await player.context.close();
    this.players.clear();
  }

  /** Waits until this player gets moving video from exactly these other players. */
  async expectLiveVideo(id: string, from: readonly string[]): Promise<VideoReport[]> {
    const page = this.page(id);
    const report = () => page.evaluate(() => window.harness.videoReport());
    await expect
      .poll(async () => {
        const videos = await report();
        return videos
          .filter((v) => v.link === 'connected' && v.width > 0 && v.frames > 0)
          .map((v) => v.memberId)
          .sort();
      }, { timeout: 30_000, message: `${id} should see video from ${from.join(', ')}` })
      .toEqual([...from].sort());

    // Frames must keep coming, not just one frozen picture. Right after connecting the frame rate
    // is low while the connection measures how much bandwidth it has, so allow some ramp-up time.
    const before = await report();
    await expect
      .poll(
        async () => {
          const now = await report();
          return now
            .filter((v) => v.frames >= (before.find((b) => b.memberId === v.memberId)?.frames ?? 0) + 5)
            .map((v) => v.memberId)
            .sort();
        },
        { timeout: 15_000, message: `video to ${id} should keep moving` },
      )
      .toEqual([...from].sort());
    return report();
  }

  private get(id: string): Seated {
    const player = this.players.get(id);
    if (!player) throw new Error(`unknown player ${id}`);
    return player;
  }

  /** Delivered one at a time per player, in order, like a real connection. */
  private deliver(id: string, event: SignalingEvent): Promise<unknown> {
    const player = this.players.get(id);
    if (!player) return Promise.resolve();
    player.queue = player.queue
      .then(() => player.page.evaluate((e) => window.harness.deliver(e), event))
      .catch(() => undefined);
    return player.queue;
  }

  private route(from: string, message: HarnessOutbound): void {
    if (message.kind === 'signal') {
      void this.deliver(message.to, { type: 'signal', from, data: message.data });
    } else {
      this.onPhoneMessage(from, message.message);
    }
  }
}
