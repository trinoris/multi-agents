<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# 03 — Handoff format and lifecycle

## Status: PROPOSED

The lock mechanism keeps two agents from colliding. The handoff is what makes them
actually collaborate: it is the only channel through which one agent's understanding
reaches the other.

## Why notes and not commit messages

A commit message describes what changed. A handoff describes **what is true now, what was
checked, and what the next agent should do** — including work that produced no commit, dead
ends worth not repeating, and things believed but unverified. None of that fits in a commit
message, and all of it is what the peer needs.

## Lifecycle

```text
write     handoff/for-<peer>/<ISO8601>-<slug>.md     author releases locks first
claim     mv → active/<same-name>.md                 atomic; no lock needed
finish    mv → archive/<same-name>.md                append ## Outcome
```

`mv` to a non-existent target is the claim primitive. If both agents race to claim, one
`mv` succeeds and the other finds no source file — no lock, no ambiguity. This is why
claiming is a move rather than editing a `status:` field in place, which would be a
read-then-write race.

Rules:

- The author releases its locks **before** writing the note, so the peer can act at once.
  A handoff that arrives with the scope still locked is a handoff the peer cannot use.
- Never edit a note in the peer's `for-<peer>/` directory. It is theirs from the moment it
  is written.
- Never edit a note in `active/` you did not claim.
- `archive/` is append-only in spirit. It is the project's record of who did what and why;
  keep it honest rather than tidy.

## Format

Frontmatter, then fixed sections. Both are required — the sections exist because each one
is a question the peer will otherwise have to ask.

```markdown
---
from: claude
to: codex
created: 2026-10-25T14:02:00Z
scopes: [engine, specs]
branch: refactor/feature-to-app
head: 6d7956bd
locks_released: true
status: handoff          # handoff | blocked | fyi
---

# <one line: the outcome, not the activity>

## Goal
Why this work exists. One or two sentences. Link the spec or issue driving it.

## What I did
Concrete changes, with paths. `engine/auth.js:638` beats "updated auth".

## Verified
Evidence only. Command → result.
- `cd engine && npm test` → 83 files, 1,973 passed
- `GET /projects/{id}/features` on the scratch tenant → `[]`

## Assumed / not verified
Everything believed but unchecked, each marked. Be generous here.
- The authorizer path is unaffected **(not verified)** — no test covers it

## Next step
The single next action you would take. Not a list of options.

## Do not touch
Paths or state the peer must leave alone, and why. Omit the section if nothing applies.

## Rollback
How to undo what landed, if it needs undoing.
```

### `status`

| Value | Means |
| --- | --- |
| `handoff` | Work is in a good state; peer should continue it |
| `blocked` | Work cannot proceed; `## Next step` says what would unblock it |
| `fyi` | No action needed; recorded so the peer is not surprised |

A `blocked` note is the most valuable kind and the easiest to skip writing. Write it.

## The verified/assumed split

This is the load-bearing part of the format.

- **Verified** — you ran it and saw the result. Cite command and outcome.
- **Assumed** — you have not. Mark `(not verified)`.

A handoff that presents assumptions as facts is worse than no handoff: the peer builds on
it, the error compounds, and the original uncertainty is now invisible. **If you cannot
decide which column something belongs in, it is assumed.**

This mirrors the convention already in use across the Control Tower specs
(`(not verified)` markers; RED/GREEN expected-today columns), so an agent moving between
repos meets one habit, not two.

## Anti-patterns

| Anti-pattern | Why it fails |
| --- | --- |
| Narrating the session chronologically | The peer needs current state, not a transcript |
| "Updated several files" | Unactionable. Give paths and line numbers |
| Listing three options in `## Next step` | Pushes your synthesis onto the peer. Decide, and note the alternative under Assumed if genuinely open |
| Writing the note, then continuing to edit | The note becomes fiction the moment you do. Release, write, stop |
| Omitting `## Assumed` because everything felt fine | The absence claims total verification. If nothing is assumed, say "Nothing" explicitly |
| A stale note left in `for-<peer>/` for days | Either it still matters — claim it — or archive it with an Outcome saying it lapsed |

## Open questions

- `(pending)` Should notes carry an explicit `expires` field? A handoff about a branch that
  has since moved on is misleading, and nothing currently detects that.
- `(pending)` Whether `archive/` needs an index, or `git log` over the directory suffices.
