---
name: timeline.events.list
description: List the events of one project, optionally narrowed by group, tags or type details. Use to read what has happened, or to find events matching a dimension.
---
<!-- SPDX-FileCopyrightText: 2026 CITADELO s.r.o. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# timeline.events.list

**Credential:** that project's key.

> **Where to run this:** anywhere. Run the command below exactly as written, replacing `<base directory>` with
> this skill's base directory (shown as "Base directory for this skill" when the skill loads). `run.mjs`
> finds the pack itself, whatever the base directory is, so there is nothing to locate or count. The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "<base directory>/run.mjs" timeline.events.list --projectId TLPT-2026-001 [--group evidence] [--tags kickoff,scoping] [--typeDetail phase:Threat\ Intelligence]
```

Returns the project's merged events as the backend orders them: the workflow's steps in workflow
order, then events outside the workflow. This is not sorted by time; use each event's `timestamp` if
recency matters.

Filters are the dimensions the ledger supports: `group`, `tags` and `typeDetail` (each `key:value`).
There is no full-text search and no other dimension — this skill with filters is the search.

Every event carries `occurred`. A planned step the workflow expects but that has not happened is
`false`; report it as a plan, not as a fact.

## When there is no usable key

The skill stops and says a confirmed key is needed. Run `timeline.authenticate --projectId <id>`. A key reaches exactly one project, so each project needs its own.
