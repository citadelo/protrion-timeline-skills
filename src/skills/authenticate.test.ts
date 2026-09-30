import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClient } from '../client';
import { readConfig } from '../config';
import { CredentialStore } from '../credentials';
import { AuthorizationRequiredError, DeclinedError, TimedOutError } from '../errors';
import { authenticate } from './authenticate';

/**
 * These drive the real loopback listener: the browser step is stood in for by a fetch to whatever
 * URL the skill wanted opened, which is exactly what the app's screen does on approval.
 */
function browserThatDelivers(params: Record<string, string>) {
  return async (url: string) => {
    const opened = new URL(url);
    const redirectUri = new URL(opened.searchParams.get('redirect_uri') as string);
    redirectUri.searchParams.set('state', opened.searchParams.get('state') as string);
    Object.entries(params).forEach(([key, value]) => redirectUri.searchParams.set(key, value));
    await fetch(redirectUri.toString(), { redirect: 'manual' });
  };
}

const browserThatNeverReturns = () => {};

describe('timeline.authenticate', () => {
  let dir: string;
  let credentials: CredentialStore;
  let client: TimelineClient;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timeline-skills-auth-'));
    credentials = new CredentialStore(dir);
    client = {
      listProjects: vi.fn().mockResolvedValue({
        content: [],
        page: 0,
        size: 1,
        totalElements: 0,
        totalPages: 0,
      }),
    } as unknown as TimelineClient;
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const options = (overrides: Record<string, unknown> = {}) => ({
    config: readConfig({} as NodeJS.ProcessEnv),
    credentials,
    client,
    openBrowser: browserThatNeverReturns,
    timeoutSeconds: 1,
    ...overrides,
  });

  it('stores the approved external tool token and reports who the agent acts as', async () => {
    const result = await authenticate(
      options({
        openBrowser: browserThatDelivers({
          external_tool_token: 'raw-external-tool-token',
          token_id: 'id-1',
          acting_as: 'Alex User',
        }),
      }),
    );

    expect(result.summary).toContain('Authorized');
    expect(result.actingAs).toBe('Alex User');
    expect((await credentials.readExternalToolToken())?.token).toBe('raw-external-tool-token');
    // The value itself must not travel back to the agent's transcript.
    expect(JSON.stringify(result)).not.toContain('raw-external-tool-token');
  });

  it('discards a revoked token and authorizes again, instead of wedging', async () => {
    // Revocation is the control the design leans on. A stored token the backend refuses must not
    // leave the pack repeating "run timeline.authenticate" down a branch that never re-authorizes.
    await credentials.writeExternalToolToken({
      token: 'revoked',
      tokenId: 'id-0',
      actingAs: 'Old User',
      expiresAt: null,
    });
    const listProjects = vi
      .fn()
      .mockRejectedValueOnce(new AuthorizationRequiredError('rejected'))
      .mockResolvedValue({ content: [], page: 0, size: 1, totalElements: 0, totalPages: 0 });
    const openBrowser = browserThatDelivers({
      external_tool_token: 'raw-external-tool-token',
      token_id: 'id-1',
      acting_as: 'Alex User',
    });

    const result = await authenticate(
      options({ client: { listProjects } as unknown as TimelineClient, openBrowser }),
    );

    expect(result.summary).toContain('had been revoked');
    expect(result.actingAs).toBe('Alex User');
    expect((await credentials.readExternalToolToken())?.token).toBe('raw-external-tool-token');
  });

  it('reports an already-usable token without opening a browser', async () => {
    await credentials.writeExternalToolToken({
      token: 'raw',
      tokenId: 'id-1',
      actingAs: 'Alex User',
      expiresAt: null,
    });
    const openBrowser = vi.fn();

    const result = await authenticate(options({ openBrowser }));

    expect(result.summary).toContain('Already authorized');
    expect(result.actingAs).toBe('Alex User');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('stores a confirmed project key with its expiry', async () => {
    await credentials.writeExternalToolToken({ token: 'raw', tokenId: 'id-1', expiresAt: null });
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

    const result = await authenticate(
      options({
        projectId: 'TLPT-2026-001',
        openBrowser: browserThatDelivers({
          project_id: 'TLPT-2026-001',
          ingest_api_key: 'raw-project-key',
          expires_at: expiresAt,
        }),
      }),
    );

    expect(result.projectId).toBe('TLPT-2026-001');
    expect(result.keyExpiresAt).toBe(expiresAt);
    expect((await credentials.readProjectKey('TLPT-2026-001'))?.key).toBe('raw-project-key');
    expect(JSON.stringify(result)).not.toContain('raw-project-key');
  });

  it('tells a decline apart from a timeout', async () => {
    await credentials.writeExternalToolToken({ token: 'raw', tokenId: 'id-1', expiresAt: null });

    await expect(
      authenticate(
        options({
          projectId: 'TLPT-2026-001',
          openBrowser: browserThatDelivers({ error: 'access_denied' }),
        }),
      ),
    ).rejects.toBeInstanceOf(DeclinedError);
  });

  it('reports a confirmation nobody finished as a timeout, leaving nothing behind', async () => {
    await credentials.writeExternalToolToken({ token: 'raw', tokenId: 'id-1', expiresAt: null });

    await expect(
      authenticate(options({ projectId: 'TLPT-2026-001', openBrowser: browserThatNeverReturns })),
    ).rejects.toBeInstanceOf(TimedOutError);
    expect(await credentials.readProjectKey('TLPT-2026-001')).toBeUndefined();
  });
});
