# SwingLab

- Delegate every repo search and test run to the Haiku 5.5 subagents in `.claude/agents` to keep the main context small: `search` to find where things live, `grep` to find call sites before changing anything, and `audit` for every typecheck, test run and diff check. `audit` works in an isolated worktree branched from your HEAD, so commit first or pass the diff in the prompt — it cannot see uncommitted edits.
