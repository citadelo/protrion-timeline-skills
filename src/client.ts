// SPDX-FileCopyrightText: 2026 CITADELO s.r.o.
// SPDX-License-Identifier: Apache-2.0

import { CredentialStore } from './credentials';
import type { TimelineConfig } from './config';
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

export interface ProjectSummary {
  projectId: string;
  codename: string;
  phase: string;
  framework: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  phaseProgress: number;
  tiProvider: string;
}

export interface Page<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface ProjectPermissions {
  projectId: string;
  actorId: string;
  member: boolean;
  permissions: string;
}

export interface TimelineEvent {
  entryId: string;
  name: string;
  description: string;
  streamId: string;
  timestamp: string;
  /** False for a planned step the workflow expects but that has not happened. */
  occurred: boolean;
  group: string | null;
  tags: string[];
  parents: string[];
  type: { name: string; details: { key: string; value: string }[] } | null;
  actor: { id: string; name: string; role: string } | null;
}

export interface ProjectTimeline {
  project: ProjectSummary;
  actors: { id: string; name: string; role: string }[];
  lanes: { id: string; label: string; order: number }[];
  events: TimelineEvent[];
  workflowCompliant: boolean;
  playbook: { id: string; name: string; phases: string[] } | null;
}

export interface ProjectMember {
  actorId: string;
  actorName: string;
  actorRole: string;
  permissions: string;
  active: boolean;
}

export interface EventFilters {
  group?: string;
  tags?: string[];
  typeDetail?: string[];
}

export interface IngestReceipt {
  id: string;
  status: string;
  receivedAt: string;
}

export interface IngestStatus {
  id: string;
  status: 'PENDING' | 'PROCESSED' | 'FAILED' | string;
  entryId: string | null;
  lastError: string | null;
}

export type VerificationVerdict = 'VALID' | 'INVALID' | 'INDETERMINATE';
export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIPPED';

export interface IngestVerificationCheck {
  code: string;
  status: CheckStatus;
  message: string;
}

export interface IngestVerificationChainCheck extends IngestVerificationCheck {
  entryIds: string[];
}

export interface IngestVerificationEntry {
  entryId: string;
  verdict: VerificationVerdict;
  parents: string[];
  creationTime: string | null;
  timestampTime: string | null;
  failedChecks: IngestVerificationCheck[];
}

export interface IngestProjectVerification {
  projectId: string;
  level: string;
  eventScope: string;
  verdict: VerificationVerdict;
  verifiedAt: string;
  coverage: {
    eventIntegrity: boolean;
    parentPresence: boolean;
    parentIntegrity: boolean;
    parentBinding: string;
    leafDeletionDetection: string;
    note: string;
  };
  summary: { total: number; valid: number; invalid: number; indeterminate: number; edges: number };
  chainChecks: IngestVerificationChainCheck[];
  entries: IngestVerificationEntry[];
}

export interface IngestEventVerification {
  projectId: string;
  entryId: string;
  scope: string;
  verdict: VerificationVerdict;
  verifiedAt: string;
  signature?: {
    profile: string | null;
    signingTime: string | null;
    timestampTime: string | null;
    proofTime: string | null;
    signer: {
      subject: string;
      issuer: string;
      serialNumber: string;
      sha256Fingerprint: string;
    } | null;
  };
  checks: IngestVerificationCheck[];
}

export interface ChainVerificationOptions {
  level?: string;
  eventScope?: string;
  includeIndexConsistency?: boolean;
}

/**
 * The pack's one way of talking to the backend.
 *
 * Two rules live here rather than in each skill. A request needing a project key is refused before
 * it is sent when no confirmed, unexpired key is held — a skill must never obtain one by itself. And
 * a refusal is reported as a refusal: which credential, and what it was attempting.
 */
export class TimelineClient {
  constructor(
    private readonly config: TimelineConfig,
    private readonly credentials: CredentialStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  // --- agent-token reads: neither yields a credential, so neither needs a human -----------------

  async listProjects(page = 0, size = 20): Promise<Page<ProjectSummary>> {
    return this.withExternalToolToken(
      `/api/ingest/projects?page=${page}&size=${size}`,
      'listing projects',
    );
  }

  async projectPermissions(projectId: string): Promise<ProjectPermissions> {
    return this.withExternalToolToken(
      `/api/ingest/projects/${encodeURIComponent(projectId)}/permissions`,
      `checking permissions on ${projectId}`,
    );
  }

  // --- project-key reads -----------------------------------------------------------------------

  async project(projectId: string, filters: EventFilters = {}): Promise<ProjectTimeline> {
    return this.withProjectKey(
      projectId,
      `/api/ingest/project${query(filters)}`,
      `reading ${projectId}`,
    );
  }

  async events(projectId: string, filters: EventFilters = {}): Promise<TimelineEvent[]> {
    return this.withProjectKey(
      projectId,
      `/api/ingest/project/events${query(filters)}`,
      `reading the events of ${projectId}`,
    );
  }

  async event(projectId: string, entryId: string): Promise<TimelineEvent> {
    return this.withProjectKey(
      projectId,
      `/api/ingest/project/events/${encodeURIComponent(entryId)}`,
      `reading ${entryId} in ${projectId}`,
    );
  }

  async members(projectId: string): Promise<ProjectMember[]> {
    return this.withProjectKey(
      projectId,
      '/api/ingest/project/members',
      `reading the members of ${projectId}`,
    );
  }

  // --- verification: a verdict is a result, so only failing to verify is an error ----------------

  async verifyProjectChain(
    projectId: string,
    options: ChainVerificationOptions = {},
  ): Promise<IngestProjectVerification> {
    const params = new URLSearchParams();
    if (options.level) params.set('level', options.level);
    if (options.eventScope) params.set('eventScope', options.eventScope);
    if (options.includeIndexConsistency !== undefined) {
      params.set('includeIndexConsistency', String(options.includeIndexConsistency));
    }
    return this.withProjectKey(
      projectId,
      `/api/ingest/project/verification${suffix(params)}`,
      `verifying the chain of ${projectId}`,
      {},
      true,
    );
  }

  async verifyProjectEvent(
    projectId: string,
    entryId: string,
    scope?: string,
  ): Promise<IngestEventVerification> {
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    return this.withProjectKey(
      projectId,
      `/api/ingest/project/events/${encodeURIComponent(entryId)}/verification${suffix(params)}`,
      `verifying ${entryId} in ${projectId}`,
      {},
      true,
    );
  }

  // --- writing ---------------------------------------------------------------------------------

  async submitEvent(projectId: string, event: Record<string, unknown>): Promise<IngestReceipt> {
    return this.withProjectKey(projectId, '/api/ingest/events', `writing an event to ${projectId}`, {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async eventStatus(projectId: string, id: string): Promise<IngestStatus> {
    return this.withProjectKey(
      projectId,
      `/api/ingest/events/${encodeURIComponent(id)}/status`,
      `checking whether an event reached the ledger`,
    );
  }

  private async withExternalToolToken<T>(path: string, attempting: string): Promise<T> {
    const externalToolToken = await this.credentials.readExternalToolToken();
    if (!externalToolToken) {
      throw new AuthorizationRequiredError('missing');
    }
    return this.send<T>(path, externalToolToken.token, 'external tool token', attempting);
  }

  private async withProjectKey<T>(
    projectId: string,
    path: string,
    attempting: string,
    init: RequestInit = {},
    verification = false,
  ): Promise<T> {
    // Refused before a request is issued: a key the user has not confirmed, or one that has run out,
    // is not something the pack may work around.
    const key = await this.credentials.readProjectKey(projectId);
    if (!key) {
      // A stored entry that is no longer usable means "expired", which is a different thing to tell
      // the agent than "you never had one" - one is a renewal, the other a first confirmation.
      const expired = await this.credentials.hasProjectKey(projectId);
      throw new ProjectKeyRequiredError(projectId, expired ? 'expired' : 'missing');
    }
    return this.send<T>(path, key.key, 'project key', attempting, init, projectId, verification);
  }

  private async send<T>(
    path: string,
    token: string,
    credential: 'external tool token' | 'project key',
    attempting: string,
    init: RequestInit = {},
    projectId?: string,
    verification = false,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      throw new BackendUnavailableError(attempting, error);
    }

    if (response.status === 401 && credential === 'external tool token') {
      throw new AuthorizationRequiredError('rejected');
    }
    if (response.status === 401 && credential === 'project key') {
      // The key stopped being usable between being confirmed and this request landing - expired
      // or revoked server-side. This is every submit and read a project key backs, not only the
      // polling path: an agent mid-operation needs the same "go re-confirm" message everywhere,
      // not a generic refusal on some calls and a helpful one on others.
      throw new ProjectKeyRequiredError(projectId as string, 'expired');
    }
    if (response.status === 401 || response.status === 403) {
      throw new RefusedError(response.status, credential, attempting, await detail(response));
    }
    if (!response.ok) {
      // 422 and 504 only mean something specific on a verification; everywhere else they keep their
      // existing mapping.
      if (verification && response.status === 422) {
        throw new TooLargeToVerifyError(attempting, await detail(response));
      }
      if (verification && response.status === 504) {
        throw new BackendTimedOutError(attempting, await detail(response));
      }
      if (response.status >= 500) {
        throw new BackendUnavailableError(attempting);
      }
      const problem = await detail(response);
      if (response.status === 404) throw new NotFoundError(attempting, problem);
      // 400/422 and any other unexpected 4xx (409): the credential was accepted, so this is not
      // "refused" and must not steer the agent to re-authenticate.
      throw new InvalidRequestError(response.status, attempting, problem);
    }
    return (await response.json()) as T;
  }
}

function suffix(params: URLSearchParams): string {
  const rendered = params.toString();
  return rendered ? `?${rendered}` : '';
}

function query(filters: EventFilters): string {
  const params = new URLSearchParams();
  if (filters.group) {
    params.set('group', filters.group);
  }
  filters.tags?.forEach((tag) => params.append('tags', tag));
  filters.typeDetail?.forEach((detail) => params.append('typeDetail', detail));
  const rendered = params.toString();
  return rendered ? `?${rendered}` : '';
}

async function detail(response: Response): Promise<string | undefined> {
  try {
    const problem = (await response.json()) as { detail?: unknown };
    return typeof problem.detail === 'string' ? problem.detail : undefined;
  } catch {
    return undefined;
  }
}
