import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { DeclinedError, DeliveryRefusedError, TimedOutError } from './errors';
import type { DeliveryRefusalReason } from './errors';

const REFUSAL_REASONS: readonly DeliveryRefusalReason[] = [
  'not_permitted',
  'unsupported_workflow_type',
  'invalid_request',
  'server_error',
];

function isDeliveryRefusalReason(value: string): value is DeliveryRefusalReason {
  return (REFUSAL_REASONS as readonly string[]).includes(value);
}

export interface Delivery {
  params: URLSearchParams;
  state: string;
}

/**
 * A one-shot listener on this machine, and the page the user is sent to.
 *
 * The credential comes back through the browser, so the listener has to be here, on loopback, and
 * has to close the moment it has its answer. The opaque `state` goes out with the request and comes
 * back with the delivery, so a response that belongs to some other request is discarded rather than
 * acted on.
 */
export async function awaitBrowserDelivery(options: {
  appUrl: string;
  screenPath: string;
  query: Record<string, string>;
  what: string;
  timeoutSeconds: number;
  openBrowser: (url: string) => void | Promise<void>;
}): Promise<Delivery> {
  const state = crypto.randomUUID();
  const server = createServer();

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const delivered = new Promise<URLSearchParams>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new TimedOutError(options.what, options.timeoutSeconds));
    }, options.timeoutSeconds * 1000);

    server.on('request', (request, response) => {
      const params = new URL(request.url ?? '/', redirectUri).searchParams;
      if (params.get('state') !== state) {
        // Not ours. Say nothing useful and keep waiting for the delivery we actually started.
        response.writeHead(400).end('Unexpected request.');
        return;
      }
      response
        .writeHead(200, { 'Content-Type': 'text/plain' })
        .end('Done. You can close this tab and return to your agent.');
      clearTimeout(timer);
      server.close();
      resolve(params);
    });
  });

  const url = new URL(options.screenPath, `${options.appUrl}/`);
  Object.entries(options.query).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  await options.openBrowser(url.toString());

  const params = await delivered;
  const error = params.get('error');
  if (error === 'access_denied') {
    throw new DeclinedError(options.what);
  }
  if (error && isDeliveryRefusalReason(error)) {
    throw new DeliveryRefusedError(options.what, error);
  }
  if (error) {
    throw new Error(`${options.what} was refused: ${error}.`);
  }
  return { params, state };
}
