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

1. `POST /exports` (`export.create`; body `snapshotId` or a live `report` selection, `format`, `language`; header `Idempotency-Key`, else a server key): in one transaction, re-check `transformation.read` and `export.create` in the snapshot's transformation, validate, insert the job (`queued`), its progress row and the audit event `export_job.create`; after COMMIT, `boss.send('reports.export', { exportJobId }, { singletonKey: exportJobId })`. A repeated request with the same key returns the existing job with 200 (UNIQUE `export_job_idempotency_key`, EJ03); a new job returns 202.
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
