#!/usr/bin/env bash
# MA-T10: a lock is mutually visible across the WSL <-> Windows boundary, and each side
# can read the other's holder.json. Runs unattended from WSL via powershell.exe.
#   usage: ma-t10-wsl-windows.sh <wsl-path> <equivalent-windows-path>
#   e.g.   ma-t10-wsl-windows.sh /mnt/c/Users/me/.t10 'C:\Users\me\.t10'
set -u
A="${1:?wsl path}"; W="${2:?windows path}"; fail=0
ck() { if [ "$2" = "$3" ]; then echo "  PASS  $1"; else echo "  FAIL  $1: got=$2 want=$3"; fail=$((fail+1)); fi; }
command -v powershell.exe >/dev/null || { echo "powershell.exe unreachable — cannot run"; exit 2; }
rm -rf "$A"; mkdir -p "$A"

mkdir "$A/wsl.lock"
printf '{"agent":"claude","scope":"engine","expires_at":"2026-01-01T00:00:00Z"}\n' > "$A/wsl.lock/holder.json"
r=$(powershell.exe -NoProfile -Command "try { New-Item -ItemType Directory -Path '$W\wsl.lock' -ErrorAction Stop | Out-Null; 'created' } catch { 'blocked' }" 2>/dev/null | tr -d '\r')
ck "WSL lock blocks Windows mkdir" "$r" "blocked"
r=$(powershell.exe -NoProfile -Command "(Get-Content -Raw '$W\wsl.lock\holder.json' | ConvertFrom-Json).agent" 2>/dev/null | tr -d '\r')
ck "Windows reads WSL holder.json" "$r" "claude"

powershell.exe -NoProfile -Command "New-Item -ItemType Directory -Path '$W\win.lock' | Out-Null; Set-Content -Path '$W\win.lock\holder.json' -Value '{\"agent\":\"codex\"}' -NoNewline" >/dev/null 2>&1
if mkdir "$A/win.lock" 2>/dev/null; then r=created; else r=blocked; fi
ck "Windows lock blocks WSL mkdir" "$r" "blocked"
r=$(sed -n 's/.*"agent":"\([^"]*\)".*/\1/p' "$A/win.lock/holder.json" 2>/dev/null)
ck "WSL reads Windows holder.json" "$r" "codex"

rm -rf "$A"
echo "failures=$fail"; [ "$fail" -eq 0 ] && echo "MA-T10: PASS" || echo "MA-T10: FAIL"
