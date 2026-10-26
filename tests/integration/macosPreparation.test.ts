import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { temporaryDirs } from '../support/temporaryDirs';

const temporaryDir = temporaryDirs();
const hasShell = spawnSync('sh', ['-c', 'exit 0']).status === 0;

/** Git's shell uses /c/... for Windows paths. Native macOS and Linux shells already use absolute POSIX paths. */
const shellPath = (path: string) =>
  path.replaceAll('\\', '/').replace(/^([a-z]):/i, (_, drive: string) => `/${drive.toLowerCase()}`);

/** Run the installer's actual preparation function with a stand-in for macOS's codesign tool. */
async function prepare(
  options: { valid?: boolean; signFails?: boolean; verificationFails?: boolean; metadataFails?: boolean } = {},
) {
  const dir = await temporaryDir('cb-macos-preparation-');
  const bin = join(dir, 'bin');
  const bundle = join(dir, 'Commander Brawl.app');
  const log = join(dir, 'commands');
  await mkdir(bin);
  await mkdir(bundle);
  await writeFile(log, '');
  const commands: Record<string, string> = {
    codesign: `#!/bin/sh
printf 'codesign %s\\n' "$*" >> "$CB_TEST_LOG"
case "$1" in
  --verify)
    [ "$CB_TEST_VALID" = 1 ] || { [ -f "$CB_TEST_SIGNED" ] && [ "$CB_TEST_VERIFY_FAILS" != 1 ]; }
    ;;
  --force)
    [ "$CB_TEST_SIGN_FAILS" != 1 ] || exit 1
    : > "$CB_TEST_SIGNED"
    ;;
  *) exit 1 ;;
esac
`,
    xattr: '#!/bin/sh\nprintf "xattr %s\\n" "$*" >> "$CB_TEST_LOG"\n[ "$CB_TEST_METADATA_FAILS" != 1 ]\n',
  };
  for (const [name, body] of Object.entries(commands)) {
    const file = join(bin, name);
    await writeFile(file, body);
    await chmod(file, 0o755);
  }
  const installer = await readFile(resolve(import.meta.dirname, '../../scripts/install.sh'), 'utf8');
  const platformCheck = installer.indexOf('\ncase "$(uname -s)"');
  if (platformCheck < 0) throw new Error('Could not find the installer function definitions.');
  // The preamble defines functions only; installation, moves, and process termination never run here.
  const script = `${installer.slice(0, platformCheck)}\nprepare_macos_app "$1"\n`;
  const result = spawnSync('sh', ['-c', script, 'test-macos-preparation', shellPath(bundle)], {
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
      CB_UPDATE: '',
      CB_TEST_LOG: shellPath(log),
      CB_TEST_SIGNED: shellPath(join(bundle, 'signed')),
      CB_TEST_VALID: options.valid ? '1' : '0',
      CB_TEST_SIGN_FAILS: options.signFails ? '1' : '0',
      CB_TEST_VERIFY_FAILS: options.verificationFails ? '1' : '0',
      CB_TEST_METADATA_FAILS: options.metadataFails ? '1' : '0',
    },
    encoding: 'utf8',
  });
  return { result, commands: (await readFile(log, 'utf8')).trim().split('\n') };
}

describe.runIf(hasShell)('free macOS app preparation', () => {
  it('prepares downloaded metadata, ad hoc signs an unsigned bundle, and verifies it', async () => {
    const { result, commands } = await prepare();
    expect(result.status, result.stderr).toBe(0);
    expect(commands).toHaveLength(4);
    expect(commands[0]).toContain('xattr -cr');
    expect(commands[1]).toContain('codesign --verify --deep --strict');
    expect(commands[2]).toContain('codesign --force --deep --sign -');
    expect(commands[3]).toContain('codesign --verify --deep --strict');
  });

  it('keeps an already-valid signature instead of replacing it', async () => {
    const { result, commands } = await prepare({ valid: true });
    expect(result.status, result.stderr).toBe(0);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('xattr -cr');
    expect(commands[1]).toContain('codesign --verify');
  });

  it('stops with an explanation if local signing fails', async () => {
    const { result } = await prepare({ signFails: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Could not prepare the app (codesign failed).');
  });

  it('stops if the prepared signature still does not verify', async () => {
    const { result } = await prepare({ verificationFails: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('The prepared app signature is invalid.');
  });

  it('stops before signing if metadata preparation fails', async () => {
    const { result, commands } = await prepare({ metadataFails: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Could not prepare the downloaded app metadata.');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('xattr -cr');
  });
});
