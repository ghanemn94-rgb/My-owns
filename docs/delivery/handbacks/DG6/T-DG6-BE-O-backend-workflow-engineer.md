# Handback T-DG6-BE-O (backend-workflow-engineer): the deliverable external-change confirmation, graceful degradation proof, the S16-022 entity group

- **Stage:** DG6 (BUILDING), P6 slice B, `docs/architecture/p6-work-split.md` §B/A.8.
- **Invocation:** `DG6-T-DG6-BE-O-backend-workflow-engineer-20261030T071809Z-8048e19c` (session `8048e19c-2c45-4c58-9b91-cc4e10bab248`).
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-O.md` (sha256 `b1b4e01f…bbfd`, verified at start).
- **Base:** branch `dg6/be-o` at `aca812ffa` ("DG6: assignment BE-O"), clean tree at start. Changes are left **uncommitted**.
- **Time:** start `2026-10-30T07:18:30Z`; end `2026-10-30T08:52:05Z` (about 95 minutes; I stopped at the D-059/D-070 point with rows 8 and 9 of §3 still running).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → **exit 0**, `PASS gate DG5 (historical)` (`T-DG6-BE-O-evidence/validate-dg5-historical.log`).
- No business, Finance or IT approval was granted. Confirming an external change records a fact with its provenance; it is not a product gate (G1–G6), and nothing here reads or writes DG0–DG7. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/portfolio/deliverable-confirmation.ts` (BE-A stub, now filled) | The external-change service and its route block (ADR-0055 §6, §9, §10). The three routes; the ADR-0055 §9 refusals (English verbatim); the zod request schemas; lock 730314 `deliverableConfirmation` (key `<deliverableId>`); commit-time re-authorization; IfMatchOrZero / If-Match; one audit event per change. Also `recordConnectorConfirmation` (the connector-confirmation port BE-N2's `confirmOutboundWrite`/`executeOutboundWrite` transaction 2 calls) and `setExternalChangeEvidenceGate` (the evidence module's ADR-0051 §4 read decision, wired at composition, because `evidence/index.ts` does not export it and portfolio may only import module indexes). |
| `apps/api/src/server.ts` | The BE-O composition lines below KBE-A's registration line (p6-work-split §B/A.11): `setOutboundConfirmationPort({ onConfirmed: … recordConnectorConfirmation … })` and `setExternalChangeEvidenceGate(requireEvidenceRead)`. |
| `apps/api/test/integration/portfolio/deliverable-confirmation.test.ts` (new) | REQ-S01-005: the four cases, flag lifecycle, authorization (AUD, roles, outsider, commit-time re-check, evidence of another transformation), If-Match, validation, concurrency, the database guard (14 tests). |
| `apps/api/test/integration/integrations/graceful-degradation.test.ts` (new) | REQ-S17-005 with the test connector `stopped` (and `disabled`): `submitKpiActual` by form and `createImport` succeed; `getConnector` shows the actionable error with both fallbacks (2 tests). |
| `apps/api/test/integration/integrations/s16-022-entity-group.test.ts` (new) | REQ-S16-022: each of the seven entities created by its mutation and read through the API with authorization enforced, on its own scratch database (6 tests). |
| `apps/api/test/integration/contract/p6-exercises-be-o.ts` | The contract exercises of the three operations (success and every reachable declared refusal) and their zod mirrors (`P6_MIRRORS_BE_O`). |
| `apps/api/test/support/p6-pending-be-o.ts` | Emptied: 3 → 0. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin only: `[425, 423, 1]` → `[427, 425, 1]` with a comment (+2 JSON request bodies). Reconcile with parallel deltas at merge (rule 16). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-O-backend-workflow-engineer.md`, `…/T-DG6-BE-O-evidence/*` | This handback and its logs. |

No migration, no contract (`openapi.yaml`) change, no schema change, no dependency.

## 2. Behaviour delivered, per requirement row

### REQ-S01-005

> Acceptance (verbatim): **"A11;A17: marking the task complete leaves the deliverable Unconfirmed; a filename-only link does not confirm it; reviewed evidence or a test-adapter confirmation sets it and records the source"**.

| Part | Behaviour | Test (`deliverable-confirmation.test.ts`) |
|---|---|---|
| Task complete → still Unconfirmed | No DG3/DG4 route reads or writes `deliverable_external_change`. A work item whose subject is the deliverable, completed by its assignee through `POST /work-items/{id}/complete`, and the DG3 submit + acceptance by the initiative's executive owner leave the flag `unconfirmed`, version 1, with no provenance. | "(a) a completed task on the deliverable and its DG3 acceptance leave it Unconfirmed" |
| Filename-only link does not confirm | `confirmDeliverableExternalChange` accepts only evidence that is `active`, `verified` and not `file_reference` (also the 0106 trigger). A `file_reference` and an unverified note → **422 `external_change.evidence_not_verified`** (ADR text verbatim); the flag stays unconfirmed, with no new audit event. | "(b) a filename-only link and an unverified note are refused 422…" |
| Reviewed evidence sets it and records the source | → `confirmed`, `confirmationSource: reviewed_evidence`, `evidenceId`, `confirmedBy` (the BO/TD user), `confirmedAt`, `confirmationNote`; audit `deliverable_external_change.confirmed` (prior 1, new 2); trigger history v1, v2. The confirmer may cite only evidence it may read (evidence module's one read decision: 404 out of scope or another transformation's item, 403 `evidence.parent_forbidden` for a sensitive item or parent). | "(c) reviewed (verified) evidence confirms it…", "evidence of another transformation (or unknown) is 404…" |
| Test-adapter confirmation sets it and records the source | When a `deliverable_status_push` outbound write for a flagged, unconfirmed deliverable becomes `confirmed` (BE-N2 transaction 2), the port writes `connector_result` with the write id, connector id, the configuration's source system id, the downstream reference, the confirmed time (copied in SQL to keep microseconds; the 0106 trigger compares them), and the connector's service identity. Audit actor type `service`, `onBehalfOfUserId` = the requesting user. A `confirm: never` write leaves the flag Unconfirmed; a confirmed write for an unflagged deliverable creates nothing. | "(d) a confirmed test-adapter outbound write confirms it…", "a write without confirmation (confirm: never) leaves it Unconfirmed…" |

Further behaviour (ADR-0055 §6, §9; rule 4):

- **Flag lifecycle.** `putDeliverableExternalChange` with If-Match `"0"` creates the flag (`.flagged`), changes type/description (`.changed`), withdraws (`isExternalChange: false`, `.withdrawn`) or re-flags (`.flagged`), only while unconfirmed. An identical request writes nothing. Withdrawing a flag that does not exist → 409 `external_change.not_flagged`. Confirming a withdrawn flag → 409 `external_change.not_flagged`. A confirmed change: withdraw → 409 `external_change.withdraw_confirmed`; change → 409 `external_change.already_confirmed`; confirm again → 409 `external_change.already_confirmed`. The 0106 guard refuses a direct `UPDATE` of a confirmed row.
- **Authorization.** Reads: the deliverable's transformation read (404 outside scope). Flag: `external_change.flag` (TL, BO, WL, TO). Confirm: `external_change.confirm` (BO, TD). AUD → 403 on both mutations, nothing written; TL, WL and SP → 403 on confirm; SP → 403 on flag; an outsider → 404 on all three. Commit-time re-check: the write gate runs on grants reloaded inside the transaction after lock 730314; a BO right revoked while the request waits on the lock → 403, nothing written (tested by holding the lock).
- **Validation.** Strict zod bodies; `description` and `note` through the shared `freeText` rules (invalid character → 400); `changeType: other` without a description → 400 `validation.required` at `/description` (the 0106 CHECK as a request rule; no new problem code).
- **Concurrency.** If-Match 428 missing, 409 stale (with `currentVersion`; `"0"` once flagged → 409). Two concurrent `"0"` flags: one 200, one 409, one row.
- **Audit.** One event per change with prior and new version, in the same transaction (0010's `p2_audit_required` backstop); the history is served in `events`.
- **No remote I/O** in any of these transactions.
- **Evidence register:** a reviewed-evidence confirmation is an active link source of its deliverable (`EVIDENCE_LINK_SOURCES`, T-DG6-ARCH-03B); `evidence-register.test.ts` passes 9/9 with it.

### REQ-S17-005

> Acceptance (verbatim): **"A17;A21: with the test connector stopped, a KPI actual can still be submitted by form, and the connector page shows an actionable error message"**.

`graceful-degradation.test.ts`: a `kpi_actual` test-adapter connector targeting the KPI world's transformation in mode `stopped` runs (`runConnector` 202, executed by `executeIntegrationRun`) and fails with `connector.stopped`. Then:

- `getConnector` (as AUD) shows `actionableError` `{runId, triggerKind: manual, attemptNo: 1, finishedAt, errorCode: connector.stopped, fallbacks: [kpi_form, import_file]}`, `lastSuccessAt: null`, verification not `verified`, and no "live" or "Mobily" in the body;
- `submitKpiActual` by form → 201 (`direct_accept`);
- `createImport` (a CSV of `kpi_actual.v1`) → 201 `staged`, 1 valid row.

The second test repeats the form and import with the connector `disabled`. The why and what-to-do **texts** are rendered by the web catalogues (FE-A/FE-C): see §5.

### REQ-S16-022

> Acceptance (verbatim): **"A06;A13: the ERD and migrations contain every entity listed (FormSchemaVersion, AutomationRuleVersion, Job, Notification, IntegrationRun, ReportSnapshot, AuditEvent) with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced"**.

The ERD and migration part was delivered by the architect (ADR-0055 §7, ERD §1v/§2.12). `s16-022-entity-group.test.ts` covers the integration-test part. It runs on its own scratch database, because publishing a forms version and running a job now are global effects.

| Entity | Created by (API) | Read by (API): producer 200 | Out of scope | AUD | Key, owner, status asserted |
|---|---|---|---|---|---|
| FormSchemaVersion | draft → `putConfigElement` → preview → compatibility → submit-review → TO approve → **`publishConfigVersion`** | `getFormSchemaAdmin?versionId=` (ADM_METHOD) shows the new field | no grant: 403 | read 200; publish 403 | `id`, `published_by`, `status: published`, `config_kind: form_schema` |
| AutomationRuleVersion | **`createAutomationRuleVersion`** (v2) | `getAutomationRuleVersion` (ADM_METHOD) | TO@B: 404 | read 200; create 403 | `id`, `created_by`, `status: draft` |
| Job | **`runJobNow`** (202); the worker's own `recordJobRun` writes the run row, since pg-boss is not running in the suite | `getJobOperation` (ADM_TECH) lists the run by `jobId` | no grant: 403 | **read 403**, run 403 (see note) | `job_run`: `job_schedule_code`, `outcome: succeeded` |
| Notification | **`submitKpiActual`** on a review route → the BO reviewer's notification | `listMyInbox` (BO) | not in the KDS submitter's or AUD's inbox; `markInboxNotificationRead` by KDS → 404 | own inbox 200; submit 403 | `id`, `recipient_user_id`, `read_at: null` |
| IntegrationRun | **`runConnector`** (202) | `getIntegrationRun` (ADM_TECH) | TO@B: 404 | read 200; run 403 | `requested_by`, `service_identity_id`, `status: queued` |
| ReportSnapshot | generate charter → **`issueReportSnapshot`** | `getReportSnapshot` (TL) | TO@B: 404 | read 200; issue 403 | `created_by`, `issued_by`, `status: issued` |
| AuditEvent | the issue mutation | `getAuditEvent` (AUD) | TO@B: 404; ADM_TECH 404 (non-inheriting `audit_event.read`, ADR-0052 §8) | 200 (no write exists) | `actor_user_id` = the issuer |

**Note for reviewers (Job and AUD).** ADR-0055 §7 says "an AUD read (200, no write)" for every row. But `job.read` is held only by the administrators: DG5 REQ-S12-022 is tested as "a non-admin (TL, AUD) gets 403", so AUD's `getJobOperation` is **403**. I tested the real behaviour and did not change a DG5 permission (that would need a migration and a reopen). If the orchestrator wants AUD to read jobs, it is a permission change for the slice J owner.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, worktree `/home/user/wt/dg6-be-o`. Harness ports 25600–25649 only. The host is shared with other P6 agents.

Logs are under `docs/delivery/handbacks/DG6/T-DG6-BE-O-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` | `validate-dg5-historical.log` |
| 2 | `pnpm -r typecheck` | **0** | all packages | `typecheck.log` |
| 3 | `pnpm -r build` | **0** | all packages | `build.log` |
| 4 | `pnpm lint` | **0** | `eslint . --max-warnings=0` | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" | `prettier.log` |
| 6 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `openapi-lint.log` |
| 2–6 re-check | `npx eslint --max-warnings=0 <my 8 files>`; `npx prettier --check <my 8 files>`, after the comment fix in row 7 | **0**, **0** | clean | `lint-changed-files-final.log`, `prettier-changed-files-final.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (on the tree **before** the comment fix below) | **1** | unit-node **2720/2722**; unit-web **1784/1787**; unit-formula-nocodegen **259 passed, 2 skipped**. Failures: (a) `advisory-locks.test.ts` "no module source … spells a class number": **mine**, a `730314` literal in my file's header comment. Fixed by naming the class instead. (b) `architecture.test.ts` "apps/web never imports @mth/db…": **30 s timeout** at load average ~17. (c) unit-web `traceability.test.tsx` (en, ar) and `transformations.test.tsx` (en): element waits that timed out under load, in pages this task does not touch. | `pre-fix/unit-locale-unset.log` |
| 7a | `npx vitest run --project unit-node advisory-locks.test.ts architecture.test.ts` (locale unset, after the fix) | **1** | **144/144 passed**. The exit 1 is one Vitest `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error under load (the same class BE-N2 reported), not a test failure. An earlier run of the same two files in this session passed 144/144 with exit 0 (not logged). | `unit-node-rerun-fixed-locale-unset.log` |
| 7b | `npx vitest run --project unit-web traceability.test.tsx transformations.test.tsx` (locale unset, alone) | **0** | **53/53**, so (c) is attributed to load | `unit-web-rerun-alone-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (on the fixed tree) | **stopped, no exit code** | The background job was stopped at its 1-hour limit at about 09:08Z, during unit-web, so there is no exit code. unit-node finished: **2721/2722**. The one failure is `architecture.test.ts` "apps/web never imports @mth/db…", **Test timed out in 30000ms** at load average ~18; the same file passed 144/144 alone (row 7a). The advisory-lock fix is confirmed: that test passes here. unit-web: partial, then stopped. unit-formula-nocodegen: **not run**. **No pass is claimed for this row.** | `unit-c-utf8.log` (stopped run) |
| 9 | `QA_PG_PORT=25610 MTH_PORT_POOL=25611-25649 tests/qa/support/with-pg.sh pnpm test:integration` | **not finished at handback** | Started 08:13Z, run in parallel with rows 7–8 to fit the time limit; the host load average was 17–19. By 08:51Z about 66 of ~333 files had finished. Three failures so far, all timeouts in suites this task does not touch: `contract.test.ts` "an undeclared request media type is a declared 400…" (**30 s**; BE-N2 saw the same under load and it passed alone), forms "export at most 5000 rows" (**60 s**), and forms "bulk editing commit-time re-authorization" (**30 s**). **No full-suite result is claimed.** | `integration.log` (in progress) |
| 9a | `QA_PG_PORT=25600 MTH_PORT_POOL=25601-25649 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/portfolio/deliverable-confirmation.test.ts` | **0** | **14/14** | `targeted-deliverable-confirmation.log` |
| 9b | the same with `…/integrations/graceful-degradation.test.ts` | **0** | **2/2** | `targeted-graceful-degradation.log` |
| 9c | the same with `…/integrations/s16-022-entity-group.test.ts` | **0** | **6/6** (own scratch database) | `targeted-s16-022.log` |
| 9d | the same with `…/contract/contract.test.ts …/integrations/outbound.test.ts …/evidence/evidence-register.test.ts` | **0** | **132/132** (contract 101, including my exercises and the updated media-type pin; BE-N2's outbound 22 with my port wired; register 9) | `targeted-contract-outbound-register.log` |

Rows 9a–9d ran before the formatting pass and the comment-only fix in row 7. Neither changes behaviour.

**Pinned-count change:** the media-type pin `[425, 423, 1]` → `[427, 425, 1]` (§4). There is no other pinned count, and the operation count is unchanged.

## 4. Operations routed (delta to `P6_PENDING_BE_O`: 3 → 0)

| Operation | Route | Permission | Exercised (`p6-exercises-be-o.ts`) |
|---|---|---|---|
| `getDeliverableConfirmation` | `GET /api/v1/deliverables/{deliverableId}/confirmation` (ETag `"0"` when never flagged) | the deliverable's `transformation.read` | 200 (null and confirmed), 400, 401, 404 |
| `putDeliverableExternalChange` | `PUT /api/v1/deliverables/{deliverableId}/external-change` (IfMatchOrZero) | `external_change.flag` | 200 (create, change), 400, 401, 403, 404, 409 (stale; `not_flagged`), 428 |
| `confirmDeliverableExternalChange` | `POST /api/v1/deliverables/{deliverableId}/confirmation` (If-Match) | `external_change.confirm` | 200, 400, 401, 403 (AUD; TL), 404, 409 (stale; `already_confirmed`), 422, 428 |

Declared but unreachable: `getDeliverableConfirmation` 403 (the read gate answers 404, never 403); `putDeliverableExternalChange` 422 (its one business rule, `other` needs a description, is a 400 validation error).

**Pinned counts (rule 16):** media-type pin `[425, 423, 1]` → **`[427, 425, 1]`** (+2 JSON request bodies). Operation count unchanged (the three were already in the contract). No new rate-limit class and no CSRF-exempt route.

## 5. Contract, schema, dependency and i18n needs (for the orchestrator)

- **No** contract, schema, migration or dependency change.
- **i18n (FE-A owns `apps/web/src/i18n/{en,ar}/problems.json`).** None of these codes has a web text yet. English is verbatim from ADR-0055; the Arabic is my **proposal, labelled provisional**.

| Key | English (ADR-0055) | Arabic (provisional) |
|---|---|---|
| `external_change.not_flagged` | This deliverable is not flagged as an external change. | هذا المُخرَج غير مُعلَّم كتغيير خارجي. |
| `external_change.already_confirmed` | This external change is already confirmed. A confirmation never changes. | هذا التغيير الخارجي مؤكَّد بالفعل. لا يتغيّر التأكيد أبداً. |
| `external_change.evidence_not_verified` | Only reviewed (verified) evidence confirms an external change. A filename-only link never does. | لا يؤكّد التغييرَ الخارجي إلا دليلٌ تمت مراجعته (موثَّق). ولا يؤكّده أبداً رابطٌ يحمل اسم ملف فقط. |
| `external_change.withdraw_confirmed` | A confirmed external change cannot be withdrawn. | لا يمكن سحب تغيير خارجي مؤكَّد. |
| `connector.source_unavailable` why / do | The source system did not respond. / Retry the run later. Until the source is back, enter the values by form or import a file. | لم يستجب نظام المصدر. / أعد تشغيل العملية لاحقاً. وإلى أن يعود المصدر، أدخل القيم عبر النموذج أو استورد ملفاً. |
| `connector.stopped` why / do | The connector's test adapter is stopped. / Start the adapter (set its mode to healthy), or enter the values by form or import a file. | محوّل الاختبار الخاص بالموصل متوقف. / شغّل المحوّل (اضبط وضعه على سليم)، أو أدخل القيم عبر النموذج أو استورد ملفاً. |
| `connector.credentials_rejected` why / do | The source system rejected the connector's credentials. / Ask IT to renew the secret named in the connector's credential reference, then retry. | رفض نظام المصدر بيانات اعتماد الموصل. / اطلب من تقنية المعلومات تجديد السر المسمّى في مرجع بيانات الاعتماد، ثم أعد المحاولة. |
| `connector.secret_unresolvable` why / do | The secret reference {name} could not be resolved. / Ask IT to provide the secret {name} to the application's secret provider, then retry. | تعذّر حل مرجع السر {name}. / اطلب من تقنية المعلومات توفير السر {name} لمزوّد الأسرار في التطبيق، ثم أعد المحاولة. |
| `connector.mapping_mismatch` why / do | The source did not provide the mapped column {column}. / Update the field mappings to match the source, then retry. | لم يوفّر المصدر العمود المربوط {column}. / حدّث ربط الحقول ليطابق المصدر، ثم أعد المحاولة. |
| `connector.response_invalid` why / do | The source returned data the connector cannot read. / Check the source export with its owner; meanwhile enter the values by form or import a file. | أعاد المصدر بيانات لا يستطيع الموصل قراءتها. / راجع تصدير المصدر مع مالكه، وفي الأثناء أدخل القيم عبر النموذج أو استورد ملفاً. |
| Display labels (FE-C) | Unconfirmed / Confirmed by reviewed evidence / Confirmed by connector result | غير مؤكَّد / مؤكَّد بدليل تمت مراجعته / مؤكَّد بنتيجة الموصل |

- **For FE-C:** `confirmationStatus: unconfirmed` (or no flag, `externalChange: null`) must render "Unconfirmed", never green. The panel sits next to the DG3 acceptance, never instead of it.

## 6. User-facing texts made untrue

I searched `apps/web/src` (en/ar JSON and TS/TSX) for texts that call the external-change confirmation, connector confirmation or integrations "planned", "later" or "coming". **None found**, so no text was made untrue. The new codes have no web text yet (§5).

## 7. What remains (not done here)

- **Acceptance checks not completed in the time limit:** `pnpm test` with `C.UTF-8` (§3 row 8) and the full `pnpm test:integration` (§3 row 9) were still running at handback, so no result is claimed for either. To finish: re-run both on a quieter host. Then re-run alone any suite that times out, starting with `contract.test.ts`, the forms export and bulk-edit suites, and `architecture.test.ts`. My own suites already passed in isolation (rows 9a–9d).
- The web texts and the deliverable panel (FE-A/FE-C; §5).
- BE-N2's open item, "the retry job of ADR-0055 §5 step 4" (an automatic re-dispatch of a `requested` write), is **not built** here either: §B/A.8 gives me no worker or watch file. Recovery remains `confirmOutboundWrite`, which records the connector confirmation through this port when it confirms.
- The ADR-0055 §7 "AUD read 200" vs DG5 `job.read` discrepancy (§2, note): a decision for the orchestrator.

## 8. Merge notes

- No migration. `server.ts`: my two lines sit directly below KBE-A's `importTargets.register(...)` line, with two deep imports (the `server.ts` precedent) next to KBE-A's import.
- `contract.test.ts`: only the media-type pin line and its comment (parallel BE deltas are reconciled at merge).
- `outbound.test.ts` (BE-N2) installs its own confirmation port in a test and restores the previous one. It ran green with my wiring (22/22).

