# DG6 final verification (orchestrator)

Run on an idle host, in a clean worktree. Each step's exit code is shown below; the logs are in this folder, with ANSI colour codes removed.

## Full run on b7a1a96a7

Logs: `full-run-b7a1a96/`.

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
| integration | 0 | 410 files; 4144 passed, 1 skipped, 2 todo |
| e2e (locale unset) | 0 | 544 passed, 2 skipped |
| e2e (C.UTF-8) | **1** | 541 passed, 1 failed, 2 skipped |
| root e2e | 0 | 288 passed, 18 skipped |
| demo e2e | 0 | 10 passed |

The one failure was `p4-kpi-unit.spec.ts` test 1 (chromium-ar, #415). Its 20 s poll for the worker-calculated KPI ran out.

The e2e stack runs no worker, so by that point in a full run the jobs queued by the earlier specs are waiting. The test starts the real worker, and the worker log printed by the test shows it was still draining the outbox and the `notifications.fanout` jobs when the poll ran out. This is a test-timing defect, not a product defect.

## Repair: 441b6e23b

The repair is in the test files only:

- The worker-backed polls in `p4-kpi-unit.spec.ts` and `p4-percentage-kpi.spec.ts` now wait 90 s, as `p4-benefits.spec.ts` already did.
- The test timeout of each is set to 240 s.

## Re-run on 441b6e23b

The steps a test-only change can affect were re-run (logs in this folder):

| Step | Exit code | Result |
| --- | --- | --- |
| hist | 0 | |
| install | 0 | |
| typecheck | 0 | |
| build | 0 | |
| lint | 0 | |
| format | 0 | |
| e2e (locale unset) | 0 | 544 passed |
| e2e (C.UTF-8) | 0 | 544 passed |

The other steps (openapi, contrast, unit, integration, root, demo) passed on b7a1a96a7 and are not affected: the diff changes only the two e2e spec files.
