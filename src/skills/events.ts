import type { EventFilters, IngestStatus, TimelineClient, TimelineEvent } from '../client';
import { InvalidRequestError, NotFoundError, ProjectKeyRequiredError } from '../errors';

export type CreateOutcome = 'processed' | 'failed' | 'unresolved' | 'needs_parent_decision' | 'not_found';

export interface CreateEventResult {
  outcome: CreateOutcome;
  /** The entry id the event was stored under, once it reached the ledger. */
  entryId?: string;
  /** The ingest record, so an unresolved outcome can be re-checked. */
  ingestId?: string;
  /** The parents the event was sent with, as named by the agent. Empty when none. Absent when nothing was written. */
  parents?: string[];
  /** For `needs_parent_decision`: the latest occurred event, or null when nothing has occurred yet. */
  suggestedParent?: string | null;
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
  const named = options.event.parents;
  // Only an actual array is a decision; anything else (absent, null, a string) is still undecided.
  if (!Array.isArray(named)) return decideParent(options);

  const parents = named.map(String);
  const event = { ...options.event };
  if (parents.length === 0) delete event.parents;
  const note = parents.length > 0
    ? `Parents were the ones given: ${parents.join(', ')}.`
    : 'No parent was used, as chosen.';
  const receipt = await options.client.submitEvent(options.projectId, event);
  return awaitOutcome(options, receipt.id, note, parents);
}

export interface RecheckEventOptions {
  client: TimelineClient;
  projectId: string;
  /** The ingest record id an earlier unresolved write returned. */
  ingestId: string;
  budgetSeconds?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Reads the ingest status of an earlier write and reports it as a fresh write would be reported.
 * Nothing is written: this never creates the event a second time.
 */
export async function recheckEvent(options: RecheckEventOptions): Promise<CreateEventResult> {
  return awaitOutcome(
    options,
    options.ingestId,
    'This is a re-check; nothing was written again.',
    undefined,
    true,
  );
}

async function awaitOutcome(
  options: {
    client: TimelineClient;
    projectId: string;
    budgetSeconds?: number;
    pollIntervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
  ingestId: string,
  note: string,
  parents?: string[],
  recheck = false,
): Promise<CreateEventResult> {
  const budgetSeconds = options.budgetSeconds ?? 30;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const receipt = { id: ingestId };
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
    // Only a re-check can name an id the backend does not know; a fresh write's record exists.
    if (recheck && (error instanceof NotFoundError || error instanceof InvalidRequestError)) {
      return {
        outcome: 'not_found',
        ingestId,
        error: reasonFor(error),
        summary:
          `No such ingest record: ${ingestId} is not known to this project's stream. Check the id `
          + 'against the ingestId an earlier write returned. Nothing was written.',
      };
    }
    return {
      outcome: 'unresolved',
      ingestId: receipt.id,
      parents,
      error: reasonFor(error),
      summary: `${unresolvedSummary(receipt.id, error)} ${note}`,
    };
  }

  if (last.status === 'PROCESSED') {
    return {
      outcome: 'processed',
      entryId: last.entryId ?? undefined,
      ingestId: receipt.id,
      parents,
      summary: `The event reached the ledger as ${last.entryId ?? 'an entry'}. ${note}`,
    };
  }
  if (last.status === 'FAILED') {
    return {
      outcome: 'failed',
      ingestId: receipt.id,
      parents,
      error: last.lastError ?? undefined,
      summary:
        'The event was accepted for processing but did not reach the ledger.'
        + (last.lastError ? ` The recorded error was: ${last.lastError}` : '')
        + ` ${note}`,
    };
  }
  return {
    outcome: 'unresolved',
    ingestId: receipt.id,
    parents,
    summary:
      `The event was accepted but had not resolved within ${budgetSeconds}s. It may still land; `
      + `re-check ingest record ${receipt.id} rather than assuming either way. ${note}`,
  };
}

/**
 * The event names no `parents` field, so what it follows has not been decided. Nothing is written:
 * the skill suggests the project's latest event that has occurred (never a planned step) and leaves
 * the choice to the user, through the agent.
 */
async function decideParent(options: CreateEventOptions): Promise<CreateEventResult> {
  const events = await options.client.events(options.projectId);
  let latest: TimelineEvent | undefined;
  for (const candidate of events) {
    if (candidate.occurred !== true) continue;
    if (!latest || Date.parse(candidate.timestamp) > Date.parse(latest.timestamp)) latest = candidate;
  }
  const suggestedParent = latest?.entryId ?? null;
  const rerun =
    'Then re-run with "parents":["<id>"] in the event to link it, or "parents":[] for no parent.';
  return {
    outcome: 'needs_parent_decision',
    suggestedParent,
    summary: suggestedParent
      ? `Nothing was written: it is not decided what this event follows. Ask the user whether to link it to `
        + `the latest event that has occurred, ${suggestedParent}, to another event, or to none. ${rerun}`
      : `Nothing was written: it is not decided what this event follows, and no event has occurred yet to `
        + `suggest. Ask the user whether to link it to a particular event or to none. ${rerun}`,
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
