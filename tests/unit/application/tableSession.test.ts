import {
  TableSession,
  type LinkStats,
  type PeerLink,
  type PeerLinkFactory,
  type PeerLinkOptions,
  type SignalingEvent,
  type TableSignaling,
} from '@commander-brawl/application';
import type { Player, SeatIndex } from '@commander-brawl/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeTimers } from '../../support/fakeTimers';

type Track = { readonly id: string };

class FakeSignaling implements TableSignaling {
  readonly sent: { to: string; data: unknown }[] = [];
  private listener: ((event: SignalingEvent) => void) | null = null;

  subscribe(listener: (event: SignalingEvent) => void) {
    this.listener = listener;
    return () => (this.listener = null);
  }

  send(to: string, data: unknown): void {
    this.sent.push({ to, data });
  }

  /** Messages for setting up video links, leaving out camera status updates. */
  get linkSignals() {
    return this.sent.filter((m) => typeof m.data === 'object' && m.data !== null && 'gen' in m.data);
  }

  statusesSentTo(to: string) {
    return this.sent.filter((m) => m.to === to && typeof m.data === 'object' && m.data !== null && 'status' in m.data);
  }

  emit(event: SignalingEvent): void {
    this.listener?.(event);
  }
}

class FakeLink implements PeerLink<Track> {
  readonly received: unknown[] = [];
  readonly tracks: (Track | null)[] = [];
  closed = false;

  constructor(readonly options: PeerLinkOptions<Track>) {}

  async handleSignal(data: unknown) {
    this.received.push(data);
  }

  async setLocalTrack(track: Track | null) {
    this.tracks.push(track);
  }

  async getStats(): Promise<LinkStats> {
    return { route: 'direct', roundTripMs: 12, inbound: null, outbound: null };
  }

  close() {
    this.closed = true;
  }
}

class FakeLinkFactory implements PeerLinkFactory<Track> {
  readonly links: FakeLink[] = [];

  create(options: PeerLinkOptions<Track>) {
    const link = new FakeLink(options);
    this.links.push(link);
    return link;
  }

  current(remoteId: string): FakeLink {
    const link = this.links.filter((l) => l.options.remoteId === remoteId && !l.closed).at(-1);
    if (!link) throw new Error(`no open link to ${remoteId}`);
    return link;
  }
}

const player = (id: string, seat: SeatIndex): Player => ({ id, name: id.toUpperCase(), seat });
const RESET_MS = 15_000;

describe('TableSession', () => {
  let signaling: FakeSignaling;
  let factory: FakeLinkFactory;
  let timers: FakeTimers;
  let session: TableSession<Track>;

  beforeEach(() => {
    signaling = new FakeSignaling();
    factory = new FakeLinkFactory();
    timers = new FakeTimers();
    session = new TableSession(signaling, factory, { timers, linkResetMs: RESET_MS });
    session.start();
  });

  const welcome = (selfId: string, members: Player[]) => signaling.emit({ type: 'welcome', selfId, members });

  it('opens one link to every other player, with exactly one initiator per pair', () => {
    welcome('b', [player('a', 0), player('b', 1), player('c', 2)]);

    expect(factory.links.map((l) => [l.options.remoteId, l.options.initiator])).toEqual([
      ['a', false],
      ['c', true],
    ]);
  });

  it('sends its camera to spectators too, who are not seats', () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    signaling.emit({ type: 'spectator-joined', spectator: { id: 's', name: 'Sam' } });
    expect(factory.links.map((l) => l.options.remoteId)).toEqual(['b', 's']);
    // The spectator only watches: they get a smaller picture than a player.
    expect(factory.links.map((l) => l.options.watcher)).toEqual([false, true]);
    expect(session.getState()).toMatchObject({ spectating: false, spectators: [{ id: 's', name: 'Sam' }] });
    expect(session.getState().seats.map((seat) => seat.player.id)).toEqual(['a', 'b']);

    signaling.emit({ type: 'member-left', memberId: 's' });
    expect(factory.links.find((l) => l.options.remoteId === 's')!.closed).toBe(true);
    expect(session.getState().spectators).toEqual([]);
  });

  it('as a spectator: links to every player, none to other spectators', () => {
    signaling.emit({
      type: 'welcome',
      selfId: 's',
      members: [player('a', 0), player('b', 1)],
      spectators: [
        { id: 'r', name: 'Robin' },
        { id: 's', name: 'Sam' },
      ],
    });
    expect(factory.links.map((l) => l.options.remoteId)).toEqual(['a', 'b']);
    expect(session.getState().spectating).toBe(true);
    // A signal from another spectator is ignored.
    signaling.emit({ type: 'signal', from: 'r', data: { gen: 0, body: {} } });
    expect(factory.links).toHaveLength(2);
  });

  it('adds and removes links as players come and go', () => {
    welcome('a', [player('a', 0)]);
    signaling.emit({ type: 'member-joined', member: player('b', 1) });
    expect(factory.current('b').options.initiator).toBe(true);

    signaling.emit({ type: 'member-left', memberId: 'b' });
    expect(factory.links[0]!.closed).toBe(true);
    expect(session.getState().seats.map((s) => s.player.id)).toEqual(['a']);
  });

  it('wraps outgoing signals with the link generation and unwraps incoming ones', () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    const link = factory.current('b');

    link.options.events.signal({ hello: 1 });
    signaling.emit({ type: 'signal', from: 'b', data: { gen: 0, body: { hi: 2 } } });

    expect(signaling.linkSignals).toEqual([{ to: 'b', data: { gen: 0, body: { hello: 1 } } }]);
    expect(link.received).toEqual([{ hi: 2 }]);
  });

  it('ignores signals from strangers and malformed envelopes', () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    signaling.emit({ type: 'signal', from: 'z', data: { gen: 0, body: {} } });
    signaling.emit({ type: 'signal', from: 'b', data: { nope: true } });
    expect(factory.current('b').received).toEqual([]);
  });

  it('sends the local camera over every link, including ones opened later', async () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    const camera = { id: 'cam' };
    await session.setLocalTrack(camera);
    signaling.emit({ type: 'member-joined', member: player('c', 2) });

    expect(factory.current('b').tracks).toEqual([camera]);
    expect(factory.current('c').options.localTrack).toBe(camera);
    expect(session.getState().seats[0]).toMatchObject({ isSelf: true, track: camera, link: 'self' });
  });

  it('shows the remote camera and link state on the other seats', () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    const link = factory.current('b');
    const remote = { id: 'remote' };

    link.options.events.state('connected');
    link.options.events.remoteTrack(remote);

    expect(session.getState().seats[1]).toMatchObject({ isSelf: false, track: remote, link: 'connected' });
  });

  it('starts a fresh link when the initiator has not connected in time', () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    const first = factory.current('b');

    timers.advance(RESET_MS);

    expect(first.closed).toBe(true);
    const second = factory.current('b');
    second.options.events.signal({ offer: true });
    expect(signaling.linkSignals.at(-1)).toEqual({ to: 'b', data: { gen: 1, body: { offer: true } } });
  });

  it('does not reset a link that connected', () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    factory.current('b').options.events.state('connected');
    timers.advance(RESET_MS * 3);
    expect(factory.links).toHaveLength(1);
  });

  it('leaves resets to the initiator', () => {
    welcome('b', [player('a', 0), player('b', 1)]);
    timers.advance(RESET_MS * 3);
    expect(factory.links).toHaveLength(1);
  });

  it('follows the other side to a newer link generation and drops stale signals', () => {
    welcome('b', [player('a', 0), player('b', 1)]);
    const first = factory.current('a');

    signaling.emit({ type: 'signal', from: 'a', data: { gen: 1, body: 'offer-1' } });
    const second = factory.current('a');
    signaling.emit({ type: 'signal', from: 'a', data: { gen: 0, body: 'late' } });

    expect(first.closed).toBe(true);
    expect(second.received).toEqual(['offer-1']);
  });

  it('ignores events from a link after it was replaced', () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    const first = factory.current('b');
    timers.advance(RESET_MS);

    first.options.events.signal('old');
    first.options.events.state('connected');

    expect(signaling.linkSignals).toEqual([]);
    expect(session.getState().seats[1]!.link).toBe('new');
  });

  it('rebuilds every link when the host restarts and hands out a new id', () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    const before = factory.current('b');

    welcome('z', [player('b', 0), player('z', 1)]);

    expect(before.closed).toBe(true);
    expect(factory.current('b').options.initiator).toBe(false);
  });

  it('reports the host connection state', () => {
    signaling.emit({ type: 'connection', state: 'reconnecting', reason: 'Lost the connection to the host.' });
    expect(session.getState()).toMatchObject({
      connection: 'reconnecting',
      connectionReason: 'Lost the connection to the host.',
    });
  });

  it('tells everyone what its camera is doing, including players who join later', () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    session.setCameraStatus('live');
    signaling.emit({ type: 'member-joined', member: player('c', 2) });
    session.setCameraStatus('reconnecting');

    expect(signaling.statusesSentTo('b').map((m) => m.data)).toEqual([
      { status: { camera: 'off' } },
      { status: { camera: 'live' } },
      { status: { camera: 'reconnecting' } },
    ]);
    expect(signaling.statusesSentTo('c').map((m) => m.data)).toEqual([
      { status: { camera: 'live' } },
      { status: { camera: 'reconnecting' } },
    ]);
    expect(session.getState().seats[0]!.camera).toBe('reconnecting');
  });

  it('shows what other players say about their camera', () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    expect(session.getState().seats[1]!.camera).toBeNull();

    signaling.emit({ type: 'signal', from: 'b', data: { status: { camera: 'reconnecting' } } });

    expect(session.getState().seats[1]!.camera).toBe('reconnecting');
    expect(factory.current('b').received).toEqual([]);
  });

  it('ignores camera statuses it does not understand', () => {
    welcome('a', [player('a', 0), player('b', 1)]);
    signaling.emit({ type: 'signal', from: 'b', data: { status: { camera: 'exploded' } } });
    expect(session.getState().seats[1]!.camera).toBeNull();
  });

  it('closes everything on dispose', () => {
    welcome('a', [player('a', 0), player('b', 1), player('c', 2)]);
    session.dispose();
    expect(factory.links.every((l) => l.closed)).toBe(true);
  });
});
