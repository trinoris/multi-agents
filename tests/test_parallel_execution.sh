#!/bin/bash
# Parallel execution test - MA-T06
# Two agents, different scopes, should work without conflict

set -euo pipefail

# Ensure we're in the project root
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== MA-T06: Parallel Execution Test ==="
echo "Testing: 2 agents, different scopes (specs, root)"
echo "Working directory: $(pwd)"
echo ""

# Cleanup function
cleanup() {
    echo "Cleaning up..."
    rm -rf coordination/locks/specs.lock coordination/locks/root.lock 2>/dev/null || true
    rm -rf coordination/active/kiro-parallel-a-* coordination/active/kiro-parallel-b-* 2>/dev/null || true
}
trap cleanup EXIT

# Agent A function (specs scope)
agent_a() {
    local AGENT_INSTANCE="kiro-parallel-a-$$"
    local START_TIME=$(date +%s)
    
    echo "[A] Starting agent A (specs scope)"
    
    # Claim handoff
    mkdir coordination/claims/parallel-test-a-specs.md.claim
    mkdir -p coordination/active/$AGENT_INSTANCE
    mv coordination/handoff/for-kiro/parallel-test-a-specs.md \
       coordination/active/$AGENT_INSTANCE/parallel-test-a-specs.md
    rmdir coordination/claims/parallel-test-a-specs.md.claim
    echo "[A] Handoff claimed"
    
    # Acquire lock
    if mkdir coordination/locks/specs.lock 2>/dev/null; then
        echo "[A] Lock acquired: specs"
        cat > coordination/locks/specs.lock/holder.json <<EOF
{
  "agent_instance": "$AGENT_INSTANCE",
  "agent_class": "kiro",
  "scope": "specs",
  "acquired_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "expires_at": "$(date -u -d '+15 minutes' +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    else
        echo "[A] ERROR: Failed to acquire lock"
        return 1
    fi
    
    # Do work (add Lessons Learned to the Phase 0 planning record)
    echo "[A] Working on docs/planning/PHASE-0-COMPLETE.md..."
    cat >> docs/planning/PHASE-0-COMPLETE.md <<'EOF'

## Lessons Learned

### What Went Well
- Minimal viable approach worked (setup + verify only)
- Embedded templates eliminated version mismatch issues
- ProcessPoolExecutor provided true parallelism for tests
- Documentation-first approach clarified requirements

### What We'd Do Differently
- Could have started with CLI immediately (skipped manual setup discussion)
- Test suite could be more comprehensive (add failure cases)

### Key Insights
- One hour was sufficient for Phase 0 (vs 1-2 days estimated)
- Atomicity testing is critical and fast to implement
- AI agents can follow bash documentation reliably
EOF
    echo "[A] File modified"
    
    # Simulate longer work
    echo "[A] Working... (10 seconds)"
    sleep 10
    
    # Release lock
    rm -rf coordination/locks/specs.lock
    echo "[A] Lock released: specs"
    
    # Archive
    local END_TIME=$(date +%s)
    local DURATION=$((END_TIME - START_TIME))
    cat >> coordination/active/$AGENT_INSTANCE/parallel-test-a-specs.md <<EOF

## Outcome

✅ Completed successfully in ${DURATION} seconds

- Acquired specs lock
- Updated docs/planning/PHASE-0-COMPLETE.md with Lessons Learned section
- Worked for 10 seconds in parallel with agent B
- Released lock cleanly
EOF
    
    local TIMESTAMP=$(date +%Y%m%dT%H%M%S)
    mv coordination/active/$AGENT_INSTANCE/parallel-test-a-specs.md \
       coordination/archive/${TIMESTAMP}-parallel-test-a-specs.md
    rmdir coordination/active/$AGENT_INSTANCE
    
    echo "[A] Completed and archived (${DURATION}s total)"
}

# Agent B function (root scope)
agent_b() {
    local AGENT_INSTANCE="kiro-parallel-b-$$"
    local START_TIME=$(date +%s)
    
    echo "[B] Starting agent B (root scope)"
    
    # Claim handoff
    mkdir coordination/claims/parallel-test-b-root.md.claim
    mkdir -p coordination/active/$AGENT_INSTANCE
    mv coordination/handoff/for-kiro/parallel-test-b-root.md \
       coordination/active/$AGENT_INSTANCE/parallel-test-b-root.md
    rmdir coordination/claims/parallel-test-b-root.md.claim
    echo "[B] Handoff claimed"
    
    # Acquire lock
    if mkdir coordination/locks/root.lock 2>/dev/null; then
        echo "[B] Lock acquired: root"
        cat > coordination/locks/root.lock/holder.json <<EOF
{
  "agent_instance": "$AGENT_INSTANCE",
  "agent_class": "kiro",
  "scope": "root",
  "acquired_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "expires_at": "$(date -u -d '+15 minutes' +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    else
        echo "[B] ERROR: Failed to acquire lock"
        return 1
    fi
    
    # Do work (add Quick Links to README.md)
    echo "[B] Working on README.md..."
    
    # Find insertion point (after status section)
    LINE=$(grep -n "^See \[\`PHASE-0-COMPLETE.md\`\]" README.md | head -1 | cut -d: -f1)
    if [ -n "$LINE" ]; then
        # Insert Quick Links section
        {
            head -n $LINE README.md
            cat <<'LINKS'

### Quick Links

- [Specifications](specs/) — 6 complete specs
- [CLI Documentation](trinoris-agent/README.md) — Installation & usage
- [Phase 0 Summary](docs/planning/PHASE-0-COMPLETE.md) — CLI implementation
- [Phase 1 Summary](docs/planning/PHASE-1-STARTED.md) — First handoff validation
- [Implementation Plan](docs/planning/IMPLEMENTATION-PLAN.md) — Roadmap

LINKS
            tail -n +$((LINE + 1)) README.md
        } > README.md.tmp
        mv README.md.tmp README.md
        echo "[B] File modified"
    else
        echo "[B] WARNING: Could not find insertion point, appending instead"
        cat >> README.md <<'EOF'

### Quick Links

- [Specifications](specs/) — 6 complete specs
- [CLI Documentation](trinoris-agent/README.md) — Installation & usage
- [Phase 0 Summary](docs/planning/PHASE-0-COMPLETE.md) — CLI implementation
- [Phase 1 Summary](docs/planning/PHASE-1-STARTED.md) — First handoff validation
- [Implementation Plan](docs/planning/IMPLEMENTATION-PLAN.md) — Roadmap
EOF
    fi
    
    # Simulate longer work
    echo "[B] Working... (10 seconds)"
    sleep 10
    
    # Release lock
    rm -rf coordination/locks/root.lock
    echo "[B] Lock released: root"
    
    # Archive
    local END_TIME=$(date +%s)
    local DURATION=$((END_TIME - START_TIME))
    cat >> coordination/active/$AGENT_INSTANCE/parallel-test-b-root.md <<EOF

## Outcome

✅ Completed successfully in ${DURATION} seconds

- Acquired root lock
- Updated README.md with Quick Links section
- Worked for 10 seconds in parallel with agent A
- Released lock cleanly
EOF
    
    local TIMESTAMP=$(date +%Y%m%dT%H%M%S)
    mv coordination/active/$AGENT_INSTANCE/parallel-test-b-root.md \
       coordination/archive/${TIMESTAMP}-parallel-test-b-root.md
    rmdir coordination/active/$AGENT_INSTANCE
    
    echo "[B] Completed and archived (${DURATION}s total)"
}

# Run both agents in parallel
echo "Starting both agents..."
START=$(date +%s)

agent_a &
PID_A=$!

agent_b &
PID_B=$!

# Wait for both to complete
echo ""
echo "Waiting for agents to complete..."
wait $PID_A
RESULT_A=$?
wait $PID_B
RESULT_B=$?

END=$(date +%s)
TOTAL=$((END - START))

echo ""
echo "=== Results ==="
echo "Agent A (specs): exit code $RESULT_A"
echo "Agent B (root):  exit code $RESULT_B"
echo "Total time: ${TOTAL}s"
echo ""

# Check results
if [ $RESULT_A -eq 0 ] && [ $RESULT_B -eq 0 ]; then
    if [ $TOTAL -ge 10 ] && [ $TOTAL -le 15 ]; then
        echo "✅ MA-T06 PASS: Both agents completed in parallel"
        echo "   Expected: ~10s (parallel), Got: ${TOTAL}s"
    else
        echo "⚠️  MA-T06 QUESTIONABLE: Agents completed but timing unexpected"
        echo "   Expected: ~10s (parallel), Got: ${TOTAL}s"
    fi
else
    echo "✗ MA-T06 FAIL: One or both agents failed"
    exit 1
fi

# Verify locks released
if [ -d coordination/locks/specs.lock ] || [ -d coordination/locks/root.lock ]; then
    echo "✗ ERROR: Locks not released properly"
    ls -la coordination/locks/
    exit 1
fi

echo "✓ All locks released"
echo ""
echo "=== MA-T06 Complete ==="
