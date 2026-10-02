---
name: timeline.events.create
description: Write an event to a project's timeline and confirm it actually reached the ledger. Use to record work as it happens.
---
<!-- SPDX-FileCopyrightText: 2026 CITADELO s.r.o. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# timeline.events.create

**Credential:** that project's key.

> **Where to run this:** anywhere. Run the command below exactly as written, replacing `<base directory>` with
> this skill's base directory (shown as "Base directory for this skill" when the skill loads). `run.mjs`
> finds the pack itself, whatever the base directory is, so there is nothing to locate or count. The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.


```
node "<base directory>/run.mjs" timeline.events.create --projectId TLPT-2026-001 --event '{"name":"Scoping complete","group":"governance","type":"milestone","parents":["EVT-004"]}'
```

## Required fields

The event is a JSON object. The backend rejects it (`400`) unless it has:

- `name` - non-blank.
- `group` - non-blank (for example `governance`, `evidence`).
- `type` **or** `entryId` - at least one of the two. `type` is a string (the event type name, for
  example `milestone`); `entryId` is the id the event should be stored under.

Plus `parents` (below), which this skill needs decided before it writes.

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
node "<base directory>/run.mjs" timeline.events.create --projectId TLPT-2026-001 --event '{"name":"Review done","group":"governance","type":"milestone","parents":["EVT-004"]}'

# deliberately no parent
node "<base directory>/run.mjs" timeline.events.create --projectId TLPT-2026-001 --event '{"name":"Review done","group":"governance","type":"milestone","parents":[]}'
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
  ingest record rather than guessing either way (below).

## Re-check an unresolved write

An unresolved result carries an `ingestId`. Look it up again - this never writes a second time:

```
node "<base directory>/run.mjs" timeline.events.create --projectId TLPT-2026-001 --recheck <ingestId>
```

It reports processed, failed or still unresolved exactly as a fresh write does. An id the backend does
not know (404) or rejects (400) is reported as outcome `not_found` ("No such ingest record"): check the
id, it is not a pending write. `--recheck` cannot be combined with `--event`. `timeline.events.get`
takes an entry id, not an ingest id, so it cannot be used for this.

## When there is no usable key

The skill stops before writing anything and says a confirmed key is needed. It never obtains one, and
it does not retry a mid-write refusal with a key nobody confirmed.
