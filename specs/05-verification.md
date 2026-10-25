<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# 05 — Verification and adoption

## Status: PROPOSED

## Development philosophy: TDD

Same rule as the Control Tower specs: **nothing is implemented before a test that fails
for the right reason.**

This protocol needs it more than most code, because its failure mode is *silent*. A broken
lock does not throw; it loses an edit. Two agents that both believe they hold `engine`
produce a working tree that looks fine and is wrong. The only way to know the mechanism
works is to race it on purpose.

Test IDs are `MA-T<nn>`, stable, never renumbered. Status: ❌ not written · 🟡 written and
failing as expected · ✅ passing.

## Test cases

Run 2026-10-25 on v9fs (`/mnt/c`). Harnesses to be extracted into `tests/` from the
scratch versions used for this run.

| # | Status | Result |
| --- | --- | --- |
| `MA-T01` | PASS | **Atomic.** N=2/8/32 x 100 trials, 4,200 racing processes barrier-synchronised on one lock: exactly one winner every trial, 0 failures. The gate is cleared |
| `MA-T02` | PASS | Live lease not breakable; expired-within-grace not breakable; expired beyond grace breakable. **Caveat**: expiry falling exactly on the grace edge is decided by microseconds and two agents can disagree — handled by the break token, not by the comparison |
| `MA-T03` | PASS | Malformed lock with fresh dir mtime not breakable; with mtime older than grace it is; unparseable `holder.json` behaves as malformed |
| `MA-T04` | PASS **after a fix** | Originally **FAILED**: `mv -n` gave 2 claimers from 8 racers (21/100 trials; 31/100 at N=32). Fixed with an atomic `mkdir` claim marker before the `mv` — 0 failures at N=8 and N=32 over 100 trials. Hardlink also passed, rejected for Windows fragility |
| `MA-T05` | PASS | ABA confirmed: after eviction the lock directory is indistinguishable from the original; the `agent` field in `holder.json` is the only thing revealing the loss. Re-verify detects it correctly |
| `MA-T06` | not written | **Incident visibility**: acquiring a scope after being evicted detects the incident file; re-verify failure prompts incident check |
| `MA-T07` | not written | **Scope registry ordering**: scopes acquired out of order are detectable; all entry points reference the registry |
| `MA-T08` | not written | **Handoff format validation**: parser rejects notes missing required sections (`## Verified`, `## Assumed`, `## Next step`); accepts when `## Assumed` contains "Nothing" |
| `MA-T09` | not written | **Heartbeat handling**: expired lease + fresh heartbeat (<3min) defers breakability; expired lease + stale heartbeat breakable; missing heartbeat does not affect live lease |
| `MA-T10` | PASS | **Both directions.** WSL-created lock blocks PowerShell `New-Item`; Windows-created lock blocks WSL `mkdir`; each side reads the other's `holder.json`. Automatable after all — see below |
| `MA-T11` | not written | **Protocol drift detection**: consuming repo's `PROTOCOL.md` diverges from source, detected by hash or version header |
| `MA-T12` | PASS **new** | **Break race.** Delete-then-recreate double-breaks: 25/60 failures at N=8, 59/60 at N=32. Rename-aside also double-breaks (2 takeovers at N=8) because the lock name frees instantly. Fixed with the `<scope>.breaking` token — 0 failures at N=8 and N=32 over 60 trials |
| `MA-T13` | not written | **Git scope pre-check**: acquiring `git` for branch mutation while peer locks are live is rejected; commits/index ops allowed |
| `MA-T14` | not written | **Instance competition**: multiple instances of same agent class (e.g., codex-gpt-6-a, codex-gpt-6-b, codex-gpt-6-c) compete for handoffs in `for-codex-gpt-6/`, exactly one claims each via atomic mkdir |
| `MA-T15` | not written | **Class-based routing**: handoff with `to_class: codex-gpt-6` is not claimable by `claude-opus-5` instances; handoff with `to_class: any` is claimable by all |
| `MA-T16` | not written | **Instance-specific addressing**: handoff with `to_instance: codex-gpt-6-a3f2` is claimable only by that instance; `to_instance: any` claimable by any instance of the target class |

`MA-T01`, `MA-T10` and `MA-T12` are the three that justify this repo existing. The rest
test rules; those three test the physics the rules assume — and two of them disproved this
spec as first written.

`MA-T14`, `MA-T15`, `MA-T16` test the agent class/instance model that enables N instances
of the same model to work in parallel.

## Test approach

The tests are shell-level, not unit-level — the subject is filesystem behaviour across two
processes and two platforms, which cannot be mocked without testing the mock.

```text
tests/
├── concurrency/     N-process races: mkdir, claim, lock-break   (MA-T01, T04, T12)
├── lifecycle/       lease expiry, malformed locks, ABA          (MA-T02, T03, T05)
├── protocol/        incidents, heartbeat, git pre-check         (MA-T06, T09, T13)
├── routing/         class/instance addressing, competition      (MA-T14, T15, T16)
├── lint/            scope registry, handoff format, drift       (MA-T07, T08, T11)
└── cross-platform/  WSL <-> Windows via powershell.exe          (MA-T10)
```

**Correction to an earlier claim in this spec.** `MA-T10` was described as impossible to
automate in one environment. That was wrong: `powershell.exe` is reachable directly from
WSL, so one harness drives both sides and the test runs unattended. It is a normal
automated test, not a manual procedure.

## Adoption

Per working tree, in this order. Nothing here is implemented yet — this is the intended
sequence, and `MA-T01` gates all of it.

```text
 0. MA-T01 passes on the target filesystem. If mkdir is not atomic under real
    concurrency there, the protocol does not apply to that tree and must not be
    installed. This is a gate, not a formality.
 1. Create coordination/ scaffolding.
 2. Install PROTOCOL.md (copy; pending the spec 04 decision).
 3. Install the entry points: AGENTS.md, .claude/skills/agent-handoff/SKILL.md,
    and the pointer line in CLAUDE.md.
 4. Dry run: both agents acquire and release disjoint scopes, write and claim one
    handoff each, with no real edits. Confirm each sees the other's locks and notes.
 5. Deliberately break one lock and confirm the incident record appears.
 6. Only then use it for real work.
```

Step 5 is not optional. Breaking a lock is the operation most likely to be done wrong under
pressure, and the only way to trust the incident trail is to have seen it produced once.

## Acceptance criteria

- `MA-01` `MA-T01` passes on every filesystem where the protocol is installed, re-run
  whenever the host or mount setup changes.
- `MA-02` Every rule in spec 01's "Hard rules" has a test above, or is explicitly recorded
  as unenforceable (rules 2 and 10 are judgement, not mechanism — they have no test and
  that is stated, not hidden).
- `MA-03` A consuming repo's `PROTOCOL.md` is byte-identical to this repo's, or the
  divergence is flagged by `MA-T11`.
- `MA-04` The dry run in adoption step 4 is completed and recorded before any real
  concurrent work.
- `MA-05` No implementation lands before its test is written and failing.
- `MA-06` The claim primitive is `mkdir`, never `mv -n`. `MA-T04` is the standing guard.
- `MA-07` Breaking a lock always acquires `<scope>.breaking` first. `MA-T12` is the guard.
  A break implementation that skips the token passes casual testing and fails under load,
  which is the worst combination available.
- `MA-08` **NEW** Acquiring `git` for branch mutation checks for peer locks first.
  `MA-T13` is the guard. This is the highest-risk operation in the protocol.
- `MA-09` **NEW** Long operations (>5min) emit heartbeats every 2 minutes. Peers check
  heartbeats before breaking expired leases. `MA-T09` validates the logic.
- `MA-10` **NEW** Acquiring any scope checks `incidents/` for recent events in that scope.
  `MA-T06` validates detection.
- `MA-11` **NEW** Agent instances correctly identify themselves with `agent_instance` and
  `agent_class` in all `holder.json` and heartbeat files.
- `MA-12` **NEW** Handoff claiming respects `to_class` and `to_instance` fields. MA-T14,
  T15, T16 validate routing logic.
- `MA-13` **NEW** Multiple instances of same agent class can work in parallel on different
  scopes without collision.
- `MA-14` **CLI** A tool implementing spec 06 can be invoked with just `--class` and works.
- `MA-15` **CLI** Status commands provide actionable info without requiring work.
- `MA-16` **CLI** Configuration file, flags, and environment variables follow precedence.
- `MA-17` **CLI** Daemon mode responds to SIGTERM with graceful shutdown.
- `MA-18` **CLI** `init` command creates valid structure that passes `verify` command.

## Honest limits

Two of spec 01's hard rules cannot be tested:

- *"Never edit a path outside a scope you hold"* — detectable after the fact by comparing
  `git status` against held locks, but not preventable.
- *"State assumptions as assumptions"* — a judgement about honesty. `MA-T08` checks the
  section exists; nothing can check it is truthful.

The protocol is a convention between two cooperating agents, not a sandbox. It makes
collisions rare and visible. It does not make them impossible, and a spec that implied
otherwise would be the most dangerous artifact in this repo.
