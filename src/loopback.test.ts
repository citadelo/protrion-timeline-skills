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
    await fetch(redirectUri.toString());
  };
}

const options = (openBrowser: (url: string) => void | Promise<void>) => ({
  appUrl: 'http://localhost:4002',
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
});
