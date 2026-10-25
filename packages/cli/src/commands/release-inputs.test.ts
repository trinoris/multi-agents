import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RELEASE_PACKAGE_SPECS, validatePackageManifest, validateReleaseInputs } from '../../../../scripts/release-inputs.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('release input integrity', () => {
  it('accepts the checked-in package manifests and pnpm lockfile', () => {
    expect(validateReleaseInputs(ROOT)).toEqual([]);
  });

  it('rejects lifecycle scripts that could execute injected publish-time code', () => {
    const spec = RELEASE_PACKAGE_SPECS.find(item => item.directory === 'cli')!;
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8'));
    manifest.scripts.prepack = 'node ./unexpected-upload.mjs';

    expect(validatePackageManifest(manifest, spec)).toEqual(expect.arrayContaining([
      expect.stringContaining('unexpected build or lifecycle command'),
    ]));
  });

  it('rejects added runtime or development dependencies not reviewed in the release manifest', () => {
    const spec = RELEASE_PACKAGE_SPECS.find(item => item.directory === 'sdk')!;
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages/sdk/package.json'), 'utf8'));
    manifest.dependencies['attacker/package'] = 'https://example.invalid/attacker.tgz';

    expect(validatePackageManifest(manifest, spec)).toEqual(expect.arrayContaining([
      expect.stringContaining('runtime dependencies'),
    ]));
  });

  it('rejects a redirected registry and a broadened package file allow-list', () => {
    const spec = RELEASE_PACKAGE_SPECS.find(item => item.directory === 'cli')!;
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8'));
    manifest.publishConfig.registry = 'https://registry.attacker.invalid/';
    manifest.files.push('scripts');

    const errors = validatePackageManifest(manifest, spec);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('publish target'),
      expect.stringContaining('publish allow-list'),
    ]));
  });

  it('rejects unreviewed manifest fields that can alter install or publish behavior', () => {
    const spec = RELEASE_PACKAGE_SPECS.find(item => item.directory === 'cli')!;
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8'));
    manifest.optionalDependencies = { 'attacker/package': 'https://example.invalid/attacker.tgz' };

    expect(validatePackageManifest(manifest, spec)).toEqual(expect.arrayContaining([
      expect.stringContaining('unexpected manifest fields: optionalDependencies'),
    ]));
  });

  it('rejects a malformed package version before using it in a registry lookup', () => {
    const spec = RELEASE_PACKAGE_SPECS.find(item => item.directory === 'cli')!;
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8'));
    manifest.version = '0.1.2; npm publish attacker';

    expect(validatePackageManifest(manifest, spec)).toEqual(expect.arrayContaining([
      expect.stringContaining('valid numeric semver version'),
    ]));
  });

  it('rejects non-semver numeric components with leading zeroes', () => {
    const spec = RELEASE_PACKAGE_SPECS.find(item => item.directory === 'cli')!;
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8'));
    manifest.version = '00.1.1';

    expect(validatePackageManifest(manifest, spec)).toEqual(expect.arrayContaining([
      expect.stringContaining('valid numeric semver version'),
    ]));
  });

  it('keeps manifest validation, frozen install, audit, and tests ahead of release builds and publish', () => {
    const script = readFileSync(join(ROOT, 'scripts/release.mjs'), 'utf8');
    const gates = [
      'validateReleaseInputs(root)',
      "gate('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile'])",
      "gate('pnpm', ['audit', '--audit-level=high', '--json'])",
      "gate('pnpm', ['run', 'test', '--force'])",
      "gate('npm', ['view'",
      "gate('pnpm', ['run', 'build', '--force'])",
      'smokeTarballs(report.artifacts',
      "run('pnpm', ['publish', artifact.path",
    ].map(token => script.indexOf(token));

    expect(gates.every(position => position >= 0)).toBe(true);
    expect(gates).toEqual([...gates].sort((a, b) => a - b));
    const executableLines = script.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n');
    expect(executableLines).not.toMatch(/\bnpm\s+publish\b/);
  });

  it.each(['.pnpmfile.cjs', '.npmrc', 'extra-workspace', 'redirected-lock'])('SG-08 rejects unreviewed release input %s', kind => {
    const root = mkdtempSync(join(tmpdir(), 'agent-release-inputs-'));
    try {
      for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json']) copyFileSync(join(ROOT, name), join(root, name));
      for (const name of ['core', 'sdk', 'cli']) {
        mkdirSync(join(root, 'packages', name), { recursive: true });
        for (const file of ['package.json', 'tsup.config.ts']) copyFileSync(join(ROOT, 'packages', name, file), join(root, 'packages', name, file));
      }
      if (kind === 'extra-workspace') { mkdirSync(join(root, 'packages/attacker')); writeFileSync(join(root, 'packages/attacker/package.json'), '{}'); }
      else if (kind === 'redirected-lock') writeFileSync(join(root, 'pnpm-lock.yaml'), readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8').replace('resolution: {integrity:', 'resolution: {tarball: "https://example.invalid/package.tgz", integrity:'));
      else writeFileSync(join(root, kind), kind === '.npmrc' ? 'registry=https://example.invalid/' : 'module.exports={hooks:{}}');
      expect(validateReleaseInputs(root).length).toBeGreaterThan(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
