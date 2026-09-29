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

/**
 * Where the browser is sent once a delivery is accepted: `<app>/agent/done` with `outcome`, and only
 * where they apply `reason` (a known delivery code) and `project_id`. Nothing else is copied from the
 * delivery, so no token, key, expiry, name or state can leak into the URL. The outcome comes from
 * what was delivered, not from which screen was opened.
 */
export function doneLocation(
  appUrl: string,
  delivered: URLSearchParams,
  requestedProjectId: string | undefined,
): string {
  const done = new URL('agent/done', `${appUrl.replace(/\/+$/, '')}/`);
  const error = delivered.get('error');
  if (error === 'access_denied') {
    done.searchParams.set('outcome', 'declined');
  } else if (error) {
    done.searchParams.set('outcome', 'refused');
    if (isDeliveryRefusalReason(error)) {
      done.searchParams.set('reason', error);
    }
    if (requestedProjectId) {
      done.searchParams.set('project_id', requestedProjectId);
    }
  } else if (delivered.has('ingest_api_key')) {
    done.searchParams.set('outcome', 'key_confirmed');
    const projectId = delivered.get('project_id');
    if (projectId) {
      done.searchParams.set('project_id', projectId);
    }
  } else if (delivered.has('external_tool_token')) {
    done.searchParams.set('outcome', 'authorized');
  }
  return done.toString();
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
      // Back into the app, so the user ends on a screen rather than bare text. The request URL holds
      // the credential; the redirect carries only the outcome, and the headers keep the loopback URL
      // out of caches and out of any Referer.
      response
        .writeHead(303, {
          Location: doneLocation(options.appUrl, params, options.query.projectId),
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        })
        .end();
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
