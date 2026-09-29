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

## Installation

```
npm ci
cp .env.example .env        # point TIMELINE_APP_URL and TIMELINE_API_URL at your environment
npm run install-skills      # links each skill into ~/.claude/skills
```

The install links, never copies: `git pull` here updates every installed skill, and
`npm run uninstall-skills` removes exactly those links. Running the install twice changes nothing and
says so.

The skills work from any project on this machine. Each one runs through `scripts/run-skill.mjs`,
which resolves this pack from its own location and uses the toolchain pinned here rather than
whatever `npx` would fetch — so nothing is downloaded at invocation time and the version never
drifts. `.env` is read from here regardless of where the agent is standing, and credentials always
land in this pack's `.credentials/`, never in the project being worked on. A skill run before
`npm ci` says which step is missing instead of failing on a missing file.

Then, from an agent session anywhere:

```
timeline.authenticate
```

## Which skill needs which credential

| Skill | Credential |
|---|---|
| `timeline.authenticate` | none to start; obtains the rest |
| `timeline.projects.list` | external tool token |
| `timeline.projects.permissions` | external tool token |
| `timeline.projects.create` | external tool token, plus your confirmation on screen |
| `timeline.projects.get` | that project's key |
| `timeline.projects.members` | that project's key |
| `timeline.project.context` | that project's key |
| `timeline.events.create` | that project's key |
| `timeline.events.get` | that project's key |
| `timeline.events.list` | that project's key |

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

## Credentials never appear in output

No skill prints a token value, on any path, including error messages and echoed request headers.
Credentials live in `.credentials/`, which is untracked.
