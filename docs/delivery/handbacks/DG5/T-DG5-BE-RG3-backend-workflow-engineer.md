# Handback T-DG5-BE-RG3 (backend-workflow-engineer): DG5 round-5 repair of F-DG5-100 and F-DG5-140

- **Stage / gate:** P5, DG5, FIXING (D-190, D-191). This is a repair task. No business, Finance or IT approval was granted, and nothing touches DG0–DG7 records.
- **Invocation:** `DG5-T-DG5-BE-RG3-backend-workflow-engineer-20261025T200240Z-a9163b80`, session `a9163b80-b9ce-467c-92b3-2dbc29f58c7d`.
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-BE-RG3.md`, sha256 `36b5e272…dcdd42df` (verified).
- **Base:** worktree `/home/user/wt/dg5-be-rg3`, branch `dg5/be-rg3`, `HEAD` = `94b465f44cbf832d75e558ef86d64b07cbbeab91`.
- **Time:** start `2026-10-25T20:02:58Z`, end about `20:45Z` (about 43 minutes, inside the limit).
- **Commits:** none. The changes are left uncommitted for the orchestrator, as the assignment requires.
- **Preceding gate at start:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)`, EXIT=0. That start-of-run output was seen in the terminal and not saved to a file. The end-of-run re-run is saved in `30-validate-dg4-historical-end.log`.

Evidence directory: `docs/delivery/handbacks/DG5/T-DG5-BE-RG3-evidence/` (written below as `E/`).

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/reporting/src/xml-chars.ts` (new) | Holds the one shared XML 1.0 character rule. `xmlSafe` replaces C0 controls (except tab, LF, CR), lone surrogates, U+FFFE and U+FFFF with U+FFFD. `hasInvalidXmlChar` detects forbidden characters, raw or as character references. `assertWellFormedChars(bytes)` checks every `*.xml` and `*.rels` part of a finished OOXML package and throws a `RenderError` if one fails. |
| `packages/reporting/src/xlsx/sheet.ts` | `xmlText` now calls the shared `xmlSafe`. Its private `INVALID_XML` copy is removed, so the rule is shared, not duplicated. |
| `packages/reporting/src/xlsx/index.ts` | Runs `assertWellFormedChars` on the finished XLSX package. |
| `packages/reporting/src/docx.ts` | Every `TextRun` text goes through `xmlSafe` (all body, header, footer and table text passes through `scriptRuns`), and so do the core properties (creator, title, description). The package is then checked. |
| `packages/reporting/src/pptx.ts` | Every `addText` string, table cell and the empty-state cell goes through `xmlSafe`, and so do the presentation properties (author, company, title, subject). The package is then checked. |
| `packages/reporting/src/labels.ts` | Adds `DEFAULT_PRODUCT_NAMES` (`en` "Mobily Transformation Hub", `ar` «منصة موبايلي للتحوّل»): the version-0 name for each export language. |
| `packages/reporting/src/index.ts` | Exports `DEFAULT_PRODUCT_NAMES`. |
| `apps/worker/src/reports/export-runner.ts` | At version 0 the runner now prints `DEFAULT_PRODUCT_NAMES[language]` instead of `deps.productName ?? DEFAULTS.productName`. The unused `ExportRunnerDeps.productName` seam (no caller set it) and the `DEFAULTS` import are removed. |
| `packages/reporting/src/ooxml-read.ts` | Test helper only (renderers don't use it). Adds `xmlWellFormedProblem`, a strict minimal XML 1.0 well-formedness checker (Char production, tag nesting, attributes, references, single root), and `malformedParts(bytes)`. The package has no XML parser dependency, and none was added. |
| `packages/reporting/src/xml-chars.test.ts` (new) | F-DG5-100 unit tests: the rule, `xmlText` = `xmlSafe`, the package check, the checker itself, DOCX/PPTX/XLSX in en and ar parsed part by part, the reviewer's renderer reproduction, and the core properties. |
| `packages/reporting/src/labels.test.ts` (new) | F-DG5-140 parity test: `DEFAULT_PRODUCT_NAMES` equals the shell's i18n `common.brand.productName` (en, ar) and the API's `DEFAULT_PRODUCT_NAME_EN` / `_AR`, read as text because the worker imports no API or web code (ADR-0002). |
| `apps/api/test/integration/reporting/exports-xml-chars.test.ts` (new) | F-DG5-100 integration test through the real API and export runner (details in §2). |
| `apps/api/test/integration/branding/branding.test.ts` | F-DG5-140 integration tests: version 0 in Arabic and English (DOCX, PPTX, PDF) and a configured version (DOCX, PPTX). The existing `pdf()` helper now also takes a format. |

**Ownership note.** The two integration test files are under `apps/api/test/integration/`. The worker's export runner is tested there (`exports.test.ts` and `branding.test.ts` already call `runExport`). The assignment allows `apps/api/**` "if needed for branding" and requires "an integration test through the export job". No API product source was changed.

`CLAUDE.local.md` and the top-level dotfiles (`.bashrc`, `.gitconfig`, `.mcp.json`, …) shown as untracked were already in the worktree when I started. They are not mine; I left them alone and they are not part of this change.

## 2. Findings

### F-DG5-100 (Medium): DOCX and PPTX were not well-formed XML 1.0 when user text held a C0 control character

**Cause.**
- `xlsx/sheet.ts` replaced XML-invalid characters itself.
- The DOCX writer (library `docx` 9.8.1) and the PPTX writer (`pptxgenjs` 4.0.1) passed user text to libraries that escape only `& < > "` and write control characters raw. This affected body text and the core properties (`docProps/core.xml`).
- Nothing checked the finished package, so the job stored a corrupt file and marked it succeeded.

**Fix.** The decision (D-191) puts the replacement at the XML-writing layer, shared:
- `packages/reporting/src/xml-chars.ts:16` (`INVALID_XML_CHAR`), `:24` (`xmlSafe`), `:37` (`assertWellFormedChars`).
- `xlsx/sheet.ts:9,19` (`xmlText` = `xmlSafe` + escaping).
- `docx.ts:71` (every `TextRun`), `docx.ts:216-218` (core properties), `docx.ts:252` (package check).
- `pptx.ts:126-129` (properties), `:167, :178, :187, :200, :209, :217, :235, :244` (every text and cell), `:260` (package check).
- `xlsx/index.ts:166` (package check).

**Why a corrupt file can't be stored as succeeded.** If any part of a finished package still holds a forbidden character, raw or as a reference, the renderer throws `RenderError`. The runner already maps that to `export.render_failed`: no retry, no file stored (existing path, `export-runner.ts` catch block; `exports.test.ts` covers RenderError → failed with no file). The unit test `assertWellFormedChars refuses a package holding a forbidden character` proves the check throws `RenderError`.

**Input rule unchanged.** The API still accepts the text and stores it as entered. The integration test asserts this, and the stored record keeps the user's character. Only the generated file carries U+FFFD.

**Regression tests.**
- *Unit:* `packages/reporting/src/xml-chars.test.ts`, 13 tests. One test each for DOCX, PPTX and XLSX, in en and ar, renders every forbidden class (`A\u0001B\u0008C\u000BD\u000CE\u001FF\uD800G\uDC00H￾I￿J\tK`) in the transformation name and a register row. It parses every part with the strict checker, expects `[]` malformed parts, and checks that the text survives with U+FFFD in place.
- *Reviewer's renderer reproduction:* "Supplier\u0001delay\u000B(pasted)" is kept with its final assertion, `not-well-formed parts: none` for docx, pptx and xlsx.
- *Integration:* `apps/api/test/integration/reporting/exports-xml-chars.test.ts`.
  - It renames the transformation through `PATCH` to `International Roaming\u000Bprogramme (pasted)` (200; the name is stored as entered).
  - It creates a RAID entry whose description is `Supplier\u0001delay\u000B(pasted)`.
  - It generates the charter, roadmap and registers outputs and exports charter DOCX, roadmap PPTX, roadmap XLSX and registers XLSX, each in en and ar (8 jobs), through the worker's `runExport`.
  - Every job is `succeeded`, every download returns 200, every part passes `malformedParts` (the reviewer's final assertion, `not-well-formed parts: none`), and the text is kept with U+FFFD.
  - The registers output offers no DOCX or PPTX (migration 0080), so the DOCX/PPTX cases use the charter and roadmap, as the reviewer did.

**Failing before** (renderers at `HEAD`; for the integration test, the fix patch reversed in the working tree with `git apply -R`):
- `E/01-f100-renderer-before.log`: `Tests 6 failed | 7 passed (13)`, EXIT=1. DOCX en/ar, PPTX en/ar, the reviewer reproduction and core properties fail. XLSX passes, as the reviewer found. The reviewer reproduction gave `"docx: not-well-formed parts: word/document.xml | docProps/core.xml"` and `"pptx: not-well-formed parts: docProps/core.xml | ppt/slides/slide1.xml | ppt/slides/slide2.xml"`.
- `E/03-integration-before.log`: `charter.en.docx: expected 'job succeeded, 12637 bytes, not-well-formed parts: docProps/core.xml: character U+000B is not an XML 1.0 Char | word/document.xml: character U+000B is not an XML 1.0 Char' to match /not-well-formed parts: none$/`, EXIT=1.

**Passing after:**
- `E/02-f100-f140-unit-after.log`: 16/16, EXIT=0.
- `E/04-integration-after-locale-unset.log`: 27/27, EXIT=0.
- The reached-tests runs in §3 also pass.

### F-DG5-140 (Low): at branding version 0, Arabic export headers printed the English product name

**Cause.** At version 0, when `brandingAtGeneration` returns null, `export-runner.ts` passed `deps.productName ?? DEFAULTS.productName` for every language. `DEFAULTS.productName` is the English text only.

**Fix.**
- `packages/reporting/src/labels.ts:26` adds `DEFAULT_PRODUCT_NAMES`.
- `apps/worker/src/reports/export-runner.ts:381` uses `DEFAULT_PRODUCT_NAMES[language]` at version 0.
- A configured version is unchanged: it still uses `productNameAr` / `productNameEn` (`:383`).
- The texts are the same as the API's version 0 and the shell's i18n texts. `labels.test.ts` asserts all three agree, so a drift fails a unit test.

**Regression tests**, in `apps/api/test/integration/branding/branding.test.ts`, through the real export runner on a fresh database with no branding row:
- *Version 0, Arabic and English:*
  - `GET /api/v1/branding` returns `versionNo 0` with `DEFAULT_EN` and `DEFAULT_AR`.
  - The first text run of the Arabic charter DOCX and of the Arabic roadmap PPTX title slide equals `productNameAr` from that response («منصة موبايلي للتحوّل»), and neither file contains the English name.
  - The English files start with `productNameEn` and contain no Arabic name.
  - The Arabic PDF draws «موبايلي» and prints no English name.
- *A configured version:* after the existing test's PUT, the DOCX and PPTX headers carry «منصة التجوال التجريبية» / "Synthetic Roaming Hub", never the shipped names.
- *Parity unit test:* `packages/reporting/src/labels.test.ts`, 3 tests.

**Failing before:** `E/03-integration-before.log`: `AssertionError: ar docx header: expected 'Mobily Transformation Hub' to be 'منصة موبايلي للتحوّل'`, EXIT=1. The configured-version test passes before as well as after; it guards the behaviour that was already correct.

**Passing after:** `E/04-integration-after-locale-unset.log`: 27/27 (`branding.test.ts` 26 tests, `exports-xml-chars.test.ts` 1), EXIT=0.

## 3. Checks (real exit codes)

All runs were one at a time, Node 24.21.0, offline, with PostgreSQL through `tests/qa/support/with-pg.sh` on `QA_PG_PORT=23150` and `MTH_PORT_POOL=23151-23199`. The disposable clusters and the A15 dump directory were removed after each run.

| # | Command | Locale | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | unset | `PASS gate DG4 (historical)`, EXIT=0 | terminal output only (see the header) |
| 2 | `pnpm -r typecheck` | unset | EXIT=0 | `E/10-typecheck.log` |
| 3 | `pnpm lint` | unset | EXIT=0 | `E/11-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | unset | "All matched files use Prettier code style!", xargs EXIT=0 | `E/12-prettier.log` |
| 5 | `pnpm openapi:lint` | unset | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations`, EXIT=0 | `E/13-openapi-lint.log` |
| 6 | `pnpm -r build` | unset | EXIT=0 | `E/14-build.log` |
| 7 | `pnpm -r typecheck` (re-run, see note) | unset | EXIT=0 | `E/15-typecheck-rerun.log` |
| 8 | `pnpm lint` (re-run, see note) | unset | EXIT=0 | `E/16-lint-rerun.log` |
| 9 | `npx vitest run --project unit-node packages/reporting apps/worker` | unset | 14 files, **113 tests passed**, EXIT=0 | `E/05-unit-reporting-worker-locale-unset.log` |
| 10 | same | `LANG=LC_ALL=C.UTF-8` | 14 files, **113 tests passed**, EXIT=0 | `E/06-unit-reporting-worker-c-utf8.log` |
| 11 | `npx vitest run --project unit-node tests/qa/unit/a22-s21-001-text-scan.test.ts` (QA unit test that imports the reporting package) | unset, then C.UTF-8 | 7 passed / 7 passed, EXIT=0 both | terminal output only |
| 12 | `with-pg.sh npx vitest run --project integration` on every integration path the change reaches (list below) | unset | **41 files, 316 tests passed**, EXIT=0 | `E/07-integration-reached-locale-unset.log` |
| 13 | same | C.UTF-8 | **41 files, 316 tests passed**, EXIT=0 | `E/08-integration-reached-c-utf8.log` |
| 14 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | unset | `PASS gate DG4 (historical)`, EXIT=0 | `E/30-validate-dg4-historical-end.log` |

**Integration paths for rows 12–13:**
- `apps/api/test/integration/reporting/` (whole directory, including the new `exports-xml-chars.test.ts`)
- `apps/api/test/integration/branding/`
- `apps/api/test/integration/forms/form-export-illustrative.test.ts`
- `apps/api/test/integration/text-scan/export-templates.test.ts`
- `tests/qa/integration/a07-historical-integrity.test.ts`
- `tests/qa/integration/a15-demo-transformation-outputs.test.ts`
- `tests/qa/integration/a15-outputs-every-definition.test.ts`
- `tests/qa/integration/a15-selected-records-and-injection.test.ts`
- `tests/qa/integration/a15-snapshots-and-packs.test.ts`

These are every test that imports `packages/reporting`, the export runner or the A15 export support.

**Notes:**
- **Re-runs (rows 7–8):** after the first typecheck and lint, `prettier --write` reformatted `docx.ts`, `pptx.ts`, `xml-chars.ts` and the two integration tests (line wrapping only). I re-ran typecheck and lint once so the reported results match the final tree. Both exits are 0. This is two runs of each command instead of the "once each" in D-164, still one at a time.
- **Earlier failures, disclosed:**
  - The first "before" integration run (overwritten by the final `E/03-integration-before.log`) failed for a test-setup reason: I had first exported DOCX/PPTX from the registers output, which offers only xlsx/csv/pdf, so the API returned `422 export.format_not_offered`. I corrected the tests to use the charter (DOCX) and roadmap (PPTX), as the reviewer did, and re-ran the before evidence.
  - The first unit "before" run had two test bugs in my own new test, both fixed before the recorded runs: a decimal surrogate-reference range missed `&#57340;`–`&#57343;`, and XLSX text was read with the `<a:t>/<w:t>` helper.
  - No other failed, flaky or timed-out test.
- **Not run (D-164):** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. They are reserved for the orchestrator's merged-tree verification. **Not passed.** No e2e spec reaches the changed code beyond what the integration paths above cover, and I ran none.

### Reviewers' reproductions, re-run (acceptance 3)

- **code-security, renderer level.** `node docs/delivery/test-evidence/DG5/code-security/round-1/repro/ooxml-control-chars.mjs`, from the rebuilt `dist`:
  - output: `docx … not-well-formed parts: none`, `pptx … none`, `xlsx … none`, `RESULT: every part is well-formed XML 1.0`, EXIT=0 (`E/20-repro-sec-renderer-after.log`);
  - before: the reviewer's own `46b-ooxml-control-chars-renderer.log`.
- **code-security, end to end.** `zz-sec-rg2-ooxml-control-char.test.ts`, copied unchanged into `tests/qa/integration/` for the run and removed afterwards (demo seed, real API, real runner):
  - rename status 200; stored name `"International Roaming\u000bprogramme (pasted)"`;
  - `charter.docx: job succeeded, 14706 bytes, not-well-formed parts: none`; `roadmap.pptx: … 38510 bytes, none`; `roadmap.xlsx: … none`;
  - 1/1 passed, EXIT=0. Both final assertions, which failed on the candidate, now pass (`E/24-repro-sec-e2e-after.log`).
- **qa-verifier, F-DG5-140.** I followed the reviewer's method:
  - Ran the A15 matrix alone with `QA_A15_DUMP`: 5/5 passed, 64 files, EXIT=0 (`E/21-repro-qa-a15-dump.log`).
  - Ran the reviewer's `zz-qa-dg5r1-inspect-samples.test.ts`, copied temporarily into `tests/qa/unit/` and removed afterwards: 1/1, EXIT=0 (`E/22-repro-qa-inspect-samples.log`).
  - Summary (`E/23-repro-qa-f140-summary.log`): all **25 Arabic PDF/DOCX/PPTX files** (the same 25 the reviewer counted) now start with «منصة موبايلي للتحوّل»; **0** Arabic samples contain "Mobily Transformation Hub"; the 25 English files start with the English name.
  - The probe's PDF reader lists glyphs in drawn order, so the 12 Arabic PDF names appear reversed. The reviewer's English PDF samples show the same artefact.

## 4. Contract, schema or dependency needs

None:
- no new operation, no response-shape change, `docs/api/openapi.yaml` untouched;
- no migration;
- no new dependency (`jszip` was already a dependency of `@mth/reporting`; the test-only XML checker is our own code).

The only package-level surface change is an internal one: the new export `DEFAULT_PRODUCT_NAMES` from `@mth/reporting`, and removal of the unused optional field `ExportRunnerDeps.productName` in the worker. No caller in the repository set that field.

## 5. ADR and data-dictionary statements for T-DG5-ARCH-R7

- **ADR-0046 §3 (and §1 on renderer errors) is incomplete.** It doesn't state the XML 1.0 character rule. Proposed wording: "every OOXML writer (DOCX, PPTX, XLSX) replaces characters XML 1.0 cannot carry (C0 controls other than tab, LF, CR; lone surrogates; U+FFFE, U+FFFF) with U+FFFD through the shared `packages/reporting/src/xml-chars.ts` `xmlSafe`, and checks the finished package (`assertWellFormedChars`); a package that still holds one is a `RenderError` (`export.render_failed`, no file stored)". It should also say that stored record text is not changed (the input rule is unchanged).
- **ADR-0049 §8 "Version 0 is the default"** is now true for generated files. Nothing to amend, unless the architect wants to name `DEFAULT_PRODUCT_NAMES` as the worker-side copy that is kept in parity with the API and the shell by `labels.test.ts`.
- **Data dictionary:** I found no statement made untrue. `branding_version` is unchanged.

## 6. User-facing texts

- **Made untrue by this work:** none.
- **Made true:** an Arabic export at branding version 0 now shows the Arabic product name, as ADR-0049 §8 and the shell already did.
- **New user-visible character:** U+FFFD (�) in DOCX/PPTX output where the stored text holds a control character. XLSX already did this. No new label or message text was added in en or ar. The `export.render_failed` message already exists and is unchanged.

## 7. Merge instructions

- Apply the working-tree changes listed in §1 (9 modified files and 5 new: `xml-chars.ts`, `xml-chars.test.ts`, `labels.test.ts`, `exports-xml-chars.test.ts`, plus the evidence directory and this handback).
- No migrations, ordering constraints or expected conflicts (the only repair task, D-191).
- Rebuild `@mth/reporting` (`pnpm -r build`) before any check that loads `dist` (for example the reviewer's `.mjs` probe).

## 8. What remains

- **For me:** nothing for the two findings.
- **For the orchestrator (D-164, D-191):** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite in both locale settings on the merged tree. I did not run them.
- **For the reviewers:** verifying F-DG5-100 and F-DG5-140 in round 2. An author never closes their own finding.
- **For the architect:** the ADR-0046 amendment in §5 (T-DG5-ARCH-R7), if accepted.
