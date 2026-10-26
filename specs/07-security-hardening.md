# Package Security Review and Hardening Requirements

**Review date:** 2026-10-25
**Current evidence updated:** 2026-10-26

**Scope:** `packages/core`, `packages/sdk`, and `packages/cli`, including package manifests, release tooling, and the package tests/specifications.

**Reviewed baseline:** `2757b3ba4f1e64c46e8dcb8d6f4042003abf7fa3`. The original review was committed as `9b48485`; the remediation status below describes the current protocol 3 implementation against that historical baseline.

**Review type:** Static review, isolated probes, and TDD implementation. The finding descriptions and source line references below preserve the original baseline evidence. Current controls and regression coverage are tracked separately; they must not be read as claims that the old behavior remains in the implementation.

**Release readiness:** Local Linux gates pass, but this working tree is not ready to publish.
The current edits still need a clean commit and a fresh Windows/Ubuntu CI run against that
exact commit. The older CI run listed below predates the current implementation and is not
release evidence for it.

## Protocol 3 state-root migration

The current CLI stores all local coordination state and its package-owned contract under
`.trinoris/`. Setup adds the root-anchored `/.trinoris/` rule to the target repository's
`.gitignore`; `verify` reports `gitignoreOk` and cannot return ready when that rule is absent.
Setup adds managed pointers to `AGENTS.md` for Codex and `CLAUDE.md` for Claude Code,
preserving existing instructions around those blocks. It also installs the Claude project
skill. Both agent entry points reference `.trinoris/PROTOCOL.md` and
`.trinoris/handoff/TEMPLATE.md`; both agents use the same CLI validator. The CLI and SDK use
this same root, and setup refuses to create a second top-level `coordination/` tree.

This is a protocol 3 layout change because protocol 2 clients continue using
`coordination/`. Migration requires stopping all earlier clients, archiving the old tree
outside the checkout, selectively reviewing history, creating a fresh `.trinoris/`, then
verifying before any protocol 3 client resumes. Do not restore active leases or mutation
markers. Regression coverage is in CLI setup, verification, and installed CLI journey tests.

## Protocol 3 implementation status

All 17 original findings have implementation controls and automated regressions in the
current code. This does not close every platform-specific matrix subcase. Consumer packages
are prepared as `0.2.0`; publication remains blocked until the clean-commit and current
cross-platform CI gates below pass. The implementation uses a package-owned versioned
contract, a shared mutation guard, generation-aware leases, strict bounded records and
paths, and explicit offline marker recovery.

| Findings | Implemented control | Regression source |
| --- | --- | --- |
| MA-SEC-01, 04 | Contained logical paths; ancestor/link/type checks; bounded no-follow file reads; preflighted atomic setup writes | SDK `security.test.ts`, `policy.test.ts`; CLI `setup.security.test.ts` |
| MA-SEC-02, 12 | One mkdir guard for all mutations; generated lease nonce; live-lease checks; safe expired cleanup | SDK `security.test.ts`, `policy.test.ts`, `concurrency.integration.test.ts`; CLI journey |
| MA-SEC-03, 10 | Unique verifier arenas; owned cleanup; bounded yielding workers; timeout/abort and readiness results | CLI `verify.test.ts`, `cli.integration.test.ts` |
| MA-SEC-05, 13 | Strict recipient/frontmatter validation; per-instance destination; collision preservation; claimant/digest receipts and interrupted-move retry | Core `security.test.ts`; SDK `security.test.ts`, `policy.test.ts` |
| MA-SEC-06 | Schema, duration, timestamp, configuration, version, file size/type and I/O validation; no adoption of a legacy record as authority | Core `security.test.ts`; SDK `security.test.ts`, `policy.test.ts` |
| MA-SEC-07 | Read-only diagnostics and exact-ID stopped-actor recovery; no time/PID stealing | SDK `policy.test.ts`, real crash integration; CLI recovery journey |
| MA-SEC-08 | Turbo 2.9.14, esbuild 0.28.2 override, migrated Turbo tasks; frozen lock and retained audit | Release input/security tests; refreshed audit |
| MA-SEC-09 | Bounded identifiers/text; controls rejected or escaped; structured incident JSON | Core validation/security tests; SDK input tests; CLI escaped output |
| MA-SEC-11, 16 | OTP argv removed; clean source required for publication; actual pnpm pin; credential-isolated gates; parsed lock/source policy; exact tarball inspection/install/digests; failed test output retained in the release evidence bundle | Release input/security tests and `packed.integration.test.ts` |
| MA-SEC-14 | Unique attempted/completed/failed events; preserved stale state; explicit state-committed result on failure | SDK `policy.test.ts` injected storage failures and takeover integration |
| MA-SEC-15 | Registry validation, ordered all-or-none batches, reciprocal Git/edit guard; unsupported heartbeat explicitly disabled and rejected | SDK `policy.test.ts`; core configuration tests |
| MA-SEC-17 | Installer ships complete contract; verifier checks its version/hash separately from filesystem atomicity | Setup/verifier tests; divergent-contract CLI journey |

TDD evidence includes the initial **29 failing regressions**, four failing verifier regressions, four failing release-input cases, and the failing CLI/packed-consumer journeys before their fixes. Further failure tests exposed incomplete-marker recovery, interrupted receipt retry, invalid recorded duration, maximum-length takeover summary, and identity-field override defects before correction. Durable tests live beside the package entry points; temporary review probes are not used as the release gate.

The `20261025T1430-embedded-protocol-missing-rules.md` handoff was checked against the evolving contract. No-spin, lease/grace, and guarded takeover were already present; the explicit unsafe-move warning and historical counterexamples were added after two failing regressions. Core `protocol.test.ts` and the empty-consumer setup regression now protect all four rules in the shipped contract. Historical 21/100, 25/60, and 59/60 results are attributed to the recorded v9fs primitive experiments, not presented as current SDK certification.

Historical GitHub Actions run [40293815948](https://github.com/trinoris/multi-agents/actions/runs/40293815948)
passed on commit `2f6dc5ab1c4e9d83717892bd1008cc89b6be6e36`. It predates the current
protocol 3 implementation and only demonstrates that historical revision's Windows and
Ubuntu matrix. It must not be used to approve publication of the current changes. The latest
local run is Linux / Node.js 24.22.1; the clean installed-tarball consumer journey also
passed on an explicitly verified Node.js 18.20.8 binary. A negative regression prevents
falling back to the host runtime while asserting a different acceptance target.
Published runtime metadata retains the tested Node.js 18+ consumer contract; release tooling
requires Node.js 20+.

Validation commands and retained results:

- `pnpm run build`: passed for all three packages on 2026-10-26.
- `pnpm run test --force`: **154 tests passed** across 15 files (core 36, SDK 50, CLI 68), with no cached tasks. Includes real process claim/acquire/takeover races, killed-process recovery, verifier success/failure/abort cleanup, dangling links, hard links, special files, additive/idempotent Codex and Claude setup instructions, template parsing, CLI journeys, release-failure log retention, and offline installation/inspection of all three tarballs.
- TypeScript `--noEmit` checks for core, SDK, and CLI: passed, including test sources and declarations for release helpers.
- `node scripts/release-inputs.mjs`: all three package manifests, reviewed workspace policy, and parsed lockfile passed.
- Refreshed npm audit: zero informational, low, moderate, high, or critical advisories.
- `bash scripts/release.sh --dry-run`: completed with `published: []`, three inspected `0.2.0` tarballs, zero npm audit advisories at every severity, test evidence, and a CycloneDX inventory. Evidence is in `.release-artifacts/trinoris-release-BKsS6D/`. This rehearsal records `dirty_snapshot: true` and source commit `a6fe3ee`; it is local validation only, not a publishable release artifact. The real release requires a clean committed snapshot and reruns all gates.
- `node scripts/consumer-runtime-smoke.mjs <node-18-binary> 18`: clean offline installed consumer passed on Node.js 18.20.8.

Remaining limits are explicit: this cooperative filesystem protocol cannot authenticate local writers or fence an editor paused after a check. Directory-entry power-loss durability is filesystem-dependent. Heartbeat/daemon support is unavailable rather than silently enabled. A recovery guard abandoned during offline recovery requires operator inspection with all actors stopped; it is never stolen automatically. The high/critical audit threshold remains the required policy; moderate/low failure is not silently imposed as a new publishing policy.

## Executive summary

The packages coordinate cooperating local agents through filesystem locks and handoff notes. The principal risks are unsafe filesystem path construction, lock mutation races, and a verifier that can recursively delete an existing user directory. The current identity fields are coordination metadata, not authentication. The packages must not be presented as a security boundary against another process that can write to the same checkout.

| ID | Priority | Original finding | Evidence in reviewed baseline |
| --- | --- | --- | --- |
| MA-SEC-01 | P1 | Traversal escapes the coordination root | SDK `lock.ts:35-37,204-218`; reproduced out-of-root deletion |
| MA-SEC-02 | P1 | Lock mutations can damage a successor | SDK `lock.ts:78-193`; reproduced three forced race interleavings |
| MA-SEC-03 | P1 | Verifier removes preexisting data | CLI `verify.ts:170-172,197`; reproduced deletion during a successful probe |
| MA-SEC-04 | P1 | Setup/state writes follow symlink targets | CLI `setup.ts:35-37,51-53,114`; reproduced external target overwrite |
| MA-SEC-12 | P1 | Expired leases pass ownership checks and renew | SDK `lock.ts:103-114`; reproduced both behaviors |
| MA-SEC-13 | P1 | Handoff move overwrites an existing destination | SDK `lock.ts:213-215`; reproduced on Linux |
| MA-SEC-05 | P2 | Handoff recipient rules are not enforced | SDK `lock.ts:204-219`; CLI `bin.ts:187-194` |
| MA-SEC-06 | P2 | Invalid records/config and I/O failures are conflated | SDK `lock.ts:50-75`; core `utils.ts:11-36,65-81`; CLI `bin.ts:25-36` |
| MA-SEC-07 | P2 | Crashes leave permanent claim/break markers | SDK `lock.ts:146-147,192-193,207-218` |
| MA-SEC-08 | P2 | Known development advisories pass the configured audit threshold | `release.sh:37-38`; refreshed audit: 1 moderate, 2 low |
| MA-SEC-14 | P2 | Incident records can imply a takeover that never completed | SDK `lock.ts:157-190`; incident is written before takeover |
| MA-SEC-15 | P2 | Registry/heartbeat/git safety requirements exceed enforcement | CLI `bin.ts:144-147`; SDK has no corresponding coordination policy checks |
| MA-SEC-16 | P2 | Release manifest checks cover only part of executable inputs | `release-inputs.mjs:116-149`; `release.sh:35,41,97,118` |
| MA-SEC-17 | P2 | Adoption gate can pass with a placeholder or divergent protocol | CLI `setup.ts:111-123`; `verify.ts:148-166` |
| MA-SEC-09 | P3 | Unbounded control/markup text reaches output | SDK `lock.ts:160-171`; CLI status/error messages |
| MA-SEC-10 | P3 | Verifier work is unbounded and workers spin | CLI `verify.ts:34-40,64,76` |
| MA-SEC-11 | P3 | Release OTP is exposed through argv | `release.sh:22,110,113-115,118` |

Priorities describe remediation order, not proof of exploitability in every deployment. P1 findings should be addressed before recommending the SDK for use on repositories containing untrusted content or valuable local data.

## Threat model and security boundary

The protocol is a local coordination aid for agents that share a working tree and follow the same contract. Its locks are not an authorization service and do not authenticate an agent. The `agent_instance`, `agent_class`, task, and handoff metadata are ordinary writable files. A process able to modify the checkout or coordination directory can forge another identity, alter lock contents, bypass the CLI, or modify work directly.

The implementation should protect against malformed inputs, accidental races, and a caller passing untrusted path or metadata values. It cannot provide isolation against a hostile process with the same filesystem permissions. Document this boundary in the package README and CLI help. Do not use this protocol as a tenant boundary, privilege boundary, or substitute for operating-system access controls.

The root README and CLI README already describe the cooperative boundary and the need for a stable `--instance`; retain those explanations. Checking ownership before an edit still leaves a pause between the check and the actual edit. Serializing metadata updates cannot fence an editor or tool that resumes after its lease has been replaced. Strict write exclusion would require every protected write to pass through a gate that enforces the current generation, or separate working trees.

## Second-review corrections and evidence

- `path.join(root, 'locks', '/tmp/example.lock')` does not reset to `/tmp`; the original review overstated absolute-path behavior. Traversal with `..` does escape: `release(paths, '../../victim', instance)` deleted a prepared `victim.lock` fixture outside the coordination root. Still reject absolute, drive, UNC, separator, and device-path inputs as unsupported identifiers.
- `rmSync(finalSymlink, { recursive: true, force: true })` removed the symlink itself and preserved its target in the probe. The verified deletion risk is the fixed verifier directory; parent symlinks/junctions and write operations remain separate path-redirection risks.
- `--audit-level=high` scans for advisories and deliberately tolerates lower severities. It matches the existing high/critical release policy. Moderate gating below is a proposed tightening, not evidence that the existing threshold is malfunctioning.
- The READMEs distinguish Node.js 18+ consumer runtime from Node.js 20+ build/test tooling. Adding package `engines` must reflect a tested consumer runtime rather than copying the development requirement automatically.
- `agent-core` explicitly promises no Node dependencies. Any stronger ID generator must preserve that boundary through a compatible global crypto API or an injected generator.

Runtime probes transpiled the current source into a temporary directory and ran on Linux / Node.js `v24.22.1`. All mutations stayed in disposable fixtures. Forced filesystem interleavings demonstrated successor overwrite/deletion and fresh-acquisition eviction; these prove reachable sequences, not their frequency under real multi-process scheduling. A real verifier run with one trial and two workers passed its atomicity probe while deleting a preexisting sentinel. An initial sandbox run timed out because child execution was restricted; that inconclusive attempt was not treated as a filesystem defect. Windows filesystem behavior was not executed in this review.

At the original review stage, the package tests were inspected but not rerun. They covered sequential lifecycles and simple handoff moves, while verifier tests covered invalid options and mocked failures. Protocol 3 added the current regressions listed above. Historical primitive race results in spec 05 are not a substitute for tests against the current SDK entry points.

## Historical baseline findings and required controls

The detailed finding text below preserves behavior and proposed fixes observed at the
original review baseline. It is not a statement that the old vulnerability remains present.
Use the protocol 3 implementation table and current validation evidence above for present
status. Historical implementation gaps are kept for audit traceability.

## Detailed findings

### MA-SEC-01 / P1 — Validate and contain all filesystem paths

**Affected:** [`packages/sdk/src/lock.ts`](../packages/sdk/src/lock.ts), [`packages/cli/src/bin.ts`](../packages/cli/src/bin.ts), [`packages/cli/src/commands/setup.ts`](../packages/cli/src/commands/setup.ts).

The SDK interpolates caller-controlled `scope` into lock and incident paths. `claim` joins `noteFilename`, `fromDir`, and `toDir` to the coordination root without validating them. Traversal can direct operations outside that root. Depending on the operation, this can write a holder file, rename a caller-selected file, create directories, or recursively remove a path. The CLI exposes these values through command-line arguments; only CLI `acquire` checks scope membership, so that check does not protect the SDK or other CLI verbs. Setup also uses caller-provided agent classes as directory names.

**Required hardening:**

- Define strict grammars and length limits for scope, agent class, instance ID, and note filename. Reject separators, `.`/`..`, absolute paths, NUL, control characters, and platform-specific drive/UNC prefixes.
- Replace unrestricted `fromDir` and `toDir` with validated logical locations, including `handoff/for-<class>` and `active/<instance>`. Preserve documented instance inboxes through a versioned API migration; do not silently reject legitimate consumers without a migration path.
- Resolve the coordination root once, validate it, and verify every derived path remains beneath it. Reject symlinked path components and symlinked final files for sensitive operations. Recheck immediately before mutation to reduce time-of-check/time-of-use exposure.
- Use exclusive creation and restrictive permissions for state files/directories where supported; do not silently follow an existing symlink when creating or replacing state.
- Add tests that use traversal, absolute paths, Windows drive/UNC forms, and symlinked parents/final targets while asserting sentinel files outside the root remain unchanged.

### MA-SEC-02 / P1 — Serialize every lock mutation, not just lock breakers

**Affected:** [`packages/sdk/src/lock.ts`](../packages/sdk/src/lock.ts), especially `renew`, `release`, and `breakLock`.

`breakLock` serializes competing breakers with a `.breaking` directory, but `renew` and `release` do not participate in that protocol. A renew can read the old holder, lose a race to takeover, then write its old holder data over the successor's `holder.json`. A release can check ownership, lose a race to takeover, then recursively remove the successor's lock directory. These operations can report success while invalidating another agent's lease.

A third sequence is also possible: after the breaker checks staleness, the old owner releases and another agent acquires; the breaker then renames the fresh lock aside. The post-write `isHolder` check sees the breaker's own record and still reports success. Rechecking only the final identity does not detect the erroneous eviction. An acquirer paused after `mkdir` and resumed after malformed-lock recovery presents the same generation problem.

**Required hardening:**

- Specify one per-scope mutation protocol covering acquire, renew, release, break, and any future lock update. Ownership must be revalidated while holding the mutation guard, and the guard must protect the complete read/modify/write or remove operation.
- Make holder replacement atomic (write a uniquely named temporary file, flush as required by the supported durability contract, then rename) while ensuring the lock generation/owner has not changed.
- Add a monotonically changing generation or unique lock nonce; compare it during renew/release so a stale actor cannot mutate a successor lock that happens to reuse an identity string.
- Define crash recovery for the mutation guard without permitting a second mutator to proceed while the first may still be active.
- Add deterministic interleaving tests plus real multi-process races for renew-vs-break, release-vs-break, release/acquire-vs-break, renew-vs-release, two simultaneous takeovers, and an acquirer paused between directory creation and holder publication. Assert a valid winner when acquisition completes, no duplicate successful ownership, and no stale mutation of a later generation. A completed release may legitimately leave no holder.

### MA-SEC-03 / P1 — Make verifier cleanup exclusively own its temporary directory

**Affected:** [`packages/cli/src/commands/verify.ts`](../packages/cli/src/commands/verify.ts).

`verify` unconditionally runs recursive removal on the fixed path `coordination/.verify-atomicity` before and after its probe. If a user already has that directory, it is deleted. When setup is incomplete, the same fixed name is used under the system temporary directory, so unrelated verifier invocations can also remove each other's probes. Removing a final symlink itself does not recursively remove its target; do not describe that as the exploit.

**Required hardening:**

- Create a unique verifier-owned directory using `mkdtemp` inside the selected filesystem, with a name that cannot collide with user data.
- Never recursively remove a path that was not created by this invocation. Track creation and clean up only the exact temporary directory; refuse symlink targets.
- Put cleanup in `finally` so exceptions do not leave probes behind, while preserving any preexisting content.
- Add a regression test that prepopulates `.verify-atomicity` with nested sentinel data and verifies it survives a successful run and a failing run.

### MA-SEC-04 / P1 — Harden setup against symlink clobbering and unsafe overwrite

**Affected:** [`packages/cli/src/commands/setup.ts`](../packages/cli/src/commands/setup.ts).

Setup checks `existsSync` and then writes or copies files. With `--force`, an existing symlink can be followed and its target overwritten; the probe reproduced this with `AGENTS.md`. A dangling symlink can be followed even without `--force`, because `existsSync` returns false when its target is missing. Directory creation can also traverse symlinked components. This is especially relevant when an agent initializes a repository containing untrusted files.

**Required hardening:**

- Reject symlinked coordination and generated-file paths before writing; ensure resolved destinations remain within the selected work tree.
- Use no-follow/exclusive file creation where available and use atomic replacement for intentional force updates.
- Make `--force` report exactly which regular files it will replace; do not overwrite symlinks, directories, or special files.
- Validate agent-class and scope configuration before creating paths or emitting JSON.
- Add tests with symlinked `coordination`, `.kiro`, generated files, and handoff inboxes.
- Include dangling links, hard-linked existing files, Windows junctions, and reparse points in the supported-platform plan. A lexical containment check and `lstat` followed by a write cannot defeat a hostile same-permission process replacing ancestors concurrently; retain the stated security boundary.

### MA-SEC-12 / P1 — Make ownership checks enforce the active lease

**Affected:** SDK `isHolder` and `renew`, CLI `check` and `renew`.

`isHolder` checks only `agent_instance`, so CLI `check` reports success for an expired lease as long as the old holder record remains. `renew` also accepts that record and resurrects its lease, even after the grace period. The probe confirmed both with a 2020 expiry. These behaviors conflict with using `check` as permission to continue writing under a current lease.

**Required hardening:**

- Distinguish recorded ownership from active ownership. The check used before edits must require a validated record, the expected generation, and a live lease at a specified time.
- Define expiry consistently at the exact boundary. Existing core tests intentionally treat the exact expiry instant as live; either retain that rule everywhere or version an explicit change.
- Reject renewal after loss/expiry and require safe reacquisition through the mutation protocol. Grace delays takeover; it must not silently extend the old owner's authority to edit.
- Allow safe cleanup of an expired record only when its generation still matches. Never remove a successor while attempting cleanup.
- Test expiry, grace, post-grace, and identity-reuse cases using an injected clock and explicit generations.

### MA-SEC-13 / P1 — Prevent claim destination overwrite and isolate active work

**Affected:** SDK `claim`, CLI default destination, and the active-note lifecycle in spec 03.

`claim` uses `renameSync(src, dest)` without a destination collision policy. On Linux the probe replaced an existing `active/task.md` with the newly claimed note. The transient marker serializes claimers for the filename but does not reserve the destination beyond that move. The CLI defaults to a shared `active/` directory, while spec 03 describes `active/<agent-instance>/`. Two notes from different inboxes or a reused filename can therefore destroy active work after the earlier marker has been removed.

**Required hardening:**

- Resolve the destination from the validated claimant identity and an immutable note ID, using the specified per-instance active location.
- Return an explicit conflict without altering source or destination when the destination already exists. An `existsSync` check followed by unguarded rename is insufficient for concurrent callers.
- Reserve source and destination under the claim protocol, or use another proven collision-safe publication primitive for the supported filesystem. Do not substitute the previously disproved `mv -n` behavior.
- Record claimed-by identity and a content digest; retries must distinguish an already-completed identical claim from a conflicting note. A marker keyed only by basename is not a durable note identity.
- Test same-name notes in different inboxes, a preexisting destination, repeated attempts, and concurrent publication on supported platforms.

### MA-SEC-05 / P2 — Enforce handoff recipient and metadata before claiming

**Affected:** [`packages/sdk/src/lock.ts`](../packages/sdk/src/lock.ts), [`packages/core/src/utils.ts`](../packages/core/src/utils.ts), CLI `claim`; contract in [`specs/01-coordination-protocol.md`](01-coordination-protocol.md).

The protocol says a handoff may target a class or a specific instance and must only be claimed by that recipient. The current `claim` implementation only checks that the source file exists and that its claim marker can be created; it does not parse `to_class`/`to_instance`, verify scopes, or compare them with the requesting identity. The CLI moves the note without enforcing the documented recipient rule. `parseFrontmatter` accepts arbitrary keys and casts partially parsed data to `HandoffMetadata` without validating required fields, types, duplicates, or allowed values.

**Required hardening:**

- Change the claim API to receive the caller identity and validate the handoff schema and recipient before moving the note.
- Validate `to_class`, `to_instance`, and requested scopes. Reject missing, duplicate, malformed, unknown, or conflicting metadata; define explicit compatibility behavior for old notes.
- Keep the atomic claim marker as the concurrency primitive, but parse and validate while holding it and release it on all failures.
- Add tests for wrong class, wrong instance, missing recipient, malformed/duplicate fields, scope mismatch, simultaneous claims, and a note changed between inspection and claim.
- Define the supported meaning of `to_class: any` and `to_instance: any` consistently with specs 01/05. Claiming a note does not acquire its scopes; the receiver must still acquire them in registry order before editing.
- Bound the note/frontmatter size before reading and reject dangerous/unknown metadata keys. This is routing validation among cooperating agents, not authentication against a malicious local writer.

### MA-SEC-06 / P2 — Validate lock records and configuration; fail closed on I/O errors

**Affected:** [`packages/core/src/utils.ts`](../packages/core/src/utils.ts), SDK lock reading/inspection, and CLI `loadConfig` in [`packages/cli/src/bin.ts`](../packages/cli/src/bin.ts).

`calculateExpiration` accepts non-finite, negative, and unbounded durations. `isLockExpired` treats an invalid date as not expired because comparisons with `Invalid Date` are false. `readHolder` catches every error and returns `null`, conflating a missing or malformed file with permission errors and transient I/O failures. `inspect` can then classify an unreadable lock as malformed and eventually break it. CLI configuration is shallowly parsed without validating registry shape, durations, or bounds.

**Required hardening:**

- Validate holder records at runtime: required identity, scope, valid ISO timestamps, expiry after acquisition, bounded strings, and supported schema/protocol version.
- Distinguish `ENOENT` and parse/schema errors from permission and other I/O errors. On uncertain I/O, fail closed and do not evict or overwrite the lock.
- Validate configuration with a strict schema and documented minimum/maximum lease and grace periods; reject `NaN`, infinity, negative values, and unreasonable values.
- Use the same validated configuration path in setup, CLI operations, and verifier checks; report invalid configuration clearly rather than silently falling back.
- Add tests for invalid dates, missing fields, wrong field types, unreadable files, truncated JSON, extreme durations, and unknown schema versions.
- Bound record/config file sizes before reading and reject directories, FIFOs, devices, and unsupported file types so inspection cannot block indefinitely on a special file. Handle disappearance between existence/read/stat operations as a typed retry or contention outcome.
- Validate before creating the lock directory. A failure while formatting expiry or writing a holder must not report acquisition success or leave unclassified state. Keep incomplete acquisitions recoverable under the generation protocol.

### MA-SEC-07 / P2 — Define recoverable claim and breaker markers

**Affected:** SDK `claim` and `breakLock`.

The `.claim` and `.breaking` marker directories are removed in `finally`, but process termination, host failure, or `SIGKILL` skips that cleanup. A leftover marker currently blocks future claims or stale-lock recovery indefinitely. Any automatic recovery must not permit a second actor to proceed while the original mutator may still be operating.

**Required hardening:**

- Store marker metadata (operation ID, owner instance, creation time, protocol version) atomically and define an explicit stale-marker recovery procedure.
- Age or a PID alone cannot prove the marker owner is no longer active. A second directory guard alone does not solve the problem: it introduces another guard that can also be abandoned. Begin with explicit operator recovery after confirming affected actors are stopped; automatic recovery requires a specified fencing mechanism and tested failure assumptions.
- Document manual recovery and provide a read-only diagnostic command before enabling automated recovery.
- Add process-kill tests at each mutation boundary and verify both safe recovery and non-duplication.

### MA-SEC-08 / P2 — Update vulnerable build tooling and make audit policy explicit

**Affected:** root dependencies and [`scripts/release.sh`](../scripts/release.sh).

The refreshed `pnpm audit --json` reported **1 moderate and 2 low advisories; 0 high and 0 critical**. The vulnerable resolutions match the lockfile:

- `turbo@1.13.4` is affected by a moderate self-hosted login CSRF/session issue and a low-severity malicious Yarn configuration code-execution issue; both advisories list `2.9.14` as the fixed release.
- `esbuild@0.27.7`, resolved through `tsup`, is affected by a low-severity Windows development-server path traversal issue; the advisory lists `0.28.1` as fixed.

The release script gates only `pnpm audit --audit-level=high`, so these findings do not block release. The Turbo advisories are most directly relevant when using affected remote-cache authentication flows or running Turbo against untrusted repositories. The esbuild advisory concerns the development server, not ordinary production build output, but should still be removed from the resolved toolchain.

**Required hardening:**

- Upgrade Turbo to a patched supported version and migrate the current `turbo.json` `pipeline` configuration as required by that major version. Update the release validator's exact dependency allowlist alongside the manifest and lockfile.
- Upgrade the esbuild resolution to a patched release through `tsup` or a reviewed pnpm override; confirm all lockfile paths resolve to the fixed version.
- Retain the required high/critical gate and propose moderate failure as an explicit policy change. Track tolerated moderate/low findings with advisory, affected path, exposure, owner, and expiry instead of describing a high-only gate as a clean audit.
- Retain the lockfile and frozen install requirement; record the audit JSON/SBOM with each release.

References: [GHSA-hcf7-66rw-9f5r](https://github.com/advisories/GHSA-hcf7-66rw-9f5r), [GHSA-3qcw-2rhx-2726](https://github.com/advisories/GHSA-3qcw-2rhx-2726), [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr).

### MA-SEC-09 / P3 — Escape and bound human-readable output

**Affected:** `breakLock` incident generation and CLI status/error messages.

`scope`, agent identity, and `reason` are interpolated into Markdown incident records and terminal output without escaping or length limits. ANSI escape sequences and newlines can make terminal output misleading; Markdown metacharacters can make a durable incident record appear to contain fabricated sections or attribution.

**Required hardening:**

- Validate identifiers and bound free-text fields, including `task` and break `reason`.
- Escape Markdown values (or store structured JSON as the authoritative incident record and render a safe Markdown view).
- Strip or visibly escape terminal control characters and newlines in single-line CLI fields; never log secrets accidentally supplied as task/reason text.
- Test ANSI, newline, Markdown-link, and oversized payload inputs.

### MA-SEC-10 / P3 — Bound verifier work and remove busy polling

**Affected:** CLI `verify` in [`packages/cli/src/commands/verify.ts`](../packages/cli/src/commands/verify.ts).

The verifier accepts user-controlled trial and concurrency values with no practical upper bounds. It starts one child process per concurrency slot and performs a synchronous tight loop while waiting for a barrier. Large values can consume CPU, memory, and process-table capacity; a runaway verifier can interfere with the user's work.

**Required hardening:**

- Set conservative documented maxima for trial count and concurrency and reject values above them before creating temporary files or processes.
- Replace the synchronous busy loop with a low-overhead synchronization method (for example IPC or a bounded sleep/yield loop).
- Ensure every child is terminated and reaped on timeout, signal, or parent failure; use a single bounded overall deadline.
- Add tests for limits, timeout cleanup, process-start errors, and interruption.

### MA-SEC-11 / P3 — Reduce release OTP exposure

**Affected:** [`scripts/release.sh`](../scripts/release.sh).

The release script accepts `--otp=...`, which can expose one-time publish credentials in shell history and process listings. Its silent prompt avoids terminal echo, but still adds the entered OTP to the child `pnpm publish` arguments. Replacing the top-level argument with an environment variable alone does not remove that child-process exposure.

**Required hardening:**

- Remove the top-level OTP argument and prefer supported registry interactive handling, trusted publishing, or a suitably restricted publishing credential. If a tool requires an OTP argument internally, document that residual local-process exposure explicitly; do not claim that a silent read or environment variable eliminates it.
- Update usage text and release documentation to remove the argument form.
- Add a static release-script check that rejects credentials in argv/log output.

### MA-SEC-14 / P2 — Make incident outcomes accurate and distinguish evidence from assertions

**Affected:** SDK `breakLock` incident write, stale-directory rename, and final holder publication.

The incident is headed `Broken lock` and written before the stale directory is moved or the new holder is published. A later exception or `lost-race` result leaves a record that can appear to describe a completed takeover. The filename depends on scope plus a millisecond timestamp, and `writeFileSync` can replace an existing record. Records and preserved holder files are mutable by other writers with the same permissions; the free-text reason is an assertion, not proof the old owner stopped.

**Required hardening:**

- Give each operation a unique ID and explicit attempted/completed/failed stages. Record the old and new generations, actor, validated scope, timestamps, and result; an incomplete attempt must not appear as a successful eviction.
- Create records without overwriting prior evidence and correlate them with preserved stale state. Define recovery when incident publication, holder write, or rename fails.
- Keep structured data authoritative and render escaped Markdown from it. State local tampering limits; a hash stored beside writable content does not provide independent authenticity.
- Test failures before/after each filesystem mutation, duplicate timestamps, and generation mismatch while asserting truthful recorded outcomes.

### MA-SEC-15 / P2 — Reconcile declared coordination policies with enforcement

**Affected:** specs 01/02/05 and current SDK/CLI policy behavior.

The CLI checks the registry only for `acquire`; SDK calls and other CLI verbs have no shared registry policy. There is no multi-scope ordering enforcement, heartbeat writer/reader, recent-incident check on acquire, or peer-lock guard for Git branch mutations, although spec 05 declares those requirements (`MA-T06`, `MA-T07`, `MA-T09`, `MA-T13`) and marks their tests not written. Setup emits `heartbeat.enabled: true`, despite the absence of that behavior in the packages. These are implementation/contract gaps; direct Git commands and non-cooperating file edits remain outside enforcement.

**Required hardening:**

- Choose a supported policy contract for SDK and CLI and validate it centrally. Reject unknown scope operations consistently without confusing cleanup of an older supported scope with an arbitrary path.
- For operations touching several scopes, expose ordered acquisition with rollback on partial contention; do not let callers retain a partial set while repeatedly waiting for another scope.
- Either implement the declared heartbeat/incident behavior with bounded freshness and trusted-state rules or mark it unsupported and stop emitting enabled configuration. A spoofable heartbeat must not become an unlimited lock extension.
- Specify Git mutation intent and the checks needed in both directions: acquiring a Git mutation guard must account for existing peer edits, and new peer edits must respect an existing Git mutation guard. Merely checking before one `git` acquisition leaves a race.
- Preserve stable test IDs in spec 05 and add regressions for the actual SDK/CLI entry points. Make advisory/operator responsibilities explicit wherever the packages cannot enforce the rule.

### MA-SEC-16 / P2 — Define the trusted release inputs and publish the reviewed artifact

**Affected:** `scripts/release-inputs.mjs`, `scripts/release.sh`, workspace/build configuration, and package tarballs.

The manifest validator is a useful allowlist, but its lockfile check only verifies format and importer names. It does not inspect tarball sources or executable package-manager/build configuration. A frozen lockfile checks consistency with its recorded resolutions; it does not establish that a modified lockfile or its integrity values were reviewed. The release script invokes `pnpm` from `PATH` without verifying the actual version, runs source tests/builds with the caller's environment, and publishes with `--no-git-checks`. Thus uncommitted inputs or modified build configuration can reach an irreversible publish. No malicious configuration was found; this finding identifies the limits of the claimed release checks.

**Required hardening:**

- Release from a trusted, identified source snapshot. Record commit/diff state and input hashes; refuse unreviewed modifications or require an explicit reviewed snapshot rather than silently bypassing Git checks.
- Verify the actual Node/pnpm versions and review workspace membership, `.npmrc`, package-manager hooks, build/test configuration, and lockfile source changes. Lifecycle-script suppression is not a sandbox for other executable hooks. Where supported, disable unneeded pnpmfile hooks explicitly.
- Run dependency installation, tests, and builds without publishing credentials. Supply least-privileged, short-lived credentials only to the final publication step.
- Build and inspect exact packed artifacts, validate rewritten workspace dependencies and installability, record their digests, and publish those same bytes. Do not repack unreviewed changes after approval.
- Treat cached test/build results according to an explicit release policy; retained evidence must identify the inputs and artifact tested. Manifest-string checks alone do not validate behavior or generated content.

### MA-SEC-17 / P2 — Verify protocol readiness separately from mkdir atomicity

**Affected:** CLI setup/verify and adoption claims in spec 05.

Setup copies `specs/01-coordination-protocol.md` from the target repository if present, otherwise writes a placeholder. `verify` checks a handful of directories and only that a configuration has a nonempty registry array; it does not validate `PROTOCOL.md`, protocol version/digest, generated instruction destinations, scope types, or unsupported enabled capabilities. A tree with a placeholder contract can pass the filesystem probe and configuration checks. Passing mkdir trials proves the observed primitive behavior for that run, not end-to-end lock safety or authenticity of agent instructions.

**Required hardening:**

- Ship or obtain a reviewed versioned contract and record its expected digest. Do not treat an arbitrary repository-local instruction file or placeholder as the canonical package protocol.
- Verify protocol identity, supported configuration version, safe regular-file destinations, registry schema, and implemented capabilities before returning an adoption-ready result.
- Report filesystem atomicity and protocol readiness as distinct results. Missing or divergent contracts must block readiness without being mislabeled as a mkdir defect.
- Test placeholder, absent, modified, symlinked, and unsupported-version contracts with a real successful primitive probe. Generated `AGENTS.md`/skill pointers must identify the same reviewed contract.

## Package-level review notes from the original baseline

### `packages/core`

- Core is small and has no direct runtime network or credential behavior in the reviewed surface.
- Date arithmetic and handoff parsing are permissive and rely on TypeScript casts rather than runtime validation; address these under the P2 validation items.
- `generateInstanceId` uses `Math.random`. This is collision hardening, not an authentication finding. A stronger generator should use a supported global crypto API or injection from a Node adapter, preserving the core package's documented lack of Node dependencies.

### `packages/sdk`

- Filesystem path containment and lock mutation concurrency are the primary risks.
- `readHolder` currently hides all I/O failures as malformed/missing state; callers need typed errors and fail-closed handling.
- Claim markers and break tokens need bounded, crash-safe lifecycle semantics.

### `packages/cli`

- `setup` and `verify` write/delete files in the caller's working tree; safety of their path handling is critical.
- CLI options and loaded configuration need one shared parser/validator. Missing option values should be rejected rather than interpreted as another flag.
- Escape untrusted values in logs, and bound resource-intensive verification options.

### Release and package publishing

- The package `files: ["dist"]` allowlist and strict manifest validation are positive controls, within the source-trust limits in MA-SEC-16.
- Keep validating exact package manifests and dependency edges before running package scripts.
- Add packed-artifact inspection to the release gate to confirm only intended files are present and no source maps, local paths, credentials, or test fixtures are shipped.
- Add package-level `engines.node` metadata based on a verified consumer runtime. The READMEs currently promise Node.js 18+, while the root requires Node.js 20+ for the development toolchain. Reconcile that distinction deliberately; updating metadata also requires updating the release validator's allowed keys and tests.

## Original validation matrix and current evidence

The matrix below was written as the original closure worklist. Its detailed subcases remain
useful review criteria, but a passing CI run does not imply every listed subcase has a
dedicated regression. Local evidence is recorded per gate below. Windows-specific behavior
and current cross-platform CI remain open until the edited source is committed and CI passes
on that exact commit. Continue labeling untested cases as open instead of inferring
coverage from the aggregate green result.

The original review used the following gates to organize remediation. They remain a useful
coverage checklist, not a claim that every subcase has an individual regression. The
current suite and OS/Node matrix are recorded in the implementation-status section above;
specific untested subcases remain open for future hardening work.

| Gate | Findings | Local evidence (2026-10-26) | Remaining publication evidence |
| --- | --- | --- | --- |
| SG-01 | MA-SEC-01, 04 | Linux tests cover traversal, absolute/drive/UNC/device-shaped identifiers, link ancestors, final/dangling links, hard-linked setup targets, special files, and outside sentinels. | Run the same suite on real Windows; confirm junction and hard-link behavior there. |
| SG-02 | MA-SEC-03, 10 | Verifier tests cover existing data through success, worker error, timeout, abort, and concurrent runs; owned arenas are removed and workers are killed/reaped. | Current Windows/Ubuntu CI on the release commit. |
| SG-03 | MA-SEC-02, 12 | Local real-process tests cover acquire/takeover contention, renew-vs-break, mixed release/acquire/break, concurrent handoff claim, and recovery after a process is killed at incomplete acquisition. | Current Windows/Ubuntu CI on the release commit; filesystem semantics vary by mount. |
| SG-04 | MA-SEC-06 | Local tests cover schema/config/version/date bounds, I/O errors, socket special files, and disappearing paths. | Windows-specific permissions and special-file behavior in current CI; host restrictions must be reported as inconclusive. |
| SG-05 | MA-SEC-05, 13 | Current SDK tests cover recipient/schema checks, source/destination preservation, per-instance claims, digest receipts, and interrupted-move retries. | Current Windows CI on the release commit. |
| SG-06 | MA-SEC-07, 14 | Local tests inject interrupted publication/takeover operations and kill child processes at operation boundaries; recovery requires exact operation identity and explicit stopped-actor confirmation. | Current CI on the release commit. Tests cover documented boundaries; they do not prove power-loss durability on every filesystem. |
| SG-07 | MA-SEC-09 | Core/SDK/CLI tests cover controls, ANSI/Markdown/newlines, bounded text, and escaped output. | Current cross-platform CI on the release commit. |
| SG-08 | MA-SEC-08, 11, 16 | Local release dry run rebuilt/inspected all three exact 0.2.0 tarballs, passed offline consumer checks, reported zero advisories at every severity, and a regression confirms failed tests retain stdout/stderr. | Repeat on clean committed release candidate; then review and authorize publication separately. |
| SG-09 | MA-SEC-15, 17 | Tests cover registry, disabled heartbeat, Git guard, divergent contract rejection, setup-generated protocol digest, and Codex/Claude instruction pointers. | Current cross-platform CI on the release commit. |
| SG-10 | MA-SEC-17 | Setup and verifier tests cover `.trinoris/` placement, ignore preservation, legacy-root refusal, and readiness failure when ignore state is removed. | Current cross-platform CI on the release commit. |

Each implementation must add its failing regression before the fix, following spec 05's TDD requirement. Use stable test IDs linked to the finding/gate; do not change historical MA-T IDs or count unit mocks as supported-filesystem race evidence. Closing a finding requires a passing regression against the shipped entry point and a review of its documented limitations.

## Original remediation order (historical)

The sequence below records how the review proposed to address the baseline findings. The
implementation controls are now present as summarized above; use `docs/planning/IMPLEMENTATION-PLAN.md`
for current follow-up work.

1. Fix verifier data loss and path containment; add sentinel, collision, and symlink regressions (SG-01, SG-02, SG-05).
2. Specify the shared mutation protocol, generation handle, active-lease checks, and crash assumptions before changing concurrency code; prove behavior with interleavings and real processes (SG-03, SG-06).
3. Enforce handoff recipient/destination semantics and validated bounded lock/config parsing (SG-04, SG-05).
4. Reconcile unsupported policies and contract readiness, and make incident outcomes explicit (SG-06, SG-09).
5. Bound verifier work, sanitize output, and reduce OTP exposure (SG-02, SG-07, SG-08).
6. Upgrade vulnerable tools, update their exact manifest allowlists/configuration, and inspect/test the release artifacts (SG-08).
7. Version SDK signature/schema changes, provide CLI migration guidance for paths and generation handles, and publish the tested platform/runtime guarantees. Preserve documented logical inboxes and the pure core boundary.

Compatibility decisions must cover existing `Lock` records without a generation, SDK `renew`/`release` signatures, the distinction between `isHolder` and active authorization, old handoff notes, and the shared `active/` destination. Migrations must be explicit and must never adopt a malformed record as proof of authority merely to preserve backward compatibility.

The original P1 closure condition was satisfied by the implemented controls and the passing
cross-platform run recorded above. This does not make the protocol an enforcement boundary:
if hostile processes sharing filesystem permissions are in scope, replace local cooperative
coordination with OS-enforced isolation rather than adding self-asserted identity fields.
