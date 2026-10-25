# @trinoris/agent-sdk

Filesystem lock engine for the Trinoris multi-agent coordination protocol — for agents
and tools that need the protocol in-process rather than through the CLI.

```js
import { acquire, inspect, release, breakLock, claim } from '@trinoris/agent-sdk';

const paths = { root: 'coordination' };
const r = acquire(paths, 'engine', { agent_instance: 'a1', agent_class: 'claude' }, 15);
if (!r.ok) { /* held by a peer — do not spin; pick other work or write a handoff */ }
```

## Why these primitives and not the obvious ones

The engine uses `mkdir` as its only test-and-set, because it is the only primitive
verified atomic across the target filesystems — including WSL2's 9p bridge to a Windows
drive. Two designs that look correct were disproved by racing them:

- **`mv -n` is not an atomic claim.** It is stat-then-rename in userspace and returns
  success when it declines, so two racing agents both conclude they claimed the same
  handoff. Measured: 2 claimers from 8 racers, 21 failed trials in 100.
- **Breaking a stale lock by delete-then-recreate double-breaks** — 25/60 failures at 8
  racers, 59/60 at 32 — because once the first breaker re-creates the lock the name is
  occupied again and a later breaker evicts the *new* holder. Rename-aside alone does not
  fix it. Breaking is therefore gated behind an atomic `<scope>.breaking` token.

`flock` is deliberately not used: advisory locks over 9p are unreliable, and `flock`
releases on process exit — wrong for agents that work in discrete tool calls.

**Lock presence is not ownership.** A slow agent whose lease expired and was evicted finds
the directory exactly as it left it. Only `holder.json`'s `agent_instance` is authority,
so re-confirm with `isHolder()` immediately before each batch of writes.

## License

MIT — see [LICENSE](./LICENSE).

