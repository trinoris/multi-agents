/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
import fs from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
export function safePath(root: string, target = root): fs.Stats | null {
  root = resolve(root); target = resolve(target);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path escapes selected root');
  const base = parse(target).root; let current = base;
  const segments = target.slice(base.length).split(sep).filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    current = join(current, segments[i]);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); } catch (e) { if (missing(e)) return null; throw e; }
    if (stat.isSymbolicLink()) throw new Error('Symlink or junction paths are unsupported');
    if (i < segments.length - 1 && !stat.isDirectory()) throw new Error('Non-directory path ancestor');
    if (i === segments.length - 1) return stat;
  }
  return fs.lstatSync(base);
}
export function directory(root: string, path = root): void {
  if (!safePath(root, root)?.isDirectory()) throw new Error('Selected root must be an existing safe directory');
  const parts = relative(resolve(root), resolve(path)).split(sep).filter(Boolean); let current = resolve(root);
  safePath(root, path);
  for (const part of parts) {
    current = join(current, part);
    if (!safePath(root, current)) { try { fs.mkdirSync(current, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; } }
    if (!safePath(root, current)?.isDirectory()) throw new Error('Expected a safe directory');
  }
}
export function readText(root: string, path: string, maxBytes = 65536): string | null {
  const stat = safePath(root, path); if (!stat) return null;
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error('Expected bounded regular file with one link');
  const fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > maxBytes || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error('File changed during inspection');
    // Bounded reads also protect against a file growing after fstat.
    const buffer = Buffer.alloc(maxBytes + 1); let length = 0;
    while (length < buffer.length) { const n = fs.readSync(fd, buffer, length, buffer.length - length, null); if (!n) break; length += n; }
    if (length > maxBytes) throw new Error('File exceeds size limit');
    return buffer.subarray(0, length).toString('utf8');
  } finally { fs.closeSync(fd); }
}
export function writeAtomic(root: string, path: string, content: string, exclusive = false, mode = 0o600): void {
  directory(root, dirname(path));
  const existing = safePath(root, path);
  if (existing && (!existing.isFile() || existing.nlink !== 1)) throw new Error('Refusing unsafe overwrite');
  if (exclusive && existing) throw Object.assign(new Error('Destination exists'), { code: 'EEXIST' });
  const temp = join(dirname(path), `.write-${randomUUID()}`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temp, 'wx', mode); fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    safePath(root, path); fs.renameSync(temp, path);
  } finally { if (fd !== undefined) fs.closeSync(fd); if (safePath(root, temp)) fs.unlinkSync(temp); }
}
export function jsonFile(root: string, path: string, value: unknown, exclusive = false): void { writeAtomic(root, path, JSON.stringify(value, null, 2) + '\n', exclusive); }
export function removeOwnedDirectory(root: string, path: string): void {
  if (!safePath(root, path)?.isDirectory()) throw new Error('Refusing cleanup of unsafe directory');
  fs.rmSync(path, { recursive: true, force: false });
}
