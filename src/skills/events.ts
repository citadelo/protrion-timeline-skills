import type { EventFilters, IngestStatus, TimelineClient, TimelineEvent } from '../client';
import { ProjectKeyRequiredError } from '../errors';

export type CreateOutcome = 'processed' | 'failed' | 'unresolved';

export interface CreateEventResult {
  outcome: CreateOutcome;
  /** The entry id the event was stored under, once it reached the ledger. */
  entryId?: string;
  /** The ingest record, so an unresolved outcome can be re-checked. */
  ingestId: string;
  error?: string;
  summary: string;
}

export interface CreateEventOptions {
  client: TimelineClient;
  projectId: string;
  event: Record<string, unknown>;
  /** How long to wait for the ledger to confirm, before reporting the outcome as unresolved. */
  budgetSeconds?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Writes an event and reports whether it actually arrived.
 *
 * The ingest API answers `202` — accepted for processing — and the real outcome appears later. An
 * agent told "success" on the `202` would report a timeline as updated every time the downstream
 * write failed, which is precisely the failure this pack exists to avoid.
 */
export async function createEvent(options: CreateEventOptions): Promise<CreateEventResult> {
  const budgetSeconds = options.budgetSeconds ?? 30;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const receipt = await options.client.submitEvent(options.projectId, options.event);
  const deadline = Date.now() + budgetSeconds * 1000;

  // The write already happened - the 202 said so. A failure from here on is a failure to *learn*
  // the outcome, not a failure to write, so it is reported as unresolved rather than thrown: an
  // agent that let this escape would crash on an event the backend had already accepted.
  let last: IngestStatus;
  try {
    last = await options.client.eventStatus(options.projectId, receipt.id);
    while (last.status !== 'PROCESSED' && last.status !== 'FAILED' && Date.now() < deadline) {
      await sleep(pollIntervalMs);
      last = await options.client.eventStatus(options.projectId, receipt.id);
    }
  } catch (error) {
    return {
      outcome: 'unresolved',
      ingestId: receipt.id,
      error: reasonFor(error),
      summary: unresolvedSummary(receipt.id, error),
    };
  }

  if (last.status === 'PROCESSED') {
    return {
      outcome: 'processed',
      entryId: last.entryId ?? undefined,
      ingestId: receipt.id,
      summary: `The event reached the ledger as ${last.entryId ?? 'an entry'}.`,
    };
  }
  if (last.status === 'FAILED') {
    return {
      outcome: 'failed',
      ingestId: receipt.id,
      error: last.lastError ?? undefined,
      summary:
        'The event was accepted for processing but did not reach the ledger.'
        + (last.lastError ? ` The recorded error was: ${last.lastError}` : ''),
    };
  }
  return {
    outcome: 'unresolved',
    ingestId: receipt.id,
    summary:
      `The event was accepted but had not resolved within ${budgetSeconds}s. It may still land; `
      + `re-check ingest record ${receipt.id} rather than assuming either way.`,
  };
}

/** A `401` on the project key mid-poll means the key stopped being usable, not that it was ever bad. */
function isExpiredProjectKey(error: unknown): boolean {
  return error instanceof ProjectKeyRequiredError && error.reason === 'expired';
}

function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unresolvedSummary(ingestId: string, error: unknown): string {
  if (isExpiredProjectKey(error)) {
    return (
      `The event was accepted (ingest record ${ingestId}), but its status could not be checked: `
      + `${reasonFor(error)} Re-check ingest record ${ingestId} once a fresh key is confirmed.`
    );
  }
  return (
    `The event was accepted (ingest record ${ingestId}), but checking its status failed: `
    + `${reasonFor(error)} It may still land; re-check ingest record ${ingestId} rather than `
    + 'assuming either way.'
  );
}

/** The events of the project a held key is bound to, optionally narrowed. */
export async function listEvents(
  client: TimelineClient,
  projectId: string,
  filters: EventFilters = {},
): Promise<TimelineEvent[]> {
  return client.events(projectId, filters);
}

/** One event of the project a held key is bound to, by entry id. */
export async function getEvent(
  client: TimelineClient,
  projectId: string,
  entryId: string,
): Promise<TimelineEvent> {
  return client.event(projectId, entryId);
}
