#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import scenario from './scenario.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'packages/cli/dist/bin.js');
if (!existsSync(cli)) {
  console.error('CLI build not found. Run `pnpm simulate` from the repository root.');
  process.exit(1);
}

const runId = new Date().toISOString().replaceAll(/[-:.]/g, '').replace('T', 'T').replace('Z', 'Z');
const outputArg = process.argv.findIndex((arg) => arg === '--output');
if (outputArg >= 0 && (!process.argv[outputArg + 1] || process.argv[outputArg + 1].startsWith('--'))) {
  console.error('--output requires a directory path.');
  process.exit(1);
}
const outputDir = outputArg >= 0 ? resolve(process.argv[outputArg + 1]) : join(repo, 'simulation/artifacts', `${runId}-${process.pid}`);
if (existsSync(outputDir)) {
  console.error(`Output path already exists; choose a new directory: ${outputDir}`);
  process.exit(1);
}
const workDir = join(outputDir, 'workspace');
const draftName = 'codex-to-reviewer.md';
const reportPath = join(outputDir, 'report.jsonl');
const events = [];
mkdirSync(join(workDir), { recursive: true });
mkdirSync(outputDir, { recursive: true });

function record(actor, event, summary, result = {}) {
  const item = { sequence: events.length + 1, at: new Date().toISOString(), actor, event, summary, ...result, system: snapshotSystem() };
  events.push(item);
  writeFileSync(reportPath, `${JSON.stringify(item)}\n`, { flag: 'a' });
  return item;
}

function snapshotSystem() {
  const root = join(workDir, '.trinoris');
  const snapshot = { leases: [], handoffs: [], protocol_version: null, mutation_guard: 'not initialized' };
  if (!existsSync(root)) return snapshot;
  const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  snapshot.protocol_version = config.protocol_version;
  snapshot.mutation_guard = existsSync(join(root, '.mutation')) ? 'held' : 'clear';
  for (const entry of readdirSync(join(root, 'locks'), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.lock')) continue;
    snapshot.leases.push(JSON.parse(readFileSync(join(root, 'locks', entry.name, 'holder.json'), 'utf8')));
  }
  function collect(directory, stage) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path, stage);
      else if (entry.isFile() && entry.name.endsWith('.md') && !['INDEX.md', 'TEMPLATE.md'].includes(entry.name)) {
        const text = readFileSync(path, 'utf8');
        const logical = relative(workDir, path).replaceAll('\\', '/');
        snapshot.handoffs.push({ path: logical, stage: logical.includes('/drafts/') ? 'draft' : stage, owner: stage === 'active' ? relative(join(root, 'active'), directory).replaceAll('\\', '/') : null, status: text.match(/^Status: (.+)$/m)?.[1] ?? 'unknown', to_class: text.match(/^to_class: (.+)$/m)?.[1] ?? 'unknown' });
      }
    }
  }
  collect(join(root, 'handoff'), 'inbox'); collect(join(root, 'active'), 'active'); collect(join(root, 'archive'), 'archive');
  return snapshot;
}

function recordFile(actor, event, path, scope, operation, content, before, from) {
  record(actor, event, `${actor} ${operation === 'editing' ? 'is editing' : operation === 'reviewing' ? 'is reviewing' : operation} ${path.split('/').at(-1)}.`, {
    path, file: { path, scope, operation, content, before, ...(from ? { from } : {}) },
  });
}

function runFixtureTests(actor, expectedFailure) {
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', scenario.testPath], { cwd: workDir, encoding: 'utf8', timeout: 20_000, windowsHide: true });
  if (run.error) throw run.error;
  const output = `${run.stdout}${run.stderr}`;
  const stats = Object.fromEntries(['tests', 'pass', 'fail'].map((key) => [key, Number(output.match(new RegExp(`# ${key} (\\d+)`))?.[1] ?? 0)]));
  record(actor, 'tests-run', expectedFailure ? 'RED: the new regression fails before the source change.' : 'GREEN: the release-policy tests pass after the change.', {
    command: `node --test ${scenario.testPath}`, exit_code: run.status, test_run: { passed: run.status === 0, expected_failure: expectedFailure, output, ...stats },
  });
  return { code: run.status, output };
}

function publishReplay(verifier) {
  const artifactsDir = join(repo, 'simulation/artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  // A local script also loads from file://, where browsers cannot fetch JSON.
  const data = JSON.stringify({ schema_version: 1, events, verifier })
    .replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const temporary = join(artifactsDir, `.latest-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(temporary, `globalThis.TRINORIS_SIMULATION_RUN=${data};\n`, { flag: 'wx' });
  renameSync(temporary, join(artifactsDir, 'latest.js'));
}

function cliRun(actor, command, args = []) {
  const result = spawnSync(process.execPath, [cli, ...command.split(' '), '--work-dir', workDir, '--json', ...args], {
    encoding: 'utf8', timeout: 20_000, windowsHide: true,
  });
  if (result.error) throw result.error;
  const code = result.status ?? 1;
  let payload;
  try { payload = JSON.parse(code === 0 ? result.stdout : result.stderr); } catch { payload = null; }
  return { actor, command, args, code, stdout: result.stdout.trim(), stderr: result.stderr.trim(), payload };
}

function cliRunAsync(actor, command, args = []) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...command.split(' '), '--work-dir', workDir, '--json', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (status) => {
      clearTimeout(timeout);
      const code = status ?? 1;
      let payload;
      try { payload = JSON.parse(code === 0 ? stdout : stderr); } catch { payload = null; }
      resolvePromise({ actor, command, args, code, stdout: stdout.trim(), stderr: stderr.trim(), payload });
    });
  });
}

function runAndRecord(actor, command, args = [], event = command) {
  const result = cliRun(actor, command, args);
  record(actor, event, `${command}: ${result.code === 0 ? 'accepted' : `rejected (${result.code})`}`, {
    command, exit_code: result.code, outcome: result.payload?.error?.code ?? (result.code === 0 ? 'ok' : 'error'),
  });
  return result;
}

function assertCliOk(result, context) {
  assert.equal(result.code, 0, `${context}: ${result.stderr || result.stdout}`);
}

function writeDraft(fromInstance) {
  const draftPath = join(workDir, '.trinoris/handoff/drafts', draftName);
  const updated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const draft = `---
from_class: codex-gpt-6
from_instance: ${fromInstance}
to_class: claude-opus-5
to_instance: any
scopes: [packages]
locks_released: true
---
# Context Handoff

Updated: ${updated}
Task: Review a simulated package change
Status: ready-for-review
Branch: simulation
Base commit: simulation-fixture

## Goal

Review and accept the simulated change after the implementer releases its scope.

## User Constraints

Use the coordination CLI and preserve one-writer ownership.

## Current State

The simulated package change is ready for independent review.

## Changes

Updated ${scenario.sourcePath}. The test engineer added ${scenario.testPath} under its own tests lease.

## Decisions

The reviewer should independently inspect the fixture and record a completion outcome.

## Verification

| Check | Result | Scope / limitations |
| --- | --- | --- |
| Lease check before write | PASS | Disposable simulation workspace |

## Failed Attempts

The competing writer was refused while the lease was held.

## Blockers and Unknowns

None.

## Next Actions

1. Review the fixture and complete this handoff.

## Resume Instructions

Claim this handoff, inspect the changed file, then complete it with a review outcome.

## References

Simulation scenario: ${runId}
`;
  writeFileSync(draftPath, draft, { flag: 'wx' });
}

const checks = {};
try {
  record('simulation', 'run-start', 'Starting disposable multi-agent coordination scenario.', { run_id: runId });
  const setup = runAndRecord('orchestrator', 'setup', [], 'workspace-setup');
  assertCliOk(setup, 'setup');
  const verified = runAndRecord('orchestrator', 'verify', ['--trials', '1', '--concurrency', '2'], 'workspace-verified');
  assertCliOk(verified, 'workspace readiness verification');
  assert.equal(verified.payload?.ready, true, 'the disposable workspace must be ready before actors start');

  const fixturePath = join(workDir, scenario.sourcePath);
  mkdirSync(dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, scenario.initialSource, { flag: 'wx' });
  writeFileSync(join(workDir, 'README.md'), scenario.readme, { flag: 'wx' });
  record('orchestrator', 'workspace-seeded', 'Prepared the example source tree before the agent sessions start.', {
    workspace: { scope_paths: scenario.scopePaths, files: [
      { path: 'README.md', scope: 'root', content: scenario.readme },
      { path: scenario.sourcePath, scope: 'packages', content: scenario.initialSource },
    ] },
  });

  // Two real CLI processes race for the same registered scope.
  const race = await Promise.all([
    cliRunAsync('codex-writer', 'acquire', ['--agent-class', 'codex-gpt-6', '--instance', 'codex-writer', '--scope', 'packages', '--task', 'Write simulated package change']),
    cliRunAsync('codex-contender', 'acquire', ['--agent-class', 'codex-gpt-6', '--instance', 'codex-contender', '--scope', 'packages', '--task', 'Attempt competing package change']),
  ]);
  const winners = race.filter((result) => result.code === 0);
  const losers = race.filter((result) => result.code === 3);
  for (const result of race) {
    record(result.actor, 'scope-acquire', `packages scope ${result.code === 0 ? 'acquired' : `refused (${result.code})`}.`, {
      command: result.command, exit_code: result.code, outcome: result.payload?.error?.code ?? (result.code === 0 ? 'acquired' : 'error'),
    });
  }
  checks.exclusive_scope_lease = winners.length === 1 && losers.length === 1;
  assert.equal(winners.length, 1, 'exactly one concurrent writer must acquire the scope');
  assert.equal(losers.length, 1, 'the competing writer must receive contention');
  const writer = winners[0];
  const writerIdentity = ['--agent-class', 'codex-gpt-6', '--instance', writer.actor];
  const generation = writer.payload?.lock?.generation;
  assert.ok(generation, 'winning acquire must return a lease generation');

  const testActor = 'kiro-test-engineer';
  const testIdentity = ['--agent-class', 'kiro', '--instance', testActor];
  const testLease = runAndRecord(testActor, 'acquire', [...testIdentity, '--scope', 'tests', '--task', 'Write the release-policy regression'], 'test-scope-acquire');
  assertCliOk(testLease, 'independent test scope acquire');
  const testGeneration = testLease.payload.lock.generation;
  assertCliOk(runAndRecord(testActor, 'check', [...testIdentity, '--scope', 'tests', '--generation', testGeneration], 'test-lease-check'), 'test lease check');
  recordFile(testActor, 'file-edit-start', scenario.testPath, 'tests', 'editing', scenario.testSource, '');
  mkdirSync(dirname(join(workDir, scenario.testPath)), { recursive: true });
  writeFileSync(join(workDir, scenario.testPath), scenario.testSource, { flag: 'wx' });
  recordFile(testActor, 'test-file-saved', scenario.testPath, 'tests', 'saved', readFileSync(join(workDir, scenario.testPath), 'utf8'), '');
  const red = runFixtureTests(testActor, true);
  checks.tests_red_before_fix = red.code === 1 && red.output.includes('blocks a release before its review is approved');
  assert.ok(checks.tests_red_before_fix, 'the new regression must fail on the baseline source');

  const check = runAndRecord(writer.actor, 'check', [...writerIdentity, '--scope', 'packages', '--generation', generation], 'lease-check-before-write');
  assertCliOk(check, 'lease check before write');
  recordFile(writer.actor, 'file-edit-start', scenario.sourcePath, 'packages', 'editing', scenario.completedSource, scenario.initialSource);
  writeFileSync(fixturePath, scenario.completedSource);
  recordFile(writer.actor, 'write-fixture', scenario.sourcePath, 'packages', 'saved', readFileSync(fixturePath, 'utf8'), scenario.initialSource);
  const green = runFixtureTests(testActor, false);
  checks.tests_green_after_fix = green.code === 0;
  assert.ok(checks.tests_green_after_fix, 'the same regression suite must pass after the source change');
  assertCliOk(runAndRecord(testActor, 'release', [...testIdentity, '--scope', 'tests', '--generation', testGeneration], 'test-scope-release'), 'test scope release');

  const release = runAndRecord(writer.actor, 'release', [...writerIdentity, '--scope', 'packages', '--generation', generation], 'scope-release');
  assertCliOk(release, 'scope release');
  const stale = runAndRecord(writer.actor, 'check', [...writerIdentity, '--scope', 'packages', '--generation', generation], 'stale-generation-probe');
  checks.generation_fencing = stale.code === 4;
  assert.equal(stale.code, 4, 'released generation must no longer authorize work');

  writeDraft(writer.actor);
  const draftPath = `.trinoris/handoff/drafts/${draftName}`;
  recordFile(writer.actor, 'handoff-drafted', draftPath, null, 'saved', readFileSync(join(workDir, draftPath), 'utf8'));
  const published = runAndRecord(writer.actor, 'handoff publish', [...writerIdentity, '--note', draftName], 'handoff-publish');
  assertCliOk(published, 'handoff publish');
  const inboxPath = `.trinoris/handoff/for-claude-opus-5/${draftName}`;
  recordFile(writer.actor, 'handoff-file-moved', inboxPath, null, 'moved', readFileSync(join(workDir, inboxPath), 'utf8'), undefined, draftPath);

  const wrongRecipient = runAndRecord('kiro-outsider', 'handoff claim', ['--agent-class', 'kiro', '--instance', 'kiro-outsider', '--note', draftName], 'wrong-recipient-claim');
  checks.recipient_enforcement = wrongRecipient.code !== 0;
  assert.notEqual(wrongRecipient.code, 0, 'a non-recipient must not claim the handoff');

  // Two eligible reviewer sessions race for the same note. One claim should win.
  const claims = await Promise.all([
    cliRunAsync('claude-reviewer-a', 'handoff claim', ['--agent-class', 'claude-opus-5', '--instance', 'claude-reviewer-a', '--note', draftName]),
    cliRunAsync('claude-reviewer-b', 'handoff claim', ['--agent-class', 'claude-opus-5', '--instance', 'claude-reviewer-b', '--note', draftName]),
  ]);
  const claimWinners = claims.filter((result) => result.code === 0);
  for (const result of claims) {
    record(result.actor, 'handoff-claim-race', `Reviewer claim ${result.code === 0 ? 'succeeded' : `did not win (${result.code})`}.`, {
      command: result.command, exit_code: result.code, outcome: result.payload?.error?.code ?? (result.code === 0 ? 'claimed' : 'not-claimed'),
    });
  }
  checks.single_handoff_claimant = claimWinners.length === 1;
  assert.equal(claimWinners.length, 1, 'exactly one eligible reviewer must claim the note');
  const reviewer = claimWinners[0];
  const activePath = `.trinoris/active/${reviewer.actor}/${draftName}`;
  recordFile(reviewer.actor, 'handoff-file-moved', activePath, null, 'moved', readFileSync(join(workDir, activePath), 'utf8'), undefined, inboxPath);
  const reviewerIdentity = ['--agent-class', 'claude-opus-5', '--instance', reviewer.actor];
  const reviewAcquire = runAndRecord(reviewer.actor, 'acquire', [...reviewerIdentity, '--scope', 'packages', '--task', 'Review simulated package change'], 'review-scope-acquire');
  assertCliOk(reviewAcquire, 'reviewer acquire');
  const reviewGeneration = reviewAcquire.payload?.lock?.generation;
  const show = runAndRecord(reviewer.actor, 'handoff show', [...reviewerIdentity, '--location', 'active', '--note', draftName], 'handoff-inspect');
  assertCliOk(show, 'handoff show');
  const reviewedFixture = readFileSync(fixturePath, 'utf8');
  checks.reviewer_inspected_change = reviewedFixture === scenario.completedSource;
  assert.ok(checks.reviewer_inspected_change, 'reviewer must inspect the exact fixture written under the winning generation');
  recordFile(reviewer.actor, 'review-fixture', scenario.sourcePath, 'packages', 'reviewing', reviewedFixture, scenario.initialSource);
  const releaseReview = runAndRecord(reviewer.actor, 'release', [...reviewerIdentity, '--scope', 'packages', '--generation', reviewGeneration], 'review-scope-release');
  assertCliOk(releaseReview, 'reviewer scope release');
  const completed = runAndRecord(reviewer.actor, 'handoff complete', [...reviewerIdentity, '--note', draftName, '--outcome', 'Reviewed fixture; coordination flow completed successfully.'], 'handoff-complete');
  assertCliOk(completed, 'handoff complete');
  recordFile(reviewer.actor, 'handoff-archived', `.trinoris/archive/${draftName}`, null, 'moved', readFileSync(join(workDir, '.trinoris/archive', draftName), 'utf8'), undefined, activePath);

  const archived = join(workDir, '.trinoris/archive', draftName);
  checks.completed_handoff_archived = existsSync(archived);
  assert.ok(checks.completed_handoff_archived, 'completed note must be in the archive');
  checks.all_expected_outcomes = Object.values(checks).every(Boolean);

  const result = {
    schema_version: 1,
    run_id: runId,
    completed_at: new Date().toISOString(),
    scenario: 'Independent source and test scopes, a RED-to-GREEN code change, recipient enforcement, and an archived human-readable review.',
    passed: checks.all_expected_outcomes,
    checks,
    actors: ['orchestrator', 'codex-writer', 'codex-contender', testActor, 'kiro-outsider', 'claude-reviewer-a', 'claude-reviewer-b'],
    workspace: 'workspace/',
  };
  writeFileSync(join(outputDir, 'scenario.json'), `${JSON.stringify({ run_id: runId, actors: result.actors, scenario: result.scenario }, null, 2)}\n`);
  record('verifier', 'run-complete', checks.all_expected_outcomes ? 'PASS: all simulation invariants held.' : 'FAIL: one or more simulation invariants failed.', { passed: checks.all_expected_outcomes, checks, focus: scenario.sourcePath });
  result.event_count = events.length;
  writeFileSync(join(outputDir, 'verifier-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  publishReplay(result);
  const checkCount = Object.keys(checks).filter((key) => key !== 'all_expected_outcomes').length;
  console.log(`${checks.all_expected_outcomes ? 'PASS' : 'FAIL'} multi-agent simulation · ${checkCount} checks · ${events.length} events`);
  console.log(`Run data: ${outputDir}`);
  console.log(`Viewer: ${join(repo, 'simulation/viewer/index.html')} (automatically loads this run)`);
  if (!checks.all_expected_outcomes) process.exitCode = 1;
} catch (error) {
  record('verifier', 'run-failed', 'FAIL: simulation aborted; see verifier result and event report.', { passed: false, error: String(error?.message ?? error) });
  const failure = { schema_version: 1, run_id: runId, completed_at: new Date().toISOString(), passed: false, checks, error: String(error?.stack ?? error), event_count: events.length };
  writeFileSync(join(outputDir, 'verifier-result.json'), `${JSON.stringify(failure, null, 2)}\n`);
  publishReplay(failure);
  console.error(`FAIL multi-agent simulation: ${error?.message ?? error}`);
  console.error(`Run data: ${outputDir}`);
  process.exitCode = 1;
}
