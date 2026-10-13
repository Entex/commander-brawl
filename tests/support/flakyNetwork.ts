import { createServer, connect, type AddressInfo, type Server, type Socket } from 'node:net';

/**
 * A TCP proxy in front of a server, standing in for the internet between a player and the host.
 * cut() drops every connection like a Wi-Fi hiccup; block() also refuses new ones like an outage, until unblock().
 */
export class FlakyNetwork {
  private readonly sockets = new Set<Socket>();
  private readonly server: Server;
  private blocked = false;
  port = 0;

  private constructor(private readonly targetPort: number) {
    this.server = createServer((client) => this.accept(client));
  }

  static async start(targetPort: number): Promise<FlakyNetwork> {
    const network = new FlakyNetwork(targetPort);
    await new Promise<void>((resolve) => network.server.listen(0, '127.0.0.1', resolve));
    network.port = (network.server.address() as AddressInfo).port;
    return network;
  }

  cut(): void {
    for (const socket of this.sockets) socket.destroy();
  }

  block(): void {
    this.blocked = true;
    this.cut();
  }

  unblock(): void {
    this.blocked = false;
  }

  close(): Promise<void> {
    this.cut();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private accept(client: Socket): void {
    if (this.blocked) {
      client.destroy();
      return;
    }
    const upstream = connect(this.targetPort, '127.0.0.1');
    for (const socket of [client, upstream]) {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('error', () => undefined);
    }
    client.pipe(upstream).pipe(client);
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  }
}
