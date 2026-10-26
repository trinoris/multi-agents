import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { derive } = require('./viewer/replay-state.js');

const source = 'packages/example/src/release-policy.mjs';
const tests = 'tests/release-policy.test.mjs';
const writer = { scope: 'packages', agent_instance: 'codex-writer', generation: 'writer-generation' };
const tester = { scope: 'tests', agent_instance: 'kiro-test-engineer', generation: 'tester-generation' };
const events = [
  { actor: 'orchestrator', event: 'workspace-seeded', workspace: { files: [{ path: source, scope: 'packages', content: 'before' }], scope_paths: { packages: ['packages/'], tests: ['tests/'] } }, system: { leases: [], handoffs: [] } },
  { actor: 'codex-writer', event: 'scope-acquire', exit_code: 0, system: { leases: [writer], handoffs: [] } },
  { actor: 'codex-contender', event: 'scope-acquire', exit_code: 3, system: { leases: [writer], handoffs: [] } },
  { actor: 'kiro-test-engineer', event: 'test-scope-acquire', system: { leases: [writer, tester], handoffs: [] } },
  { actor: 'kiro-test-engineer', event: 'file-edit-start', file: { path: tests, scope: 'tests', content: 'assert', before: '', operation: 'editing' }, system: { leases: [writer, tester], handoffs: [] } },
  { actor: 'codex-writer', event: 'file-edit-start', file: { path: source, scope: 'packages', content: 'after', before: 'before', operation: 'editing' }, system: { leases: [writer, tester], handoffs: [] } },
  { actor: 'codex-writer', event: 'write-fixture', file: { path: source, scope: 'packages', content: 'after', before: 'before', operation: 'saved' }, system: { leases: [writer, tester], handoffs: [] } },
  { actor: 'codex-writer', event: 'scope-release', system: { leases: [tester], handoffs: [] } },
  { actor: 'claude-reviewer-a', event: 'review-fixture', file: { path: source, operation: 'reviewing' }, system: { leases: [{ ...writer, agent_instance: 'claude-reviewer-a', generation: 'review-generation' }], handoffs: [{ path: '.trinoris/active/claude-reviewer-a/review.md', stage: 'active', owner: 'claude-reviewer-a' }] } },
];

test('scope ownership comes from recorded leases, never from a rejected claimant', () => {
  const state = derive(events, 3);
  assert.equal(state.files.get(source).leaseOwner, 'codex-writer');
  assert.equal(state.leases.length, 1);
  assert.equal(state.blocked, 1);
});
test('independent scopes show two owners and separate editing buffers', () => {
  const state = derive(events, 6);
  assert.equal(state.files.get(source).activity, 'editing');
  assert.equal(state.files.get(source).content, 'after');
  assert.equal(state.files.get(tests).leaseOwner, 'kiro-test-engineer');
  assert.equal(state.files.get(tests).activity, 'editing');
  assert.equal(state.leases.length, 2);
});
test('scrubbing backward removes later content, owners, and future files', () => {
  derive(events, 9);
  const state = derive(events, 1);
  assert.equal(state.files.get(source).content, 'before');
  assert.equal(state.files.get(source).leaseOwner, null);
  assert.equal(state.files.has(tests), false);
});
test('released files are available; a later reviewer has its own lease and activity', () => {
  assert.equal(derive(events, 8).files.get(source).leaseOwner, null);
  const state = derive(events, 9);
  assert.equal(state.files.get(source).leaseOwner, 'claude-reviewer-a');
  assert.equal(state.files.get(source).author, 'codex-writer');
  assert.equal(state.files.get(source).activity, 'reviewing');
  assert.equal(state.handoffs[0].stage, 'active');
});
test('legacy reports show missing content honestly and do not invent locks', () => {
  const state = derive([{ actor: 'old-writer', event: 'write-fixture', path: 'packages/old.txt' }], 1);
  assert.equal(state.files.get('packages/old.txt').recorded, false);
  assert.equal(state.files.get('packages/old.txt').leaseOwner, null);
  assert.equal(state.hasSnapshots, false);
});
test('handoff moves remove the old path, and test results rewind with the timeline', () => {
  const history = [
    { actor: 'writer', event: 'handoff-drafted', file: { path: '.trinoris/handoff/drafts/review.md', content: 'draft', operation: 'saved' } },
    { actor: 'tester', event: 'tests-run', test_run: { passed: false, expected_failure: true, output: 'RED' } },
    { actor: 'writer', event: 'handoff-publish', file: { from: '.trinoris/handoff/drafts/review.md', path: '.trinoris/handoff/for-claude/review.md', content: 'draft', operation: 'moved' } },
    { actor: 'tester', event: 'tests-run', test_run: { passed: true, output: 'GREEN' } },
  ];
  const state = derive(history, 4);
  assert.equal(state.files.has('.trinoris/handoff/drafts/review.md'), false);
  assert.equal(state.files.has('.trinoris/handoff/for-claude/review.md'), true);
  assert.equal(state.testRun.passed, true);
  assert.equal(derive(history, 2).testRun.expected_failure, true);
});
