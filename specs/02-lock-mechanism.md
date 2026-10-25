<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# 02 — Lock mechanism

## Status: PROPOSED

Rationale and failure analysis for the locking in
[`01-coordination-protocol.md`](01-coordination-protocol.md). Spec 01 states the rules;
this spec says why they are those rules and what each one is defending against. Read this
before changing any of them.

## Primitive selection

The lock must work when the holder is not a running process. Agents act in discrete tool
calls: there is no daemon, no held file descriptor, nothing the kernel can clean up.

| Primitive | Exclusive on v9fs | Survives process exit | Verdict |
| --- | --- | --- | --- |
| `mkdir` | yes (measured) | yes | **chosen** |
| `>` with `noclobber` | yes (measured) | yes | viable; a directory holds metadata more naturally |
| `ln -s` | yes (measured) | yes | viable; obscure, no metadata slot |
| `flock` | unreliable over 9p | **no** — releases on exit | rejected |
| `O_EXCL` open via a language runtime | yes | yes | equivalent to `noclobber`, adds a runtime dependency |
| A lock *file* written non-atomically | no | yes | rejected — read-then-write is a race |

`flock` is the trap worth naming: the binary exists on the WSL side, it is the textbook
answer, and it is wrong twice over here. Advisory locks over the 9p bridge are not
dependable, and even where they work the lock vanishes the moment the agent's shell
command returns — which is after every single tool call.

`mkdir` wins because the exclusivity decision happens where the directory is created, and
because a directory gives a natural place to put `holder.json`.

## The two-step acquire window

Acquisition is two operations, not one:

1. `mkdir coordination/locks/<scope>.lock` — atomic, decides the winner.
2. write `holder.json` — not atomic with step 1.

An agent that dies between them leaves a **malformed lock**: a directory that proves
someone won the race but says nothing about who, or until when. Without a rule for this
case the scope is dead forever.

The rule in spec 01: a malformed lock may be broken once the **lock directory's own mtime**
is older than the grace period. The directory's mtime is set by step 1, so it is available
precisely when `holder.json` is not. This is why the metadata lives *inside* the directory
rather than the directory being named after its holder — the container carries a timestamp
independent of its contents.

Writing `holder.json` immediately after `mkdir`, in the very next operation, keeps this
window to milliseconds. Do not do analysis between the two steps.

## Lease, not lock

The directory grants exclusivity. The **lease** (`expires_at`) grants it *for a period*.
The split exists because nothing can release the directory on the holder's behalf.

- A lease is a claim to still be alive, renewed by rewriting `holder.json` with a later
  `expires_at`. It is not a reservation of future work.
- 15 minutes default, renewed every 5 minutes of active work. The ratio matters: renewing
  at one third of the lease means two missed renewals before the peer can act, so a slow
  tool call does not look like death.
- 5 minute grace on top of expiry before the peer may break it.

Tuning: a longer lease makes a dead agent block the peer for longer; a shorter one makes a
busy agent lose locks it still needs. 15/5/5 assumes a tool call rarely exceeds 5 minutes.
If a scope routinely holds work longer than that, renew more often rather than lengthening
the lease — a long lease is indistinguishable from a deadlock to the peer.

## Deadlock

Two scopes acquired in opposite orders by two agents deadlock permanently, because neither
agent blocks-and-waits in a way the other can observe, and both leases keep getting
renewed by agents that are alive and stuck.

Prevented by the single rule: **multiple scopes are acquired in registry order, always.**
With a total order over scopes and acquisition only ever ascending, a cycle in the
wait-for graph cannot form. This is the standard resource-ordering result and it is the
only deadlock defence in the protocol — which is why the scope table is ordered and why
adding a scope means inserting it into that table rather than appending ad hoc.

Leases are the backstop, not the defence: if the ordering rule is violated, the deadlock
resolves only when a lease expires, and only if one of the two agents actually died.

## Starvation and the no-spin rule

Spec 01 forbids waiting on a held lock. An agent that polls a lock is an agent doing
nothing, which is worse than an agent doing different work or stopping with a handoff.

The consequence accepted deliberately: there is **no fairness guarantee**. An unlucky agent
can be beaten to the same scope repeatedly. With two agents and a human in the loop this
is not worth a queue — see spec 01's non-goals.

## The re-verify rule

Spec 01 requires re-reading `holder.json` and confirming ownership immediately before each
batch of writes. This defends against a specific sequence:

1. Agent A acquires `engine`, starts a long operation.
2. A's lease expires — A is slow, not dead.
3. Agent B sees an expired lease, records an incident, breaks the lock, acquires it.
4. A finishes its long operation and writes, believing it still holds `engine`.

Step 4 is the data loss. A's in-memory belief is stale and nothing on disk contradicts it
unless A looks. The check is cheap and it is the only thing standing between a slow agent
and silently overwriting its peer.

This is an ABA problem: the lock directory exists at step 4 exactly as it did at step 1, so
*presence* is not evidence of ownership. Only the `agent` field in `holder.json` is.

## What the mechanism does not protect against

Stated plainly so nobody relies on it for more than it does:

- **An agent that ignores the protocol.** Nothing is enforced. A tool call that writes
  without a lock succeeds.
- **A human editing in an editor.** The protocol governs the two agents, not the person.
  A file open in an IDE can be saved over either agent's work at any time.
- **Non-file state.** Running dev servers, a cloud deploy, a database, a tmux session — all
  shared, none covered. Add a scope for them if they matter, or coordinate out of band.
- **Partial writes.** A lock serialises *who* writes; it does not make a multi-file edit
  atomic. An agent interrupted mid-edit leaves the tree inconsistent, which is why breaking
  a lock obliges the breaker to check `git status` and run tests before trusting what it
  finds.
- **Clock skew.** Leases compare wall-clock timestamps and assume one machine. Splitting
  the agents across machines invalidates the lease mechanism entirely.

## Open questions

- `(pending)` Should `git` be split into `git-read-write` (index, commit) and `git-history`
  (branch, rebase, reset)? One coarse scope is safer but serialises all commits. Decide
  after observing real contention, not before.
- `(pending)` Is 15/5/5 right? Needs measurement against real tool-call durations.
- `(not verified)` Whether `mkdir` remains atomic under genuine concurrent load on v9fs.
  Measured exclusivity sequentially only; `MA-T01` in spec 05 is the real test.
