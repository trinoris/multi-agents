<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->

# CLI mode completion plan

**Status:** Proposed implementation roadmap  
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

1. **The CLI spec is stale.** `specs/06-cli-interface.md` still contains proposed
   interactive/once/daemon modes, commands such as `handoffs`, `incidents`, and `archive`,
   environment/config precedence, and polling behavior that the implementation does not
   provide and protocol 3 must not provide. It is labeled as a current proposal even though
   its header also calls much of it historical.
2. **The handoff lifecycle is incomplete in CLI.** Users create and finish Markdown notes
   outside the CLI. The CLI can claim a note but cannot validate, list, inspect, publish, or
   complete/archive one through the same guarded contract.
3. **Read-only visibility is partial.** `status` shows lease state and `diagnose` shows
   abandoned operation markers, but there are no dedicated inbox or incident-list views.
4. **Identity defaults are easy to misuse.** A command without `--agent-class` silently
   uses `claude-opus-5`; a command without `--instance` creates a new random instance. That
   is convenient for one-shot reads, but confusing across stateful command sequences.
5. **CLI setup cannot set all supported lease values.** SDK setup accepts lease and grace
   durations, while the CLI parser exposes only agent classes and scope names.
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

### Phase 0 — reconcile the contract first

- Rewrite `specs/06-cli-interface.md` to describe the actual protocol 3 CLI and its
  intended completed command surface.
- Move obsolete interactive/once/daemon examples into a clearly marked historical archive
  or remove them after preserving necessary design history.
- Keep the protocol boundary and no-spin rule explicit; do not treat old proposed commands
  as a promise to implement daemon behavior.
- Add a spec-to-command matrix linking every public CLI command to implementation and test.

**Exit:** no current spec section promises a command, mode, config source, or behavior the
CLI does not implement.

### Phase 1 — identity and configuration safety

- Keep read-only commands usable without an explicit instance.
- For mutations, require an explicit stable `--instance` and `--agent-class`, or accept
  equivalent documented environment defaults that remain stable across shell commands.
  Do not silently assign a tool-specific identity to a mutation.
- Add CLI flags for supported setup lease duration and grace values, with the same bounds
  as core validation.
- Define precedence only for supported inputs; do not invent a second persistent config
  file or read configuration from a parent directory.
- Define stable JSON success and error envelopes, preserving current exit codes and keeping
  diagnostics on stderr.

**TDD exit:** tests prove missing/unstable mutation identity is rejected, stable env/flag
identity is resolved as documented, bad durations fail before filesystem changes, and JSON
errors remain parseable without leaking control characters or secrets.

### Phase 2 — complete the handoff lifecycle

Add CLI commands backed by new SDK operations where needed:

- `handoff validate <draft>` — validate protocol version, required sections, recipients,
  scopes, status, size, and safe file type without mutating state.
- `handoff publish <draft>` — validate, then atomically publish a uniquely named note to
  the correct inbox; refuse overwrite, symlinks, invalid recipients, and held scopes.
- `handoff list [--class <class>]` and `handoff show <filename>` — read only the registered
  inbox/active locations; do not accept arbitrary path traversal.
- `handoff claim <filename>` — preserve the current guarded, recipient-checked claim and
  active destination behavior; retain `claim` as a compatibility alias if needed.
- `handoff complete <filename> --outcome <text>` — validate the active note and identity,
  record the outcome, then archive atomically without replacing an existing archive entry.

Do not make a completed note claimable. Define interrupted publication/completion receipts
and retries before implementing them. Every filesystem mutation must go through the SDK's
shared guard and must preserve truthful attempted/completed/failed records where applicable.

**TDD exit:** unit tests cover validation and schema; real-process E2E tests cover duplicate
publish, concurrent claim, interrupted move, archive collision, idempotent retry, and
cross-platform filename behavior.

### Phase 3 — read-only operational visibility

- Add `incidents list [--scope <scope>]` with safe bounded rendering and JSON support.
- Include inbox and active-note counts in a read-only `status` summary or direct users to
  the handoff commands; do not mix unrelated product-level work into lease status.
- Make output distinguish live, expired-awaiting-grace, breakable, malformed, and unknown
  lease states without implying authenticated identity.
- Add per-command `--help`, top-level `--version`, and actionable examples generated from
  the same command metadata used for parsing.

**TDD exit:** CLI subprocess tests assert exact JSON schema, bounded terminal text, no
mutation on read-only paths, and clear handling of missing or malformed state.

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

Start with Phase 0: reconcile `specs/06-cli-interface.md` to the current implementation,
then implement the handoff lifecycle before adding convenience modes. This prevents stale
interactive and daemon requirements from driving unsafe or unnecessary implementation.
