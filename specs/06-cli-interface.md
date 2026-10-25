<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->


# 06 — CLI interface and agent invocation

## Status: PROPOSED

How agents are invoked, configured, and controlled. This spec defines the command-line
interface, configuration format, and operational modes for any tool implementing the
coordination protocol.

The protocol (specs 01-05) defines **what agents do**. This spec defines **how humans
launch and control them**.

## Design principles

1. **Agent-agnostic** — The interface works for any agent class (codex-gpt-6,
   claude-opus-5, etc.). Tool-specific wrappers provide defaults.
2. **Zero-config default** — Running with no arguments works in most cases (auto-detect
   class, auto-generate instance ID, use current directory).
3. **Explicit when needed** — Critical parameters (class, instance) can be set explicitly
   for reproducibility.
4. **Observable** — Status commands show locks, handoffs, incidents without doing work.
5. **Automatable** — One-shot and daemon modes support scripting and CI/CD.

## Command-line interface

### Generic agent (tool-agnostic)

```bash
trinoris-agent [options] [command]

Options:
  --class <name>              Agent class (e.g., codex-gpt-6, claude-opus-5)
                              REQUIRED unless set in config or via wrapper
  --instance <id>             Instance ID (default: auto-generate from class+uuid)
  --work-dir <path>           Working directory (default: current directory)
  --config <file>             Config file (default: .kiro/coordination.json)
  
  --mode <mode>               Operational mode:
                                interactive - prompt for handoffs (default)
                                once - claim one handoff, work, exit
                                daemon - continuous, watch for new handoffs
  
  --claim <file>              Claim specific handoff file (implies --mode once)
  --prefer-scopes <scopes>    Comma-separated: prefer these scopes
  --avoid-scopes <scopes>     Comma-separated: avoid these scopes
  
  --lease-duration <sec>      Lease duration in seconds (default: 900 = 15min)
  --grace-period <sec>        Grace period before breaking (default: 300 = 5min)
  --heartbeat-interval <sec>  Heartbeat interval (default: 120 = 2min)
  
  --dry-run                   Check protocol, show what would be claimed, exit
  --verbose                   Verbose logging
  --quiet                     Minimal output
  --version                   Show version and exit
  --help                      Show help and exit

Commands (without starting agent):
  status                      Show locks, handoffs, incidents
  locks                       Show current scope locks
  handoffs [--class <name>]   List available handoffs (default: for my class)
  incidents [--scope <name>]  Show recent incidents (default: all)
  init                        Create coordination/ structure in current repo
  verify                      Verify protocol installation (runs MA-T01 if available)

Commands (for AI agents in Mode B - CLI-driven):
  claim <file>                Claim a handoff atomically (mkdir + mv)
  acquire-lock <scope>        Acquire a scope lock
  release-lock <scope>        Release a scope lock
  renew-lease <scope>         Renew lease on held lock
  archive <file>              Archive handoff with outcome
    --outcome <string>        Outcome description (required)
  check-scope <scope>         Check if scope is available (exit 0=free, 1=held)
  
Examples:
  # Auto-generate instance, work interactively
  trinoris-agent --class codex-gpt-6
  
  # Explicit instance ID (reproducible)
  trinoris-agent --class claude-opus-5 --instance claude-main
  
  # Claim specific handoff and exit when done
  trinoris-agent --class codex-gpt-6 --claim task-engine.md
  
  # Daemon mode for CI/CD
  trinoris-agent --class codex-gpt-6 --mode daemon --work-dir /build/repo
  
  # Check status without starting
  trinoris-agent status
  trinoris-agent locks
  trinoris-agent handoffs --class codex-gpt-6

Mode B examples (AI agent calls these):
  # Claim handoff
  trinoris-agent claim task-engine.md
  
  # Acquire lock
  trinoris-agent acquire-lock engine
  
  # Check if scope is free
  trinoris-agent check-scope engine && echo "available" || echo "held"
  
  # Release lock
  trinoris-agent release-lock engine
  
  # Archive with outcome
  trinoris-agent archive task-engine.md --outcome "completed: tests pass"
```

### Tool-specific wrappers

Tools implementing the protocol provide their own wrappers with baked-in defaults:

```bash
# Codex wrapper
codex-cli [options] [command]
# Implicit: --class codex-gpt-6

# Claude wrapper
claude-code [options] [command]
# Implicit: --class claude-opus-5 (or sonnet-4, haiku-3 based on model)

# Kiro wrapper
kiro agent [options] [command]
# Reads class from .kiro/settings.json or prompts
```

All accept the same options as `trinoris-agent`, but provide tool-specific defaults.

## Configuration file

Location precedence (first found wins):
1. `--config <file>` (explicit flag)
2. `.kiro/coordination.json` (workspace-specific)
3. `~/.kiro/coordination.json` (user-specific)
4. Built-in defaults

Format:

```json
{
  "agent": {
    "class": "codex-gpt-6",
    "instance_id": "auto",
    "capabilities": ["code-generation", "refactoring", "testing"]
  },
  
  "coordination": {
    "protocol_path": "coordination/",
    "lease_duration": 900,
    "grace_period": 300,
    "heartbeat_interval": 120,
    "check_incidents_on_acquire": true
  },
  
  "routing": {
    "prefer_scopes": ["engine", "api"],
    "avoid_scopes": ["docs"],
    "auto_claim": true,
    "class_filter": null
  },
  
  "behavior": {
    "mode": "interactive",
    "verify_before_commit": true,
    "archive_completed": true,
    "max_handoffs_per_session": 5
  },
  
  "logging": {
    "level": "info",
    "file": "coordination/logs/agent.log",
    "include_timestamps": true
  }
}
```

### Field descriptions

| Section | Field | Type | Description |
|---------|-------|------|-------------|
| `agent` | `class` | string | Agent class (e.g., `codex-gpt-6`) |
| `agent` | `instance_id` | string | Instance ID or `"auto"` to generate |
| `agent` | `capabilities` | array | Freeform tags (for human reference) |
| `coordination` | `protocol_path` | string | Path to coordination/ directory |
| `coordination` | `lease_duration` | int | Seconds (default: 900) |
| `coordination` | `grace_period` | int | Seconds before breaking (default: 300) |
| `coordination` | `heartbeat_interval` | int | Seconds between heartbeats (default: 120) |
| `coordination` | `check_incidents_on_acquire` | bool | Check incidents before claiming (default: true) |
| `routing` | `prefer_scopes` | array | Prefer handoffs needing these scopes |
| `routing` | `avoid_scopes` | array | Avoid handoffs needing these scopes |
| `routing` | `auto_claim` | bool | Claim first available without prompting |
| `routing` | `class_filter` | string | Only claim handoffs for this class (null = my class) |
| `behavior` | `mode` | string | `interactive`, `once`, or `daemon` |
| `behavior` | `verify_before_commit` | bool | Run tests before committing |
| `behavior` | `archive_completed` | bool | Auto-archive on completion |
| `behavior` | `max_handoffs_per_session` | int | Exit after N handoffs (0 = unlimited) |
| `logging` | `level` | string | `debug`, `info`, `warn`, `error` |
| `logging` | `file` | string | Log file path (null = stdout only) |
| `logging` | `include_timestamps` | bool | Timestamp each log line |

## Operational modes

### Interactive mode (default)

```bash
$ trinoris-agent --class codex-gpt-6

Agent: codex-gpt-6-a3f2
Working directory: /my-project
Protocol: coordination/PROTOCOL.md (v1.0) ✓
Configuration: .kiro/coordination.json

Scanning handoff/for-codex-gpt-6/...

Available handoffs:
  1. task-engine.md
     Scopes: [engine]
     From: claude-opus-5-x9k2
     Status: handoff
     Summary: Implement auth backend refactor
     
  2. task-api.md
     Scopes: [api]
     From: codex-gpt-6-b1d8
     Status: handoff
     Summary: Add webhook endpoint for external service
     
  3. task-webapp.md
     Scopes: [webapp] - BLOCKED (scope held by codex-gpt-6-b1d8, expires in 8m)
     From: claude-opus-5-x9k2
     Status: handoff
     Summary: Update login UI

Select handoff (1-3, 's' to check status, 'r' to refresh, 'q' to quit): 1

Claiming task-engine.md...
  mkdir coordination/claims/task-engine.md.claim ✓
  mv to coordination/active/codex-gpt-6-a3f2/task-engine.md ✓

Checking for recent incidents in [engine]...
  No incidents found ✓

Acquiring scope locks: [engine]
  mkdir coordination/locks/engine.lock ✓
  Writing holder.json ✓

Lock acquired. Ready to work.
Press Ctrl+C to release and exit.

[Agent now does its work via tool calls...]
```

### Once mode (one-shot)

```bash
$ trinoris-agent --class codex-gpt-6 --mode once

Agent: codex-gpt-6-a3f2 (once mode)
Claiming first available handoff...

Claimed: task-engine.md [engine]
Acquiring locks: [engine] ✓
Working...

[Agent does work]

Tests: PASS ✓
Committing changes...
Releasing locks...
Archiving handoff with outcome: completed
Done.

$ echo $?
0
```

Exit codes:
- `0` — handoff completed successfully
- `1` — no handoffs available
- `2` — handoff claimed but scopes blocked
- `3` — work failed (tests failed, etc.)
- `4` — configuration error
- `5` — protocol not found

### Daemon mode (continuous)

```bash
$ trinoris-agent --class codex-gpt-6 --mode daemon

Agent: codex-gpt-6-a3f2 (daemon mode)
Watching: handoff/for-codex-gpt-6/
Press Ctrl+C to stop gracefully

[11:20:00] No handoffs available, waiting...
[11:22:15] New handoff detected: task-engine.md
[11:22:16] Claiming task-engine.md...
[11:22:17] Acquiring locks: [engine] ✓
[11:22:18] Working on task-engine.md...
[11:30:45] Tests: PASS ✓
[11:30:46] Committed: abc1234
[11:30:47] Archived: task-engine.md
[11:30:48] No handoffs available, waiting...
[11:35:10] New handoff detected: task-api.md
[11:35:11] Claiming task-api.md...
^C
[11:36:00] Interrupt received, finishing current work...
[11:36:15] Releasing locks...
[11:36:16] Writing handoff for incomplete work...
[11:36:17] Shutdown complete.
```

Graceful shutdown:
1. Finish current tool call
2. Release all locks
3. Write handoff if work incomplete
4. Exit

## Status commands (non-destructive)

### Show all locks

```bash
$ trinoris-agent locks

Current scope locks:

  engine
    Holder: codex-gpt-6-a3f2
    Acquired: 2026-10-25T11:15:00Z
    Expires: 2026-10-25T11:30:00Z (in 12m)
    Task: implementing auth backend refactor
    Handoff: active/codex-gpt-6-a3f2/task-engine.md
    
  webapp
    Holder: codex-gpt-6-b1d8
    Acquired: 2026-10-25T11:20:00Z
    Expires: 2026-10-25T11:35:00Z (in 17m)
    Task: updating login UI
    
  specs
    Holder: claude-opus-5-x9k2
    Acquired: 2026-10-25T11:10:00Z
    Expires: 2026-10-25T11:25:00Z (in 7m)
    Task: writing auth design spec

Free scopes: api, agents, infra, tests, root, git
```

### List handoffs

```bash
$ trinoris-agent handoffs --class codex-gpt-6

Handoffs for codex-gpt-6:

  task-engine.md [engine]
    From: claude-opus-5-x9k2
    Created: 2026-10-25T10:30:00Z
    Status: handoff
    Scopes: BLOCKED (engine held by a3f2)
    
  task-api.md [api]
    From: codex-gpt-6-b1d8
    Created: 2026-10-25T11:00:00Z
    Status: handoff
    Scopes: available ✓
    
  task-tests.md [tests]
    From: claude-sonnet-4-p3j1
    Created: 2026-10-25T09:00:00Z
    Status: blocked
    Note: Waiting on deployment

Total: 3 handoffs (1 available, 1 blocked by locks, 1 blocked by status)
```

### Show incidents

```bash
$ trinoris-agent incidents

Recent incidents (last 24h):

  2026-10-25T10:34:12Z - Broken lock: engine
    Breaker: codex-gpt-6-b1d8
    Evicted: codex-gpt-6-a3f2
    Reason: Lease expired (expires_at: 10:30, now: 10:35)
    File: incidents/2026-10-25T1034-broken-engine.md
    
  2026-10-25T09:15:23Z - Broken lock: webapp
    Breaker: claude-opus-5-x9k2
    Evicted: codex-gpt-6-b1d8
    Reason: Malformed lock (holder.json missing)
    File: incidents/2026-10-25T0915-broken-webapp.md

Total: 2 incidents

$ trinoris-agent incidents --scope engine
Shows only incidents for engine scope
```

### Overall status

```bash
$ trinoris-agent status

Coordination Protocol Status

Protocol: coordination/PROTOCOL.md ✓
Version: 1.0
Working directory: /my-project

Active agents (by heartbeat):
  codex-gpt-6-a3f2    - last seen 30s ago - [engine]
  codex-gpt-6-b1d8    - last seen 2m ago - [webapp]
  claude-opus-5-x9k2  - last seen 5m ago - [specs]

Scope locks: 3/9 held (engine, webapp, specs)
Free scopes: api, agents, infra, tests, root, git

Handoffs by class:
  for-codex-gpt-6:     3 handoffs (1 available)
  for-claude-opus-5:   1 handoff (1 available)
  for-claude-sonnet-4: 0 handoffs

Recent incidents: 2 (last: 1h ago)
Archive entries: 47
```

## Protocol initialization

```bash
$ trinoris-agent init

Initializing coordination protocol in /my-project...

Creating directory structure:
  coordination/ ✓
  coordination/locks/ ✓
  coordination/claims/ ✓
  coordination/handoff/ ✓
    coordination/handoff/for-codex-gpt-6/ ✓
    coordination/handoff/for-claude-opus-5/ ✓
    coordination/handoff/for-claude-sonnet-4/ ✓
  coordination/active/ ✓
  coordination/archive/ ✓
  coordination/incidents/ ✓
  coordination/heartbeat/ ✓

Copying protocol spec:
  coordination/PROTOCOL.md ✓
  coordination/TEMPLATE-handoff.md ✓

Creating archive index:
  coordination/archive/INDEX.md ✓

Initialization complete.

Next steps:
  1. Review coordination/PROTOCOL.md
  2. Configure agent classes in .kiro/coordination.json
  3. Run 'trinoris-agent verify' to test atomicity

$ trinoris-agent verify

Running protocol verification...

MA-T01: mkdir atomicity under concurrency
  Testing with N=8 racers, 50 trials...
  Result: PASS ✓ (exactly 1 winner every trial)

Protocol verified. Safe to use.
```

## Environment variables

Alternative to command-line flags:

```bash
export TRINORIS_AGENT_CLASS="codex-gpt-6"
export TRINORIS_AGENT_INSTANCE="alpha"
export TRINORIS_WORK_DIR="/my-project"
export TRINORIS_CONFIG="/my-project/.kiro/coordination.json"
export TRINORIS_MODE="daemon"
export TRINORIS_LOG_LEVEL="debug"

# Now just run with no args
trinoris-agent
```

Precedence (highest to lowest):
1. Command-line flags
2. Environment variables
3. Configuration file
4. Built-in defaults

## Error handling

### No protocol found

```bash
$ trinoris-agent --class codex-gpt-6

Error: Coordination protocol not found
  Looked for: coordination/PROTOCOL.md in /my-project
  
Did you forget to initialize?
  Run: trinoris-agent init

Exit code: 4
```

### Class mismatch

```bash
$ trinoris-agent handoffs --class codex-gpt-6

Error: No handoff directory for class 'codex-gpt-6'
  Expected: coordination/handoff/for-codex-gpt-6/
  Found classes: claude-opus-5, claude-sonnet-4
  
Available handoffs are for other agent classes.

Exit code: 1
```

### Lock acquisition timeout

```bash
$ trinoris-agent --class codex-gpt-6 --claim task-engine.md

Claimed: task-engine.md
Acquiring locks: [engine]...
  engine is held by codex-gpt-6-b1d8 (expires in 12m)

Waiting for lock to be released...
[5 minutes pass]
Still held by codex-gpt-6-b1d8 (expires in 7m)

Error: Lock acquisition timeout
  Scope 'engine' has been held for >5 minutes
  Holder: codex-gpt-6-b1d8
  
Options:
  1. Wait for holder to release (expires in 7m)
  2. Write a handoff asking holder to yield
  3. Exit and try different work
  
Exit code: 2
```

## Logging

### Log format

```
[2026-10-25T11:20:00Z] [INFO] [codex-gpt-6-a3f2] Agent started
[2026-10-25T11:20:01Z] [INFO] [codex-gpt-6-a3f2] Scanning handoff/for-codex-gpt-6/
[2026-10-25T11:20:02Z] [INFO] [codex-gpt-6-a3f2] Found 3 handoffs
[2026-10-25T11:20:15Z] [INFO] [codex-gpt-6-a3f2] Claiming task-engine.md
[2026-10-25T11:20:16Z] [DEBUG] [codex-gpt-6-a3f2] mkdir coordination/claims/task-engine.md.claim
[2026-10-25T11:20:16Z] [INFO] [codex-gpt-6-a3f2] Claim successful
[2026-10-25T11:20:17Z] [INFO] [codex-gpt-6-a3f2] Acquiring scope: engine
[2026-10-25T11:20:17Z] [DEBUG] [codex-gpt-6-a3f2] mkdir coordination/locks/engine.lock
[2026-10-25T11:20:17Z] [INFO] [codex-gpt-6-a3f2] Lock acquired: engine
[2026-10-25T11:20:18Z] [INFO] [codex-gpt-6-a3f2] Starting work on task-engine.md
[2026-10-25T11:25:00Z] [DEBUG] [codex-gpt-6-a3f2] Heartbeat written
[2026-10-25T11:30:00Z] [INFO] [codex-gpt-6-a3f2] Tests passed
[2026-10-25T11:30:01Z] [INFO] [codex-gpt-6-a3f2] Releasing lock: engine
[2026-10-25T11:30:02Z] [INFO] [codex-gpt-6-a3f2] Archiving handoff
[2026-10-25T11:30:03Z] [INFO] [codex-gpt-6-a3f2] Work complete
```

### Log files

- `coordination/logs/<instance-id>.log` — per-instance log
- `coordination/logs/protocol.log` — all agent activity (append-only)

Rotation: daily, keep last 7 days

## Integration with agents

The protocol supports **two integration modes**: documentation-driven (skill-based) and
CLI-driven (wrapper tool). Both are valid; choose based on implementation preference.

### Mode A: Documentation-driven (skill-based)

The AI agent reads markdown skill files and executes bash commands directly to follow the
protocol. No separate trinoris-agent implementation needed.

**User workflow:**
```
User in Codex IDE: "Take off from task-engine"

Codex AI:
  1. Read: AGENTS.md → discover protocol
  2. Read: coordination/PROTOCOL.md → learn rules
  3. Execute: ls coordination/handoff/for-codex-gpt-6/
  4. Execute: mkdir coordination/claims/task-engine.md.claim
  5. Execute: mv handoff/for-codex-gpt-6/task-engine.md \
                active/codex-gpt-6-a3f2/task-engine.md
  6. Execute: rmdir coordination/claims/task-engine.md.claim
  7. Read: active/codex-gpt-6-a3f2/task-engine.md → parse scopes: [engine]
  8. Execute: mkdir coordination/locks/engine.lock
  9. Execute: echo '{...holder.json...}' > locks/engine.lock/holder.json
  10. [Do actual work: edit files, run tests]
  11. Execute: rm -rf coordination/locks/engine.lock
  12. Execute: mv active/codex-gpt-6-a3f2/task-engine.md archive/
```

**Entry point files:**
- `AGENTS.md` (Codex) or `.claude/skills/agent-handoff/SKILL.md` (Claude)
- `coordination/PROTOCOL.md` (full spec)
- `coordination/TEMPLATE-handoff.md` (format reference)

**Pros:**
- No implementation needed beyond markdown documentation
- AI has full visibility into operations (transparent)
- Direct, debuggable, no black boxes

**Cons:**
- AI executes 10+ bash commands per handoff cycle
- Risk of AI making mistakes in command sequence
- Each AI tool reimplements the decision logic

### Mode B: CLI-driven (wrapper tool)

The AI agent calls `trinoris-agent` CLI commands that handle protocol details internally.

**User workflow:**
```
User in Codex IDE: "Take off from task-engine"

Codex AI:
  1. Execute: trinoris-agent handoffs
     Output: "task-engine.md [engine] - available"
  
  2. Execute: trinoris-agent claim task-engine.md
     Output: "Claimed successfully, scopes: [engine]"
  
  3. Execute: trinoris-agent acquire-lock engine
     Output: "Lock acquired: engine"
  
  4. Read: active/codex-gpt-6-a3f2/task-engine.md
  
  5. [Do actual work: edit files, run tests]
  
  6. Execute: trinoris-agent release-lock engine
     Output: "Lock released: engine"
  
  7. Execute: trinoris-agent archive task-engine.md --outcome "completed: tests pass"
     Output: "Archived to coordination/archive/"
```

**Commands available:**
```bash
trinoris-agent handoffs                      # List available handoffs
trinoris-agent claim <file>                  # Claim handoff (mkdir + mv)
trinoris-agent acquire-lock <scope>          # Acquire scope lock
trinoris-agent release-lock <scope>          # Release scope lock
trinoris-agent archive <file> --outcome <s>  # Archive with outcome
trinoris-agent locks                         # Show current locks
trinoris-agent status                        # Overall status
```

**Pros:**
- Fewer commands for AI to execute (5 vs 12)
- Protocol logic centralized, tested, consistent
- Better error messages and validation
- Atomic operations guaranteed

**Cons:**
- Requires implementing the CLI tool
- AI has less visibility (operations are black box)
- Additional runtime dependency

### Hybrid approach (recommended)

Use both modes:

1. **Mode A for learning:** AI reads `coordination/PROTOCOL.md` to understand the protocol
   conceptually (what locks are, why leases exist, etc.)

2. **Mode B for execution:** AI calls `trinoris-agent` commands to perform operations

This gives the AI understanding of *why* (from docs) while ensuring correctness of *how*
(from CLI).

### Codex CLI example

```python
# codex-cli internals (pseudocode)

def main():
    # Parse args
    args = parse_args()
    
    # Load config
    config = load_config(args.config)
    
    # Determine agent identity
    agent_class = args.class or config.agent.class or "codex-gpt-6"
    agent_instance = args.instance or config.agent.instance_id
    if agent_instance == "auto":
        agent_instance = f"{agent_class}-{generate_uuid()[:4]}"
    
    # Initialize agent
    agent = CoordinationAgent(
        agent_class=agent_class,
        agent_instance=agent_instance,
        work_dir=args.work_dir or os.getcwd(),
        config=config
    )
    
    # Run based on mode
    if args.command == "status":
        agent.show_status()
    elif args.command == "locks":
        agent.show_locks()
    elif args.mode == "interactive":
        agent.run_interactive()
    elif args.mode == "once":
        agent.run_once(claim=args.claim)
    elif args.mode == "daemon":
        agent.run_daemon()
```

### Claude Code integration

```typescript
// .claude/skills/agent-handoff/coordination.ts

import { CoordinationProtocol } from 'trinoris-coordination';

export async function initCoordination() {
  const protocol = new CoordinationProtocol({
    agentClass: 'claude-opus-5',
    agentInstance: process.env.CLAUDE_INSTANCE || 'auto',
    workDir: process.cwd(),
    configPath: '.kiro/coordination.json'
  });
  
  return protocol;
}

export async function claimHandoff(protocol: CoordinationProtocol, handoffName: string) {
  const handoff = await protocol.claim(handoffName);
  const locks = await protocol.acquireLocks(handoff.scopes);
  
  return { handoff, locks };
}

export async function releaseAndArchive(
  protocol: CoordinationProtocol,
  handoff: Handoff,
  outcome: string
) {
  await protocol.releaseLocks();
  await protocol.archiveHandoff(handoff, outcome);
}
```

## Open questions

- `(pending)` Should `--mode daemon` support inotify/fswatch for instant handoff detection,
  or poll every N seconds?
- `(pending)` Should there be a `trinoris-agent break-lock --scope <name>` command for
  manual intervention, or force humans to follow the protocol?
- `(pending)` How should multiple instances with the same instance ID be handled? (Error?
  Suffix with -2, -3? Force kill the old one?)

## Acceptance criteria

- `MA-14` A tool implementing this spec can be invoked with just `--class` and works
  (auto-generates instance, uses current dir, finds handoffs).
- `MA-15` Status commands (`locks`, `handoffs`, `status`) provide actionable information
  without requiring the agent to do work.
- `MA-16` Configuration file overrides defaults, flags override config, environment
  variables work as documented.
- `MA-17` Daemon mode responds to SIGTERM with graceful shutdown (finishes current work,
  releases locks, exits).
- `MA-18` `trinoris-agent init` creates a valid protocol structure that passes
  `trinoris-agent verify`.

---

This spec is independent of any specific tool. Codex, Claude, Kiro, or any future agent can
implement it and interoperate through the coordination protocol.
