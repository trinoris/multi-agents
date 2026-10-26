# Shared coding workspace simulation

## User problem

A command log does not show whether agents are working on different files, waiting for one scope, or reviewing a finished change. The viewer should answer three questions at any replay step: who is acting, what changed, and which system state authorized it.

## Reading the workspace

| Area | User question | Interaction |
| --- | --- | --- |
| Left: actors | Who is editing, reviewing, waiting, or refused? | Select an actor to inspect their last recorded file. |
| Middle: explorer and editor | Which folder is leased, which file is being edited, and what changed? | Expand folders, select files or tabs, inspect added lines and buffers. |
| Middle: activity and test output | Which command produced this state? | Scrub or select activity; switch to the recorded test output. |
| Right: system state | Who owns each scope, which generation is valid, and where is the handoff? | Inspect the state at the selected event. |
| Right: recorded final audit | Did the complete run meet its checks? | Expand final checks independently of replay position. |

Actor colors carry across cards, file ownership, editor labels, and scope records. Text identifies each actor and state so color is not the only signal. On narrow screens, actors become a horizontal strip, followed by the coding workspace and system state. The explorer can be collapsed, and long code scrolls inside the editor.

## State and interaction rules

- A scope lease applies to the mapped folder; it is not a separate filesystem lock on each file.
- Editing shows a recorded unsaved buffer. Saved and reviewing are distinct states. A reviewer gets its own generation after the writer releases the scope.
- A denied acquire or claim never changes the displayed owner.
- Follow mode opens the most recently active file. Manual file/tab/actor selection pins that file until follow mode is enabled again.
- Replaying or scrubbing reconstructs state from the first event through the selected event. Future files, edits, test results, leases, and handoff moves must disappear when rewinding.
- Current system state follows the cursor. The recorded final audit is labeled separately and remains the outcome of the complete run.
- Legacy reports without snapshots show unrecorded content and ownership; the viewer does not infer missing code or lock holders from success messages.

## Recorded event contract

The runner retains its original JSONL event fields and adds optional workspace data:

| Field | Shape | Meaning |
| --- | --- | --- |
| `workspace.files` | Array of `{path, scope, content}` | Source tree seeded before agent sessions start. |
| `workspace.scope_paths` | Scope to folder/path arrays | Explicit display mapping between leases and files. |
| `file` | `{path, scope, operation, content, before?, from?}` | An editing buffer, saved/read file, or protocol-file move. |
| `system.leases` | Actual recorded lease-holder objects | Ownership, generation, and expiry read from the disposable workspace. |
| `system.handoffs` | Array of `{path, stage, status, owner?, to_class?}` | Actual draft, inbox, active, or archived notes. |
| `system.protocol_version` | String or null | Installed protocol version at this step. |
| `system.mutation_guard` | `clear`, `held`, or `not initialized` | Observed guard state after the recorded action. |
| `test_run` | `{passed, expected_failure, output, tests, pass, fail}` | Actual example-test process output and counts. |
| `focus` | Recorded file path | Explicit editor focus, for example the final source after completion. |

File operations are `editing`, `saved`, `reviewing`, and `moved`. A move removes `from` from the visible tree before adding `path`. Rendering uses text nodes for filenames, code, terminal output, and messages.

`replay-state.js` reconstructs a fresh model for each cursor position. `editor-workspace.js` renders that model. `viewer.js` owns playback, loading, and user selection. `scenario.js` supplies the same example source/test contents to the real runner and the explicitly synthetic browser demo.

## Acceptance evidence

The reducer tests cover refusal without ownership transfer, independent scope owners, editing buffers, rewind, review ownership, legacy reports, handoff moves, and test-state rewind. The browser journey checks these behaviors against a real generated run through both local-file and HTTP loading, including mobile overflow, final audit, and manual file selection.
