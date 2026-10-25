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

## Order matters

`agent-core` → `agent-sdk` → `agent-cli`. The CLI depends on the other two; publishing it
first puts a version on the registry whose dependencies do not exist yet.

## The commands

From the repo root. Get the 6-digit code from your authenticator immediately before
running — codes are valid for about 30 seconds.

```bash
cd /mnt/c/Users/Hai-Linh/trinoris/trinoris-multi-agents

# 0. Build fresh, so what publishes matches the source
pnpm install
pnpm --filter @trinoris/agent-core build
pnpm --filter @trinoris/agent-sdk  build
pnpm --filter @trinoris/agent-cli  build

# 1. Confirm identity (should print your npm username)
npm whoami

# 2. Rehearse — writes nothing to the registry
pnpm --filter @trinoris/agent-core publish --dry-run --no-git-checks

# 3. Publish, in dependency order, each with a FRESH code
pnpm --filter @trinoris/agent-core publish --access public --otp=123456 --no-git-checks
pnpm --filter @trinoris/agent-sdk  publish --access public --otp=234567 --no-git-checks
pnpm --filter @trinoris/agent-cli  publish --access public --otp=345678 --no-git-checks
```

**Use a fresh code for each package.** npm treats an OTP as short-lived and effectively
single-use; reusing one across all three usually fails on the second with `EOTP`. If a
package fails, re-run only that one — the ones before it are already published and cannot
be republished at the same version.

### Or in one step

`scripts/release.sh` does the build, the identity check, the order, and refuses to run
under plain npm:

```bash
pnpm release -- --otp=123456          # or: bash scripts/release.sh --otp=123456
pnpm release:dry                       # rehearsal, publishes nothing
```

One code for all three may expire mid-run. If it does, finish with the individual
commands above for whichever packages remain.

## Avoiding OTP entirely

An **Automation** token bypasses 2FA, which is what CI needs:

npmjs.com → Access Tokens → Generate New Token → **Automation**

Put it in `.env` as `NPM_REGISTRY_TOKEN=` (already gitignored). `scripts/release.sh` then
runs unattended with no `--otp`.

## Afterwards

```bash
npm view @trinoris/agent-sdk dependencies   # must show 0.1.0, never workspace:*
npm view @trinoris/agent-cli  version
```

Then a real consumer check in an empty directory, which is the only test that proves the
tarballs resolve against each other:

```bash
mkdir /tmp/consume && cd /tmp/consume && npm init -y >/dev/null
npm i @trinoris/agent-cli
npx trinoris-agent --help
```

## Current state

| Package | Version | License | Access |
| --- | --- | --- | --- |
| `@trinoris/agent-core` | 0.1.0 | Apache-2.0 | public |
| `@trinoris/agent-sdk` | 0.1.0 | Apache-2.0 | public |
| `@trinoris/agent-cli` | 0.1.0 | Apache-2.0 | public |

Nothing is published yet — verified: all three return 404 on the registry.
