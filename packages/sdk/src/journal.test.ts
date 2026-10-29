/** Copyright 2026 TRINORIS — Licensed under the Apache License, Version 2.0. */
import fs from 'node:fs';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendJournal, journalRecord, pruneJournal, readJournal } from './journal.js';

const made: string[] = [];
afterEach(() => { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function root() { const r = realpathSync(mkdtempSync(join(tmpdir(), 'journal-'))); made.push(r); return r; }
const codex = { agent_class: 'codex-gpt-6', agent_instance: 'codex-operate-live' };
const claude = { agent_class: 'claude-opus-5', agent_instance: 'claude-rename' };

describe('R3a journal', () => {
  // The question the journal exists to answer, and the one nothing could answer on
  // 2026-10-29: a peer took every scope minutes earlier and released them.
  it('retains which scopes a peer took and what it said it was doing', () => {
    const r = root();
    appendJournal(r, journalRecord(codex, 'acquire-many', new Date('2026-10-29T19:49:00Z'), { scopes: ['engine', 'webapp', 'tests'], task: 'migrating app display fields' }));
    appendJournal(r, journalRecord(codex, 'release', new Date('2026-10-29T20:04:00Z'), { scopes: ['tests'] }));
    const records = readJournal(r);
    expect(records).toHaveLength(2);
    expect(records[0].operation).toBe('release');            // most recent first
    expect(records[1].scopes).toEqual(['engine', 'webapp', 'tests']);
    expect(records[1].task).toBe('migrating app display fields');
  });

  it('filters by scope and by instance', () => {
    const r = root();
    appendJournal(r, journalRecord(codex, 'acquire', new Date('2026-10-29T10:00:00Z'), { scopes: ['engine'] }));
    appendJournal(r, journalRecord(claude, 'acquire', new Date('2026-10-29T10:01:00Z'), { scopes: ['webapp'] }));
    expect(readJournal(r, { scope: 'engine' }).map(x => x.agent_instance)).toEqual(['codex-operate-live']);
    expect(readJournal(r, { instance: 'claude-rename' }).map(x => x.scopes)).toEqual([['webapp']]);
  });

  it('records a refusal with its reason', () => {
    const r = root();
    appendJournal(r, journalRecord(claude, 'acquire-many', new Date('2026-10-29T10:00:00Z'), { scopes: ['engine'], outcome: 'refused', detail: 'held' }));
    expect(readJournal(r)[0]).toMatchObject({ outcome: 'refused', detail: 'held' });
  });

  // An aid, never a gate: a journal that could break a release would be worse than none.
  it('never throws when the journal cannot be written', () => {
    const r = root();
    fs.writeFileSync(join(r, 'journal'), 'not a directory');
    expect(() => appendJournal(r, journalRecord(codex, 'acquire', new Date()))).not.toThrow();
    expect(readJournal(r)).toEqual([]);
  });

  it('bounds task and detail, and strips control characters', () => {
    const r = root();
    appendJournal(r, journalRecord(codex, 'acquire', new Date('2026-10-29T10:00:00Z'), { task: `${'x'.repeat(900)}\n\u0007injected` }));
    const task = readJournal(r)[0].task ?? '';
    expect(task.length).toBeLessThanOrEqual(513);
    expect(task).not.toMatch(/[\u0000-\u001f]/);
  });

  it('drops day files past the retention bound', () => {
    const r = root();
    appendJournal(r, journalRecord(codex, 'acquire', new Date('2026-09-01T10:00:00Z')));
    appendJournal(r, journalRecord(codex, 'acquire', new Date('2026-10-29T10:00:00Z')));
    pruneJournal(r, new Date('2026-10-29T10:00:00Z'), 30);
    expect(fs.readdirSync(join(r, 'journal'))).toEqual(['2026-10-29.jsonl']);
  });

  it('skips an unparseable line rather than failing the read', () => {
    const r = root();
    appendJournal(r, journalRecord(codex, 'acquire', new Date('2026-10-29T10:00:00Z'), { scopes: ['engine'] }));
    fs.appendFileSync(join(r, 'journal/2026-10-29.jsonl'), '{ truncated\n');
    expect(readJournal(r)).toHaveLength(1);
  });

  it('caps how much it will return', () => {
    const r = root();
    for (let i = 0; i < 60; i++) appendJournal(r, journalRecord(codex, 'acquire', new Date('2026-10-29T10:00:00Z')));
    expect(readJournal(r, { last: 5 })).toHaveLength(5);
    expect(readJournal(r).length).toBeLessThanOrEqual(60);
  });
});
