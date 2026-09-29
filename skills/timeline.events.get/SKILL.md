---
name: timeline.events.get
description: Read one event of a project by its entry id. Use when a specific entry is known and its detail is needed.
---

# timeline.events.get

**Credential:** that project's key.

> **Where to run this:** anywhere. Replace `$PACK` with this pack's root — two levels above this
> skill's base directory (shown as "Base directory for this skill" when the skill loads). The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "$PACK/scripts/run-skill.mjs" timeline.events.get --projectId TLPT-2026-001 --entryId EVT-005
```

Returns the event with that entry id within the project the held key is bound to, or `404` when the
project has no such entry.

## When there is no usable key

The skill stops and says a confirmed key is needed. Run `timeline.authenticate --projectId <id>`.
