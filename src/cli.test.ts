// SPDX-FileCopyrightText: 2026 CITADELO s.r.o.
// SPDX-License-Identifier: Apache-2.0

import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CredentialStore } from './credentials';

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

describe('verification skills through the launcher', () => {
  let dir: string;
  let server: http.Server;
  let seen: string[];
  let respond: (url: string) => { status: number; body: unknown };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timeline-skills-cli-'));
    await new CredentialStore(dir).writeProjectKey({
      projectId: 'TLPT-2026-001',
      key: 'cli-project-key',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    server = http.createServer((request, response) => {
      seen.push(request.url ?? '');
      const { status, body } = respond(request.url ?? '');
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    seen = [];
  });

  const run = (...args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const port = (server.address() as AddressInfo).port;
      const child = spawn(process.execPath, [RUN_SKILL, ...args], {
        env: {
          ...process.env,
          TIMELINE_API_URL: `http://127.0.0.1:${port}`,
          TIMELINE_CREDENTIALS_DIR: dir,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });

  const chain = (verdict: string) => ({
    projectId: 'TLPT-2026-001',
    level: 'LINKS',
    eventScope: 'INTEGRITY',
    verdict,
    verifiedAt: '2026-09-30T10:00:00Z',
    coverage: { note: 'Integrity only.' },
    summary: { total: 1, valid: 0, invalid: 1, indeterminate: 0, edges: 0 },
    chainChecks: [],
    entries: [
      {
        entryId: 'EVT-1',
        verdict: 'INVALID',
        failedChecks: [{ code: 'REFERENCE_DIGESTS', status: 'FAIL', message: 'digest differs' }],
      },
    ],
  });

  it('exits successfully with an INVALID chain verdict and sends no default parameters', async () => {
    respond = () => ({ status: 200, body: chain('INVALID') });

    const result = await run('timeline.projects.verify', '--projectId', 'TLPT-2026-001');

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).verdict).toBe('INVALID');
    expect(JSON.parse(result.stdout).unverifiedEntries[0].entryId).toBe('EVT-1');
    expect(seen).toEqual(['/api/ingest/project/verification']);
    expect(result.stdout).not.toContain('cli-project-key');
  });

  it('passes level, eventScope and includeIndexConsistency through', async () => {
    respond = () => ({ status: 200, body: chain('VALID') });

    const result = await run(
      'timeline.projects.verify', '--projectId', 'TLPT-2026-001',
      '--level', 'BOUND_LINKS', '--eventScope', 'SIGNATURE', '--includeIndexConsistency',
    );

    expect(result.status).toBe(0);
    const url = new URL(seen[0]!, 'http://x');
    expect(url.searchParams.get('level')).toBe('BOUND_LINKS');
    expect(url.searchParams.get('eventScope')).toBe('SIGNATURE');
    expect(url.searchParams.get('includeIndexConsistency')).toBe('true');
  });

  it('exits successfully with a VALID event verdict and passes the scope through', async () => {
    respond = () => ({
      status: 200,
      body: {
        projectId: 'TLPT-2026-001', entryId: 'EVT-1', scope: 'SIGNATURE', verdict: 'VALID',
        verifiedAt: '2026-09-30T10:00:00Z', checks: [],
      },
    });

    const result = await run(
      'timeline.events.verify', '--projectId', 'TLPT-2026-001', '--entryId', 'EVT-1', '--scope', 'SIGNATURE',
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).verdict).toBe('VALID');
    expect(seen).toEqual(['/api/ingest/project/events/EVT-1/verification?scope=SIGNATURE']);
  });

  it('exits 0 with the verdict when the signature has no signer', async () => {
    respond = () => ({
      status: 200,
      body: {
        projectId: 'TLPT-2026-001', entryId: 'EVT-1', scope: 'INTEGRITY', verdict: 'INVALID',
        verifiedAt: '2026-09-30T10:00:00Z',
        signature: { profile: null, signingTime: null, timestampTime: null, proofTime: null, signer: null },
        checks: [{ code: 'SIGNING_CERTIFICATE_BINDING', status: 'FAIL', message: 'unreadable' }],
      },
    });

    const result = await run(
      'timeline.events.verify', '--projectId', 'TLPT-2026-001', '--entryId', 'EVT-1',
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.verdict).toBe('INVALID');
    expect(parsed.signature.profile).toBeNull();
    expect(parsed.signature.signer).toBeNull();
  });

  it.each([
    [404, /Nothing was found/],
    [422, /too large to verify/],
    [502, /could not be reached/],
    [504, /timed out/],
  ])('fails with the cause on %i and reports no verdict', async (status, message) => {
    respond = () => ({ status, body: { detail: 'x' } });

    const result = await run('timeline.projects.verify', '--projectId', 'TLPT-2026-001');

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(message);
  });

  it('refuses before any request when no key is held for the project', async () => {
    respond = () => ({ status: 200, body: {} });

    const result = await run('timeline.events.verify', '--projectId', 'TLPT-2026-777', '--entryId', 'E');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('timeline.authenticate --projectId TLPT-2026-777');
    expect(seen).toEqual([]);
  });

  it('lists twelve skills for an unknown one', async () => {
    const result = await run('timeline.nothing');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('timeline.projects.{create,get,list,permissions,members,verify}');
    expect(result.stderr).toContain('timeline.events.{create,get,list,verify}');
  });
});
