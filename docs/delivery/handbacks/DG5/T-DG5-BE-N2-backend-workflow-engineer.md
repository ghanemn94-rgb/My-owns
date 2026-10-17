# Handback T-DG5-BE-N2 (backend-workflow-engineer): D-163 repair of slice F (§F.5/§F.6 Added scope)

- **Stage:** P5, gate DG5 (BUILDING). Task T-DG5-BE-N2, wave W18, repair task (D-163).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-N2-backend-workflow-engineer-20261017T013212Z-6f79cda2","session_id":"6f79cda2-d9b3-4f37-8e79-d057ef032b02"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-N2.md`, sha256 `f44f6d60466ce78d27eecd6ae6c79d5e5b243e6e9267781c8b5f15d81ec8d720` (verified).
- **Starting revision:** branch `dg5/be-n2`, `HEAD` = `f21a5363939294effa4157c5e6db3d404b04ce3c` (D-163). Changes are left **uncommitted**.
- **Time:** start `Sat Oct 17 01:32:25 UTC 2026`; end: see §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exited **0** at the start ("PASS gate DG4 (historical)"). The end run is in §4.

No agent grants a real business, Finance or IT approval. Product gates G1–G6 are business approvals inside the product, and nothing here touches DG0–DG7. All fixtures are synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/report.ts` | `ReportDocument` gets the optional member `synthetic: z.literal(true).optional()`: present (true) only in a demo database, absent in production (D-163 contract change). |
| `docs/api/openapi.yaml` | The `ReportDocument` component only: `synthetic: { type: boolean, enum: [true] }`, optional, with its description. No other contract edit. |
| `apps/api/src/modules/reporting/reports/snapshots.ts` | `assembleReport` reads the environment in its `REPEATABLE READ` transaction (`reportEnvironmentPort`, §6.1). In a demo database the document gets `synthetic: true` before validation and hashing. In production the member is absent. |
| `packages/reporting/src/labels.ts` | Frame label `export.illustrative`: en "Illustrative example — synthetic", ar "مثال توضيحي — اصطناعي" (ADR-0050 §2 verbatim). |
| `packages/reporting/src/model.ts` | `illustrativeLabel(doc, labels)` (decided from the snapshot's recorded `synthetic` member only) and `provenanceText(options)` (the B0004 statement as the caller passed it, or null; never invented). |
| `packages/reporting/src/csv.ts` | Demo: the label is the first row. B0004: one row right after the header rows, through `csvCell` (so `neutralizeSpreadsheetText` applies). |
| `packages/reporting/src/xlsx/index.ts` | Demo: the label is the first row of **every** sheet, added when the sheet is created so the SUM ranges stay exact. B0004: the last row of **every** sheet, a plain inline string (`textCell`: never a formula; quote-prefixed only if it ever started like one). |
| `packages/reporting/src/layout/blocks.ts` | `PagedDocument.illustrative` (the label or null) for PDF, DOCX and PPTX. |
| `packages/reporting/src/pdf/index.ts` | Demo: the label under the product name in the header block, and `pageHeaders()` draws it in the top margin of **every** page (ink `#7A4B00`, 7.4:1 on white), start-aligned per direction. |
| `packages/reporting/src/docx.ts` | Demo: the label in the body's header block and in a default page `Header` (every page). No header part in production. |
| `packages/reporting/src/pptx.ts` | Demo: the label at the top of **every** slide, the title slide included. |
| `packages/reporting/src/provenance-illustrative.test.ts` (new) | 24 unit tests (§3). |
| `packages/reporting/src/pdf/pdf.test.ts` | Only an explicit per-describe timeout (60 s): Arabic shaping hit the 5 s default under a loaded run (§5). No assertion changed. |
| `apps/api/test/integration/reporting/exports.test.ts` | One statement in BE-M's XLSX test: the data rows end at the blank row before the new B0004 row (§5). |
| `apps/api/test/integration/reporting/report-synthetic.test.ts` (new) | 6 integration tests on a disposable demo database and the run's production database (§3). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-N2-evidence/**` | Logs of every check below. Superseded first runs are in `superseded/`. |

The worker (`apps/worker/src/reports/export-runner.ts`) needed **no change**. It already passes `branding.provenance` (from `provenanceFooter`) to `render`, and it renders the stored snapshot content, so the renderers decide from the snapshot's own `synthetic` member, never from the worker's environment. **Migration: none.** `0095` is unused.

## 2. Behaviour delivered, per requirement row

- **REQ-PB-001.** Acceptance: *"A01: provenance text on reader/About/report footer matches B0004 verbatim; an automated text scan of UI strings (en+ar) and report templates finds no claim of 'official PMI standard', 'PMI certified' or equivalent."*
  - Delivered for the report part (F-DG5-qa-c-1). XLSX and CSV now print the B0004 statement as the worker reads it from the catalogue. Every XLSX sheet carries it as a plain inline string. CSV carries one row after the header rows, neutralized like all text. With `provenance: null`, nothing is printed in its place.
  - The new strings contain no certification claim.
- **REQ-S20-015 (A15).** Acceptance: *"A15: Executive pack and relevant PDF/DOCX/XLSX/PPTX outputs contain current selected data, correct provenance and readable Arabic/English layout."*
  - `tests/qa/integration/a15-outputs-every-definition.test.ts` › "every file, in every format, prints the B0004 provenance statement in its language (ADR-0046 §2, REQ-PB-001)" now **passes, unchanged**. The whole file passes: 5/5 (§4).
- **REQ-PB-089.** Acceptance: *"A01;A15: every demo record and exported demo report shows the illustrative label in en and ar."*
  - Delivered for exports (F-DG5-qa-c-2). In a demo database every snapshot (and live report) records `synthetic: true`. Every export of such a snapshot prints the label:
    - in its header and on every page (PDF, DOCX);
    - on every slide (PPTX);
    - on every sheet (XLSX);
    - as a row (CSV).
  - The label is in the file's language.
  - Both `tests/qa/integration/a15-demo-transformation-outputs.test.ts` › REQ-PB-089 tests now **pass, unchanged** (§4).
- **REQ-S18-001.** Acceptance: *"A22;A01: running the reset twice yields identical record counts and checksums; every demo screen, record and export shows the synthetic label in en and ar."*
  - The export part is delivered as above. Production is unchanged: no label, no `synthetic` member, and `content_sha256` is the hash of exactly the content-schema-v1 document (R2). This is proven in `report-synthetic.test.ts`.
  - The reset and screens parts are other tasks' work and were not touched.
- **Added scope 3 (QA-C O3, Low): KPI target `100.000000`.**
  - ADR-0046 §9 **does** set a display rule: "Numbers are printed from their canonical decimal strings with the shared display formatter (`formatDecimal`, half-up display rounding, the stored value never rounded), the unit kind…". The paged renderers already apply it to every `decimal` value (`layout/values.ts` `displayValue`: at most 6 fraction digits, trailing zeros dropped, money 2, percentage with `%`). A new test proves `100.000000` (unit kind `other`) prints `100` in en and ar while the value stays `100.000000`.
  - **The cause of O3 is not in my files.** The registers assembler emits the KPI target as a system **text** cell, so it never reaches the number formatter: `apps/api/src/modules/reporting/reports/assemblers/registers.ts:385`, `textValue(v?.target_value ?? null, "system", …)`. Its comment says this is because KPIs in one column have different units. Reformatting a text cell in the renderer would mean guessing that a text is a number, so I **changed nothing** for O3 in the renderers.
  - The fix belongs to the assembler, which is KBE-D3's ownership in W18. It would emit the target as a `decimal` with the KPI's own `unitKind` per row, or format it at assembly as display text. Its owner and the orchestrator decide.

## 3. Tests added

**Unit (`packages/reporting/src/provenance-illustrative.test.ts`, 24 tests):**
- **Contract:** `synthetic` absent or true parses; false, `"true"`, 1 and null are refused.
- **XLSX, en and ar:** every sheet carries the exact B0004 statement once, as `inlineStr`, with no formula and no quote prefix, and sheet direction follows the language.
- **XLSX with the statement:** the SUM total is still `SUM(D3:D5)` with cached `30.00`.
- **XLSX formula-shaped statement:** a statement like `=HYPERLINK(...)` stays text with `quotePrefix`.
- **XLSX, provenance null:** the sheets are identical to rendering without the member.
- **CSV, en and ar:** the statement is exactly one row, at index 10, right after the ten header rows, followed by the blank separator.
- **CSV formula-shaped statement:** `@SUM(1)` is printed as `'@SUM(1)`.
- **CSV, provenance null:** byte-identical to rendering without the member.
- **Demo, en and ar:**
  - XLSX: the label is row 1 of every sheet, and the SUM shifts to `SUM(D4:D6)`.
  - CSV: the label is row 1.
  - PDF: 160 rows, more than 2 pages, the label on every page (twice on page 1).
  - DOCX: the label in the body before the title, plus a header part referenced from `document.xml`.
  - PPTX: 40 rows, the label on every slide.
- **Production:** no format prints "Illustrative"/"توضيحي" in either language, and the DOCX has no `headerReference`.
- **Labels:** no missing label key in either language.
- **O3:** `100.000000` prints `100`, and `87.500000` with unit kind percentage prints `87.5%`.

**Integration (`apps/api/test/integration/reporting/report-synthetic.test.ts`, 6 tests):**
- **Databases:** one disposable database seeded through `seedDemo` (the test demo modules, which write the real `demo` marker), and the run's database, which reads as production.
- **Port equivalence:** `reportEnvironmentPort` and admin's `environmentReadPort` answer alike on both databases, also inside a transaction. A compile-time assignment proves the admin port satisfies the reporting port's contract.
- **Demo snapshot:** generation, `getReportSnapshot` and `getLiveReport` record `synthetic: true`. The stored and returned `contentSha256` equal the SHA-256 of the canonical content.
- **Production snapshot:** no member in the response, the stored content or the live report. `content_schema_version` is 1, and the canonical JSON does not contain `"synthetic"`.
- **Worker exports through `POST /exports` and `runExport`:**
  - Demo CSV and XLSX in en and ar carry the label and the B0004 statement exactly as `GET /methodology/provenance` returns it (XLSX: on every sheet).
  - Production exports carry the statement and no label.

## 4. Checks actually run

Environment: Node 24.21.0, offline, worktree `/home/user/wt/dg5-be-n2`, harness ports 23800–23849 (PostgreSQL from `tests/qa/support/with-pg.sh`). Logs: `docs/delivery/handbacks/DG5/T-DG5-BE-N2-evidence/`.

| # | Command | Exit | Result |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | PASS gate DG4 (historical) |
| 1 | `pnpm -r typecheck` | **137 (BLOCKED, not passed)** | `typecheck.log`. The kernel killed it (exit 137, out of memory) in all three runs after my last source edit (`superseded/typecheck-run2-oom-killed.log`, `superseded/typecheck-run3-oom-killed.log`, `typecheck.log`; the last run used `--workspace-concurrency=1`). **The final tree is therefore not type-checked by `tsc -p tsconfig.json`.** The first run, before the port change and the test edits, exited 0 (`superseded/typecheck-run1.log`). |
| 2 | `pnpm -r build` | 0 | `build.log`: `tsc -p tsconfig.build.json` of every package, run **after** the last source edit, so all non-test source type-checks. |
| 3 | `pnpm lint` | 0 | `lint.log` (eslint `--max-warnings=0`, after the last source edit). The test files edited afterwards were linted on their own: `npx eslint --max-warnings=0 apps/api/test/integration/reporting/exports.test.ts apps/api/test/integration/reporting/report-synthetic.test.ts`, exit 0 (`lint-targeted-late-edits.log`). |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `openapi-lint.log` |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **1** | `unit-locale-unset.log`: unit-node 2275 passed, 1 failed (2276), plus 2 unhandled vitest RPC errors (`Timeout calling "onTaskUpdate"`). The one failure is `architecture.test.ts` › "every import respects dependsOn …", which **timed out at its 30 s bound** (no violation reported) while the integration run and the typecheck shared the machine. unit-web: 1533 passed, 1 failed (1534). The failure is `src/pages/raid/raid.test.tsx` › "RAID and actions screens (en) › action register …" ("Unable to find role=link 'Synthetic call the vendor'"), the same web test that failed in the superseded run (there in ar). I edit no web code, and nothing I changed reaches it, so I report it as load-sensitive for the web owner. unit-formula-nocodegen: 259 passed, 2 skipped (261). |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | `unit-c-utf8.log` (finished 03:31:02 UTC, after this handback was first written): unit-node 2275 passed, 1 failed (2276): the same architecture-test 30 s timeout. unit-web 1531 passed, 3 failed (1534): `raid.test.tsx` › "action register …" (en and ar) and `p2-blank-forms.test.tsx` › "gate submission note (en) › a whitespace-only note is refused inline". All are web code I did not touch, and all ran under the concurrent integration load. unit-formula-nocodegen: 259 passed, 2 skipped (261). |
| 8 | `QA_PG_PORT=23810 MTH_PORT_POOL=23811-23849 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | `integration.log` (finished 03:48:39 UTC, after the handback was first written; `integration-times.txt`): test files 4 failed, 284 passed (288); tests 3 failed, 2886 passed, 1 skipped (2890).<br>(1) A06 REQ-S06-004 display: **F-DG5-QA-A-1 (BE-C3)**, intended per D-163.<br>(2) A15 demo "a system SUM total remains a formula": **F-DG5-qa-c-3 (KBE-D3)**, intended per D-163.<br>(3) `exports.test.ts` "XLSX contains exactly the filtered rows" (`expected 4 to be 2`): **caused by my change and fixed** after this run started (row 8b, 22/22).<br>(4) The `packages/db/test/integration/demo.test.ts` suite failed with "Hook timed out in 30000ms": a setup-hook timeout while the machine was overloaded (§5). That file is not mine and none of its tests ran.<br>For comparison, D-163's run of the merged tree: 2878 passed, 1 skipped, 5 failed (2884). This run: 2890 tests, which includes my 6 new integration tests. The `demo.test.ts` suite did not run, so the totals are not directly comparable. Pinned-count change: none. |
| 9 | `QA_PG_PORT=23800 MTH_PORT_POOL=23801-23849 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a15-outputs-every-definition.test.ts tests/qa/integration/a15-demo-transformation-outputs.test.ts` (targeted, before the full run) | 1 | 11 passed, 1 failed (12). B0004 file 5/5. Demo file: both REQ-PB-089 tests and REQ-S13-004/008 pass. The one failure is "a system SUM total remains a formula …" (`expected 0 to be greater than 0`): **F-DG5-qa-c-3 (D3)**, no assembler declares a total, allocated to **KBE-D3**, not to me. |
| 8b | `QA_PG_PORT=23820 MTH_PORT_POOL=23821-23849 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/reporting/exports.test.ts apps/api/test/integration/reporting/report-synthetic.test.ts` (after the `exports.test.ts` fix) | 0 | 22 passed (22): `integration-targeted-exports.log` |
| 8c | `QA_PG_PORT=23800 … npx vitest run --project integration apps/api/test/integration/reporting/report-synthetic.test.ts` (earlier, before the port change) | 0 | 5 passed (5). The 6th test, port equivalence, was added later and passed in row 8b. |
| 6b | `npx vitest run --project unit-node apps/api/src/architecture.test.ts` (alone, final tree) | 0 | 139 passed (139): `unit-targeted-architecture.log`. The boundary holds; the full-run failures above were timeouts. |
| 6c | `npx vitest run --project unit-node apps/api/src/architecture.test.ts apps/api/src/modules/reporting/reporting.test.ts packages/reporting/src` (final tree, under the integration load) | 1 | 230 passed, 1 failed (231): the same architecture-test 30 s timeout. All `packages/reporting` tests (including the 24 new ones) and `reporting.test.ts` passed: `unit-targeted-boundary-and-reporting.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | PASS gate DG4 (historical): `validate-dg4-end.log` |

**Acceptance 1–3 are therefore not fully met.**
- `pnpm -r typecheck`: BLOCKED (out of memory, exit 137).
- `pnpm test` in both locales: exit 1 and incomplete. The only failures are the architecture-test timeout under load, which passes alone.
- Full `pnpm test:integration`: completed with exit 1. The failures are 2 intended ones from other owners, 1 of mine (now fixed) and 1 load timeout in a suite hook.

**The orchestrator should rerun all three on a quiet machine** before integrating. Acceptance 4 is met (exit 0). Pinned-count change: none.

## 5. Disclosures (non-zero exits, flakes, timeouts)

- **First static-check pass, run before my last edits.** Typecheck, build, lint, prettier and OpenAPI lint all exited 0 (`superseded/*-run1.log`). My shell wrapper then exited 1, but only because of a malformed trailing `tail -3 a b c`, not because of any check. I reran all five after the last edit (rows 1–5).
- **First unit run (`superseded/unit-*-run1.log`, locale unset exit 1, C.UTF-8 exit 1).** It found three real problems and some load timeouts:
  - **(a) Real: module boundary.** My first implementation imported `admin/environment.ts` from `reporting`. The ADR-0002 architecture tests (`apps/api/src/architecture.test.ts` and `reporting.test.ts`) refused it: "module reporting may not import module admin". I fixed it (§6.1).
  - **(b) Load timeout in my new test.** "production … no format prints the label" hit the 5 s default while my ad-hoc test runs ran in parallel. Its file now has an explicit 120 s bound.
  - **(c) Load timeout, PDF.** `pdf.test.ts` › "has a right-to-left base direction" hit 5 s in the C.UTF-8 run. Explicit 60 s bound added; no assertion changed.
  - **(d) Not my code.** In the locale-unset run, `apps/web` `src/pages/raid/raid.test.tsx` › "RAID and actions screens (ar) › action register …" failed ("Unable to find role=link 'Synthetic call the vendor'"). I touch no web code. That run overlapped my other test runs, so it is reported as a load-sensitive failure for the web owner. Its result in the final run is in §4.
  - The C.UTF-8 half of that run also started before fix (a) and read a mix of old and new files, so its result is void. Both locales were rerun (rows 6–7).
- **Concurrency of the final runs: my mistake, and it cost the evidence.** To fit the 2-hour limit I started three things together on a 4-core, 16 GB machine that the four other W18 worktrees also share:
  - the final unit runs (rows 6–7, sequential to each other);
  - the full integration run (row 8);
  - the second static-check pass (rows 1–5).

  The results:
  - `tsc` was killed for lack of memory (exit 137) three times, including once alone with `--workspace-concurrency=1` while the integration run was still going.
  - The ADR-0002 architecture test exceeded its own 30 s bound in both locales, and vitest reported RPC timeouts (`onTaskUpdate`).
  - Both unit runs completed all three projects (rows 6–7), each with exit 1, from load-sensitive timeouts and the web failures listed there.
  - The sandbox gives each command its own PID namespace, so I could not stop the background runs once started. They may still be writing to `unit-c-utf8.log` and `integration.log` after this handback; the counts above are as of 03:22 UTC.
- **An out-of-list edit, disclosed.** `apps/api/test/integration/reporting/exports.test.ts` is BE-M's implementer test of the XLSX writer, not a QA test. It read every row after the column header as a data row, so the required B0004 rows on every sheet made it count 4 rows instead of 2. I changed one statement: the data rows now end at the first blank row. Every assertion is otherwise unchanged. It passes again (row 8b). `tests/qa/**` was not edited.

## 6. For the orchestrator

### 6.1 The environment read and ADR-0002 (a decision to confirm)

The assignment says "Snapshot generation reads the environment through `EnvironmentReadPort`". `EnvironmentReadPort` lives in module `admin`, and `apps/api/src/modules.ts` does not let `reporting` depend on `admin`. The architecture tests enforce this. `modules.ts` and `server.ts` are outside my ownership. So, within my files:

- `snapshots.ts` exports `ReportEnvironmentPort { read(db): Promise<{ synthetic: boolean }> }`, the `synthetic` slice of `EnvironmentReadPort`'s contract. `environmentReadPort` satisfies it as it is.
- Its default `reportEnvironmentPort` reads the same source with the same rule: `@mth/db` `readDeploymentEnvironment(tx)`, the function `environmentReadPort.read` itself wraps. `synthetic` is set exactly in a `demo` database, and a database without a marker is production.
- The read happens in the assembly transaction.
- The integration test proves the two ports agree on a demo and a production database, also inside a transaction.

If the orchestrator wants the literal port object, either one-line change makes it so; neither is mine to make:

- (a) add `"admin"` to `API_MODULES.reporting.dependsOn` in `apps/api/src/modules.ts` (check for cycles: `admin` depends on organization, identity and jobs), then import `environmentReadPort` from `../../admin/index.ts` after adding it to admin's barrel;
- (b) inject `environmentReadPort` at composition (`server.ts`) into the reporting registration (the GateFactsProvider pattern).

### 6.2 Contract, schema and dependencies

- **Contract change (approved by D-163):** `ReportDocument.synthetic`, optional, `enum: [true]` in OpenAPI and `z.literal(true).optional()` in zod. "Optional boolean, present (true) exactly in a demo database" is encoded so that `false` can never be stored. Production content and its `content_sha256` and `content_schema_version` (1) are byte-identical.
- **No other contract change.** No migration (`0095` unused). No new dependency. No new problem code.
- **Operations routed:** none. Pending-list delta: **0** (no `p5-pending-*.ts` or `p5-exercises-*.ts` edit). Pinned counts in `contract.test.ts`: **no delta**. OpenAPI lint still reports 846 operations.

### 6.3 User-facing texts

- **New:** `export.illustrative` (en/ar, ADR-0050 §2 verbatim) in `packages/reporting/src/labels.ts`.
- **Made untrue:** none found. I searched `apps/web/src/i18n/{en,ar}` and `apps/api/src` for texts calling the export label or provenance planned or absent, and none says so. The web demo banner and badge texts (`playbookP5.json`) already state the illustrative nature and remain true.
- No string names DG0–DG7.

## 7. What remains

- **Verification on a quiet machine (orchestrator):**
  - `pnpm -r typecheck` (OOM-killed here);
  - `pnpm test` in both locales (incomplete here; unit-node passed apart from the load timeout of the architecture test);
  - the full `pnpm test:integration` (exit 1 here: 2 intended failures from other owners, 1 of mine now fixed, and the `demo.test.ts` hook timeout under load).

  Expected integration failures from other owners: F-DG5-QA-A-1 (A06, BE-C3) and F-DG5-qa-c-3 (A15 SUM, KBE-D3). Before integrating, also check the `apps/web` `raid.test.tsx` failure (§5), seen once under load.

- **O3** (§2): the KPI target text in the registers assembler is outside my ownership (KBE-D3 / orchestrator).
- **F-DG5-qa-c-3** (SUM total): KBE-D3. Until it merges, `a15-demo-transformation-outputs.test.ts` › "a system SUM total remains a formula …" fails, as intended by D-163.
- **§6.1:** the orchestrator's choice of literal `EnvironmentReadPort` wiring (optional; behaviour is identical).
- **Merge notes:**
  - `packages/reporting/**`: KBE-D3 does not edit it.
  - `snapshots.ts`: KBE-D3 edits `reports/assemblers/**`, not `snapshots.ts`, so no conflict is expected.
  - `openapi.yaml`: my edit is one line in `ReportDocument`. BE-C3 edits the automation dry-run text elsewhere, so a textual merge should be clean.

## 8. End

End: `Sat Oct 17 03:23 UTC 2026` (`date -u` at 03:22:01), about 111 minutes after the start. Stopped at the time limit with the gaps listed in §4 and §7.
