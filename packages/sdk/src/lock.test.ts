import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquire, breakLock, claim, inspect, isHolder, release, renew } from './lock.js';
import type { LockPaths } from './lock.js';

const roots: string[] = [];
const identity = { agent_instance: 'codex-session-a', agent_class: 'codex-gpt-6' };
const other = { agent_instance: 'claude-session-b', agent_class: 'claude-opus-5' };

function makePaths(): LockPaths {
  const root = mkdtempSync(join(tmpdir(), 'trinoris-agent-sdk-'));
  roots.push(root);
  for (const name of ['locks', 'claims', 'handoff/for-codex-gpt-6', 'active', 'incidents']) {
    mkdirSync(join(root, name), { recursive: true });
  }
  return { root };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('scope lock lifecycle', () => {
  it('acquires exclusively, records the owner, and rejects another acquisition', () => {
    const paths = makePaths();
    const first = acquire(paths, 'api', identity, 15, 'validate requests');

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.lock).toMatchObject({ ...identity, scope: 'api', task: 'validate requests' });
    expect(JSON.parse(readFileSync(join(paths.root, 'locks/api.lock/holder.json'), 'utf8'))).toMatchObject(identity);
    expect(inspect(paths, 'api', 5).state).toBe('held');
    expect(isHolder(paths, 'api', identity.agent_instance)).toBe(true);
    expect(isHolder(paths, 'api', other.agent_instance)).toBe(false);

    const second = acquire(paths, 'api', other, 15);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('held');
  });

  it('renews and releases only for the recorded owner', () => {
    const paths = makePaths();
    expect(acquire(paths, 'api', identity, 15).ok).toBe(true);

    expect(renew(paths, 'api', other.agent_instance, 15)).toEqual({ ok: false, reason: 'not-holder' });
    const renewed = renew(paths, 'api', identity.agent_instance, 30);
    expect(renewed.ok).toBe(true);
    if (renewed.ok) expect(Date.parse(renewed.lock.expires_at)).toBeGreaterThan(Date.now() + 29 * 60_000);

    expect(release(paths, 'api', other.agent_instance)).toEqual({ ok: false, reason: 'not-holder' });
    expect(release(paths, 'api', identity.agent_instance)).toEqual({ ok: true });
    expect(inspect(paths, 'api', 5)).toEqual({ state: 'free' });
    expect(release(paths, 'api', identity.agent_instance)).toEqual({ ok: false, reason: 'free' });
  });

  it('breaks a stale lease under the token and preserves incident evidence', () => {
    const paths = makePaths();
    mkdirSync(join(paths.root, 'locks', 'api.lock'));
    writeFileSync(join(paths.root, 'locks', 'api.lock', 'holder.json'), JSON.stringify({
      ...other,
      scope: 'api',
      acquired_at: '2020-01-01T00:00:00.000Z',
      expires_at: '2020-01-01T00:15:00.000Z',
    }));

    const result = breakLock(paths, 'api', identity, 15, 0, 'owner confirmed stopped');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evicted?.agent_instance).toBe(other.agent_instance);
    expect(isHolder(paths, 'api', identity.agent_instance)).toBe(true);
    expect(readFileSync(result.incident, 'utf8')).toContain('owner confirmed stopped');
    expect(inspect(paths, 'api', 5).state).toBe('held');
  });
});

describe('handoff claiming', () => {
  it('moves a note once and releases its atomic claim marker', () => {
    const paths = makePaths();
    const source = join(paths.root, 'handoff/for-codex-gpt-6/task.md');
    writeFileSync(source, '# Task\n');

    const result = claim(paths, 'task.md', 'handoff/for-codex-gpt-6', 'active');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe(join(paths.root, 'active/task.md'));
    expect(readFileSync(result.path, 'utf8')).toBe('# Task\n');
    expect(claim(paths, 'task.md', 'handoff/for-codex-gpt-6', 'active')).toEqual({ ok: false, reason: 'missing' });
  });

  it('returns missing without leaving the claim marker behind', () => {
    const paths = makePaths();
    expect(claim(paths, 'absent.md', 'handoff/for-codex-gpt-6', 'active')).toEqual({ ok: false, reason: 'missing' });
    expect(claim(paths, 'absent.md', 'handoff/for-codex-gpt-6', 'active')).toEqual({ ok: false, reason: 'missing' });
  });
});
