<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->

# Integration Modes — 2026-10-25T11:42

## Summary

The protocol supports **two integration modes** for AI agents:

1. **Mode A: Documentation-driven (skill-based)** — AI reads markdown, executes bash
2. **Mode B: CLI-driven (wrapper tool)** — AI calls `trinoris-agent` commands

Both are valid. Choose based on implementation complexity and AI agent capabilities.

## Mode A: Documentation-driven (skill-based)

### How it works

The AI agent reads skill documentation files and executes raw bash commands to follow the
protocol. No separate trinoris-agent binary needed.

### User workflow

```
User in IDE: "Take off from task-engine"

Codex AI internal reasoning:
  [User said "take off from task-engine"]
  [Check if multi-agent protocol exists]
  
  → Execute: cat AGENTS.md
  [Discovers: coordination protocol exists, read PROTOCOL.md]
  
  → Execute: cat coordination/PROTOCOL.md
  [Learns: handoffs in coordination/handoff/for-codex-gpt-6/]
  [Learns: claim with mkdir, acquire locks, etc.]
  
  → Execute: ls coordination/handoff/for-codex-gpt-6/
  Output: task-engine.md, task-api.md
  [Found the handoff]
  
  → Execute: mkdir coordination/claims/task-engine.md.claim
  [Atomic claim token acquired]
  
  → Execute: mv coordination/handoff/for-codex-gpt-6/task-engine.md \
                coordination/active/codex-gpt-6-a3f2/task-engine.md
  [Handoff moved to my active directory]
  
  → Execute: rmdir coordination/claims/task-engine.md.claim
  [Claim token released]
  
  → Execute: cat coordination/active/codex-gpt-6-a3f2/task-engine.md
  [Read handoff content]
  Parse: scopes=[engine], status=handoff
  
  → Execute: mkdir coordination/locks/engine.lock
  [Lock directory created]
  
  → Execute: echo '{"agent_instance":"codex-gpt-6-a3f2",...}' > \
                coordination/locks/engine.lock/holder.json
  [Holder metadata written]
  
  [Now I hold engine lock, can edit engine/ files]
  
  → Execute: cat engine/auth.js
  [Read current code]
  
  [AI analyzes and generates new code]
  
  → Execute: write to engine/auth.js [new code]
  [File edited]
  
  → Execute: cd engine && npm test
  Output: 83 tests passed
  [Tests pass, work complete]
  
  → Execute: rm -rf coordination/locks/engine.lock
  [Lock released]
  
  → Execute: mv coordination/active/codex-gpt-6-a3f2/task-engine.md \
                coordination/archive/task-engine.md
  [Handoff archived]
  
Codex to user:
  "Completed task-engine! Refactored auth service, all tests pass."
```

### Files the AI reads

**1. Entry point: `AGENTS.md`** (for Codex)
```markdown
# Agent Instructions

Multiple agents may share this working tree.

**Read `coordination/PROTOCOL.md` before editing.**

When the user says "take off from X":
1. List: coordination/handoff/for-codex-gpt-6/
2. Claim: mkdir claims/X.claim, mv to active/, rmdir claim
3. Read X.md to know which scopes you need
4. Acquire: mkdir locks/<scope>.lock, write holder.json
5. Do the work
6. Release: rm -rf locks/<scope>.lock
7. Archive: mv active/X.md to archive/
```

**2. Full protocol: `coordination/PROTOCOL.md`**

Complete spec 01 content (scope registry, lock rules, handoff lifecycle).

**3. The handoff: `coordination/handoff/for-codex-gpt-6/task-engine.md`**

```markdown
---
from_class: claude-opus-5
to_class: codex-gpt-6
scopes: [engine]
---

# Implement auth backend

## Next step
Refactor engine/auth.js to use new interface
```

### Bash commands the AI executes

```bash
# Discovery
cat AGENTS.md
cat coordination/PROTOCOL.md
ls coordination/handoff/for-codex-gpt-6/

# Claiming (3 commands)
mkdir coordination/claims/task-engine.md.claim
mv coordination/handoff/for-codex-gpt-6/task-engine.md \
   coordination/active/codex-gpt-6-a3f2/task-engine.md
rmdir coordination/claims/task-engine.md.claim

# Reading
cat coordination/active/codex-gpt-6-a3f2/task-engine.md

# Locking (2 commands)
mkdir coordination/locks/engine.lock
echo '{"agent_instance":"codex-gpt-6-a3f2","agent_class":"codex-gpt-6",...}' > \
  coordination/locks/engine.lock/holder.json

# [Work happens: read files, edit files, run tests]

# Unlocking (1 command)
rm -rf coordination/locks/engine.lock

# Archiving (1 command)
mv coordination/active/codex-gpt-6-a3f2/task-engine.md \
   coordination/archive/task-engine.md
```

**Total: ~10-12 bash commands per handoff cycle**

### Pros

✅ **No implementation needed** — Just markdown documentation  
✅ **Transparent** — AI sees every operation  
✅ **Debuggable** — Human can see exact commands executed  
✅ **Zero dependencies** — No binary, no library  
✅ **Flexible** — AI can adapt commands if needed

### Cons

❌ **Verbose** — 10+ commands per cycle  
❌ **Error-prone** — AI might execute commands in wrong order  
❌ **Duplicated logic** — Each AI tool reimplements decision-making  
❌ **No validation** — No central place to catch mistakes

---

## Mode B: CLI-driven (wrapper tool)

### How it works

The AI agent calls `trinoris-agent` CLI commands that encapsulate protocol logic. The CLI
handles mkdir, mv, holder.json, etc. internally.

### User workflow

```
User in IDE: "Take off from task-engine"

Codex AI:
  [User said "take off from task-engine"]
  
  → Execute: trinoris-agent handoffs
  Output:
    Available handoffs for codex-gpt-6:
      task-engine.md [engine] - available
      task-api.md [api] - available
  
  → Execute: trinoris-agent claim task-engine.md
  Output:
    Claimed: task-engine.md
    Scopes required: [engine]
    Handoff path: active/codex-gpt-6-a3f2/task-engine.md
  
  → Execute: cat coordination/active/codex-gpt-6-a3f2/task-engine.md
  [Read handoff content, understand goal]
  
  → Execute: trinoris-agent acquire-lock engine
  Output:
    Lock acquired: engine
    Expires at: 2026-10-25T11:57:00Z
  
  [Now I hold engine lock, can edit]
  
  → Execute: cat engine/auth.js
  [Read current code]
  
  [AI generates new code]
  
  → Execute: write to engine/auth.js [new code]
  
  → Execute: cd engine && npm test
  Output: 83 tests passed
  
  → Execute: trinoris-agent release-lock engine
  Output:
    Lock released: engine
  
  → Execute: trinoris-agent archive task-engine.md \
                --outcome "completed: refactored auth, tests pass"
  Output:
    Archived to: coordination/archive/task-engine.md
    Updated: coordination/archive/INDEX.md
  
Codex to user:
  "Completed task-engine! Refactored auth service, all tests pass."
```

### Commands the AI executes

```bash
# Discovery
trinoris-agent handoffs

# Claiming (1 command)
trinoris-agent claim task-engine.md

# Reading
cat coordination/active/codex-gpt-6-a3f2/task-engine.md

# Locking (1 command)
trinoris-agent acquire-lock engine

# [Work happens: read files, edit files, run tests]

# Unlocking (1 command)
trinoris-agent release-lock engine

# Archiving (1 command)
trinoris-agent archive task-engine.md --outcome "completed: tests pass"
```

**Total: ~5-6 commands per handoff cycle**

### CLI commands available

```bash
# Status (non-destructive)
trinoris-agent status                        # Overall status
trinoris-agent locks                         # Show current locks
trinoris-agent handoffs                      # List available handoffs
trinoris-agent incidents                     # Show recent incidents

# Lifecycle (for AI agents)
trinoris-agent claim <file>                  # Claim handoff
trinoris-agent acquire-lock <scope>          # Acquire lock
trinoris-agent release-lock <scope>          # Release lock
trinoris-agent renew-lease <scope>           # Renew lease
trinoris-agent archive <file> --outcome <s>  # Archive with outcome

# Helpers
trinoris-agent check-scope <scope>           # Check if available (exit code)
trinoris-agent init                          # Initialize protocol
trinoris-agent verify                        # Run MA-T01 test
```

### Pros

✅ **Concise** — 5 commands vs 12  
✅ **Reliable** — CLI handles all edge cases  
✅ **Consistent** — All AI tools use same implementation  
✅ **Better errors** — CLI validates and gives helpful messages  
✅ **Atomic** — CLI ensures mkdir/mv sequences are correct

### Cons

❌ **Requires implementation** — Must build the CLI  
❌ **Black box** — AI doesn't see mkdir/mv internals  
❌ **Dependency** — Must install trinoris-agent binary  
❌ **Less flexible** — AI can't adapt commands

---

## Comparison

| Aspect | Mode A (Skill) | Mode B (CLI) |
|--------|----------------|--------------|
| **Commands per cycle** | 10-12 | 5-6 |
| **Implementation** | Markdown only | Requires binary |
| **Transparency** | Full (AI sees all bash) | Partial (CLI is black box) |
| **Error handling** | AI responsibility | CLI responsibility |
| **Consistency** | Each AI reimplements | Central implementation |
| **Debugging** | See exact commands | See CLI calls + internals |
| **Adoption speed** | Immediate (just docs) | Slower (must build CLI) |
| **Maintenance** | Update docs | Update CLI code |

## Hybrid approach (recommended)

**Use both modes together:**

1. **AI reads docs (Mode A) for conceptual understanding**
   - What are scopes?
   - Why do leases exist?
   - What's the ABA problem?
   - When to check incidents?

2. **AI calls CLI (Mode B) for execution**
   - `trinoris-agent claim task-engine.md`
   - `trinoris-agent acquire-lock engine`
   - `trinoris-agent release-lock engine`

**Benefits:**
- AI understands *why* (from reading PROTOCOL.md)
- Operations are *correct* (CLI handles edge cases)
- Best of both worlds

## Implementation path

### Phase 1: Mode A only (spec-complete, no coding)
```
1. Write AGENTS.md and .claude/skills/agent-handoff/SKILL.md
2. Copy coordination/PROTOCOL.md to repo
3. AI reads docs, executes bash commands
4. Test with 2 agents in same repo
```

### Phase 2: Add Mode B (build CLI)
```
1. Implement trinoris-agent CLI (Python or TypeScript)
2. Test claim, acquire-lock, release-lock, archive
3. Update AI agent to call CLI instead of bash
4. Compare: fewer commands, better errors
```

### Phase 3: Hybrid (recommended end state)
```
1. AI reads PROTOCOL.md on first run (learns protocol)
2. AI calls trinoris-agent commands for operations
3. AI can fall back to bash if CLI unavailable
```

## Real-world examples

### Codex using Mode A (skill-based)

```python
# Codex internals (pseudocode)

def handle_user_request(user_input):
    if "take off from" in user_input:
        handoff_name = extract_handoff_name(user_input)
        
        # Read skill doc
        skill = read_file("AGENTS.md")
        protocol = read_file("coordination/PROTOCOL.md")
        
        # Execute bash commands learned from skill
        execute_bash(f"mkdir coordination/claims/{handoff_name}.claim")
        execute_bash(f"mv coordination/handoff/for-codex-gpt-6/{handoff_name} ...")
        execute_bash(f"rmdir coordination/claims/{handoff_name}.claim")
        
        # Read handoff
        handoff = read_file(f"coordination/active/codex-gpt-6-a3f2/{handoff_name}")
        scopes = parse_scopes(handoff)
        
        # Acquire locks
        for scope in scopes:
            execute_bash(f"mkdir coordination/locks/{scope}.lock")
            execute_bash(f"echo '{{...}}' > coordination/locks/{scope}.lock/holder.json")
        
        # Do work
        do_refactoring()
        
        # Release locks
        for scope in scopes:
            execute_bash(f"rm -rf coordination/locks/{scope}.lock")
        
        # Archive
        execute_bash(f"mv coordination/active/.../{handoff_name} coordination/archive/")
```

### Codex using Mode B (CLI-driven)

```python
# Codex internals (pseudocode)

def handle_user_request(user_input):
    if "take off from" in user_input:
        handoff_name = extract_handoff_name(user_input)
        
        # Claim
        result = execute_bash(f"trinoris-agent claim {handoff_name}")
        scopes = parse_scopes_from_output(result)
        
        # Read handoff
        handoff = read_file(f"coordination/active/codex-gpt-6-a3f2/{handoff_name}")
        
        # Acquire locks
        for scope in scopes:
            execute_bash(f"trinoris-agent acquire-lock {scope}")
        
        # Do work
        do_refactoring()
        
        # Release locks
        for scope in scopes:
            execute_bash(f"trinoris-agent release-lock {scope}")
        
        # Archive
        execute_bash(f"trinoris-agent archive {handoff_name} --outcome 'completed'")
```

**Mode B = 50% fewer bash commands, better error handling.**

---

## Summary

**Mode A (skill-based):**
- ✅ Available now (just docs)
- ✅ Transparent
- ❌ Verbose (10+ commands)

**Mode B (CLI-driven):**
- ✅ Concise (5 commands)
- ✅ Reliable
- ❌ Requires implementation

**Hybrid (recommended):**
- Docs for understanding
- CLI for execution
- Best of both

**Decision:** Start with Mode A (no implementation needed), migrate to hybrid once CLI is built.
