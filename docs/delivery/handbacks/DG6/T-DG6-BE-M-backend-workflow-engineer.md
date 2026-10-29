# Handback T-DG6-BE-M (backend-workflow-engineer): the import engine (port, parsers, staging, duplicates)

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Section: `docs/architecture/p6-work-split.md` §B/A.3.
- **Invocation:** `DG6-T-DG6-BE-M-backend-workflow-engineer-20261029T041957Z-f7105ca7`, session `f7105ca7-2b57-4b95-8818-ce531c0d5903`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-M.md`, sha256 `ea3546e0e74592c8c36bc3a0a4d34ec676b400c8f672e851bd7b429f34f40990` (verified with `sha256sum` before starting).
- **Base:** branch `dg6/be-m`, `HEAD` `bf7a2347929dbdc479dc22eef1eb77c7f0b18fa6`. The tree was clean at the start. Changes are left **uncommitted** for the orchestrator.
- **Time:** started `2026-10-29T04:20:11Z` (`date -u`). The end time is in §4.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited **0** before any write (re-run at the end: §4).
- **Gates:** nothing here reads or writes DG0–DG7. Staging an import commits nothing and approves nothing (G1–G6): a commit (BE-M2) goes through the DG4 submission path, which decides the review route. Every test value is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/integrations/imports/targets.ts` (new) | The `ImportTargetRegistry` port of ADR-0056 §1: `ImportTarget` (`kind`, `templateVersion`, `titleEn/Ar`, `columns`, `validateRow`, `existingKeys`, `commitRow`, `requiredPermissions`, optional `extensionColumns`), `ImportColumn`, `RowVerdict`, `ImportRowReason`, `ImportTargetContext`, the registry (`createImportTargetRegistry`, `setImportTargetRegistry`, `importTargetRegistry`, `columnsOf`), the media-type constants and `cellValue()`. |
| `apps/api/src/modules/integrations/imports/parsers/csv.ts` (new) | The CSV parser: strict UTF-8 (BOM removed), RFC 4180, the row limits. No dependency. |
| `apps/api/src/modules/integrations/imports/parsers/xlsx.ts` (new) | The XLSX parser: a bounded ZIP reader on `node:zlib` (raw inflate, CRC-32), the container limits, a small XML tokenizer, the first worksheet's cells as text, formula cells reported. No dependency. |
| `apps/api/src/modules/integrations/imports/validate.ts` (new) | `IMPORT_LIMITS`, the whole-file refusals of ADR-0056 §9 (`importRefusals`), `toTable` (the header against the template), `tableFromJsonItems` (webhook items for BE-N), `checkCells` (the engine's row reasons), `mergeVerdict`, `rawForStorage`. |
| `apps/api/src/modules/integrations/imports/duplicates.ts` (new) | Duplicate classification: the first valid row per key is `valid`, later ones are `duplicate_in_batch` pointing at it, keys the target already holds are `duplicate_committed`; the counts. Pure. |
| `apps/api/src/modules/integrations/imports/staging.ts` (new) | The engine: `parseImportFile` (size, media type against content, parser), `uploadSource`, `prepareImport` (header, cell rules, the target's `validateRow`, before the transaction), `stageImportInTx` / `stageImport` (one transaction under the `importCommit` lock: the caller's re-check, batch v1, existing keys, rows, batch `staged` v2, two audit events). |
| `apps/api/src/modules/integrations/imports/{engine,parsers/csv,parsers/xlsx}.test.ts` (new) | Unit tests: 31 + 14 + 22 = 67 (no database). |
| `apps/api/test/integration/integrations/import-staging.test.ts` (new) | Integration tests of the staging transaction against the disposable PostgreSQL: 10. Not in §B/A.3's file list (BE-M has no route, so its persistence is proven here; "every API task owns its tests", p6-work-split §1). |
| `apps/api/src/server.ts` | BE-A's wiring point: the registry line (`createImportTargetRegistry`, `setImportTargetRegistry`) and `setConnectorTargetColumnsSource((kind) => importTargets.columnsOf(kind))`, so BE-L's mappings view gets its target columns from the registered template (it was an empty list until now). KBE-A adds its registration line below mine. |
| `apps/api/src/architecture.testkit.ts` | **Outside my file list; needs the orchestrator's acceptance (§6.1).** One allow-list entry: `zlib` in `SAFE_NODE_BUILTINS`, with a comment. Without it the API module checker refuses `node:zlib`, which §B/A.3 prescribes for the ZIP entries. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-M-backend-workflow-engineer.md`, `T-DG6-BE-M-evidence/*.log` | This handback and its logs. |

**Migrations: none.** No schema change was needed: `0105` already has every table, CHECK and trigger the engine writes to. The highest file on this branch is `0114_p6_job_service_identities.sql`.

## 2. Operations routed

**None, by design.** §B/A.3: "No route (BE-M2 routes them once KBE-A's target exists)". There is no `p6-pending-be-m.ts`; the 8 import operations stay in `p6-pending-be-m2.ts` (unchanged), and `p6-exercises-be-m.ts` stays BE-A's stub (unchanged; BE-M2 fills it). **Contract deltas: none** (operation count, media-type pins, rate-limit floor and CSRF-exempt list unchanged; `openapi.yaml` untouched).

## 3. Behaviour delivered, per requirement row

BE-M is the engine half of both rows. Neither row is complete with BE-M alone: commit, lineage and the KPI target are KBE-A's and BE-M2's; templates are BE-M2's; webhooks are BE-N's; the pages are FE-C's.

### REQ-S17-002 (BE-M part; shared with KBE-A, BE-M2, FE-C)

Acceptance (quoted): **"A17: a file with 8 valid rows, 1 invalid row and 1 duplicate commits 8 rows with provenance and shows the 2 others with row-level reasons"**.

What BE-M delivers towards it. The commit of the 8 rows and their provenance (lineage) are BE-M2/KBE-A, so the row is **not met yet**.

- **Staging before commit (M0334).** `stageImportInTx` writes, in ONE transaction:
  1. the batch (`staging`, version 1, audit `import_batch.created`), pinned to `p5_form_schema_version_for(transformation)`;
  2. every row in row-number order (cells as text in `raw`, decimal strings in `normalized` for valid rows, `duplicate_key`, `validation_status`, `reasons`, `commit_status = 'pending'`);
  3. the batch `staged` with `rows_total/valid/invalid/duplicate` (version 2, audit `import_batch.staged`).

  Counts are NULL while the batch is staging, so they read as Unknown, never 0. The test reads the batch from inside the transaction and finds `staging` with every count `null`. The trigger-written history has the two versions. The file bytes are never stored; the batch keeps the name, media type, size and SHA-256.
- **The A17 shape, staged** (integration test). A CSV with 10 data rows stages as total 10 = 8 valid + 1 invalid + 1 duplicate:
  - row 7, `"12,5"`, is `invalid` with `import.row.value_not_decimal` and params `{field: "value", value: "12,5"}`;
  - row 11 is `duplicate_in_batch`: `duplicate_of_row_id` is row 2's id, and the reason `import.row.duplicate_in_batch` has `{firstRow: 2}`.
- **Duplicate source/period records (M0334).**
  - Within the batch: the **first valid** row with a key is `valid`; later ones point at it. An invalid row is never "the first" (unit test).
  - Against committed data: every row whose key the target already holds is `duplicate_committed`, with the target's params (`{status}`, ADR-0056 §5) (integration test).
  - The database invariants `import_row_one_valid_per_key` and `import_row_duplicate_of` hold on every staged batch.
- **Row-level reasons.** The engine raises these itself:
  - `import.row.formula_cell`;
  - `import.row.text_too_long` (over 4,000 characters);
  - `import.row.text_invalid_character` (the shared `hasInvalidCharacter` rule);
  - `import.row.value_not_decimal` (a webhook item's non-string JSON value);
  - `import.row.source_record_id_too_long` (proposed, §6.2).

  The target's own reasons follow (a target reason on a field the engine already refused is dropped), capped at 20. Reasons are stored as `{code, field, params}`, codes only, never sentences (rule 6); the 0105 CHECK accepts them.
- **Isolation.** Invalid and duplicate rows are stored with `normalized = null` and their reasons. They are never handed to `commitRow` (BE-M2 commits `valid` rows only).
- **Not here:** commit, lineage (`import_row_commit`), commit-time re-validation, cancel (BE-M2); the KPI rules (KBE-A).

### REQ-S17-003 (BE-M part: the parsers; shared with BE-M2, BE-N, FE-C)

Acceptance (quoted): **"A17: CSV and XLSX KPI imports and a signed webhook call each commit valid data; an unsigned webhook is rejected"**.

What BE-M delivers towards it (commit, templates and webhooks are BE-M2/BE-N, so the row is **not met yet**):

- **CSV** (`parsers/csv.ts`):
  - UTF-8 only, decoded strictly: non-UTF-8 is 422 `import.csv_not_utf8`; a UTF-16 file or a ZIP sent as CSV is 415. A BOM is removed.
  - RFC 4180: quoted commas, quoted line breaks and doubled quotes stay in one cell; an unclosed quote or text after a closing quote is 422 `import.csv_malformed` (proposed, §6.2).
  - Blank records are skipped; source row numbers are kept.
  - Formula-like text (`=`, `+`, `-`, `@`) is **kept as text** (D-195 Q11).
  - Over 5,000 data rows is 422 `import.too_many_rows`.
- **XLSX** (`parsers/xlsx.ts`, `node:zlib` only). Every container limit of ADR-0056 §3 is checked on the central directory before unpacking, and again on what is unpacked (inflate output cap = declared size, CRC-32): ≤ 100 entries; each ≤ 20 MiB unpacked; ≤ 50 MiB in total; ratio ≤ 100:1. Any violation is 422 `import.xlsx_unsafe`, as are:
  - macros: `xl/vbaProject.bin` or a macro-enabled content type;
  - external links: `xl/externalLinks/*` or an `External` relationship;
  - encrypted entries, ZIP64, a DTD.

  Only the first worksheet is read. Shared, rich and inline strings are text. **A numeric cell's stored `<v>` text is taken verbatim** (`"12.5"`, `"0.30000000000000004"`, `"1E-3"` stay as written; never `Number()`). **A formula cell is reported (`formulaIndexes`) with a null value, never its cached result** (the test checks the cached `"3"` appears nowhere). A date serial stays its digits, so the target reports `import.row.date_invalid`. A file that is not a workbook is 415.
- **Both** (`parseImportFile`): > 10 MiB is 413 `import.file_too_large` (exactly 10 MiB is accepted); a media type other than `text/csv` or the XLSX type is 415; the content is checked against the declared type; a CSV `charset` other than UTF-8 is 415. A header that does not match the template is 422 `import.header_mismatch` with `params.template`. That covers: an unknown, duplicate or empty column name, a missing required column, more than 50 columns, data outside the header, or a formula in the header. An unregistered template is 422 `import.template_unknown`.
- **Webhook items** (for BE-N): `tableFromJsonItems` keeps strings as text and null as empty, and marks every other JSON value non-text. That gives the row reason `import.row.value_not_decimal` with the value's JSON text, never a coerced number (ADR-0056 §7). The keys go through the same header check as a file.

### Shared rules (p6-work-split §2) as they apply to an engine without a route

- **Rule 4 (mutation).** BE-M has no route, so there is no request and no `If-Match`; a batch is created at version 1.
  - *Authorization at commit time:* `StageImportOptions.recheck(tx)` runs inside the transaction after the lock and before any write. BE-M2 passes the `import.create` re-check. Test: a refusing re-check rolls everything back, and no batch with that hash exists.
  - *Validation:* before the transaction.
  - *Audit:* one event per batch version, prior and new version, same request id. The deferred `p2_audit_required` trigger holds.
  - *No remote I/O in the transaction:* there is none; parsing and validation run before it.
  - *Form schema pin moved between validation and staging:* 409 `import.form_schema_changed` (proposed, §6.2), nothing written (test).
- **Rule 1 (free text).** Engine checks use `hasInvalidCharacter`; every truncation goes through `truncateText` (the stored raw copy; the `value` param).
- **Rule 4 / 730311.** The batch id is locked with `ADVISORY_LOCK_CLASSES.importCommit` (no number spelled in module source; the registry test passes).
- **Rule 5 (decimal only).** Cells are strings end to end. The tests assert `jsonb_typeof` of every stored raw cell is `string` or `null`.
- **Rule 13 (deterministic under load).** The tests that parse or build files near the limits carry an explicit 30 s budget. The measured loaded worst case was 5.96 s (the 10 MiB CSV, in a full parallel `pnpm test`, before I replaced the character-by-character scan with a chunked one). After the change, the same test takes under 0.1 s alone. No e2e spec was added.

## 4. Checks actually run

Environment: Node 24.21.0, offline, the worktree above. Harness ports 24401–24449 only. Empty `.claude/.cc-writes` directories were removed before the test runs. Logs: `docs/delivery/handbacks/DG6/T-DG6-BE-M-evidence/`. **End time: `2026-10-29T06:19:48Z`** (about 2 h). The full integration run (row 10) finished at about 06:20, just after it.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start and end) | **0** | `PASS gate DG5 (historical)` | `validate-historical-DG5.log` (the end run) |
| 2 | `pnpm -r typecheck` | **0** | every package | `typecheck.log` |
| 3 | `pnpm -r build` | **0** | | `build.log` |
| 4 | `pnpm lint` | **0** | `eslint . --max-warnings=0` clean | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" | `prettier.log` |
| 6 | `pnpm openapi:lint` | **0** | | `openapi-lint.log` |
| 7 | `env -u LANG -u LANGUAGE -u LC_ALL -u LC_CTYPE -u LC_MESSAGES pnpm test` (locale unset) | **0** | unit-node **2568/2568** (165 files); unit-web **1768/1768** (96 files); unit-formula-nocodegen **259 passed, 2 skipped** (3 files) | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | unit-node **2568/2568**; unit-web **1768/1768**; nocodegen **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=24430 MTH_PORT_POOL=24431-24439 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/integrations/import-staging.test.ts` | **0** | **10/10** (final tree) | not kept (scratch); the same file passed in row 10 |
| 10 | `QA_PG_PORT=24410 MTH_PORT_POOL=24411-24449 tests/qa/support/with-pg.sh pnpm test:integration` | **1 (FAIL)** | Ran on the final tree (started 05:20:43, after my last source edit at 05:10:55; duration 3547 s). **Files 3 failed / 336 passed (339); tests 4 failed / 3444 passed / 3 skipped / 1 todo (3452).** BE-M's `import-staging.test.ts` passed **10/10** and BE-L's `connectors.test.ts` **20/20**. The 4 failures are listed below. | `integration.log` |

**About row 10's failures (the run is a FAIL; my analysis follows, but I did not re-run anything to verify it).**

1. **`contract.test.ts` and `response-validation.test.ts`, "every route accepts exactly the request media types its operation declares".** `expected [ 405, 404, 1 ] to deeply equal [ 403, 402, 1 ]`: two more JSON-body routes than the pin. BE-M registers **no route**, so these two routes are not mine. They come from a task merged before this branch's base, and the pin is the orchestrator's merge seam (rule 16, D-201).
2. **`response-validation.test.ts`, "P5 BE-J operations (p5-exercises-be-j.ts)".** `expected [] to have a length of 1 but got +0`. D-201 records the same failure on the merged W6 tree; it passed when re-run alone and was attributed to load.
3. **`response-validation.test.ts`, "every operation: an undeclared request media type is a declared 400 …".** A **timeout at 30,002 ms**. Three other test processes were running on the host at the time (rows 7 and 8, and the discarded run). D-201 records the same class.
4. **`adoption/assessment-form-version.test.ts`** failed at file level: `duplicate key value violates unique constraint "organization_code_key"` in the harness's `createOrg(uniq("ORG"))`. A generated organization code collided with an existing one. This is a harness flake, not touched by BE-M.

I did not re-run any of the four alone, so items 2–4 are attributions, not proofs. Item 1 follows from BE-M adding zero routes (`git diff` of `routes.ts`: none). **Pinned-count change from BE-M: none.** The orchestrator should reconcile the media-type pin (now 405/404) from the handbacks that added those routes.

**Discarded first run (disclosed).** The first `pnpm test` (locale unset) on the earlier tree **failed, exit 1**, on two tests my code had broken:

- `architecture.test.ts`: computed member access with a non-literal key in the new files, and `node:zlib` not on the built-in allow-list;
- `advisory-locks.test.ts`: the number 730311 spelled in a comment.

The same run also measured the 10 MiB CSV test at 5.96 s, over the 5 s default.

I fixed all three: `Map`s, `.at()` and `charAt()` instead of keyed access, the allow-list entry of §6.1, no lock number in comments, a chunked CSV scan, and explicit 30 s budgets. Its C.UTF-8 run (exit 1) ran while I was editing. Both logs are kept as `discarded-run1-unit-locale-unset.log` and `discarded-run1-unit-c-utf8.log`. Rows 7 and 8 are the reruns on the final tree.

**Test counts added by BE-M.** Unit: `engine.test.ts` 31, `parsers/csv.test.ts` 14, `parsers/xlsx.test.ts` 22 (67 in the `imports` folder; the integrations unit folder runs 69 with BE-A's 2). Integration: `import-staging.test.ts` 10.

## 5. Notes for the next tasks (BE-M2, KBE-A, BE-N, BE-L2)

- **Upload (BE-M2):**
  1. `parseImportFile(bytes, contentType)` before anything.
  2. `prepareImport(db, {templateVersion, transformationId, actorUserId, sheet})` (read-only).
  3. `stageImport(db, prepared, {source: uploadSource(name, mediaType, bytes), createdBy, audit, recheck})`.

  The 413/415/422 file refusals are thrown as `HttpProblem`s by step 1.
- **Webhook (BE-N):** `tableFromJsonItems(body.items)`, then `prepareImport(..., {table})` before the transaction. Then `stageImportInTx(tx, prepared, {source: {kind: "webhook", connectorId, webhookReceiptId, commitMode, onBehalfOfUserId}, createdBy: null, audit: <service actor>})` inside the receipt transaction. The connector run (BE-L2) uses `{kind: "connector", integrationRunId, ...}`.
- **The target (KBE-A):**
  - Cells are a `Record<string, string | null>`. Read them with `cellValue(cells, key)`: the API module checker refuses `cells[key]` with a non-literal key.
  - `existingKeys` returns `Map<key, params>` (the params of `import.row.duplicate_committed`, e.g. `{status}`).
  - `validateRow` is called once per row with the same `ctx` object, so per-batch lookups can be memoised on it (e.g. a `WeakMap` keyed by `ctx`).
  - Register the target below my line in `server.ts` with `importTargets.register(...)`. The connector mappings' target columns then appear automatically.
- **Commit (BE-M2):** `prepared.target.commitRow` and the registry give the target. The batch row, `import_row` rows and the lock class are as above. `import_batch_counts_match_rows` and `import_batch_committed_shape` are already satisfied by staging.

## 6. For the orchestrator

### 6.1 A change outside my file list: `apps/api/src/architecture.testkit.ts`

§B/A.3 and ADR-0056 §3 prescribe `node:zlib` for the XLSX container, but the D-055 default-deny allow-list of the API module checker did not list it. The first full `pnpm test` therefore failed `architecture.test.ts`; see §4, where that run is disclosed. I added one entry, `"zlib"`, with a comment citing the ADR, following T-DG5-BE-M's precedent (`@mth/reporting/storage`, 9abfb02).

`node:zlib`'s members compress, decompress and checksum only: none loads, evaluates or executes code, opens a debugger or loads a native object (the F-DG1-130 criteria of that file). **Please accept or re-own this line at merge.** If it is refused, the alternative is a hand-written inflate in TypeScript: no dependency, but more code to review.

### 6.2 Codes not in the ADR-0056 tables (rule 17), proposed with their texts

| Code | Kind | Status | English text (proposed) | Why |
|---|---|---|---|---|
| `import.csv_malformed` | whole-file refusal | 422 | "The CSV file is not valid CSV: a quoted field is not closed correctly." | ADR-0056 §3 requires RFC 4180, but §9 has no code for a broken quote; `csv_not_utf8` would be untrue. |
| `import.form_schema_changed` | refusal | 409 | "The form schema of this transformation changed while the file was checked. Upload the file again." | The `import_batch_form_schema_pinned` trigger would otherwise surface as an unmapped 500 when the pin moves between validation and staging. |
| `import.row.source_record_id_too_long` | row reason | — | "The source record id is longer than 200 characters." | `import_row.source_record_id` holds ≤ 200 (0105); `text_too_long`'s "4,000 characters" would be untrue. |

Arabic: none is written by me (the `i18n/{en,ar}/{problems,imports}.json` blocks are FE-A's). The owner of those files should add the three with Arabic labelled provisional. The 18 row-reason texts of ADR-0056 §5 and the problem texts of §9 are also not in `apps/web/src/i18n` on this branch (`grep` finds no `import.` key); FE-A's planned B/A block.

### 6.3 Contract, schema, dependency

- **Contract:** no change; no pinned-count change.
- **Schema:** no change; no migration.
- **Dependency:** none added. The XLSX reader uses only `node:zlib`, `node:crypto` (SHA-256) and the existing `@mth/shared` helpers.

### 6.4 Deviations from the ADR-0056 §1 sketch (additive, for the reviewers)

- `validateRow` and `existingKeys` are `async` (they make read-only queries).
- `existingKeys` returns a `Map` of key → reason params, not a `Set`: ADR-0056 §5 needs the existing record's status in `import.row.duplicate_committed`.
- `titleEn/titleAr` are added for the contract's `ImportTemplate`; `extensionColumns` (optional) carries the pinned form schema's extension fields of ADR-0056 §4; `ImportColumn.informational` marks `kpi_name`.
- The parsers return a positional `ParsedSheet`; `toTable` turns it into the ADR's `{header, rows: {rowNumber, cells, formulaColumns}}` once the header is checked (the header check needs the template, which the parsers do not know).

### 6.5 User-facing texts made untrue

None. BE-M ships no route or page, so no feature becomes visible, and no en/ar string on this branch calls imports planned or later (`grep -i import` in `apps/web/src/i18n/en/*.json` with "plan|later|not yet|future|P6" finds nothing).

## 7. What remains

- **Assignment acceptance:**
  - Item 1 (typecheck, build, lint, prettier, `openapi:lint`): met, all exit 0.
  - Item 2 (`pnpm test` in both locales): met, exit 0 in each Vitest invocation.
  - Item 4 (`validate --historical --stage DG5`): met, exit 0.
  - **Item 3 (the full `test:integration`) is NOT met:** exit 1 with the 4 failures of §4 row 10. None is in BE-M's files, and BE-M's own integration file passes 10/10, but I did not re-run the 4 alone. The orchestrator's merged-tree run should settle it (media-type pin 405/404; the BE-J, timeout and organization-code items).

- **For REQ-S17-002 and REQ-S17-003, everything outside §B/A.3:** KBE-A's target, then BE-M2's routes, commit, lineage, cancel and templates; BE-N's webhooks; FE-C's pages; QA-A's A17. Neither row is complete.
- **A connector-source or webhook-source batch is not exercised against PostgreSQL here.** It needs a connector, an integration run or a webhook receipt, which belong to BE-L2 and BE-N. The `import_batch_source_shape` and `import_batch_connector_matches` constraints will check it when those tasks call `stageImportInTx`.
- **`rawForStorage` is a disclosed limitation.** When a row's cells together exceed `import_row.raw`'s 32 KiB, it cuts the longest cells (through `truncateText`) in the stored display copy only; the verdict was taken on the full cells. A template where that matters would need a schema change (orchestrator).
