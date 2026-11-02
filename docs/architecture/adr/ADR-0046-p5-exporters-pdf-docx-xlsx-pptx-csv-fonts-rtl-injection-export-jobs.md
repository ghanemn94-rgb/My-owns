# ADR-0046: Exporters: PDF, DOCX, XLSX, PPTX and CSV rendered server-side from report snapshots, bundled Arabic and Latin fonts, RTL/LTR layout, formula-injection rules, asynchronous export jobs with progress, export authorization equal to record views, and the dependency and licence evidence

- **Status:** Proposed for P5 (DG5). Author: solution-architect (T-DG5-ARCH-04), 2026-10-14.
- **Requirements (slice F of `docs/architecture/p5-plan.md`):** REQ-S13-005, REQ-S13-006, REQ-S13-009; with ADR-0045 for REQ-S13-004 (what is exported) and REQ-S13-008 (labels in exports).
- **Sources (quoted where a design point has one):**
  - M0253 (§13): "Include native reading/presentation views and actual export functions for relevant PDF, DOCX, XLSX, PPTX and CSV outputs. A report export must contain the selected records, not a generic placeholder. Spreadsheet exports must neutralize formula injection in user text while preserving deliberately authored numeric formulas where applicable."
  - M0254 (§13): "Label provisional/unvalidated values clearly and preserve bilingual layout in exports."
  - REQ-S13-006 procedure: "User text starting with =, +, -, @, tab or CR is escaped; system-authored numeric formulas are written as formulas". REQ-S13-005 automation: "Long export -> async job with progress". REQ-S13-009 procedure: "Exports render in the selected language with correct direction and bundled fonts".
  - M0310 (§16) and CLAUDE.md: every mandatory runtime service runs inside company-controlled infrastructure; no public CDNs or builder-hosted runtime dependencies.
  - The playbook has no export block; the provenance footer text is slice I's (B0004, REQ-PB-001).
- **Decisions applied:** D-142 **Q8** (export libraries and fonts: the architect chooses them with documentation, support-window and licence evidence; agent runs stay offline; the orchestrator checks the registry and installs into the lockfile before BE-M/BE-N; a package that cannot be provisioned makes the affected checks BLOCKED), D-141, D-145; ADR-0001 (exact pins, lifecycle scripts only on the allow-list `onlyBuiltDependencies: []`); D-088 §2 and F-DG3-100.
- **Builds on:** ADR-0001, ADR-0002 (`packages/reporting` reserved for "snapshot assembly and document exports"; rule 5: the worker imports no API code), ADR-0008 (worker, pg-boss, `RETRY_POLICY` 5 retries with backoff), ADR-0010 (evidence-storage adapter), ADR-0016 (lock registry), ADR-0043 §5 (failure capture on the last attempt), ADR-0045 (snapshots and the document model).
- **Physical model:** `0081_p5_export_jobs.sql` (this ADR), `0082_p5_reporting_permissions.sql` (`export.create`). Probe ids EJ01–EJ20 in `docs/delivery/handbacks/DG5/T-DG5-ARCH-04-evidence/probe-output.txt`.
- **Two gate systems.** No export template, header, footer or file name contains a DG0–DG7 string; an exported gate pack names product gates G1–G6 as business approvals. An export approves nothing.

## Context

1. `packages/reporting` is a reserved directory without a `package.json` (ADR-0002); `apps/api/src/modules/reporting/exports/routes.ts` and `apps/worker/src/{handlers,queues}/reports.ts` are BE-A stubs.
2. The workspace has no PDF, DOCX, XLSX or PPTX library. The local pnpm store (`/root/.local/share/pnpm/store/v10`, 256 index buckets searched by package name on 2026-10-14) holds none of `pdfkit`, `fontkit`, `docx`, `pptxgenjs`, `exceljs`, `jszip`, `pdf-lib`, `harfbuzzjs`, `fflate`. It holds `bidi-js@1.1.0` (a transitive dependency of the web test stack, in `pnpm-lock.yaml`), and `@fontsource/ibm-plex-sans-arabic@5.2.6` and `@fontsource/ibm-plex-sans@5.2.6`, which `apps/web` already depends on (exact pins).
3. This run is offline. The registry facts below that are marked **unverified** could not be checked here; the orchestrator checks them (D-142 Q8).

## Decision

### 1. Where rendering happens

- **All five formats are rendered in the worker**, from a stored report snapshot (ADR-0045), by pure renderer functions in a new workspace package **`@mth/reporting`** (`packages/reporting`, the ADR-0002 reservation): `render(document, { format, language, branding, labels }) → { bytes, sections }`. A renderer gets the document model and the already-translated label table; it reads no database and makes no network call.
- The API never renders. It validates the request, writes the job and sends it (§5). The worker imports `@mth/reporting`; the API imports only its dependency-free subpath `@mth/reporting/storage` (the export-file store, §5) and the document-model Zod schema from `@mth/shared/schemas` (ADR-0045 §3). So no renderer library is loaded by the API process.
- This places the renderers in `packages/reporting/src/**` instead of the `apps/api/src/modules/reporting/exports/{pdf,docx,xlsx,pptx,csv}.ts` files named in p5-plan §5.1, for two reasons: the worker cannot import API code (ADR-0002 rule 5), and ADR-0002 already reserves the package for this. File ownership in p5-work-split §F follows this ADR.

### 2. What an export contains (REQ-S13-005)

An export renders **exactly one snapshot** in one format and one language: every section, every row and every value of its content, in content order, with the same validation labels (ADR-0045 §5). There is no placeholder text: a section with no rows prints "No records" / "لا توجد سجلات" and its filter summary. An export of a live report first generates a snapshot from the request (ADR-0045 §2) and exports that, so the file always equals a stored, reproducible content. REQ-S13-005's tests: "an XLSX export of T15 contains exactly the filtered RAID rows" (the `registers` snapshot with `register = raid` and the filters) and "a PPTX gate pack contains the gate's criteria" (the `gate_pack` content lists every criterion with its state and evidence).

Every file carries, in its language: the product name (from the branding read port of slice I; until BE-R ships it, the DG1 product name), the output title, the transformation code and name, the subject, the period, the as-of time (Asia/Riyadh by default, the transformation's time zone), the snapshot ID, the issue version or **"Draft — not an issued report"** / **"مسودة — ليس تقريراً صادراً"** for a generated snapshot, the methodology version, the provisional legend, page or slide numbers where the format has pages, and slice I's provenance footer (B0004). Demo snapshots also carry slice J's synthetic label (ADR-0050).

### 3. Languages, direction and fonts (REQ-S13-009)

- **Language** is chosen per export (`en` or `ar`); labels come from the API's i18n tables at render time (ADR-0045 §3); user-authored text is printed as authored.
- **Digits.** Numbers, dates and identifiers use Latin digits 0–9 in both languages, as the web client does (`apps/web/src/lib/format.ts`: `ar-u-ca-gregory-nu-latn`; `packages/shared/src/value.ts` `intlNumberLocale`). Identifiers (`RAID-014`, UUIDs, SHA-256) are isolated as left-to-right runs inside Arabic text, so they read in their own order (REQ-S13-009 "an Arabic PDF renders RTL with readable numbers and identifiers").
- **Bundled fonts.** IBM Plex Sans Arabic (Arabic and Latin) and IBM Plex Sans (Latin), weights 400 and 700, from `@fontsource/ibm-plex-sans-arabic@5.2.6` and `@fontsource/ibm-plex-sans@5.2.6` (SIL Open Font License 1.1; §7). `@mth/reporting` depends on the two packages at the same exact versions as `apps/web`, and loads the `.woff` files from them at start-up: no font is fetched at run time, and no system font is needed. The `.woff` files are TrueType-flavoured (sfnt version `0x00010000`) and contain the `GSUB`, `GPOS` and `GDEF` tables that Arabic shaping needs (checked on this workspace's files, evidence `font-tables.txt`). Fontsource ships each family split by Unicode range (the `arabic`, `latin`, `latin-ext` files); the layout chooses the file that covers each run (below).
- **PDF (pdfkit, §7).** pdfkit embeds a subset of each font used. Its text layout does not reorder bidirectional text, so `packages/reporting/src/layout/**` does, per paragraph: (1) base direction = the export language (`ar` → RTL, `en` → LTR); (2) embedding levels with `bidi-js` (the Unicode Bidirectional Algorithm, UAX #9); (3) line breaking on the logical text, measuring runs with the embedded font; (4) for each line, the visual order of its runs (`bidi-js` reorder segments) and mirrored brackets in RTL runs; (5) each run drawn with the font file that covers its script, Arabic runs in logical order so that fontkit's OpenType layout applies the Arabic joining forms and ligatures from `GSUB` and returns the glyphs in visual order. Tables mirror their column order in RTL (first column on the right); page numbers and the footer follow the base direction.
- **DOCX (docx, §7).** Paragraphs `bidirectional` and runs `rightToLeft` in Arabic; complex-script font `IBM Plex Sans Arabic`, ASCII/high-ANSI font `IBM Plex Sans`, `w:lang` `ar-SA`/`en-GB`; tables `visuallyRightToLeft` in Arabic. The word processor shapes Arabic itself. The two families are embedded in the DOCX only if BE-N's test proves the embedding opens in LibreOffice 24.2 without a font warning; otherwise the file names the families, and a viewer without them substitutes a font (this is stated in the export's "About this file" section). Either outcome is recorded in BE-N's handback.
- **PPTX (pptxgenjs, §7).** Text boxes with `rtlMode` and `lang: 'ar-SA'` in Arabic, right-aligned; the families are named (pptxgenjs does not embed fonts). The presentation application shapes Arabic itself.
- **XLSX (own writer over jszip, §4).** Arabic sheets set `<sheetView rightToLeft="1">`; the named fonts are `IBM Plex Sans Arabic`/`IBM Plex Sans`; spreadsheets do not embed fonts.
- **CSV.** UTF-8 with a byte-order mark, CRLF line ends, RFC 4180 quoting; header labels in the export language. CSV has no direction or font; it is stated so in the export dialog.

### 4. Spreadsheets: formula injection and authored formulas (REQ-S13-006)

Every spreadsheet cell comes from a document-model value (ADR-0045 §3) and is written by its kind:

| Value | XLSX | CSV |
|---|---|---|
| `text` (user or system) | an inline-string cell (`t="inlineStr"`), never a `<f>` element; when the text's first character is `=`, `+`, `-`, `@`, TAB (U+0009) or CR (U+000D), the cell also gets the `quotePrefix` style, so a spreadsheet application keeps it as text when the cell is edited | the field is prefixed with an apostrophe `'` and quoted when its first character is one of those six; otherwise written as is (quoted when it contains a comma, quote, CR or LF) |
| `decimal` (validated or provisional) | a number cell with the canonical decimal string as its value; a value with more than 15 significant digits is written as text (spreadsheets read numbers as binary floating point) with the same companion status (below) | the canonical decimal string, unprefixed (a leading minus of a system number is not user text) |
| `unknown`/`stale` | an empty cell | an empty field |
| `date`, `timestamp`, `code`, `count` | text (ISO 8601 dates and times), text (translated label), number | the same text, the integer |
| table total (`formula: 'sum'`, system-authored) | a formula cell `<f>SUM(<col>first:<col>last)</f>` over the column's own data rows, with the decimal.js total as its cached value | the decimal.js total as a number (CSV has no formulas) |

- Only the totals the document model declares become formulas; their text is generated from a fixed template (`SUM` of one contiguous column range of the same sheet), never from user text. REQ-S13-006's tests: "a RAID description '=HYPERLINK(...)' exports as text; a system SUM total remains a formula".
- **Validation labels in spreadsheets.** Every decimal column is followed by a companion column "<label> — status" / "<label> — الحالة" holding Validated, Provisional, Unknown, Stale or n/a per row; provisional cells are also italic in XLSX. A legend sheet (XLSX) or legend rows at the end (CSV) explain the labels.
- The neutralization rule is one pure function `neutralizeSpreadsheetText(text) → { text, prefixed }` in `packages/reporting/src/injection.ts`, property-tested over the six leading characters and over strings that start with any other character.

### 5. Export jobs: asynchronous, with progress, exactly once

**Entity** `export_job` (`0081`): `snapshot_id`, `requested_by` (= `created_by`, CHECK `export_job_requester_creates`), `format` (closed set), `language` (`en` | `ar`), `idempotency_key`, `status`, `attempt_count` (0–20), `started_at`, `finished_at`, the stored file (`storage_key` under `exports/`, `file_name` ASCII, `content_type` equal to the format's, `file_sha256`, `file_size_bytes` ≤ 200 MiB; all present exactly when `succeeded`, CHECK `export_job_file_complete`, EJ11), `error_code` (closed set, exactly when `failed`, EJ19), `cancelled_at`/`cancelled_by`, P2 stamps and `version`. **Progress** `export_job_progress` (one row per job): `stage` (`queued`, `loading`, `rendering`, `storing`, `done`), `percent` 0–100, `sections_done`, `sections_total`; it only moves forward (EJ13), `done` only for a succeeded job (EJ14), version-stepped and not audited (the `job_run` precedent, ADR-0043 §6).

**State machine** (trigger `export_job_guard`; EJ06–EJ12, EJ16–EJ18):

```text
queued  -> running (attempt_count + 1) | failed | cancelled
running -> succeeded | failed | queued (a transient failure before the last attempt) | cancelled
succeeded, failed, cancelled: terminal
```

The request (`snapshot_id`, `requested_by`, `format`, `language`, `idempotency_key`) never changes (EJ18). The format must be one the snapshot's definition offers (EJ04), and a discarded snapshot is not exported (EJ05).

**Flow.**

1. `POST /exports` (`export.create`; body `snapshotId` or a live `report` selection, `format`, `language`; header `Idempotency-Key`, else a server key): in one transaction, re-check `transformation.read` and `export.create` in the snapshot's transformation, validate, insert the job (`queued`), its progress row, the audit event `export_job.create` and the outbox event `export_job.requested` (payload `{ exportJobId }`, idempotency key `export_job.requested:<id>`, ADR-0008); the outbox relay hands it to the queue `reports.export` after COMMIT (`REPORTS_EVENT_QUEUES` in `apps/worker/src/queues/reports.ts`). *(Corrected 2026-11-02, T-DG6-ARCH-12: this step first said `boss.send('reports.export', …)` after COMMIT; the code has used the outbox event since DG5, `jobs.ts` `enqueueExportRequested`.)* For a **live selection**, the start writes no snapshot and no outbox event; see the amendments of 2026-11-01 (H2) and 2026-11-02 (R3). A repeated request with the same key returns the existing job with 200 (UNIQUE `export_job_idempotency_key`, EJ03); a new job returns 202.
2. Worker `reports.export` (queue declared by BE-M in `apps/worker/src/queues/reports.ts`, standard `RETRY_POLICY`): under lock **730264** on the job id, `queued → running` (audited, actor `service`); re-check that the requester still holds `transformation.read` and `export.create` in the transformation, else `failed` with `export.source_unavailable` (not retried); load the snapshot content and the label table **outside** any transaction; render, updating progress per section; store the file (outside any transaction); then in one transaction `running → succeeded` with the file fields, progress `done` and the audit event.
3. A thrown error before the last attempt moves the job `running → queued` (audited) and rethrows, so pg-boss retries with backoff; on the last attempt the job becomes `failed` with `export.retries_exhausted` and the failure is captured in the failure queue (ADR-0043 §5, BE-I's capture lines) before rethrowing to `ops.failed`. A rendering error that retrying cannot fix (a renderer's own validation error) is `failed` with `export.render_failed` at once; a file above 200 MiB is `failed` with `export.too_large`.
4. `POST /exports/{id}/cancel` (requester, `If-Match`): `queued`/`running` → `cancelled`; the worker checks the status between sections and stops without storing a file.
5. Each export is asynchronous, including small ones, so the client always polls one status route (`GET /exports/{id}`, with `stage`, `percent` and the sections counts). REQ-S13-005's "Long export -> async job with progress" holds for every export.

**Storage.** The file is written through the export-file store `@mth/reporting/storage` (BE-M): the ADR-0010 filesystem driver pattern (write to a temporary name, fsync, atomic rename) under the configured evidence-store root with the key prefix `exports/`; the S3 driver arrives with evidence's in P6. The worker therefore mounts the same storage volume as the API (a packaging change requested from devops through the orchestrator, additive). P5 does not delete export files; retention is a later decision.

**Download** (`GET /exports/{id}/download`): only the requester; the job must be `succeeded` (else 409 `export.not_ready`, or 422 `export.failed` for a failed job); `transformation.read` is re-checked at download time (a requester who lost access gets 404, the same as a stranger). The response streams the bytes with the format's content type, `Content-Disposition: attachment` with the ASCII file name, `X-Content-Type-Options: nosniff` and `ETag` = the file's SHA-256. This is "export authorization equal to record views": the export was created from a snapshot of records the requester could read, and is downloaded only while the requester still can.

### 6. Authorization (permissions matrix §21)

| Operation | Permission | Role defaults (`0082`) |
|---|---|---|
| Create an export of a snapshot | `export.create` + `transformation.read` in the snapshot's transformation | SP, TL, BO, WL, FIN, TO, KDS, TD, CM, SEC |
| Create an export of a live selection | the above + `report.generate` (it generates the snapshot, ADR-0045 §2) | same |
| List, read, cancel, download own exports | requester + `transformation.read` (re-checked) | — |

AUD and the technical administrators hold no export code (AUD stays read-only: 403 on `POST /exports`). Every mutation re-checks authorization in its transaction, validates, requires `If-Match` on cancel (428/409), writes one audit event per job transition (`export_job.create|start|retry|succeed|fail|cancel`), and does no remote I/O inside a transaction.

### 7. Dependencies, licences and evidence (D-142 Q8)

Chosen set: four libraries, one bidi package and two font packages; the smallest set found that covers the five formats with Arabic shaping and no browser. Each must have **no install script** (ADR-0001 keeps `onlyBuiltDependencies: []`); the orchestrator rejects any package, direct or transitive, whose registry metadata has `hasInstallScript: true`.

| Package (exact pin requested) | Role | Licence | Native code / install scripts | Arabic and RTL | Official documentation | Support window / maintenance | Size | Verified here |
|---|---|---|---|---|---|---|---|---|
| `pdfkit@0.17.2` | PDF documents, font subsetting and embedding | MIT | pure JavaScript; no install script expected | shapes through its dependency `fontkit` (OpenType `GSUB`/`GPOS`, including the Arabic joining features); does **not** reorder bidi text, hence §3's layout with `bidi-js` | <https://pdfkit.org/> and the repository `foliojs/pdfkit` | community-maintained, no published support window; 0.x semver | **unverified** (orchestrator records the unpacked size) | **No** (not in the store; version, licence, scripts, size and transitive set unverified offline) |
| `@types/pdfkit` (the version matching pdfkit, dev) | TypeScript types | MIT (DefinitelyTyped) | types only | — | DefinitelyTyped | follows pdfkit | small | **No** |
| `docx@9.5.1` | DOCX documents | MIT | pure TypeScript; no install script expected | `bidirectional` paragraphs, `rightToLeft` runs, complex-script fonts; shaping is the word processor's | <https://docx.js.org/> | community-maintained, no published support window | **unverified** | **No** |
| `pptxgenjs@4.0.1` | PPTX presentations | MIT | pure JavaScript; no install script expected | `rtlMode`, `lang`; shaping is the presentation application's | <https://gitbrent.github.io/PptxGenJS/> | community-maintained, no published support window | **unverified** | **No** |
| `jszip@3.10.1` | ZIP container for the own XLSX writer (also a dependency of `docx` and `pptxgenjs`) | MIT or GPL-3.0-or-later (dual; used under MIT) | pure JavaScript | — | <https://stuk.github.io/jszip/> | mature, infrequent releases | **unverified** | **No** |
| `bidi-js@1.1.0` | Unicode Bidirectional Algorithm (UAX #9): embedding levels, reorder segments, mirroring | MIT | pure JavaScript; `scripts` has only `build`/`test`/`test-build` (no install hook); one dependency `require-from-string@2.0.2` (MIT) | the bidi part of §3 | <https://github.com/lojjic/bidi-js> | community-maintained, no published support window | 224 KiB unpacked | **Yes** (local `node_modules/.pnpm/bidi-js@1.1.0`, `package.json`; in `pnpm-lock.yaml`) |
| `@fontsource/ibm-plex-sans-arabic@5.2.6` | bundled Arabic + Latin font files | OFL-1.1 (`package.json` `license`, `LICENSE`: "licensed under the SIL Open Font License, Version 1.1") | font files and CSS; no scripts | Arabic glyphs with `GSUB`/`GPOS`/`GDEF` (checked) | <https://fontsource.org/fonts/ibm-plex-sans-arabic> | Fontsource-packaged IBM Plex (IBM, OFL) | 1.3 MiB unpacked (56 font files) | **Yes** (local; already an exact pin of `apps/web`) |
| `@fontsource/ibm-plex-sans@5.2.6` | bundled Latin font files | OFL-1.1 | font files and CSS; no scripts | Latin | <https://fontsource.org/fonts/ibm-plex-sans> | as above | 3.1 MiB unpacked | **Yes** (local; already an exact pin of `apps/web`) |

- **CSV** needs no library. **XLSX** is written by `packages/reporting/src/xlsx/**` (SpreadsheetML parts: content types, relationships, workbook, one sheet per table section, styles with `quotePrefix`, inline strings) over `jszip`: this keeps formula handling in our code (§4) and avoids a spreadsheet library with a large dependency tree.
- **Versions.** The pins above are the versions requested; they are **unverified offline**. The orchestrator checks for each, from the registry metadata: that the version exists and is the latest stable release of its line, its `license`, `hasInstallScript`, its dependency tree (each transitive package with licence and install-script status), its unpacked size and its publication date. If a newer stable release exists, the orchestrator pins that one and records it; if any package fails these checks, BE-M/BE-N's affected checks are BLOCKED and the user is told (D-142 Q8).
- **Licence obligations.** MIT and OFL-1.1 require their notices to ship with the product: `packages/reporting/THIRD_PARTY_NOTICES.md` (BE-N) lists each package with its licence text, and the OFL text accompanies the bundled fonts. OFL-1.1 allows embedding subsets in documents.

### 8. Refusal codes and English texts (exact)

| Status | Code | English text (exact) |
|---|---|---|
| 422 | `export.format_not_offered` | This output cannot be exported in that format. |
| 422 | `export.snapshot_discarded` | A discarded snapshot cannot be exported. |
| 422 | `export.not_cancellable` | Only a queued or running export can be cancelled. |
| 409 | `export.not_ready` | The export is not finished yet; check its progress. |
| 422 | `export.failed` | This export failed; start a new export. |

Job error codes (stored in `export_job.error_code`, shown translated): `export.render_failed` "The file could not be produced from this report; start a new export or report the problem."; `export.too_large` "The file would be larger than 200 MB; export a narrower selection."; `export.source_unavailable` "You no longer have access to this report's records."; `export.retries_exhausted` "The export failed after several attempts; it is in the failure queue." Generic codes are ADR-0007's; ADR-0045 §11 codes apply to a live selection.

### 9. Decimal and Unknown semantics in files

Numbers are printed from their canonical decimal strings with the shared display formatter (`formatDecimal`, half-up display rounding, the stored value never rounded), the unit kind and, for money, the ISO 4217 code (default SAR). Unknown and stale values print their label and no number in every format; spreadsheets leave the value cell empty and fill the companion status (§4). No format shows Unknown as 0 or colours it green.

## Alternatives considered

1. **A bundled headless browser (Chromium through Playwright) rendering HTML to PDF.** Rejected for P5: pdfkit with fontkit shaping and `bidi-js` covers Arabic, and the browser would add a large runtime image (the Playwright Chromium build is of the order of hundreds of MB; its exact size was not measured here) and a second rendering stack for PPTX/DOCX anyway. It stays the fallback if BE-N's tests show the pdfkit layout cannot pass REQ-S13-009; that would be a new decision with image-size and licence evidence.
2. **LibreOffice in headless mode as the converter.** Rejected as a runtime dependency (a very large image, MPL-2.0, a process to supervise). LibreOffice 24.2.7 is present on this build host and may be used **only by tests** to open the produced DOCX, XLSX and PPTX files and convert them to PDF/PNG for inspection (QA-C, A15); it is not shipped.
3. **`exceljs` for XLSX.** Rejected: a broad dependency tree for features P5 does not need, and formula handling would still need our neutralization layer.
4. **`pdf-lib` + `harfbuzzjs`.** Rejected: pdf-lib draws strings, not shaped glyph runs, so the glyph placement would be ours to write; pdfkit already lays out glyphs from fontkit.
5. **Synchronous small exports.** Rejected: one asynchronous path is simpler to authorize, audit and test, and satisfies "async job with progress" for every size.

## Consequences

- The worker image gains the renderer libraries and the fonts (≈ 4.4 MiB of font packages plus the libraries' unverified sizes); the API image gains none of them.
- `packages/reporting` becomes a workspace package (ADR-0002's reservation); its subpath `@mth/reporting/storage` is the only part the API imports. A new subpath of `@mth/shared` is not needed (the document model goes into the existing `@mth/shared/schemas`).
- Arabic PDF quality depends on our layout code over pdfkit; BE-N proves it on the A15 samples, and QA-C inspects them in both languages.

## Verification

- **Database (probe):** EJ01–EJ20 and the AO/AD grant probes in `docs/delivery/handbacks/DG5/T-DG5-ARCH-04-evidence/probe-output.txt`; font tables in `font-tables.txt` of the same folder.
- **Implementer tests (literal, p5-work-split §F):** an XLSX export of the RAID register with a filter contains exactly the filtered rows (REQ-S13-005); a PPTX gate pack lists each criterion of the gate (REQ-S13-005); a RAID description `=HYPERLINK(...)` is an inline string with `quotePrefix` in XLSX and `'=HYPERLINK(...)` in CSV, and the system total is `<f>SUM(…)</f>` (REQ-S13-006); an Arabic PDF has base direction RTL, embeds IBM Plex Sans Arabic, and its RAID identifiers and numbers keep their order (REQ-S13-009; text extraction plus the glyph-run check of BE-N, and QA-C's visual inspection); a pending benefit value prints "مؤقت"/"Provisional" in the PDF pack (REQ-S13-008); the export of the same request with the same key creates one job; a killed worker mid-export completes once; AUD gets 403 on `POST /exports`; another user's download is 404; a requester who lost `transformation.read` gets 404 on download.

## Amendment (2026-10-17, T-DG5-ARCH-R1; D-163, D-164 (g), D-166): B0004 and the illustrative label in every format, and the KPI target text

Sources: D-163 (F-DG5-qa-c-1, F-DG5-qa-c-2, QA-C O3), D-164 (g), D-166 (W20 integrated), and the handbacks of T-DG5-BE-N2 (§1–§3) and T-DG5-KBE-D4 (§2, Added scope 2). Nothing above is removed. This amendment states how §2's "slice I's provenance footer (B0004)" and "slice J's synthetic label" are placed in each format, and how §9 applies to a KPI target.

### E1. The B0004 provenance statement in XLSX and CSV (T-DG5-BE-N2; D-163 F-DG5-qa-c-1)

The statement is the text the worker passes as `branding.provenance`, read from the catalogue (`provenanceFooter`). `packages/reporting/src/model.ts:140` `provenanceText` returns that text, or null. With null, nothing is printed in its place, and the text is never invented.

- **XLSX** (`packages/reporting/src/xlsx/index.ts`). It is the **last row of every sheet**: About, each table sheet and Legend. It is a plain inline-string cell, never a formula, and it gets `quotePrefix` only if it ever started like a formula (§4).
- **CSV** (`packages/reporting/src/csv.ts:66–68`). It is **one row right after the header rows**, written through `csvCell`, so `neutralizeSpreadsheetText` applies. _Corrected 2026-10-23 (T-DG5-ARCH-RG1; D-185, amendment E5): the row is now at `csv.ts:71–73`. It is written by `textRow`, which builds each field with `textCell` (`model.ts:196–198`), so `neutralizeSpreadsheetText` decides the cell's `quotePrefix` once, and `csvCell` writes that decision as the leading apostrophe. `csvCell` no longer neutralizes a second time._
- **PDF, DOCX and PPTX** keep the footer of §2, unchanged.

Requirement rows: REQ-PB-001 and REQ-S20-015 (A15). Test: `tests/qa/integration/a15-outputs-every-definition.test.ts` › "every file, in every format, prints the B0004 provenance statement in its language", which passes unchanged.

### E2. The illustrative label in a demo snapshot's files (T-DG5-BE-N2; D-163 F-DG5-qa-c-2)

- **Source of the decision.** The label is printed exactly when the snapshot's content records `synthetic: true` (ADR-0045 amendment O1), decided by `model.ts:132` `illustrativeLabel`. The worker's own environment plays no part, so a file always matches the snapshot it renders.
- **Text** (label key `export.illustrative`, `packages/reporting/src/labels.ts`). It is in the file's language: "Illustrative example — synthetic" / "مثال توضيحي — اصطناعي" (ADR-0050 §2 (b), verbatim).
- **Placement:**

| Format | Where |
|---|---|
| PDF | under the product name in the header block, and in the top margin of **every** page (`pageHeaders()`; ink `#7A4B00`, 7.4:1 on white), start-aligned for the direction |
| DOCX | in the body's header block, and in a default page `Header` part (every page); a production file has no header part |
| PPTX | at the top of **every** slide, the title slide included |
| XLSX | the **first row of every sheet**, added when the sheet is created, so the §4 `SUM` ranges stay exact |
| CSV | the **first row** |

- **Production.** A production snapshot prints no label in any format.
- Requirement rows: REQ-PB-089 and REQ-S18-001. Tests: `packages/reporting/src/provenance-illustrative.test.ts` (24) and `apps/api/test/integration/reporting/report-synthetic.test.ts`.

### E3. The KPI target as display text in its own unit (T-DG5-KBE-D4; D-164 (g), QA-C O3)

- **Before.** The `registers` assembler (`{register: "kpis"}`) emitted the stored target string as a system `text` cell, so files printed for example `100.000000`.
- **Now.** `kpiTargetText(value, unitKind, currency)` (`apps/api/src/modules/reporting/reports/assemblers/registers.ts:519`) formats the target with the shared display formatter `formatDecimal` (§9: half-up **display** rounding, trailing zeros dropped, Latin digits; the stored value is never rounded), in the KPI's own unit kind, as the KPI screen does:
  - **money:** 2 fraction digits with the ISO 4217 code;
  - **percentage:** the stored fraction × 100, at 2 digits, followed by ` %`;
  - **any other unit:** up to 4 digits;
  - **no target:** null, so the cell shows n/a, never 0.
- **As built vs. D-164 (g).** D-164 (g) named "a `decimal` with each KPI's own unit kind". As built, and as D-166 records it, the target is **display text**.
  - **Why text.** One `decimal` column must never mix unit kinds (ADR-0045 §3), and the KPIs of one register have different units.
  - **What it means.** The column stays a system `text` column. The figure is not a spreadsheet number and carries no companion status column.
  - **Language.** The text is the same in en and ar (Latin digits, the same separators). A currency target reads `SAR 1,500,000` in both, because the content model has no per-language text cell.
- Requirement rows: REQ-S13-004 and REQ-S13-005. Tests: `apps/api/src/modules/reporting/reports/assemblers/kbe-d4.test.ts` and `apps/api/test/integration/reporting/kpi-target-text.test.ts` (the CSV renderer in en and ar prints `100` and `25 %`, never `100.000000` or `0.250000`).

Nothing here touches product gates G1–G6 or the engineering gates DG0–DG7. Demo files are synthetic illustrative examples, not Mobily performance.

## Amendment (2026-10-17, T-DG5-ARCH-R3; D-167, D-168): §5, no orphan file after a killed attempt

Sources: D-167 (QA-F2 D-QA-F2-3, Low), D-168 (W22 integrated), and the T-DG5-BE-T5 handback §2.2 (continued as T-DG5-BE-T5B). Nothing above is removed or corrected. This amendment adds one storage rule to §5 as merged at `b463552`. No migration, no API or contract change, and no change to the export-file store (`packages/reporting/src/store*`).

### E4. The worker removes earlier attempts' files (T-DG5-BE-T5; D-QA-F2-3)

- **The gap.** Each attempt writes its own file, `exports/<org>/<job>-a<attempt>.<ext>`, so a stale attempt can never overwrite the recorded file (§5, "Storage"). An attempt killed after `store.put` and before its success commit left a file that no job row records.
- **As merged** (`apps/worker/src/reports/export-runner.ts`):
  - `attemptStorageKey(job, attempt)` builds one attempt's key from the job's own id (`:334–336`).
  - `discardEarlierAttempts(store, job)` removes the keys of attempts 1 to `attempt_count − 1` through the store port's existing `discard` (`:346–351`). A missing object is a no-op, and a store error is swallowed, so the file stays for the next attempt and the export does not fail.
  - `runExport` calls it when an attempt starts (`:367`) and again after a successful commit (`:455`). The current attempt's key is never in the range, and no other job's key is ever built.
  - The rest of §5 is unchanged: a failed or cancelled attempt still removes its own file (`:454`).
- **Tests.**
  - Unit: `apps/worker/src/reports/export-runner.test.ts` (`describe` at `:24`): the exact keys, idempotence, swallowed store errors, and the current key untouched.
  - Integration: `apps/api/test/integration/reporting/exports-orphan.test.ts` (`describe` at `:88`). At `:89`, attempt 1 is killed after `put`, attempt 2 removes its file when it starts, only `a2` remains, and another job's files are untouched. At `:142`, an earlier file written while the succeeding attempt renders is removed when that attempt succeeds.
  - Black-box: `tests/qa/integration/a13-jobs-rerun.test.ts` passed unchanged, including its orphan assertion (T-DG5-BE-T5 handback §2.2; D-168: D-QA-F2-3 closed).

Nothing here touches product gates G1–G6 or the engineering gates DG0–DG7.

## Amendment (2026-10-23, T-DG5-ARCH-RG1; D-185, F-DG5-101): §4, a long negative decimal is unprefixed in CSV, and the CSV neutralization is decided once

Sources: D-185 (F-DG5-101, Low, code-security round 1) and the T-DG5-BE-RG1 handback §5 item 4, verified against the merged code (`1e6a545`). §4 is unchanged; this amendment makes its CSV column true for every decimal. No contract, migration or XLSX writer change.

### E5. CSV follows the cell's `quotePrefix` decision (T-DG5-BE-RG1; F-DG5-101)

- **The defect (historical).** A decimal with more than 15 significant digits is a `text` sheet cell with `quotePrefix: false` (`valueCell`, `packages/reporting/src/model.ts:201–208`: a system number, never prefixed). `csvCell` neutralized every text cell again, so a long **negative** decimal (for example `-12345678901.23456`) was written as `'-12345678901.23456`, contrary to §4 ("the canonical decimal string, unprefixed").
- **As merged** (`packages/reporting/src/csv.ts`):
  - **One decision.** `textCell(text)` (`model.ts:196–198`) sets `quotePrefix` from `neutralizeSpreadsheetText(text).prefixed`. XLSX and CSV both read that flag.
  - **The CSV writer.** `csvCell` writes a text cell as `'<text>` when `quotePrefix` is true and as the text otherwise, quoted by `csvField` when needed (`csv.ts:45–56`, the text case at `:54`). It no longer calls `neutralizeSpreadsheetText` itself.
  - **Plain text rows.** `textRow` (labels, frame values, titles, the B0004 statement, the illustrative label, the legend) builds each field with `textCell` (`csv.ts:59`), so these texts are still neutralized.
- **Result.** Positive and negative decimals, long and short, and a long negative total, are written as their canonical strings, unprefixed. User text that starts with one of the six §4 characters keeps its apostrophe, in English and in Arabic. XLSX already used the flag: a long negative decimal is an inline string without `quotePrefix`.
- **Tests.** `packages/reporting/src/csv.test.ts` (`describe` at `:136`: the reviewer's reproduction, the long and short cases with a long negative total at `:158`, an injection string that keeps its apostrophe, and `csvCell` following `quotePrefix`), and `packages/reporting/src/xlsx/xlsx.test.ts` ("a negative decimal of more than 15 significant digits is text without quotePrefix").

Requirement row: REQ-S13-006. Nothing here touches product gates G1–G6 or the engineering gates DG0–DG7.

## Amendment (2026-10-25, delivery-orchestrator; D-191, F-DG5-100): §3, characters XML 1.0 cannot carry

- Every OOXML writer (DOCX, PPTX, XLSX) replaces the characters XML 1.0 cannot carry (C0 controls other than tab, LF and CR; lone surrogates; U+FFFE and U+FFFF) with U+FFFD, through the shared `packages/reporting/src/xml-chars.ts` (`xmlSafe`), and checks the finished package (`assertWellFormedChars`). A package that still holds such a character is a `RenderError` (`export.render_failed`): no file is stored and the job does not report succeeded.
- Stored record text is not changed; the input rule (`hasInvalidCharacter`, ADR-0007) is unchanged.

## Amendment (2026-11-01, T-DG6-ARCH-11; D-207, F-DG6-147): §2, §5 and §6, a live selection is assembled after the start, not in it

Sources: D-207 (`docs/delivery/decisions.md`, read verbatim), F-DG6-147, and the T-DG6-BE-Y4 handback (its measurement: about 55 % of a live-selection start was report assembly, and trimming it did not bring 50 simultaneous starts under 2 s). The implementation is T-DG6-BE-Y5's. This amendment records the design that D-207 decides. Where it differs from §2, §5 or §6 above, it wins. Nothing else above is removed. When this amendment was written (main checkout at `8268ac5a6`), BE-Y5 had not yet written its migration or code, so it cites no file lines. The names below (`live_selection`, the CHECK, the index and the watch) are the architecture's. If the merged files use other names, the orchestrator reconciles them with this text at merge (handback Q4). **Reconciled on 2026-11-02 by T-DG6-ARCH-12 with what T-DG6-BE-Y5 shipped (amendment R below): where H1–H6 and R differ, R wins.**

### H1. What changes in §2

§2 said: "An export of a live report first generates a snapshot from the request (ADR-0045 §2) and exports that." That still holds, but **the generation no longer happens in the request**:

- An export still renders exactly one stored snapshot, and the file still equals a stored, reproducible content. Nothing is ever rendered from a live query.
- For a live selection, the snapshot is assembled **after** the 202, by the snapshot watch (H3). Until then the job has no snapshot (`snapshotId` is `null`).
- **Data-as-of** is the assembly time, recorded on the snapshot (`report_snapshot.as_of`) as before (D-207 (5)). It is not the request time. A user who starts an export reads the data-as-of from the snapshot, not from the job's `createdAt`.
- **Exports of an existing snapshot (`snapshotId` in the body) are unchanged** (D-207 (5)). They have a snapshot from the INSERT, and they are never touched by the watch.

### H2. The start (§5 Flow step 1, live selection) — reconciled by R3

`createExport` with a `report` selection (D-207 (1)):

1. **Synchronously, before any write**, as in DG5: validate the body (`ExportCreate`, the definition offers the format), resolve the transformation from the subject, check `transformation.read`, `export.create` and `report.generate`, and run the restricted-source check. **D-199's 403 `export.includes_restricted_records` is unchanged**: a start that DG5/DG6 refused with 403 is still refused with 403, before the 202, and writes nothing. How that check is computed without an assembled snapshot is BE-Y5's to implement and test, and the `sensitive-reads` tests stay unchanged (BE-Y5 assignment). It is listed as Q1 in the handback.
2. **In one transaction**, after the grants are reloaded (commit-time re-authorization, unchanged): insert the job (`queued`, `snapshot_id` NULL, `live_selection` = the validated selection), its progress row (`stage = queued`, `percent = 0`) and the audit event `export_job.create`. **No snapshot and no `export_job.requested` outbox event are written here.**
3. Answer **202** with the job. `snapshotId` is `null`, and `GET /exports/{id}` shows the same until assembly. No new progress stage is added: a pending job is `queued` at 0 %.

An idempotent replay (same requester and `Idempotency-Key`) **compares the stored selection** (`live_selection`, `format` and `language`) with the request, not the snapshot (D-207 (3)). It answers 200 with the job whether or not the job has been assembled yet. A different request under the same key is still the DG5 refusal `idempotency.key_reused`.

### H3. The snapshot watch (new; D-207 (2)) — reconciled by R4 and R5

- **Where.** The watch runs in the **API process**, not in the worker. The assemblers are API code (`apps/api/src/modules/reporting/reports/assemblers/*.ts`). ADR-0002 rule 5 lets packages depend in one direction only (`apps/*` → `packages/*`), so `apps/worker` cannot import `apps/api`. This is the reason ADR-0046 §1 gives for keeping renderers in `@mth/reporting`, and the reason ADR-0055 §2 gives for running connector runs in the API.
- **The precedent: the connector run watch** (ADR-0055 §2, "The run", as amended on 2026-10-30 by T-DG6-ARCH-07). That watch is `connectorRunWatchStep` in `apps/api/src/modules/integrations/runs.ts`. `integrations/index.ts` starts it at `onReady` and stops it at `onClose`. It is not started under `NODE_ENV=test`, where suites drive the step directly. Several API replicas are safe because of the claim and the state transition. The snapshot watch follows the same pattern from the `reporting` module's `index.ts`. Its step is exported, so suites drive it directly. It polls every **1 s**, because a user is waiting on an interactive export and the connector watch's 10 s is too slow. BE-Y5 may change the interval if a measurement justifies it, and must state it in its handback.
- **The claim.** For each pending job (`status = 'queued'` and `snapshot_id IS NULL`, served by `export_job_pending_assembly_idx`, oldest `created_at` first), one transaction runs:
  1. `SELECT … FOR UPDATE SKIP LOCKED` on the job row. A job locked by another watcher is skipped, so several API replicas never assemble the same job.
  2. Re-check the requester's access on fresh grants: `transformation.read`, `export.create` and `report.generate` in the job's transformation.
  3. Assemble the selection (database reads only, no remote I/O) and insert the snapshot with the requester as `created_by`, together with its sources, versions and evidence, as in DG5. Also run the restricted-source check on the assembled snapshot's sources.
  4. Set `export_job.snapshot_id` (version step, audit event `export_job.assemble`).
  5. **Only then** write the `export_job.requested` outbox event. The relay hands it to `reports.export` after COMMIT, and the worker's flow (§5 steps 2–5) is unchanged.

  A crash or restart before COMMIT rolls everything back, and the job is still pending, so the next watch tick resumes it. The row lock and the `snapshot_id IS NULL` predicate make sure a job is assembled **at most once**, and the guard's "assigned once" rule backs this up (H4).
- **Access lost between the start and the assembly** (D-207 (2)). If step 2 fails, or step 3 finds a restricted source, the same transaction moves the job `queued → failed` with `error_code = 'export.source_unavailable'` and `finished_at`, and writes the audit event `export_job.fail`. No snapshot is written, no outbox event is written, and **no file is ever written**. `export.source_unavailable` is the existing DG5 code, and it already has its en/ar text in the web catalogue. It has the same meaning as the worker's re-check in §5 step 2. So the error-code set and the contract enum do not change (Q2 in the handback).
- **An assembly error** (an assembler throws) rolls the transaction back, and the job stays pending for the next tick. A selection whose assembly fails the same way repeatedly is bounded by BE-Y5. The design point is that it ends `failed` with `export.render_failed` and never loops silently (Q3).
- **Cancel.** `POST /exports/{id}/cancel` on a pending job moves it `queued → cancelled` (unchanged). If the watch holds the row at that moment, the cancel waits for it. The cancel then sees the new `version` and gets the usual 409, and the client re-reads and cancels again. A cancelled pending job is never assembled, because the claim takes only `queued` jobs.
- **No new lock class.** The claim is the row lock with `SKIP LOCKED`, so ADR-0016's registry gets no new number. The worker's lock 730264 is unchanged.
- **Attribution.** The watch's job writes are made by the API process on behalf of the requester. They use the service-actor pattern of the worker's job transitions (§5 step 2, "actor `service`"), with the requester recorded as in `export-runner.ts`'s `jobActor`. The snapshot stays the requester's (`created_by`), so its ADR-0045 issue and discard rights are the same as in DG5.

### H4. Physical model: migration `0124` (D-207 (4)) — superseded by R1 and R2 (shipped names)

`0124` is the next id above `0123` on BE-Y5's branch (D-196). The seed free-id example in `packages/db/src/seed.test.ts` moves to `0125`. The data dictionary ("P6 round-1 repair migration 0124") and the ERD (§1ab) record:

- `export_job.snapshot_id` becomes **nullable**. The composite FK `export_job_snapshot_fkey` is unchanged, and a NULL is not checked (MATCH SIMPLE).
- New column `export_job.live_selection jsonb NULL`. It holds the validated `ExportLiveSelection` (`definitionCode`, optional `subjectId`, `reportingPeriodId` and `parameters`). It is NULL for the export of an existing snapshot. Its shape is checked by zod before the write (typed JSON, never an unvalidated blob), and the database bounds it with the CHECK `export_job_live_selection_shape` (an object of at most 8,192 bytes, the bound of `report_snapshot.parameters`).
- New CHECK `export_job_snapshot_pending`. A job names a snapshot or a selection. A job without a snapshot is only `queued` (pending), `failed` (access lost) or `cancelled`. `running` and `succeeded` therefore always have a snapshot, and the worker's flow never sees a NULL.
- `export_job_guard()` is replaced:
  - on INSERT, a NULL `snapshot_id` needs a `live_selection` whose definition offers the format;
  - `snapshot_id` may change only once, from NULL to a snapshot, while the job is `queued`;
  - that snapshot must be in the job's transformation, not discarded, of the selection's definition, and offer the format;
  - `live_selection` never changes;
  - every other DG5 rule is unchanged (request fixed, transitions, finished jobs frozen, each start is the next attempt).
- New partial index `export_job_pending_assembly_idx` on `(created_at, id) WHERE status = 'queued' AND snapshot_id IS NULL`, for the watch's claim.

Rows written before `0124` all have a snapshot and a NULL `live_selection`, and they satisfy both CHECKs, so no backfill is needed.

### H5. Contract (D-207 (3); owned by T-DG6-BE-Y5) — superseded by R5 (the error-code enum changed)

`ExportJob.snapshotId` becomes `{ type: [string, "null"] }` (a UUID, or `null` until the snapshot is assigned). It stays in `required`. The operations, status codes, the `ExportCreate` body and the error-code enum are unchanged. This document does not edit `docs/api/openapi.yaml`, the zod mirrors or the web client. BE-Y5 owns them (its assignment, "Contract change"). The change is a breaking change of a DG5 response field type (D-207 decides it), so it is raised as such in the handback.

### H6. §6 authorization, restated

The live-selection row of the §6 table still needs `export.create`, `transformation.read` and `report.generate`. They are checked **twice**: at the start (synchronously, with D-199's 403) and again at assembly (H3 step 2). A loss of access between the two gives a failed job and no file. Download is unchanged (requester only; `transformation.read` re-checked; others 404).

Requirement rows: REQ-S13-005 ("Long export -> async job with progress"), REQ-S20-030 (ADR-0058 amendment T2). Nothing here touches product gates G1–G6 or the engineering gates DG0–DG7.

## Amendment (2026-11-02, T-DG6-ARCH-12; D-207, F-DG6-147): reconciliation of H1–H6 with what T-DG6-BE-Y5 shipped

Sources: D-207 (read verbatim), the T-DG6-ARCH-11 handback (its questions Q1–Q4) and the T-DG6-BE-Y5 handback. The design was checked against the shipped files at the integrated `HEAD` `a973b5673`:

- `packages/db/migrations/0124_p6_export_live_selection_pending.sql`;
- `apps/api/src/modules/reporting/exports/assembly.ts`, `jobs.ts` and `routes.ts`;
- `apps/api/src/modules/reporting/reports/snapshots.ts`;
- `packages/shared/src/schemas/export-jobs.ts`;
- `docs/api/openapi.yaml` (`ExportJob`).

The physical model was read from the catalogue of a disposable PostgreSQL 16 database with all 116 migrations applied (`docs/delivery/handbacks/DG6/T-DG6-ARCH-12-evidence/01-catalog-0124.log`). **Where H1–H6 and this amendment differ, this amendment wins.** H1 (an export renders exactly one stored snapshot; data-as-of is the assembly time, `report_snapshot.as_of`; exports of an existing snapshot are unchanged) and H6 (the permissions are checked at the start and again at assembly) hold as written.

### R1. Names

| H1–H6 said | Shipped (binding) |
|---|---|
| column `live_selection` | column `export_job.selection jsonb NULL` |
| CHECKs `export_job_live_selection_shape` and `export_job_snapshot_pending` | one CHECK, `export_job_selection_pending` (R2) |
| file `0124_p6_export_job_pending_snapshot.sql` | `0124_p6_export_live_selection_pending.sql` |
| "the snapshot watch", started from the `reporting` module's `index.ts` | **the export assembly watch**: `startExportAssemblyWatch` / `exportAssemblyWatchStep` in `reporting/exports/assembly.ts`, started at `onReady` and stopped at `onClose` by `reporting/exports/routes.ts` |
| index `export_job_pending_assembly_idx` | unchanged name: `(created_at, id) WHERE ((snapshot_id IS NULL) AND (status = 'queued'))` |

### R2. Physical model (supersedes H4)

- `export_job.snapshot_id` is nullable. The composite FK `export_job_snapshot_fkey` `(transformation_id, snapshot_id)` → `report_snapshot (transformation_id, id)` is unchanged (MATCH SIMPLE, so a NULL is not checked). **That FK is what keeps an assigned snapshot in the job's transformation.**
- `export_job.selection jsonb NULL` is the stored `ExportLiveSelection`: only the members the request carried, from `definitionCode`, `subjectId`, `reportingPeriodId` and `parameters` (`selectionToStore`). It is NULL for an export of an existing snapshot.
- CHECK `export_job_selection_pending`, as `pg_get_constraintdef` prints it:
  `CHECK ((((snapshot_id IS NOT NULL) OR ((selection IS NOT NULL) AND (status = ANY (ARRAY['queued'::text, 'failed'::text, 'cancelled'::text])))) AND ((selection IS NULL) OR ((jsonb_typeof(selection) = 'object'::text) AND (jsonb_typeof((selection -> 'definitionCode'::text)) = 'string'::text)))))`.
  A job without a snapshot carries a selection and is `queued`, `failed` or `cancelled`, so `running` and `succeeded` always have a snapshot. A selection is an object with a string `definitionCode`.
- **No database size bound on `selection`** (H4 asked for 8,192 bytes). The architect accepts what shipped. The selection is bounded and validated before it is written: zod `exportLiveSelection` is a strict object, and the synchronous `checkReportRequest` → `resolveRequest` refuses parameters above `REPORT_MAX_PARAMETER_BYTES` (8,192) with 422 `report.parameters_invalid`. The watch re-parses the stored value with the same zod schema before use (`storedSelection`). The request-body limit of ADR-0052 §4 bounds it too. This is typed, validated JSON, not an unvalidated blob.
- `export_job_error_code_check` gains `export.includes_restricted_records` and `export.assembly_failed`. **The closed set changes**, which supersedes H3's "the error-code set … do[es] not change" (R5).
- `export_job_guard()` is replaced (`CREATE OR REPLACE`, the same trigger):
  - **INSERT with a NULL snapshot:** the selection's `definitionCode` must name a `report_definition` that offers the format (`export_job_format_offered`).
  - **UPDATE:** `requested_by`, `format`, `language`, `idempotency_key` and `selection` never change. A non-NULL `snapshot_id` never changes. A NULL `snapshot_id` changes to a snapshot only while both `OLD.status` and `NEW.status` are `queued` (`export_job_request_immutable`).
  - **An assigned snapshot** is checked as on INSERT: it is not discarded (`export_job_snapshot_exportable`), and its definition offers the format.
  - Transitions, the frozen finished job and the attempt step are unchanged.
  - **The guard does not check that the assigned snapshot's `definition_code` equals `selection.definitionCode`** (H4 asked for it). Today the application guarantees it: the watch inserts the snapshot from the stored selection in the same transaction that assigns it. A defence-in-depth check in the database is proposed to the owner as a Low finding, not changed here (T-DG6-ARCH-12 handback).
- No row changes and no backfill. `mth_app` keeps INSERT, SELECT and UPDATE on `export_job`.

### R3. The start, as shipped (supersedes H2 where they differ; answers Q1)

**Q1 is answered: D-199's 403 is computed synchronously without an assembled snapshot in the common case, and with a discarded read-only assembly otherwise.** In `createExport`, `requireUnrestrictedLiveSelection`:

1. calls `transformationHasRestricted`, one indexed query on `record_sensitivity` (`record_sensitivity_transformation_idx`) through the same `restrictedAmong` admission rule. If the requester is restricted from **no** record of the transformation, no assembly can include a restricted record, so nothing is assembled in the request;
2. otherwise assembles the report read-only in the request, exactly as before D-207. Its sources decide the 403 `export.includes_restricted_records`, and the assembly is discarded.

So every DG5/DG6 403 case is kept. `sensitive-reads.test.ts` keeps its 403 assertions, with one case now reading the snapshot id from GET after a watch step. The cost for ADR-0058 T2: a requester restricted from some record of the transformation still pays the assembly in the request (ADR-0058 amendment T3).

The remaining checks stay synchronous: the definition, the subject's transformation (404 for an unknown subject), `export.create` and `report.generate`, `export.format_not_offered`, and the report request's own 422 `report.*` refusals (`checkReportRequest`). One transaction then re-checks the permissions on reloaded grants and writes the job (`snapshot_id` NULL, `selection`), its progress row and `export_job.create`, with no snapshot and no outbox event. The answer is 202 with `snapshotId: null`, and the route then wakes the watch (`kick`).

**Idempotent replay** (`sameRequest`): `format` and `language` must be equal. For a live body, the stored selection must match: `definitionCode`, `subjectId`, `reportingPeriodId`, and `parameters` compared as canonical JSON. Before D-207 the live comparison ignored `parameters`. A snapshot-id body under a live job's key (or the reverse) is 422 `idempotency.key_reused`. A job created before `0124` has no stored selection, so replaying its key with a live body is 422. This is a deploy-boundary edge only.

**Download** of a job with no snapshot answers as before: 409 `export.not_ready` while pending, 422 `export.failed` once failed.

### R4. The export assembly watch, as shipped (supersedes H3 where they differ)

- **Who drives it.** Every API process, every `EXPORT_ASSEMBLY_INTERVAL_MS` = **1,000 ms**, plus a `kick` right after a pending 202. It runs at most one step at a time per process. A step runs `EXPORT_ASSEMBLY_CONCURRENCY` = **2** claim loops, each of at most `EXPORT_ASSEMBLY_BATCH` = 50 jobs, and the next tick continues. It is not started under `NODE_ENV=test`, where suites call `exportAssemblyWatchStep`, nor by a route-only instance. The four `EXPORT_ASSEMBLY_*` values are code constants exported from `assembly.ts`, not environment variables. Changing one is a code change backed by a measurement.
- **One transaction per job** (`assembleNextExport`):
  1. **Claim.** The oldest pending job (`snapshot_id IS NULL AND status = 'queued'`, ordered by `created_at, id`), `FOR UPDATE SKIP LOCKED`. Then `pg_try_advisory_xact_lock` on the **existing** class `exportJob` (**730264**, ADR-0016), the class that cancel and the worker hold. It is tried and never waited for, so a job that cancel is holding is skipped. **ADR-0016 still gets no new number** (H3), but the claim is the row lock **plus** that try-lock, not the row lock alone.
  2. **Access check** on the current grants: an active user who holds `transformation.read`, `export.create` and `report.generate` in the job's transformation. Otherwise the job fails with `export.source_unavailable`.
  3. **Assembly.** `assembleReport` runs on its **own read-only REPEATABLE READ connection** while the claim is held. It is not part of the claim transaction (H3 said "in the transaction"). It makes database reads only and no remote I/O. Its `asOf` becomes the snapshot's data-as-of. A refusal of the report itself (any 4xx `HttpProblem`: subject, period or parameters 422, `report.too_large`, a 404 subject or output) fails the job with `export.assembly_failed`.
  4. **Commit-time access check** on grants reloaded after the assembly. A loss of access fails the job with `export.source_unavailable`.
  5. **D-199 on the assembly's actual sources** (`restrictedAmong`). A restricted source fails the job with **`export.includes_restricted_records`** (H3 said `export.source_unavailable`; R5).
  6. **Writes:**
     - the snapshot (`insertGeneratedSnapshot`: the same rows and the same `report_snapshot.generate` audit event as `generateSnapshot`, `created_by` = the requester);
     - `snapshot_id` with version + 1 (audit `export_job.assemble`, changes `snapshot_id` null → id);
     - the `export_job.requested` outbox event.

     The worker's flow (§5 steps 2–5) is unchanged.
- **Every failure** is `queued → failed` with `error_code` and `finished_at`, version + 1, audited `export_job.fail` with the prior and new version, in the same transaction. No snapshot, no outbox event and no file is written.
- **Attribution** (`ASSEMBLY_ACTOR`): `actorType = 'service'`, `actorUserId = null`, `onBehalfOfUserId` = the requester, `requestId = export_job:<id>`. This applies to `export_job.assemble`, `export_job.fail` and the snapshot's `report_snapshot.generate`.
- **Bounded retry (answers Q3).** An unexpected error, meaning anything but a report refusal, rolls the transaction back, and the job stays pending for the next tick. After `EXPORT_ASSEMBLY_MAX_ERRORS` = **3** such errors for one job in one process, the next claim fails it with **`export.assembly_failed`**, not `export.render_failed` as H3 proposed. `export.render_failed` stays the worker's renderer error (§5 step 3). The count is in memory per process, so a restart starts it again. The bound therefore holds per process lifetime, and a job never loops silently inside one process.
- **At most once.** The claim, the snapshot, the assignment and the outbox event commit together. The guard refuses a second assignment, and the outbox key `export_job.requested:<id>` is unique. A crash before COMMIT leaves the job pending.
- **Cancel** takes the job's advisory lock (blocking) and then reads the row. If the watch holds the job, the cancel waits until the watch commits. It then answers with the new version, so the client's stale `If-Match` gets 409, and the client re-reads. A job being cancelled is skipped by the watch's try-lock. A cancelled job is never claimed.
- **Pool use.** Each concurrent claim holds two connections, the claim transaction and the assembly's read connection. So the watch uses up to 4 connections per API process at the default concurrency, out of the API pool of 20 (`apps/api/src/main.ts`, `createPool(…, { max: 20 })`).

### R5. Error codes (answers Q2) and contract (supersedes H5)

**Q2 is answered.** Access lost between the start and the assembly fails the job with the existing `export.source_unavailable`, as H3 said. A restricted source found only at assembly uses the dedicated job code `export.includes_restricted_records`, D-199's code, now also stored on a job. A failed assembly uses the new job code `export.assembly_failed`. **The contract enum changes:** `ExportJob.errorCode` in `docs/api/openapi.yaml` and `EXPORT_ERROR_CODES` in `packages/shared/src/schemas/export-jobs.ts` gain both codes. `ExportJob.snapshotId` is `NullableUuid` and stays required. Operations and status codes are unchanged. Both changes are D-207 (3) consequences, raised by ARCH-11 and BE-Y5 as breaking changes of a DG5 response.

Job error codes added to §8. These are stored in `export_job.error_code` and shown translated. The English texts are exact and equal `apps/web/src/i18n/en/problems.json`. The Arabic texts are in `ar/problems.json`.

| Where | Code | English text (exact) |
|---|---|---|
| job (assembly) | `export.includes_restricted_records` | This report includes records you cannot see, so it cannot be exported for you. |
| job (assembly) | `export.assembly_failed` | The report could not be assembled from the current records (its subject or period changed, or it became too large); start a new export. |

(The table's first column is not an HTTP status. These are job codes, not responses. `fee.test.tsx` pins the number of §8 codes it reads to 24, and it does not read this table. Extending that test to these two codes is listed for its owner in the T-DG6-ARCH-12 handback.)

**Web.** A job with `snapshotId === null` shows no snapshot link. It shows "Preparing the report: its snapshot is assembled from the current records before the file is produced." while queued and "No snapshot was produced." once failed or cancelled, in en and ar (`ExportsPage.tsx`, `reportsP5.json`).

### R6. §5 and §6 restated

- §5 "The request … never changes (EJ18)" now reads: the request never changes, except that a NULL `snapshot_id` is assigned exactly once while the job is `queued` (R2).
- §5 Flow step 1 no longer says `boss.send`. It was corrected in place, with a note, because the code has written the outbox event since DG5.
- §6 audit actions per job transition: `export_job.create|assemble|start|retry|succeed|fail|cancel`. A pending job's `fail` is written by the watch, with the service actor on behalf of the requester.

### R7. Q4 (names) is closed

BE-Y5 shipped other names than H4's (R1). This amendment, the data dictionary ("P6 round-1 repair migration 0124", rewritten to the shipped catalogue) and the ERD (§1ab) now use the shipped names.

Requirement rows: REQ-S13-005, REQ-S20-030, REQ-S10-004 (the export half). This is an engineering design record. Nothing here grants a business, Finance or IT approval (G1–G6), and nothing implies a DG0–DG7 result.

