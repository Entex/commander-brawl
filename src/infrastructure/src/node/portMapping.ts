import { upnpNat } from '@achingbrain/nat-port-mapper';
import { isCarrierGradeNat, isPrivateIpv4 } from './network';

export type PortMappingResult =
  | {
      readonly ok: true;
      readonly externalIp: string;
      readonly externalPort: number;
      /** The router has a public address, so friends outside the home can reach it. */
      readonly reachable: boolean;
      release(): Promise<void>;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Asks the home router (UPnP) to forward a TCP port to this computer, so friends can reach the table.
 * The router keeps refreshing the mapping until release() is called.
 */
export async function openRouterPort(
  port: number,
  internalHost: string,
  timeoutMs = 8_000,
): Promise<PortMappingResult> {
  const client = upnpNat({ description: 'Commander Brawl', autoRefresh: true });
  let lastError = 'No router with UPnP answered. Turn on UPnP on the router, or forward the port manually.';
  try {
    for await (const gateway of client.findGateways({ signal: AbortSignal.timeout(timeoutMs) })) {
      try {
        const mapping = await gateway.map(port, internalHost, {
          protocol: 'tcp',
          externalPort: port,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const externalIp = await gateway.externalIp({ signal: AbortSignal.timeout(timeoutMs) });
        return {
          ok: true,
          externalIp,
          externalPort: mapping.externalPort,
          reachable: !isPrivateIpv4(externalIp) && !isCarrierGradeNat(externalIp),
          release: () => gateway.stop(),
        };
      } catch (error) {
        lastError = `The router refused to open port ${port}: ${(error as Error).message}`;
        await gateway.stop().catch(() => undefined);
      }
    }
  } catch {
    // The search timed out.
  }
  return { ok: false, reason: lastError };
}
