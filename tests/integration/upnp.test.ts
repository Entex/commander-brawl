import {
  addPortMapping,
  UpnpError,
  connectionService,
  deletePortMapping,
  discoverGateway,
  externalAddress,
  getConnection,
  parseSearchAnswer,
} from '@commander-brawl/infrastructure/node';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { getConnections } from '../../src/infrastructure/src/node/upnp';

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

/** A home router's description, as MiniUPnPd (version 1 of the standard) gives it. */
function description(service: string | readonly string[]): string {
  const services = typeof service === 'string' ? [service] : service;
  return `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>
    <serviceList><service>
      <serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType>
      <controlURL>/ctl/L3F</controlURL>
    </service></serviceList>
    <deviceList><device>
      <deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType>
      <deviceList><device>
        <deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType>
        <serviceList>${services
          .map(
            (type) => `<service>
          <serviceType>${type}</serviceType>
          <controlURL>/ctl/IPConn</controlURL>
        </service>`,
          )
          .join('')}</serviceList>
      </device></deviceList>
    </device></deviceList>
  </device>
</root>`;
}

/** A router that keeps port mappings, and only takes permanent ones if told to (as some do). */
async function fakeRouter(
  options: {
    onlyPermanent?: boolean;
    permanentCode?: number;
    refuse?: number;
    service?: string | readonly string[];
  } = {},
) {
  const mappings = new Map<number, { host: string; lease: number }>();
  const actions: string[] = [];
  const server = createServer((request, response) => {
    if (request.method === 'GET') {
      response.end(description(options.service ?? 'urn:schemas-upnp-org:service:WANIPConnection:1'));
      return;
    }
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const action = /#(\w+)"/.exec(String(request.headers.soapaction))?.[1] ?? '';
      actions.push(action);
      const value = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(body)?.[1] ?? '';
      const fault = (code: number, text: string) => {
        response.statusCode = 500;
        response.end(
          `<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode><errorDescription>${text}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`,
        );
      };
      if (action === 'GetExternalIPAddress') {
        response.end(
          '<s:Envelope><s:Body><u:R><NewExternalIPAddress>203.0.113.9</NewExternalIPAddress></u:R></s:Body></s:Envelope>',
        );
      } else if (action === 'AddPortMapping') {
        const lease = Number(value('NewLeaseDuration'));
        if (options.refuse) return fault(options.refuse, 'Invalid Args');
        if (options.onlyPermanent && lease !== 0)
          return fault(options.permanentCode ?? 725, 'OnlyPermanentLeasesSupported');
        mappings.set(Number(value('NewExternalPort')), { host: value('NewInternalClient'), lease });
        response.end('<s:Envelope><s:Body/></s:Envelope>');
      } else if (action === 'DeletePortMapping') {
        if (!mappings.delete(Number(value('NewExternalPort')))) return fault(714, 'NoSuchEntryInArray');
        response.end('<s:Envelope><s:Body/></s:Envelope>');
      } else {
        fault(401, 'Invalid Action');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closing.push(() => server.close());
  const location = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/rootDesc.xml`);
  return { location, mappings, actions };
}

describe('finding the router (UPnP)', () => {
  it('reads where the description is from a router answering a search', () => {
    const answer = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=120',
      'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1',
      'LOCATION: http://192.168.1.1:33995/rootDesc.xml',
      'SERVER: AsusWRT/102 UPnP/1.1 MiniUPnPd/2.2.0',
      '',
      '',
    ].join('\r\n');
    expect(parseSearchAnswer(answer)?.href).toBe('http://192.168.1.1:33995/rootDesc.xml');
    // A smart TV answering isn't a router.
    expect(parseSearchAnswer(answer.replace(/ST: .*/, 'ST: upnp:rootdevice'))).toBeNull();
  });

  it('searches from a port of its own, and finds the router that answers', async () => {
    const router = await fakeRouter();
    const responder = createSocket('udp4');
    let searchedFromPort = 0;
    responder.on('message', (message, from) => {
      searchedFromPort = from.port;
      const st = /^ST: (.*)$/m.exec(message.toString())?.[1]?.trim();
      const answer = `HTTP/1.1 200 OK\r\nST: ${st}\r\nLOCATION: ${router.location.href}\r\n\r\n`;
      responder.send(answer, from.port, from.address);
    });
    await new Promise<void>((resolve) => responder.bind(0, '127.0.0.1', resolve));
    closing.push(() => responder.close());

    const { location, localAddress } = await discoverGateway({
      target: { address: '127.0.0.1', port: responder.address().port },
      from: ['127.0.0.1'],
      router: () => null,
    });
    expect(location?.href).toBe(router.location.href);
    expect(localAddress).toBe('127.0.0.1');
    // Not UPnP's own port: on Windows a system service holds it, and would get the answer.
    expect(searchedFromPort).not.toBe(1900);
  });

  it('asks the router directly too, which answers when the search of the whole network gets nowhere', async () => {
    const router = await fakeRouter();
    // Nobody answers the search of the whole network.
    const everyone = createSocket('udp4');
    await new Promise<void>((resolve) => everyone.bind(0, '127.0.0.1', resolve));
    closing.push(() => everyone.close());
    const direct = createSocket('udp4');
    direct.on('message', (message, from) => {
      // Addressed to the router itself.
      if (!message.toString().includes(`HOST: 127.0.0.1:${direct.address().port}\r\n`)) return;
      const st = /^ST: (.*)$/m.exec(message.toString())?.[1]?.trim();
      direct.send(`HTTP/1.1 200 OK\r\nST: ${st}\r\nLOCATION: ${router.location.href}\r\n\r\n`, from.port, from.address);
    });
    await new Promise<void>((resolve) => direct.bind(0, '127.0.0.1', resolve));
    closing.push(() => direct.close());

    const { location } = await discoverGateway({
      target: { address: '127.0.0.1', port: everyone.address().port },
      from: ['127.0.0.1'],
      router: () => ({ address: '127.0.0.1', port: direct.address().port }),
    });
    expect(location?.href).toBe(router.location.href);
  });

  it("finds the router's port forwarding service, in version 1 or 2 of the standard", () => {
    const location = new URL('http://192.168.1.1:33995/rootDesc.xml');
    for (const service of [
      'urn:schemas-upnp-org:service:WANIPConnection:1',
      'urn:schemas-upnp-org:service:WANIPConnection:2',
      'urn:schemas-upnp-org:service:WANPPPConnection:1',
    ]) {
      const found = connectionService(description(service), location);
      expect(found?.serviceType).toBe(service);
      expect(found?.controlUrl.href).toBe('http://192.168.1.1:33995/ctl/IPConn');
    }
    expect(connectionService(description('urn:example:something-else'), location)).toBeNull();
  });

  it('finishes cleanly and reports the socket error when an adapter cannot be bound', async () => {
    const result = await discoverGateway({ from: ['192.0.2.1'], router: () => null, timeoutMs: 200 });
    expect(result).toMatchObject({ location: null, localAddress: null, sendError: 'EADDRNOTAVAIL' });
  });

  it('keeps all forwarding services so a rejected service can fall back to another', async () => {
    const v1 = 'urn:schemas-upnp-org:service:WANIPConnection:1';
    const v2 = 'urn:schemas-upnp-org:service:WANIPConnection:2';
    const router = await fakeRouter({ service: [v1, v2] });
    expect((await getConnections(router.location)).map((service) => service.serviceType)).toEqual([v2, v1]);
  });
});

describe('forwarding a port on the router (UPnP)', () => {
  it('forwards the port, says the internet address, and removes the forward again', async () => {
    const router = await fakeRouter();
    const connection = await getConnection(router.location);
    expect(await addPortMapping(connection, 47801, '192.168.1.59', 'Commander Brawl', 3600)).toBe(3600);
    expect(router.mappings.get(47801)).toEqual({ host: '192.168.1.59', lease: 3600 });
    expect(await externalAddress(connection)).toBe('203.0.113.9');
    await deletePortMapping(connection, 47801);
    expect(router.mappings.size).toBe(0);
  });

  it('asks again for a permanent forward when the router only does those', async () => {
    const router = await fakeRouter({ onlyPermanent: true });
    const connection = await getConnection(router.location);
    expect(await addPortMapping(connection, 47801, '192.168.1.59', 'Commander Brawl', 3600)).toBe(0);
    expect(router.mappings.get(47801)?.lease).toBe(0);
    expect(router.actions).toEqual(['AddPortMapping', 'AddPortMapping']);
  });

  it('tries a permanent lease once when a v1 service rejects the timed lease with generic Invalid Args', async () => {
    const router = await fakeRouter({ onlyPermanent: true, permanentCode: 402 });
    const connection = await getConnection(router.location);
    expect(await addPortMapping(connection, 47801, '192.168.1.235', 'Commander Brawl', 3600)).toBe(0);
    expect(router.mappings.get(47801)).toEqual({ host: '192.168.1.235', lease: 0 });
    expect(router.actions).toEqual(['AddPortMapping', 'AddPortMapping']);
  });

  it('reports the failed action and router error code if both lease attempts fail', async () => {
    const router = await fakeRouter({ refuse: 402 });
    const connection = await getConnection(router.location);
    await expect(addPortMapping(connection, 47801, '192.168.1.235', 'Commander Brawl', 3600)).rejects.toMatchObject({
      name: 'UpnpError',
      code: 402,
      message: 'AddPortMapping: Invalid Args (UPnP 402)',
    });
    expect(router.actions).toEqual(['AddPortMapping', 'AddPortMapping']);
  });

  it('does not retry authorization errors or request permanent leases from a v2 service', async () => {
    for (const options of [
      { refuse: 606 },
      { refuse: 402, service: 'urn:schemas-upnp-org:service:WANIPConnection:2' },
    ]) {
      const router = await fakeRouter(options);
      const connection = await getConnection(router.location);
      await expect(addPortMapping(connection, 47801, '192.168.1.235', 'Commander Brawl', 3600)).rejects.toBeInstanceOf(
        UpnpError,
      );
      expect(router.actions).toEqual(['AddPortMapping']);
    }
  });
});
