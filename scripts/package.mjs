// Packages the app into release/, ready to attach to a GitHub release:
//   commander-brawl-win32-x64.zip, commander-brawl-darwin-arm64.tar.gz, ... plus the install scripts and SHA256SUMS.
// Usage: npm run package                      (every platform)
//        npm run package -- linux-x64 win32-x64 (only these)
import { packager } from '@electron/packager';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildApp } from './build.mjs';

const root = resolve(import.meta.dirname, '..');
const release = resolve(root, 'release');
const staging = resolve(release, 'staging');
const ALL_TARGETS = ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'];

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ALL_TARGETS;
for (const target of targets) {
  if (!ALL_TARGETS.includes(target)) throw new Error(`Unknown target ${target}. Pick from: ${ALL_TARGETS.join(', ')}`);
}

const { out: appDir, version } = await buildApp();
const electronVersion = JSON.parse(await readFile(resolve(root, 'node_modules/electron/package.json'), 'utf8')).version;
await rm(release, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

const archives = [];
for (const target of targets) {
  const [platform, arch] = target.split('-');
  console.log(`Packaging ${target}…`);
  const [packaged] = await packager({
    dir: appDir,
    out: staging,
    platform,
    arch,
    electronVersion,
    name: 'Commander Brawl',
    executableName: 'commander-brawl',
    appVersion: version,
    appBundleId: 'io.github.entex.commanderbrawl',
    appCategoryType: 'public.app-category.board-games',
    asar: true,
    prune: false,
    overwrite: true,
    quiet: true,
    darwinDarkModeSupport: true,
    win32metadata: { CompanyName: 'Commander Brawl', ProductName: 'Commander Brawl', FileDescription: 'Commander Brawl' },
    extendInfo: {
      NSCameraUsageDescription: 'Commander Brawl shows your play area to the other players.',
      NSLocalNetworkUsageDescription: 'Commander Brawl connects to your phone camera and to players on your network.',
    },
  });

  // Every archive holds one folder, commander-brawl/, with the app and an app-version file.
  // (Not "VERSION": Electron already ships a "version" file, and Windows ignores case.)
  const folder = join(staging, `${target}-root`);
  const content = join(folder, 'commander-brawl');
  await mkdir(folder, { recursive: true });
  if (platform === 'darwin') {
    await mkdir(content);
    await rename(join(packaged, 'Commander Brawl.app'), join(content, 'Commander Brawl.app'));
  } else {
    await rename(packaged, content);
  }
  await writeFile(join(content, 'app-version'), `${version}\n`);

  const name = `commander-brawl-${target}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const archive = join(release, name);
  if (platform === 'win32') {
    if (process.platform === 'win32') run('tar', ['-a', '-cf', archive, 'commander-brawl'], folder);
    else run('zip', ['-qry', archive, 'commander-brawl'], folder);
  } else {
    // tar keeps the symlinks and permissions the macOS app bundle and Linux sandbox need.
    run('tar', ['-czf', archive, 'commander-brawl'], folder);
  }
  archives.push(name);
}

for (const script of ['install.sh', 'install.ps1']) {
  await copyFile(resolve(root, 'scripts', script), join(release, script));
}
const sums = [];
for (const name of [...archives, 'install.sh', 'install.ps1']) {
  const hash = createHash('sha256').update(await readFile(join(release, name))).digest('hex');
  sums.push(`${hash}  ${name}`);
}
await writeFile(join(release, 'SHA256SUMS'), `${sums.join('\n')}\n`);
await rm(staging, { recursive: true, force: true });
console.log(`Commander Brawl ${version} is in ${release}:\n  ${[...archives, 'install.sh', 'install.ps1', 'SHA256SUMS'].join('\n  ')}`);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}
