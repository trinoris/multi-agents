<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->

# 06 — CLI interface

**Status:** Current implementation contract
**Package:** `@trinoris/agent-cli`
**Reviewed:** 2026-10-26

This document describes the shipped protocol 3 CLI in
[`packages/cli/src/bin.ts`](../packages/cli/src/bin.ts). It does not promise future
commands. The CLI is a one-shot coordination client; it does not launch or supervise a
coding agent. The earlier interactive, once, daemon, configuration-precedence, and polling
proposal is retained in [`docs/archive/CLI-SPEC-2026-10-25.md`](../docs/archive/CLI-SPEC-2026-10-25.md)
as historical material, not as a current contract.

The remaining CLI roadmap is tracked separately in
[`docs/planning/CLI-MODE-COMPLETION-PLAN.md`](../docs/planning/CLI-MODE-COMPLETION-PLAN.md).

## Purpose and boundary

`trinoris-agent` exposes protocol 3 setup, verification, lease and handoff lifecycles,
read-only status and incident views, diagnosis, and explicit recovery. It delegates
filesystem coordination to `@trinoris/agent-sdk` and validation to `@trinoris/agent-core`.

It coordinates cooperating agents that share one working tree. Agent class and instance
strings are local labels, not authenticated identities. Locks do not sandbox an editor,
fence a process paused after a check, or coordinate independent clones or machines. Use
separate working trees or an enforcing service when strict write exclusion is required.

The CLI never waits or polls on contention, automatically breaks a lock, renews a lease in
the background, or steals a marker because of age or PID. A caller receiving contention
must choose other work or stop. Recovery requires explicit operator confirmation that the
affected actors have stopped.

## Invocation

```text
trinoris-agent <command> [options]
```

Top-level and per-command help are available with `--help` or `-h`. `--version` reads the
version from the installed CLI package manifest.

### Common options

| Option | Current behavior |
| --- | --- |
| `--work-dir <path>` | Target checkout; defaults to the current working directory. |
| `--agent-class <name>` | Coordination label. Stateful commands require it explicitly; other commands currently default it to `claude-opus-5`. |
| `--instance <id>` | Explicit coordination label. Stateful commands require it explicitly; other commands generate an unused per-invocation value when omitted. |
| `--json` | Emits successful results as JSON and failures as `{ "error": { "code": "cli_error", "message": "..." } }` on stderr. The message is terminal-escaped and capped at 512 characters. |

Lease mutation commands (`acquire`, `acquire-many`, `check`, `renew`, `release`, `break`,
`claim`, and `recover`) and handoff mutation commands (`handoff publish`, `handoff complete`)
reject missing `--agent-class` or `--instance` before changing state. `handoff list` requires
both labels because it includes the caller's active notes. Reuse the same explicit labels
across related commands, and retain the generation returned by `acquire` or `break`. These
labels do not prove who is making the call.

The CLI has no user config file, `--config` option, environment-variable precedence, or
persisted identity profile. Installed coordination settings are read from the selected
checkout's `.trinoris/config.json` by the SDK.

## Current commands

| Command | Options | Effect |
| --- | --- | --- |
| `setup` | `--force`, `--agent-classes <csv>`, `--scopes <csv>`, `--lease-minutes <n>`, `--grace-minutes <n>` | Installs protocol 3 files and instructions in the target checkout. `--force` replaces eligible generated files and refuses retained active locks. Lease and grace values use core bounds. |
| `verify` | `--trials <n>`, `--concurrency <n>` | Checks installed structure, configuration, protocol digest, ignore rule, and real mkdir behavior. Defaults to 50 trials and 8 workers. It uses bounded temporary worker activity. |
| `status` | `--scope <scope>` | Inspects lease directories. States include `free`, `held`, `expired` (with `breakable`), `malformed`, and `unknown` for an unregistered scope directory. It does not mutate state. |
| `acquire` | `--scope <scope>`, optional `--task <text>` | Acquires one lease and returns its generation. |
| `acquire-many` | `--scopes <csv>` | Acquires an ordered all-or-none set of leases. Newly acquired leases roll back if the batch cannot complete. |
| `check` | `--scope <scope>`, `--generation <id>` | Confirms the caller still holds the exact live generation immediately before writing. |
| `renew` | `--scope <scope>`, `--generation <id>` | Renews the caller's exact still-live generation. There is no automatic renewal. |
| `release` | `--scope <scope>`, `--generation <id>` | Releases only the matching generation. |
| `break` | `--scope <scope>`, `--reason <text>` | Performs guarded takeover after expiry plus grace or an eligible malformed-lock grace period; preserves stale state and returns the new generation. |
| `claim` | `--note <filename>`, optional `--from <inbox>`, `--to <active-dir>` | Validates recipient and note rules and moves a matching inbox note to the claimant's active directory. Defaults to `handoff/for-<class>` and `active/<instance>`. |
| `handoff validate` | `--note <filename>` | Validates a draft under `.trinoris/handoff/drafts/` without mutation. |
| `handoff publish` | `--note <filename>`, `--agent-class`, `--instance` | Validates and publishes a draft to its declared inbox. Uses the shared mutation guard and an idempotent publication receipt; refuses an existing destination. |
| `handoff list` | `--agent-class`, `--instance` | Lists the caller-class inbox, universal inbox, and that instance's active notes. |
| `handoff show` | `--note <filename>`, `--agent-class`, optional `--instance`, `--location inbox\|universal\|active` | Reads only a managed inbox or the caller's own active directory. `--instance` is required for `active`. |
| `handoff claim` | Same as `claim` | Compatibility spelling for the guarded claim operation. |
| `handoff complete` | `--note <filename>`, `--outcome <text>`, `--agent-class`, `--instance` | Completes and archives an active note. Writes an idempotent receipt and archive index entry; does not overwrite another archive entry. |
| `diagnose` | none | Read-only inspection of abandoned mutation, recovery, break, and claim markers. |
| `incidents list` | optional `--scope <scope>` | Lists up to 200 newest bounded summaries from retained incident events; scans at most 5000 candidate files and reads at most 16 KiB per event. A scoped query returns only matching registered scopes. Malformed events are identified by filename without rendering their contents. |
| `recover` | `--marker <path>`, `--operation <id or unknown>`, `--reason <text>`, `--confirm-stopped` | Explicitly recovers an exact diagnosed marker after all affected actors have stopped. |

Lease duration and grace use `.trinoris/config.json`. `setup --lease-minutes 30 --grace-minutes 5`
sets those values; renewal threshold is set to one third of the lease
duration. Configuration rejects `heartbeat.enabled: true`.

## Command behavior and exit codes

- Successful operations return exit code `0`.
- Invalid input, invalid configuration, failed verification, conflicts, and uncertain I/O
  return `1`.
- Contention, a held scope, a busy mutation guard, or a note claimed by another actor
  returns `3`. Do not retry in a loop.
- A failed lease check or a lease operation that reports `not-holder` returns `4`; stop
  editing immediately.

When `--json` is supplied, successful results are one JSON value on stdout and failures use
the stable top-level `error.code` / `error.message` shape on stderr. The current code is
`cli_error`; message details are diagnostic, bounded, and not a machine-readable contract.
Scripts must use the exit code as the success signal.

`status` is a lease view. `diagnose` is a marker-recovery view. `incidents list` reads
retained takeover and recovery events; it deliberately omits raw error strings and limits
reason text to 256 characters. These local records are not independently authenticated.

## Security requirements

- All state-changing lease and handoff operations go through the SDK's shared mutation guard.
- `check`, `renew`, and `release` require both the instance label and exact generation.
- Claim validates protocol 3 note structure, recipient class/instance, status, source inbox,
  and destination. It never overwrites existing active content.
- Handoff publish and complete are guarded, receipt-backed mutations. Exact retries can
  finish an interrupted move; conflicting content or a different operation is refused.
- Handoff reads are constrained to the caller-class inbox, universal inbox, or the exact
  active directory named by `--instance`; arbitrary filesystem paths are not accepted.
- Takeover records an attempted/completed/failed outcome where storage allows, preserves
  stale state, and serializes against other mutations.
- `recover` is offline operator recovery. It requires `--confirm-stopped` and the exact
  operation ID, or `unknown` after inspecting an incomplete marker with all actors stopped.
- No command treats PID, age alone, heartbeat, identity labels, or a reason string as proof
  of authority.
- Keep secrets out of task, reason, handoff, and incident text. These fields are local
  coordination records, not a protected secret store.

## Handoff workflow

Create a protocol 3 note in `.trinoris/handoff/drafts/`, validate it, release owned scopes,
then publish it. The recipient lists and reads only its routed inbox, claims the note into
its own active directory, and completes it with a recorded outcome when done. See the
[`@trinoris/agent-cli` guide](../packages/cli/README.md) for examples and
[`specs/03-handoff-format.md`](03-handoff-format.md) for the note schema.

## Implemented tests

The command contract is exercised by:

- `packages/cli/src/commands/cli.integration.test.ts` — installed CLI command journeys,
  lease lifecycle, handoff validate/publish/list/show/claim/complete journey, argument
  rejection, diagnosis, recovery, incident listing, status states, help/version, and JSON
  error output.
- `packages/cli/src/commands/setup.security.test.ts` — safe and idempotent setup plus
  package-owned protocol installation.
- `packages/cli/src/commands/verify.test.ts` — readiness, filesystem probe bounds, and
  cancellation behavior.
- `packages/cli/src/commands/release-inputs.test.ts` and
  `packages/cli/src/commands/release.security.test.ts` — release manifest, artifact, and
  credential boundaries.
- `packages/cli/src/commands/packed.integration.test.ts` — packed artifacts and offline
  consumer journey.

Release readiness and cross-platform package validation remain tracked in
[`docs/planning/CLI-MODE-COMPLETION-PLAN.md`](../docs/planning/CLI-MODE-COMPLETION-PLAN.md).
