# ADR-0056: P6 controlled imports: staging batches and rows, CSV and XLSX parsing with limits, validation against the target's rules and the pinned form schema, duplicate source and period detection, bilingual row-level reasons, commit of valid rows through the `ImportTargetRegistry` (KPI actuals first), lineage, downloadable templates, and signed webhooks to a staged import

- **Status:** Proposed for P6 (DG6). Author: solution-architect (T-DG6-ARCH-03), 2026-10-26.
- **Requirements (slice A of `docs/architecture/p6-plan.md`):** REQ-S17-002, REQ-S17-003. Slice B is ADR-0055.
- **Sources (quoted where a design point has one):**
  - M0334 (§17) "Imports must stage and validate data before commitment, detect duplicate source/period records, show row-level errors and preserve source lineage. Support approved CSV/XLSX imports, documented APIs/webhooks and optional adapters for corporate data sources when access is supplied."
  - M0335 (§17) "Core workflows must work with native forms and controlled imports while a connector is unavailable."
  - M0386 (§20, A17) "Invalid rows are isolated, duplicates detected, valid rows committed with provenance; unavailable connector shows an actionable error".
  - REQ-S17-002 acceptance: "A17: a file with 8 valid rows, 1 invalid row and 1 duplicate commits 8 rows with provenance and shows the 2 others with row-level reasons". REQ-S17-003 acceptance: "A17: CSV and XLSX KPI imports and a signed webhook call each commit valid data; an unsigned webhook is rejected".
  - Playbook: Template 2 (B0049/B0050, columns "Outcome | KPI | Baseline | Target | Target date | Owner | Leading indicator") and the benefits lifecycle row "Measure | Is the benefit appearing in actual performance? | Evidence / actuals" (B0121) are why KPI actuals are the first import target. The playbook names no import or webhook control, so nothing below is attributed to it.
- **Decisions applied:** D-195 (Q1 Imports under "Strategy and KPIs" with an entry in Administration > Integrations, no fifteenth area; Q11 XLSX formula cells refused as row errors, formula-like CSV text imported as text; Q12; R3), D-196, D-193, D-088 §2, D-141, F-DG3-100, F-DG4-160; p6-plan §3 seams 9 (KPI actuals through the DG4 path), 12 (webhook routes signature-authenticated, CSRF-exempt), 24 (pinned form schema).
- **Builds on:** ADR-0004 (audit), ADR-0006 (policy), ADR-0007 §5b (statuses, media types), ADR-0027/0028 (KPI actuals and their submission path), ADR-0039 §3 and ADR-0041 §4 (pinned form schema, custom-field validation), ADR-0046 (P5 CSV/XLSX export, formula-injection neutralisation), ADR-0051 §1 (`ReadScope`), ADR-0052 §2 (free text, upload limits), ADR-0052 §5 (`SecretRef`), ADR-0055 (connectors, runs, service identities).
- **Physical model:** `packages/db/migrations/0105_p6_imports_lineage_webhooks.sql`, `0107_p6_integrations_permissions.sql`; probe groups IM, WH in `docs/delivery/handbacks/DG6/T-DG6-ARCH-03-evidence/probe-output.txt`.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. A commit submits KPI actuals through DG4's path; it never accepts one by itself and approves nothing.

## Context

1. No import staging exists (`grep import_batch` finds nothing in `0001`–`0103`). P5 exports CSV and XLSX (`packages/reporting/src/{csv.ts,xlsx}`); `ooxml-read.ts` reads OOXML in tests only.
2. The DG4 KPI actual path (`submitKpiActual`, ADR-0027/0028) validates a slot (KPI, scope, reporting period), the active KPI version, the period, the value shape, the currency and evidence rules, decides the review or direct-accept route, and refuses an existing slot with 409 (`kpi_actual_slot_key`, lock 730229). It is the only path that creates a KPI actual.
3. Custom fields are validated against the form schema version the transformation is pinned to (`p5_form_schema_version_for`, `0068`; ADR-0039 §3 "never the latest").
4. Every route so far is session-authenticated and CSRF-protected except login (ADR-0005). A webhook is called by a machine without a session.

## Decision

### 1. The `ImportTargetRegistry` port (p6-plan §2)

`apps/api/src/modules/integrations/imports/targets.ts` (BE-M) defines:

```ts
interface ImportTarget {
  kind: "kpi_actual";                      // the closed set of import_batch.target_kind
  templateVersion: string;                 // "kpi_actual.v1"
  columns: readonly ImportColumn[];        // the template (§9): key, en/ar label, required, kind
  validateRow(ctx, raw): RowVerdict;       // pure + read-only queries: normalized values | reasons; duplicateKey
  existingKeys(ctx, keys): Set<string>;    // duplicate keys already committed (the target's own uniqueness)
  commitRow(trx, ctx, row): { recordType: "kpi_actual"; recordId: string; valueNo: number };
  requiredPermissions: readonly Permission[]; // re-checked at commit time for the committer
}
```

`integrations` imports no domain module: `kpi/import-target.ts` (KBE-A) implements the target and registers it at composition (`server.ts`, BE-A's wiring point), the P5 `AutomationActionRegistry` pattern. `kpi_actual` is the only target in P6; `import_batch.target_kind` has a CHECK with that one value, so a second target needs a migration.

### 2. Staging batch (REQ-S17-002)

**Entity `import_batch`** (`0105`): `organization_id`, `transformation_id`, `target_kind`, `template_version`, `form_schema_version_id` (the transformation's pinned form schema version at staging; trigger `import_batch_form_schema_pinned`, IM01), `source_kind` (`csv_upload` | `xlsx_upload` | `webhook` | `connector`), `connector_id`, `integration_run_id`, `webhook_receipt_id` (UNIQUE), `file_name`, `media_type`, `byte_size` (≤ 10 MiB), `content_sha256`, `status`, `rows_total` (≤ 5,000), `rows_valid`, `rows_invalid`, `rows_duplicate`, `rows_committed`, `failure_code`, `commit_mode` (`manual` | `auto`) with `on_behalf_of_user_id`, `committed_at/by`, `cancelled_at/by`, `cancel_reason`, `version`, stamps. History `import_batch_event`.

**State machine** (trigger `import_batch_guard`): `staging` → `staged` | `failed`; `staged` → `committed` | `cancelled`. `committed`, `cancelled`, `failed` never change (IM20).

**Database invariants (probe IM):**

| # | Invariant | Mechanism | Probe |
|---|---|---|---|
| 1 | The batch pins the form schema version the transformation uses | trigger (`import_batch_form_schema_pinned`) | IM01 |
| 2 | Each source kind has exactly its fields: uploads have file name, media type (`text/csv` for CSV, the XLSX type for XLSX), size, hash and a user; a webhook batch has its receipt, its connector and `application/json`; a connector batch has its run; only machine sources may `auto` commit | CHECK `import_batch_source_shape`, `import_batch_commit_mode`; trigger (`import_batch_connector_matches`) | IM02, IM24, IM25 |
| 3 | A file is at most 10 MiB; a batch at most 5,000 rows | CHECKs | IM03 |
| 4 | Counts are NULL while staging (Unknown, never 0); once staged, valid + invalid + duplicates = total = the number of `import_row`s, and they never change | CHECK `import_batch_counts`; trigger (`import_batch_counts_match_rows`, `import_batch_identity_fixed`) | IM10, IM11 |
| 5 | `committed` needs `rows_committed` = the number of committed rows ≤ valid | CHECK `import_batch_committed_shape`; trigger | IM17, IM18 |
| 6 | One batch per webhook receipt | UNIQUE `import_batch_webhook_receipt_key` | IM26 |
| 7 | Version step, audit at COMMIT, append-only history | P2 guards, `import_batch_history` | IM23, IM27 |

### 3. Parsing with limits (REQ-S17-003 "approved CSV/XLSX imports")

`integrations/imports/parsers/{csv,xlsx}.ts` (BE-M), **no new dependency**. Both return `{header: string[], rows: Array<{rowNumber, cells: Record<string, string | null>, formulaColumns: string[]}>}`; every cell is a **string** (never a JavaScript number), so a decimal is never parsed from a spreadsheet's binary double (p6-plan carried rule).

| Limit | Value | Refusal (whole file) |
|---|---|---|
| File size (both) | ≤ 10,485,760 bytes (10 MiB; also a DB CHECK) | 413 `import.file_too_large` |
| Data rows (both) | ≤ 5,000 (also a DB CHECK) | 422 `import.too_many_rows` |
| Columns | ≤ 50; header row required (row 1) | 422 `import.header_mismatch` |
| Cell length | ≤ 4,000 characters | row reason `import.row.text_too_long` |
| CSV encoding | UTF-8 (an optional BOM is removed); RFC 4180 quoting; comma separator | 422 `import.csv_not_utf8` |
| XLSX container | ZIP; ≤ 100 entries; each entry ≤ 20 MiB uncompressed; total ≤ 50 MiB uncompressed; each entry's ratio ≤ 100:1; no `xl/vbaProject.bin`, no `xl/externalLinks/*`; first worksheet only | 422 `import.xlsx_unsafe` |
| Media type | `text/csv` or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, checked against the content (CSV: valid UTF-8 text; XLSX: the ZIP signature and `[Content_Types].xml`) | 415 `import.unsupported_media_type` |

- **XLSX cells:** shared strings and inline strings are read as text; a numeric cell's stored `<v>` text is taken **verbatim** as a decimal string (e.g. `"12.5"`); a cell with a formula (`<f>`) is reported in `formulaColumns` and becomes the row reason `import.row.formula_cell` (D-195 Q11: "formula cells are not imported; paste values"), never its cached value. Dates must be text cells in the template's format; a numeric date serial in a date column is the reason `import.row.date_invalid`.
- **CSV text that looks like a formula** (`=`, `+`, `-`, `@` first) is imported as text (D-195 Q11) and neutralised on any later export by the P5 rules (ADR-0046).
- **No remote I/O in a transaction.** Parsing and validation run before the staging transaction; the file bytes are not stored (only `content_sha256`, name, size and the parsed cells in `import_row.raw`).

### 4. Validation against the target's rules and the pinned form schema

For `kpi_actual.v1` (KBE-A, `kpi/import-target.ts`), each row is checked with the **same rules as `submitKpiActual`** (DG4), read-only: the KPI exists in the batch's transformation and has an active version; the scope (kind and id) is valid for the KPI; the reporting period (by `period_label`) exists and is open; the value shape fits the KPI version (value, or numerator and denominator, or milestone fields, or a missing reason); the currency matches; the committer would be an owner, steward or update assignee of the KPI (else the row reason `import.row.not_kpi_updater`); a KPI that requires evidence with each actual cannot be imported (`import.row.evidence_required`: enter it by form). Free text (`comment`, `missing_reason`) uses the shared `freeText`/`hasInvalidCharacter` rules. Columns that are extension fields of the pinned form schema version are validated with ADR-0041 §4's validator against `import_batch.form_schema_version_id`; an unknown column is the whole-file refusal `import.header_mismatch`.

Decimal values: `^-?[0-9]{1,18}(\.[0-9]{1,6})?$` (a dot separator, no thousands separator, at most 6 decimals, the `numeric(24,6)` of `kpi_actual_value`); normalized as decimal strings with the shared decimal helper. Anything else is `import.row.value_not_decimal`, never coerced.

### 5. Duplicates and row-level reasons (REQ-S17-002)

**Entity `import_row`** (`0105`): `import_batch_id`, `row_number` (the source row; header is row 1), `source_record_id` (the source's own row id, the template's `source_record_id` column, ≤ 200), `raw` (cells as strings or null, ≤ 50 keys, ≤ 32 KiB; CHECK `import_row_raw`), `normalized` (decimal strings; set iff valid), `duplicate_key`, `validation_status` (`valid` | `invalid` | `duplicate_in_batch` | `duplicate_committed`), `duplicate_of_row_id`, `reasons` (≤ 20 `{code, field?, params?}` with codes `import.row.*`; empty iff valid), `commit_status` (`pending` | `committed` | `not_committed`).

- **Duplicate key** (the "source/period" of M0334): `kpi_actual:<kpiDefinitionId>:<scopeKind>:<scopeId>:<reportingPeriodId>`, the DG4 slot (`kpi_actual_slot_key`, lock 730229 key).
- **Within the batch:** the first valid row with a key is `valid`; a later row with the same key is `duplicate_in_batch` and points at it. **Database invariant:** at most one `valid` row per (batch, key) (unique index `import_row_one_valid_per_key`, IM06); a duplicate points at the valid row of the same batch and key (trigger `import_row_duplicate_of`).
- **Against committed data:** a row whose key names an existing `kpi_actual` slot (any status, the DG4 uniqueness) is `duplicate_committed` (reason params: the existing actual's status). The DG4 unique key remains the backstop at commit.
- **Immutability:** rows are added only while the batch is `staging` (IM12); a staged row never changes except `commit_status` (`pending` → `committed` | `not_committed`; column-level UPDATE grant, IM14); `committed` requires its lineage row first (IM13); rows are never deleted (IM21).

**Row reasons** (codes stored; texts rendered at render time from `i18n/{en,ar}/imports.json`, English verbatim below, Arabic labelled provisional):

| Code | English text |
|---|---|
| `import.row.required_missing` | "{field} is required." |
| `import.row.value_not_decimal` | "{field}: \"{value}\" is not a decimal number. Use a dot as the decimal separator, no thousands separator, at most 6 decimals." |
| `import.row.formula_cell` | "{field}: formula cells are not imported; paste values." |
| `import.row.date_invalid` | "{field}: \"{value}\" is not a date in the form YYYY-MM-DD." |
| `import.row.text_too_long` | "{field} is longer than 4,000 characters." |
| `import.row.text_invalid_character` | "{field} contains a character that is not allowed." |
| `import.row.kpi_unknown` | "KPI {value} does not exist in this transformation." |
| `import.row.kpi_no_active_version` | "KPI {value} has no active version." |
| `import.row.scope_invalid` | "The scope {value} is not valid for this KPI." |
| `import.row.period_unknown` | "Reporting period {value} does not exist." |
| `import.row.period_not_open` | "Reporting period {value} is not open for actuals." |
| `import.row.value_shape` | "The values do not fit this KPI: {expected}." |
| `import.row.currency_mismatch` | "The currency {value} differs from the KPI's currency {expected}." |
| `import.row.evidence_required` | "This KPI needs evidence with each actual. Enter this value by form." |
| `import.row.not_kpi_updater` | "You are not an owner, steward or update assignee of KPI {value}." |
| `import.row.custom_field_invalid` | "{field} does not satisfy form schema version {version}." |
| `import.row.duplicate_in_batch` | "Duplicate of row {firstRow}: the same KPI, scope and period." |
| `import.row.duplicate_committed` | "An actual for this KPI, scope and period already exists ({status})." |

The staged view lists every row with its status and reasons; invalid and duplicate rows are isolated (never committed) and stay visible after the commit.

### 6. Commit of valid rows only, through the target, with lineage (REQ-S17-002)

`commitImport` (BE-M; `import.commit`), under lock 730311 (key batch id), If-Match on the batch:
1. **Commit-time re-authorization:** the committer (or, for `auto`, `on_behalf_of_user_id`) holds `import.commit` and every `requiredPermissions` code of the target (`kpi_actual.submit`) in the batch's transformation through `ReadScope`; else 403.
2. **Re-validation** of every `valid` row with the target's rules (state may have changed since staging); if any valid row now fails, the commit is refused 409 `import.revalidation_failed` with the row numbers, and nothing is written (the user cancels and re-stages).
3. In **one transaction**, for each `valid` row in `row_number` order: `commitRow` creates the KPI actual through the DG4 submission service (the same function `submitKpiActual` calls: status, route, recalculation once per affected KPI after the loop, DG4 audit events), then inserts `import_row_commit` (lineage) and sets the row `committed`; every other row becomes `not_committed`; the batch becomes `committed` with `rows_committed` (one audit event `import_batch.committed` listing the counts). A commit never accepts a value by itself: on the review route the actuals are `submitted` and wait for a reviewer (ADR-0027).
4. **Lineage** (`import_row_commit`, append-only): `import_row_id` (UNIQUE) → `target_record_type` `kpi_actual`, `target_record_id`, `target_value_no`, `committed_at`; with the row's `source_record_id`, `row_number` and the batch's source (file name and hash, receipt, or run) this is the provenance of M0386. The trigger refuses lineage for a non-valid or non-pending row or a non-staged batch (IM15) and for a KPI actual value that does not exist in the transformation (IM16). The KPI actual's detail shows "Imported from {file or source} row {n}" (KBE-A, read lines only).

`cancelImport` (`import.commit`) moves `staged` → `cancelled` with a reason; rows are kept.

**The A17 fixture** (QA-A; also probe IM05–IM19): 10 data rows, of which 8 valid, 1 invalid (`12,5`: `import.row.value_not_decimal`) and 1 duplicate of row 2 (`import.row.duplicate_in_batch`) → `staged` 10 = 8 + 1 + 1 → commit → 8 lineage rows, 8 KPI actuals each with its source row id, 2 rows shown with their reasons.

### 7. Signed webhooks to a staged import (REQ-S17-003)

**Entities** (`0105`): `webhook_endpoint` (`connector_id` of a `webhook` connector, `endpoint_key` 32–64 URL-safe characters, `label`, `signing_secret_ref` (a `SecretRef`, never a value), `previous_secret_ref` and `previous_valid_until` during a rotation, `secret_rotated_at`, `tolerance_seconds` 30–900, default 300, `status` `active` | `disabled` (final), version, stamps; history `webhook_endpoint_change`) and `webhook_receipt` (append-only: `delivery_id`, `signed_at`, `received_at`, `secret_slot` `current` | `previous`, `body_sha256`, `body_bytes` ≤ 1 MiB, `item_count` ≤ 5,000; UNIQUE (endpoint, delivery id)).

**Signature scheme (documented in OpenAPI `receiveWebhook`):**
- Headers: `X-MTH-Webhook-Timestamp` (Unix seconds), `X-MTH-Webhook-Delivery` (the sender's delivery id, `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`), `X-MTH-Webhook-Signature: v1=<64 lowercase hex>`.
- `signature = HMAC-SHA256(secret, "<timestamp>.<deliveryId>.<raw body bytes>")`, compared in constant time (`crypto.timingSafeEqual`) against the current secret, and against the previous secret while `now ≤ previous_valid_until`. The secret is resolved by `SecretProvider` from the reference before any transaction.
- Body: `application/json`, ≤ 1 MiB, strict UTF-8: `{"templateVersion": "kpi_actual.v1", "items": [{"sourceRecordId": "…", "kpiId": "…", "scopeKind": "…", "scopeId": "…", "periodLabel": "…", "value": "12.5", …}]}`; every value a JSON **string** (a JSON number is the row reason `import.row.value_not_decimal`), at most 5,000 items.

**Handling (BE-N, `integrations/webhooks.ts`; route `POST /api/v1/webhooks/{endpointKey}`, no session, CSRF-exempt by signature, its own rate-limit class):**
1. Refuse with **401 `webhook.unauthenticated`** (one code and one text for every case, so a caller learns nothing about which check failed; the case is logged, redacted, and counted) when: the endpoint key is unknown or disabled; a header is missing or malformed; `|now − timestamp| > tolerance_seconds`; or no secret matches. **An unsigned webhook is rejected** (acceptance). Rejected requests store no row.
2. Under lock 730312 (key `<endpointId>:<deliveryId>`), in one transaction: if a receipt with the delivery id exists and its `body_sha256` equals → **200 with the original receipt and batch (replay: nothing new)**; if it differs → 409 `webhook.delivery_id_reused`. Otherwise insert the receipt, an `integration_run` (`trigger_kind = 'webhook'`, idempotency key `webhook:<receipt id>`) and the staged `import_batch` (`source_kind = 'webhook'`, rows validated per §4–§5), audit actor `service` (the connector's service identity), and answer **202** with `{receiptId, importBatchId, rowsTotal, rowsValid, rowsInvalid, rowsDuplicate}`.
3. With the connector configuration's `commit_mode = 'auto'`, the commit of §6 runs after that transaction on behalf of `commit_on_behalf_of` (re-authorized at commit; if refused, the batch stays `staged`, an audit event `import_batch.auto_commit_refused` is written and a KDS commits by hand). With `manual`, a KDS commits it in Strategy and KPIs > Imports.

**Database invariants (probe WH):** an endpoint belongs to a `webhook` connector (WH01); its secret is a `SecretRef` (WH02); a rotation keeps the old reference as `previous` for at most 7 days (WH04, WH05); a receipt is recorded only for an `active` endpoint, inside its window, with a valid secret slot (WH08, WH09, WH12); one receipt per (endpoint, delivery id) (WH07); receipts are append-only (WH10); a disabled endpoint never changes (WH13).

**Admin routes** (`webhook.configure`, ADM_TECH): `createWebhookEndpoint` (the server generates `endpoint_key` with 32 random bytes, base64url), `rotateWebhookSecret` (body: the new `SecretRef` IT provisioned and `graceHours` 1–168), `disableWebhookEndpoint` (reason). The secret value is never generated, shown or stored by the application: IT puts it in the secret provider and gives it to the sender.

### 8. Advisory locks (ADR-0016 §6 registry)

730311 `importCommit` (key `<importBatchId>`: staging end, commit, cancel, auto commit); 730312 `webhookReceipt` (key `<webhookEndpointId>:<deliveryId>`). 730310, 730313, 730314 are ADR-0055's; 730315–730317 are reserved.

### 9. Templates, authorization, refusal codes

**Templates (REQ-S17-003 "CSV/XLSX templates are downloadable"):** `listImportTemplates` returns `kpi_actual.v1` with its columns (key, en and ar labels, required, kind, example) and media types; `downloadImportTemplate` (`?format=csv|xlsx&transformationId=`) returns the file built with the P5 writers (`packages/reporting/src/{csv.ts,xlsx}`), prefilled with one row per active KPI of the transformation the caller can read (KPI id and name, empty values), headers in English with the Arabic label row as a comment line only in XLSX (CSV keeps one header row). Columns of `kpi_actual.v1`: `source_record_id`, `kpi_id`, `kpi_name` (informational, ignored on import), `scope_kind`, `scope_id`, `period_label`, `value`, `numerator`, `denominator`, `milestone_achieved`, `achieved_on`, `currency`, `missing_reason`, `data_as_of`, `comment`.

**Authorization (`0107`; permissions matrix §26):** `import.read` (KDS, BO, TO, AUD: list, get, rows, lineage, templates), `import.create` (KDS: upload), `import.commit` (KDS: commit, cancel; plus `kpi_actual.submit` at commit), `webhook.configure` (ADM_TECH). Every read is scoped by the batch's transformation through `ReadScope`; AUD reads only and every mutation answers 403 for AUD. The technical administrators configure webhooks but hold no import right (REQ-S10-003: no business-record write). `receiveWebhook` is authorized by signature only; its writes act as the connector's service identity (ADR-0053 §1). The register's "import:KDS,ADM" is met for ADM by connector and webhook configuration; the orchestrator may grant `import.*` to another role by a later seed if the business asks (raised in the handback).

**Refusal codes** (problem+json; English verbatim; Arabic provisional):

| Code | Status | English text |
|---|---|---|
| `import.file_too_large` | 413 | "The file is larger than 10 MiB." |
| `import.unsupported_media_type` | 415 | "Only CSV (UTF-8) and XLSX files can be imported." |
| `import.csv_not_utf8` | 422 | "The CSV file is not valid UTF-8 text." |
| `import.xlsx_unsafe` | 422 | "The XLSX file was refused: it has too many parts, unpacks too large, or contains macros or external links." |
| `import.too_many_rows` | 422 | "The file has more than 5,000 data rows. Split it into smaller files." |
| `import.header_mismatch` | 422 | "The header row does not match template {template}. Download the template and keep its columns." |
| `import.template_unknown` | 422 | "Template {template} does not exist." |
| `import.not_staged` | 409 | "Only a staged import can be committed or cancelled." |
| `import.nothing_to_commit` | 422 | "This import has no valid row to commit." |
| `import.revalidation_failed` | 409 | "Rows {rows} are no longer valid. Cancel this import and upload the file again." |
| `webhook.unauthenticated` | 401 | "The webhook request is not signed correctly." |
| `webhook.delivery_id_reused` | 409 | "This delivery id was already used with a different body." |
| `webhook.payload_invalid` | 400 | "The webhook body is not valid JSON in the documented format." |
| `webhook.payload_too_large` | 413 | "The webhook body is larger than 1 MiB." |
| `webhook.endpoint_disabled` | 409 | "This webhook endpoint is disabled." (admin routes only; the receiving route answers 401) |
| `webhook.grace_invalid` | 422 | "The grace period must be between 1 and 168 hours." |

### 10. Decimal and Unknown semantics

- Every imported number is kept as the source's text in `raw` and as a normalized decimal string in `normalized`; it reaches `kpi_actual_value.value` (`numeric(24,6)`) through the DG4 path. No float, no `Number()` of a cell, no locale-dependent parsing.
- Batch counts are NULL (Unknown) while staging and render "Unknown"; a committed count is shown only for a committed batch. A row's missing value is the DG4 "missing reason" path, never 0.
- KPI freshness and status stay DG4's (ADR-0028): an import changes them only through the actuals it submits and their review.

## Alternatives

1. **Write accepted actuals directly from the import.** Rejected: it bypasses DG4 review, separation of duties and recalculation (p6-plan §3 row 9: a reopen, not planned).
2. **Keep the uploaded file in evidence storage.** Rejected for P6: the staged rows, the hash, name and size are the provenance; storing the bytes would add retention questions. A later stage can add it.
3. **A spreadsheet library dependency for XLSX.** Rejected: no dependency without an orchestrator decision (D-195), and the needed subset (first sheet, strings, numbers as text, formula detection) is small; the limits make a hand-rolled reader safe.
4. **Distinct webhook rejection codes.** Rejected: they tell an attacker which check failed; one 401 plus a redacted log line keeps operators informed.
5. **Store the webhook secret hashed.** Not possible for HMAC verification; a `SecretRef` keeps the value in the provider.

## Consequences

- 7 new tables in `0105` (`webhook_endpoint`, `webhook_endpoint_change`, `webhook_receipt`, `import_batch`, `import_batch_event`, `import_row`, `import_row_commit`), 2 validation functions (`p6_import_raw_valid`, `p6_import_reasons_valid`), 8 trigger functions (`webhook_endpoint_guard`, `webhook_endpoint_history`, `webhook_receipt_guard`, `import_batch_guard`, `import_batch_history`, `import_row_guard`, `import_row_no_delete`, `import_row_commit_guard`), the FK `integration_run_import_batch_fkey`.
- No DG1–DG5 table, constraint, route or text changes; the DG4 KPI path is called, not changed. New strings: the `imports.json` catalogues and the problem texts above.
- The first session-less, CSRF-exempt mutation besides login (`receiveWebhook`); the contract test pins it (BE-A owns the pin; p6-work-split §B/A).
- Residuals: no external sender is exercised; the A17 webhook is signed by the test harness with a test secret from the env provider.

## Verification

- `probe-output.txt` (110/110 PASS, exit 0): IM01–IM27, WH01–WH13 (with the G, CN, IR, OW, DX, PM groups of ADR-0055).
- `catalogue.test.ts` and `seed.test.ts` pins (as ADR-0055).
- Implementer tests in `p6-work-split.md` §B/A: parser limit tests (BE-M), the 8/1/1 CSV and XLSX integration tests (KBE-A), the webhook signature, window, replay and idempotency tests (BE-N); QA-A's A17 suite.
