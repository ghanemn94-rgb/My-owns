# Handback T-DG5-BE-E2 (backend-workflow-engineer): export, bulk edit, drafts, the recoverable conflict

- **Stage:** P5 / DG5 (BUILDING). Section: `docs/architecture/p5-work-split.md` §B.4.
- **Invocation:** `DG5-T-DG5-BE-E2-backend-workflow-engineer-20261016T011050Z-b89b1483` (session `b89b1483-3d0f-45b2-b37c-eef101c0a26e`).
- **Base:** branch `dg5/be-e2` at `cca2ba571e2030f7a35a4667961ca5625543cc80`. The changes are **uncommitted**, as assigned.
- **Time:** started 2026-10-16T01:14:57Z; the end time is in "Checks" below.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0, at the start (re-run at the end; see Checks).
- **Gates:** nothing here grants or records a G1–G6 business approval, or reads or writes DG0–DG7. Drafts and bulk edits approve nothing. All test data is synthetic.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/forms/drafts.ts` (new) | `listFormDrafts`, `createFormDraft`, `getFormDraft`, `updateFormDraft`, `closeFormDraft`. Also `formRecordConflict` (409 `form_record.conflict` with `currentVersion`) and `currentRecordVersion` (a record's version by registry table, T04/T16 kind-aware). |
| `apps/api/src/modules/forms/export.ts` (new) | `exportFormRecords`: JSON (`FormRecordExport`) and CSV (RFC 4180, UTF-8 with a BOM, CRLF, a status column after each value, formula-like text neutralized). Capped at 5000 rows. |
| `apps/api/src/modules/forms/bulk.ts` (new) | `bulkUpdateFormRecords`: all-or-nothing in one transaction. Source columns go through each register's own update function; extension values are validated against the pinned version. |
| `apps/api/src/modules/forms/routes.ts` | The three BE-E2 registration lines (they replace the "BE-E2 registers here" placeholder). |
| `apps/api/src/modules/transformations/register-kit.ts` | Named lines: `RegisterUpdateInput`, `RegisterUpdater`, `registerUpdaterOf(table)`. The PATCH's update core is now the closure `updateRow`, and the PATCH route and the bulk updater both call it. `finishLock` takes an optional expected-version function (default: `requireIfMatch`, as before). PATCH behaviour is unchanged; the whole integration suite covers it (see Checks). |
| `apps/api/src/modules/transformations/index.ts` | **Outside my file list; one additive edit, disclosed:** `registerUpdaterOf` and its two types are added to the existing register-kit export block. `architecture.test.ts` allows `forms` to import `transformations` only through `index.ts`, so the exposure §B.4 assigns me could not otherwise be reached. |
| `packages/shared/src/schemas/forms-records.ts` (new) | zod mirrors: `formRecordExport(Query)`, `formBulkItem`, `formBulkUpdate(Result)`, `formDraft(Create/Update/Close/Page/ListQuery)` and constants (5000-row cap, 100-item cap, 256 KiB payload). |
| `packages/shared/src/schemas/index.ts` | One barrel line for `forms-records.ts` (BE-D's and BE-E's precedent). |
| `apps/api/test/integration/forms/form-records.test.ts` (new) | 18 tests against real PostgreSQL: the literal T01/T14 acceptance runs, bulk on T03, the refusals, AUD 403, commit-time re-authorization, one audit event per record, and the database guard. |
| `apps/api/test/integration/contract/p5-exercises-be-e2.ts` (new) | Contract exercises of the seven operations: a success and every reachable declared refusal, through the validating client. |
| `apps/api/test/integration/contract/contract.test.ts` | Import, mirrors and `it` lines for BE-E2 (the P5 precedent), plus the media-type pin: `[381, 380, 1]` → `[385, 384, 1]` (see §5). |
| `apps/api/test/support/p5-pending-be-e2.ts` | Emptied: all seven operations are routed. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-E2-*` | This handback and its logs. |

**Migrations:** none. `0073` (reserved for BE-E2 "only if bulk edit or export needs one") is **left unused**. No database change was needed: `form_draft`, `form_custom_value` and the registry from `0068` suffice.

## 2. Behaviour delivered (REQ-S05-001)

Acceptance text (binding): *"A01;A14: for T01 and T14, a saved draft reopens, a new version is listed in history, a comment and attachment persist, export returns the rows, and a conflicting concurrent save returns a recoverable conflict"*. BE-E2's parts are **draft saving, export, bulk editing and the recoverable conflict**. History, comments and attachments are BE-E's, and the screens are FE-C's.

| Clause | Delivered | Test (`form-records.test.ts` unless named) |
|---|---|---|
| "a saved draft reopens" (T01, T14) | `createFormDraft` stores the partial body (`payload`, a JSON object ≤ 256 KiB, every text storable) with `recordId` and `baseRecordVersion`. `getFormDraft` returns the payload byte-for-byte (decimals stay strings). After a concurrent edit of the record, `baseChanged: true`, also in `listFormDrafts`. Only the owner sees a draft (others 404). There is one open draft per user and record (409 `form_draft.open_exists`, with the 23505 race mapped to the same code). `open → closed` (`saved`/`discarded`) is final (422 `form_draft.closed`; the database guard `form_draft_status_transition` refuses it when the API is bypassed). | "T01/T14: a saved draft reopens…", "the database refuses a change to a closed draft…" |
| "export returns the rows" (T01, T14) | `exportFormRecords` returns every record of the type in the transformation. Columns: the `column`-storage source columns plus the pinned version's extension fields, with labels in `lang`. With no `lang`, the caller's `preferred_locale` decides. Values are strings: numeric text exactly as stored, percentages as fractions, currency `SAR 1500000.10`, choices as labels in the language. Unknown → `null` value and status `unknown`. A calculated field with missing inputs → `not_computable`. **Never 0.** CSV: BOM, header row in en or ar (`Record ID…` / `معرّف السجل…`), a `<label> (status)` column after each value showing Unknown/غير معروف, and text starting with `= + - @ TAB CR` prefixed with `'`. Decimals are never prefixed. `format` and `Accept` must agree (400). More than 5000 rows → 422 `form_export.too_large` (exact text); exactly 5000 export. | "T01: JSON and CSV rows in en and ar…", "T14: export returns the benefit rows…", "at most 5000 rows…", "CSV cells…" |
| "a conflicting concurrent save returns a recoverable conflict" (T01, T14) | Two saves of the same draft with the same `If-Match`: the second gets 409 `form_record.conflict` with `currentVersion` and the exact ADR text. Nothing is written (no audit row for that request). Re-applying on the current version succeeds. Bulk: a stale item → 409 `form_record.bulk_conflict`, shown on T14 too. | "T01/T14: a conflicting concurrent save…", "T14 extension values…" |
| Bulk editing where suitable | 1–100 items (more → 422 `form_record.bulk_too_many`). Only where `bulk_edit_allowed` (else 422 `form_record.bulk_not_allowed`). `sourceFields` take only the `bulk_editable` column fields of a register that exposes its update function; anything else → 422 `form_record.bulk_field_not_editable`. Every record is locked (in id order, so concurrent bulk edits cannot deadlock) and version-checked **before any write**. Any stale item → 409 `form_record.bulk_conflict`, listing each one and saving nothing. Each item then goes through the register's own PATCH core (its gates, validation, checks, version +1, audit event and `afterUpdate`). A later item's refusal rolls back the earlier ones. `customFieldValues` are merged into the stored values (`null` clears one) and validated as `putFormRecordCustomFields` validates them (400 field codes at `/items/<i>/customFieldValues/<field>`, 422 unknown/required), with one `form_custom_value.*` audit event per values row. | "owners of 3 T03 records…", "one stale version…", "a refusal of a later item rolls back…", "refusals…", "T14 extension values…" |
| Permissions, rule 4 | Reads need `transformation.read` in scope (404 outside it); AUD reads. Every write needs the record type's `write_permission_code`, re-checked on the principal reloaded in the transaction (`requireRecordWrite`). AUD → 403 on create, update and close of a draft, and on bulk. A grant revoked while the request waits → 403 with nothing written (drafts and bulk). `If-Match`: 428 when missing, 409 when stale, creates are version 1. One audit event per write, in the same transaction. No remote I/O. | "AUD gets 403…", "commit-time re-authorization…" (×2), the 428 cases, the `auditOfRequest` assertions |

Rule 1 (free text): draft payload strings and keys pass `hasInvalidCharacter`. Bulk source values go through each register's own schema; extension values go through the KBE-B validators. Rule 2: no route-local parser. Rule 3: `config.consumes` is `application/json` on the four body routes and absent on the three GETs; `consumesDrift` is green. Rule 5: no float on any path (numerics are read as jsonb text). Rule 15: every ADR-0041 §10 code and English text is used verbatim (see §6 for the field codes).

## 3. Checks (real exit codes; logs in `T-DG5-BE-E2-evidence/`)

Environment: Node 24.21.0, offline, harness ports 24800–24849 (`QA_PG_PORT=24800 MTH_PORT_POOL=24801-24849`), PostgreSQL started by `tests/qa/support/with-pg.sh`. Empty `.claude/.cc-writes` directories in source folders were removed before the tests.

RESULTS_PLACEHOLDER

## 4. Operations routed (delta to `p5-pending-be-e2.ts`)

Removed: `exportFormRecords`, `bulkUpdateFormRecords`, `listFormDrafts`, `createFormDraft`, `getFormDraft`, `updateFormDraft`, `closeFormDraft` (7 → 0). All seven are exercised in `p5-exercises-be-e2.ts`, and all seven have a zod mirror. The export mirror is `formRecordExport | string-with-BOM`, because the default response is `text/csv`.

## 5. For the orchestrator: pins, contract and dependency needs

1. **Media-type pin:** +4 JSON bodies (`bulkUpdateFormRecords`, `createFormDraft`, `updateFormDraft`, `closeFormDraft`); the three GETs add none. In this tree: `[381, 380, 1]` → `[385, 384, 1]`. Reconcile it with the other W13 deltas. **Rate-limit floor:** unchanged (`≥ 285`). **Operation count:** unchanged (846 by `openapi:lint`; the contract was not edited).
2. **The bulk-conflict listing has no structured Problem member.** The Problem schema has no field for "a list of `{recordId, currentVersion}`", and `HttpProblem` carries only `errors`, `currentVersion` and `params` (`params` is restricted by ADR-0038 Q1). The listing is therefore in `errors[]`: `{pointer: "/items/<i>/version", code: "form_record.bulk_conflict", message: "Record <id> is at version <n>."}`. The pointer identifies the item; the message carries the current version. **If a machine-readable `currentVersion` per item is wanted, a contract change is needed** (e.g. `FieldError.currentVersion`, or a `conflicts` Problem member). Similarly, ADR-0041 §5 says "with `currentVersion` and the current representation". The Problem schema cannot carry a representation (BE-D and BE-E return only `currentVersion` too), so the client re-reads with `getFormDraft` or the record's GET.
3. **No new problem codes.** The field codes are existing i18n keys: `validation.too_big` (payload over 256 KiB), `validation.format` (format vs Accept), `validation.unique_items` (a record twice in a bulk), `validation.required` (empty item; `recordId` without `baseRecordVersion`), `validation.invalid_character`, `validation.max_properties`. All ADR-0041 §10 codes I return already have en and ar entries in `apps/web/src/i18n/*/problems.json`.
4. **No dependency.** The API must not load `@mth/reporting`'s renderers (ADR-0046 §1), so `export.ts` applies the two-line CSV quoting and formula-neutralization rule of `packages/reporting/src/csv.ts`/`injection.ts` itself. It is the same rule, cited.
5. **A shared deferred-check helper (request to the forms owner):** `forms/custom-values.ts` (BE-D) keeps `runDeferredChecks`/`lookupMember` module-private. `bulk.ts` repeats the same reference, attachment and lookup checks (`deferredProblems`, about 60 lines) instead of editing BE-D's file. Exporting one helper from `custom-values.ts` and deleting the copy is a safe follow-up.

## 6. Deviations and known gaps (stated plainly)

1. **T15 bulk edit of owners is not served (work-split test text not met as written).** §B.4's test names "bulk edit of owners on 3 T15 records". Only the registers built on the register kit expose an update function through `register-kit.ts`, as §B.4 assigns: T01 `confidence`, T02 `owner`, T03 `owner`, T08 `owner`/`needed_by_date`. **RAID (T15, `raid/register.ts`), decisions (T04/T16), initiatives (T05), stakeholder groups (T13) and benefits (T14)** have their own update functions, which are module-private (`raid/register.ts` `updateEntry` is not exported) and outside my files. For those registers, `sourceFields` → 422 `form_record.bulk_field_not_editable` ("This field cannot be bulk edited.", true in this release). Their `customFieldValues` are served. I wrote the literal test on **3 T03 records**, and a test asserts the T15 refusal so the gap is visible. **Their record types keep `bulk_edit_allowed = true`**, because extension-value bulk edit is served for all of them; no `0073` flag change was made. **To close it:** each owning module exports `(tx, request, {transformationId, recordId, expectedVersion, body})` on its PATCH core (or calls a register hook), and one line per register goes into the forms map. The bulk path then serves it unchanged. The binding REQ-S05-001 acceptance text does not name bulk edit or T15; it is judged on its own text (D-142 R1).
2. **Draft payloads are not validated against each register's update schema "made partial"** (the `0068` table comment). They are validated as a JSON object, ≤ 256 KiB, with storable text. A draft is work in progress and is refused only for what cannot be stored. The register validates when the record is saved. Per-type partial schemas would need a map of 30 register schemas; this is a candidate for FE-C/BE review.
3. **`closeFormDraft` with `reason: "saved"` trusts the client's sequence** (the record write happened first); it does not prove the write.
4. **Stricter register read rules:** export reads with `transformation.read` in scope, as ADR-0041 §9 lists. I found no stricter register read rule to apply, but I did not audit every register for one.
5. **Export of `procedure_definition`** returns zero rows. Those are platform configuration with no transformation column, and they are exported by the procedures operations.
6. **Bulk `version` semantics:** each item's `version` is the **register record's** version (what the user saw in the list). Extension values are merged under a row lock on the values row, in the same transaction.

## 7. User-facing texts made untrue

I searched `apps/web/src` (i18n en/ar, `router.tsx` planned routes, `nav.ts`) for texts calling form drafts, export or bulk edit planned or later. **I found none that BE-E2's backend makes untrue.** The P5 planned routes and sub-pages are FE-C's screens, which are still to come. Every ADR-0041 §10 code I return is already translated in en and ar. Nothing to correct.

## 8. Merge instructions

- No migration. Apply the uncommitted tree as-is.
- Expected conflicts: `contract.test.ts` (the media-type pin and the import/mirror/`it` lines, which are additive with the other W13 tasks) and `packages/shared/src/schemas/index.ts` (one additive barrel line). Resolve both by union, with the pin summed.
- `transformations/index.ts` gains three names in one export block (additive).
- Integration order note (§B.6): FE-C can now use the seven operations. `useFormDrafts` in `apps/web/src/api/p5.ts` already points at `listFormDrafts`.

## 9. What remains

- Serving T15/T04/T05/T13/T14/T16 source-column bulk edits needs the owners' exported update functions (§6.1).
- The optional follow-ups in §5.2 (structured bulk-conflict listing) and §5.5 (shared deferred checks).
