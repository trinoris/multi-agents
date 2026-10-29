/** Copyright 2026 TRINORIS — Licensed under the Apache License, Version 2.0. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Owed by specs/08: R1's coverage was at SDK level, but the exit code is wired in bin.ts.
// Exit 5 is the contract a caller scripts against, so it needs a test at this level.
const bin = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-guard-')));
  roots.push(root);
  const g = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
  g('init', '-q'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 'test');
  writeFileSync(join(root, '.gitignore'), 'ignored.log\n');
  writeFileSync(join(root, 'clean.txt'), 'committed\n');
  g('add', '.gitignore', 'clean.txt'); g('commit', '-qm', 'init');
  return root;
}
function guard(root: string, paths: string, extra: string[] = []) {
  const r = spawnSync(process.execPath, [bin, 'guard', '--work-dir', root, '--paths', paths, '--json', ...extra], { encoding: 'utf8', timeout: 20000 });
  if (r.error) throw r.error;
  return { code: r.status, data: () => JSON.parse(r.stdout) };
}

describe('guard CLI contract', () => {
  it('exits 5 on an untracked path and names it', () => {
    const root = repo();
    writeFileSync(join(root, 'peer.js'), 'peer work\n');
    const r = guard(root, 'peer.js');
    expect(r.code).toBe(5);
    const report = r.data();
    expect(report.ok).toBe(false);
    expect(report.paths[0]).toMatchObject({ path: 'peer.js', verdict: 'untracked', allowed: false });
  });

  it('exits 0 on tracked, unmodified paths', () => {
    const root = repo();
    const r = guard(root, 'clean.txt');
    expect(r.code).toBe(0);
    expect(r.data().ok).toBe(true);
  });

  it('exits 5 when any one path in a batch is refused', () => {
    const root = repo();
    appendFileSync(join(root, 'clean.txt'), 'edit\n');
    writeFileSync(join(root, 'ignored.log'), 'output\n');
    const r = guard(root, 'clean.txt,ignored.log,absent.txt');
    expect(r.code).toBe(5);
    const verdicts = r.data().paths.map((p: { verdict: string }) => p.verdict);
    expect(verdicts).toEqual(['dirty', 'ignored', 'missing']);
  });

  it('exits 0 once the caller claims the path explicitly', () => {
    const root = repo();
    writeFileSync(join(root, 'mine.js'), 'my new file\n');
    expect(guard(root, 'mine.js').code).toBe(5);
    expect(guard(root, 'mine.js', ['--allow-untracked', 'mine.js']).code).toBe(0);
  });
});
