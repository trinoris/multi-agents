# Multi-agent coordination simulation

This scenario replays a realistic protocol 3 collaboration using the built CLI against a disposable workspace. It records each actor action as JSONL and writes a verifier result so the run can be reviewed or replayed in the browser viewer.

## Run it

Open the [published replay](https://trinoris.github.io/multi-agents/) to explore the latest
CI simulation in your browser, or generate a local run below.

From the repository root:

```sh
pnpm simulate
```

The runner builds the CLI, creates a unique directory under `simulation/artifacts/`, and retains the full disposable workspace with the report. These generated artifacts are git-ignored. To choose a location:

```sh
node simulation/run.mjs --output /path/to/run-output
```

Open `simulation/viewer/index.html` in a browser: it automatically loads and replays the latest saved run, including when opened directly from disk. Each simulation publishes a compact `simulation/artifacts/latest.js` replay bundle; the original reports and workspace remain in the run directory. Failed runs also become the latest run.

The three-column viewer connects **actors → coding workspace → system state**. Actor cards show who holds a scope or has been refused. The middle contains a file explorer, editor tabs, recorded editing buffers, changed lines, and activity/test-output panels. The right shows leases, generations, handoff progress, and test status at the selected event. Expand **Recorded final audit** for the compact final checks.

The editor follows the active file by default. Click a file, tab, or actor to pin a file; re-enable **Follow active editor** to resume following. Scrubbing backward reconstructs the earlier file tree, contents, ownership, and test result. A scope lease covers every file in its mapped folder; the UI distinguishes that lease from a file currently being edited. Older reports without snapshots display missing content and ownership as unrecorded.

Use **Latest run** to reload after another simulation finishes, or load an older run's `report.jsonl` and matching `verifier-result.json` manually. **Demo run** shows synthetic events based on the same example files; it also appears automatically when no saved run is available. Replay data stays local. See [the workspace design and event contract](docs/editor-workspace.md).

## Scenario

1. Initialize an isolated protocol 3 workspace and pass its CLI readiness check before starting agent sessions.
2. Race two writer sessions for the same `packages` scope. Exactly one should acquire it; the other should receive contention.
3. A test engineer independently acquires `tests/`, writes a release-policy regression, and runs it against the baseline source: RED. While both scopes are held, the source writer checks its generation, edits `packages/example/src/release-policy.mjs`, and the same tests turn GREEN.
4. Both editing scopes are released. Reusing the writer's released generation must fail. The writer publishes a ready-for-review handoff.
5. A non-recipient tries and fails to claim it.
6. Two eligible reviewer sessions race to claim the note. Exactly one should become its owner.
7. The winning reviewer acquires the scope, inspects the active note and changed fixture, releases the scope, and completes the handoff into the archive.

The verifier reports eight independent checks: exclusive scope lease, generation fencing, recipient enforcement, single claimant, reviewer inspection, archived completion, a failing regression before the fix, and passing tests afterward. The release policy is an isolated coding example inside the run workspace; it does not modify the shipped packages. This simulation does not replace the target filesystem's real mkdir readiness check with `verify`.

## Verification

```sh
node --test simulation/replay-state.test.mjs
node --test simulation/pages.test.mjs
node simulation/viewer.browser.mjs
```

The browser journey requires Playwright and its Chromium browser. It uses a locally installed `playwright` module, or the module path supplied through `PLAYWRIGHT_MODULE`. Run a simulation first. It verifies file/HTTP auto-loading, ownership, editor buffers, backward scrubbing, file pinning, RED/GREEN tests, review/archive, mobile layout, and demo/legacy reports. Screenshots are retained in `simulation/artifacts/editor-desktop.png` and `editor-mobile.png`.

## Publish on GitHub Pages

In repository **Settings → Pages**, select **GitHub Actions** as the build source. The
`simulation-pages.yml` workflow builds on pushes to the default branch, every day at
03:30 UTC, and manual dispatch from that branch. Other branches do not replace the site.

The workflow installs the frozen dependencies, validates release inputs, builds the CLI,
checks replay-state and site-publishing behavior, and records a real simulation. It copies
an explicit list of viewer assets and `artifacts/latest.js` into the Pages artifact.
Disposable workspaces and `.trinoris/` directories are excluded. Reports remain available
as separate Actions artifacts for 30 days. Failed simulations publish their valid failure
replay while retaining a failed workflow result; a missing or invalid bundle cannot
replace the public site with empty data.

The public entry is **https://trinoris.github.io/multi-agents/**. Its relative redirect
keeps the viewer and replay assets inside the repository's Pages path.

After generating a local run, build the same static site with:

```sh
node simulation/build-pages.mjs
```

Output is `simulation/site/`, which is git-ignored. Use `--output <fresh-directory>` for
another local build. Set `SIMULATION_SITE_DIR` to that output when running the browser
journey to verify the packaged site under the `/multi-agents/` URL prefix.
