import { PhoneLinkServer, createIdentity, type PhoneLinkEvents } from '@commander-brawl/infrastructure/node';
import { PHONE_REPLACED_CLOSE_CODE, type PhoneToDesktop } from '@commander-brawl/infrastructure/protocol';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { get } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { waitFor } from '../support/wait';

const TOKEN = 'phone-link-token-for-tests';

describe('phone link server', () => {
  let server: PhoneLinkServer;
  let events: string[];
  let messages: PhoneToDesktop[];
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'cb-phone-'));
    await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>camera</title>');
    events = [];
    messages = [];
    const handlers: PhoneLinkEvents = {
      connected: () => events.push('connected'),
      disconnected: () => events.push('disconnected'),
      message: (message) => messages.push(message),
    };
    server = await PhoneLinkServer.start(
      { identity: await createIdentity(['127.0.0.1']), staticDir, token: TOKEN, preferredPort: 0, heartbeatMs: 200 },
      handlers,
    );
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await server.close();
  });

  function phone(token = TOKEN): WebSocket {
    const ws = new WebSocket(`wss://127.0.0.1:${server.port}/link?token=${token}`, { rejectUnauthorized: false });
    ws.on('error', () => undefined);
    sockets.push(ws);
    return ws;
  }

  function fetchPage(path: string): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      get({ host: '127.0.0.1', port: server.port, path, rejectUnauthorized: false }, (response) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body, headers: response.headers }));
      }).on('error', reject);
    });
  }

  it('serves the camera page over HTTPS', async () => {
    const page = await fetchPage('/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('camera');
    expect(page.headers['cache-control']).toBe('no-store');
  });

  it('does not serve files outside the page folder', async () => {
    expect((await fetchPage('/../../etc/passwd')).status).toBe(404);
    expect((await fetchPage('/%2e%2e/%2e%2e/etc/passwd')).status).toBe(404);
  });

  it('only lets phones with the token connect', async () => {
    const intruder = phone('wrong-token');
    const rejected = await new Promise<string>((resolve) => intruder.on('unexpected-response', (_req, res) => resolve(String(res.statusCode))));
    expect(rejected).toBe('401');
    expect(events).toEqual([]);
  });

  it('relays the phone messages and answers pings', async () => {
    const ws = phone();
    await new Promise((resolve) => ws.once('open', resolve));
    const pong = new Promise<string>((resolve) => ws.once('message', (data) => resolve(data.toString())));

    ws.send(JSON.stringify({ t: 'offer', session: 1, sdp: 'v=0' }));
    ws.send(JSON.stringify({ t: 'ping' }));

    expect(JSON.parse(await pong)).toEqual({ t: 'pong' });
    await waitFor(() => messages.length === 1);
    expect(messages).toEqual([{ t: 'offer', session: 1, sdp: 'v=0' }]);
    expect(events).toEqual(['connected']);
    expect(server.send({ t: 'answer', session: 1, sdp: 'v=0' })).toBe(true);
  });

  it('lets a new phone take over and tells the old one', async () => {
    const first = phone();
    await new Promise((resolve) => first.once('open', resolve));
    const closed = new Promise<number>((resolve) => first.once('close', (code) => resolve(code)));

    const second = phone();
    await new Promise((resolve) => second.once('open', resolve));

    expect(await closed).toBe(PHONE_REPLACED_CLOSE_CODE);
    expect(server.isConnected).toBe(true);
    expect(events).toEqual(['connected']);
  });

  it('notices when the phone disappears', async () => {
    const ws = phone();
    await new Promise((resolve) => ws.once('open', resolve));
    ws.terminate();
    await waitFor(() => events.includes('disconnected'));
    expect(server.isConnected).toBe(false);
  });

  it('builds QR code links with the token kept out of server logs', () => {
    expect(server.urls(['192.168.1.20'])).toEqual([`https://192.168.1.20:${server.port}/#${TOKEN}`]);
  });
});
