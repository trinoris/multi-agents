/**
 * Copyright 2026 TRINORIS
 * Licensed under the Apache License, Version 2.0 — see LICENSE.
 *
 * R1 of specs/08-write-guard-and-visibility.md — refuse a write over a path whose loss
 * would not be recoverable from Git.
 *
 * Why this exists: on 2026-10-29 an agent holding valid leases on six scopes, each checked
 * immediately before writing, corrupted three untracked files belonging to a peer. No rule
 * was broken — the peer held no lease — because a scope lease coordinates intent and says
 * nothing about which paths it covers.
 *
 * What this deliberately does NOT do: attribute a dirty file to a lease holder. Mapping a
 * path to a scope is a human responsibility under spec 01, so the engine cannot know whose
 * a modified file is. It reports what Git can prove and refuses what Git cannot recover.
 */
import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

export type PathVerdict = 'clean' | 'dirty' | 'untracked' | 'ignored' | 'missing';
export interface PathClassification { path: string; verdict: PathVerdict; allowed: boolean; reason: string }
export interface GuardReport { ok: boolean; repository: string | null; paths: PathClassification[] }

const REASON: Record<PathVerdict, string> = {
  clean: 'tracked and unmodified; a write is recoverable by diff',
  dirty: 'tracked but modified; the working copy is unattributable and a write would overwrite it',
  untracked: 'untracked; nothing committed to diff or restore if a write is wrong',
  ignored: 'ignored by Git; build output or coordination state',
  missing: 'does not exist; a write creates it',
};

function git(repository: string, args: string[]): string {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** The repository root containing `from`, or null when it is not a work tree. */
export function repositoryRoot(from: string): string | null {
  try { return git(from, ['rev-parse', '--show-toplevel']).trim() || null; } catch { return null; }
}

/**
 * Classify each path. `allowUntracked` and `allowDirty` list paths the caller asserts are
 * its own; the override is per path and never global, so a bulk operation cannot silence
 * the check wholesale.
 */
export function classifyPaths(paths: string[], options: { cwd?: string; allowUntracked?: string[]; allowDirty?: string[] } = {}): GuardReport {
  if (!paths.length || paths.length > 4096) throw new RangeError('Provide between 1 and 4096 paths');
  const cwd = resolve(options.cwd ?? process.cwd());
  const repository = repositoryRoot(cwd);
  if (!repository) {
    // Not a work tree: Git can prove nothing, so nothing is allowed on its authority.
    return { ok: false, repository: null, paths: paths.map(path => ({ path, verdict: 'untracked', allowed: false, reason: 'not inside a Git work tree; Git cannot establish recoverability' })) };
  }
  const allowUntracked = new Set((options.allowUntracked ?? []).map(p => relative(repository, resolve(cwd, p))));
  const allowDirty = new Set((options.allowDirty ?? []).map(p => relative(repository, resolve(cwd, p))));

  const classified = paths.map<PathClassification>(path => {
    const rel = relative(repository, resolve(cwd, path));
    if (rel.startsWith('..')) return { path, verdict: 'untracked', allowed: false, reason: 'outside the repository; Git cannot establish recoverability' };
    let verdict: PathVerdict;
    const status = (() => { try { return git(repository, ['status', '--porcelain', '--ignored=matching', '--', rel]); } catch { return ''; } })();
    const line = status.split('\n').find(l => l.trim().length > 0);
    if (!line) {
      let tracked = false;
      try { tracked = git(repository, ['ls-files', '--error-unmatch', '--', rel]).trim().length > 0; } catch { tracked = false; }
      verdict = tracked ? 'clean' : 'missing';
    } else if (line.startsWith('!!')) verdict = 'ignored';
    else if (line.startsWith('??')) verdict = 'untracked';
    else verdict = 'dirty';

    const overridden = (verdict === 'untracked' && allowUntracked.has(rel)) || (verdict === 'dirty' && allowDirty.has(rel));
    const allowed = verdict === 'clean' || verdict === 'ignored' || verdict === 'missing' || overridden;
    return { path, verdict, allowed, reason: overridden ? `${REASON[verdict]} — allowed explicitly by the caller` : REASON[verdict] };
  });

  return { ok: classified.every(c => c.allowed), repository, paths: classified };
}
