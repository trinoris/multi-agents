# NPM Publishing Strategy

## Packages to Publish

### Option A: Publish All Packages (Recommended)

**4 packages total:**

1. **`@trinoris/coordination-core`** ✅ PUBLISH
   - Pure TypeScript types and utilities
   - Zero dependencies
   - Usable by anyone building coordination tools
   - **Public or Scoped Private**

2. **`@trinoris/coordination-cli`** ✅ PUBLISH
   - Command-line interface
   - Depends on: @trinoris/coordination-core, commander, chalk, ora
   - Binary: `trinoris-agent`
   - **Public or Scoped Private**

3. **`@trinoris/coordination-sdk`** ✅ PUBLISH
   - Programmatic API for AI agents
   - Depends on: @trinoris/coordination-core
   - For building integrations
   - **Public or Scoped Private**

4. **`@trinoris/codex-coordination`** ✅ PUBLISH
   - Codex plugin wrapper
   - Depends on: @trinoris/coordination-sdk
   - Optional, for Codex users only
   - **Public or Scoped Private**

**Total: 4 packages** (all independently useful)

---

### Option B: Minimal (Core + CLI Only)

**2 packages:**

1. `@trinoris/coordination-core` - Types and utils
2. `@trinoris/coordination-cli` - CLI binary

Skip SDK and plugins (build later if needed)

**Total: 2 packages**

---

### Option C: Bundle Everything (Not Recommended)

**1 package:**

Single `@trinoris/coordination` with CLI + SDK + types all together.

**Problems:**
- Users who only want SDK get CLI dependencies
- Users who only want types get everything
- Harder to version independently
- Larger package size

**Total: 1 package** (but not ideal)

---

## Recommended: Option A (4 Packages)

### Why Separate Packages?

**User Scenarios:**

1. **Human using CLI:**
   ```bash
   npm install -g @trinoris/coordination-cli
   trinoris-agent setup
   ```
   Gets: CLI + core only (no SDK bloat)

2. **AI agent (programmatic):**
   ```bash
   npm install @trinoris/coordination-sdk
   ```
   ```typescript
   import { CoordinationClient } from '@trinoris/coordination-sdk';
   ```
   Gets: SDK + core only (no CLI dependencies)

3. **Building custom tools:**
   ```bash
   npm install @trinoris/coordination-core
   ```
   ```typescript
   import { parseHandoff, isLockExpired } from '@trinoris/coordination-core';
   ```
   Gets: Types and utils only (zero dependencies)

4. **Codex integration:**
   ```bash
   npm install @trinoris/codex-coordination
   ```
   Gets: Plugin + SDK + core (full stack)

### Dependency Tree

```
@trinoris/codex-coordination
  └─ @trinoris/coordination-sdk
      └─ @trinoris/coordination-core

@trinoris/coordination-cli
  └─ @trinoris/coordination-core
  └─ commander
  └─ chalk
  └─ ora
```

Clean separation, no duplication!

---

## Package Sizes (Estimated)

| Package | Size (unpacked) | Dependencies | Use Case |
|---------|-----------------|--------------|----------|
| `core` | ~10 KB | 0 | Types, utils |
| `cli` | ~50 KB | 3 (commander, chalk, ora) | Human interface |
| `sdk` | ~30 KB | 1 (core) | Programmatic API |
| `codex-plugin` | ~10 KB | 1 (sdk) | Codex integration |

**Total if user installs everything:** ~100 KB (reasonable)

---

## Publishing Options

### A. Public (Free)

```json
{
  "name": "@trinoris/coordination-core",
  "publishConfig": {
    "access": "public"
  }
}
```

**Pros:**
- Free on npm
- Community can use and contribute
- Build reputation
- Easier distribution

**Cons:**
- Code is public (already open-source anyway)
- Support requests from community

### B. Scoped Private (Paid)

```json
{
  "name": "@trinoris/coordination-core",
  "private": false,
  "publishConfig": {
    "access": "restricted"
  }
}
```

**Cost:** $7/user/month for private packages on npm

**Pros:**
- Keep code proprietary
- Control access
- No public support burden

**Cons:**
- Cost for each developer
- Harder to share with clients
- Need npm organization

### C. Self-Hosted Registry

Use Verdaccio or GitHub Packages (free for private repos).

**Pros:**
- Free
- Full control
- Can be private

**Cons:**
- More setup
- Need to maintain registry
- `npm login` to custom registry

---

## Recommended Publishing Plan

### Phase 1: Private Development (Now)

Don't publish yet. Use workspace references:

```json
// packages/cli/package.json
{
  "dependencies": {
    "@trinoris/coordination-core": "workspace:*"
  }
}
```

Build and test locally. No npm publishing needed.

### Phase 2: Alpha Release (Week 2)

Publish to **GitHub Packages** (free, private):

```bash
# One-time setup
npm login --registry=https://npm.pkg.github.com

# Publish all packages
pnpm publish -r --registry=https://npm.pkg.github.com
```

Users install with:
```bash
npm config set @trinoris:registry https://npm.pkg.github.com
npm install -g @trinoris/coordination-cli
```

### Phase 3: Beta Release (Week 4)

Publish to **npm (public)**:

```bash
# Publish all 4 packages
pnpm publish -r --access public
```

**Packages:**
- `@trinoris/coordination-core@0.1.0`
- `@trinoris/coordination-cli@0.1.0`
- `@trinoris/coordination-sdk@0.1.0`
- `@trinoris/codex-coordination@0.1.0`

Users install with:
```bash
npm install -g @trinoris/coordination-cli
```

### Phase 4: Stable Release (Month 2+)

Version 1.0.0 on npm (public).

---

## Versioning Strategy

### Independent Versioning (Recommended)

Each package has its own version:

```
@trinoris/coordination-core@1.2.0
@trinoris/coordination-cli@0.5.0
@trinoris/coordination-sdk@0.3.0
@trinoris/codex-coordination@0.2.0
```

**Pros:**
- Core can be stable (1.x) while CLI iterates (0.x)
- Breaking changes only affect dependent packages
- Clear versioning per package

**Cons:**
- More complex to manage
- Need to track compatibility

### Fixed Versioning (Simpler)

All packages share the same version:

```
@trinoris/coordination-core@0.5.0
@trinoris/coordination-cli@0.5.0
@trinoris/coordination-sdk@0.5.0
@trinoris/codex-coordination@0.5.0
```

**Pros:**
- Easy to understand ("all packages at v0.5.0")
- Simpler release process
- Guaranteed compatibility

**Cons:**
- Patch to CLI bumps all packages
- Less semantic

**Recommendation:** Start with fixed versioning, switch to independent later.

---

## Publishing Checklist

### Before First Publish

- [ ] Choose npm organization name (`@trinoris`)
- [ ] Create npm account
- [ ] Set up 2FA on npm
- [ ] Add LICENSE file to each package
- [ ] Add README.md to each package
- [ ] Test local installation (`npm pack`, install .tgz)
- [ ] Update package.json with repository, bugs, homepage
- [ ] Add .npmignore or use `files` field

### Publishing Command

```bash
# Dry run first
pnpm publish -r --dry-run

# Actual publish
pnpm publish -r --access public

# Or publish individual packages
cd packages/core && pnpm publish --access public
cd packages/cli && pnpm publish --access public
cd packages/sdk && pnpm publish --access public
cd packages/codex-plugin && pnpm publish --access public
```

---

## Cost Analysis

### Option A: Public npm (Free)

**Cost:** $0  
**Packages:** 4 (unlimited)

### Option B: Private npm ($7/user/month)

**Cost:** $7-21/month (1-3 developers)  
**Packages:** 4 (unlimited private packages)

### Option C: GitHub Packages (Free)

**Cost:** $0 (for public repos)  
**Packages:** 4 (unlimited)  
**Note:** Requires GitHub account to install

### Option D: Self-hosted Verdaccio (Free)

**Cost:** $0 (hosting costs only)  
**Packages:** Unlimited  
**Note:** Need to maintain registry

---

## Final Recommendation

### For TRINORIS Project:

**Publish: 4 packages**

1. `@trinoris/coordination-core`
2. `@trinoris/coordination-cli`
3. `@trinoris/coordination-sdk`
4. `@trinoris/codex-coordination`

**Where to publish:**

- **Phase 1 (Now):** Don't publish, use workspace references
- **Phase 2 (Week 2):** GitHub Packages (free, private)
- **Phase 3 (Week 4):** npm public (free, open-source)

**Versioning:** Fixed versioning (all at same version)

**Total cost:** $0 (using public npm or GitHub Packages)

---

## Summary

**Answer: 4 packages** ✅

- Core (types + utils)
- CLI (command-line tool)
- SDK (programmatic API)
- Codex Plugin (optional integration)

Each package is independently useful, properly scoped, and follows npm best practices.

**Publishing timeline:**
- Now: Local development only
- Week 2: Alpha (GitHub Packages)
- Week 4: Beta (npm public)

**Cost:** $0 (free public publishing)
