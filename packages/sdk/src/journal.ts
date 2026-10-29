/**
 * Copyright 2026 TRINORIS
 * Licensed under the Apache License, Version 2.0 — see LICENSE.
 *
 * R3a of specs/08-write-guard-and-visibility.md — an append-only record of what has
 * happened in this checkout.
 *
 * `incidents` records only takeovers and recoveries. There was no answer to "what has
 * happened here recently", which is the question a resuming agent actually asks, and the
 * question whose absence let the 2026-10-29 collision go unnoticed: a peer had taken all
 * seven scopes minutes earlier and released them, and nothing retained that fact.
 *
 * A failed append must never fail the operation it describes. Coordination state under
 * `locks/` is the record; this is an aid to reading it.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import type { AgentIdentity } from '@trinoris/agent-core';
import { readText, safePath } from './filesystem.js';

export interface JournalRecord {
  at: string;
  agent_class: string;
  agent_instance: string;
  operation: string;
  operation_id?: string;
  scopes?: string[];
  task?: string;
  outcome: 'ok' | 'refused' | 'error';
  detail?: string;
}

const MAX_RECORD_BYTES = 4096;
const MAX_LINES_RETURNED = 1000;
const day = (at: Date) => at.toISOString().slice(0, 10);

/** Truncate and strip control characters, so one record cannot bloat or corrupt the file. */
function bounded(value: string | undefined, limit: number): string | undefined {
  if (value === undefined) return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

/**
 * Append one record. Never throws: a journal that can break a release would be worse than
 * no journal at all.
 */
export function appendJournal(root: string, record: JournalRecord, retentionDays = 30): void {
  try {
    const dir = join(root, 'journal');
    if (!safePath(root, dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const at = new Date(record.at);
    if (Number.isNaN(at.getTime())) return;
    const line = JSON.stringify({
      ...record,
      task: bounded(record.task, 512),
      detail: bounded(record.detail, 512),
      scopes: record.scopes?.slice(0, 64),
    });
    if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) return;
    const path = join(dir, `${day(at)}.jsonl`);
    const existing = safePath(root, path);
    if (existing && (!existing.isFile() || existing.nlink !== 1)) return;
    const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || (existing && (opened.ino !== existing.ino || opened.dev !== existing.dev))) return;
      fs.writeFileSync(fd, `${line}\n`, 'utf8');
    } finally { fs.closeSync(fd); }
    pruneJournal(root, at, retentionDays);
  } catch { /* an aid, never a gate */ }
}

/** Drop day files older than the retention bound, so the journal cannot grow without limit. */
export function pruneJournal(root: string, at: Date, retentionDays: number): void {
  try {
    const dir = join(root, 'journal');
    if (!safePath(root, dir)?.isDirectory()) return;
    const cutoff = day(new Date(at.getTime() - retentionDays * 86_400_000));
    for (const name of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
      if (name.slice(0, -6) < cutoff && safePath(root, join(dir, name))?.isFile()) fs.rmSync(join(dir, name), { force: true });
    }
  } catch { /* best effort */ }
}

/** Most recent first. Unparseable lines are skipped rather than failing the read. */
export function readJournal(root: string, options: { last?: number; scope?: string; instance?: string } = {}): JournalRecord[] {
  const dir = join(root, 'journal');
  if (!safePath(root, dir)?.isDirectory()) return [];
  const limit = Math.min(Math.max(options.last ?? 50, 1), MAX_LINES_RETURNED);
  const files = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')).sort().reverse();
  const out: JournalRecord[] = [];
  for (const name of files) {
    let content: string | null;
    try { content = readText(root, join(dir, name), 8 * 1024 * 1024); } catch { continue; }
    if (content === null) continue;
    const lines = content.split('\n').filter(Boolean);
    for (const raw of lines.reverse()) {
      let record: JournalRecord;
      try { record = JSON.parse(raw) as JournalRecord; } catch { continue; }
      if (!record || typeof record !== 'object' || typeof record.at !== 'string' || typeof record.agent_instance !== 'string' || typeof record.agent_class !== 'string' || typeof record.operation !== 'string' || !['ok', 'refused', 'error'].includes(record.outcome) || (record.scopes !== undefined && (!Array.isArray(record.scopes) || record.scopes.some(s => typeof s !== 'string')))) continue;
      if (options.scope && !(record.scopes ?? []).includes(options.scope)) continue;
      if (options.instance && record.agent_instance !== options.instance) continue;
      out.push(record);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function journalRecord(owner: AgentIdentity, operation: string, at: Date, extra: Partial<JournalRecord> = {}): JournalRecord {
  return { at: at.toISOString(), agent_class: owner.agent_class, agent_instance: owner.agent_instance, operation, outcome: 'ok', ...extra };
}
