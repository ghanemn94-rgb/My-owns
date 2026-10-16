# T-DG5-QA-A handback: executable acceptance suites for A06 "Configuration change" (qa-verifier, authoring)

- **Stage:** DG5 (BUILDING). This is an authoring task, not the DG5 gate review. No review record was written, and no engineering gate was approved or claimed.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-QA-A-qa-verifier-20261016T211516Z-843ba484","session_id":"843ba484-d157-4af0-9afd-2e4c4a4f17f7"}`
- **Working tree:** `/home/user/wt/dg5-qa-a`, branch `dg5/qa-a`, `HEAD` `bb0601f6a03feb789c4532d7a88e88dc88e43c5e`. Assignment sha256 `82937ea9…6712e7` was verified.
- **Time:** `date -u` gave `Fri Oct 16 21:15:29 UTC 2026` at the start and `21:58:37 UTC` before the final reruns. The final reruns finished at about 22:01 UTC.
- **Changes:** left uncommitted, as instructed. No product source (`apps/**`, `packages/**`), `tools/**`, `.claude/**`, `docs/source/**` or delivery record was edited in this tree.
- **Data:** all synthetic. Every configuration review, gate or exception decision, migration approval and route-step approval is a synthetic in-product action on test data. None of them approves anything real.
- **Pre-existing untracked files:** `.bashrc`, `.gitconfig`, `.mcp.json`, `CLAUDE.local.md` and others were already untracked in this worktree when I started. I did not create or touch them.

## 1. Files written

| File | Purpose |
|---|---|
| `tests/qa/integration/a06-configuration-change.test.ts` | A06 API acceptance suite: 27 tests, real Fastify app plus a real PostgreSQL on its **own scratch database**, because it publishes the shared `forms`, `playbook` and `scoring-defaults` keys. It runs the full Studio pipeline (draft, preview, configured review, publish) through the same operations the UI calls. |
| `e2e/a06-configuration-change.spec.ts` | Root acceptance e2e on the real stack (`with-stack.sh`), chromium-en and chromium-ar. In the UI: Studio draft, a field added in the form builder, the rule changed in the form builder, a gate approver changed in the Studio elements editor; preview, review and publish in the UI; then use on new and old transformations. A second test checks the T13 field in the UI. |
| `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-A-authoring/**` | This handback, logs, screenshots (`screenshots/{en,ar}/a06-*.png`) and mutation logs plus the runner script (`mutations/`). |

No support file was changed. The suites reuse `tests/qa/support/{api.ts,p4.ts,gates-native.ts,with-pg.sh}`, the backend harness fixtures (`setupApprovalWorld`, `newDecision`, `mapParty`) and the web e2e helpers (`apps/web/e2e/support/{ui.ts,p3-journey-setup.ts}`), all read-only.

## 2. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, PostgreSQL 16.13 disposable clusters, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Ports: QA PG 23650 (pool 23651–23699), e2e PG 23660 / API 23661 (pool 23662–23699), mutations PG 23670 (pool 23671–23699). `df -h .` showed 7.9G free before every full run. No empty `.cc-writes` directories were found.

| # | Command | Exit | Result |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)`. I did not save a log for this start run; the output is in the session transcript. |
| 1 | `QA_PG_PORT=23650 MTH_PORT_POOL=23651-23699 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | **1** | 16 files, **198 passed, 1 failed** (199). The one failure is the A06 product defect F-1 below, kept failing on purpose. Log: `integration-tests-qa.log`; per-file counts: `integration-counts.txt`. |
| 1a | Same command, A06 file only, after formatting | **1** | 26 passed, 1 failed (the same F-1 test). Log: `integration-a06-final.log`. |
| 2 | `E2E_PG_PORT=23660 E2E_API_PORT=23661 MTH_PORT_POOL=23662-23699 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a06-configuration-change.spec.ts --workers=1` | **1** | Main A06 test **passed** in chromium-en (31.6 s) and chromium-ar (28.8 s), with axe 0 serious/critical on all 7 checked screens per language. The T13 test **failed** in both languages (product defect F-2, kept). Log: `e2e-a06-final.log`. |
| 3 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean. Log: `lint.log`. |
| 3a | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" Log: `prettier-check.log`. |
| 6 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)`. Log: `validate-historical-DG4-end.log`. |

Per-file counts for check 1:

| File | Passed | Failed |
|---|---|---|
| a01-one-source-of-truth-scorecard | 2 | 0 |
| a02-a08-drafts-before-g2-scale-after-g5 | 1 | 0 |
| a03-modular-entry | 12 | 0 |
| a04-a05-a10-partials | 4 | 0 |
| a04-kpi-propagation | 8 | 0 |
| a05-calculation-correctness | 17 | 0 |
| **a06-configuration-change** | **26** | **1 (F-1)** |
| a08-gate-controls | 31 | 0 |
| a09-decision-escalation | 17 | 0 |
| a10-benefit-integrity | 16 | 0 |
| a11-adoption | 12 | 0 |
| a11-bau-sustain | 17 | 0 |
| a11-value-closure | 11 | 0 |
| a12-cross-scope | 14 | 0 |
| a13-job-idempotency | 5 | 0 |
| a14-concurrency | 5 | 0 |

### Non-zero exits, failures and flakiness, disclosed

- **Vitest config loading.** The plain `pnpm vitest run …` fails at startup with `ENOENT … mkdir node_modules/.vite-temp`, because `node_modules` is mounted read-only in this sandbox. I added `--configLoader runner` (Vitest's in-memory loader). That's the only deviation from the assignment's command, and it changes no test.
- **Development iterations.** While writing the suites, earlier runs failed because of mistakes in my tests. Examples: a wrong `resultUnitKind`, the shape of the coverage-run response, a missing `subjectVersion`, a missing SteerCo mapping, the dry-run sample shape, the sessions for G2 criterion lookup, and an unset value reading back as `null` (e2e run 1, `e2e-a06-run1.log`). I fixed each in the tests; none is reported as a product defect. `e2e-a06-run2.log` is the run before formatting, with the same outcome as the final run.
- **Flakiness and timeouts:** none seen. No spec hit the 30 s step timeout, and no timeout was raised to hide a failure (the per-test timeouts were set when the specs were written).

## 3. Requirement → test table

"IT" means `tests/qa/integration/a06-configuration-change.test.ts`; "E2E" means `e2e/a06-configuration-change.spec.ts`.

| Requirement | Binding acceptance clause | Proving test | Status |
|---|---|---|---|
| REQ-PB-093 | Weights changed to 30/20/20/15/15 and the Feasibility rubric changed through Studio, then published; a new transformation starts with them; an existing one keeps its version; 95 % is rejected. | IT "scoring defaults: publishing defaults that total 95% is rejected" (422 `config_version.weights_total`, still a draft); IT "30/20/20/15/15 and a new Feasibility rubric…" (new TX `scoring-defaults.versionId` is the new version and weights are 30/20/20/15/15 as decimal strings; old TX keeps v1 and 25/25). In the UI, Studio publishing of scoring defaults is exercised by FE-B's journey; the A06 e2e drives the same pipeline for forms. | COVERED (API). The A06 e2e does not edit weights in the UI. |
| REQ-DLV-037 (A06 part) | The A06 executable tests pass on the DG5 candidate. | IT plus E2E (this authoring run, pre-freeze). | PARTIAL: A06 runs, with F-1 and F-2 failing. The A07/A15/A16 parts and export-sample inspection are other tasks. |
| REQ-S01-002 | Changing the name updates the shell header in en and ar and the next report header; a fresh install shows 'Mobily Transformation Hub'. | IT "branding": fresh `GET /branding` gives version 0, `default`, 'Mobily Transformation Hub'; after `PUT /admin/branding` (ADM_TECH) the en and ar names are served at once; BO is refused. | PARTIAL: the shell-header render and the report-header clause were NOT tested here (the A20 shell spec is a different scenario). |
| REQ-S02-001 | The report shows 2/6/6/16/10/5/6/3/1/25; deleting a template in a draft fails the check and blocks publish. | IT "the published source-coverage report counts every element set" (exact counts); IT "deleting a template … fails the check and blocks publish" (run `fail`, template 16 → 15, publish 422, still a draft). | COVERED |
| REQ-S05-002 | Adding an extension field to T03 publishes; deleting T03 'Gap' is rejected. | IT draft-edits test (T03 extension field 200, published in forms v2; remove `T03.gap` → 422 protected; retype → 422; gap still `rich_text`). | COVERED |
| REQ-S06-001 | A procedure with a conditional and a parallel step publishes and runs; one missing a trigger or completion is rejected. | IT "a definition missing a trigger or a completion condition is rejected" (422 `trigger_required` / `completion_required`); IT "…publishes and runs on a new transformation" (two parallel steps active together; conditional step `not_applicable`; instance `completed`). | COVERED (API). The procedure builder UI was not driven. |
| REQ-S06-003 | The ten procedures exist after initialization, and each can be launched and completed in A02. | IT "the ten seeded procedures are published" (count 10). | PARTIAL: launching and completing each seeded procedure is the A02 scenario, NOT COVERED here. |
| REQ-S06-004 | Admin adds a field to T13, changes a validation rule and changes an approver route in the UI; after publish: a new T13 record stores the field, the changed rule rejects a value it accepted, and a submission is routed to the new approver. | **API:** IT T13 field stored on a new TX (`form_custom_value` row pinned to v2); IT max 100 → 50 (80 refused 400 on new TX, 40 stored, v2 record still accepts 80); IT `approval.decision_request` route BO → FIN; IT gate G3 approver SP → BO (G3 submission `approverRoleCode` BO; SP decision 403, BO decision 201; old TX keeps SP). **UI:** E2E steps 1–4 on **T01**: field added and rule changed in the form builder, gate approver changed in the Studio elements editor, entry in the record form, 80 refused, 40 stored, exceptions routed to BO on a new TX and to SP on an old TX. | PARTIAL: **F-1** (gate shows the old approver) and **F-2** (T13 value cannot be entered in the UI) fail; see also F-3. |
| REQ-S06-005 | 12% stores 0.12; currency is stored as decimal SAR without float error; a calculated field naming an unknown field is rejected. | IT "a NEW T13 record stores…" (`"12%"` → `"0.12"` in the response and the DB; `{amount:"1500000.10",currencyCode:"SAR"}` exact in the DB); IT draft edits (calculated → 422 `form_schema.calculated_formula_invalid`). | COVERED |
| REQ-S06-006 | Renaming G3's label succeeds; changing its stable ID, deleting a TOM dimension or configuring ADM as automatic approver is rejected. | IT "relabelling G3 succeeds; changing its stable ID…" (label 200; origin change 422; ordinal move 422 `stable_id_change`; TOM dimension remove 422 `source_element_protected`; ADM_METHOD in a route 422; ADM_METHOD as gate approver 422). | COVERED |
| REQ-S06-007 | Publish without the required review is rejected; editing a published version returns 409; the diff lists the added field. | IT "the diff lists the added field; publish without preview or … review is rejected" (preview_required, review_required, author self-review 403); IT "a published version is immutable (409)". The E2E diff also lists the field in the UI. | COVERED. The affected-records view was not asserted. |
| REQ-S06-008 | After v2, an existing transformation still renders v1 forms; the migration preview lists the new required field and a required G2 re-approval; historical records are unchanged. | IT "existing transformation stays pinned to forms v1"; IT forms migration v1 → v3 lists `new_required_field` `T13.qa_readiness_score` and the pin does not move; IT methodology migration lists `reapproval` G2, requester self-decision 403, synthetic Sponsor approval, execute; `gate_decision` rows byte-identical; `gate-reapprovals` lists G2; pin moved. The E2E old TX has no field and the v2 record keeps 80. | COVERED |
| REQ-S06-010 | A methodology admin can publish a form change but gets 403 approving a funding reallocation; a KPI owner can update KPI actuals but not use Studio. | IT "a methodology admin … receives 403 approving a funding reallocation; a business owner cannot use Studio" (approval stays `pending`; BO `POST /admin/methodology-versions` → 403). | PARTIAL: "KPI owner can update assigned KPI actuals" was not re-tested here (A04 suites cover it). |
| REQ-S10-015 | In a sequential route step 2 is not notified until step 1 approves; in a parallel route both are notified at once. | IT sequential (BO active, FIN waiting, FIN has 0 `approval_decision` items; after BO approves, FIN active with ≥1 item); IT parallel (v3: both active, both notified). | COVERED (API). The UI cannot configure these routes: **F-3**. |
| REQ-S12-002 | A dry run creates no tasks; a failed execution appears in the queue and succeeds on retry without duplicating actions. | IT "a dry run … writes no work item or notification" (planned `create_task` would run; `work_item` and `inbox_notification` counts unchanged in the private scratch DB). | PARTIAL: the failure-queue retry clause is NOT COVERED here (A13 part). |
| REQ-S12-018 | Proposing a formula change lists affected benefits and creates a review task. | IT route change: submit-review creates a `RevisionProposal` (`methodology_version`, validation pass, impact `affectedTransformations`, `reviewTaskCount` ≥ 1) and a `config_review` work item for TO. | PARTIAL: the **formula** (benefit) case, A07, is NOT COVERED; only the methodology revision is. |
| REQ-S16-010 | A custom-field value violating its schema is rejected by the API; core entities have typed columns and foreign keys. | IT "a custom-field value violating its schema is rejected before persistence" (non-number, above max, JSON number, float currency, unknown key → 400/422; stored row unchanged; `stakeholder_group` has FKs). | COVERED |
| REQ-S20-006 | A06 e2e: with no deployment, a record under the new version stores the added field, the changed rule rejects a previously accepted value, the updated workflow routes to the new approver, and old-version records are unchanged. | E2E main test passes in en and ar (one API process for the whole run; html `lang`/`dir`; axe; no foreign request; no DG text). IT "the new transformation pinned to the published methodology keeps a complete working catalogue" (the FE-B-reported empty-catalogue issue no longer reproduces: 10 TOM dimensions, 6 gates, other catalogues equal to v1). | PARTIAL: passes on T01; **F-1** and **F-2** fail. |

## 4. Mutation checks

Runner: `mutations/mutate.sh`. For each mutation it copies `apps`, `packages`, `tests` and `docs/api` into `$TMPDIR/mut-<name>` (with `node_modules` symlinked read-only), applies `sed` there, runs the A06 IT file and deletes the copy. Nothing in this tree changed. The baseline is a comment-only change: 26 passed, 1 failed (F-1), the same as the tree (`mutations/baseline.log`).

| Id | Broken behaviour (in the copy) | Result | Killing test(s) |
|---|---|---|---|
| M1 | Forms validator ignores the field's `max` (`apps/api/src/modules/forms/provider.ts`). | **KILLED** | "rule change … refuses 80", "schema violation rejected" |
| M2 | API publish ignores the 100 % rule (`publish.ts`). | survived: the DB guard `methodology_version_weights_total` gives the same 422 code | n/a |
| M2b | M2 plus the guard disabled in 0062. | **KILLED** | "publishing defaults that total 95% is rejected" |
| M3 | Compatibility no longer flags fixed sets (`invariants.ts:268`). | survived: removal is refused at write time | n/a |
| M3b | Removal guard (`invariants.ts:235`) plus CHECK `methodology_element_fixed_sets` disabled. | **KILLED** | "…deleting a TOM dimension … is rejected", plus 7 dependent tests |
| M4 | Sequential route: every step starts active (`approval-routes.ts:382-383`). | **KILLED** | "routed to the new approvers in sequence" |
| M5 / M5b | Admin approver check disabled in the API (and in 0062 for M5b). | survived: migration **0086** redefines the guard, so the 0062 edit is superseded | n/a |
| M5c | API check plus the 0086 guard disabled. | **KILLED** | "…configuring ADM as an approver is rejected" (the PUT returned 200) |

Five central assertions (M1, M2b, M3b, M4, M5c) are shown to fail when the behaviour breaks. The surviving single-layer mutants are equivalent mutants because a second, database-level guard enforces the same rule with the same problem code. That redundancy is by design (ADR-0039/0041). I ran no e2e mutation.

## 5. Product defects found (proposed IDs; the orchestrator allocates)

### F-DG5-QA-A-1: a gate's approver shown on the Gates screens is not the configured approver (Medium; REQ-S06-004, REQ-S20-006; mandatory_violation: false)

- **Reproduction** (IT test "REQ-S06-004 (display)…"):
  1. In the playbook draft, `PUT /api/v1/admin/methodology-versions/{v2}/elements/gate/G3` with `{"attributes":{"labelEn":"Synthetic G3 relabel","labelAr":"…","defaultApproverRoleCode":"BO"}}` returns 200; then publish.
  2. A new transformation is created afterwards and pinned to v2. G1 and G2 are approved natively. The G3 exceptions are decided by BO; the Sponsor is refused with 403 `gate_exception.not_approver`, which is correct.
  3. `POST …/gates/G3/submissions` returns 201 with `approverRoleCode: "BO"`.
- **Actual:** `GET /api/v1/transformations/01a146ab-4dcc-7120-9a78-e84b1ae6d7cf/gates/G3` returns 200 with `gate={"gateCode":"G3","status":"approved","approverRoleCode":"SP"}`, while `currentSubmission={"submissionNo":1,"approverRoleCode":"BO"}` (`integration-tests-qa.log`).
- **Impact:** `GatesPage.tsx:148` and `GateDetailPage.tsx:174` render `gate.approverRoleCode` as the gate's approver. Users of a new transformation see "Sponsor" while only the Business Owner can decide (Sponsor 403, BO 201).
- **Expected:** the gate instance reports the approver resolved from its pinned methodology.

### F-DG5-QA-A-2: extension fields added to T13 cannot be entered in the UI (Medium; REQ-S06-004 "a new T13 record stores the new field", A06 "works without code changes"; mandatory_violation: false)

- **Reproduction** (E2E test "a field added to T13 … can be entered on a stakeholder record…", en and ar):
  1. The T13 field `qa_stakeholder_score_<lang>` is added in the form builder and published.
  2. `GET /api/v1/transformations/{txB}/form-schemas/T13` lists the field.
  3. On `/transformations/{txB}/adoption`, the stakeholder group row offers only "Champions and involvement", "Edit" and "Archive". There is no form-tools entry and no extension-field input (`screenshots/{en,ar}/a06-t13-stakeholder-record.png`, `a06-t13-defect-failure.png`).
- **Cause by source inspection:** among the templates, only T01 (DiagnosePage) and T14 (BenefitPage) host the record form framework (`FormFramework`/`FormToolsButton`). T02–T13, T15 and T16 extension fields can be configured and published, and stored through the API, but not entered or seen in the UI.

### F-DG5-QA-A-3: sequential and parallel approval routes cannot be configured in the UI (Medium; REQ-S10-015 "configure:ADM", A06 "using the UI"; mandatory_violation: false)

- **Basis:** found by source inspection only. I wrote no failing test for it.
- `apps/web/src/pages/studio/ElementsSection.tsx:38` lets an `approver_route` element edit only a single `approverRoleCode`. Line 110 deletes `approverRoleCodes` when one is set, and there is no `mode` control. `ApprovalRoutesPage` is read-only by design and says "routes are configured in the Playbook Studio".
- **Result:** the sequential and parallel routes that REQ-S10-015 needs (`approverRoleCodes` plus `mode`) can only be set through the API, which is what the IT suite does.

### F-DG5-QA-A-4: misleading refusal text when a number exceeds the field maximum (Low; REQ-S06-004 UX)

- With max 50, entering `80` in the T01 extension field is refused correctly.
- The message is the decimal-format hint ("enter a number using Latin digits and a point", for example in `screenshots/ar/a06-changed-rule-refuses-80.png`) rather than an out-of-range message. 80 is a well-formed number, so the user isn't told the limit.
- The API code was not captured separately; the IT suite asserts only status 400.

### Observations (not defects)

- **O-1 (Low, contract):** `AutomationDryRunRequest` describes "a payload with the trigger's fields". For `gate.submitted` the server requires the complete internal outbox payload `gate.submitted` v1 (10 fields: `gateInstanceId`, `submissionId`, `snapshotSha256`, …). Sending only the catalogue's condition field `gateCode` plus `transformationId` returns 422 `automation.dry_run_sample_invalid`. The contract and the catalogue don't document the required shape.
- **O-2:** a forms migration plan of a transformation with **no** T13 records lists only `unchanged_history`, with no `new_required_field`. With one T13 record it lists the field. This may be intended (the item is per affected record type); I'm recording it without a defect claim.
- **O-3:** the FE-B journey header reports empty DG2 catalogues for a transformation pinned to a newly published methodology. That **no longer reproduces** on this HEAD (IT catalogue test passes).

## 6. What remains

- **NOT COVERED, by design of this task:**
  - REQ-S12-002 failure-queue retry (A13);
  - REQ-S12-018 formula-revision impact (A07);
  - REQ-S06-003 launch and complete each seeded procedure (A02);
  - REQ-S01-002 shell-header render and report-header clause;
  - REQ-S06-010 KPI-owner actuals clause;
  - REQ-S06-007 affected-records view;
  - REQ-PB-093 weights edited in the UI by the A06 e2e;
  - REQ-DLV-037 export samples (A15/A16).
- **Product work:** F-1, F-2 and F-3 need product fixes. The failing tests for F-1 (IT) and F-2 (E2E) are kept on purpose. F-3 has no test yet; a UI test can be added once a route editor exists.
- **Merge:** add the two test files and the evidence directory. No migrations, no shared-file edits, no expected conflicts: all file names start with `a06-`. The IT file creates and drops its own scratch database (`mth_qa_a06…`). The e2e spec publishes new `forms` and `playbook` versions in its stack, so run it in its own stack (as done here) or after specs that expect the seeded versions.
