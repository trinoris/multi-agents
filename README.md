<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# trinoris-multi-agents

Coordination protocol for multiple coding agents sharing one working tree, organized by
**model class** (e.g., `codex-gpt-6`, `claude-opus-5`) with support for multiple
**instances** of each class running in parallel.

**Repository:** https://github.com/trinoris/multi-agents.git

## Status: PHASE 1 IN PROGRESS — First handoff validated ✅

**Current Status:** Phase 1 started, protocol validated with real execution  
**Next:** Parallel execution testing (2 agents, different scopes)

### What's Working

**Phase 0 Complete (2026-10-25T12:29):**
- ✅ trinoris-agent CLI v0.1.0 (setup + verify commands)
- ✅ MA-T01: 100/100 trials on ext4 and v9fs (WSL2)
- ✅ Automated test suite: 10/10 tests pass
- ✅ Generates AGENTS.md and .claude/skills for AI agents

**Phase 1 Started (2026-10-25T11:36):**
- ✅ First handoff executed successfully (test-update-phase1-start)
- ✅ All protocol steps validated:
  - Atomic claim (mkdir token pattern)
  - Lock acquisition (mkdir + holder.json)
  - Re-verify before write (ABA prevention)
  - Lock release (clean removal)
  - Handoff archiving (with outcome)
- ✅ Command count: 11 bash commands (matches 10-12 estimate)
- ✅ Duration: ~2 minutes from claim to archive
- ✅ Zero issues encountered

**Installation:**
```bash
cd trinoris-agent
pip install -e .
trinoris-agent setup     # Initialize in any project
trinoris-agent verify    # Verify atomicity and structure
```

See [`PHASE-0-COMPLETE.md`](PHASE-0-COMPLETE.md) and [`PHASE-1-STARTED.md`](PHASE-1-STARTED.md) for full details.

### Quick Links

- [Specifications](specs/) — 6 complete specs
- [CLI Documentation](trinoris-agent/README.md) — Installation & usage
- [Phase 0 Summary](PHASE-0-COMPLETE.md) — CLI implementation
- [Phase 1 Summary](PHASE-1-STARTED.md) — First handoff validation
- [Implementation Plan](IMPLEMENTATION-PLAN.md) — Roadmap


---

Deliberately spec-first. The mechanism's failure mode is silent data loss, so the design
was settled and raced on purpose before any production code exists.

**That paid for itself: testing disproved two parts of the first draft.** `mv -n` is not
an atomic claim, and breaking a stale lock by delete-then-recreate double-breaks under
load. Both are fixed and re-verified; both are recorded in
[`specs/02-lock-mechanism.md`](specs/02-lock-mechanism.md) because each is the obvious
answer and will be proposed again.

**Implementation plan:** See [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md) for phased
adoption roadmap (4-6 weeks, specification to production).

## What it is

Both agents see the same files and nothing else — no shared memory, no message bus, no way
to observe each other's reasoning. The protocol is built from the only primitive they
share: **the filesystem**.

- **Scope locks** — `mkdir` as the atomic primitive, with a lease, because nothing releases
  a lock when an agent that works in discrete tool calls stops existing.
- **Handoff notes** — markdown, claimed atomically by `mv`, separating what was *verified*
  from what was *assumed*.
- **Incident records** — breaking a lock is allowed; doing it silently is not.

## Specs

| Spec | Contents |
| --- | --- |
| [`01-coordination-protocol.md`](specs/01-coordination-protocol.md) | **The contract.** Scope registry, lock rules, handoff lifecycle, hard rules. If anything else disagrees with this, this wins |
| [`02-lock-mechanism.md`](specs/02-lock-mechanism.md) | Why `mkdir` and not `flock`, the two-step acquire window, lease tuning, deadlock prevention by scope ordering, the ABA case — and what the mechanism does not protect against |
| [`03-handoff-format.md`](specs/03-handoff-format.md) | Note format, claim-by-`mv`, the verified/assumed split, anti-patterns |
| [`04-agent-entry-points.md`](specs/04-agent-entry-points.md) | Binding each tool: Claude's `SKILL.md`, Codex's `AGENTS.md`, thin pointers only |
| [`05-verification.md`](specs/05-verification.md) | `MA-T01…T16`, the adoption sequence, and the rules that are honestly untestable |
| [`06-cli-interface.md`](specs/06-cli-interface.md) | Command-line interface, configuration format, operational modes (interactive/once/daemon), status commands |

## Three design decisions worth knowing up front

**`flock` is rejected.** It is the textbook answer and it is wrong twice here: advisory
locks over WSL2's 9p bridge are unreliable, and `flock` releases on process exit — which
happens after every agent tool call. `mkdir` survives the agent's process ending.

**Scopes are a fixed registry, not path globs.** Deciding whether two locks conflict is
then a string comparison instead of glob-overlap arithmetic. Scopes are acquired in
registry order, and that total ordering is the only deadlock defence.

**Presence of a lock is not proof of ownership.** A slow agent whose lease expired and was
evicted will find the directory exactly as it left it. Only the `agent` field in
`holder.json` is authority — hence the rule to re-confirm ownership immediately before
every batch of writes. See spec 02 for the ABA worked example.

## Recent updates (2026-10-25)

### Operational improvements (morning)
- **Incident visibility** — Acquiring a scope now checks for recent incidents (< 1 hour)
- **Git scope pre-check** — Branch mutations require checking for peer locks first
- **Heartbeat for long operations** — Lightweight liveness signal for operations >5 min
- **Archive index** — `archive/INDEX.md` makes handoff history searchable
- **ABA worked example** — Timeline showing how re-verify prevents silent data loss

### Agent class/instance model (afternoon)
- **N-agent support** — Extended from 2 agents to unlimited, organized by model class
- **Model-based identity** — `codex-gpt-6`, `claude-opus-5`, `claude-sonnet-4` as agent classes
- **Parallel instances** — Multiple instances of same class work simultaneously
- **Capability routing** — Handoffs addressed to agent classes (e.g., "any codex-gpt-6")
- **Instance tracking** — Know which specific agent instance did what work

### CLI interface specification (late afternoon)
- **Command-line interface** — Flags, commands, operational modes
- **Configuration format** — `.kiro/coordination.json` with precedence rules
- **Three modes** — Interactive (human-driven), once (one-shot), daemon (continuous)
- **Status commands** — `locks`, `handoffs`, `incidents`, `status` (non-destructive)
- **Protocol initialization** — `init` and `verify` commands
- **Two integration modes** — Skill-based (AI reads docs, executes bash) and CLI-driven (AI calls trinoris-agent commands)

See [`UPDATES-2026-10-25.md`](UPDATES-2026-10-25.md),
[`AGENT-CLASSES-2026-10-25.md`](AGENT-CLASSES-2026-10-25.md),
[`CLI-SPEC-2026-10-25.md`](CLI-SPEC-2026-10-25.md), and
[`INTEGRATION-MODES-2026-10-25.md`](INTEGRATION-MODES-2026-10-25.md) for full details.

## Verified environment facts

Measured 2026-10-25 in `/mnt/c/Users/Hai-Linh/trinoris/trinoris-control-tower`:

| Fact | Value |
| --- | --- |
| Filesystem | `v9fs` (WSL2 ↔ Windows drive) |
| `mkdir` under real concurrency | **atomic** — 4,200 racing processes (N=2/8/32 × 100 trials), exactly one winner every trial |
| `mv -n` as a claim | **not atomic** — stat-then-rename; returns success when it declines. 2 claimers from 8 racers |
| Delete-then-recreate lock break | **double-breaks** — 25/60 failures at N=8, 59/60 at N=32 |
| Rename-aside lock break | **also double-breaks** — the lock name frees instantly |
| `mkdir`-token guarded break | **safe** — 0 failures at N=8 and N=32 |
| WSL ↔ Windows lock visibility | mutually visible, `holder.json` readable both ways |
| `flock` | present, **rejected** |

Run 2026-10-25. Harnesses in [`tests/`](tests/) — re-run them on any new filesystem
before adopting the protocol there.

## Non-goals

No queue, no priorities, no scheduler, no automatic conflict resolution, and no
enforcement. The protocol makes collisions rare and visible between two cooperating
agents. It is not a sandbox, and it does not defend against an agent that ignores it or a
human saving over both of them from an editor.
