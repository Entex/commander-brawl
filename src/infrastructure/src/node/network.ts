import { networkInterfaces } from 'node:os';

// Virtual adapters from Docker, VMs and VPNs. A phone on the home Wi-Fi can't reach these.
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|vethernet|utun|tun|tap|wg|tailscale|zt)/i;

/** Private IPv4 addresses of this computer on the local network, best guess first. */
export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address)) {
        found.push(entry.address);
      }
    }
  }
  return [...new Set(found)].sort((a, b) => privateRangeRank(a) - privateRangeRank(b));
}

/** Public IPv6 addresses. Routers don't translate these, so friends may reach them directly. */
export function globalIpv6Addresses(): string[] {
  const found: string[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv6' && !entry.internal && /^[23]/.test(entry.address)) {
        found.push(entry.address);
      }
    }
  }
  return [...new Set(found)];
}

export function isPrivateIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Carrier-grade NAT: the internet provider shares one public address between many customers.
 * Nobody outside can connect in, even with a port forward on the home router.
 */
export function isCarrierGradeNat(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) return false;
  const [a, b] = octets;
  return a === 100 && b >= 64 && b <= 127;
}

function privateRangeRank(ip: string): number {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  return 2;
}

function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets as [number, number, number, number];
}
