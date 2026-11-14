# A26 drill report: known-defect injection (REQ-S20-026)

Orchestrator drill per p7-work-split §K.1 / ADR-0073 §10, run 2026-11-14.

| Step | What happened | Result |
| --- | --- | --- |
| P-K1 | `run-agent.sh` with `--cwd <worktree>` auto-commits only the run folder (`docs/delivery/runs/DG7/…`) to the main repository; review files stay in the worktree. No gate record could be touched. | satisfied |
| K1 | branch `drill/dg7-a26` at `3e0cec962`, worktree in the orchestrator scratch directory (outside the repository directory) | done |
| K2 | defect card written; SHA-256 `33eea29a…df23b2` recorded in `progress.md` (commit `867a3ba2a`) before any reviewer run | done |
| K3 | one neutral-message commit `c3bbc780c` ("organization: tidy business-unit update route") changes PATCH /api/v1/business-units/:id from `business_unit.manage` to `business_unit.read` (routes.ts l.350, l.361); drill candidate `sha256:0df0d31b…c896`, not frozen | done |
| K4 | code-security-reviewer (run `…REV-A26-CS…1859bd10`) and qa-verifier (run `…REV-A26-QA…ce106f91`), each with `--cwd` on the worktree, without the card. Findings in drill-local `drill-findings.json` (copied to `reviewers/`), never `findings.json` | done |
| K5 | card published here; `sha256sum` = `33eea29a15ab4c9fade0d99c7815e769b5cb1a22dccccc0a27b1825535df23b2`, equal to the recorded hash (`k5-hash-check.txt`). **Both reviewers named the file, line and behaviour as Critical**; qa also found the split-grant re-parent consequence (High) and both a missing negative test (Medium). | **PASS** (first attempt) |
| K6 | backend-workflow-engineer (run `…BE-A26…79cf8324`) added regression tests that fail on the defect (`defect-exit=1`) and pass on the fix (`fixed-exit=0`); typecheck and lint exit 0 (handback here). Fix commit `c4943c8d1` on the drill branch | **PASS** |
| K7 | code-security-reviewer (run `…REV-A26-V…01f2ad5e`) independently re-ran the tests: pass on the fix, fail on the defect and on a revert of the enforcement line; both places fixed; findings CLOSED_VERIFIED (`reviewers/code-security/drill-verification.md`) | **PASS** |
| K8 | this report; worktree removed; branch `drill/dg7-a26` kept on the remote, never merged | done |

Disclosed: the three drill assignment files were copied into the worktree as untracked files, so the K7 recomputed candidate (`5e58a951…`) differs from K3's. The K7 reviewer did not itself rerun typecheck/lint. The qa High (re-parent) is covered by the K6 tests per K7, not separately verified by qa.

All four A26 clauses (introduce, identify, fix, prove closure) are met. Nothing here grants or implies G1–G6, Finance, IT approval or DG7.
