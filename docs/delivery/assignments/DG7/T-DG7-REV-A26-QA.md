# Assignment T-DG7-REV-A26-QA: drill-candidate review (qa-verifier)

**Context.** This is a review of a drill candidate on branch `drill/dg7-a26` (your working directory is its worktree). It is not a gate round: write nothing under `docs/delivery/reviews/` and never touch `docs/delivery/findings.json`.

**Scope.** Review the change introduced by the branch's last commit (`git show HEAD`) and its effect on the surrounding module and its tests, as you would any merged change: correctness, authorization, validation, concurrency and audit for every mutation it touches. Run whatever checks you need (unit tests, `packages/db/test/with-pg.sh` for integration) and record real exit codes.

**Output.** Write `docs/delivery/test-evidence/DG7/qa/a26/drill-findings.json`: an array of findings, each `{ "id", "severity", "file", "line", "summary", "reproduction", "evidence" }`, and a short `drill-review.md` next to it with the commands you ran and their exit codes. A finding needs file and line and a reproduction. If you find nothing, write an empty array and say what you checked.

**Rules.** Read-only to product code. Synthetic data only. Nothing here grants or implies any G1–G6, Finance, IT approval or DG7.
