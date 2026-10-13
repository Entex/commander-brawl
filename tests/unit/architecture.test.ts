import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The clean architecture rules, enforced. Inner layers never depend on outer ones:
 * domain ← application ← infrastructure ← desktop / phone.
 */

const root = resolve(import.meta.dirname, '../..');
const PACKAGE = '@commander-brawl/';

interface Rule {
  /** Folder (relative to the repo root) the rule applies to. */
  readonly folder: string;
  /** Returns why an import is not allowed, or null if it's fine. */
  readonly check: (specifier: string) => string | null;
}

const isRelative = (s: string) => s.startsWith('.');
const isOwnPackage = (s: string) => s.startsWith(PACKAGE);
const isNodeBuiltin = (s: string) => s.startsWith('node:');

const rules: Rule[] = [
  {
    folder: 'src/domain/src',
    check: (s) => (isRelative(s) ? null : 'the domain may not depend on anything'),
  },
  {
    folder: 'src/application/src',
    check: (s) =>
      isRelative(s) || s === `${PACKAGE}domain` ? null : 'the application layer may only depend on the domain',
  },
  {
    folder: 'src/infrastructure/src/protocol',
    check: (s) =>
      isRelative(s) || s === `${PACKAGE}domain` || s === `${PACKAGE}application`
        ? null
        : 'the protocol is shared by Node and browsers, so it may only use the inner layers',
  },
  {
    folder: 'src/infrastructure/src/browser',
    check: (s) => {
      if (isNodeBuiltin(s)) return 'browser code may not use Node modules';
      if (s.includes('/node')) return 'browser code may not use Node infrastructure';
      if (isOwnPackage(s) && s !== `${PACKAGE}domain` && s !== `${PACKAGE}application`)
        return 'infrastructure may not depend on apps';
      return null;
    },
  },
  {
    folder: 'src/infrastructure/src/node',
    check: (s) => {
      if (s.includes('/browser')) return 'Node code may not use browser infrastructure';
      if (isOwnPackage(s) && s !== `${PACKAGE}domain` && s !== `${PACKAGE}application`)
        return 'infrastructure may not depend on apps';
      return null;
    },
  },
  {
    folder: 'src/desktop/src/renderer',
    check: (s) => {
      if (isNodeBuiltin(s) || s === 'electron') return 'the UI runs sandboxed and may not use Node or Electron';
      if (s === `${PACKAGE}infrastructure/node`)
        return 'the UI may not use Node infrastructure; go through the main process';
      return null;
    },
  },
  {
    folder: 'src/desktop/src/main',
    check: (s) => (s === `${PACKAGE}infrastructure/browser` ? 'the main process has no browser APIs' : null),
  },
  {
    folder: 'src/phone/src',
    check: (s) =>
      isRelative(s) || s === `${PACKAGE}infrastructure/browser` || s === `${PACKAGE}infrastructure/protocol`
        ? null
        : 'the phone page only needs the browser infrastructure',
  },
];

function sourceFiles(folder: string): string[] {
  return readdirSync(join(root, folder), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => join(root, folder, file));
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const pattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...source.matchAll(pattern)].map((match) => (match[1] ?? match[2])!);
}

describe('architecture', () => {
  it.each(rules.map((rule) => [rule.folder, rule] as const))('%s respects its layer', (_folder, rule) => {
    const files = sourceFiles(rule.folder);
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) =>
      importsOf(file)
        .map((specifier) => ({ specifier, reason: rule.check(specifier) }))
        .filter((result) => result.reason !== null)
        .map(({ specifier, reason }) => `${relative(root, file)} imports "${specifier}": ${reason}`),
    );
    expect(violations).toEqual([]);
  });
});
