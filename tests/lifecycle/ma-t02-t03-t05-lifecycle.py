#!/usr/bin/env python3
"""MA-T02 / T03 / T05: the lock lifecycle decision rules from spec 01/02.

Reference implementation of 'may I break this lock?' and 'do I still hold it?',
exercised against real directories on the target filesystem.
"""
import json, os, shutil, sys, time
from datetime import datetime, timedelta, timezone

GRACE = timedelta(minutes=5)
ARENA = sys.argv[1]
now = lambda: datetime.now(timezone.utc)
iso = lambda d: d.strftime('%Y-%m-%dT%H:%M:%SZ')
fails = []

def check(name, got, want):
    ok = got == want
    print(f"  {'PASS' if ok else 'FAIL'}  {name}: got={got!r} want={want!r}")
    if not ok: fails.append(name)

def mklock(path, holder=None, dir_age_min=0):
    os.makedirs(path, exist_ok=False)
    if holder is not None:
        with open(os.path.join(path, 'holder.json'), 'w', newline='\n') as f:
            json.dump(holder, f)
    if dir_age_min:
        t = time.time() - dir_age_min * 60
        os.utime(path, (t, t))

def breakable(path, at=None):
    """Spec 01: breakable if lease expired beyond grace, OR malformed and dir mtime
    older than grace."""
    at = at or now()
    hp = os.path.join(path, 'holder.json')
    try:
        with open(hp) as f: h = json.load(f)
        exp = datetime.strptime(h['expires_at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        return at > exp + GRACE
    except (FileNotFoundError, json.JSONDecodeError, KeyError, ValueError):
        mtime = datetime.fromtimestamp(os.path.getmtime(path), timezone.utc)
        return at > mtime + GRACE

def still_holder(path, me):
    """Spec 02: presence is not ownership. Only holder.json's agent field is."""
    try:
        with open(os.path.join(path, 'holder.json')) as f:
            return json.load(f).get('agent') == me
    except Exception:
        return False

shutil.rmtree(ARENA, ignore_errors=True); os.makedirs(ARENA)
H = lambda mins: {"agent": "claude", "scope": "engine", "expires_at": iso(now() + timedelta(minutes=mins))}

print("MA-T02 — lease expiry vs grace")
mklock(f"{ARENA}/live",       H(+10)); check("live lease", breakable(f"{ARENA}/live"), False)
mklock(f"{ARENA}/just_exp",   H(-1));  check("expired 1m (inside grace)", breakable(f"{ARENA}/just_exp"), False)
mklock(f"{ARENA}/edge",       H(-5));  check("expired exactly grace", breakable(f"{ARENA}/edge"), False)
mklock(f"{ARENA}/dead",       H(-20)); check("expired 20m (beyond grace)", breakable(f"{ARENA}/dead"), True)

print("MA-T03 — malformed lock")
mklock(f"{ARENA}/mal_new",  None, dir_age_min=0)
check("no holder.json, fresh dir", breakable(f"{ARENA}/mal_new"), False)
mklock(f"{ARENA}/mal_old",  None, dir_age_min=30)
check("no holder.json, dir 30m old", breakable(f"{ARENA}/mal_old"), True)
os.makedirs(f"{ARENA}/corrupt"); open(f"{ARENA}/corrupt/holder.json","w").write("{not json")
t = time.time() - 30*60; os.utime(f"{ARENA}/corrupt", (t,t))
check("unparseable holder.json, dir old", breakable(f"{ARENA}/corrupt"), True)

print("MA-T05 — ABA: slow holder must not trust lock presence")
p = f"{ARENA}/aba"
mklock(p, H(-20))                                    # A acquired, lease now expired
check("A believes it holds (naive: dir exists)", os.path.isdir(p), True)
check("B may break", breakable(p), True)
shutil.rmtree(p)                                     # B breaks...
mklock(p, {"agent":"codex","scope":"engine","expires_at": iso(now()+timedelta(minutes=15))})
check("dir still exists (ABA)", os.path.isdir(p), True)
check("A re-checks ownership -> lost", still_holder(p, "claude"), False)
check("B is the holder", still_holder(p, "codex"), True)

shutil.rmtree(ARENA, ignore_errors=True)
print(f"\nfailures={len(fails)} {fails if fails else ''}")
print("LIFECYCLE: PASS" if not fails else "LIFECYCLE: FAIL")
