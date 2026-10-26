(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrinorisSimulationScenario = factory();
})(globalThis, function () {
  return {
    sourcePath: 'packages/example/src/release-policy.mjs',
    testPath: 'tests/release-policy.test.mjs',
    scopePaths: { packages: ['packages/'], tests: ['tests/'], root: ['README.md'] },
    initialSource: `// Shared example: protect a release with two independent checks.
export function canRelease({ testsPassed, reviewApproved }) {
  // TODO: require an approved review as well as passing tests.
  return testsPassed === true;
}
`,
    completedSource: `// Shared example: protect a release with two independent checks.
export function canRelease({ testsPassed, reviewApproved }) {
  const testsAreGreen = testsPassed === true;
  const reviewIsApproved = reviewApproved === true;

  // Both conditions must hold before a release is allowed.
  return testsAreGreen && reviewIsApproved;
}
`,
    testSource: `import assert from 'node:assert/strict';
import test from 'node:test';
import { canRelease } from '../packages/example/src/release-policy.mjs';

test('allows a release after tests and review pass', () => {
  assert.equal(canRelease({ testsPassed: true, reviewApproved: true }), true);
});

test('blocks a release before its review is approved', () => {
  assert.equal(canRelease({ testsPassed: true, reviewApproved: false }), false);
});

test('blocks a release when tests fail', () => {
  assert.equal(canRelease({ testsPassed: false, reviewApproved: true }), false);
});
`,
    readme: '# Shared release policy example\n\nTask: require passing tests AND an approved review before release.\n\nA writer owns packages/. A test engineer owns tests/.\nThe reviewer claims a handoff after both editing scopes are released.\n',
  };
});
