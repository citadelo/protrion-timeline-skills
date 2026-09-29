import { TimelineClient } from '../client';
import type { TimelineConfig } from '../config';
import { CredentialStore } from '../credentials';
import { AuthorizationRequiredError } from '../errors';
import { awaitBrowserDelivery } from '../loopback';

export interface AuthenticateResult {
  /** What the agent can now do, in a sentence the calling agent can relay. */
  summary: string;
  actingAs?: string;
  projectId?: string;
  /** Present when a key was obtained; the value itself never leaves the store. */
  keyExpiresAt?: string;
}

export interface AuthenticateOptions {
  config: TimelineConfig;
  credentials: CredentialStore;
  client: TimelineClient;
  openBrowser: (url: string) => void | Promise<void>;
  timeoutSeconds?: number;
  /** Ask for a key to this project, confirming it in the app. */
  projectId?: string;
  /** Create this project and hold its key. */
  createProject?: {
    workflowType: string;
    codename: string;
    framework: string;
    provider: string;
  };
}

/**
 * Obtains what the rest of the pack needs, by taking a human through the app.
 *
 * This is the only skill that can produce a credential, because the app is the only place one is
 * issued. It does two related jobs — authorize the agent, and confirm a key for one project — which
 * is a deliberate exception to one-operation-per-skill: both are "get me a credential", and an agent
 * that has to reason about which of two skills to call has one more way to get it wrong.
 */
export async function authenticate(options: AuthenticateOptions): Promise<AuthenticateResult> {
  const timeoutSeconds = options.timeoutSeconds ?? 300;
  let existing = await options.credentials.readExternalToolToken();
  let reauthorized = false;

  // A stored token the backend no longer accepts - revoked in the app, most often - must not leave
  // the pack telling the user to run this command while this command keeps taking the branch that
  // never opens a browser. Forget it and authorize again.
  if (existing) {
    try {
      await options.client.listProjects(0, 1);
    } catch (error) {
      if (!(error instanceof AuthorizationRequiredError)) {
        throw error;
      }
      await options.credentials.clearExternalToolToken();
      existing = undefined;
      reauthorized = true;
    }
  }

  let actingAs: string | undefined;
  if (!existing) {
    const delivery = await awaitBrowserDelivery({
      appUrl: options.config.appUrl,
      screenPath: 'agent/authorize',
      query: {},
      what: 'Authorizing this agent',
      timeoutSeconds,
      openBrowser: options.openBrowser,
    });
    const token = delivery.params.get('external_tool_token');
    const tokenId = delivery.params.get('token_id');
    if (!token || !tokenId) {
      throw new AuthorizationRequiredError('missing');
    }
    await options.credentials.writeExternalToolToken({
      token,
      tokenId,
      // Who approved this, as the screen reported it. A skill that answered "as whom do I act" with
      // a placeholder would be a small lie repeated on every run.
      actingAs: delivery.params.get('acting_as') ?? undefined,
      expiresAt: null,
    });
  }

  // A freshly issued token is exercised too, so a delivery that produced something unusable fails
  // here rather than at the next skill. An already-valid one was exercised above.
  if (!existing) {
    await options.client.listProjects(0, 1);
  }
  actingAs = (await options.credentials.readExternalToolToken())?.actingAs;

  if (!options.projectId && !options.createProject) {
    return {
      summary: existing
        ? 'Already authorized. No browser was opened and no second token was issued.'
        : reauthorized
          ? 'The previous authorization had been revoked, so it was discarded and you authorized '
            + 'this agent again.'
          : 'Authorized. The agent can list projects and check permissions; acting on a project '
            + 'needs a key you confirm separately.',
      actingAs,
    };
  }

  const what = options.createProject
    ? `Creating ${options.createProject.codename} and confirming its key`
    : `Confirming a key for ${options.projectId}`;
  const delivery = await awaitBrowserDelivery({
    appUrl: options.config.appUrl,
    screenPath: 'agent/project-key',
    query: options.createProject
      ? { ...options.createProject }
      : { projectId: options.projectId as string },
    what,
    timeoutSeconds,
    openBrowser: options.openBrowser,
  });

  const projectId = delivery.params.get('project_id');
  const key = delivery.params.get('ingest_api_key');
  const expiresAt = delivery.params.get('expires_at');
  if (!projectId || !key || !expiresAt) {
    throw new Error(`${what} did not complete: no key was delivered.`);
  }
  await options.credentials.writeProjectKey({ projectId, key, expiresAt });

  return {
    summary:
      `A key for ${projectId} was confirmed and stored. It expires at ${expiresAt}; after that the `
      + 'agent will ask you to confirm another rather than carrying on.',
    actingAs,
    projectId,
    keyExpiresAt: expiresAt,
  };
}
