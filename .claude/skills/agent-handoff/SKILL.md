---
name: agent-handoff
description: Use before editing a shared working tree with another agent, or when drafting, routing, claiming, or completing a handoff.
---

- Read .trinoris/PROTOCOL.md before editing. This is a cooperative local protocol, not a sandbox.
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
