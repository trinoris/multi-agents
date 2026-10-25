<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->

# Agent Class/Instance Model — 2026-10-25T11:05

## Summary

Extended the protocol from 2-agent (claude, codex) to **N-agent with model-based identity**.
Agents now have:
- **Agent class** (model type): `codex-gpt-6`, `claude-opus-5`, `claude-sonnet-4`
- **Agent instance** (runtime ID): `codex-gpt-6-a3f2`, `claude-opus-5-x9k2`

Multiple instances of the same class can work in parallel. Handoffs route by class (any
instance can claim) with optional instance-specific addressing.

## Motivation

Original 2-agent design assumed:
- One "claude" agent
- One "codex" agent  
- `handoff/for-claude/` and `handoff/for-codex/`

**Limitation:** Cannot run 3 instances of codex-gpt-6 in parallel, cannot distinguish
between claude-opus-5 (architect) and claude-sonnet-4 (reviewer), no capability-based
routing.

**New model enables:**
- Parallel work: codex-gpt-6-a, codex-gpt-6-b, codex-gpt-6-c all working simultaneously
- Capability routing: handoff from architect (opus-5) to implementer (codex-gpt-6)
- Instance tracking: know which specific instance did what work
- Backward compatible: 2-agent setup still works

## Agent identity

### Agent class (static)
Model type identifier. Examples:
- `codex-gpt-6`
- `claude-opus-5`
- `claude-sonnet-4`
- `deepseek-v3`

Used for:
- Handoff routing (`to_class: codex-gpt-6`)
- Capability-based task assignment
- Directory structure (`handoff/for-codex-gpt-6/`)

### Agent instance (dynamic)
Unique runtime identifier. Examples:
- `codex-gpt-6-a3f2` (auto-generated suffix)
- `codex-gpt-6-main` (explicit name)
- `claude-opus-5-x9k2`

Used for:
- Lock ownership (`agent_instance` in `holder.json`)
- Incident tracking (who broke whose lock)
- Active work directory (`active/codex-gpt-6-a3f2/`)
- Heartbeat files (`heartbeat/codex-gpt-6-a3f2.json`)

## Directory structure changes

### Before (2-agent):
```
coordination/
├── handoff/
│   ├── for-claude/
│   └── for-codex/
├── active/
│   ├── note-1.md
│   └── note-2.md
└── heartbeat/
    ├── claude.json
    └── codex.json
```

### After (N-agent with classes):
```
coordination/
├── handoff/
│   ├── for-codex-gpt-6/         ← by class
│   ├── for-claude-opus-5/
│   └── for-claude-sonnet-4/
├── active/
│   ├── codex-gpt-6-a3f2/        ← by instance
│   │   └── task-engine.md
│   ├── codex-gpt-6-b1d8/
│   │   └── task-webapp.md
│   └── claude-opus-5-x9k2/
│       └── task-specs.md
└── heartbeat/
    ├── codex-gpt-6-a3f2.json    ← by instance
    ├── codex-gpt-6-b1d8.json
    └── claude-opus-5-x9k2.json
```

## holder.json changes

### Before:
```json
{
  "agent": "claude",
  "scope": "engine",
  "acquired_at": "2026-10-25T10:00:00Z",
  "expires_at": "2026-10-25T10:15:00Z"
}
```

### After:
```json
{
  "agent_instance": "codex-gpt-6-a3f2",
  "agent_class": "codex-gpt-6",
  "scope": "engine",
  "task": "implementing auth backend",
  "acquired_at": "2026-10-25T10:00:00Z",
  "expires_at": "2026-10-25T10:15:00Z",
  "handoff": "coordination/active/codex-gpt-6-a3f2/task-engine.md"
}
```

## Handoff frontmatter changes

### Before:
```yaml
---
from: claude
to: codex
scopes: [engine]
---
```

### After:
```yaml
---
from_instance: claude-opus-5-x9k2
from_class: claude-opus-5
to_class: codex-gpt-6              # any codex-gpt-6 instance can claim
to_instance: any                   # or: codex-gpt-6-a3f2 (specific)
scopes: [engine]
---
```

## Claiming logic

Agent instance at startup:
1. Reads configuration → learns `agent_class` (e.g., `codex-gpt-6`)
2. Generates or reads `agent_instance` (e.g., `codex-gpt-6-a3f2`)
3. Scans `handoff/for-<my-class>/` directory

For each handoff:
1. Read frontmatter
2. Check `to_class` == my class? If no, skip
3. Check `to_instance`:
   - `any` → I can claim
   - specific ID → only claim if it matches mine
4. Check `scopes`: are they available?
5. `mkdir claims/<note>.claim` (atomic)
6. If success: `mv` to `active/<my-instance>/<note>`
7. If failure: another instance claimed it, try next

## Use cases enabled

### 1. Parallel implementation by same model
```
Task: Refactor 3 modules

codex-gpt-6-a3f2: claims task-engine.md   [engine]
codex-gpt-6-b1d8: claims task-webapp.md   [webapp]
codex-gpt-6-c5x1: claims task-api.md      [api]

All work in parallel, zero coordination overhead.
```

### 2. Capability-based workflow
```
claude-opus-5-x9k2 (architect):
  - Design system architecture
  - Write specs/auth-design.md
  - Handoff → for-codex-gpt-6/implement-auth.md

codex-gpt-6-a3f2 (implementer):
  - Claims implement-auth.md
  - Generates code
  - Writes tests
  - Handoff → for-claude-sonnet-4/review-auth.md

claude-sonnet-4-p3j1 (reviewer):
  - Claims review-auth.md
  - Reviews code quality
  - Suggests refactors
  - Handoff → for-codex-gpt-6/apply-refactors.md

codex-gpt-6-b1d8 (different instance):
  - Claims apply-refactors.md
  - Applies changes
  - Archives with outcome

Four agents, three model classes, zero orchestration.
```

### 3. Instance-specific work
```yaml
# Emergency: codex-gpt-6-a3f2 left work half-done before crash
---
to_class: codex-gpt-6
to_instance: codex-gpt-6-a3f2    # must be that specific instance
---

Only codex-gpt-6-a3f2 will claim this (if it restarts).
Others see it but skip it.
```

## Archive index format update

### Before:
```markdown
- `task-engine.md` — [engine] — completed: refactored
```

### After:
```markdown
- `task-engine.md` — [engine] — codex-gpt-6-a3f2 — completed: refactored auth service
```

Adds instance ID for traceability. Answers:
- Which instance did this work?
- Which model class handles which scopes best?
- If bugs appear, which agent instance's work should we review?

## Backward compatibility

### Two-agent setup still works

Old-style handoffs without class/instance:
```yaml
---
from: claude
to: codex
scopes: [engine]
---
```

Interpreted as:
```yaml
---
from_instance: claude      # treated as instance ID
from_class: claude         # inferred
to_class: codex
to_instance: any
scopes: [engine]
---
```

So a repo with only "claude" and "codex" (no model suffixes) continues to function. The
protocol is backward compatible but forward-enhanced.

## Hard rule changes

New rules added:
- **Rule 9**: Only claim handoffs addressed to your agent class (matching `to_class`) and
  to you specifically or `to_instance: any`.
- **Rule 11**: State assumptions as assumptions (renumbered from 10).

Updated rules:
- **Rule 4**: Re-verify by checking `agent_instance` in `holder.json`, not just presence.
- **Rule 8**: Never edit another agent class's handoff directory or another instance's
  active directory.

## Test coverage

New tests required:

| Test | What it validates |
|------|------------------|
| MA-T14 | Multiple instances of same class compete for handoffs, exactly one wins |
| MA-T15 | Class-based routing: codex-gpt-6 doesn't claim claude-opus-5 handoffs |
| MA-T16 | Instance-specific addressing: only target instance claims |

Acceptance criteria added:
- MA-11: Agents correctly identify with both class and instance in all files
- MA-12: Handoff claiming respects `to_class` and `to_instance`
- MA-13: Multiple instances work in parallel without collision

## Migration path

For existing deployments:

1. **Add agent class to configuration:**
   ```json
   {
     "agent": {
       "class": "codex-gpt-6",
       "instance_id": "auto"
     }
   }
   ```

2. **Update handoff directories:**
   ```bash
   mv coordination/handoff/for-codex coordination/handoff/for-codex-gpt-6
   mv coordination/handoff/for-claude coordination/handoff/for-claude-opus-5
   ```

3. **Update existing active work:**
   ```bash
   mkdir -p coordination/active/codex-gpt-6-main
   mv coordination/active/*.md coordination/active/codex-gpt-6-main/
   ```

4. **Update lock files:** Rewrite any live `holder.json` to include `agent_instance` and
   `agent_class` fields.

5. **Test with 2 instances:** Run two instances of same class on different scopes, verify
   no collision.

## Implementation notes

### At agent startup:
```python
# Read config
agent_class = config.get("agent.class")  # "codex-gpt-6"
instance_id = config.get("agent.instance_id")

if instance_id == "auto":
    # Generate: codex-gpt-6-a3f2
    suffix = generate_short_id()
    agent_instance = f"{agent_class}-{suffix}"
else:
    agent_instance = instance_id

# Now use agent_instance in all holder.json, heartbeat files
# Scan handoff/for-{agent_class}/ for claimable work
```

### Claiming handoff:
```python
def can_claim(handoff_frontmatter, my_class, my_instance):
    if handoff_frontmatter["to_class"] != my_class:
        return False
    
    to_instance = handoff_frontmatter.get("to_instance", "any")
    if to_instance != "any" and to_instance != my_instance:
        return False
    
    # Check scopes available
    for scope in handoff_frontmatter["scopes"]:
        if is_scope_held_by_other(scope):
            return False
    
    return True
```

## Open questions

- Should `agent_class` be freeform or from a registry? (Leaning toward freeform with
  convention: `<model>-<variant>-<version>`)
- Should there be a `coordination/agents.json` listing all known active instances? (Leaning
  toward no — heartbeat files already provide this)
- How long should heartbeat files persist after an instance exits? (Recommendation: 1 hour,
  then delete)

## References

- Spec 01: Core protocol updated with agent identity section
- Spec 03: Handoff format updated with class/instance fields
- Spec 05: New tests MA-T14, T15, T16 and acceptance criteria MA-11, 12, 13
- UPDATES-2026-10-25.md: Previous operational improvements

---

**Status**: Spec changes complete, implementation pending, tests unwritten.

This extension enables the protocol to scale from 2 agents to N agents organized by
capability (model class) with parallel execution (multiple instances). The filesystem
coordination mechanism remains unchanged — all new features are layered on top of the
existing atomic primitives.
