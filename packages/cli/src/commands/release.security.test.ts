import { describe, expect, it } from 'vitest';
import { cleanEnvironment, parseReleaseArgs, commandInvocation, runRelease } from '../../../../scripts/release.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTarListing, validatePackedFiles } from '../../../../scripts/artifacts.mjs';
import { createSbom } from '../../../../scripts/release-inputs.mjs';

const expected = { name: '@trinoris/agent-core', version: '0.2.0', dependencies: {} };
const clean = () => [
  { name: 'package/package.json', type: 'file', content: JSON.stringify({ ...expected, engines: { node: '>=18.0.0' } }) },
  ...['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts'].map(n => ({ name: `package/dist/${n}`, type: 'file', content: 'export {};' })),
];
describe('SG-08 release credential and artifact boundary', () => {
  it('normalizes Windows tar output without accepting traversal paths', () => {
    expect(parseTarListing('package/package.json\r\npackage\\dist\\index.js\r\n')).toEqual([
      { name: 'package/package.json', rawName: 'package/package.json' },
      { name: 'package/dist/index.js', rawName: 'package\\dist\\index.js' },
    ]);
    expect(() => parseTarListing('package/../outside.txt\r\n')).toThrow(/Unsafe archive path/);
    expect(() => parseTarListing('package\\..\\outside.txt')).toThrow(/Unsafe archive path/);
    expect(() => parseTarListing('C:\\outside.txt')).toThrow(/Unsafe archive path/);
  });

  it('removes credentials and preload/config injection from gate processes', () => {
    const env = cleanEnvironment({ PATH: '/bin', NODE_AUTH_TOKEN: 'secret', AWS_ACCESS_KEY_ID: 'secret', GITHUB_TOKEN: 'secret', NODE_OPTIONS: '--require attacker', NPM_CONFIG_USERCONFIG: '/secret/.npmrc', HOME: '/home/publisher' }, '/tmp/empty-npmrc');
    expect(env).not.toHaveProperty('NODE_AUTH_TOKEN'); expect(env).not.toHaveProperty('AWS_ACCESS_KEY_ID'); expect(env).not.toHaveProperty('GITHUB_TOKEN'); expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env.NPM_CONFIG_USERCONFIG).toBe('/tmp/empty-npmrc'); expect(env.PATH).toBe('/bin');
  });
  it('rejects OTP arguments instead of placing credentials in process listings', () => {
    expect(() => parseReleaseArgs(['--otp=123456'])).toThrow(); expect(parseReleaseArgs(['--dry-run'])).toEqual({ dryRun: true });
  });
  it('blocks dirty real releases before install, test, or publish can run', () => {
    const calls: string[] = [];
    const run = (command: string, args: string[]) => { calls.push(`${command} ${args[0]}`); if (command === 'git' && args[0] === 'rev-parse') return 'reviewed-commit'; if (command === 'git' && args[0] === 'status') return ' M unreviewed-source'; throw new Error('Unexpected executable'); };
    expect(() => runRelease([], fileURLToPath(new URL('../../../../', import.meta.url)), run)).toThrow(/clean reviewed/);
    expect(calls).toEqual(['git rev-parse', 'git status']);
  });
  it('retains a machine-readable inventory including patched tools and integrity hashes', () => {
    const bom = createSbom(fileURLToPath(new URL('../../../../', import.meta.url)));
    expect(bom.bomFormat).toBe('CycloneDX');
    expect(bom.components).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'turbo', version: '2.9.14' })]));
    expect(bom.components.some(c => c.hashes?.some(h => h.alg === 'SHA-512' && /^[a-f0-9]{128}$/.test(h.content)))).toBe(true);
  });
  it('runs Windows package-manager JS entry points without shell interpolation', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-tool-shim-'));
    try {
      const entry = join(root, 'node_modules/pnpm/bin/pnpm.cjs'); mkdirSync(join(root, 'node_modules/pnpm/bin'), { recursive: true }); writeFileSync(entry, '// trusted installed CLI');
      const result = commandInvocation('pnpm', ['pack', 'path with & shell metacharacters'], { PATH: root }, 'win32');
      expect(result.command).toBe(process.execPath); expect(result.args).toEqual([entry, 'pack', 'path with & shell metacharacters']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it.each(['package/.env', 'package/dist/index.js.map', 'package/../../escape', 'package/dist/key.pem'])('rejects unexpected packed member %s', name => {
    expect(() => validatePackedFiles([...clean(), { name, type: 'file', content: 'unexpected' }], expected)).toThrow();
  });
  it('rejects links, embedded secrets, unresolved workspace dependencies, and missing entries', () => {
    expect(() => validatePackedFiles([...clean(), { name: 'package/dist/bin.js', type: 'symlink', content: '' }], expected)).toThrow();
    const secret = clean(); secret[1].content = '-----BEGIN PRIVATE KEY-----'; expect(() => validatePackedFiles(secret, expected)).toThrow();
    const unresolved = clean(); unresolved[0].content = JSON.stringify({ ...expected, dependencies: { '@trinoris/agent-sdk': 'workspace:*' } });
    expect(() => validatePackedFiles(unresolved, expected)).toThrow();
    expect(() => validatePackedFiles(clean().filter(f => !f.name.endsWith('index.cjs')), expected)).toThrow();
    expect(() => validatePackedFiles(clean(), expected)).not.toThrow();
  });
});
