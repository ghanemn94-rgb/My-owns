# Handback T-DG7-DO-D6 (devops-engineer): finish D8–D11 of the transfer drill

- **Stage:** P7, gate DG7 (BUILDING). The assignment names §B.8 of `docs/architecture/p7-work-split.md`. The work split has no DO-D6 section, so this task's content comes from the assignment text, D-262 and the rules of "B.8 DO-D4" (the numbering clash was accepted in D-261).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-D6-devops-engineer-20261113T183824Z-3857827a","session_id":"3857827a-73fb-47a3-a433-057e4151438d"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-D6.md`, sha256 verified as `8afb6c11ec5138d50d946a6e1307b85477526c62f1159e8857c5d321bb23a3e7`.
- **Base:** `07c3db04b2b86b935d31c61fcf4281bea0c7bae8` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from my run folder. Nothing was committed.
- **Time (`date -u`, sandbox clock):** start 18:38:33Z, last stamp before this file 19:01:05Z.
- **Environment:**
  - Node v24.21.0;
  - PostgreSQL 16.15, as disposable clusters from `tests/qa/support/with-pg.sh`;
  - bubblewrap, uid 0;
  - offline (`MTH_PNPM_OFFLINE=1`), no Docker daemon (D-243 Q1);
  - about 3568 MB free (`df -Pm`). `$TMPDIR/b11` and `$TMPDIR/diag` are deleted.
- **Two gate systems.** Every user, grant, secret, origin, KPI value, evidence note and gate decision here is SYNTHETIC. Nothing grants or implies a G1–G6, Finance or IT approval. Nothing reads or writes a DG0–DG7 record.
- **A container-free local drill is not evidence of high-availability production readiness.**

## Headline

**BLOCKED on D-262's precondition. T-B11 is FAIL at D8, and T-B17 test 1 fails. The orchestrator or architect has to decide (Q1).**

- **D-262 (a) cannot be done on the shipped demo data without a product authorization change.** That is the escalation case D-262 itself records ("The grant requires changing product authorization rules (escalate)").
  - `createRoleAssignment` at **organization** scope needs `access.assign` that applies to an organization target.
  - `apps/api/src/modules/access/rules.ts` `grantApplies` (l.70–86) never lets a `business_unit` grant act on an `organization` target.
  - Measured on a fresh `migrate` and `seed-demo`: the demo organization `SYN-ROAMING` (`01995000-0000-7000-8000-000000000002`) has one `ADM_ACCESS` grant, held by `01995000-1001-7000-8000-000000000003` at **business-unit** scope `01995000-0000-7000-8000-000000000003`.
  - The seed-dev administrator `01920000-0000-7000-9000-000000000201` holds `ADM_ACCESS` at organization scope, but of `SYN-DEV`, a different organization.
  - So no rebound user can make the grant, and I did not work around it. No demo data change, no rule change, no direct database write in the drill.
- **The grant step is implemented and works once a qualified grantor exists.** A **diagnostic run, not T-B17 and not committed**, added one synthetic organization-scoped `ADM_ACCESS` grant to its own throwaway fixture. On that fixture the whole A3.6 chain C0–C6 passed on the real API:
  - `createRoleAssignment` 201, `createReportingPeriod`, `openReportingPeriod`;
  - 3 × `submitKpiActual`, accepted in period 2026-11;
  - `createEvidence`, `reviewEvidence`, `linkPhaseStepEvidence`, `createAdoptionMetricLink`, `recordExecutiveDecisionOutcome`;
  - `submitGate`, then `decideGate` (`deferred`, a SYNTHETIC decision);
  - a 30 s worker wait, then 3 KPI evaluations read.

  This is the first time the period routes and C2–C6 reached a 2xx (DO-D5 gap 3).
- **The same diagnostic shows mode 2 gaps on the full chain** (Q2). Even with correct lists, `automation_execution` and `automation_action_result` rows and worker-written `kpi_evaluation` rows are unexplained. I did not hand-edit any list, as B.8 DO-D4 requires.
- **T-B11** used an archive built from HEAD `07c3db04`. D0–D7 PASS. D8 `writes` stops before writing anything, with the new line: `D8 FAIL: no rebound user holds reporting_period.manage (the current period 2026-11 is absent), and no rebound user holds access.assign at organization scope to grant it (D-262)`. D9–D11 are NOT_RUN.
- **The A18 harness was NOT_RUN**, because there is no PASS report.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/drill/pick-actors.sql` | New keys:<br>• `accessAdmin` (G): a rebound user holding `access.assign` through an **organization-scoped** grant on the transformation's organization;<br>• `periodGrantee`: the first rebound `reporting_period.manage` holder on the transformation (any scope), never G, else the KPI user K.<br>The header documents both, with the `grantApplies` reason. |
| `deploy/scripts/drill/journey.mjs` | **New `grantPeriodManager`:** when `periodManager` is null, G calls `createRoleAssignment` `{userId: periodGrantee, roleCode: "TO", scope: {type: "organization", id: <org>}, reason: "SYNTHETIC transfer drill D8: …approves nothing"}` (201 expected). The product audits it as `scoped_assignment.create`, and the grantee then signs in as R.<br>**The grant is recorded** in the journal file's new `grants` array (assignment id, grantor, grantee, role, scope) and in the journey summary's `grants`. It is not an allowance key: `scoped_assignment` is a D8 child table, and `buildAllowance` rejects journal keys for child tables. Its parent `app_user` is explained because the grantee signs in.<br>**Pre-check before C1:** it fails only when there is neither R nor a usable G/grantee pair, and the line now names the missing organization-scope `access.assign` (D-262). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D6-evidence/*` | The logs listed in §3; the T-B17 measurement; the diagnostic measurement; T-B11 (`t-b11-run.log`, `transfer/`); the driver `t-b11-driver.sh` (DO-D5's, with the evidence path changed). |

- No change to: migrations, the contract, permissions, product code, demo data, `transfer-drill.sh`, `allowance.mjs` lists or `transfer-drill.test.mjs`.
- `apps/api/test/support/p7-pending*.ts` has no entry for this task, so none were removed.
- No new mutation endpoint: the drill calls the existing `createRoleAssignment`, whose authorization, validation, audit and tests already exist.

## 2. Behaviour per requirement

| Requirement / clause | Test | Status |
| --- | --- | --- |
| D-262 (a): organization-wide role granted through the API, audited and journalled | T-B17; diagnostic | **Implemented. BLOCKED on the shipped data** (no organization-scope grantor). On a diagnostic fixture: **201**, and the grant is recorded in `grants`. |
| D-262: current period opened through the API by a permitted actor | diagnostic | **Works** (create, then open, period 2026-11), but only on the diagnostic fixture |
| REQ-S19-017 "successful key workflows" | T-B11 D8 (b)–(d); T-B17 | **FAIL** (Q1). The diagnostic shows C0–C6 pass when a grantor exists. |
| REQ-S19-017 "working evidence downloads under the new base URL" | T-B11 D8 (a) | **PASS:** 2 of 2, SHA-256 equal, by `01920000-0000-7000-9000-000000000202` |
| REQ-S19-017 "rebind identity" | T-B11 D6, D8 `unbound` | **PASS:** `01920000-0000-7000-9000-000000000205` refused with `identity_unbound`, `/me` 401 |
| REQ-S19-017 "records, jobs and approvals intact after a full restart" | T-B11 D9 | **NOT_RUN** |
| REQ-S01-006 "different base URL" | T-B11 D7 | D7 **PASS** (origin `http://127.0.0.1:25302`, environmentKind `demo`); D10 **NOT_RUN** |
| REQ-S01-006 "runs key workflows with outbound public internet disabled" | T-B11 probe | Probe **PASS:** `ENETUNREACH`, `EAI_AGAIN`. D8 key workflows: FAIL (Q1). |
| REQ-S01-001, REQ-S19-009, REQ-S19-010, REQ-S20-018 "clean environment starts" | T-B11 D0, D3, D7 | **PASS** |
| REQ-S20-018 A18 harness | `tests/qa/integration/a18-transfer-drill.test.ts` | **NOT_RUN** (no PASS report) |

## 3. Checks run (real exit codes)

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6`, **first** | **0** | `PASS gate DG6 (historical)`: `validate-historical-DG6-before.log` |
| `npx eslint deploy/scripts/drill deploy/scripts/tests/transfer-drill.test.mjs` | **0** | `eslint-own.log` |
| `npx prettier --check --ignore-unknown` on the two changed files | **0** | `prettier-own.log` |
| Probe: `with-pg.sh`, `migrate` and `seed-demo` on a scratch database, then query the `ADM_ACCESS`/`TO` grants | 0 | The three grants quoted in the Headline (not saved as a log; the query is in the Headline) |
| `MTH_DRILL_D8_MEASURE_OUT=… tests/qa/support/with-pg.sh node --test --test-reporter=spec --test-name-pattern='T-B17' deploy/scripts/tests/transfer-drill.test.mjs` | **1** | 56 s. 4 tests: 3 pass, 1 fail. Test 1 fails: `accessAdmin: null`, and D8 stops at the pre-check with `writes: []` (nothing written). Mode 2 exit 0 PASS; exit 4 PASS; T-B18 PASS. Logs: `t-b17-run1.log`, `t-b17-measurement.json`. |
| **Diagnostic (not T-B17):** a throwaway copy of the test file in `$TMPDIR/diag`, with one fixture-only SYNTHETIC `INSERT` of an organization-scoped `ADM_ACCESS` grant for `01995000-1001-7000-8000-000000000003` after the rebind; same command | **1** | 61 s. The journey is **PASS** (C0–C6). The list assertion and both mode 2 cases fail (Q2). Logs: `diag-org-admin-run1.log`, `diag-org-admin-measurement.json`. The copy is deleted. |
| T-B11: `tests/qa/support/with-pg.sh bash docs/delivery/handbacks/DG7/T-DG7-DO-D6-evidence/t-b11-driver.sh` | **1** | See below. Log: `t-b11-run.log`, report: `transfer/transfer-drill-report.json`. |
| `tests/qa/support/with-pg.sh node --test --test-reporter=spec deploy/scripts/tests/transfer-drill.test.mjs` | **1** | 89 s. 41 tests: 40 pass, 1 fail (T-B17 test 1, Q1). `transfer-drill-test-final.log` |
| `pnpm -r typecheck` | **0** | 181 s, `typecheck.log` |
| `pnpm lint` | **0** | 36 s, `lint.log` |
| `pnpm openapi:lint` | **0** | `openapi-lint.log` |
| `pnpm test` | **0** | 307 s, `pnpm-test.log` |
| Repository-wide prettier; `validate.mjs --historical --stage DG6` at the end | see `final-exits.log` | Run after this file was written |

**T-B11 details:**
- archive `mth-transformation-hub-0.1.0-abc6c897ed68.tar.gz`: 14 367 137 bytes, sha256 `c2a81a1a2d895717bb78a48b129ab1c77c08c8376b1c01ca16416d22925f60e5`, candidate `sha256:abc6c897ed68940494c1e95d1cdcfa24a434b3999c3f670920664bac27af460b`, commit `07c3db04`;
- demo export manifest sha256 `2dee5960…7fc79`;
- drill package: 335 tables, 4995 rows, 2 attachments;
- probe: `ENETUNREACH`/`EAI_AGAIN`;
- step times: D0 162.9 s, D1 10.4, D2 1.7, D3 0.4, D4 6.0, D5 10.6 (import matched; 15 users await rebind), D6 2.9, D7 2.0. **All PASS.**
- **D8 FAIL** (pre-check line above), with `signin`, `unbound`, `csrf`, `status` and `downloads` PASS. D9–D11 NOT_RUN.
- the drill took 202 s.
- The archive's `source/` is HEAD. As in DO-D2–D5, the drill scripts ran from the working tree, which holds this task's uncommitted changes.

I did not run the vitest integration tests or the contract test, because I changed no product code or contract.

## 4. Known gaps / not done

1. **T-B11 is not PASS.** D8 `writes`, `approve` and `deeplink` fail (Q1), and D9–D11 are NOT_RUN.
2. **T-B17 test 1 fails.** `D8_TOUCHED_*` are still DO-D4's partial-chain lists. They are not remeasured, because T-B17's real chain cannot run (Q1). The diagnostic measurement is on altered fixture data, so I did not use it to change the lists.
3. **A18 harness: NOT_RUN.**
4. **There is no dedicated unit test of the grant path.** It is exercised by the diagnostic only. Once Q1 is settled, T-B17 exercises it on the real chain.
5. **The work split has no DO-D6 section,** so this task followed the assignment, D-262 and B.8 DO-D4.

## 5. Open questions and merge instructions

### Q1 (orchestrator/architect): no organization-scope grantor in the demo data

Choices:
- (a′) The demo seed gets an organization-scoped `ADM_ACCESS`, or an organization-scoped `TO`. This is a demo data change, which D-262 excludes.
- (b) Option (b) of D-262: date-relative demo periods.
- (c) A product rule letting a business-unit `access.assign` grant at organization scope. This is an authorization change, and I do not recommend it.
- (d) Another gate.

The drill code is ready for (a′): the pre-check and `grantPeriodManager` take any rebound organization-scope `access.assign` holder. With (a′), only `pick-actors.sql` decides who acts.

### Q2: mode 2 gaps on the full chain (diagnostic fixture, with the current lists)

These hold whatever list values T-B17 later measures:
- `automation_execution`: 16 added against 14 explaining events, with 9 keys unexplained.
- `automation_action_result`: 16 added against 7 events.
- `kpi_evaluation`: 3 worker-written rows "unexpected added". They are journalled-table rows that the API never returned.

The candidate list additions from that run are:
- audited: `data_quality_finding`;
- non-audited: `kpi_actual_value`, `kpi_actual_review`, `gate_submission_criterion`, `corrective_signal`;
- `record_code_counter`: added 1, changed 1.

The automation and `kpi_evaluation` rows look like A3.9 residual-type rows (worker or automation writes). The B.8 DO-D4 rules forbid explaining them by hand, so the orchestrator must decide.

### Merge

- No migration and no contract change.
- `pick-actors.sql` gains `accessAdmin` and `periodGrantee`. `journey.mjs` gains `grantPeriodManager`, plus the `grants` arrays in the journal and the summary. All are backward compatible: `allowance.mjs` reads only `entries`.
- The CI fragment is unchanged. It still fails on T-B17 test 1 until Q1 is settled.
