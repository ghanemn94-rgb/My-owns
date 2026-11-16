# Handback T-DG7-DO-D3 (devops-engineer): run the transfer drill to the end

- **Stage:** P7, gate DG7 (BUILDING). Task "B.7 DO-D3" of `docs/architecture/p7-work-split.md` (D-259). ADR-0064 Amendment 2 (A2.6, A2.8), ADR-0069 §4.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-D3-devops-engineer-20261113T151913Z-666071eb","session_id":"666071eb-9943-4772-bf90-bf841e8a3c26"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-D3.md`. I verified its sha256 as `dfd78abf73b8e6640720817c05f464130457644d2f5de4162a0215d9e11869d3`.
- **Base:** `5a776e3af2542e69b26c593f8b73f6dcbd74c27c` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from my run folder. Nothing was committed.
- **Time (`date -u`, sandbox clock, which earlier handbacks note runs slow):** start 15:19:22Z, last stamp before this file 15:41:14Z.
- **Environment:**
  - Node v24.21.0, PostgreSQL 16.15 (disposable clusters via `tests/qa/support/with-pg.sh`), uid 0;
  - offline (`MTH_PNPM_OFFLINE=1`), no Docker daemon (D-243 Q1);
  - free disk 3597 MB at the end (`df -Pm`).
- **Two gate systems.** Every user, secret, origin and decision here is SYNTHETIC. D8's decision outcome is `deferred` and approves nothing real. Nothing grants or implies a G1–G6, Finance or IT approval, and nothing reads or writes a DG0–DG7 record.
- **A container-free local drill is not evidence of high-availability production readiness.**

## Headline

- **Precondition 2 does not hold, so T-B11 is BLOCKED and was NOT RUN.**
  - The A2.8 register rewording is not merged: REQ-DLV-006 and REQ-DLV-023 still carry `/var/tmp/mth-run.XXXXXX` and `/tmp/claude-0`.
  - T-R16 (`node --test apps/api/scripts/register-snapshot.test.mjs`) exits **1** with exactly `['REQ-DLV-006 procedure R2', 'REQ-DLV-023 notes R2']` (`precondition-register-snapshot.log`).
  - An archive built from HEAD therefore fails D0 the same way DO-D2's did.
  - Even past D0, the run would FAIL at D8 (finding 2 below).
  - Precondition 1 (BE-R2 merged) holds: `5a776e3a` "T-DG7-BE-R2 output", with `recheck.ts`, `table-digest.ts`, `prepare-target.mjs` and the mode 2 flags present.
- **Done in code:**
  - allowance `mth-recheck-allowance/2` with all six keys, constants from `recheck.ts` only (no fallback);
  - `job-check.mjs` on `mth-db table-digest`;
  - T-B15 (6 cases) and T-B16 (6 cases): **all pass**;
  - T-B17 **written and run**;
  - the CI fragment.
- **Measured by the real runs: one product defect and three drill/seam failures.**
  1. **Defect (product, `packages/db/src/cli.ts`, BE-R2's `table-digest`):** stdout is cut at 64 KiB when it is a pipe. On the same database the output was **122 697 bytes to a file, 65 536 through a pipe**. Cause: `main(...).then((code) => process.exit(code))` right after `console.log`. Not fixed in product code. The drill tools write the child's stdout to a file instead (`defect-table-digest-pipe-truncation.log`).
  2. **Seam: D8 (b) cannot submit any gate on seed-demo data.** On the one demo transformation, G1–G4 are `approved`, and G5/G6 are `draft` (latest_submission_no 0). Submitting G5 is refused `422 gate_criteria_incomplete: "Mandatory required outputs are incomplete: Performance evidence, Adoption, Decision log."` So `writes` and `approve` FAIL, and T-B17 test 1 fails.
  3. **Design gap in A2.6 (measured by T-B17 mode 2 on the partial chain; `t-b17-measurement-mode2.txt`):** two classes of rows that D8 causes cannot be explained:
     - `automation_execution` and `automation_action_result`: one row each, written by the worker's automation run that `createTransformation` triggers, with **0 explaining events**. The audit actor is not a journalled user.
     - `record_code_counter` `["01995000-0000-7000-8000-000000000001","I"]`: the RAID code counter of the **carried** transformation. Its foreign-key parent is unchanged, and it has no key to the RAID row.

     So `reconcile-migration --after-use` exits 4 (`mismatch: 3 tables`), even though the product behaves correctly. I did not loosen any rule (see Q2).
  4. **Drill bugs found and fixed** (`transfer-drill.sh`, `journey.mjs`, new `pick-actors.sql`). The failing lines are in `t-b17-run3.log` … `t-b17-run8.log`.
     - The `gate.submit` holder was also used for the KPI value: `record KPI value: HTTP 403 … "forbidden"` (`t-b17-run3.log`). A `kpiUser` (a `kpi_actual.submit` holder who owns or stewards the definition) is now chosen and signed in.
     - Every demo KPI is a ratio: `HTTP 422 … "Enter a numerator and a denominator for this KPI"` (`t-b17-run4.log`). The journey now sends `numerator "3"` / `denominator "2"` (decimal strings) for a ratio.
     - The slot already existed: `HTTP 409 … version-conflict` (`t-b17-run6.log`). The journey now takes an open period without a slot, or else posts `…/kpi-actuals/{a}/values` with `If-Match`.
     - The gate was fixed at G1: `submit gate G1: HTTP 422 … "gate.already_approved"` (`t-b17-run7.log`). `pick-actors.sql` now chooses the lowest gate in `draft`/`changes_requested`/`deferred`, and an approver holding that gate's approver role.
     - `kpi_actual_value` was journalled from `values[].id`, which the API never returns (it presents `valueNo`), so that line never fired. It was removed, and the table is a `children` entry.
     - D9's `job-check.mjs` calls now pass `--mth-db "$RT/packages/db/dist/cli.js"`, the runtime tree's encoder.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/drill/allowance.mjs` | Writes `/2` with all six keys:<br>• `actors`: the app_user ids of the journalled sign-ins, resolved on T by (issuer, subject);<br>• `tables`: the journalled keys of every table not in `audited`;<br>• `audited`: `D8_TOUCHED_AUDITED`, with `mustInclude` set to the journalled keys;<br>• `children`: `D8_TOUCHED_CHILDREN`;<br>• `operational`: unchanged.<br>Each list entry has its reason in `allowance-reasons.json` (`mth-recheck-allowance-reasons/2`). The constants and `parseAllowance` come from `recheck.ts` only; a failing import exits 2 and there is no literal fallback. The built file is checked by `parseAllowance` before it is written (exit 1 if refused). The two D8 constants are marked in the file as measured on a **partial** chain (§4 gap 1). |
| `deploy/scripts/drill/job-check.mjs` | Digests through `mth-db table-digest`:<br>• approval tables by `digest` and `rows`;<br>• enabled `job_schedule` and earlier `job_run` rows by `--rows` line hashes of their keys.<br>pg-boss keeps the measured form. Snapshot format `mth-drill-job-snapshot/2`, and `/1` is refused (exit 2). New option `--mth-db <cli>`. Exports `tableDigest()` (stdout to a temp file, defect 1). |
| `deploy/scripts/drill/journey.mjs` | `--kpi-user`, `--kpi-definition`, `--kpi-value-nature`. The KPI value is recorded by the KPI user (signed in and journalled); a ratio sends numerator/denominator; an existing slot gets a value version with If-Match. The dead `kpi_actual_value` journal line is removed. |
| `deploy/scripts/drill/pick-actors.sql` (new) | The actor query, moved out of `transfer-drill.sh` so that T-B17 measures the drill's own choice. Adds `gate`, an approver with that gate's approver role, `kpiUser`, `kpiDefinition` and `kpiValueNature`. Rebound users only, never "whatever is new". |
| `deploy/scripts/transfer-drill.sh` | Bug fixes only: `pick_actors` runs `pick-actors.sql`; D8 passes `--kpi-user`, `--kpi-definition`, `--kpi-value-nature` and `--gate`; D9's job-check passes `--mth-db` (runtime). D9's `--allow` gets the `/2` file that `allowance.mjs` now writes. |
| `deploy/scripts/tests/transfer-drill.test.mjs` | T-B15 rewritten for `/2` (6 cases, including `parseAllowance` acceptance and the D8 list pins). T-B16 rewritten on a migrated and seed-demo database with encoder digests (6 cases; "a changed approval row changes the encoder digest"). T-B17 added (3 cases). |
| `deploy/scripts/ci/transfer-drill.job.yml` (new) | CI job fragment (§2 rule 9): `tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs`. The CI files are not edited. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D3-evidence/*` | logs, measurement, defect reproduction, `final-exits.log` |

No migration, contract, permission or product-code change. `apps/api/test/support/p7-pending*.ts` has no entry for this task (none names DO-D3 or the drill), so none were removed. `docs/handover/` is unchanged.

## 2. Behaviour per requirement

| Requirement / clause | Test | Status |
| --- | --- | --- |
| A2.6 allowance `/2` | T-B15 | **PASS (6/6).** `parseAllowance` accepts the file. Actors come from sign-ins. Audited journalled keys go to `mustInclude`. Never-operational tables appear only in tables, audited or children. Duplicates are merged. Reasons exist for every operational, audited and child entry. `app_user` is listed only by the measurement. Invalid entries exit 1. |
| REQ-S19-017 "records, jobs and approvals intact after a full restart" | T-B16 | **PASS (6/6)** on a migrated seed-demo database:<br>• snapshot approval digests equal `mth-db table-digest`'s;<br>• a new `job_run` passes (counted);<br>• a changed enabled schedule fails;<br>• a removed `job_run` fails;<br>• a changed `gate_decision` changes the encoder digest and fails;<br>• a missing pg-boss table is BLOCKED (exit 2). |
| B.7 "the two D8 lists are measured" | T-B17 | **FAIL (1/3 pass)**, on a real fixture: S migrate + seed-demo → export → T prepare-target + import + rebind of 9 users → API and worker (`NODE_ENV=production`, `AUTH_MODE=oidc`, drill IdP). Every one of the 335 exported tables compared row by row via table-digest.<br>• Test 1 FAILS: the journey stops at the gate submission (finding 2). The measurement of the steps that ran is recorded: 28 tables changed, 19 in the residue.<br>• Test 2 FAILS: mode 2 exit 4 (finding 3).<br>• Test 3 **PASSES**: an extra `roadmap_wave` row with an event by a non-journalled user is reported `unexplained added ["<its id>"]`, exit 4. |
| REQ-S19-017, REQ-S01-006, REQ-S19-009 | T-B11 | **BLOCKED, NOT RUN** (precondition 2). |

## 3. Checks run (real exit codes)

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (**first**) | 0 | `PASS gate DG6 (historical)`, `validate-historical-DG6-before.log` |
| `node --test apps/api/scripts/register-snapshot.test.mjs` (precondition 2) | 1 | T-R16: `REQ-DLV-006 procedure R2`, `REQ-DLV-023 notes R2`, `precondition-register-snapshot.log` |
| T-B17 iterations: `MTH_DRILL_D8_MEASURE_OUT=… tests/qa/support/with-pg.sh node --test --test-name-pattern=T-B17 deploy/scripts/tests/transfer-drill.test.mjs` | 1 (×10) | `t-b17-run1.log` … `t-b17-run10.log`. Runs 1–2 failed on my harness (TMPDIR, pipe truncation); runs 3–8 on the drill bugs in finding 4; runs 9–10 on findings 2 and 3. About 38 s per run. |
| `tests/qa/support/with-pg.sh node --test --test-reporter=spec deploy/scripts/tests/transfer-drill.test.mjs` (final, before the last `transfer-drill.sh` edit) | **1** | **39 tests: 37 pass, 2 fail** (T-B17 tests 1 and 2, findings 2 and 3). 1 m 13 s. `transfer-drill-test.log` |
| `npx eslint deploy/scripts/drill deploy/scripts/tests/transfer-drill.test.mjs` | 0 | `eslint-own.log` |
| `bash -n deploy/scripts/transfer-drill.sh` | 0 | after every edit |
| `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint`, `pnpm test`, the repository-wide prettier check, `validate.mjs --historical --stage DG6` (end) | see §3a | `final-exits.log` |
| T-B11 | — | **BLOCKED, NOT RUN** |

Not run:

- the A18 harness `tests/qa/integration/a18-transfer-drill.test.ts`, which needs a PASSing drill report;
- the contract test and any vitest integration file, because I changed none.

## 4. Known gaps / not done

1. **T-B11 is not run (BLOCKED).** The A2.8 register rewording is the requirements-analyst's.
2. **T-B17 fails:**
   - the D8 chain cannot submit a gate on seed-demo data (finding 2);
   - the gate submission and decision tables (`gate_submission`, `gate_decision`, `approval*`, `decision*` and their children) are therefore **not measured**. `D8_TOUCHED_AUDITED` (15 tables) and `D8_TOUCHED_CHILDREN` (4 entries) cover only sign-in, `createTransformation`, the RAID item and the KPI value. They will change once the chain runs to the end.
3. **Mode 2 cannot match after D8 under A2.6 as written** (finding 3). I did not add an operational table or a rule.
4. **Defect 1 (`table-digest` pipe truncation)** is open in product code. The drill avoids it, so D9 is unaffected.
5. Not run with the `transfer-drill.sh` edits: the D8 and D9 paths of the drill itself (they run only inside T-B11). T-B17 runs the same `pick-actors.sql` and journey code.
6. T-B17 starts the worker and waits 15 s after the chain. A worker job that derives rows later than that is not measured.

## 5. Open questions and merge instructions

- **Q1 (orchestrator / BE-R2 owner):** fix `mth-db` so it lets stdout drain before exiting (for example, set `process.exitCode` instead of calling `process.exit`). Then `table-digest | …` works for big tables. The drill does not depend on the fix.
- **Q2 (architect, A2.6):** how should mode 2 explain:
  - (a) worker automation rows whose audit actor is a service, while the initiating user is journalled (`automation_execution.initiating_user_id`)? Options: an `on_behalf_of_user_id` on those events, or an A2.6 rule over `initiating_user_id`;
  - (b) counters like `record_code_counter`, which change on a carried parent with no key to the journalled row? Options: make it operational, or define a "counter" basis.
- **Q3 (orchestrator / data owner):** D8 (b) needs a submittable gate. Choices:
  - seed-demo ships a gate whose mandatory criteria are complete (or covered by an accepted exception);
  - or the work split extends D8 so that it completes G5's outputs through the API.

  Until then, D8 cannot pass on demo data.
- **Merge:**
  - No migration and no contract change.
  - Merge the CI fragment `deploy/scripts/ci/transfer-drill.job.yml` into `deploy/ci/ci.yml` and run `check-ci-needs.mjs`. Expect it to fail until Q2 and Q3 are settled (T-B17).
  - `pick-actors.sql` is a new drill file, and `prettier --ignore-unknown` skips it.

## 3a. Final check results

`docs/delivery/handbacks/DG7/T-DG7-DO-D3-evidence/final-exits.log` holds the exit codes of `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint`, `pnpm test`, the repository-wide prettier check and the closing validator. They were run by `$TMPDIR/checks.sh` after the code was final, and the log is authoritative. The values below are copied from it.

| Command | Exit | Result / log |
| --- | --- | --- |
| `pnpm -r typecheck` | **0** | 196 s, `typecheck.log` |
| `pnpm lint` | **0** | 38 s, `lint.log` |
| `pnpm openapi:lint` | **0** | `openapi-lint.log` |
| `pnpm test` | **0** | 313 s. unit-node 205 files / 3011 tests; unit-web 130 / 2175; nocodegen 3 / 259 (+2 skipped). `pnpm-test.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `prettier.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | **0** | `validate-historical-DG6-end.log` |
| `tests/qa/support/with-pg.sh node --test --test-reporter=spec deploy/scripts/tests/transfer-drill.test.mjs` (final, after the last `transfer-drill.sh` edit) | **1** | 39 tests: 37 pass, 2 fail (T-B17 tests 1 and 2: findings 2 and 3). 15:54:45Z. `transfer-drill-test-final.log` |

The acceptance item "every §B.7 test passes" is **not met**: T-B17 fails (findings 2 and 3) and T-B11 is BLOCKED (precondition 2). This handback was written before the repository-wide prettier run, which covered it.
