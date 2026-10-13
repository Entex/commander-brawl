// Type-checks every part of the app. Each has its own tsconfig because they run in different places:
// pure TypeScript (domain, application), Node (main process), and browsers (UI, phone page).
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const projects = [
  'src/domain/tsconfig.json',
  'src/application/tsconfig.json',
  'src/infrastructure/tsconfig.node.json',
  'src/infrastructure/tsconfig.browser.json',
  'src/desktop/tsconfig.main.json',
  'src/desktop/tsconfig.renderer.json',
  'src/phone/tsconfig.json',
  'tests/tsconfig.json',
];

let failed = false;
for (const project of projects) {
  const result = spawnSync('npx', ['tsc', '-p', project], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`Type errors in ${project}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
