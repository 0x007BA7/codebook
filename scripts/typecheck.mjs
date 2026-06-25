#!/usr/bin/env node
// Typecheck every package against its OWN tsconfig, so per-package `lib`
// isolation is enforced (e.g. core/contracts have no DOM lib -> DOM usage
// fails to typecheck there). A single root tsconfig would lose that.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgs = ['contracts', 'core', 'ingest', 'server', 'cli', 'web'];
const tsc = join(root, 'node_modules', '.bin', 'tsc');

let failed = false;
for (const p of pkgs) {
  process.stdout.write(`tsc ${p} ... `);
  try {
    execFileSync(tsc, ['-p', `packages/${p}/tsconfig.json`, '--noEmit'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log('ok');
  } catch (err) {
    failed = true;
    console.log('FAIL');
    process.stdout.write(err.stdout?.toString() ?? '');
    process.stdout.write(err.stderr?.toString() ?? '');
  }
}
process.exit(failed ? 1 : 0);
