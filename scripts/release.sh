#!/usr/bin/env bash
# Build and publish only @trinoris/agent-* packages whose configured version is not
# already present on npm.
#
#   usage: scripts/release.sh [--dry-run] [--otp=123456 ...]
#
# `npm publish` must not be used here. Packages depend on each other through
# `workspace:*`, and npm ships that string verbatim. pnpm rewrites workspace dependencies
# to concrete versions when packing and publishing.
#
# npm versions cannot be reused. The registry check below skips already-published package
# versions and stops on registry errors other than E404, so a network failure cannot be
# mistaken for a new version.
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=""
OTP_CODES=()
for a in "$@"; do
  case "$a" in
    --dry-run) DRY="--dry-run" ;;
    --otp=*)   OTP_CODES+=("${a#--otp=}") ;;
    *) echo "unknown argument: $a"; echo "usage: $0 [--dry-run] [--otp=123456 ...]"; exit 1 ;;
  esac
done

command -v pnpm >/dev/null || { echo "pnpm is required (npm would ship workspace:* unresolved)"; exit 1; }
command -v npm >/dev/null || { echo "npm is required to check registry versions and publish"; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) { console.error("Node.js 20 or later is required to run the release test toolchain."); process.exit(1); }'

echo "Checking release manifests and executable scripts..."
node scripts/release-inputs.mjs

echo "Installing from the frozen lockfile with lifecycle scripts disabled..."
CI=true pnpm install --frozen-lockfile --ignore-scripts

echo "Auditing workspace dependencies (high and critical vulnerabilities fail)..."
pnpm audit --audit-level=high

echo "Running the complete workspace test suite..."
pnpm test

PACKAGES=(agent-core agent-sdk agent-cli)
RELEASE_PACKAGES=()

for name in "${PACKAGES[@]}"; do
  package="@trinoris/$name"
  dir=${name#agent-}
  version=$(node -e "console.log(require('./packages/$dir/package.json').version)")
  set +e
  lookup=$(npm view --fetch-retries=0 --fetch-timeout=10000 "$package@$version" version 2>&1)
  lookup_status=$?
  set -e

  if [ "$lookup_status" -eq 0 ]; then
    echo "skip $package@$version (already published)"
  elif [[ "$lookup" == *"E404"* ]]; then
    echo "new  $package@$version"
    RELEASE_PACKAGES+=("$name")
  else
    echo "REFUSING: could not check $package@$version on npm:"
    echo "$lookup"
    exit 1
  fi
done

if [ "${#RELEASE_PACKAGES[@]}" -eq 0 ]; then
  echo "All configured package versions already exist on npm; quality gates passed and nothing needs publishing."
  exit 0
fi

if [ -z "$DRY" ]; then
  npm whoami >/dev/null 2>&1 || {
    echo "Not logged in to npm. Either:"
    echo "  npm login --scope=@trinoris          # interactive, then re-run with --otp"
    echo "  or configure an npm Automation token in your npm environment"
    exit 1
  }
  echo "Publishing as: $(npm whoami)"
  for name in "${RELEASE_PACKAGES[@]}"; do
    dir=${name#agent-}
    access=$(node -e "console.log(require('./packages/$dir/package.json').publishConfig.access)")
    license=$(node -e "console.log(require('./packages/$dir/package.json').license)")
    if [ "$access" = "public" ] && [ "$license" = "UNLICENSED" ]; then
      echo "REFUSING: @trinoris/$name is public but UNLICENSED. Set a license or use restricted access."
      exit 1
    fi
  done
  echo "A published version cannot be reused; review the package list above before continuing."
fi

echo "Building release targets and their workspace dependencies..."
BUILD_FILTERS=()
for name in "${RELEASE_PACKAGES[@]}"; do
  BUILD_FILTERS+=(--filter "@trinoris/$name...")
done
pnpm "${BUILD_FILTERS[@]}" build >/dev/null

index=0
for name in "${RELEASE_PACKAGES[@]}"; do
  package="@trinoris/$name"
  dir=${name#agent-}
  version=$(node -e "console.log(require('./packages/$dir/package.json').version)")
  echo "--- publishing $package@$version"
  PUBLISH_ARGS=()
  if [ -n "$DRY" ]; then
    PUBLISH_ARGS+=(--dry-run)
  else
    if [ "$index" -lt "${#OTP_CODES[@]}" ]; then
      PUBLISH_ARGS+=("--otp=${OTP_CODES[$index]}")
    elif [ -t 0 ] && [ -r /dev/tty ]; then
      code=""
      read -r -s -p "Fresh npm OTP for $package (press Enter if npm auth token is configured): " code </dev/tty
      echo
      if [ -n "$code" ]; then PUBLISH_ARGS+=("--otp=$code"); fi
    fi
  fi
  pnpm --filter "$package" publish "${PUBLISH_ARGS[@]}" --no-git-checks
  index=$((index + 1))
done

echo
if [ -n "$DRY" ]; then
  echo "Dry run only — no package versions were published."
else
  echo "Published new package versions. Verify them with npm view @trinoris/<package> version."
fi
