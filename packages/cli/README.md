# `@trinoris/agent-cli` user guide

`trinoris-agent` coordinates coding agents that edit the **same working tree**. It gives
each agent a stable identity, lets agents reserve named areas of work, shows who holds
those reservations, and lets an agent claim a handoff note without two agents claiming it
at once.

Use it when multiple agents may write to one checkout. It does not coordinate separate
clones or separate branches, and it does not prevent an agent from ignoring the protocol.
All participating agents must use the same `coordination/` directory and follow
`PROTOCOL.md`.

## How the CLI fits together

```text
 Coding agent A                         Coding agent B
 (Codex, Claude, Kiro, ...)            (Codex, Claude, Kiro, ...)
        |                                      |
        | trinoris-agent acquire/check/...     | trinoris-agent status/claim/...
        +------------------+-------------------+
                           |
                    @trinoris/agent-cli
               parses command, identity, config
                           |
                    @trinoris/agent-sdk
          lock / renew / release / claim / break
                           |
               shared repository filesystem
                           |
          +----------------+----------------+
          |                |                |
   coordination/locks  coordination/     coordination/
   <scope>.lock        handoff/...       incidents/...
   holder.json         *.claim marker    break records
                      active/ notes

 `verify` takes a separate path:
 CLI -> start N child processes -> workers wait for release barrier
    -> each mkdirs the same unique lock path -> parent checks 1 winner
    -> repeat for each trial -> ATOMIC / NOT ATOMIC / PROBE FAILED
```

The filesystem is the coordination service: every participant sees the same lock and
handoff records. The CLI and SDK do not send messages to agents, schedule work, or keep a
central server. Agents communicate through handoff files and coordinate ownership through
the shared directory.

## Best-fit use scenarios

- **Parallel work in one checkout:** one agent owns `api`, another owns `webapp`; both can
  read the whole tree, but each reserves the files it plans to change.
- **Several agents working on the same subsystem:** agree on a single shared scope such as
  `engine`; only one agent edits that subsystem at a time, while others work on disjoint
  scopes or prepare handoffs.
- **A task changes owners:** the current agent writes a handoff note into the next agent's
  inbox. The receiver claims it with `trinoris-agent claim`, then acquires the needed
  scope before editing.
- **Long-running work:** the owner renews the lease and checks ownership before each batch
  of writes. If the owner disappears, a peer checks status and uses the guarded `break`
  command only after the lease and grace period expire.
- **Onboarding a repository or changing its mount:** run `setup` once, then `verify` on the
  actual shared checkout before agents start relying on locks.

This CLI fits teams sharing one working tree on a filesystem where the verifier confirms
atomic directory creation. Use branch isolation or a hosted coordination service when
agents work in separate clones, need remote notifications, require enforced access control,
or need a system to stop non-cooperating writers. A lock is a coordination agreement; it
does not enforce filesystem permissions.

## Limitations

- **Cooperative protocol:** locks are advisory. The CLI cannot stop an agent, editor, or
  script from changing files without acquiring the relevant scope.
- **Shared checkout only:** agents must see the same working tree and `coordination/`
  directory. Identical copies in separate clones do not coordinate with each other.
- **Filesystem-specific guarantee:** `verify` exercises directory creation from the
  current environment and target tree. Its result does not certify another mount, host,
  container, or filesystem configuration. Rerun it when those change.
- **Sandbox restrictions:** if a sandbox blocks child processes or filesystem inspection,
  the result is inconclusive. `PROBE FAILED` and `filesystem unknown` are not proof of
  non-atomic behavior; rerun with the required permissions against the same tree.
- **No agent orchestration:** the CLI does not launch agents, assign tasks, deliver live
  notifications, or negotiate ownership. Agents use handoff files and check status
  themselves.
- **Scopes require team discipline:** the CLI checks scope names against the registry but
  does not map files to scopes or detect overlapping ownership. Agree on scope boundaries
  and acquire every scope needed for a change.
- **Leases are not health checks:** an expired lease does not prove its owner has stopped.
  Check with the owner when possible; use `break` only after confirming the lock is stale,
  and inspect the working tree after a takeover.
- **Identity must persist for lock operations:** generated instance IDs change per command.
  Reuse the same explicit `--instance` value for acquire, check, renew, and release.

## Install and start

The CLI requires Node.js 18 or later. From this monorepo:

```bash
pnpm install
pnpm build
node packages/cli/dist/bin.js --help
```

After publishing, install the CLI globally and use `trinoris-agent` in place of
`node packages/cli/dist/bin.js` below:

```bash
npm install --global @trinoris/agent-cli
```

Run setup once from the repository you want agents to share:

```bash
trinoris-agent setup --work-dir /path/to/repository
trinoris-agent verify --work-dir /path/to/repository
```

`setup` creates `coordination/`, a scope registry in `.kiro/coordination.json`, and thin
agent instruction files. It does not start agents or acquire locks. Read the generated
`AGENTS.md` and `PROTOCOL.md`, then run `verify`. Do not let agents rely on the locking
protocol until verification passes.

To customize the initial scope names and agent classes:

```bash
trinoris-agent setup \
  --work-dir /path/to/repository \
  --agent-classes codex-gpt-6,claude-opus-5 \
  --scopes api,webapp,tests,git
```

`setup --force` rewrites generated configuration and instruction files. Use it only when
you intend to replace local edits to those generated files.

## Identify each agent consistently

Pass the same `--agent-class` and `--instance` values to every command issued by one agent
session. The instance is the lock owner; a new instance cannot renew or release another
instance's lock.

```bash
trinoris-agent status \
  --work-dir /path/to/repository \
  --agent-class codex-gpt-6 \
  --instance codex-session-a
```

`--agent-class` defaults to `claude`. If `--instance` is omitted, the CLI generates a new
ID for that invocation. That is convenient for one-off status checks, but unsuitable for
acquire/check/renew/release sequences. Choose a stable session ID and repeat it, or save
these options in a shell alias or wrapper.

Every command defaults `--work-dir` to the current directory. Set it explicitly if the
shell is not running at the repository root.

## Daily workflow: reserve work before editing

Scopes are shared names for areas such as `api`, `webapp`, or `tests`. The default registry
also includes `engine`, `agents`, `infra`, `specs`, `root`, and `git`. Choose the smallest
scope that covers the files you intend to change. If the repository has a custom registry,
the CLI rejects unregistered scopes.

Acquire a scope before editing:

```bash
trinoris-agent acquire \
  --work-dir /path/to/repository \
  --agent-class codex-gpt-6 \
  --instance codex-session-a \
  --scope api \
  --task "Add request validation"
```

Before each batch of writes, confirm the same instance still owns the lock:

```bash
trinoris-agent check \
  --work-dir /path/to/repository \
  --agent-class codex-gpt-6 \
  --instance codex-session-a \
  --scope api
```

For work that may outlast the configured lease, renew periodically. Release the scope as
soon as the work is complete or you stop working:

```bash
trinoris-agent renew  --work-dir /path/to/repository --instance codex-session-a --scope api
trinoris-agent release --work-dir /path/to/repository --instance codex-session-a --scope api
```

Keep the same `--agent-class` as well when running these commands. The default lease is 15
minutes and the default grace period for stale-lock recovery is 5 minutes; both are read
from `.kiro/coordination.json`.

### If a scope is already held

`acquire` exits with code `3` and names the current holder when it can read the holder
record. Do not loop or retry repeatedly. Pick work covered by another free scope, or write
a handoff for the current holder.

Check the current locks with:

```bash
trinoris-agent status --work-dir /path/to/repository
trinoris-agent status --work-dir /path/to/repository --scope api
```

With no `--scope`, `status` lists every lock directory. It reports `HELD`, `EXPIRED`, or
`MALFORMED` state and whether a lock is eligible for recovery.

## Handoffs

Write a handoff note in `coordination/handoff/for-<agent-class>/` using the repository's
handoff format. The receiving agent claims it by filename:

```bash
trinoris-agent claim \
  --work-dir /path/to/repository \
  --agent-class codex-gpt-6 \
  --instance codex-session-a \
  --note implement-validation.md
```

By default, `claim` looks in `coordination/handoff/for-codex-gpt-6/` and moves a successful
claim into `coordination/active/`. To use another source or destination directory, pass
`--from` and `--to` as paths relative to `coordination/`:

```bash
trinoris-agent claim --note implement-validation.md \
  --from handoff/for-claude-opus-5 --to active
```

The CLI claims by creating an atomic marker before moving the note. If another agent has
already claimed it, the command exits `3`; do not claim the note by moving it manually.

## Recover a stale lock

Only break a lock after checking with its owner or establishing that the owner is gone and
the lock is stale. The grace period protects an agent that is slow or temporarily
disconnected. Supply a reason so the takeover is recorded:

```bash
trinoris-agent break \
  --work-dir /path/to/repository \
  --agent-class claude-opus-5 \
  --instance claude-recovery-a \
  --scope api \
  --reason "Owner confirmed terminated; lease and grace period expired"
```

Breaking a lock records an incident and preserves the stale lock metadata. After a
successful break, inspect `git status` and run the relevant checks before continuing. Do
not remove lock directories by hand.

## Verify the filesystem gate

The verifier runs real child processes that race to create one directory. Defaults are 50
trials with 8 workers per trial:

```bash
trinoris-agent verify --work-dir /path/to/repository
trinoris-agent verify --work-dir /path/to/repository --trials 100 --concurrency 8
```

`--trials` must be a positive integer. `--concurrency` must be an integer of at least 2;
one worker cannot test a race.

The result has three meanings:

- **ATOMIC** — all trials completed normally and exactly one worker won each race.
- **NOT ATOMIC** — workers completed normally, but a trial had zero or multiple winners.
  Do not install or use the protocol in that working tree.
- **NOT CHECKED / PROBE FAILED** — workers could not start, returned invalid results, or
  timed out after 15 seconds. This says nothing about filesystem atomicity.

Codex, IDE, and CI sandboxes can block subprocess startup or filesystem inspection. A
sandboxed run may therefore report a probe failure and `filesystem unknown`; this is not a
non-atomic result. Rerun the command in an environment that permits child-process creation
against the same working tree. If the filesystem name is unknown but all races complete,
the race result is still meaningful; the name lookup is diagnostic only.

## Exit codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `0` | Command succeeded; for `verify`, setup and the filesystem gate passed | Continue |
| `1` | Invalid input, missing setup/configuration, probe failure, or non-atomic filesystem | Read the error and notes; fix the cause before relying on the protocol |
| `3` | Scope or handoff claim is contended | Choose other work or coordinate with the holder; do not spin |
| `4` | This instance does not hold the scope or lost ownership | Stop writing in that scope and re-acquire before continuing |

## Command reference

```text
trinoris-agent setup [--force] [--work-dir DIR]
  [--agent-classes CLASS,CLASS] [--scopes SCOPE,SCOPE]
trinoris-agent verify [--work-dir DIR] [--trials N] [--concurrency N]
trinoris-agent status [--work-dir DIR] [--scope SCOPE]
trinoris-agent acquire --scope SCOPE [--task TEXT] [identity options]
trinoris-agent check --scope SCOPE [identity options]
trinoris-agent renew --scope SCOPE [identity options]
trinoris-agent release --scope SCOPE [identity options]
trinoris-agent break --scope SCOPE --reason TEXT [identity options]
trinoris-agent claim --note FILENAME [--from DIR] [--to DIR] [identity options]

identity options:
  --agent-class CLASS   Defaults to claude
  --instance ID         Generated per invocation if omitted
  --work-dir DIR        Defaults to the current directory
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).

<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->
