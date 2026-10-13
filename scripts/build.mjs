// Builds the desktop app into build/app: the Electron main process, the UI, and the phone camera page.
import { build as esbuild } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as viteBuild } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'build/app');
const desktop = resolve(root, 'src/desktop');

export async function buildApp() {
  await rm(out, { recursive: true, force: true });
  await viteBuild({ configFile: resolve(desktop, 'vite.config.ts'), logLevel: 'warn' });
  await buildPhone();
  await buildMain();
  await copyFile(resolve(root, 'assets/icon.png'), resolve(out, 'icon.png'));
  return { out, version: await writeAppPackageJson() };
}

export async function buildPhone() {
  await viteBuild({ configFile: resolve(root, 'src/phone/vite.config.ts'), logLevel: 'warn' });
}

/** The package.json Electron reads to start the app. */
export async function writeAppPackageJson() {
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  await mkdir(out, { recursive: true });
  await writeFile(
    resolve(out, 'package.json'),
    JSON.stringify(
      { name: 'commander-brawl', productName: 'Commander Brawl', version, author: 'Commander Brawl', main: 'main.cjs' },
      null,
      2,
    ),
  );
  return version;
}

export async function buildMain() {
  const shared = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    sourcemap: 'linked',
    external: ['electron', 'bufferutil', 'utf-8-validate'],
    logLevel: 'warning',
  };
  await Promise.all([
    esbuild({ ...shared, entryPoints: [resolve(desktop, 'src/main/main.ts')], outfile: resolve(out, 'main.cjs') }),
    esbuild({
      ...shared,
      entryPoints: [resolve(desktop, 'src/preload/preload.ts')],
      outfile: resolve(out, 'preload.cjs'),
    }),
  ]);
}

if (import.meta.main) {
  const { out: dir, version } = await buildApp();
  console.log(`Built Commander Brawl ${version} into ${dir}`);
}
