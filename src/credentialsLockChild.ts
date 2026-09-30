/**
 * Fixture for the cross-process locking test in credentials.test.ts - not a test itself.
 *
 * Run as its own process (via `tsx`, spawned from the test), so it exercises a real second
 * `CredentialStore` instance in a real second OS process against the same directory - exactly what
 * two skill invocations running close together look like, which nothing in-process can simulate.
 */
import { CredentialStore } from './credentials';

const [, , credentialsDir, projectId] = process.argv;
if (!credentialsDir || !projectId) {
  throw new Error('usage: tsx credentialsLockChild.ts <credentialsDir> <projectId>');
}

const store = new CredentialStore(credentialsDir);
await store.writeProjectKey({
  projectId,
  key: `key-for-${projectId}`,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});
