#!/usr/bin/env node
/**
 * How every skill invokes the pack.
 *
 * Plain `node`, no dependencies, so it runs on a bare checkout. It exists because `npx tsx` would
 * resolve the interpreter from npm's cache or the network when the caller is standing in some other
 * project — not from the pack's pinned devDependency. The pack's own binary is the one that runs.
 *
 * It is also where a missing one-time setup becomes a sentence instead of ENOENT: the binary is
 * absent exactly when `npm ci` has not been run.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// tsx's real CLI entry, run through this very node: `.bin/tsx` is a sh shim on Windows and cannot be
// spawned without a shell. The entry comes from tsx's own package.json rather than a guessed path.
function tsxEntry() {
  try {
    const dir = path.join(PACK_ROOT, 'node_modules', 'tsx');
    const { bin } = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    return path.join(dir, typeof bin === 'string' ? bin : bin.tsx);
  } catch {
    return undefined;
  }
}
const TSX = tsxEntry();
const CLI = path.join(PACK_ROOT, 'src', 'cli.ts');

if (!TSX || !existsSync(TSX)) {
  process.stderr.write(
    `One-time setup has not been done: run \`npm ci\` in ${PACK_ROOT} and try again.\n`,
  );
  process.exit(1);
}

// The pack's own root, whatever directory the agent is working in: the skills read this pack's
// configuration and write into this pack's credential store, never into the caller's project.
const child = spawn(process.execPath, [TSX, CLI, ...process.argv.slice(2)], {
  cwd: PACK_ROOT,
  stdio: 'inherit',
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on('error', (error) => {
  process.stderr.write(`Could not run the skill: ${error.message}\n`);
  process.exit(1);
});
