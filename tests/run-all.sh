#!/usr/bin/env bash
# Runs the whole verification battery. Every harness needs an arena directory and most
# take N/trials, which is why they are not self-documenting enough to run by hand.
#
#   usage: tests/run-all.sh [arena-base] [N] [trials]
#
# The arena base MUST be on the filesystem you are certifying — the point of these tests
# is the filesystem's behaviour, so running them on /tmp tells you nothing about a repo
# that lives on a Windows drive.
set -u
cd "$(dirname "$0")/.."
BASE="${1:-$(pwd)/.test-arena}"; N="${2:-8}"; TRIALS="${3:-25}"
CLI="$(pwd)/packages/cli/dist/bin.js"
pass=0; fail=0
run() { # run <label> <command...>
  local label="$1"; shift
  printf '%-30s ' "$label"
  local out; out="$("$@" 2>&1 | tail -1)"
  if echo "$out" | grep -q "PASS"; then echo "PASS"; pass=$((pass+1))
  else echo "FAIL  ($out)"; fail=$((fail+1)); fi
}

echo "arena=$BASE  N=$N  trials=$TRIALS"
[ -f "$CLI" ] || echo "NOTE: CLI not built — CLI-dependent tests will fail. Run: pnpm --filter @trinoris/agent-cli build"
echo

run "MA-T01 mkdir race"        bash tests/concurrency/ma-t01-mkdir-race.sh "$BASE/t01" "$N" "$TRIALS"
run "MA-T04 claim race (mkdir)" bash tests/concurrency/ma-t04-claim-race.sh "$BASE/t04" "$N" "$TRIALS" B
run "MA-T12 break race (shell)" bash tests/concurrency/ma-t12-break-race.sh "$BASE/t12" "$N" "$TRIALS"
run "MA-T02/03/05 lifecycle"   python3 -I tests/lifecycle/ma-t02-t03-t05-lifecycle.py "$BASE/life"
if [ -f "$CLI" ]; then
  run "MA-T07 no-spin (CLI)"   bash tests/concurrency/ma-t07-contention-no-spin.sh "$BASE/t07"
  run "MA-T12 break race (CLI)" bash tests/concurrency/ma-t12-cli-break-race.sh "$BASE/t12cli" "$N" "$TRIALS"
fi
if command -v powershell.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
  # Both arguments must name the SAME directory, one in each namespace — wslpath does
  # the translation. Passing two different paths makes the test compare unrelated trees
  # and fail for the wrong reason.
  mkdir -p "$BASE/t10"
  WINPATH="$(wslpath -w "$BASE/t10")"
  rmdir "$BASE/t10"
  run "MA-T10 WSL<->Windows"   bash tests/cross-platform/ma-t10-wsl-windows.sh "$BASE/t10" "$WINPATH"
else
  echo "MA-T10 WSL<->Windows           SKIP (needs powershell.exe + wslpath)"
fi

rm -rf "$BASE"
echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ] || exit 1
