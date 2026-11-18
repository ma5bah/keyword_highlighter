# Agent workflow

## Global rules

Apply to every agent and task; explicit user instructions override these rules.

1. **Brevity.** Use the fewest rules, steps, and words that deliver a correct, complete result. Make the smallest complete change; preserve unrelated work. Decide unless a wrong guess costs more than asking.
2. **Implement first; syntax only afterward.** No builds, type checks, linters, app launches, or behavioral verification unless explicitly requested. Do not write, modify, or run tests without an explicit request, even for core functionality. For docs, check the content/diff. If syntax-only checking is unavailable, report it.
3. **Mark core behavior.** Distinguish critical system behavior from optional features. Above each core functionality added or changed, comment `@CORE: <critical responsibility>` and `@TODO: Test and verify <behavior, failure cases, recovery>`. Use the nearest supported comment location. These markers never authorize tests.
4. **Report honestly.** State changes, syntax results, and deferred testing TODOs (including non-core work); never imply syntax proves behavior. After implementation, ask: “Should I write the test cases and verify the system now?” If already explicitly requested, complete that scope without asking again.
5. **Foreground only, check last.** Complete all planned code before checks; no installs or execution during implementation. Reading, searching, and diffs are allowed. Run commands and subagents in the foreground; only Mode A handoff may detach.
6. **Delegate execution, keep judgment.** Outside Direct mode, subagents explore, implement, and check. The top-level agent plans and reviews. Use the supervisor's default below unless the user explicitly requests a different subagent or model. Apply the default and any available fallback automatically.
   - **Claude Code:** native subagents with `model: "haiku"`.
   - **Codex:** native subagents with `model: gpt-6-luna`.
   - **OpenCode:** its own native subagents.

   If the required Claude Code or Codex native subagent is unavailable, use the OpenCode fallback below. If the fallback is also unavailable, report the blocker and options. Switching to Direct for blocked work requires explicit user approval. Parallelize independent work with disjoint ownership and stable interfaces.

## Modes

Choose the mode automatically and state it first. Follow any explicit mode request. Otherwise, use Direct for the cases below and Mode B for everything else. Begin work without asking the user to choose or confirm the mode or subagents.

- **Direct:** docs or small, understood changes in one or two files; implement and check yourself.
- **Mode B (default):** delegate discovery → define scope, interfaces, and acceptance criteria → dispatch → judge code/diffs → correct or re-plan until complete → fresh subagents check combined syntax. Broader verification requires explicit authorization. If a subagent is stuck, revise its package or follow the fallback rule above.
- **Mode A (only on request):** test-first handoff. Test work still requires explicit authorization; “handoff” alone does not grant it. Design minimal black-box tests through real interfaces, delegate test coding, review coverage, and confirm failures reflect missing behavior. Record commands and test checksums. Hand off requirements, approved tests, constraints, ownership, and context; confirm handoff (detached when launched externally), then stop and return handoff identifiers and suite location. Resume only when asked. Report failed launches as blocked.

## Subagent packages

- Store each package in `scratch/opencode/<run-id>/`, never in shell arguments; ensure `/scratch/` is Git-ignored. Include scope, done conditions, files, interfaces, context, and the global rules. Never stage packages/artifacts or stash, reset, clean, or commit unrelated work.
- Subagents report changes, files, checks run or deferred, likely failures, and open issues. Judge from code/diffs and output, not claims. Send consolidated corrections to the same subagent.

## When tests or verification are explicitly requested

- After all implementation, fresh verification subagents own integrated checks and repairs outside Direct mode. Use focused checks and minimal core smoke coverage; broaden only for failures, shared infrastructure, or requested scope. Reuse passing results until relevant code changes.
- Fix root causes; never weaken approved tests or hardcode their cases. In Mode A, preserve the test checksum baseline and rerun the approved suite plus affected checks before completion.
- Keep E2E to essential outcomes and high-impact failures; use lower-level checks for boundaries. Report commands, output, limits, and session identifiers.
- Rust: scope checks to affected packages; avoid redundant builds, cache clearing, and dependency/toolchain changes.

## UI and UX

Implement clear, accessible, responsive flows with working controls, truthful states, preserved input/context, and recoverable errors. Follow product conventions; confirm only consequential actions. When verification is authorized, exercise the main flow and failure/recovery, keyboard access, and narrow/wide layouts.

## OpenCode fallback

- When OpenCode is the supervisor, use native subagents for all delegation, including Mode A. Never launch a separate session. Report the blocker if native handoff is unavailable.
- The following rules apply only when launching OpenCode externally. Use `.claude/opencode/launch.sh --wait <package.md> '<title>' <model> <fallback-model> [ses_id]`; add `--parallel` for independent packages. Detach only for Mode A; retain job ID, PID, status path, and log path.
- Models: `opencode-go/deepseek-v4.1-flash` and `opencode-go/muse-spark-1.3-contributor`. Do not hand-build `opencode run`, use `--auto`, or set a timeout without need.
- Work from the project root; use `--standalone` on every OpenCode command. Before first launch, confirm HEAD exists; create an initial commit only if absent. Never rewrite the root commit or restart/stop the shared service unless asked.
- After launch, confirm and record sessions with `opencode session list --standalone`. Resume corrections with a new package and the original `ses_` ID. View with `opencode --standalone -s <ses_id>`.
