# TypeScript Monorepo Design

**Decision:** Convert to TypeScript with proper workspace structure

## Why Convert Now (Before It's Too Late)

### 1. **Small Codebase**
- Only 800 lines of Python
- 2 commands implemented
- 4-6 hours to port (manageable)
- **Better now than after v0.2 with 2000+ lines**

### 2. **Better Structure**
- Separate concerns properly
- CLI, SDK, and types as packages
- Shared code reuse
- Professional project layout

### 3. **Future-Proof**
- Codex integration will need TypeScript
- Claude Code uses TypeScript
- Web dashboard will use TypeScript
- **Everything converges on TypeScript eventually**

### 4. **Better DX (Developer Experience)**
- Type safety catches bugs
- Better IDE support
- Self-documenting code
- Easier to contribute

## Proposed Workspace Structure

```
trinoris-multi-agents/
├── package.json              # Root workspace config
├── tsconfig.json             # Shared TypeScript config
├── turbo.json               # Turbo for monorepo builds
├── .changeset/              # Versioning automation
│
├── packages/
│   ├── core/                # @trinoris/coordination-core
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   ├── locks.ts
│   │   │   ├── handoffs.ts
│   │   │   ├── archive.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                 # @trinoris/coordination-cli
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── setup.ts
│   │   │   │   ├── verify.ts
│   │   │   │   ├── claim.ts
│   │   │   │   ├── acquire.ts
│   │   │   │   └── release.ts
│   │   │   ├── templates/
│   │   │   │   ├── agents-md.ts
│   │   │   │   └── skill-md.ts
│   │   │   ├── cli.ts
│   │   │   └── index.ts
│   │   ├── bin/
│   │   │   └── trinoris-agent.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── sdk/                 # @trinoris/coordination-sdk
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   ├── agent.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── codex-plugin/        # @trinoris/codex-coordination
│       ├── src/
│       │   ├── plugin.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   └── docs/                # Documentation site (optional)
│       ├── pages/
│       └── package.json
│
├── tests/
│   ├── integration/
│   │   ├── parallel-execution.test.ts
│   │   ├── conflict-scenario.test.ts
│   │   └── atomicity.test.ts
│   └── fixtures/
│
├── specs/                   # Keep existing specs
│   └── *.md
│
└── README.md
```

## Package Breakdown

### 1. `@trinoris/coordination-core`

**Purpose:** Core protocol logic (no CLI, no I/O)

**Exports:**
```typescript
// Types
export interface Lock {
  agent_instance: string;
  agent_class: string;
  scope: string;
  acquired_at: string;
  expires_at: string;
}

export interface Handoff {
  frontmatter: HandoffMetadata;
  content: string;
  verified: string[];
  assumed: string[];
}

// Pure functions
export function parseLease(minutes: number): Date;
export function isExpired(lock: Lock): boolean;
export function parseHandoff(content: string): Handoff;
export function formatHandoff(handoff: Handoff): string;
export function validateScope(scope: string, registry: string[]): boolean;
export function scopeOrdering(scopes: string[]): string[];
```

**No Dependencies:** Pure TypeScript, no Node.js APIs

**Size:** ~300 lines

### 2. `@trinoris/coordination-cli`

**Purpose:** Command-line interface (like current Python CLI)

**Depends on:** `@trinoris/coordination-core`

**Commands:**
```bash
trinoris-agent setup
trinoris-agent verify
trinoris-agent claim <file>
trinoris-agent acquire-lock <scope>
trinoris-agent release-lock <scope>
trinoris-agent archive <file> --outcome "..."
trinoris-agent locks
trinoris-agent handoffs
```

**Dependencies:**
- commander (CLI framework)
- chalk (colors)
- ora (spinners)
- @trinoris/coordination-core

**Size:** ~500 lines

### 3. `@trinoris/coordination-sdk`

**Purpose:** Programmatic API for AI agents

**Depends on:** `@trinoris/coordination-core`

**Usage:**
```typescript
import { CoordinationClient } from '@trinoris/coordination-sdk';

const client = new CoordinationClient({
  workDir: process.cwd(),
  agentClass: 'codex-gpt-6',
  agentInstance: 'codex-123'
});

// Claim handoff
const handoff = await client.claimHandoff('task-123.md');

// Acquire lock
await client.acquireLock('specs');

// Do work...

// Release lock
await client.releaseLock('specs');

// Archive
await client.archiveHandoff('task-123.md', {
  outcome: 'Completed successfully'
});
```

**Size:** ~400 lines

### 4. `@trinoris/codex-coordination`

**Purpose:** Codex plugin for native integration

**Depends on:** `@trinoris/coordination-sdk`

**Usage:**
```javascript
// Codex can import directly
import { codexPlugin } from '@trinoris/codex-coordination';

codex.use(codexPlugin);

// Now Codex has coordination commands
await codex.coordination.claimHandoff('task.md');
```

**Size:** ~200 lines

## Technology Stack

### Build System

**Turborepo:**
```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    }
  }
}
```

**Why Turborepo:**
- Fast incremental builds
- Caches build artifacts
- Runs tasks in parallel
- Industry standard for monorepos

### Package Manager

**pnpm:**
- Fast and efficient
- Proper workspace support
- Saves disk space (hardlinks)
- Better than npm/yarn for monorepos

### TypeScript Config

**Base tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

### Build Tool

**tsup:**
- Zero-config TypeScript bundler
- Fast (uses esbuild)
- Generates .d.ts files
- CJS and ESM outputs

```typescript
// tsup.config.ts
export default {
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  shims: true
};
```

## Migration Plan

### Phase 0.5: Setup Monorepo (2-3 hours)

**Day 1:**
1. ✅ Create workspace structure
2. ✅ Set up pnpm workspaces
3. ✅ Configure Turborepo
4. ✅ Set up TypeScript configs
5. ✅ Add build scripts

**Deliverables:**
- Empty packages with proper structure
- Build system working
- Can run `pnpm build` successfully

### Phase 0.6: Port Core Logic (2-3 hours)

**Day 1 (continued):**
1. ✅ Port pure functions to `@trinoris/coordination-core`
2. ✅ Add types for Lock, Handoff, Config
3. ✅ Write unit tests for core
4. ✅ Validate type safety

**Deliverables:**
- `@trinoris/coordination-core` complete
- 100% type coverage
- Tests passing

### Phase 0.7: Port CLI (2-3 hours)

**Day 2:**
1. ✅ Port setup command
2. ✅ Port verify command
3. ✅ Add commander for CLI framework
4. ✅ Add chalk/ora for UX
5. ✅ Test on ext4 and v9fs

**Deliverables:**
- `@trinoris/coordination-cli` working
- Parity with Python CLI
- All MA-T01 tests passing

### Phase 0.8: Build SDK (2-3 hours)

**Day 2 (continued):**
1. ✅ Create CoordinationClient class
2. ✅ Implement async methods
3. ✅ Add error handling
4. ✅ Write SDK tests

**Deliverables:**
- `@trinoris/coordination-sdk` complete
- Ready for Phase 3 integrations

**Total Time:** 8-12 hours over 2 days

## Package.json Examples

### Root package.json

```json
{
  "name": "trinoris-multi-agents",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "dev": "turbo run dev --parallel",
    "clean": "turbo run clean && rm -rf node_modules"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.1",
    "turbo": "^1.11.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  },
  "packageManager": "pnpm@8.12.0",
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=8.0.0"
  }
}
```

### packages/core/package.json

```json
{
  "name": "@trinoris/coordination-core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "dev": "tsup --watch"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}
```

### packages/cli/package.json

```json
{
  "name": "@trinoris/coordination-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "trinoris-agent": "./dist/cli.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "test": "vitest run"
  },
  "dependencies": {
    "@trinoris/coordination-core": "workspace:*",
    "commander": "^11.1.0",
    "chalk": "^5.3.0",
    "ora": "^7.0.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}
```

### packages/sdk/package.json

```json
{
  "name": "@trinoris/coordination-sdk",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run"
  },
  "dependencies": {
    "@trinoris/coordination-core": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}
```

## Benefits of New Structure

### 1. **Separation of Concerns**
```
Core     → Protocol logic (pure functions)
CLI      → Human interface
SDK      → Programmatic interface
Plugins  → Tool-specific integrations
```

### 2. **Code Reuse**
```
CLI depends on Core
SDK depends on Core
Plugins depend on SDK
→ No duplication
```

### 3. **Independent Versioning**
```
@trinoris/coordination-core@1.0.0
@trinoris/coordination-cli@0.2.0
@trinoris/coordination-sdk@0.1.0
```

### 4. **Better Testing**
```
Core: Unit tests (pure functions)
CLI: Integration tests (filesystem)
SDK: API tests (public interface)
```

### 5. **Easier Contributions**
- Clear boundaries
- TypeScript catches errors
- Better documentation (types)
- Standard tooling

## Comparison: Old vs New

### Old (Python)

```
trinoris-agent/
├── trinoris_agent/
│   ├── cli.py           (CLI + logic mixed)
│   └── commands/
│       ├── setup.py     (I/O + logic mixed)
│       └── verify.py
└── setup.py
```

**Issues:**
- CLI and logic coupled
- Can't reuse code programmatically
- Single language only
- No type safety

### New (TypeScript Monorepo)

```
packages/
├── core/               (Pure logic, reusable)
├── cli/                (CLI only, thin wrapper)
├── sdk/                (Programmatic API)
└── codex-plugin/       (Tool integration)
```

**Benefits:**
- Clean separation
- Multiple interfaces (CLI, SDK, plugins)
- Type safety everywhere
- Easy to test

## Migration Risk Mitigation

### 1. **Keep Python CLI During Migration**
- Don't delete until TypeScript is proven
- Run both in parallel for 1 week
- Compare outputs

### 2. **Test Parity Before Switch**
- All MA-T01, T04, T06, T07 must pass
- Same performance or better
- Same or better UX

### 3. **Incremental Migration**
- Week 1: Core only
- Week 2: CLI
- Week 3: SDK
- Week 4: Delete Python

### 4. **Rollback Plan**
- Git branch for migration
- Tag Python CLI as v0.1.0-python
- Can revert if needed

## Recommended Timeline

### Week 1, Day 1-2 (Today + Tomorrow)

**Setup + Core:**
- Set up monorepo structure
- Port core logic to TypeScript
- Tests passing

### Week 1, Day 3-4

**CLI + Verification:**
- Port CLI commands
- Run all existing tests
- Verify parity with Python

### Week 1, Day 5-7

**SDK + Phase 1 Completion:**
- Build SDK package
- Complete Phase 1 tests with TypeScript
- Delete Python CLI

### Week 2

**Phase 2 + CLI v0.2:**
- Add operation commands (claim, acquire, etc.)
- Build codex-plugin
- Production ready

## Conclusion

**Decision: Convert to TypeScript Monorepo** ✅

**Why:**
- Small enough to port quickly (8-12 hours)
- Better structure for long-term
- Enables AI agent integrations
- Industry-standard approach
- Future-proof investment

**When to Start:** Now (before codebase grows)

**Action Items:**
1. Create monorepo structure (today)
2. Port core + CLI (tomorrow)
3. Validate with existing tests
4. Delete Python after 1 week

**Risk:** Medium (requires rewrite, but codebase is small)  
**Reward:** High (better structure, easier integrations, type safety)

Let's do it! 🚀
