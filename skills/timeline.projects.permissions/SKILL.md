---
name: timeline.projects.permissions
description: Report what the approving user may do on one project, without attempting anything. Use before asking for a key, or before assuming a write will succeed.
---

# timeline.projects.permissions

**Credential:** external tool token.

> **Where to run this:** anywhere. Replace `$PACK` with this pack's root — two levels above this
> skill's base directory (shown as "Base directory for this skill" when the skill loads). The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "$PACK/scripts/run-skill.mjs" timeline.projects.permissions --projectId TLPT-2026-001
```

Answers the question that listing projects does not: may the user this agent acts for read or write
this particular project.

Without it, the only way to find out is to attempt a write and read the refusal — which means guessing
with side effects.

## What it reports

- **A member, with permissions** — `rwx`, `r`, and so on. `canWrite` says plainly whether writes are
  possible.
- **Read-only** — a key can be confirmed, but writes will fail. Worth telling the user before they
  confirm one.
- **Not a member** — no key for this project can exist. Do not ask the user to confirm one.
- **No such project** — `404`.
