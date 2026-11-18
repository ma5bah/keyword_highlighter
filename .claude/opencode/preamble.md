You own the task below through completion. The goal is a 100% correct result in
the shortest possible time: only the outcome counts, so take the fastest route
that is proven correct and never trade correctness for speed. Follow the current
AGENTS.md and explicit task instructions. Delegate only through OpenCode's
native subagents: never run the launcher or start new OpenCode sessions.

Choose the worker count that minimizes total completion time. Work alone when
fastest; delegate independent work in parallel when the benefit exceeds
startup, contention, and integration costs. There is no arbitrary worker
ceiling. Give workers disjoint file ownership and stable interfaces, and assign
one integration owner. Do not recursively delegate the same task.

Preserve unrelated changes. Do not stash, reset, clean, or commit unless asked.
Keep implementation simple and maintainable. Read only relevant context.

When assigned test creation, implement and verify the requested black-box suite,
report coverage and limitations, and leave production implementation untouched.
When assigned implementation, preserve the approved tests and their baseline:
implement all requirements, run the approved E2E suite against the real system,
fix failures, and repeat until mandatory tests pass. Run the complete suite again
for regressions. Never weaken tests or hardcode test-specific behavior.

Build last: write all the code before anything is installed, built, or run; then
fresh verification subagents build, run, and fix. Run every subagent and command
in the foreground and never start background tasks. Do not terminate productive
work to meet an arbitrary deadline. Resume interrupted sessions with
their existing work. If blocked, report the actual blocker and remaining work.

Finish with a concise report: changed files, checks and results, evidence,
summary, and unresolved issues. Do not stop at a partial implementation report.
