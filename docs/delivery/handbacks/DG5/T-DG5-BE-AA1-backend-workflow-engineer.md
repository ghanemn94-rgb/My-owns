# Handback T-DG5-BE-AA1 (backend-workflow-engineer): DG5 round-5 repair, F-DG5-124

- **Stage:** P5 / DG5, FIXING after round 5 (candidate `sha256:a18a9f05…`, D-178).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-AA1-backend-workflow-engineer-20261021T213524Z-e3f5a119","session_id":"e3f5a119-1e0c-418b-95f4-4ac9e483ad06"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-AA1.md` (sha256 `ac9152cd…6e8e`, verified).
- **Base:** worktree `/home/user/wt/dg5-be-aa1`, branch `dg5/be-aa1`, `HEAD` `c819f15d1a6d8303e0aca2136c9fb1f8092190c9`.
- **Time:** started `2026-10-21T21:35:36Z`, finished checks `2026-10-21T22:07:04Z` (about 32 minutes).
- **Changes:** left **uncommitted**, as instructed.
- **Evidence:** `docs/delivery/handbacks/DG5/T-DG5-BE-AA1-evidence/`.

No business, Finance or IT approval was granted. Product gates G1–G6 aren't touched, and nothing here relates to DG0–DG7. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/forms/export.ts` | Reads the deployment environment when the export is generated. On a demo database it puts the illustrative label in `illustrativeLabel` (JSON) and in the CSV's first row, before the header. |
| `packages/shared/src/schemas/forms-records.ts` | `formRecordExport` gains `illustrativeLabel: string (min 1) \| null`. This is the additive contract change D-178 decided. |
| `docs/api/openapi.yaml` | `FormRecordExport` gains `illustrativeLabel` (`[string, "null"]`, `minLength: 1`, listed in `required`), and its description is updated. No other change. |
| `apps/api/test/integration/forms/form-export-illustrative.test.ts` (new) | The regression test: the domain reviewer's reproduction as a product test. |
| `apps/api/test/integration/forms/form-records.test.ts` | The existing `exportCsv` case now sets `illustrativeLabel: null`, which the type requires. A labelled variant checks that the label row comes after the BOM and before the header. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-AA1-*` | This handback and its evidence. |

No migration. No new API endpoint or operation. No new dependency.

## 2. F-DG5-124 (Medium, mandatory violation, REQ-S18-001)

### Cause

The form framework's per-form export (`exportFormRecords`, ADR-0041 §5) is outside the report pipeline. The pipeline labels its outputs through the synthetic flag recorded in the report snapshot (ADR-0050 §2 (d), D4). `buildFormExport` and `exportCsv` never read the deployment environment, so a demo database's CSV and JSON exports carried no illustrative label in either language.

### Fix

**The environment source.** `apps/api/src/modules/forms/export.ts:235` reads `readDeploymentEnvironment(db)` from `@mth/db` when the export is generated.
- This is the same source as `GET /api/v1/environment` (`admin/environment.ts` `environmentReadPort`) and the report pipeline (`reporting/reports/snapshots.ts` `reportEnvironmentPort`).
- `synthetic` is true exactly in a `demo` database. A database without a marker reads as production (fail-safe).
- `forms` cannot import `admin`, so it reads the same `@mth/db` function directly, as `reporting` does.

**The label strings.** `FORM_EXPORT_ILLUSTRATIVE_LABELS` (`export.ts:95`) holds "Illustrative example — synthetic" and "مثال توضيحي — اصطناعي". These are the reporting pipeline's `export.illustrative` strings from `packages/reporting/src/labels.ts`.
- The API may not import `@mth/reporting`'s main entry (ADR-0046 §1; `architecture.testkit.ts` allows only `@mth/reporting/storage`), so the strings are repeated in `export.ts`.
- The regression test checks that they equal `FRAME_LABELS.{en,ar}["export.illustrative"]`, so a drift between the two fails the test.

**The JSON body.** At `export.ts:271–275`, `illustrativeLabel` is the label in the export language on a demo database and `null` otherwise.

**The CSV.** At `export.ts:297`, when `illustrativeLabel` is set it becomes the first line, after the BOM and before the header. The BOM, the CRLF line ends and RFC 4180 quoting are unchanged. Non-demo CSVs are byte-for-byte unchanged.

**The contract.**
- zod: `packages/shared/src/schemas/forms-records.ts:34`.
- OpenAPI: `docs/api/openapi.yaml:25902–25909`.

### Regression test

The new `apps/api/test/integration/forms/form-export-illustrative.test.ts` has 19 tests.

**Demo database.**
- Setup: the real `seedDemo` dataset in a scratch database, with the real API on it (`MTH_ENV=demo`). The test signs in as `roaming.user.tl`, the reviewer's user, and confirms `GET /environment` returns `kind: demo, synthetic: true`.
- Cases: all 8 domain cases (T14 and T01 × csv and json × en and ar) on the roaming transformation.
- CSV: line 1 is exactly `BOM + label` in the export language, and line 2 is the localized header. The test also checks CRLF line ends and a final CRLF.
- JSON: the body parses with `formRecordExport`, and `illustrativeLabel` equals the label in the export language.
- Each case keeps the probe's final assertion, `status 200`.

**Non-demo database.**
- Setup: a migrated database with no marker, where `GET /environment` returns `production, synthetic: false`, plus synthetic T01 and T14 fixtures.
- Cases: the same 8 cases. None has a label row in either language, and every JSON body has `illustrativeLabel: null`.

**String check.** One test checks that the label strings equal the reporting pipeline's `FRAME_LABELS`.

**Failing before the fix.** Log: `01-regression-before.log`, exit 1: 13 failed, 6 passed. The 6 that passed are the two environment checks and the four non-demo CSV cases, which were already unlabelled.

```
AssertionError: first row: BOM + label, before the header: expected '﻿Record ID,Version,ID,ID (status…' to be '﻿Illustrative example — synthetic'
AssertionError: first row: BOM + label, before the header: expected '﻿معرّف السجل,الإصدار,المعرّف,الم…' to be '﻿مثال توضيحي — اصطناعي'
AssertionError: expected undefined to be 'Illustrative example — synthetic'
AssertionError: expected undefined to be null
 Test Files  1 failed (1)
      Tests  13 failed | 6 passed (19)
EXIT=1
```

**Passing after the fix.** Log: `02-regression-after.log`, exit 0.

```
 ✓ |integration| apps/api/test/integration/forms/form-export-illustrative.test.ts (19 tests) 8971ms
 Test Files  1 passed (1)
      Tests  19 passed (19)
EXIT=0
```

### The 8 domain cases re-run

Acceptance item 3, run as the integration equivalent on a seeded demo database. A temporary dump spec, deleted after the run, wrote the first lines of each response.
- Output: `03-eight-cases-dump.txt`.
- Run log: `03-eight-cases-dump.log`, exit 0.

| Case | Status | What the file carries |
|---|---|---|
| T14 csv en | 200 | Line 1 is `﻿Illustrative example — synthetic`, line 2 is `Record ID,Version,ID,…` |
| T14 json en | 200 | `"illustrativeLabel":"Illustrative example — synthetic"`, 3 rows |
| T14 csv ar | 200 | Line 1 is `﻿مثال توضيحي — اصطناعي`, line 2 is `معرّف السجل,الإصدار,…` |
| T14 json ar | 200 | `"illustrativeLabel":"مثال توضيحي — اصطناعي"`, 3 rows |
| T01 csv en | 200 | Line 1 is `﻿Illustrative example — synthetic`, line 2 is `Record ID,Version,Dimension,…` |
| T01 json en | 200 | `"illustrativeLabel":"Illustrative example — synthetic"`, 6 rows |
| T01 csv ar | 200 | Line 1 is `﻿مثال توضيحي — اصطناعي`, line 2 is `معرّف السجل,الإصدار,البُعد,…` |
| T01 json ar | 200 | `"illustrativeLabel":"مثال توضيحي — اصطناعي"`, 6 rows |

On the non-demo database all 8 cases return 200. The CSVs have no label row (line 1 is the BOM plus the header), and every JSON body has `"illustrativeLabel":null`.

## 3. Checks run

All runs were sequential, never two heavy runs in parallel. Integration runs used `tests/qa/support/with-pg.sh` (a disposable PostgreSQL cluster, removed on exit) with `QA_PG_PORT=23150` and `MTH_PORT_POOL=23151-23170`. Empty `.claude/.cc-writes` directories were removed before the tests (none were found).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-historical-start.log` |
| 1 | Regression test before the fix | 1 | 13 failed, 6 passed (expected) | `01-regression-before.log` |
| 2 | Regression test after the fix | 0 | 19 passed | `02-regression-after.log` |
| 3 | The 8-case dump (temporary spec, deleted) | 0 | Label in all 8 demo cases, none in the 8 non-demo cases | `03-eight-cases-dump.log`, `03-eight-cases-dump.txt` |
| 4 | `pnpm -r typecheck` (first pass) | 0 | Done | `10-typecheck.log` |
| 5 | `pnpm -r build` (first pass) | 0 | Done | `11-build.log` |
| 6 | `pnpm lint` (first pass) | 0 | No warnings | `12-lint.log` |
| 7 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (first pass) | 0 | All matched files use Prettier code style | `13-prettier.log` |
| 8 | `pnpm openapi:lint` (first pass) | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `14-openapi-lint.log` |
| 9 | Unit, locale unset, attempt 1: `vitest --project unit-node apps/api/src/modules/forms/forms.test.ts apps/api/src/architecture.test.ts` | **1** | 1 failed, 141 passed (see the disclosure below) | `20a-unit-locale-unset-attempt1-FAILED.log` |
| 10 | Same command, `LANG=LC_ALL=C.UTF-8`, attempt 1 | **1** | 1 failed, 141 passed (same failure) | `21a-unit-c-utf8-attempt1-FAILED.log` |
| 11 | Unit, locale unset, after the fix | 0 | 2 files, 142 passed | `20-unit-locale-unset.log` |
| 12 | Unit, `C.UTF-8`, after the fix | 0 | 2 files, 142 passed | `21-unit-c-utf8.log` |
| 13 | `vitest --project unit-web apps/web/src/components/form-framework/form-framework.test.tsx` (read-only check of the web client) | 0 | 16 passed | `22-web-form-framework-unit.log` |
| 14 | Integration, locale unset: `vitest --project integration apps/api/test/integration/forms apps/api/test/integration/contract/contract.test.ts` | 0 | 6 files, 174 passed (contract 83, form-records 18, form-export-illustrative 19, form-schemas 17, form-framework 16, form-bulk-registers 21) | `30-integration-locale-unset.log` |
| 15 | Same command, `C.UTF-8` | 0 | 6 files, 174 passed | `31-integration-c-utf8.log` |
| 16 | `pnpm -r typecheck` (final) | 0 | Done | `15-typecheck-final.log` |
| 17 | `pnpm -r build` (final) | 0 | Done | `16-build-final.log` |
| 18 | `pnpm lint` (final) | 0 | No warnings | `17-lint-final.log` |
| 19 | Prettier check, same command as #7 (final) | 0 | All matched files use Prettier code style | `18-prettier-final.log` |
| 20 | `pnpm openapi:lint` (final) | 0 | PASS, 846 operations | `19-openapi-lint-final.log` |
| 21 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `90-validate-dg4-historical-end.log` |

**Disclosures.**
- **Runs 9 and 10 failed.** My first version used a computed member, `FORM_EXPORT_ILLUSTRATIVE_LABELS[lang]`. The ADR-0002 module-boundary rule in `architecture.test.ts` rejects that: "computed member with a non-literal key (line 271) bypasses the module-interface check". I replaced it with the file's existing `lang === "ar" ? X.ar : X.en` pattern (`export.ts:271–275`) and re-ran: runs 11 and 12, both green. The failed logs are kept.
- **The static checks ran twice.** That edit came after the first static checks (4–8), so I ran all five again on the final tree (16–20). Both passes exited 0. Strictly, this is more than "once each" under D-164, but every run was sequential.
- **Contract test.** It validates every exercised `exportFormRecords` JSON response against the updated OpenAPI `FormRecordExport`, where `illustrativeLabel` is now required. It passes.
- **Not run (D-164):** `pnpm test`, `pnpm test:integration` and the full e2e suite. These are for the orchestrator's merged-tree verification. No e2e spec is reached: the web isn't changed and the CSV is a plain download link.
- **No flaky tests or timeouts were seen.**

## 4. Web client (frontend-owned; not edited)

`apps/web/src/components/form-framework/api.ts:96–97` `fetchExport` uses `api.get<FormRecordExport>` without a zod parse. `ExportDialog.tsx:61` `downloadJson` serialises the body as is.
- A strict client parse doesn't reject the new field, so no web change is needed.
- The downloaded JSON now carries `illustrativeLabel` on a demo database.
- The CSV button downloads the API's CSV directly, so it gets the label row.
- `pnpm -r typecheck` passes for `apps/web` with the new required field in the type. No web fixture builds a typed `FormRecordExport`.
- The web unit test `form-framework.test.tsx` passes (16 of 16). Its mock JSON lacks `illustrativeLabel`, which is harmless because the client doesn't parse it.

## 5. Contract, schema and dependency needs

- **Only the D-178 additive change was made.** `illustrativeLabel` was added to `FormRecordExport` (OpenAPI) and to `formRecordExport` (zod), always present, string or null. No other contract change. No new operation, no new dependency, no migration.
- **One OpenAPI text is now incomplete, outside my ownership** (I own only the `FormRecordExport` schema), so I left it unchanged:
  - Where: the `exportFormRecords` `text/csv` response schema description at `docs/api/openapi.yaml:18476` reads "RFC 4180 UTF-8 with BOM; header labels in the requested language (ADR-0041 §5)."
  - The text is still true, but it doesn't mention that a demo-database CSV starts with the illustrative label row before the header.
  - Suggested wording: "RFC 4180 UTF-8 with BOM; on a demo database the first row is the illustrative label in the requested language (D-178); then header labels in the requested language (ADR-0041 §5)."
  - The orchestrator decides whether to apply it.

## 6. ADR and data-dictionary statements made incomplete (for T-DG5-ARCH-R7)

- **ADR-0041 §5, "Export" row** (`docs/architecture/adr/ADR-0041-…md:116`): it describes the CSV and JSON layout and doesn't mention the demo label. It should add that on a demo database the CSV's first row (after the BOM, before the header) is the illustrative label in the export language. It should also say the JSON body carries `illustrativeLabel` (the label, or `null` outside a demo database), per D-178.
- **ADR-0050 §2 (d) and amendment D4** (`ADR-0050-…md:38`, `:252–262`):
  - (d) says every report **and export** generated in a demo database carries the label. It then describes only the report pipeline: `ReportEnvironmentPort`, the snapshot's recorded `synthetic` member, and the renderers.
  - The form framework's export is a second export path. It reads the same source (`@mth/db` `readDeploymentEnvironment`) directly when the export is generated. It records no snapshot, because the export is a live read, and it repeats the `export.illustrative` strings, held equal to `FRAME_LABELS` by a test.
  - The ADR text is incomplete rather than untrue. An amendment naming this second path would make it complete.
- **Data dictionary:** no statement about the form export exists in `docs/architecture/data-dictionary.md`, so nothing there is affected.

## 7. User-facing texts

- **No user-facing text became untrue.** The export dialog already showed the demo badge, and now the downloaded files carry the label too.
- **The new user-visible strings are the reporting pipeline's existing ones,** in en and ar ("Illustrative example — synthetic" / "مثال توضيحي — اصطناعي"). No new translation was introduced.

## 8. What remains

- **Merged-tree verification (D-164)** by the orchestrator: `pnpm test`, `pnpm test:integration` and the full e2e suite. These were not run by me.
- **Round 6:** the domain reviewer verifies F-DG5-124. I don't close my own finding.
- **Optional, for the orchestrator or architect:** the OpenAPI `text/csv` description wording (§5) and the ADR-0041/ADR-0050 amendments (§6).
- **Untracked files I didn't create.** `git status` shows untracked top-level files: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. I didn't edit any of them intentionally. Most were listed by my first `git status` at the start; that listing was truncated, so I can't confirm `.zshrc` and `CLAUDE.local.md` were among them. They look like run-environment artefacts, are not part of this repair, and should not be integrated.

## 9. Merge instructions

- No migration and no ordering constraint.
- Rebuild `@mth/shared` before the API is type-checked against `dist`; `pnpm -r build` does this.
- No conflict is expected with T-DG5-FE-AA1, which owns only `apps/web/**`. I didn't touch it.
