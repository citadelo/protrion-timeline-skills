#!/usr/bin/env node
/**
 * Links every skill in this pack into the host's skill directory.
 *
 * Links, not copies: the installed skills keep pointing back into this checkout, so `git pull`
 * updates them and uninstalling is deleting links, never files. Runs on a bare checkout — it needs
 * nothing from node_modules.
 *
 * Idempotent: a link that already points at this pack counts as installed; a second run changes
 * nothing and says so. Anything else already occupying a skill's name is reported and left alone —
 * this script never overwrites something it does not own.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKILLS_SOURCE = path.join(PACK_ROOT, 'skills');
const TARGET = process.env.CLAUDE_SKILLS_DIR ?? path.join(os.homedir(), '.claude', 'skills');

const names = (await fs.readdir(SKILLS_SOURCE, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

await fs.mkdir(TARGET, { recursive: true });

let linked = 0;
let alreadyInstalled = 0;
let refused = 0;

for (const name of names) {
  const source = path.join(SKILLS_SOURCE, name);
  const destination = path.join(TARGET, name);

  let existing;
  try {
    existing = await fs.lstat(destination);
  } catch {
    existing = undefined;
  }

  if (existing?.isSymbolicLink()) {
    if (path.resolve(path.dirname(destination), await fs.readlink(destination)) === source) {
      alreadyInstalled += 1;
      continue;
    }
    console.error(`refusing ${name}: a link exists but points somewhere else`);
    refused += 1;
    continue;
  }
  if (existing) {
    console.error(`refusing ${name}: something that is not this pack's link already exists there`);
    refused += 1;
    continue;
  }

  await fs.symlink(source, destination);
  console.log(`installed ${name}`);
  linked += 1;
}

if (linked === 0 && refused === 0) {
  console.log(`nothing to do: all ${alreadyInstalled} skills are already installed in ${TARGET}`);
} else {
  console.log(`${linked} installed, ${alreadyInstalled} already installed, ${refused} refused (${TARGET})`);
}
process.exit(refused > 0 ? 1 : 0);
