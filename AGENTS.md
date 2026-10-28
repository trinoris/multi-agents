# Agent instructions

- Read .trinoris/PROTOCOL.md before editing. This is a cooperative local protocol, not a sandbox.
- Keep all coordination state in .trinoris/; do not create a parallel coordination/ directory.
- Use a stable --instance and keep the generation returned by acquire.
- Pass --generation to check/renew/release. An expired lease never authorizes edits.
- Check immediately before writes; exit 4 means stop. Exit 3 means contention; never spin.
- Acquire scopes in registry order and use the git scope for Git mutations.
- Claim only notes addressed to you from .trinoris/handoff/for-<class>/; active notes live in .trinoris/active/<instance>/.
- Write protocol 3 handoffs with locks_released: true and every required section in .trinoris/PROTOCOL.md.
- Codex follows this file; Claude Code follows CLAUDE.md and the agent-handoff skill. Both point to the same protocol and template.
- Copy .trinoris/handoff/TEMPLATE.md to .trinoris/handoff/drafts/, replace every template field, then validate and publish with the CLI.
- Markers are not stolen by age. Diagnose, stop affected actors, then explicitly recover.
- Heartbeat/daemon support is disabled in protocol 3.

## Verification gate

- Before committing implementation changes, run `pnpm run test:coverage` from the repository root.
- The command runs each package's Vitest suite with V8 branch coverage and enforces at least 80% branch coverage per package. The CLI bootstrap entry point is excluded; installed CLI behavior is exercised by CLI integration tests.
- Focused tests are useful during development, but they do not replace the full coverage gate before commit or release.

<!-- TRINORIS AGENT INSTRUCTIONS START -->
# Trinoris agent coordination

- Read .trinoris/PROTOCOL.md before editing. This is a cooperative local protocol, not a sandbox.
- At each new agent session cold start, run `trinoris-agent doctor --runtime` once when the installed CLI is available.
- In this source checkout, if the CLI is not on PATH, build it from local dependencies and run `node packages/cli/dist/bin.js doctor --runtime`. The check is offline; if it reports a critical runtime advisory, stop and upgrade Node.js before using the CLI.
- Codex, Kiro, and Cursor read AGENTS.md; Kiro and Cursor support it as workspace instructions. Claude Code follows CLAUDE.md and the agent-handoff project skill. All use the same protocol and handoff template.
- Keep all coordination state in .trinoris/; do not create a parallel coordination/ directory.
- Use a stable --instance and keep the generation returned by acquire.
- Pass --generation to check/renew/release. An expired lease never authorizes edits.
- Check immediately before writes; exit 4 means stop. Exit 3 means contention; never spin.
- Acquire scopes in registry order and use the git scope for Git mutations.
- Claim only notes addressed to you from .trinoris/handoff/for-<class>/; active notes live in .trinoris/active/<instance>/.
- For handoffs, copy .trinoris/handoff/TEMPLATE.md to handoff/drafts/, replace every placeholder, then validate and publish with the CLI.
- Write protocol 3 handoffs with locks_released: true and every required section in .trinoris/PROTOCOL.md.
- Markers are not stolen by age. Diagnose, stop affected actors, then explicitly recover.
- Heartbeat/daemon support is disabled in protocol 3.
<!-- TRINORIS AGENT INSTRUCTIONS END -->
