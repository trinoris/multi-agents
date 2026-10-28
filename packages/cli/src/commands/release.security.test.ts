import { describe, expect, it } from 'vitest';
import { cleanEnvironment, parseReleaseArgs, commandInvocation, runRelease } from '../../../../scripts/release.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTarListing, validatePackedFiles } from '../../../../scripts/artifacts.mjs';
import { createSbom } from '../../../../scripts/release-inputs.mjs';

const expected = { name: '@trinoris/agent-core', version: '0.2.0', dependencies: {} };
const clean = () => [
  { name: 'package/package.json', type: 'file', content: JSON.stringify({ ...expected, engines: { node: '>=22.0.0' } }) },
  ...['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts'].map(n => ({ name: `package/dist/${n}`, type: 'file', content: 'export {};' })),
];
describe('SG-08 release credential and artifact boundary', () => {
  it('retains failed test stdout and stderr in the dry-run evidence bundle', () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const outputRoot = join(root, '.release-artifacts'); mkdirSync(outputRoot, { recursive: true });
    const before = new Set(readdirSync(outputRoot));
    const pnpmVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager.split('@')[1];
    const run = (command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'rev-parse') return 'fixture-commit';
      if (command === 'git' && args[0] === 'status') return '';
      if (command === 'git' && args[0] === 'diff') return '';
      if (command === 'pnpm' && args[0] === '--version') return pnpmVersion;
      if (command === 'pnpm' && args[0] === 'install') return '';
      if (command === 'pnpm' && args[0] === 'audit') return JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } });
      if (command === 'pnpm' && args[0] === 'run' && args[1] === 'test') {
        throw Object.assign(new Error('simulated test failure'), { stdout: Buffer.from('TEST_STDOUT\n'), stderr: Buffer.from('TEST_STDERR\n') });
      }
      throw new Error(`Unexpected release command: ${command} ${args.join(' ')}`);
    };
    try {
      expect(() => runRelease(['--dry-run'], root, run)).toThrow(/simulated test failure/);
      const created = readdirSync(outputRoot).filter(name => !before.has(name));
      expect(created).toHaveLength(1);
      const dir = join(outputRoot, created[0]);
      expect(readFileSync(join(dir, 'tests.log'), 'utf8')).toContain('TEST_STDOUT');
      expect(readFileSync(join(dir, 'tests.log'), 'utf8')).toContain('TEST_STDERR');
      expect(JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'))).toMatchObject({ status: 'failed', published: [] });
      rmSync(dir, { recursive: true, force: true });
    } finally {
      for (const name of readdirSync(outputRoot)) if (!before.has(name)) rmSync(join(outputRoot, name), { recursive: true, force: true });
    }
  });

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
  it('checks npm authentication before install, tests, build, or pack on real releases', () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const outputRoot = join(root, '.release-artifacts'); mkdirSync(outputRoot, { recursive: true });
    const before = new Set(readdirSync(outputRoot));
    const pnpmVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager.split('@')[1];
    const calls: string[] = [];
    const run = (command: string, args: string[]) => {
      calls.push(`${command} ${args.join(' ')}`);
      if (command === 'git' && args[0] === 'rev-parse') return 'fixture-commit';
      if (command === 'git' && args[0] === 'status') return '';
      if (command === 'git' && args[0] === 'diff') return '';
      if (command === 'pnpm' && args[0] === '--version') return pnpmVersion;
      if (command === 'npm' && args[0] === 'whoami') throw new Error('simulated unauthenticated npm');
      throw new Error(`Unexpected release command: ${command} ${args.join(' ')}`);
    };
    try {
      expect(() => runRelease([], root, run)).toThrow(/npm authentication is missing or expired.*npm login/);
      expect(calls.at(-1)).toBe('npm whoami --registry https://registry.npmjs.org/');
      expect(calls.some(call => call.startsWith('pnpm install'))).toBe(false);
      expect(calls.some(call => call.includes(' test'))).toBe(false);
      expect(calls.some(call => call.startsWith('pnpm publish'))).toBe(false);
      const created = readdirSync(outputRoot).filter(name => !before.has(name));
      expect(created).toHaveLength(1);
      expect(JSON.parse(readFileSync(join(outputRoot, created[0], 'release.json'), 'utf8'))).toMatchObject({ status: 'failed', published: [] });
    } finally {
      for (const name of readdirSync(outputRoot)) if (!before.has(name)) rmSync(join(outputRoot, name), { recursive: true, force: true });
    }
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
