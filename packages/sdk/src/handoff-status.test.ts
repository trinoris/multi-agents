import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '@trinoris/agent-core';
import { claim, completeHandoff, publishHandoff, publishedHandoffStatus } from './lock.js';
import type { LockPaths } from './lock.js';

const roots: string[] = [];
const sender = { agent_class: 'codex', agent_instance: 'codex-a' };
const recipient = { agent_class: 'claude', agent_instance: 'claude-b' };
const noteText = `---
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
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'agent-handoff-status-'));
  roots.push(root);
  for (const path of ['locks', 'claims', 'incidents', 'published', 'handoff/drafts', 'handoff/for-claude', 'active/codex-a', 'active/claude-b', 'archive']) {
    fs.mkdirSync(join(root, path), { recursive: true });
  }
  fs.writeFileSync(join(root, 'config.json'), JSON.stringify(defaultConfig()));
  fs.writeFileSync(join(root, 'archive/INDEX.md'), '# Handoff archive\n\n| Completed | Note | From | To | Outcome |\n| --- | --- | --- | --- | --- |\n');
  return { root };
}
function digestReceiptId(root: string, filename = 'review.md') {
  return sha256(`publish:${join(root, 'handoff/drafts', filename)}:${sender.agent_instance}`);
}
function writePublication(p: LockPaths, overrides: Record<string, unknown> = {}) {
  fs.writeFileSync(join(p.root, 'handoff/drafts/review.md'), noteText);
  fs.writeFileSync(join(p.root, 'handoff/for-claude/review.md'), noteText);
  const receipt = {
    source: 'handoff/drafts/review.md',
    destination: 'handoff/for-claude/review.md',
    digest: sha256(noteText),
    published_by: sender.agent_instance,
    published_class: sender.agent_class,
    ...overrides,
  };
  fs.writeFileSync(join(p.root, 'published', `${digestReceiptId(p.root)}.json`), JSON.stringify(receipt));
  return receipt;
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('published handoff lifecycle status', () => {
  it('tracks missing, publishing, published, claimed, and completed states', () => {
    const p = fixture();
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: false, reason: 'missing' });

    fs.writeFileSync(join(p.root, 'handoff/drafts/review.md'), noteText);
    expect(publishHandoff(p, 'review.md', sender).ok).toBe(true);
    const inbox = join(p.root, 'handoff/for-claude/review.md');
    fs.renameSync(inbox, join(p.root, 'handoff/drafts/review.md'));
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'publishing' });

    expect(publishHandoff(p, 'review.md', sender).ok).toBe(true);
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'published' });
    expect(claim(p, 'review.md', 'handoff/for-claude', `active/${recipient.agent_instance}`, recipient).ok).toBe(true);
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'claimed', recipient_instance: recipient.agent_instance });
    expect(completeHandoff(p, 'review.md', recipient, 'Review passed.').ok).toBe(true);
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({
      ok: true, status: 'completed', recipient_instance: recipient.agent_instance, outcome: 'Review passed.',
    });
  });

  it('rejects malformed publication receipts and destination routing', () => {
    const p = fixture();
    const invalids: Record<string, unknown>[] = [
      { invalid: true },
      { source: 'handoff/drafts/other.md' },
      { published_by: 'someone-else' },
      { published_class: 'someone-else' },
      { digest: 'not-a-digest' },
      { destination: '../review.md' },
      { destination: 'handoff/for-../review.md' },
    ];
    for (const override of invalids) {
      writePublication(p, override);
      expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: false, reason: 'destination-conflict' });
    }
    expect(() => publishedHandoffStatus(p, '../review.md', sender)).toThrow();
    expect(() => publishedHandoffStatus(p, 'review.md', { ...sender, extra: true } as typeof sender)).toThrow();
  });

  it('reports interrupted completion and validates archive receipts and content', () => {
    const p = fixture(); const publication = writePublication(p);
    const receiptId = sha256(`complete:active/${recipient.agent_instance}/review.md`);
    const receiptPath = join(p.root, 'archive', `.${receiptId}.receipt.json`);
    const receipt = {
      source: `active/${recipient.agent_instance}/review.md`, archived: 'archive/review.md',
      original_digest: publication.digest, completed_digest: sha256('completed note'),
      from_instance: sender.agent_instance, from_class: sender.agent_class, outcome: 'done', completed_at: '2026-10-26T13:30:00.000Z',
    };
    const malformed = [
      '{', JSON.stringify({ ...receipt, original_digest: 'different' }),
      JSON.stringify({ ...receipt, from_instance: 'other' }),
      JSON.stringify({ ...receipt, from_class: 'other' }),
    ];
    for (const text of malformed) {
      fs.writeFileSync(receiptPath, text);
      expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'published' });
    }
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'completing', recipient_instance: recipient.agent_instance });
    fs.writeFileSync(join(p.root, 'archive/review.md'), 'wrong content');
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: false, reason: 'destination-conflict' });
    fs.writeFileSync(join(p.root, 'archive/review.md'), 'completed note');
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'completed', outcome: 'done', completed_at: '2026-10-26T13:30:00.000Z' });
  });

  it('rejects malformed correlated archive receipts and skips unrelated ones', () => {
    const p = fixture(); const publication = writePublication(p);
    const path = join(p.root, 'archive', '.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.receipt.json');
    const base = {
      original_digest: publication.digest, from_instance: sender.agent_instance, from_class: sender.agent_class,
      archived: 'archive/review.md', source: `active/${recipient.agent_instance}/review.md`, completed_digest: sha256('done'),
    };
    const badReceipts = [
      { ...base, archived: 'archive/other.md' },
      { ...base, source: 'wrong/review.md' },
      { ...base, source: 'active/../review.md' },
      { ...base, completed_digest: 'invalid' },
    ];
    for (const receipt of badReceipts) {
      fs.writeFileSync(path, JSON.stringify(receipt));
      expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: false, reason: 'destination-conflict' });
    }
    fs.writeFileSync(path, JSON.stringify({ ...base, from_instance: 'not-sender' }));
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'published' });
    fs.writeFileSync(path, JSON.stringify({ ...base, outcome: null, completed_at: null }));
    fs.writeFileSync(join(p.root, 'archive/review.md'), 'done');
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'completed' });
    expect(publishedHandoffStatus(p, 'review.md', sender)).not.toHaveProperty('outcome');
    expect(publishedHandoffStatus(p, 'review.md', sender)).not.toHaveProperty('completed_at');
  });

  it('tracks claiming and rejects mismatched claim receipts or changed active content', () => {
    const p = fixture(); const publication = writePublication(p);
    const claimId = sha256('handoff/for-claude/review.md');
    const path = join(p.root, 'active', recipient.agent_instance, `${claimId}.receipt.json`);
    const receipt = {
      source: 'handoff/for-claude/review.md', digest: publication.digest,
      claimed_by: recipient.agent_instance, claimed_class: recipient.agent_class,
    };
    fs.writeFileSync(path, JSON.stringify({ ...receipt, digest: 'other' }));
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'published' });
    fs.writeFileSync(path, JSON.stringify(receipt));
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'claiming' });
    fs.writeFileSync(join(p.root, 'active', recipient.agent_instance, 'review.md'), 'tampered');
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: false, reason: 'destination-conflict' });
    fs.writeFileSync(join(p.root, 'active', recipient.agent_instance, 'review.md'), noteText);
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'claimed' });
  });

  it('rejects a replaced published note and never treats disappearance as completion', () => {
    const p = fixture(); writePublication(p);
    fs.writeFileSync(join(p.root, 'handoff/for-claude/review.md'), 'tampered');
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: false, reason: 'destination-conflict' });
    fs.rmSync(join(p.root, 'handoff/for-claude/review.md'));
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: true, status: 'publishing' });
    fs.rmSync(join(p.root, 'handoff/drafts/review.md'));
    expect(publishedHandoffStatus(p, 'review.md', sender)).toMatchObject({ ok: false, reason: 'destination-conflict' });
  });
});
