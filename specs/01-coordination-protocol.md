<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# 01 — Two-agent coordination protocol

## Status: PROPOSED

Agent-agnostic contract for two coding agents sharing one working tree: **claude**
(Claude Code) and **codex** (Codex CLI), each in its own terminal.

This spec is the single source of truth. It is maintained in `trinoris-multi-agents` and
copied into each consuming working tree as `coordination/PROTOCOL.md`.
`.claude/skills/agent-handoff/SKILL.md` and
`AGENTS.md` are thin entry points that point here — if they ever disagree with this file,
this file wins.

## The problem being solved

Both agents see the same files and nothing else. There is no shared memory, no message
bus, and neither can observe the other's reasoning. Everything below is built from the
only primitive both have: **the filesystem**.

Three failure modes are worth the protocol's weight:

1. **Concurrent edits to the same file** — one agent's write silently discards the other's.
2. **Concurrent git operations** — a branch switch or commit while the other agent is
   mid-edit corrupts both agents' mental model of what is on disk.
3. **A dead agent holding a lock forever** — agents are not long-lived processes, so
   nothing releases a lock automatically.

## Verified environment facts

Measured in this working tree on 2026-10-25. Re-verify if the setup changes.

| Fact | Value |
| --- | --- |
| Filesystem | `v9fs` — WSL2's 9p bridge to the Windows drive (`/mnt/c/…` ↔ `C:\…`) |
| `mkdir` on an existing dir | fails — **usable as the lock primitive** |
| `>` with `noclobber` | fails on existing file — usable |
| `ln -s` on existing name | fails — usable |
| `flock` | binary exists, **must not be used** |

**Do not use `flock`.** Advisory locking over 9p is unreliable, and `flock` releases on
process exit — which is wrong for agents that work in discrete tool calls rather than
holding a file descriptor open. `mkdir` is the primitive: its exclusivity is enforced
where the directory is created, and it survives the agent's process ending.

**Cross-platform.** Codex may run on native Windows while Claude runs in WSL. Both see the
same bytes through `C:\` / `/mnt/c`. Therefore:

- The protocol is defined in terms of **operations** ("create a directory; failure means
  held"), never in terms of a shell snippet. Equivalents:
  - bash: `mkdir coordination/locks/engine.lock`
  - PowerShell: `New-Item -ItemType Directory coordination/locks/engine.lock`
- Write files as UTF-8 with LF endings.
- Treat paths as case-sensitive even though Windows is not. Never rely on case to
  distinguish two things.
- Both agents are on the **same machine**, so wall-clock timestamps are directly
  comparable. This is an assumption the lease mechanism depends on; if the agents are ever
  split across machines, leases must be reworked.

## Layout

```text
coordination/
├── PROTOCOL.md              this file
├── TEMPLATE-handoff.md      copy this to write a handoff (format: spec 03)
├── locks/<scope>.lock/      a lock. Directory presence = held
│   └── holder.json          who holds it, and until when
├── handoff/
│   ├── for-claude/          notes addressed to claude
│   └── for-codex/           notes addressed to codex
├── active/                  claimed notes, work in progress
├── archive/                 completed notes
├── incidents/               records of broken locks and protocol violations
└── heartbeat/<agent>.json   last-seen marker, for liveness only
```

## Scopes

Locks are taken on **names from this fixed registry**, never on arbitrary paths or globs.
Computing glob overlap is error-prone; a fixed list makes "do these two locks conflict?" a
string comparison.

| Scope | Covers |
| --- | --- |
| `engine` | `engine/` |
| `webapp` | `webapp/` |
| `api` | `api/`, `callbacks/` |
| `agents` | `chat-agent/`, `mailbox/` |
| `infra` | `infrastructure/`, `scripts/`, CI config |
| `specs` | `specs/`, `docs/` |
| `tests` | `tests/` at repo root |
| `root` | repo-root files: `package.json`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, … |
| `git` | **any** history-or-branch-mutating git operation. See below |

Rules:

- **Before editing a file, hold a lock whose scope covers it.** No lock, no write.
- A scope is held by at most one agent. There is no shared or read lock — reading needs no
  lock at all.
- Need two scopes? Acquire them **in the order listed in the table above**, always. This
  fixed ordering is what prevents deadlock; acquiring `webapp` then `engine` while the peer
  acquires `engine` then `webapp` deadlocks both.
- If a scope is missing from this table, add it here **first**, in a `root`-locked edit,
  before using it.

### The `git` scope

Holding `git` is required for: `commit`, `checkout`/`switch`, `branch`, `merge`, `rebase`,
`reset`, `stash`, `tag`, `push`, `pull`/`fetch --prune`, and anything touching the index
(`add`, `rm`, `restore --staged`).

Read-only git needs **no** lock: `status`, `log`, `diff`, `show`, `ls-files`, `rev-parse`,
`blame`.

A branch switch changes every file under both agents' feet, so `git` is the one scope
where holding it while the peer is mid-edit is actively destructive. **Never switch
branches while any other scope lock is held by the peer** — check `locks/` first, and if
any peer lock is live, write a handoff asking for the switch instead of forcing it.

## Locks

### Acquire

1. Create the directory `coordination/locks/<scope>.lock`.
   - Success → you hold it. Continue to step 2.
   - Failure → held by someone. Go to **Contention**.
2. Immediately write `holder.json` inside it:

```json
{
  "agent": "claude",
  "scope": "engine",
  "task": "one line: what you are doing and why",
  "acquired_at": "2026-10-25T14:03:11Z",
  "expires_at": "2026-10-25T14:18:11Z",
  "handoff": "coordination/active/2026-10-25T1402-rename-engine-fields.md"
}
```

Default lease: **15 minutes**. `handoff` is optional but strongly preferred — it tells the
peer where to read the full context instead of guessing from one line.

### Hold and renew

- While working, rewrite `holder.json` with a pushed-out `expires_at` at least every
  **5 minutes of active work**. A lease is a promise you are still alive, not a reservation.
- **Re-read `holder.json` and confirm you are still the holder immediately before each
  batch of writes.** If the lease expired and the peer broke the lock, you no longer hold
  it and must stop and re-acquire — your in-memory belief is not authority.

### Release

Delete the lock directory. Release as soon as the edit is done; do not hold a lock across
a long analysis or while waiting for the user.

### Contention

Read the peer's `holder.json`:

- **Lease still valid** → do not wait or spin. Pick different work in another scope, or
  write a handoff note into `handoff/for-<peer>/` and stop. Blocking on a lock wastes a
  whole agent.
- **`expires_at` in the past by more than the 5-minute grace** → you may break it.
- **`holder.json` missing or unparseable** → the lock is malformed; the acquirer died
  between creating the directory and writing its metadata. You may break it once the
  **lock directory's own mtime** is older than the grace period.

### Breaking a lock

Breaking is permitted and sometimes necessary. Doing it silently is not.

1. Write `coordination/incidents/<ISO8601>-broken-<scope>.md` recording: who you are, the
   scope, the holder you evicted, that holder's `acquired_at`/`expires_at`, why you judged
   it dead, and what you intend to do next.
2. Delete the lock directory.
3. Acquire it fresh, your own `holder.json`.
4. **Assume the evicted agent left the tree mid-edit.** Run `git status` and the relevant
   tests before building on what you find. A broken lock means the work in that scope is of
   unknown quality, not that it is absent.

## Handoffs

### Writing one

Write `coordination/handoff/for-<peer>/<ISO8601>-<slug>.md` using the format in
[`03-handoff-format.md`](03-handoff-format.md). A consuming tree may keep a copy of that
format as `coordination/TEMPLATE-handoff.md`; the spec is authoritative.

Release your locks **before** writing the note, so the peer can act on it immediately.

### Claiming one

Claiming is a `mv` of the file from `handoff/for-<you>/` into `coordination/active/`. A
`mv` to a path that does not exist is the atomic claim — if two agents race, one `mv`
succeeds and the other finds the file gone. **No lock is needed to claim**, and an agent
must never edit a note sitting in the peer's `for-<peer>/` directory.

### Finishing one

`mv` the note from `active/` to `archive/`, appending an `## Outcome` section: what landed,
what did not, and what is now true. The archive is the project's memory of who did what and
why — keep it honest rather than tidy.

## The verified/assumed split

Every handoff separates **Verified** from **Assumed**, and this is the part that makes
handoffs worth reading.

- **Verified** — you ran something and saw the result. Cite the command and the outcome.
  "`cd engine && npm test` → 1,973 passed" is verified.
- **Assumed** — you believe it but did not check. Mark it `(not verified)`.

This mirrors the convention already used across `specs/` and `specs/security-hardening/`.
A handoff that states assumptions as facts is worse than no handoff: the peer builds on it
and the error compounds silently. **If you are unsure which column something belongs in,
it is assumed.**

## Heartbeat

Optional, liveness only. An agent may write `coordination/heartbeat/<agent>.json`:

```json
{ "agent": "claude", "at": "2026-10-25T14:03:11Z", "status": "working on engine rename" }
```

It answers "is my peer alive at all". It is **not** a lock and confers no rights. A fresh
heartbeat does not protect an expired lease, and a missing heartbeat is not permission to
break a live one.

## Hard rules

1. No lock, no write. Reading is always free.
2. Never edit a path outside a scope you hold.
3. Acquire multiple scopes in registry order, always.
4. Re-verify you hold the lock immediately before writing.
5. Never break a lock without an incident record.
6. Never switch branches, rebase or reset while the peer holds any lock.
7. Never force-push, and never rewrite a commit you did not create.
8. Never edit a note in the peer's `for-<peer>/` directory, and never edit a note in
   `active/` that you did not claim.
9. Release locks before writing a handoff and before stopping.
10. State assumptions as assumptions.

## Deliberate non-goals

- **No queue, no priorities, no scheduler.** Two agents and a human do not need one, and
  the mechanism would cost more than the contention it resolves.
- **No automatic conflict resolution.** If both agents changed the same file, a human
  decides. The protocol's job is to make that rare and visible, not to merge.
- **No enforcement.** Nothing here is checked by a hook. It works because both agents
  follow it, so it is written to be followed under time pressure rather than to be
  complete.
