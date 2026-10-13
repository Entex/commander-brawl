import type { SignalingEvent, TableSignaling, Unsubscribe } from '@commander-brawl/application';
import type { DesktopApi } from '../shared/api';

declare global {
  interface Window {
    readonly brawl: DesktopApi;
  }
}

export const api: DesktopApi = window.brawl;

/** Electron wraps errors thrown in the main process. Keep only the part meant for the player. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
}

/** The table connection lives in the main process. This forwards it to the UI. */
export class IpcTableSignaling implements TableSignaling {
  subscribe(listener: (event: SignalingEvent) => void): Unsubscribe {
    let active = true;
    const off = api.table.onEvent((event) => {
      if (active) listener(event);
    });
    void api.table.snapshot().then((events) => {
      if (active) for (const event of events) listener(event);
    });
    return () => {
      active = false;
      off();
    };
  }

  send(to: string, data: unknown): void {
    api.table.send(to, data);
  }
}
