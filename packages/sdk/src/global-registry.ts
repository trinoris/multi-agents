/**
 * Copyright 2026 TRINORIS
 * Licensed under the Apache License, Version 2.0 — see LICENSE.
 *
 * R3b of specs/08-write-guard-and-visibility.md — a machine-local view of who is working
 * where.
 *
 * Each checkout's `.trinoris/` is isolated. The 2026-10-29 wave spanned nine repositories;
 * while one instance worked in trinoris-templates a peer was active in
 * trinoris-control-tower, and neither protocol instance could observe the other.
 *
 * Advisory, never a lock of record. Per-repo `.trinoris/` stays authoritative for every
 * decision; this answers "who else is on this machine" and nothing more. It must never gate
 * an acquire, or one unrelated repository becomes a single point of failure for all of them.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readText, safePath, writeAtomic } from './filesystem.js';

export interface GlobalEntry {
  schema_version: 1;
  repository: string;
  agent_class: string;
  agent_instance: string;
  scopes: string[];
  task?: string;
  updated_at: string;
}

/** Overridable for tests; `~` may sit on a different filesystem from the checkout. */
export function globalRoot(): string {
  return process.env.TRINORIS_GLOBAL_DIR ? resolve(process.env.TRINORIS_GLOBAL_DIR) : join(homedir(), '.trinoris');
}

/** A repository path maps to one stable filename, so an entry is replaced rather than appended. */
const entryName = (repository: string, instance: string) => `${createHash('sha256').update(`${resolve(repository)}\0${instance}`).digest('hex').slice(0, 32)}.json`;

/**
 * Publish this instance's current holdings for one repository. Never throws: the global
 * view is an aid, and a failure here must not affect the lease it describes.
 */
export function publishGlobalEntry(entry: Omit<GlobalEntry, 'schema_version'>): void {
  try {
    const root = globalRoot();
    const dir = join(root, 'registry');
    if (!safePath(root, dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, entryName(entry.repository, entry.agent_instance));
    if (!entry.scopes.length) { fs.rmSync(path, { force: true }); return; }
    const record: GlobalEntry = { schema_version: 1, ...entry, repository: resolve(entry.repository), scopes: entry.scopes.slice(0, 64) };
    writeAtomic(root, path, `${JSON.stringify(record)}\n`);
  } catch { /* advisory */ }
}

/** Remove this machine's entry for a repository, e.g. when the last scope is released. */
export function clearGlobalEntry(repository: string): void {
  try {
    const dir = join(globalRoot(), 'registry');
    if (!safePath(globalRoot(), dir)?.isDirectory()) return;
    for (const name of fs.readdirSync(dir)) {
      const path = join(dir, name);
      try {
        const text = readText(globalRoot(), path, 64 * 1024);
        if (text && JSON.parse(text).repository === resolve(repository)) fs.rmSync(path, { force: true });
      } catch { /* skip malformed or unsafe entry */ }
    }
  } catch { /* advisory */ }
}

export interface GlobalView { root: string; entries: GlobalEntry[]; unreadable: number }

/**
 * Every entry on this machine. A stale or malformed entry is not an error: repositories are
 * deleted, moved, and operated by agents that predate this feature.
 */
export function readGlobalRegistry(): GlobalView {
  const root = globalRoot();
  const dir = join(root, 'registry');
  if (!safePath(root, dir)?.isDirectory()) return { root, entries: [], unreadable: 0 };
  const entries: GlobalEntry[] = [];
  let unreadable = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const text = readText(root, join(dir, name), 64 * 1024);
      const parsed = text ? JSON.parse(text) as GlobalEntry : null;
      if (parsed?.schema_version === 1 && typeof parsed.repository === 'string' && typeof parsed.agent_class === 'string' && typeof parsed.agent_instance === 'string' && Array.isArray(parsed.scopes) && parsed.scopes.every(s => typeof s === 'string') && typeof parsed.updated_at === 'string' && Number.isFinite(Date.parse(parsed.updated_at))) entries.push(parsed);
      else unreadable++;
    } catch { unreadable++; }
  }
  entries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { root, entries, unreadable };
}
