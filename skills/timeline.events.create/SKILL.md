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
node "$PACK/scripts/run-skill.mjs" timeline.events.create --projectId TLPT-2026-001 --event '{"name":"Scoping complete","group":"governance","type":"milestone","parents":["EVT-004"]}'
```

## Ask the user what the event follows

The timeline graph draws its edges from each event's `parents`. **If you have not been told what the
event follows, ask the user before writing:** link it to <the suggestion>, to another event, or to
none. Do not choose for them.

Run without a `parents` field, the skill writes nothing. It returns outcome `needs_parent_decision`
with `suggestedParent` (the project's latest event that has occurred - never a planned step - or `null`
when nothing has occurred) and exits with code 2, which is not a successful write. Put the question to
the user, then re-run with their answer:

```
# link to the suggested event, or to another one the user names
node "$PACK/scripts/run-skill.mjs" timeline.events.create --projectId TLPT-2026-001 --event '{"name":"Review done","parents":["EVT-004"]}'

# deliberately no parent
node "$PACK/scripts/run-skill.mjs" timeline.events.create --projectId TLPT-2026-001 --event '{"name":"Review done","parents":[]}'
```

If the user has already said what it follows, include `parents` at once. Explicit parents are sent
exactly as given; `"parents":[]` sends the event without any. A written event's result carries a
`parents` field.

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
