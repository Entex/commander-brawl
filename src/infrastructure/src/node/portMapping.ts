import { isCarrierGradeNat, isPrivateIpv4 } from './network';
import { addPortMapping, deletePortMapping, discoverGateway, externalAddress, getConnection } from './upnp';

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

/** How long the router keeps the port forwarded unless it's renewed, in seconds. */
const LEASE_SECONDS = 3_600;
/** Renewed well before that, for as long as the table is open. */
const RENEW_MS = 30 * 60_000;
const DESCRIPTION = 'Commander Brawl';

/**
 * Asks the home router (UPnP) to forward a TCP port to this computer, so friends can reach the table.
 * The port stays forwarded (renewed) until release() is called.
 */
export async function openRouterPort(
  port: number,
  internalHost: string,
  timeoutMs = 4_000,
): Promise<PortMappingResult> {
  const location = await discoverGateway({ timeoutMs });
  if (!location) {
    return {
      ok: false,
      reason: 'No router with UPnP answered. Turn on UPnP on the router, or forward the port manually.',
    };
  }
  try {
    const connection = await getConnection(location);
    const lease = await addPortMapping(connection, port, internalHost, DESCRIPTION, LEASE_SECONDS);
    const externalIp = await externalAddress(connection);
    const renew =
      lease > 0
        ? setInterval(() => {
            void addPortMapping(connection, port, internalHost, DESCRIPTION, lease).catch(() => undefined);
          }, RENEW_MS)
        : null;
    renew?.unref();
    return {
      ok: true,
      externalIp,
      externalPort: port,
      reachable: !isPrivateIpv4(externalIp) && !isCarrierGradeNat(externalIp),
      release: async () => {
        if (renew) clearInterval(renew);
        await deletePortMapping(connection, port).catch(() => undefined);
      },
    };
  } catch (error) {
    return { ok: false, reason: `The router refused to open port ${port}: ${(error as Error).message}` };
  }
}
