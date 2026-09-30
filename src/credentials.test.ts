import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore } from './credentials';

const TSX_BIN = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const LOCK_CHILD = fileURLToPath(new URL('./credentialsLockChild.ts', import.meta.url));

function runChildWrite(credentialsDir: string, projectId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [LOCK_CHILD, credentialsDir, projectId], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`credentialsLockChild.ts exited code=${code} signal=${signal}`));
      }
    });
  });
}

describe('CredentialStore', () => {
  let dir: string;
  let store: CredentialStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timeline-skills-'));
    store = new CredentialStore(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const key = (projectId: string, expiresAt: string) => ({
    projectId,
    key: `raw-key-for-${projectId}`,
    expiresAt,
  });

  const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
  const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

  it('selects the key of the project being acted on', async () => {
    await store.writeProjectKey(key('TLPT-2026-001', inAnHour()));
    await store.writeProjectKey(key('TLPT-2026-002', inAnHour()));

    expect((await store.readProjectKey('TLPT-2026-002'))?.key).toBe('raw-key-for-TLPT-2026-002');
  });

  it('never falls back to another project key', async () => {
    await store.writeProjectKey(key('TLPT-2026-001', inAnHour()));

    // Acting on a project the pack holds no key for must come back empty-handed, not with somebody
    // else's key - a fallback would silently write to the wrong timeline.
    expect(await store.readProjectKey('TLPT-2026-999')).toBeUndefined();
  });

  it('replaces a project key rather than keeping two for one project', async () => {
    await store.writeProjectKey(key('TLPT-2026-001', inAnHour()));
    await store.writeProjectKey({
      projectId: 'TLPT-2026-001',
      key: 'a-fresher-key',
      expiresAt: inAnHour(),
    });

    expect((await store.readProjectKey('TLPT-2026-001'))?.key).toBe('a-fresher-key');
    expect(await store.projectsWithKeys()).toEqual(['TLPT-2026-001']);
  });

  it('recognises an expired key from what it stored, without a request', async () => {
    await store.writeProjectKey(key('TLPT-2026-001', anHourAgo()));

    expect(await store.readProjectKey('TLPT-2026-001')).toBeUndefined();
    expect(await store.projectsWithKeys()).toEqual([]);
  });

  it('keeps the external tool token separately from project keys', async () => {
    await store.writeExternalToolToken({ token: 'raw-external-tool-token', tokenId: 'id-1', expiresAt: null });
    await store.writeProjectKey(key('TLPT-2026-001', inAnHour()));

    expect((await store.readExternalToolToken())?.token).toBe('raw-external-tool-token');
    expect((await store.readProjectKey('TLPT-2026-001'))?.key).toBe('raw-key-for-TLPT-2026-001');
  });

  it('reports an unreadable store with a fixed message that holds nothing from the file', async () => {
    const secret = 'SECRET-TOKEN-VALUE-1234567890';
    await fs.writeFile(path.join(dir, 'credentials.json'), `{"externalToolToken":{"token":"${secret}" oops`);

    const failure = await store.readExternalToolToken().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      `credential store is unreadable; delete ${dir} and authorize again`,
    );
    expect((failure as Error).message).not.toContain(secret);
    expect(String((failure as Error).stack)).not.toContain(secret);
    expect((failure as Error).cause).toBeUndefined();
  });

  it('reads as empty before anything has been granted', async () => {
    expect(await store.readExternalToolToken()).toBeUndefined();
    expect(await store.projectsWithKeys()).toEqual([]);
  });

  it('serializes concurrent writers instead of losing an update', async () => {
    // Without serializing, every one of these would read the same empty snapshot and only the
    // last to finish writing would survive - the other seven would vanish silently.
    const projectIds = Array.from({ length: 8 }, (_, index) => `TLPT-2026-${index}`);
    await Promise.all(projectIds.map((projectId) => store.writeProjectKey(key(projectId, inAnHour()))));

    expect((await store.projectsWithKeys()).sort()).toEqual([...projectIds].sort());
  });

  it('leaves the previous, valid file in place when a write is interrupted', async () => {
    await store.writeProjectKey(key('TLPT-2026-001', inAnHour()));

    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated crash'));
    await expect(store.writeProjectKey(key('TLPT-2026-002', inAnHour()))).rejects.toThrow(
      'simulated crash',
    );
    rename.mockRestore();

    // Written to a temp file and renamed over the target: an interruption before the rename
    // leaves the previous content intact rather than a truncated or half-written file.
    expect((await store.readProjectKey('TLPT-2026-001'))?.key).toBe('raw-key-for-TLPT-2026-001');
    expect(await store.readProjectKey('TLPT-2026-002')).toBeUndefined();
  });

  it('enforces 0600 on the file and 0700 on the directory on every write', async () => {
    await store.writeProjectKey(key('TLPT-2026-001', inAnHour()));

    const fileStat = await fs.stat(path.join(dir, 'credentials.json'));
    const dirStat = await fs.stat(dir);
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it('tightens permissions back up even when they were loosened some other way', async () => {
    await store.writeProjectKey(key('TLPT-2026-001', inAnHour()));
    await fs.chmod(path.join(dir, 'credentials.json'), 0o644);
    await fs.chmod(dir, 0o755);

    await store.writeProjectKey(key('TLPT-2026-002', inAnHour()));

    const fileStat = await fs.stat(path.join(dir, 'credentials.json'));
    const dirStat = await fs.stat(dir);
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it(
    'serializes writes across processes, not only within one',
    async () => {
      // Each skill invocation is its own process - an in-process queue alone cannot protect
      // against two of them racing this store, so this drives two real child processes at the
      // same directory rather than two calls on one instance.
      await Promise.all([
        runChildWrite(dir, 'TLPT-2026-201'),
        runChildWrite(dir, 'TLPT-2026-202'),
      ]);

      expect((await store.projectsWithKeys()).sort()).toEqual([
        'TLPT-2026-201',
        'TLPT-2026-202',
      ]);
    },
    20_000,
  );

  const lockFile = () => `${path.join(dir, 'credentials.json')}.lock`;

  /** A lock file presumed abandoned by {@code reclaimIfStale}, aged by {@code ageMs}. */
  async function leaveACrashedLock(ageMs = 20_000): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(lockFile(), 'dead-nonce');
    const agedTimestamp = new Date(Date.now() - ageMs);
    await fs.utimes(lockFile(), agedTimestamp, agedTimestamp);
  }

  it('takes over a lock a crashed process left behind, rather than waiting for it to expire', async () => {
    await leaveACrashedLock();

    // The write must succeed well inside the acquire timeout: the fix is exactly that a waiter
    // does not give up before an already-stale lock is even eligible to be reclaimed.
    await store.writeProjectKey(key('TLPT-2026-501', inAnHour()));

    expect((await store.readProjectKey('TLPT-2026-501'))?.key).toBe('raw-key-for-TLPT-2026-501');
    await expect(fs.access(lockFile())).rejects.toThrow();
  });

  it(
    'waits past the staleness threshold rather than giving up just short of it',
    async () => {
      // A lock left by a crash a few seconds ago is not yet stale - reclaiming it needs the
      // remaining few seconds to actually elapse. A waiter whose own patience is shorter than
      // that gives up for no reason but bad luck in timing: exactly the bug this margin exists
      // to close. Aged so it needs real waiting (not merely inside the acquire loop's own
      // rounding), but well under the timeout the fix provides.
      await leaveACrashedLock(3_000);

      await store.writeProjectKey(key('TLPT-2026-502', inAnHour()));

      expect((await store.readProjectKey('TLPT-2026-502'))?.key).toBe('raw-key-for-TLPT-2026-502');
    },
    12_000,
  );

  it('lets two waiters race the same stale lock without either losing its write', async () => {
    await leaveACrashedLock();

    // Force two waiters to judge the very same abandoned lock stale at once, rather than hoping
    // incidental scheduling produces it: neither's staleness check is allowed to return until
    // both have read the lock, so both necessarily act on the same observation before either has
    // done anything about it. (The narrower "a rename lands on a lock someone else only just
    // created" case is covered deterministically by the release-ownership test below, which is
    // where this implementation's actual protection against that lives.)
    let arrivals = 0;
    let releaseBoth: () => void = () => {};
    const bothArrived = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    const originalStat = fs.stat;
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation((async (...args: unknown[]) => {
      const result = await (originalStat as (...a: unknown[]) => Promise<unknown>)(...args);
      arrivals += 1;
      if (arrivals >= 2) {
        releaseBoth();
      } else {
        await bothArrived;
      }
      return result;
    }) as typeof fs.stat);
    // And hold whichever waiter wins the fresh lock a moment before it does anything else with
    // it - exactly the "fresh lock exists but its owner has not finished with it yet" window a
    // second waiter's un-recomputed staleness verdict could otherwise land in and destroy.
    const originalOpen = fs.open;
    const openSpy = vi.spyOn(fs, 'open').mockImplementation((async (...args: unknown[]) => {
      const [target, flags] = args as [string, string];
      const handle = await (originalOpen as (...a: unknown[]) => Promise<unknown>)(...args);
      if (target === lockFile() && flags === 'wx') {
        await delay(40);
      }
      return handle;
    }) as typeof fs.open);

    const storeA = new CredentialStore(dir);
    const storeB = new CredentialStore(dir);
    try {
      await Promise.all([
        storeA.writeProjectKey(key('TLPT-2026-601', inAnHour())),
        storeB.writeProjectKey(key('TLPT-2026-602', inAnHour())),
      ]);
    } finally {
      statSpy.mockRestore();
      openSpy.mockRestore();
    }

    // Neither write may have been silently discarded by the other reclaiming and deleting a lock
    // it had just taken - which is what a double-delete-of-a-fresh-lock bug would do.
    expect((await store.projectsWithKeys()).sort()).toEqual(['TLPT-2026-601', 'TLPT-2026-602']);
  });

  it('never releases a lock a different process has since taken over', async () => {
    // Simulates the tail end of the same race deterministically: by the time this acquisition
    // finishes its own work, a different process has (rightly or wrongly) come to believe this
    // one abandoned the lock and has taken it over. Releasing unconditionally would delete that
    // process's lock instead of protecting it - handing the store to two writers at once, which
    // is exactly what the lock exists to prevent.
    const foreignNonce = 'a-different-processs-nonce';
    const originalWriteFile = fs.writeFile;
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockImplementation((async (...args: unknown[]) => {
      const [target] = args as [string, ...unknown[]];
      if (typeof target === 'string' && target.endsWith('.tmp')) {
        // Right as this acquisition starts its own critical-section write, another process
        // takes the lock over.
        await fs.writeFile(lockFile(), foreignNonce, 'utf-8');
      }
      return (originalWriteFile as (...a: unknown[]) => Promise<unknown>)(...args);
    }) as typeof fs.writeFile);

    await store.writeProjectKey(key('TLPT-2026-901', inAnHour()));
    writeFileSpy.mockRestore();

    await expect(fs.readFile(lockFile(), 'utf-8')).resolves.toBe(foreignNonce);
  });

  it('retries the final rename on a transient EPERM/EBUSY, as Windows can produce', async () => {
    const transient = Object.assign(new Error('simulated transient hold'), { code: 'EBUSY' });
    const originalRename = fs.rename;
    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(transient)
      .mockImplementation((async (...args: unknown[]) =>
        (originalRename as (...a: unknown[]) => Promise<unknown>)(...args)) as typeof fs.rename);

    await store.writeProjectKey(key('TLPT-2026-701', inAnHour()));

    expect(renameSpy).toHaveBeenCalledTimes(2);
    expect((await store.readProjectKey('TLPT-2026-701'))?.key).toBe('raw-key-for-TLPT-2026-701');
    renameSpy.mockRestore();
  });

  it('does not retry a rename failure that is not EPERM/EBUSY', async () => {
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated crash'));

    await expect(store.writeProjectKey(key('TLPT-2026-702', inAnHour()))).rejects.toThrow(
      'simulated crash',
    );
    expect(rename).toHaveBeenCalledTimes(1);
    rename.mockRestore();
  });
});
