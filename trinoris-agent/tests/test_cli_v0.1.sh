#!/bin/bash
# Test trinoris-agent CLI v0.1.0
# Phase 0: Setup and Verification

set -euo pipefail

echo "=== Testing trinoris-agent CLI v0.1.0 ==="
echo

# Test 1: Version
echo "Test 1: Version check"
trinoris-agent --version
echo "✓ Version command works"
echo

# Test 2: Help
echo "Test 2: Help message"
trinoris-agent --help | grep "Multi-agent coordination" > /dev/null
echo "✓ Help command works"
echo

# Test 3: Setup in clean directory
TEST_DIR=$(mktemp -d)
echo "Test 3: Setup in clean directory: $TEST_DIR"
cd "$TEST_DIR"
trinoris-agent setup
echo "✓ Setup completed"
echo

# Test 4: Verify structure
echo "Test 4: Verify structure created"
[ -d coordination/locks ] || { echo "✗ locks/ missing"; exit 1; }
[ -d coordination/claims ] || { echo "✗ claims/ missing"; exit 1; }
[ -d coordination/handoff ] || { echo "✗ handoff/ missing"; exit 1; }
[ -d coordination/active ] || { echo "✗ active/ missing"; exit 1; }
[ -d coordination/archive ] || { echo "✗ archive/ missing"; exit 1; }
[ -d coordination/incidents ] || { echo "✗ incidents/ missing"; exit 1; }
[ -d coordination/heartbeat ] || { echo "✗ heartbeat/ missing"; exit 1; }
[ -f .kiro/coordination.json ] || { echo "✗ config missing"; exit 1; }
[ -f AGENTS.md ] || { echo "✗ AGENTS.md missing"; exit 1; }
[ -f .claude/skills/trinoris-coordination.md ] || { echo "✗ skill missing"; exit 1; }
echo "✓ All files and directories present"
echo

# Test 5: Verify atomicity
echo "Test 5: Verify mkdir atomicity (50 trials)"
trinoris-agent verify --trials 50 --concurrency 8
echo "✓ Atomicity verified"
echo

# Test 6: Duplicate setup without force
echo "Test 6: Duplicate setup should fail"
if trinoris-agent setup 2>&1 | grep "already exists" > /dev/null; then
    echo "✓ Duplicate setup rejected correctly"
else
    echo "✗ Duplicate setup should have been rejected"
    exit 1
fi
echo

# Test 7: Update skills
echo "Test 7: Update skills only"
trinoris-agent setup --update-skills
[ -f AGENTS.md ] || { echo "✗ AGENTS.md not updated"; exit 1; }
echo "✓ Skills updated"
echo

# Test 8: Force overwrite
echo "Test 8: Force overwrite"
trinoris-agent setup --force > /dev/null
echo "✓ Force overwrite works"
echo

# Test 9: Check agent class directories
echo "Test 9: Verify agent class handoff directories"
[ -d coordination/handoff/for-codex-gpt-6 ] || { echo "✗ codex-gpt-6 missing"; exit 1; }
[ -d coordination/handoff/for-claude-opus-5 ] || { echo "✗ claude-opus-5 missing"; exit 1; }
[ -d coordination/handoff/for-claude-sonnet-4 ] || { echo "✗ claude-sonnet-4 missing"; exit 1; }
[ -d coordination/handoff/for-kiro ] || { echo "✗ kiro missing"; exit 1; }
echo "✓ All agent class directories present"
echo

# Test 10: Configuration content
echo "Test 10: Verify configuration content"
grep '"protocol_version": "1.0"' .kiro/coordination.json > /dev/null || { echo "✗ Bad config"; exit 1; }
grep '"engine"' .kiro/coordination.json > /dev/null || { echo "✗ Scope registry missing"; exit 1; }
echo "✓ Configuration valid"
echo

# Cleanup
cd /
rm -rf "$TEST_DIR"

echo "=== All tests passed! ==="
echo
echo "trinoris-agent v0.1.0 Phase 0 complete:"
echo "  ✓ Setup command"
echo "  ✓ Verify command"
echo "  ✓ mkdir atomicity tested"
echo "  ✓ Error handling works"
echo "  ✓ Skills generated"
echo
echo "Next: Test with AI agents using generated skills (Phase 1)"
