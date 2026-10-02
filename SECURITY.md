# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities by email to **security@citadelo.com**.

Do not open a public GitHub issue, pull request, or discussion for a vulnerability.

Include as much of the following as you can:

- the affected skill, file, or component, and the version or commit;
- a description of the issue and its impact;
- steps to reproduce, or a proof of concept;
- any known mitigations.

We will acknowledge your report, keep you informed while we investigate, and coordinate the
disclosure timeline with you. Please give us a reasonable chance to release a fix before disclosing
anything publicly. We are glad to credit reporters who want to be named.

## Supported versions

Only the latest commit on the default branch is supported. Fixes are not backported.

## Scope

This pack lets an AI agent act on a Protrion Timeline project, but only with credentials that a
human approved or confirmed in the Timeline app. The following are especially in scope:

- **Credential leakage** - the external tool token or a project key reaching output, logs, error
  messages, or stack traces, or `.credentials/` being written with permissions wider than owner-only.
- **Bypassing human approval** - any way to obtain or use a credential without the approval or
  confirmation screen in the app, for example through environment variables or configuration.
- **The loopback callback** - the local `127.0.0.1` listener that receives credentials from the app,
  including missing or forgeable `state`, acceptance of non-loopback redirects, or a credential
  delivered to the wrong listener.
- **Transport** - talking to a remote backend over plain `http://`.

Vulnerabilities in the Timeline backend or app themselves should be reported to the same address.
