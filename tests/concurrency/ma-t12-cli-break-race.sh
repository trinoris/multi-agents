#!/usr/bin/env bash
# MA-T12 against the real @trinoris/agent-cli implementation.
# N agents simultaneously try to break the same stale lock. Exactly one may take over,
# and the winner must be the agent actually recorded in holder.json.
#   usage: ma-t12-cli-break-race.sh <arena> <N> <trials> [path/to/bin.js]
set -u
A="${1:?arena}"; N="${2:-16}"; TRIALS="${3:-40}"
BIN="${4:-$(cd "$(dirname "$0")/../../packages/cli" && pwd)/dist/bin.js}"
[ -f "$BIN" ] || { echo "built CLI not found at $BIN — run: pnpm --filter @trinoris/agent-cli build"; exit 2; }
fail=0
for t in $(seq 1 "$TRIALS"); do
  rm -rf "$A"; mkdir -p "$A/coordination/locks/engine.lock" "$A/coordination/incidents"
  printf '{"agent_instance":"dead-1","agent_class":"kiro","scope":"engine","acquired_at":"2020-01-01T00:00:00Z","expires_at":"2020-01-01T00:15:00Z"}\n' \
    > "$A/coordination/locks/engine.lock/holder.json"
  barrier="$A/go"; out="$A/out"; : > "$out"
  for i in $(seq 1 "$N"); do
    ( while [ ! -e "$barrier" ]; do :; done
      if node "$BIN" break --scope engine --work-dir "$A" --instance "agent-$i" \
           --agent-class claude --reason "race test" >/dev/null 2>&1; then
        echo "took:agent-$i" >> "$out"
      fi
    ) &
  done
  sleep 0.05; : > "$barrier"; wait
  takeovers=$(grep -c '^took:' "$out" 2>/dev/null || echo 0)
  winner=$(sed -n 's/^took://p' "$out" 2>/dev/null | tr -d '\n')
  holder=$(sed -n 's/.*"agent_instance": *"\([^"]*\)".*/\1/p' "$A/coordination/locks/engine.lock/holder.json" 2>/dev/null)
  if [ "$takeovers" -ne 1 ] || [ "$winner" != "$holder" ]; then
    echo "TRIAL $t FAIL takeovers=$takeovers winner=$winner holder=$holder"; fail=$((fail+1))
  fi
done
rm -rf "$A"
echo "trials=$TRIALS racers=$N failures=$fail"
[ "$fail" -eq 0 ] && echo "MA-T12 (CLI): PASS" || echo "MA-T12 (CLI): FAIL"
