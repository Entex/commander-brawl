import { execFile } from 'node:child_process';
import { isIPv4 } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { promisify } from 'node:util';

const execute = promisify(execFile);
type Interfaces = Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>>;

/** The configured IPv4 gateways, keyed by this computer's address on each network. No network traffic is sent. */
export async function gatewayAddresses(): Promise<ReadonlyMap<string, string>> {
  const platform = process.platform;
  const command =
    platform === 'win32'
      ? { file: 'route.exe', args: ['print', '-4'] }
      : platform === 'darwin'
        ? { file: '/sbin/route', args: ['-n', 'get', 'default'] }
        : { file: 'ip', args: ['-4', 'route', 'show', 'default'] };
  try {
    const { stdout } = await execute(command.file, command.args, { timeout: 2_000, windowsHide: true });
    return parseGatewayAddresses(stdout, platform, networkInterfaces());
  } catch {
    // Minimal Linux installs may have no ip command. UPnP multicast still works, and callers can try a guess.
    return new Map();
  }
}

/** Parses native route output without depending on localized column headings. */
export function parseGatewayAddresses(output: string, platform: string, interfaces: Interfaces): Map<string, string> {
  const gateways = new Map<string, string>();
  const addInterface = (name: string, gateway: string) => {
    if (!isIPv4(gateway) || gateway === '0.0.0.0') return;
    for (const entry of interfaces[name] ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) gateways.set(entry.address, gateway);
    }
  };
  if (platform === 'win32') {
    // Destination, mask, next hop, local address, metric. Persistent routes don't have a local address here.
    const routes = [...output.matchAll(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s*$/gm)];
    routes.sort((a, b) => Number(a[3]) - Number(b[3]));
    for (const [, gateway, address] of routes) {
      if (gateway && address && isIPv4(gateway) && isIPv4(address) && gateway !== '0.0.0.0') {
        if (!gateways.has(address)) gateways.set(address, gateway);
      }
    }
  } else if (platform === 'darwin') {
    const gateway = /^\s*gateway:\s*([\d.]+)\s*$/m.exec(output)?.[1];
    const name = /^\s*interface:\s*(\S+)\s*$/m.exec(output)?.[1];
    if (gateway && name) addInterface(name, gateway);
  } else {
    for (const [, gateway, name] of output.matchAll(/^default\s+via\s+([\d.]+)\s+dev\s+(\S+)/gm)) {
      if (gateway && name) addInterface(name, gateway);
    }
  }
  return gateways;
}
