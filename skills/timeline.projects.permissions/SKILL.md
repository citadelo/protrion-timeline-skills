---
name: timeline.projects.permissions
description: Report what the approving user may do on one project, without attempting anything. Use before asking for a key, or before assuming a write will succeed.
---

# timeline.projects.permissions

**Credential:** external tool token.

> **Where to run this:** anywhere. Run the command below exactly as written, replacing `<base directory>` with
> this skill's base directory (shown as "Base directory for this skill" when the skill loads). `run.mjs`
> finds the pack itself, whatever the base directory is, so there is nothing to locate or count. The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "<base directory>/run.mjs" timeline.projects.permissions --projectId TLPT-2026-001
```

Answers the question that listing projects does not: may the user this agent acts for read or write
this particular project.

Without it, the only way to find out is to attempt a write and read the refusal — which means guessing
with side effects.

## What it reports

- **A member, with permissions** — `rwx`, `r`, and so on. `canWrite` says plainly whether writes are
  possible.
- **Read-only** — no key can be confirmed: the project-key screen refuses without write access, so the
  project can be neither read nor written through this pack. Tell the user; do not ask them to confirm
  one.
- **Not a member** — no key for this project can exist. Do not ask the user to confirm one.
- **No such project** — `404`.
