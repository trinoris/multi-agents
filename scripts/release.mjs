/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { validateReleaseInputs, createSbom, RELEASE_PACKAGE_SPECS } from './release-inputs.mjs';
import { inspectTarball, smokeTarballs } from './artifacts.mjs';

export function parseReleaseArgs(args) {
  if (args.some(a => a !== '--dry-run') || args.length > 1) throw new Error('Usage: scripts/release.sh [--dry-run]. OTP arguments are unsupported; use npm login or a restricted publishing credential.');
  return { dryRun: args.includes('--dry-run') };
}
export function cleanEnvironment(env, npmrc) {
  const clean = Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM'].filter(k => env[k] !== undefined).map(k => [k, env[k]]));
  return { ...clean, HOME: dirname(npmrc), USERPROFILE: dirname(npmrc), XDG_CONFIG_HOME: join(dirname(npmrc), '.config'), CI: 'true', NPM_CONFIG_USERCONFIG: npmrc, npm_config_userconfig: npmrc, npm_config_ignore_scripts: 'true', NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/', TURBO_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };
}
function createPublishEnvironment(gateEnv, arena, sourceEnv = process.env) {
  const publishEnv = { ...gateEnv };
  const token = sourceEnv.NODE_AUTH_TOKEN || sourceEnv.NPM_REGISTRY_TOKEN;
  if (token) {
    const auth = join(arena, 'publish.npmrc');
    fs.writeFileSync(auth, '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n', { mode: 0o600 });
    publishEnv.NODE_AUTH_TOKEN = token;
    publishEnv.NPM_CONFIG_USERCONFIG = auth;
    publishEnv.npm_config_userconfig = auth;
  } else {
    // npm login credentials are visible only to the trusted whoami/publish process.
    publishEnv.HOME = sourceEnv.HOME;
    publishEnv.USERPROFILE = sourceEnv.USERPROFILE;
    delete publishEnv.NPM_CONFIG_USERCONFIG;
    delete publishEnv.npm_config_userconfig;
  }
  return publishEnv;
}
export function commandInvocation(command, args, env = process.env, platform = process.platform) {
  if (platform !== 'win32' || !['npm', 'pnpm'].includes(command)) return { command, args };
  const suffix = command === 'npm' ? 'npm-cli.js' : 'pnpm.cjs';
  const candidates = [];
  if (command === 'pnpm' && env.npm_execpath?.endsWith('pnpm.cjs')) candidates.push(env.npm_execpath);
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    candidates.push(join(dir, 'node_modules', command, 'bin', suffix), join(dir, '..', command, 'bin', suffix));
    if (command === 'pnpm') candidates.push(join(dir, 'node_modules/corepack/dist/pnpm.js'));
  }
  const script = candidates.find(path => fs.existsSync(path));
  if (!script) throw new Error(`Cannot find trusted ${command} JavaScript entry point`);
  return { command: process.execPath, args: [script, ...args] };
}
export function execute(command, args, options) {
  const invocation = commandInvocation(command, args, options?.env);
  return execFileSync(invocation.command, invocation.args, { encoding: 'utf8', stdio: 'pipe', maxBuffer: 8_000_000, ...options });
}
function commandOutput(error) {
  const output = error && typeof error === 'object' ? error : {};
  const text = value => Buffer.isBuffer(value) ? value.toString('utf8') : typeof value === 'string' ? value : '';
  const streams = Array.isArray(output.output) ? output.output : [];
  return `${text(output.stdout ?? streams[1])}${text(output.stderr ?? streams[2])}`;
}
export function runRelease(args, root = dirname(dirname(fileURLToPath(import.meta.url))), run = execute) {
  const { dryRun } = parseReleaseArgs(args);
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ is required for release tooling');
  const errors = validateReleaseInputs(root); if (errors.length) throw new Error(errors.join('\n'));
  const arena = fs.mkdtempSync(join(tmpdir(), 'trinoris-release-'));
  const npmrc = join(arena, 'empty.npmrc'); fs.writeFileSync(npmrc, '', { mode: 0o600 });
  let outputDir; let report;
  try {
    const env = cleanEnvironment(process.env, npmrc);
    const gate = (command, args, options = {}) => run(command, args, { cwd: root, env, ...options });
    report = { status: 'running', started_at: new Date().toISOString(), dry_run: dryRun, source: gate('git', ['rev-parse', 'HEAD']).trim(), artifacts: [], published: [] };
    const dirty = gate('git', ['status', '--porcelain']).trim();
    if (dirty && !dryRun) throw new Error('Real release requires a clean reviewed source snapshot; commit changes first');
    report.dirty_snapshot = !!dirty;
    report.diff_sha256 = createHash('sha256').update(gate('git', ['diff', '--no-ext-diff', '--no-textconv', 'HEAD'])).digest('hex');
    const expectedPnpm = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).packageManager.split('@')[1];
    if (gate('pnpm', ['--version']).trim() !== expectedPnpm) throw new Error(`Release requires pnpm ${expectedPnpm}`);
    outputDir = join(root, '.release-artifacts', arena.split(/[\\/]/).pop()); fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(join(outputDir, 'sbom.json'), JSON.stringify(createSbom(root), null, 2) + '\n');
    const publishEnv = createPublishEnvironment(env, arena);
    if (!dryRun) {
      try {
        run('npm', ['whoami', '--registry', 'https://registry.npmjs.org/'], { cwd: root, env: publishEnv });
      } catch {
        throw new Error('npm authentication is missing or expired. Run `npm login --registry=https://registry.npmjs.org/` (or configure NODE_AUTH_TOKEN) before a real release.');
      }
    }
    console.log('Installing from the frozen lockfile without lifecycle scripts or pnpmfile hooks...');
    gate('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile']);
    console.log('Auditing dependencies; high and critical block release...');
    const audit = gate('pnpm', ['audit', '--audit-level=high', '--json']);
    fs.writeFileSync(join(outputDir, 'audit.json'), audit);
    console.log('Running uncached package tests and integration journeys...');
    const testsLog = join(outputDir, 'tests.log');
    try { fs.writeFileSync(testsLog, gate('pnpm', ['run', 'test', '--force'])); }
    catch (error) {
      fs.writeFileSync(testsLog, commandOutput(error));
      throw error;
    }
    const manifests = RELEASE_PACKAGE_SPECS.map(s => JSON.parse(fs.readFileSync(join(root, 'packages', s.directory, 'package.json'), 'utf8')));
    const versions = Object.fromEntries(manifests.map(p => [p.name, p.version]));
    const pending = [];
    for (const pkg of manifests) {
      try { gate('npm', ['view', `${pkg.name}@${pkg.version}`, 'version', '--json', '--fetch-retries=0', '--fetch-timeout=10000']); }
      catch (error) {
        let code;
        try { code = JSON.parse(String(error.stdout)).error?.code; } catch { /* Network errors must not be interpreted as unpublished versions. */ }
        if (code !== 'E404') throw error;
        pending.push(pkg.name);
      }
    }
    console.log('Building, packing, inspecting, and consumer-testing the exact release bytes...');
    gate('pnpm', ['run', 'build', '--force']);
    for (const [index, spec] of RELEASE_PACKAGE_SPECS.entries()) {
      const pkg = manifests[index];
      gate('pnpm', ['--dir', join(root, 'packages', spec.directory), 'pack', '--pack-destination', outputDir]);
      const path = join(outputDir, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
      const dependencies = Object.fromEntries(Object.keys(pkg.dependencies ?? {}).map(name => [name, versions[name]]));
      report.artifacts.push(inspectTarball(path, { name: pkg.name, version: pkg.version, dependencies }));
    }
    smokeTarballs(report.artifacts, arena, env, run);
    if (!dryRun && gate('git', ['status', '--porcelain']).trim()) throw new Error('Source changed during release gates');
    // Only publication receives the caller's npm configuration/credential. No OTP argv.
    for (const artifact of report.artifacts.filter(a => pending.includes(a.name))) {
      const bytes = fs.readFileSync(artifact.path);
      if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Artifact changed after validation');
      if (dryRun) continue;
      run('pnpm', ['publish', artifact.path, '--registry', 'https://registry.npmjs.org/', '--access', 'public', '--ignore-scripts'], { cwd: arena, env: publishEnv, stdio: 'inherit' });
      report.published.push(`${artifact.name}@${artifact.version}`);
      fs.writeFileSync(join(outputDir, 'release.json'), JSON.stringify(report, null, 2) + '\n');
    }
    console.log(`Release evidence: ${outputDir}${dryRun ? ' (dry run; nothing published)' : ''}`);
    report.status = 'completed';
    return report;
  } catch (error) {
    if (report) { report.status = 'failed'; report.failure = 'A release gate or publication failed; inspect retained logs and published list'; }
    throw error;
  } finally {
    if (report) report.finished_at = new Date().toISOString();
    if (outputDir && report) fs.writeFileSync(join(outputDir, 'release.json'), JSON.stringify(report, null, 2) + '\n');
    fs.rmSync(arena, { recursive: true, force: true });
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { runRelease(process.argv.slice(2)); } catch (error) { console.error(`REFUSING: ${error.message}`); process.exitCode = 1; }
}
