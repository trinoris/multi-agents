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
[ "${1:-}" = "--dry-run" ] && DRY="--dry-run"

command -v pnpm >/dev/null || { echo "pnpm is required (npm would ship workspace:* unresolved)"; exit 1; }

if [ -z "$DRY" ]; then
  npm whoami >/dev/null 2>&1 || {
    echo "Not logged in to npm. Run:  npm login --scope=@trinoris"
    exit 1
  }
  echo "Publishing as: $(npm whoami)"
  ACCESS=$(node -e "console.log(require('./packages/core/package.json').publishConfig.access)")
  echo "Access: $ACCESS"
  if [ "$ACCESS" = "public" ]; then
    echo
    echo "WARNING: access is 'public'. These packages are marked UNLICENSED and the source"
    echo "headers say 'Proprietary and confidential'. A public publish makes the compiled"
    echo "output world-readable and downloadable by anyone, permanently."
    read -r -p "Type PUBLIC to confirm: " c
    [ "$c" = "PUBLIC" ] || { echo "aborted"; exit 1; }
  fi
fi

echo "Building..."
pnpm --filter @trinoris/agent-core build >/dev/null
pnpm --filter @trinoris/agent-sdk  build >/dev/null
pnpm --filter @trinoris/agent-cli  build >/dev/null

# Dependency order: core <- sdk <- cli
for pkg in agent-core agent-sdk agent-cli; do
  echo "--- $pkg"
  pnpm --filter "@trinoris/$pkg" publish $DRY --no-git-checks
done

echo
if [ -n "$DRY" ]; then
  echo "Dry run only — nothing was published."
else
  echo "Published. Verify a consumer install resolves the dependency versions:"
  echo "  npm view @trinoris/agent-sdk dependencies"
fi
