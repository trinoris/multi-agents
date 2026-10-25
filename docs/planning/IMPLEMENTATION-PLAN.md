<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->

# Implementation Plan — trinoris-multi-agents

**Status:** Phase 0 complete, Phase 1 starting  
**Date:** 2026-10-25  
**Version:** 1.1 (updated after Phase 0)

## Executive Summary

The trinoris-multi-agents coordination protocol is **fully specified** and ready for
implementation. This plan outlines the phased approach to adopt it in real projects.

**Key insight:** Build minimal CLI first for deterministic setup, then let AI agents use
skills (documentation) with optional CLI commands for operations. This combines the speed
of skill-based testing with the reliability of CLI tooling.

**Timeline:** 4-6 weeks from specification to production use  
**Approach:** CLI-first setup for deterministic initialization, then progressive enhancement  
**Risk level:** Low (protocol verified on target filesystem, setup validated before operations)  
**Dependencies:** Python 3.9+ (for CLI), no external services

## The Approach

### Phase 0 (Day 1-2): Build minimal CLI for setup
```bash
trinoris-agent setup    # Creates correct structure, generates skills
trinoris-agent verify   # Runs MA-T01 atomicity test
```

**Why:** Ensures correct initialization, no manual errors, embeds protocol version.

### Phase 1 (Day 3-7): Test with skills + optional CLI
```bash
# AI reads generated AGENTS.md (skill)
# AI can use: trinoris-agent claim ... (if CLI available)
# AI falls back: mkdir, mv, rm ... (if CLI not available)
```

**Why:** Validates protocol quickly, AI can choose best approach.

### Phase 3 (Week 2): Expand CLI operations
```bash
trinoris-agent claim <file>
trinoris-agent acquire-lock <scope>
trinoris-agent release-lock <scope>
trinoris-agent archive <file> --outcome "..."
```

**Why:** Fewer commands for AI (5 vs 12), better validation, consistent across tools.

## Current State

### What's complete ✓

- ✅ **6 specifications** (01-06) defining protocol, locks, handoffs, CLI
- ✅ **Model-based agent identity** (class + instance)
- ✅ **Two integration modes** (skill-based and CLI-driven)
- ✅ **Test plan** (MA-T01..T16 defined)
- ✅ **Acceptance criteria** (MA-01..MA-18 defined)
- ✅ **Verification harnesses** (MA-T01, T04, T12 passing on v9fs)

### What's pending ⏳

- ⏳ Test with AI agents using skills (Phase 1, Week 1)
- ⏳ trinoris-agent CLI v0.2 with operation commands (Week 2)
- ⏳ Integration into codex-cli and claude-code (Week 3-4)
- ⏳ Real-world deployment and validation (Week 5+)

## Implementation Phases

### Phase 0: Build Setup CLI — ✅ COMPLETE

**Status:** ✅ Completed 2026-10-25  
**Duration:** 1 hour (faster than estimated 1-2 days)  
**Deliverables:** All complete

**What was built:**
- ✅ trinoris-agent Python package with setup.py
- ✅ `setup` command - Initialize coordination structure
- ✅ `verify` command - Run MA-T01 atomicity test
- ✅ AGENTS.md template generation
- ✅ .claude/skills template generation
- ✅ .kiro/coordination.json config generation
- ✅ Archive INDEX.md template
- ✅ Automated test suite (10/10 tests pass)
- ✅ README documentation

**Test results:**
- ✅ MA-T01: 100/100 trials on ext4
- ✅ MA-T01: 100/100 trials on v9fs (WSL2)
- ✅ Tested with N=8 and N=32 concurrency

**Installation:**
```bash
cd trinoris-agent
pip install -e .
trinoris-agent setup     # Ready to use
trinoris-agent verify    # Passes on ext4 and v9fs
```

See [`PHASE-0-COMPLETE.md`](PHASE-0-COMPLETE.md) for full details.

---

### Phase 1: Skill-Based Testing (Week 1, Day 3-7)

**Started:** 2026-10-25T11:36:22Z  
**Status:** 🔄 In Progress

**Goal:** Validate protocol using generated skills, with AI agents reading AGENTS.md

**Tasks:**

#### 1.1 Initialize pilot project

Choose pilot project and run setup:
```bash
cd /path/to/pilot-project

# One command setup
trinoris-agent setup

# Output:
# ✓ Created coordination/ structure
# ✓ Wrote AGENTS.md
# ✓ Wrote .claude/skills/agent-handoff/SKILL.md
# ✓ Wrote coordination/PROTOCOL.md
# ✓ Created archive/INDEX.md
# ✓ Setup complete!
```

Validate scope registry matches project:
```bash
# Edit coordination/PROTOCOL.md if needed
# Update scope registry for actual project structure
```

#### 1.2 Create test handoff manually

```bash
cat > coordination/handoff/for-codex-gpt-6/test-handoff.md <<EOF
---
from_instance: human
from_class: human
to_class: codex-gpt-6
to_instance: any
scopes: [specs]
status: handoff
created: $(date -Iseconds)
---

# Test handoff - Update README

## Goal
Add a "Testing coordination protocol" section to README.md

## Next step
Add section after "Installation" with text:
"This project uses the trinoris-multi-agents coordination protocol."

## Verified
Nothing (this is a test)

## Assumed
README.md exists and is editable
EOF
```

#### 1.3 Test with Codex (AI can choose CLI or bash)

In Codex IDE:
```
User: "Take off from test-handoff"

Expected AI behavior:
  1. Read AGENTS.md → discovers protocol and CLI
  2. Try: which trinoris-agent
     → If found: Use CLI commands (recommended path)
     → If not found: Use bash fallback
  
  Using CLI (if available):
    Execute: trinoris-agent claim test-handoff.md
    Execute: cat coordination/active/codex-gpt-6-<id>/test-handoff.md
    Execute: trinoris-agent acquire-lock specs
    [Edit README.md]
    Execute: trinoris-agent release-lock specs
    Execute: trinoris-agent archive test-handoff.md --outcome "completed"
  
  Using bash (if CLI not available):
    Execute: mkdir coordination/claims/test-handoff.md.claim
    Execute: mv coordination/handoff/... coordination/active/...
    Execute: rmdir coordination/claims/test-handoff.md.claim
    [etc - full bash sequence]
```

Validate:
```bash
# Check work was done correctly
git diff README.md  # Should show new section

# Check handoff was archived
ls coordination/archive/  # Should contain test-handoff.md

# Check locks were released
ls coordination/locks/  # Should be empty

# If AI used CLI, check logs
trinoris-agent logs  # (if logging implemented)
```

#### 1.4 Test parallel execution

Terminal 1 (Codex):
```
User: "Take off from task-engine" (scopes: [engine])
# AI uses CLI or bash to acquire engine lock
```

Terminal 2 (Claude):
```
User: "Take off from task-specs" (scopes: [specs])
# AI uses CLI or bash to acquire specs lock
```

Both should work simultaneously without collision.

Validate:
```bash
# While both running
trinoris-agent locks
# Should show both locks held by different instances

# Or check manually
ls coordination/locks/
# Should see: engine.lock/ and specs.lock/
```

#### 1.5 Test CLI vs bash equivalence

Create two identical handoffs:
```bash
coordination/handoff/for-codex-gpt-6/task-a.md  # AI will use CLI
coordination/handoff/for-codex-gpt-6/task-b.md  # AI will use bash
```

Compare final filesystem state - should be identical.

**Deliverables:**
- ✓ Pilot project initialized with `trinoris-agent setup`
- ✓ Single-agent handoff works (using CLI or bash)
- ✓ Parallel execution works (different scopes)
- ✓ AI can use CLI commands when available
- ✓ AI falls back to bash when CLI not available
- ✓ Both approaches produce identical results

**Duration:** 3-5 days

---

### Phase 2: Conflict Testing (Week 2)

**Goal:** Verify protocol prevents collisions and handles contention

**Tasks:**

#### 2.1 Test scope contention

Create two handoffs for same scope:
```bash
# Both need [engine]
coordination/handoff/for-codex-gpt-6/task-engine-1.md
coordination/handoff/for-codex-gpt-6/task-engine-2.md
```

Terminal 1 (Codex instance 1):
```
User: "Take off from task-engine-1"
# Should acquire engine lock
```

Terminal 2 (Codex instance 2):
```
User: "Take off from task-engine-2"
# Should fail to acquire engine lock (directory exists)
# Should pick different work or write handoff
```

Validate:
- Instance 2 does NOT edit engine/ files (no lock)
- Only one holder.json exists in locks/engine.lock/

#### 2.2 Test lease expiry

Simulate stale lock:
```bash
# Create expired lock manually
mkdir coordination/locks/engine.lock
cat > coordination/locks/engine.lock/holder.json <<EOF
{
  "agent_instance": "codex-gpt-6-stale",
  "agent_class": "codex-gpt-6",
  "scope": "engine",
  "acquired_at": "2026-10-25T10:00:00Z",
  "expires_at": "2026-10-25T10:15:00Z"
}
EOF
# Set mtime to 30 minutes ago
touch -t 202610251000 coordination/locks/engine.lock
```

Fresh agent:
```
User: "Take off from task-engine"
# Should detect stale lock (expired + grace passed)
# Should break lock (mkdir .breaking, write incident, mv stale lock)
# Should acquire fresh lock
# Should work successfully
```

Validate:
- Incident file created in incidents/
- Stale lock moved to incidents/<timestamp>-engine.stale/
- Fresh lock acquired with new holder.json

#### 2.3 Test git scope pre-check

Agent 1 holds engine lock:
```
coordination/locks/engine.lock/holder.json exists
```

Agent 2 tries to switch branches:
```
User: "Switch to branch feature/new-auth"
# Should check for peer locks
# Should find engine lock held by Agent 1
# Should REFUSE to switch branches
# Should tell user: "Cannot switch branches, peer holds locks"
```

Validate: Branch was NOT switched (git operations blocked)

#### 2.4 Test handoff claiming race

Create one handoff, two agents claim simultaneously:

Terminal 1 & 2 (exact same time):
```
User: "Take off from task-engine"
```

Validate:
- Only ONE agent successfully claims (mkdir claim token succeeds once)
- Other agent fails to claim (mkdir returns error)
- Only one handoff file in active/<instance>/
- Losing agent picks different work

**Deliverables:**
- ✓ Scope contention prevents double-write
- ✓ Stale lock is breakable after grace period
- ✓ Git operations blocked when peer holds locks
- ✓ Handoff claiming is atomic (one winner)

**Duration:** 2-3 days

---

### Phase 3: Expand CLI Operations (Week 2)

**Goal:** Add operation commands to CLI for better UX

Now that protocol is validated with skills + minimal CLI, expand CLI with operation
commands to reduce AI command count and improve reliability.

**Tasks:**

#### 3.1 Implement operation commands

Add to trinoris-agent CLI (v0.2):

```python
Commands (v0.2):
  # Setup (already exists from Phase 0)
  setup
  verify
  
  # New: Status commands (read-only, safe)
  status                      Show overall protocol status
  locks                       Show current scope locks
  handoffs [--class <name>]   List available handoffs
  incidents [--scope <name>]  Show recent incidents
  
  # New: Operation commands (for AI agents)
  claim <file>                Claim handoff atomically
  acquire-lock <scope>        Acquire scope lock
  release-lock <scope>        Release scope lock  
  renew-lease <scope>         Renew lease on held lock
  archive <file>              Archive handoff with outcome
    --outcome <string>        Outcome description (required)
  check-scope <scope>         Check if scope available (exit code)
```

**Implementation:**

```python
class CoordinationAgent:
    def __init__(self, agent_class, agent_instance, work_dir):
        self.agent_class = agent_class
        self.agent_instance = agent_instance or self._generate_instance_id()
        self.coord_path = f"{work_dir}/coordination"
        
    def claim_handoff(self, filename):
        """Claim handoff atomically"""
        claim_dir = f"{self.coord_path}/claims/{filename}.claim"
        
        try:
            os.mkdir(claim_dir)
        except FileExistsError:
            raise ClaimError(f"Another agent is claiming {filename}")
        
        try:
            # Move handoff to active
            src = f"{self.coord_path}/handoff/for-{self.agent_class}/{filename}"
            dst = f"{self.coord_path}/active/{self.agent_instance}/{filename}"
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(src, dst)
            
            # Parse scopes from handoff
            handoff = self._read_handoff(dst)
            
            print(f"✓ Claimed: {filename}")
            print(f"  Scopes required: {handoff['scopes']}")
            print(f"  Status: {handoff['status']}")
            
            return handoff
        finally:
            os.rmdir(claim_dir)
        
    def acquire_lock(self, scope):
        """Acquire scope lock"""
        lock_dir = f"{self.coord_path}/locks/{scope}.lock"
        
        # Check for recent incidents
        self._check_incidents(scope)
        
        # Try to create lock
        try:
            os.mkdir(lock_dir)
        except FileExistsError:
            holder = self._read_holder(lock_dir)
            
            # Check if lease expired
            if self._is_expired(holder):
                # Check heartbeat
                if self._has_fresh_heartbeat(holder['agent_instance']):
                    raise LockHeldError(f"Scope {scope} held by {holder['agent_instance']} "
                                       f"(expired but heartbeat fresh, wait)")
                
                # Break stale lock
                self._break_lock(scope, holder)
                os.mkdir(lock_dir)  # Re-acquire
            else:
                expires_in = self._time_until_expiry(holder)
                raise LockHeldError(f"Scope {scope} held by {holder['agent_instance']}, "
                                   f"expires in {expires_in}")
        
        # Write holder.json
        holder = {
            "agent_instance": self.agent_instance,
            "agent_class": self.agent_class,
            "scope": scope,
            "acquired_at": datetime.now().isoformat(),
            "expires_at": (datetime.now() + timedelta(minutes=15)).isoformat()
        }
        with open(f"{lock_dir}/holder.json", "w") as f:
            json.dump(holder, f, indent=2)
        
        print(f"✓ Lock acquired: {scope}")
        print(f"  Expires: {holder['expires_at']}")
        
    def release_lock(self, scope):
        """Release scope lock"""
        lock_dir = f"{self.coord_path}/locks/{scope}.lock"
        
        # Verify we still hold it
        holder = self._read_holder(lock_dir)
        if holder['agent_instance'] != self.agent_instance:
            raise LockError(f"Cannot release {scope}: held by {holder['agent_instance']}")
        
        shutil.rmtree(lock_dir)
        print(f"✓ Lock released: {scope}")
        
    def archive_handoff(self, filename, outcome):
        """Archive handoff with outcome"""
        src = f"{self.coord_path}/active/{self.agent_instance}/{filename}"
        dst = f"{self.coord_path}/archive/{filename}"
        
        # Append outcome
        with open(src, "a") as f:
            f.write(f"\n## Outcome\n\n{outcome}\n")
        
        # Move to archive
        shutil.move(src, dst)
        
        # Update index
        self._update_archive_index(filename, outcome)
        
        print(f"✓ Archived: {filename}")
        print(f"  Outcome: {outcome}")
```

#### 3.2 Add validation and error handling

```python
def _check_incidents(self, scope):
    """Check for recent incidents in this scope"""
    incidents_dir = f"{self.coord_path}/incidents"
    cutoff = datetime.now() - timedelta(hours=1)
    
    for incident_file in os.listdir(incidents_dir):
        if scope in incident_file:
            # Parse timestamp from filename
            timestamp = self._parse_timestamp(incident_file)
            if timestamp > cutoff:
                print(f"⚠ Recent incident in scope {scope}:")
                with open(f"{incidents_dir}/{incident_file}") as f:
                    print(f.read()[:200])  # First 200 chars
                
                response = input("Continue anyway? [y/N] ")
                if response.lower() != 'y':
                    raise IncidentWarning(f"User aborted due to recent incident")

def _break_lock(self, scope, stale_holder):
    """Break stale lock with proper protocol"""
    # 1. Acquire breaking token
    breaking_dir = f"{self.coord_path}/locks/{scope}.breaking"
    try:
        os.mkdir(breaking_dir)
    except FileExistsError:
        raise LockError(f"Another agent is breaking {scope} lock")
    
    try:
        # 2. Re-check staleness
        lock_dir = f"{self.coord_path}/locks/{scope}.lock"
        current_holder = self._read_holder(lock_dir)
        if not self._is_expired(current_holder):
            raise LockError(f"Lock renewed while acquiring breaking token")
        
        # 3. Write incident
        incident_file = f"{self.coord_path}/incidents/{datetime.now().strftime('%Y%m%dT%H%M%S')}-broken-{scope}.md"
        with open(incident_file, "w") as f:
            f.write(f"""# Incident: Broken lock
            
- **Time**: {datetime.now().isoformat()}
- **Scope**: {scope}
- **Breaker**: {self.agent_instance} ({self.agent_class})
- **Evicted**: {stale_holder['agent_instance']} ({stale_holder['agent_class']})
- **Reason**: Lease expired (expires_at: {stale_holder['expires_at']})
""")
        
        # 4. Move stale lock aside
        stale_dir = f"{self.coord_path}/incidents/{datetime.now().strftime('%Y%m%dT%H%M%S')}-{scope}.stale"
        shutil.move(lock_dir, stale_dir)
        
        print(f"⚠ Broke stale lock: {scope}")
        print(f"  Evicted: {stale_holder['agent_instance']}")
        print(f"  Incident recorded: {incident_file}")
        
    finally:
        os.rmdir(breaking_dir)
```

#### 3.3 Implement status commands

```python
def show_locks(self):
    """Show current scope locks"""
    locks_dir = f"{self.coord_path}/locks"
    
    locks = []
    for lock_name in os.listdir(locks_dir):
        if lock_name.endswith(".lock"):
            scope = lock_name.replace(".lock", "")
            holder = self._read_holder(f"{locks_dir}/{lock_name}")
            locks.append((scope, holder))
    
    if not locks:
        print("No locks currently held")
        return
    
    print("Current scope locks:\n")
    for scope, holder in locks:
        expires_in = self._time_until_expiry(holder)
        print(f"  {scope}")
        print(f"    Holder: {holder['agent_instance']}")
        print(f"    Expires: in {expires_in}")
        if 'task' in holder:
            print(f"    Task: {holder['task']}")
        print()

def show_handoffs(self, agent_class=None):
    """List available handoffs"""
    agent_class = agent_class or self.agent_class
    handoff_dir = f"{self.coord_path}/handoff/for-{agent_class}"
    
    if not os.path.exists(handoff_dir):
        print(f"No handoff directory for class: {agent_class}")
        return
    
    handoffs = os.listdir(handoff_dir)
    
    if not handoffs:
        print(f"No handoffs available for {agent_class}")
        return
    
    print(f"Handoffs for {agent_class}:\n")
    for filename in handoffs:
        handoff = self._read_handoff(f"{handoff_dir}/{filename}")
        scopes_status = self._check_scopes_available(handoff['scopes'])
        
        print(f"  {filename}")
        print(f"    From: {handoff['from_class']}")
        print(f"    Scopes: {handoff['scopes']} - {scopes_status}")
        print(f"    Status: {handoff['status']}")
        if 'created' in handoff:
            print(f"    Created: {handoff['created']}")
        print()
```

#### 3.4 Test Mode B (CLI) vs Mode A (bash)

Create test script:
```bash
#!/bin/bash
# Test Mode B vs Mode A equivalence

# Setup
trinoris-agent setup
# Create two identical handoffs
cp test-handoff.md coordination/handoff/for-codex-gpt-6/test-cli.md
cp test-handoff.md coordination/handoff/for-codex-gpt-6/test-bash.md

# Test Mode B (CLI)
echo "=== Testing Mode B (CLI) ==="
time trinoris-agent claim test-cli.md
trinoris-agent acquire-lock specs
# [do work]
trinoris-agent release-lock specs
trinoris-agent archive test-cli.md --outcome "completed via CLI"

# Test Mode A (bash)
echo "=== Testing Mode A (bash) ==="
time {
  mkdir coordination/claims/test-bash.md.claim
  mv coordination/handoff/for-codex-gpt-6/test-bash.md \
     coordination/active/codex-gpt-6-test/test-bash.md
  rmdir coordination/claims/test-bash.md.claim
  
  mkdir coordination/locks/specs.lock
  echo '{"agent_instance":"codex-gpt-6-test",...}' > \
    coordination/locks/specs.lock/holder.json
  
  # [do work]
  
  rm -rf coordination/locks/specs.lock
  
  mv coordination/active/codex-gpt-6-test/test-bash.md \
     coordination/archive/test-bash.md
}

# Compare
echo "=== Comparing results ==="
diff coordination/archive/test-cli.md coordination/archive/test-bash.md
echo "Command count: Mode B = 4, Mode A = 7"
```

Validate:
- Both produce identical archive files
- Mode B has fewer commands (4-5 vs 10-12)
- Mode B has better error messages
- Both handle edge cases correctly

#### 3.5 Update AGENTS.md to prefer CLI

After CLI is tested and working, update skill docs:

```bash
trinoris-agent setup --update-skills
# Regenerates AGENTS.md with "CLI is now recommended" message
```

**Deliverables:**
- ✓ trinoris-agent v0.2 with operation commands
- ✓ claim, acquire-lock, release-lock, archive implemented
- ✓ Status commands work (locks, handoffs, incidents)
- ✓ Error handling and validation
- ✓ Mode B tested against Mode A (equivalent results)
- ✓ Skills updated to recommend CLI

**Duration:** 4-6 days

---

### Phase 4: Integration with AI Tools (Week 4-5)

**Goal:** Integrate protocol into codex-cli and claude-code

**Tasks:**

#### 4.1 Codex CLI integration

Update codex-cli to use trinoris-agent:

```python
# codex-cli wrapper
def main():
    args = parse_args()
    
    # Determine instance ID
    instance_id = args.instance or f"codex-gpt-6-{uuid4().hex[:4]}"
    
    # Initialize coordination
    coord = CoordinationAgent(
        agent_class="codex-gpt-6",
        agent_instance=instance_id,
        work_dir=os.getcwd()
    )
    
    # If user specifies handoff
    if args.handoff:
        coord.claim_handoff(args.handoff)
        handoff = coord.read_handoff(args.handoff)
        
        # Acquire scopes
        for scope in handoff.scopes:
            coord.acquire_lock(scope)
        
        # Let Codex AI do work
        codex_ai.execute(handoff)
        
        # Release and archive
        for scope in handoff.scopes:
            coord.release_lock(scope)
        coord.archive_handoff(args.handoff, "completed")
```

#### 4.2 Claude Code integration

Add coordination skill:

```typescript
// .claude/skills/agent-handoff/index.ts
import { CoordinationProtocol } from 'trinoris-coordination';

export async function handleHandoff(handoffName: string) {
  const protocol = new CoordinationProtocol({
    agentClass: 'claude-opus-5',
    agentInstance: process.env.CLAUDE_INSTANCE || generateInstanceId(),
    workDir: process.cwd()
  });
  
  // Claim
  const handoff = await protocol.claim(handoffName);
  
  // Acquire locks
  await protocol.acquireLocks(handoff.scopes);
  
  // Work (Claude AI takes over)
  await claudeAI.executeHandoff(handoff);
  
  // Release and archive
  await protocol.releaseLocks();
  await protocol.archiveHandoff(handoff, 'completed');
}
```

#### 4.3 Test end-to-end workflow

Full workflow with both tools:

```
Terminal 1 (Claude):
User: "Design auth refactor, write spec"
Claude: Acquires [specs] lock
        Writes specs/auth-refactor.md
        Releases [specs] lock
        Writes handoff to for-codex-gpt-6/implement-auth.md
        Archives

Terminal 2 (Codex):
User: "Check handoffs"
Codex: Lists handoff/for-codex-gpt-6/ → sees implement-auth.md
User: "Take off from implement-auth"
Codex: Claims implement-auth.md
       Acquires [engine] lock
       Implements auth refactor
       Runs tests
       Releases [engine] lock
       Writes handoff to for-claude-opus-5/review-auth.md
       Archives

Terminal 1 (Claude):
User: "Check handoffs"
Claude: Lists handoff/for-claude-opus-5/ → sees review-auth.md
User: "Take off from review-auth"
Claude: Claims review-auth.md
        Acquires [engine] lock
        Reviews code
        Suggests improvements
        Releases [engine] lock
        Archives with outcome
```

Validate:
- 3 handoffs completed
- Each archived with outcomes
- archive/INDEX.md updated
- No collisions or data loss

**Deliverables:**
- ✓ codex-cli integrated with coordination
- ✓ claude-code integrated with coordination
- ✓ End-to-end multi-agent workflow tested
- ✓ No collisions, no data loss

**Duration:** 4-6 days

---

### Phase 5: Production Validation (Week 5-6)

**Goal:** Use protocol in real development work

**Tasks:**

#### 5.1 Real feature development

Choose a real feature to implement:
```
Example: "Add authentication to Control Tower API"

Task breakdown:
1. Claude: Design auth spec (specs scope)
2. Codex: Implement backend (engine, api scopes)
3. Claude: Review code (engine, api scopes)
4. Codex: Write tests (tests scope)
5. Claude: Update docs (specs scope)
```

Execute with handoffs between agents.

#### 5.2 Incident handling drill

Deliberately break a lock to test incident system:

```bash
# Agent 1 acquires lock, crashes
# (simulate by killing process)

# Agent 2 waits for grace period
# Agent 2 breaks lock
# Validate incident file created
# Validate evicted lock preserved in incidents/
```

#### 5.3 Performance measurement

Measure overhead:
- Time to claim handoff: < 100ms (mkdir + mv)
- Time to acquire lock: < 50ms (mkdir + write)
- Time to release lock: < 20ms (rmdir)
- Heartbeat overhead: < 1% CPU

Validate: Protocol adds minimal overhead to agent operations

#### 5.4 Scale testing

Test with 3+ agents:
```
Terminal 1: codex-gpt-6-alpha [engine]
Terminal 2: codex-gpt-6-beta [webapp]
Terminal 3: claude-opus-5-x [specs]
```

All working simultaneously, validate no collisions.

#### 5.5 Documentation updates

Based on real usage:
- Update AGENTS.md with lessons learned
- Add troubleshooting section
- Document common patterns
- Add FAQ

**Deliverables:**
- ✓ Real feature developed using protocol
- ✓ Incident handling tested and working
- ✓ Performance acceptable (< 100ms overhead)
- ✓ 3+ agents working in parallel
- ✓ Documentation updated with real-world patterns

**Duration:** 5-7 days

---

## Testing Plan

### Verification tests (from spec 05)

#### Already passing:
- ✅ MA-T01: mkdir atomicity (4,200 trials, 0 failures)
- ✅ MA-T04: claim atomicity (100 trials, 0 double-claims)
- ✅ MA-T12: break-lock serialization (60 trials, 0 double-breaks)
- ✅ MA-T10: WSL ↔ Windows compatibility

#### To implement:
- ⏳ MA-T02: Lease expiry and grace period logic
- ⏳ MA-T03: Malformed lock handling
- ⏳ MA-T05: ABA re-verify detection
- ⏳ MA-T06: Incident visibility on acquire
- ⏳ MA-T07: Scope registry ordering
- ⏳ MA-T08: Handoff format validation
- ⏳ MA-T09: Heartbeat handling
- ⏳ MA-T11: Protocol drift detection
- ⏳ MA-T13: Git scope pre-check
- ⏳ MA-T14: Instance competition
- ⏳ MA-T15: Class-based routing
- ⏳ MA-T16: Instance-specific addressing

### Acceptance criteria (from spec 05)

Track progress against MA-01 through MA-18.

---

## Risks and Mitigations

### Risk: mkdir not atomic on production filesystem

**Mitigation:** Re-run MA-T01 on every new filesystem before adoption  
**Status:** Verified on v9fs (WSL2 ↔ Windows)

### Risk: AI agents don't follow protocol correctly

**Mitigation:** Start with Mode A (transparent bash), observe AI behavior  
**Fallback:** Implement Mode B CLI to reduce AI error surface

### Risk: Lease timing too short/long

**Mitigation:** Start with 15/5/5 (lease/renewal/grace), tune based on real data  
**Monitor:** Time between renewals, frequency of breaks

### Risk: Deadlock due to scope ordering violation

**Mitigation:** Scope registry is fixed and ordered, agents must acquire in order  
**Detection:** If agents stall, check lock acquisition order

### Risk: Filesystem performance degradation

**Mitigation:** Protocol uses only mkdir/rmdir/mv (fast operations)  
**Monitor:** Lock acquire/release times, should be < 100ms

---

## Success Criteria

### Phase 1 success:
- [ ] 2 agents can claim handoffs without CLI (Mode A)
- [ ] Locks prevent concurrent edits to same scope
- [ ] Handoffs flow from one agent to another
- [ ] No data loss or collisions

### Phase 3 success:
- [ ] trinoris-agent CLI works for all operations
- [ ] Mode B requires 50% fewer commands than Mode A
- [ ] Error messages are helpful

### Phase 5 success:
- [ ] Real feature developed using protocol
- [ ] 3+ agents work in parallel without collisions
- [ ] Incident system catches and records lock breaks
- [ ] Protocol overhead < 100ms per operation
- [ ] Team prefers coordinated workflow over ad-hoc

---

## Rollout Strategy

### Week 1-2: Internal testing
- Pilot project: trinoris-control-tower (or similar)
- Team: 2 developers using Codex and Claude
- Mode: A (documentation-driven)

### Week 3-4: CLI development
- Build trinoris-agent CLI
- Migrate pilot project to Mode B
- Measure improvement (fewer commands, better errors)

### Week 5-6: Production validation
- Use in real feature development
- Expand to 3+ agents
- Document lessons learned

### Week 7+: Broader adoption
- Roll out to other projects
- Package trinoris-coordination library
- Publish documentation and examples

---

## Resources Required

### Development time:
- **Phase 1 (Mode A):** 3-5 days (1 developer)
- **Phase 3 (CLI):** 5-7 days (1 developer)
- **Phase 4 (Integration):** 4-6 days (1 developer + AI tool team)
- **Phase 5 (Validation):** 5-7 days (2 developers using protocol)

**Total:** ~20-25 developer-days

### Infrastructure:
- Git repository with coordination/ directory (already exists)
- WSL2 or Linux environment (already available)
- Python 3.9+ or Node 18+ (for CLI implementation)

### External dependencies:
- None (protocol is filesystem-only)

---

## Next Immediate Steps

**Day 1 (Today):**
1. ✓ Specifications complete (done)
2. Start trinoris-agent CLI v0.1 implementation
   - Create Python package structure
   - Implement `setup` command
   - Embed PROTOCOL.md, AGENTS.md, SKILL.md templates

**Day 2:**
3. Complete trinoris-agent CLI v0.1
   - Implement `verify` command (MA-T01 test)
   - Package and test installation
   - Validate `setup` generates correct structure

**Day 3:**
4. Initialize pilot project
   - Run `trinoris-agent setup` in pilot repo
   - Validate generated skills and structure
   - Choose first real handoff to test

**Day 4-5:**
5. Test with AI agents (skills + optional CLI)
   - Single-agent handoff workflow
   - Parallel execution (2 agents, different scopes)
   - Validate AI can use bash or CLI commands

**Day 6-10 (Week 2):**
6. Expand CLI with operation commands (v0.2)
   - Implement claim, acquire-lock, release-lock, archive
   - Test equivalence with bash approach
   - Update skills to recommend CLI

**Goal:** Full protocol validated and CLI operational by end of Week 2.

---

## Appendices

### A. File Checklist

Before starting Phase 1, ensure these files exist:

- [ ] `coordination/PROTOCOL.md` (copy from specs/01)
- [ ] `coordination/TEMPLATE-handoff.md` (copy from specs/03)
- [ ] `AGENTS.md` (at repo root, for Codex)
- [ ] `.claude/skills/agent-handoff/SKILL.md` (for Claude)
- [ ] `coordination/archive/INDEX.md` (empty, will be populated)

### B. Scope Registry Template

```markdown
# Scope Registry for [Project Name]

| Scope | Covers | Typical Work |
|-------|--------|--------------|
| engine | engine/ | Core business logic |
| webapp | webapp/, frontend/ | UI components |
| api | api/, routes/ | REST endpoints |
| specs | specs/, docs/ | Documentation |
| tests | tests/, __tests__/ | Test files |
| infra | infrastructure/, scripts/ | Deployment |
| root | package.json, tsconfig.json, .gitignore | Config files |
| git | (all git operations) | Commits, branches |

Acquisition order: engine → webapp → api → specs → tests → infra → root → git
```

### C. Handoff Template

```markdown
---
from_instance: [your-instance-id]
from_class: [your-class]
to_class: [target-class]
to_instance: any
scopes: [scope1, scope2]
status: handoff
---

# [One-line outcome]

## Goal
[Why this work exists]

## What I did
[Concrete changes with paths]

## Verified
- [Command] → [Result]

## Assumed / not verified
- [Belief] **(not verified)**

## Next step
[Single next action]

## Rollback
[How to undo if needed]
```

### D. Quick Reference Card

```
Claim handoff:
  mkdir coordination/claims/<file>.claim
  mv coordination/handoff/for-<class>/<file> coordination/active/<instance>/
  rmdir coordination/claims/<file>.claim

Acquire lock:
  mkdir coordination/locks/<scope>.lock
  echo '{"agent_instance":"...","agent_class":"...","scope":"...","acquired_at":"...","expires_at":"..."}' \
    > coordination/locks/<scope>.lock/holder.json

Release lock:
  rm -rf coordination/locks/<scope>.lock

Archive:
  mv coordination/active/<instance>/<file> coordination/archive/<file>
  # Update coordination/archive/INDEX.md
```

---

**End of Implementation Plan**

This plan is a living document. Update as implementation progresses and new insights emerge.
