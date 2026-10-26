import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));
const roots: string[] = [];
function fixture() { const root = mkdtempSync(join(tmpdir(), 'agent-cli-journey-')); roots.push(root); return root; }
function run(root: string, command: string, args: string[] = []) {
  const result = spawnSync(process.execPath, [bin, ...command.split(' '), '--work-dir', root, '--json', ...args], { encoding: 'utf8', timeout: 20000 });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, data: () => JSON.parse(result.stdout) };
}
const who = ['--agent-class', 'codex', '--instance', 'codex-a'];
const handoffDraft = `---
from_class: codex
from_instance: codex-a
to_class: claude
to_instance: any
scopes: [packages, tests]
locks_released: true
---
# Context Handoff

Updated: 2026-10-26 13:30 UTC
Task: Review invoice workflow
Status: ready-for-review
Branch: main
Base commit: abc1234

## Goal

Review the workflow.

## User Constraints

Keep the API stable.

## Current State

The implementation is ready.

## Changes

Validation was updated.

## Decisions

Keep evidence immutable.

## Verification

| Check | Result | Scope / limitations |
| --- | --- | --- |
| Unit tests | PASS | Fixture |

## Failed Attempts

None.

## Blockers and Unknowns

None.

## Next Actions

1. Review edge cases.

## Resume Instructions

Read the branch and run tests.

## References

See the plan.
`;
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('SG-01..09 shipped CLI journeys', () => {
  it('sets up, verifies the real filesystem, acquires, checks, renews and releases a generation', () => {
    const root = fixture(); expect(run(root, 'setup').code).toBe(0);
    expect(existsSync(join(root, '.trinoris/config.json'))).toBe(true);
    expect(existsSync(join(root, 'coordination'))).toBe(false);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('/.trinoris/');
    const verified = run(root, 'verify', ['--trials', '1', '--concurrency', '2']);
    expect(verified.code, verified.stderr).toBe(0); expect(verified.data()).toMatchObject({ ready: true, protocolOk: true, atomicityOk: true });
    const acquired = run(root, 'acquire', [...who, '--scope', 'api']);
    expect(acquired.code, acquired.stderr).toBe(0); const generation = acquired.data().lock.generation;
    const lease = [...who, '--scope', 'api', '--generation', generation];
    expect(run(root, 'check', lease).code).toBe(0);
    expect(run(root, 'renew', lease).code).toBe(0);
    expect(run(root, 'release', lease).code).toBe(0);
    expect(run(root, 'check', lease).code).toBe(4);
  }, 30000);
  it('rejects missing/duplicate/unknown options and refuses identity-only lease commands', () => {
    const root = fixture(); run(root, 'setup');
    expect(run(root, 'acquire', ['--scope']).code).toBe(1);
    expect(run(root, 'acquire', ['--scope', 'api', '--scope', 'tests']).code).toBe(1);
    expect(run(root, 'acquire', ['--arbitrary', 'value']).code).toBe(1);
    expect(run(root, 'check', [...who, '--scope', 'api']).code).toBe(1);
  });
  it.each([
    ['missing both', ['--scope', 'api']],
    ['missing instance', ['--agent-class', 'codex', '--scope', 'api']],
    ['missing class', ['--instance', 'codex-a', '--scope', 'api']],
  ])('requires explicit identity for a stateful command (%s)', (_label, args) => {
    const root = fixture(); run(root, 'setup');
    const result = run(root, 'acquire', args);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Stateful commands require --agent-class and --instance');
    expect(existsSync(join(root, '.trinoris/locks/api.lock'))).toBe(false);
  });
  it('sets supported lease values during setup and rejects invalid values before writing', () => {
    const configured = fixture();
    const result = run(configured, 'setup', ['--lease-minutes', '30', '--grace-minutes', '2']);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(configured, '.trinoris/config.json'), 'utf8')).scopes).toMatchObject({
      lease_duration_minutes: 30,
      renewal_threshold_minutes: 10,
      grace_period_minutes: 2,
    });

    const invalid = fixture();
    expect(run(invalid, 'setup', ['--lease-minutes', '0']).code).toBe(1);
    expect(existsSync(join(invalid, '.trinoris'))).toBe(false);
  });
  it('runs the complete handoff lifecycle through the CLI', () => {
    const root = fixture(); expect(run(root, 'setup').code).toBe(0);
    writeFileSync(join(root, '.trinoris/handoff/drafts/review.md'), handoffDraft);
    expect(run(root, 'handoff validate', ['--note', 'review.md']).data()).toMatchObject({ ok: true, note: { status: 'ready-for-review' } });
    const published = run(root, 'handoff publish', [...who, '--note', 'review.md']);
    expect(published.code, published.stderr).toBe(0); expect(published.data()).toMatchObject({ ok: true, alreadyPublished: false });
    const claude = ['--agent-class', 'claude', '--instance', 'claude-b'];
    expect(run(root, 'handoff list', claude).data()).toEqual(expect.arrayContaining([expect.objectContaining({ filename: 'review.md', location: 'inbox', valid: true })]));
    expect(run(root, 'handoff claim', [...claude, '--note', 'review.md']).code).toBe(0);
    expect(run(root, 'handoff show', [...claude, '--location', 'active', '--note', 'review.md']).data()).toMatchObject({ ok: true, note: { status: 'ready-for-review' } });
    const completed = run(root, 'handoff complete', [...claude, '--note', 'review.md', '--outcome', 'Review passed.']);
    expect(completed.code, completed.stderr).toBe(0); expect(completed.data()).toMatchObject({ ok: true, alreadyCompleted: false });
    expect(readFileSync(join(root, '.trinoris/archive/review.md'), 'utf8')).toContain('Completion outcome: Review passed.');
    expect(run(root, 'handoff complete', [...claude, '--note', 'review.md', '--outcome', 'Review passed.']).data()).toMatchObject({ ok: true, alreadyCompleted: true });
  }, 30000);
  it('diagnoses a marker without deleting it and requires explicit stopped-actor recovery', () => {
    const root = fixture(); run(root, 'setup');
    const marker = join(root, '.trinoris/.mutation'); mkdirSync(marker);
    writeFileSync(join(marker, 'operation.json'), JSON.stringify({ operation_id: 'crashed-operation' }));
    const result = run(root, 'diagnose'); expect(result.code).toBe(0); expect(result.data()[0].metadata.operation_id).toBe('crashed-operation');
    const args = [...who, '--marker', '.mutation', '--operation', 'crashed-operation', '--reason', 'All affected actors have stopped'];
    expect(run(root, 'recover', args).code).toBe(1);
    expect(run(root, 'recover', [...args, '--confirm-stopped']).code).toBe(0);
    expect(run(root, 'acquire', [...who, '--scope', 'api']).code).toBe(0);
  });
  it('does not call a divergent contract ready even when mkdir passes', () => {
    const root = fixture(); run(root, 'setup'); writeFileSync(join(root, '.trinoris/PROTOCOL.md'), '# unreviewed contract');
    const result = run(root, 'verify', ['--trials', '1', '--concurrency', '2']);
    expect(result.code).toBe(1); expect(result.data()).toMatchObject({ ready: false, protocolOk: false, atomicityOk: true });
    expect(readFileSync(join(root, '.trinoris/PROTOCOL.md'), 'utf8')).toBe('# unreviewed contract');
  }, 30000);
});
