---
name: timeline.projects.create
description: Create a new timeline project and obtain its key, with the user confirming both in the app. Use when work needs a project that does not exist yet.
---

# timeline.projects.create

**Credential:** external tool token, plus the user's confirmation on screen.

> **Where to run this:** anywhere. Run the command below exactly as written, replacing `<base directory>` with
> this skill's base directory (shown as "Base directory for this skill" when the skill loads). `run.mjs`
> finds the pack itself, whatever the base directory is, so there is nothing to locate or count. The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "<base directory>/run.mjs" timeline.projects.create --workflowType TLPT-TI --codename "NORTH STAR" --framework TIBER-EU --provider Protrion
```

Opens a screen naming the project about to be created and the lifetime of the key that comes with it.
The user confirms; the project is created and its key stored.

`workflowType` must be `TLPT-TI` or `TLPT-RT`. Anything else is refused on the screen, before a project
is created.

## What it reports

- **Created** — the project id, and when its key expires.
- **Declined** — the user refused; no project was created.
- **Not completed in time** — nothing was created.

The key value is stored, never printed.
