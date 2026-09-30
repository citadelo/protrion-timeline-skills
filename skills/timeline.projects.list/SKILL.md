---
name: timeline.projects.list
description: List every project the timeline ledger holds. Use to discover which projects exist. Appearing in the list is not a claim that the agent may read or write one.
---

# timeline.projects.list

**Credential:** external tool token.

> **Where to run this:** anywhere. Replace `$PACK` with this pack's root — two levels above this
> skill's base directory (shown as "Base directory for this skill" when the skill loads). The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "$PACK/scripts/run-skill.mjs" timeline.projects.list [--page 0] [--size 20]
```

Returns every project the ledger holds, paged. Membership is deliberately not consulted, so this
answers *what exists*, not *what you may touch*.

The result carries that caveat as a field rather than leaving it to documentation — an agent reading a
list of projects will otherwise assume it can act on them.

## What to do with it

Pick a project, then ask `timeline.projects.permissions` whether acting on it is even possible. Reading
or writing it needs a key, which `timeline.authenticate` takes the user through confirming.
