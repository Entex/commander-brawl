import { createSocket } from 'node:dgram';
import { lanAddresses, likelyRouter } from './network';

/**
 * Just enough UPnP (Internet Gateway Device, versions 1 and 2) to ask a home router to forward a port: find it,
 * read its internet address, add and remove a port mapping.
 */

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
/** What to search for: routers answer to some of these and not others. */
const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
];
/** The services that forward ports, best first. */
const CONNECTION_SERVICES = [
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
];

/** A router's service for forwarding ports: where to send requests, and what it calls itself. */
export interface UpnpConnection {
  readonly controlUrl: URL;
  readonly serviceType: string;
}

export class UpnpError extends Error {
  constructor(
    message: string,
    /** The router's error code (UPnP), if it gave one. */
    readonly code: number | null = null,
  ) {
    super(message);
    this.name = 'UpnpError';
  }
}

interface Destination {
  readonly address: string;
  readonly port: number;
}

export interface DiscoverOptions {
  readonly timeoutMs?: number;
  /** Where to send the search: the UPnP multicast address, or a test's own responder. */
  readonly target?: Destination;
  /** Addresses to search from. This computer's addresses at home by default. */
  readonly from?: readonly string[];
  /** Where the router probably is, to also ask it directly. Its network's first address by default. */
  readonly router?: (from: string) => Destination | null;
}

export interface Discovery {
  /** Where the router's description is, if a router answered. */
  readonly location: URL | null;
  /**
   * Why the search couldn't be sent to everyone on the network, if it couldn't (like EHOSTUNREACH): the system
   * may have blocked it, as macOS does for apps not allowed on the local network.
   */
  readonly sendError: string | null;
}

/** Searched again after this long, in case the first search or its answer got lost (Wi-Fi drops some). */
const SEARCH_AGAIN_MS = 1_000;

/**
 * Searches the home network for a router that forwards ports, and finds where its description is. The search goes
 * to everyone on the network (multicast), and to where the router probably is, which gets through where multicast
 * doesn't. It's sent from a port of our own, not UPnP's 1900: on Windows the SSDP Discovery service holds that one,
 * and gets the routers' answers sent to it.
 */
export function discoverGateway(options: DiscoverOptions = {}): Promise<Discovery> {
  const {
    timeoutMs = 4_000,
    target = { address: SSDP_ADDRESS, port: SSDP_PORT },
    router = (from: string) => {
      const address = likelyRouter(from);
      return address ? { address, port: SSDP_PORT } : null;
    },
  } = options;
  const from = options.from ?? lanAddresses();
  return new Promise((resolve) => {
    if (from.length === 0) {
      resolve({ location: null, sendError: null });
      return;
    }
    const sockets = from.map(() => createSocket({ type: 'udp4', reuseAddr: true }));
    let sendError: string | null = null;
    let settled = false;
    const done = (location: URL | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(again);
      for (const socket of sockets) socket.close();
      resolve({ location, sendError: location ? null : sendError });
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    const searches: (() => void)[] = [];
    const again = setTimeout(() => searches.forEach((search) => search()), SEARCH_AGAIN_MS);
    sockets.forEach((socket, i) => {
      const address = from[i]!;
      const direct = router(address);
      socket.on('message', (message) => {
        const location = parseSearchAnswer(message.toString());
        if (location) done(location);
      });
      socket.on('error', () => undefined);
      const search = () => {
        if (settled) return;
        for (const searchTarget of SEARCH_TARGETS) {
          socket.send(searchRequest(searchTarget, target), target.port, target.address, (error) => {
            sendError ??= (error as NodeJS.ErrnoException | null)?.code ?? null;
          });
          if (direct) socket.send(searchRequest(searchTarget, direct), direct.port, direct.address, () => undefined);
        }
      };
      socket.bind(0, address, () => {
        // Out of this address's network, not wherever the system sends multicast (which may be another network).
        if (target.address === SSDP_ADDRESS) {
          try {
            socket.setMulticastInterface(address);
          } catch {
            // Left to the system.
          }
        }
        searches.push(search);
        search();
      });
    });
  });
}

export function searchRequest(searchTarget: string, target = { address: SSDP_ADDRESS, port: SSDP_PORT }): string {
  return [
    'M-SEARCH * HTTP/1.1',
    `HOST: ${target.address}:${target.port}`,
    'MAN: "ssdp:discover"',
    'MX: 2',
    `ST: ${searchTarget}`,
    '',
    '',
  ].join('\r\n');
}

/** Where the description is, in a router's answer to a search for a gateway (null if it isn't one). */
export function parseSearchAnswer(answer: string): URL | null {
  if (!/^HTTP\/1\.[01] 200/i.test(answer)) return null;
  const searchTarget = header(answer, 'ST') ?? '';
  if (!SEARCH_TARGETS.includes(searchTarget)) return null;
  const location = header(answer, 'LOCATION');
  if (!location) return null;
  try {
    const url = new URL(location);
    return url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function header(message: string, name: string): string | null {
  const match = new RegExp(`^${name}:[ \\t]*(.*?)[ \\t]*$`, 'im').exec(message);
  return match?.[1] ?? null;
}

/** The router's port forwarding service, from its description (the XML its search answer points to). */
export function connectionService(description: string, location: URL): UpnpConnection | null {
  const base = tagText(description, 'URLBase') ?? location.href;
  const services = [...description.matchAll(/<service>([\s\S]*?)<\/service>/gi)].map(([, body]) => ({
    serviceType: tagText(body!, 'serviceType') ?? '',
    controlUrl: tagText(body!, 'controlURL') ?? '',
  }));
  for (const wanted of CONNECTION_SERVICES) {
    const service = services.find((s) => s.serviceType === wanted && s.controlUrl);
    if (service) return { serviceType: service.serviceType, controlUrl: new URL(service.controlUrl, base) };
  }
  return null;
}

function tagText(xml: string, tag: string): string | null {
  const match = new RegExp(`<(?:\\w+:)?${tag}>\\s*([\\s\\S]*?)\\s*</(?:\\w+:)?${tag}>`, 'i').exec(xml);
  return match ? decodeXml(match[1]!) : null;
}

function decodeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function encodeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Fetches a router's description and finds its port forwarding service. */
export async function getConnection(location: URL, timeoutMs = 5_000): Promise<UpnpConnection> {
  const response = await fetch(location, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new UpnpError(`The router's description couldn't be read (${response.status}).`);
  const service = connectionService(await response.text(), location);
  if (!service) throw new UpnpError("The router doesn't offer port forwarding over UPnP.");
  return service;
}

/** Sends a request (a SOAP action) to the router, and returns the values in its answer. */
export async function callAction(
  connection: UpnpConnection,
  action: string,
  args: Readonly<Record<string, string | number>>,
  timeoutMs = 5_000,
): Promise<Record<string, string>> {
  const body =
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${connection.serviceType}">` +
    Object.entries(args)
      .map(([name, value]) => `<${name}>${encodeXml(String(value))}</${name}>`)
      .join('') +
    `</u:${action}></s:Body></s:Envelope>`;
  const response = await fetch(connection.controlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${connection.serviceType}#${action}"` },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    const code = Number(tagText(text, 'errorCode'));
    const description = tagText(text, 'errorDescription') ?? `HTTP ${response.status}`;
    throw new UpnpError(description, Number.isFinite(code) ? code : null);
  }
  const values: Record<string, string> = {};
  for (const [, name, value] of text.matchAll(/<(New\w+)>([\s\S]*?)<\/\1>/g)) values[name!] = decodeXml(value!);
  return values;
}

/** The router's address on the internet. */
export async function externalAddress(connection: UpnpConnection): Promise<string> {
  const { NewExternalIPAddress: address } = await callAction(connection, 'GetExternalIPAddress', {});
  if (!address) throw new UpnpError("The router didn't say its internet address.");
  return address;
}

/** "Only permanent leases supported": the router keeps mappings until they're removed, and wants a lease of 0. */
const ONLY_PERMANENT_LEASES = 725;

/** Forwards a TCP port on the router to this computer. Returns the lease the router took, in seconds (0: until removed). */
export async function addPortMapping(
  connection: UpnpConnection,
  port: number,
  internalHost: string,
  description: string,
  leaseSeconds: number,
): Promise<number> {
  const args = (lease: number) => ({
    NewRemoteHost: '',
    NewExternalPort: port,
    NewProtocol: 'TCP',
    NewInternalPort: port,
    NewInternalClient: internalHost,
    NewEnabled: 1,
    NewPortMappingDescription: description,
    NewLeaseDuration: lease,
  });
  try {
    await callAction(connection, 'AddPortMapping', args(leaseSeconds));
    return leaseSeconds;
  } catch (error) {
    if (!(error instanceof UpnpError) || error.code !== ONLY_PERMANENT_LEASES || leaseSeconds === 0) throw error;
    await callAction(connection, 'AddPortMapping', args(0));
    return 0;
  }
}

export async function deletePortMapping(connection: UpnpConnection, port: number): Promise<void> {
  await callAction(connection, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' });
}
