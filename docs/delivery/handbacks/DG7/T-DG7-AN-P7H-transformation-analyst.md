# Handback T-DG7-AN-P7H (transformation-analyst): register notes for the A18 scheduled-starter rule (F-DG7-971, D-278)

- **Stage:** DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `2f9b873afd88115056caedbb3639ff1cbaba17a0`, verified with `git rev-parse HEAD`. At the start, `git status` was clean apart from this run's own `docs/delivery/runs/…` directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-AN-P7H.md`, sha256 `8fdff657…f898` (verified).
- **Invocation:** run `DG7-T-DG7-AN-P7H-transformation-analyst-20261116T101932Z-2eab4286`, session `2eab4286-22f3-40e4-bb0d-dd8dff3b998e`.
- **Requirements:** REQ-S19-017, REQ-S20-018, REQ-S01-006. Finding F-DG7-971 (Medium, not mandatory).
- **Time:** `date -u` start 10:19:42Z. The end time is in §3.
- **Two gate systems.** This is a register update. It grants and implies no G1–G6, Finance or IT approval, and no DG gate. F-DG7-971 is not closed here: only a non-author reviewer can close it. All drill data cited is SYNTHETIC.

**Inputs read:**
- D-278, and decisions D-243 to D-278 by title;
- F-DG7-971 in `reviews/DG7/round-5/qa-verifier.findings.json`;
- QA evidence `test-evidence/DG7/qa/round-5/a18/d9-schedule-window-analysis.log` §1–§10 and `qa-r5-d9-boundary-repro.sh`;
- ADR-0064 Amendment 5 (A5.1–A5.7) and the ARCH-R6 handback;
- the DO-D9 handback and its evidence;
- `p7-work-split.md` §1–§2, and the `p7-plan.md` headings.

I checked DO-D9's claims against the files themselves, not just the handback:
- `steps.ndjson` (D0–D11 PASS for out-away, out-quarter and out-quarter2);
- `job-check.json` (`PASS`, 0 new job runs);
- `schedule-explained-d9.json` (quarter2: `recheckExit` 4, `applicable` true, 1 execution, no failures);
- `reconcile-d9.json` (quarter2: exit 4, `equal` false);
- the worker log line 56 (`approval.escalation_scan` handled after the D9 restart, `selected 0`);
- the sha256 of `transfer-drill.sh`, `drill/schedule-explained.mjs`, the A18 harness and `transfer-drill.test.mjs` at this base. All four match the DO-D9 handback.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/delivery/requirements.csv` | Appends "DG7 analyst pass 8" to the `notes` of REQ-S19-017, REQ-S20-018 and REQ-S01-006. No other field or row changed. The CSV round-trips byte for byte, and the diff is exactly 3 lines (`T-DG7-AN-P7H-evidence/requirements.diff`). |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7H-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7H-evidence/*` | Check logs, the register diff and the C3 audit JSON. |

Not changed:
- `docs/handover/**`: the assignment forbids it (open question 1);
- status, evidence and every other column;
- gate tooling, reviews, `stages.json`, `findings.json`, test evidence and code.

No `apps/api/test/support/p7-pending*.ts` entry belongs to this task. The assignment's generic deliverables (mutations, authorization, decimal, bilingual) don't apply: there is no product change.

## 2. Behaviour per requirement (register notes)

All three notes now state the following:
- **The residual:** QA round 5 on candidate `07af9fba` saw D9 FAIL in 2 of 5 runs when `approval.escalation_scan` (`*/15`, Asia/Riyadh) or a daily starter (00:05–00:45 Asia/Riyadh) ran on the target between D7 and D9. That is about 5–7 % of runs on the clock alone, and the product was correct.
- **D-278's rule as ADR-0064 A5.2 specifies it:**
  - the mode 2 recheck runs unchanged;
  - the drill explains only a schedule-triggered execution with no initiating user whose key names an enabled `job_schedule` row and a slot of its cron and timezone in `(W0 − 60 s, W1]` on the target clock, created in the window, with its own worker audit event and one execution per slot;
  - it also explains that execution's action results and audit events;
  - every other row stays unexplained (Gate 0);
  - the report lists each explained execution;
  - no job is paused or rescheduled.

| Requirement | Note added | Status |
| --- | --- | --- |
| REQ-S19-017 (A18 drill) | Residual, rule, and DO-D9's **away** run (no quarter hour, `recheck: matched`, D0–D11 PASS, exit 0) and **quarter2** run (10:15 inside the window; recheck exit 4 in the F-DG7-971 pattern; execution `01a1e3da-c303-…` explained with key `…:2026-11-16T10:15`, 1 action result and 3 audit events; `recheck: schedule_explained`; job-check PASS; D0–D11 PASS; exit 0). Also the first quarter attempt (window reached 10:00 only in its last 0.99 s, matched) and deploy tool tests 204/204 (T-S4, T-S5, T-S9). Remaining residuals: handler business writes still FAIL D9 (not a data defect; re-run, never pause); engine ticks not covered; S6/S7 rest on pg-boss 11.0.0. These are integration-tree runs, and QA round 6 re-runs them. | **IMPLEMENTED**, unchanged. Each acceptance clause is met by both reports, including the time-of-day case. |
| REQ-S20-018 (A18 executable test) | The same residual, rule and runs, plus the harness's new acceptance (`matched`, or `schedule_explained` whose entries pass its own S2–S8 re-check; never `not_matched`). **Disclosed gap:** the changed harness's drill path with archive inputs has not been run. DO-D9 recorded it as BLOCKED. Its branch was checked only on quarter2's real report (no problems; a tampered copy gives the S2, S6 and S7 problems). | **IMPLEMENTED**, unchanged. The literal acceptance (clean start, restored records, files and configuration, workflows) is met by the drill reports. The harness gap is disclosed (open question 2). |
| REQ-S01-006 (transferable package) | Unaffected. The row rests on T-B11 D3, D7 and D8 and the host run, not D9, and the residual can only change D9. The rule is summarised, and DO-D9's away and quarter2 runs pass D3, D7 and D8. | **IMPLEMENTED**, unchanged. |

The A5.6 disclosure points are all in the notes:
- a scheduled job in the window is explained only as A5.2 says and is listed in the report;
- a handler that writes business rows still makes D9 FAIL, which is not a data defect;
- the recovery is to re-run the drill, never to pause a schedule.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, no Docker, no network. Logs are in `docs/delivery/handbacks/DG7/T-DG7-AN-P7H-evidence/`.

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (before the edit) | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6-before.log`) |
| `node tools/gates/validate.mjs --register DG7` (after the edit) | 0 | `PASS register rules at DG7` (`validate-register-DG7.log`) |
| `node tools/release/protocol-audit.mjs --stage DG7` (after the register edit, before this handback existed) | 1 | `FAIL (exit 1): 35 hit(s) in 3 check(s)`. **C3 handback-sections: 7 hits**, all pre-existing (AN-P7B, ARCH-R2, ARCH-R5, BE-R5, DO-A2, DO-D8, FE-C3; JSON in `protocol-audit-DG7-C3-before-handback.json`). C2 has 27 hits and C5 has 1, also pre-existing. Log: `protocol-audit-DG7.log`. |
| `node tools/release/protocol-audit.mjs --stage DG7` (after this handback) | see §3a | `protocol-audit-DG7-after.log` |
| `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint`, `pnpm test` | see §3a | `typecheck.log`, `lint.log`, `openapi-lint.log`, `pnpm-test.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see §3a | `prettier.log` |
| Integration tests and contract test on `with-pg.sh` | **NOT RUN, not applicable** | This task touched no test, code or contract. |

### 3a. Results of the later checks

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/release/protocol-audit.mjs --stage DG7` (after this handback) | 1 | Same totals: 35 hits in C2 (27), C3 (7), C5 (1), all pre-existing. This handback adds **no C3 hit**, so **C3 stays at 7**. It appears only in C5's informational `stated_in_records` list, and this run in the informational `runs-without-meta` note because it has not finished. Logs: `protocol-audit-DG7-after.log`, `protocol-audit-DG7-after.json`. |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm lint` | 0 | `lint.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` (`openapi-lint.log`) |
| `pnpm test` | **1 (BLOCKED by the sandbox, not a test failure)** | Vitest could not load its configuration: `EROFS: read-only file system, open '…/node_modules/.vite-temp/vitest.config.ts.timestamp-…mjs'`. In the analyst's sandbox `node_modules` is read-only. No test ran (`pnpm-test.log`). |
| The same three `pnpm test` commands with `--configLoader runner` (`npx vitest run --configLoader runner --project unit-node`, then `unit-web`, then `unit-formula-nocodegen`), which avoids the temp file | 1 overall | unit-node: 206 of 207 files and 3041 of 3042 tests passed. unit-web: 131 files and 2199 tests passed, exit 0. formula: 259 passed and 2 skipped, exit 0. The one failure is `tests/qa/unit/a20-p6-token-contrast.test.ts` writing `test-results/qa-a20/contrast-pairs.txt`, also `EROFS` from the sandbox (`pnpm-test-configloader-runner.log`). |
| `QA_EVIDENCE_DIR=$TMPDIR/qa-a20 npx vitest run --configLoader runner --project unit-node tests/qa/unit/a20-p6-token-contrast.test.ts` (the test's own evidence-directory variable) | 0 | 4 of 4 passed (`a20-contrast-rerun.log`) |

| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | 24 batches, all "All matched files use Prettier code style!", no `[warn]` (`prettier.log`, 10:39:09Z). It ran after this handback had all its content except this row and the end-time line. Both are re-checked alone below. |

The run ended at 10:39Z (`date -u`).

So every unit test passed somewhere, but **literal `pnpm test` did not run to completion here**. It is BLOCKED by the read-only `node_modules` and `test-results/` of the analyst sandbox. This task changed no code or test, only the register's `notes` and this handback, so no test outcome can depend on it. The orchestrator's integration run is the literal `pnpm test`.

## 4. Known gaps / not done

1. **Handover disclosure is not written by me.** The assignment forbids `docs/handover/**`, but ADR-0064 A5.6 assigns "the handover disclosure in `known-limitations.md`, the release notes and `deployment.md`'s drill section" to AN.
   - At this base, `deployment.md` line 247 already carries DO-D9's paragraph with all three A5.6 points.
   - `known-limitations.md`, `release-notes.md`, `deployment.ar-summary.md` and `known-limitations.ar-summary.md` have **no** mention (grep).
   - Until the orchestrator regenerates them, F-DG7-971's "not disclosed in any handover text" is only partly repaired.
2. **The changed A18 harness has not run end to end with an archive** (DO-D9 §3a, BLOCKED). The REQ-S20-018 note says so. QA round 6 is the independent run.
3. **Literal `pnpm test` is BLOCKED in this sandbox** (§3a). The equivalent runs with `--configLoader runner` and the contrast test re-run passed.
4. **Evidence column not extended.** The notes cite DO-D9's evidence by path, but I did not add those paths to the `evidence` column, because the assignment scopes the change to notes (open question 3).

## 5. Merge instructions

- Register notes only: no migration, no ordering constraint, no contract change.
- Merge after `2f9b873` (DO-D9), which the notes cite. A conflict is expected only if another task edits the same three rows' `notes` at the same time. In that case, re-append the "DG7 analyst pass 8" paragraph from `requirements.diff`.

## 6. Residual risks

1. Scheduled handlers that do business work in the window, engine ticks, and the pg-boss 11.0.0 timing assumptions (ADR-0064 A5.7 residuals 1–4) remain. They are disclosed in the notes, not removed.
2. The evidence cited for the rule is DO-D9's integration-tree runs, not a frozen candidate. A round-6 reviewer who shows the rule hides a non-scheduled write is D-278's re-open condition, and the three statuses would then need revisiting.
3. The notes copy DO-D9 values that I re-read from the evidence files: windows, ids, checksum prefixes and step results. Test counts (204/204) come from `deploy-tool-tests.log`. I did not re-run the drill.

## 7. Open questions (for the orchestrator)

1. **The A5.6 handover disclosure.** ADR-0064 A5.6 gives it to AN, while this assignment gives it to the orchestrator's regeneration. Please confirm that `known-limitations.md`, the release notes and the Arabic summaries will carry it, since F-DG7-971's expected result names them.
2. **REQ-S20-018 status.** I kept IMPLEMENTED because the literal acceptance concerns the environment, which the drill reports show. If the orchestrator holds that the A18 *executable test* must have run in its changed form, the row should drop until QA round 6 runs it.
3. **Evidence column.** Should DO-D9's `out-away/transfer-drill-report.json`, `out-quarter2/transfer-drill-report.json` and `out-quarter2/schedule-explained-d9.json` be added to the `evidence` column of REQ-S19-017 and REQ-S20-018?
4. **The S6/S7 latitude** (ARCH-R6 open question 1) and **engine ticks** (A5.7 residual 3) are still undecided. The notes describe the rule as ADR-0064 A5.2 states it.
