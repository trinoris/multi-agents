/**
 * © 2026 TRINORIS. MIT licensed — see LICENSE.
 *
 * Filesystem lock engine. Implements specs/01 + specs/02 exactly, including the two
 * primitives that verification disproved:
 *
 *   - the claim is a `mkdir` marker, never `mv -n` (MA-T04)
 *   - breaking a lock requires the `<scope>.breaking` token (MA-T12)
 *
 * Every mutation goes through mkdir, the only primitive verified atomic on the target
 * filesystems. Nothing here uses flock.
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, statSync, existsSync, mkdirSync as mkdirp } from 'node:fs';
import { join } from 'node:path';
import {
  type Lock,
  isLockExpired,
  isInGracePeriod,
  calculateExpiration,
  formatTimestamp,
} from '@trinoris/agent-core';

export interface LockPaths {
  root: string;            // the coordination/ directory
}

export type LockState =
  | { state: 'free' }
  | { state: 'held'; lock: Lock; breakable: false }
  | { state: 'expired'; lock: Lock; breakable: boolean }   // breakable once past grace
  | { state: 'malformed'; breakable: boolean; dirMtime: Date };

const lockDir = (p: LockPaths, scope: string) => join(p.root, 'locks', `${scope}.lock`);
const tokenDir = (p: LockPaths, scope: string) => join(p.root, 'locks', `${scope}.breaking`);
const holderFile = (p: LockPaths, scope: string) => join(lockDir(p, scope), 'holder.json');

/** mkdir as the atomic test-and-set. Returns false if it already exists. */
function mkdirExclusive(path: string): boolean {
  try {
    mkdirSync(path);           // no recursive: must fail when present
    return true;
  } catch (e: any) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

function readHolder(p: LockPaths, scope: string): Lock | null {
  try {
    return JSON.parse(readFileSync(holderFile(p, scope), 'utf8')) as Lock;
  } catch {
    return null;              // absent or unparseable: both are "malformed"
  }
}

/**
 * Spec 01: a lock is breakable when its lease is past expiry by more than the grace
 * period, or when it is malformed and the lock DIRECTORY's own mtime is older than
 * grace. The directory mtime is the only timestamp available when holder.json is
 * missing, which is exactly the two-step-acquire window.
 */
export function inspect(p: LockPaths, scope: string, graceMinutes: number, now = new Date()): LockState {
  const dir = lockDir(p, scope);
  if (!existsSync(dir)) return { state: 'free' };

  const lock = readHolder(p, scope);
  if (!lock) {
    const dirMtime = statSync(dir).mtime;
    const graceEnd = new Date(dirMtime.getTime() + graceMinutes * 60_000);
    return { state: 'malformed', breakable: now > graceEnd, dirMtime };
  }
  if (!isLockExpired(lock, now)) return { state: 'held', lock, breakable: false };
  return { state: 'expired', lock, breakable: !isInGracePeriod(lock, graceMinutes, now) };
}

export function acquire(
  p: LockPaths,
  scope: string,
  identity: { agent_instance: string; agent_class: string },
  leaseMinutes: number,
  task?: string
): { ok: true; lock: Lock } | { ok: false; reason: 'held'; state: LockState } {
  if (!mkdirExclusive(lockDir(p, scope))) {
    return { ok: false, reason: 'held', state: inspect(p, scope, 0) };
  }
  // Spec 02: write holder.json in the very next operation — this window is the
  // malformed-lock case and must be kept to milliseconds.
  const now = new Date();
  const lock: Lock = {
    ...identity,
    scope,
    acquired_at: formatTimestamp(now),
    expires_at: formatTimestamp(calculateExpiration(leaseMinutes, now)),
    ...(task ? { task } : {}),
  };
  writeFileSync(holderFile(p, scope), JSON.stringify(lock, null, 2) + '\n', 'utf8');
  return { ok: true, lock };
}

/** Spec 02: presence is not ownership. Only the agent_instance field is. */
export function isHolder(p: LockPaths, scope: string, agentInstance: string): boolean {
  return readHolder(p, scope)?.agent_instance === agentInstance;
}

export function renew(
  p: LockPaths, scope: string, agentInstance: string, leaseMinutes: number
): { ok: true; lock: Lock } | { ok: false; reason: 'not-holder' } {
  const current = readHolder(p, scope);
  if (current?.agent_instance !== agentInstance) return { ok: false, reason: 'not-holder' };
  const lock: Lock = { ...current, expires_at: formatTimestamp(calculateExpiration(leaseMinutes)) };
  writeFileSync(holderFile(p, scope), JSON.stringify(lock, null, 2) + '\n', 'utf8');
  return { ok: true, lock };
}

export function release(
  p: LockPaths, scope: string, agentInstance: string
): { ok: true } | { ok: false; reason: 'not-holder' | 'free' } {
  if (!existsSync(lockDir(p, scope))) return { ok: false, reason: 'free' };
  if (!isHolder(p, scope, agentInstance)) return { ok: false, reason: 'not-holder' };
  rmSync(lockDir(p, scope), { recursive: true, force: true });
  return { ok: true };
}

/**
 * Break a stale lock.
 *
 * Verified (MA-T12): judging a lock stale and then deleting-and-recreating it
 * double-breaks under load — 25/60 failures at N=8, 59/60 at N=32 — because once the
 * first breaker re-creates the lock the name is occupied again and a slightly later
 * breaker evicts the NEW holder. Rename-aside alone does not fix it either.
 *
 * The fix is this token: `mkdir <scope>.breaking` serialises breaking with the one
 * primitive proven atomic. A loser stands down without touching the lock.
 */
export function breakLock(
  p: LockPaths,
  scope: string,
  identity: { agent_instance: string; agent_class: string },
  leaseMinutes: number,
  graceMinutes: number,
  reason: string
): { ok: true; lock: Lock; evicted: Lock | null; incident: string }
  | { ok: false; reason: 'token-held' | 'not-stale' | 'lost-race' } {
  const token = tokenDir(p, scope);
  if (!mkdirExclusive(token)) return { ok: false, reason: 'token-held' };

  try {
    // Re-check after taking the token: the holder may have renewed meanwhile.
    const state = inspect(p, scope, graceMinutes);
    if (state.state === 'held' || (state.state !== 'free' && !state.breakable)) {
      return { ok: false, reason: 'not-stale' };
    }
    const evicted = state.state === 'expired' ? state.lock : null;

    const stamp = formatTimestamp().replace(/[:]/g, '');
    mkdirp(join(p.root, 'incidents'), { recursive: true });
    const incident = join(p.root, 'incidents', `${stamp}-broken-${scope}.md`);
    writeFileSync(incident, [
      `# Broken lock: ${scope}`, '',
      `- **Broken by:** ${identity.agent_instance} (${identity.agent_class})`,
      `- **At:** ${formatTimestamp()}`,
      `- **Prior holder:** ${evicted ? `${evicted.agent_instance} (${evicted.agent_class})` : 'unknown — malformed lock, no holder.json'}`,
      `- **Prior acquired_at:** ${evicted?.acquired_at ?? 'n/a'}`,
      `- **Prior expires_at:** ${evicted?.expires_at ?? 'n/a'}`,
      `- **Lock state:** ${state.state}`,
      `- **Why judged dead:** ${reason}`, '',
      '> The evicted agent may have left the tree mid-edit. Run `git status` and the',
      '> relevant tests before building on what is here.', '',
    ].join('\n'), 'utf8');

    // Move the stale lock aside rather than deleting it: the evicted holder's metadata
    // survives as evidence.
    if (existsSync(lockDir(p, scope))) {
      renameSync(lockDir(p, scope), join(p.root, 'incidents', `${stamp}-${scope}.stale`));
    }
    if (!mkdirExclusive(lockDir(p, scope))) return { ok: false, reason: 'lost-race' };

    const now = new Date();
    const lock: Lock = {
      ...identity, scope,
      acquired_at: formatTimestamp(now),
      expires_at: formatTimestamp(calculateExpiration(leaseMinutes, now)),
      task: `took over stale lock: ${reason}`,
    };
    writeFileSync(holderFile(p, scope), JSON.stringify(lock, null, 2) + '\n', 'utf8');

    // Re-verify: anything that still slipped through is caught here.
    if (!isHolder(p, scope, identity.agent_instance)) return { ok: false, reason: 'lost-race' };
    return { ok: true, lock, evicted, incident };
  } finally {
    rmSync(token, { recursive: true, force: true });
  }
}

/**
 * Claim a handoff note.
 *
 * Verified (MA-T04): `mv -n` is NOT an atomic claim — it is stat-then-rename in
 * userspace and returns success when it declines, so two racers both believe they
 * claimed (2 of 8 racers; 21/100 trials). The mkdir marker is the atomic step.
 */
export function claim(
  p: LockPaths, noteFilename: string, fromDir: string, toDir: string
): { ok: true; path: string } | { ok: false; reason: 'claimed-by-other' | 'missing' } {
  const marker = join(p.root, 'claims', `${noteFilename}.claim`);
  mkdirp(join(p.root, 'claims'), { recursive: true });
  if (!mkdirExclusive(marker)) return { ok: false, reason: 'claimed-by-other' };
  try {
    const src = join(p.root, fromDir, noteFilename);
    if (!existsSync(src)) return { ok: false, reason: 'missing' };
    const dest = join(p.root, toDir, noteFilename);
    mkdirp(join(p.root, toDir), { recursive: true });
    renameSync(src, dest);
    return { ok: true, path: dest };
  } finally {
    rmSync(marker, { recursive: true, force: true });
  }
}
