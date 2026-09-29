---
name: timeline.projects.members
description: List the active actors of one project with their permissions. Use to see who may write before attempting a write, or to report who is involved.
---

# timeline.projects.members

**Credential:** that project's key.

> **Where to run this:** anywhere. Replace `$PACK` with this pack's root — two levels above this
> skill's base directory (shown as "Base directory for this skill" when the skill loads). The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "$PACK/scripts/run-skill.mjs" timeline.projects.members --projectId TLPT-2026-001
```

Returns the project's active members: actor id, name, role and permissions.

Inactive actors — people removed from the project — are not included.

## When there is no usable key

The skill stops and says a confirmed key is needed. Run `timeline.authenticate --projectId <id>`.
