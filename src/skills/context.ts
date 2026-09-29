import type { TimelineClient } from '../client';

export interface ProjectContext {
  projectId: string;
  codename: string;
  workflowType: string | null;
  currentPhase: string;
  workflowCompliant: boolean;
  members: { actorId: string; actorName: string; permissions: string }[];
  /** Newest first. Each says whether it happened or is still only planned. */
  recentEvents: {
    entryId: string;
    name: string;
    timestamp: string;
    occurred: boolean;
    actorName: string | null;
  }[];
  plannedAhead: { entryId: string; name: string }[];
  summary: string;
}

/**
 * One orienting read, so routine work does not start with a sequence of separate lookups.
 *
 * Planned steps are separated from things that happened rather than merged into one list: an agent
 * summarising a project must not report a plan as a fact.
 */
export async function projectContext(
  client: TimelineClient,
  projectId: string,
  recentCount = 10,
): Promise<ProjectContext> {
  const [timeline, members] = await Promise.all([
    client.project(projectId),
    client.members(projectId),
  ]);

  const occurred = timeline.events.filter((event) => event.occurred);
  const planned = timeline.events.filter((event) => !event.occurred);

  return {
    projectId: timeline.project.projectId,
    codename: timeline.project.codename,
    workflowType: timeline.playbook?.id ?? null,
    currentPhase: timeline.project.phase,
    workflowCompliant: timeline.workflowCompliant,
    members: members.map((member) => ({
      actorId: member.actorId,
      actorName: member.actorName,
      permissions: member.permissions,
    })),
    recentEvents: occurred.slice(0, recentCount).map((event) => ({
      entryId: event.entryId,
      name: event.name,
      timestamp: event.timestamp,
      occurred: true,
      actorName: event.actor?.name ?? null,
    })),
    plannedAhead: planned.map((event) => ({ entryId: event.entryId, name: event.name })),
    summary:
      `${timeline.project.codename} (${timeline.project.projectId}) is in ${timeline.project.phase}, `
      + `with ${occurred.length} event(s) recorded and ${planned.length} planned step(s) not yet `
      + 'taken. Planned steps have not happened - do not report them as if they had.',
  };
}
