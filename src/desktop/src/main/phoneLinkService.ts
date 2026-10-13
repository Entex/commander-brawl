import { lanAddresses, PhoneLinkServer, randomId, type TlsIdentity } from '@commander-brawl/infrastructure/node';
import type { DesktopToPhone } from '@commander-brawl/infrastructure/protocol';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PhoneLinkEvent, PhoneLinkInfo } from '../shared/api';

export interface PhoneLinkServiceOptions {
  readonly identity: TlsIdentity;
  readonly dataDir: string;
  readonly staticDir: string;
  readonly preferredPort: number;
  readonly emit: (event: PhoneLinkEvent) => void;
}

/**
 * Keeps the phone camera page available on the local network for as long as the app runs.
 * The link token is saved, so a phone that's already set up reconnects by itself after an app restart.
 */
export class PhoneLinkService {
  private constructor(private readonly server: PhoneLinkServer | null) {}

  static async start(options: PhoneLinkServiceOptions): Promise<PhoneLinkService> {
    try {
      const token = await loadOrCreateToken(options.dataDir);
      const server = await PhoneLinkServer.start(
        { identity: options.identity, staticDir: options.staticDir, token, preferredPort: options.preferredPort },
        {
          connected: () => options.emit({ type: 'connected' }),
          disconnected: () => options.emit({ type: 'disconnected' }),
          message: (message) => options.emit({ type: 'message', message }),
        },
      );
      return new PhoneLinkService(server);
    } catch (error) {
      console.error('[phone] could not start the phone link', error);
      return new PhoneLinkService(null);
    }
  }

  info(): PhoneLinkInfo {
    return {
      urls: this.server ? this.server.urls(lanAddresses()) : [],
      connected: this.server?.isConnected ?? false,
    };
  }

  send(message: DesktopToPhone): void {
    this.server?.send(message);
  }

  async close(): Promise<void> {
    await this.server?.close();
  }
}

async function loadOrCreateToken(dir: string): Promise<string> {
  const path = join(dir, 'phone-token');
  try {
    const saved = (await readFile(path, 'utf8')).trim();
    if (/^[A-Za-z0-9_-]{22,}$/.test(saved)) return saved;
  } catch {
    // First run.
  }
  const token = randomId();
  await mkdir(dir, { recursive: true });
  await writeFile(path, token, { mode: 0o600 });
  return token;
}
