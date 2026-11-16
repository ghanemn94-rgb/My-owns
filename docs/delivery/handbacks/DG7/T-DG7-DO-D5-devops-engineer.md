# Handback T-DG7-DO-D5 (devops-engineer): make D8–D11 of the transfer drill pass

- **Stage:** P7, gate DG7 (BUILDING). The assignment cites "§B.8" of `docs/architecture/p7-work-split.md`, and that number names two sections: "B.8 Requirement → clause → test → owner" and "B.8 DO-D4" (D-261 accepted the clash). This task's own content comes from the assignment text and D-261: fixes (1)–(5), then remeasuring the lists, T-B17, T-B11 and A18.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-D5-devops-engineer-20261113T180147Z-8b052e53","session_id":"8b052e53-8b34-4bf0-bae6-7eff5ea96cd7"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-D5.md`, sha256 verified as `d77ed1cb00dc89f2a3845f8fb8dd338d6ec0f483c8fbd391528ed8113d068a5e`.
- **Base:** `3b315d77290b1c0a936a6246854d1aa917eead0a` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from my run folder. Nothing was committed.
- **Time (`date -u`, sandbox clock):** start 18:01:57Z, last stamp before this file 18:32:39Z.
- **Environment:**
  - Node v24.21.0, PostgreSQL 16.15 (disposable clusters from `tests/qa/support/with-pg.sh`), bubblewrap, uid 0;
  - offline (`MTH_PNPM_OFFLINE=1`), no Docker daemon (D-243 Q1);
  - 3575 MB free at the end (`df -Pm`). `$TMPDIR/b11` is deleted.
- **Two gate systems.** Every user, secret, origin, KPI value, adoption link, evidence note and gate decision here is SYNTHETIC. Nothing grants or implies a G1–G6, Finance or IT approval. Nothing reads or writes a DG0–DG7 record.
- **A container-free local drill is not evidence of high-availability production readiness.**

## Headline

**T-B11 is still FAIL. A blocker outside D-261's decision needs the orchestrator or architect (Q1 below).**

- **Fixes (2)–(5) work and are proven** by T-B11 attempt 2, on an archive built from HEAD `3b315d77`:
  - D5's `audit_already_present` delta is recorded, allowed, and equal to the import's count (45 = 45). It is written into `reconcile-d5.json`.
  - D8 `unbound`: `identity_unbound`, and `/me` answers 401.
  - D8 `status`: PASS.
  - D8 `downloads`: 2 of 2 files, SHA-256 equal, downloaded by the rebound uploader.
- **Fix (1) `g5.adoption_none` works through the public API.** It calls `createAdoptionMetricLink` (template `usage_activation_rate`, fed by the existing demo KPI "Attach rate / activation", same unit and polarity), then runs the KPI remedy. In T-B17 run 1, `g5.adoption_none` turned into `g5.adoption_indicator_unknown` for the new link. No demo data and no gate rule was changed.
- **The new blocker is calendar ageing of the demo data, not a product defect.**
  - The demo's last open period is 2026-08, and 2026-09 is scheduled. An actual the drill submits there has `dataAsOf` 2026-08-31.
  - With `staleAfterDays` 45, today (2026-11-13) makes it `stale` (T-B17 run 1, `getKpiStatus`: `"actualStatus":"stale","actualReason":"kpi.stale"`). So `g5.performance_kpi_not_known` ×3 and the adoption indicator can never become known on this data.
  - The product does the right thing here: stale is never green.
  - The remedy available in the API is to open the current period (`createReportingPeriod` and `openReportingPeriod`). Those are organization routes, and they need an **organization-scoped** `reporting_period.manage` grant plus `organization.read`.
  - **No seed-demo user has one.** Measured on a fresh `migrate` and `seed-demo`: the only holder is TO `01995000-1001-7000-8000-000000000001`, with `business_unit` and `transformation` scope only. T-B17 run 2 got `createReportingPeriod HTTP 404 not_found` with that user.
  - Getting past this would need either a new access grant (an ADM_ACCESS action), or demo data with current periods. Neither is covered by D-261, so I stopped and am escalating.
- D8 now stops before C1 writes anything: `D8 FAIL: no rebound user holds reporting_period.manage (the current period 2026-11 is absent)`.
- **D9–D11 NOT_RUN.**
- **T-B17 test 1 FAIL** (same cause). The D8 lists are not remeasured on the full chain.
- **The A18 harness was NOT_RUN** because there is no PASS report.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/drill/journey.mjs` | **(1)** `g5.adoption_none` added to `REMEDY_CODES`. The remedy has adoption editor A (`adoption.edit`) call `createAdoptionMetricLink` `{templateKey, targetKind: "transformation", kpiDefinitionId}` from `actors.adoptionLink`, journals `adoption_metric_link`, then runs `kpiRemedy` on that KPI. `neededActors` checks for A and the KPI user K.<br>**New `currentPeriod`:** the KPI remedy reports in the monthly period that holds today's business date (Asia/Riyadh). If that period is scheduled or missing, period manager R opens it (or creates it, then opens it) through the API, and the call is journalled.<br>**Read-only pre-check before C1:** if a KPI-type code is missing, no R exists, and the current period is not open, D8 stops before writing.<br>**(3)/(4)** New `--status-user` and `--download-user` options. These steps sign in that user in its own session (journalled like the other actors). The header documents both. |
| `deploy/scripts/drill/pick-actors.sql` | New keys:<br>• `adoptionEditor`: an `adoption.edit` holder on the chosen transformation;<br>• `adoptionLink`: the first KPI-fed template, by indicator and measure ordinal, whose `unit_kind` and `polarity` match an active KPI with a K and which has no active link on the transformation yet;<br>• `periodManager`: a rebound user with an **organization-scoped** `reporting_period.manage` grant and `organization.read`. |
| `deploy/scripts/transfer-drill.sh` | **(5) D5:** after mode 1, it reads the latest recheck's `audit_event`/`audit_already_present` delta. The delta must be allowed and its `rows_changed` must equal `migration_import.audit_already_present_rows`. The result goes into `reconcile-d5.json` (`auditAlreadyPresent`) and `reconcile-d5-delta.txt`.<br>**(2) D6:** the user left unmapped is the last carried user with 1 identity, `active` status and an e-mail no other active user shares, because the callback can answer `identity_unbound` only through the e-mail (`oidc.ts` `resolveOidcUser` step 2). Otherwise D6 fails with a reason.<br>**(4) `downloads()`:** picks the single rebound uploader (`evidence.created_by`, checked against `mapping.csv`) and writes `download-user.id`. D8 and D9 pass `--download-user`.<br>**(3) D8:** passes `--expect-origin "$ORIGIN_T"`, `--expect-environment "$(env_kind)"` (new helper reading the package's `sourceEnvironment`) and `--status-user` (the D7 admin). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D5-evidence/*` | Logs, T-B17 measurements (runs 1–3), T-B11 attempts 1–2 (`t-b11-attempt1.log` and `transfer-attempt1/`; attempt 2 is `t-b11-run.log` and `transfer/`), and the driver `t-b11-driver.sh` (DO-D4's, with the evidence path changed). |

No migration, contract, permission or product-code change. `apps/api/test/support/p7-pending*.ts` has no entry for this task, so none were removed. `transfer-drill.test.mjs` is unchanged: T-B17 and T-B18 already cover the new code paths through `runJourney` and `pick-actors.sql`.

## 2. Behaviour per requirement

| Requirement / clause | Test | Status |
| --- | --- | --- |
| D-261 (1) `g5.adoption_none` through the public API | T-B17 run 1 | **Remedy PASS** (link created, the code moves on to `adoption_indicator_unknown`). The chain then stops on stale KPIs (Q1). |
| D-261 (2) unbound user chosen consistently; `identity_unbound` | T-B11 D6, D8 | **PASS:** `01920000-0000-7000-9000-000000000205` refused `identity_unbound`, `/me` 401 |
| D-261 (3) D8 `status` with the D7 expectations | T-B11 D8 | **PASS:** origin `http://127.0.0.1:25302`, environmentKind `demo` |
| D-261 (4) downloads by an actor who can read the transformation | T-B11 D8 | **PASS:** 2 of 2, SHA-256 equal, by the rebound uploader `01920000-0000-7000-9000-000000000202` |
| D-261 (5) `audit_already_present` delta in `reconcile-d5.json` | T-B11 D5 | **PASS:** `45 t 45` (rows changed, allowed, import rows) |
| REQ-S19-017 "successful key workflows" | T-B11 D8 (b)–(d), T-B17 | **FAIL:** Q1 |
| REQ-S19-017 "records, jobs and approvals intact after a full restart" | T-B11 D9 | **NOT_RUN** |
| REQ-S01-006 "different base URL" | T-B11 D7, D10 | D7 **PASS**; D10 **NOT_RUN** |
| REQ-S01-001, REQ-S19-009, REQ-S19-010 | T-B11 D0, D3, D7 | **PASS** (attempt 2) |
| REQ-S20-018 A18 harness | `tests/qa/integration/a18-transfer-drill.test.ts` | **NOT_RUN** (no PASS report) |

## 3. Checks run (real exit codes)

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (**first**) | **0** | `PASS gate DG6 (historical)`, `validate-historical-DG6-before.log` |
| `MTH_DRILL_D8_MEASURE_OUT=… tests/qa/support/with-pg.sh node --test --test-name-pattern='T-B17' deploy/scripts/tests/transfer-drill.test.mjs`, run 1 | 1 | `t-b17-run1.log`: the adoption link was made, then the KPIs were stale |
| same, run 2 | 1 | `createReportingPeriod HTTP 404 not_found` (R had only a transformation or business-unit grant) |
| same, run 3 | 1 | `no rebound user holds reporting_period.manage`. Mode 2: PASS. Negative case exit 4: PASS. T-B18: PASS. |
| `tests/qa/support/with-pg.sh bash …/t-b11-driver.sh`, attempt 1 | 1 | D5: my own bug, `invalid input syntax for type bigint: "null"` (`coalesce` on a bigint). Fixed with `::text`. |
| **T-B11 attempt 2:** same command | **1** | • archive `mth-transformation-hub-0.1.0-8a5c135e5a67.tar.gz`: 14 359 351 bytes, sha256 `ff2f083b37a03829dc14cc9fd5669d5b4adc8d1269da5fc06f4fe182af6789c2`, candidate `sha256:8a5c135e5a67…5b40`, commit `3b315d77`;<br>• demo export manifest sha256 `54c07957…a2cf`, 335 tables;<br>• probe `ENETUNREACH`/`EAI_AGAIN`;<br>• D0 160.1 s, D1 10.4, D2 1.7, D3 0.3, D4 5.6, D5 10.3 (4997 rows in 335 tables, 2 attachments; 45 already-present events), D6 2.7 (13 rebound), D7 2.0: **all PASS**;<br>• **D8 FAIL**; D9–D11 NOT_RUN;<br>• the drill took 198 s.<br>The archive's `source/` is HEAD. As in DO-D2–D4, the drill scripts ran from the working tree. |
| `tests/qa/support/with-pg.sh node --test --test-reporter=spec deploy/scripts/tests/transfer-drill.test.mjs` | **1** | 41 tests: 40 pass, 1 fail (T-B17 test 1, Q1). `transfer-drill-test-final.log` |
| `npx eslint deploy/scripts/drill deploy/scripts/tests/transfer-drill.test.mjs` | **0** | `eslint-own.log` |
| `npx prettier --check` on the drill files | **0** | `prettier-own.log` |
| `bash -n deploy/scripts/transfer-drill.sh` | **0** | after each edit |
| `pnpm -r typecheck` | **0** | 190 s, `typecheck.log` |
| `pnpm lint` | **0** | 37 s, `lint.log` |
| `pnpm openapi:lint` | **0** | `openapi-lint.log` |
| `pnpm test` | **0** | 309 s, `pnpm-test.log` |
| repository-wide prettier, and `validate.mjs --historical --stage DG6` (end) | see `final-exits.log` | run after this file was written |

I did not run the vitest integration tests or the contract test, because I changed no product code or contract.

## 4. Known gaps / not done

1. **T-B11 is not PASS.** D8 `writes`, `approve` and `deeplink` fail, and D9–D11 are NOT_RUN (Q1). `deeplink` fails only because no submission was made.
2. **T-B17 test 1 fails.** `D8_TOUCHED_*` are still DO-D4's partial-chain lists, not remeasured on the full chain.
3. **The `currentPeriod` remedy has never reached a 2xx.** Run 2 hit 404 with a user who lacked organization scope. `openReportingPeriod`, `createReportingPeriod` and the later steps (C2–C6) have never run against the real API.
4. **A18 harness not run.**
5. Driver cosmetic issue: the `rows` line in `t-b11-run.log` concatenates strings instead of summing them (DO-D4's driver). The real counts come from the import line.

## 5. Open questions and merge instructions

- **Q1 (orchestrator/architect): stale demo KPIs.** Choices:
  - (a) Let D8 grant an organization-scoped TO through `createScopedAssignment`, made by a rebound ADM_ACCESS holder. That is an access change by the drill, and it may raise separation-of-duty questions.
  - (b) Allow the demo seed to carry periods relative to the seeding date. That changes demo data.
  - (c) Choose another gate whose criteria do not depend on fresh KPIs.

  The code for (a) is ready apart from the grant: `currentPeriod` and `periodManager`. Today's date decides the result, so any choice should be measured again.
- **Q2:** D-261 decided only the adoption configuration. Please confirm that opening the current reporting period through the API (as an operator does each month) is acceptable under the same reasoning.
- **Merge:**
  - No migration and no contract change.
  - `journey.mjs` gains `--status-user` and `--download-user`, and `pick-actors.sql` gains `adoptionEditor`, `adoptionLink` and `periodManager`. Both are backward compatible.
  - The CI fragment is unchanged. It still fails on T-B17 test 1 until Q1 is settled.
