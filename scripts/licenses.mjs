// Writes THIRD_PARTY_LICENSES.txt: the license of every library the app ships, as their licenses ask.
// The build bundles the libraries' code, which drops the notices in it, so they're collected here instead.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
/** The parts of the app that ship: their dependencies end up in it. */
const WORKSPACES = ['desktop', 'infrastructure', 'phone', 'application', 'domain'];
/** Only types for the compiler, never in the app. */
const TYPES_ONLY = /^(@types\/|undici-types$)/;
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.-]|$)/i;
/** Where a library's contents come from, when that has a license of its own. */
const ORIGINS = {
  '@tesseract.js-data/eng':
    "The trained data comes from Tesseract's tessdata (https://github.com/tesseract-ocr/tessdata), under the Apache License 2.0 (see tesseract.js).",
};

export async function writeThirdPartyLicenses(file) {
  const packages = new Map();
  for (const workspace of WORKSPACES) {
    const dir = resolve(root, 'src', workspace);
    for (const name of dependencies(join(dir, 'package.json'))) collect(name, dir, packages);
  }
  // Electron itself, without what it uses to download itself. Chromium's licenses come with it, in LICENSES.chromium.html.
  collect('electron', root, packages, false);

  const sections = [...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const heading = `${p.name} ${p.version}${p.license ? ` (${p.license})` : ''}${p.url ? `\n${p.url}` : ''}`;
      const texts = p.files.map((f) => readFileSync(join(p.dir, f), 'utf8').trim());
      // A few packages name their license without including its text.
      const fallback = `Licensed under ${p.license ?? 'its own terms'}${p.author ? `, by ${p.author}` : ''}.`;
      const origin = ORIGINS[p.name] ? `\n\n${ORIGINS[p.name]}` : '';
      return `${heading}\n\n${texts.join('\n\n') || fallback}${origin}`;
    });
  const intro =
    'Commander Brawl uses these libraries. Their licenses follow, as each asks.\n' +
    "Chromium's licenses, and those of what it uses, are in LICENSES.chromium.html, which comes with the app.";
  await writeFile(file, `${intro}\n\n${sections.map((s) => `${'='.repeat(78)}\n${s}\n`).join('\n')}`);
  return packages.size;
}

function collect(name, from, packages, withDependencies = true) {
  if (TYPES_ONLY.test(name) || name.startsWith('@commander-brawl/')) return;
  const manifest = find(name, from);
  if (!manifest) return;
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (packages.has(key)) return;
  const dir = dirname(manifest);
  packages.set(key, {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? null),
    url: repositoryUrl(pkg),
    author: typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? null),
    dir,
    files: readdirSync(dir)
      .filter((f) => LICENSE_FILE.test(f))
      .sort(),
  });
  if (withDependencies) for (const dependency of dependencies(manifest)) collect(dependency, dir, packages);
}

/** Where Node would find the package from this folder, with links followed (npm workspaces link). */
function find(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const manifest = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) return realpathSync(manifest);
    if (dirname(dir) === dir) return null;
  }
}

function dependencies(manifest) {
  return Object.keys(JSON.parse(readFileSync(manifest, 'utf8')).dependencies ?? {});
}

function repositoryUrl(pkg) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return (url ?? pkg.homepage ?? '').replace(/^git\+/, '').replace(/\.git$/, '') || null;
}
