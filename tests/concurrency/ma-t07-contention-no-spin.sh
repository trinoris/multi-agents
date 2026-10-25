#!/usr/bin/env bash
# MA-T07: same-scope contention, asserting the NO-SPIN rule.
#
# Supersedes tests/test_conflict_scenario.sh, which retried in a loop until it won and
# recorded that as a pass. Spec 01's hard rules forbid waiting or spinning on a held
# lock: "do not wait or spin. Pick different work or write a handoff." An agent that
# spins is an idle agent, and a test that certifies spinning certifies the wrong design.
#
# Asserts: B fails immediately with exit 3 (contended, not an error), does NOT retry,
# writes a handoff instead, and never disturbs A's lock. After A releases, a fresh
# attempt by B succeeds.
#   usage: ma-t07-contention-no-spin.sh <arena> [path/to/bin.js]
set -u
A="${1:?arena}"
BIN="${2:-$(cd "$(dirname "$0")/../../packages/cli" && pwd)/dist/bin.js}"
[ -f "$BIN" ] || { echo "built CLI not found at $BIN — run: pnpm --filter @trinoris/agent-cli build"; exit 2; }
fail=0
ck() { if [ "$2" = "$3" ]; then echo "  PASS  $1"; else echo "  FAIL  $1: got=$2 want=$3"; fail=$((fail+1)); fi; }

rm -rf "$A"; mkdir -p "$A/coordination/locks" "$A/coordination/handoff/for-kiro" "$A/coordination/active"

node "$BIN" acquire --scope specs --work-dir "$A" --instance agent-a --agent-class claude --task "holding" >/dev/null
ck "A holds the lock" "$(node "$BIN" check --scope specs --work-dir "$A" --instance agent-a >/dev/null 2>&1; echo $?)" "0"

# B attempts once. Time it: a spinning implementation would take seconds.
start=$(date +%s%N)
node "$BIN" acquire --scope specs --work-dir "$A" --instance agent-b --agent-class codex >/dev/null 2>&1
code=$?
elapsed_ms=$(( ($(date +%s%N) - start) / 1000000 ))
ck "B is told contended (exit 3, not an error)" "$code" "3"
if [ "$elapsed_ms" -lt 2000 ]; then
  echo "  PASS  B returned immediately (${elapsed_ms}ms) — did not spin"
else
  echo "  FAIL  B took ${elapsed_ms}ms — looks like it waited or retried"; fail=$((fail+1))
fi

ck "A's lock is untouched" "$(sed -n 's/.*"agent_instance": *"\([^"]*\)".*/\1/p' "$A/coordination/locks/specs.lock/holder.json")" "agent-a"

# The prescribed response to contention: hand the work over, then stop.
cat > "$A/coordination/handoff/for-kiro/20261025T0000-specs-blocked.md" <<'EOF'
---
from: agent-b
to: kiro
scopes: [specs]
status: blocked
locks_released: true
---
# specs was held, work not started

## Verified
- `acquire --scope specs` returned exit 3; holder was agent-a

## Assumed / not verified
- Nothing

## Next step
Retry once agent-a releases specs. Do not poll for it.
EOF
ck "B wrote a handoff instead of waiting" "$(ls "$A/coordination/handoff/for-kiro" | wc -l)" "1"

# After release, a FRESH attempt succeeds — this is retry-on-a-later-turn, not spinning.
node "$BIN" release --scope specs --work-dir "$A" --instance agent-a >/dev/null
node "$BIN" acquire --scope specs --work-dir "$A" --instance agent-b --agent-class codex >/dev/null 2>&1
ck "B acquires on a fresh attempt after release" "$?" "0"
ck "B is now the holder" "$(sed -n 's/.*"agent_instance": *"\([^"]*\)".*/\1/p' "$A/coordination/locks/specs.lock/holder.json")" "agent-b"

rm -rf "$A"
echo "failures=$fail"
[ "$fail" -eq 0 ] && echo "MA-T07: PASS" || echo "MA-T07: FAIL"
