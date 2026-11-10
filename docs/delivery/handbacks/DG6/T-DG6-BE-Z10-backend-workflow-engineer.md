# Handback T-DG6-BE-Z10 (backend-workflow-engineer): open records no longer name restricted record ids (F-DG6-420, D-218)

- **Stage:** DG6, FIXING after review round 6. Task T-DG6-BE-Z10. Finding F-DG6-420 (Medium, REQ-S10-002).
- **Invocation:** `DG6-T-DG6-BE-Z10-backend-workflow-engineer-20261107T162401Z-21fa21c6`, session `21fa21c6-e847-4bb7-ae7f-46a7a1fa5b8d`.
- **Base:** branch `dg6/be-z10` at `a2413d43579384fa0ff41de266a4257ecbd94596` (the BE-Z9 merge). The tree was clean at the start. All changes are **uncommitted**, as asked.
- **Times:** start `2026-11-07T16:24:13Z`; end recorded in the checks section.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exits 0 (`PASS gate DG5 (historical)`; at the start in `00-validate-dg5-historical.log`, and again at the end).
- **Product gates:** marking a record sensitive is an access decision, never a business approval. Nothing here grants or implies G1–G6, and nothing touches DG0–DG7. All test data is SYNTHETIC.

## Assignment discrepancy (please confirm)

The assignment's handback section names `docs/delivery/handbacks/DG6/T-DG6-BE-Z8-backend-workflow-engineer.md` and `T-DG6-BE-Z8-evidence/`. Both already exist: they are the merged handback of the earlier task T-DG6-BE-Z8 (F-DG6-380). Overwriting them would destroy that record, so I did **not** touch them. I wrote this handback to the protocol's default path for this task, `docs/delivery/handbacks/DG6/T-DG6-BE-Z10-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-BE-Z10-evidence/`. I read this as a copy error in the assignment; the agent protocol says to report such contradictions rather than guess.

## What D-218 required, and what I did

D-218 says: a response never names the id of a sensitive record the reader is not admitted to. The reference is omitted. Where the open record depends on it, the response carries a neutral restricted marker without an id plus `includesRestrictedRecords: true`, and the screen shows the restricted label instead of a link.

### The shared helpers (`apps/api/src/modules/access/sensitive-reach.ts`, exported from `access/index.ts`)

All of them sit on top of the existing `restrictedRecordRefs` (ADR-0051 §2; one query when nothing is marked in the reader's organizations, so DG1–DG5 responses are unchanged until someone marks a record):

- `restrictedIdsOf(db, principal, recordType, ids)`: the ids among `ids` that the reader is not admitted to.
- `hideRestrictedRefs(db, principal, recordType, items, field)`: for items with one nullable reference, sets that field to null and adds `includesRestrictedRecords: true`.
- `redactRestrictedIds(db, principal, value)`: read-time redaction of a free-form or frozen body (a gate submission snapshot or criterion details). Every uuid, or `<type>:<uuid>`, is checked as a benefit, business case or evidence id, and a typed ref also as its own type. A hidden id that is an array element is dropped. An array element that is an object with a property equal to a hidden id (an evidence entry) is dropped. Any other property equal to a hidden id becomes null. The stored body and its hash are unchanged.
- `restrictedIdsAmong(db, principal, ids)` and `uuidsIn(value)`: for uuids of unknown type (audit `changes`), including uuids inside compound texts such as dedupe keys. A uuid is checked as a benefit, business case or evidence id, and as a child type **only where that child row exists**. This avoids the fail-closed rule of `sensitiveOwnersOf` restricting unrelated ids.

### Per field: what I found and what changed

"TL" means a reader in scope without a grant (gets 404 on the record); "TO" means an admitted reader. Admitted readers get every id and no marker, in every row below.

| Response (operation) | Field | Found before the fix | Now |
|---|---|---|---|
| `listBenefitGroups`, `getBenefitGroup` (and the create/PATCH responses) | `countedBenefitId`, `memberBenefitIds` | Named the hidden benefit (the F-DG6-420 repro). | The hidden member is omitted. A hidden counted member becomes `countedBenefitId: null` with **`countedBenefitRestricted: true`**, so a counted member is never shown as "none named". The group carries `includesRestrictedRecords: true`. A TL rename without `countedBenefitId` keeps the hidden counted member (tested). |
| `getBenefitMeasurement`, `listBenefitMeasurements` (and create/PATCH/submit responses) | `evidenceIds` | Named the hidden evidence (the repro). | Omitted, plus `includesRestrictedRecords: true`. |
| `listBenefits` (T14 register rows) | `latestEvidenceIds`, `evidenceCount` | Named the hidden evidence, and counted it. | Omitted and not counted (no hidden count, per the ADR-0051 amendment), plus `includesRestrictedRecords: true`. |
| `listEvidenceRegister` | the item itself; `links[]` | Listed a **sensitive evidence item itself**, including its title, and links to hidden records. This was a content leak, not only an id. | A restricted item is not listed (lists omit the row). A link to a restricted record (sensitive record or value child) is omitted, and the item carries `includesRestrictedRecords: true`. |
| `listEvidenceLinks` | row (`evidenceId`, `recordId`) | Listed links of the hidden evidence. | A link whose evidence or linked record is restricted is not listed. |
| `getDayNinetyTest` (and the PUT/complete responses) | `evidenceSuggestions[]`, `response.evidenceId` | Suggested the hidden evidence, with its **title as the label**, and named the response evidence. | A restricted suggestion is not offered. A restricted response evidence becomes `evidenceId: null`. The test carries `includesRestrictedRecords: true`. |
| `listFundingDecisions`, `getFundingDecision` | `businessCaseId` | Named the hidden case. | `businessCaseId: null`, **`businessCaseRestricted: true`**, `includesRestrictedRecords: true`. |
| `getBusinessCaseTotals` | `includedCaseIds` | Named the hidden initiative case. | Omitted, plus `includesRestrictedRecords: true`. The totals are unchanged (D-195 Q3). |
| `listBusinessCases`, `getBusinessCase` (and create/PATCH/archive responses) | `parentCaseId` | Named the hidden transformation case. | `parentCaseId: null`, **`parentCaseRestricted: true`**, `includesRestrictedRecords: true`. |
| `listGates`, `getGate` (GateView) | `criteria[].unverifiedEvidenceIds`, `currentSubmission.snapshot` | Named the hidden evidence and the hidden case. | Redacted with `redactRestrictedIds`, plus `includesRestrictedRecords: true` on the view and on the submission. |
| `listGateSubmissions`, `getGateSubmission` | `snapshot` (frozen), `criteria[].detail` | Named the hidden evidence and the hidden case. | The shown snapshot and details are redacted, plus `includesRestrictedRecords: true`. **The stored snapshot and `snapshotSha256` are unchanged**, so a redacted snapshot does not verify against the hash; the contract text says so. |
| `listExecutiveDecisions`, `getExecutiveDecision` (and create/PATCH/outcome responses) | `blockerRecordId` | Named the hidden benefit's variance case: a child that carries its values and answers 404 to TL. | `blockerRecordId: null`, **`blockerRecordRestricted: true`** (the type stays: it carries no identifier), plus `includesRestrictedRecords: true`. |
| `listFinanceValidations`, `getFinanceValidation` | `content.evidence` (frozen snapshot) | Can name hidden evidence. Found by reading the code; the seed had no such case, so the sweep could not see it. | Omitted from the shown content, plus `includesRestrictedRecords: true`. The stored content is unchanged. |
| `listKpiActuals`, `getKpiActual`, review queue, submission responses | `values[].evidenceIds` | Can name hidden evidence (reviewer's list; code reading). | Omitted, plus `includesRestrictedRecords: true` on the slot. |
| `listBauHandovers`, `getBauHandover` | `evidenceIds` | Can name hidden evidence (reviewer's `sustainment-areas.ts:167`; code reading). | Omitted, plus `includesRestrictedRecords: true`. `missingItems` is unchanged: the handover holds that evidence whoever reads it. |
| `listGateConditions` | `evidenceId` (reviewer's `approval-routes.ts:96`) | Can name hidden evidence (code reading). | `evidenceId: null` plus `includesRestrictedRecords: true`. |
| `getHealthCheck` | `answers[].evidenceId` (reviewer's `health.ts:57`) | Can name hidden evidence (code reading). | `evidenceId: null` plus `includesRestrictedRecords: true` on the answer. |
| `listTransformationAudit`, `listAuditEvents`, `getAuditEvent` | `changes` of an **open** record's event | Named hidden ids in changed values: a group's `counted_benefit_id`, an ask's `blocker_record_id`. | Such an event is redacted the same way as a restricted record's event (`changes` and `reason` null; `redacted: true` on the global API). The audit module receives `restrictedIdsAmong` from `server.ts`, because audit cannot import access (ADR-0002). |
| `listTransformationAudit`, `listAuditEvents` | `recordId` of a restricted record's own event | Named. | **Not changed; needs your decision.** See "Decision needed" below. |
| `listSensitiveGrants`, `getSensitiveGrant` | `recordId` | Named to readers with `sensitive_record.read` (AUD). | **Not changed; needs your decision.** See below. |

KPIs, risks and decisions are **not** in the ADR-0051 sensitive set (`SENSITIVE_RECORD_TYPE_LIST` = benefit, business case, evidence), so a KPI, risk or decision id is never "restricted" in itself. Where such a record names a sensitive record or a value child (for example an executive decision's blocker), the row above covers it.

### Writes

Writes that name a hidden id keep their existing answers (D-218). I changed no write path, with these consequences:

- Measurement evidence linking is additive (`linkEvidence` only inserts), so a not-admitted editor cannot drop a hidden link by saving.
- The group dialog does not offer the counted-member picker when the counted member is restricted, so a rename never sends `countedBenefitId`.
- `PATCH` of a group without `countedBenefitId` keeps the hidden counted member (asserted in the ported test).

### Web (en and ar)

The screens reuse the existing `access.includesRestrictedRecords` strings ("Includes restricted records" / "يشمل سجلات مقيدة") through `RestrictedRecordsLabel`. No new string is needed.

- `apps/web/src/pages/benefits/RegisterPages.tsx` (benefit groups register): a restricted counted member shows the label (`data-counted-member="restricted"`), never a link and never "none counted". A restricted member adds a label item (`data-restricted-member`) instead of a link. The edit dialog hides the counted-member picker when the counted member is restricted.
- `apps/web/src/pages/benefits/BenefitsPage.tsx` (T14 register): the evidence cell shows the label when the row carries `includesRestrictedRecords`.
- `apps/web/src/pages/reports/EvidenceRegisterPage.tsx` (evidence register): the links cell shows the label.
- `apps/web/src/pages/benefits/MeasurementPage.tsx`: the evidence field shows the label.

## Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/sensitive-reach.ts`, `access/index.ts` | The helpers above. |
| `apps/api/src/modules/benefits/groups.ts` | Group members, counted member and marker. |
| `apps/api/src/modules/benefits/measurements.ts` | Measurement `evidenceIds`. |
| `apps/api/src/modules/benefits/register.ts` | T14 rows: `latestEvidenceIds` and `evidenceCount`. |
| `apps/api/src/modules/benefits/finance-validation.ts` | Validation `content.evidence`. |
| `apps/api/src/modules/evidence/register.ts`, `evidence/routes.ts` | Evidence register items and links; evidence-link list rows. |
| `apps/api/src/modules/launch/day-ninety.ts` | Day-90 suggestions and response evidence. |
| `apps/api/src/modules/portfolio/funding.ts` | Funding decision business case marker. |
| `apps/api/src/modules/kpi/business-cases.ts` | Totals `includedCaseIds`; the case `parentCaseId` marker. |
| `apps/api/src/modules/kpi/actuals.ts` | KPI actual value `evidenceIds`. |
| `apps/api/src/modules/workflows/gates.ts` | Gate view and submission redaction. |
| `apps/api/src/modules/workflows/gate-conditions.ts` | Condition `evidenceId`. |
| `apps/api/src/modules/governance/executive-decisions.ts` | Blocker marker. |
| `apps/api/src/modules/sustainment/handovers.ts` | Handover `evidenceIds`. |
| `apps/api/src/modules/health/assessments.ts` | Health answer `evidenceId`. |
| `apps/api/src/modules/audit/routes.ts`, `apps/api/src/server.ts`, `apps/api/src/modules/transformations/routes.ts` | Audit: redact an open record's event whose `changes` name a restricted id. |
| `packages/shared/src/schemas/{benefits,benefit-values,evidence-register,day-ninety,portfolio,business-case,gate,executive-decisions,kpi-actuals,sustainment-areas,approval-routes,health}.ts` | Zod mirrors: the optional markers. |
| `docs/api/openapi.yaml` | The same optional members, each described (additive). |
| `apps/web/src/pages/benefits/RegisterPages.tsx`, `BenefitsPage.tsx`, `MeasurementPage.tsx`, `apps/web/src/pages/reports/EvidenceRegisterPage.tsx` | Restricted label instead of a link (en/ar). |
| `apps/web/src/pages/benefits/benefits.test.tsx` | Web tests in en and ar: the group's restricted counted member and member show the label with no link; a T14 row shows the label. |
| `apps/api/test/integration/access/sensitive-reach-id-refs.test.ts` (new) | The ported repro, asserting (5 tests). |
| `apps/api/test/integration/access/sensitive-reach-sweep.test.ts` | BE-Z7B sweep extended to identifiers (below). |

## Tests

**Ported repro** (`sensitive-reach-id-refs.test.ts`). Setup: the reviewer's (group BG-77 with a hidden counted member and an open member; a sensitive evidence item on an open measurement). Assertions:

- TL gets 404 on both hidden records; TO reads them.
- TL's group list and item never contain the hidden id; they show `countedBenefitId` null, `countedBenefitRestricted: true`, the open member only, and `includesRestrictedRecords: true`.
- TO gets both ids and no marker.
- TL's measurement item and list omit the hidden evidence id and are marked; TO sees it.
- A TL rename keeps the hidden counted member.

Before the fix: **3 failed, 2 passed** (`01-before-fix-id-refs.log`). After: 5 passed.

**Extended sweep** (`sensitive-reach-sweep.test.ts`). Over every callable GET of the contract, the sweep now also fails if a not-admitted reader (TL, AUD at the transformation, AUD at the organization, and the not-admitted admin controls) receives the id of any of these:

- the sensitive benefit, which is also the counted member of a synthetic group with an open member;
- a sensitive evidence item linked to an open benefit's draft measurement (a BO records the draft through the API when the seed has none);
- one demo evidence item and one demo business case per table that references one, all marked by the TO (the seed gives `evidence_link`, `business_case_line` and `funding_decision`);
- the sensitive benefit's variance case, a child that carries its values.

A request whose own path names the id is not judged on that id (an error body may echo it). Only the fields in `ID_REF_ALLOWED` are excused, each with its reason: `recordId` on the two audit lists and the two grant reads. An allowance that stops matching fails the test, so the list cannot go stale. The setup's own audit `requestId`s no longer embed record ids; the old one did, which was a test artefact.

- Before the fix (source reverted with `patch -R`): **1 failed, 77 id leaks over 18 operations** (`02-before-fix-sweep.log`).
- After: 2 passed (`03-after-fix-sweep-run-a.log`, and the touched-files run).

## Checks run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. Disposable PostgreSQL 16.15 via `tests/qa/support/with-pg.sh` (UTF8, C locale). Harness ports 31050–31099 only. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Z10-evidence/`. The final results come from the tree as handed back (after the two late fixes described under "Non-zero exits").

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `00-validate-dg5-historical.log` |
| 1 | `with-pg.sh npx vitest run --project integration …/access/sensitive-reach-id-refs.test.ts`, **before the fix** | 1 (expected) | 3 failed, 2 passed (5) | `01-before-fix-id-refs.log` |
| 2 | `with-pg.sh … sensitive-reach-sweep.test.ts` (extended), **source reverted with `patch -R`** | 1 (expected) | 1 failed, 1 passed; 77 id leaks over 18 operations | `02-before-fix-sweep.log` |
| 3 | `with-pg.sh npx vitest run --configLoader runner --project integration` over the three access files (`sensitive-reach`, `-sweep`, `-id-refs`), final tree | 0 | 3 files, **17 passed** | `32-access-after-fix.log` |
| 4 | `with-pg.sh npx vitest run --configLoader runner --project integration <77 files>` (list in `30-files.txt`), final tree, run while `pnpm test` ran alongside | 0 | **77 files: 826 passed, 1 todo** | `31-integration-touched.log` |
| 5 | `pnpm -r typecheck` | 0 | all packages Done | `10-typecheck.log` |
| 6 | `pnpm -r build` | 0 | all packages Done | `14-build.log` |
| 7 | `pnpm lint` | 0 | `eslint . --max-warnings=0`, clean | `11-lint.log` |
| 8 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | all files formatted | `13-prettier.log` |
| 9 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `12-openapi-lint.log` |
| 10 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | 0 | unit-node 190 files / 2899 passed; unit-web 122 / 2068 passed; unit-formula-nocodegen 3 / 259 passed + 2 skipped | `20-pnpm-test-locale-unset.log` |
| 11 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | the same counts | `21-pnpm-test-C.UTF-8.log` |
| 12 | `E2E_PG_PORT=31070 E2E_API_PORT=31080 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --project=chromium-en --project=chromium-ar` (real stack: built API, SPA and worker; run while the integration and unit runs were going) | 0 | **4 passed** (a13: en 11.2 s, ar 9.8 s; a22: en 1.8 m, ar 1.8 m) | `40-e2e-a22-a13.log` |
| 13 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `50-validate-dg5-historical-end.log` |

The 77 integration files are:

- `access/` (all 14 files, including the new test and the extended sweep) and `access-derived-race`;
- in `benefits/`: groups, measurements, register, finance-validation, totals and slice-b-denials;
- `evidence/` (all files) and `evidence.test.ts`;
- `gates/` and `gates.test.ts`;
- `audit/`, `health/` and `launch/`;
- `governance/executive-decisions`, `kpi/business-cases`, `kpi-p4/actuals`, `sustainment/handovers`, `workflows/gate-conditions`, `portfolio/funding` and `transformations.test.ts`;
- `contract/` (including `contract.test.ts`);
- `operations/` (all 7 files, including the BE-Z6 race test `exception-recurrence-race` and the operational-exception files);
- `jobs/` (`job-operations`, `job-schedules`) and `automation/automation-failures`;
- `environment/demo-day-ninety`;
- worker: `job-runs`, `automation-failure-queue` (the failure queue and recovery), `worker-attempt`, `outbox`, `blocker-escalation`, `gate-condition-escalation` and `day-ninety-tasks`;
- QA: `a13-*`, `a22-operational-readiness` and `a16-launch-plan`.

The new e2e budget rule does not apply: I added no e2e spec.

### Non-zero exits and superseded runs (all disclosed; the logs are kept)

- `20a-pnpm-test-locale-unset-run1-architecture-fail.log`: exit 1. `architecture.test.ts` (ADR-0002 module interface) rejected computed members with non-literal keys in my new helpers. I rewrote them with `Map`, `Object.entries` and `Object.fromEntries`.
- `31a-integration-touched-run1-2-failed.log`: exit 1, 76/77 files, 2 tests failed in `access/sensitive-reach.test.ts` (F-DG6-121/122: "a plain record is never redacted"). This was a real defect in my first `restrictedIdsAmong`: it checked unknown-type uuids against every child type, and `sensitiveOwnersOf` **fails closed** for a child row that does not exist, so unrelated ids got restricted and plain events were redacted. Fixed: a uuid is checked as a child type only where that child row exists.
- `32a-access-run-before-dedupe-key-fix.log`: exit 1. After that fix, the sweep found a restricted child id (the variance case) inside a **compound** text in an open event's `changes` (an inbox notification `dedupe_key` `corrective.follow_up:<caseId>:<userId>`). Fixed: the audit-side scan finds every uuid inside a string.
- `32b-access-run-missing-helper-typecheck-error.log`: exit 1. My own edit had accidentally removed `hideRestrictedRefs`; I restored it.
- `*-run-before-final-fix.log` (typecheck, lint, openapi lint, prettier, build, both `pnpm test` runs) and `03-after-fix-sweep-run-a.log`: green runs on the tree before the two fixes above. Every check was re-run on the final tree (rows 3–13).
- During the work I also ran the sweep several times while finding leaks (logs not kept); those runs exited 1 by design. One early "before-fix" attempt did not revert anything (`git checkout` cannot write the git index in this sandbox: "Read-only file system"). It ran on the fixed tree, passed, and is kept honestly as `03-after-fix-sweep-run-a.log`. The real before-fix run used `patch -R` (row 2).
- No flaky or timed-out test was observed.

**End:** `2026-11-07T18:05:10Z` (about 101 minutes).

## Operations routed

None. Every change modifies an existing operation. Delta to my `p6-pending-*.ts` list: **none**.

## Contract, schema and dependency needs (for the orchestrator)

- **Contract:** additive optional members only (D-195 Q3):
  - `includesRestrictedRecords` (`const: true`) on `BenefitGroup`, `BenefitMeasurement`, `BenefitRegisterRow`, `EvidenceRegisterItem`, `DayNinetyTest`, `FundingDecision`, `BusinessCaseTotals`, `BusinessCase`, `GateSubmission`, `GateView`, `GateSubmissionView`, `ExecutiveDecision`, `FinanceValidation`, `KpiActual`, `BauHandover`, `TrackedGateCondition` and `HealthCheckAnswer`;
  - the markers `countedBenefitRestricted`, `businessCaseRestricted`, `parentCaseRestricted` and `blockerRecordRestricted`.

  No required member and no type changed. `pnpm openapi:lint` passes (932 operations). I did not bump the contract version string; please do so at merge if your process requires it.
- **Migrations:** none.
- **Dependencies:** none.
- **ADR text:** ADR-0051 §2 should record D-218's rule, the markers, and the gate-snapshot redaction (the hash stays over the stored snapshot). That is the architect's file; I did not edit it.

## Decision needed (D-218 vs earlier ADR text)

1. **Audit trail `recordId`.** ADR-0051 §2 (T-DG6-BE-Y1) decided that a restricted record's audit events keep "actor, action, time, record id and versions" (`changes` and `reason` null, `redacted: true`). D-218's wording ("never names the id") conflicts with it for TL and AUD on `listTransformationAudit` and `listAuditEvents`.
2. **Grant register `recordId`.** ADR-0051 §7 says "an access administrator manages grants by record id". `listSensitiveGrants` and `getSensitiveGrant` show `recordId` to `sensitive_record.read` holders (AUD and the access admin).

I left both unchanged and excused only those `recordId` fields in the sweep, with these citations. If you decide D-218 overrides them, the change is small (null the field and mark the event), but `GlobalAuditEvent.recordId` is required, so the audit change would touch the contract.

## User-facing texts

No existing en or ar string became untrue. The screens reuse `access.includesRestrictedRecords` and `adminP6.restricted.hint`, which already exist in both languages.

## What remains (the separable second half, D-059/D-070)

The demo seed does not exercise these reference fields, so the sweep cannot judge them. I did not change them, and they still name a restricted id if one is linked:

- **Diagnose:** workstream outputs `recordId` and `evidenceId` (`diagnose.ts:104`; generic register kit in `transformations/registers.ts`).
- **Phases:** phase-step evidence (`phases.ts`, `workflows/phase-steps.ts`).
- **Forms:** form attachments and evidence references (`forms-framework.ts`).
- **Missing-links:** item evidence (`missing-links.ts`).
- **KPI RAG overrides:** `evidenceId` (`kpi-actuals.ts:341,357`; `kpi/rag-overrides.ts`).
- **Portfolio:** deliverable confirmation and dispensations evidence (`portfolio/deliverable-confirmation.ts`, `portfolio/dispensations.ts`).
- **Other evidence references:** agenda materials (`governance/agenda.ts`), canvas and G5 evidence (`workflows/canvas.ts`, `workflows/g5.ts`), the modular report (`reporting/modular.ts`), KPI status evidence (`kpi/kpi-status.ts`).
- **Report snapshot evidence lists:** `report.ts` (BE-Z9 handled report sections, not evidence ids).
- **Write responses of the gate-condition close and the health PATCH:** these show the writer's own reference and are not redacted.
- **Day-90 PUT:** it replaces the response's `evidenceId` (`body.evidenceId ?? null`), so a TL who re-saves an answer whose evidence is hidden clears that link. This is existing write behaviour, which the assignment says to keep; it should be decided with the second half.

Each should follow the same pattern (`hideRestrictedRefs` or `restrictedIdsOf` plus the optional marker), with a sweep extension that seeds a reference of that kind. I also noticed that `listEvidenceVersions` (`/evidence/{evidenceId}/versions`) has no sensitivity reach check. That is not an id leak, so I left it out of scope, but it should be checked.
