import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquire, acquireMany, breakLock, claim, diagnose, inspect, isHolder, recoverMarker, release, renew } from './lock.js';
import { readText } from './filesystem.js';
import { defaultConfig } from '@trinoris/agent-core';

const roots: string[] = [];
const a = { agent_class: 'codex', agent_instance: 'codex-a' }, b = { agent_class: 'claude', agent_instance: 'claude-b' };
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'agent-policy-')); roots.push(root);
  for (const d of ['locks', 'claims', 'incidents', 'handoff/for-codex', 'active']) fs.mkdirSync(join(root, d), { recursive: true });
  return { root };
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('SG-03 scope and Git policy', () => {
  it('acquires batches in order and rolls back partial contention', () => {
    const p = fixture(); const other = acquire(p, 'tests', b, 15); expect(other.ok).toBe(true);
    expect(acquireMany(p, ['tests', 'api'], a, 15).ok).toBe(false);
    expect(inspect(p, 'api', 5).state).toBe('free');
    if (!other.ok) return; release(p, 'tests', b.agent_instance, other.lock.generation);
    const batch = acquireMany(p, ['tests', 'api'], a, 15); expect(batch.ok).toBe(true);
    if (batch.ok) expect(batch.locks.map(l => l.scope)).toEqual(['api', 'tests']);
  });
  it('blocks peer Git/edit acquisitions in both directions under one guard', () => {
    const p = fixture(); const held = acquire(p, 'api', a, 15); if (!held.ok) throw new Error('fixture');
    expect(acquire(p, 'git', b, 15)).toMatchObject({ ok: false, reason: 'scope-held' });
    release(p, 'api', a.agent_instance, held.lock.generation);
    expect(acquire(p, 'git', b, 15).ok).toBe(true);
    expect(acquire(p, 'api', a, 15)).toMatchObject({ ok: false, reason: 'scope-held' });
  });
  it('rejects out-of-order acquisition and enabled unsupported heartbeats', () => {
    const p = fixture(); expect(acquire(p, 'tests', a, 15).ok).toBe(true);
    expect(acquire(p, 'api', a, 15)).toMatchObject({ ok: false, reason: 'order-violation' });
    const config = defaultConfig(); config.heartbeat.enabled = true;
    fs.writeFileSync(join(p.root, 'config.json'), JSON.stringify(config));
    expect(() => acquire(p, 'api', a, 15)).toThrow(/unsupported/i);
  });
  it('blocks takeover while an acquirer is paused before holder publication', () => {
    const p = fixture(); const original = fs.mkdirSync; let tried = false;
    vi.spyOn(fs, 'mkdirSync').mockImplementation(((path: any, ...args: any[]) => {
      const result = (original as any)(path, ...args);
      if (String(path).endsWith('api.lock')) { tried = true; expect(breakLock(p, 'api', b, 15, 0, 'paused acquisition').ok).toBe(false); }
      return result;
    }) as any);
    expect(acquire(p, 'api', a, 15).ok).toBe(true); expect(tried).toBe(true);
  });
});

describe('SG-04 bounded safe files', () => {
  it('rejects linked, oversized, and nonregular state without reading it', () => {
    const p = fixture(); fs.writeFileSync(join(p.root, 'large'), 'x'.repeat(65537));
    expect(() => readText(p.root, join(p.root, 'large'))).toThrow();
    expect(() => readText(p.root, join(p.root, 'locks'))).toThrow();
    fs.writeFileSync(join(p.root, 'original'), 'keep'); fs.linkSync(join(p.root, 'original'), join(p.root, 'alias'));
    expect(() => readText(p.root, join(p.root, 'alias'))).toThrow();
  });
});

describe('SG-06 recovery and truthful incidents', () => {
  it('never steals an abandoned marker by age; recovers only its exact ID with confirmation', () => {
    const p = fixture(); const dir = join(p.root, '.mutation'); fs.mkdirSync(dir);
    fs.writeFileSync(join(dir, 'operation.json'), JSON.stringify({ operation_id: 'stopped-owner', created_at: '2020-01-01T00:00:00.000Z' }));
    expect(acquire(p, 'api', a, 15)).toMatchObject({ ok: false, reason: 'busy' });
    expect(diagnose(p)[0].metadata?.operation_id).toBe('stopped-owner');
    expect(() => recoverMarker(p, '.mutation', 'stopped-owner', a, 'operator checked actors')).toThrow();
    expect(recoverMarker(p, '.mutation', 'another-owner', a, 'operator checked actors', true).ok).toBe(false);
    expect(recoverMarker(p, '.mutation', 'stopped-owner', a, 'operator checked actors', true).ok).toBe(true);
    expect(acquire(p, 'api', a, 15).ok).toBe(true);
  });
  it('keeps incomplete markers diagnosable and explicitly recoverable', () => {
    const p = fixture(); const dir = join(p.root, '.mutation'); fs.mkdirSync(dir);
    fs.writeFileSync(join(dir, 'operation.json'), '{interrupted');
    expect(diagnose(p)[0].metadata).toMatchObject({ invalid: true });
    expect(recoverMarker(p, '.mutation', null, a, 'all actors stopped; incomplete marker', true).ok).toBe(true);
  });
  it('records failed instead of completed if takeover publication is interrupted', () => {
    const p = fixture(); const first = acquire(p, 'api', a, 15); if (!first.ok) throw new Error('fixture');
    fs.writeFileSync(join(p.root, 'locks/api.lock/holder.json'), JSON.stringify({ ...first.lock, acquired_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:15:00.000Z' }));
    const original = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (String(target).endsWith('/api.lock/holder.json')) throw new Error('injected disk failure');
      return original(source, target);
    });
    expect(() => breakLock(p, 'api', b, 15, 0, 'stopped owner')).toThrow();
    const events = fs.readdirSync(join(p.root, 'incidents'));
    expect(events.some(n => n.endsWith('.attempted.json'))).toBe(true);
    expect(events.some(n => n.endsWith('.failed.json'))).toBe(true);
    expect(events.some(n => n.endsWith('.completed.json'))).toBe(false);
  });
  it('publishes a readable active lease even for the maximum accepted reason length', () => {
    const p = fixture(); const first = acquire(p, 'api', a, 15); if (!first.ok) throw new Error('fixture');
    fs.writeFileSync(join(p.root, 'locks/api.lock/holder.json'), JSON.stringify({ ...first.lock, acquired_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:15:00.000Z' }));
    const result = breakLock(p, 'api', b, 15, 0, 'r'.repeat(2048));
    expect(result.ok).toBe(true); if (result.ok) expect(isHolder(p, 'api', b.agent_instance, result.lock.generation)).toBe(true);
  });
});

describe('SG-05 interrupted handoff publication', () => {
  const protocol3Handoff = (status = 'in-progress') => `---
from_instance: claude-b
from_class: claude
to_class: codex
to_instance: any
scopes: [api]
locks_released: true
---

# Context Handoff

Updated: 2026-10-25 14:02 UTC
Task: Continue API validation
Status: ${status}
Branch: main
Base commit: abc1234

## Goal

Add request validation.

## User Constraints

Keep the API compatible.

## Current State

Boundary tests remain.

## Changes

No changes yet.

## Decisions

No decisions.

## Verification

No tests run.

## Failed Attempts

Nothing.

## Blockers and Unknowns

Nothing.

## Next Actions

1. Add the tests.

## Resume Instructions

1. Read the route code.

## References

- API spec
`;

  it('claims protocol 3 handoffs for all non-complete body statuses', () => {
    const p = fixture();
    for (const status of ['in-progress', 'blocked', 'ready-for-review']) {
      const filename = `${status}.md`; const source = join(p.root, 'handoff/for-codex', filename);
      fs.writeFileSync(source, protocol3Handoff(status));
      const result = claim(p, filename, 'handoff/for-codex', 'active/codex-a', a);
      expect(result.ok).toBe(true);
      expect(fs.existsSync(source)).toBe(false);
      expect(fs.existsSync(join(p.root, 'active/codex-a', filename))).toBe(true);
    }
  });

  it('does not claim a protocol 3 handoff marked complete', () => {
    const p = fixture(); const source = join(p.root, 'handoff/for-codex/complete.md');
    fs.writeFileSync(source, protocol3Handoff('complete'));
    expect(claim(p, 'complete.md', 'handoff/for-codex', 'active/codex-a', a)).toMatchObject({ ok: false, reason: 'invalid-note' });
    expect(fs.existsSync(source)).toBe(true);
  });

  it('can safely finish its own matching receipt after an interrupted move', () => {
    const p = fixture(); const source = join(p.root, 'handoff/for-codex/task.md');
    const content = '---\nfrom_class: claude\nfrom_instance: sender\nto_class: codex\nto_instance: codex-a\nscopes: api\nstatus: ready\ncreated: 2026-10-25T10:00:00.000Z\n---\n\n# Task\n\n## Context\n\nContext\n\n## Task\n\nTask\n\n## What I Verified\n\n- tests\n\n## What I Assumed\n\n- nothing\n';
    fs.writeFileSync(source, content); const original = fs.renameSync; let failed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (from === source && !failed) { failed = true; throw new Error('interrupted move'); }
      return original(from, to);
    });
    expect(() => claim(p, 'task.md', 'handoff/for-codex', 'active/codex-a', a)).toThrow();
    expect(claim(p, 'task.md', 'handoff/for-codex', 'active/codex-a', a).ok).toBe(true);
  });
});
