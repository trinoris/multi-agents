/** Copyright 2026 TRINORIS — Licensed under the Apache License, Version 2.0. */
import fs from 'node:fs';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearGlobalEntry, globalRoot, publishGlobalEntry, readGlobalRegistry } from './global-registry.js';

const made: string[] = [];
let previous: string | undefined;
beforeEach(() => { previous = process.env.TRINORIS_GLOBAL_DIR; const r = realpathSync(mkdtempSync(join(tmpdir(), 'global-'))); made.push(r); process.env.TRINORIS_GLOBAL_DIR = r; });
afterEach(() => {
  if (previous === undefined) delete process.env.TRINORIS_GLOBAL_DIR; else process.env.TRINORIS_GLOBAL_DIR = previous;
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const at = '2026-10-29T19:49:00.000Z';

describe('R3b machine-global registry', () => {
  // The blindness this exists to remove: a nine-repo wave where no instance could see a
  // peer active in another checkout.
  it('shows an instance in one repository to an instance in another', () => {
    publishGlobalEntry({ repository: '/work/trinoris-control-tower', agent_class: 'codex-gpt-6', agent_instance: 'codex-operate-live', scopes: ['engine', 'webapp'], task: 'operate redesign', updated_at: at });
    publishGlobalEntry({ repository: '/work/trinoris-templates', agent_class: 'claude-opus-5', agent_instance: 'claude-rename', scopes: ['specs'], updated_at: '2026-10-29T19:50:00.000Z' });
    const view = readGlobalRegistry();
    expect(view.entries.map(e => e.agent_instance)).toEqual(['claude-rename', 'codex-operate-live']); // newest first
    expect(view.entries[1]).toMatchObject({ scopes: ['engine', 'webapp'], task: 'operate redesign' });
  });

  it('replaces a repository entry rather than accumulating', () => {
    for (const scopes of [['engine'], ['engine', 'tests'], ['tests']]) {
      publishGlobalEntry({ repository: '/work/one', agent_class: 'c', agent_instance: 'i', scopes, updated_at: at });
    }
    const view = readGlobalRegistry();
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].scopes).toEqual(['tests']);
  });

  it('keeps concurrent agents in one repository independently visible', () => {
    publishGlobalEntry({ repository: '/work/one', agent_class: 'codex', agent_instance: 'a', scopes: ['engine'], updated_at: at });
    publishGlobalEntry({ repository: '/work/one', agent_class: 'claude', agent_instance: 'b', scopes: ['tests'], updated_at: at });
    publishGlobalEntry({ repository: '/work/one', agent_class: 'codex', agent_instance: 'a', scopes: [], updated_at: at });
    expect(readGlobalRegistry().entries.map(e => e.agent_instance)).toEqual(['b']);
  });

  it('removes the entry when nothing is held, instead of leaving it stale', () => {
    publishGlobalEntry({ repository: '/work/one', agent_class: 'c', agent_instance: 'i', scopes: ['engine'], updated_at: at });
    publishGlobalEntry({ repository: '/work/one', agent_class: 'c', agent_instance: 'i', scopes: [], updated_at: at });
    expect(readGlobalRegistry().entries).toEqual([]);
  });

  it('clears explicitly', () => {
    publishGlobalEntry({ repository: '/work/one', agent_class: 'c', agent_instance: 'i', scopes: ['engine'], updated_at: at });
    clearGlobalEntry('/work/one');
    expect(readGlobalRegistry().entries).toEqual([]);
  });

  // Advisory: it must never become a gate, so every failure path is silent and lossy
  // rather than throwing into the lease operation that triggered it.
  it('never throws when the registry cannot be written', () => {
    writeFileSync(join(globalRoot(), 'registry'), 'not a directory');
    expect(() => publishGlobalEntry({ repository: '/work/one', agent_class: 'c', agent_instance: 'i', scopes: ['engine'], updated_at: at })).not.toThrow();
    expect(readGlobalRegistry().entries).toEqual([]);
  });

  it('counts a malformed entry instead of failing the read', () => {
    publishGlobalEntry({ repository: '/work/one', agent_class: 'c', agent_instance: 'i', scopes: ['engine'], updated_at: at });
    writeFileSync(join(globalRoot(), 'registry', 'bogus.json'), '{ truncated');
    writeFileSync(join(globalRoot(), 'registry', 'wrong-version.json'), JSON.stringify({ schema_version: 99 }));
    writeFileSync(join(globalRoot(), 'registry', 'missing-time.json'), JSON.stringify({ schema_version: 1, repository: '/work/x', agent_class: 'c', agent_instance: 'i', scopes: [] }));
    const view = readGlobalRegistry();
    expect(view.entries).toHaveLength(1);
    expect(view.unreadable).toBe(3);
  });

  it('reports an empty view when no registry exists yet', () => {
    const view = readGlobalRegistry();
    expect(view).toMatchObject({ entries: [], unreadable: 0 });
    expect(view.root).toBe(globalRoot());
  });

  it('bounds the recorded scope list', () => {
    publishGlobalEntry({ repository: '/work/one', agent_class: 'c', agent_instance: 'i', scopes: Array(200).fill('engine'), updated_at: at });
    expect(readGlobalRegistry().entries[0].scopes).toHaveLength(64);
  });
});
