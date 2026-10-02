// SPDX-FileCopyrightText: 2026 CITADELO s.r.o.
// SPDX-License-Identifier: Apache-2.0

import type { ChainVerificationOptions, IngestVerificationCheck, TimelineClient } from '../client';

export interface ProjectVerificationReport {
  projectId: string;
  verdict: string;
  /** The level the backend actually used, which is the default when the caller chose none. */
  level: string;
  eventScope: string;
  verifiedAt: string;
  /** States what this level of check could not detect. */
  coverageNote: string;
  summary: { total: number; valid: number; invalid: number; indeterminate: number; edges: number };
  /** Chain checks that did not pass. */
  failedChainChecks: { code: string; status: string; message: string; entryIds: string[] }[];
  /** Entries whose verdict is not VALID. */
  unverifiedEntries: {
    entryId: string;
    verdict: string;
    failedChecks: { code: string; status: string; message: string }[];
  }[];
}

export interface EventVerificationReport {
  projectId: string;
  entryId: string;
  verdict: string;
  scope: string;
  verifiedAt: string;
  signature?: {
    profile: string | null;
    signingTime: string | null;
    timestampTime: string | null;
    /** Null when the ledger could not read the signing certificate. */
    signer: { subject: string; issuer: string } | null;
  };
  /** Checks that did not pass. */
  failedChecks: { code: string; status: string; message: string }[];
}

const trimCheck = ({ code, status, message }: IngestVerificationCheck) => ({ code, status, message });

/**
 * Verifies the chain of a project and reports what an agent must act on: the verdict, the level it
 * was checked at, and only the checks and entries that did not pass (counts cover the rest).
 *
 * A non-VALID verdict is a result and is returned, not thrown. Only a failure to verify throws.
 */
export async function verifyProject(
  client: TimelineClient,
  projectId: string,
  options: ChainVerificationOptions = {},
): Promise<ProjectVerificationReport> {
  const report = await client.verifyProjectChain(projectId, options);
  return {
    projectId: report.projectId,
    verdict: report.verdict,
    level: report.level,
    eventScope: report.eventScope,
    verifiedAt: report.verifiedAt,
    coverageNote: report.coverage.note,
    summary: report.summary,
    failedChainChecks: report.chainChecks
      .filter((check) => check.status !== 'PASS')
      .map((check) => ({ ...trimCheck(check), entryIds: check.entryIds })),
    unverifiedEntries: report.entries
      .filter((entry) => entry.verdict !== 'VALID')
      .map((entry) => ({
        entryId: entry.entryId,
        verdict: entry.verdict,
        failedChecks: entry.failedChecks.filter((check) => check.status !== 'PASS').map(trimCheck),
      })),
  };
}

/** Verifies one event of a project. Same rule: the verdict is a result, not an error. */
export async function verifyEvent(
  client: TimelineClient,
  projectId: string,
  entryId: string,
  scope?: string,
): Promise<EventVerificationReport> {
  const report = await client.verifyProjectEvent(projectId, entryId, scope);
  const result: EventVerificationReport = {
    projectId: report.projectId,
    entryId: report.entryId,
    verdict: report.verdict,
    scope: report.scope,
    verifiedAt: report.verifiedAt,
    failedChecks: report.checks.filter((check) => check.status !== 'PASS').map(trimCheck),
  };
  if (report.signature) {
    result.signature = {
      profile: report.signature.profile,
      signingTime: report.signature.signingTime,
      timestampTime: report.signature.timestampTime,
      signer: report.signature.signer
        ? { subject: report.signature.signer.subject, issuer: report.signature.signer.issuer }
        : null,
    };
  }
  return result;
}
