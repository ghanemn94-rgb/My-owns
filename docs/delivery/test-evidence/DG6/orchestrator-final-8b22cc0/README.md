# DG6 final verification after the round-2 repairs (orchestrator)

Run in a clean detached worktree (`/home/user/wt/verify`) at `8b22cc095`. This tree has every round-2 repair merged: BE-Z1, ARCH-14, BE-Z2/Z2B, AN-Z1, BE-Z3, FE-Z1/Z1B and DO-Z1, plus the orchestrator's one-line `configuration.md` fix. Scripts: `run.sh` (steps 00–08) and `e2e/run.sh`. Every step's exit code is listed in `summary.txt` and `e2e/summary.txt`.

| Step | Exit | Result |
| --- | --- | --- |
| install, build, typecheck, lint, format | 0 | |
| openapi | 0 | 932 operations |
| contrast | 0 | |
| unit (locale unset) | 0 | 259 passed, 2 skipped |
| unit (C.UTF-8) | 0 | 259 passed, 2 skipped |
| integration | 0 | 4212 passed, 1 skipped, 1 todo (3705 s) |
| e2e (locale unset) | 0 | 546 passed, 2 skipped (1.6 h) |
| e2e (C.UTF-8) | 0 | 546 passed, 2 skipped (1.6 h) |
| root e2e | 0 | 288 passed, 18 skipped |
| demo e2e | 0 | 10 passed |

- The skipped tests are the same declared skips as in `orchestrator-final-1b70b9a`.
- The e2e runs export the synthetic test value `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001`. It is not a secret. The integration run did not export it, and it passed.
- FE-Z1B had reported that the deliverable-count warning in `p3-ui-completion` arrived late under load. On this quieter host it passed in both locales, so no repair is assigned. The round-3 QA review judges it again.
- `validate.mjs --historical --stage DG5` was not re-run here. It is a check for the reviewers.
