import { NatPmpError, natPmpExternalAddress, natPmpMapTcp, type NatPmpRouter } from './natPmp';
import { isCarrierGradeNat, isPrivateIpv4, likelyRouter } from './network';
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
/** What sending to the local network fails with when the system doesn't allow it. */
const BLOCKED = new Set(['EHOSTUNREACH', 'ENETUNREACH', 'EPERM', 'EACCES']);

/** The router would only open another port: friends would need that one, and the invite has this computer's. */
class RouterPortTaken extends Error {}

/**
 * Asks the home router to forward a TCP port to this computer, so friends can reach the table: over UPnP, or
 * NAT-PMP if that doesn't work. The port stays forwarded (renewed) until release() is called.
 */
export async function openRouterPort(
  port: number,
  internalHost: string,
  timeoutMs = 4_000,
): Promise<PortMappingResult> {
  const { location, sendError } = await discoverGateway({ timeoutMs });
  let refused: string | null = null;
  if (location) {
    try {
      return await openWithUpnp(location, port, internalHost);
    } catch (error) {
      refused = `The router refused to open port ${port}: ${(error as Error).message}`;
    }
  }

  const router = likelyRouter(internalHost);
  let natPmpError: unknown = null;
  if (router) {
    try {
      return await openWithNatPmp({ address: router, from: internalHost }, port);
    } catch (error) {
      natPmpError = error;
    }
  }

  if (refused) return { ok: false, reason: refused };
  const blocked = sendError ?? (natPmpError instanceof NatPmpError ? natPmpError.code : null);
  if (typeof blocked === 'string' && BLOCKED.has(blocked)) {
    return {
      ok: false,
      reason:
        process.platform === 'darwin'
          ? "macOS didn't let Commander Brawl talk to your router. Allow Commander Brawl in System Settings → Privacy & Security → Local Network, then host again."
          : `This computer couldn't send anything to your router (${blocked}): a firewall may be in the way.`,
    };
  }
  if (natPmpError instanceof NatPmpError && typeof natPmpError.code === 'number') {
    return { ok: false, reason: `The router refused to open port ${port}: ${natPmpError.message}` };
  }
  if (natPmpError instanceof RouterPortTaken) return { ok: false, reason: natPmpError.message };
  return {
    ok: false,
    reason: 'No router answered (UPnP or NAT-PMP). Turn on UPnP on the router, or forward the port manually.',
  };
}

async function openWithUpnp(location: URL, port: number, internalHost: string): Promise<PortMappingResult> {
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
    reachable: isPublic(externalIp),
    release: async () => {
      if (renew) clearInterval(renew);
      await deletePortMapping(connection, port).catch(() => undefined);
    },
  };
}

async function openWithNatPmp(router: NatPmpRouter, port: number): Promise<PortMappingResult> {
  const externalIp = await natPmpExternalAddress(router);
  const mapping = await natPmpMapTcp(router, port, LEASE_SECONDS);
  const release = () => natPmpMapTcp(router, port, 0).then(() => undefined);
  if (mapping.externalPort !== port) {
    await release().catch(() => undefined);
    throw new RouterPortTaken(
      `The router would only open port ${mapping.externalPort}, not ${port}: is port ${port} forwarded to another computer?`,
    );
  }
  // Renewed at half the lease, as the standard says, if the router gave less than asked for.
  const renewMs = Math.max(60_000, Math.min(RENEW_MS, (mapping.leaseSeconds * 1000) / 2));
  const renew = setInterval(() => {
    void natPmpMapTcp(router, port, LEASE_SECONDS).catch(() => undefined);
  }, renewMs);
  renew.unref();
  return {
    ok: true,
    externalIp,
    externalPort: port,
    reachable: isPublic(externalIp),
    release: async () => {
      clearInterval(renew);
      await release().catch(() => undefined);
    },
  };
}

function isPublic(ip: string): boolean {
  return !isPrivateIpv4(ip) && !isCarrierGradeNat(ip);
}
