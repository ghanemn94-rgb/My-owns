# DG6 final verification after the round-1 repairs (orchestrator)

Run in a clean detached worktree (`/home/user/wt/verify`) on a mostly idle host (1-minute load about 2). Each step's exit code is shown below. The logs are in the two subfolders, with ANSI colour codes removed. The scripts that ran are `full-run-c5bad15/run.sh` and `rerun-1b70b9a/run.sh`.

## Full run on c5bad1517

This tree has every round-1 repair merged: BE-Y1 to Y6, DO-Y1, DO-Y2, FE-Y1 and ARCH-11 to 13. Logs are in `full-run-c5bad15/`.

| Step | Exit code | Result |
| --- | --- | --- |
| hist (`validate.mjs --historical --stage DG5`) | 0 | |
| install | 0 | |
| typecheck | 0 | |
| build | 0 | |
| lint | 0 | |
| format | 0 | |
| openapi | 0 | |
| contrast | 0 | |
| unit (locale unset) | 0 | |
| unit (C.UTF-8) | 0 | |
| integration | **1** | 413 files; 1 failed, 412 passed; 4185 passed, 6 skipped, 1 todo |
| e2e (locale unset) | 0 | 546 passed, 2 skipped |
| e2e (C.UTF-8) | 0 | 546 passed, 2 skipped |
| root e2e | 0 | 288 passed, 18 skipped |
| demo e2e | 0 | 10 passed |

The one failing file was `apps/api/test/integration/automation/automation-version-at-occurrence.test.ts` (BE-X10). It migrates a scratch database to 0122, then asserts that the next `migrate()` applies exactly one file, `0123_*`. After 0124 (BE-Y5) and 0125 (BE-Y6) were merged, three files were applied. This is a test defect, not a product defect.

## Repair: 1b70b9acf

The repair is in the test only. It now asserts that the first applied file is `0123_*` and that every other applied file comes later.

That file run alone: 5 passed.

## Re-run on 1b70b9acf

A change to a test file can affect only these steps, so only these were re-run. Logs are in `rerun-1b70b9a/`.

| Step | Exit code | Result |
| --- | --- | --- |
| typecheck | 0 | |
| lint | 0 | |
| format | 0 | |
| integration (full) | 0 | 413 files passed; 4190 passed, 1 skipped, 1 todo |

The other steps were not re-run on 1b70b9acf. Their results come from c5bad1517, which differs only by this one test file.
