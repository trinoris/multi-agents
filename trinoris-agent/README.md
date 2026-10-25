# trinoris-agent CLI

Command-line interface for the Trinoris multi-agent coordination protocol.

## Installation

```bash
pip install trinoris-coordination
```

Or install from source:
```bash
cd trinoris-agent
pip install -e .
```

## Quick Start

### 1. Initialize a project

```bash
cd /path/to/your/project
trinoris-agent setup
```

This creates:
- `coordination/` directory structure
- `.kiro/coordination.json` configuration
- `AGENTS.md` documentation for AI agents
- `.claude/skills/trinoris-coordination.md` Claude skill
- `PROTOCOL.md` full specification

### 2. Verify setup

```bash
trinoris-agent verify
```

This tests:
- Directory structure is complete
- Configuration is valid
- Documentation is present
- **mkdir atomicity** (MA-T01 test with 100 trials)

### 3. Start coordinating

AI agents can now:
- Read `AGENTS.md` for protocol instructions
- Check for handoffs in `coordination/handoff/for-<agent-class>/`
- Acquire locks, do work, release locks
- Archive completed work or create new handoffs

## Commands

### `trinoris-agent setup`

Initialize coordination structure and generate agent skills.

**Options:**
- `--force` - Overwrite existing coordination directory
- `--update-skills` - Regenerate documentation only, preserve state

**Example:**
```bash
trinoris-agent setup
trinoris-agent setup --force
trinoris-agent setup --update-skills
```

### `trinoris-agent verify`

Verify protocol setup and filesystem atomicity.

**Options:**
- `--trials N` - Number of atomicity test trials (default: 100)
- `--concurrency N` - Concurrent processes per trial (default: 8)

**Example:**
```bash
trinoris-agent verify
trinoris-agent verify --trials 200 --concurrency 32
```

### Global Options

- `--work-dir PATH` - Working directory (default: current directory)
- `--version` - Show version and exit
- `--help` - Show help message

## Version 0.1.0 Features

**Phase 0: Setup and Verification**
- ✅ Initialize coordination structure
- ✅ Generate agent documentation (AGENTS.md, skills)
- ✅ Verify setup completeness
- ✅ Test mkdir atomicity (MA-T01)
- ✅ Support WSL2/v9fs filesystem
- ✅ Configuration management

**Not Yet Implemented (v0.2+):**
- Operation commands (claim, acquire-lock, release-lock, archive)
- Status commands (locks, handoffs, incidents)
- Heartbeat management
- Incident handling
- whoami command

## Integration Modes

**Mode A: Skill-based (v0.1)**
AI agents read generated documentation and execute bash commands directly:
```bash
mkdir coordination/locks/engine.lock
echo '{"agent_instance":"..."}' > coordination/locks/engine.lock/holder.json
# ... work ...
rm -rf coordination/locks/engine.lock
```

**Mode B: CLI-driven (v0.2+)**
AI agents call CLI commands:
```bash
trinoris-agent acquire-lock engine
# ... work ...
trinoris-agent release-lock engine
```

**Current Status:** v0.1 uses Mode A. CLI commands reduce from ~12 bash commands to ~5 CLI calls.

## Filesystem Requirements

The protocol requires **atomic mkdir** operation. Verified filesystems:
- ✅ ext4 (Linux native)
- ✅ v9fs/9p (WSL2 ↔ Windows)
- ✅ Most POSIX filesystems

The `verify` command tests this automatically.

## Project Status

**Current:** Phase 0 complete (setup + verify CLI)  
**Next:** Phase 1 (test with AI agents using skills)  
**Future:** Phase 3 (expand CLI with operation commands)

See `IMPLEMENTATION-PLAN.md` for full roadmap.

## Documentation

- [Full Protocol Specification](../specs/01-coordination-protocol.md)
- [Lock Mechanism Details](../specs/02-lock-mechanism.md)
- [Handoff Format](../specs/03-handoff-format.md)
- [Agent Entry Points](../specs/04-agent-entry-points.md)
- [Verification Tests](../specs/05-verification.md)
- [CLI Interface Spec](../specs/06-cli-interface.md)

## License

© 2026 TRINORIS. All rights reserved. Proprietary and confidential.
