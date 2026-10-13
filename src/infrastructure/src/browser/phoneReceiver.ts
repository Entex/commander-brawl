import type { DesktopToPhone, PhoneCrop, PhoneToDesktop } from '../protocol';

export type PhoneCameraState = 'waiting' | 'connecting' | 'live' | 'reconnecting';

export interface PhoneReceiverEvents {
  send(message: DesktopToPhone): void;
  track(track: MediaStreamTrack | null): void;
  state(state: PhoneCameraState): void;
}

/**
 * The desktop end of the phone camera. Answers the phone's video connection and hands the
 * resulting camera track to the app, which forwards it to the other players.
 */
export class PhoneReceiver {
  private pc: RTCPeerConnection | null = null;
  private session = -1;
  private state: PhoneCameraState = 'waiting';
  private nextSnapshot = 0;
  private readonly snapshots = new Map<string, { resolve(image: string): void; reject(error: Error): void }>();

  constructor(private readonly events: PhoneReceiverEvents) {}

  get isLive(): boolean {
    return this.state === 'live';
  }

  /** Asks the phone for a full-resolution picture of part of its view. A JPEG data URL. */
  requestSnapshot(crop: PhoneCrop, timeoutMs = 10_000): Promise<string> {
    const id = `s${++this.nextSnapshot}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.snapshots.delete(id);
        reject(new Error("The phone didn't answer in time."));
      }, timeoutMs);
      this.snapshots.set(id, {
        resolve: (image) => {
          clearTimeout(timer);
          resolve(image);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.events.send({ t: 'snapshot', id, crop });
    });
  }

  async handle(message: PhoneToDesktop): Promise<void> {
    if (message.t === 'snapshot' || message.t === 'snapshot-failed') {
      const waiting = this.snapshots.get(message.id);
      this.snapshots.delete(message.id);
      if (message.t === 'snapshot') waiting?.resolve(message.image);
      else waiting?.reject(new Error(message.message));
      return;
    }
    try {
      if (message.t === 'offer') {
        await this.answer(message.session, message.sdp);
      } else if (message.t === 'candidate' && message.session === this.session && this.pc) {
        await this.pc.addIceCandidate(message.candidate);
      }
    } catch (error) {
      console.warn('[phone] could not handle message', error);
    }
  }

  /** The phone's control connection dropped. Video may still be flowing, so only the status changes. */
  phoneDisconnected(): void {
    if (this.state === 'live' && this.pc?.connectionState === 'connected') return;
    this.setState(this.pc ? 'reconnecting' : 'waiting');
  }

  close(): void {
    this.pc?.close();
    this.pc = null;
    this.events.track(null);
    this.setState('waiting');
  }

  private async answer(session: number, sdp: string): Promise<void> {
    this.pc?.close();
    this.session = session;
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    this.setState('connecting');

    pc.ontrack = ({ track }) => {
      if (this.pc !== pc) return;
      // The phone's "keep it sharp" hint doesn't travel over the connection. Without it, passing the
      // video on to the other players would trade resolution for frame rate, which blurs card text.
      track.contentHint = 'detail';
      this.events.track(track);
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && this.pc === pc) {
        const { sdpMid = null, sdpMLineIndex = null } = candidate;
        this.events.send({
          t: 'candidate',
          session,
          candidate: { candidate: candidate.candidate, sdpMid, sdpMLineIndex },
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      switch (pc.connectionState) {
        case 'connected':
          this.setState('live');
          break;
        case 'disconnected':
        case 'failed':
          // The phone notices too and starts a fresh connection.
          this.setState('reconnecting');
          break;
        default:
          break;
      }
    };

    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription();
    if (this.pc === pc && pc.localDescription) {
      this.events.send({ t: 'answer', session, sdp: pc.localDescription.sdp });
    }
  }

  private setState(state: PhoneCameraState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.state(state);
  }
}
