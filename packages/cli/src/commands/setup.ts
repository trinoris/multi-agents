/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PROTOCOL_TEXT, PROTOCOL_VERSION, defaultConfig, validateConfig } from '@trinoris/agent-core';
import { directory, jsonFile, readText, removeOwnedDirectory, safePath, writeAtomic } from '@trinoris/agent-sdk';

export interface SetupOptions { workDir: string; agentClasses?: string[]; scopes?: string[]; force?: boolean; leaseMinutes?: number; graceMinutes?: number }
export interface SetupResult { created: string[]; skipped: string[]; replaced: string[]; updated: string[] }
export const protocolDigest = () => createHash('sha256').update(PROTOCOL_TEXT).digest('hex');

export function setup(opts: SetupOptions): SetupResult {
  const root = resolve(opts.workDir); const coord = join(root, '.trinoris');
  if (safePath(root, join(root, 'coordination'))) throw new Error('Top-level coordination directory exists; stop all agents, archive it offline, then rerun setup for protocol 3');
  const config = defaultConfig();
  if (opts.agentClasses) config.agent_classes = opts.agentClasses;
  if (opts.scopes) config.scopes.registry = opts.scopes;
  if (opts.leaseMinutes !== undefined) { config.scopes.lease_duration_minutes = opts.leaseMinutes; config.scopes.renewal_threshold_minutes = opts.leaseMinutes / 3; }
  if (opts.graceMinutes !== undefined) config.scopes.grace_period_minutes = opts.graceMinutes;
  validateConfig(config);
  const rules = [
    'Read .trinoris/PROTOCOL.md before editing. This is a cooperative local protocol, not a sandbox.',
    'Keep all coordination state in .trinoris/; do not create a parallel coordination/ directory.',
    'Use a stable --instance and keep the generation returned by acquire.',
    'Pass --generation to check/renew/release. An expired lease never authorizes edits.',
    'Check immediately before writes; exit 4 means stop. Exit 3 means contention; never spin.',
    'Acquire scopes in registry order and use the git scope for Git mutations.',
    'Claim only notes addressed to you from .trinoris/handoff/for-<class>/; active notes live in .trinoris/active/<instance>/.',
    'Write protocol 3 handoffs with locks_released: true and every required section in .trinoris/PROTOCOL.md.',
    'Markers are not stolen by age. Diagnose, stop affected actors, then explicitly recover.',
    'Heartbeat/daemon support is disabled in protocol 3.',
  ].map(v => `- ${v}`).join('\n');
  const files = new Map<string, string>([
    ['.trinoris/PROTOCOL.md', PROTOCOL_TEXT],
    ['.trinoris/protocol.json', JSON.stringify({ version: PROTOCOL_VERSION, sha256: protocolDigest() }, null, 2) + '\n'],
    ['.trinoris/config.json', JSON.stringify(config, null, 2) + '\n'],
    ['AGENTS.md', `# Agent instructions\n\n${rules}\n`],
    ['.claude/skills/agent-handoff/SKILL.md', `---\nname: agent-handoff\ndescription: Coordinate cooperating agents in a shared local working tree.\n---\n\n${rules}\n`],
    ['.trinoris/archive/INDEX.md', '# Handoff archive\n\n| Completed | Note | From | To | Outcome |\n| --- | --- | --- | --- | --- |\n'],
  ]);
  const dirs = ['locks', 'claims', 'handoff', 'handoff/drafts', 'published', 'active', 'archive', 'incidents', 'heartbeat', ...[...new Set([...config.agent_classes, 'any'])].map(c => `handoff/for-${c}`)];
  // Preflight every path before any generated file is written, including skipped files.
  for (const name of dirs) { const st = safePath(root, join(coord, name)); if (st && !st.isDirectory()) throw new Error('Expected setup directory'); }
  const gitignore = join(root, '.gitignore');
  const gitignoreStat = safePath(root, gitignore);
  if (gitignoreStat && (!gitignoreStat.isFile() || gitignoreStat.nlink !== 1)) throw new Error('Refusing unsafe .gitignore');
  const gitignoreText = gitignoreStat ? readText(root, gitignore, 1024 * 1024) : '';
  if (gitignoreText === null) throw new Error('Could not read .gitignore');
  const ignoreRulePresent = gitignoreText.split(/\r?\n/).some(line => line.trim() === '/.trinoris/');
  for (const name of files.keys()) {
    const st = safePath(root, join(root, name)); if (st && (!st.isFile() || st.nlink !== 1)) throw new Error('Refusing unsafe setup destination');
  }
  directory(root, coord);
  if (safePath(root, join(coord, '.recovery'))) throw new Error('Recovery in progress');
  const guard = join(coord, '.mutation'); safePath(root, guard);
  try { fs.mkdirSync(guard, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Coordination busy; do not run setup while actors are active'); throw e; }
  const operationId = randomUUID();
  const result: SetupResult = { created: [], skipped: [], replaced: [], updated: [] };
  try {
    jsonFile(root, join(guard, 'operation.json'), { operation_id: operationId, operation: 'setup', created_at: new Date().toISOString() }, true);
    const locks = join(coord, 'locks');
    if (safePath(root, locks) && fs.readdirSync(locks).some(n => n.endsWith('.lock') || n.endsWith('.breaking'))) throw new Error('Stop actors and resolve retained locks before setup');
    for (const d of dirs) directory(root, join(coord, d));
    for (const [name, content] of files) {
      const target = join(root, name); const exists = safePath(root, target);
      if (exists && !opts.force) { result.skipped.push(target); continue; }
      writeAtomic(root, target, content, !exists);
      (exists ? result.replaced : result.created).push(target);
    }
    if (!ignoreRulePresent) {
      const next = `${gitignoreText}${gitignoreText && !gitignoreText.endsWith('\n') ? '\n' : ''}\n# Trinoris local coordination state\n/.trinoris/\n`;
      writeAtomic(root, gitignore, next, !gitignoreStat, gitignoreStat ? gitignoreStat.mode & 0o777 : 0o644);
      result.updated.push(gitignore);
    }
    return result;
  } finally {
    const meta = readText(root, join(guard, 'operation.json'));
    if (meta && JSON.parse(meta).operation_id === operationId) removeOwnedDirectory(root, guard);
  }
}
