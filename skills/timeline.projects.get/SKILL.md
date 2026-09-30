---
name: timeline.projects.get
description: Read the full merged timeline of one project - info, actors, lanes, events, workflow compliance and playbook. Use when the whole picture is needed rather than a slice of it.
---

# timeline.projects.get

**Credential:** that project's key.

> **Where to run this:** anywhere. Run the command below exactly as written, replacing `<base directory>` with
> this skill's base directory (shown as "Base directory for this skill" when the skill loads). `run.mjs`
> finds the pack itself, whatever the base directory is, so there is nothing to locate or count. The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "<base directory>/run.mjs" timeline.projects.get --projectId TLPT-2026-001
```

Returns the same merged view the people working this engagement see in the app, because it is produced
by the same read.

Events include planned steps the workflow expects but that have not happened; those carry
`occurred: false`. Do not report a planned step as something that took place.

## When there is no usable key

The skill stops and says a confirmed key is needed, naming the project. It does not obtain one — run
`timeline.authenticate --projectId <id>` and let the user confirm. A key reaches exactly one project.
