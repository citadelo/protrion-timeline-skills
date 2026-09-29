---
name: timeline.events.list
description: List the events of one project, optionally narrowed by group, tags or type details. Use to read what has happened, or to find events matching a dimension.
---

# timeline.events.list

**Credential:** that project's key.

> **Where to run this:** anywhere. Replace `$PACK` with this pack's root — two levels above this
> skill's base directory (shown as "Base directory for this skill" when the skill loads). The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "$PACK/scripts/run-skill.mjs" timeline.events.list --projectId TLPT-2026-001 [--group evidence] [--tags kickoff,scoping] [--typeDetail phase:Threat\ Intelligence]
```

Returns the project's merged events, newest first.

Filters are the dimensions the ledger supports: `group`, `tags` and `typeDetail` (each `key:value`).
There is no full-text search and no other dimension — this skill with filters is the search.

Every event carries `occurred`. A planned step the workflow expects but that has not happened is
`false`; report it as a plan, not as a fact.

## When there is no usable key

The skill stops and says a confirmed key is needed. Run `timeline.authenticate --projectId <id>`.
