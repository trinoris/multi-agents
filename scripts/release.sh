#!/usr/bin/env bash
# Publish the @trinoris/agent-* packages to npm.
#
#   usage: scripts/release.sh [--dry-run]
#
# TWO THINGS THIS SCRIPT EXISTS TO PREVENT
#
# 1. `npm publish` must never be used here. The packages depend on each other with the
#    `workspace:*` protocol, and npm ships that string verbatim — a consumer running
#    `npm install @trinoris/agent-sdk` then fails with "Unsupported URL Type:
#    workspace:". Verified: `npm pack` produced {"@trinoris/agent-core":"workspace:*"}
#    while `pnpm pack` produced {"@trinoris/agent-core":"0.1.0"}. Only pnpm rewrites it.
#
# 2. Publish order matters. sdk depends on core, cli depends on both. Publishing cli
#    first leaves a version on the registry whose dependencies do not exist yet.
#
# npm publishes are effectively permanent: unpublish is restricted to a 72-hour window
# and a version number can never be reused. There is no undo for a wrong tarball.
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=""
OTP=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY="--dry-run" ;;
    --otp=*)   OTP="--otp=${a#--otp=}" ;;
    *) echo "unknown argument: $a"; echo "usage: $0 [--dry-run] [--otp=123456]"; exit 1 ;;
  esac
done

command -v pnpm >/dev/null || { echo "pnpm is required (npm would ship workspace:* unresolved)"; exit 1; }

if [ -z "$DRY" ]; then
  npm whoami >/dev/null 2>&1 || {
    echo "Not logged in to npm. Either:"
    echo "  npm login --scope=@trinoris          # interactive, then re-run with --otp"
    echo "  or put an Automation token in .env   # NPM_REGISTRY_TOKEN=, bypasses 2FA"
    exit 1
  }
  if [ -z "$OTP" ]; then
    echo "note: no --otp given. If 2FA is enforced this stops at EOTP on the first package."
  fi
  echo "Publishing as: $(npm whoami)"
  ACCESS=$(node -e "console.log(require('./packages/core/package.json').publishConfig.access)")
  echo "Access: $ACCESS"
  LIC=$(node -e "console.log(require('./packages/core/package.json').license)")
  echo "License: $LIC"
  if [ "$ACCESS" = "public" ] && [ "$LIC" = "UNLICENSED" ]; then
    # Only a contradiction is worth blocking on: public + no licence grant means the
    # packages are downloadable by everyone and lawfully usable by none.
    echo
    echo "REFUSING: access=public with license=UNLICENSED grants no rights to anyone."
    echo "Set a real licence (Apache-2.0) or publish with access=restricted."
    exit 1
  fi
  echo
  echo "This is permanent: a published version cannot be reused, and unpublish is"
  echo "limited to a 72-hour window."
fi

echo "Building..."
pnpm --filter @trinoris/agent-core build >/dev/null
pnpm --filter @trinoris/agent-sdk  build >/dev/null
pnpm --filter @trinoris/agent-cli  build >/dev/null

# Dependency order: core <- sdk <- cli
for pkg in agent-core agent-sdk agent-cli; do
  echo "--- $pkg"
  # shellcheck disable=SC2086
  pnpm --filter "@trinoris/$pkg" publish $DRY $OTP --no-git-checks
done

echo
if [ -n "$DRY" ]; then
  echo "Dry run only — nothing was published."
else
  echo "Published. Verify a consumer install resolves the dependency versions:"
  echo "  npm view @trinoris/agent-sdk dependencies"
fi
