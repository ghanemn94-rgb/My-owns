# Handback T-DG6-ARCH-16 (solution-architect): architecture and contract texts for BE-Z9 to BE-Z12B (F-DG6-460, Low)

- **Stage:** DG6, FIXING after review round 7. Task T-DG6-ARCH-16. Finding F-DG6-460 (Low, not mandatory, REQ-S10-002). Decisions D-195 Q3, D-199, D-218, D-219, D-221, D-222 and D-223.
- **Invocation:** run `DG6-T-DG6-ARCH-16-solution-architect-20261108T120332Z-54e81779`, session `54e81779-64be-4617-b696-5f74d7dc92bf`.
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG6/T-DG6-ARCH-16.md`. Its sha256 `717badddb29655e706e9b0a3d811576074618ffee998a66061cbfa18d2c7973b` was checked at the start and matches.
- **Base:** branch `dg6/arch-16` at `95936867c` ("DG6: D-223; ARCH-16 brief covers BE-Z12B"). The tree was clean at the start. All changes are **uncommitted**, as asked.
- **Times (`date -u`):** start `2026-11-08T12:03:45Z`; end: see the last line.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exited **0** (`PASS gate DG5 (historical)`) at the start (`00-validate-historical-DG5-start.log`) and at the end (`10-validate-historical-DG5-end.log`).
- **Nature of the change:** docs and contract descriptions only. No behaviour, schema, migration, dependency or user-facing string changed.
- **Product gates:** nothing here grants or implies a G1–G6 business, Finance or IT approval, and nothing implies a DG0–DG7 result.

Logs are under `docs/delivery/handbacks/DG6/T-DG6-ARCH-16-evidence/`.

## 0. Contradictions in the assignment (protocol: "say so, do not guess")

1. **Handback path.** The brief says to write `docs/delivery/handbacks/DG6/T-DG6-BE-Z8-backend-workflow-engineer.md`, with logs under `T-DG6-BE-Z8-evidence/`. That file already exists: it is T-DG6-BE-Z8's handback for F-DG6-380. Overwriting it would destroy another task's record. I used the protocol default instead, `docs/delivery/handbacks/DG6/T-DG6-ARCH-16-solution-architect.md`, with evidence under `T-DG6-ARCH-16-evidence/`. Please confirm.
2. **Acceptance item 3** lists integration files (the worker job, failure-queue, automation-recovery, `operations` and operational-exception files, the BE-Z6 race test) and two e2e specs (`a22-p6-operability`, `a13-automation-recovery`). These look carried over from the BE-Z8 brief. This task changes no code, so none of them is a file "your change touches". What I ran instead and why is in §3.3. Item 3's own rule ("run every integration file your change touches") is met by the integration files that read the documents I changed.
3. **"Pending operations" / `p6-pending-*.ts`** does not apply: no operation was added or routed (§4).

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0051-p6-authorization-boundary-read-scope-sensitive-records-deep-links.md` | §2: the `ReportDocument` row of "Which responses carry `includesRestrictedRecords`" is corrected in place, with a pointer to the new amendment. A sentence after "Totals that are the same for every reader" covers aggregate records, and a new "Effect on reads" bullet points to the amendment. **New amendment (2026-11-08, T-DG6-ARCH-16)**, parts A–G: the report aggregate flag (BE-Z9) and the D-218 shapes (null + marker, typed, named flags, omitted ids, unlisted rows, redacted bodies, work items/My Work under D-222 (1), automation literals under D-222 (2)). It also records the contract widenings, the re-save rule, the write rule for hidden references, D-219's three exclusions, the schema-derived reference inventory, and the saved-view registry column (BE-Z11). |
| `docs/architecture/adr/ADR-0045-p5-generated-outputs-report-snapshots-owner-updates-presentation-evidence.md` | §3 "What a snapshot retains" gains a row for `report_snapshot_aggregate`. The "Absent when…" line of the 2026-11-06 amendment points to the aggregate rule. **New amendment (2026-11-08):** the aggregate rule, the new snapshot child table, `aggregates_recorded` and the legacy rule, and what does not change. |
| `docs/architecture/data-dictionary.md` | **New section "P6 round-6 repair migration 0126 (DG6)"**: `report_snapshot_aggregate` (columns, constraints, indexes, triggers and privileges as read from a migrated catalogue), `report_snapshot: changes in 0126` (`aggregates_recorded`, its trigger), the function, and the validation rules. A pointer was added to the `report_snapshot` (0080) entry. The section states that BE-Z10 to BE-Z12B changed no stored column. |
| `docs/architecture/erd.md` | **New §1ab.3** for `0126`: the relationship `report_snapshot ||--o{ report_snapshot_aggregate`, the notes, and the entity register row. |
| `docs/api/openapi.yaml` | **Descriptions only, no schema change** (31 lines; §2.2). |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-16-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-16-evidence/*` | Logs, plus the catalogue probe script (`01-catalog-probe.mts.txt`). |

## 2. Behaviour delivered, per requirement row

**REQ-S10-002**, acceptance (quoted): "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant".

No runtime behaviour changed; the runtime rule was verified for F-DG6-400 and F-DG6-480. F-DG6-460 is documentation drift. Its "expected" (quoted): "The texts that state the shipped rule match the code. … The data dictionary covers every migrated table." What now states each rule:

### 2.1 What each item of the brief asked, and where it is

| Brief item | Where |
|---|---|
| The aggregate flag rule (BE-Z9) | ADR-0051 §2 table row (corrected) and amendment A; ADR-0045 §3 row and amendment; OpenAPI `ReportDocument.sections` |
| D-218 id redaction with the restricted marker (BE-Z10, Z10B, Z12, Z12B) | ADR-0051 amendment B (shapes table, with the helper behind each); the OpenAPI field descriptions (§2.2) |
| The re-save rule | ADR-0051 amendment C; OpenAPI `BenefitUpdate.parentBenefitId`/`businessCaseLineId`, `LaunchTaskUpdate.outputRecordId`, `DayNinetyResponsePut.evidenceId`, `HealthCheckAnswerPut.evidenceId`, `FormCustomValuesPut.values`, `AgendaItemUpdate.materialsEvidenceIds`, `AutomationRuleContent` condition `value` |
| The write rule for hidden references (BE-Z12) | ADR-0051 amendment D (table of writes and their exact answers); OpenAPI `BenefitCreate`/`BenefitUpdate`, `LaunchTaskUpdate`, `MeetingOutputCreate.recordId`, `ProcedureStepEvidence.evidenceId`, `ProcedureStepComplete.outputRecordId`, `ProcedureLaunch.subjectRecordId` |
| D-219's exclusions | ADR-0051 amendment E; OpenAPI `AuditEvent.recordId`, `GlobalAuditEvent.recordId`, `SensitiveGrant.recordId`, `PhaseStepEvidence.evidenceId` |
| BE-Z12B (D-222, D-223): §5 "ADR text for the architect" items 1 and 2 | ADR-0051 amendment B (work-item and automation rows), C (automation re-save matched by field, operator, order and position) and D (D-223 (2) free-text trade-off); OpenAPI condition `value` (D-223 sentence added). `WorkItem`/`MyWorkItem` descriptions were already correct, from BE-Z12B. |
| BE-Z12 §5 "ADR text" items 1–4 | ADR-0051 amendments D (item 1), C (item 2), B "unlisted rows" (item 3) and F (item 4: the inventory is the reference list) |
| BE-Z10 / BE-Z10B ADR-text requests (markers, gate-snapshot hash, unlisted link rows, closure redaction, re-save) | ADR-0051 amendment B and C |
| `report_snapshot_aggregate`, `report_snapshot.aggregates_recorded`, migration `0126` | data dictionary (new section and pointer), ERD §1ab.3, ADR-0045 §3 |
| "Any table BE-Z12 changed" | **None.** BE-Z12 and BE-Z12B shipped no migration (both handbacks §5; the highest migration is `0126`). The dictionary section says so. |

### 2.2 OpenAPI descriptions changed

- **Two existing descriptions were rewritten or extended:**
  - `ReportDocument.sections`: it now states the aggregate rule, the four aggregate sections, true/false/absent, the live versus stored (`report_snapshot_aggregate`) source, and the legacy rule for `aggregates_recorded` false. The aggregate records are never shown, and nothing is stored.
  - The condition `value` of `AutomationRuleContent`: it adds that a marker with no hidden literal behind it is stored as an ordinary literal, and the D-223 free-text trade-off.
- **New property descriptions, each a `description` sibling of the existing `$ref` or type. Types, required lists and `additionalProperties` are unchanged:**
  - **read rule:** `Benefit.parentBenefitId`, `Benefit.businessCaseLineId`, `LaunchTask.outputRecordId`, `MeetingOutput.recordId`, `Approval.subjectId`, `ApprovalDecisionRecord.subjectId`, `DayNinetyResponse.evidenceId`, `HealthCheckAnswer.evidenceId`, `FormCustomValues.values`, `ProcedureInstance.subjectRecordId`, `.inputValues` and `.links`;
  - **write rule:** `BenefitCreate.parentBenefitId` and `.businessCaseLineId`, `MeetingOutputCreate.recordId`, `ProcedureStepEvidence.evidenceId`, `ProcedureStepComplete.outputRecordId`, `ProcedureLaunch.subjectRecordId` (accepted as an unknown id, no oracle);
  - **write and re-save:** `BenefitUpdate.parentBenefitId` and `.businessCaseLineId`, `LaunchTaskUpdate.outputRecordId` (re-save only when `outputRecordType` is unchanged, per `launch/tasks.ts`);
  - **re-save:** `DayNinetyResponsePut.evidenceId`, `HealthCheckAnswerPut.evidenceId`, `FormCustomValuesPut.values`, `AgendaItemUpdate.materialsEvidenceIds`;
  - **D-219:** `AuditEvent.recordId`, `GlobalAuditEvent.recordId`, `SensitiveGrant.recordId`, `PhaseStepEvidence.evidenceId`.
- **Already correct, left unchanged:** the 47 `includesRestrictedRecords` and named-flag descriptions that BE-Z10 to BE-Z12B added (listed from the contract, then checked against the inventory's `fix` texts), plus `WorkItem.subjectId`, `MyWorkItem.recordId` and `RagOverride*.evidenceId`.
- **Applied mechanically.** The edits were made by a scoped script. It failed unless each target property was found exactly once in its schema, and it skipped any property that already had a description. Each claim was checked against the code before it was written, including `keptRestrictedRef`, `refIsRestricted`, the benefit re-save loop, the launch-task re-save and write, `keepRestrictedLiterals`, `presentWorkItems` and the cursor, and `legacyAggregates`. The audit claim was checked against the schemas: `GlobalAuditEvent` has `redacted` and the transformation `AuditEvent` does not, and the two texts differ accordingly.

### 2.3 Claims I corrected while writing

- **Contract widenings.** No decision row confirms the `RagOverride*`/`Approval*` widenings. D-223 (1) confirms only `WorkItem.subjectId`/`MyWorkItem.recordId`. The ADR says so instead of claiming a decision (see §5).
- **The snapshot source and evidence lists** use `visibleRefs`, not `withoutRestricted`. The ADR table names both.

## 3. Checks actually run (Node 24.21.0; offline; harness port 31050)

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `00-validate-historical-DG5-start.log` |
| 1 | catalogue probe of `0126`: `QA_PG_PORT=31050 MTH_PORT_POOL=31050-31099 tests/qa/support/with-pg.sh node --conditions=@mth/source --experimental-strip-types <probe> <repo>` | 0 | PostgreSQL 16.15, UTF8/C; `migrate exit 0 118 applied`; the table, the column, constraints, indexes, triggers, grants and function | `01-catalog-0126.log`, `01-catalog-probe.mts.txt` |
| 2 | `pnpm -r typecheck` | 0 | | `02-typecheck.log` |
| 3 | `pnpm -r build` | 0 | | `03-build.log` |
| 4 | `pnpm lint` | 0 | | `04-lint.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `05-openapi-lint.log` |
| 6 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `06-prettier-check.log` |
| 7 | `node tools/gates/validate.mjs --register DG6` | 0 | `PASS register rules at DG6` | `07-validate-register-DG6.log` |
| 8a | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | unit-node **190 files, 2899 passed**; unit-web **123 files, 2082 passed**; unit-formula-nocodegen **3 files, 259 passed, 2 skipped** | `08a-test-locale-unset.log` |
| 8b | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | the same counts: 190/2899, 123/2082, 3/259 + 2 skipped | `08b-test-c-utf8.log` |
| 9 | `QA_PG_PORT=31050 MTH_PORT_POOL=31050-31099 tests/qa/support/with-pg.sh npx vitest run --project integration <6 files>` (§3.3) | 0 | **6 files, 190 tests passed** | `09-integration-docs-readers.log` |
| 11 | `E2E_PG_PORT=31060 E2E_API_PORT=31065 MTH_PORT_POOL=31060-31099 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --project=chromium-en --project=chromium-ar` (real stack: built API, SPA and worker) | 0 | **4 passed** (4.0 m; a13 en 8.9 s, ar 7.0 s; a22 en 1.8 m, ar 1.8 m), no retry | `11-e2e-a22-a13.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `10-validate-historical-DG5-end.log` |
| 12 | full prettier check, re-run after the last edit (the ADR-0051 widening sentence and this handback) | 0 | "All matched files use Prettier code style!" | `12-prettier-check-final.log` |

### 3.3 Integration and e2e: what I ran, and why

- **Non-zero exits, failures, flakes, timeouts:** none in any log cited here.
- **The 2 skipped tests** are `it.skipIf(NOCODEGEN)` cases of `packages/shared/src/formula/fuzz.test.ts`, by design in the no-codegen process. They predate this task.
- **The integration files (row 9).** A docs-only change can affect only the tests that read the changed files. These are the integration files that parse the contract, the ERD or the snapshot tables:
  - `apps/api/test/integration/contract/contract.test.ts`: the contract against the routes, and the pending and exercise lists;
  - `apps/api/test/integration/access/sensitive-reference-inventory.test.ts`: the inventory against the catalogue and the contract's operationIds;
  - `apps/api/test/integration/hardening/route-inventory.test.ts`: every mutating operation of the contract;
  - `tests/qa/integration/a09-decision-escalation.test.ts`: reads `docs/architecture/erd.md`;
  - `packages/db/test/integration/catalogue.test.ts`: the `0126` rules the dictionary now states;
  - `apps/api/test/integration/access/sensitive-reach-dashboards-reports.test.ts`: the BE-Z9 aggregate rule and legacy snapshots the ADR now states.

  Every other integration file that loads `openapi.yaml` validates responses against the schemas. No schema changed, only `description` texts, which no validator reads.
- **Acceptance item 3's own list** (the worker job, failure-queue, automation-recovery, `operations`, operational-exception and BE-Z6 race files) was **not run**. This task touches none of those files or the code they test (§0 item 2). The e2e specs it names were run anyway (row 11), because they are cheap, and they passed in both locales.
- **Full `pnpm test:integration`:** not run, as the brief allows. The orchestrator runs it on the merged tree.
- **e2e budgets:** I added no spec, so the budget rule does not apply.

## 4. Operations routed

None. No operation was added, removed or routed. The delta to the `p6-pending-*.ts` lists is **none**, and `contract.test.ts` is unaffected by description text. It was run in §3 row 9.

## 5. Contract, schema and dependency needs (for the orchestrator)

- **Contract:** description text only. No type, required list, enum or operation changed, and the version string stays `1.5.0-p6`. No gate needs reopening.
- **To confirm (record only, no change requested).** The widenings `RagOverride.evidenceId`/`RagOverrideInForce.evidenceId` (BE-Z10B) and `Approval.subjectId`/`ApprovalDecisionRecord.subjectId` (BE-Z12) were merged, but no decision row confirms them. D-223 (1) covers only the work-item pair. ADR-0051 amendment B records them "as merged". If you want a decision row, it would mirror D-223 (1).
- **Open design question, carried and not decided** (BE-Z9 §9 item 1; ADR-0051 amendment A, "Exports"): the rendered export files carry no restricted label for any section. This is stated, not changed.
- **Migrations:** none. The highest is still `0126`.
- **Dependencies:** none.
- **Observation for the owner of `packages/db/src/seed.test.ts`** (not changed; outside my files): the free-id example at line 1058 still uses `0126_p6_example.sql`, while `0126` now exists. The data dictionary's `0125` section says the example "moves to `0126`". I did not change either, because the test passes in §3 rows 8a and 8b. It is noted only so the next migration's author updates the example.

## 6. User-facing texts

None made untrue, and none changed. This task touches no en/ar string. The ADR quotes the existing keys `access.includesRestrictedRecords` ("Includes restricted records" / "يشمل سجلات مقيدة", Arabic provisional) and `inbox.restricted`, and the server phrase "a restricted record" / "سجل مقيد".

## 7. What remains

- Nothing of F-DG6-460's scope. Verification is by a non-author reviewer (the domain reviewer raised it).
- The items in §0 and §5 are for the orchestrator to confirm.

## 8. Merge instructions

- Docs and descriptions only, with no migration, no dependency and no build-order change.
- Expect textual conflicts only if another branch edits the same lines: the ADR-0051 §2 table row, the end of ADR-0051 or ADR-0045, the end of `data-dictionary.md`, the ERD just before "## 2. Conceptual model", or the listed OpenAPI property lines.

End: `2026-11-08T12:38:56Z` (`date -u`).
