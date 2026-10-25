/**
 * © 2026 TRINORIS. All rights reserved.
 * Proprietary and confidential.
 *
 * `setup` — scaffold coordination/ in a working tree and bind each agent tool to the
 * protocol.
 *
 * Generated instruction files are deliberately THIN POINTERS. Spec 04 requires one
 * source of truth: duplicating the rules per tool guarantees they drift, and a drifted
 * protocol is worse than none because each agent follows its own copy while believing it
 * is coordinating. So these files say the protocol exists, where it is, and the two or
 * three rules that apply before anything else has been read.
 */

import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SCOPE_REGISTRY, DEFAULT_AGENT_CLASSES, formatTimestamp } from '@trinoris/agent-core';

const SUBDIRS = ['locks', 'claims', 'handoff', 'active', 'archive', 'incidents', 'heartbeat'];

export interface SetupOptions {
  workDir: string;
  agentClasses?: string[];
  scopes?: string[];
  force?: boolean;
  leaseMinutes?: number;
  graceMinutes?: number;
}

export interface SetupResult {
  created: string[];
  skipped: string[];
}

const w = (path: string, body: string, force: boolean, r: SetupResult) => {
  if (existsSync(path) && !force) { r.skipped.push(path); return; }
  writeFileSync(path, body, 'utf8');
  r.created.push(path);
};

export function setup(opts: SetupOptions): SetupResult {
  const {
    workDir, force = false,
    agentClasses = [...DEFAULT_AGENT_CLASSES],
    scopes = [...DEFAULT_SCOPE_REGISTRY],
    leaseMinutes = 15, graceMinutes = 5,
  } = opts;
  const r: SetupResult = { created: [], skipped: [] };
  const coord = join(workDir, 'coordination');

  mkdirSync(coord, { recursive: true });
  for (const d of SUBDIRS) mkdirSync(join(coord, d), { recursive: true });
  for (const c of agentClasses) mkdirSync(join(coord, 'handoff', `for-${c}`), { recursive: true });
  r.created.push(`${coord}/ (+${SUBDIRS.length} subdirs, ${agentClasses.length} handoff inboxes)`);

  w(join(coord, 'archive', 'INDEX.md'), [
    '# Handoff archive', '',
    'Completed handoffs, newest last. This is the record of who did what and why —',
    'keep it honest rather than tidy.', '',
    '| Completed | Note | From | To | Outcome |',
    '| --- | --- | --- | --- | --- |', '',
  ].join('\n'), force, r);

  w(join(workDir, '.kiro', 'coordination.json'), JSON.stringify({
    version: '0.1.0',
    protocol_version: '1',
    created_at: formatTimestamp(),
    scopes: {
      registry: scopes,
      lease_duration_minutes: leaseMinutes,
      renewal_threshold_minutes: Math.max(1, Math.floor(leaseMinutes / 3)),
      grace_period_minutes: graceMinutes,
    },
    agent_classes: agentClasses,
    heartbeat: { enabled: true, interval_seconds: 60 },
    incidents: { check_window_hours: 24 },
  }, null, 2) + '\n', force, (mkdirSync(join(workDir, '.kiro'), { recursive: true }), r));

  const rules = [
    '- No lock, no write. Reading is free.',
    '- Acquire with `trinoris-agent acquire --scope <scope>`. **Exit 3 means contended:**',
    '  do not wait, do not retry in a loop. Pick other work or write a handoff.',
    '- Re-confirm ownership with `trinoris-agent check --scope <scope>` immediately before',
    '  each batch of writes. **Exit 4 means the lease was lost — stop writing.**',
    '- Never switch branches, rebase, reset or commit while a peer holds any lock.',
    '- Release before writing a handoff and before stopping.',
    '- A stale lock is taken over with `break --reason ...`, never by deleting it by hand.',
  ].join('\n');

  w(join(workDir, 'AGENTS.md'), [
    '# Agent instructions', '',
    'Other agents may share this working tree.', '',
    '**Read `PROTOCOL.md` before editing anything.** It is the contract; this file is a',
    'pointer to it.', '', '## Non-negotiable', '', rules, '',
    '## Handoffs', '',
    'Notes addressed to you are in `coordination/handoff/for-<your-class>/`. Claim one with',
    '`trinoris-agent claim --note <file>` — never by `mv` alone, which is not atomic.', '',
  ].join('\n'), force, r);

  mkdirSync(join(workDir, '.claude', 'skills', 'agent-handoff'), { recursive: true });
  w(join(workDir, '.claude', 'skills', 'agent-handoff', 'SKILL.md'), [
    '---', 'name: agent-handoff',
    'description: Coordinate with other agents sharing this working tree — acquire and',
    '  release scope locks, claim and write handoff notes, take over stale locks. Use',
    '  before editing any file when another agent may be active, and before any branch or',
    '  commit operation.', '---', '',
    'Read `PROTOCOL.md` before acting. It is the contract; this file is a pointer.', '',
    '## Before your first write', '', rules, '',
  ].join('\n'), force, r);

  const protocolSrc = join(workDir, 'specs', '01-coordination-protocol.md');
  const protocolDst = join(workDir, 'PROTOCOL.md');
  if (existsSync(protocolSrc) && (!existsSync(protocolDst) || force)) {
    copyFileSync(protocolSrc, protocolDst);
    r.created.push(protocolDst);
  } else if (!existsSync(protocolSrc) && !existsSync(protocolDst)) {
    w(protocolDst, [
      '# Coordination protocol', '',
      '**This is a placeholder.** The real contract lives in the `trinoris-multi-agents`',
      'repository as `specs/01-coordination-protocol.md`. Copy it here before relying on',
      'the protocol in this tree — the rules below are a summary, not the contract.', '',
      rules, '',
    ].join('\n'), force, r);
  }

  return r;
}
