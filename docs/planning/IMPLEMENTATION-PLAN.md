<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->

# Implementation Plan — trinoris-multi-agents

**Status:** Protocol 3 implementation complete; cross-platform hardening validation is the next gate
**Updated:** 2026-10-26
**Repository version:** 0.2.0
**Current baseline:** `1c2a184` (`fix(protocol): align handoff parser with v3 contract`)

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
| `@trinoris/agent-cli` | Setup, verification, status, acquire/release, claim, diagnosis, and recovery commands |

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
- The full repository test suite passed: 120 tests across 13 test files (core 35, SDK 34,
  CLI 51).
- The local v9fs readiness probe passed 50 trials with 8 workers and zero bad trials.

Details and limitations are recorded in [`specs/07-security-hardening.md`](../../specs/07-security-hardening.md).

## Next milestone: cross-platform validation

The Linux/v9fs result does not establish Windows filesystem behavior. The next gate is to
run and review the existing CI matrix in `.github/workflows/security-regressions.yml`:

1. Confirm the Windows jobs complete for the configured Node.js versions and investigate
   filesystem, path, process-spawn, or packaging differences.
2. Confirm the Linux and Node.js 18 packed-consumer jobs still pass on the same commit.
3. Record the workflow run URL, commit, OS, Node.js version, test counts, and any exclusions
   in the security-hardening evidence. Do not describe local v9fs testing as Windows proof.
4. Fix failures test-first, then rerun the affected matrix and full suite.

**Exit criteria:** all required matrix jobs pass, or each unsupported combination has an
explicit, reviewed support boundary. A sandbox-blocked worker run is inconclusive and must
not be recorded as an atomicity failure.

## Follow-up backlog

After the cross-platform gate:

1. Reconcile historical test tables and acceptance criteria in `specs/05-verification.md`
   and `specs/07-security-hardening.md` with the shipped protocol 3 behavior and tests.
   Keep historical MA-T results labeled as historical; do not silently reuse old IDs as
   proof for current entry points.
2. Audit the release workflow against the current package manifests, CI matrix, and actual
   npm publication state before preparing a release. Do not publish as part of validation.
3. Only consider heartbeat/daemon or network coordination after a separate design and
   threat review. These capabilities are explicitly unsupported by protocol 3 today.

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
