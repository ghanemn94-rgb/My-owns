# T-DG5-QA-C handback: executable acceptance suites A15 (Reporting)

- **Agent:** qa-verifier, an authoring task (not the DG5 gate review). Invocation `DG5-T-DG5-QA-C-qa-verifier-20261016T211536Z-c16c1a6a`, session `c16c1a6a-ccff-4c48-87d3-c5e20f75ec83`.
- **Tree:** worktree `/home/user/wt/dg5-qa-c`, branch `dg5/qa-c`, HEAD `bb0601f6a03feb789c4532d7a88e88dc88e43c5e`. HEAD was the same at the start and at the end.
- **Time:** started `Fri Oct 16 21:15:50 UTC 2026`, last check `Fri Oct 16 21:54:13 UTC 2026` (about 40 minutes).
- **Disk:** `df -h .` showed 7.9G free before the runs. The `$TMPDIR` volume had 7.7G free before the mutation copy (about 5.6G after it). The copy has been deleted.
- **Changes:** all left **uncommitted**. I edited no product source (`apps/**`, `packages/**`), no `tools/**`, `.claude/**`, `docs/source/**` and no delivery record.
- **Data:** all synthetic. The G1 submission, the change-request decision by the BO user and the cut-off pack review are synthetic in-product actions on test data. They approve nothing real, and no DG0–DG7 engineering gate is named in any product text.

## 1. Files written

| File | Purpose |
|---|---|
| `tests/qa/support/a15.ts` | A15 support. It exports through the real API (`POST /exports`), delivers the job's `export_job.requested` outbox event to the real worker runner `runExport`, using the production content label table and a filesystem store, then downloads through `GET /exports/{id}/download`. It reads PDF/XLSX/DOCX/PPTX/CSV with the package's test readers and adds right-to-left PDF line reconstruction, PDF direction from the footer's start and end sides, and an English-label-fallback detector (D-157 a). |
| `tests/qa/integration/a15-outputs-every-definition.test.ts` | Every definition from `GET /report-definitions` (12), every format it offers, in en and ar: 64 files. Checks the data, snapshot ID, B0004 provenance, title language, RTL/LTR and that Arabic files have no English fallback. Also the `export.format_not_offered` refusal and the requester-only job and file (404). |
| `tests/qa/integration/a15-selected-records-and-injection.test.ts` | REQ-S13-005: an XLSX (en, ar) of the risk-filtered RAID register holds exactly the rows of `GET /raid?type=risk`, and a PPTX gate pack (en, ar) lists every G1 criterion. REQ-S13-006: text starting with `=`, `+`, `-`, `@`, tab or CR becomes a quote-prefixed inline string in XLSX and an `'`-prefixed field in CSV. |
| `tests/qa/integration/a15-demo-transformation-outputs.test.ts` | A scratch database seeded with the real synthetic demo dataset (`seedDemo`, International Roaming), with the API on `MTH_ENV=demo`. Covers REQ-S13-004 (the ten outputs come from the demo transformation and carry its ID and records), REQ-PB-089 (illustrative label in every demo export, en and ar), REQ-S13-006 (a system SUM total is a formula) and REQ-S13-008 (provisional label in the PDF). |
| `tests/qa/integration/a15-snapshots-and-packs.test.ts` | REQ-S13-007: an issued snapshot keeps the old KPI target and its `kpi_version` after an approved change request moves the target from 100 to 120, while the live report refreshes and the PDF shows "Issued report, version 1". REQ-S09-011: the executive pack's PDF, DOCX and PPTX in en and ar carry the submitted update text. REQ-S10-013: the live presentation follows an edited decision, and the issued pack stays the snapshot. REQ-S12-015: the worker's cut-off scan, run twice, creates one draft agenda with the open ask, and publishing is refused before review (422) but works after it. |
| `e2e/a15-reporting.spec.ts` | Root e2e in chromium-en and chromium-ar on the real stack. The user-visible path: Reports page, Registers output (labels in the page language), live preview, generated snapshot (only the risk, not the issue; transformation ID; draft marking), XLSX export recorded with the page language. Includes axe checks. |
| `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-C-authoring/**` | This handback, logs, e2e screenshots and the mutation logs and script. |

**Reuse:** world setup reuses the backend's synthetic test fixtures (`p2-fixtures`, `meeting-fixtures`, `kbe-d2-fixtures`, `p4-exercises-be-i`, `change-fixtures`, `t16-fixtures`) and the harness, only to stage records through the API. Every assertion is derived from the acceptance texts, the ADRs they cite and `docs/api/openapi.yaml`, and expected values come from the DG2–DG4 list routes.

## 2. Checks run (real exit codes)

| # | Command | Environment | Result |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` at the start | Node 24.21.0 | **exit 0**, `PASS gate DG4 (historical)` (`validate-dg4-start.log`) |
| 2 | `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23719 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | Disposable PostgreSQL 16.13, UTF8/C, 85 migrations | **exit 1**: 19 files, **206 tests, 202 passed, 4 failed** (`integration-tests-qa-full.log`). The 4 failures are the product gaps D1–D3 below. Every other suite, including all pre-existing QA suites, passes. |
| 3 | `E2E_PG_PORT=23720 E2E_API_PORT=23721 MTH_PORT_POOL=23722-23749 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a15-reporting.spec.ts --workers=1 --reporter=list` | Real stack, no worker (D-162 d), Chromium at `/opt/pw-browsers` | **exit 0**: 2 passed (chromium-en 7.3 s, chromium-ar 6.3 s). axe found 0 serious or critical issues on the reports page and the snapshot page in both projects. No timeouts (`e2e-a15-reporting.log`, `e2e-screenshots/`) |
| 4 | `pnpm lint` | — | **exit 0** (`pnpm-lint.log`) |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | — | **exit 0** (`prettier-check.log`; re-run after this handback was written) |
| 6 | Mutation checks (§4) | Disposable copy `$TMPDIR/mut` | 6 of 6 mutations made the targeted tests fail (`mutations/`) |
| 7 | `node tools/gates/validate.mjs --historical --stage DG4` at the end | — | **exit 0**, `PASS gate DG4 (historical)` (`validate-dg4-end.log`) |

Per-file counts of run 2:

| File | Tests | Result |
|---|---|---|
| a15-outputs-every-definition | 5 | 4 passed, **1 failed (D1)** |
| a15-demo-transformation-outputs | 7 | 4 passed, **3 failed (D2 ×2, D3)** |
| a15-selected-records-and-injection | 7 | 7 passed |
| a15-snapshots-and-packs | 15 | 15 passed |
| a01-one-source-of-truth-scorecard | 2 | passed |
| a02-a08-drafts-before-g2-scale-after-g5 | 1 | passed |
| a03-modular-entry | 12 | passed |
| a04-a05-a10-partials | 4 | passed |
| a04-kpi-propagation | 8 | passed |
| a05-calculation-correctness | 17 | passed |
| a08-gate-controls | 31 | passed |
| a09-decision-escalation | 17 | passed |
| a10-benefit-integrity | 16 | passed |
| a11-adoption | 12 | passed |
| a11-bau-sustain | 17 | passed |
| a11-value-closure | 11 | passed |
| a12-cross-scope | 14 | passed |
| a13-job-idempotency | 5 | passed |
| a14-concurrency | 5 | passed |

**Non-zero exits and environment notes**

- **Read-only `node_modules`:** a plain `vitest run` failed at start-up with `ENOENT mkdir node_modules/.vite-temp`, because `node_modules` is read-only in this sandbox. Every Vitest run therefore uses `--configLoader runner` (Vitest 3.2), which loads the same `vitest.config.ts` without writing a bundle. Nothing else changes.
- **Development iterations:** before the final runs, earlier runs failed for my own harness or fixture reasons, which I fixed:
  - an import of `@mth/shared` from the repository root;
  - `seedWorld` not exported by `tests/qa/support/api.ts`;
  - a wrong demo handover id;
  - a KPI version that needed `changeReason` and an approved change request;
  - a decision field called `decision`, not `title`;
  - no single agenda-item GET in the contract;
  - PDF text split into separate runs;
  - an "Output" label that is ambiguous on the reports page.
- **Prettier during the full run:** `prettier --write` reformatted my own files while run 2 was in progress. The changes were whitespace only, and runs 4 and 5 were made on the final files.

## 3. Requirement → test

| Row | Literal acceptance | Test(s) | Status |
|---|---|---|---|
| REQ-PB-089 | every demo record and exported demo report shows the illustrative label in en and ar | `a15-demo-transformation-outputs` › "every generated demo snapshot records that it is synthetic" and "every format of every demo output, en and ar, prints the illustrative label" | **FAILS: product gap D2.** Demo *records on screen* are FE scope and not covered here. |
| REQ-DLV-037 | A15 executable tests pass on the DG5 candidate; exported PDF/DOCX/XLSX/PPTX samples inspected in both languages | All `a15-*` suites; 64 files inspected in en and ar (matrix) plus 54 demo files. | Samples inspected. **Does not pass yet** (D1–D3). This is an authoring run, not the candidate review. |
| REQ-S09-011 | executive pack's workstream section contains the submitted update text and current metrics without manual editing | `a15-snapshots-and-packs` › REQ-S09-011 (7 tests: snapshot plus PDF/DOCX/PPTX × en/ar) | PASS. "Current metrics" is asserted as a `metrics_` section per subject. Metric values are not compared to the dashboard (gap G1). |
| REQ-S10-013 | changing a linked decision before cut-off changes the presentation; the issued pack remains the snapshot | `a15-snapshots-and-packs` › "changing the linked decision…" and "the issued meeting pack remains the snapshot…" (live JSON, `?snapshotId=` and the issued pack's PDF in en and ar) | PASS |
| REQ-S12-015 | cut-off creates one draft agenda containing current open asks; not published without review | `a15-snapshots-and-packs` › "the cut-off creates ONE draft agenda…" (real worker handler run twice, one pack, the ask present, publish 422 `agenda_item.pack_not_reviewed` with the version unchanged, publish 200 after review) | PASS |
| REQ-S13-004 | each of the ten outputs generates from the demo transformation and contains its ID and records | `a15-demo-transformation-outputs` › REQ-S13-004 (3 tests: the ten generate; each cites source records; each PDF in en and ar shows the demo transformation's code) and the `a15-outputs-every-definition` matrix | PASS |
| REQ-S13-005 | XLSX export of T15 contains exactly the filtered RAID rows; a PPTX gate pack contains the gate's criteria | `a15-selected-records-and-injection` › REQ-S13-005 (XLSX en/ar; PPTX en/ar) and the e2e spec | PASS |
| REQ-S13-006 | a RAID description '=HYPERLINK(...)' exports as text; a system SUM total remains a formula | `a15-selected-records-and-injection` › REQ-S13-006 (XLSX and CSV, six trigger characters) for the text part; `a15-demo-transformation-outputs` › "a system SUM total remains a formula…" | Text part PASS. **SUM part FAILS: product gap D3.** |
| REQ-S13-007 | after a later KPI change, the issued snapshot still shows the old values and their versions | `a15-snapshots-and-packs` › REQ-S13-007 (5 tests) | PASS |
| REQ-S13-008 | a pending benefit value is labelled provisional in the PDF pack | `a15-demo-transformation-outputs` › "a benefit value that is not validated is labelled provisional in the PDF (en and ar)" | PASS on the benefits-register PDF of the demo data. The literal "PDF pack" (executive pack) holding a pending benefit is NOT COVERED (gap G2). |
| REQ-S13-009 | an Arabic PDF renders RTL with readable numbers and identifiers | `a15-outputs-every-definition` matrix: RTL for every Arabic PDF/DOCX/XLSX/PPTX, no English fallback, transformation code and snapshot UUID readable as left-to-right runs. Also the target `100` and "تقرير صادر، الإصدار 1" in `a15-snapshots-and-packs`. | PASS |
| REQ-S20-015 | Executive pack and relevant outputs contain current selected data, correct provenance and readable Arabic/English layout | All of the above plus `e2e/a15-reporting.spec.ts` | **FAILS on provenance** (D1) and on the demo label (D2). Otherwise passes. |

## 4. Mutation checks (disposable copy `$TMPDIR/mut`, deleted afterwards; logs in `mutations/`)

| ID | Behaviour broken in the copy | Test | Result |
|---|---|---|---|
| M1 | `neutralizeSpreadsheetText` never prefixes (`packages/reporting/src/injection.ts`) | REQ-S13-006 | **exit 1**, 2 failed: quotePrefix false; CSV `'=HYPERLINK` missing |
| M2 | Arabic exports take the English content labels (`labels.ts` `content?.["en"]`) | matrix "every file carries…" | **exit 1**: 32 Arabic files report English label fallbacks ("Code", "Title", "Business case", …) |
| M3 | kpis register takes the newest (draft) KPI version, not the active one in force at the as-of time | REQ-S13-007 | **exit 1**: `expected ['120'] to include '100'` in the issued snapshot |
| M4 | RAID register ignores the `type` filter (`registers.ts`) | REQ-S13-005 XLSX | **exit 1**, 2 failed: 8 codes instead of 7 |
| M5 | the presentation ignores `snapshotId` (`presentation.ts`) | REQ-S10-013 | **exit 1**: the issued pack's presentation no longer shows the issued title |
| M6 | the worker prints no provenance footer (`provenanceFooter` returns null) | matrix B0004 | **exit 1**: 64 files miss B0004, against 14 on the unmutated tree (D1) |

## 5. Product defects found (proposed findings; the orchestrator allocates IDs)

### D1: XLSX and CSV exports omit the B0004 provenance statement

- **Proposed ID:** F-DG5-qa-c-1.
- **Severity:** Medium. Rows: REQ-PB-001, REQ-S20-015. ADR-0046 §2 says "Every file carries … slice I's provenance footer (B0004)".
- **Request:** `POST /api/v1/exports {"snapshotId":"<registers raid snapshot>","format":"csv","language":"en"}` returns 202; the worker reports `succeeded`; `GET /api/v1/exports/{id}/download` returns 200 `text/csv`.
- **Actual:** the file has the Product, Output, Transformation, Subject, Period, As of, Snapshot ID, Issue, Methodology version and Approval state rows, the data and the legend, but not the statement "Practical synthesis inspired by PMI Organizational Transformation, …" (en) or "توليفة عملية مستوحاة من سلسلة PMI …" (ar), which `GET /api/v1/methodology/provenance` returns as `statement`.
- **Scope:** the same holds for every XLSX (diagnostic, tom, business_cases, roadmap, registers, executive_dashboard) in en and ar.
- **Contrast:** PDF, DOCX and PPTX carry it.
- **Failing test:** `a15-outputs-every-definition` › "every file, in every format, prints the B0004 provenance statement…". The list has 14 entries.
- **Mandatory violation:** to be decided by the domain reviewer. REQ-PB-001 is a SOURCE row, so I propose true.

### D2: demo reports and exports carry no illustrative or synthetic label, and demo snapshots do not record `synthetic`

- **Proposed ID:** F-DG5-qa-c-2.
- **Severity:** High. Rows: REQ-PB-089, M0090, M0339. ADR-0050 §2 (d): every report and export generated in a demo database carries "Illustrative example — synthetic" / "مثال توضيحي — اصطناعي" in its header and on every page or sheet, and the snapshot records `synthetic: true`.
- **Setup:** a scratch database seeded with `seedDemo` (real dataset) and the API with `MTH_ENV=demo`. `GET /api/v1/environment` returns `{kind:"demo", synthetic:true}`.
- **Snapshot:** `POST /api/v1/transformations/01995000-…/reports/charter/generate {}` returns 201, but `content` has only the keys `asOf, period, subject, sections, methodology, approvalState, schemaVersion, definitionCode, transformation`. There is no `synthetic` key. The same holds for all ten outputs.
- **Exports:** none of the 54 exports (every format of the ten outputs, en and ar) contains the label.
- **Other wording:** 28 of the 54 files contain "illustrative" only inside English record texts of the dataset (for example "Synthetic demonstration value (illustrative example; …)"), never as the label, and never in Arabic. gate_pack, registers, executive_dashboard, meeting_minutes and handover files have no such wording at all.
- **Code observation:** `EnvironmentReadPort` (`apps/api/src/modules/admin/environment.ts`) is described as "the read the report and export layout uses at generation time", but nothing under `apps/api/src/modules/reporting`, `apps/worker/src/reports` or `packages/reporting` refers to it.
- **Failing tests:** two in `a15-demo-transformation-outputs` › REQ-PB-089.
- **Mandatory violation:** I propose true (demonstration data must be explicitly marked).

### D3: no exported spreadsheet contains a system SUM total formula

- **Proposed ID:** F-DG5-qa-c-3.
- **Severity:** Medium. Row: REQ-S13-006, "a system SUM total remains a formula". ADR-0046 §4 describes a table total as `<f>SUM(<col>first:<col>last)</f>`.
- **Request:** on demo data, `POST …/reports/business_cases/generate {}` and `…/registers/generate {"parameters":{"register":"benefits"}}`, then XLSX en export.
- **Actual:** the XLSX formulas found are `{"business_cases":[],"registers":[]}`.
- **Cause:** the writer supports `totals` (`packages/reporting/src/xlsx/sheet.ts`), but no report assembler emits one. Every `totals:` in `apps/api/src/modules/reporting/reports/assemblers/**` is `[]`. Only the renderer unit fixture `packages/reporting/src/test-fixtures.ts` has a `formula: "sum"` total.
- **Effect:** the half of the acceptance about the formula being preserved cannot occur in any product export.
- **Failing test:** `a15-demo-transformation-outputs` › "a system SUM total remains a formula…".

### Observations (Low, not failing any test)

- **O1:** in the Arabic snapshot page (`e2e-screenshots/chromium-ar--a15-02-snapshot.png`), the SHA-256 content checksum runs past the card's left edge, and the source-records table shows the raw codes `register` and `raid_entry` in the Arabic UI. This is FE scope.
- **O2:** the Arabic gate pack prints the catalogue's `label_en` column ("Diagnostic", "Baseline", …) next to `label_ar`. This is a deliberate bilingual data column, not a label fallback, and my detector ignores it (an English label counts as a fallback only when its Arabic translation is absent from the file).
- **O3:** the KPI target prints as `100.000000` in the PDF register. It is readable but unrounded.

## 6. Known gaps and what remains

- **G1:** REQ-S09-011 "current metrics": the suite asserts that a metrics section exists for the transformation and for the workstream. It does not compare the values with `GET …/workstreams/{w}/dashboard`.
- **G2:** REQ-S13-008 "in the PDF **pack**": proven on the demo benefits-register PDF (the label appears beyond the legend baseline in en and ar). An executive-pack PDF with a pending benefit value is not staged.
- **G3:** the e2e stack has no worker (D-162 d), so the e2e export stays `queued`. File contents are proven through the worker runner in the integration suites.
- **G4:** Arabic readability is checked as text and direction: drawn Arabic text in logical order, embedded fonts implied by ToUnicode mapping, `rightToLeft`, `w:bidi`/`w:rtl`, `rtl="1"`. No visual or OCR inspection of the PDF pages was done.
- **G5:** a full repository `pnpm test` was not run. Only the commands listed in the assignment were run.
- **Before the gate:** D1–D3 need repair and re-verification by a separate, independent DG5 QA review on the frozen candidate.

## 7. Merge instructions

Add the seven new files under `tests/qa/**` and `e2e/**` and this evidence directory. There are no migrations and no product changes. The suites need nothing beyond the existing harness. In this sandbox, Vitest needs `--configLoader runner` because `node_modules` is read-only; CI with a writable `node_modules` does not.

The four failing tests are intentional. They expose D1–D3 and must stay until those are repaired.
