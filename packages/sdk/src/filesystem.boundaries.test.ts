import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { directory, jsonFile, missing, readText, removeOwnedDirectory, safePath, writeAtomic } from './filesystem.js';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'agent-sdk-fs-'));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('filesystem boundary helpers', () => {
  it('distinguishes missing files and rejects root escapes and non-directory ancestors', () => {
    const root = fixture();
    expect(missing(Object.assign(new Error(), { code: 'ENOENT' }))).toBe(true);
    expect(missing(Object.assign(new Error(), { code: 'EACCES' }))).toBe(false);
    expect(safePath(root, join(root, 'absent'))).toBeNull();
    expect(() => safePath(root, join(root, '..', 'outside'))).toThrow(/escapes/i);
    fs.writeFileSync(join(root, 'file'), 'data');
    expect(() => safePath(root, join(root, 'file', 'child'))).toThrow(/ancestor/i);
    expect(safePath(root, root)?.isDirectory()).toBe(true);
  });

  it('creates nested safe directories but refuses an invalid root and existing files', () => {
    const root = fixture();
    directory(root, join(root, 'nested', 'child'));
    expect(fs.statSync(join(root, 'nested', 'child')).isDirectory()).toBe(true);
    const file = join(root, 'plain-file'); fs.writeFileSync(file, 'x');
    expect(() => directory(root, join(file, 'child'))).toThrow();
    expect(() => directory(join(root, 'missing-root'), join(root, 'missing-root', 'child'))).toThrow(/root/i);
  });

  it('reads only bounded regular files and returns null for absent paths', () => {
    const root = fixture();
    expect(readText(root, join(root, 'absent'))).toBeNull();
    const file = join(root, 'record'); fs.writeFileSync(file, 'hello');
    expect(readText(root, file, 5)).toBe('hello');
    expect(() => readText(root, file, 4)).toThrow(/bounded/i);
    expect(() => readText(root, root)).toThrow(/bounded/i);
  });

  it('writes atomically, supports exclusive create, and refuses unsafe replacement', () => {
    const root = fixture(); const file = join(root, 'nested', 'record.json');
    jsonFile(root, file, { first: true });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ first: true });
    expect(() => writeAtomic(root, file, 'second', true)).toThrow(/exists/i);
    writeAtomic(root, file, 'updated');
    expect(fs.readFileSync(file, 'utf8')).toBe('updated');
    const linkTarget = join(root, 'target'); fs.writeFileSync(linkTarget, 'keep');
    const linked = join(root, 'linked'); fs.symlinkSync(linkTarget, linked);
    expect(() => writeAtomic(root, linked, 'replace')).toThrow();
    expect(fs.readFileSync(linkTarget, 'utf8')).toBe('keep');
  });

  it('removes only an existing safe directory', () => {
    const root = fixture(); const child = join(root, 'owned'); fs.mkdirSync(child);
    removeOwnedDirectory(root, child);
    expect(fs.existsSync(child)).toBe(false);
    expect(() => removeOwnedDirectory(root, child)).toThrow(/unsafe directory/i);
    const file = join(root, 'file'); fs.writeFileSync(file, 'keep');
    expect(() => removeOwnedDirectory(root, file)).toThrow(/unsafe directory/i);
  });
});
