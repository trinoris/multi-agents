import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { acquire, breakLock, diagnose, inspect, isHolder, recoverMarker } from './lock.js';

const moduleURL = pathToFileURL(fileURLToPath(new URL('../dist/index.js', import.meta.url))).href;
const roots: string[] = [], children = new Set<ChildProcess>();
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'agent-process-race-')); roots.push(root);
  for (const d of ['locks', 'claims', 'incidents', 'handoff/for-codex', 'active']) fs.mkdirSync(join(root, d), { recursive: true }); return { root };
}
afterEach(() => { for (const child of children) child.kill('SIGKILL'); children.clear(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const code = `
import * as sdk from ${JSON.stringify(moduleURL)};
const [root, action, instance, generation] = process.argv.slice(1);
process.send({ ready: true });
process.on('message', () => {
  try {
    const p = { root }; const who = { agent_class: 'codex', agent_instance: instance };
    const r = action === 'acquire' ? sdk.acquire(p, 'api', who, 15)
      : action === 'break' ? sdk.breakLock(p, 'api', who, 15, 0, 'owner stopped for race test')
      : action === 'renew' ? sdk.renew(p, 'api', instance, 15, generation)
      : action === 'claim' ? sdk.claim(p, 'task.md', 'handoff/for-codex', 'active/' + instance, who)
      : sdk.release(p, 'api', instance, generation);
    process.send({ result: r }, () => process.disconnect());
  } catch (e) { process.send({ error: String(e.stack) }, () => process.disconnect()); }
});`;
async function race(root: string, actors: Array<{ action: string; instance: string; generation?: string }>) {
  const workers = actors.map(actor => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, root, actor.action, actor.instance, actor.generation ?? ''], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    children.add(child); let reply: any; let readyResolve!: () => void, rejectReady!: (e: Error) => void; let errorOutput = '';
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; rejectReady = reject; });
    child.stderr?.on('data', data => { errorOutput += data; });
    child.on('message', (msg: any) => { if (msg.ready) readyResolve(); else reply = msg; });
    child.on('error', e => rejectReady(e));
    const done = new Promise<any>((resolve, reject) => child.on('close', status => {
      children.delete(child);
      if (status !== 0 || !reply?.result || reply.error) { const e = new Error(errorOutput || reply?.error || 'worker failed'); rejectReady(e); reject(e); }
      else resolve(reply.result);
    }));
    return { child, ready, done };
  });
  const timer = setTimeout(() => workers.forEach(w => w.child.kill('SIGKILL')), 10000);
  try { await Promise.all(workers.map(w => w.ready)); workers.forEach(w => w.child.send('go')); return await Promise.all(workers.map(w => w.done)); }
  finally { clearTimeout(timer); }
}
describe('SG-03 real process races against shipped SDK', () => {
  it('has exactly one acquire winner and exactly one stale takeover winner', async () => {
    const p = fixture(); const contenders = Array.from({ length: 8 }, (_, i) => ({ action: 'acquire', instance: `actor-${i}` }));
    const results = await race(p.root, contenders); expect(results.filter(r => r.ok)).toHaveLength(1);
    const winner = results.find(r => r.ok).lock;
    expect(isHolder(p, 'api', winner.agent_instance, winner.generation)).toBe(true);
    fs.writeFileSync(join(p.root, 'locks/api.lock/holder.json'), JSON.stringify({ ...winner, acquired_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:15:00.000Z' }));
    const broken = await race(p.root, contenders.map(a => ({ ...a, action: 'break' })));
    expect(broken.filter(r => r.ok)).toHaveLength(1);
    const successor = broken.find(r => r.ok).lock;
    expect(isHolder(p, 'api', successor.agent_instance, successor.generation)).toBe(true);
    expect(successor.generation).not.toBe(winner.generation);
  }, 30000);
  it('never deletes a successful successor in mixed release/acquire/break races', async () => {
    for (let t = 0; t < 3; t++) {
      const p = fixture(); const initial = acquire(p, 'api', { agent_class: 'codex', agent_instance: 'initial' }, 15); if (!initial.ok) throw new Error('fixture');
      fs.writeFileSync(join(p.root, 'locks/api.lock/holder.json'), JSON.stringify({ ...initial.lock, acquired_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:15:00.000Z' }));
      const results = await race(p.root, [{ action: 'release', instance: 'initial', generation: initial.lock.generation }, { action: 'acquire', instance: 'successor' }, { action: 'break', instance: 'breaker' }]);
      const winners = results.filter(r => r.ok && r.lock);
      expect(winners.length).toBeLessThanOrEqual(1);
      for (const r of winners) expect(isHolder(p, 'api', r.lock.agent_instance, r.lock.generation)).toBe(true);
      if (!winners.length) expect(['free', 'expired']).toContain(inspect(p, 'api', 0).state);
    }
  }, 30000);
  it('does not let an expired owner renew across a concurrent takeover', async () => {
    const p = fixture(); const initial = acquire(p, 'api', { agent_class: 'codex', agent_instance: 'initial' }, 15);
    if (!initial.ok) throw new Error('fixture');
    fs.writeFileSync(join(p.root, 'locks/api.lock/holder.json'), JSON.stringify({ ...initial.lock, acquired_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:15:00.000Z' }));
    const result = await race(p.root, [
      { action: 'renew', instance: 'initial', generation: initial.lock.generation },
      { action: 'break', instance: 'breaker' },
    ]);
    expect(result[0].ok).toBe(false);
    let successor = result.find(value => value.ok && value.lock)?.lock;
    if (!successor) {
      expect(inspect(p, 'api', 0).state).toBe('expired');
      const retry = breakLock(p, 'api', { agent_class: 'codex', agent_instance: 'breaker' }, 15, 0, 'retry after busy generation race');
      expect(retry.ok).toBe(true); if (retry.ok) successor = retry.lock;
    }
    expect(successor?.agent_instance).toBe('breaker');
    expect(isHolder(p, 'api', 'breaker', successor?.generation)).toBe(true);
  }, 30000);
  it('allows exactly one process to claim a shared handoff source', async () => {
    const p = fixture();
    const content = `---\nfrom_class: claude\nfrom_instance: sender\nto_class: codex\nto_instance: any\nscopes: [api]\nlocks_released: true\n---\n\n# Context Handoff\n\nUpdated: 2026-10-26 12:00 UTC\nTask: Race claimers\nStatus: ready-for-review\nBranch: main\nBase commit: abc1234\n\n## Goal\n\nProve one claim wins.\n\n## User Constraints\n\nKeep the contract stable.\n\n## Current State\n\nA single inbox note exists.\n\n## Changes\n\nNo changes yet.\n\n## Decisions\n\nNone.\n\n## Verification\n\nNo tests run.\n\n## Failed Attempts\n\nNone.\n\n## Blockers and Unknowns\n\nNone.\n\n## Next Actions\n\n1. Continue.\n\n## Resume Instructions\n\nRead the repository.\n\n## References\n\nNone.\n`;
    fs.writeFileSync(join(p.root, 'handoff/for-codex/task.md'), content);
    const results = await race(p.root, Array.from({ length: 8 }, (_, i) => ({ action: 'claim', instance: `claimer-${i}` })));
    expect(results.filter(value => value.ok)).toHaveLength(1);
    expect(fs.existsSync(join(p.root, 'handoff/for-codex/task.md'))).toBe(false);
    const claimed = fs.readdirSync(join(p.root, 'active')).filter(name => fs.existsSync(join(p.root, 'active', name, 'task.md')));
    expect(claimed).toHaveLength(1);
    expect(fs.readFileSync(join(p.root, 'active', claimed[0], 'task.md'), 'utf8')).toBe(content);
  }, 30000);
  it('recovers a process killed after creating an incomplete lock directory', async () => {
    const p = fixture();
    const crashCode = `import fs from 'node:fs'; import path from 'node:path'; import * as sdk from ${JSON.stringify(moduleURL)};
      const target = path.resolve(process.argv[1], 'locks', 'api.lock');
      const mkdir = fs.mkdirSync; fs.mkdirSync = function(value, ...args) { const result = mkdir.call(fs,value,...args); if (path.resolve(String(value)) === target) { process.send({ paused: true }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0); } return result; };
      sdk.acquire({root:process.argv[1]},'api',{agent_class:'codex',agent_instance:'paused'},15);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', crashCode, p.root], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); children.add(child);
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('acquirer did not reach the lock-directory boundary')), 5000);
      child.once('message', (message: any) => { if (message?.paused) { clearTimeout(timer); resolve(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    child.kill(); await closed; children.delete(child);
    const marker = diagnose(p).find(value => value.marker === '.mutation');
    expect(marker?.metadata.operation_id).toBeTruthy();
    expect(fs.existsSync(join(p.root, 'locks/api.lock/holder.json'))).toBe(false);
    const operator = { agent_class: 'operator', agent_instance: 'resume-session' };
    expect(recoverMarker(p, '.mutation', marker!.metadata.operation_id, operator, 'paused writer stopped and confirmed', true).ok).toBe(true);
    const stale = new Date(Date.now() - 10 * 60_000); fs.utimesSync(join(p.root, 'locks/api.lock'), stale, stale);
    const recovered = breakLock(p, 'api', operator, 15, 5, 'recovered paused acquisition');
    expect(recovered.ok).toBe(true);
    if (recovered.ok) expect(isHolder(p, 'api', operator.agent_instance, recovered.lock.generation)).toBe(true);
  }, 15000);
  it('preserves a crash-left operation for explicit stopped-actor recovery', async () => {
    const p = fixture();
    const crashCode = `import fs from 'node:fs'; import * as sdk from ${JSON.stringify(moduleURL)};
      const rename = fs.renameSync; fs.renameSync = (a,b) => { const r = rename(a,b); if (String(b).includes('.mutation') && String(b).endsWith('operation.json')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0); return r; };
      sdk.acquire({root:process.argv[1]},'api',{agent_class:'codex',agent_instance:'crashed'},15);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', crashCode, p.root], { stdio: 'ignore' }); children.add(child);
    const exit = new Promise(resolve => child.on('close', resolve));
    const limit = Date.now() + 5000;
    while (!fs.existsSync(join(p.root, '.mutation/operation.json')) && Date.now() < limit) await new Promise(r => setTimeout(r, 20));
    child.kill('SIGKILL'); await exit; children.delete(child);
    const markers = diagnose(p); expect(markers).toHaveLength(1);
    const owner = { agent_class: 'operator', agent_instance: 'operator-session' };
    expect(acquire(p, 'api', owner, 15)).toMatchObject({ ok: false, reason: 'busy' });
    expect(recoverMarker(p, '.mutation', markers[0].metadata?.operation_id, owner, 'worker killed and confirmed stopped', true).ok).toBe(true);
    expect(acquire(p, 'api', owner, 15).ok).toBe(true);
  }, 10000);
});
