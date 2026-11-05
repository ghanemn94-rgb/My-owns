# DG6 final verification after the round-4 repairs (orchestrator)

Run in a clean detached worktree (`/home/user/wt/verify`) at `8a24a1c62`. This tree has every round-4 repair merged, plus the pre-freeze repair BE-Z6:
- BE-Z5: F-DG6-300 and 280;
- FE-Z3: F-DG6-320, 301 and 281;
- AN-Z3: register rows;
- BE-Z6: the exception-acknowledge race (D-213).

Script: `run.sh`. Each step writes `<step>.log` and `<step>.rc`, and `summary.txt` lists every exit code. Every step exits 0.

| Step | Exit | Result |
| --- | --- | --- |
| hist (`validate.mjs --historical --stage DG5`) | 0 | |
| install, build, typecheck, lint, format | 0 | |
| openapi, contrast | 0 | |
| unit (locale unset; C.UTF-8) | 0 | |
| integration | 0 | 4238 passed, 1 skipped, 1 todo (422 files) |
| e2e (locale unset) | 0 | 552 passed, 2 skipped (1.4 h) |
| e2e (C.UTF-8) | 0 | 552 passed, 2 skipped (1.3 h) |
| root e2e | 0 | 288 passed, 18 skipped, including `a22-p6-operability` in both locales |
| demo e2e | 0 | 10 passed |

- **Why this run, not `orchestrator-final-31d5cce`:** the earlier run had one root failure (`a22-p6-operability`, en). Its cause was a product race, not a flake (D-213). BE-Z6 repaired it, and this run passes that spec with no retry.
- **No interruptions:** no step was interrupted or re-run.
- **Synthetic test value:** the integration and e2e runs export `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001`. It is a synthetic test value, not a real secret.
- **Skipped tests:** the skips are the same declared skips as in `orchestrator-final-04fcf43`.
