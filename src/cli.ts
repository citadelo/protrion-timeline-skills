import path from 'node:path';
import { openBrowser } from './browser';
import { TimelineClient } from './client';
import { PACK_ROOT, readConfig } from './config';
import { CredentialStore } from './credentials';
import {
  AuthorizationRequiredError,
  BackendUnavailableError,
  DeclinedError,
  DeliveryRefusedError,
  InvalidRequestError,
  NotFoundError,
  ProjectKeyRequiredError,
  RefusedError,
  TimedOutError,
} from './errors';
import { authenticate } from './skills/authenticate';
import { projectContext } from './skills/context';
import { createEvent, getEvent, listEvents, recheckEvent } from './skills/events';
import { getProject, listProjects, projectMembers, projectPermissions } from './skills/projects';

/**
 * The single entry point every skill invokes. Each skill is one subcommand, so a `SKILL.md` stays a
 * description of when to use it rather than a place where request-shaping logic can drift.
 */
async function main(argv: string[]): Promise<void> {
  await loadPackEnv();
  const [skill, ...rest] = argv;
  const args = parseArgs(rest);
  const config = readConfig();
  const credentials = new CredentialStore(config.credentialsDir);
  const client = new TimelineClient(config, credentials);

  switch (skill) {
    case 'timeline.authenticate':
      return report(
        await authenticate({
          config,
          credentials,
          client,
          openBrowser,
          projectId: args.projectId,
          createProject: args.workflowType
            ? {
                workflowType: required(args, 'workflowType'),
                codename: required(args, 'codename'),
                framework: required(args, 'framework'),
                provider: required(args, 'provider'),
              }
            : undefined,
        }),
      );
    case 'timeline.projects.list':
      return report(await listProjects(client, number(args.page, 0), number(args.size, 20)));
    case 'timeline.projects.permissions':
      return report(await projectPermissions(client, required(args, 'projectId')));
    case 'timeline.projects.create':
      return report(
        await authenticate({
          config,
          credentials,
          client,
          openBrowser,
          createProject: {
            workflowType: required(args, 'workflowType'),
            codename: required(args, 'codename'),
            framework: required(args, 'framework'),
            provider: required(args, 'provider'),
          },
        }),
      );
    case 'timeline.projects.get':
      return report(await getProject(client, required(args, 'projectId')));
    case 'timeline.projects.members':
      return report(await projectMembers(client, required(args, 'projectId')));
    case 'timeline.project.context':
      return report(await projectContext(client, required(args, 'projectId')));
    case 'timeline.events.list':
      return report(
        await listEvents(client, required(args, 'projectId'), {
          group: args.group,
          tags: list(args.tags),
          typeDetail: list(args.typeDetail),
        }),
      );
    case 'timeline.events.get':
      return report(
        await getEvent(client, required(args, 'projectId'), required(args, 'entryId')),
      );
    case 'timeline.events.create':
    {
      // --recheck reads the status of an earlier, unresolved write; it never writes again.
      if (args.recheck !== undefined && args.event !== undefined) {
        throw new Error('--recheck cannot be combined with --event: a re-check writes nothing.');
      }
      if (args.recheck === 'true') throw new Error('--recheck needs the ingestId of the earlier write.');
      const result = args.recheck
        ? await recheckEvent({
            client,
            projectId: required(args, 'projectId'),
            ingestId: required(args, 'recheck'),
          })
        : await createEvent({
            client,
            projectId: required(args, 'projectId'),
            event: JSON.parse(required(args, 'event')) as Record<string, unknown>,
          });
      report(result);
      // Nothing was written: a distinct non-zero code so it cannot be read as a successful write.
      if (result.outcome === 'needs_parent_decision') process.exitCode = 2;
      return;
    }
    default:
      throw new Error(
        `Unknown skill '${skill ?? ''}'. This pack ships: timeline.authenticate, `
          + 'timeline.projects.{create,get,list,permissions,members}, '
          + 'timeline.events.{create,get,list}, timeline.project.context.',
      );
  }
}

/**
 * The pack's own .env, wherever the caller is standing. dotenv is also the pack's only dependency,
 * so failing to import it means the one-time setup has not run - say that, not ERR_MODULE_NOT_FOUND.
 */
async function loadPackEnv(): Promise<void> {
  let dotenv: typeof import('dotenv');
  try {
    dotenv = await import('dotenv');
  } catch {
    throw new Error(
      `One-time setup has not been done: run \`npm ci\` in ${PACK_ROOT} and try again.`,
    );
  }
  dotenv.config({ path: path.join(PACK_ROOT, '.env'), quiet: true });
}

function report(result: unknown): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArgs(argv: string[]): Record<string, string | undefined> {
  const args: Record<string, string | undefined> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token?.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[index + 1];
      args[key] = next && !next.startsWith('--') ? next : 'true';
      if (args[key] !== 'true') {
        index += 1;
      }
    }
  }
  return args;
}

function required(args: Record<string, string | undefined>, key: string): string {
  const value = args[key];
  if (!value) {
    throw new Error(`--${key} is required.`);
  }
  return value;
}

function number(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value: string | undefined): string[] | undefined {
  return value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : undefined;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  // Every failure the agent has to act on differently gets its own message, and none of them ever
  // carries a credential value.
  if (
    error instanceof ProjectKeyRequiredError
    || error instanceof AuthorizationRequiredError
    || error instanceof RefusedError
    || error instanceof NotFoundError
    || error instanceof InvalidRequestError
    || error instanceof BackendUnavailableError
    || error instanceof DeclinedError
    || error instanceof DeliveryRefusedError
    || error instanceof TimedOutError
  ) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
