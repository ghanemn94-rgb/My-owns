# DG6 final verification after the round-3 repairs (orchestrator)

Run in a clean detached worktree (`/home/user/wt/verify`) at `04fcf43f3`. This tree has every round-3 repair merged: BE-Z4 (F-DG6-220), FE-Z2 (F-DG6-221, 222, 261) and AN-Z2 (F-DG6-260). Script: `run.sh`. Each step writes `<step>.log` and `<step>.rc`; `summary.txt` lists every exit code.

| Step | Exit | Result |
| --- | --- | --- |
| hist (`validate.mjs --historical --stage DG5`) | 0 | |
| install, build, typecheck, lint, format | 0 | |
| openapi | 0 | 932 operations |
| contrast | 0 | |
| unit (locale unset) | 0 | |
| unit (C.UTF-8) | 0 | |
| integration | 0 | 4217 passed, 1 skipped, 1 todo |
| e2e (locale unset) | 0 | 550 passed, 2 skipped (1.6 h) |
| e2e (C.UTF-8) | 0 | 550 passed, 2 skipped (1.3 h) |
| root e2e | 0 | 288 passed, 18 skipped |
| demo e2e | 0 | 10 passed |

- **Container restart:** the container restarted during the first C.UTF-8 e2e run, which killed it. Nothing had failed before it stopped. Its partial log is kept as `e2e-cutf8.interrupted.log`, and it has no `.rc` file. The script skips any step that already has an `.rc` file, so it resumed from that step. The C.UTF-8 e2e step was re-run in full, and that run's results are `e2e-cutf8.log` and `e2e-cutf8.rc`.
- **Synthetic test value:** the integration and e2e runs export `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001`. It is a synthetic test value, not a real secret.
- **Skipped tests:** the skips are the same declared skips as in `orchestrator-final-8b22cc0`.
