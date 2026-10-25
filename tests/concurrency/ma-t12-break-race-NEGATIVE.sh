#!/usr/bin/env bash
# Breaking a stale lock must be atomic: N agents all judge it breakable at the same
# instant. Exactly one may take over.
#   OLD) rm -rf then mkdir      — two breakers can both "win", second clobbers the first
#   NEW) mv lock aside, then mkdir — rename is atomic; losing the mv means stand down
set -u
ARENA="${1:?arena}"; N="${2:-16}"; TRIALS="${3:-100}"; MODE="${4:?OLD|NEW}"
rm -rf "$ARENA"; mkdir -p "$ARENA/stale"
fail=0
for t in $(seq 1 "$TRIALS"); do
  lock="$ARENA/s$t.lock"; barrier="$ARENA/go-$t"; out="$ARENA/res-$t"
  mkdir -p "$lock"; echo '{"agent":"dead","expires_at":"2020-01-01T00:00:00Z"}' > "$lock/holder.json"
  : > "$out"
  for i in $(seq 1 "$N"); do
    ( while [ ! -e "$barrier" ]; do :; done
      me="agent$i"
      if [ "$MODE" = OLD ]; then
        rm -rf "$lock" 2>/dev/null
        if mkdir "$lock" 2>/dev/null; then
          echo "{\"agent\":\"$me\"}" > "$lock/holder.json"; echo "took:$me" >> "$out"
        fi
      else
        if mv "$lock" "$ARENA/stale/s$t-$me" 2>/dev/null; then
          if mkdir "$lock" 2>/dev/null; then
            echo "{\"agent\":\"$me\"}" > "$lock/holder.json"; echo "took:$me" >> "$out"
          fi
        fi
      fi
    ) &
  done
  sleep 0.05; : > "$barrier"; wait
  takeovers=$(grep -c '^took:' "$out" 2>/dev/null || echo 0)
  final=$(sed -n 's/.*"agent":"\([^"]*\)".*/\1/p' "$lock/holder.json" 2>/dev/null)
  claimed=$(sed -n 's/^took://p' "$out" 2>/dev/null | tr '\n' ',')
  # the single agent that believes it took over must be the one actually in holder.json
  if [ "$takeovers" -ne 1 ] || [ "took:$final," != "took:${claimed}" ]; then
    echo "TRIAL $t FAIL takeovers=$takeovers final=$final claimed=$claimed"; fail=$((fail+1))
  fi
done
echo "mode=$MODE trials=$TRIALS racers=$N failures=$fail"
[ "$fail" -eq 0 ] && echo "PASS" || echo "FAIL"
