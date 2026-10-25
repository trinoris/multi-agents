#!/usr/bin/env bash
# MA-T01: is mkdir atomic under REAL concurrency on the target filesystem?
# N racers synchronise on a barrier file, then all attempt mkdir of the same path.
# Exactly one must win, every trial.
set -u
ARENA="${1:?arena dir}"; N="${2:-16}"; TRIALS="${3:-50}"
rm -rf "$ARENA"; mkdir -p "$ARENA"
fail=0; total_wins=0
for t in $(seq 1 "$TRIALS"); do
  lock="$ARENA/t$t.lock"; barrier="$ARENA/go-$t"; out="$ARENA/res-$t"
  : > "$out"
  for i in $(seq 1 "$N"); do
    (
      while [ ! -e "$barrier" ]; do :; done   # spin on barrier: tight start window
      if mkdir "$lock" 2>/dev/null; then echo win >> "$out"; fi
    ) &
  done
  sleep 0.05            # let all racers reach the barrier
  : > "$barrier"        # release them
  wait
  wins=$(grep -c win "$out" 2>/dev/null || echo 0)
  total_wins=$((total_wins + wins))
  if [ "$wins" -ne 1 ]; then
    echo "TRIAL $t: FAIL — $wins winners (expected 1)"
    fail=$((fail + 1))
  fi
done
echo "trials=$TRIALS racers=$N total_wins=$total_wins expected_wins=$TRIALS failures=$fail"
[ "$fail" -eq 0 ] && echo "MA-T01: PASS" || echo "MA-T01: FAIL"
