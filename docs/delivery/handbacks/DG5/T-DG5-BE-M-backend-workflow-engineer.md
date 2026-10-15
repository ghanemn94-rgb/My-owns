# Handback T-DG5-BE-M (backend-workflow-engineer): `@mth/reporting` scaffold, export-file store, formula-injection rule, CSV and XLSX, export jobs

- **Stage / gate:** P5, DG5 (BUILDING). Section: `docs/architecture/p5-work-split.md` §F.5. Assignment
  `docs/delivery/assignments/DG5/T-DG5-BE-M.md` (sha256 `a9e6f848…2479bf`, verified at start).
- **Invocation:** `DG5-T-DG5-BE-M-backend-workflow-engineer-20261015T101827Z-be55de63`, session
  `be55de63-a4ed-4764-8e84-23c3b2e61a3f`.
- **Base:** branch `dg5/be-m`, `HEAD` `14878770448c2b1736f90a0b74da560e3abb7c99` (W10 assignments). Changes are left
  **uncommitted** for the orchestrator.
- **Time:** start `2026-10-15T10:27:05Z`; end `2026-10-15T12:22Z` (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0
  (`T-DG5-BE-M-evidence/validate-historical-DG4.log`).
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. An export approves nothing; no template, header
  or file name contains a DG0–DG7 string. All test data is synthetic.

## 1. Changed files

### Inside my §F.5 ownership

| File | Purpose |
|---|---|
| `packages/reporting/package.json` | Added the `exports` entries `.` and `./storage` and the `build`/`typecheck` scripts (D-146: "BE-M adds its source and exports"). The dependency list is unchanged. |
| `packages/reporting/tsconfig.json`, `tsconfig.build.json` | Package layout. The test-only files `src/test-fixtures.ts` and `src/xlsx/read.ts` are excluded from the build. |
| `packages/reporting/README.md` | Was "reserved … no `package.json` yet", which is now untrue. Rewritten to describe the package. |
| `packages/reporting/src/injection.ts` | `neutralizeSpreadsheetText` / `startsLikeFormula`: the ADR-0046 §4 rule over `=`, `+`, `-`, `@`, TAB and CR. |
| `packages/reporting/src/labels.ts` | Frame labels in en and ar (header block, "Draft — not an issued report" / "مسودة — ليس تقريراً صادراً", "No records", validation labels, legend, status suffix), and the label resolver with a visible fallback and a `missing` list. |
| `packages/reporting/src/model.ts` | The renderer contract (`RenderOptions`, `RenderResult`, `RenderError`, content types), the file frame (ADR-0046 §2), and the spreadsheet cell rules (ADR-0046 §4, §9): number vs text (more than 15 significant digits is text), Unknown/Stale as an empty cell, companion status columns, and SUM totals only when the rows sum exactly to the declared decimal.js total. |
| `packages/reporting/src/csv.ts` | CSV writer: UTF-8 with BOM, CRLF, RFC 4180 quoting, `'` prefix, legend rows. |
| `packages/reporting/src/xlsx/sheet.ts`, `xlsx/index.ts` | Own SpreadsheetML writer over jszip: inline strings, the `quotePrefix` style, the fixed `SUM(<col>a:<col>b)` template, `rightToLeft` sheets in Arabic, the IBM Plex fonts, deterministic bytes. |
| `packages/reporting/src/render.ts`, `index.ts` | `render()` dispatch: CSV and XLSX. PDF, DOCX and PPTX raise `RenderError` until BE-N adds them. |
| `packages/reporting/src/storage.ts` | `@mth/reporting/storage`: the filesystem export-file store (temp file, fsync, atomic rename, directory fsync), the `exports/` key rule, the ASCII file name, the 200 MiB limit, and `s3` unavailable. Uses Node built-ins only. |
| `packages/reporting/src/{injection,csv,storage}.test.ts`, `xlsx/xlsx.test.ts`, `test-fixtures.ts`, `xlsx/read.ts` | Unit tests (26), synthetic fixtures, and a test-only XLSX reader. |
| `apps/api/src/modules/reporting/exports/routes.ts` | Filled BE-A's stub: the five routes. |
| `apps/api/src/modules/reporting/exports/jobs.ts` | Services (create with idempotency, list, get, download with the re-check, cancel), the zod mirrors `exportCreate`/`exportJob`/`exportJobPage`, and the ADR-0046 §8 refusals. |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP5ExportError` (the 0081 guards a request can reach in a race) and its line in `mapDatabaseGuardError`. |
| `apps/worker/src/reports/export-runner.ts` | `reports.export`: lock 730264, progress, cancel between sections, retries, failure on the last attempt (captured by `worker.ts`), and the store. |
| `apps/worker/src/handlers/reports.ts`, `apps/worker/src/queues/reports.ts` | The `reports.export` handler line, queue and event route (`export_job.requested` → `reports.export`), added after KBE-D's lines. |
| `apps/api/test/integration/reporting/exports.test.ts` | 16 integration tests (API plus the worker runner, against PostgreSQL). |
| `apps/api/test/integration/contract/p5-exercises-be-m.ts`, `apps/api/test/support/p5-pending-be-m.ts` | Contract exercises of the five operations. Pending list emptied. |

### Outside my listed ownership: needed for the build, to accept or redo at the merge (p5-plan §5.3 "orchestrator merge on request")

| File | Change | Why |
|---|---|---|
| `apps/api/package.json`, `apps/worker/package.json` | `"@mth/reporting": "workspace:*"` (one line each) | ADR-0046 §1: the worker imports `@mth/reporting` and the API imports `@mth/reporting/storage`. Without the workspace link neither resolves. This is a workspace link, **not** a registry dependency. |
| `pnpm-lock.yaml` | +6 lines: the two `link:../../packages/reporting` importer entries | Written by `pnpm install --offline` (exit 0, "downloaded 0, added 0"). No other lockfile line changed. |
| `apps/api/src/architecture.testkit.ts` | `"@mth/reporting/storage"` added to the workspace-import allow-list | "The API module allow-list" is an orchestrator item (p5-plan §5.3). Without it the architecture test refuses the ADR-mandated import. |
| `packages/shared/src/schemas/events.ts` | `exportJobRequestedV1` and the `export_job.requested` v1 registry line | See §5.2. The precedent is BE-F2, BE-I and BE-I2, which each registered their own event in this file. |

## 2. Behaviour delivered, per requirement row

### REQ-S13-005

**Acceptance (binding):** "A15: an XLSX export of T15 contains exactly the filtered RAID rows; a PPTX gate pack contains the gate's criteria".

- **XLSX half: delivered.** `exports.test.ts` "XLSX contains exactly the filtered rows, cell by cell against GET /raid?type=risk":
  - a `registers` snapshot with `{register: raid, filters: {type: risk}}` is exported;
  - the worker renders it and the file is downloaded;
  - the workbook is read back: the row count equals the list route's, and code, type, description, impact, probability and status match cell by cell, in order;
  - the Issue entry is absent.
- **"Long export → async job with progress": delivered.** Every export is a job (202, `queued`). The worker moves `stage`, `percent` and `sectionsDone` forward only, and the job ends `done`/100 (test "progress moves forward only and ends done", which reads `GET /exports/{id}` after each section).
- **§F.5 literal tests:** CSV is UTF-8 with BOM and CRLF; the same `Idempotency-Key` gives one job (202, then 200 with the same id; one row); a killed worker mid-export completes once; another user's `getExport`/`downloadExport` → 404; a requester who lost `transformation.read` → 404 on download; cancel of a succeeded job → 422 `export.not_cancellable`; download before success → 409 `export.not_ready`; AUD → 403 on `POST /exports`.
- **Killed-worker test.** A real first attempt starts (audited), renders one section and then hangs. A half-written `.part` file of that attempt is left in the store. The redelivery restarts the job as attempt 2 and succeeds, and a replay does nothing. When the hung attempt is released, it records nothing and removes its own file. Audit trail: `create, start, retry, start, succeed`. Exactly one file remains, under the attempt-2 key.
- **PPTX half: not mine** (BE-N, §F.6). Until BE-N merges, a `pdf`/`docx`/`pptx` job fails at once with `export.render_failed` and is never retried, so no format is silently substituted (tested).

### REQ-S13-006

**Acceptance:** "A15;A12: a RAID description '=HYPERLINK(...)' exports as text; a system SUM total remains a formula".

- **Text half, end to end:** the RAID description `=HYPERLINK("http://x","y")`:
  - in XLSX it is an inline string (`t="inlineStr"`) with no `<f>`, and its style has `quotePrefix="1"`;
  - in CSV it is `'=HYPERLINK(...)`, RFC 4180-quoted;
  - checked through the API and the worker (`exports.test.ts`), and in unit tests for all six characters.
- **Property test** (`injection.test.ts`), seeded and deterministic: 1,200 strings starting with each of `=`, `+`, `-`, `@`, TAB and CR are prefixed. 800 strings starting with other characters (including look-alikes such as full-width `＝`/`－`, LF, RLM and a leading space) are not.
- **SUM half, renderer level only.** `xlsx.test.ts`: a declared `sum` total is written `<f>SUM(D3:D9)</f><v>1107.00</v>`, with the decimal.js total as the cached value. If the column holds an Unknown row, or its rows do not sum exactly to the declared total, it is written as a value and never as a partial formula.
- **Gap, stated plainly:** no merged assembler declares a `totals[]` entry yet (`grep` of `reporting/reports/assemblers/*.ts`), so no exported report contains a formula today. A15's end-to-end "system SUM total remains a formula" needs an assembler that declares a total. That belongs to the assembler owners (KBE-C/KBE-C2/KBE-D2), or is an A15 fixture for QA-C.

### REQ-S13-008 (BE-M part: labels in the CSV/XLSX files)

**Acceptance:** "A10;A15: a pending benefit value is labelled provisional in the PDF pack". The PDF is BE-N's.

- **CSV and XLSX (mine):**
  - every decimal column has a companion "<label> — status" column (Validated, Provisional, Unknown, Stale, n/a; Arabic مؤقت, غير معروف …);
  - provisional cells are italic in XLSX;
  - Unknown/Stale is an empty cell with status "Unknown", never 0;
  - there is a legend sheet (XLSX) or legend rows (CSV);
  - a generated snapshot carries "Draft — not an issued report" / "مسودة — ليس تقريراً صادراً";
  - unit tests in `csv.test.ts` and `xlsx.test.ts`, and the Arabic draft line in the integration CSV test.

### REQ-S13-009

Not mine (BE-N). The XLSX writer sets `rightToLeft="1"` and IBM Plex Sans Arabic for Arabic sheets, and IBM Plex Sans for English (unit-tested).

## 3. Checks actually run

See §8. In short, every acceptance check ran:

- Exit 0: typecheck, build, lint, prettier, `openapi:lint`, and the DG4 historical validator (at the start and the end).
- `pnpm test` exited 1 in both locale settings. Each run had 1–2 **load timeouts**, in files I did not change (or did not change in a way the failure involves). Each passes alone; disclosed below.
- Integration: 2357/2358. The single failure is the expected media-type pin (§4).

## 4. Operations routed (delta to `p5-pending-be-m.ts`)

`createExport`, `listExports`, `getExport`, `downloadExport` and `cancelExport` were removed: the list is now empty. Each is exercised in `p5-exercises-be-m.ts` through the validating client, with its success and every declared refusal it can reach:

| Operation | Responses exercised |
|---|---|
| `createExport` | 202, 200 (same key), 400, 403 (AUD), 404, 422 `export.snapshot_discarded`, 422 `idempotency.key_reused`, 422 `export.format_not_offered` (when a transformation-level definition offers fewer than five formats) |
| `getExport` | 200, 400, 404 (unknown; another user's job) |
| `downloadExport` | 200 (`text/csv; charset=utf-8`), 400, 404, 409 `export.not_ready`, 422 `export.failed` |
| `listExports` | 200, 400 |
| `cancelExport` | 200, 400, 403 (AUD), 404, 409, 422 `export.not_cancellable`, 428 |

- **Zod mirrors:** `listExports` → `exportJobPage`, `createExport`/`getExport`/`cancelExport` → `exportJob`. They live in `apps/api/src/modules/reporting/exports/jobs.ts` because §F.5 assigns me no shared schema file (§5.4).
- **Pinned counts (D-079): the media-type triple goes `[368, 367, 1]` → `[369, 368, 1]`.** That is +1 JSON body, `createExport`; `cancelExport` is bodiless and the other three are GETs. Suggested comment line: `// T-DG5-BE-M: + createExport (1 JSON body; cancelExport is bodiless, the other three are GETs).`
- **Rate-limit floor:** unchanged by me (no new rate-limit class).
- **Contract test alone:** 74 passed, 1 failed. The failure is exactly this pin: `expected [ 369, 368, 1 ] to deeply equal [ 368, 367, 1 ]` (`T-DG5-BE-M-evidence/contract-test-alone.log`). I did not edit `contract.test.ts` (the BE-L precedent).

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **Workspace links and allow-list (§1, second table).** `@mth/reporting` is linked into `@mth/api` and `@mth/worker`, and `@mth/reporting/storage` is allow-listed for API module source. No registry package was added or upgraded.
2. **`export_job.requested` outbox event instead of "after COMMIT `boss.send`" (ADR-0046 §5 step 1).** The API has no pg-boss dependency, and the project's path from API to worker is the transactional outbox (ADR-0008). The job, its progress row, the audit event and the outbox row are written in one transaction. The relay sends to `reports.export` with job id = the outbox event id (exactly once) and `singletonKey` = `export_job.requested:<jobId>`. The ADR text says `singletonKey = exportJobId`. Please record this as an ADR-0046 note (ARCH), or tell me to change it.
3. **`ExportLiveSelection` has no `transformationId`.** I derive the transformation from `subjectId`: for a transformation-level output the subject is the transformation, and for a meeting, gate instance, business case or BAU handover I take the subject's `transformation_id`. A live selection without `subjectId` is refused with the existing `422 report.subject_invalid` (ADR-0045 §11 text); an unknown subject is 404. A contract note, or an optional `transformationId` member, is the architect's call.
4. **ExportJob zod mirror location.** FE-E will need `exportJob`/`exportCreate` in `@mth/shared/schemas` (for example `packages/shared/src/schemas/exports.ts` plus a barrel line). They are currently in the API module, ready to move verbatim.
5. **Download of a cancelled job.** ADR-0046 §5 says "the job must be `succeeded` (else 409 `export.not_ready`, or 422 `export.failed` for a failed job)". I followed it literally, so a **cancelled** job answers 409 `export.not_ready`, whose text ("not finished yet") fits poorly. Proposal for the architect: 422 `export.failed`, or a new code `export.cancelled` "This export was cancelled; start a new export." I invented no code.
6. **Idempotency of a live selection.** A repeated key is matched on format, language, definition, subject and period. The stored parameters are the assembler's normalized form, so raw parameters are not compared. Two concurrent first requests with the same key and a live selection can each generate a snapshot: one job wins (ON CONFLICT), and the loser's generated snapshot remains as an unexported `generated` snapshot. `snapshots.ts` (KBE-C's file) exposes no in-transaction insert to avoid this.
7. **Worker re-check of access.** The worker cannot import the API policy, so `requesterHolds` is the `grantApplies` rule in SQL: transformation scope, or business unit or organization scope for downward-inheriting roles, on an active, unrevoked, effective assignment with the permission. Tested positive and negative (`export.source_unavailable`).
8. **Packaging (D-146):** the worker must mount the evidence-storage volume (`EVIDENCE_STORAGE_PATH`) that the API reads. Still to be requested from devops in DG6.
9. **Migration:** none. `0084` was left unused (§F.8).

## 6. User-facing texts

- `apps/web/src/i18n/{en,ar}/nav.json` `exports.summary`: "PDF, Word, Excel, PowerPoint and CSV exports of selected records." With BE-M alone, only Excel and CSV are produced. It is true for the P5 release once BE-N (PDF/DOCX/PPTX) merges in the same stage. If BE-N does not land in P5, the owner of `nav.json` (FE) must change it. I did not edit it (not my file).
- **Missing web translations (FE-E, `problems.json`):** `export.format_not_offered`, `export.snapshot_discarded`, `export.not_cancellable`, `export.not_ready`, `export.failed`, and the job error codes `export.render_failed`, `export.too_large`, `export.source_unavailable`, `export.retries_exhausted`. English texts are as in ADR-0046 §8. `idempotency.key_reused` already exists in ADR-0007.
- **Content label table: no owner yet.** The renderers translate frame labels in both languages, but the `report.*` keys the assemblers emit (section titles, column labels such as `report.registers.raid.description`, code labels such as `report.raid_type.risk`) have no en/ar table that the worker can load. They render through a visible fallback (column "Description", code value "risk") and are reported in `RenderResult.missingLabels`. Arabic exports therefore show English fallback column headers for content keys. A content label table is needed (ADR-0045 §3 "translated at render time"), passed as `ExportRunnerDeps.labels`. I propose an API/shared i18n source owned by FE-E or KBE-C. That is the orchestrator's decision.

## 7. What remains

- REQ-S13-006's SUM half is end to end only once an assembler declares a total (§2).
- REQ-S13-005's PPTX half, PDF and DOCX, and the REQ-S13-008 PDF label are BE-N's.
- The content label table (§6), the web problem translations (§6), and the contract and ADR notes (§5.2, §5.3, §5.5).
- No architecture test yet pins "packages/reporting imports only `@mth/shared`" (it does). That is a one-line addition to `architecture.test.ts`, which is not my file.

## 8. Checks (real exit codes; logs in `docs/delivery/handbacks/DG5/T-DG5-BE-M-evidence/`)

**Environment.**
- Node 24.21.0, pnpm 10.33.0, offline, PostgreSQL 16.13 (disposable, `tests/qa/support/with-pg.sh`), harness ports 24050–24099.
- Load average 16–21 throughout: four W10 agents were running, on 16 GB with no swap.
- Empty sandbox `.claude/.cc-writes` and `.claude` directories under `apps/`, `packages/` and `tests/` were removed before every test run. A leftover `apps/api/src/modules/.claude` makes `architecture.test.ts` fail ("has only mapped module directories"); see run 1 below.

| # | Command | Exit | Result / counts |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start, 10:27Z) | **0** | `PASS gate DG4 (historical)` (`validate-historical-DG4.log`) |
| 2 | `pnpm -r typecheck` (final tree) | **0** | `typecheck.log` |
| 3 | `pnpm -r build` (final tree) | **0** | `build.log`; `packages/reporting/dist` produced |
| 4 | `pnpm lint` (final tree) | **0** | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final tree) | **0** | "All matched files use Prettier code style!" (`prettier.log`) |
| 6 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` (`openapi-lint.log`) |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (pre-fix tree, run 1) | **1** | unit-node 1964/1969 (5 failed: my own defects, all fixed; see below), unit-web 1400/1400, nocodegen 259 + 2 skipped (`unit-locale-unset-prefix-run1.log`) |
| 8 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (final tree) | **1** | unit-node **1968/1969**, unit-web **1399/1400**, nocodegen **259 passed + 2 skipped** (by design). The 2 failures are load timeouts; see below (`unit-locale-unset-final.log`) |
| 9 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (final tree) | **1** | unit-node **1968/1969**, unit-web **1400/1400**, nocodegen **259 passed + 2 skipped**. The 1 failure is a load timeout; see below (`unit-locale-cutf8-final.log`) |
| 10 | Load-timeout files alone: `vitest run --project unit-node apps/api/src/architecture.test.ts` (locale unset; and C.UTF-8) | **0**, **0** | 139/139 each (`rerun-unset-architecture.log`, `rerun-cutf8-architecture.log`) |
| 11 | `vitest run --project unit-web src/pages/change-requests/change-requests.test.tsx` (locale unset) | **0** | 15/15 (`rerun-unset-change-requests.log`) |
| 12 | `QA_PG_PORT=24050 MTH_PORT_POOL=24051-24099 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/reporting/exports.test.ts` | **0** | 16/16 (`exports-integration-alone.log`) |
| 13 | the same with `…/contract/contract.test.ts` | **1** | 74/75; the 1 failure is exactly the media-type pin `[369, 368, 1]` vs `[368, 367, 1]` (§4; `contract-test-alone.log`) |
| 14 | `QA_PG_PORT=24060 MTH_PORT_POOL=24061-24099 tests/qa/support/with-pg.sh pnpm test:integration` (run 1) | **1** | **244 files: 243 passed, 1 failed; 2357 passed, 1 failed (2358).** The only failure is the media-type pin (§4) (`integration-full-run1-midfix-tree.log`) |
| 15 | `QA_PG_PORT=24080 MTH_PORT_POOL=24081-24099 … pnpm test:integration` (final tree, attempt 1) | **1** | Aborted: the Vitest fork died (`Error: Channel closed`, `ERR_IPC_CHANNEL_CLOSED`) in `connection-hygiene.test.ts`, after the contract file (only the pin failed). No test assertion failed. Memory pressure is the likely cause (two integration runs and a unit run at once, no swap). Log kept: `integration-final-attempt1-fork-died.log` |
| 16 | `QA_PG_PORT=24085 MTH_PORT_POOL=24086-24099 … pnpm test:integration` (final tree, attempt 2) | **1** | **244 files: 243 passed, 1 failed; 2357 passed, 1 failed (2358).** The only failure is the media-type pin (§4). Finished at 12:23Z (`integration-final-tree.log`) |
| 17 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | **0** | `PASS gate DG4 (historical)` (`validate-historical-DG4-end.log`) |

**Disclosures.**

- **Run 7 (pre-fix), 5 failures, all my own and all fixed before runs 8–17:**
  - (a) A sandbox `apps/api/src/modules/.claude` directory tripped "has only mapped module directories". Fixed by removing the empty `.claude` directories.
  - (b) and (c) `jobs.ts` used a computed member (`SUBJECT_TABLES[...]`), which the module-interface check refuses, in two tests. Fixed: now a `Map`.
  - (d) `jobs.ts` spelled the lock class number in a comment, which the advisory-lock registry test refuses. Fixed.
  - (e) `reporting.test.ts` registers the module with a config that has no `evidenceStorage`, so creating the store at registration crashed. Fixed: the store is created on first use.
- **Runs 8 and 9, load timeouts (the F-DG4-143..148 class, D-134 envelope):**
  - `architecture.test.ts` "every import respects dependsOn…" timed out at its 30 s limit (plus a Vitest RPC `onTaskUpdate` timeout in run 8). This test walks the whole API tree, my new files included. It passes alone in both locale settings (row 10).
  - `change-requests.test.tsx` (web; I changed no web code) could not find its button in time in run 8. It passes alone (row 11) and passed in run 9.
- **Run 14's tree.** It started at about 11:12Z, before the four source fixes above, which landed at about 11:24Z (two-line changes in `jobs.ts` and `routes.ts`). Vitest loads sources per file, so files that ran after the fix used the fixed code. None of the four changes alters behaviour that the integration suite checks: `exports.test.ts` (16) passed in both trees, and run 16 covers the final tree.
- **Pinned count change:** integration 2342 (D-153) → **2358** (+16 `exports.test.ts`). Media-type pin `[368, 367, 1]` → `[369, 368, 1]` (+1, `createExport`), for the orchestrator to reconcile (§4).
- **Time:** start 10:27:05Z; end 12:22Z (about 115 minutes, inside the 2-hour limit). Integration run 16 finished at 12:23Z.

## 9. Merge instructions

- **No migration.**
- Run `pnpm install --offline` after the merge, so the `@mth/reporting` workspace links exist in `apps/api` and `apps/worker` (lockfile importer lines included).
- Build order: `packages/reporting` builds before `apps/*` (pnpm topological order; it depends on `@mth/shared`).
- **Expected conflicts (all additive):**
  - `apps/worker/src/handlers/reports.ts` and `queues/reports.ts`: my lines come after KBE-D's.
  - `packages/shared/src/schemas/events.ts`: one schema and one registry line.
  - `platform/db-errors.ts`: one mapper and one dispatch line after `mapP5OwnerUpdateError`.
  - `architecture.testkit.ts`: one allow-list line.
  - `contract.test.ts`: the pin, for the orchestrator to set to `[369, 368, 1]` plus other W10 deltas.
