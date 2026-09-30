import { describe, expect, it, vi } from 'vitest';
import type { TimelineClient } from '../client';
import { projectContext } from './context';
import { listProjects, projectPermissions } from './projects';

function timelineClient() {
  return {
    project: vi.fn().mockResolvedValue({
      project: {
        projectId: 'TLPT-2026-001',
        codename: 'NORTH STAR',
        phase: 'Threat Intelligence',
      },
      actors: [],
      lanes: [],
      events: [
        {
          entryId: 'EVT-002',
          name: 'Scoping complete',
          timestamp: '2026-09-02T10:00:00Z',
          occurred: true,
          actor: { id: 'user-1', name: 'Alex User', role: 'project-manager' },
        },
        {
          entryId: 'EVT-009',
          name: 'Report delivered',
          timestamp: '2026-09-09T10:00:00Z',
          occurred: false,
          actor: null,
        },
      ],
      workflowCompliant: true,
      playbook: { id: 'TLPT-TI', name: 'Threat Intelligence', phases: [] },
    }),
    members: vi.fn().mockResolvedValue([
      { actorId: 'user-1', actorName: 'Alex User', actorRole: 'project-manager', permissions: 'rwx', active: true },
    ]),
  } as unknown as TimelineClient;
}

describe('timeline.project.context', () => {
  it('reports identity, workflow type, members, phase and recent events', async () => {
    const context = await projectContext(timelineClient(), 'TLPT-2026-001');

    expect(context.codename).toBe('NORTH STAR');
    expect(context.workflowType).toBe('TLPT-TI');
    expect(context.currentPhase).toBe('Threat Intelligence');
    expect(context.members.map((member) => member.actorId)).toEqual(['user-1']);
    expect(context.recentEvents.map((event) => event.entryId)).toEqual(['EVT-002']);
  });

  it('keeps planned steps out of what happened', async () => {
    // Folding the two together is how an agent ends up reporting a plan as a fact.
    const context = await projectContext(timelineClient(), 'TLPT-2026-001');

    expect(context.recentEvents.every((event) => event.occurred)).toBe(true);
    expect(context.plannedAhead.map((event) => event.entryId)).toEqual(['EVT-009']);
    expect(context.summary).toContain('do not report them as if they had');
  });
});

describe('timeline.projects.list', () => {
  it('says out loud that appearing in the list is not access', async () => {
    const client = {
      listProjects: vi.fn().mockResolvedValue({
        content: [
          { projectId: 'TLPT-2026-001', codename: 'NORTH STAR', phase: 'TI', status: 'Active' },
        ],
        page: 0,
        size: 20,
        totalElements: 1,
        totalPages: 1,
      }),
    } as unknown as TimelineClient;

    const listing = await listProjects(client);

    expect(listing.projects).toHaveLength(1);
    expect(listing.note).toContain('says nothing about what you may do');
  });
});

describe('timeline.projects.permissions', () => {
  it('distinguishes write access from mere membership', async () => {
    const client = {
      projectPermissions: vi.fn().mockResolvedValue({
        projectId: 'TLPT-2026-001',
        actorId: 'user-1',
        member: true,
        permissions: 'r',
      }),
    } as unknown as TimelineClient;

    const report = await projectPermissions(client, 'TLPT-2026-001');

    expect(report.canWrite).toBe(false);
    // POST /api/ui/api-keys gates on write access, so a read-only member cannot get a key
    // confirmed at all - not "a key could be confirmed but writes would fail".
    expect(report.summary).toContain('no key can be confirmed for it without write permission');
  });

  it('says plainly when no key can exist for a project', async () => {
    const client = {
      projectPermissions: vi.fn().mockResolvedValue({
        projectId: 'TLPT-2026-001',
        actorId: 'user-1',
        member: false,
        permissions: '',
      }),
    } as unknown as TimelineClient;

    const report = await projectPermissions(client, 'TLPT-2026-001');

    expect(report.canWrite).toBe(false);
    expect(report.summary).toContain('cannot be confirmed');
  });

  it('takes the most recent occurred events newest first even when they arrive in workflow order', async () => {
    const client = timelineClient();
    const at = (entryId: string, timestamp: string) => ({ entryId, name: entryId, timestamp, occurred: true });
    vi.mocked(client.project).mockResolvedValue({
      project: { projectId: 'TLPT-2026-001', codename: 'NORTH STAR', phase: 'x' },
      events: [
        at('EVT-A', '2026-09-01T10:00:00Z'),
        at('EVT-C', '2026-09-03T10:00:00Z'),
        at('EVT-B', '2026-09-02T10:00:00Z'),
        at('EVT-D', '2026-09-04T10:00:00Z'),
      ],
      workflowCompliant: true,
      playbook: null,
    } as never);

    const context = await projectContext(client, 'TLPT-2026-001', 2);

    expect(context.recentEvents.map((event) => event.entryId)).toEqual(['EVT-D', 'EVT-C']);
  });
});
