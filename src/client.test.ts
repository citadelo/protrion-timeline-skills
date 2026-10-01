import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineClient } from './client';
import { readConfig } from './config';
import { CredentialStore } from './credentials';
import {
  AuthorizationRequiredError,
  BackendTimedOutError,
  BackendUnavailableError,
  InvalidRequestError,
  NotFoundError,
  ProjectKeyRequiredError,
  RefusedError,
  TooLargeToVerifyError,
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

    await expect(client(fetchImpl).events(PROJECT)).rejects.toThrow(
      `timeline.authenticate --projectId ${PROJECT}`,
    );
  });

  it('names the full authenticate command, and that a key reaches one project, when none is held', async () => {
    const fetchImpl = vi.fn();

    const failure = await client(fetchImpl).events(PROJECT).catch((error: unknown) => error);

    expect((failure as Error).message).toContain(`timeline.authenticate --projectId ${PROJECT}`);
    expect((failure as Error).message).toContain('exactly one project');
  });

  it('names the full authenticate command when the held key has expired', async () => {
    await givenProjectKey(new Date(Date.now() - 1_000).toISOString());

    const failure = await client(vi.fn()).events(PROJECT).catch((error: unknown) => error);

    expect((failure as Error).message).toContain(`timeline.authenticate --projectId ${PROJECT}`);
    expect((failure as Error).message).toContain('exactly one project');
  });

  it.each([
    [404, NotFoundError, /Nothing was found.*\(404\).*No such event\./],
    [400, InvalidRequestError, /request was invalid \(400\).*No such event\./],
    [422, InvalidRequestError, /request was invalid \(422\).*No such event\./],
    [409, InvalidRequestError, /request was invalid \(409\).*No such event\./],
  ])('maps a %i on a read to a non-credential error carrying the detail', async (status, type, message) => {
    await givenProjectKey();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'No such event.' }, status));

    const failure = await client(fetchImpl).event(PROJECT, 'EVT-1').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(type);
    expect(failure).not.toBeInstanceOf(RefusedError);
    expect((failure as Error).message).toMatch(message);
    expect((failure as Error).message).not.toMatch(/refused|authenticate/);
  });

  it.each([
    [404, NotFoundError],
    [400, InvalidRequestError],
    [422, InvalidRequestError],
  ])('maps a %i on submitting an event without calling it a refused key', async (status, type) => {
    await givenProjectKey();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'name must not be blank' }, status));

    const failure = await client(fetchImpl).submitEvent(PROJECT, {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(type);
    expect((failure as Error).message).toContain('name must not be blank');
    expect((failure as Error).message).not.toMatch(/refused|authenticate/);
  });

  it('still reports 401 and 403 on a project key as refusals or re-confirmation', async () => {
    await givenProjectKey();
    const forbidden = vi.fn().mockResolvedValue(jsonResponse({ detail: 'No.' }, 403));

    await expect(client(forbidden).events(PROJECT)).rejects.toBeInstanceOf(RefusedError);
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

  describe('verification', () => {
    const urlOf = (fetchImpl: ReturnType<typeof vi.fn>) => fetchImpl.mock.calls[0]![0] as string;

    it('sends no query parameter when the caller chose none', async () => {
      await givenProjectKey();
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));

      await client(fetchImpl).verifyProjectChain(PROJECT);

      expect(urlOf(fetchImpl)).toBe('http://localhost:8080/api/ingest/project/verification');
      const [, init] = fetchImpl.mock.calls[0]!;
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer raw-project-key');
    });

    it('sends exactly the chain parameters the caller gave', async () => {
      await givenProjectKey();
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));

      await client(fetchImpl).verifyProjectChain(PROJECT, {
        level: 'BOUND_LINKS',
        eventScope: 'SIGNATURE',
        includeIndexConsistency: false,
      });

      const url = new URL(urlOf(fetchImpl));
      expect(url.pathname).toBe('/api/ingest/project/verification');
      expect(url.searchParams.get('level')).toBe('BOUND_LINKS');
      expect(url.searchParams.get('eventScope')).toBe('SIGNATURE');
      expect(url.searchParams.get('includeIndexConsistency')).toBe('false');
    });

    it('sends only the parameter given for a partial choice', async () => {
      await givenProjectKey();
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));

      await client(fetchImpl).verifyProjectChain(PROJECT, { level: 'EVENTS' });

      expect(urlOf(fetchImpl)).toBe('http://localhost:8080/api/ingest/project/verification?level=EVENTS');
    });

    it('verifies one event, with the scope only when given', async () => {
      await givenProjectKey();
      const plain = vi.fn().mockResolvedValue(jsonResponse({}));
      const scoped = vi.fn().mockResolvedValue(jsonResponse({}));

      await client(plain).verifyProjectEvent(PROJECT, 'EVT 1');
      await client(scoped).verifyProjectEvent(PROJECT, 'EVT-1', 'SIGNATURE_WITH_REVOCATION');

      expect(urlOf(plain)).toBe('http://localhost:8080/api/ingest/project/events/EVT%201/verification');
      expect(urlOf(scoped)).toBe(
        'http://localhost:8080/api/ingest/project/events/EVT-1/verification?scope=SIGNATURE_WITH_REVOCATION',
      );
    });

    it('refuses without a held key, before issuing a request', async () => {
      const fetchImpl = vi.fn();

      await expect(client(fetchImpl).verifyProjectChain('TLPT-2026-999')).rejects.toBeInstanceOf(
        ProjectKeyRequiredError,
      );
      await expect(client(fetchImpl).verifyProjectEvent('TLPT-2026-999', 'E')).rejects.toBeInstanceOf(
        ProjectKeyRequiredError,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
      [404, NotFoundError],
      [400, InvalidRequestError],
      [422, TooLargeToVerifyError],
      [502, BackendUnavailableError],
      [504, BackendTimedOutError],
      [503, BackendUnavailableError],
    ])('maps a %i on either verification to its own cause', async (status, type) => {
      await givenProjectKey();
      const respond = () => vi.fn().mockResolvedValue(jsonResponse({ detail: 'Because.' }, status));

      const chain = await client(respond()).verifyProjectChain(PROJECT).catch((e: unknown) => e);
      const event = await client(respond()).verifyProjectEvent(PROJECT, 'E').catch((e: unknown) => e);

      expect(chain).toBeInstanceOf(type);
      expect(event).toBeInstanceOf(type);
    });

    it('keeps 504 distinct from an unavailable backend and 422 from an invalid request', async () => {
      await givenProjectKey();
      const timeout = await client(vi.fn().mockResolvedValue(jsonResponse({}, 504)))
        .verifyProjectChain(PROJECT).catch((e: unknown) => e);
      const large = await client(vi.fn().mockResolvedValue(jsonResponse({}, 422)))
        .verifyProjectChain(PROJECT).catch((e: unknown) => e);

      expect(timeout).not.toBeInstanceOf(BackendUnavailableError);
      expect(large).not.toBeInstanceOf(InvalidRequestError);
      expect((large as Error).message).toContain('too large');
      expect((timeout as Error).message).toContain('timed out');
    });

    it('leaves 504 on other reads as an unavailable backend', async () => {
      await givenProjectKey();
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 504));

      await expect(client(fetchImpl).events(PROJECT)).rejects.toBeInstanceOf(BackendUnavailableError);
    });

    it('still reports 401 and 403 on a verification as re-confirmation or refusal', async () => {
      await givenProjectKey();

      await expect(
        client(vi.fn().mockResolvedValue(jsonResponse({}, 401))).verifyProjectChain(PROJECT),
      ).rejects.toBeInstanceOf(ProjectKeyRequiredError);
      await expect(
        client(vi.fn().mockResolvedValue(jsonResponse({}, 403))).verifyProjectEvent(PROJECT, 'E'),
      ).rejects.toBeInstanceOf(RefusedError);
    });
  });

  it('never puts a credential in the message of a refusal', async () => {
    await givenProjectKey();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Nope.' }, 403));

    await expect(client(fetchImpl).project(PROJECT)).rejects.toSatisfy(
      (error: Error) => !error.message.includes('raw-project-key'),
    );
  });
});
