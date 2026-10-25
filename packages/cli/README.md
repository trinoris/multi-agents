# `@trinoris/agent-cli` user guide

`trinoris-agent` coordinates cooperating coding agents in one working tree. It reserves
registered scopes, validates handoff recipients, and records takeover attempts and outcomes.
It does not authenticate agents, sandbox editors, or prevent direct uncoordinated writes.

## Architecture

```text
 Agent session A                 Agent session B
 stable instance + generation    stable instance + generation
          |                               |
          +--------- trinoris-agent ------+
                          |
                     agent-sdk
                          |
        atomic mkdir: .trinoris/.mutation
                          |
          +---------------+---------------+
          |               |               |
    locks/<scope>/   handoff -> active/   incidents/
    holder.json      <instance>/         attempted/completed/failed
    generation       note + receipt      preserved stale state
                          |
                agent-core validation
                package-owned protocol
```

Every mutation uses the same short filesystem guard, including Git policy checks and
handoff moves. A busy guard returns contention; agents must choose other work, not spin.
The guard is never stolen because of its age or a PID. A stopped actor may leave it behind;
explicit operator recovery preserves the reason and operation identity.

## Best uses and boundaries

- Coordinate several agents editing different scopes in the same checkout.
- Pass verified context and next steps through addressed handoff notes.
- Inspect interrupted work before a safe takeover.
- Verify the actual filesystem after onboarding a checkout or changing a mount.

Use isolated working trees or an enforcing service for hostile actors, multiple machines,
or strict write exclusion. A process can pause between checking a lease and making its edit;
the CLI cannot fence that edit. Cloned coordination directories do not coordinate clones.

## Install and adopt

Published consumer packages declare Node.js 18+. The repository build/test toolchain
requires Node.js 20+. From source, build workspace dependencies before running the CLI:

```bash
pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile
pnpm build
node packages/cli/dist/bin.js setup --work-dir /path/to/repository
node packages/cli/dist/bin.js verify --work-dir /path/to/repository --trials 5 --concurrency 4
```

Setup installs a complete package-owned protocol and digest. It retains existing regular
files unless `--force` is explicit, refuses links/special files, and reports replacements.
It never copies instructions from an arbitrary target repository's `specs/` directory.
Review generated `.trinoris/PROTOCOL.md`, `AGENTS.md`, and the skill pointer before allowing agents
into the working tree. Force setup refuses retained locks; stop actors and resolve them first.

`verify --json` reports `structureOk`, `configOk`, `protocolOk`, `gitignoreOk`, `atomicityOk`, and `ready`.
Only `ready: true` passes adoption. Missing/divergent protocols block readiness independently
of mkdir results. Sandbox restrictions are inconclusive (`atomicityOk: null`), not proof
that mkdir is non-atomic. Repeat on the same filesystem with worker permission.

## Lease lifecycle

Use a stable explicit instance for the session. Acquire returns a new **generation**;
retain it and pass it to every subsequent lease operation. Do not read the current holder
and adopt someone else's generation as a replacement for the one returned to you.

```bash
trinoris-agent acquire --work-dir /repo --agent-class codex-gpt-6 \
  --instance codex-session-a --scope api --task 'Validate requests' --json

# Copy the generation from the acquisition response.
trinoris-agent check --work-dir /repo --instance codex-session-a \
  --scope api --generation <generation>
trinoris-agent renew --work-dir /repo --instance codex-session-a \
  --scope api --generation <generation>
trinoris-agent release --work-dir /repo --instance codex-session-a \
  --scope api --generation <generation>
```

Check immediately before each batch of edits. A lease is live at the exact expiry instant;
afterwards checks and renewal fail. Grace delays takeover and does not authorize continued
editing. Release can safely remove an expired lease only with its matching generation.
An identity string alone never authorizes check/renew/release in protocol 3.

Registry order governs acquisition. `acquire-many --scopes api,tests --instance SESSION`
sorts by that order and rolls back its new leases if any scope is contended. Acquiring a
lower scope while holding a higher one fails. The conservative `git` scope covers all Git
mutations: peer editing leases block it, and a peer Git lease blocks new editing leases.
Actual Git commands still require the agents to follow the protocol.

## Handoffs

Release the author's scopes, then publish a uniquely named `.md` note under
`.trinoris/handoff/for-<class>/` (or `for-any/` for an explicitly universal note).

```markdown
---
from_class: claude-opus-5
from_instance: claude-session-b
to_class: codex-gpt-6
to_instance: any
scopes: api,tests
status: ready
created: 2026-10-25T10:00:00.000Z
---

# Validate requests

## Context

Requests need stricter validation.

## Task

Add the boundary checks.

## What I Verified

- Existing tests cover valid requests.

## What I Assumed

- The public schema stays compatible.
```

```bash
trinoris-agent claim --work-dir /repo --agent-class codex-gpt-6 \
  --instance codex-session-a --note validate-requests.md --json
```

The SDK validates recipient class/instance, status, schema, registered scopes, and scope
availability. `any` is supported only when explicit. Duplicate or unknown frontmatter,
invalid dates, and incomplete sections fail validation. Claim does not acquire editing
scopes; acquire those separately before writing.

The destination is `active/<instance>/<filename>`. Existing active content is preserved
on conflict. A digest/claimant receipt identifies an identical retry and permits recovery
of an interrupted matching move. `--from` accepts a logical class inbox; `--to` must equal
the claimant's instance directory. Unrestricted filesystem paths and shared `active/`
destinations are no longer accepted.

## Takeover and operator recovery

```bash
trinoris-agent break --work-dir /repo --agent-class claude-opus-5 \
  --instance recovery-session --scope api --reason 'Prior actor confirmed stopped' --json
trinoris-agent diagnose --work-dir /repo --json
```

A break requires expiry plus grace (or a malformed directory older than grace). It
serializes against every other mutation, preserves stale state, and returns a new generation.
Structured incident events say `attempted`, `completed`, or `failed`; an attempt alone is
never evidence of successful takeover. Acquisition surfaces recent scope incidents.
Inspect those events, `git status`, and relevant tests before editing interrupted work.
Reasons are assertions, not proof the old process stopped. Local records remain writable
by the same filesystem principals; they are not independently authenticated audit evidence.

If a process crashes with a marker, stop **all affected actors**, inspect the marker and
operation ID, then recover explicitly:

```bash
trinoris-agent recover --work-dir /repo --instance operator-session \
  --marker .mutation --operation <exact-operation-id> \
  --reason 'All affected actors stopped; retained state inspected' --confirm-stopped
```

For an incomplete/corrupt marker, `diagnose` reports missing or invalid metadata; use
`--operation unknown` only after the same offline inspection. Recover leftover
`locks/<scope>.breaking` and `claims/<digest>.claim` markers separately. Recovery refuses
a changed operation ID. An abandoned `.recovery` marker requires offline operator inspection
with every actor stopped; it is never automatically reclaimed.

## Configuration, limits, and compatibility

Canonical configuration is `.trinoris/config.json`; the CLI and SDK read it only from the
selected `.trinoris/` root. Setup does not create an external configuration mirror. It adds
`/.trinoris/` to the target repository's `.gitignore`, so local coordination state is not
committed. The package-owned contract lives at `.trinoris/PROTOCOL.md`; generated
`AGENTS.md` and Claude skill instructions point there. Custom SDK roots do not inherit
configuration from an unrelated parent. SDK callers without an installed configuration
use the built-in registry; the CLI requires installed configuration.

Lease: 1–1440 minutes. Grace: 0–60 minutes. Identifiers: at most 96 plain characters;
filenames: at most 160. Records/config: at most 64 KiB; notes: at most 256 KiB.
Verifier: 1–100 trials, 2–32 workers, at most 1024 total worker launches, and a 60-second
overall deadline. Workers yield while waiting and terminate on timeout/abort.

Heartbeats and daemon operation are unsupported in protocol 3; `heartbeat.enabled` must
remain false. Protocol 1 records may be inspected and safely taken over after expiry/grace,
but generation-less records never authorize check, renewal, or release. Stop all old agents
but generation-less records never authorize check, renewal, or release. Stop all old agents
before upgrading. Protocol 2 used the top-level `coordination/` path; protocol 3 uses
`.trinoris/`. With all actors stopped, move the old directory to an offline backup outside
the working tree. Review and selectively preserve handoff/archive/incident history; do not
restore active locks or mutation markers. Run `setup` to create a fresh `.trinoris/`, inspect
its generated instructions, then run `verify` before starting only protocol 3 clients. Do not
run protocol 2 and 3 clients concurrently.

## Exit codes and automation

| Exit | Meaning | Caller action |
| --- | --- | --- |
| 0 | Success | Retain returned generation/receipt; continue within its scope |
| 1 | Invalid input, incomplete readiness, conflict, or uncertain I/O | Inspect and correct; do not assume success |
| 3 | Contention | Pick other work or hand off; never spin |
| 4 | Lease lost or cannot be confirmed | Stop editing and safely reacquire |

`--json` gives structured stdout. Errors use bounded escaped stderr. Keep secrets out of
all task/reason/note fields. Runtime tests and release gates live alongside package code.
The installed `.trinoris/PROTOCOL.md` is self-contained; adopters do not need repository specifications.

Apache-2.0 — see [LICENSE](./LICENSE).

<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->
