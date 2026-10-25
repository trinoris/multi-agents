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

| # | Expected today | Status | Asserts |
| --- | --- | --- | --- |
| `MA-T01` | UNKNOWN | ❌ | **Real concurrency.** N parallel processes on `/mnt/c` (v9fs) each attempt `mkdir` of the same lock; exactly one succeeds. Run with N=2, 8, 32, repeated. This is the assumption everything rests on and it is currently verified only sequentially |
| `MA-T02` | RED (new) | ❌ | A lock whose `expires_at` is in the past by more than the grace period is reported breakable; one still inside grace is not |
| `MA-T03` | RED (new) | ❌ | **Malformed lock.** A lock directory with no `holder.json`, mtime older than grace, is breakable. The same directory with a recent mtime is not |
| `MA-T04` | RED (new) | ❌ | **Claim race.** Two processes `mv` the same handoff note to `active/`; exactly one succeeds and the other observes the source gone. No note is duplicated or lost |
| `MA-T05` | RED (new) | ❌ | **The ABA case from spec 02.** Holder A's lease expires, B breaks and acquires, A then re-reads `holder.json` and correctly concludes it no longer holds the lock |
| `MA-T06` | RED (new) | ❌ | Breaking a lock without writing an `incidents/` record is detectable after the fact: every lock that changed hands has a matching incident file |
| `MA-T07` | RED (new) | ❌ | Acquiring two scopes out of registry order is rejected by the helper (if a helper exists) or flagged by the lint in `MA-T09` |
| `MA-T08` | RED (new) | ❌ | A handoff note missing `## Verified` or `## Assumed / not verified` is rejected by a format check |
| `MA-T09` | RED (new) | ❌ | Lint: every scope named in any `holder.json` exists in spec 01's registry; no `holder.json` references an unknown scope |
| `MA-T10` | RED (new) | ❌ | **Cross-platform.** A lock created from Windows (PowerShell `New-Item -ItemType Directory`) is seen as held from WSL, and vice versa. Both read each other's `holder.json` as UTF-8/LF |
| `MA-T11` | RED (new) | ❌ | A copied `PROTOCOL.md` in a consuming repo that has diverged from this repo's version is flagged (the copy-vs-symlink decision in spec 04) |

`MA-T01` and `MA-T10` are the two that justify this repo existing. Everything else tests
rules; those two test the physics the rules assume.

## Test approach

The tests are shell-level, not unit-level — the subject is filesystem behaviour across two
processes and two platforms, which cannot be mocked without testing the mock.

```text
tests/
├── concurrency/     N-process races: mkdir, claim-by-mv        (MA-T01, T04, T05)
├── lifecycle/       lease expiry, malformed locks, incidents   (MA-T02, T03, T06)
├── lint/            scope registry, handoff format, drift      (MA-T07..T09, T11)
└── cross-platform/  WSL ↔ Windows, run manually                (MA-T10)
```

`MA-T10` cannot run unattended in a single environment — it needs a real shell on each
side. It is a documented manual procedure with a recorded result and a date, not a CI job.
Marking it automated would be a lie that matters, because the WSL↔Windows bridge is exactly
where a silent assumption would hide.

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

## Honest limits

Two of spec 01's hard rules cannot be tested:

- *"Never edit a path outside a scope you hold"* — detectable after the fact by comparing
  `git status` against held locks, but not preventable.
- *"State assumptions as assumptions"* — a judgement about honesty. `MA-T08` checks the
  section exists; nothing can check it is truthful.

The protocol is a convention between two cooperating agents, not a sandbox. It makes
collisions rare and visible. It does not make them impossible, and a spec that implied
otherwise would be the most dangerous artifact in this repo.
