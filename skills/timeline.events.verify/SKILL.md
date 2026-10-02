---
name: timeline.events.verify
description: Verify one event of a project against the ledger - that it is unchanged since signing and, if asked, who signed it. Use when the user asks whether a specific entry can be trusted.
---
<!-- SPDX-FileCopyrightText: 2026 CITADELO s.r.o. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# timeline.events.verify

**Credential:** that project's key. It acts on that one project only.

> **Where to run this:** anywhere. Run the command below exactly as written, replacing `<base directory>` with
> this skill's base directory (shown as "Base directory for this skill" when the skill loads). `run.mjs`
> finds the pack itself, whatever the base directory is, so there is nothing to locate or count. The runner
> uses the pack's own pinned toolchain and its own configuration and credentials, so the project you
> are working in is never touched and nothing is fetched from the network.

```
node "<base directory>/run.mjs" timeline.events.verify --projectId TLPT-2026-001 --entryId EVT-005 [--scope INTEGRITY]
```

Verifies one event of the project and reports the verdict. Nothing is written or stored.

## Choosing the scope

**Pass exactly the scope the user asked for.** If the user asked for nothing in particular, pass no
`--scope`: the backend default applies, `INTEGRITY`, because signing on the ledger is not finished yet and
timestamp and certificate checks cannot pass reliably. The result always names the `scope` actually used.

| `--scope` | Checks |
|---|---|
| `INTEGRITY` | The event is unchanged since signing and its signature value matches the certificate embedded in it (well-formed XML, identity, reference digests, signature value, certificate binding). Says nothing about whether that certificate was valid or trusted. |
| `SIGNATURE` | `INTEGRITY`, plus the signature timestamp, and the certificate's validity and trust at signing time (checked offline). |
| `SIGNATURE_WITH_REVOCATION` | `SIGNATURE`, plus that the certificate was not revoked (online OCSP/CRL lookup). |

## Reading the result

The result has `verdict` (`VALID`, `INVALID` or `INDETERMINATE`), `scope`, `verifiedAt`, `failedChecks`
(checks that did not pass) and, when the event carries a readable signature, `signature` with the profile,
signing time, timestamp time and the signer's subject and issuer (`signer` is null when the ledger could not read the certificate; `signingTime` may be null too). The signer is trustworthy only when the
certificate checks passed - at `INTEGRITY` scope validity and trust were not checked, so do not present the signer as trusted.

- **`INVALID` and `INDETERMINATE` are findings, and the run still succeeds.** Report the verdict, the
  scope used and the failed checks to the user as they are.
- **Never write events in response** - not to repair, annotate or supersede the event. Do not call
  `timeline.events.create` because of a verdict. Whether to act is the user's decision.
- A verdict at `INTEGRITY` scope says nothing about whether the signer's certificate was valid or trusted; say so if the user asks
  who signed it, and offer a higher `--scope`.

## When verification did not run

There is then no verdict, and the skill exits with an error naming the cause: no such event (404), the
ledger or backend unavailable (502), or timed out (504). Report the cause; do not treat it as `INVALID`.

## When there is no usable key

The skill stops and says a confirmed key is needed. Run `timeline.authenticate --projectId <id>`. A key reaches exactly one project, so each project needs its own.
