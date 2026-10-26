import fs from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sdk from './lock.js';
import { readText } from './filesystem.js';

const roots: string[] = [];
const a = { agent_instance: 'codex-a', agent_class: 'codex' };
const b = { agent_instance: 'claude-b', agent_class: 'claude' };
function fixture() {
  const base = fs.mkdtempSync(join(tmpdir(), 'agent-security-')); roots.push(base);
  const root = join(base, '.trinoris');
  for (const d of ['locks', 'claims', 'handoff/for-codex', 'handoff/for-claude', 'active', 'archive', 'incidents']) fs.mkdirSync(join(root, d), { recursive: true });
  return { base, root };
}
function take(p: sdk.LockPaths, owner = a) {
  const result = sdk.acquire(p, 'api', owner, 15);
  expect(result.ok).toBe(true); if (!result.ok) throw new Error('acquisition failed');
  return result.lock as typeof result.lock & { generation: string };
}
function handoff(toClass = 'codex', toInstance = 'any') {
  return `---\nfrom_class: claude\nfrom_instance: sender\nto_class: ${toClass}\nto_instance: ${toInstance}\nscopes: api\nstatus: ready\ncreated: 2026-10-25T10:00:00.000Z\n---\n\n# Task\n\n## Context\n\nImplement validation.\n\n## Task\n\nDo the work.\n\n## What I Verified\n\n- existing tests\n\n## What I Assumed\n\n- nothing\n`;
}
afterEach(() => { vi.restoreAllMocks(); for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });

describe('SG-01 filesystem containment', () => {
  it.each(['../../victim', '/tmp/victim', '..\\..\\victim', 'C:\\victim', 'CON', 'api\u001b[2J'])('rejects unsafe scope %s before mutation', scope => {
    const p = fixture(); const outside = join(p.base, 'victim.lock'); fs.mkdirSync(outside);
    fs.writeFileSync(join(outside, 'holder.json'), JSON.stringify(a));
    expect(() => sdk.release(p, scope, a.agent_instance, 'generation')).toThrow();
    expect(fs.existsSync(outside)).toBe(true);
  });
  it('rejects symlinked ancestors and holder files without changing targets', () => {
    const p = fixture(); const outside = join(p.base, 'outside'); fs.mkdirSync(outside);
    fs.rmSync(join(p.root, 'locks'), { recursive: true }); fs.symlinkSync(outside, join(p.root, 'locks'), 'junction');
    expect(() => take(p)).toThrow(); expect(fs.readdirSync(outside)).toEqual([]);
  });
  it('rejects final and dangling links and fails closed when a checked file disappears', () => {
    const p = fixture(); const target = join(p.base, 'target'); const linked = join(p.root, 'linked');
    fs.writeFileSync(target, 'keep'); fs.symlinkSync(target, linked);
    expect(() => readText(p.root, linked)).toThrow(); expect(fs.readFileSync(target, 'utf8')).toBe('keep');
    const missingTarget = join(p.base, 'missing'); const dangling = join(p.root, 'dangling'); fs.symlinkSync(missingTarget, dangling);
    expect(() => readText(p.root, dangling)).toThrow(); expect(fs.existsSync(missingTarget)).toBe(false);

    const disappearing = join(p.root, 'disappearing'); fs.writeFileSync(disappearing, 'content');
    const open = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation(((path: any, ...args: any[]) => {
      if (path === disappearing) fs.unlinkSync(disappearing);
      return (open as any)(path, ...args);
    }) as any);
    expect(() => readText(p.root, disappearing)).toThrow();
    vi.restoreAllMocks();
  });
  it.skipIf(process.platform === 'win32')('rejects a socket file before opening it as state', async context => {
    const p = fixture(); const socketPath = join(p.root, 'socket'); const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') { context.skip(); return; }
      throw error;
    }
    try { expect(() => readText(p.root, socketPath)).toThrow(/regular file/i); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

describe('SG-03 generation and active ownership', () => {
  it('rejects extra identity fields that could override a generated lease', () => {
    const p = fixture(); expect(() => sdk.acquire(p, 'api', { ...a, generation: 'chosen' } as any, 15)).toThrow();
  });
  it('rejects expired ownership and renewal even for the same instance', () => {
    const p = fixture(); const lease = take(p);
    fs.writeFileSync(join(p.root, 'locks/api.lock/holder.json'), JSON.stringify({ ...lease, acquired_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:15:00.000Z' }));
    expect(sdk.isHolder(p, 'api', a.agent_instance, lease.generation)).toBe(false);
    expect(sdk.renew(p, 'api', a.agent_instance, 15, lease.generation).ok).toBe(false);
  });
  it('does not let a previous generation release a reacquired lease with the same identity', () => {
    const p = fixture(); const first = take(p);
    expect(sdk.release(p, 'api', a.agent_instance, first.generation).ok).toBe(true);
    const next = take(p);
    expect(next.generation).toBeTruthy(); expect(next.generation).not.toBe(first.generation);
    expect(sdk.release(p, 'api', a.agent_instance, first.generation).ok).toBe(false);
    expect(sdk.isHolder(p, 'api', a.agent_instance, next.generation)).toBe(true);
  });
  it('serializes release and takeover while a renew is reading the holder', () => {
    const p = fixture(); const lease = take(p);
    const read = fs.readSync; let attempted = false;
    vi.spyOn(fs, 'readSync').mockImplementation(((fd: any, ...args: any[]) => {
      const content = (read as any)(fd, ...args);
      if (!attempted) {
        attempted = true;
        expect(sdk.release(p, 'api', a.agent_instance, lease.generation).ok).toBe(false);
        expect(sdk.breakLock(p, 'api', b, 15, 0, 'race probe').ok).toBe(false);
      }
      return content;
    }) as any);
    expect(sdk.renew(p, 'api', a.agent_instance, 15, lease.generation).ok).toBe(true);
    expect(attempted).toBe(true);
  });
  it('treats invalid holder records as malformed and I/O errors as errors', () => {
    const p = fixture(); take(p);
    fs.writeFileSync(join(p.root, 'locks/api.lock/holder.json'), '{"expires_at":"invalid"}');
    expect(sdk.inspect(p, 'api', 5).state).toBe('malformed');
    vi.spyOn(fs, 'readSync').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
    expect(() => sdk.inspect(p, 'api', 0)).toThrow();
  });
});

describe('SG-05 handoff integrity', () => {
  it('rejects another recipient and preserves source and preexisting destination', () => {
    const p = fixture(); const src = join(p.root, 'handoff/for-codex/task.md');
    fs.writeFileSync(src, handoff('claude'));
    expect(sdk.claim(p, 'task.md', 'handoff/for-codex', 'active/codex-a', a).ok).toBe(false);
    fs.writeFileSync(src, handoff()); fs.mkdirSync(join(p.root, 'active/codex-a'));
    const dest = join(p.root, 'active/codex-a/task.md'); fs.writeFileSync(dest, 'existing work');
    expect(sdk.claim(p, 'task.md', 'handoff/for-codex', 'active/codex-a', a).ok).toBe(false);
    expect(fs.readFileSync(src, 'utf8')).toContain('to_class: codex'); expect(fs.readFileSync(dest, 'utf8')).toBe('existing work');
  });
  it('records claimant and content digest and recognizes an identical retry', () => {
    const p = fixture(); fs.writeFileSync(join(p.root, 'handoff/for-codex/task.md'), handoff());
    const result = sdk.claim(p, 'task.md', 'handoff/for-codex', 'active/codex-a', a);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect((result as any).digest).toMatch(/^[a-f0-9]{64}$/);
    expect(sdk.claim(p, 'task.md', 'handoff/for-codex', 'active/codex-a', a)).toMatchObject({ ok: true, alreadyClaimed: true });
  });
});
