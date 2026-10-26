/**
 * Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE.
 * Protocol 3 serializes every mutation with mkdir. Guards are never reclaimed by age.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { type AgentIdentity, type Handoff, type Lock, ValidationError, boundedText, calculateExpiration, duration, identifier, isInGracePeriod, isLockExpired, parseHandoff, validateLock, object, validDate } from '@trinoris/agent-core';
import { directory, jsonFile, readText, removeOwnedDirectory, safePath, writeAtomic } from './filesystem.js';
import { loadConfiguration } from './configuration.js';

export interface LockPaths { root: string; clock?: () => Date }
export type Lease = Lock & { schema_version: 2; generation: string };
export type Failure = { ok: false; reason: 'busy' | 'held' | 'not-holder' | 'free' | 'token-held' | 'not-stale' | 'missing' | 'recipient-mismatch' | 'invalid-note' | 'destination-conflict' | 'claimed-by-other' | 'scope-held' | 'order-violation' };
export type LockState = { state: 'free' } | { state: 'held'; lock: Lock; breakable: false } | { state: 'expired'; lock: Lock; breakable: boolean } | { state: 'malformed'; breakable: boolean; dirMtime: Date };
const fail = (reason: Failure['reason']): Failure => ({ ok: false, reason });
const now = (p: LockPaths) => validDate(p.clock?.() ?? new Date());
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const lockDir = (p: LockPaths, scope: string) => join(p.root, 'locks', `${scope}.lock`);
const holderFile = (p: LockPaths, scope: string) => join(lockDir(p, scope), 'holder.json');
function identity(i: AgentIdentity) { object(i, ['agent_instance', 'agent_class'], 'identity'); identifier(i?.agent_instance, 'instance'); identifier(i?.agent_class, 'class'); }
function policy(p: LockPaths, scope: string) {
  identifier(scope, 'scope');
  if (!safePath(p.root)?.isDirectory()) throw new Error('Missing safe .trinoris root');
  const config = loadConfiguration(p);
  if (!config.scopes.registry.includes(scope)) throw new ValidationError('Unknown scope in registry');
  return config;
}
function readHolder(p: LockPaths, scope: string): Lock | null {
  const text = readText(p.root, holderFile(p, scope)); if (text === null) return null;
  try { return validateLock(JSON.parse(text), scope); } catch (error) {
    if (error instanceof SyntaxError || error instanceof ValidationError) return null;
    throw error;
  }
}
function inspectUnderGuard(p: LockPaths, scope: string, grace: number, at: Date): LockState {
  const stat = safePath(p.root, lockDir(p, scope)); if (!stat) return { state: 'free' };
  if (!stat.isDirectory()) throw new Error('Lock must be a directory');
  const lock = readHolder(p, scope);
  if (!lock) return { state: 'malformed', breakable: at.getTime() > stat.mtimeMs + grace * 60_000, dirMtime: stat.mtime };
  return isLockExpired(lock, at) ? { state: 'expired', lock, breakable: !isInGracePeriod(lock, grace, at) } : { state: 'held', lock, breakable: false };
}
export function inspect(p: LockPaths, scope: string, graceMinutes: number, at = now(p)): LockState {
  policy(p, scope); duration(graceMinutes, 'grace', 0, 60);
  return inspectUnderGuard(p, scope, graceMinutes, at);
}
function marker(p: LockPaths, path: string, operation: Record<string, unknown>): boolean {
  directory(p.root, join(path, '..')); safePath(p.root, path);
  try { fs.mkdirSync(path, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; }
  try { jsonFile(p.root, join(path, 'operation.json'), operation, true); }
  catch (e) { removeOwnedDirectory(p.root, path); throw e; }
  return true;
}
function metadata(p: LockPaths, path: string): Record<string, any> | null {
  const text = readText(p.root, join(path, 'operation.json'));
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) && typeof value.operation_id === 'string' ? value : { invalid: true };
  } catch { return { invalid: true }; }
}
function cleanMarker(p: LockPaths, path: string, id: string) {
  if (metadata(p, path)?.operation_id !== id) throw new Error('Marker generation changed; refusing cleanup');
  removeOwnedDirectory(p.root, path);
}
function mutate<T>(p: LockPaths, owner: AgentIdentity, operation: string, body: (id: string) => T): T | Failure {
  identity(owner); if (safePath(p.root, join(p.root, '.recovery'))) return fail('busy');
  const path = join(p.root, '.mutation'); const id = randomUUID();
  if (!marker(p, path, { schema_version: 2, operation_id: id, operation, owner, created_at: now(p).toISOString() })) return fail('busy');
  try { return body(id); } finally { cleanMarker(p, path, id); }
}
function heldNames(p: LockPaths): string[] {
  directory(p.root, join(p.root, 'locks'));
  return fs.readdirSync(join(p.root, 'locks')).filter(n => n.endsWith('.lock')).map(n => identifier(n.slice(0, -5), 'scope'));
}
function compatible(p: LockPaths, scope: string, owner: AgentIdentity): Failure | null {
  const registry = loadConfiguration(p).scopes.registry;
  for (const held of heldNames(p)) {
    if (!registry.includes(held)) throw new ValidationError('Retained scope outside registry; stop actors and migrate offline');
    const lock = readHolder(p, held);
    if (held === scope) continue;
    if ((held === 'git' || scope === 'git') && lock?.agent_instance !== owner.agent_instance) return fail('scope-held');
    if (lock?.agent_instance === owner.agent_instance && registry.indexOf(held) > registry.indexOf(scope)) return fail('order-violation');
  }
  return null;
}
function publishLease(p: LockPaths, scope: string, owner: AgentIdentity, minutes: number, task?: string): Lease {
  const at = now(p); const lock: Lease = { schema_version: 2, generation: randomUUID(), ...owner, scope, acquired_at: at.toISOString(), expires_at: calculateExpiration(minutes, at).toISOString(), ...(task ? { task } : {}) };
  validateLock(lock, scope);
  fs.mkdirSync(lockDir(p, scope), { mode: 0o700 });
  jsonFile(p.root, holderFile(p, scope), lock, true); return lock;
}
export function recentIncidents(p: LockPaths, scope: string): string[] {
  const cfg = policy(p, scope); const dir = join(p.root, 'incidents'); if (!safePath(p.root, dir)) return [];
  return fs.readdirSync(dir).filter(n => /^[a-f0-9-]+\.(completed|failed)\.json$/.test(n)).filter(n => {
    const r = JSON.parse(readText(p.root, join(dir, n))!);
    return (r.scope === scope || r.action === 'marker-recovery') && Date.parse(r.at) >= now(p).getTime() - cfg.incidents.check_window_hours * 3600_000;
  }).map(n => join(dir, n));
}
export function acquire(p: LockPaths, scope: string, owner: AgentIdentity, leaseMinutes: number, task?: string) {
  policy(p, scope); identity(owner); duration(leaseMinutes); if (task !== undefined) boundedText(task, 'task');
  return mutate(p, owner, 'acquire', () => {
    directory(p.root, join(p.root, 'locks'));
    if (safePath(p.root, lockDir(p, scope))) return fail('held');
    const blocked = compatible(p, scope, owner); if (blocked) return blocked;
    const incidents = recentIncidents(p, scope);
    return { ok: true as const, lock: publishLease(p, scope, owner, leaseMinutes, task), recent_incidents: incidents };
  });
}
export function isHolder(p: LockPaths, scope: string, instance: string, generation?: string, at = now(p)): boolean {
  policy(p, scope); identifier(instance, 'instance');
  if (!generation || safePath(p.root, join(p.root, '.mutation')) || safePath(p.root, join(p.root, '.recovery'))) return false;
  identifier(generation, 'generation'); const lock = readHolder(p, scope);
  return !!lock && lock.agent_instance === instance && lock.generation === generation && !isLockExpired(lock, at) && !safePath(p.root, join(p.root, '.mutation'));
}
export function renew(p: LockPaths, scope: string, instance: string, leaseMinutes: number, generation?: string) {
  policy(p, scope); identifier(instance, 'instance'); duration(leaseMinutes);
  if (!generation) return fail('not-holder'); identifier(generation, 'generation');
  return mutate(p, { agent_instance: instance, agent_class: 'operation' }, 'renew', () => {
    const lock = readHolder(p, scope);
    if (!lock || lock.agent_instance !== instance || lock.generation !== generation || isLockExpired(lock, now(p))) return fail('not-holder');
    const at = now(p);
    const renewed = { ...lock, renewed_at: at.toISOString(), expires_at: calculateExpiration(leaseMinutes, at).toISOString() } as Lease;
    validateLock(renewed, scope);
    jsonFile(p.root, holderFile(p, scope), renewed); return { ok: true as const, lock: renewed };
  });
}
export function release(p: LockPaths, scope: string, instance: string, generation?: string) {
  policy(p, scope); identifier(instance, 'instance');
  if (!generation) return fail('not-holder'); identifier(generation, 'generation');
  return mutate(p, { agent_instance: instance, agent_class: 'operation' }, 'release', () => {
    if (!safePath(p.root, lockDir(p, scope))) return fail('free');
    const lock = readHolder(p, scope);
    if (lock?.agent_instance !== instance || lock.generation !== generation) return fail('not-holder');
    removeOwnedDirectory(p.root, lockDir(p, scope)); return { ok: true as const };
  });
}
function record(p: LockPaths, id: string, stage: string, value: Record<string, unknown>) {
  const path = join(p.root, 'incidents', `${id}.${stage}.json`);
  jsonFile(p.root, path, { schema_version: 2, operation_id: id, stage, at: now(p).toISOString(), ...value }, true); return path;
}
export function breakLock(p: LockPaths, scope: string, owner: AgentIdentity, leaseMinutes: number, graceMinutes: number, reason: string) {
  policy(p, scope); identity(owner); duration(leaseMinutes); duration(graceMinutes, 'grace', 0, 60); boundedText(reason, 'reason');
  return mutate(p, owner, 'break', id => {
    const token = join(p.root, 'locks', `${scope}.breaking`);
    if (!marker(p, token, { operation_id: id, owner, created_at: now(p).toISOString() })) return fail('token-held');
    let committed = false; let attempted = false;
    try {
      const state = inspectUnderGuard(p, scope, graceMinutes, now(p));
      if (state.state === 'free' || state.state === 'held' || !state.breakable) return fail('not-stale');
      const blocked = compatible(p, scope, owner); if (blocked) return blocked;
      const evicted = state.state === 'expired' ? state.lock : null;
      record(p, id, 'attempted', { scope, actor: owner, previous: evicted, reason }); attempted = true;
      const archived = join(p.root, 'incidents', `${id}.stale`);
      safePath(p.root, archived); fs.renameSync(lockDir(p, scope), archived);
      const lock = publishLease(p, scope, owner, leaseMinutes, `takeover: ${reason}`.slice(0, 2048)); committed = true;
      const incident = record(p, id, 'completed', { scope, actor: owner, previous: evicted, next: lock, reason, state_committed: true });
      return { ok: true as const, lock, evicted, incident };
    } catch (error) {
      if (attempted) {
        try { record(p, id, 'failed', { scope, actor: owner, reason, state_committed: committed, error: 'Takeover interrupted; inspect preserved state before retrying' }); } catch { /* Attempt record survives; never report completion. */ }
      }
      throw Object.assign(error as Error, { operation_id: id, state_committed: committed });
    } finally { cleanMarker(p, token, id); }
  });
}
export function claim(p: LockPaths, noteFilename: string, fromDir: string, toDir: string, owner?: AgentIdentity) {
  identifier(noteFilename, 'note filename', 160); if (!noteFilename.endsWith('.md')) throw new ValidationError('Expected Markdown handoff filename');
  if (!owner) throw new ValidationError('Claim requires identity; migrate to protocol 3'); identity(owner);
  if (!/^handoff\/for-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fromDir)) throw new ValidationError('Invalid logical inbox');
  identifier(fromDir.slice('handoff/for-'.length), 'inbox class');
  const destDir = `active/${owner.agent_instance}`;
  if (toDir !== destDir) throw new ValidationError('Destination must be active/<claimant-instance>');
  const config = loadConfiguration(p); const source = join(p.root, fromDir, noteFilename); const dest = join(p.root, destDir, noteFilename);
  const id = digest(`${fromDir}/${noteFilename}`); const receipt = join(p.root, destDir, `${id}.receipt.json`);
  return mutate(p, owner, 'claim', operationId => {
    const token = join(p.root, 'claims', `${id}.claim`);
    if (!marker(p, token, { operation_id: operationId, owner, created_at: now(p).toISOString() })) return fail('claimed-by-other');
    try {
      const content = readText(p.root, source, 262144);
      const receiptText = readText(p.root, receipt);
      if (content === null) {
        if (receiptText !== null) {
          const prior = JSON.parse(receiptText); const saved = readText(p.root, dest, 262144);
          if (saved !== null && prior.claimed_by === owner.agent_instance && prior.claimed_class === owner.agent_class && prior.digest === digest(saved) && prior.source === `${fromDir}/${noteFilename}`) return { ok: true as const, path: dest, digest: prior.digest as string, alreadyClaimed: true };
        }
        return fail('missing');
      }
      const note = parseHandoff(content); if (!note || note.metadata.status !== 'ready') return fail('invalid-note');
      const m = note.metadata;
      if ((m.to_class !== 'any' && m.to_class !== owner.agent_class) || (m.to_instance !== 'any' && m.to_instance !== owner.agent_instance) || (fromDir !== `handoff/for-${owner.agent_class}` && fromDir !== 'handoff/for-any')) return fail('recipient-mismatch');
      const scopes = m.scopes.split(',').map(v => v.trim());
      if (scopes.some(s => !config.scopes.registry.includes(s))) return fail('invalid-note');
      if (scopes.some(s => safePath(p.root, lockDir(p, s)))) return fail('scope-held');
      if (safePath(p.root, dest)) return fail('destination-conflict');
      directory(p.root, join(p.root, destDir));
      const hash = digest(content);
      const prior = receiptText === null ? null : JSON.parse(receiptText);
      if (prior && (prior.claimed_by !== owner.agent_instance || prior.claimed_class !== owner.agent_class || prior.digest !== hash || prior.source !== `${fromDir}/${noteFilename}`)) return fail('destination-conflict');
      // All cooperating publishers hold .mutation through destination reservation/move.
      if (!prior) jsonFile(p.root, receipt, { schema_version: 2, source: `${fromDir}/${noteFilename}`, digest: hash, claimed_by: owner.agent_instance, claimed_class: owner.agent_class, operation_id: operationId }, true);
      fs.renameSync(source, dest);
      return { ok: true as const, path: dest, digest: hash, alreadyClaimed: false };
    } finally { cleanMarker(p, token, operationId); }
  });
}

export type HandoffLocation = 'inbox' | 'universal' | 'active';
export type HandoffDraftResult = Failure | { ok: true; path: string; digest: string; note: Handoff };
export interface HandoffListEntry {
  filename: string;
  location: HandoffLocation;
  path: string;
  valid: boolean;
  title?: string;
  status?: string;
  scopes?: string[];
}

function handoffFilename(filename: string) {
  identifier(filename, 'handoff filename', 160);
  if (!filename.endsWith('.md')) throw new ValidationError('Expected Markdown handoff filename');
}
function draftPath(p: LockPaths, filename: string) { return join(p.root, 'handoff', 'drafts', filename); }
function inboxPath(p: LockPaths, filename: string, agentClass: string) { return join(p.root, 'handoff', `for-${agentClass}`, filename); }
function activePath(p: LockPaths, filename: string, instance: string) { return join(p.root, 'active', instance, filename); }
function validateHandoff(content: string, p: LockPaths): Handoff | null {
  const note = parseHandoff(content);
  if (!note || note.format_version !== 3) return null;
  const registry = loadConfiguration(p).scopes.registry;
  if (note.metadata.scopes.split(',').some(scope => !registry.includes(scope))) return null;
  return note;
}
function anyUnknownOrOwnedLock(p: LockPaths, owner: AgentIdentity): boolean {
  const registry = loadConfiguration(p).scopes.registry;
  for (const scope of heldNames(p)) {
    if (!registry.includes(scope)) return true;
    const lock = readHolder(p, scope);
    if (!lock || lock.agent_instance === owner.agent_instance) return true;
  }
  return false;
}
function parseReceipt(text: string | null): Record<string, any> | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { invalid: true };
  } catch { return { invalid: true }; }
}

/** Validate a user-authored draft inside `.trinoris/handoff/drafts/` without mutating it. */
export function validateHandoffDraft(p: LockPaths, filename: string): HandoffDraftResult {
  try { handoffFilename(filename); } catch { return fail('invalid-note'); }
  if (!safePath(p.root)?.isDirectory()) throw new Error('Missing safe .trinoris root');
  const path = draftPath(p, filename); const content = readText(p.root, path, 262144);
  if (content === null) return fail('missing');
  const note = validateHandoff(content, p); if (!note || note.metadata.status === 'completed') return fail('invalid-note');
  return { ok: true, path, digest: digest(content), note };
}

/** Publish a validated draft to its declared recipient inbox under the shared mutation guard. */
export function publishHandoff(p: LockPaths, filename: string, owner: AgentIdentity) {
  handoffFilename(filename); identity(owner);
  if (!safePath(p.root)?.isDirectory()) throw new Error('Missing safe .trinoris root');
  const source = draftPath(p, filename); const receiptId = digest(`publish:${source}:${owner.agent_instance}`);
  const receiptPath = join(p.root, 'published', `${receiptId}.json`);
  return mutate(p, owner, 'handoff-publish', operationId => {
    const content = readText(p.root, source, 262144); const prior = parseReceipt(readText(p.root, receiptPath));
    if (content === null) {
      if (!prior || prior.invalid || prior.source !== 'handoff/drafts/' + filename || prior.published_by !== owner.agent_instance) return fail('missing');
      const saved = readText(p.root, join(p.root, prior.destination), 262144);
      if (saved === null || digest(saved) !== prior.digest) return fail('destination-conflict');
      return { ok: true as const, path: join(p.root, prior.destination), digest: prior.digest as string, alreadyPublished: true };
    }
    const note = validateHandoff(content, p);
    if (!note || note.metadata.status === 'completed') return fail('invalid-note');
    if (note.metadata.from_class !== owner.agent_class || note.metadata.from_instance !== owner.agent_instance) return fail('recipient-mismatch');
    if (anyUnknownOrOwnedLock(p, owner)) return fail('scope-held');
    const inbox = note.metadata.to_class === 'any' ? 'for-any' : `for-${note.metadata.to_class}`;
    const destination = `handoff/${inbox}/${filename}`; const dest = join(p.root, destination);
    if (prior && (prior.invalid || prior.source !== `handoff/drafts/${filename}` || prior.destination !== destination || prior.published_by !== owner.agent_instance || prior.digest !== digest(content))) return fail('destination-conflict');
    if (safePath(p.root, dest)) {
      if (!prior) return fail('destination-conflict');
      const saved = readText(p.root, dest, 262144);
      if (saved === null || digest(saved) !== digest(content)) return fail('destination-conflict');
      fs.unlinkSync(source);
      return { ok: true as const, path: dest, digest: digest(content), alreadyPublished: true };
    }
    directory(p.root, join(p.root, 'published'));
    if (!prior) jsonFile(p.root, receiptPath, { schema_version: 1, operation_id: operationId, source: `handoff/drafts/${filename}`, destination, digest: digest(content), published_by: owner.agent_instance, published_class: owner.agent_class }, true);
    directory(p.root, join(p.root, 'handoff', inbox));
    fs.renameSync(source, dest);
    return { ok: true as const, path: dest, digest: digest(content), alreadyPublished: false };
  });
}

/** List the caller's inboxes and, when created, their own active notes. */
export function listHandoffs(p: LockPaths, owner: AgentIdentity): HandoffListEntry[] {
  identity(owner); if (!safePath(p.root)?.isDirectory()) throw new Error('Missing safe .trinoris root');
  const locations: Array<[HandoffLocation, string]> = [
    ['inbox', `handoff/for-${owner.agent_class}`], ['universal', 'handoff/for-any'], ['active', `active/${owner.agent_instance}`],
  ];
  const result: HandoffListEntry[] = [];
  for (const [location, relativeDir] of locations) {
    const path = join(p.root, relativeDir); const stat = safePath(p.root, path);
    if (!stat) continue;
    if (!stat.isDirectory()) throw new Error('Handoff location must be a directory');
    const names = fs.readdirSync(path).filter(name => name.endsWith('.md')).sort();
    if (result.length + names.length > 500) throw new Error('Handoff listing exceeds the 500-note limit');
    for (const filename of names) {
      try { handoffFilename(filename); } catch { continue; }
      const file = join(path, filename); const content = readText(p.root, file, 262144); if (content === null) continue;
      const note = validateHandoff(content, p);
      result.push({ filename, location, path: file, valid: !!note, ...(note ? { title: note.title, status: note.status ?? note.metadata.status, scopes: note.metadata.scopes.split(',') } : {}) });
    }
  }
  return result;
}

/** Read one note only from the caller's inbox, universal inbox, or own active directory. */
export function readHandoff(p: LockPaths, filename: string, owner: AgentIdentity, location: HandoffLocation = 'inbox') {
  handoffFilename(filename); identity(owner);
  let path: string;
  if (location === 'inbox') path = inboxPath(p, filename, owner.agent_class);
  else if (location === 'universal') path = inboxPath(p, filename, 'any');
  else if (location === 'active') path = activePath(p, filename, owner.agent_instance);
  else throw new ValidationError('Invalid handoff location');
  const content = readText(p.root, path, 262144); if (content === null) return fail('missing');
  const note = validateHandoff(content, p); if (!note) return fail('invalid-note');
  return { ok: true as const, path, content, digest: digest(content), note };
}

function completedContent(content: string, outcome: string): string {
  const statusLine = /^Status: (?:in-progress|blocked|ready-for-review)$/m;
  if (!statusLine.test(content)) throw new ValidationError('Handoff status cannot be completed');
  const withStatus = content.replace(statusLine, 'Status: complete');
  const start = withStatus.indexOf('\n## Changes\n'); if (start < 0) throw new ValidationError('Handoff is missing its Changes section');
  const end = withStatus.indexOf('\n## ', start + 1); if (end < 0) throw new ValidationError('Handoff section structure is invalid');
  return `${withStatus.slice(0, end)}\n- Completion outcome: ${outcome}${withStatus.slice(end)}`;
}

/** Complete an active protocol 3 note, archive it, and idempotently update the archive index. */
export function completeHandoff(p: LockPaths, filename: string, owner: AgentIdentity, outcome: string) {
  handoffFilename(filename); identity(owner); boundedText(outcome, 'handoff outcome');
  if (!safePath(p.root)?.isDirectory()) throw new Error('Missing safe .trinoris root');
  const sourceRelative = `active/${owner.agent_instance}/${filename}`; const source = join(p.root, sourceRelative);
  const archiveRelative = `archive/${filename}`; const archived = join(p.root, archiveRelative);
  const receiptId = digest(`complete:${sourceRelative}`); const receiptPath = join(p.root, 'archive', `.${receiptId}.receipt.json`);
  return mutate(p, owner, 'handoff-complete', operationId => {
    const content = readText(p.root, source, 262144); const prior = parseReceipt(readText(p.root, receiptPath));
    if (prior && (prior.invalid || prior.source !== sourceRelative || prior.archived !== archiveRelative || prior.completed_by !== owner.agent_instance)) return fail('destination-conflict');
    if (content === null) {
      if (!prior) return fail('missing');
      const saved = readText(p.root, archived, 262144);
      if (saved === null || digest(saved) !== prior.completed_digest) return fail('destination-conflict');
      ensureArchiveIndex(p, receiptId, prior);
      return { ok: true as const, path: archived, digest: prior.completed_digest as string, alreadyCompleted: true };
    }
    const note = validateHandoff(content, p); if (!note || note.status === 'complete') return fail('invalid-note');
    if (anyUnknownOrOwnedLock(p, owner)) return fail('scope-held');
    const updated = completedContent(content, outcome);
    if (!validateHandoff(updated, p) || parseHandoff(updated)?.status !== 'complete') return fail('invalid-note');
    const originalDigest = digest(content); const completedDigest = digest(updated);
    if (prior && (prior.original_digest !== originalDigest || prior.completed_digest !== completedDigest || prior.outcome !== outcome)) return fail('destination-conflict');
    if (!prior) jsonFile(p.root, receiptPath, {
      schema_version: 1, operation_id: operationId, source: sourceRelative, archived: archiveRelative,
      original_digest: originalDigest, completed_digest: completedDigest, completed_by: owner.agent_instance,
      completed_class: owner.agent_class, from_class: note.metadata.from_class,
      from_instance: note.metadata.from_instance, to_class: note.metadata.to_class,
      scopes: note.metadata.scopes, outcome, completed_at: now(p).toISOString(),
    }, true);
    const saved = readText(p.root, archived, 262144);
    if (saved === null) writeAtomic(p.root, archived, updated, true);
    else if (digest(saved) !== completedDigest) return fail('destination-conflict');
    const current = readText(p.root, source, 262144);
    if (current !== null) {
      if (digest(current) !== originalDigest) throw new Error('Active handoff changed during completion; inspect archive receipt');
      fs.unlinkSync(source);
    }
    const receipt = prior ?? { source: sourceRelative, completed_at: now(p).toISOString(), outcome, from_class: note.metadata.from_class, from_instance: note.metadata.from_instance, to_class: note.metadata.to_class, completed_class: owner.agent_class, scopes: note.metadata.scopes };
    ensureArchiveIndex(p, receiptId, receipt);
    return { ok: true as const, path: archived, digest: completedDigest, alreadyCompleted: false };
  });
}
function ensureArchiveIndex(p: LockPaths, receiptId: string, receipt: Record<string, any>) {
  const path = join(p.root, 'archive', 'INDEX.md'); const current = readText(p.root, path, 1_048_576);
  if (current === null) throw new Error('Missing safe archive index');
  const markerText = `<!-- receipt:${receiptId} -->`;
  if (current.includes(markerText)) return;
  const cell = (value: unknown) => String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
  const from = `${receipt.from_class ?? 'unknown'}/${receipt.from_instance ?? 'unknown'}`;
  const to = `${receipt.to_class ?? 'unknown'}/${receipt.completed_class ?? 'unknown'}`;
  const line = `| ${cell(receipt.completed_at)} | ${cell(receipt.source?.split('/').at(-1))} | ${cell(from)} | ${cell(to)} | ${cell(receipt.outcome)} | ${markerText}`;
  writeAtomic(p.root, path, `${current}${current.endsWith('\n') ? '' : '\n'}${line}\n`);
}
export function acquireMany(p: LockPaths, scopes: string[], owner: AgentIdentity, minutes: number) {
  if (!scopes.length || scopes.length > 64 || new Set(scopes).size !== scopes.length) throw new ValidationError('Invalid scope batch');
  const cfg = policy(p, scopes[0]); scopes.forEach(s => policy(p, s)); duration(minutes); identity(owner);
  const ordered = [...scopes].sort((a, b) => cfg.scopes.registry.indexOf(a) - cfg.scopes.registry.indexOf(b));
  return mutate(p, owner, 'acquire-many', () => {
    const locks: Lease[] = [];
    try {
      for (const scope of ordered) {
        const blocked = compatible(p, scope, owner);
        if (blocked || safePath(p.root, lockDir(p, scope))) {
          for (const held of locks) removeOwnedDirectory(p.root, lockDir(p, held.scope));
          return blocked ?? fail('held');
        }
        locks.push(publishLease(p, scope, owner, minutes));
      }
      return { ok: true as const, locks };
    } catch (e) { for (const held of locks) removeOwnedDirectory(p.root, lockDir(p, held.scope)); throw e; }
  });
}
export function diagnose(p: LockPaths) {
  const locations = ['.mutation', '.recovery'];
  for (const dir of ['locks', 'claims']) if (safePath(p.root, join(p.root, dir))) {
    for (const n of fs.readdirSync(join(p.root, dir))) if (n.endsWith('.breaking') || n.endsWith('.claim')) locations.push(`${dir}/${identifier(n, 'marker', 160)}`);
  }
  return locations.filter(n => safePath(p.root, join(p.root, n))).map(marker => ({ marker, metadata: metadata(p, join(p.root, marker)) }));
}
export function recoverMarker(p: LockPaths, target: string, expectedId: string | null, owner: AgentIdentity, reason: string, confirmedStopped = false) {
  identity(owner); boundedText(reason, 'recovery reason');
  if (!confirmedStopped) throw new ValidationError('Recovery requires confirmation that all affected actors are stopped');
  if (!/^(?:\.mutation|locks\/[A-Za-z0-9][A-Za-z0-9._-]*\.breaking|claims\/[a-f0-9]{64}\.claim)$/.test(target)) throw new ValidationError('Invalid recovery marker');
  if (expectedId !== null) identifier(expectedId, 'operation ID');
  const guard = join(p.root, '.recovery'); const id = randomUUID();
  if (!marker(p, guard, { operation_id: id, owner, created_at: now(p).toISOString() })) return fail('busy');
  try {
    const path = join(p.root, target); if (!safePath(p.root, path)) return fail('missing');
    if ((metadata(p, path)?.operation_id ?? null) !== expectedId) return fail('not-holder');
    record(p, id, 'attempted', { action: 'marker-recovery', marker: target, expected_id: expectedId, actor: owner, reason });
    removeOwnedDirectory(p.root, path);
    record(p, id, 'completed', { action: 'marker-recovery', marker: target, expected_id: expectedId, actor: owner, reason });
    return { ok: true as const };
  } finally { cleanMarker(p, guard, id); }
}
