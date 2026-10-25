import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { acquire, diagnose, inspect, isHolder, recoverMarker } from './lock.js';

const moduleURL = pathToFileURL(fileURLToPath(new URL('../dist/index.js', import.meta.url))).href;
const roots: string[] = [], children = new Set<ChildProcess>();
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'agent-process-race-')); roots.push(root);
  for (const d of ['locks', 'claims', 'incidents']) fs.mkdirSync(join(root, d)); return { root };
}
afterEach(() => { for (const child of children) child.kill('SIGKILL'); children.clear(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const code = `
import * as sdk from ${JSON.stringify(moduleURL)};
const [root, action, instance, generation] = process.argv.slice(1);
process.send({ ready: true });
process.on('message', () => {
  try {
    const p = { root }; const who = { agent_class: 'codex', agent_instance: instance };
    const r = action === 'acquire' ? sdk.acquire(p, 'api', who, 15) : action === 'break' ? sdk.breakLock(p, 'api', who, 15, 0, 'owner stopped for race test') : sdk.release(p, 'api', instance, generation);
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
