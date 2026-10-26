<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->

# Implementation Plan — trinoris-multi-agents

**Status:** Protocol hardening complete; CLI handoff lifecycle implemented locally
**Updated:** 2026-10-26
**Repository version:** 0.2.0
**Current baseline:** `2f6dc5a` (`ci: refresh security workflow runtimes`)

## Purpose

This plan tracks work remaining after the initial prototype. The original Phase 0 and
Phase 1 documents are retained as historical records; their Python CLI, `coordination/`
paths, shell-only lifecycle, and protocol 1/2 examples are superseded. Use the current
package documentation and protocol 3 contract for all new work.

## Current implementation

The repository contains three TypeScript packages:

| Package | Responsibility |
| --- | --- |
| `@trinoris/agent-core` | Protocol contract, validation, types, and handoff parsing |
| `@trinoris/agent-sdk` | Guarded coordination state, scope leases, handoff claims, incidents, and recovery |
| `@trinoris/agent-cli` | Setup, verification, lease lifecycle, handoff lifecycle, diagnosis, and recovery commands |

Protocol 3 stores all local coordination material in the Git-ignored `.trinoris/`
directory. Setup installs the package-owned `PROTOCOL.md`, writes its version and digest,
and updates agent entry points. Handoffs use routed frontmatter, require
`locks_released: true`, and contain the fixed protocol 3 section set. The parser continues
to read legacy protocol 2 notes; new claims follow protocol 3 validation.

The current protocol deliberately disables heartbeat/daemon behavior. Locks are
cooperative and do not fence non-cooperating processes, separate clones, or direct Git
commands. Verify the actual checkout filesystem before relying on its atomic operations.

## Completed in the current baseline

- Protocol 3 runtime state and generated instructions use `.trinoris/`.
- Lease mutations and claims share the guarded mutation protocol; lease actions require
  the exact generation.
- Scope ordering, Git-scope exclusion, stale-state diagnosis, guarded recovery, and
  recipient-aware handoff claims are implemented.
- Protocol 3 handoff parsing and claim behavior have regression coverage; legacy protocol
  2 notes remain readable.
- Release validation includes manifest checks, frozen installation, dependency audit,
  package tests/builds, and packed consumer validation.
- The full repository test suite passed: 121 tests across 13 test files (core 35, SDK 34,
  CLI 52).
- The local v9fs readiness probe passed 50 trials with 8 workers and zero bad trials.

Details and limitations are recorded in [`specs/07-security-hardening.md`](../../specs/07-security-hardening.md).

## Cross-platform validation: complete

GitHub Actions run [40293815948](https://github.com/trinoris/multi-agents/actions/runs/40293815948)
passed on commit `2f6dc5ab1c4e9d83717892bd1008cc89b6be6e36`:

- Windows and Ubuntu on Node.js 20 and 24: all four full-suite jobs passed.
- The Ubuntu/Node.js 20 job also passed the Node.js 18 packed-consumer smoke test.
- The workflow ran manifest validation, high-severity audit, full package tests, and the
  applicable consumer runtime check.

This closes the cross-platform matrix gate for this commit and verifies the refreshed action
versions and pinned Ubuntu runner. The v9fs probe remains separate evidence for its
specific mount.

## Verification-spec reconciliation: complete

`specs/05-verification.md` now separates historical MA-T observations from the current
121-test inventory and passing CI run. `specs/07-security-hardening.md` identifies the
original findings as baseline evidence, records the current protocol 3 controls and matrix
result, and retains uncovered subcases as open rather than treating green CI as proof of
unexercised cases.

## Release workflow audit: complete

Audited commit `6e79925` against the package manifests, the passing security workflow, the
manual publishing guide, release runner, and npm registry on 2026-10-26. All three local
packages are version `0.2.0`, target public npm, and pass `scripts/release-inputs.mjs`.
The registry contains core `0.1.0`, SDK `0.1.0`, and CLI `0.1.1`; none has a published
`0.2.0` version. CI runs manifest validation, high/critical audit, and the full tests but
does not publish. The manual release runner adds frozen install, build, exact tarball
inspection, offline consumer smoke, and dependency-ordered publication, and rejects
registry errors other than a confirmed missing exact version. No workflow or manifest
mismatch was found; no release was published during this audit.

## Heartbeat and network coordination review: complete

[`heartbeat-daemon-threat-review.md`](../decisions/heartbeat-daemon-threat-review.md)
records the threat analysis and decision to keep automatic renewal, daemon behavior, and
network coordination out of protocol 3. The current manual, generation-scoped lease and
handoff model remains the supported local workflow. Reopening this requires an explicit
product requirement, authenticated ownership, write fencing, and a new versioned design.
The review also records the unused empty `heartbeat/` directory as inert compatibility
residue; it has no writer, reader, or authority.

## Follow-up backlog

Automatic heartbeat, daemon, and network coordination remain out of scope unless their
reopen criteria are met. The CLI completion roadmap is
[`CLI-MODE-COMPLETION-PLAN.md`](CLI-MODE-COMPLETION-PLAN.md). Phase 0 reconciled
[`specs/06-cli-interface.md`](../../specs/06-cli-interface.md) to the shipped command
surface and marked the older interactive/daemon proposal as historical. Phase 1, stable
mutation identity and setup-duration options, and Phase 2, the guarded handoff lifecycle,
are complete locally. Phase 3, read-only incident visibility and command usability, is
complete locally. Phase 4, release readiness, is next.

The Phase 3 full local suite passed uncached: 142 tests across 15 files — core (36), SDK
(45), and CLI (61). Turbo rebuilt all three packages. CLI integration tests used real child
processes and filesystem fixtures. The suite was run locally on 2026-10-26; Windows CI
remains the cross-platform verification gate for this change.

## Change and verification rules

- Follow TDD: add a regression that fails for the intended reason before changing runtime
  behavior.
- Preserve stable finding and test IDs; add new IDs rather than renumbering history.
- Run `pnpm run test --force` after implementation changes. For release changes, use the
  release validation path and inspect the exact packed artifacts.
- Run `node packages/cli/dist/bin.js verify --work-dir <target>` on the actual checkout
  mount before adopting coordination there, and rerun after mount or host changes.
- Describe assumptions, unsupported environments, and unexecuted jobs as such.

## Historical planning records

- [`PHASE-0-COMPLETE.md`](PHASE-0-COMPLETE.md) records the original prototype and is not
  the shipped package architecture.
- [`PHASE-1-STARTED.md`](PHASE-1-STARTED.md) records early manual handoff trials using the
  former layout; its command examples are not current operating instructions.
