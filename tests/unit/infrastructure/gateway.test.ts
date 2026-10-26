import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseGatewayAddresses } from '../../../src/infrastructure/src/node/gateway';

function ipv4(address: string): NetworkInterfaceInfo {
  return {
    address,
    family: 'IPv4',
    internal: false,
    netmask: '255.255.255.0',
    mac: '00:00:00:00:00:00',
    cidr: `${address}/24`,
  };
}

describe('reading the actual default gateway', () => {
  it('reads Windows routes with CRLF and localized headings, choosing the lowest metric per adapter', () => {
    const output = [
      'Aktiva v\u00e4gar:',
      '  0.0.0.0  0.0.0.0  192.168.50.1    192.168.50.137  50',
      '  0.0.0.0  0.0.0.0  192.168.50.254  192.168.50.137  10',
      '  0.0.0.0  0.0.0.0  192.168.1.254   192.168.1.235   25',
      '  0.0.0.0  0.0.0.0  On-link         10.0.0.2        1',
      '  0.0.0.0  0.0.0.0  999.1.1.1       192.168.2.5     1',
      'Best\u00e4ndiga v\u00e4gar:',
      '  0.0.0.0  0.0.0.0  192.168.3.1    1',
    ].join('\r\n');
    expect([...parseGatewayAddresses(output, 'win32', {})]).toEqual([
      ['192.168.50.137', '192.168.50.254'],
      ['192.168.1.235', '192.168.1.254'],
    ]);
  });

  it('matches the macOS default route to its interface, including routers not ending in .1', () => {
    const output = '   route to: default\n destination: default\n gateway: 192.168.1.254\n interface: en0\n';
    expect([...parseGatewayAddresses(output, 'darwin', { en0: [ipv4('192.168.1.59')] })]).toEqual([
      ['192.168.1.59', '192.168.1.254'],
    ]);
  });

  it('reads Linux gateways for multiple interfaces and skips routes without a gateway', () => {
    const output = [
      'default via 192.168.50.254 dev wlan0 proto dhcp src 192.168.50.137 metric 600',
      'default via 10.0.0.254 dev eth0 proto dhcp metric 100',
      'default dev tun0 scope link',
    ].join('\n');
    expect([
      ...parseGatewayAddresses(output, 'linux', {
        wlan0: [ipv4('192.168.50.137')],
        eth0: [ipv4('10.0.0.8')],
        tun0: [ipv4('10.8.0.2')],
      }),
    ]).toEqual([
      ['192.168.50.137', '192.168.50.254'],
      ['10.0.0.8', '10.0.0.254'],
    ]);
  });
});
