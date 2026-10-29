/** Copyright 2026 TRINORIS — Licensed under the Apache License, Version 2.0. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyPaths, repositoryRoot } from './guard.js';

const made: string[] = [];
afterEach(() => { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function repo() {
  const root = fs.realpathSync(mkdtempSync(join(tmpdir(), 'guard-')));
  made.push(root);
  const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 'test');
  writeFileSync(join(root, '.gitignore'), 'ignored.log\n');
  writeFileSync(join(root, 'clean.txt'), 'committed\n');
  g('add', '.gitignore', 'clean.txt'); g('commit', '-qm', 'init');
  return { root, g };
}

describe('R1 write guard', () => {
  // The incident this guards against: three UNTRACKED peer files were silently rewritten
  // by a bulk rename while the writer held six valid leases.
  it('refuses an untracked path, because nothing committed can restore it', () => {
    const { root } = repo();
    writeFileSync(join(root, 'peer.js'), 'peer work\n');
    const r = classifyPaths(['peer.js'], { cwd: root });
    expect(r.ok).toBe(false);
    expect(r.paths[0].verdict).toBe('untracked');
    expect(r.paths[0].allowed).toBe(false);
  });

  // The false-positive check the spec requires: ordinary committed work must pass, or the
  // guard is noise and will be switched off.
  it('allows tracked, unmodified paths', () => {
    const { root } = repo();
    const r = classifyPaths(['clean.txt'], { cwd: root });
    expect(r.ok).toBe(true);
    expect(r.paths[0].verdict).toBe('clean');
  });

  it('refuses a modified tracked path, since the working copy cannot be attributed', () => {
    const { root } = repo();
    fs.appendFileSync(join(root, 'clean.txt'), 'local edit\n');
    const r = classifyPaths(['clean.txt'], { cwd: root });
    expect(r.ok).toBe(false);
    expect(r.paths[0].verdict).toBe('dirty');
  });

  it('allows ignored paths and paths that do not exist yet', () => {
    const { root } = repo();
    writeFileSync(join(root, 'ignored.log'), 'build output\n');
    const r = classifyPaths(['ignored.log', 'brand-new.txt'], { cwd: root });
    expect(r.ok).toBe(true);
    expect(r.paths.map(c => c.verdict)).toEqual(['ignored', 'missing']);
  });

  it('honours a per-path override without silencing the others', () => {
    const { root } = repo();
    writeFileSync(join(root, 'mine.js'), 'my new file\n');
    writeFileSync(join(root, 'theirs.js'), 'peer work\n');
    const r = classifyPaths(['mine.js', 'theirs.js'], { cwd: root, allowUntracked: ['mine.js'] });
    expect(r.ok).toBe(false);
    expect(r.paths.find(c => c.path === 'mine.js')?.allowed).toBe(true);
    expect(r.paths.find(c => c.path === 'theirs.js')?.allowed).toBe(false);
  });

  it('refuses a path outside the repository', () => {
    const { root } = repo();
    const r = classifyPaths(['../escape.txt'], { cwd: root });
    expect(r.ok).toBe(false);
    expect(r.paths[0].reason).toMatch(/outside the repository/);
  });

  it('refuses everything when the directory is not a work tree', () => {
    const outside = fs.realpathSync(mkdtempSync(join(tmpdir(), 'notrepo-')));
    made.push(outside);
    // A bare temp dir can still sit under a parent work tree; only assert the contract
    // when Git genuinely reports no root, which is what the guard keys on.
    if (repositoryRoot(outside)) return;
    const r = classifyPaths(['anything.txt'], { cwd: outside });
    expect(r.ok).toBe(false);
    expect(r.repository).toBeNull();
  });

  it('bounds the path list', () => {
    const { root } = repo();
    expect(() => classifyPaths([], { cwd: root })).toThrow(RangeError);
    expect(() => classifyPaths(Array(5000).fill('clean.txt'), { cwd: root })).toThrow(RangeError);
  });

  it('refuses when Git status cannot establish recoverability', () => {
    const { root } = repo();
    writeFileSync(join(root, 'peer.js'), 'peer work\n');
    writeFileSync(join(root, '.git', 'index'), 'corrupt index');
    const r = classifyPaths(['peer.js'], { cwd: root });
    expect(r.ok).toBe(false);
    expect(r.paths[0].allowed).toBe(false);
    expect(r.paths[0].reason).toMatch(/Git status failed/);
  });
});
