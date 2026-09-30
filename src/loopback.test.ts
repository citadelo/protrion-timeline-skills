import { describe, expect, it } from 'vitest';
import { DeclinedError, DeliveryRefusedError, TimedOutError } from './errors';
import { awaitBrowserDelivery } from './loopback';

/**
 * The browser step is stood in for by a fetch to whatever URL the screen would have redirected
 * to - exactly what the app's screen does on approval, decline or an automatic refusal
 * (design.md Browser flows).
 */
function browserThatDelivers(params: Record<string, string>) {
  return async (url: string) => {
    const opened = new URL(url);
    const redirectUri = new URL(opened.searchParams.get('redirect_uri') as string);
    redirectUri.searchParams.set('state', opened.searchParams.get('state') as string);
    Object.entries(params).forEach(([key, value]) => redirectUri.searchParams.set(key, value));
    await fetch(redirectUri.toString(), { redirect: 'manual' });
  };
}

/** Like browserThatDelivers, but keeps the listener's answer without following the redirect. */
function browserThatCapturesAnswer(params: Record<string, string>, answers: Response[]) {
  return async (url: string) => {
    const opened = new URL(url);
    const redirectUri = new URL(opened.searchParams.get('redirect_uri') as string);
    redirectUri.searchParams.set('state', opened.searchParams.get('state') as string);
    Object.entries(params).forEach(([key, value]) => redirectUri.searchParams.set(key, value));
    answers.push(await fetch(redirectUri.toString(), { redirect: 'manual' }));
  };
}

// Deliberately a closed port: the listener redirects here, and no test may depend on it being reachable.
const APP_URL = 'http://127.0.0.1:9';

const options = (openBrowser: (url: string) => void | Promise<void>) => ({
  appUrl: APP_URL,
  screenPath: 'agent/authorize',
  query: {},
  what: 'Authorizing this agent',
  timeoutSeconds: 1,
  openBrowser,
});

describe('awaitBrowserDelivery', () => {
  it('reports a decline distinguishably from every other refusal', async () => {
    await expect(
      awaitBrowserDelivery(options(browserThatDelivers({ error: 'access_denied' }))),
    ).rejects.toBeInstanceOf(DeclinedError);
  });

  it('reports a confirmation nobody finished as a timeout', async () => {
    await expect(awaitBrowserDelivery(options(() => {}))).rejects.toBeInstanceOf(TimedOutError);
  });

  it.each([
    ['not_permitted', 'write access'],
    ['unsupported_workflow_type', 'workflow type'],
    ['invalid_request', 'invalid'],
    ['server_error', 'backend failed'],
  ] as const)('maps %s to a distinct, actionable message', async (code, expectedText) => {
    const error = await awaitBrowserDelivery(options(browserThatDelivers({ error: code }))).then(
      () => expect.fail('expected a refusal'),
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(DeliveryRefusedError);
    expect((error as DeliveryRefusedError).reason).toBe(code);
    expect((error as Error).message).toContain(expectedText);
  });

  it('gives each refusal code its own message, not one generic one', async () => {
    const messages = await Promise.all(
      (['not_permitted', 'unsupported_workflow_type', 'invalid_request', 'server_error'] as const).map(
        (code) =>
          awaitBrowserDelivery(options(browserThatDelivers({ error: code }))).then(
            () => expect.fail('expected a refusal'),
            (caught: Error) => caught.message,
          ),
      ),
    );

    expect(new Set(messages).size).toBe(messages.length);
  });

  describe('the answer to the browser', () => {
    const SECRETS = ['tok-secret-1', 'tid-secret-2', 'key-secret-3', '2030-01-01T00:00:00Z', 'Ada Lovelace'];

    it.each([
      [
        'authorized',
        { external_tool_token: 'tok-secret-1', token_id: 'tid-secret-2', acting_as: 'Ada Lovelace' },
        'outcome=authorized',
        {},
      ],
      [
        'key_confirmed',
        { project_id: 'p-42', ingest_api_key: 'key-secret-3', expires_at: '2030-01-01T00:00:00Z' },
        'outcome=key_confirmed&project_id=p-42',
        {},
      ],
      ['declined', { error: 'access_denied' }, 'outcome=declined', {}],
      ['refused (known code)', { error: 'not_permitted' }, 'outcome=refused&reason=not_permitted', {}],
      [
        'refused (known code, project named)',
        { error: 'server_error' },
        'outcome=refused&reason=server_error&project_id=p-7',
        { projectId: 'p-7' },
      ],
      ['refused (unknown code omits reason)', { error: 'weird<script>' }, 'outcome=refused', {}],
    ] as const)('redirects %s', async (_name, delivered, expectedQuery, query) => {
      const answers: Response[] = [];
      await awaitBrowserDelivery({
        ...options(browserThatCapturesAnswer({ ...delivered }, answers)),
        query: { ...query },
      }).catch(() => undefined);

      expect(answers).toHaveLength(1);
      const answer = answers[0] as Response;
      expect(answer.status).toBe(303);
      const location = new URL(answer.headers.get('location') as string);
      expect(location.origin + location.pathname).toBe(`${APP_URL}/agent/done`);
      expect(location.search).toBe(`?${expectedQuery}`);
      expect(answer.headers.get('cache-control')).toBe('no-store');
      expect(answer.headers.get('referrer-policy')).toBe('no-referrer');
      const raw = answer.headers.get('location') as string;
      SECRETS.forEach((secret) => expect(raw).not.toContain(secret));
      expect(raw).not.toMatch(/state=|external_tool_token|token_id|ingest_api_key|expires_at|acting_as/);
    });

    it('still answers a non-matching state with 400 and keeps waiting', async () => {
      let status = 0;
      const outcome = awaitBrowserDelivery(
        options(async (url) => {
          const redirectUri = new URL(new URL(url).searchParams.get('redirect_uri') as string);
          redirectUri.searchParams.set('state', 'not-ours');
          const wrong = await fetch(redirectUri.toString(), { redirect: 'manual' });
          status = wrong.status;
        }),
      );
      await expect(outcome).rejects.toBeInstanceOf(TimedOutError);
      expect(status).toBe(400);
    });
  });
});
