/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEnvironment, execute } from './release.mjs';
import { inspectTarball, smokeTarballs } from './artifacts.mjs';
import { RELEASE_PACKAGE_SPECS } from './release-inputs.mjs';

// Keep build/npm tooling on the supported host, and run the installed consumer
// with the explicitly selected binary. No package is published or globally installed.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const consumerNode = process.argv[2] ? resolve(process.argv[2]) : process.execPath;
const arena = fs.mkdtempSync(join(tmpdir(), 'trinoris-runtime-consumer-'));
try {
  const npmrc = join(arena, 'empty.npmrc'); fs.writeFileSync(npmrc, '', { mode: 0o600 });
  const env = cleanEnvironment(process.env, npmrc);
  const version = execute(consumerNode, ['--version'], { cwd: root, env }).trim();
  const expectedMajor = process.argv[3];
  if (expectedMajor !== undefined && (!/^[1-9][0-9]*$/.test(expectedMajor) || !version.startsWith(`v${expectedMajor}.`))) throw new Error('Consumer runtime version does not match the requested acceptance target');
  const manifests = RELEASE_PACKAGE_SPECS.map(s => JSON.parse(fs.readFileSync(join(root, 'packages', s.directory, 'package.json'), 'utf8')));
  const versions = Object.fromEntries(manifests.map(m => [m.name, m.version]));
  const artifacts = RELEASE_PACKAGE_SPECS.map((spec, i) => {
    const pkg = manifests[i];
    execute('pnpm', ['--dir', join(root, 'packages', spec.directory), 'pack', '--pack-destination', arena], { cwd: root, env });
    return inspectTarball(join(arena, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`), { name: pkg.name, version: pkg.version, dependencies: Object.fromEntries(Object.keys(pkg.dependencies ?? {}).map(n => [n, versions[n]])) });
  });
  smokeTarballs(artifacts, arena, env, execute, consumerNode);
  console.log(`Installed consumer passed on ${version}`);
} finally { fs.rmSync(arena, { recursive: true, force: true }); }
