---
name: timeline.events.create
description: Write an event to a project's timeline and confirm it actually reached the ledger. Use to record work as it happens.
---

# timeline.events.create

**Credential:** that project's key.

> **Where to run this:** anywhere. Replace `$PACK` with this pack's root — two levels above this
> skill's base directory (shown as "Base directory for this skill" when the skill loads). The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "$PACK/scripts/run-skill.mjs" timeline.events.create --projectId TLPT-2026-001 --event '{"name":"Scoping complete","group":"governance","type":"milestone"}'
```

The ingest API answers `202` — *accepted for processing* — and the real outcome appears afterwards.
This skill waits for it.

## What it reports

- **processed** — the event reached the ledger, under the entry id given.
- **failed** — it was accepted and then rejected downstream, with the recorded error. **This is not
  success.** Never report the `202` as if the timeline were updated.
- **unresolved** — it had not settled within the waiting budget. It may still land. Re-check the
  ingest record rather than guessing either way.

## When there is no usable key

The skill stops before writing anything and says a confirmed key is needed. It never obtains one, and
it does not retry a mid-write refusal with a key nobody confirmed.
