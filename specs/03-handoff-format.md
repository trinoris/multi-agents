<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# 03 — Handoff format and lifecycle

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


## Historical design status: PROPOSED

This label belongs to the original design draft. Protocol 3 is implemented and enforced by
the shipped core, SDK, and CLI. Setup now installs a copy-ready handoff skeleton at
`.trinoris/handoff/TEMPLATE.md`; Codex, Kiro, and Cursor discover it through `AGENTS.md`,
and Claude Code through `.claude/skills/agent-handoff/SKILL.md`. All entry points direct
agents to the same template, protocol, and CLI validation flow. Replace all template fields, validate the
draft, release held scopes, then publish it. The CLI is the schema gate; prose instructions
alone do not make a malformed note claimable.

The lock mechanism keeps two agents from colliding. The handoff is what makes them
actually collaborate: it is the only channel through which one agent's understanding
reaches the other.

## Why notes and not commit messages

A commit message describes what changed. A handoff describes **what is true now, what was
checked, and what the next agent should do** — including work that produced no commit, dead
ends worth not repeating, and things believed but unverified. None of that fits in a commit
message, and all of it is what the peer needs.

## Sender wait

After a successful publish, the sender can opt in to `handoff wait --note <filename>`.
The wait is bound to the publication receipt created for that exact filename, sender
class/instance, and content digest. It follows these states: `publishing`, `published`,
`claiming`, `claimed`, `completing`, and `completed`. Missing or conflicting receipt state
is an error; disappearance of the inbox file alone is never treated as completion.

The wait defaults to `--until completed`; `--until claimed` returns at `claimed` or any
later state. Polling is bounded: timeout defaults to 1800 seconds and accepts 1–86400;
interval defaults to 2 seconds and accepts 1–60. Timeout exits `3`, and Ctrl-C/SIGTERM
exits `130`. The wait holds no editing scope and does not keep a mutation guard between
polls. It requires the same filesystem-visible working tree; it does not coordinate
separate clones or machines. This facility is only for tracking an already-published
handoff. Contention and claim conflicts remain one-shot outcomes and must not be retried in
a loop.

## Lifecycle

```text
write     handoff/for-<agent-class>/<ISO8601>-<slug>.md     author releases locks first
claim     mkdir claims/<note>.claim  (atomic)               check to_class + to_instance
          mv → active/<agent-instance>/<note>, rmdir claim
finish    mv → archive/<same-name>.md                       append ## Outcome
          update archive/INDEX.md
```

The claim is the **`mkdir`**, not the `mv`. `mkdir` is the only primitive verified atomic
on this filesystem; `mv -n` is not — it is stat-then-rename and returns success when it
declines, so two racing agent instances both conclude they claimed the note (measured: 2
claimers of 8 racers). See spec 02, "two primitives that looked right and were not".

Claiming is still a move rather than editing a `status:` field in place, because an
in-place edit is a read-then-write race with no atomic step at all.

Rules:

- The author releases its locks **before** writing the note, so peers can act at once.
  A handoff that arrives with the scope still locked is a handoff peers cannot use.
- Never edit a note in another agent class's `handoff/for-<agent-class>/` directory. It
  belongs to that class from the moment it is written.
- Never edit a note in another instance's `active/<instance>/` directory.
- `archive/` is append-only in spirit. It is the project's record of who did what and why;
  keep it honest rather than tidy.
- When moving a note to `archive/`, update `archive/INDEX.md` with a one-line entry:
  ```markdown
  - `2026-10-25T1402-rename-engine-fields.md` — [engine, specs] — codex-gpt-6-a3f2 — completed: fields renamed, tests pass
  ```
  Format: `- <filename> — [scopes] — <agent-instance> — <outcome>`. This makes "what
  happened to `engine` last week?" a search through one file instead of reading every
  archived note.

## Format

Frontmatter carries routing — who, to whom, what scope, whether locks are clear — because
the claim mechanism and conflict checks depend on it. The body is a fixed set of sections.
Both are required — the frontmatter exists because the filesystem lifecycle needs it; the
sections exist because each one is a question peers will otherwise have to ask.

```markdown
---
from_instance: codex-gpt-6-a3f2
from_class: codex-gpt-6
to_class: claude-opus-5                # any instance of claude-opus-5 can claim
to_instance: any                       # or: claude-opus-5-x9k2 (specific instance)
scopes: [engine, specs]
locks_released: true
---

# Context Handoff

Updated: 2026-10-25 14:02 UTC
Task: <short task name>
Status: in-progress | blocked | ready-for-review | complete
Branch: refactor/feature-to-app
Base commit: 6d7956bd

## Goal
Requested outcome and acceptance criteria. Link the spec or issue driving it.

## User Constraints
Explicit requirements, preferences, and scope boundaries.

## Current State
- Completed: <implemented result>
- In progress: <unfinished work>
- Remaining: <required work>

## Changes
| Path | Change | Reason |
| --- | --- | --- |
| `engine/auth.js:638` | ... | ... |

## Decisions
- <Decision>: <reason>
  - Evidence: <file, commit, issue, or URL>
  - Status: accepted | proposed

## Verification
| Check | Result | Scope / limitations |
| --- | --- | --- |
| `cd engine && npm test` | PASS | 83 files, 1,973 passed |

Verified at commit: <SHA, or "working tree">. Describe edits made after verification, if any.

## Failed Attempts
- Attempt: <what was tried>
- Result: <observed failure>
- Implication: <what the next agent should avoid or investigate>

## Blockers and Unknowns
- <Issue, its impact, and what would resolve it.>
- Clearly label assumptions and unverified claims, e.g. **(not verified)**.

## Next Actions
1. <Concrete first action, including file or command>
2. <Next action>
3. <Final validation or delivery step>

## Resume Instructions
1. Read AGENTS.md and this file.
2. Check `git status` and the current diff.
3. Verify branch and commit against this handoff.
4. Load relevant memory files and source code.
5. Continue from Next Actions.

## References
- Relevant source paths, issues, PRs, and documentation
```

### `status`

| Value | Means |
| --- | --- |
| `in-progress` | Work continues in a good state; the next instance of the target class should pick it up |
| `blocked` | Work cannot proceed; `## Next Actions` says what would unblock it |
| `ready-for-review` | Author's side is done; needs a peer or human review before continuing |
| `complete` | Task is finished; nothing further is needed — kept for the audit trail |

A `blocked` note is the most valuable kind and the easiest to skip writing. Write it.

## The verified/assumed split

This is the load-bearing part of the format.

- **Verified** — you ran it and saw the result. Put it in `## Verification` as a row:
  exact command, PASS/FAIL, and any scope/limitations.
- **Assumed** — you have not. Put it in `## Blockers and Unknowns`, marked `(not verified)`.

A handoff that presents assumptions as facts is worse than no handoff: peers build on
it, the error compounds, and the original uncertainty is now invisible. **If you cannot
decide which section something belongs in, it is assumed.**

This mirrors the convention already in use across the Control Tower specs
(`(not verified)` markers; RED/GREEN expected-today columns), so an agent moving between
repos meets one habit, not two.

## Anti-patterns

| Anti-pattern | Why it fails |
| --- | --- |
| Narrating the session chronologically | Peers need current state, not a transcript |
| "Updated several files" in prose instead of the `## Changes` table | Unactionable. One row per change, with paths and line numbers |
| Listing three options in `## Next Actions` | Pushes your synthesis onto peers. Decide, and note the alternative under `## Blockers and Unknowns` if genuinely open |
| Writing the note, then continuing to edit | The note becomes fiction the moment you do. Release, write, stop |
| Omitting `## Blockers and Unknowns` because everything felt fine | The absence claims total verification. If nothing is assumed, say "Nothing" explicitly |
| A stale note left in `for-<agent-class>/` for days | Either it still matters — claim it — or archive it with an Outcome saying it lapsed |
| Addressing to the wrong agent class | `to_class: codex-gpt-6` for a task requiring design/architecture (better for `claude-opus-5`) |

## Resolved design questions

- **Resolved — no automatic expiry in protocol 3.** Long-running work must not silently
  become unclaimable because a timestamp elapsed. A recipient checks the note's base commit
  and current repository state before relying on it; stale notes remain visible for an
  explicit archive or follow-up decision. Handoff expiry is not an authorization or safety
  boundary.
- **Resolved** — Archive needs an index: `archive/INDEX.md` with one-line entries per note,
  added when the note is archived. Makes history searchable without `grep -r` over hundreds
  of files.
