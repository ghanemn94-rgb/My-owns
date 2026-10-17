# Handback T-DG5-QA-E: executable acceptance suites A02 and A21 (qa-verifier, authoring)

- **Run:** `DG5-T-DG5-QA-E-qa-verifier-20261017T060319Z-83b518e4` (session `83b518e4-5261-46bd-8253-6e23d9eabd81`).
- **Tree:** worktree `dg5/qa-e` at `bed361972afeebcb91ea8bfd0064e4622c1d2540` (integrated HEAD). The assignment file's SHA-256 is `7de9b1e4…5b920`, which matches.
- **Time:** start `2026-10-17T06:03:36Z`, end `07:00:02Z` (about 57 min).
- **Kind:** authoring task, not the DG5 gate review. No review record was written.
- **Product source:** unchanged. Every change is new, uncommitted files under `tests/qa/**`, root `e2e/**` and this folder.
- **Synthetic data:** everything is synthetic. Every G1–G6 decision, Finance validation and executive decision in the suites is a synthetic in-product decision on test data that approves nothing real. Nothing names DG0–DG7 in product text.

## 1. Files written

| File | What |
|---|---|
| `tests/qa/support/a02.ts` | `FakeDemoIdp`: a stand-in for the **external** demo IdP. It overrides only `OidcService.prepareLogin` (no discovery) and `exchange` (returns `iss = DEMO_IDP_ISSUER`, `sub = roaming.user.<role>`). These product paths run unchanged: `GET /auth/login`, `GET /auth/callback`, the login state, the browser-binding cookie, user resolution by issuer and subject, and the session. Also `demoSignIn` and `grantedActor`, which grants roles through `POST /role-assignments`. |
| `tests/qa/integration/a02-a21-complete-lifecycle.test.ts` | 13 tests. Real API (Fastify inject, every response contract-checked) on a scratch database of the disposable cluster, migrated and seeded with the **real** demo dataset (`seedDemo`, International Roaming), with `MTH_ENV=demo`. |
| `e2e/support/with-demo-stack.sh` | A mirror of `apps/web/e2e/support/with-stack.sh`. Differences: `mth-db seed-demo` runs before `seed-dev`, and the API runs with `MTH_ENV=demo`. `apps/web/e2e/support/**` is not changed. |
| `e2e/a02-guided-walkthrough.spec.ts` | A02's user-visible path: step 1 in the native create form, Help > Guided walkthrough, the synthetic banner and axe. |
| `e2e/a21-no-ai-operation.spec.ts` | A21's user-visible path: a report generated in the UI with no AI, external-notification or export channel, and no request leaving the origin. |
| `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-E-authoring/**` | Logs, mutation evidence, screenshots (en and ar) and this handback. |

## 2. Checks (real exit codes)

| # | Command | Exit | Result |
|---|---|---|---|
| 6a | `node tools/gates/validate.mjs --historical --stage DG4` (start, 06:03Z) | 0 | `PASS gate DG4 (historical)` |
| 1 | `QA_PG_PORT=23650 MTH_PORT_POOL=23651-23669 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | **1** | 24 files, **274 passed, 2 failed**. The 2 failures are the two tests kept failing on purpose because they expose product defects D-QA-E-1 and D-QA-E-2 (§5). Log: `integration-tests-qa-full.log`. |
| 2 | `E2E_PG_PORT=23670 E2E_API_PORT=23680 MTH_PORT_POOL=23681-23699 e2e/support/with-demo-stack.sh npx playwright test e2e/a02-guided-walkthrough.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1` | 0 | **4/4 passed** (2 specs × chromium-en and chromium-ar). axe reports 0 serious or critical issues on the walkthrough and snapshot pages, through the shared `expectAccessible`, which fails on any. No timeouts. Logs: `e2e-final.log`, plus the earlier identical runs `e2e-a02-a21-demo-stack.log` and `e2e-a02-first-run.log`. |
| 3a | `pnpm lint` | 0 | `lint.log` |
| 3b | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.log`) |
| 5 | Mutation runs, 7 runs (§4) | 1 each | Every mutation is detected. |
| 6b | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `validate-dg4-end.log` |

**Per-file counts of run 1:**
- a02-a21-complete-lifecycle: 13 (11 passed, 2 failed, both intended)
- a06: 27
- a08: 31
- a09: 17
- a10: 16
- a05: 17
- a11-bau-sustain: 17
- a11-adoption: 12
- a16-health-check: 13
- a11-value-closure: 11
- a04-kpi-propagation: 8
- a16-launch-plan: 11
- a15-snapshots-and-packs: 15
- a03: 12
- a04-a05-a10-partials: 4
- a15-outputs-every-definition: 5
- a15-demo-transformation-outputs: 7
- a12: 14
- a13: 5
- a02-a08: 1
- a15-selected-records: 7
- a14: 5
- a16-s16-021: 6
- a01: 2

**Disclosures:**
- Load: heavy commands ran one at a time. The single-file integration run was repeated during authoring; those intermediate logs are not cited, except `integration-run6-bo-baseline-403.log` (O-2) and `integration-intake-unrouted-debug.log` (D-QA-E-2).
- Clean-up: before the runs there were no empty `.claude/.cc-writes` directories.
- Disk: 7.9 GB free throughout.

## 3. Requirement → test

In the table, "file" is `tests/qa/integration/a02-a21-complete-lifecycle.test.ts`.

| Row | Acceptance (binding text) | Proven by | Status |
|---|---|---|---|
| REQ-S20-002 | A02: authorized users complete the guided end-to-end scenario using only native workflows | file › "each step is false before its native workflow and true after it; all twelve end completed on persisted records" (detail below). e2e `a02-guided-walkthrough.spec.ts` (en and ar). | **PASS** |
| REQ-S18-004 | an e2e test performs all twelve walkthrough steps **with the demo role users** and verifies the resulting records | **(a)** The twelve steps run on one transformation, records verified: file, the lifecycle test (API level); in e2e, steps 1 and 10 in the UI on a demo stack. **(b)** The demo role users: all 8 `roaming.user.<role>` sign in through the demo-IdP path (PASS), but the demo TL cannot perform step 1 (**FAIL, D-QA-E-1**). **(c)** In a browser, demo role users cannot sign in without a demo IdP (**BLOCKED**, §6). | **FAIL** (D-QA-E-1), partly BLOCKED |
| REQ-S01-003 | the guided scenario passes through input, validation, approval, output, monitoring, correction and sustainment on persisted records | file › "REQ-S01-003: the chain …" (detail below) | **PASS** for the guided-scenario clause. The A01 clause (the coverage view) is NOT COVERED here: it belongs to A01, DG6. |
| REQ-S01-004 | A02 completes with exports, email and AI channels disabled; no workflow step's completion condition references an uploaded spreadsheet, deck or email | file › "the A02 scenario completed with no export job, no e-mail notification and no AI call" and "no published procedure step's completion condition references …" (detail below). e2e `a21-no-ai-operation.spec.ts`. | **PASS**, with O-3 |
| REQ-S06-002 | a baseline-validation instance shows its current step and assignee; completing it creates a validated baseline record linked to the instance | file › "a baseline-validation instance …" (detail below) | **PASS**, with O-2 |
| REQ-S06-003 | the ten procedures exist after initialization and each can be launched and completed in the A02 scenario | file › "the ten procedures exist" (PASS). "each … can be launched" (10/10 PASS). "drives every instance … every one ends completed": **9/10 completed**. `new_transformation_intake` cannot complete. | **FAIL** (D-QA-E-2) |
| REQ-S09-011 | the executive pack's workstream section contains the submitted update text and current metrics without manual editing | file › "the generated pack contains the workstream lead's update text and the current canonical metrics" (detail below) | **PASS** |
| REQ-S18-002 | a seed-coverage test finds ≥1 record for each of T01–T16, G1–G6, six phases, ten TOM dimensions, six dashboard areas, plus stale KPI, overdue decision, shared benefit, adoption gap, BAU handover, missing evidence, pending approval | file › "REQ-S18-002: … coverage …" (detail below) | **PASS** |
| A21 (the scenario) | core lifecycle, approvals, calculations and reports still work with AI and external notification channels disabled | the A02 lifecycle in the file (G1–G4 approvals, Finance decision, KPI actuals, the executive pack) on a server with no AI, e-mail or export adapter. e2e `a21-no-ai-operation.spec.ts`. | **PASS** within P5 scope (O-3) |

**REQ-S20-002, the lifecycle test.** One transformation goes through steps 1–12 in M0349 order. Each step works like this:
- `GET /demo/walkthrough` shows the step as false before it;
- the native API workflow runs, with the role that performs it;
- the step reads true after it, and every earlier step stays true;
- `completedCount` ends 12/12.

No fixture staging is used. G1–G4 are passed natively: missing criteria are covered by accepted exceptions, the Lead submits and the Sponsor approves. The other records:
- the Finance baseline validation;
- an outcome and KPI with their T02 link;
- a TOM target cell and a gap;
- an initiative score;
- a workstream update and a completed training record;
- a KPI actual;
- a benefit measured, submitted and approved by Finance;
- an executive decision recorded as decided;
- the executive pack;
- the BAU handover, submitted and accepted;
- a KPI actual after the acceptance.

**REQ-S01-003, the chain test.** Database state is asserted for each link:
- the baseline is `validated`;
- the four `approved` gate decisions G1–G4;
- the generated `report_snapshot`;
- two submitted or accepted KPI actuals, the second after `accepted_at`;
- the validated measurement and the approved Finance validation, with `approved_amount` = 240000 as a decimal string;
- a corrective-action case opened through `POST …/corrective-actions`;
- the handover accepted by the receiving owner.

**REQ-S01-004, the two A21 tests.**
- After the scenario, `export_job` holds 0 rows, and no notification exists on any channel other than `in_app`.
- Every published procedure definition is scanned from `GET /procedure-definitions`: completion rule and texts (en and ar), step conditions, required input keys, output record types and required file inputs, against spreadsheet, deck and e-mail terms. 0 hits.

**REQ-S06-002, the baseline-validation test.**
- After launch, the instance shows `currentStepKeys = ["record_baseline"]`, an active step assigned to role BO, and `nextAction` naming that step.
- Completing the step without evidence gives 422 `procedure_step.evidence_required`, and without the record 422 `output_required`.
- The step completes with the natively recorded baseline. That baseline is then linked as `output`.
- The next step is `validate_baseline`, assigned to FIN. Completing it before Finance validates gives 422; after Finance validates, the instance is `completed`.
- The linked baseline row is `validated`, with `value` 12.50.

**REQ-S09-011, the executive-pack test.** `executive_pack` is generated from the records.
- Section `update_ws_01` contains the workstream lead's achievements text verbatim and is not `no_update_submitted`.
- `metrics_ws_01` lists the six T10 RAG areas.
- The pack's value headlines equal `GET …/dashboard?periodId=` for the same period, compared key by key and including `value_validated_top_line_sar`.

**REQ-S18-002, the coverage test.** `GET /admin/environment` returns `latestRun.coverage`. All 53 listed condition keys are ≥ 1:
- `template.t01–t16`, `gate.g1–g6`, `phase.1–6`, `tom.dimension_01–10` and `dashboard.area_1–6`;
- `kpi.stale`, `decision.overdue`, `benefit.shared`, `adoption.gap`, `bau.handover`, `evidence.missing` and `approval.pending`.

`coverageComplete` is true. Independent SQL agrees: the roaming transformation has gate instances G1–G6, 10 distinct TOM dimension cells and at least one BAU handover.

## 4. Mutation checks

All runs used a disposable `git clone` in `$TMPDIR` at `bed3619`, with `node_modules` symlinked. The test file is the final version. Each mutation changed one product line in the clone only, and the clone was deleted afterwards. The runner script is `mutations/mutate.sh`; the diffs are `mutations/M*.log.diff`, the logs `mutations/M*.log` and the summary `mutations/summary.txt`.

| ID | Scenario | Mutation (clone only) | Expected killer | Result |
|---|---|---|---|---|
| M0 | — | none (baseline in the clone) | — | 11 passed and 2 failed: the same as the tree |
| M1 | A02 / S18-004 | walkthrough `benefit_validated` predicate always false | lifecycle: "validate_benefit after its workflow: expected false to be true" | **killed** (8 failed: the lifecycle and its dependants) |
| M2 | A02 / S18-004 | step 1 rule ignores `demo_seed_record` | "the seeded roaming transformation is not 'created in this demo database'" | **killed** (9 failed: that test, and the lifecycle's step-1 "false before" check) |
| M3 | A02 / S09-011 | the pack's `achievements` replaced by "Edited by hand" | S09-011 test ("expected … to contain 'Synthetic QA A02: launched …'") | **killed** (only that test plus the 2 intended failures) |
| M4 | **A21** / S01-004 | procedure completion text gains "Upload the signed spreadsheet." | the A21 completion-condition scan | **killed** |
| M5 | A02 / S18-002 | API reports `kpi.stale: 0` | the coverage test | **killed** |
| M6 | A02 / S06-002 | the baseline output adapter advances without Finance validation | baseline-validation test (the "before Finance validated" 422 check) | **killed** |

## 5. Product defects found (tests kept failing; not worked around)

### D-QA-E-1: demo role users cannot perform walkthrough step 1

- **Proposed severity:** High. It blocks REQ-S18-004's acceptance, "with the demo role users".
- **Request:** `roaming.user.tl`, signed in through the demo-IdP path (callback 302 to `/`, `GET /me` 200), sends `POST /api/v1/transformations` with body `{"businessUnitId":"01995000-0000-7000-8000-000000000003","name":"Synthetic QA A02 demo-user transformation","mode":"end_to_end"}`.
- **Response:** `404 {"type":"urn:mth:problem:not-found","title":"Not found","status":404,"code":"not_found",…}`.
- **Cause:** `packages/db/src/demo/data/roaming.ts` `seedFoundation` gives every demo user only a `scope_type = 'transformation'` grant on the seeded roaming transformation. No demo user holds `transformation.create` on the business unit or organization. There is also no demo access administrator to grant roles on a new transformation.
- **Effect:** step 1, which must be a non-seeded transformation (ADR-0050 §7), and so steps 2–12 on it, cannot be done by the demo role users.
- **Test:** `a02-a21-complete-lifecycle.test.ts` › "step 1 'create transformation' is performed by the demo Transformation Lead in the demo business unit".

### D-QA-E-2: `new_transformation_intake` can never complete

- **Proposed severity:** Medium. REQ-S06-003, "each can be launched and completed", fails for 1 of 10.
- **What happens:** the instance is launched by TO at organization scope and its first two steps are done:
  - `capture_intake` produces a new transformation through `POST /transformations`;
  - `draft_charter` links its charter through `POST …/charter`.
- **Where it stops:** the next step, `confirm_sponsor` (approval, SP), stays `active` with `approvalId: null`, and `nextAction.messageKey` = `procedures.next_action.await_approval_unrouted`. Exact instance read (`integration-intake-unrouted-debug.log`): `{"stepKey":"confirm_sponsor","stepKind":"approval","status":"active","assigneeRoleCode":"SP","approvalId":null,…}; transformationId null`.
- **Cause:** `apps/api/src/modules/procedures/steps.ts:651`, in `requestStepApproval`, returns without requesting an approval when `step.transformation_id === null`. The step rows of an organization-scope instance keep `transformation_id` null even after `capture_intake` produced the transformation. The code comment cites a BE-G handback item.
- **Test:** › "drives every instance through its steps …" (the other 9 complete).

### Observations (not failing tests)

- **O-1 (Low, contract wording).** `ProcedureStepComplete`'s description says "create and advance outputs are produced by the adapter". In fact a `create` step needs `outputRecordId` naming a record produced natively first. Without it the response is 422 `procedure_step.output_required`, which the test asserts. The implementation's own comment, `outputs/kit.ts`, says "verify-and-link only". The contract text should say so.
- **O-2 (Medium, seeded methodology vs permissions).** `baseline_validation.record_baseline` assigns role **BO**, but BO does not hold `baseline.edit`, which `0018` grants to TL and KDS only. So the assignee cannot record the baseline its step requires:
  - Request: `POST …/baselines` as BO.
  - Response: `403 {"code":"forbidden","detail":"You do not have permission for this action."}` (`integration-run6-bo-baseline-403.log`).
  - Workaround in the suite: the Lead records the baseline and BO completes the step. This is the adapter's "whoever holds the right" rule.
  - Decision needed: whether a step whose assignee cannot produce its output is acceptable.
- **O-3 (A21 scope).** No configuration key exists to "disable" exports, e-mail or AI (`packages/config` has none). P5 ships no AI adapter and no external notification adapter (p5-plan l.356; D-142 Q11), and the export endpoints are always available. "Disabled" was therefore taken to mean the shipped configuration, with no export worker running. The test proves the scenario never needs these channels: 0 export jobs, no non-in-app notification, and no off-origin request in e2e. A real switch-off, with AI or e-mail adapters configured and then disabled, can only be tested once those adapters exist (DG6).

## 6. BLOCKED and NOT COVERED

- **BLOCKED: demo role users signing in a browser.** Their identities name only `DEMO_IDP_ISSUER` (`https://demo-idp.mth.invalid/realms/roaming-demo`), with `email` null, and no demo IdP or demo Keycloak realm exists in `deploy/` or in this sandbox. The integration suite covers this sign-in at API level with the IdP stand-in. The e2e specs therefore sign in the synthetic dev users of `seed-dev` on the demo database.
- **NOT COVERED in e2e: steps 2–9, 11 and 12 performed in the UI.** The e2e covers step 1 (UI create form) and step 10 (native generation, with the walkthrough read in the UI). All twelve are proven at API level on one transformation. Doing all twelve in the UI also needs D-QA-E-1 fixed and a demo IdP.
- **NOT COVERED: REQ-S01-003's A01 clause** (the coverage view for every seeded methodology element). It is A01 / DG6 scope and is not part of this assignment's A02 reading.

## 7. What remains

1. Repair D-QA-E-1. Options: an organization- or BU-scoped TL/TO grant for the demo users, or a demo access-admin user, in the dataset. Then the REQ-S18-004 test passes, and an e2e that drives all twelve steps with the demo role users needs a demo IdP in the compose `demo` profile (devops).
2. Repair D-QA-E-2: route the intake's approval once `capture_intake` has produced the transformation.
3. Decide O-1, O-2 and O-3.
4. The orchestrator's merged-tree verification should re-run the two root specs by explicit path with `e2e/support/with-demo-stack.sh`.
5. Configuration: the specs publish no global configuration (D-163). Each run creates its own transformation, and the demo stack is disposable.
