import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspectTarball, smokeTarballs } from '../../../../scripts/artifacts.mjs';
import { cleanEnvironment, execute } from '../../../../scripts/release.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
describe('SG-08 installed release artifacts', () => {
  it('refuses to certify a different runtime when a mismatched major is asserted', () => {
    const wrongMajor = process.versions.node.startsWith('22.') ? '24' : '22';
    expect(() => execute(process.execPath, ['scripts/consumer-runtime-smoke.mjs', process.execPath, wrongMajor], { cwd: root, env: process.env })).toThrow();
  }, 30000);
  it('packs exact workspace dependencies, inspects the archives, and runs an offline consumer journey', () => {
    const arena = fs.mkdtempSync(join(tmpdir(), 'agent-packed-'));
    try {
      const npmrc = join(arena, 'empty.npmrc'); fs.writeFileSync(npmrc, '');
      const env = cleanEnvironment(process.env, npmrc);
      const manifests = ['core', 'sdk', 'cli'].map(name => JSON.parse(fs.readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')));
      const versions = Object.fromEntries(manifests.map(m => [m.name, m.version]));
      const artifacts = manifests.map((pkg, i) => {
        execute('pnpm', ['--dir', join(root, 'packages', ['core', 'sdk', 'cli'][i]), 'pack', '--pack-destination', arena], { cwd: root, env });
        const file = join(arena, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
        return inspectTarball(file, { name: pkg.name, version: pkg.version, dependencies: Object.fromEntries(Object.keys(pkg.dependencies ?? {}).map(name => [name, versions[name]])) });
      });
      expect(artifacts).toHaveLength(3); artifacts.forEach(a => expect(a.sha256).toMatch(/^[a-f0-9]{64}$/));
      expect(artifacts[2].files).toContain('package/dist/race-worker.mjs');
      smokeTarballs(artifacts, arena, env, execute);
    } finally { fs.rmSync(arena, { recursive: true, force: true }); }
  }, 60000);
});
