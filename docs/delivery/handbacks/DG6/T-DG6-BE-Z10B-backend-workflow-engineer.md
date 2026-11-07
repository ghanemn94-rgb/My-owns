# Handback T-DG6-BE-Z10B (backend-workflow-engineer): the remaining restricted id references (F-DG6-420 second half, D-218)

- **Stage:** DG6, FIXING after review round 6. Task T-DG6-BE-Z10B, the second half of T-DG6-BE-Z10. Finding F-DG6-420 (Medium, REQ-S10-002).
- **Invocation:** `DG6-T-DG6-BE-Z10B-backend-workflow-engineer-20261107T180922Z-fdc175c2`, session `fdc175c2-c7cd-4125-b6f6-a3c9a1c3fb12`.
- **Base:** branch `dg6/be-z10b` at `3e6f1bc15cf30d29cd909dc4740504eaeb1f9410`. The tree was clean at the start. All changes are **uncommitted**, as asked.
- **Times:** start `2026-11-07T18:09:35Z`; end `2026-11-07T19:16Z` (about 67 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exits 0 (`PASS gate DG5 (historical)`), at the start (`00-validate-dg5-historical.log`) and at the end (`50-validate-dg5-historical-end.log`).
- **Product gates:** marking a record sensitive is an access decision, never a business approval. Nothing here grants or implies G1–G6, and nothing touches DG0–DG7. All test data is SYNTHETIC.

## Assignment discrepancy (please confirm)

The assignment's handback section names `docs/delivery/handbacks/DG6/T-DG6-BE-Z8-backend-workflow-engineer.md` and `T-DG6-BE-Z8-evidence/`. Both already exist: they are the merged handback of the earlier task T-DG6-BE-Z8 (F-DG6-380). BE-Z10 reported the same copy error. Overwriting them would destroy that record, so I did not touch them. Following the agent protocol's default path, this handback is `docs/delivery/handbacks/DG6/T-DG6-BE-Z10B-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-BE-Z10B-evidence/`.

## Requirement row

**REQ-S10-002**, acceptance (quoted): "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant".

D-218 applies it to identifiers: "a response never names the id of a sensitive record the reader is not admitted to. The reference is omitted; where the open record depends on it, a neutral restricted marker without an id is returned, `includesRestrictedRecords: true` is set, and the screen shows the restricted label instead of a link."

Throughout, "TL" is a reader in scope with no grant (404 on the record), and "admitted" is the TO or a reader with an explicit grant. Admitted readers get every id and no marker, in every row below.

## 1. Every field from BE-Z10's "What remains"

| BE-Z10 item | Response (operations) | What I found | Now |
|---|---|---|---|
| Diagnose workstream outputs | `listWorkstreamOutputs`, `getWorkstreamOutput`, and the create/PATCH/archive responses (register kit) | `evidenceId` named the hidden evidence (sweep: 6 leaks before the fix). `recordId` can only name the 7 `WORKSTREAM_OUTPUT_RECORD_TYPES`; none of them is sensitive or a child of one, so it is not restricted today. | `evidenceId: null` plus `includesRestrictedRecords: true`. `recordId` goes through `hideRestrictedTypedRefs`, which keeps the type and nulls the id if a sensitive type is ever added. **New register-kit hook `redact`** (principal-aware, applied to the list, the item and every write response of a register). |
| Phase-step evidence | `listPhaseStepEvidence` | Listed the link to the hidden evidence (3 leaks). | A link to an evidence item the reader is not admitted to is **not listed**, as in BE-Z10's `listEvidenceLinks`: the row exists only to name the item, and `evidenceId` is a required uuid. The step itself carries no evidence ids. |
| Form attachments | `listFormRecordAttachments` | Already filtered (BE-Y1, F-DG6-123). | Unchanged. |
| Form attachment and reference values (custom fields) | `getFormRecordCustomFields` and the `putFormRecordCustomFields` response | An `attachment` field's evidence ids, and a `reference` field's id, were served raw. Found by reading the code; the demo has no extension field. | Read-time `redactRestrictedIds` over `values`: a hidden array element is dropped, a hidden single reference becomes null, plus `includesRestrictedRecords: true`. The stored row is unchanged. **Re-save rule** (below): stored hidden ids are kept. |
| Missing-links evidence | `getMissingLinks` | Its items never carry evidence ids (the 8 codes name outcomes, initiatives, benefits and dispensations). The benefit item is already omitted (BE-Z5). | Unchanged. The evidence reference of the modular entry is the inherited record (next row). |
| Modular report: inherited records | `listInheritedRecords`, `getInheritedRecord`, the create and withdraw responses | `evidenceId` named the hidden evidence, including in `prior_approval` entries built from dispensations (3 leaks). | `evidenceId: null` plus `includesRestrictedRecords: true`. |
| KPI RAG overrides | `listRagOverrides`, and the create and revoke responses | `evidenceId` named the hidden evidence (3 leaks). | `evidenceId: null`, **`evidenceRestricted: true`** (the override has evidence, never "none"), plus `includesRestrictedRecords: true`. **Contract type widening:** `RagOverride.evidenceId` was a required non-null uuid and is now a nullable uuid (see the contract section). |
| KPI status evidence | `getKpiStatus`, `listKpiStatuses` (`override.evidenceId`) | Named the hidden evidence of the override in force (3 leaks). | `override.evidenceId: null` and `override.evidenceRestricted: true`. The override and its RAG stay shown. Same type widening on `RagOverrideInForce.evidenceId`. |
| Portfolio deliverable confirmation | `getDeliverableConfirmation`, and the PUT and confirm responses | `externalChange.evidenceId` named the hidden evidence (6 leaks: the filler's read and the extra read). | `evidenceId: null` plus `includesRestrictedRecords: true`; `confirmationSource` stays `reviewed_evidence`. |
| Portfolio dispensations | `listGateDispensations`, and the create, decision and revoke responses | `evidenceId` named the hidden evidence (3 leaks). | `evidenceId: null` plus `includesRestrictedRecords: true`. `evidenceVerified` and `counts` are unchanged: the dispensation holds that evidence whoever reads it. |
| *(found by the sweep)* Readiness | `getTransformationReadiness` (`gates[].dispensations[]`) | Embedded the same dispensations, naming the hidden evidence (3 leaks). Not in BE-Z10's list. | The same redaction. The sequencing state reads `counts`, which is unchanged. |
| Agenda materials | `listAgendaItems`, and the create, PATCH, publish, withdraw and outcome responses | `materialsEvidenceIds` named the hidden evidence (3 leaks). | The hidden id is omitted, plus `includesRestrictedRecords: true`. **Re-save rule** for the PATCH (below). |
| Canvas evidence | `getTomCanvas`, `getTomCanvasCell`, and the PATCH response | The box's `evidence[]` listed the hidden **evidence item itself, with its title** (3 leaks). That is content, not only an id. | A restricted item is not listed, and the box view carries `includesRestrictedRecords: true`. |
| G5 evidence | the G5 criterion, the submission snapshot `g5.pilotEvidenceIds` | The live criterion text names no ids. The pilot evidence ids exist only in the frozen snapshot, which BE-Z10's `redactRestrictedIds` already redacts on every gate read (a hidden array element is dropped). The pilot step's own links are the phase-step row above. | No change needed. The demo has no G5 submission, so the sweep could not seed this one (see "Not seeded"). |
| Modular report | the reporting module's `modular.ts` | It is the inherited-records and missing-links routes above. | As above. |
| Report snapshot evidence lists | `listReportSnapshotEvidence`, `listReportSnapshotSources`, the snapshot body | Already filtered (`visibleRefs`, BE-Z5). The document's rows, items and sources are filtered (`documentForReader`); no cell carries an evidence id. | Unchanged. |
| Write response: gate-condition close | `closeGateCondition` | The 201 body named the closure evidence, even when the list hid it. | The same `hideRestrictedRefs` as the list. |
| Write response: health PATCH | `updateHealthCheck`, and also `createHealthCheck`, `putHealthCheckAnswer`, `putHealthCheckActions`, `submitHealthCheck` | All five write responses named an answer's hidden evidence. | All go through the item read's redaction. **Re-save rule** for the answer PUT (below). |

### The sweep for other fields (item 1, second part)

1. **Code.** I listed every response mapper in `apps/api/src/modules` that emits `evidenceId(s)`, `benefitId(s)`, `businessCaseId(s)`, `parentCaseId`, `countedBenefitId`, `memberBenefitIds`, `latestEvidenceIds`, `materialsEvidenceIds`, `includedCaseIds` or `blockerRecordId` (60 file/field pairs). Per field:
   - **Already handled earlier.**
     - BE-Z10: groups, measurements, the T14 register, finance validation, the evidence register and links, Day-90, funding, business cases and totals, gates, executive decisions, KPI actuals, handovers, gate conditions (list) and health (item).
     - BE-B2/Z7: dashboards and drill-down (`dashboards/finance.ts`, `drilldown.ts`, `benefits/dashboard-facts.ts`, `kpi/dashboard-facts.ts`).
     - BE-Z5: reports and traceability (`reporting/traceability.ts`, the assemblers, `reports/routes.ts`).
     - BE-Y1/Z4: forms attachments, the deep links and inbox (`tasks/deep-links.ts`).
     - Benefit children carrying `benefitId` (`values.ts`, `scenarios.ts`, `lifecycle.ts`, `raid/corrective-cases.ts`, `sustainment/performance-areas.ts`, `transition-decisions.ts`, `business-case-lines.ts`, `financial-metrics.ts`): these answer 404, or are omitted from their lists, through the reach guard (`SENSITIVE_REACH_PARAMS`) and list filters (BE-Y1/Z4/Z5).
   - **Fixed here:** every row of the table above, plus closure records (next item).
   - **Closure records — new, found by reading the code.** `listClosureRecords` and the `closeInitiative`/`closeTransformation` 201 bodies return a frozen `snapshot.benefits[]` naming each benefit id with its validated measurement and transition decision ids. A benefit entry the reader is not admitted to is now omitted from the shown snapshot (`redactRestrictedIds`), plus `includesRestrictedRecords: true`. The stored snapshot and the basis are unchanged. The demo has no closure, so the sweep cannot see this; it has its own test (`sustainment/closure.test.ts`).
   - **Not a leak:**
     - `automation/samples.ts`: fixed synthetic placeholder ids of the builder's example payloads.
     - `benefits/counting.ts`, `kpi/p3-gate-facts.ts`, `kpi/totals.ts` and `benefits/totals.ts`: internal readers. Their response fields are covered by BE-Z10's totals change.
     - `sustainment/status-model.ts`: `benefits[]` is internal to the value status and is not in the status-model response.
2. **Runtime.** The extended sweep (below) reads every callable GET of the contract with the new references seeded. Its only finding outside BE-Z10's list was `getTransformationReadiness` (fixed).
3. **Still open, by design:** `listTransformationAudit`/`listAuditEvents` and `listSensitiveGrants`/`getSensitiveGrant` `recordId` (BE-Z10's "Decision needed"), still excused in the sweep's `ID_REF_ALLOWED`. Also the phase-step evidence **remove** response, which echoes its link's `evidenceId` (a required uuid) to a writer who names the link id. The list no longer gives a not-admitted reader that link id. Changing it would be a contract type change, so I left it and list it under "What remains".

## 2. The Day-90 PUT: the re-save rule (documented)

**Rule** (D-218 continuation; `keptRestrictedRef` in `access/sensitive-reach.ts`, with its doc comment):
- A reader who is not admitted to a stored reference was shown `null`. So a write that sends `null`, or omits the field, is a re-save, not a removal they could have chosen: **the stored hidden reference is kept.**
- The writer changes it only explicitly, by sending another id, which their write checks as before.
- A writer admitted to the stored record, or a stored reference to an open record, clears it with `null` exactly as before.
- The audit event records no evidence change for such a re-save.

Applied to:
- the **Day-90 response PUT** (as assigned);
- the **health answer PUT** (the same flaw);
- the **agenda item PATCH** of `materialsEvidenceIds` (hidden materials are appended back);
- the **custom-field values PUT** (a hidden attachment id stays in its list; a hidden single reference stays when the writer sends null or omits it).

Writes that **name** a hidden id keep their existing answers, as before (D-218).

## 3. `listEvidenceVersions`: the reach check

`GET /transformations/{t}/evidence/{evidenceId}/versions` now calls `requireRecordReach(…, "evidence", evidenceId, target)` after the register read gate. A sensitive evidence item the reader is not admitted to answers **404**, like its own GET; the denial is logged with the record. The contract summary says so; 404 was already declared.

Test (`access/sensitive-reach-id-refs-writes.test.ts`):
- TL gets 404 on the sensitive item's versions, and on the item, and the body carries no title;
- the admitted TL and the TO get 200;
- TL gets 200 on an open item's versions.

## 4. Tests

### The extended sweep (`access/sensitive-reach-sweep.test.ts`)

`secondHalfSetup` creates one new evidence item, verified by another person (ADR-0018), references it from **every** reference kind, then has the TO mark it sensitive. The kinds:
- diagnose workstream output;
- phase-step evidence on `transform.deliver_pilots`;
- KPI RAG override, in force on the filler's KPI definition, plus an extra `getKpiStatus` read of that slot;
- deliverable external change, flagged then confirmed by reviewed evidence on the filler's deliverable, plus an extra read;
- inherited-approval dispensation, which also appears as `listInheritedRecords`' `prior_approval` entry;
- agenda item materials on the sweep's meeting;
- TOM canvas box evidence (`evidence_link`);
- Day-90 response on the demo's open test, keeping `answered_count` true.

Each direct insert carries its audit event (the 0004 guard). Reads that the contract filler cannot reach are added as `extraReads`: `listPhaseStepEvidence`, the KPI status slot and the deliverable confirmation.

**Not seeded**, with the reason logged by the test itself:
- `inherited_record` of kind evidence: the database admits it only in a Modular transformation, and the demo's is not one. It is covered through the `prior_approval` entry, which has the same member and the same redaction.
- `health_assessment_answer` and `gate_condition_closure`: the demo has no assessment and no approved G5 decision.
- A G5 submission snapshot: the demo has none.

These kinds are covered by the dedicated tests below.

**Results:**
- Before the fix, with `apps/api/src` reverted by `patch -R`: **1 failed, 36 id leaks over 12 request ids (11 operations)**. The operations: `listWorkstreamOutputs`, `getWorkstreamOutput`, `getTomCanvas`, `getTransformationReadiness`, `listGateDispensations`, `listRagOverrides`, `listAgendaItems`, `listInheritedRecords`, `getDeliverableConfirmation` (twice), `listPhaseStepEvidence` and `getKpiStatus`; each leaked to TL, AUD and AUD(org). Log: `01-before-fix-sweep.log`.
- After the fix: **2 passed** (`02-after-fix-sweep.log`).

### Dedicated tests

- **New** `access/sensitive-reach-id-refs-writes.test.ts` (demo dataset; TL against a granted TL with the same write rights). 5 tests:
  - `listEvidenceVersions` 404 and 200 (above);
  - the Day-90 re-save rule: null keeps, absent keeps, no `evidence_id` in the audit changes, another id replaces, the admitted writer clears with null;
  - health: TL's PATCH and answer PUT responses never name E, TL's re-save keeps E, the admitted writer clears it;
  - agenda: TL reads the materials without E (marked), TL's PATCH to `[]` keeps E stored, the admitted reader sees E;
  - register-kit write response: TL's workstream-output PATCH response shows `evidenceId: null` plus the marker, the stored link stays, the admitted reader sees it.
- **New** `forms/custom-values-restricted.test.ts` (1 test): T01 with an attachment field and a reference field. TL's GET omits E and nulls the reference (marked). TL's re-save keeps both. An explicit other reference replaces it. The TO sees everything.
- **Added to** `workflows/gate-conditions.test.ts` (1 test): the owner (not admitted) closes citing a sensitive evidence item. The 201 body shows `evidenceId: null` plus the marker, the stored closure keeps the id, and the TO's list shows it.
- **Added to** `sustainment/closure.test.ts` (1 test): after a closure, the benefit is marked sensitive. AUD's closure records show `snapshot.benefits: []` plus the marker, with the basis unchanged. The TO sees the entry.

**Before the fix**, each new test failed:
- `03-before-fix-writes.log`: 6 failed, and the 5 pre-existing tests of the two files passed;
- `04-before-fix-custom-values.log`: 1 failed;
- `05-before-fix-closure.log`: 1 failed, 9 passed.

### Web, en and ar

The screens reuse the existing `access.includesRestrictedRecords` strings ("Includes restricted records" / "يشمل سجلات مقيدة") through `RestrictedRecordsLabel`. No new string is needed.

- `DispensationsPage.tsx`: an inherited approval whose evidence is restricted shows the label (`data-evidence="restricted"`), never "Evidence: None" (which would now be untrue). Test: `dispensations.test.tsx`, en and ar.
- `DesignPage.tsx` (canvas box view): shows the label, and no longer says "No evidence linked" when a linked item is restricted. Test: `p2.test.tsx`.
- `ExternalConfirmationPanel.tsx`: the "Confirmed by reviewed evidence" provenance shows the label when the evidence is restricted.

The other screens need no change:
- The phase-step evidence row is omitted.
- The agenda materials and RAG override evidence are not rendered as links in the SPA.
- The Day-90 page already sends `evidenceId: null` on re-save, which the new rule keeps.

## Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/sensitive-reach.ts`, `access/index.ts` | New helpers: `hideRestrictedTypedRefs` (polymorphic type and id), `hideRestrictedRefLists` (id lists), `keptRestrictedRef` (the re-save rule). |
| `apps/api/src/modules/transformations/register-kit.ts` | Optional principal-aware `redact` hook on every register response. |
| `apps/api/src/modules/transformations/registers.ts` | Workstream outputs: the `redact` hook. |
| `apps/api/src/modules/workflows/phase-steps.ts` | Restricted step-evidence links are not listed. |
| `apps/api/src/modules/forms/custom-values.ts` | Values redaction; `keepRestrictedValues` on PUT. |
| `apps/api/src/modules/reporting/modular.ts` | Inherited records' `evidenceId`. |
| `apps/api/src/modules/kpi/rag-overrides.ts`, `kpi/kpi-status.ts` | Override evidence (list, writes, KPI status). |
| `apps/api/src/modules/portfolio/deliverable-confirmation.ts`, `dispensations.ts`, `readiness.ts` | Confirmation, dispensation and readiness evidence. |
| `apps/api/src/modules/governance/agenda.ts` | Materials redaction; PATCH keeps hidden materials. |
| `apps/api/src/modules/workflows/canvas.ts` | Restricted canvas evidence not listed; box marker. |
| `apps/api/src/modules/workflows/gate-conditions.ts` | Close response redaction. |
| `apps/api/src/modules/health/assessments.ts` | Every write response redacted; answer re-save rule. |
| `apps/api/src/modules/launch/day-ninety.ts` | Response re-save rule. |
| `apps/api/src/modules/evidence/register.ts` | `listEvidenceVersions` reach check. |
| `apps/api/src/modules/sustainment/closure.ts` | Closure snapshot redaction. |
| `packages/shared/src/schemas/{diagnose,forms,missing-links,kpi-actuals,portfolio,governance-workflow,decision,sustainment-closure}.ts` | Zod mirrors: optional markers; `ragOverride.evidenceId` and `ragOverrideInForce.evidenceId` nullable. |
| `docs/api/openapi.yaml` | The same members, each described; the `listEvidenceVersions` summary. |
| `apps/web/src/pages/dispensations/DispensationsPage.tsx`, `pages/design/DesignPage.tsx`, `components/external-confirmation/ExternalConfirmationPanel.tsx` | Restricted label (en/ar). |
| `apps/web/src/pages/dispensations/dispensations.test.tsx`, `apps/web/src/pages/p2.test.tsx` | Web tests of the label. |
| `apps/api/test/integration/access/sensitive-reach-sweep.test.ts` | `secondHalfSetup`, `seedRow`, `extraReads`. |
| `apps/api/test/integration/access/sensitive-reach-id-refs-writes.test.ts` (new) | The write-side and versions tests. |
| `apps/api/test/integration/forms/custom-values-restricted.test.ts` (new) | Custom values. |
| `apps/api/test/integration/workflows/gate-conditions.test.ts`, `sustainment/closure.test.ts` | One added test each. |

## Operations routed

None. Every change modifies an existing operation, and no operation was added. Delta to my `p6-pending-*.ts` list: **none**.

## Contract, schema and dependency needs (for the orchestrator)

- **Additive optional members** (`includesRestrictedRecords`, `const: true`) on `WorkstreamOutput`, `FormCustomValues`, `InheritedRecord`, `GateDispensation`, `AgendaItem`, `TomCanvasCellView`, `ClosureRecord`, `RagOverride` and the `DeliverableConfirmation.externalChange` object. Also `evidenceRestricted` on `RagOverride` and `RagOverrideInForce`.
- **One type widening (please confirm):** `RagOverride.evidenceId` and `RagOverrideInForce.evidenceId` change from `Uuid` (required, non-null) to `NullableUuid` (still required). Null only for a reader not admitted to the evidence, with `evidenceRestricted: true`.
  - An override is a governance record; omitting the row would hide that the RAG was overridden, which D-218 does not allow ("where the open record depends on it, a neutral restricted marker").
  - Stored evidence stays mandatory (`rag_override.evidence_required` is unchanged).
  - The SPA reads neither field.
  - I did not bump the contract version string. Please do so at merge if your process requires it.
- `pnpm openapi:lint` passes (932 operations).
- **Migrations:** none (the highest on the branch is `0126`).
- **Dependencies:** none.
- **ADR text:** ADR-0051 §2 should record:
  - D-218's re-save rule (`keptRestrictedRef`);
  - that a link row whose only purpose is a restricted record is not listed (phase-step evidence, canvas evidence, as for evidence links);
  - closure-snapshot redaction.

  That is the architect's file; I did not edit it.

## User-facing texts

- **Made untrue by the redaction, and fixed in both languages:**
  - The dispensation evidence cell would have said "Evidence: None" / "الدليل: لا يوجد" for an inherited approval whose evidence is restricted. It now shows the restricted label.
  - The canvas box would have said "No evidence linked." / "لا توجد أدلة مرتبطة." It now shows the label instead.
- No other en or ar string calls a feature I shipped "planned" or "later".
- No new string.

## What remains

- The phase-step evidence **remove** response echoes its link's `evidenceId`, a required uuid, to a writer who names the link id. A not-admitted reader can no longer obtain that id from the list. Nulling it would be a contract type change; say if you want it.
- BE-Z10's two open decisions are unchanged (audit-trail `recordId`, grant-register `recordId`; excused in the sweep's `ID_REF_ALLOWED`).
- The sweep cannot seed three kinds in the demo dataset: an inherited record of kind evidence (Modular only), a health answer and a gate-condition closure (no assessment and no approved G5), and a G5 submission snapshot. Each is covered by a dedicated test or by BE-Z10's gate-snapshot redaction, as listed under "Not seeded".

## Checks run

**Environment:**
- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline.
- Disposable PostgreSQL 16.15 via `tests/qa/support/with-pg.sh` (UTF8, C locale).
- Harness ports 31050–31099 only.
- Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Z10B-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `00-validate-dg5-historical.log` |
| 1 | `with-pg.sh npx vitest run --configLoader runner --project integration …/access/sensitive-reach-sweep.test.ts`, `apps/api/src` reverted with `patch -R` | 1 (expected) | 1 failed, 1 passed; 36 id leaks over 12 request ids | `01-before-fix-sweep.log` |
| 2 | the same, final source | 0 | 2 passed | `02-after-fix-sweep.log` |
| 3 | `with-pg.sh … access/sensitive-reach-id-refs-writes.test.ts workflows/gate-conditions.test.ts`, source reverted | 1 (expected) | 6 failed (all new tests), 5 passed (pre-existing) | `03-before-fix-writes.log` |
| 4 | `with-pg.sh … forms/custom-values-restricted.test.ts`, `custom-values.ts` reverted | 1 (expected) | 1 failed | `04-before-fix-custom-values.log` |
| 5 | `with-pg.sh … sustainment/closure.test.ts`, `closure.ts` reverted | 1 (expected) | 1 failed, 9 passed | `05-before-fix-closure.log` |
| 6 | `with-pg.sh npx vitest run --configLoader runner --project integration <116 files>` (list in `30-files.txt`), final source | 0 | **116 files: 1190 passed, 1 todo** (20 min) | `31-integration-touched.log` |
| 7 | `pnpm -r typecheck` (final tree) | 0 | all packages Done | `10-typecheck.log` |
| 8 | `pnpm -r build` (final tree) | 0 | all packages Done | `14-build.log` |
| 9 | `pnpm lint` (final tree) | 0 | `eslint . --max-warnings=0`, clean | `11-lint.log` |
| 10 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final tree, after this handback was written; an earlier green run is `13-prettier-run1.log`) | 0 | `All matched files use Prettier code style!` | `13-prettier.log` |
| 11 | `pnpm openapi:lint` (final tree) | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `12-openapi-lint.log` |
| 12 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | 0 | unit-node 190 files / 2899 passed; unit-web 122 / 2071 passed; unit-formula-nocodegen 3 / 259 passed + 2 skipped | `20-pnpm-test-locale-unset.log` |
| 13 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | the same counts | `21-pnpm-test-C.UTF-8.log` |
| 14 | `E2E_PG_PORT=31070 E2E_API_PORT=31080 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --project=chromium-en --project=chromium-ar` (real stack: built API, SPA and worker; run while the integration run was going) | 0 | **4 passed** (a13: en 11.0 s, ar 11.4 s; a22: en 1.8 m, ar 1.7 m) | `40-e2e-a22-a13.log` |
| 15 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `50-validate-dg5-historical-end.log` |

**The 116 integration files:**
- `access/` (all, including the new write test and the extended sweep) and `access-derived-race`;
- `forms/` (all, including the new custom-values test);
- `health/`, `launch/` and `evidence/` (all), plus `evidence.test.ts`;
- `governance/agenda` and `governance/meetings`;
- `portfolio/` `deliverable-confirmation`, `dispensations` and `readiness`;
- `workflows/` `gate-conditions`, `phases`, `g5-g6`, `modular-precondition` and `modular-waiver`;
- `sustainment/closure` and `sustainment/status-model`;
- `kpi-p4/` `overrides`, `status` and `actuals`;
- `reporting/modular` and `reporting/report-snapshots`;
- `transformations/` and `registers.test.ts`;
- `gates/` and `gates.test.ts`; `audit/`;
- `contract/` (including `contract.test.ts`);
- `operations/` (all 7, including the BE-Z6 race test `exception-recurrence-race` and the operational-exception files);
- `jobs/` and `automation/automation-failures`; `environment/`;
- worker: `job-runs`, `automation-failure-queue` (the failure queue and automation recovery), `worker-attempt`, `outbox`, `blocker-escalation`, `gate-condition-escalation` and `day-ninety-tasks`;
- QA: every `a13-*`, plus `a03-modular-entry`, `a16-launch-plan`, `a16-health-check`, `a17-s01-005-external-change`, `a22-operational-readiness` and `a22-p6-operability`.

The e2e budget rule does not apply: I added no e2e spec.

### Non-zero exits and superseded runs (all disclosed; the logs are kept)

- `01a`–`01d-before-fix-sweep-setup-abort-*.log`: exit 1. Four attempts of the before-fix sweep that stopped in my new setup, before any request; each found a database rule my direct inserts had to respect:
  - an inherited record is Modular only;
  - an external change is flagged unconfirmed first;
  - only verified evidence confirms;
  - a Day-90 test's `answered_count` must match its responses.

  I fixed the setup each time. Row 1 is the first complete before-fix run.
- `20a-pnpm-test-locale-unset-run1-cc-writes-artefact.log`: exit 1, 1 failed (`architecture.test.ts`: `expected [ '.claude' ] to deeply equal []`). The harness recreates empty `.claude/.cc-writes` directories in a source folder when my shell's working directory is inside it, and `apps/api/src/modules/.claude` looked like an unmapped module. I removed the empty directories (as the assignment says) and re-ran: rows 12 and 13 are green. Not a code defect.
- `10/11/12/14-*-run1.log`: green runs, possibly started before my last source edit (closure redaction). All four were re-run on the final tree (rows 7–9 and 11). The e2e stack used a build that already contains that edit: `apps/api/dist/modules/sustainment/closure.js` holds `shownClosure`.
- During development I ran the new test files a few times while fixing my own test mistakes; those logs are not kept:
  - the health scheme allows only yes/no, and I had used "partial";
  - the demo has no approved G5 decision, so the condition test moved to `gate-conditions.test.ts`;
  - a log path with an unset variable failed to open ("Read-only file system").

  The kept logs are the before-fix runs (rows 1, 3–5) and the final-tree runs (rows 2 and 6).
- No flaky or timed-out test was observed.

## Merge instructions

- No migration and no new dependency.
- Expect conflicts only in the files listed above.
- `openapi.yaml` and the zod mirrors change together.
