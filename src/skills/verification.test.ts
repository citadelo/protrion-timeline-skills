// SPDX-FileCopyrightText: 2026 CITADELO s.r.o.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import type { TimelineClient } from '../client';
import { TooLargeToVerifyError } from '../errors';
import { verifyEvent, verifyProject } from './verification';

const NOTE = 'Checks links and integrity only; signatures were not checked.';

const chainReport = (verdict: string, invalid = false) => ({
  projectId: 'TLPT-2026-001',
  level: 'LINKS',
  eventScope: 'INTEGRITY',
  verdict,
  verifiedAt: '2026-09-30T10:00:00Z',
  coverage: {
    eventIntegrity: true,
    parentPresence: true,
    parentIntegrity: true,
    parentBinding: 'NONE',
    leafDeletionDetection: 'NONE',
    note: NOTE,
  },
  summary: { total: 3, valid: invalid ? 2 : 3, invalid: invalid ? 1 : 0, indeterminate: 0, edges: 2 },
  chainChecks: [
    { code: 'PARENTS_PRESENT', status: 'PASS', message: 'ok', entryIds: [] },
    ...(invalid
      ? [{ code: 'PARENTS_INTACT', status: 'FAIL', message: 'parent broken', entryIds: ['EVT-2'] }]
      : []),
  ],
  entries: [
    { entryId: 'EVT-1', verdict: 'VALID', parents: [], creationTime: null, timestampTime: null, failedChecks: [] },
    ...(invalid
      ? [
          {
            entryId: 'EVT-2',
            verdict: 'INVALID',
            parents: ['EVT-1'],
            creationTime: '2026-09-01T00:00:00Z',
            timestampTime: null,
            failedChecks: [
              { code: 'XML_WELL_FORMED', status: 'PASS', message: 'fine' },
              { code: 'REFERENCE_DIGESTS', status: 'FAIL', message: 'digest differs' },
            ],
          },
        ]
      : []),
  ],
});

const eventReport = (verdict: string, withSignature = true) => ({
  projectId: 'TLPT-2026-001',
  entryId: 'EVT-2',
  scope: 'SIGNATURE',
  verdict,
  verifiedAt: '2026-09-30T10:00:00Z',
  ...(withSignature
    ? {
        signature: {
          profile: 'XADES_T',
          signingTime: '2026-09-01T00:00:00Z',
          timestampTime: '2026-09-01T00:00:05Z',
          proofTime: '2026-09-30T10:00:00Z',
          signer: { subject: 'CN=Signer', issuer: 'CN=CA', serialNumber: '1', sha256Fingerprint: 'ab' },
        },
      }
    : {}),
  checks: [
    { code: 'XML_WELL_FORMED', status: 'PASS', message: 'ok' },
    { code: 'SIGNATURE_VALUE', status: verdict === 'VALID' ? 'PASS' : 'FAIL', message: 'bad value' },
  ],
});

describe('timeline.projects.verify', () => {
  it('reports a VALID chain with counts and nothing to act on', async () => {
    const client = { verifyProjectChain: vi.fn().mockResolvedValue(chainReport('VALID')) };

    const result = await verifyProject(client as unknown as TimelineClient, 'TLPT-2026-001');

    expect(result).toEqual({
      projectId: 'TLPT-2026-001',
      verdict: 'VALID',
      level: 'LINKS',
      eventScope: 'INTEGRITY',
      verifiedAt: '2026-09-30T10:00:00Z',
      coverageNote: NOTE,
      summary: { total: 3, valid: 3, invalid: 0, indeterminate: 0, edges: 2 },
      failedChainChecks: [],
      unverifiedEntries: [],
    });
  });

  it('returns an INVALID chain as a result, dropping PASS checks and VALID entries', async () => {
    const client = { verifyProjectChain: vi.fn().mockResolvedValue(chainReport('INVALID', true)) };

    const result = await verifyProject(client as unknown as TimelineClient, 'TLPT-2026-001');

    expect(result.verdict).toBe('INVALID');
    expect(result.summary.total).toBe(3);
    expect(result.failedChainChecks).toEqual([
      { code: 'PARENTS_INTACT', status: 'FAIL', message: 'parent broken', entryIds: ['EVT-2'] },
    ]);
    expect(result.unverifiedEntries).toEqual([
      {
        entryId: 'EVT-2',
        verdict: 'INVALID',
        failedChecks: [{ code: 'REFERENCE_DIGESTS', status: 'FAIL', message: 'digest differs' }],
      },
    ]);
  });

  it('passes the options through and reports the level the backend used', async () => {
    const verifyProjectChain = vi.fn().mockResolvedValue(chainReport('INDETERMINATE'));
    const options = { level: 'BOUND_LINKS', eventScope: 'SIGNATURE', includeIndexConsistency: true };

    const result = await verifyProject({ verifyProjectChain } as unknown as TimelineClient, 'P', options);

    expect(verifyProjectChain).toHaveBeenCalledWith('P', options);
    expect(result.verdict).toBe('INDETERMINATE');
  });

  it('lets a failure to verify escape instead of reporting a verdict', async () => {
    const verifyProjectChain = vi.fn().mockRejectedValue(new TooLargeToVerifyError('verifying P'));

    await expect(
      verifyProject({ verifyProjectChain } as unknown as TimelineClient, 'P'),
    ).rejects.toBeInstanceOf(TooLargeToVerifyError);
  });
});

describe('timeline.events.verify', () => {
  it('keeps the verdict when the signature has no signer or signing time', async () => {
    const base = eventReport('INVALID');
    const verifyProjectEvent = vi.fn().mockResolvedValue({
      ...base,
      signature: { ...base.signature, profile: null, signer: null, signingTime: null },
    });

    const result = await verifyEvent({ verifyProjectEvent } as unknown as TimelineClient, 'P', 'EVT-2');

    expect(result.verdict).toBe('INVALID');
    expect(result.signature?.profile).toBeNull();
    expect(result.signature?.signer).toBeNull();
    expect(result.signature?.signingTime).toBeNull();
  });

  it('reports a VALID event with its signer and no failed checks', async () => {
    const verifyProjectEvent = vi.fn().mockResolvedValue(eventReport('VALID'));

    const result = await verifyEvent({ verifyProjectEvent } as unknown as TimelineClient, 'P', 'EVT-2', 'SIGNATURE');

    expect(verifyProjectEvent).toHaveBeenCalledWith('P', 'EVT-2', 'SIGNATURE');
    expect(result).toEqual({
      projectId: 'TLPT-2026-001',
      entryId: 'EVT-2',
      verdict: 'VALID',
      scope: 'SIGNATURE',
      verifiedAt: '2026-09-30T10:00:00Z',
      signature: {
        profile: 'XADES_T',
        signingTime: '2026-09-01T00:00:00Z',
        timestampTime: '2026-09-01T00:00:05Z',
        signer: { subject: 'CN=Signer', issuer: 'CN=CA' },
      },
      failedChecks: [],
    });
  });

  it('returns an INVALID event as a result and omits an absent signature', async () => {
    const verifyProjectEvent = vi.fn().mockResolvedValue(eventReport('INVALID', false));

    const result = await verifyEvent({ verifyProjectEvent } as unknown as TimelineClient, 'P', 'EVT-2');

    expect(verifyProjectEvent).toHaveBeenCalledWith('P', 'EVT-2', undefined);
    expect(result.verdict).toBe('INVALID');
    expect('signature' in result).toBe(false);
    expect(result.failedChecks).toEqual([
      { code: 'SIGNATURE_VALUE', status: 'FAIL', message: 'bad value' },
    ]);
  });
});
