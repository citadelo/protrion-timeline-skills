---
name: timeline.project.context
description: One orienting read of a project - what it is, who acts on it, where it stands, what happened recently. Use at the start of work on a project instead of several separate lookups.
---

# timeline.project.context

**Credential:** that project's key.

> **Where to run this:** anywhere. Replace `$PACK` with this pack's root — two levels above this
> skill's base directory (shown as "Base directory for this skill" when the skill loads). The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "$PACK/scripts/run-skill.mjs" timeline.project.context --projectId TLPT-2026-001
```

Returns the project's identity and workflow type, its active members, its current phase, and its most
recent events — in one read.

Planned steps are kept in a **separate list** from what happened, deliberately. An agent summarising a
project must not fold the two together and report a plan as a fact.

## When there is no usable key

The skill stops and says a confirmed key is needed. Run `timeline.authenticate --projectId <id>`. A key reaches exactly one project, so each project needs its own.
