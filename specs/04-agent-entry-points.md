<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# 04 — Agent entry points

## Status: PROPOSED

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
| Codex CLI | `AGENTS.md` at repo root | Codex's own convention |
| Kiro (already present in Control Tower) | `.kiro/steering/*.md` | Add only if Kiro joins the protocol |

## Claude Code — the skill

`.claude/skills/agent-handoff/SKILL.md`:

```markdown
---
name: agent-handoff
description: Coordinate with the Codex agent sharing this working tree — acquire and
  release scope locks, write and claim handoff notes. Use before editing any file when a
  second agent may be active, and before any branch or commit operation.
---

Read `coordination/PROTOCOL.md` before acting. It is the contract; this file is a pointer.

Before your first write in a session:
1. `ls coordination/locks/` — if a scope you need is held and its lease is live, do not
   wait. Pick other work or write a handoff.
2. Acquire by `mkdir coordination/locks/<scope>.lock`, then immediately write
   `holder.json`.
3. Re-confirm you are the holder immediately before each batch of writes.

Release as soon as the edit is done. Release before writing a handoff and before stopping.
```

`CLAUDE.md` additionally carries one line, because a skill is only loaded once invoked and
the agent must know to invoke it:

```markdown
A second agent (Codex) may share this working tree. Before editing, read
`coordination/PROTOCOL.md` and hold the lock for the scope you are editing.
```

## Codex CLI — `AGENTS.md`

Codex reads `AGENTS.md` from the repo root by convention. It gets the equivalent content,
in its own file, pointing at the same protocol:

```markdown
# Agent instructions

A second agent (Claude Code) may share this working tree.

**Read `coordination/PROTOCOL.md` before editing anything.** It is the contract.

Non-negotiable:
- No lock, no write. Reading is free.
- Acquire a scope with `mkdir coordination/locks/<scope>.lock`, then immediately write
  `holder.json`. Failure to create means it is held — do not wait, do not spin.
- Never switch branches, rebase, reset or commit while the peer holds any lock.
- Re-confirm you hold the lock immediately before each batch of writes.
- Release before writing a handoff and before stopping.

Handoffs addressed to you are in `coordination/handoff/for-codex/`. Claim one by moving it
to `coordination/active/`.
```

## The asymmetry worth noting

The two tools differ in how reliably they load their instructions, and the protocol must
not assume parity:

- Claude Code loads `CLAUDE.md` automatically and skills on invocation.
- Codex loads `AGENTS.md` automatically.

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
coordination/              scaffolding (locks/, handoff/, active/, archive/, incidents/)
coordination/PROTOCOL.md   copied, or symlinked from this repo
AGENTS.md                  Codex entry point
.claude/skills/agent-handoff/SKILL.md
CLAUDE.md                  one pointer line added
```

`(pending)` Copy or symlink? A copy drifts; a symlink breaks on Windows-side checkouts and
in zips. Leaning toward a copy plus a version line in the header, with a check in spec 05
that flags divergence. Decide before first adoption.

## Not in scope here

- Shipping this as an installable package. Spec 05 covers adoption mechanics; packaging is
  a later question and depends on the copy-vs-symlink decision above.
- A third agent. The protocol generalises to N agents unchanged — the scope registry and
  lease logic do not care — but the `for-<agent>/` directory layout and the two-agent
  assumptions in the non-goals would need revisiting.
