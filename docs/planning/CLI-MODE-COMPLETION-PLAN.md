<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->

# CLI mode completion plan

**Status:** Phases 0 and 1 complete; implementation roadmap in progress
**Reviewed:** 2026-10-26
**Baseline:** local commit `992c8ed`; 121 package tests passed on this checkout

## Goal

Complete `trinoris-agent` as a dependable one-shot command-line interface for the
protocol 3 lifecycle. A user or coding agent should be able to inspect coordination state,
publish and consume a handoff, acquire and release scopes, and recover an interrupted
operation without manually reproducing filesystem mutation rules.

The CLI is a coordination client. It does not launch an LLM, edit project files, decide
what work to perform, or stay resident between commands.

## Current implementation

The shipped command surface in `packages/cli/src/bin.ts` is:

| Area | Current commands |
| --- | --- |
| Adoption | `setup`, `verify` |
| Leases | `status`, `acquire`, `acquire-many`, `check`, `renew`, `release`, `break` |
| Handoffs | `claim` |
| Recovery | `diagnose`, `recover` |

The CLI already uses the SDK for guarded mutations, requires a generation for lease
checks/renewals/releases, emits JSON on successful commands, and has real-filesystem and
packed-consumer coverage. The local full suite passed with 121 tests across core, SDK, and
CLI.

## Gaps to close

1. **Resolved in Phase 0 — CLI spec was stale.** `specs/06-cli-interface.md` contained
   proposed interactive/once/daemon modes, commands such as `handoffs`, `incidents`, and
   `archive`, environment/config precedence, and polling behavior that the implementation
   does not provide and protocol 3 must not provide. It was labeled as a current proposal
   even though its header also called much of it historical.
2. **The handoff lifecycle is incomplete in CLI.** Users create and finish Markdown notes
   outside the CLI. The CLI can claim a note but cannot validate, list, inspect, publish, or
   complete/archive one through the same guarded contract.
3. **Read-only visibility is partial.** `status` shows lease state and `diagnose` shows
   abandoned operation markers, but there are no dedicated inbox or incident-list views.
4. **Resolved in Phase 1 — identity defaults were easy to misuse.** A command without
   `--agent-class` silently used `claude-opus-5`; a command without `--instance` created a
   new random instance. That is convenient for one-shot reads, but confusing across
   stateful command sequences.
5. **Resolved in Phase 1 — CLI setup could not set all supported lease values.** SDK setup
   accepts lease and grace durations, while the CLI parser exposed only agent classes and
   scope names.
6. **Error automation is weaker than success automation.** `--json` affects successful
   output, but parse/runtime failures are plain text on stderr and do not expose a stable
   machine-readable error shape.

## Product boundary

### In scope

- One-shot commands for protocol 3 setup, verification, state inspection, handoff
  lifecycle, lease lifecycle, and explicit recovery.
- Safe defaults for read-only commands and explicit stable identity for mutations.
- Human-readable output plus stable JSON output for scripts and agent callers.
- SDK-owned filesystem operations; no duplicate mutation logic in the CLI.
- Cross-platform tests and the existing Node.js 18 packed-consumer contract.

### Out of scope

- Interactive work execution, automatic work selection, or launching an agent/model.
- `--mode daemon`, background workers, heartbeat renewal, lock polling, or auto-break.
- Multi-host/network coordination. A future distributed product needs authenticated
  ownership, transactional leases, and write-enforced fencing tokens.
- Codex/Claude-specific wrappers or shell startup modifications in the first CLI release.

## Proposed implementation sequence

### Phase 0 — reconcile the contract first — complete

- Rewrite `specs/06-cli-interface.md` to describe the actual protocol 3 CLI and its shipped
  command surface.
- Move obsolete interactive/once/daemon examples into a clearly marked historical archive
  or remove them after preserving necessary design history.
- Keep the protocol boundary and no-spin rule explicit; do not treat old proposed commands
  as a promise to implement daemon behavior.
- Add a spec-to-command matrix linking every shipped CLI command to implementation and test.

**Exit:** no current spec section promises a command, mode, config source, or behavior the
CLI does not implement. The current command contract is now in `specs/06-cli-interface.md`;
the older interaction/daemon proposal remains in `docs/archive/CLI-SPEC-2026-10-25.md`.

### Phase 1 — identity and configuration safety — complete

- Keep read-only commands usable without an explicit instance.
- For stateful commands, require an explicit stable `--instance` and `--agent-class`.
  Environment identity defaults are not supported. Do not silently assign a tool-specific
  identity to a mutation.
- Add CLI flags for supported setup lease duration and grace values, with the same bounds
  as core validation.
- Define precedence only for supported inputs; do not invent a second persistent config
  file or read configuration from a parent directory.
- Keep current successful JSON results and exit codes. Error-envelope improvements are
  assigned to Phase 3.

**TDD exit:** tests prove incomplete mutation identity is rejected before state changes,
explicit identity works across the lease lifecycle, and invalid setup durations fail before
filesystem changes. The fixed registry includes `packages/`, so package code and local tests
can be coordinated under a defined scope.

### Phase 2 — complete the handoff lifecycle — implemented locally

The CLI and SDK now provide the following lifecycle through SDK-owned, guarded
operations:

- `handoff validate --note <filename>` — validate protocol version, required sections, recipients,
  scopes, status, size, and safe file type without mutating state.
- `handoff publish --note <filename>` — validate, then publish a uniquely named note to
  the correct inbox; refuse overwrite, symlinks, invalid recipients, and held scopes.
- `handoff list --agent-class <class> --instance <id>` and `handoff show --note <filename>` — read only the registered
  inbox/active locations; do not accept arbitrary path traversal.
- `handoff claim --note <filename>` — preserve the current guarded, recipient-checked claim and
  active destination behavior; retain `claim` as a compatibility alias if needed.
- `handoff complete --note <filename> --outcome <text>` — validate the active note and identity,
  record the outcome, then archive atomically without replacing an existing archive entry.

Completed notes remain unclaimable. Publication and completion use receipts so an exact
retry can finish an interrupted move; conflicts do not overwrite existing files. Every
filesystem mutation goes through the SDK's shared guard.

**TDD status:** unit tests cover schema validation, authorized read locations, duplicate
publish, held-scope refusal, archive collision, idempotent retries, and interrupted publish
and completion recovery. CLI subprocess coverage runs the full validate → publish → list →
claim → show → complete journey. Existing real-process claim and lease tests remain in place.
Cross-platform Windows/Ubuntu validation is a CI gate and is not represented as a new local
Windows run.

### Phase 3 — read-only operational visibility — implemented locally

- `incidents list [--scope <scope>]` returns bounded read-only summaries with JSON output.
- `status` distinguishes held, expired/breakable, malformed, and unknown lock directories;
  handoff details remain available through explicit handoff commands.
- Per-command help and top-level `--version` are available. Help options are derived from
  the same allow-list used by argument parsing and include actionable examples.
- `--json` failures use a stable error envelope with terminal-escaped, bounded diagnostics
  and do not echo unrelated arguments.

**TDD status:** SDK and CLI tests cover event filtering, malformed-record handling, record
and text bounds, status state distinctions, read-only behavior, command help/version, and
the JSON error envelope. Full uncached local suite passed on 2026-10-26: 142 tests across
15 files. Windows/Ubuntu CI remains the cross-platform verification gate.

### Phase 4 — release readiness

- Run the complete suite uncached on Ubuntu and Windows with Node.js 20 and 24.
- Run the packed consumer on Node.js 18 and 20; verify help, setup, verify, handoff lifecycle,
  and a lease lifecycle using only installed tarballs.
- Run the release gate: frozen install, configured high/critical audit, complete tests,
  build, packed artifact inspection, and offline consumer journey.
- Publish only after a separate explicit release instruction; never publish from CI.

**Exit:** user guide, command spec, help, code, and packed-consumer behavior agree; all
required matrix jobs pass; no daemon/heartbeat/network behavior is implied.

## Compatibility and rollout

- Existing protocol 3 lease and claim commands remain available. If command names are
  grouped under `handoff`, keep existing `claim` as an alias for one release and document
  removal only in a future major version.
- Preserve exit codes: `0` success, `1` invalid/uncertain, `3` contention, `4` lease lost.
- Never infer authority from `agent_class`, `agent_instance`, config, environment values,
  or handoff text; these are local coordination labels, not authentication.
- Preserve generation-required check/renew/release semantics and the no-spin rule.
- Do not enable heartbeat, add a background service, or change protocol 3's local-machine
  trust boundary as part of CLI completion.

## Current next action

Commit Phase 3 locally, then proceed to Phase 4 release readiness. Do not publish without
a separate explicit release instruction.
