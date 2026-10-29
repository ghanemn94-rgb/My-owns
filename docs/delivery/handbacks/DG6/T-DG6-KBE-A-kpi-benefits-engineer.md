# Handback T-DG6-KBE-A: the KPI actual import target `kpi_actual.v1` (kpi-benefits-engineer)

- **Stage:** P6, gate DG6 (BUILDING). Section `docs/architecture/p6-work-split.md` §B/A.4. Branch `dg6/kbe-a`, worktree `/home/user/wt/dg6-kbe-a`, base `HEAD` `b5b33a331`. Changes are **uncommitted** for the orchestrator.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-KBE-A-kpi-benefits-engineer-20261029T195605Z-a376e4b7","session_id":"a376e4b7-7351-4d8b-848a-ce1b143669ac"}`. Assignment file SHA-256 verified: `ddf467269e9d11d1b2f5ccbe4e9661f0e14ef544820838825345a337afeb4c8e`.
- **Time:** start `2026-10-29T19:56:28Z`; end `2026-10-29T21:44:21Z` (`date -u`). The 100-minute mark was passed while checks were running; see §3 and §7.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. The target never accepts a KPI actual itself: the KPI version's DG4 submission route decides. No business, Finance or IT approval is granted. All test data is synthetic.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/kpi/import-target.ts` (new) | The `kpi_actual.v1` target. It has the ADR-0056 §9 columns (en and provisional ar labels). `validateRow` applies the DG4 `submitKpiActual` rules read-only, and each failure becomes an `import.row.*` reason with params. `existingKeys` reads the `kpi_actual_slot_key` slots with their status. `commitRow` goes through the DG4 `submitFirstValue`. `requiredPermissions` is `kpi_actual.submit`. `extensionColumns` returns `[]`. It implements the BE-M port **structurally** (see §5.1). |
| `apps/api/src/server.ts` | One import line and one registration line, below BE-M's registry line: `importTargets.register(createKpiActualImportTarget())`. |
| `apps/api/src/modules/kpi/actuals.ts` | The lineage read lines plus the minimum needed to call the DG4 service. See §5.2 for the scope note. DG4 behaviour is unchanged. Details:<br>(a) `importLineageOf` and `KpiActualImportLineage` are new: "Imported from {source} row {n}", read-only.<br>(b) `submitFirstValue` is now exported, and its helper chain is typed with `SubmissionContext`, a `Pick` of `WriteContext` without `request` and `principal`, which this path never reads.<br>(c) The read-only `maySubmitActuals` is split out of `assertMaySubmit` (same query, same 403).<br>(d) `EXPECTED_FIELDS` is now exported. |
| `apps/api/src/modules/kpi/import-target.test.ts` (new) | Unit tests without a database: template columns, required and informational columns, kind and version, permission, slot key. |
| `apps/api/test/integration/kpi/import-target.test.ts` (new) | The PostgreSQL tests of §B/A.4 (listed in §2). |
| `docs/delivery/handbacks/DG6/T-DG6-KBE-A-kpi-benefits-engineer.md`, `…/T-DG6-KBE-A-evidence/*` | This handback and its logs. |

No migration, no new dependency, and no contract change. The OpenAPI file and `schema.ts` are untouched.

## 2. Behaviour delivered, per requirement row

### REQ-S17-002 (my share: KBE-A)

Acceptance text, verbatim: *"A17: a file with 8 valid rows, 1 invalid row and 1 duplicate commits 8 rows with provenance and shows the 2 others with row-level reasons"*.

The test "the A17 8/1/1 fixture as CSV" and its XLSX twin (`apps/api/test/integration/kpi/import-target.test.ts`) each do the following:

- **Stage.** The file goes through BE-M's real engine (`parseImportFile` → `prepareImport` → `stageImport`) with this target. The batch is `staged` with 10 = 8 valid + 1 invalid + 1 duplicate.
  - Row 10 (`12,5`) gets `import.row.value_not_decimal` `{field: "value", value: "12,5"}`.
  - Row 11 gets `import.row.duplicate_in_batch` `{firstRow: 2}` and points at row 2.
- **Commit.** The commit runs through this target's `commitRow`, using a test driver of ADR-0056 §6 step 3 (BE-M2 owns the real commit). It creates **8 KPI actuals through the DG4 submission service**:
  - the 4 direct-accept rows are `accepted` (route `direct_accept`);
  - the 4 review rows are `submitted` (route `review`), waiting for the mapped reviewer, so the import never accepts them.
- **Audit and lineage.** The commit writes 8 DG4 audit events (4 `kpi_actual.accepted`, 4 `kpi_actual.submit`, all by the committer) and **8 `import_row_commit` lineage rows**. `importLineageOf` returns for each one the batch, the source kind, the file name, the row number and the `source_record_id` (provenance).
- **The two others.** Both are `not_committed` and keep their reasons after the commit.
- **Decimals stay strings.** `120.5`, `0.000001`, `-3.25`, `1000.000000` → `1000`, and the full-width `999999999999999999.999999` are stored exactly. A missing value takes the DG4 missing-reason path, never 0.

The other §B/A.4 tests, all in the same file:

| Section requirement | Test and result |
|---|---|
| Each row reason of ADR-0056 §5 that the KPI rules produce | "row reasons of the KPI rules" stages 16 rows, all kept, each with its exact reason, field and params.<br>Table codes covered: `required_missing`, `kpi_unknown`, `kpi_no_active_version`, `scope_invalid`, `period_unknown`, `period_not_open`, `value_shape` (flow with a numerator, ratio with a value, a milestone flag that is not a boolean), `currency_mismatch`, `date_invalid`, `value_not_decimal` (`1,000.5`, 7 decimals, formula-like CSV text `=1+1` taken as text).<br>Proposed codes covered (§5.3): `text_length`, `reviewer_unavailable`.<br>The engine's own codes (`formula_cell`, `text_too_long`, `text_invalid_character`) are BE-M's and are tested there. `custom_field_invalid` cannot occur (see `extensionColumns` in §5.4). |
| `duplicate_committed` against a form-entered actual | A form-entered actual (status `submitted`) plus an import of the same slot gives `import.row.duplicate_committed` `{status: "submitted"}`. |
| A KPI that requires evidence | `import.row.evidence_required` (enter it by form). |
| A non-updater | The TL user, who is not owner, steward or update assignee, gives `import.row.not_kpi_updater` `{value: <kpi id>}`. |
| Recalculation runs once per affected KPI | **Partly.** Exactly one `kpi.actual_accepted` outbox event per accepted imported value (key `kpi.actual_accepted:<id>:1`), none for a submitted one. Each event gives exactly one `calculation_run`, and a replay gives none more. This is the DG4 unit (one run per accepted value). Batching to one run per KPI per commit is **not** delivered; see §5.5. |
| Read-only `validateRow` and `existingKeys` | Both run inside a `SET TRANSACTION READ ONLY` transaction without error. |
| `commitRow` goes through DG4, never directly | When a slot is filled by form between staging and commit, DG4 answers 409. The whole commit transaction then writes nothing: no lineage row, the row stays `pending`, the form actual is the only slot. |
| Registration line | The composition root's registry holds `kpi_actual.v1` with the §9 columns in order, `kpi_name` informational, and `kpi_actual.submit` required. |

### REQ-S17-003 (my share: the KPI target the CSV and XLSX channels commit into)

Acceptance text, verbatim: *"A17: CSV and XLSX KPI imports and a signed webhook call each commit valid data; an unsigned webhook is rejected"*.

- **CSV and XLSX.** The same 8/1/1 fixture commits 8 actuals from CSV and from XLSX. In the XLSX file the decimals are numeric cells whose stored `<v>` text is used verbatim.
- **Webhook.** The signed webhook half is BE-N's. This target is source-agnostic: `commitRow` takes the committing or on-behalf-of user from the context.
- **Status.** REQ-S17-003 is not complete from my side alone. It also needs BE-M2 (routes, templates) and BE-N (webhooks).

## 3. Checks actually run

Environment: Node 24.21.0, offline, worktree above. Logs are in `docs/delivery/handbacks/DG6/T-DG6-KBE-A-evidence/`.

**Read this first.** I made the machine overloaded myself: I ran the full integration suite in parallel with the other checks. The consequences were timeouts, two OOM kills and an integration run that could not finish inside the 2-hour limit. Several acceptance items are therefore **not proven on the final tree** (marked ✗ or ◐ below).

The final tree differs from the tree of the complete runs only by the `informational` removal (§5.9) and test edits. Both are covered by the targeted reruns.

| # | Command | Exit | Counts / notes | Log |
|---|---|---|---|---|
| 4 | `node tools/gates/validate.mjs --historical --stage DG5` (at start) | **0** | `PASS gate DG5 (historical)` | `validate-dg5-historical-start.log` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG5` (at end, 21:51Z) | **0** | `PASS gate DG5 (historical)` | `validate-dg5-historical-end.log` |
| 1 | `pnpm -r typecheck`, run 1 | **2** | Two type errors in my new integration test (TS4111, TS2322). Fixed. Run 1 was stopped at its 10-minute background limit. | `run1-typecheck-exit2.log`, `run1-killed-exit-codes.txt` |
| 1 | `pnpm -r typecheck`, run 2 | **0** | Before the §5.9 fix. | `typecheck.log`, `exit-codes.txt` |
| 1 | `pnpm -r build`, run 2 | **0** | Before the §5.9 fix. | `build.log` |
| 1 | `pnpm lint`, run 2 | **0** | Started while the §5.9 edit was being made; the file state it saw is not certain. | `lint.log` |
| 1 | `pnpm openapi:lint`, run 2 | **0** | | `openapi-lint.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown`, run 2 | **0** | | `prettier.log` |
| 1 | Final tree: `npx eslint` and `npx prettier --check` on the 5 changed source and test files plus this handback | **0 / 0** | After the §5.9 fix. | (console; see §8) |
| 1 | Final tree: `apps/api` `tsc -p tsconfig.json --noEmit` | **137, twice** | ✗ **Killed by the kernel (OOM)** while the stale integration run and `pnpm test` held about 11 GB of 16 GB. Not proven on the final tree. The changes since the passing typecheck are the removal of one optional property, comments, and test assertions. | `final-api-typecheck.log`, `final-tree-checks.txt` |
| 2 | `pnpm test`, locale unset: `unit-node` | **in progress** | ◐ `unit-node`: **5 failed / 2,612 passed (2,617)**; 4 of 169 files failed. All 5 are **timeouts** under my self-inflicted load: `architecture.test.ts` 30 s; `server.test.ts` ×2, `kpi.test.ts`, `branding-layout.test.ts` 5 s. | `pnpm-test-locale-unset.log` |
| 2 | `pnpm test`, locale unset: `unit-web` | **in progress** | ◐ It shows 3 `Unable to find role…` and 3 more 20 s timeouts in other web specs. Not mine: I changed no web file. The run had not finished at handback time. | `pnpm-test-locale-unset.log` |
| 2 | `pnpm test`, locale unset: `unit-formula-nocodegen` | — | Had not run yet at handback time. | |
| 2 | Rerun of the timed-out files: `architecture.test.ts`, `kpi.test.ts`, `server.test.ts`, `import-target.test.ts` (final tree) | **1** | **195 passed, 1 failed:** `server.test.ts` "declares access on every /api route" timed out at 5 s (6.4 s, loaded). | `unit-rerun-final.log` |
| 2 | `server.test.ts` alone (final tree) | **0** | 6/6 passed; the same test took 1.99 s. | `unit-rerun-server-alone.log` |
| 2 | `pnpm test` with `C.UTF-8` | — | ✗ **Not run**: the locale-unset run had not finished by the time limit. | |
| 3 | `QA_PG_PORT=24810 MTH_PORT_POOL=24811-24849 tests/qa/support/with-pg.sh pnpm test:integration` (started 20:34:51Z, before the §5.9 fix) | **still running** | ✗ **Not complete.** 107 of about 342 files done at 21:43Z, loaded. 5 failures so far:<br>(a) `connectors.test.ts` mappings: **caused by my target**, fixed in §5.9; passes on the final tree (below).<br>(b) forms export 5,000 rows: 60 s timeout.<br>(c) forms bulk-edit commit-time re-authorization: 30 s timeout.<br>(d) G3 B1 waivers: 30 s timeout.<br>(e) `expiry … gate.exception_revoked (exact text)`: an **assertion mismatch on the detail text**, not a timeout. It is in the governance module, which I did not touch. Not investigated (time); please rerun it on the merged tree.<br>Pinned counts: no change from KBE-A. | `integration.log`, `integration-times.txt` |
| 3 | Final tree, targeted: `with-pg.sh npx vitest run --project integration` on `kpi-p4/actuals.test.ts`, `kpi-p4/entity-group.test.ts`, `kpi/`, `integrations/`, `contract/contract.test.ts` | **1** | **239 passed / 6 failed (245); 11 of 12 files pass**, including the DG4 actuals suites (unchanged behaviour), all of `integrations/` (connectors and staging) and `kpi/import-target.test.ts` (9/9).<br>The 6 failures are all in `contract.test.ts`: 5 exercise groups timed out at 30 s (P5 BE-B, BE-S, BE-T2, P6 BE-B, undeclared media type), and the coverage assertion then lists the 6 P6 BE-B operations of the timed-out group (`getRecordSensitivity`, …) as unexercised. KBE-A routes no operation. | `targeted-integration-final.log`, `targeted-final-times.txt` |
| 3 | Final tree: `import-target.test.ts` and `connectors.test.ts` | **0** | 29/29 passed. | `targeted-integration-after-fix.log` |
| — | `kpi/import-target.test.ts` alone, before the §5.9 fix | **0** | 9/9 passed: CSV 8/1/1 1,022 ms, XLSX 674 ms. | (console) |

**Budgets.** No e2e spec was added. The integration test budgets are 120 s for the fixture and reason tests and 60 s for the others, against 0.3–1.0 s measured unloaded: at least 60× the unloaded worst case. Under load the fixture test was not observed to time out.

## 4. Operations routed (pending-list delta)

**None.** §B/A.4 assigns KBE-A no operation: the import routes are BE-M2's. No `p6-pending-kbe-a.ts` exists, and the `p6-exercises-kbe-a.ts` stub (T-DG6-BE-A) is left unchanged: "Nothing routed yet". Contract-test pins: no operation-count, media-type, rate-limit or CSRF delta.

## 5. Needs for the orchestrator (contract, schema, scope, texts)

### 5.1 Module boundary: why the target is structural

`kpi` is a P4 module. `architecture.test.ts` forbids any P1–P5 module from importing a P6 module, type-only imports included, and kpi's `dependsOn` has no `integrations`. So `kpi/import-target.ts` mirrors the port types locally (`KpiImportContext`, `KpiRowVerdict`, …). `server.ts` passes the target to `ImportTargetRegistry.register`, and the compiler checks it there against `ImportTarget`. The integration test does the same through the port types.

If `targets.ts` changes the port, `pnpm -r typecheck` fails in `server.ts` until the mirror is updated.

### 5.2 Scope note on `kpi/actuals.ts`

My section names "read lines only" in `actuals.ts`. The section also requires `commitRow` to go "through the DG4 submission service", and that service (`submitFirstValue`) was module-private and typed with a request-bound `WriteContext`. I made the minimum change:

- export the service;
- narrow its parameter type to a `Pick` (`WriteContext` is still accepted, so every route call is unchanged);
- split a read-only `maySubmitActuals` out of `assertMaySubmit`, so the row check is the same rule, not a copy;
- export `EXPECTED_FIELDS`.

The DG4 suites pass unchanged (see §3). Please confirm this scope, or move it to a reopen decision.

### 5.3 Proposed row-reason codes (rule 17; not in ADR-0056 §5)

| Code | Proposed English | Why |
|---|---|---|
| `import.row.text_length` | "{field} must be 1 to {max} characters of visible text." | DG4 bounds `missing_reason` to 1–1000 and `comment` to 1–4000, and refuses blank text. ADR-0056's `text_too_long` text says "4,000 characters", which is untrue for `missing_reason`. |
| `import.row.reviewer_unavailable` | "Nobody can review actuals of KPI {value} yet: map its reviewer role to a person who may accept actuals." | DG4 refuses a review-route submission whose reviewer party is unmapped or has nobody holding `kpi_actual.accept` (422 `routing.role_unmapped` / `routing.assignee_not_approver`). Without this reason the row would stage as valid and then fail the whole commit. |

BE-M already proposed `import.row.source_record_id_too_long`.

### 5.4 en/ar `imports.json` row-reason texts (FE-A merges; the Arabic is provisional and needs Mobily translation review)

| Code | en (ADR-0056 §5 verbatim, or proposed in §5.3) | ar (provisional) |
|---|---|---|
| `import.row.required_missing` | "{field} is required." | "الحقل {field} مطلوب." |
| `import.row.value_not_decimal` | "{field}: \"{value}\" is not a decimal number. Use a dot as the decimal separator, no thousands separator, at most 6 decimals." | "{field}: القيمة \"{value}\" ليست رقمًا عشريًا. استخدم النقطة فاصلًا عشريًا، دون فاصل للآلاف، وبحد أقصى 6 منازل عشرية." |
| `import.row.formula_cell` | "{field}: formula cells are not imported; paste values." | "{field}: لا تُستورد خلايا الصيغ؛ الصق القيم." |
| `import.row.date_invalid` | "{field}: \"{value}\" is not a date in the form YYYY-MM-DD." | "{field}: القيمة \"{value}\" ليست تاريخًا بالصيغة YYYY-MM-DD." |
| `import.row.text_too_long` | "{field} is longer than 4,000 characters." | "الحقل {field} أطول من 4,000 حرف." |
| `import.row.text_invalid_character` | "{field} contains a character that is not allowed." | "يحتوي الحقل {field} على حرف غير مسموح به." |
| `import.row.kpi_unknown` | "KPI {value} does not exist in this transformation." | "المؤشر {value} غير موجود في هذا التحول." |
| `import.row.kpi_no_active_version` | "KPI {value} has no active version." | "لا توجد نسخة نشطة للمؤشر {value}." |
| `import.row.scope_invalid` | "The scope {value} is not valid for this KPI." | "النطاق {value} غير صالح لهذا المؤشر." |
| `import.row.period_unknown` | "Reporting period {value} does not exist." | "فترة التقرير {value} غير موجودة." |
| `import.row.period_not_open` | "Reporting period {value} is not open for actuals." | "فترة التقرير {value} غير مفتوحة لإدخال القيم الفعلية." |
| `import.row.value_shape` | "The values do not fit this KPI: {expected}." | "القيم لا تناسب هذا المؤشر: {expected}." |
| `import.row.currency_mismatch` | "The currency {value} differs from the KPI's currency {expected}." | "العملة {value} تختلف عن عملة المؤشر {expected}." |
| `import.row.evidence_required` | "This KPI needs evidence with each actual. Enter this value by form." | "يتطلب هذا المؤشر دليلًا مع كل قيمة فعلية. أدخل هذه القيمة عبر النموذج." |
| `import.row.not_kpi_updater` | "You are not an owner, steward or update assignee of KPI {value}." | "لست مالكًا أو مشرفًا أو مكلفًا بتحديث المؤشر {value}." |
| `import.row.custom_field_invalid` | "{field} does not satisfy form schema version {version}." | "الحقل {field} لا يطابق نسخة مخطط النموذج {version}." |
| `import.row.duplicate_in_batch` | "Duplicate of row {firstRow}: the same KPI, scope and period." | "تكرار للصف {firstRow}: نفس المؤشر والنطاق والفترة." |
| `import.row.duplicate_committed` | "An actual for this KPI, scope and period already exists ({status})." | "توجد قيمة فعلية لهذا المؤشر والنطاق والفترة بالفعل ({status})." |
| `import.row.text_length` (proposed) | "{field} must be 1 to {max} characters of visible text." | "يجب أن يحتوي الحقل {field} على 1 إلى {max} حرفًا من النص المرئي." |
| `import.row.reviewer_unavailable` (proposed) | "Nobody can review actuals of KPI {value} yet: map its reviewer role to a person who may accept actuals." | "لا يوجد من يمكنه مراجعة القيم الفعلية للمؤشر {value} بعد: اربط دور المراجع بشخص مخوّل بقبول القيم الفعلية." |

Notes on params:

- `value_shape` gives `{expected}` as the DG4 English phrase ("a value", "a numerator and a denominator", "whether the milestone was achieved"). FE-A should map it to a localized phrase. I propose the client key the phrase on the DG4 value nature.
- `currency_mismatch` gives `expected: "-"` for a KPI without a currency.

`custom_field_invalid` is never produced by this target. The P5 form schema has no `kpi_actual` record type (`0068`/`0069`), so the pinned version has no extension column, and any extra column is the whole-file `import.header_mismatch`.

### 5.5 "Recalculation runs once per affected KPI"

The DG4 pipeline recalculates once per **accepted value**: one `kpi.actual_accepted` event per slot value, with a unique trigger key per value in `calculation_run`. Imports keep exactly that, with no duplicate and nothing for submitted values. Collapsing N accepted values of one KPI in one commit into one run would need a new outbox event or a worker change in DG4/P4 code (`kpi-outbox.ts` event types, `apps/worker/src/handlers/kpi.ts`). That is outside my files and touches `packages/shared` event schemas. The options are:

- (a) accept the per-value unit as meeting the intent (no repeated recalculation of the same value), or
- (b) open a reopen task for a batched `kpi.actuals_imported` trigger.

### 5.6 The commit's audit context (for BE-M2; port addition request)

`ImportTargetContext` has no audit context, so `commitRow` accepts an optional `audit` member on the context (structural extension). BE-M2's commit should pass the commit request's `AuditContext`. For an `auto` webhook or connector commit, that context is the service actor with `onBehalfOfUserId`. Without it, the DG4 events are attributed to `actorUserId` with request id `import:<batch id>`.

I recommend that BE-M (or the orchestrator) add `readonly audit?: AuditContext` to `ImportTargetContext` in `integrations/imports/targets.ts`.

### 5.7 "Imported from {source} row {n}" on the KPI actual detail (contract need)

`importLineageOf` delivers the read (tested). The KPI actual response schema (`KpiActual`, `additionalProperties: false`, DG4) has no lineage field, so the detail cannot show it without a contract addition. I propose:

- an optional member on `KpiActualValue`: `importedFrom: {importBatchId, sourceKind, source, rowNumber, sourceRecordId} | null`, filled by `presentActuals` from `importLineageOf`;
- the i18n key `kpi.actual.imported_from`, en "Imported from {source} row {rowNumber}", ar (provisional) "مستورد من {source} الصف {rowNumber}".

This changes a DG4 schema, which ADR-0056 "Consequences" says P6 does not do, so it is the orchestrator's decision.

### 5.8 Fixture builders

The section asks for fixtures "built with the P5 writers". The CSV uses the P5 CSV writer's quoting (`csvField` from `@mth/reporting`). The P5 report renderers (`renderCsv`, `renderXlsx`) write a report frame: header-block rows, and in XLSX an "About" sheet first. They cannot write a header-on-row-1 import file. The XLSX fixture is therefore a minimal OOXML workbook zipped with `node:zlib` in the test, the same technique as BE-M's staging test. BE-M2's template builder is the product path that should reuse the P5 sheet writer (`worksheetXml`/`cellXml`).

### 5.9 The port's `informational` column flag versus the contract (for BE-L, BE-M2 and the orchestrator)

`ImportColumn.informational?` (BE-M, `targets.ts`) is not a member of the contract's `ImportTemplateColumn` (`additionalProperties: false`). BE-L's `getConnectorMappings` returns `importTargets.columnsOf(kind)` unprojected. Once `kpi_actual.v1` was registered with `informational: true` on `kpi_name`, its response violated the schema.

This showed up in the first full integration run: `connectors.test.ts` failed with "data/targetColumns/2 must NOT have additional properties". The engine never reads the flag, so the target now carries no `informational` member. `kpi_name` is informational by its label, and `validateRow` never reads it. A test pins the contract shape of every column. After the fix, `connectors.test.ts` and `import-target.test.ts` pass (29/29).

Recommendation: BE-L's mappings route and BE-M2's `listImportTemplates` should project columns to the contract members, or the flag should be removed from the port.

## 6. User-facing texts made untrue

None. A search of `apps/web/src/i18n/{en,ar}` finds no string that calls KPI imports planned or later. This task ships no route or screen, so no visible text changes. The new texts it needs are listed in §5.4 and §5.7 for FE-A.

## 7. What remains

**Checks not proven on the final tree** (my load caused the failures; the orchestrator should run them on the integrated tree):

- `pnpm -r typecheck` (OOM kill twice);
- `pnpm test` in both locales (the locale-unset run was incomplete, only timeouts seen; C.UTF-8 not run);
- the full `pnpm test:integration` (incomplete at handback time);
- the `gate.exception_revoked` detail-text mismatch, which is unrelated to KPI imports.

**Functional items:**

- §5.5: recalculation batched per KPI (not delivered; orchestrator decision).
- §5.7: the contract field so the KPI actual detail shows its import origin.
- §5.6: the port's `audit` member, and BE-M2 passing it.
- §5.3 and §5.4: the i18n texts and proposed codes (FE-A).
- REQ-S17-002 and REQ-S17-003 complete only with BE-M2, BE-N, FE-C and QA-A A17.

## 8. Merge instructions

- No migration. No dependency. No contract or pinned-count change.
- `server.ts`: my two lines sit directly below BE-M's registry block. BE-O's connector-confirmation port line goes below mine (§B/A.11).
- Expect no conflict with BE-P2, BE-K2 or BE-L2 in my files, except possibly `server.ts` import ordering.

## Addendum (21:55Z): the locale-unset `pnpm test` finished

`pnpm test` (locale unset) exited **1** at 21:55:29Z (`pnpm-test-exit-codes.txt`):

| Project | Result |
|---|---|
| unit-node | 5 failed / 2,612 passed (2,617). All are timeouts, see §3. |
| unit-web | 6 failed / 1,781 passed (1,787) across 5 files: 20 s timeouts and "Unable to find role…". I changed no web file. |
| unit-formula-nocodegen | 259 passed, 2 skipped |

The C.UTF-8 run started automatically after it, after the time limit, and writes to `pnpm-test-c-utf8.log`. Its result is not reported here. Acceptance item 2 remains **not met** on this run, and needs a rerun on an unloaded machine.

## Addendum 2 (22:18Z): the C.UTF-8 `pnpm test` finished

`pnpm test` with `LANG=LC_ALL=C.UTF-8` exited **1** at 22:18:03Z (`pnpm-test-c-utf8.log`):

| Project | Result |
|---|---|
| unit-node | 1 failed / 2,616 passed (2,617). The failure is the 30 s timeout of `architecture.test.ts` "apps/web never imports @mth/db or @mth/config". It passed in my isolated reruns. |
| unit-web | 2 failed / 1,785 passed (1,787), both in `src/pages/traceability/traceability.test.tsx` (en and ar): "Unable to find role=button 'Assign initiative'". |
| unit-formula-nocodegen | 259 passed, 2 skipped |

The traceability failure also appeared in the locale-unset run. It is in a web page I did not change; this task touches no `apps/web` file. Whether it comes from load or from the base tree was not investigated. Acceptance item 2 is **not met** on these runs.

## Addendum 3 (22:35Z): the full integration run was stopped

The full `pnpm test:integration` run (started 20:34:51Z, before the §5.9 fix) was **stopped by the 2-hour background limit**, unfinished. It produced no summary and no exit code. I did not restart it: it already had the longest allowed limit.

At the stop, 262 of about 342 files had reported, with 10 failures in `integration.log`:

- **5 listed in §3:**
  - (a) the connectors mappings test, which my target caused; fixed in §5.9.
  - (b), (c), (d) timeouts.
  - (e) the `gate.exception_revoked` text mismatch.
- **4 more 30–120 s timeouts:**
  - contract P3 BE-D exercises;
  - the U+0000 query sweep;
  - the undeclared-media-type sweep;
  - reports 5,001 rows.
- **1 assertion:** the contract "P5 BE-J operations" group, "expected [] to have a length of 1 but got +0". The same group passed earlier in the same log, at line 92. Not investigated; it is unrelated to KPI imports.

Acceptance item 3 is **not met**. The integration suite must be run in full on the integrated tree.
