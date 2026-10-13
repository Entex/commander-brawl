// Runs the app with live reload for the UI. Changes to the main process need a restart of `npm run dev`.
// Extra arguments go to Electron, e.g. `npm run dev -- --use-fake-device-for-media-stream`.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { buildMain, buildPhone, writeAppPackageJson } from './build.mjs';

const root = resolve(import.meta.dirname, '..');

const server = await createServer({ configFile: resolve(root, 'src/desktop/vite.config.ts') });
await server.listen();
await writeAppPackageJson();
await Promise.all([buildPhone(), buildMain()]);

const url = server.resolvedUrls?.local[0];
console.log(`UI served from ${url}`);
const electron = spawn(
  resolve(root, 'node_modules/.bin/electron'),
  [resolve(root, 'build/app'), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, CB_RENDERER_URL: url },
    shell: process.platform === 'win32',
  },
);
electron.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
