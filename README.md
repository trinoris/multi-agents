<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# trinoris-multi-agents

Coordination protocol for two coding agents sharing one working tree — **claude**
(Claude Code) and **codex** (Codex CLI), each in its own terminal.

## Status: SPECS ONLY — nothing implemented

Deliberately spec-first. The mechanism's failure mode is silent data loss, so the design
is settled and the tests are written before any code exists. `MA-T01` in
[`specs/05-verification.md`](specs/05-verification.md) gates everything: if `mkdir` is not
atomic under real concurrency on the target filesystem, the protocol does not apply there.

## What it is

Both agents see the same files and nothing else — no shared memory, no message bus, no way
to observe each other's reasoning. The protocol is built from the only primitive they
share: **the filesystem**.

- **Scope locks** — `mkdir` as the atomic primitive, with a lease, because nothing releases
  a lock when an agent that works in discrete tool calls stops existing.
- **Handoff notes** — markdown, claimed atomically by `mv`, separating what was *verified*
  from what was *assumed*.
- **Incident records** — breaking a lock is allowed; doing it silently is not.

## Specs

| Spec | Contents |
| --- | --- |
| [`01-coordination-protocol.md`](specs/01-coordination-protocol.md) | **The contract.** Scope registry, lock rules, handoff lifecycle, hard rules. If anything else disagrees with this, this wins |
| [`02-lock-mechanism.md`](specs/02-lock-mechanism.md) | Why `mkdir` and not `flock`, the two-step acquire window, lease tuning, deadlock prevention by scope ordering, the ABA case — and what the mechanism does not protect against |
| [`03-handoff-format.md`](specs/03-handoff-format.md) | Note format, claim-by-`mv`, the verified/assumed split, anti-patterns |
| [`04-agent-entry-points.md`](specs/04-agent-entry-points.md) | Binding each tool: Claude's `SKILL.md`, Codex's `AGENTS.md`, thin pointers only |
| [`05-verification.md`](specs/05-verification.md) | `MA-T01…T11`, the adoption sequence, and the rules that are honestly untestable |

## Three design decisions worth knowing up front

**`flock` is rejected.** It is the textbook answer and it is wrong twice here: advisory
locks over WSL2's 9p bridge are unreliable, and `flock` releases on process exit — which
happens after every agent tool call. `mkdir` survives the agent's process ending.

**Scopes are a fixed registry, not path globs.** Deciding whether two locks conflict is
then a string comparison instead of glob-overlap arithmetic. Scopes are acquired in
registry order, and that total ordering is the only deadlock defence.

**Presence of a lock is not proof of ownership.** A slow agent whose lease expired and was
evicted will find the directory exactly as it left it. Only the `agent` field in
`holder.json` is authority — hence the rule to re-confirm ownership immediately before
every batch of writes.

## Verified environment facts

Measured 2026-10-25 in `/mnt/c/Users/Hai-Linh/trinoris/trinoris-control-tower`:

| Fact | Value |
| --- | --- |
| Filesystem | `v9fs` (WSL2 ↔ Windows drive) |
| `mkdir` / `noclobber` / `ln -s` on existing name | all fail — usable as lock primitives |
| `flock` | present, **rejected** |

Exclusivity was measured **sequentially**. True atomicity under concurrent load is
`MA-T01` and is **(not verified)**.

## Non-goals

No queue, no priorities, no scheduler, no automatic conflict resolution, and no
enforcement. The protocol makes collisions rare and visible between two cooperating
agents. It is not a sandbox, and it does not defend against an agent that ignores it or a
human saving over both of them from an editor.
