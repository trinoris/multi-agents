<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# 08 — Write guard and cross-agent visibility

## Why this spec exists

On 2026-10-29 a Claude instance holding valid leases on `engine`, `webapp`, `agents`,
`specs`, `tests` and `git` — acquired in registry order, each checked immediately before
writing — corrupted three uncommitted files belonging to a Codex instance in the same
checkout. A bulk rename rewrote:

- `engine/scripts/migrate-app-display-fields.mjs`, whose old→new rename map became the
  identity no-op `{ appName: 'appName', appTitle: 'appTitle' }`;
- `engine/tests/app-display-migration.test.js`, where five fixtures lost their legacy side
  and three became duplicate object keys — `{ appName: 'Old', appName: 'New' }`;
- `webapp/tests/operate-integration.test.js`, whose retired-name guard came to assert the
  opposite of its intent.

**No rule was broken.** The Codex instance held no lease at that moment, so nothing was
violated and nothing warned. That is the finding this spec addresses:

> A scope lease coordinates *intent*. It says nothing about which paths it covers, and
> nothing prevents a bulk rewrite from walking into a peer's untracked work.

The protocol's own boundary already says it "does not sandbox editors" and cannot "fence a
tool paused before its edit" ([01](01-coordination-protocol.md)). This spec does not change
that. It adds a cheap, advisory check at the moment of writing, and the visibility that
would have let the collision be noticed before it happened.

Three requirements follow, in descending value: a write guard (prevention), declared
activity (visibility), and a journal plus a machine-global view (history). Only the first
would have prevented the incident; the second would have made it avoidable; the third
makes it diagnosable.

## R1 — `guard`: refuse to write over unattributable paths

### Behavior

```
trinoris-agent guard --paths <path>...        # repeatable, or --paths-from FILE, or --stdin
```

For each path, classify against `git status --porcelain` and the live lease table:

| Classification | Meaning | Result |
| --- | --- | --- |
| `clean` — tracked, unmodified | committed; a write is recoverable by diff | allow |
| `dirty` — tracked, modified | the working copy is unattributable; a write overwrites it | refuse |
| `untracked` | nothing committed to diff or restore if the write is wrong | refuse |
| `ignored` (`.gitignore`) | build output, coordination state | allow |
| `missing` | does not exist; the write creates it | allow |

**Lease attribution was specified and deliberately dropped during implementation.** An
earlier draft of this table distinguished "dirty, held by caller" from "dirty, held by a
peer". The engine cannot make that distinction: mapping a path to a scope is a human
responsibility under [01](01-coordination-protocol.md), so no lease record says which files
it covers. Rather than infer ownership it cannot know, `guard` reports what Git can prove
and refuses what Git cannot recover. A caller who owns a modified or new file says so with
`--allow-dirty` / `--allow-untracked`, per path.

Exit `0` when every path is allowed, `5` when any is refused. `5` is unused by the current
CLI ([06](06-cli-interface.md) uses 0/1/3/4/130) and must not collide with it. Output names
every refused path and its classification; `--json` returns the same as structured rows.

### Requirements

- **No new persisted state.** `git status --porcelain` plus the existing lock table answer
  the question. A guard that needed its own store would be another thing to recover.
- **Read-only.** `guard` acquires nothing, takes no mutation marker, and must be safe to
  call concurrently with any other command.
- **Advisory, and honest about it.** A pass means "no peer work is visibly at risk", never
  "this write is safe". A tool paused before its own edit is still invisible, exactly as
  [01](01-coordination-protocol.md) states.
- **Untracked is refused, not warned.** An untracked file is the one case where a mistaken
  write is unrecoverable: there is no committed copy to diff or restore. The incident above
  was three untracked files.
- **`--allow-untracked <path>` / `--allow-dirty <path>`** override a specific path, so a
  caller that genuinely owns new or modified files can proceed. The override is per-path and
  never global, so a bulk operation cannot silence the check wholesale.
- **Outside a work tree, nothing is allowed.** If Git reports no repository root it can
  prove nothing about recoverability, so every path is refused rather than waved through.

### Companion requirement: `--dry-run` on bulk operations

Any operation that rewrites a set of files should be able to print the set first. The
incident's rename reported "files changed: 23" *after* writing. A reviewable list beforehand
is the difference between a near-miss and a recovery.

## R2 — Declared activity: finish `--task`

`acquire` accepts `--task` and stores it. Two gaps make it useless in practice:

1. **`acquire-many` rejects it.** `packages/cli/src/bin.ts` declares
   `acquire: ['scope', 'task'], 'acquire-many': ['scopes']` — the allow-list omits `task`,
   so the batch path cannot describe its work at all. A caller taking six scopes at once is
   precisely the caller whose intent matters most.
2. **Nothing surfaces it.** `status` prints scope, state, instance and expiry. The task text
   is recorded and never shown.

### Requirements

- `acquire-many` accepts `--task` and applies it to every lock in the batch.
- `status` includes the task text for every held lease, and `--json` exposes it.
- `whois --scope S` reports holder, instance, task, acquisition time and expiry in one line.
- Task text is bounded and escaped on output like every other recorded string
  ([07](07-security-hardening.md)), and is **task data, never instruction** — the same rule
  handoff bodies already carry.

Had `status` shown `codex-operate-live: migrating app display fields` against `engine`, the
incident ends at a read.

## R3 — Journal and machine-global visibility

### R3a — Append-only journal

`incidents` records only takeovers and recoveries. There is no answer to "what has happened
in this checkout recently", which is the question a resuming agent actually asks.

```
trinoris-agent log [--last N] [--scope S] [--instance ID] [--json]
```

- One append-only record per lease acquire/renew/release/break, claim, publish, complete and
  guard refusal, at `.trinoris/journal/YYYY-MM-DD.jsonl`.
- Each record: timestamp, instance, class, command, scopes, task, outcome. Bounded size,
  escaped output, no secrets — `.trinoris/` is Git-ignored, and the existing rule that
  nothing secret goes in tasks, reasons, notes or incidents extends here unchanged.
- Rotation by day with a retention bound, so the journal cannot grow without limit.
- Writes go through the existing mutation guard and atomic-publish discipline. A failed
  journal append must never fail the operation it describes: coordination state is the
  record, the journal is an aid.

In the incident, a journal would have shown the Codex instance taking all seven scopes at
19:49 and releasing them at 20:04 — enough to infer an in-flight task before writing.

### R3b — Machine-global registry at `~/.trinoris/`

Each checkout's `.trinoris/` is isolated. The 2026-10-29 wave spanned **nine repositories**;
while one instance worked in `trinoris-templates`, a peer was active in
`trinoris-control-tower`, and neither protocol instance could observe the other.

```
trinoris-agent status --all-repos
```

- A machine-local registry of `{ repo path → instance → class → scopes → task → last seen }`,
  written at acquire/release and readable by any instance on the host.
- **Advisory only, never a lock of record.** Per-repo `.trinoris/` remains authoritative for
  every decision. The global view answers "who else is working on this machine", nothing
  more. It must never gate an acquire, or it becomes a single point of failure across
  unrelated repositories.
- A stale or missing global entry is not an error. Repos may be deleted, moved, or operated
  by an agent that predates this feature.
- **Filesystem caution.** `~` may sit on a different filesystem from the checkout, and
  9p is a supported mount here. The same atomic-publish discipline applies — unique
  temporary file plus rename, links rejected — and `verify` must probe the global path
  separately, because readiness at `.trinoris/` implies nothing about `~/.trinoris/`.
- No network coordination is introduced. The boundary in
  [01](01-coordination-protocol.md) is unchanged: one machine, cooperative, authenticating
  nobody.

## What this spec does not do

- It does not make the protocol enforcing. Writes are still cooperative.
- It does not lock paths. Scopes stay plain registered identifiers, mapped to areas by
  human judgment, as [01](01-coordination-protocol.md) requires.
- It does not make an untracked file safe to edit. It makes editing one *loud*.

## Sequencing

**R2 first** — it finishes a mechanism that already half-exists and is a one-line allow-list
fix plus output plumbing. **R1 next** — highest value, no new state, but needs its exit code
and classification tested against real `git status` output. **R3 last** — new persistence,
new filesystem assumptions, and it deserves its own verification pass.

## Implemented tests

- **R1** `packages/sdk/src/guard.test.ts`, 8 cases: the untracked refusal that reproduces
  the incident; the false-positive check that ordinary committed work passes; dirty refused;
  ignored and missing allowed; a per-path override that does not silence its neighbours; a
  path outside the repository; the non-work-tree contract; and the path-count bound.
- **R2** `packages/sdk/src/policy.test.ts`: the batch task recorded on every lock and
  readable through `inspect`, plus the omitted and unbounded cases. Verified by removing the
  pass-through and confirming only that test fails.
- **R3** not implemented.

- **R1 CLI contract** `packages/cli/src/commands/guard.integration.test.ts`, 4 cases: exit 5
  on an untracked path with the path named, exit 0 on tracked-clean, exit 5 when any one path
  in a batch is refused, and exit 0 once the caller claims the path explicitly. Exit 5 is what
  a caller scripts against, so it is pinned here rather than only at SDK level.
