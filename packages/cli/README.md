# @trinoris/agent-cli

CLI for the Trinoris multi-agent coordination protocol: scope locks, handoff claims, and
stale-lock recovery for two or more coding agents sharing one working tree.

```bash
trinoris-agent setup              # scaffold coordination/ and bind agent tools
trinoris-agent verify             # adoption gate: is mkdir atomic on this filesystem?
trinoris-agent acquire --scope engine
trinoris-agent check   --scope engine     # re-confirm ownership before writing
trinoris-agent release --scope engine
```

## Exit codes are the contract

Agents drive this from a shell, so the codes carry meaning:

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | usage or runtime error |
| 3 | **contended** — the scope is held, or the note is already claimed. Not an error. Pick other work or write a handoff; do not retry in a loop |
| 4 | **not the holder** — the lease was lost. Stop writing immediately and re-acquire |

Exit 3 is deliberate: an agent that spins on a held lock is an idle agent.

## `verify` is a gate, not a formality

The protocol rests on `mkdir` being atomic in the target tree. `verify` races real OS
processes to find out, because the failure mode is silent data loss rather than an error.
If it fails, the protocol does not apply to that filesystem and must not be installed.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

