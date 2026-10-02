---
name: timeline.projects.verify
description: Verify the ledger chain of one project - that its events are unchanged and their parent links present and intact. Use when the user asks whether a project's timeline can be trusted or has been tampered with.
---
<!-- SPDX-FileCopyrightText: 2026 CITADELO s.r.o. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# timeline.projects.verify

**Credential:** that project's key. It acts on that one project only.

> **Where to run this:** anywhere. Run the command below exactly as written, replacing `<base directory>` with
> this skill's base directory (shown as "Base directory for this skill" when the skill loads). `run.mjs`
> finds the pack itself, whatever the base directory is, so there is nothing to locate or count. The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.

```
node "<base directory>/run.mjs" timeline.projects.verify --projectId TLPT-2026-001 [--level LINKS] [--eventScope INTEGRITY] [--includeIndexConsistency true]
```

Verifies the project's whole chain against the ledger and reports the verdict. Nothing is written or
stored.

## Choosing the level

**Pass exactly the level the user asked for.** If the user asked for nothing in particular, pass none of
`--level`, `--eventScope` or `--includeIndexConsistency`: the backend defaults then apply, which are
chain `LINKS` and event `INTEGRITY`, because signing on the ledger is not finished yet and timestamp
and certificate checks cannot pass reliably. The result always names the `level` and `eventScope` actually used.

`--level` - how much of the chain is checked:

| Value | Checks |
|---|---|
| `EVENTS` | Each event on its own (per `eventScope`); parent links are not examined. |
| `LINKS` | `EVENTS`, plus every parent link: parents exist, are intact, the graph has no cycle, parent order and a single signer. |
| `BOUND_LINKS` | `LINKS`, plus that each link is bound to its parent's digest. Only events written after the ledger began binding digests carry it, so older links report a warning and the verdict is `INDETERMINATE`. |

`--eventScope` - how deeply each event is checked:

| Value | Checks |
|---|---|
| `INTEGRITY` | The event is unchanged since signing and its signature value matches the certificate embedded in it (well-formed XML, identity, reference digests, signature value, certificate binding). Says nothing about whether that certificate was valid or trusted. |
| `SIGNATURE` | `INTEGRITY`, plus the signature timestamp, and the certificate's validity and trust at signing time (checked offline). |

`--includeIndexConsistency` (`true` or `false`) - also compare the ledger's stream index with the events
found. Omit it unless the user asked.

## Reading the result

The result has `verdict` (`VALID`, `INVALID` or `INDETERMINATE`), `level`, `eventScope`, `verifiedAt`,
`coverageNote`, `summary` counts, `failedChainChecks` (checks that did not pass, with the `entryIds` they
concern) and `unverifiedEntries` (entries that are not `VALID`, with their failed checks). Passing checks
and valid entries are counted in `summary` but not listed.

- **`coverageNote` states what this check could not detect.** Repeat it to the user with the verdict, so
  a `VALID` at a low level is not read as more than it is.
- **`INVALID` and `INDETERMINATE` are findings, and the run still succeeds.** Report the verdict, the level
  used, and the failed checks and entries to the user as they are.
- **Never write events in response** - not to repair, annotate or work around a chain. Do not call
  `timeline.events.create` because of a verdict. Whether to act is the user's decision.

## When verification did not run

There is then no verdict, and the skill exits with an error naming the cause: not found (404), too large to
verify (422), the ledger or backend unavailable (502), or timed out (504). Report the cause; do not treat
it as `INVALID`. A timeout or unavailability may be retried later.

## When there is no usable key

The skill stops and says a confirmed key is needed. Run `timeline.authenticate --projectId <id>`. A key reaches exactly one project, so each project needs its own.
