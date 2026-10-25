/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

export function validatePackedFiles(files, expected) {
  const names = new Set();
  for (const file of files) {
    if (names.has(file.name) || file.type !== 'file' || !/^package\/(?:package\.json|README(?:\.md)?|LICENSE(?:\.md)?|dist\/(?:index|bin)\.(?:js|cjs|d\.ts|d\.cts))$/i.test(file.name)) throw new Error('Unexpected or linked packed member');
    names.add(file.name);
    if (file.content.length > 1_000_000 || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\bnpm_[A-Za-z0-9]{30,}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\/mnt\/[a-z]\/[Uu]sers\//.test(file.content)) throw new Error('Sensitive or oversized packed content');
  }
  for (const name of ['package.json', 'dist/index.js', 'dist/index.cjs', 'dist/index.d.ts', 'dist/index.d.cts']) if (!names.has(`package/${name}`)) throw new Error(`Missing packed entry: ${name}`);
  const pkg = JSON.parse(files.find(f => f.name === 'package/package.json').content);
  if (pkg.name !== expected.name || pkg.version !== expected.version || !isDeepStrictEqual(pkg.dependencies ?? {}, expected.dependencies) || pkg.engines?.node !== '>=18.0.0') throw new Error('Packed manifest does not match reviewed versions/dependencies/runtime');
  if (['prepack', 'prepare', 'prepublish', 'prepublishOnly', 'postpublish', 'install', 'postinstall'].some(k => pkg.scripts?.[k])) throw new Error('Packed lifecycle hook');
  if (expected.name === '@trinoris/agent-cli' && !names.has('package/dist/bin.js')) throw new Error('Missing CLI executable');
  return pkg;
}

export function inspectTarball(path, expected) {
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 20_000_000) throw new Error('Unsafe artifact');
  const tar = args => execFileSync('tar', args, { encoding: 'utf8', maxBuffer: 2_000_000 });
  const listing = tar(['-tzf', path]).trim().split('\n');
  const verbose = tar(['-tvzf', path]).trim().split('\n');
  if (listing.length > 40 || verbose.some(line => !line.startsWith('-'))) throw new Error('Unexpected archive type or size');
  const files = listing.map(name => {
    if (!/^package\/[A-Za-z0-9./_-]+$/.test(name) || name.split('/').includes('..')) throw new Error('Unsafe archive path');
    return { name, type: 'file', content: tar(['-xOf', path, name]) };
  });
  const manifest = validatePackedFiles(files, expected);
  return { path, name: manifest.name, version: manifest.version, sha256: createHash('sha256').update(fs.readFileSync(path)).digest('hex'), files: listing };
}

export function smokeTarballs(artifacts, arena, env, run, consumerNode = process.execPath) {
  const consumer = join(arena, 'consumer'); fs.mkdirSync(consumer);
  fs.writeFileSync(join(consumer, 'package.json'), '{"name":"local-release-consumer","version":"1.0.0","private":true,"type":"module"}\n');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...artifacts.map(a => a.path)], { cwd: consumer, env });
  const bin = join(consumer, 'node_modules/@trinoris/agent-cli/dist/bin.js');
  const work = join(arena, 'consumer-workspace'); fs.mkdirSync(work);
  run(consumerNode, [bin, '--help'], { cwd: consumer, env });
  run(consumerNode, [bin, 'setup', '--work-dir', work, '--json'], { cwd: consumer, env });
  run(consumerNode, [bin, 'verify', '--work-dir', work, '--trials', '1', '--concurrency', '2', '--json'], { cwd: consumer, env });
}
