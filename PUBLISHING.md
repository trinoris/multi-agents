<!--
Copyright (c) 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# Publishing

Manual releases publish public packages to npmjs.com. This repository's CI runs tests;
it does not publish packages or require an npm publishing token.

## Prepare a release

Use Node.js 22+ and the exact pnpm version in `packageManager` (currently 8.12.0).
Commit the reviewed source changes before a real release. The release script rejects
unknown workspace members, executable package-manager hooks, local registry configuration,
unreviewed manifest fields/dependencies, and lockfile source changes outside its policy.

```bash
# Authenticate with npm's supported login flow, or provide a restricted short-lived
# NODE_AUTH_TOKEN / NPM_REGISTRY_TOKEN externally for the final publish step.
npm login --scope=@trinoris

# Complete rehearsal; nothing is published.
bash scripts/release.sh --dry-run

# Publish only versions absent from npm after all gates pass.
bash scripts/release.sh
```

OTP arguments are deliberately unsupported. The script does not read or execute `.env`.
Do not put an OTP in shell history or command arguments. If your npm authentication policy
needs an interactive challenge, use the registry/tool's supported login flow; no promise
is made that an environment variable removes a tool's internal OTP argument exposure.

## Gate order and credentials

The shell script delegates to `scripts/release.mjs`. The runner validates inputs and the
actual pnpm version, then performs a frozen install with lifecycle scripts and pnpmfile
hooks disabled. It runs an uncached test suite, checks which exact versions already exist,
builds the workspace, packs all three packages, inspects every archive, and installs those
local tarballs into an empty offline consumer. That consumer runs the CLI help, setup, and
real filesystem verifier before publication is considered.

Build/install/test/pack processes receive an allowlisted environment, an empty npm config,
and an isolated home directory. Publishing credentials are supplied only to the final
trusted publish process. This reduces credential exposure; it does not sandbox arbitrary
source code from a hostile process sharing the publisher's filesystem permissions.

The required audit threshold remains high/critical. The complete audit report is retained;
a passing threshold is not a claim that lower-severity advisories are absent. The protocol
2 dependency update currently removes the earlier Turbo/esbuild advisories.

## Exact artifacts and dependency ordering

`pnpm pack` rewrites `workspace:*` dependencies to the package versions being released.
Do not use `npm pack` directly on these workspace manifests: it leaves unresolved workspace
ranges. The release runner validates the rewritten dependencies, expected entry points,
file allowlist, secret patterns, archive types, and digests. Unexpected files, links,
source maps, missing entries, or unresolved workspace dependencies block the release.

It publishes the exact inspected tarball bytes in dependency order: `agent-core`,
`agent-sdk`, then `agent-cli`. Already-published exact versions are skipped. A registry or
network error cannot be treated as an unpublished package. After a partial publish, rerun
the release; immutable published versions are not reused.

The runner never adds `--no-git-checks` to bypass source review. A real release requires a
clean source snapshot both before and after quality gates. A dry run can inspect a dirty
working tree and clearly records that fact, but it publishes nothing.

## Retained evidence

Each run retains `.release-artifacts/<run>/release.json`, `audit.json`, `sbom.json`, test output, and
inspected tarballs. The report records source commit/diff state, package versions, archive
members, SHA-256 digests, and successfully published versions. It contains no publishing
credentials and is ignored by Git. Incomplete release evidence must be read with the
recorded outcome; do not infer that every artifact was published from its presence alone.

## Protocol 3 migration and versions

The protocol 3 packages `@trinoris/agent-core`, `@trinoris/agent-sdk`, and
`@trinoris/agent-cli` have `0.2.0` releases on npm. The current CLI update adds
`doctor --runtime` and a critical-advisory startup gate, so its next release is `0.3.0`;
core and SDK remain at `0.2.0`. The release runner skips the already-published exact
core/SDK versions and publishes only the CLI version after every gate passes. Stop all
earlier protocol 2 clients before migrating to protocol 3. See the CLI user guide and
`specs/07-security-hardening.md` for migration rules, boundaries, and test coverage.
