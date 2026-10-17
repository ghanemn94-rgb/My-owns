# Handback T-DG5-QA-B: A07 executable acceptance suites, and the D-163/D-164 fixes to the A06 spec (qa-verifier, authoring)

- Invocation reference: `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-QA-B-qa-verifier-20261017T060259Z-ae348720","session_id":"ae348720-b812-432a-97e9-5c33125c95a3"}`
- Assignment: `docs/delivery/assignments/DG5/T-DG5-QA-B.md`, sha256 `601d03f0…24b70` (verified).
- Worktree `/home/user/wt/dg5-qa-b`, branch `dg5/qa-b`, HEAD `bed361972afeebcb91ea8bfd0064e4622c1d2540` (unchanged; nothing committed).
- Time: started 2026-10-17T06:03:14Z, finished 2026-10-17T06:56Z (about 53 minutes).
- This was an **authoring** task. It is not the independent DG5 QA review.
- All data is SYNTHETIC. Every approval in the fixtures is a synthetic in-product action on test data:
  - gate decisions by a synthetic Sponsor;
  - a change request and a restatement decided by a synthetic Business Owner;
  - configuration reviews by the office.
- None of those approvals is a real business, Finance or IT approval. No DG0–DG7 gate is named in product text.

## 1. Files written (uncommitted)

| File | Purpose |
|---|---|
| `tests/qa/integration/a07-historical-integrity.test.ts` (new) | A07 API suite, 12 tests. It runs on its own scratch database because it publishes shared configuration keys. |
| `e2e/a07-historical-integrity.spec.ts` (new) | A07 user-visible path in chromium-en and chromium-ar: issue a KPI register, change the target, check the issued snapshot is unchanged, then reissue as version 2. |
| `e2e/a06-configuration-change.spec.ts` (edited) | D-164: deterministic record selection. D-163: global configuration restored in `afterAll`. Every existing assertion is kept. |
| `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-B-authoring/**` | Logs, mutation logs and runner, screenshots, and this handback. |

`e2e/a03-modular-entry.spec.ts` was **not** edited (see §3).

## 2. What the A07 integration suite does

It derives every check from the acceptance texts and `docs/api/openapi.yaml`, and runs against the real Fastify app on disposable PostgreSQL. The harness validates every response against the contract.

**The history ledger.** Before any change, the suite issues four snapshots:
- the **Q1 2085 executive dashboard** (a period report showing the KPI's Q1 actual);
- the **KPI register**;
- the **benefit register**;
- the **approved G2 gate pack** (`approvalState: approved`).

It then exports five files from them through the real worker export runner:
- Q1 dashboard as PDF (en) and XLSX (ar);
- KPI register as PDF (ar);
- benefit register as XLSX (en);
- gate pack as DOCX (ar).

`expectHistoryIntact` then re-reads all of them after each of these changes:
1. a target change;
2. a formula change;
3. a methodology migration;
4. the refused restatement decisions;
5. the approved restatement;
6. the reissue.

For the four snapshots, each re-read checks:
- the snapshot read is equal field by field (content, `contentSha256`, `asOf`, period, `methodologyVersionId`, `approvalState`, issue data);
- `/versions` and `/sources` are unchanged.

For the five exported files, each re-read checks:
- every export job still has the same `fileSha256` and size;
- the download is byte-identical (sha-256 of the bytes).

**Scenario steps, in order:**

1. **REQ-S13-007.** The issued snapshots retain as-of, period, methodology version, the KPI register's `kpi_version` v1, the source records and the approval state.
   - A separate test checks that the Q1 dashboard retains the KPI's calculation version. **It fails: product defect P-1.**
2. **REQ-S07-016a.** Target 100 → 120 through a change request.
   - The impact preview is `material` and lists the outcome as `value_changes`.
   - Submitting routes an approval, and v2 is not active before the decision.
   - After the BO's decision, Q1 keeps its RAG (amber), its evaluation id and its actual. The Q1 evaluation is still v1 against target 100 (database state).
   - The live Q1 dashboard shows the same RAG.
   - The issued register still shows 100 and never 120. Its versions never cite v2.
   - History is intact.
3. **REQ-S12-018.** A new formula version (uplift 2.5 → 3.0) is proposed.
   - `GET /admin/revision-proposals` lists one proposal whose `impact.affectedBenefits` contains the benefit, with `validationResult: pass` and at least one review task.
   - FIN's own `/me/work-items` has an open `config_review` task for the version. The editor has none.
   - History is intact.
4. **REQ-S06-008 (history part).** A playbook version flips a G2 criterion's `mandatory` flag and is published through the full pipeline.
   - The existing transformation stays pinned until the deliberate migration.
   - The migration lists a G2 `reapproval`. It is submitted, approved by the synthetic SP and executed.
   - `gate-reapprovals` lists G2, and the `gate_decision` rows are byte-equal to before.
   - The approved G2 pack keeps `approved` and its original methodology version.
   - History is intact.
5. **REQ-S07-016b.** A Q1 restatement is requested by a user holding both FIN and KDS.
   - TL is refused with 403 `kpi_restatement.no_authority`, and so is KDS.
   - The requester is refused with 403 `kpi_restatement.self_decision`.
   - Nothing changes: the restatement is still `submitted`, Q1's RAG and evaluation are unchanged, and history is intact.
6. **REQ-S07-016c.** The BO approves, and the worker's `kpi.recalculate` consumer runs once.
   - The retained reconciliation shows Q1 target before 100 and after 120. The restated Q1 evaluation is v2 / 120.
   - History is intact, and the KPI register is offered for reissue.
   - Reissuing the Q1 dashboard with a reason gives a new snapshot in the same series. It is still `generated`, and v1 stays `issued` until the reissue is issued.
   - Once issued it is `issueVersion: 2`, and v1 becomes `superseded` (`supersededById` = the reissue, `issueVersion` 1).
   - History is still intact after the reissue: v1's content, hash and versions are as issued, and its three files are byte-identical.
   - A separate test checks that the Q1 dashboard is among the reissue offers. **It fails: product defect P-1, downstream.**
7. **REQ-S06-009.**
   - A forms version adds a T13 number field, and a transformation created under it stores `"7"`.
   - A rollback of the prior version gives a draft with `origin: rollback` and `rollbackOfVersionId` set. It is reviewed and published.
   - Its definition and all resolved elements equal the prior version's. Both earlier versions remain published.
   - The value `"7"` stays retrievable with its `formSchemaVersionId`.
   - A transformation created after the rollback has no field.
   - The audit trail has `methodology_version.rollback_create` by the methodology admin, and the publish.
8. **REQ-PB-093.**
   - Defaults totalling 95% are refused at publish with 422 `config_version.weights_total`, even after an approved review.
   - 30/20/20/15/15 with a new Feasibility rubric applies to a new transformation.
   - The existing transformation's scoring-defaults read is unchanged (still 25/25…). Only `isNewestPublished` flips from true to false.
9. **REQ-S14-003.**
   - A health check is submitted under scheme v1 (19 yes).
   - An N/A draft that keeps the four source bands fails preview with 422 `health_scheme.own_bands_required`. Publish returns 422, the draft is not a published scheme, and the scheme GET returns 404.
   - With its own bands the scheme publishes.
   - The assessment keeps scheme v1, its score and its band, and v1 is unchanged.
10. **Contract test** (found while authoring). `GET …/custom-fields` on a record with no values returns `ETag: "0"`. **It fails: defect P-3.**

## 3. D-163 and D-164 (A06 spec)

**D-164: record-selection race.**
- `openT01Form(page, tx, recordId)` now opens `#t01 [data-form-tools='<recordId>']`, the id that `t01Record` patched.
- It then asserts that the dialog's `data-form-framework` has `data-record-id = recordId`.
- All four call sites pass the record id (`W.recOld`, `recB`, `recC`, `W.recB`).
- The grid order no longer matters.

**D-163: shared-state pollution.** I chose option (a): the A06 spec restores what it publishes.
- The spec records the base version of every global key it publishes over: `form_schema/forms` in step 1 and `methodology/playbook` in step 4.
- A `test.afterAll` restores each one through the product's own rollback, `POST …/{base}/rollback`, followed by the review pipeline.
  - It first discards any open draft of the key.
  - It runs even after a failure.
  - It then checks that the newest published version has `origin: rollback`, `rollbackOfVersionId = base`, and an equal definition.
- Why (a) rather than making A03 decide with the routed approver:
  - It fixes the cause (one spec leaking global state) rather than one symptom.
  - It protects every later spec, not only A03.
  - A03's assertions stay exactly as written.
  - It also exercises REQ-S06-009 rollback on the real stack.
- My A07 spec publishes no global configuration, so it has nothing to restore.

## 4. Checks run (real exit codes)

| # | Command (environment: node 24.21.0, offline, ports 23600–23649) | Result |
|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | **exit 0**, `PASS gate DG4 (historical)` (`validate-DG4-historical-start.log`) |
| 2 | `QA_PG_PORT=23600 MTH_PORT_POOL=23601-23619 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | **exit 1**: 24 files, **272 passed, 3 failed** (275). The only 3 failures are the product defects P-1 (×2) and P-3 in the A07 file (`qa-integration-tests-qa.log`) |
| 3 | `apps/web/e2e/support/with-stack.sh npx playwright test e2e/a03-modular-entry.spec.ts e2e/a04-kpi-update.spec.ts e2e/a06-configuration-change.spec.ts e2e/a07-historical-integrity.spec.ts e2e/a08-a09-gates-decisions.spec.ts e2e/a15-reporting.spec.ts e2e/a16-health-launch.spec.ts e2e/a20-bilingual-shell.spec.ts --workers=1` (`E2E_PG_PORT=23620 E2E_API_PORT=23621 MTH_PORT_POOL=23622-23649`), run 2 (final) | **exit 1**: **25 passed, 1 failed**. The failure is A07 chromium-en, axe `color-contrast` (product defect P-2). A03 and A06 pass in both projects, including A03 chromium-ar after A06 (`e2e-root-run2-final.log`) |
| 3a | Same command, run 1 (before the final A06 `afterAll` assertion) | exit 1: 24 passed, 2 failed (see §7) (`e2e-root-run1.log`) |
| 3b | A07 spec alone, both projects | exit 1: en failed on P-2, ar passed (`e2e-a07-alone-run1.log`) |
| 4 | `pnpm lint` | **exit 0** (`pnpm-lint.log`) |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** (`prettier-check.log`) |
| 6 | `npx eslint --max-warnings=0` on my 3 files | exit 0 (`eslint-own-files.log`) |
| 7 | `tsc -p` a throwaway config over my 3 files (they are not in any repository typecheck project) | exit 0 (`tsc-own-files.log`) |
| 8 | Mutation checks (§6) | 8 of 8 mutants killed |
| 9 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | **exit 0** (`validate-DG4-historical-end.log`) |

**A07 integration, per test (run inside #2):** 9 passed, 3 failed.

**Per-file counts for #2** (all passed except A07):

| File | Tests |
|---|---|
| a01 | 2 |
| a02-a08 | 1 |
| a03 | 12 |
| a04-a05-a10 | 4 |
| a04-kpi | 8 |
| a05 | 17 |
| a06 | 27 |
| **a07** | **12 (3 failed)** |
| a08 | 31 |
| a09 | 17 |
| a10 | 16 |
| a11-adoption | 12 |
| a11-bau | 17 |
| a11-value | 11 |
| a12 | 14 |
| a13 | 5 |
| a14 | 5 |
| a15-demo | 7 |
| a15-every | 5 |
| a15-selected | 7 |
| a15-snapshots | 15 |
| a16-health | 13 |
| a16-launch | 11 |
| a16-s16-021 | 6 |

**Axe:** 0 serious or critical issues on every A07 screen in chromium-ar, and on 4 of 5 in chromium-en. The exception is P-2.

Disk had 7.9 GB free before every run. No timeouts occurred, and no runs were in parallel.

## 5. Requirement → test table

| Row | Test that proves it (file `tests/qa/integration/a07-historical-integrity.test.ts` unless stated) | Status |
|---|---|---|
| REQ-PB-093 | "REQ-PB-093: … defaults totalling 95% are refused at publish; 30/20/20/15/15 with a new Feasibility rubric reach only new transformations". Also covered by A06 `tests/qa/integration/a06-configuration-change.test.ts` scoring defaults. The UI part ("in the UI") is A06's. | PASS |
| REQ-DLV-037 (A07 part) | This whole suite plus `e2e/a07-historical-integrity.spec.ts` on the candidate. Bilingual export inspection is out of A07's scope (A15). | Executed. FAILS on P-1, P-2, P-3 |
| REQ-S06-008 | "REQ-S06-008: a methodology change requiring G2 re-approval is migrated; the approved G2 decision and pack stay intact". The "existing transformation still renders v1 forms" and "new required field" parts are proven by A06 integration. | PASS |
| REQ-S06-009 | "REQ-S06-009: … records created under the rolled-back version remain retrievable and the audit trail shows the rollback". The e2e A06 `afterAll` exercises rollback on the real stack. | PASS |
| REQ-S07-016 | Prospective RAG: "a prospective target change … leaves last quarter's RAG unchanged". Authority: "a Q1 restatement decided without kpi_restatement.approve … is rejected". Report unchanged + reissue v2: "approved by an authority (BO) … a reissue creates version 2", and e2e A07 step 2. Offer of the Q1 period report: "the Q1 report issued earlier … is offered for reissue". | PASS, except the reissue offer for the Q1 dashboard (FAIL, P-1) |
| REQ-S12-018 | "REQ-S12-018: proposing a formula change lists the affected benefit and creates a review task". The methodology-revision case is in A06. | PASS |
| REQ-S13-007 | "REQ-S13-007: an issued snapshot retains …" (PASS). "…the issued Q1 dashboard retains the calculation version and source revision of the KPI value it shows" (FAIL, P-1). e2e A07 step 1: the issued register still shows 100 with KPI version v1 after the change (PASS in ar; en passes every value assertion, but its final axe check fails on P-2). | PARTIAL: FAIL on P-1 |
| REQ-S14-003 | "REQ-S14-003: an N/A scheme without its own bands is refused; existing assessments keep their scheme version and band". Also covered by A16 `a16-health-check.test.ts`. | PASS |
| REQ-S20-007 | This suite and the e2e spec, executed on the integrated tree (§4). | Executed. Not all green, because of P-1, P-2, P-3 |

## 6. Mutation checks

Method:
- The tree was copied to `$TMPDIR/mut` with `node_modules` symlinked.
- One product line was mutated in the **copy only**, the A07 suite was run there, and the file was restored.
- Runner: `mutation/mutrun.sh`. Each log contains the diff and the full output.
- Baseline (unmutated copy): 9 passed, 3 failed, the same as the tree (`mutation/mut-baseline.log`).

| Mutant | Mutation (copy only) | Killed by | Log |
|---|---|---|---|
| M1 | `restatement-decisions.ts`: authority role falls back to `"TL"` | Restatement authority test (TL's decision returned 200, expected 403 `no_authority`) | `mut-M1-authority.log` |
| M2 | `revision-impact.ts`: `affectedBenefits: []` | REQ-S12-018 (`expected [] to include <benefitId>`) | `mut-M2-formula-impact.log` |
| M3 | `snapshots.ts`: superseding also rewrites `as_of` | Reissue test. The database immutability guard refuses it (issue returns 422), so the ledger is not what catches it. That led to M3b. | `mut-M3-supersede-asof.log` |
| M3b | `snapshots.ts` read: a superseded snapshot reports `asOf = now` | Ledger: "Q1 executive dashboard after the reissue: expected … to deeply equal" | `mut-M3b-read-asof.log` |
| M4 | `publish.ts` rollback copies `newest.id`'s elements | REQ-S06-009 ("the rollback version's elements equal the prior version's": 145 vs 144) | `mut-M4-rollback-content.log` |
| M5 | `scoring-defaults.ts`: the transformation read ignores the pin and reads the newest | REQ-PB-093 (the existing transformation now reads the newest version) | `mut-M5-scoring-pin.log` |
| M6 | worker `kpi.ts`: version activation recalculates the **closed** period | REQ-S07-016a (Q1 evaluation changed), and the reconciliation (`['120','120']` vs `['100','120']`) | `mut-M6-retroactive.log` |
| M7 | export download route: every re-download flips the last byte | Ledger: "Q1 dashboard PDF (en) bytes after the target change / formula change / methodology migration / …" | `mut-M7-export-bytes.log` |

Disclosure on M7: the first M7 attempt was invalid. It sent a raw async generator, so the route returned 500 in setup and all 12 tests were skipped. I rewrote it with `Readable.from`, and the log above is that second, valid attempt; the invalid one was overwritten.

## 7. Non-zero exits and failures in my own runs, explained

- **Integration runs 1 to 6** (`authoring-iterations/`) failed on my own test errors, fixed in turn:
  - wrong impact-preview shape;
  - a KDS requester cannot trigger `self_decision`;
  - no approved trajectory, so RAG was Unknown;
  - `elements?limit` must be at most 100;
  - publish needs an approved review before the weights rule;
  - the `isNewestPublished` flip.
- **Debug runs** (`debug1/2`) printed snapshot versions, status and rollback content, which established P-1 and the rollback hash observation O-2.
- **Root e2e run 1** failed A06 test 2 (en) in my new `afterAll`. It wrongly asserted that the rollback version's `contentSha256` equals the base's. The restore itself had worked: A03 and A06 passed in chromium-ar afterwards. I replaced the check with origin, `rollbackOfVersionId` and definition. Run 2 is green for A06.
- **The a07 test file changed after the mutation and e2e runs**: a lint-only refactor of the `frozen()` helper (unused destructured names). The comparison is equivalent, and the final run #2 includes that edit.

## 8. Product defects found (failing tests kept; proposed finding IDs)

**P-1 (proposed F-DG5-qa-1): Medium, mandatory_violation true (REQ-S13-007 and REQ-S07-016).** The executive dashboard snapshot records no calculation version for the KPI values it shows.
- Request:
  1. `POST /api/v1/transformations/{t}/reports/executive_dashboard/generate {"reportingPeriodId":"<Q1 2085>"}`
  2. `…/issue`
  3. `GET …/report-snapshots/{id}/versions`
- Response: 200 `{"items":[{"versionKind":"methodology_version","referenceId":"01920002-0000-7000-8000-000000000001","referenceKey":"playbook","versionLabel":"v1"}]}`. There is no `kpi_version` entry, although the `items_outcomes` row shows the KPI's Q1 actual `90`.
- `/sources` lists `transformation`, `outcome`, `outcome_kpi` and `benefit`, but no KPI definition or actual.
- Cause in source: `apps/api/src/modules/reporting/reports/assemblers/executive-dashboard.ts:310` hard-codes `versions: []`. The KPI register (`registers.ts:513`) does record `kpi_version`.
- Downstream: after an approved Q1 restatement, `GET …/kpi-restatements/{id}/reissue-offers` returns only the KPI register: `[{"definitionCode":"registers","issueVersion":1,"periodLabel":null,…}]`. **The Q1 report issued earlier is not offered for reissue.** A manual reissue still works and gives version 2.
- Expected:
  - REQ-S13-007: the snapshot retains "source record revisions … calculation versions".
  - REQ-S07-016: "Restatement approved -> recalc selected periods and offer report reissue".
- Tests: "the issued Q1 dashboard retains the calculation version…" and "the Q1 report issued earlier … is offered for reissue".

**P-2 (proposed F-DG5-qa-2): Medium (an accessibility AA failure; axe "serious"), en.** On a superseded snapshot page, the banner link "Open the current issue" (`<a class="link">` inside `.banner--info`) has a contrast ratio of 4.22:1, below the 4.5:1 required for 16px text.
- Colours: foreground `#006de9` on background `#e8f1fc` (`e2e-a07-en-axe-diagnostic.log`; screenshot `screenshots/en/a07-FAILED-axe-contrast-superseded-v1.png`).
- Request: open `/transformations/{t}/reports/{v1}` after v1 was superseded by an issued reissue; locale en.
- In chromium-ar, the same page with the same banner link passes axe (screenshot `screenshots/ar/a07-v1-superseded-unchanged.png`). I did not establish why it passes in ar.
- Not in `findings.json`.
- Test: `e2e/a07-historical-integrity.spec.ts` step 2, final `checkPage`. Every value assertion before it passes in en.

**P-3 (proposed F-DG5-qa-3): Low, mandatory_violation false (contract conformance).** On a record with no stored values, `GET /api/v1/transformations/{t}/form-records/T13/{id}/custom-fields` returns 200 `version: 0` with header `ETag: "0"`.
- The contract describes the body as "version 0 when none stored", but its `ETag` header (`components/headers/ETag`) requires `^"[1-9][0-9]{0,9}"$`.
- The harness rejects the response: `contract: header ETag="0" violates {"type":"string","pattern":"^\"[1-9][0-9]{0,9}\"$"}`.
- Either the contract or the server must change.
- Test: "contract (found while authoring A07): … returns version 0 with an ETag the contract allows".

**Observations (no failing test):**
- **O-1 (Low).** After a prospective target change, `GET …/kpi-definitions/{k}/status?reportingPeriodId=<closed Q1>` reports `kpiVersionId` = v2 and `finalTarget: "120"`. Its `evaluationId`, RAG and actual remain the Q1 v1 evaluation, whose stored target is 100.
  - The panel therefore pairs Q1's v1 evaluation with v2's version and target.
  - The contract does not define whether these fields belong to the period, so I assert only the RAG, the evaluation and the stored evaluation version.
- **O-2 (Low).** A rollback version whose definition and every resolved element equal the restored version still gets a different `contentSha256`. This is deterministic across stacks: `96ee46…` versus the seeded `b383e1…` for forms.
  - The rollback code hashes the definition, titles and elements (`publish.ts`), so the seeded base hash may have been computed differently.
  - Content equality is asserted on elements, not on the hash.

## 9. What remains and merge notes

- Every assigned requirement row has an executable test (§5). The A07 suite is not all green, and the cause is the product defects P-1, P-2 and P-3. Following the rules, I kept those tests failing and did not work around them.
- The binding D-163 result is met for A03 and A06: they pass in one stack, in file order, en then ar, with `--workers=1`. The whole root set is not green only because of A07 en (P-2).
- Nothing in the merge needs migrations. My files are new apart from `e2e/a06-configuration-change.spec.ts`. A conflict is possible only if another task also edited that spec (QA-E, QA-F and FE-C3 are not scoped to it).
- **Untracked files I did not create:** `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. These are environment files in the worktree root. They should not be integrated.
