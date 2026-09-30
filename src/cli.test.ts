import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RUN_SKILL = fileURLToPath(new URL('../scripts/run-skill.mjs', import.meta.url));

describe('timeline.events.create arguments', () => {
  it('refuses --recheck together with --event before doing anything', () => {
    const run = spawnSync(
      process.execPath,
      [RUN_SKILL, 'timeline.events.create', '--projectId', 'P', '--recheck', 'i-1', '--event', '{}'],
      { encoding: 'utf-8' },
    );

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('--recheck cannot be combined with --event');
    expect(run.stdout).toBe('');
  });
});
