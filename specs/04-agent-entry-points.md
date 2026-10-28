<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# 04 — Agent entry points

## Protocol 3 implementation notice

The historical analysis below describes the original protocol and proposed tool behavior.
The shipped `0.2.0` implementation uses protocol 3 and the versioned package-owned contract in
`packages/core/src/protocol.ts`; setup installs its exact bytes and verify checks its digest
under `.trinoris/`.
[Security hardening](07-security-hardening.md) maps current behavior to regression tests.
All mutations now share one guard; lease commands require a generation, claims validate
recipients and use per-instance destinations, and heartbeat/daemon operation is explicitly
unsupported. Git mutations use the conservative mutually exclusive `git` scope. Historical
MA-T results remain evidence of their recorded runs, not proof of the current SDK or a new
filesystem. Keep stable MA-T IDs when adding current regressions.

Setup currently adds managed, idempotent pointers to `AGENTS.md` for Codex, Kiro, and
Cursor, and `CLAUDE.md` for Claude Code, preserving existing text around each block. Kiro
and Cursor both automatically load root `AGENTS.md` ([Kiro steering docs](https://kiro.dev/docs/steering/),
[Cursor rules docs](https://cursor.com/docs/rules)); setup therefore does not create
parallel `.kiro/` or `.cursor/` rules that could drift. It also installs
`.claude/skills/agent-handoff/SKILL.md` with a clear description of when Claude should use
it. The default configuration includes `cursor` as a handoff routing class. Both entry
points point to `.trinoris/PROTOCOL.md` and
`.trinoris/handoff/TEMPLATE.md`; verify requires those pointers to remain present.


## Historical design status: PROPOSED (superseded by protocol 3)

The proposal below describes the original binding design. The current generated entry
points and setup behavior are summarized above; old command examples are historical and
must not replace the CLI contract in specs 03, 05, and 06.

How each tool is bound to the protocol. The protocol is useless if an agent has to be told
about it by the human on every session — the binding has to be something each tool loads on
its own.

## Principle: thin pointers, one source of truth

Each tool gets a small file in the location that tool loads automatically. Every one of
them **points at `specs/01-coordination-protocol.md` and restates nothing of substance.**

Duplicating the rules per tool guarantees they drift, and a drifted protocol is worse than
none: two agents each follow their own copy, both believing they are coordinating. The
entry point's only jobs are: say the protocol exists, say where it is, and state the two or
three rules an agent must apply *before* it has read anything else.

| Tool | File it loads automatically | Role |
| --- | --- | --- |
| Claude Code | `.claude/skills/agent-handoff/SKILL.md` | Invoked skill, plus a line in `CLAUDE.md` so it is known about unprompted |
| Codex CLI | `AGENTS.md` at repo root | Automatically loaded project instructions |
| Kiro | `AGENTS.md` at repo root | Automatically loaded as steering; no duplicate `.kiro/steering/` file required |
| Cursor | `AGENTS.md` at repo root | Automatically loaded project instructions; no duplicate `.cursor/rules/` file required |

## Claude Code — the skill

`.claude/skills/agent-handoff/SKILL.md`:

```markdown
---
name: agent-handoff
description: Coordinate with the Codex agent sharing this working tree — acquire and
  release scope locks, write and claim handoff notes. Use before editing any file when a
  second agent may be active, and before any branch or commit operation.
---

Read `.trinoris/PROTOCOL.md` before acting. It is the contract; this file is a pointer.

Before your first write in a session:
1. `ls .trinoris/locks/` — if a scope you need is held and its lease is live, do not
   wait. Pick other work or write a handoff.
2. Acquire by `mkdir .trinoris/locks/<scope>.lock`, then immediately write
   `holder.json`.
3. Re-confirm you are the holder immediately before each batch of writes.

Release as soon as the edit is done. Release before writing a handoff and before stopping.
```

`CLAUDE.md` additionally carries one line, because a skill is only loaded once invoked and
the agent must know to invoke it:

```markdown
A second agent (Codex) may share this working tree. Before editing, read
`.trinoris/PROTOCOL.md` and hold the lock for the scope you are editing.
```

## Codex, Kiro, and Cursor — `AGENTS.md`

All three tools read the generated root `AGENTS.md`, which points to the same installed
protocol and handoff template. Kiro calls this workspace steering; Cursor documents it as
a simple alternative to project rules.

```markdown
# Agent instructions

A second agent (Claude Code) may share this working tree.

**Read `.trinoris/PROTOCOL.md` before editing anything.** It is the contract.

Non-negotiable:
- No lock, no write. Reading is free.
- Acquire a scope with `mkdir .trinoris/locks/<scope>.lock`, then immediately write
  `holder.json`. Failure to create means it is held — do not wait, do not spin.
- Never switch branches, rebase, reset or commit while the peer holds any lock.
- Re-confirm you hold the lock immediately before each batch of writes.
- Release before writing a handoff and before stopping.

Handoffs addressed to you are in `.trinoris/handoff/for-codex/`. Claim one by moving it
to `.trinoris/active/`.
```

## The asymmetry worth noting

The tools differ in how they load their instructions, and the protocol must
not assume parity:

- Claude Code loads `CLAUDE.md` automatically and skills on invocation.
- Codex, Kiro, and Cursor load `AGENTS.md` automatically.

Neither guarantees the agent *acts* on what it read. So the protocol is written to be
**safe when one side is sloppy**: an agent that acquires locks correctly is protected from
one that does not *notice* a lock, because the careful agent still holds the directory and
will see the peer's writes in `git status`. It is **not** protected from an agent that
deliberately writes without locking. That residual risk is accepted and named in spec 02.

## Adoption per repo

The protocol is per-working-tree, because the thing being protected is a working tree. Two
agents in two different clones of the same repo do not need it; two agents in one clone do.

What a consuming repo gets:

```text
.trinoris/              scaffolding (locks/, handoff/, active/, archive/, incidents/)
.trinoris/PROTOCOL.md   copied, or symlinked from this repo
AGENTS.md                  Codex, Kiro, and Cursor entry point
.claude/skills/agent-handoff/SKILL.md
CLAUDE.md                  one pointer line added
```

The CLI installs a copy of the package-owned contract because symlinks are unreliable on
Windows and in archives. `verify` checks the installed protocol version and digest so drift
is detected before the workspace is declared ready.

## Historical open questions — resolved by implementation

- **Installable package:** shipped as the `@trinoris/agent-*` package family with the
  `trinoris-agent` CLI. See specs 05 and 06 for the current adoption and command contract.
- **Additional agents:** protocol 3 routes by configurable agent class and instance; it is
  not limited to two agents. Tool-specific entry points remain thin pointers.
