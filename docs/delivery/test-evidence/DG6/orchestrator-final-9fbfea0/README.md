# DG6 final verification after the round-5 repairs (orchestrator)

Run in a clean detached worktree (`/home/user/wt/verify`) at `9fbfea063`. This tree has every round-5 repair merged: BE-Z7/Z7B (F-DG6-360, 361, 340, 362), BE-Z8 (F-DG6-380), ARCH-15 (F-DG6-341) and AN-Z4 (register rows), D-215.

Script: `run.sh`. Each step writes `<step>.log` and `<step>.rc`, and `summary.txt` lists every exit code. Every step exits 0, with no interruption and no re-run.

| Step | Exit | Result |
| --- | --- | --- |
| hist (`validate.mjs --historical --stage DG5`) | 0 | |
| install, build, typecheck, lint, format | 0 | |
| openapi, contrast | 0 | |
| unit (locale unset; C.UTF-8) | 0 | |
| integration | 0 | 4253 passed, 1 skipped, 1 todo |
| e2e (locale unset) | 0 | 552 passed, 2 skipped (1.1 h) |
| e2e (C.UTF-8) | 0 | 552 passed, 2 skipped (1.4 h) |
| root e2e | 0 | 288 passed, 18 skipped |
| demo e2e | 0 | 10 passed |

- **Synthetic test value:** the integration and e2e runs export `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001`. It is a synthetic test value, not a real secret.
- **Skipped tests:** the skips are the same declared skips as in `orchestrator-final-8a24a1c`.
