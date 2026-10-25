# @trinoris/agent-core

Core types and utilities for the multi-agent coordination protocol.

**Part of:** [trinoris-multi-agents](https://github.com/trinoris/multi-agents)

## Installation

```bash
npm install @trinoris/agent-core
# or
pnpm add @trinoris/agent-core
```

## Usage

```typescript
import {
  Lock,
  Handoff,
  isLockExpired,
  parseHandoff,
  calculateExpiration,
  sortScopesByRegistry,
  DEFAULT_SCOPE_REGISTRY
} from '@trinoris/agent-core';

// Check if a lock has expired
const lock: Lock = {
  agent_instance: 'codex-gpt-6-abc123',
  agent_class: 'codex-gpt-6',
  scope: 'specs',
  acquired_at: '2026-10-25T12:00:00Z',
  expires_at: '2026-10-25T12:15:00Z'
};

if (isLockExpired(lock)) {
  console.log('Lock has expired');
}

// Calculate lease expiration
const expiresAt = calculateExpiration(15); // 15 minutes from now

// Parse handoff markdown
const handoff = parseHandoff(markdownContent);
console.log(handoff.metadata, handoff.verified, handoff.assumed);

// Sort scopes for deadlock prevention
const scopes = ['specs', 'api', 'engine'];
const ordered = sortScopesByRegistry(scopes, DEFAULT_SCOPE_REGISTRY);
// ['engine', 'api', 'specs'] - always acquire in this order
```

## Features

- **Pure TypeScript** - No Node.js dependencies
- **Type-safe** - Full TypeScript definitions
- **Zero dependencies** - Only stdlib
- **Dual output** - ESM and CJS formats
- **Tree-shakeable** - Import only what you need

## Exports

### Types

- `Lock` - Scope lock holder information
- `Handoff` - Parsed handoff note structure
- `HandoffMetadata` - Handoff frontmatter
- `CoordinationConfig` - Protocol configuration
- `Incident` - Incident record
- `ArchiveEntry` - Archive index entry
- `AgentIdentity` - Agent identification

### Constants

- `DEFAULT_SCOPE_REGISTRY` - Standard scope ordering
- `DEFAULT_AGENT_CLASSES` - Standard agent classes

### Utilities

**Lease Management:**
- `calculateExpiration(minutes)` - Calculate lease expiration
- `isLockExpired(lock)` - Check if lock expired
- `isInGracePeriod(lock, gracePeriodMinutes)` - Check grace period
- `timeUntilExpiry(lock)` - Time until expiration (ms)

**Handoff Parsing:**
- `parseFrontmatter(content)` - Extract frontmatter
- `parseHandoff(content)` - Parse full handoff note

**Scope Management:**
- `validateScope(scope, registry)` - Validate scope name
- `sortScopesByRegistry(scopes, registry)` - Sort for deadlock prevention

**Utilities:**
- `generateInstanceId(agentClass)` - Generate unique instance ID
- `formatTimestamp(date)` - Format ISO 8601 timestamp
- `formatDuration(ms)` - Human-readable duration

## Package Size

- **Unpacked:** ~10 KB
- **Dependencies:** 0
- **Outputs:** ESM + CJS + TypeScript definitions

## Related Packages

- [@trinoris/agent-cli](../cli) - Command-line interface
- [@trinoris/agent-sdk](../sdk) - Programmatic API
- [@trinoris/agent-codex](../codex-plugin) - Codex plugin

## Documentation

- [Full Protocol Specification](../../specs/01-coordination-protocol.md)
- [Lock Mechanism](../../specs/02-lock-mechanism.md)
- [Handoff Format](../../specs/03-handoff-format.md)

## License

© 2026 TRINORIS. All rights reserved. Proprietary and confidential.
