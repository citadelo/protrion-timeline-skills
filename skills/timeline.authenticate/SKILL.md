---
name: timeline.authenticate
description: Obtain the credentials the other timeline skills need, by taking the user through the app. Use when another skill reports that authorization or a confirmed project key is needed, or before starting work on a project for the first time.
---

# timeline.authenticate

**Credential:** none to begin with — this is the skill that obtains the rest.

> **Where to run this:** anywhere. Replace `$PACK` with this pack's root — two levels above this
> skill's base directory (shown as "Base directory for this skill" when the skill loads). The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


Every credential this pack holds comes from a human approving it in the app. This skill opens the
right screen in the user's browser and waits for the result on a listener running on this machine.

## Authorize the agent

```
node "$PACK/scripts/run-skill.mjs" timeline.authenticate
```

Opens the authorization screen. Once the user approves, the external tool token is stored. It acts as that
user, and on its own it can do exactly two things: list projects and check permissions. It reaches no
timeline.

If a usable external tool token is already held, this reports who the agent acts as and **opens no browser**.

## Confirm a key for a project

```
node "$PACK/scripts/run-skill.mjs" timeline.authenticate --projectId TLPT-2026-001
```

Opens a screen naming that project and the key's lifetime. Every project key is confirmed this way —
the first one, and every replacement of an expired one. A key expires within two hours.

## What it reports

- **Authorized** — who the agent now acts as.
- **A key was confirmed** — for which project, and when it expires. The key value itself is stored,
  never printed.
- **Declined** — the user refused. Distinct from a timeout, and not something to retry silently.
- **Not completed in time** — nothing was obtained; ask the user whether to try again.
- **Not permitted** — the user has no write access to that project, so no key can exist for it. Check
  `timeline.projects.permissions` before asking again.

## Do not

Do not put a project key in an environment variable to skip this. The pack ignores one that appears
there: it would bypass the confirmation, which is the entire mechanism.
