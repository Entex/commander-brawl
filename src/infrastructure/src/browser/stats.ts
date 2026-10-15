import type { LinkStats, VideoStats } from '@commander-brawl/application';

interface Sample {
  readonly timestamp: number;
  readonly bytes: number;
  readonly packets: number;
  readonly lost: number;
}

/** Turns raw WebRTC stats into the few numbers worth showing. Keeps the previous sample to compute rates. */
export class LinkStatsReader {
  private inbound: Sample | null = null;
  private outbound: Sample | null = null;

  read(report: RTCStatsReport): LinkStats {
    let inboundRtp: Record<string, unknown> | undefined;
    let outboundRtp: Record<string, unknown> | undefined;
    let remoteInbound: Record<string, unknown> | undefined;
    let selectedPairId: string | undefined;
    const pairs = new Map<string, Record<string, unknown>>();
    const candidates = new Map<string, Record<string, unknown>>();

    report.forEach((raw: Record<string, unknown>) => {
      switch (raw.type) {
        case 'inbound-rtp':
          if (raw.kind === 'video') inboundRtp = raw;
          break;
        case 'outbound-rtp':
          if (raw.kind === 'video') outboundRtp = raw;
          break;
        case 'remote-inbound-rtp':
          if (raw.kind === 'video') remoteInbound = raw;
          break;
        case 'transport':
          if (typeof raw.selectedCandidatePairId === 'string') selectedPairId = raw.selectedCandidatePairId;
          break;
        case 'candidate-pair':
          pairs.set(raw.id as string, raw);
          break;
        case 'local-candidate':
        case 'remote-candidate':
          candidates.set(raw.id as string, raw);
          break;
      }
    });

    const pair =
      (selectedPairId ? pairs.get(selectedPairId) : undefined) ??
      [...pairs.values()].find((p) => p.nominated === true && p.state === 'succeeded');
    const local = pair ? candidates.get(pair.localCandidateId as string) : undefined;
    const remote = pair ? candidates.get(pair.remoteCandidateId as string) : undefined;
    const route = !pair
      ? 'unknown'
      : local?.candidateType === 'relay' || remote?.candidateType === 'relay'
        ? 'relay'
        : 'direct';
    const rtt = num(pair, 'currentRoundTripTime');
    const available = num(pair, 'availableOutgoingBitrate');

    const inbound = inboundRtp
      ? this.video(
          inboundRtp,
          'inbound',
          num(inboundRtp, 'bytesReceived'),
          num(inboundRtp, 'packetsReceived'),
          num(inboundRtp, 'packetsLost'),
        )
      : null;
    const outbound = outboundRtp
      ? this.video(
          outboundRtp,
          'outbound',
          num(outboundRtp, 'bytesSent'),
          num(outboundRtp, 'packetsSent'),
          null,
          num(remoteInbound, 'fractionLost'),
        )
      : null;

    return {
      route,
      roundTripMs: rtt === null ? null : Math.round(rtt * 1000),
      inbound,
      outbound: outbound && outboundRtp ? { ...outbound, limitation: limitationOf(outboundRtp) } : outbound,
      availableKbps: available === null ? null : Math.round(available / 1000),
    };
  }

  private video(
    stats: Record<string, unknown>,
    direction: 'inbound' | 'outbound',
    bytes: number | null,
    packets: number | null,
    lost: number | null,
    fractionLost: number | null = null,
  ): VideoStats {
    const timestamp = num(stats, 'timestamp') ?? 0;
    const sample: Sample = { timestamp, bytes: bytes ?? 0, packets: packets ?? 0, lost: lost ?? 0 };
    const previous = direction === 'inbound' ? this.inbound : this.outbound;
    if (direction === 'inbound') this.inbound = sample;
    else this.outbound = sample;

    let kbps = 0;
    let lossPercent = fractionLost === null ? 0 : fractionLost * 100;
    if (previous && timestamp > previous.timestamp) {
      kbps = ((sample.bytes - previous.bytes) * 8) / (timestamp - previous.timestamp);
      const lostDelta = sample.lost - previous.lost;
      const receivedDelta = sample.packets - previous.packets;
      if (direction === 'inbound' && lostDelta + receivedDelta > 0) {
        lossPercent = (Math.max(0, lostDelta) / (lostDelta + receivedDelta)) * 100;
      }
    }
    return {
      width: num(stats, 'frameWidth') ?? 0,
      height: num(stats, 'frameHeight') ?? 0,
      fps: Math.round(num(stats, 'framesPerSecond') ?? 0),
      kbps: Math.max(0, Math.round(kbps)),
      lossPercent: Math.round(lossPercent * 10) / 10,
    };
  }
}

/** What WebRTC says is holding the video sent back. */
function limitationOf(stats: Record<string, unknown>): VideoStats['limitation'] {
  switch (stats.qualityLimitationReason) {
    case 'bandwidth':
      return 'bandwidth';
    case 'cpu':
      return 'cpu';
    case 'other':
      return 'other';
    default:
      return null;
  }
}

function num(stats: Record<string, unknown> | undefined, key: string): number | null {
  const value = stats?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
