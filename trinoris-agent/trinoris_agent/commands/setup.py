"""
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.

Setup command - Initialize coordination structure and generate skills
"""

import os
import shutil
from pathlib import Path
from datetime import datetime


COORDINATION_STRUCTURE = [
    "locks",
    "claims",
    "handoff",
    "active",
    "archive",
    "incidents",
    "heartbeat",
]


def setup_command(work_dir: Path, force: bool, update_skills: bool):
    """
    Initialize coordination structure and generate agent skills.
    
    Args:
        work_dir: Root directory of the project
        force: Overwrite existing coordination directory
        update_skills: Update skills only, preserve state
    """
    coord_dir = work_dir / "coordination"
    
    # Check existing coordination directory
    if coord_dir.exists() and not force and not update_skills:
        print(f"✗ Coordination directory already exists: {coord_dir}")
        print("  Use --force to overwrite or --update-skills to regenerate docs")
        return
    
    if update_skills:
        print("Updating skills and documentation...")
        _generate_skills(work_dir, coord_dir)
        print("✓ Skills updated")
        return
    
    # Create coordination structure
    print(f"Setting up coordination in: {work_dir}")
    
    if coord_dir.exists() and force:
        print(f"  Removing existing: {coord_dir}")
        shutil.rmtree(coord_dir)
    
    coord_dir.mkdir(exist_ok=True)
    
    # Create directory structure
    for subdir in COORDINATION_STRUCTURE:
        (coord_dir / subdir).mkdir(exist_ok=True)
        print(f"  ✓ {subdir}/")
    
    # Create handoff agent class directories
    agent_classes = ["codex-gpt-6", "claude-opus-5", "claude-sonnet-4", "kiro"]
    for agent_class in agent_classes:
        (coord_dir / "handoff" / f"for-{agent_class}").mkdir(exist_ok=True)
        print(f"  ✓ handoff/for-{agent_class}/")
    
    # Create archive index
    _create_archive_index(coord_dir / "archive")
    
    # Create configuration
    _create_config(work_dir)
    
    # Generate skills and documentation
    _generate_skills(work_dir, coord_dir)
    
    print("\n✓ Setup complete!")
    print(f"\nNext steps:")
    print(f"  1. Run: trinoris-agent verify")
    print(f"  2. Read: {work_dir / 'AGENTS.md'}")
    print(f"  3. Create first handoff in: {coord_dir / 'handoff'}")


def _create_archive_index(archive_dir: Path):
    """Create archive INDEX.md"""
    index_path = archive_dir / "INDEX.md"
    
    template = f"""# Handoff Archive Index

Created: {datetime.now().isoformat()}

## Recent Handoffs

_(Most recent first)_

<!-- New entries will be added here automatically -->

## Search Tips

Search by:
- Agent class: `grep "From: codex-gpt-6" *.md`
- Scope: `grep "Scopes: engine" *.md`
- Status: `grep "Status: completed" *.md`
- Date: `ls -lt` (most recent first)

## Format

Each entry follows this pattern:
```
### YYYY-MM-DDTHH-MM-SS-<slug>.md
- From: <agent-class>
- To: <agent-class>
- Scopes: <scope-list>
- Status: <outcome>
- Created: <timestamp>
```
"""
    
    index_path.write_text(template)
    print(f"  ✓ archive/INDEX.md")


def _create_config(work_dir: Path):
    """Create .kiro/coordination.json config file"""
    kiro_dir = work_dir / ".kiro"
    kiro_dir.mkdir(exist_ok=True)
    
    config_path = kiro_dir / "coordination.json"
    
    config = """{
  "version": "0.1.0",
  "protocol_version": "1.0",
  "created_at": "%s",
  
  "scopes": {
    "registry": ["engine", "webapp", "api", "agents", "infra", "specs", "tests", "root", "git"],
    "lease_duration_minutes": 15,
    "renewal_threshold_minutes": 5,
    "grace_period_minutes": 5
  },
  
  "agent_classes": [
    "codex-gpt-6",
    "claude-opus-5",
    "claude-sonnet-4",
    "kiro"
  ],
  
  "heartbeat": {
    "enabled": true,
    "interval_seconds": 60
  },
  
  "incidents": {
    "check_window_hours": 1
  }
}
""" % datetime.now().isoformat()
    
    config_path.write_text(config)
    print(f"  ✓ .kiro/coordination.json")


def _generate_skills(work_dir: Path, coord_dir: Path):
    """Generate AGENTS.md and .claude/skills/SKILL.md"""
    
    # Copy templates
    templates_dir = Path(__file__).parent.parent / "templates"
    
    # Generate AGENTS.md (for codex-cli)
    agents_md = _get_agents_template()
    (work_dir / "AGENTS.md").write_text(agents_md)
    print(f"  ✓ AGENTS.md")
    
    # Generate .claude/skills/trinoris-coordination.md
    claude_dir = work_dir / ".claude" / "skills"
    claude_dir.mkdir(parents=True, exist_ok=True)
    
    skill_md = _get_skill_template()
    (claude_dir / "trinoris-coordination.md").write_text(skill_md)
    print(f"  ✓ .claude/skills/trinoris-coordination.md")
    
    # Copy full protocol spec
    protocol_src = work_dir / "specs" / "01-coordination-protocol.md"
    if protocol_src.exists():
        shutil.copy(protocol_src, work_dir / "PROTOCOL.md")
        print(f"  ✓ PROTOCOL.md (copied from specs)")


def _get_agents_template() -> str:
    """Get AGENTS.md template for codex-cli"""
    return """# Multi-Agent Coordination Protocol

**Version:** 1.0  
**Generated:** %s  
**CLI:** trinoris-agent v0.1.0

## Quick Start

You are working in a repository with multiple AI agents. This protocol prevents conflicts.

### Check for handoffs

```bash
ls coordination/handoff/for-$(trinoris-agent whoami --class)/
```

### Claim a handoff

```bash
# Read the handoff first
cat coordination/handoff/for-codex-gpt-6/task-123.md

# Claim it (atomic)
mkdir coordination/claims/task-123.md.claim
mv coordination/handoff/for-codex-gpt-6/task-123.md \\
   coordination/active/$(trinoris-agent whoami --instance)/task-123.md
rmdir coordination/claims/task-123.md.claim
```

### Acquire scope lock

```bash
# Lock the 'engine' scope
mkdir coordination/locks/engine.lock

# Write holder info
cat > coordination/locks/engine.lock/holder.json <<EOF
{
  "agent_instance": "$(trinoris-agent whoami --instance)",
  "agent_class": "$(trinoris-agent whoami --class)",
  "scope": "engine",
  "acquired_at": "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)",
  "expires_at": "$(date -u -d '+15 minutes' +%%Y-%%m-%%dT%%H:%%M:%%SZ)"
}
EOF
```

### Release lock

```bash
rm -rf coordination/locks/engine.lock
```

### Archive handoff

```bash
# Append outcome
cat >> coordination/active/$(trinoris-agent whoami --instance)/task-123.md <<EOF

## Outcome

Completed successfully. Changed 3 files in engine/.
EOF

# Move to archive
mv coordination/active/$(trinoris-agent whoami --instance)/task-123.md \\
   coordination/archive/task-123.md
```

## Scope Registry (Acquire in This Order)

1. engine
2. webapp
3. api
4. agents
5. infra
6. specs
7. tests
8. root
9. git

**Why order matters:** Prevents deadlocks. Always acquire multiple locks in this order.

## Check Before Writes

Before any write operation, re-verify you still hold the lock:

```bash
# Verify agent_instance matches
jq -r .agent_instance coordination/locks/engine.lock/holder.json
# Should equal: $(trinoris-agent whoami --instance)
```

## Full Protocol

See `PROTOCOL.md` for complete specification.

---
Generated by trinoris-agent v0.1.0
""" % datetime.now().isoformat()


def _get_skill_template() -> str:
    """Get .claude/skills template for Claude"""
    return """---
skill: trinoris-multi-agent-coordination
version: 1.0
generated: %s
---

# Multi-Agent Coordination

You are working in a repository where multiple AI agents may work simultaneously.
Follow this protocol to avoid conflicts.

## Core Concepts

- **Scopes**: Areas of the codebase (engine, webapp, api, etc.)
- **Locks**: Exclusive access to a scope (15 min lease)
- **Handoffs**: Work passed between agents
- **Agent classes**: codex-gpt-6, claude-opus-5, claude-sonnet-4, kiro

## Workflow

### 1. Check for handoffs

```bash
ls coordination/handoff/for-$(trinoris-agent whoami --class)/
```

### 2. Claim a handoff

```bash
mkdir coordination/claims/<file>.claim
mv coordination/handoff/for-<your-class>/<file> \\
   coordination/active/$(trinoris-agent whoami --instance)/<file>
rmdir coordination/claims/<file>.claim
```

### 3. Acquire locks

```bash
mkdir coordination/locks/<scope>.lock
echo '{"agent_instance":"...","scope":"..."}' > \\
  coordination/locks/<scope>.lock/holder.json
```

### 4. Do work

Work on the files in your locked scope(s).

### 5. Release locks

```bash
rm -rf coordination/locks/<scope>.lock
```

### 6. Archive or handoff

```bash
# Archive completed work
mv coordination/active/$(trinoris-agent whoami --instance)/<file> \\
   coordination/archive/<file>

# OR create new handoff
cat > coordination/handoff/for-<next-agent>/<new-file>.md <<EOF
---
from_class: $(trinoris-agent whoami --class)
to_class: <target-agent-class>
scopes: <required-scopes>
status: ready
created: $(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ)
---

# Task Title

## What I Verified
...

## What I Assumed
...
EOF
```

## Scope Order (Deadlock Prevention)

Always acquire multiple locks in this order:
engine → webapp → api → agents → infra → specs → tests → root → git

## Re-verify Before Writes

```bash
# Check you still hold the lock
jq -r .agent_instance coordination/locks/<scope>.lock/holder.json
```

## Full Documentation

See `AGENTS.md` or `PROTOCOL.md` for complete details.

---
Generated by trinoris-agent v0.1.0
""" % datetime.now().isoformat()
