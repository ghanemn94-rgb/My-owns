# Handback T-DG7-QA-F (qa-verifier): the race in the A13 import-commit kill-and-restart drill

- **Stage:** P7 / DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` = `48588a00c30d97aa31919f3595765d973ab1aa90` at both start and end. At start, `git status` showed only this run's directory under `docs/delivery/runs/DG7/`.
- **Candidate:** none is frozen (pre-freeze task). At the end, `node tools/gates/candidate.mjs --stage DG7` printed `sha256:cf01b4d445db7725165e9f3f06a2fd9f12d454d8aff1fce7e74499cb127a38fd` (working tree, 3148 files, including my uncommitted files). It is recorded for traceability only. This is not a review and not a gate verdict.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-QA-F-qa-verifier-20261115T041353Z-8302ac7b","session_id":"8302ac7b-2479-452c-a6bc-291c8ff3092a"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-QA-F.md`, sha256 `c2a5d4e6e97f6c4f6000d435c5d46e63bb8bac60f6ed4af1b8b1ddf364f26085` (verified).
- **Time:** started 04:14:04 UTC, ended 04:45 UTC (about 31 minutes).
- **Where this file is:** the assignment asks for `docs/delivery/handbacks/DG7/T-DG7-QA-F-qa-verifier.md` and `docs/delivery/handbacks/DG7/T-DG7-QA-F-evidence/`. The write guard refuses both paths for qa-verifier: the Write tool returned "BLOCKED by write guard: qa-verifier may not write 'docs/delivery/handbacks/DG7/T-DG7-QA-F-evidence/loop-summary.txt' (outside role write scope)", and the Bash sandbox returned EROFS for the same directory. I followed the QA-C precedent (D-266) and wrote this handback and every log to `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-F/`. **Q1** asks the orchestrator to copy them.
- **Authorship:** I edited only acceptance-test support and tests under `tests/qa/**`. I edited no product code.

## 1. Files changed

| File | Change |
| --- | --- |
| `tests/qa/support/child-ready.ts` (new) | `watchChildOutput(child, what, marker, ms)`: an event-driven waiter for a child's READY line. It resolves on the first `data` chunk that completes a line equal to the marker. It rejects only on `close`, which comes after the process exits **and** all of its stdio has been delivered, so "exited before READY" means the child really never printed READY. It also rejects on a spawn `error` or a timeout. The file header explains the root cause. |
| `tests/qa/support/a13c.ts` | `spawnChild` now uses `watchChildOutput` in place of the exit-first poll. With `QA_A13C_TRACE=1`, each child's READY time and exit (code or signal) go to stderr as evidence. `killHard` no longer waits forever when the process has already exited: it takes the real `signalCode`, so the existing `toBe("SIGKILL")` assertion fails with a clear message. |
| `tests/qa/support/a13-durable.ts` | `childWorker` had the same exit-first poll. It now uses `watchChildOutput` too. Nothing else changed. |
| `tests/qa/unit/a13-child-ready-race.test.ts` (new) | A unit regression test with 6 cases, using inline `node -e` children only (no database, no product code). (1) It reproduces the root cause deterministically: the former probe, evaluated after a READY-then-exit-0 child has closed, throws exactly `exited (0) before READY: READY`. (2) The new waiter resolves for that child 50 times in a row and returns the whole output. (3) It resolves for a live child whose READY arrives split across chunks. (4) A child that exits without READY is rejected, and the error includes the child's output. (5) `NOT-READY-YET` does not count as READY. (6) A silent child times out. |

There are no `p7-pending*` entries in my scope and I removed none. My scope has no mutation, money, Unknown/Stale or bilingual-text requirements: this is a test-harness repair.

## 2. Behaviour per requirement

**REQ-S20-013 / REQ-DLV-038 (A13 durable automation), drill `tests/qa/integration/a13-p6-import-commit-kill-restart.test.ts`**

- **Root cause of pre-freeze run 2** ("a13c-child-api.ts exited (0) before READY: READY"):
  - The failure came from the restarted child, `qa-a13c-imp-api2` (test line 153, the second `childCommit`). In `request` mode, `a13c-child-api.ts` prints READY, runs one `inject`, prints `RESPONSE …` and calls `process.exit(0)`. That is its documented design (file header: "Prints `RESPONSE <status> <body>` when it completes").
  - The old `spawnChild` polled every 150 ms (`waitFor` in `a13-durable.ts`) and checked `child.exitCode !== null` **before** `out.includes("READY")`.
  - With the blocking trigger switched off, READY, the commit and the exit all happened between two polls. The next poll saw exit code 0 and threw, although the output already held READY **and** the full `RESPONSE 200 {… "status":"committed","rowsCommitted":3 …}`. The pre-freeze log shows exactly this at lines 2878–2879.
  - The trace measured 20 + 1 times how long the restarted child takes from READY to exit: 138–188 ms, which straddles the 150 ms poll interval. So whether a poll landed between READY and the exit was down to timing. Run 1 passed, run 2 failed.
- **Not stdout loss or buffering:** the error message itself contains READY and the RESPONSE line, so the data had arrived. The cause was only the order of the checks.
- **Not a product defect:** the child exiting after READY is the support script's own documented behaviour in `request` mode. The product commit worked correctly in the failing run: 200 `committed`, `rowsCommitted` 3, `version` 3.
- **The fix is deterministic:** the waiter does not poll. Node delivers every stdout/stderr `data` event before `close`, so a child that wrote READY always resolves first. The race cannot occur whatever the timing, and unit case (1) and (2) demonstrate this.
- **The drill's acceptance assertions are unchanged:**
  - the killed commit leaves the batch staged, with Unknown `rowsCommitted` and no lineage or actual;
  - the retried commit gives 200 `committed`, 3 lineage rows and 3 actuals;
  - a replay gives 409 `import.not_staged` and writes nothing.

## 3. Checks run (real exit codes)

Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, a disposable PostgreSQL cluster per invocation from `tests/qa/support/with-pg.sh`. `node_modules/` is read-only in this sandbox, so every vitest command used `--configLoader runner` (see the `pnpm test` row). Logs are in `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-F/`.

| # | Command | Expected | Actual | Exit | Log |
| --- | --- | --- | --- | --- | --- |
| 1 | `npx vitest run --configLoader runner --project unit-node tests/qa/unit/a13-child-ready-race.test.ts` | 6 pass | 6 pass | 0 | `unit-race.log` |
| 2 | 20 × `QA_A13C_TRACE=1 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa/integration/a13-p6-import-commit-kill-restart.test.ts`, each on a new cluster | 20/20 pass | **20/20 pass**. Every run: api1 `signal=SIGKILL`, api2 `code=0` (READY → exit 138–188 ms) | 0 ×20 | `loop-summary.txt`, `loop/run-1..20.log` |
| 3 | `with-pg.sh npx vitest run … --project integration` with the 4 A13 P6 drills, `a13-durable-automation`, `a13-jobs-rerun` and `apps/api/test/integration/contract` (all users of the changed helpers, plus the contract test) | pass | 9 files, 252 tests pass | 0 | `a13-siblings-contract.log` |
| 4 | `pnpm -r typecheck` | 0 | 0 | 0 | `typecheck.log` |
| 5 | `pnpm lint` | 0 | 0 | 0 | `lint.log` |
| 6 | `pnpm openapi:lint` | 0 | PASS, 965 operations | 0 | `openapi-lint.log` |
| 7 | `pnpm test` (plain) | 0 | **BLOCKED (sandbox):** vite cannot write `node_modules/.vite-temp/vitest.config.ts.timestamp-*.mjs` (EROFS) | 1 | `pnpm-test-plain.log` |
| 7a | The same three projects with `--configLoader runner`: `unit-node`, `unit-web`, `unit-formula-nocodegen` | 0 | unit-web 2179/2179 (exit 0); nocodegen 259 pass + 2 skipped (exit 0); unit-node 3041/3042 (exit **1**) | 1, 0, 0 | `test-unit-*.log` |
| 7b | `QA_EVIDENCE_DIR=$TMPDIR/qa-a20 npx vitest run --configLoader runner --project unit-node` (rerun) | 0 | 3042/3042. The run-7a failure was `a20-p6-token-contrast` writing `test-results/qa-a20/contrast-pairs.txt` (EROFS in this sandbox). It is unrelated to this change, and the file supports `QA_EVIDENCE_DIR` for exactly this case. | 0 | `test-unit-node-rerun.log` |
| 8 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | all files formatted | 0 | `prettier.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | PASS gate DG6 (historical) | 0 | `validate-dg6.log` |
| 10 | `npx eslint --max-warnings=0` on the 4 touched files | 0 | 0 | 0 | `eslint-files.log` |
| 11 | ad hoc `tsc -p $TMPDIR/tsconfig.qaf.json` on the 4 touched files (`tests/qa` is in no typecheck project) | 0 | 1 error, TS2883 at `a13-durable.ts:339` (`qaBoss` return type names `PgBoss`). That line is outside my diff, so the error was already there (see §4). | 2 | `tsc-qa-files.log` |

Every non-zero exit is disclosed above: 7, 7a unit-node and 11.

## 4. Known gaps

- **Plain `pnpm test` did not run** (row 7): this sandbox mounts `node_modules/` read-only and vite writes its config bundle there. The equivalent per-project runs passed (7a, 7b). The orchestrator should run plain `pnpm test` on a writable tree.
- **`tests/qa/**` is in no `tsconfig`** (that was already the case). The ad hoc check found an existing TS2883 in `a13-durable.ts:339`, outside my diff. Vitest does not typecheck, so no test is affected. I did not fix it because it is out of scope.
- **Similar polling remains in two places:** `tests/qa/support/a22-ops.ts` and `e2e/support/a13-a22-stack.ts`. Both check the marker **before** the exit code, and both start long-running workers that must not exit, so an observed exit is a real failure there. Neither is affected by this race. I left them unchanged.
- I re-ran the other A13 drills once (row 3), not 20 times. Their children (watch and worker modes) never exit on their own, so they cannot hit this race.

## 5. Open questions

- **Q1 (orchestrator):** please copy this handback to `docs/delivery/handbacks/DG7/T-DG7-QA-F-qa-verifier.md` and the logs to `docs/delivery/handbacks/DG7/T-DG7-QA-F-evidence/`. The write guard refuses qa-verifier there; the same happened for QA-C under D-266.
- **Q2 (orchestrator):** do you want `tests/qa/**` covered by a typecheck project, and the existing TS2883 fixed, in a later QA task?
