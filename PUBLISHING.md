<!--
Copyright (c) 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# Publishing

Run these yourself — the account has 2FA enforced, so publishing needs a one-time code
from your authenticator.

## Use pnpm, never npm

The packages depend on each other with the `workspace:*` protocol and **npm ships that
string verbatim**. Verified on this repo:

| Command | What lands in the tarball |
| --- | --- |
| `npm pack` | `"@trinoris/agent-core": "workspace:*"` — every consumer install fails with `Unsupported URL Type: workspace:` |
| `pnpm pack` | `"@trinoris/agent-core": "0.1.0"` — correct |

A version number can never be reused on npm and unpublish is limited to 72 hours, so one
`npm publish` here is not recoverable at that version.

## Initial publication order

For a first publication when dependencies are not yet on npm, publish `agent-core` →
`agent-sdk` → `agent-cli`. The CLI depends on the other two; publishing it first puts a
version on the registry whose dependencies do not exist yet. Do not republish unchanged
core or SDK versions during a CLI-only release.

## The release gate

Use the release script for both initial and incremental publications. Direct `pnpm publish`
commands bypass the repository's release checks and should not be used. From the repo root,
the release script validates manifests before running package code, performs a frozen
install with lifecycle scripts disabled, audits all dependencies, runs every workspace
test, builds new package targets, and only then publishes packages whose exact version is
not already on npm. It fails on high or critical dependency advisories. Release tooling
requires Node.js 20 or later; the published CLI itself supports Node.js 18 or later.

Get a fresh 6-digit authenticator code before each publish; codes are valid for about 30
seconds.

```bash
cd /mnt/c/Users/Hai-Linh/trinoris/trinoris-multi-agents

# Check identity (should print your npm username)
npm whoami

# Rehearse the complete release gate; publishes nothing
pnpm release:dry

# Publish only new versions after the same gate passes
pnpm release -- --otp=123456
```

**Use a fresh code for each package.** npm treats an OTP as short-lived and effectively
single-use; reusing one across all three usually fails on the second with `EOTP`. If a
package fails, re-run only that one — the ones before it are already published and cannot
be republished at the same version.

### How packages are selected

After the quality gates pass, `scripts/release.sh` checks the configured version of each
package against npm in dependency order (`agent-core` → `agent-sdk` → `agent-cli`). It skips
an exact version that already exists and builds/publishes only packages whose configured
version is absent from the registry. Build dependencies may also be rebuilt locally, but
are not published unless their own package version is new. If every current version already
exists, the script exits after the quality gates without building or publishing anything.

```bash
pnpm release:dry                       # quality gates, checks versions, builds new targets, dry-runs publish
pnpm release -- --otp=123456           # or: bash scripts/release.sh --otp=123456
```

The dry run publishes nothing. Registry access is required to compare exact versions; the
script stops if npm cannot distinguish an unpublished version from a registry/network
error. Before publishing, make sure each new package depends on versions that are already
published or included earlier in the dependency-ordered release. With multiple new
packages, the script uses supplied `--otp` values in package order and prompts for a fresh
code for any remaining packages when run in a terminal. In CI, use a configured npm
automation token.

## Avoiding OTP entirely

An **Automation** token bypasses 2FA, which is what CI needs:

npmjs.com → Access Tokens → Generate New Token → **Automation**

Put it in `.env` as `NPM_REGISTRY_TOKEN=` (already gitignored). `scripts/release.sh` then
runs unattended with no `--otp`.

## Afterwards

```bash
npm view @trinoris/agent-cli version
npm view @trinoris/agent-cli@0.1.1 dependencies # must not contain workspace:*
```

Then a real consumer check in an empty directory, which is the only test that proves the
tarballs resolve against each other:

```bash
mkdir /tmp/consume && cd /tmp/consume && npm init -y >/dev/null
npm i @trinoris/agent-cli
npx trinoris-agent --help
```

## Package versions checked on 2026-10-25

| Package | Version | License | Access |
| --- | --- | --- | --- |
| `@trinoris/agent-core` | 0.1.0 | Apache-2.0 | public |
| `@trinoris/agent-sdk` | 0.1.0 | Apache-2.0 | public |
| `@trinoris/agent-cli` | 0.1.1 | Apache-2.0 | public |

The release dry run found `agent-core@0.1.0` and `agent-sdk@0.1.0` already published, and
`agent-cli@0.1.1` new. The script checks exact versions again at runtime; this table is a
snapshot, not a substitute for that registry check.
