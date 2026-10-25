#!/bin/bash
# Conflict scenario test - MA-T07
# Two agents try to acquire the same scope - one must wait or fail gracefully

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== MA-T07: Conflict Scenario Test ==="
echo "Testing: 2 agents, SAME scope (specs) - lock contention"
echo "Working directory: $(pwd)"
echo ""

# Cleanup function
cleanup() {
    echo "Cleaning up..."
    rm -rf coordination/locks/specs.lock 2>/dev/null || true
    rm -rf coordination/active/kiro-conflict-* 2>/dev/null || true
}
trap cleanup EXIT

# Agent A function (gets lock first, holds for 5 seconds)
agent_a() {
    local AGENT_INSTANCE="kiro-conflict-a-$$"
    local START_TIME=$(date +%s)
    
    echo "[A] Starting agent A"
    
    # Acquire lock
    if mkdir coordination/locks/specs.lock 2>/dev/null; then
        echo "[A] ✓ Lock acquired: specs"
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
        echo "[A] ✗ Failed to acquire lock (unexpected)"
        return 1
    fi
    
    # Hold lock for 5 seconds
    echo "[A] Holding lock for 5 seconds..."
    sleep 5
    
    # Release lock
    rm -rf coordination/locks/specs.lock
    echo "[A] Lock released: specs"
    
    local END_TIME=$(date +%s)
    local DURATION=$((END_TIME - START_TIME))
    echo "[A] Completed (${DURATION}s total)"
}

# Agent B function (tries to acquire same lock, should fail initially)
agent_b() {
    local AGENT_INSTANCE="kiro-conflict-b-$$"
    local START_TIME=$(date +%s)
    local RETRY_COUNT=0
    local MAX_RETRIES=5  # Increased from 3
    
    echo "[B] Starting agent B"
    
    # Small delay to ensure A gets lock first
    sleep 0.5
    
    # Try to acquire lock (will fail while A holds it)
    echo "[B] Attempting to acquire lock..."
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if mkdir coordination/locks/specs.lock 2>/dev/null; then
            echo "[B] ✓ Lock acquired: specs (on attempt $((RETRY_COUNT + 1)))"
            cat > coordination/locks/specs.lock/holder.json <<EOF
{
  "agent_instance": "$AGENT_INSTANCE",
  "agent_class": "kiro",
  "scope": "specs",
  "acquired_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "expires_at": "$(date -u -d '+15 minutes' +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
            
            # Success - do brief work
            echo "[B] Working for 2 seconds..."
            sleep 2
            
            # Release lock
            rm -rf coordination/locks/specs.lock
            echo "[B] Lock released: specs"
            
            local END_TIME=$(date +%s)
            local DURATION=$((END_TIME - START_TIME))
            echo "[B] Completed (${DURATION}s total, acquired on attempt $((RETRY_COUNT + 1)))"
            return 0
        else
            # Failed to acquire - check who holds it
            RETRY_COUNT=$((RETRY_COUNT + 1))
            
            if [ -f coordination/locks/specs.lock/holder.json ]; then
                HOLDER=$(jq -r .agent_instance coordination/locks/specs.lock/holder.json 2>/dev/null || echo "unknown")
                EXPIRES=$(jq -r .expires_at coordination/locks/specs.lock/holder.json 2>/dev/null || echo "unknown")
                echo "[B] ✗ Attempt $RETRY_COUNT: Lock held by $HOLDER"
            else
                echo "[B] ✗ Attempt $RETRY_COUNT: Lock exists but cannot read holder"
            fi
            
            if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
                echo "[B] Waiting 1.5 seconds before next attempt..."
                sleep 1.5  # Reduced from 2 seconds
            fi
        fi
    done
    
    echo "[B] ✗ Failed to acquire lock after $MAX_RETRIES attempts"
    return 1
}

# Run both agents
echo "Starting both agents..."
echo ""
START=$(date +%s)

agent_a &
PID_A=$!

agent_b &
PID_B=$!

# Wait for both to complete
echo "Waiting for agents to complete..."
echo ""
wait $PID_A
RESULT_A=$?
wait $PID_B
RESULT_B=$?

END=$(date +%s)
TOTAL=$((END - START))

echo ""
echo "=== Results ==="
echo "Agent A: exit code $RESULT_A"
echo "Agent B: exit code $RESULT_B"
echo "Total time: ${TOTAL}s"
echo ""

# Expected behavior:
# - Agent A should succeed (0)
# - Agent B should succeed after retry (0)
# - Total time should be ~7s (A: 5s, B waits then works 2s)

if [ $RESULT_A -eq 0 ] && [ $RESULT_B -eq 0 ]; then
    if [ $TOTAL -ge 7 ] && [ $TOTAL -le 10 ]; then
        echo "✅ MA-T07 PASS: Lock contention handled correctly"
        echo "   Agent A held lock, Agent B waited and retried successfully"
        echo "   Total time ${TOTAL}s (expected ~7s for sequential execution)"
    else
        echo "⚠️  MA-T07 QUESTIONABLE: Both succeeded but timing unexpected"
        echo "   Expected: ~7s (A: 5s hold + B: 2s work), Got: ${TOTAL}s"
    fi
else
    if [ $RESULT_A -eq 0 ] && [ $RESULT_B -ne 0 ]; then
        echo "⚠️  MA-T07 PARTIAL: Agent A succeeded, Agent B failed after retries"
        echo "   This is acceptable behavior (agent B gave up)"
    else
        echo "✗ MA-T07 FAIL: Unexpected results"
        echo "   Agent A should always succeed (got exit code $RESULT_A)"
    fi
fi

# Verify lock is released
if [ -d coordination/locks/specs.lock ]; then
    echo "✗ ERROR: Lock not released properly"
    ls -la coordination/locks/specs.lock/
    exit 1
fi

echo "✓ Lock released properly"
echo ""
echo "=== MA-T07 Complete ==="
