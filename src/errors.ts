/**
 * The failures a skill has to be able to tell apart, because the agent's next move differs for each.
 *
 * None of them ever carries a credential value — not in a message, not in an echoed header.
 */

/** A confirmed key for this project is needed and the pack does not hold a usable one. */
export class ProjectKeyRequiredError extends Error {
  constructor(
    readonly projectId: string,
    readonly reason: 'missing' | 'expired',
  ) {
    const command = `timeline.authenticate --projectId ${projectId}`;
    super(
      reason === 'expired'
        ? `The key for ${projectId} has expired. Project keys are short-lived and every one is `
          + `confirmed by a person: run \`${command}\` to be taken through confirming a fresh one. `
          + 'A key reaches exactly one project.'
        : `No confirmed key is held for ${projectId}. Run \`${command}\` to be taken through `
          + 'confirming one. A key reaches exactly one project.',
    );
    this.name = 'ProjectKeyRequiredError';
  }
}

/** The external tool token is missing or no longer valid, so nothing can even be requested. */
export class AuthorizationRequiredError extends Error {
  constructor(reason: 'missing' | 'rejected') {
    super(
      reason === 'rejected'
        ? 'The external tool token was refused. Run timeline.authenticate to be authorized again.'
        : 'No external tool token is configured. Run timeline.authenticate first.',
    );
    this.name = 'AuthorizationRequiredError';
  }
}

/** The backend refused the request. Which credential was refused, and what it was attempting. */
export class RefusedError extends Error {
  constructor(
    readonly status: number,
    readonly credential: 'external tool token' | 'project key',
    readonly attempting: string,
    detail?: string,
  ) {
    super(
      `The ${credential} was refused (${status}) while ${attempting}.`
        + (detail ? ` ${detail}` : ''),
    );
    this.name = 'RefusedError';
  }
}

/** The project, or the thing asked for in it, does not exist (404). The credential was accepted. */
export class NotFoundError extends Error {
  constructor(readonly attempting: string, detail?: string) {
    super(`Nothing was found while ${attempting} (404).` + (detail ? ` ${detail}` : ''));
    this.name = 'NotFoundError';
  }
}

/** The backend rejected the request itself (400/422). The credential was fine; the request was not. */
export class InvalidRequestError extends Error {
  constructor(readonly status: number, readonly attempting: string, detail?: string) {
    super(
      `The request was invalid (${status}) while ${attempting}.` + (detail ? ` ${detail}` : ''),
    );
    this.name = 'InvalidRequestError';
  }
}

/** The backend could not be reached, or failed. Distinct from "nothing found". */
export class BackendUnavailableError extends Error {
  constructor(readonly attempting: string, cause?: unknown) {
    super(`The timeline backend could not be reached while ${attempting}.`, { cause });
    this.name = 'BackendUnavailableError';
  }
}

/** The user declined on the confirmation screen, as opposed to never finishing it. */
export class DeclinedError extends Error {
  constructor(what: string) {
    super(`${what} was declined.`);
    this.name = 'DeclinedError';
  }
}

/**
 * The screen determined a refusal on its own and delivered it automatically (design.md Browser
 * flows), rather than the user declining. Each code names something distinct enough for the agent
 * to act on differently: a permission problem is not a bad request, and neither is a backend
 * outage.
 */
export type DeliveryRefusalReason =
  | 'not_permitted'
  | 'unsupported_workflow_type'
  | 'invalid_request'
  | 'server_error';

export class DeliveryRefusedError extends Error {
  constructor(
    what: string,
    readonly reason: DeliveryRefusalReason,
  ) {
    super(`${what} was refused: ${DeliveryRefusedError.describe(reason)}`);
    this.name = 'DeliveryRefusedError';
  }

  private static describe(reason: DeliveryRefusalReason): string {
    switch (reason) {
      case 'not_permitted':
        return 'you do not have write access to that project.';
      case 'unsupported_workflow_type':
        return 'the workflow type is not one of TLPT-TI or TLPT-RT.';
      case 'invalid_request':
        return 'the request was invalid - check that every required field was supplied.';
      case 'server_error':
        return 'the backend failed or could not be reached. Try again.';
    }
  }
}

/** The confirmation screen was not completed within the waiting budget. */
export class TimedOutError extends Error {
  constructor(what: string, seconds: number) {
    super(`${what} was not completed within ${seconds}s. Nothing was obtained.`);
    this.name = 'TimedOutError';
  }
}
