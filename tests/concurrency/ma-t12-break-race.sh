#!/usr/bin/env bash
# Breaking a stale lock, with a break-token so only one agent may break a scope at a time,
# plus the protocol's re-verify-after-acquire step.
#   mkdir <scope>.breaking   -> atomic; losing it means stand down, do not touch the lock
#   mv lock aside; mkdir lock; write holder.json
#   re-read holder.json: if it is not me, I lost -> stand down
#   rmdir <scope>.breaking
set -u
ARENA="${1:?arena}"; N="${2:-16}"; TRIALS="${3:-100}"
rm -rf "$ARENA"; mkdir -p "$ARENA/stale"
fail=0
for t in $(seq 1 "$TRIALS"); do
  lock="$ARENA/s$t.lock"; tok="$ARENA/s$t.breaking"; barrier="$ARENA/go-$t"; out="$ARENA/res-$t"
  mkdir -p "$lock"; echo '{"agent":"dead","expires_at":"2020-01-01T00:00:00Z"}' > "$lock/holder.json"
  : > "$out"
  for i in $(seq 1 "$N"); do
    ( while [ ! -e "$barrier" ]; do :; done
      me="agent$i"
      mkdir "$tok" 2>/dev/null || exit 0            # lost the right to break: stand down
      mv "$lock" "$ARENA/stale/s$t-$me" 2>/dev/null
      if mkdir "$lock" 2>/dev/null; then
        echo "{\"agent\":\"$me\"}" > "$lock/holder.json"
        # protocol re-verify: presence is not ownership
        if [ "$(sed -n 's/.*"agent":"\([^"]*\)".*/\1/p' "$lock/holder.json" 2>/dev/null)" = "$me" ]; then
          echo "took:$me" >> "$out"
        fi
      fi
      rmdir "$tok" 2>/dev/null
    ) &
  done
  sleep 0.05; : > "$barrier"; wait
  takeovers=$(grep -c '^took:' "$out" 2>/dev/null || echo 0)
  final=$(sed -n 's/.*"agent":"\([^"]*\)".*/\1/p' "$lock/holder.json" 2>/dev/null)
  claimed=$(sed -n 's/^took://p' "$out" 2>/dev/null | tr -d '\n')
  if [ "$takeovers" -ne 1 ] || [ "$final" != "$claimed" ]; then
    echo "TRIAL $t FAIL takeovers=$takeovers final=$final claimed=$claimed"; fail=$((fail+1))
  fi
done
echo "trials=$TRIALS racers=$N failures=$fail"
[ "$fail" -eq 0 ] && echo "PASS" || echo "FAIL"
