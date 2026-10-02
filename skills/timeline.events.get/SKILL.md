---
name: timeline.events.get
description: Read one event of a project by its entry id. Use when a specific entry is known and its detail is needed.
---
<!-- SPDX-FileCopyrightText: 2026 CITADELO s.r.o. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# timeline.events.get

**Credential:** that project's key.

> **Where to run this:** anywhere. Run the command below exactly as written, replacing `<base directory>` with
> this skill's base directory (shown as "Base directory for this skill" when the skill loads). `run.mjs`
> finds the pack itself, whatever the base directory is, so there is nothing to locate or count. The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "<base directory>/run.mjs" timeline.events.get --projectId TLPT-2026-001 --entryId EVT-005
```

Returns the event with that entry id within the project the held key is bound to, or `404` when the
project has no such entry.

## When there is no usable key

The skill stops and says a confirmed key is needed. Run `timeline.authenticate --projectId <id>`. A key reaches exactly one project, so each project needs its own.
