/**
 * A minimal WebM (Matroska) writer for one video track: enough to turn encoded frames into a file any player
 * (and Discord) plays. Everything is known up front, so element sizes are exact; a cluster starts at each key
 * frame, which is also where a player can start or seek.
 */

export interface EncodedFrame {
  readonly data: Uint8Array;
  /** Microseconds. */
  readonly timestamp: number;
  readonly key: boolean;
}

export interface WebmOptions {
  readonly width: number;
  readonly height: number;
  /** Matroska codec id, e.g. "V_VP9" or "V_VP8". */
  readonly codec: string;
}

/** The frames as a WebM file, starting at the first key frame. Times start at zero. */
export function muxWebm(frames: readonly EncodedFrame[], options: WebmOptions): Uint8Array<ArrayBuffer> {
  const start = frames.findIndex((f) => f.key);
  const usable = start < 0 ? [] : frames.slice(start);
  const origin = usable[0]?.timestamp ?? 0;
  const ms = (timestamp: number) => Math.round((timestamp - origin) / 1000);

  const clusters: Uint8Array[] = [];
  let cluster: { time: number; blocks: Uint8Array[] } | null = null;
  const flush = () => {
    if (cluster) clusters.push(element(0x1f43b675, [uint(0xe7, cluster.time), ...cluster.blocks]));
  };
  for (const frame of usable) {
    const time = ms(frame.timestamp);
    // A new cluster at each key frame, and before the time within a cluster outgrows its 16 bits.
    if (!cluster || frame.key || time - cluster.time > 30_000) {
      flush();
      cluster = { time, blocks: [] };
    }
    cluster.blocks.push(simpleBlock(frame, time - cluster.time));
  }
  flush();

  const duration = usable.length > 1 ? ms(usable.at(-1)!.timestamp) + 33 : 0;
  const header = element(0x1a45dfa3, [
    uint(0x4286, 1), // EBMLVersion
    uint(0x42f7, 1), // EBMLReadVersion
    uint(0x42f2, 4), // EBMLMaxIDLength
    uint(0x42f3, 8), // EBMLMaxSizeLength
    text(0x4282, 'webm'), // DocType
    uint(0x4287, 4), // DocTypeVersion
    uint(0x4285, 2), // DocTypeReadVersion
  ]);
  const info = element(0x1549a966, [
    uint(0x2ad7b1, 1_000_000), // TimecodeScale: milliseconds
    text(0x4d80, 'Commander Brawl'), // MuxingApp
    text(0x5741, 'Commander Brawl'), // WritingApp
    float(0x4489, duration), // Duration
  ]);
  const tracks = element(0x1654ae6b, [
    element(0xae, [
      uint(0xd7, 1), // TrackNumber
      uint(0x73c5, 1), // TrackUID
      uint(0x83, 1), // TrackType: video
      text(0x86, options.codec), // CodecID
      element(0xe0, [uint(0xb0, options.width), uint(0xba, options.height)]), // Video: PixelWidth, PixelHeight
    ]),
  ]);
  return concat([header, element(0x18538067, [info, tracks, ...clusters])]);
}

/**
 * The frames from the last `seconds` before the newest one, starting at a key frame (so the clip can play from
 * its first frame): the newest key frame at or before the cutoff, or the oldest one if none is that old.
 */
export function lastSeconds<T extends { readonly timestamp: number; readonly key: boolean }>(
  frames: readonly T[],
  seconds: number,
): T[] {
  const newest = frames.at(-1);
  if (!newest) return [];
  const cutoff = newest.timestamp - seconds * 1_000_000;
  let start = frames.findIndex((f) => f.key);
  if (start < 0) return [];
  for (let i = start; i < frames.length && frames[i]!.timestamp <= cutoff; i++) if (frames[i]!.key) start = i;
  return frames.slice(start);
}

function simpleBlock(frame: EncodedFrame, relative: number): Uint8Array {
  const body = new Uint8Array(4 + frame.data.length);
  body[0] = 0x81; // track number 1, as a one-byte size-style number
  new DataView(body.buffer).setInt16(1, relative);
  body[3] = frame.key ? 0x80 : 0x00;
  body.set(frame.data, 4);
  return element(0xa3, [body]);
}

function element(id: number, children: readonly Uint8Array[]): Uint8Array {
  const body = concat(children);
  return concat([idBytes(id), size(body.length), body]);
}

function uint(id: number, value: number): Uint8Array {
  const bytes: number[] = [];
  let rest = value;
  do {
    bytes.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  } while (rest > 0);
  return element(id, [Uint8Array.from(bytes)]);
}

function float(id: number, value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value);
  return element(id, [bytes]);
}

function text(id: number, value: string): Uint8Array {
  return element(id, [new TextEncoder().encode(value)]);
}

/** Element ids are written as they are, in as many bytes as they take (their first byte says how many). */
function idBytes(id: number): Uint8Array {
  const bytes: number[] = [];
  let rest = id;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return Uint8Array.from(bytes);
}

/** A size in Matroska's variable-length form: the number of leading zero bits says how many bytes follow. */
function size(value: number): Uint8Array {
  for (let length = 1; length <= 8; length++) {
    // All ones is reserved (unknown size), so one less than that is the most a length can hold.
    if (value < 2 ** (7 * length) - 1) {
      const bytes = new Uint8Array(length);
      let rest = value;
      for (let i = length - 1; i >= 0; i--) {
        bytes[i] = rest % 256;
        rest = Math.floor(rest / 256);
      }
      bytes[0]! |= 1 << (8 - length);
      return bytes;
    }
  }
  throw new Error('Too big for WebM.');
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, p) => total + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
