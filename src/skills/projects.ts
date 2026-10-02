// SPDX-FileCopyrightText: 2026 CITADELO s.r.o.
// SPDX-License-Identifier: Apache-2.0

import type { ProjectMember, ProjectPermissions, TimelineClient } from '../client';

export interface ProjectListing {
  projects: { projectId: string; codename: string; phase: string; status: string }[];
  page: number;
  totalElements: number;
  /** Said out loud because appearing in this list is not a claim about access. */
  note: string;
}

/**
 * Lists every project the ledger holds.
 *
 * Membership is not consulted, so this answers "what exists", not "what may I touch". The note is
 * part of the result rather than documentation, because an agent reading a list of projects will
 * otherwise assume it can act on them.
 */
export async function listProjects(
  client: TimelineClient,
  page = 0,
  size = 20,
): Promise<ProjectListing> {
  const result = await client.listProjects(page, size);
  return {
    projects: result.content.map((project) => ({
      projectId: project.projectId,
      codename: project.codename,
      phase: project.phase,
      status: project.status,
    })),
    page: result.page,
    totalElements: result.totalElements,
    note:
      'Appearing here says nothing about what you may do with a project. Check its permissions, and '
      + 'acting on one needs a key a person confirms.',
  };
}

export interface PermissionsReport extends ProjectPermissions {
  canWrite: boolean;
  summary: string;
}

/** Reports what the approving user may do on one project, without attempting anything. */
export async function projectPermissions(
  client: TimelineClient,
  projectId: string,
): Promise<PermissionsReport> {
  const permissions = await client.projectPermissions(projectId);
  const canWrite = permissions.member && permissions.permissions.includes('w');
  return {
    ...permissions,
    canWrite,
    summary: permissions.member
      ? `Permissions on ${projectId}: ${permissions.permissions}.`
        + (canWrite ? '' : ' Read-only: no key can be confirmed for it without write permission.')
      : `Not a member of ${projectId}. A key for it cannot be confirmed.`,
  };
}

/** The project a held key is bound to, merged: info, actors, lanes, events, compliance, playbook. */
export async function getProject(client: TimelineClient, projectId: string) {
  return client.project(projectId);
}

/** The active actors of the project a held key is bound to. */
export async function projectMembers(
  client: TimelineClient,
  projectId: string,
): Promise<ProjectMember[]> {
  return client.members(projectId);
}
