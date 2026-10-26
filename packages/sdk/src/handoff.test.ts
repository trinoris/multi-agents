import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, parseHandoff } from '@trinoris/agent-core';
import { completeHandoff, listHandoffs, publishHandoff, readHandoff, validateHandoffDraft } from './lock.js';

const roots: string[] = [];
const sender = { agent_class: 'codex', agent_instance: 'codex-a' };
const validNote = (status = 'ready-for-review') => `---
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
Status: ${status}
Branch: main
Base commit: abc1234

## Goal

Review the workflow.

## User Constraints

Keep the public API stable.

## Current State

Implementation is ready for review.

## Changes

Updated validation.

## Decisions

Keep evidence immutable.

## Verification

| Check | Result | Scope / limitations |
| --- | --- | --- |
| Unit tests | PASS | Local fixture |

## Failed Attempts

None.

## Blockers and Unknowns

None.

## Next Actions

1. Review the edge cases.

## Resume Instructions

Read the current branch and run tests.

## References

See the implementation plan.
`;
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'agent-handoff-lifecycle-')); roots.push(root);
  for (const path of ['locks', 'claims', 'incidents', 'published', 'handoff/drafts', 'handoff/for-codex', 'handoff/for-claude', 'handoff/for-any', 'active/codex-a', 'archive']) {
    fs.mkdirSync(join(root, path), { recursive: true });
  }
  fs.writeFileSync(join(root, 'config.json'), JSON.stringify(defaultConfig()));
  fs.writeFileSync(join(root, 'archive/INDEX.md'), '# Handoff archive\n\n| Completed | Note | From | To | Outcome |\n| --- | --- | --- | --- | --- |\n');
  return { root };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('guarded handoff lifecycle', () => {
  it('validates a bounded protocol 3 draft and rejects malformed drafts', () => {
    const p = fixture();
    fs.writeFileSync(join(p.root, 'handoff/drafts/review.md'), validNote());
    fs.writeFileSync(join(p.root, 'handoff/drafts/bad.md'), validNote().replace('## References', '## Unknown Section'));
    expect(validateHandoffDraft(p, 'review.md')).toMatchObject({ ok: true, note: { format_version: 3, status: 'ready-for-review' } });
    expect(validateHandoffDraft(p, 'bad.md')).toMatchObject({ ok: false, reason: 'invalid-note' });
    expect(validateHandoffDraft(p, '../review.md')).toMatchObject({ ok: false, reason: 'invalid-note' });
  });

  it('publishes only a ready draft to its declared inbox and safely retries the exact publish', () => {
    const p = fixture(); fs.writeFileSync(join(p.root, 'handoff/drafts/review.md'), validNote());
    const first = publishHandoff(p, 'review.md', sender);
    expect(first).toMatchObject({ ok: true, path: join(p.root, 'handoff/for-claude/review.md'), alreadyPublished: false });
    expect(fs.existsSync(join(p.root, 'handoff/drafts/review.md'))).toBe(false);
    expect(publishHandoff(p, 'review.md', sender)).toMatchObject({ ok: true, alreadyPublished: true });
    fs.writeFileSync(join(p.root, 'handoff/drafts/review.md'), validNote());
    expect(publishHandoff(p, 'review.md', sender)).toMatchObject({ ok: true, alreadyPublished: true });
    expect(fs.existsSync(join(p.root, 'handoff/drafts/review.md'))).toBe(false);
  });

  it('finishes the exact publication after an interrupted draft move', () => {
    const p = fixture(); const source = join(p.root, 'handoff/drafts/review.md');
    fs.writeFileSync(source, validNote()); const rename = fs.renameSync; let failed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (from === source && !failed) { failed = true; throw new Error('simulated interrupted publish'); }
      return rename(from, to);
    });
    expect(() => publishHandoff(p, 'review.md', sender)).toThrow('simulated interrupted publish');
    expect(publishHandoff(p, 'review.md', sender)).toMatchObject({ ok: true, alreadyPublished: false });
    expect(fs.existsSync(join(p.root, 'handoff/for-claude/review.md'))).toBe(true);
    vi.restoreAllMocks();
  });

  it('refuses publication while the sender still owns a lease or the inbox name collides', () => {
    const p = fixture(); fs.writeFileSync(join(p.root, 'handoff/drafts/review.md'), validNote());
    fs.mkdirSync(join(p.root, 'locks/packages.lock'));
    fs.writeFileSync(join(p.root, 'locks/packages.lock/holder.json'), JSON.stringify({
      schema_version: 2, generation: 'lease-a', ...sender, scope: 'packages',
      acquired_at: '2026-10-26T12:00:00.000Z', expires_at: '2026-10-26T14:00:00.000Z',
    }));
    expect(publishHandoff(p, 'review.md', sender)).toMatchObject({ ok: false, reason: 'scope-held' });
    fs.rmSync(join(p.root, 'locks/packages.lock'), { recursive: true });
    fs.writeFileSync(join(p.root, 'handoff/for-claude/review.md'), 'keep');
    expect(publishHandoff(p, 'review.md', sender)).toMatchObject({ ok: false, reason: 'destination-conflict' });
    expect(fs.readFileSync(join(p.root, 'handoff/for-claude/review.md'), 'utf8')).toBe('keep');
  });

  it('lists and reads only the caller inbox, universal inbox, and own active directory', () => {
    const p = fixture();
    fs.writeFileSync(join(p.root, 'handoff/for-codex/review.md'), validNote().replace('to_class: claude', 'to_class: codex'));
    fs.writeFileSync(join(p.root, 'handoff/for-any/universal.md'), validNote().replace('to_class: claude', 'to_class: any'));
    fs.writeFileSync(join(p.root, 'active/codex-a/active.md'), validNote());
    fs.mkdirSync(join(p.root, 'active/other'), { recursive: true });
    fs.writeFileSync(join(p.root, 'active/other/private.md'), validNote());
    const entries = listHandoffs(p, sender);
    expect(entries.map(entry => entry.filename).sort()).toEqual(['active.md', 'review.md', 'universal.md']);
    expect(readHandoff(p, 'active.md', sender, 'active')).toMatchObject({ ok: true, content: validNote() });
    expect(readHandoff(p, 'private.md', sender, 'active')).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('completes and archives an active handoff once, recording a truthful outcome', () => {
    const p = fixture(); const source = join(p.root, 'active/codex-a/review.md');
    fs.writeFileSync(source, validNote('ready-for-review'));
    const first = completeHandoff(p, 'review.md', sender, 'Reviewed successfully.');
    expect(first).toMatchObject({ ok: true, path: join(p.root, 'archive/review.md'), alreadyCompleted: false });
    const archived = fs.readFileSync(join(p.root, 'archive/review.md'), 'utf8');
    expect(parseHandoff(archived)).toMatchObject({ status: 'complete', metadata: { status: 'completed' } });
    expect(archived).toContain('Completion outcome: Reviewed successfully.');
    expect(fs.existsSync(source)).toBe(false);
    expect(completeHandoff(p, 'review.md', sender, 'Reviewed successfully.')).toMatchObject({ ok: true, alreadyCompleted: true });
    expect(fs.readFileSync(join(p.root, 'archive/INDEX.md'), 'utf8').match(/review\.md/g)).toHaveLength(1);
  });

  it('finishes an exact archive after interruption between archive write and active removal', () => {
    const p = fixture(); const source = join(p.root, 'active/codex-a/review.md');
    fs.writeFileSync(source, validNote()); const unlink = fs.unlinkSync; let failed = false;
    vi.spyOn(fs, 'unlinkSync').mockImplementation(path => {
      if (path === source && !failed) { failed = true; throw new Error('simulated interrupted completion'); }
      return unlink(path);
    });
    expect(() => completeHandoff(p, 'review.md', sender, 'Reviewed successfully.')).toThrow('simulated interrupted completion');
    expect(fs.existsSync(join(p.root, 'archive/review.md'))).toBe(true);
    expect(fs.existsSync(source)).toBe(true);
    expect(completeHandoff(p, 'review.md', sender, 'Reviewed successfully.')).toMatchObject({ ok: true, alreadyCompleted: false });
    expect(fs.existsSync(source)).toBe(false);
    expect(completeHandoff(p, 'review.md', sender, 'Reviewed successfully.')).toMatchObject({ ok: true, alreadyCompleted: true });
    vi.restoreAllMocks();
  });

  it('does not overwrite an archive entry or complete a note while its scope is held', () => {
    const p = fixture(); const source = join(p.root, 'active/codex-a/review.md');
    fs.writeFileSync(source, validNote()); fs.writeFileSync(join(p.root, 'archive/review.md'), 'keep');
    expect(completeHandoff(p, 'review.md', sender, 'done')).toMatchObject({ ok: false, reason: 'destination-conflict' });
    expect(fs.readFileSync(join(p.root, 'archive/review.md'), 'utf8')).toBe('keep');
    fs.rmSync(join(p.root, 'archive/review.md'));
    fs.mkdirSync(join(p.root, 'locks/tests.lock'));
    fs.writeFileSync(join(p.root, 'locks/tests.lock/holder.json'), JSON.stringify({
      schema_version: 2, generation: 'lease-a', ...sender, scope: 'tests',
      acquired_at: '2026-10-26T12:00:00.000Z', expires_at: '2026-10-26T14:00:00.000Z',
    }));
    expect(completeHandoff(p, 'review.md', sender, 'done')).toMatchObject({ ok: false, reason: 'scope-held' });
    expect(fs.existsSync(source)).toBe(true);
  });
});
