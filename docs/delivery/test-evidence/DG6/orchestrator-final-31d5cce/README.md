# DG6 verification after the round-4 repairs (orchestrator): one failure

Run in a clean detached worktree (`/home/user/wt/verify`) at `31d5ccea4`. This tree has the round-4 repairs BE-Z5 (F-DG6-300, 280), FE-Z3 (F-DG6-320, 301, 281) and AN-Z3 merged. Script: `run.sh`. Each step writes `<step>.log` and `<step>.rc`. `summary.txt` lists the exit codes.

| Step | Exit | Result |
| --- | --- | --- |
| hist, install, build, typecheck, lint, format, openapi, contrast | 0 | |
| unit (locale unset, C.UTF-8) | 0 | |
| integration | 0 | 4231 passed, 1 skipped, 1 todo |
| e2e (locale unset) | 0 | 552 passed (1.4 h) |
| e2e (C.UTF-8) | 0 | 552 passed (1.4 h) |
| root e2e | **1** | 287 passed, **1 failed**, 18 skipped |
| demo e2e | 0 | 10 passed |

## The failure

- **What failed:** `e2e/a22-p6-operability.spec.ts`, `chromium-en`, after 13.7 s. After Acknowledge, the exception stayed `open` (it expected `acknowledged`).
- **The re-run:** the spec alone with `--repeat-each=3` (`a22-rerun.sh`, `a22-rerun.log`, `a22-rerun.rc`) passed 6 of 6 (3 en, 3 ar, about 60 s each).
- **Not dismissed as a flake.** The orchestrator's reading of the cause:
  - The API heartbeat watch re-raises an open `heartbeat_missed` exception every 60 s, which bumps its version.
  - An acknowledgement made with the version loaded before that tick therefore gets 409.
- **Routed:** to the pre-freeze repair T-DG6-BE-Z6 (D-213). This run does not support a freeze. The candidate is frozen only after the repair passes and a new full verification passes.
