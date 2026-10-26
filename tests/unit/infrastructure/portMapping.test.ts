import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { gatewayAddresses } from '../../../src/infrastructure/src/node/gateway';
import { NatPmpError, natPmpExternalAddress, natPmpMapTcp } from '../../../src/infrastructure/src/node/natPmp';
import { lanAddresses, likelyRouter } from '../../../src/infrastructure/src/node/network';
import { openRouterPort, type PortMappingResult } from '../../../src/infrastructure/src/node/portMapping';
import {
  addPortMapping,
  deletePortMapping,
  discoverGateway,
  externalAddress,
  getConnections,
  UpnpError,
} from '../../../src/infrastructure/src/node/upnp';

vi.mock('../../../src/infrastructure/src/node/gateway');
vi.mock('../../../src/infrastructure/src/node/network');
vi.mock('../../../src/infrastructure/src/node/upnp', async (original) => ({
  ...(await original<typeof import('../../../src/infrastructure/src/node/upnp')>()),
  addPortMapping: vi.fn(),
  deletePortMapping: vi.fn(),
  discoverGateway: vi.fn(),
  externalAddress: vi.fn(),
  getConnections: vi.fn(),
}));
vi.mock('../../../src/infrastructure/src/node/natPmp', async (original) => ({
  ...(await original<typeof import('../../../src/infrastructure/src/node/natPmp')>()),
  natPmpExternalAddress: vi.fn(),
  natPmpMapTcp: vi.fn(),
}));

const primary = '192.168.1.235';
const wifi = '192.168.50.137';
const location = new URL('http://192.168.50.254/root.xml');
const v1 = { serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1', controlUrl: new URL('/v1', location) };
const v2 = { serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:2', controlUrl: new URL('/v2', location) };
const mappings: PortMappingResult[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(lanAddresses).mockReturnValue([primary, wifi]);
  vi.mocked(likelyRouter).mockReturnValue(null);
  vi.mocked(gatewayAddresses).mockResolvedValue(new Map([[wifi, '192.168.50.254']]));
  vi.mocked(discoverGateway).mockResolvedValue({ location, localAddress: wifi, sendError: null });
  vi.mocked(getConnections).mockResolvedValue([v1]);
  vi.mocked(externalAddress).mockResolvedValue('203.0.113.9');
  vi.mocked(addPortMapping).mockResolvedValue(3600);
  vi.mocked(deletePortMapping).mockResolvedValue(undefined);
  vi.mocked(natPmpExternalAddress).mockRejectedValue(new NatPmpError('No answer'));
  vi.mocked(natPmpMapTcp).mockResolvedValue({ externalPort: 47801, leaseSeconds: 3600 });
});

afterEach(async () => {
  for (const mapping of mappings.splice(0)) if (mapping.ok) await mapping.release();
});

async function open() {
  const mapping = await openRouterPort(47801, primary);
  mappings.push(mapping);
  return mapping;
}

it('maps to the adapter that found the router, and uses its actual gateway for direct discovery', async () => {
  expect(await open()).toMatchObject({ ok: true, externalIp: '203.0.113.9' });
  expect(addPortMapping).toHaveBeenCalledWith(v1, 47801, wifi, 'Commander Brawl', 3600);
  const options = vi.mocked(discoverGateway).mock.calls[0]![0]!;
  expect(options.from).toEqual([primary, wifi]);
  expect(options.router!(wifi)).toEqual({ address: '192.168.50.254', port: 1900 });
});

it('tries the advertised v1 service when v2 rejects the mapping', async () => {
  vi.mocked(getConnections).mockResolvedValue([v2, v1]);
  vi.mocked(addPortMapping).mockRejectedValueOnce(new UpnpError('Invalid Args', 402)).mockResolvedValue(3600);
  expect(await open()).toMatchObject({ ok: true });
  expect(vi.mocked(addPortMapping).mock.calls.map(([connection]) => connection)).toEqual([v2, v1]);
});

it('uses the configured gateway for NAT-PMP even when the first adapter has no gateway', async () => {
  vi.mocked(discoverGateway).mockResolvedValue({ location: null, localAddress: null, sendError: null });
  vi.mocked(natPmpExternalAddress).mockResolvedValue('203.0.113.9');
  expect(await open()).toMatchObject({ ok: true });
  expect(natPmpExternalAddress).toHaveBeenCalledExactlyOnceWith({ address: '192.168.50.254', from: wifi });
  expect(natPmpMapTcp).toHaveBeenCalledWith({ address: '192.168.50.254', from: wifi }, 47801, 3600);
});

it('keeps an explicit NAT-PMP refusal when an earlier gateway timed out', async () => {
  vi.mocked(gatewayAddresses).mockResolvedValue(
    new Map([
      [primary, '192.168.1.1'],
      [wifi, '192.168.50.254'],
    ]),
  );
  vi.mocked(discoverGateway).mockResolvedValue({ location: null, localAddress: null, sendError: null });
  vi.mocked(natPmpExternalAddress)
    .mockRejectedValueOnce(new NatPmpError('No answer'))
    .mockRejectedValueOnce(new NatPmpError('NAT-PMP is disabled', 2));
  expect(await open()).toEqual({ ok: false, reason: 'The router refused to open port 47801: NAT-PMP is disabled' });
});

it('does not leave a mapping behind when the external-address request fails', async () => {
  vi.mocked(externalAddress).mockRejectedValue(new UpnpError('GetExternalIPAddress: Invalid Args (UPnP 402)', 402));
  const result = await open();
  expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('GetExternalIPAddress') });
  expect(addPortMapping).not.toHaveBeenCalled();
});
