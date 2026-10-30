# Handback: T-DG6-BE-M2 (backend-workflow-engineer): import routes, commit and cancel, templates

- **Stage:** P6 / DG6 (BUILDING). Section `docs/architecture/p6-work-split.md` §B/A.5.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-M2-backend-workflow-engineer-20261029T230315Z-254a0059","session_id":"254a0059-9c15-48ac-83f2-ec09e99f3bd1"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-M2.md` (sha256 `42cb0b82ec9634a329d6dc95ac80fe0149af11685c40ea71567a916d49a4a947`, verified).
- **Starting revision:** branch `dg6/be-m2`, `HEAD` `a28d715fb5da2f666642d75397a0e8571a5fbdd3`, clean tree. Changes are left **uncommitted**.
- **Time:** start `2026-10-29T23:03:33Z`, end `2026-10-30T01:10:06Z` (`date -u`).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. A commit submits KPI actuals through the DG4 submission path; it never accepts one by itself and grants no business approval. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/integrations/imports/commit.ts` (new) | Import reads (ReadScope gate, list, get, rows with lineage), upload staging with the commit-time re-check, the commit of ADR-0056 §6 (`commitBatchInTx`, reusable by BE-N's auto commit), cancel, response shapes, the §9 refusals `import.not_staged`, `import.nothing_to_commit`, `import.revalidation_failed`. |
| `apps/api/src/modules/integrations/imports/templates.ts` (new) | `listImportTemplates` shape, prefill rows (one per active KPI), CSV and XLSX template writers (node:zlib ZIP, no dependency), `xlsxWorkbook` (also used by the tests to build XLSX fixtures). |
| `apps/api/src/modules/integrations/routes.ts` | The BE-M2 named block (8 routes) after BE-L2's, and the CSV/XLSX upload body parser (bytes only, 10 MiB cap while reading). |
| `apps/api/src/modules/platform/media-types.ts` | **Outside my listed ownership (disclosed, §5):** two additive entries in `SUPPORTED_REQUEST_MEDIA_TYPES` (`text/csv`, the XLSX type). Without them `assertValidConsumes` refuses to register `createImport` at start-up. |
| `apps/api/test/integration/integrations/imports.test.ts` (new) | 11 integration tests (real PostgreSQL) for the 8 operations. |
| `apps/api/test/integration/contract/p6-exercises-be-m.ts` | BE-M2 block of the BE-M seam: the 8 operations with success and every reachable declared refusal; 7 zod mirrors. |
| `apps/api/test/integration/contract/contract.test.ts` | Shared pin (reconciled by the orchestrator): request-body operations 407 → 410, JSON 406 → 408, new pins `text/csv` 1 and XLSX 1, `createImport`'s declared media types. |
| `apps/api/test/support/p6-pending-be-m2.ts` | Emptied (8 → 0). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-M2-evidence/*` | Logs of every check below. |

No migration, no new dependency, no schema or contract change, no i18n file edit.

## 2. Behaviour delivered, per requirement row

### REQ-S17-002 — acceptance (verbatim): "A17: a file with 8 valid rows, 1 invalid row and 1 duplicate commits 8 rows with provenance and shows the 2 others with row-level reasons"

Delivered through the API (test `imports.test.ts` "the A17 8/1/1 fixture through the API as CSV" and "... as XLSX"):
- `createImport` stages the 10-row fixture: 201, `ETag "2"`, `Location`; counts `10 = 8 + 1 + 1`, `rowsCommitted` null; audit `import_batch.created` (v1) and `import_batch.staged` (1 → 2) in the upload request.
- `listImportRows` shows row 10 `invalid` with `import.row.value_not_decimal` (raw cell `"12,5"` kept as text) and row 11 `duplicate_in_batch` pointing at row 2 (`duplicateOfRowNumber: 2`).
- `commitImport` (`If-Match "2"`) → 200, `ETag "3"`, `committed`, `rowsCommitted 8`; one `import_batch.committed` audit event (prior 2, new 3) plus DG4's own `kpi_actual` events in the same request; 8 lineage rows (`import_row_commit`) whose KPI actuals carry source row ids `SRC-01`…`SRC-08` (provenance); rows 10 and 11 stay visible as `not_committed` with their reasons. The review-route KPI's actuals are `submitted` (never accepted by the import; ADR-0027).
- ADR-0056 §6 steps: re-authorization inside the transaction after the `importCommit` lock (730311) and the row lock; re-validation of every valid row with the target's rules and committed keys; one transaction; `import.revalidation_failed` when a slot is filled between staging and commit (test: rows "3", nothing written, no audit row).
- The owner of the KPI target and its own 8/1/1 test is KBE-A; this task adds the routes, commit and cancel.

### REQ-S17-003 — acceptance (verbatim): "A17: CSV and XLSX KPI imports and a signed webhook call each commit valid data; an unsigned webhook is rejected"

- **CSV and XLSX KPI imports commit valid data through the API:** delivered (the two 8/1/1 tests above; templates download as CSV and XLSX and re-import; a filled CSV template row commits).
- **Templates downloadable (ADR-0056 §9):** `listImportTemplates` returns `kpi_actual.v1` with its 15 columns (English and Arabic labels, required, kind, example) and both media types; `downloadImportTemplate` returns a CSV (UTF-8 BOM, CRLF, keys on row 1, formula-like text apostrophe-prefixed) or XLSX (sheet 1 the table, sheet 2 "Column labels" right-to-left with en/ar labels), prefilled with one row per active KPI (id, name, entry scope kind and, for transformation-level KPIs, the scope id).
- **The signed-webhook half is not this task's:** it is BE-N's (`receiveWebhook`, §B/A.6). `commitBatchInTx` takes `expectedVersion: null`, `committedBy: null` and a `recheck` callback so BE-N's auto commit can reuse it. REQ-S17-003 is therefore **not complete** until BE-N lands.

## 3. Operations routed (delta to `p6-pending-be-m2.ts`: 8 → 0)

| Operation | Route | Permission | Exercised refusals (contract seam) |
|---|---|---|---|
| `listImports` | `GET /api/v1/transformations/{t}/imports` | `import.read` (ReadScope) | 400, 401, 403 (TL), 404 |
| `createImport` | `POST …/imports?template=` (`text/csv`, XLSX; `X-File-Name`) | `import.create` | 400, 401, 403 (AUD), 404, 413, 415, 422 |
| `getImport` | `GET …/imports/{importId}` | `import.read` | 400, 401, 403, 404 |
| `listImportRows` | `GET …/imports/{importId}/rows` | `import.read` | 400, 401, 403, 404 |
| `commitImport` | `POST …/imports/{importId}/commit` (If-Match) | `import.commit` + `kpi_actual.submit` | 400, 401, 403 (AUD), 404, 409 (stale; not staged), 422 (nothing to commit), 428 |
| `cancelImport` | `POST …/imports/{importId}/cancel` (If-Match) | `import.commit` | 400, 401, 403, 404, 409, 428 |
| `listImportTemplates` | `GET /api/v1/import-templates` | `import.read` (anywhere) | 400, 401, 403 |
| `downloadImportTemplate` | `GET /api/v1/import-templates/{templateVersion}/download` | `import.read` (ReadScope on `transformationId`) | 400, 401, 403 (TL), 404 |

## 4. Shared rules (§2) — how each is met

- **Rule 4 (every mutation):** server-side authorization before and re-checked at commit time inside the transaction after the lock (`refreshPrincipal` + `commitTimeDenial`; test "the commit-time re-check runs inside the transaction, after the lock and before any write"); validation (zod strict bodies, `freeText`); `If-Match` 428/409 on commit and cancel (create is a new batch, ETag "2" after staging); one audit event per batch version with prior/new version in the same transaction; no remote I/O inside a transaction (parsing and row validation run before the staging transaction).
- **AUD (rule 7):** 403 on upload, commit and cancel; reads allowed (tests and contract seam).
- **Commit without `kpi_actual.submit` → 403:** tested with TO given `import.commit` for the test only (role permission restored in `finally`).
- **Rule 5 / B/A.13 item 4:** cells stay text; no `Number()` of a cell; counts null while staging.
- **Rule 1 / 2:** `X-File-Name`, `note`, `reason` through `freeText`; JSON bodies through the shared strict-UTF-8 parser.
- **Rule 3:** `createImport`'s `config.consumes` equals the contract's two media types (declared in the contract's sorted order, so the 400 `validation.content_type` text matches the sweep's expectation).
- **Rule 17:** refusal codes and English texts are ADR-0056 §9's verbatim.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **`platform/media-types.ts` edit outside my listed files (please accept or relocate):** `SUPPORTED_REQUEST_MEDIA_TYPES` gains `text/csv` and the XLSX media type (two exported constants `CSV_REQUEST_MEDIA_TYPE`, `XLSX_REQUEST_MEDIA_TYPE`). The parsers themselves are registered in `integrations/routes.ts` (the evidence octet-stream precedent). BE-N's webhook body is `application/json` and needs no change here.
2. **Contract-test pins (rule 16):** request-body operations 407 → 410 (+ `createImport`, `commitImport`, `cancelImport`); `application/json` 406 → 408; new pins `text/csv` = 1 and XLSX = 1; already edited in `contract.test.ts` with a comment, to reconcile with the parallel W10 deltas.
3. **Undeclared 409 on `createImport`:** BE-M's staging engine throws 409 `import.form_schema_changed` when the transformation's pinned form schema changes between validation and the staging transaction (a race). `createImport` in `openapi.yaml` declares no 409. Proposed: add `"409": VersionConflict`-style response to `createImport` (additive), or have BE-M map it to 422. Not reachable in the tests.
4. **ADR-0056 §9 interpretation:** "the Arabic label row as a comment line only in XLSX". A second label row in the first sheet would be read as a data row by the engine (header is row 1, first worksheet only), so the template puts the Arabic labels in a second, right-to-left worksheet "Column labels". The architect may confirm or amend the ADR wording.
5. **P5 writers:** ADR-0056 §9 says templates are "built with the P5 writers (`packages/reporting/src/{csv.ts,xlsx}`)". The API may import only `@mth/reporting/storage` (ADR-0046 §1; `architecture.testkit.ts`), so `templates.ts` applies the same rules itself (RFC 4180, BOM, CRLF, inline strings, apostrophe / `quotePrefix` for formula-like text), as `forms/export.ts` does. No new dependency.
6. **No migration** was needed (the next free id is not taken).
7. **Grants (ADR-0056 §9 note):** the register's "import:KDS,ADM" — ADM holds no `import.*` (REQ-S10-003); unchanged here, as the ADR states.

## 6. User-facing texts

- Searched `apps/web/src/i18n/{en,ar}/*.json` for strings that call imports, CSV/XLSX upload or templates planned/later: **none found**, so nothing became untrue.
- The web catalogues hold **no** import problem texts yet. For FE-A/FE-C (`i18n/{en,ar}/problems.json`, Arabic provisional), the codes this task's routes return: `import.file_too_large`, `import.unsupported_media_type`, `import.csv_not_utf8`, `import.xlsx_unsafe`, `import.too_many_rows`, `import.header_mismatch` (param `template`), `import.template_unknown` (param `template`), `import.not_staged`, `import.nothing_to_commit`, `import.revalidation_failed` (param `rows`), plus BE-M's proposed `import.csv_malformed` and `import.form_schema_changed`. Texts: ADR-0056 §9 verbatim (BE-M's two in its handback). The row-reason texts are KBE-A's `imports.json` request.

## 7. Checks (real exit codes; logs under `docs/delivery/handbacks/DG6/T-DG6-BE-M2-evidence/`)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, PostgreSQL 16.15 disposable cluster, harness ports 25001–25049.

| # | Command | Exit | Result (counts) | Log |
|---|---|---|---|---|
| A4 | `node tools/gates/validate.mjs --historical --stage DG5` (at start) | **0** | `PASS gate DG5 (historical)` | `validate-historical-DG5-start.txt` |
| — | `with-pg.sh npx vitest run --project integration …/integrations/imports.test.ts` (ports 25001; pool 25002–25049) | **0** | 11/11 passed (alone, unloaded) | `integration-imports-only.txt` |
| A1 | `pnpm -r typecheck` (first run, before the one-line type-import fix below) | **0** | all packages | `typecheck.txt` |
| A1 | `pnpm -r build` | **0** | all packages | `build.txt` |
| A1 | `pnpm lint` (first run) | **0** | `--max-warnings=0` | `lint.txt` |
| A1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | all files formatted | `prettier.txt` |
| A1 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `openapi-lint.txt` |
| A2 | `pnpm test`, locale unset, run 1 | **killed** (20-min background limit, mine) | unit-node 1 failed / 169 passed files (2624/2625 tests): `architecture.test.ts` "every import respects dependsOn": **my defect**, a type-only `node:http` import in `integrations/routes.ts` (not allow-listed). Fixed (Fastify's `RawRequestDefaultExpression`). unit-web did not finish. | `unit-locale-unset-run1-partial-stale.txt` |
| A2 | `pnpm test`, locale unset, run 2 (after the fix) | **1** | unit-node **170/170 files, 2625/2625 tests**; unit-formula-nocodegen **3/3 files, 259 passed + 2 skipped**; unit-web **97/98 files, 1786/1787 tests**: 1 failure `Portfolios and workstreams (ar) > workstreams list WS-nn codes; assigning an initiative twice shows the translated refusal` (`Unable to find role="button" and name "إسناد مبادرة"`, 7 s). Web UI code: not touched by this task. It ran while the full integration suite loaded the 4 cores. **Not re-run alone (time):** an open item. | `unit-locale-unset.txt` |
| A2 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` (finished 01:25:52Z, after this handback was first written) | **1** | unit-node 166/170 files (2620/2625 tests): 5 failures, all **timeouts** (30 s, 5 s): `architecture.test.ts` (web import direction), `server.test.ts` ×2, `reporting/branding-layout.test.ts`, `reporting/xlsx/xlsx.test.ts`. unit-web 90/98 files (1771/1787 tests): 16 failures, 7 of them `Test timed out in 20000ms` and the rest async element lookups / null waits (p2, p2-blank-forms, portfolio, fe-e, traceability, transformations, valueHeadlines, extension-fields). unit-formula-nocodegen 3/3 (259 + 2 skipped). This task changed **no web file and no file under test in these failures**. The whole run overlapped the full integration suite and two OOM-killed typechecks on 4 cores, and the same unit-node files passed 170/170 in the unset run 2. **Not re-run on an idle machine (time):** these are open items, not passes. | `unit-c-utf8.txt` |
| A3 | `QA_PG_PORT=25010 MTH_PORT_POOL=25011-25049 tests/qa/support/with-pg.sh pnpm test:integration` | **1** (aborted) | **Incomplete:** 108 files reported, then `Unhandled Rejection: Error: Channel closed (ERR_IPC_CHANNEL_CLOSED)` from tinypool, with no summary line. This run overlapped two unit runs and a typecheck on 4 cores / 15 GB. **Passed among them:** `contract/contract.test.ts` **101/101** (route coverage, pending list, my media-type pins 410/408/1/1/1, `consumesDrift`, the undeclared-media-type sweep, the BE-M seam), `integrations/imports.test.ts` 11/11, `import-staging` 10/10, `kpi/import-target` 9/9, `integrations/connectors` 20/20, `integrations/runs` 15/15, `media-types.test.ts` 21/21. **Failed:** (a) timeouts: `forms/form-records.test.ts` ×2 (60 s, 30 s), `health/health-schemes.test.ts` ×1 (30 s); (b) fast assertion failures in **worker** tests: `adoption-below-trajectory.test.ts` "the event-to-queue registry (D-102)": `connector.run_failed: expected 'integrations.connector_exception' to be 'automation.evaluate'`; `operations-freshness.test.ts` ×2 (starter 16 version 2 triggers; freshness scan `data_stale`). My diff touches no `apps/worker`, outbox registry, catalogue or freshness file. These look like a BE-L2 / BE-K2 seam in the integrated `HEAD`, but I did **not** reproduce them on a clean `HEAD` clone (time). **Pinned-count change:** none in integration tests besides the `contract.test.ts` media-type pins above. | `integration-full.txt` |
| A1 | `pnpm -r typecheck` (final, after the fix) | **137** (killed) | `apps/api typecheck: Killed`: out of memory while the integration and unit runs were active. | `typecheck-final.txt` |
| A1 | `apps/api: npx tsc -p tsconfig.json` (re-run alone) | **137** (killed) | killed again while the C.UTF-8 unit run held memory. The final tree's API typecheck is therefore **BLOCKED (resource)**. The only source change after the passing typecheck is the type import `RawRequestDefaultExpression` from `fastify` (a type Fastify exports) replacing `IncomingMessage`. | `typecheck-api-rerun.txt` |
| A1 | `pnpm lint` (final) | **0** | `--max-warnings=0`, final tree | `lint-final.txt` |
| A1 | `npx prettier --check` on the files changed after the full prettier run | **0** | — | (console; also covered by `lint-final` for TS style) |


## 8. What remains

Stated plainly. The implementation is complete for §B/A.5. The acceptance **checks** are not all green on the final tree.

1. **Final `pnpm -r typecheck` is BLOCKED (OOM, exit 137 twice).** Re-run it alone on an idle machine. Expected 0: the only change since the passing run is one type-only import.
2. **`pnpm test` with C.UTF-8 exits 1**: 5 unit-node and 16 unit-web failures, all timeouts or async lookups during the overloaded window, none in this task's files. Re-run on an idle machine.
3. **`pnpm test` (locale unset) unit-web: 1 failure** (`Portfolios and workstreams (ar)`, button lookup), not in this task's files. Re-run that spec alone. If it fails alone, it is the web owner's (not this task's).
4. **`pnpm test:integration` aborted** (IPC channel closed, after 108 files). Re-run it alone. Of its failures, the three timeouts (forms ×2, health ×1) need re-running alone. The three **worker** assertion failures (event-to-queue registry for `connector.run_failed`; starter 16 v2; freshness scan) are outside this task. They should be reproduced on clean `HEAD` `a28d715fb` to confirm that they predate this branch (BE-L2/BE-K2 seam).
5. **`validate --historical --stage DG5`** ran at start (0). It was not re-run at the end (no delivery record changed by this task).
6. **REQ-S17-003** needs BE-N (signed and unsigned webhooks). REQ-S17-002 also needs FE-C's pages and QA-A's A17 run. Neither requirement is complete from this task alone.
7. **i18n texts** for the import problem codes (list in §6) are for FE-A/FE-C. **The ADR wording** on the XLSX Arabic labels (§5 item 4) and the undeclared 409 (§5 item 3) are for the architect/orchestrator.
8. **No e2e spec** was added, so no budget is stated (rule 15 is not triggered).
9. **No separable second half:** the 8 operations, commit/cancel and templates are all delivered.

## 9. Merge instructions

- No migration. No dependency. Expect conflicts only in the shared files the assignment names: `integrations/routes.ts` (the BE-M2 block sits after BE-L2's, before BE-N's), `contract.test.ts` (the media-type pin line; add the W10 deltas), and possibly `platform/media-types.ts` (two additive set entries).
- BE-N can call `commitBatchInTx(tx, { expectedVersion: null, committedBy: null, userId: <on_behalf_of>, recheck, ... })` for the auto commit after its receipt transaction.

End time: 2026-10-30T01:10:06Z (`date -u`); about 127 minutes, past the 2-hour limit while waiting on the check runs.

