import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeGitHub {
  /** Stands in for https://api.github.com. */
  readonly apiUrl: string;
  close(): Promise<void>;
}

/** GitHub's API for the app's latest release, and the release's files, served locally. Null: no releases yet. */
export async function startFakeGitHub(
  release: { readonly version: string; readonly files: Readonly<Record<string, Buffer>> } | null,
): Promise<FakeGitHub> {
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    if (url === '/repos/Entex/commander-brawl/releases/latest') {
      if (!release) return void response.writeHead(404).end('{"message":"Not Found"}');
      const assets = Object.keys(release.files).map((name) => ({
        name,
        browser_download_url: `${apiUrl}/download/${encodeURIComponent(name)}`,
      }));
      const body = {
        tag_name: `v${release.version}`,
        html_url: `https://github.com/Entex/commander-brawl/releases/tag/v${release.version}`,
        assets,
      };
      return void response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    }
    const file = url.startsWith('/download/') ? release?.files[decodeURIComponent(url.slice(10))] : undefined;
    if (!file) return void response.writeHead(404).end();
    response.writeHead(200, { 'Content-Length': file.length }).end(file);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { apiUrl, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
