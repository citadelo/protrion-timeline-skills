// SPDX-FileCopyrightText: 2026 CITADELO s.r.o.
// SPDX-License-Identifier: Apache-2.0

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** The external tool token: acts as the user who approved it, and reaches no timeline on its own. */
export interface StoredExternalToolToken {
  token: string;
  tokenId: string;
  /** The approving user's display name, as the authorization delivery reported it. */
  actingAs?: string;
  /** Null: an external tool token lives until its user revokes it. */
  expiresAt: string | null;
}

/** A project key: one project, confirmed by a human, short-lived. */
export interface StoredProjectKey {
  projectId: string;
  key: string;
  /** Always set for a key an agent holds — that is what the confirmation buys. */
  expiresAt: string;
}

interface StoreFile {
  externalToolToken?: StoredExternalToolToken;
  projectKeys?: Record<string, StoredProjectKey>;
}

const unreadableStore = (dir: string) =>
  `credential store is unreadable; delete ${dir} and authorize again`;

/**
 * Where the pack keeps what a human has granted it.
 *
 * Project keys are kept **keyed by project**: each reaches exactly one project and an agent
 * routinely works more than one, so acting on a project must select that project's key and never
 * fall back to another's — a fallback would silently act on the wrong timeline.
 */
export class CredentialStore {
  private static readonly LOCK_RETRY_MS = 25;
  /** Older than this, a lock file is presumed abandoned by a process that never released it. */
  private static readonly STALE_LOCK_MS = 10_000;
  /**
   * Deliberately longer than {@link STALE_LOCK_MS}, with margin: a waiter must never give up
   * before a lock left by a crash is even eligible to be reclaimed, or a just-confirmed key can
   * fail to store for no reason but unlucky timing.
   */
  private static readonly LOCK_TIMEOUT_MS = CredentialStore.STALE_LOCK_MS + 5_000;
  private static readonly RENAME_RETRIES = 5;
  private static readonly RENAME_RETRY_MS = 50;

  private readonly dir: string;
  private readonly file: string;
  private readonly lockFile: string;
  /**
   * Every read-modify-write goes through this, one at a time, within this process - see {@link
   * mutate}. It is not what makes writes safe across processes; the lock file does that.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(credentialsDir: string) {
    this.dir = path.resolve(credentialsDir);
    this.file = path.join(this.dir, 'credentials.json');
    this.lockFile = `${this.file}.lock`;
  }

  async readExternalToolToken(): Promise<StoredExternalToolToken | undefined> {
    return (await this.read()).externalToolToken;
  }

  async writeExternalToolToken(token: StoredExternalToolToken): Promise<void> {
    await this.mutate((store) => {
      store.externalToolToken = token;
    });
  }

  /**
   * Returns the key for this project, or undefined when none is held or the one held has expired.
   * Expiry is answered from the stored value, so a skill can tell a usable key from a stale one
   * without spending a request to find out.
   */
  async readProjectKey(projectId: string, now: Date = new Date()): Promise<StoredProjectKey | undefined> {
    const stored = (await this.read()).projectKeys?.[projectId];
    if (!stored) {
      return undefined;
    }
    return Date.parse(stored.expiresAt) > now.getTime() ? stored : undefined;
  }

  /** Replaces this project's key rather than accumulating keys for one project. */
  async writeProjectKey(key: StoredProjectKey): Promise<void> {
    await this.mutate((store) => {
      store.projectKeys = { ...(store.projectKeys ?? {}), [key.projectId]: key };
    });
  }

  /** Whether a key is stored for this project at all, usable or long expired. */
  async hasProjectKey(projectId: string): Promise<boolean> {
    return (await this.read()).projectKeys?.[projectId] !== undefined;
  }

  /** Forgets the external tool token, so the next authenticate goes through the app again. */
  async clearExternalToolToken(): Promise<void> {
    await this.mutate((store) => {
      delete store.externalToolToken;
    });
  }

  /** The projects the pack currently holds a usable key for. */
  async projectsWithKeys(now: Date = new Date()): Promise<string[]> {
    const store = await this.read();
    return Object.values(store.projectKeys ?? {})
      .filter((key) => Date.parse(key.expiresAt) > now.getTime())
      .map((key) => key.projectId);
  }

  /**
   * Runs one read-modify-write against the store, holding the cross-process lock file for its
   * whole duration and, within this process, queued behind every mutation already pending on this
   * instance.
   *
   * Each skill invocation is its own OS process (`run-skill.mjs` spawns one per call), so an
   * in-process queue alone protects nothing between two of them: two skills invoked close together
   * are two different `CredentialStore` instances in two different processes, each perfectly happy
   * to read the same snapshot and have the second writer silently discard the first's change. The
   * lock file is what actually prevents that; the in-process queue only spares this instance from
   * racing itself.
   */
  private mutate(change: (store: StoreFile) => void): Promise<void> {
    const next = this.queue.then(() =>
      this.withLock(async () => {
        const store = await this.read();
        change(store);
        await this.write(store);
      }),
    );
    // A failed mutation must not wedge every mutation queued after it; the caller of *this*
    // mutation still observes the rejection through the returned promise.
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Acquires the lock file with `O_EXCL` - atomic create-if-absent, so two processes racing this
   * can never both believe they hold it - retrying with a short backoff until it is free. The
   * file's content is a nonce unique to this acquisition, so the release below can tell "the lock
   * I took" from "a lock that happens to be at this path now" - see {@link releaseIfOwned}.
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + CredentialStore.LOCK_TIMEOUT_MS;
    const nonce = crypto.randomUUID();

    for (;;) {
      try {
        const handle = await fs.open(this.lockFile, 'wx');
        try {
          await handle.writeFile(nonce);
        } finally {
          await handle.close();
        }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
        await this.reclaimIfStale();
        if (Date.now() >= deadline) {
          throw new Error(
            `Timed out waiting for the credential store lock (${this.lockFile}). Another process `
            + 'may be holding it; remove the lock file if it is stale.',
          );
        }
        await delay(CredentialStore.LOCK_RETRY_MS + Math.random() * CredentialStore.LOCK_RETRY_MS);
      }
    }

    try {
      return await fn();
    } finally {
      await this.releaseIfOwned(nonce);
    }
  }

  /**
   * Takes over a lock old enough to be presumed abandoned by a crashed or killed process, without
   * racing another waiter reaching the same conclusion at the same time: renaming to a name unique
   * to this attempt is the exclusive step - of any number of processes racing to rename the same
   * path away, at most one succeeds, the rest fail with `ENOENT` because there is nothing left at
   * that path to rename - so at most one waiter ever deletes the abandoned lock, and it is never a
   * fresh lock some other winner just created in between.
   */
  private async reclaimIfStale(): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(this.lockFile);
    } catch {
      return; // Gone already - the next open('wx') attempt will settle it.
    }
    if (Date.now() - stat.mtimeMs <= CredentialStore.STALE_LOCK_MS) {
      return;
    }
    const claimed = `${this.lockFile}.stale-${crypto.randomUUID()}`;
    try {
      await fs.rename(this.lockFile, claimed);
    } catch {
      // Some other waiter's rename won this exact race, or the holder released it in the
      // meantime - either way, this attempt did not take the lock over and must not touch it.
      return;
    }
    await fs.rm(claimed, { force: true });
  }

  /**
   * Deletes the lock only if its content is still the nonce this acquisition wrote. Without that
   * check, releasing would remove whatever happens to be at the path when this runs - including a
   * lock a different process legitimately took over after presuming this one abandoned, which
   * would hand the store to two writers at once instead of protecting it from that.
   */
  private async releaseIfOwned(nonce: string): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(this.lockFile, 'utf-8');
    } catch {
      return; // Already gone.
    }
    if (content === nonce) {
      await fs.rm(this.lockFile, { force: true });
    }
  }

  private async read(): Promise<StoreFile> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
    try {
      return JSON.parse(raw) as StoreFile;
    } catch {
      // Never the parser's message: V8 quotes a slice of the file, and this file holds tokens.
      throw new Error(unreadableStore(this.dir));
    }
  }

  /**
   * Written atomically - to a temp file in the same directory, then renamed over the target - so a
   * write interrupted partway (a crash, a killed process) leaves the previous, valid file in
   * place rather than a truncated or corrupted one. Permissions are reasserted on every write, not
   * only when the file and directory are first created, so a store loosened some other way -
   * or one that predates this - is tightened back up rather than trusted.
   */
  private async write(store: StoreFile): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.dir, 0o700);

    const tmp = path.join(this.dir, `.credentials.json.${process.pid}-${crypto.randomUUID()}.tmp`);
    try {
      await fs.writeFile(tmp, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
      await fs.chmod(tmp, 0o600);
      await this.renameWithRetry(tmp, this.file);
    } catch (error) {
      await fs.rm(tmp, { force: true });
      throw error;
    }
    await fs.chmod(this.file, 0o600);
  }

  /**
   * Windows can hold `credentials.json` open (a concurrent read, an antivirus scan) long enough
   * that renaming over it fails transiently with `EPERM` or `EBUSY`. Retried a few times rather
   * than treated as a real failure - the holder typically lets go within milliseconds - anything
   * else fails immediately, unretried.
   */
  private async renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await fs.rename(from, to);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code !== 'EPERM' && code !== 'EBUSY') || attempt >= CredentialStore.RENAME_RETRIES) {
          throw error;
        }
        await delay(CredentialStore.RENAME_RETRY_MS);
      }
    }
  }
}
