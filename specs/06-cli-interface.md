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

`trinoris-agent` exposes the protocol 3 setup, verification, lease, claim, diagnosis, and
explicit recovery operations. It delegates filesystem coordination to `@trinoris/agent-sdk`
and validation to `@trinoris/agent-core`.

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

The current top-level help is available with `trinoris-agent --help` or `trinoris-agent
-h`. Help is not implemented per subcommand. There is no current `--version` option.

### Common options

| Option | Current behavior |
| --- | --- |
| `--work-dir <path>` | Target checkout; defaults to the current working directory. |
| `--agent-class <name>` | Coordination label. Stateful commands require it explicitly; other commands currently default it to `claude-opus-5`. |
| `--instance <id>` | Explicit coordination label. Stateful commands require it explicitly; other commands generate an unused per-invocation value when omitted. |
| `--json` | Emits successful command results as JSON. Parse and runtime errors remain bounded plain text on stderr. |

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
| `status` | `--scope <scope>` | Inspects one registered lease or all lease directories. It does not list handoffs or all incident records. |
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

When `--json` is supplied, successful results are one JSON value on stdout. Current errors
are human-readable bounded text on stderr, not a JSON error envelope. Scripts must use the
exit code as the success signal and must not parse human error strings as a stable API.

`status` is a lease view. `diagnose` is a marker-recovery view. Recent incidents are
included in acquisition results and in takeover results, but there is no current standalone
incident-list command.

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
  rejection, diagnosis, and recovery.
- `packages/cli/src/commands/setup.security.test.ts` — safe and idempotent setup plus
  package-owned protocol installation.
- `packages/cli/src/commands/verify.test.ts` — readiness, filesystem probe bounds, and
  cancellation behavior.
- `packages/cli/src/commands/release-inputs.test.ts` and
  `packages/cli/src/commands/release.security.test.ts` — release manifest, artifact, and
  credential boundaries.
- `packages/cli/src/commands/packed.integration.test.ts` — packed artifacts and offline
  consumer journey.

## Planned, not current

The following are roadmap items only; they are not implemented CLI contracts:

- a dedicated incident-list view;
- machine-readable error envelopes, per-command help, and `--version`.

Implementation order and acceptance criteria are maintained in
[`docs/planning/CLI-MODE-COMPLETION-PLAN.md`](../docs/planning/CLI-MODE-COMPLETION-PLAN.md).
