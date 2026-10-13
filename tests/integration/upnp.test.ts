import {
  addPortMapping,
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

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

/** A home router's description, as MiniUPnPd (version 1 of the standard) gives it. */
function description(service: string): string {
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
        <serviceList><service>
          <serviceType>${service}</serviceType>
          <controlURL>/ctl/IPConn</controlURL>
        </service></serviceList>
      </device></deviceList>
    </device></deviceList>
  </device>
</root>`;
}

/** A router that keeps port mappings, and only takes permanent ones if told to (as some do). */
async function fakeRouter(options: { onlyPermanent?: boolean } = {}) {
  const mappings = new Map<number, { host: string; lease: number }>();
  const actions: string[] = [];
  const server = createServer((request, response) => {
    if (request.method === 'GET') {
      response.end(description('urn:schemas-upnp-org:service:WANIPConnection:1'));
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
        if (options.onlyPermanent && lease !== 0) return fault(725, 'OnlyPermanentLeasesSupported');
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

    const location = await discoverGateway({
      target: { address: '127.0.0.1', port: responder.address().port },
      from: ['127.0.0.1'],
    });
    expect(location?.href).toBe(router.location.href);
    // Not UPnP's own port: on Windows a system service holds it, and would get the answer.
    expect(searchedFromPort).not.toBe(1900);
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
});
