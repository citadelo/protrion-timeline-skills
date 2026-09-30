import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SKILLS = fileURLToPath(new URL('../skills', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'skills-launcher-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('skill launcher', () => {
  it('runs from an install symlink, standing in a foreign directory', () => {
    const skill = 'timeline.projects.get';
    const link = path.join(tmp, skill);
    symlinkSync(path.join(SKILLS, skill), link, 'dir');

    const run = spawnSync(process.execPath, [path.join(link, 'run.mjs'), skill], {
      cwd: tmp,
      encoding: 'utf-8',
    });

    expect(run.stderr).toContain('--projectId is required.');
    expect(run.stderr).not.toContain('Cannot find module');
    expect(run.status).toBe(1);
  });

  it('ships a launcher in every skill directory', () => {
    for (const name of readdirSync(SKILLS)) {
      const run = spawnSync(process.execPath, ['--check', path.join(SKILLS, name, 'run.mjs')]);
      expect(run.status, name).toBe(0);
    }
  });
});
