import { gatewayAddresses } from './gateway';
import { NatPmpError, natPmpExternalAddress, natPmpMapTcp, type NatPmpRouter } from './natPmp';
import { isCarrierGradeNat, isPrivateIpv4, lanAddresses, likelyRouter } from './network';
import {
  addPortMapping,
  deletePortMapping,
  discoverGateway,
  externalAddress,
  getConnections,
  type UpnpConnection,
} from './upnp';

export type PortMappingResult =
  | {
      readonly ok: true;
      readonly externalIp: string;
      readonly externalPort: number;
      /** The router reports a public address. The computer's firewall can still block incoming connections. */
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
  const addresses = [...new Set([internalHost, ...lanAddresses()])];
  const gateways = await gatewayAddresses();
  const routerFor = (address: string) => gateways.get(address) ?? likelyRouter(address);
  const { location, localAddress, sendError } = await discoverGateway({
    timeoutMs,
    from: addresses,
    router: (from) => {
      const address = routerFor(from);
      return address ? { address, port: 1900 } : null;
    },
  });
  let refused: string | null = null;
  if (location) {
    try {
      return await openWithUpnp(location, port, localAddress ?? internalHost);
    } catch (error) {
      refused = `The router refused to open port ${port}: ${(error as Error).message}`;
    }
  }

  const natPmpErrors: unknown[] = [];
  // Don't waste time asking inactive VPN adapters when the system has told us where the real gateways are.
  const candidates = addresses.filter((address) => gateways.size === 0 || gateways.has(address));
  for (const from of candidates) {
    const router = routerFor(from);
    if (!router) continue;
    try {
      return await openWithNatPmp({ address: router, from }, port);
    } catch (error) {
      natPmpErrors.push(error);
    }
  }

  if (refused) return { ok: false, reason: refused };
  const natPmpError = natPmpErrors.find((error) => error instanceof NatPmpError && error.code !== null);
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
  const portTaken = natPmpErrors.find((error) => error instanceof RouterPortTaken);
  if (portTaken) return { ok: false, reason: portTaken.message };
  return {
    ok: false,
    reason: 'No router answered (UPnP or NAT-PMP). Turn on UPnP on the router, or forward the port manually.',
  };
}

async function openWithUpnp(location: URL, port: number, internalHost: string): Promise<PortMappingResult> {
  const connections = await getConnections(location);
  let failure: unknown;
  for (const connection of connections) {
    try {
      return await openWithUpnpService(connection, port, internalHost);
    } catch (error) {
      failure ??= error;
    }
  }
  throw failure;
}

async function openWithUpnpService(
  connection: UpnpConnection,
  port: number,
  internalHost: string,
): Promise<PortMappingResult> {
  // Read the address before opening the port, so a failed address lookup doesn't leave an orphaned mapping.
  const externalIp = await externalAddress(connection);
  const lease = await addPortMapping(connection, port, internalHost, DESCRIPTION, LEASE_SECONDS);
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
