// SPDX-FileCopyrightText: 2026 CITADELO s.r.o.
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The pack's own root, resolved from this file's location — never from the process working
 * directory. Skills run while the agent stands in some other project, and the pack's state has to
 * stay with the pack: one authorization serves every project on the machine, and a credential must
 * never be written into whatever repository the caller happened to be in.
 */
export const PACK_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Where the app and the backend live for this environment. */
export interface TimelineConfig {
  /** The app a human is sent to when a credential has to be approved or confirmed. */
  appUrl: string;
  /** The backend the pack reads and writes through. */
  apiUrl: string;
  /** Where credentials are kept. Untracked; written by `timeline.authenticate`. */
  credentialsDir: string;
}

const DEFAULTS = {
  appUrl: 'http://localhost:4002',
  apiUrl: 'http://localhost:8080',
} as const;

export function readConfig(env: NodeJS.ProcessEnv = process.env): TimelineConfig {
  const apiUrl = trimTrailingSlash(env.TIMELINE_API_URL ?? DEFAULTS.apiUrl);
  assertSafeApiUrl(apiUrl);
  return {
    appUrl: trimTrailingSlash(env.TIMELINE_APP_URL ?? DEFAULTS.appUrl),
    apiUrl,
    // The override exists for tests; the default is the pack's own store, wherever the caller is.
    credentialsDir: env.TIMELINE_CREDENTIALS_DIR ?? path.join(PACK_ROOT, '.credentials'),
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Refuses a plain `http://` backend unless it is this machine: every credential the pack holds -
 * the external tool token, every project key - would otherwise cross the network in the clear on
 * every request. `https://` is unrestricted; the backend's own TLS posture is not this pack's
 * business. Loopback includes `localhost`, not only its literal addresses - it is the pack's own
 * documented default for local development, unlike the browser redirect target the frontend holds
 * to the stricter RFC 8252 definition.
 */
function assertSafeApiUrl(apiUrl: string): void {
  const { protocol, hostname } = new URL(apiUrl);
  if (protocol === 'http:' && !isLoopbackHost(hostname)) {
    throw new Error(
      `TIMELINE_API_URL (${apiUrl}) uses plain http:// against a non-loopback host. That would `
      + 'send every credential this pack holds across the network in the clear. Use https://, or '
      + 'point it at a loopback address (localhost, 127.0.0.1, ::1) for local development.',
    );
  }
}

function isLoopbackHost(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return bare === 'localhost' || bare === '::1' || /^127(\.\d{1,3}){3}$/.test(bare);
}
