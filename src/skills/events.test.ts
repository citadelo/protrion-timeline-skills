import { describe, expect, it, vi } from 'vitest';
import type { TimelineClient } from '../client';
import { BackendUnavailableError, ProjectKeyRequiredError } from '../errors';
import { createEvent } from './events';

function clientWith(
  statuses: { status: string; entryId?: string; lastError?: string }[],
  events: unknown[] = [],
) {
  const eventStatus = vi.fn();
  statuses.forEach((status) =>
    eventStatus.mockResolvedValueOnce({
      id: 'ingest-1',
      status: status.status,
      entryId: status.entryId ?? null,
      lastError: status.lastError ?? null,
    }),
  );
  // Keep answering with the last one once the scripted sequence runs out.
  const last = statuses[statuses.length - 1]!;
  eventStatus.mockResolvedValue({
    id: 'ingest-1',
    status: last.status,
    entryId: last.entryId ?? null,
    lastError: last.lastError ?? null,
  });
  return {
    submitEvent: vi.fn().mockResolvedValue({
      id: 'ingest-1',
      status: 'PENDING',
      receivedAt: '2026-09-20T08:00:00Z',
    }),
    eventStatus,
    events: vi.fn().mockResolvedValue(events),
  } as unknown as TimelineClient;
}

const noSleep = () => Promise.resolve();

const occurred = (entryId: string, timestamp: string, isOccurred = true) => ({
  entryId,
  timestamp,
  occurred: isOccurred,
});

async function create(client: TimelineClient, event: Record<string, unknown>) {
  return createEvent({ client, projectId: 'TLPT-2026-001', event, sleep: noSleep });
}

function sentEvent(client: TimelineClient): Record<string, unknown> {
  return (client.submitEvent as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>;
}

describe('timeline.events.create parents', () => {
  const processed = [{ status: 'PROCESSED', entryId: 'EVT-009' }];

  it('submits nothing without parents and suggests the latest occurred event', async () => {
    const client = clientWith(processed, [
      occurred('EVT-001', '2026-09-01T00:00:00Z'),
      occurred('EVT-003', '2026-09-03T00:00:00Z'),
      occurred('EVT-002', '2026-09-02T00:00:00Z'),
    ]);

    const result = await create(client, { name: 'x' });

    expect(client.submitEvent).not.toHaveBeenCalled();
    expect(result.outcome).toBe('needs_parent_decision');
    expect(result.suggestedParent).toBe('EVT-003');
    expect(result.summary).toContain('Ask the user');
    expect(result.summary).toContain('"parents":[]');
  });

  it.each([[null], ['EVT-1']])('treats parents %j as undecided and submits nothing', async (value) => {
    const client = clientWith(processed, [occurred('EVT-001', '2026-09-01T00:00:00Z')]);

    const result = await create(client, { name: 'x', parents: value });

    expect(client.submitEvent).not.toHaveBeenCalled();
    expect(result.outcome).toBe('needs_parent_decision');
    expect(result.suggestedParent).toBe('EVT-001');
  });

  it('never suggests a planned step, even when its timestamp is later', async () => {
    const client = clientWith(processed, [
      occurred('EVT-001', '2026-09-01T00:00:00Z'),
      occurred('EVT-PLAN', '2026-12-01T00:00:00Z', false),
    ]);

    const result = await create(client, { name: 'x' });

    expect(result.suggestedParent).toBe('EVT-001');
  });

  it('suggests nothing when no event has occurred', async () => {
    const client = clientWith(processed, [occurred('EVT-P1', '2026-09-01T00:00:00Z', false)]);

    const result = await create(client, { name: 'x' });

    expect(client.submitEvent).not.toHaveBeenCalled();
    expect(result.outcome).toBe('needs_parent_decision');
    expect(result.suggestedParent).toBeNull();
  });

  it('sends explicit parents unchanged and does not list events', async () => {
    const client = clientWith(processed, [occurred('EVT-001', '2026-09-01T00:00:00Z')]);

    const result = await create(client, { name: 'x', parents: ['EVT-005'] });

    expect(sentEvent(client).parents).toEqual(['EVT-005']);
    expect(client.events).not.toHaveBeenCalled();
    expect(result.outcome).toBe('processed');
    expect(result.parents).toEqual(['EVT-005']);
  });

  it('sends an empty list without parents, as a deliberate choice', async () => {
    const client = clientWith(processed, [occurred('EVT-001', '2026-09-01T00:00:00Z')]);

    const result = await create(client, { name: 'x', parents: [] });

    expect(sentEvent(client)).not.toHaveProperty('parents');
    expect(client.events).not.toHaveBeenCalled();
    expect(result.outcome).toBe('processed');
    expect(result.parents).toEqual([]);
    expect(result.summary).toContain('No parent was used');
  });
});

describe('timeline.events.create', () => {
  it('reports success only once the event reached the ledger', async () => {
    const client = clientWith([{ status: 'PENDING' }, { status: 'PROCESSED', entryId: 'EVT-009' }]);

    const result = await createEvent({
      client,
      projectId: 'TLPT-2026-001',
      event: { name: 'Scoping complete', parents: [] },
      sleep: noSleep,
    });

    expect(result.outcome).toBe('processed');
    expect(result.entryId).toBe('EVT-009');
  });

  it('reports a failure after acceptance as a failure, with the recorded error', async () => {
    // The 202 said "accepted for processing". Reporting that as success would tell the agent the
    // timeline was updated every single time the downstream write failed.
    const client = clientWith([{ status: 'FAILED', lastError: 'Parent lookup failed' }]);

    const result = await createEvent({
      client,
      projectId: 'TLPT-2026-001',
      event: { name: 'Scoping complete', parents: [] },
      sleep: noSleep,
    });

    expect(result.outcome).toBe('failed');
    expect(result.error).toBe('Parent lookup failed');
    expect(result.summary).toContain('did not reach the ledger');
  });

  it('reports an unresolved outcome rather than guessing either way', async () => {
    const client = clientWith([{ status: 'PENDING' }]);

    const result = await createEvent({
      client,
      projectId: 'TLPT-2026-001',
      event: { name: 'Scoping complete', parents: [] },
      budgetSeconds: 0,
      sleep: noSleep,
    });

    expect(result.outcome).toBe('unresolved');
    expect(result.ingestId).toBe('ingest-1');
    expect(result.summary).toContain('re-check');
  });

  it('reports unresolved, not a crash, when the project key is rejected mid-poll', async () => {
    // The write already happened. A 401 here means the key stopped being usable between the
    // submit and the check - the agent needs to know to re-confirm, not to see the write itself
    // reported as a failure.
    const client = {
      submitEvent: vi.fn().mockResolvedValue({
        id: 'ingest-1',
        status: 'PENDING',
        receivedAt: '2026-09-20T08:00:00Z',
      }),
      events: vi.fn().mockResolvedValue([]),
      eventStatus: vi
        .fn()
        .mockRejectedValue(new ProjectKeyRequiredError('TLPT-2026-001', 'expired')),
    } as unknown as TimelineClient;

    const result = await createEvent({
      client,
      projectId: 'TLPT-2026-001',
      event: { name: 'Scoping complete', parents: [] },
      sleep: noSleep,
    });

    expect(result.outcome).toBe('unresolved');
    expect(result.ingestId).toBe('ingest-1');
    expect(result.summary).toContain('timeline.authenticate');
  });

  it('reports unresolved, not a crash, when polling fails against an unavailable backend', async () => {
    const client = {
      submitEvent: vi.fn().mockResolvedValue({
        id: 'ingest-1',
        status: 'PENDING',
        receivedAt: '2026-09-20T08:00:00Z',
      }),
      events: vi.fn().mockResolvedValue([]),
      eventStatus: vi
        .fn()
        .mockRejectedValue(
          new BackendUnavailableError('checking whether an event reached the ledger'),
        ),
    } as unknown as TimelineClient;

    const result = await createEvent({
      client,
      projectId: 'TLPT-2026-001',
      event: { name: 'Scoping complete', parents: [] },
      sleep: noSleep,
    });

    expect(result.outcome).toBe('unresolved');
    expect(result.ingestId).toBe('ingest-1');
    expect(result.summary).toContain('could not be reached');
  });
});
