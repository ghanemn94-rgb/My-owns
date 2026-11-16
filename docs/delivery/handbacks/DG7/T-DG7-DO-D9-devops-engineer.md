# T-DG7-DO-D9 handback (devops-engineer): A18 drill explains scheduled starters in D7–D9 (F-DG7-971, D-278, ADR-0064 Amendment 5)

- **Stage:** DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`, base `HEAD` `733b17715fea1401028e4cacb3336e8ca68a5870` (clean tree at start apart from this run's `docs/delivery/runs/` directory).
- **Invocation:** `DG7-T-DG7-DO-D9-devops-engineer-20261116T092822Z-9be8b05c`, session `9be8b05c-6a59-4a5b-b595-9d91271e08d5`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-D9.md`, sha256 `a29a7ec3…44ba3d` (verified).
- **Requirements:** REQ-S19-017, REQ-S20-018.
- **Time:** `date -u` start 09:28:32Z, end 10:19Z (about 51 min).
- **Environment:**
  - Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline (`MTH_PNPM_OFFLINE=1`);
  - PostgreSQL 16.15 at `/usr/lib/postgresql/16/bin`, bubblewrap 0.9.0, uid 0;
  - no Docker daemon (D-243 Q1), none used.
- **Disk:** about 10.3 GB free at the start in `$TMPDIR`. Every temporary tree was removed (driver logs: `removed …`).

Nothing here grants or implies a G1–G6, Finance or IT approval, and G6 never implies DG7. All drill data, users and credentials are SYNTHETIC. A local, container-free drill is not evidence of high-availability production readiness.

## 1. Files changed

| File | Purpose | sha256 |
| --- | --- | --- |
| `deploy/scripts/drill/schedule-explained.mjs` (new) | ADR-0064 A5 second stage. It exports `parseScheduleKey`, `parseCron`, `cronMatches`, `slotOf`, `gate0`, `explain`, `stage` and `canonical`. Its CLI reads T in one `REPEATABLE READ READ ONLY` transaction (also `PGOPTIONS=-c default_transaction_read_only=on`, and it checks `transaction_read_only = on`), applies Gate 0, S1–S9, uniqueness and S′, prints the A5.4 lines and writes canonical `schedule-explained-d9.json`. | `b8fc5103…72ed0` |
| `deploy/scripts/transfer-drill.sh` | `target_clock` (T's `clock_timestamp()`, UTC, ms). D7: W0 is read immediately before `start_target`, with the A5.4 line. D9: `reconcile D9 … \|\| rc=$?`; W1 is read immediately after, with the A5.4 line; then `schedule-explained.mjs` runs always (exit 0 also writes the file). D9 passes only on recheck exit 0, or on stage exit 0. Stage exit 2 is a D9 FAIL ("BLOCKED"). Otherwise the existing D-264 "changed outside the allowance" lines follow. The D11 report gives D9 `recheck`, `scheduleExplained` and `scheduleWindow`, and lists `schedule-explained-d9.json` in `reports[]`. The header is updated. | `a72ca6f0…51c06` |
| `tests/qa/integration/a18-transfer-drill.test.ts` | The harness accepts D9 only for `recheck` `matched`, or `schedule_explained` with ≥ 1 entry passing its **own** re-check, which is written independently of the drill module: S2 and S3 from the entry, S4 key, S5 code, S6 slot by its own cron evaluator, S7 and S8 against `scheduleWindow`, one execution per slot, and a `job:` event of the execution. It prints each entry and requires `schedule-explained-d9.json` `recheckExit` 4 with no failures. Only in that case is `reconcile-d9.json` (whose real result is exit 4) not checked for equality. `schedule-explained.mjs` is added to the drill files checked. | `066cf941…720ff` |
| `deploy/scripts/tests/transfer-drill.test.mjs` | New suite `T-DG7-DO-D9 …`: T-S1 to T-S8 (unit), and T-S9 with the assignment's (a) and (b) on PostgreSQL (§2). | `c2913e7f…252b7` |
| `deploy/scripts/tests/fixtures/f-dg7-971-reconcile-d9.json` (new) | QA round-5 `out-repro/reconcile-d9.json` `exit` and `output[]`, copied unchanged (T-S4 to T-S7) | `418184a4…b47e` |
| `docs/handover/deployment.md` | One paragraph in "Moving an installation": the drill rule, the window, what still FAILs (handler business writes), the recovery (re-run; never pause a schedule), and what the report lists. No heading or anchor changed. | `55a1b783…05ac` |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D9-evidence/**` | Logs, the two drill drivers and the three drill output directories (`out-away/`, `out-quarter/`, `out-quarter2/`) | — |

Not changed (as required): `packages/db/**`, `recheck.ts`, `reconcile.ts`, the allowance, migrations, the contract, the register, other handover texts, gate tooling and reviews. No `apps/api/test/support/p7-pending*.ts` entry belongs to this task: it adds no API operation, and `p7-pending-arch-05.ts` holds only BE-H's list.

## 2. Behaviour per requirement

**REQ-S19-017 / REQ-S20-018 (A18 drill: "records, jobs and approvals intact after a full restart", independent of the wall clock).**

The drill now gives the same result whether or not a scheduled starter runs on T between D7 and D9. It does so without loosening mode 2 and without pausing or rescheduling a job. The drill never writes `job_schedule`, and B.6 job-check still pins it.

**How the stage works.** `reconcile-d9.json` keeps the recheck's real result. After the recheck, the stage explains only the following:
- an added `automation_execution` with `run_as = 'service'` and `initiating_user_id IS NULL`;
- whose trigger kind is `schedule`;
- whose key is `<code>:YYYY-MM-DDTHH:MM`, with the code equal to `trigger_code`;
- for which exactly one enabled `job_schedule` row `<code>` exists;
- whose key minute names a slot of that row's cron in that row's timezone (`M`, or `M − 60 s`);
- whose slot is in `(W0 − 60 s, W1]`, with `created_at` in `[W0, W1]`;
- which has a worker `service` event with no user, a `job:` request id and `new_version = version`, with `seq > B`;
- and which is the only execution for its `(code, slot)`.

It also explains that execution's added action results, each with a worker event in `R(x)` and the A4.4 structure. Gate 0 refuses any other line of the recheck output, a third table, or 20 keys.

**What is listed.**
- Each explained execution gets an A5.4 line, and the summary line precedes `step D9 PASS`.
- Each one is listed in `schedule-explained-d9.json` and in the report's D9 `scheduleExplained`, together with its action results and audit events.

**Choices I made where the ADR left room** (reviewers please check):
1. **B** = `greatest(audit_baseline_seq_max, audit_carried_seq_max)` of the latest `migration_import` (NULL → 0), not the baseline maximum alone. This is never looser than A5.2's B: a higher bound admits fewer events.
2. **W0/W1** are read to milliseconds (`to_char … MS`, truncated), as A5.2 says. A `created_at` within the same millisecond as a bound is compared at ms precision.
3. **Uniqueness** counts every execution on T with the same `trigger_code` created since `W0 − 10 min`, not only the `U_x` keys. A same-slot execution is created at or after its slot, which is after `W0 − 60 s`.
4. **Gate 0** treats any blank line except the final newline as "line not allowed", so stderr noise in `reconcile-d9.txt` (for example a Node warning) makes D9 FAIL. That is strict, not loose.
5. **Report fields beyond A5.5.** Each execution entry also carries `runAs`, `initiatingUserId` and `triggerKind`, so the harness can re-check S2 and S3 from the report alone (A5.5 asks it to re-check S2–S8).
6. **Two A5.4 reasons were not in the table**, and I added them: `result attempt <a> is after the execution's attempt <n>`, and `result <id> is added but not in the recheck's unexplained list`. The starter rule ("exactly one `starter_handler` at ordinal 1") uses `attempt <a> ordinals <list> (expected 1..1, starter_handler)`.

**Tests** (`deploy/scripts/tests/transfer-drill.test.mjs`, suite `T-DG7-DO-D9 …`):

| Test | What it proves |
| --- | --- |
| T-S1 | Key parsing. Refuses `Z`, seconds, an offset, 02-30, an hour of 24, upper case, and another code. |
| T-S2 | `slotOf`: 08:00 → 08:00; 08:01 → 08:00; 08:02 and 08:07 → none; `5 0 * * *` Asia/Riyadh → 21:05Z the previous day. DOW 7 = Sunday; DOM/DOW combine by OR or AND; seconds ≠ 0 and an unknown zone are refused. |
| T-S3 | S7 bounds: `W0 − 60 s` is outside, `W0 − 59 s` is inside, `W1` is inside, and a slot after `W1` is outside (exact reason text). |
| T-S4 | The QA round-5 fixture is explained, with the exact A5.4 lines. Without the stage, the same output (exit 4) is a D9 FAIL. The `d9()` decision in `transfer-drill.sh` is pinned statically. |
| T-S5 | 14 single violations each FAIL with the A5.4 reason: S1, S2, S3, S4, S5 (disabled schedule and no row), S6 (08:02), S7, S8, S9 (no event; a user on the event; `seq ≤ B`; a non-`job:` id) and uniqueness. The action result then fails too. |
| T-S6 | Gate 0 makes the rule not applicable for each of: `unexplained changed`, a third table, `expected but not`, a non-zero attachment count, a table-count mismatch, `missing ≠ 0`, 20 keys, no execution key, an unknown line, and exit 1. Exit 0 → `recheck matched`. |
| T-S7 | S′ FAILs for: a result of an unexplained execution, a result event outside `R(x)`, ordinals {1, 3}, and a starter without `starter_handler`. |
| T-S8 | Every `cron` seeded into `job_schedule` by `packages/db/migrations/*.sql` parses. `MON`, `L`, six fields, `?`, `#` and `5/15` are refused. |
| T-S9 (PostgreSQL) | See the list below. |

The T-S9 cases run on a disposable database: `mth-db migrate` and `seed-demo`, a fixture `migration_import` with B = the current max seq, and fixture rows inserted as the superuser.
- **(a) PASS:** an injected execution for the **real** `approval.escalation_scan` `'*/15 * * * *' Asia/Riyadh` row, at slot 08:00, with its result and three worker events, passes. It is listed with 1 result and 3 audit events. A digest of `job_schedule`, `pgboss.schedule`, both automation tables and `audit_event` (count and max seq) is unchanged by the stage.
- **(a) FAIL with the rule removed:** the same module with `explained.set` mutated away exits 1 on the same rows.
- **(b) still FAILS:** an execution with an initiating user; a `trigger_key` whose code (a synthetic `schedule` trigger `fixture.no_schedule`) has no `job_schedule` row; and a slot outside the window (07:45).
- **Also FAILS:** an `event`-triggered execution in the same window, a scheduled execution with no worker events, and a valid execution beside an unexplained one. In the last case D9 FAILs as a whole and nothing is listed.
- The migrations' seeded crons are also parsed from the live `job_schedule`.

**Drill runs** (same archive for all three: built from HEAD `733b1771…`, the product is unchanged by this task; `mth-transformation-hub-0.1.0-9540a3756aad.tar.gz`, 14,701,164 bytes, sha256 `8a39bb3e892e752b9237eee48598f63f3ce6f4303f26516066ddadf6ed65656b`; demo export 335 tables, 4,782 rows; drill helpers from this working tree):

| Run | Start → end (UTC) | Window `[W0, W1]` (target clock) | Quarter inside? | D9 recheck | Listed | Drill |
| --- | --- | --- | --- | --- | --- | --- |
| away | 09:43:00 → 09:47:39 (278.9 s; drill 274.408 s) | 09:46:47.434Z – 09:47:33.727Z (lower bound 09:45:47.434Z) | no | exit 0, `matched` | none | **PASS**, exit 0; 335 tables, 2 evidence files |
| quarter (1st attempt) | 09:55:20 → 10:00:06 (286.4 s; drill 281.754 s) | 09:59:15.117Z – 10:00:00.992Z | 10:00:00 was inside, but only in the window's last 0.99 s; no execution existed by W1 | exit 0, `matched` | none | **PASS**, exit 0 |
| quarter2 | 10:10:45 → 10:15:33 (288.1 s; drill 283.483 s) | 10:14:41.442Z – 10:15:27.756Z | yes, 10:15:00 | **exit 4**: `automation_execution` 17 added, unexplained `01a1e3da-c303-7a8b-a35f-32308e2b7cc7`; `automation_action_result` 17 added, unexplained `01a1e3da-c317-70fe-8b85-91cb4bbfa98f` (the F-DG7-971 pattern) | 1: trigger `approval.escalation_scan`, key `…:2026-11-16T10:15`, slot 10:15:00.000Z, `'*/15 * * * *' Asia/Riyadh`, `succeeded`, created 10:15:27.231Z, 1 action result, 3 audit events (seq 1493–1495, request `job:8db1a75a-…`) | **PASS**, exit 0; `recheck: schedule_explained` |

More detail on the runs:
- **Why there are two quarter runs.** The first attempt's start was planned from QA's D0–D6 time (about 275 s). This run's away drill took 227 s to W0, so its window only just reached 10:00. The driver ran in another sandbox and could not be stopped, so it ran as planned and is recorded as it happened. I then ran quarter2 on a copy of the same archive, aiming the D9 restart a few seconds after 10:15.
- **Worker log, quarter2.** The `approval.escalation_scan` job was handled by the worker started in the D9 restart (`out-quarter2/worker.log` line 56), with outcome `selected 0, escalated 0`.
- **Steps per run.** D0 191.6 / 198.2 / 197.7 s; D8 33.8 s each; D9 10.3 / 9.9 / 10.1 s.
- **Checksums** (`transfer-drill-report.json`, `schedule-explained-d9.json`, `reconcile-d9.json`):
  - away: `901c6911…1232`, `23182659…e120`, `1994104b…d9c`;
  - quarter: `76603f5c…b1bf9`, `bc697f6f…87`, `1994104b…d9c`;
  - quarter2: `f3d64489…13e9`, `ccffb261…e987`, `73290b5a…dae8`.
- **No PostgreSQL left running** after any run, and every work tree was removed.

The harness's own re-check was run separately on quarter2's real report, copying the function body verbatim from the test file (`harness-recheck-on-quarter2.log`). It returns `[]`. A copy tampered with a user and a 10:00 slot returns the S2, S6 and S7 problems.

## 3. Checks run (real exit codes)

| Command | Result | Exit | Log |
| --- | --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (before any check) | `PASS gate DG6 (historical)` | 0 | `validate-historical-DG6.log` |
| `QA_PG_PORT=24871 tests/qa/support/with-pg.sh node --test --test-name-pattern="T-DG7-DO-D9" deploy/scripts/tests/transfer-drill.test.mjs` (development run) | pass 15, fail 0 | 0 | console (not kept) |
| `node --test --test-name-pattern="T-DG7-DO-D9" …` without PostgreSQL (development run) | 8 pass; 7 PostgreSQL cases FAIL with `BLOCKED: TEST_DATABASE_ADMIN_URL is not set` (never skip or pass) | 1 | console |
| `QA_PG_PORT=24891 tests/qa/support/with-pg.sh node --test deploy/scripts/tests/*.test.mjs` (deploy tool tests, full; includes the transfer-drill tests) | 204 tests, 204 pass, 0 fail, 0 skipped (§3a) | 0 | `deploy-tool-tests.log` |
| `tests/qa/support/with-pg.sh bash …/do-d9-drill-driver.sh` (away and quarter runs) | both drills exit 0 | 0 | `drill-runs.log`, `out-away/`, `out-quarter/` |
| `bash …/do-d9-quarter2-driver.sh` (quarter2) | drill exit 0, `schedule_explained` | 0 | `drill-quarter2.log`, `out-quarter2/` |
| `QA_PG_PORT=24901 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a18-transfer-drill.test.ts` (no archive inputs) | 3 passed, 7 skipped: `BLOCKED: A18 transfer drill not run: input missing …` | 0 | `a18-harness-no-archive.log` |
| `npx tsc -p <scratch tsconfig extending tsconfig.base.json, files: the harness>` (`tests/qa` is in no tsconfig, so `pnpm -r typecheck` does not cover it) | 0 errors after fixing 5 TS4111 errors from my first version | 0 | `tsc-a18-harness.log` |
| `pnpm -r typecheck` | all packages done | 0 | `typecheck.log` |
| `pnpm lint` | clean | 0 | `lint.log` |
| `pnpm openapi:lint` | clean | 0 | `openapi-lint.log` |
| `pnpm test` | unit-node 207 files, 3042 passed; unit-web 131 files, 2199 passed; formula 259 passed, 2 skipped (pre-existing) | 0 | `pnpm-test.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | all files formatted | 0 | `prettier.log` |

### 3a. Deploy tool tests

`QA_PG_PORT=24891 tests/qa/support/with-pg.sh node --test deploy/scripts/tests/*.test.mjs` (10:15:43Z–10:18:41Z):
- totals: `tests 204, suites 16, pass 204, fail 0, cancelled 0, skipped 0`, duration 176.6 s, **exit 0**;
- the new suite `T-DG7-DO-D9 …` is 15 tests plus 2 suite lines, all ✔. That is T-S1 to T-S8, and T-S9 with (a), the three (b) cases and three more failure cases, on PostgreSQL 16.15.

This suite ran at the same time as the A18 harness run (separate `with-pg.sh` clusters on ports 24891 and 24901).

**Not run (BLOCKED):** the A18 harness's 7 drill tests with `QA_A18_ARCHIVE`/`QA_A18_STORE`/`QA_A18_REQUIRE=1` (T-S10's harness half). Time ran out: one harness run is about 5 minutes, and the quarter runs used the slots. The drill half of T-S10 was run (the table above). The harness half was checked only by running its re-check function on quarter2's real report. QA's round-6 harness run is the real test of it.

## 4. Merge instructions

- There are no migrations and no product, contract or `packages/db` change, so no ordering constraint.
- Commit everything listed in §1 together. `transfer-drill.sh` calls `drill/schedule-explained.mjs`, and the harness requires that file to exist.
- **Possible conflict:** T-DG7-AN-P7H also writes the disclosure into `docs/handover/deployment.md`'s drill text (ADR-0064 A5.6 AN). My paragraph sits at the end of "Moving an installation" (`#migration-import`). If AN adds its own drill paragraph, merge the two so the rule is stated once.

## 5. Residual risks

1. **The harness's drill path with archive inputs was not run here** (§3a). Its `schedule_explained` branch was checked only by running its function on a real report.
2. **The stage parses the recheck's console text** (A5.7 residual 6). An unknown line, including Node warnings on stderr in `reconcile-d9.txt`, makes D9 FAIL. That is strict, and an operator would re-run.
3. **Quarter2's execution was created 0.5 s before W1.** A slot whose execution is created after the recheck's snapshot is simply not seen, and the run matches. Both outcomes PASS, so this is not a correctness risk, but a "quarter" run does not always exercise the stage (the first attempt did not).
4. **A scheduled handler that does real work in the window** (for example an escalated overdue approval), a daily `kpi.reporting_period_open` that opens a period, and engine ticks (`tickSlot` keys) still FAIL D9, as A5.7 residuals 1–3 intend. The demo measured `selected 0`.
5. **pg-boss timing assumptions** (`< 60 s` send rule, 30 s/5 s intervals) are pinned only by the ADR (A5.7 residual 4). An upgrade must re-verify S6 and S7.
6. **Process incident, no effect.** A `git stash push` I tried, to typecheck the harness at HEAD, failed because `.git` is read-only in this sandbox. The `git stash pop` chained after it was refused, and stash `an-p7d-partial` stays in place. Afterwards I verified that `git stash list` is unchanged (3 entries) and that my files' checksums match the ones taken before. No other file changed.

## 6. Open questions

1. **Extra fields in the A5.5 entries.** Is it acceptable that each `executions[]` entry also carries `runAs`, `initiatingUserId` and `triggerKind`? The harness's S2/S3 re-check needs them. Otherwise A5.5 would need the harness to read T.
2. **B is stricter than written** (§2 choice 1). Should the ADR say `greatest(baseline, carried)`, or should B be exactly `audit_baseline_seq_max`?
3. **Two failure reasons are new** (§2 choice 6). Should they be added to the A5.4 table?
4. **Engine ticks** (A5.7 residual 3) stay out of scope, as the ADR says. This is for the orchestrator.
