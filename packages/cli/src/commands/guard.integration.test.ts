/** Copyright 2026 TRINORIS — Licensed under the Apache License, Version 2.0. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
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

// Reviewing 1c2a184 (handoff parser aligned with protocol 3) surfaced this: the protocol
// defines handoff/for-any for an explicitly universal note, and the SDK's claim accepts that
// source, but the CLI defaulted --from to the class inbox only. A universal note was
// unreachable unless the caller already knew to pass --from handoff/for-any.
describe('claim reaches a universal note without --from', () => {
  const note = (to: string) => [
    '---', 'from_class: codex-gpt-6', 'from_instance: peer', `to_class: ${to}`, 'to_instance: any',
    'scopes: [specs]', 'locks_released: true', '---', '',
    '# Context Handoff', '', 'Updated: 2026-10-29 18:00 UTC', 'Task: probe', 'Status: ready-for-review',
    'Branch: main', 'Base commit: abc1234', '',
    '## Goal', 'x', '## User Constraints', '- x', '## Current State', '- x',
    '## Changes', '| Path | Change | Reason |', '| --- | --- | --- |', '| `x` | x | x |',
    '## Decisions', '- x', '## Verification', '| Check | Result | Scope / limitations |',
    '| --- | --- | --- |', '| `x` | PASS | x |', '## Failed Attempts', '- x',
    '## Blockers and Unknowns', '- Nothing.', '## Next Actions', '1. x',
    '## Resume Instructions', '1. x', '## References', '- x', '',
  ].join('\n');

  function seeded(to: string) {
    const root = repo();
    spawnSync(process.execPath, [bin, 'setup', '--work-dir', root, '--json'], { encoding: 'utf8', timeout: 20000 });
    mkdirSync(join(root, '.trinoris/handoff/drafts'), { recursive: true });
    writeFileSync(join(root, '.trinoris/handoff/drafts/n.md'), note(to));
    spawnSync(process.execPath, [bin, 'handoff', 'publish', '--work-dir', root, '--note', 'n.md', '--agent-class', 'codex-gpt-6', '--instance', 'peer', '--json'], { encoding: 'utf8', timeout: 20000 });
    return root;
  }
  const claim = (root: string) => spawnSync(process.execPath, [bin, 'claim', '--work-dir', root, '--note', 'n.md', '--agent-class', 'claude-opus-5', '--instance', 'reviewer', '--json'], { encoding: 'utf8', timeout: 20000 });

  it('claims a to_class: any note published to for-any', () => {
    const root = seeded('any');
    const r = claim(root);
    expect(JSON.parse(r.stdout).ok).toBe(true);
    expect(existsSync(join(root, '.trinoris/active/reviewer/n.md'))).toBe(true);
  });

  it('still prefers this class inbox when the note is addressed to it', () => {
    const root = seeded('claude-opus-5');
    const r = claim(root);
    expect(JSON.parse(r.stdout).ok).toBe(true);
    expect(existsSync(join(root, '.trinoris/active/reviewer/n.md'))).toBe(true);
  });
});
