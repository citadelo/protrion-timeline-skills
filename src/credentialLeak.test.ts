import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineClient } from './client';
import { readConfig } from './config';
import { CredentialStore } from './credentials';
import { createEvent } from './skills/events';
import { listProjects, projectPermissions } from './skills/projects';

const AGENT_TOKEN = 'SECRET-external-tool-token-a1b2c3';
const PROJECT_KEY = 'SECRET-project-key-d4e5f6';
const PROJECT = 'TLPT-2026-001';

/**
 * A credential must not reach an agent's transcript by any path — not through a result, not through
 * a message, not through an echoed request header on the way to explaining a failure.
 *
 * Error paths matter most: they are where a well-meaning "here is exactly what I sent" gets added.
 */
describe('no skill output carries a credential', () => {
  let dir: string;
  let store: CredentialStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timeline-skills-leak-'));
    store = new CredentialStore(dir);
    await store.writeExternalToolToken({ token: AGENT_TOKEN, tokenId: 'id-1', expiresAt: null });
    await store.writeProjectKey({
      projectId: PROJECT,
      key: PROJECT_KEY,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const client = (fetchImpl: typeof fetch) =>
    new TimelineClient(readConfig({} as NodeJS.ProcessEnv), store, fetchImpl);

  const expectNoSecrets = (text: string) => {
    expect(text).not.toContain(AGENT_TOKEN);
    expect(text).not.toContain(PROJECT_KEY);
  };

  it('keeps them out of successful results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    expectNoSecrets(JSON.stringify(await listProjects(client(fetchImpl))));
  });

  it('keeps them out of a refusal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Not a member.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await projectPermissions(client(fetchImpl), PROJECT).then(
      () => expect.fail('expected a refusal'),
      (error: Error) => expectNoSecrets(`${error.message}\n${error.stack ?? ''}`),
    );
  });

  it('keeps them out of an unreachable-backend failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8080'));

    await listProjects(client(fetchImpl)).then(
      () => expect.fail('expected a failure'),
      (error: Error) => expectNoSecrets(`${error.message}\n${error.stack ?? ''}`),
    );
  });

  it('keeps them out of a write that failed after acceptance', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'ingest-1', status: 'PENDING', receivedAt: 'now' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'ingest-1',
            status: 'FAILED',
            entryId: null,
            lastError: 'Parent lookup failed',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const result = await createEvent({
      client: client(fetchImpl),
      projectId: PROJECT,
      event: { name: 'Scoping complete' },
      sleep: () => Promise.resolve(),
    });

    expect(result.outcome).toBe('failed');
    expectNoSecrets(JSON.stringify(result));
  });

  it('fails when a credential is deliberately echoed, so this test is not vacuous', () => {
    const contrived = `The project key was refused: ${PROJECT_KEY}`;

    expect(() => expectNoSecrets(contrived)).toThrow();
  });
});
