<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# 01 — Shared-worktree agent coordination protocol

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


## Historical design status: PROPOSED (superseded by protocol 3)

Agent-agnostic contract for multiple coding agents sharing one working tree. Agents are
identified by **model class** (e.g., `codex-gpt-6`, `claude-opus-5`) with unique
**instance IDs** at runtime (e.g., `codex-gpt-6-a3f2`).

This document preserves the original design and rationale. The package-owned, versioned
contract in `packages/core/src/protocol.ts` is authoritative for shipped behavior; setup
copies those exact bytes into each consuming working tree as `.trinoris/PROTOCOL.md`.
`.claude/skills/agent-handoff/SKILL.md` and
`AGENTS.md` are thin entry points to that installed contract. If this historical document
differs from the installed contract, the package-owned protocol wins.

## The problem being solved

Multiple agents see the same files and nothing else. There is no shared memory, no message
bus, and agents cannot observe each other's reasoning. Everything below is built from the
only primitive all have: **the filesystem**.

Three failure modes are worth the protocol's weight:

1. **Concurrent edits to the same file** — one agent's write silently discards the other's.
2. **Concurrent git operations** — a branch switch or commit while another agent is
   mid-edit corrupts both agents' mental model of what is on disk.
3. **A dead agent holding a lock forever** — agents are not long-lived processes, so
   nothing releases a lock automatically.

## Agent identity

Each agent has two identifiers:

- **Agent class** — the model type: `codex-gpt-6`, `claude-opus-5`, `claude-sonnet-4`, etc.
  This is static per agent and used for capability-based routing.
- **Agent instance** — unique runtime ID: `codex-gpt-6-a3f2`, `claude-opus-5-x9k2`, etc.
  Generated at startup (UUID suffix) or explicit. This identifies a specific running
  instance.

Multiple instances of the same class can work in parallel on different scopes. Handoffs are
addressed to a **class** (any instance can claim) or a specific **instance** (only that one
can claim).

## Verified environment facts

Measured in this working tree on 2026-10-25. Re-verify if the setup changes.

| Fact | Value |
| --- | --- |
| Filesystem | `v9fs` — WSL2's 9p bridge to the Windows drive (`/mnt/c/…` ↔ `C:\…`) |
| `mkdir` on an existing dir | fails — **usable as the lock primitive** |
| `>` with `noclobber` | fails on existing file — usable |
| `ln -s` on existing name | fails — usable |
| `flock` | binary exists, **must not be used** |
| `mkdir` under real concurrency | atomic — verified, 4,200 racing processes (N=2/8/32 × 100 trials), exactly one winner every trial |
| `mv -n` as an atomic claim | **not atomic** — it is stat-then-rename in userspace and returns success when it declines. Verified: 2 claimers out of 8 racers |
| WSL ↔ Windows lock visibility | works both directions, `holder.json` readable both ways — verified via `powershell.exe` |

**Do not use `flock`.** Advisory locking over 9p is unreliable, and `flock` releases on
process exit — which is wrong for agents that work in discrete tool calls rather than
holding a file descriptor open. `mkdir` is the primitive: its exclusivity is enforced
where the directory is created, and it survives the agent's process ending.

**Cross-platform.** Codex may run on native Windows while Claude runs in WSL. Both see the
same bytes through `C:\` / `/mnt/c`. Therefore:

- The protocol is defined in terms of **operations** ("create a directory; failure means
  held"), never in terms of a shell snippet. Equivalents:
  - bash: `mkdir .trinoris/locks/engine.lock`
  - PowerShell: `New-Item -ItemType Directory .trinoris/locks/engine.lock`
- Write files as UTF-8 with LF endings.
- Treat paths as case-sensitive even though Windows is not. Never rely on case to
  distinguish two things.
- Both agents are on the **same machine**, so wall-clock timestamps are directly
  comparable. This is an assumption the lease mechanism depends on; if the agents are ever
  split across machines, leases must be reworked.

## Layout

```text
.trinoris/
├── PROTOCOL.md              this file
├── TEMPLATE-handoff.md      copy this to write a handoff (format: spec 03)
├── locks/<scope>.lock/      a lock. Directory presence = held
│   ├── holder.json          who holds it, and until when
│   └── (locks/<scope>.breaking/ — transient: the right to break this lock)
├── claims/<note>.claim/     transient: the right to claim a handoff note
├── handoff/
│   ├── for-codex-gpt-6/          notes addressed to any codex-gpt-6 instance
│   ├── for-claude-opus-5/        notes addressed to any claude-opus-5 instance
│   └── for-claude-sonnet-4/      notes addressed to any claude-sonnet-4 instance
├── active/
│   ├── codex-gpt-6-a3f2/         instance a3f2's claimed work
│   ├── codex-gpt-6-b1d8/         instance b1d8's claimed work
│   └── claude-opus-5-x9k2/       instance x9k2's claimed work
├── archive/                      completed notes (all instances)
│   └── INDEX.md                  one-line entries: filename, scopes, outcome
├── incidents/                    records of broken locks and protocol violations
└── heartbeat/
    ├── codex-gpt-6-a3f2.json     per-instance heartbeat
    ├── codex-gpt-6-b1d8.json
    └── claude-opus-5-x9k2.json
```

## What is version-controlled

The entire `.trinoris/` directory is ignored. It contains working-tree-local coordination
state: configuration, the installed contract, leases, in-flight handoffs, active notes,
archives, and incidents. `setup` adds the root-anchored `/.trinoris/` rule to the consuming
repository's `.gitignore`. Archive and incident files are local history, not a shared audit
trail across clones; use a separately governed durable store if cross-clone retention is
required.

**A committed lock is a phantom lock.** A fresh clone would show a lease held by an agent
that is not running. A top-level ignore rule also prevents protocol copies from being
mistaken for shared coordination across clones. Standard agent entry points such as
`AGENTS.md` and installed skill files remain outside `.trinoris/` so tools can discover them.

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
| `packages` | `packages/` — package source, package-local tests, and package metadata |
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
where holding it while the peer is mid-edit is actively destructive. **Before acquiring
`git` for any branch-mutating operation** (`checkout`, `switch`, `merge`, `rebase`,
`reset`), **`ls .trinoris/locks/` and abort if any peer lock with a live lease exists.**
Read each peer lock's `holder.json` to check `expires_at`. If any peer lock is live, write
a handoff asking for the switch instead of forcing it. Commits and index operations are
safe to perform while peer locks are held, as they don't change the working tree.

## Locks

### Acquire

1. **Check for recent incidents in this scope**: `ls incidents/ | grep <scope>`. If any
   incident file for this scope exists with a timestamp less than 1 hour old, read it
   before proceeding. You may be re-acquiring after an eviction, or the peer may have
   discovered corruption.
2. Create the directory `.trinoris/locks/<scope>.lock`.
   - Success → you hold it. Continue to step 3.
   - Failure → held by someone. Go to **Contention**.
3. Immediately write `holder.json` inside it:

```json
{
  "agent_instance": "codex-gpt-6-a3f2",
  "agent_class": "codex-gpt-6",
  "scope": "engine",
  "task": "one line: what you are doing and why",
  "acquired_at": "2026-10-25T14:03:11Z",
  "expires_at": "2026-10-25T14:18:11Z",
  "handoff": ".trinoris/active/codex-gpt-6-a3f2/2026-10-25T1402-rename-engine-fields.md"
}
```

Default lease: **15 minutes**. `handoff` is optional but strongly preferred — it tells
peers where to read the full context instead of guessing from one line.

### Hold and renew

- While working, rewrite `holder.json` with a pushed-out `expires_at` at least every
  **5 minutes of active work**. A lease is a promise you are still alive, not a reservation.
- For long operations (>5 minutes) that cannot be checkpointed, write
  `.trinoris/heartbeat/<agent-instance>.json` every 2 minutes as a lightweight liveness signal:
  ```json
  {
    "agent_instance": "codex-gpt-6-a3f2",
    "agent_class": "codex-gpt-6",
    "at": "2026-10-25T14:03:11Z",
    "scope": "engine"
  }
  ```
  This does not extend the lease, but it helps distinguish "slow operation in progress"
  from "dead agent" when peers evaluate breakability. A peer seeing a fresh heartbeat
  (< 3 minutes old) for the lock holder should wait an additional grace period before
  breaking.
- **Re-read `holder.json` and confirm you are still the holder immediately before each
  batch of writes.** If the lease expired and a peer broke the lock, you no longer hold
  it and must stop and re-acquire — your in-memory belief is not authority.

### Release

Delete the lock directory. Release as soon as the edit is done; do not hold a lock across
a long analysis or while waiting for the user.

### Contention

Read the peer's `holder.json`:

- **Lease still valid** → do not wait or spin. Pick different work in another scope, or
  write a handoff note into `handoff/for-<peer-class>/` and stop. Blocking on a lock wastes
  an agent.
- **`expires_at` in the past by more than the 5-minute grace** → check
  `.trinoris/heartbeat/<peer-instance>.json`. If it exists and its `at` timestamp is less than
  3 minutes old, the peer is alive but slow — wait one additional grace period (5 minutes)
  before reconsidering. If no fresh heartbeat, you may break the lock via the break-token
  sequence below. Never decide this and act on it in one step: at the exact grace boundary
  two agents disagree by microseconds, and the token is what stops both acting on their own
  answer.
- **`holder.json` missing or unparseable** → the lock is malformed; the acquirer died
  between creating the directory and writing its metadata. You may break it once the
  **lock directory's own mtime** is older than the grace period.

### Breaking a lock

Breaking is permitted and sometimes necessary. Doing it silently is not — and it must be
serialised, or two agents break the same lock and the second one evicts the first.

1. `mkdir .trinoris/locks/<scope>.breaking` — **the atomic right to break.** If this
   fails, another agent is already breaking this scope: stand down entirely, do not touch
   the lock.
2. Re-check that the lock is still stale. The holder may have renewed while you were
   acquiring the token.
3. Write `.trinoris/incidents/<ISO8601>-broken-<scope>.md` recording: your instance ID,
   agent class, the scope, the holder you evicted (both instance and class), that holder's
   `acquired_at`/`expires_at`, why you judged it dead, and what you intend to do next.
4. `mv` the stale lock directory to `incidents/<ISO8601>-<scope>.stale` — move it aside
   rather than deleting it, so the evicted holder's metadata survives as evidence.
5. `mkdir` the lock fresh and write your own `holder.json` with your instance ID.
6. Re-read `holder.json` and confirm `agent_instance` is yours. If it is not, you lost: stand down.
7. `rmdir .trinoris/locks/<scope>.breaking`.
8. **Assume the evicted agent left the tree mid-edit.** Run `git status` and the relevant
   tests before building on what you find. A broken lock means the work in that scope is of
   unknown quality, not that it is absent.

## Handoffs

### Writing one

Write `.trinoris/handoff/for-<agent-class>/<ISO8601>-<slug>.md` using the format in
[`03-handoff-format.md`](03-handoff-format.md). Address it to an **agent class** (e.g.,
`for-codex-gpt-6/`) so any instance of that class can claim it, or specify a particular
instance in the frontmatter if the work must be done by that specific agent.

A consuming tree may keep a copy of the format as `.trinoris/TEMPLATE-handoff.md`; the
spec is authoritative.

Release your locks **before** writing the note, so peers can act on it immediately.
After publishing, the sender may explicitly run the bounded `handoff wait` command for
that exact filename and publishing identity. Waiting holds no scope lock; it follows
receipt-backed claim/completion state and is independent of the no-spin contention rule.

### Claiming one

Claiming is **two steps**, because `mv` is not an atomic claim:

1. **Check if you can claim this handoff:**
   - Read the frontmatter
   - Check `to_class`: must match your agent class (e.g., `codex-gpt-6`)
   - Check `to_instance`: if `any`, you can claim; if a specific instance ID, only that instance can claim
   - Check `scopes`: verify those scopes are available (not currently held by other agents)
   
2. `mkdir .trinoris/claims/<note-filename>.claim` — this is the atomic step. Failure
   means another agent instance is claiming it; stand down.

3. `mv .trinoris/handoff/for-<your-class>/<note> .trinoris/active/<your-instance>/<note>`,
   then `rmdir` the claim directory.

**Do not use `mv -n` as the claim.** Verified: `mv -n` is implemented as stat-then-rename
in userspace, so when the target already exists it returns **success** without moving.
Two agents racing both get exit 0, both see the source gone, and both conclude they
claimed the note — measured at 2 claimers out of 8 racers, 21 failures in 100 trials.
`mkdir` is the only claim primitive verified atomic here.

No scope lock is needed to claim. An agent instance must never edit a note sitting in
another agent's `for-<agent-class>/` directory or in another instance's `active/<instance>/`
directory.

### Finishing one

`mv` the note from `active/<your-instance>/` to `archive/`, appending an `## Outcome`
section: what landed, what did not, and what is now true. The archive is the project's
memory of who did what and why — keep it honest rather than tidy.

Update `archive/INDEX.md` with a one-line entry (see spec 03).

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

Lightweight liveness signal for long operations. An agent instance holding a lock for an
operation that cannot checkpoint every 5 minutes should write
`.trinoris/heartbeat/<agent-instance>.json`:

```json
{
  "agent_instance": "codex-gpt-6-a3f2",
  "agent_class": "codex-gpt-6",
  "at": "2026-10-25T14:03:11Z",
  "scope": "engine"
}
```

Update every **2 minutes** during long operations. This answers "is this agent instance
alive?" without the cost of rewriting `holder.json` and re-parsing the entire lease
structure.

**A heartbeat does not extend a lease.** It is evidence of liveness that informs peers'
breakability decisions: a fresh heartbeat (< 3 minutes old) for an expired lock suggests
waiting one additional grace period. An expired lease with no fresh heartbeat is breakable
immediately after grace elapses.

A missing or stale heartbeat is **not** permission to break a live lease. The lease itself
is authoritative; the heartbeat is advisory.

## Hard rules

1. No lock, no write. Reading is always free.
2. Never edit a path outside a scope you hold.
3. Acquire multiple scopes in registry order, always.
4. Re-verify you hold the lock immediately before writing (check `agent_instance` in `holder.json`).
5. Never break a lock without holding `<scope>.breaking` **and** writing an incident
   record. Breaking without the token is the one violation that silently destroys a
   peer's freshly acquired lock.
6. Never switch branches, rebase or reset while any peer holds any lock.
7. Never force-push, and never rewrite a commit you did not create.
8. Never edit a note in another agent class's `handoff/for-<agent-class>/` directory, and
   never edit a note in another instance's `active/<instance>/` directory.
9. Only claim handoffs addressed to your agent class (matching `to_class`) and to you
   specifically or `to_instance: any`.
10. Release locks before writing a handoff and before stopping.
11. State assumptions as assumptions.

## Deliberate non-goals

- **No queue, no priorities, no scheduler.** Multiple agents and a human do not need one,
  and the mechanism would cost more than the contention it resolves. Agents pick work by
  reading their `handoff/for-<agent-class>/` directory.
- **No automatic conflict resolution.** If multiple agents want the same scope, one blocks
  and picks different work. If both changed the same file (protocol violation), a human
  decides. The protocol's job is to make collisions rare and visible, not to merge.
- **No enforcement.** Nothing here is checked by a hook. It works because all agents
  follow it, so it is written to be followed under time pressure rather than to be
  complete.
