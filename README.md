# protrion-timeline-skills

A Claude Code skill pack for working a Protrion Timeline engagement — reading a project, keeping its
timeline current, and checking what the agent is actually allowed to do.

Specs and changes live in the sibling repo `protrion-timeline-openspec`, registered as OpenSpec store
id `protrion-timeline`. Run OpenSpec commands with `--store protrion-timeline`.

## The credential chain

Nothing here is usable without a human, and that is the point.

1. **`timeline.authenticate`** opens the app in your browser. You sign in as you normally would and
   approve the agent. The app hands back an **external tool token**, delivered to a listener the pack runs on
   this machine.
2. The external tool token on its own reaches **no timeline**. It lists which projects exist and reports what
   you may do on one. That is all.
3. To act on a project, the agent needs that project's **key**. Every key — the first one, one for a
   project it just created, and every replacement of an expired one — is **confirmed by you on a
   screen that names the project**.
4. A project key **expires within two hours**. When it does, the agent stops and asks again rather
   than carrying on.

No credential can arrive through the environment: the pack defines no variable that accepts one,
deliberately - a variable is exactly how the confirmation step would get bypassed.

## Requirements

- **Node.js 22** (the version CI uses) and npm.
- **Claude Code** on the same machine - the skills are Claude Code skills.
- **A reachable Protrion Timeline** - the frontend app (where you approve things) and the backend
  (which the pack talks to). Locally that is the frontend on `http://localhost:4002` and the backend on
  `http://localhost:8080`.
- **An account in the app.** Reading needs membership of the project; confirming a key for a project
  needs write access to it.
- **A browser on this machine.** Approval happens there, and the app delivers the result to a listener
  on `127.0.0.1`, so the browser and the agent must be on the same machine.

## Installation

```
npm ci
cp .env.example .env        # point TIMELINE_APP_URL and TIMELINE_API_URL at your environment
npm run install-skills      # links each skill into ~/.claude/skills
```

The install links, never copies: `git pull` here updates every installed skill, and
`npm run uninstall-skills` removes exactly those links. Running the install twice changes nothing and
says so. After a `git pull` that changes `package-lock.json`, run `npm ci` again.

The skills work from any project on this machine. Each one runs through its own `run.mjs` launcher (which hands over to `scripts/run-skill.mjs`),
which resolves the pack from its real location (so the install symlink does not matter) and uses the toolchain pinned here rather than
whatever `npx` would fetch — so nothing is downloaded at invocation time and the version never
drifts. `.env` is read from here regardless of where the agent is standing, and credentials always
land in this pack's `.credentials/`, never in the project being worked on. A skill run before
`npm ci` says which step is missing instead of failing on a missing file.

### Configuration

`.env` holds two settings and nothing else:

| Variable | Default | Meaning |
|---|---|---|
| `TIMELINE_APP_URL` | `http://localhost:4002` | The frontend app. The pack opens its `/agent/authorize` and `/agent/project-key` screens in your browser. |
| `TIMELINE_API_URL` | `http://localhost:8080` | The backend the pack reads and writes through. |

Point both at the same environment. Plain `http://` is accepted for `TIMELINE_API_URL` only when the
host is this machine (`localhost`, `127.0.0.1`, `::1`); anything else must be `https://`, because every
credential the pack holds travels with each request. The pack refuses to start otherwise.

Switching environments means switching credentials too: a token approved on one environment is
meaningless on another. Clear `.credentials/` (see [Managing access](#managing-access)) when you
change the URLs.

## Which skill needs which credential

| Skill | Credential |
|---|---|
| `timeline.authenticate` | none to start; obtains the rest |
| `timeline.projects.list` | external tool token |
| `timeline.projects.permissions` | external tool token |
| `timeline.projects.create` | external tool token, plus your confirmation on screen |
| `timeline.projects.get` | that project's key |
| `timeline.projects.members` | that project's key |
| `timeline.projects.verify` | that project's key |
| `timeline.project.context` | that project's key |
| `timeline.events.create` | that project's key |
| `timeline.events.get` | that project's key |
| `timeline.events.list` | that project's key |
| `timeline.events.verify` | that project's key |

## Using the skills

You do not call the skills yourself. Ask Claude for what you want, and it picks the skill; each
`SKILL.md` tells it which credential the skill needs and what to do when it is missing. Typical
requests:

- "Authorize yourself for the timeline." - runs `timeline.authenticate`; approve in the browser.
- "Which timeline projects are there, and can I write to TLPT-2026-001?" - `timeline.projects.list`
  and `timeline.projects.permissions`.
- "Get me up to speed on TLPT-2026-001." - `timeline.project.context`, after you confirm a key for
  that project when asked.
- "Record that scoping is complete on TLPT-2026-001." - `timeline.events.create`, which reports
  whether the event actually reached the ledger.
- "Create a new TLPT-TI project called NORTH STAR." - `timeline.projects.create`; you confirm the
  project and its key on one screen.

A first session on a project usually goes:

1. **Authorize the agent** - once per machine and environment. A browser tab opens on
   `/agent/authorize`; sign in if needed and approve. The agent now acts as you, but can only list
   projects and check permissions.
2. **Confirm a key for the project** - a tab opens on `/agent/project-key` naming the project and how
   long the key will last (at most two hours). Confirm it.
3. **Work** - reads and writes on that project use its key until it expires.
4. **Confirm again** when the key expires - the agent stops and asks; it never renews a key on its own.

Once you approve, decline or the app refuses, the tab lands on the app's `/agent/done` screen, which
says how it went and that you can return to your agent. The address it is sent to carries only the
outcome, never a token or key.

Each browser screen waits five minutes for you. Leaving it longer, or closing the tab, ends the
request with nothing obtained.

Every skill can also be run directly, which is handy for checking an installation. Each `SKILL.md`
shows the exact command, for example:

```
node skills/timeline.projects.list/run.mjs timeline.projects.list
node skills/timeline.authenticate/run.mjs timeline.authenticate --projectId TLPT-2026-001
```

## What a result means

| The agent reports | Meaning | What to do |
|---|---|---|
| Authorized, acting as *name* | The external tool token is stored. | Nothing. |
| A key was confirmed, expires at *time* | The project key is stored. | Nothing. |
| Declined | You refused on the screen. | Nothing, unless you meant to approve - ask again. |
| Not completed within 300s | The screen was left open or closed. Nothing was obtained. | Ask again when you are at the browser. |
| Refused: no write access to that project | No key can exist for you on it. | Get write access in the app, or work on another project. |
| Refused: workflow type is not TLPT-TI or TLPT-RT | Only those two can be created. | Use one of them. |
| Refused: the request was invalid | A required field was missing (for a new project: workflow type, codename, framework, provider). | Supply every field. |
| Refused: the backend failed or could not be reached | A server or network error while issuing. | Try again; check the backend if it persists. |
| No external tool token / the external tool token was refused | Never authorized, or the token was revoked. | Authorize again with `timeline.authenticate`. |
| No confirmed key / the key has expired | The project has no key, or its key ran out. | Confirm a key with `timeline.authenticate --projectId <id>`. |
| Nothing was found (404) | The project, event or ingest record asked for does not exist (the key was accepted). | Check the id you passed; do not re-authenticate. |
| The request was invalid (4xx) | The backend rejected the request itself, with its reason. | Fix the request (for an event: `name`, `group`, and `type` or `entryId`); do not re-authenticate. |
| No such ingest record (`not_found`) | `--recheck` was given an id the backend does not know. | Use the `ingestId` an earlier write returned; nothing was written. |
| The backend could not be reached | Network or backend down. Distinct from "nothing found". | Check `TIMELINE_API_URL` and that the backend runs. |
| Verification verdict `VALID` | Nothing failed at the level and scope reported. | Read the coverage note: it says what that level could not detect. |
| Verification verdict `INVALID` or `INDETERMINATE` | A finding, not a failure: the run succeeded. `INVALID` means a check failed; `INDETERMINATE` means one warned and none failed. | Report it, with the failed checks, to the user. Never write events in response. |
| Too large to verify (422) | The project has more events than one verification can take. No verdict. | Not retryable as is; nothing was verified. |
| Timed out (504) | The ledger or its signer took too long. No verdict. | Try again later. |
| Event `PROCESSED` | The event is in the ledger. | Nothing. |
| Event `FAILED` | The ledger rejected it; the recorded error is included. | Fix the event and create it again. |
| Event unresolved, with its ingest id | Accepted, but its outcome could not be confirmed in time (or the key expired while checking). | Re-check it with `timeline.events.create --projectId <id> --recheck <ingestId>` - do not create it a second time. |

## Two things that are absent on purpose

**`timeline.actions.list` and `timeline.actions.execute`** are named in PL-21 but are not here. The
backend has no notion of an action: a playbook carries phases, lanes, tags and roles, and nothing
computes "what may happen next". Shipping a stub would invite an agent to invent one.

**`timeline.events.search`** is not here either. It would hit the same endpoint as
`timeline.events.list` with the same `group`/`tags`/`typeDetail` filters — the ledger supports no
other search dimension and no full text — so it would be an alias pretending to be a capability. Use
`timeline.events.list` with filters.

## Writing events

`timeline.events.create` treats the ingest API's `202` as *accepted for processing*, not as proof the
event reached the ledger. It polls the event's status and reports `PROCESSED`, `FAILED` with the
recorded error, or unresolved — never the `202` as success.

What an event follows is an explicit choice. Without a `parents` field the skill writes nothing: it
returns `needs_parent_decision` with `suggestedParent` (the latest *occurred* event, never a planned
step, or `null`) and exits with code 2, so the agent asks the user whether to link to the suggestion,
to another event, or to none, then re-runs with `"parents":["<id>"]` or `"parents":[]`. Explicit
parents are sent unchanged; an empty list is a deliberate "no parent".

## Verifying

`timeline.projects.verify` and `timeline.events.verify` ask the ledger whether a project's chain, or one event,
is unchanged. `--level` (`EVENTS`, `LINKS`, `BOUND_LINKS`), `--eventScope` (`INTEGRITY`, `SIGNATURE`) and `--scope`
(`INTEGRITY`, `SIGNATURE`, `SIGNATURE_WITH_REVOCATION`) choose how deep; each `SKILL.md` says what each value
checks. Nothing chosen means nothing sent, so the backend defaults apply: chain `LINKS` + `INTEGRITY`, event
`INTEGRITY`, because signing on the ledger is not finished yet. The result names the level used and a coverage
note saying what the check could not detect. A verdict of any kind exits `0`; only a failure to verify
(not found, too large, unavailable, timed out) exits `1`.

## Credentials never appear in output

No skill prints a token value, on any path, including error messages and echoed request headers.
Credentials live in `.credentials/`, which is untracked.

## Managing access

- **See and revoke what the agent holds** on the app's **API keys** page (`/api-keys`). It lists your
  external tool tokens with when each was last used, and marks project keys held by an agent (`AGENT`)
  apart from your own (`HUMAN`).
- **Revoking the external tool token** stops the agent from listing projects or asking for new keys.
  Project keys it already obtained keep working until they expire (at most two hours) or you revoke
  them on the same page.
- **Starting over on this machine**: delete `.credentials/` in this pack. The next skill run asks you
  to authorize again. Do this also after switching environments.

`.credentials/credentials.json` is written with owner-only permissions (`0600`, directory `0700`),
atomically, and under a lock, so two skills running at once cannot corrupt it or lose a key.

## Troubleshooting

- **"run `npm ci`"** - the one-time setup was not done in this pack, or `package-lock.json` changed.
- **No browser opens** - open the URL the skill prints in a browser on this machine. On Linux this
  needs `xdg-open`.
- **The screen says the request cannot be delivered** - the request lacked a `state` or pointed at a
  non-loopback address; the agent was not started by this pack. Run the skill again.
- **Every request is refused (401)** - the token was revoked, has expired, or belongs to another
  environment. Authorize again; clear `.credentials/` if you changed the URLs.
- **`TIMELINE_API_URL ... plain http://`** - use `https://` for a remote backend.
- **Skills not offered in Claude Code** - run `npm run install-skills` again and start a new session.

## Development

```
npm run typecheck
npm test
```

Both run offline - no backend, no browser, no credentials - and are what CI (`.gitlab-ci.yml`) runs on
every push. Specs and tasks for changes live in the OpenSpec store `protrion-timeline`.
