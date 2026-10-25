#!/usr/bin/env bash
# MA-T04 candidate claim primitives. Exactly one racer may believe it claimed.
#   A) ln (hardlink) target, then unlink source  — link() is atomic, fails if target exists
#   B) mkdir a claim marker, winner then moves the note — reuses the MA-T01-proven primitive
set -u
ARENA="${1:?arena}"; N="${2:-16}"; TRIALS="${3:-100}"; MODE="${4:?A|B}"
rm -rf "$ARENA"; mkdir -p "$ARENA/inbox" "$ARENA/active" "$ARENA/claims"
fail=0
for t in $(seq 1 "$TRIALS"); do
  note="$ARENA/inbox/n$t.md"; target="$ARENA/active/n$t.md"
  claim="$ARENA/claims/n$t.claim"; barrier="$ARENA/go-$t"; out="$ARENA/res-$t"
  echo "payload-$t" > "$note"; : > "$out"
  for i in $(seq 1 "$N"); do
    ( while [ ! -e "$barrier" ]; do :; done
      if [ "$MODE" = A ]; then
        if ln "$note" "$target" 2>/dev/null; then rm -f "$note"; echo claim >> "$out"; fi
      else
        if mkdir "$claim" 2>/dev/null; then mv "$note" "$target" 2>/dev/null && echo claim >> "$out"; fi
      fi
    ) &
  done
  sleep 0.05; : > "$barrier"; wait
  claims=$(grep -c claim "$out" 2>/dev/null || echo 0)
  copies=0; [ -e "$note" ] && copies=$((copies+1)); [ -e "$target" ] && copies=$((copies+1))
  ok=no; [ -e "$target" ] && [ "$(cat "$target" 2>/dev/null)" = "payload-$t" ] && ok=yes
  if [ "$claims" -ne 1 ] || [ "$copies" -ne 1 ] || [ "$ok" != yes ]; then
    echo "TRIAL $t FAIL claims=$claims copies=$copies ok=$ok"; fail=$((fail+1))
  fi
done
echo "mode=$MODE trials=$TRIALS racers=$N failures=$fail"
[ "$fail" -eq 0 ] && echo "PASS" || echo "FAIL"
