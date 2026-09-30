#!/usr/bin/env node
/**
 * Removes exactly the links `install-skills` created: only symlinks, and only ones that point back
 * into this pack. Anything else wearing a skill's name is left alone.
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

let removed = 0;
for (const name of names) {
  const destination = path.join(TARGET, name);
  let existing;
  try {
    existing = await fs.lstat(destination);
  } catch {
    continue;
  }
  if (!existing.isSymbolicLink()) {
    console.error(`leaving ${name}: not a link, so not something this pack installed`);
    continue;
  }
  const target = path.resolve(path.dirname(destination), await fs.readlink(destination));
  if (!target.startsWith(SKILLS_SOURCE + path.sep) && target !== path.join(SKILLS_SOURCE, name)) {
    console.error(`leaving ${name}: links somewhere that is not this pack`);
    continue;
  }
  await fs.unlink(destination);
  console.log(`removed ${name}`);
  removed += 1;
}
console.log(`${removed} removed (${TARGET})`);
