import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineClient } from './client';
import { readConfig } from './config';
import { CredentialStore } from './credentials';
import {
  AuthorizationRequiredError,
  BackendUnavailableError,
  ProjectKeyRequiredError,
  RefusedError,
} from './errors';

const PROJECT = 'TLPT-2026-001';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TimelineClient', () => {
  let dir: string;
  let store: CredentialStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timeline-skills-client-'));
    store = new CredentialStore(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const client = (fetchImpl: typeof fetch) =>
    new TimelineClient(readConfig({} as NodeJS.ProcessEnv), store, fetchImpl);

  const givenAgentToken = () =>
    store.writeExternalToolToken({ token: 'raw-external-tool-token', tokenId: 'id-1', expiresAt: null });

  const givenProjectKey = (expiresAt = new Date(Date.now() + 3_600_000).toISOString()) =>
    store.writeProjectKey({ projectId: PROJECT, key: 'raw-project-key', expiresAt });

  it('reads a project with the key of that project', async () => {
    await givenProjectKey();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ project: { projectId: PROJECT } }));

    const timeline = await client(fetchImpl).project(PROJECT);

    expect(timeline.project.projectId).toBe(PROJECT);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer raw-project-key');
  });

  it('refuses a project it holds no key for, before issuing a request', async () => {
    const fetchImpl = vi.fn();

    await expect(client(fetchImpl).project('TLPT-2026-999')).rejects.toBeInstanceOf(
      ProjectKeyRequiredError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a project whose key has expired, before issuing a request', async () => {
    await givenProjectKey(new Date(Date.now() - 1_000).toISOString());
    const fetchImpl = vi.fn();

    await expect(client(fetchImpl).events(PROJECT)).rejects.toThrow(/has expired/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps a mid-operation 401 on a project key to a fresh-confirmation message, without retrying', async () => {
    // The key was good when it was stored; it stopped being usable server-side since (expired or
    // revoked). Every project-key call gets the same actionable message, submit included - not
    // only the ones that happen to poll.
    await givenProjectKey();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Token expired' }, 401));

    await expect(client(fetchImpl).events(PROJECT)).rejects.toBeInstanceOf(ProjectKeyRequiredError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('names timeline.authenticate in that fresh-confirmation message', async () => {
    await givenProjectKey();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Token expired' }, 401));

    await expect(client(fetchImpl).events(PROJECT)).rejects.toThrow(/timeline\.authenticate/);
  });

  it('maps a 401 on submitting an event to the same fresh-confirmation message', async () => {
    await givenProjectKey();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Token expired' }, 401));

    await expect(client(fetchImpl).submitEvent(PROJECT, { name: 'Scoping complete' })).rejects.toThrow(
      /timeline\.authenticate/,
    );
  });

  it('reports which credential was refused and what it was attempting', async () => {
    await givenProjectKey();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Not a member.' }, 403));

    await expect(client(fetchImpl).members(PROJECT)).rejects.toThrow(
      /project key was refused \(403\) while reading the members of TLPT-2026-001\. Not a member\./,
    );
  });

  it('asks for re-authorization when the external tool token itself is refused', async () => {
    await givenAgentToken();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));

    await expect(client(fetchImpl).listProjects()).rejects.toBeInstanceOf(
      AuthorizationRequiredError,
    );
  });

  it('reports an unreachable backend as a failure, not as nothing found', async () => {
    await givenAgentToken();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(client(fetchImpl).listProjects()).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('reports a server error as a failure too', async () => {
    await givenProjectKey();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 502));

    await expect(client(fetchImpl).project(PROJECT)).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });

  it('requires an external tool token before listing projects', async () => {
    const fetchImpl = vi.fn();

    await expect(client(fetchImpl).listProjects()).rejects.toBeInstanceOf(
      AuthorizationRequiredError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes each event filter through', async () => {
    await givenProjectKey();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));

    await client(fetchImpl).events(PROJECT, {
      group: 'evidence',
      tags: ['kickoff'],
      typeDetail: ['phase:Threat Intelligence'],
    });

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('group=evidence');
    expect(url).toContain('tags=kickoff');
    expect(url).toContain('typeDetail=phase%3AThreat+Intelligence');
  });

  it('never puts a credential in the message of a refusal', async () => {
    await givenProjectKey();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Nope.' }, 403));

    await expect(client(fetchImpl).project(PROJECT)).rejects.toSatisfy(
      (error: Error) => !error.message.includes('raw-project-key'),
    );
  });
});
