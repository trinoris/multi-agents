<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# 05 — Verification and adoption

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


## Current runtime verification

The last verified revision `e06f89d6f8c090f011029fa7b0fcaccd4553eb2d` passed the previous
Windows/Ubuntu Node.js 20/24 matrix in [run
40697037334](https://github.com/trinoris/multi-agents/actions/runs/40697037334). That
matrix is historical evidence only. The current support floor retires EOL Node.js 18/20,
declares Node.js 22+, and targets maintained LTS lines 22 and 24. The updated Windows and
Ubuntu matrix plus packed-consumer checks passed on commit `f06e526` in [run
40727208527](https://github.com/trinoris/multi-agents/actions/runs/40727208527).

The CLI runtime-advisory startup gate is a later local change and still needs its own CI
run on the implementation commit. Its tests use a subprocess with a controlled Node version
to verify exact vulnerable/fixed patch behavior without depending on the CI host's patch.

The local v9fs adoption probe separately passed 50 trials with 8 workers and zero bad
trials. This result applies only to that checkout and mount. The CI matrix is the evidence
for the Windows and Ubuntu runner environments.

## Development philosophy: TDD

Same rule as the Control Tower specs: **nothing is implemented before a test that fails
for the right reason.**

This protocol needs it more than most code, because its failure mode is *silent*. A broken
lock does not throw; it loses an edit. Two agents that both believe they hold `engine`
produce a working tree that looks fine and is wrong. The only way to know the mechanism
works is to race it on purpose.

Test IDs are `MA-T<nn>`, stable, never renumbered. Status: ❌ not written · 🟡 written and
failing as expected · ✅ passing.

## Legacy MA-T results (historical record)

The following table records the original 2026-10-25 protocol experiments. A status of
`not written` means the test had not been written at that historical snapshot; it does not
describe current regression coverage. Early shell and `coordination/` workflows below are
not protocol 3 instructions. Current coverage is summarized in the next section.

| # | Status | Result |
| --- | --- | --- |
| `MA-T01` | PASS | **Atomic.** N=2/8/32 x 100 trials, 4,200 racing processes barrier-synchronised on one lock: exactly one winner every trial, 0 failures. The gate is cleared |
| `MA-T02` | PASS | Live lease not breakable; expired-within-grace not breakable; expired beyond grace breakable. **Caveat**: expiry falling exactly on the grace edge is decided by microseconds and two agents can disagree — handled by the break token, not by the comparison |
| `MA-T03` | PASS | Malformed lock with fresh dir mtime not breakable; with mtime older than grace it is; unparseable `holder.json` behaves as malformed |
| `MA-T04` | PASS **after a fix** | Originally **FAILED**: `mv -n` gave 2 claimers from 8 racers (21/100 trials; 31/100 at N=32). Fixed with an atomic `mkdir` claim marker before the `mv` — 0 failures at N=8 and N=32 over 100 trials. Hardlink also passed, rejected for Windows fragility |
| `MA-T05` | PASS | ABA confirmed: after eviction the lock directory is indistinguishable from the original; the `agent` field in `holder.json` is the only thing revealing the loss. Re-verify detects it correctly |
| `MA-T06` | not written | **Incident visibility**: acquiring a scope after being evicted detects the incident file; re-verify failure prompts incident check |
| `MA-T07` | not written | **Scope registry ordering**: scopes acquired out of order are detectable; all entry points reference the registry |
| `MA-T08` | not written | **Handoff format validation**: parser rejects notes missing required sections (`## Verified`, `## Assumed`, `## Next step`); accepts when `## Assumed` contains "Nothing" |
| `MA-T09` | not written | **Heartbeat handling**: expired lease + fresh heartbeat (<3min) defers breakability; expired lease + stale heartbeat breakable; missing heartbeat does not affect live lease |
| `MA-T10` | PASS | **Both directions.** WSL-created lock blocks PowerShell `New-Item`; Windows-created lock blocks WSL `mkdir`; each side reads the other's `holder.json`. Automatable after all — see below |
| `MA-T11` | not written | **Protocol drift detection**: consuming repo's `PROTOCOL.md` diverges from source, detected by hash or version header |
| `MA-T12` | PASS **new** | **Break race.** Delete-then-recreate double-breaks: 25/60 failures at N=8, 59/60 at N=32. Rename-aside also double-breaks (2 takeovers at N=8) because the lock name frees instantly. Fixed with the `<scope>.breaking` token — 0 failures at N=8 and N=32 over 60 trials |
| `MA-T13` | not written | **Git scope pre-check**: acquiring `git` for branch mutation while peer locks are live is rejected; commits/index ops allowed |
| `MA-T14` | not written | **Instance competition**: multiple instances of same agent class (e.g., codex-gpt-6-a, codex-gpt-6-b, codex-gpt-6-c) compete for handoffs in `for-codex-gpt-6/`, exactly one claims each via atomic mkdir |
| `MA-T15` | not written | **Class-based routing**: handoff with `to_class: codex-gpt-6` is not claimable by `claude-opus-5` instances; handoff with `to_class: any` is claimable by all |
| `MA-T16` | not written | **Instance-specific addressing**: handoff with `to_instance: codex-gpt-6-a3f2` is claimable only by that instance; `to_instance: any` claimable by any instance of the target class |

`MA-T01`, `MA-T10` and `MA-T12` are the three that justify this repo existing. The rest
test rules; those three test the physics the rules assume — and two of them disproved this
spec as first written.

`MA-T14`, `MA-T15`, `MA-T16` test the agent class/instance model that enables N instances
of the same model to work in parallel.

## Current regression inventory

Tests live beside the package entry points and exercise the shipped TypeScript SDK/CLI;
the old proposed `tests/` directory tree above was never the repository layout.

| Package | Files | Cases | Coverage focus |
| --- | ---: | ---: | --- |
| `packages/core` | 4 | 45 | Protocol contract, v2/v3 handoff parsing, input/schema validation, bounded terminal output, default agent routing classes |
| `packages/sdk` | 9 | 67 | Path and file safety, generation ownership, leases, claims, guarded recovery, incidents, and real-process concurrency |
| `packages/cli` | 7 | 86 | Setup/ignore/readiness, runtime advisory gate, verifier probe behavior, CLI journeys, release input policy, tarball inspection, and offline consumer install |

On 2026-10-28, the full coverage gate passed locally on Linux: 198 tests across 20 files
(45 core, 67 SDK, 86 CLI). It does not replace the fresh Windows/Ubuntu CI run required
for these uncommitted edits.

`pnpm run test:coverage` is the branch-coverage gate in CI. It runs the Vitest suite for
each workspace package with V8 coverage and requires at least 80% branch coverage per
package. On 2026-10-28 it passed with Core at 89.81%, SDK at 81.83%, and CLI command
modules at 83.39%. The CLI bootstrap wrapper (`packages/cli/src/bin.ts`) is excluded from
source coverage because the installed CLI journey tests exercise its built entry point.

The suite uses both unit tests and real child-process integration tests. Mocked tests do not
replace the per-environment `verify` probe. Heartbeat/daemon behavior is intentionally
unsupported in protocol 3 and is not a pending acceptance criterion.

### CLI adoption-gate probe outcomes

The CLI verifier distinguishes three outcomes so an execution restriction cannot be
mistaken for a filesystem race:

- **ATOMIC** is reported only after every requested trial completed and each worker thread
  returned exactly one valid outcome, with one winner per trial.
- **NOT ATOMIC** is reported only after workers completed normally and the observed
  winner count violated that condition.
- **NOT CHECKED / PROBE FAILED** means worker startup, execution, or response validation
  failed, or workers exceeded the 15-second timeout. This is inconclusive; it must not be
  recorded as a filesystem atomicity failure.

The verifier uses Node worker threads for concurrent filesystem calls and `statfsSync`
for filesystem identification; it does not launch a shell or child process. When the
filesystem metadata API is unavailable or fails, `filesystem unknown` is a diagnostic
warning and does not determine the atomicity result. Run the probe against the intended
working tree; a different temporary directory may use a different filesystem. The
concurrency setting must be at least 2; a single worker cannot test concurrent exclusivity.

The CLI package tests cover invalid trial/concurrency settings, worker failure, timeout,
abort, malformed outcomes, and cleanup. The end-to-end adoption gate must still be run on
each target filesystem because unit tests do not establish that filesystem's behavior.

**Correction to an earlier claim in this spec.** `MA-T10` was described as impossible to
automate in one environment. That was wrong: `powershell.exe` is reachable directly from
WSL, so one harness drives both sides and the test runs unattended. It is a normal
automated test, not a manual procedure.

## Adoption

Per working tree, initialize once, inspect generated instructions, and verify the actual
checkout before allowing agents to coordinate. Setup installs instruction pointers and the
package-owned contract under `.trinoris/`; do not start concurrent work until `verify`
reports ready for that target filesystem.

```text
 0. Run `node packages/cli/dist/bin.js setup --work-dir <target>` to create .trinoris/ and the agent instruction pointers.
 1. Run `node packages/cli/dist/bin.js verify --work-dir <target>` on the target filesystem. If mkdir is not atomic under real
    concurrency there, the protocol does not apply to that tree and must not be
    used. This is a gate, not a formality.
 2. Review `.trinoris/PROTOCOL.md`, `AGENTS.md`, and installed agent entry points.
 3. Confirm all participating agents use the same working tree, protocol version, and scope registry.
 4. Exercise acquire/check/release and handoff claim with disposable work before real parallel edits.
 5. Only then use it for real work.
```

Step 5 is not optional. Breaking a lock is the operation most likely to be done wrong under
pressure, and the only way to trust the incident trail is to have seen it produced once.

## Current acceptance criteria

- CI release/security matrix passes on Linux and Windows with Node.js 22 and 24; packed
  consumer smoke passes on Ubuntu under both Node.js 22 and 24.
- A consuming tree's installed `.trinoris/PROTOCOL.md` and digest match the package-owned
  protocol contract; unsupported config or a missing ignore rule blocks readiness.
- `verify` distinguishes a real atomicity failure from an inconclusive worker/environment
  failure. A sandbox failure is not filesystem evidence.
- Every implementation change adds a regression first; real-process tests cover concurrency
  behavior that unit mocks cannot establish.
- Protocol 3 claims enforce routed recipients and the required schema. Protocol 2 notes are
  readable for compatibility; heartbeat/daemon behavior remains disabled.
- State stays cooperative: direct filesystem writers, editors, Git commands, and other
  clones are not fenced by this protocol.

## Honest limits

Two of spec 01's hard rules cannot be tested:

- *"Never edit a path outside a scope you hold"* — detectable after the fact by comparing
  `git status` against held locks, but not preventable.
- *"State assumptions as assumptions"* — a judgement about honesty. `MA-T08` checks the
  section exists; nothing can check it is truthful.

The protocol is a convention between two cooperating agents, not a sandbox. It makes
collisions rare and visible. It does not make them impossible, and a spec that implied
otherwise would be the most dangerous artifact in this repo.
