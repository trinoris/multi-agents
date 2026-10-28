<!-- TRINORIS AGENT HANDOFF START -->
For shared-worktree edits, coordination, or agent handoffs, follow
`.claude/skills/agent-handoff/SKILL.md` before writing. It points to the canonical
`.trinoris/PROTOCOL.md` contract and `.trinoris/handoff/TEMPLATE.md`.

For repository changes, follow `AGENTS.md` for the required verification workflow. Run
`pnpm run test:coverage` before committing implementation changes; it enforces the 80%
V8 branch-coverage gate across packages.
<!-- TRINORIS AGENT HANDOFF END -->
