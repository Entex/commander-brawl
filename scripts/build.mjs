// Builds the desktop app into build/app: the Electron main process, the UI, and the phone camera page.
import { build as esbuild } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

// @achingbrain/ssdp (used for opening router ports) reads its own package.json at runtime,
// which doesn't exist inside the bundle. Inline the two values it needs.
const inlineSsdpPackageJson = {
  name: 'inline-ssdp-package-json',
  setup(build) {
    build.onLoad({ filter: /[\\/]@achingbrain[\\/]ssdp[\\/]dist[\\/]src[\\/]ssdp\.js$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const pkg = JSON.parse(await readFile(resolve(args.path, '../../../package.json'), 'utf8'));
      const pattern =
        /const req = createRequire\(import\.meta\.url\);\s*const \{ name, version \} = req\('\.\.\/\.\.\/package\.json'\);/;
      if (!pattern.test(source))
        throw new Error('@achingbrain/ssdp changed; update inlineSsdpPackageJson in scripts/build.mjs');
      const values = JSON.stringify({ name: pkg.name, version: pkg.version });
      return { contents: source.replace(pattern, `const { name, version } = ${values};`), loader: 'js' };
    });
  },
};

export async function buildMain() {
  const shared = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    sourcemap: 'linked',
    external: ['electron', 'bufferutil', 'utf-8-validate'],
    plugins: [inlineSsdpPackageJson],
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
