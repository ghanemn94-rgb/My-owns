# Handback T-DG7-FE-C2 (frontend-ux-engineer): Administration > Retention screens

- **Stage:** DG7 (P7), repair task for finding F-DG7-913. Requirements REQ-S16-024 (screens), REQ-S20-022 (A22: admin job visibility).
- **Invocation:** `DG7-T-DG7-FE-C2-frontend-ux-engineer-20261115T105830Z-5e5015e1`, session `5e5015e1-c4df-4cdc-b463-7f66746b9d19`.
- **Base:** `HEAD` `16b2bdd3565b6da39a83e376d930bf7593750884` on `claude/mobily-transformation-platform-dg6-regate`; working tree clean except this run's own `docs/delivery/runs/...` directory when I started.
- **Time:** start 10:58:42 UTC, end 11:50 UTC (`date -u`).
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-FE-C2.md`, sha256 `39e8a7d4…180d2` (verified).
- Nothing here grants a business, Finance or IT approval. Product gates G1–G6 are not touched, and no DG gate is claimed. All data in the tests is SYNTHETIC, and every reference text written by a test begins with `TEST-ONLY`.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/web/src/pages/admin/retention/RetentionPages.tsx` (new) | The five §E.6 screens on the real API (`api/p7.ts` hooks and `p7Paths`): `RetentionPage`, `RetentionClassPage` (change form), `RetentionRunPage` (per-record action log), `RetentionArchivedPage`, `BackupSetsPage`. |
| `apps/web/src/pages/admin/retention/retention-screens.test.tsx` (new) | Component tests T-E23 and T-E24, plus If-Match/409/422, Idempotency-Key, read-only, Unknown-never-0, filters and 403. 20 tests. |
| `apps/web/src/i18n/en/retention.json`, `apps/web/src/i18n/ar/retention.json` (new) | The `retention` namespace: every §E.6 text exactly, plus the screens' labels. 146 leaves in each, with identical key sets. |
| `apps/web/src/i18n/provisional-ar-p7-retention.ts` (new) | Marks each of the 146 Arabic leaves as provisional: 24 are `work-split` (the §E.6 cells, used exactly) and 122 are `fe-c2`. |
| `apps/web/src/i18n/index.ts` | Registers the `retention` namespace (en, ar). |
| `apps/web/src/app/router.tsx` | Five lazy pages; `P7_FE_C_RETENTION_PATHS` and `P7_FE_C_RETENTION_ROUTES` replace the five `P7NotAvailablePage` routes. `P7_PLANNED_ROUTES` is now empty and kept as a tested seam. `P7NotAvailablePage` itself is kept for that seam, as with P6. |
| `apps/web/src/app/p7-shell.test.tsx` | The seam expectation is now `P7_PLANNED_ROUTES` = `[]`. The placeholder test is replaced: each of the five slice E paths renders its `data-p7-screen` (never `data-p7-feature`) in the locale's direction, and sends only GET requests. |
| `apps/web/e2e/p7-retention.spec.ts` (rewritten) | T-E25 on the real stack, in chromium-en and chromium-ar: axe at 1280 and 360 px, no page-level horizontal scroll at 360 px, keyboard paths, and ADM_TECH vs AUD. |
| `docs/handover/release-notes.md`, `docs/handover/known-limitations.md` | Regenerated with `--write`. The only diff is the new provisional-Arabic row (146) and the total (299 → 445). |
| `tools/release/tests/check-handover.test.mjs` | One line: adds `apps/web/src/i18n/provisional-ar-p7-retention.ts` to `KL_PROVISIONAL_SOURCES`, the hard-coded list of provisional files that the fixture copies (see §3 row 16b). This file belongs to DevOps; it is outside the write-guard's forbidden set (`tools/gates/**`, `tools/agents/**`). |
| `docs/handover/guides/admin/{en,ar}/admin-guide.md` | §Retention "Status in this release" said the screens were not built. It now describes the built screens and their rights. One paragraph changed in each language. |
| `docs/delivery/handbacks/DG7/T-DG7-FE-C2-evidence/**` | Logs, screenshots and the axe summaries. |

`api/**` and the API are unchanged. No `p7-pending*.ts` entry relates to these screens: `P7_PENDING_BE_G` was already empty, so none was removed.

## 2. Behaviour per requirement

### REQ-S16-024: Administration > Retention (§E.6)

**Retention** (`/admin/retention`)

- Lists every class: label in the locale, code, category, action chip, period, IT approval reference, and table count.
- The table is the shared `RegisterTable`, so it has sort, filter, pagination and column selection.
- A NULL period shows the chip "Not set (IT to agree)" / «غير محددة (يُتفق عليها مع تقنية المعلومات)». It never shows 0 or a default number.
- Business, audit, snapshot, system and derived classes show "Always kept". A class with an expiry job shows "Removed automatically when expired".
- Runs and dry runs are listed newest first, cursor paged, and polled while one is queued or running.
- A NULL count shows "Unknown". A count the server gives as 0 shows 0.
- Holders of `retention.run` get "Dry run" and "Run now":
  - both need a reason;
  - each mode keeps its own Idempotency-Key for retries of the same submission;
  - a 422 `retention.run_in_progress` shows the §E.5 text.

**Retention class** (`/admin/retention/classes/:code`)

- Shows the facts, the tables (age column or "None (never selected by a run)", whether a table can be deleted) and the inbox effect text when the class covers `inbox_notification`.
- The change form appears only for `retention.configure` holders on an operational class that no job manages. It has:
  - **Action:** Keep / Archive / Archive, then delete.
  - **Period in days:** empty means `null`; otherwise a whole number from 1 to 36500.
  - **"IT approval reference":** labelled as a reference, with the §E.6 help "Saving it does not approve anything". Empty means `null`; otherwise 3–500 characters.
  - **Reason.**
- The form is sent as `PUT` with `If-Match` set to the version the form was opened on.
- A 409 shows `ConflictPanel`: your values next to the latest saved values. Nothing is saved. "Re-apply" sends the change again with the new version; "Discard" resets the form.
- A 422 shows the §E.5 problem text.
- After a save, the screen shows "Saved" and the values the server returned.
- With `retention.read` only, the screen shows a read-only note. A class that is always kept shows "always kept" and no form. A note says that changing a class grants no business, Finance or IT approval.

**Retention run** (`/admin/retention/runs/:id`)

- Shows mode, status chip (text and icon), requested by, as-of time, the four counts (Unknown while NULL), archive set key, SHA-256 and bytes (for a run), the failure reason, and the started and finished times ("Not yet" while unset).
- The per-record action log (`listRetentionRunActions`) lists table, record key (primary-key values only), action chip, class, period applied, record date and time logged. It is cursor paged.
- A run (not a dry run) links to its archived records.

**Archived records** (`/admin/retention/archived`)

- Two filters, table name and run, are validated against the contract patterns and carried in the URL. Only the two contract parameters are ever sent.
- A record that was not purged shows "Kept (read-only)". A purged one shows "Deleted on <date>".

**Backup sets** (`/admin/retention/backups`)

- Read-only, with the §E.6 note. It has no form and no control that starts a backup.
- Each set shows status (with the failure reason), times, migration level, PostgreSQL major version, sizes, evidence storage, checksums, operator and recorded time. NULL values show "Unknown", never 0.
- An empty list shows "No backup set has been reported yet."

**Across all five screens**

- Every status is a chip with a text label and an icon. Blue is never used as a "good" colour: "Keep" and queued/running are neutral, an enabled action is a warning, and only a succeeded run or backup uses the good tone.
- Identifiers, checksums and table names are shown LTR inside RTL (`<bdi dir="ltr">`).
- A 403 or 404 shows the shared no-permission / not-found state. Every right is enforced by the server (`requireRetentionRight`). `useCan` only hides controls.

### REQ-S20-022 (A22, "admin job visibility")

- The retention job's runs, with their status, counts, failure reason and per-action log, are now visible on screen. Before this task they were visible through the API only.
- A22 as a whole is still qa-verifier's executable test. I did not run A22.

### Tests mapped (p7-work-split §E.4)

- **T-E23:** `retention-screens.test.tsx` checks "Not set (IT to agree)" for NULL, no `data-period`, never 0, and the reference labelled as a reference with its help. Run in en and ar.
- **T-E24:** the same file checks:
  - the 24 §E.6 cells exactly in en and ar;
  - identical key sets;
  - every Arabic leaf listed as provisional, and the `work-split` entries equal to exactly the §E.6 keys;
  - no gate names or claim wording;
  - `<html dir>` rtl in Arabic, ltr in English.
- **T-E25:** `p7-retention.spec.ts` on the real stack, in both locales. Covered:
  - axe at 1280 and 360 px on home, class, archived, backups, run-404 and class-auditor;
  - no horizontal scroll at 360 px;
  - keyboard paths, each starting at the skip link, with a visible focus check at every Tab stop:
    - **Run form:** "Dry run" with an empty reason is refused, focus moves to the reason field, and nothing is posted.
    - **Class change:** a class link opens the class page; period, reference and reason are typed, and Save is pressed with Enter. The saved period and reference are read back from the page (one real `PUT`, If-Match).
    - **Archived filter:** typed and applied with Enter; the URL carries exactly `?table=…`.
  - AUD sees a read-only class and no run form.
  - Axe summaries: `screens/{en,ar}/p7-retention-axe-summary.json` list **0 violations of any impact** on these screens. This is a measurement, not a claim of conformity.

## 3. Checks run (Node 24.21.0, `MTH_PNPM_OFFLINE=1`; logs in `docs/delivery/handbacks/DG7/T-DG7-FE-C2-evidence/`)

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 1 | `npx vitest run src/pages/admin/retention` (apps/web), first run | **exit 1**: 9 of 20 failed. Test defect: `waitFor(() => querySelector(...)!)` accepts a null result. Fixed with a throwing `found()` helper. | not kept (console) |
| 2 | same, plus `src/app/p7-shell.test.tsx` | exit 0, 31 passed | console |
| 3 | `pnpm -r typecheck`, first run | **exit 2**: a test-fixture type (`let current` inferred too narrowly). Fixed. | overwritten by row 4 |
| 4 | `pnpm -r typecheck` | exit 0 | `pnpm-typecheck.log` |
| 5 | `pnpm lint` | exit 0 | `pnpm-lint.log` |
| 6 | `pnpm openapi:lint` | exit 0 (`PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations`) | `pnpm-openapi-lint.log` |
| 7 | `pnpm -r build` | exit 0 | `pnpm-build.log` |
| 8 | `E2E_PG_PORT=27621 E2E_API_PORT=27622 E2E_SCREENSHOT_DIR=…/screens apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p7-retention.spec.ts --workers=1` | exit 0. 4 passed (47.0 s): en ADM_TECH 17.8 s, en AUD 4.3 s, ar ADM_TECH 16.8 s, ar AUD 4.0 s. The worst case is under half the 90 s budget. | `e2e-p7-retention.log`, `screens/` |
| 9 | `pnpm test` | exit 0. unit-node 207 files / 3042 tests; unit-web 131 / 2199; unit-formula-nocodegen 3 / 259 passed, 2 skipped | `pnpm-test.log` |
| 10 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `prettier-check.log` |
| 11 | `node tools/release/release-notes.mjs … --check` (before the write) | **exit 1**: out of date, because of my new provisional file. Then `--write` exited 0; the diff is the new row and total only. | console |
| 12 | `node tools/release/known-limitations.mjs --protocol-audit docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-prefreeze.json --check` (before the write) | **exit 1**, same cause. Then `--write` exited 0; the diff is the new row and total only, and `external-dependencies.json` is unchanged. | console |
| 13 | Both `--check` commands after the write | release-notes exit 0 ("up to date"); known-limitations exit 0 (PASS, both files current) | `release-docs-check.log` |
| 14 | `QA_PG_PORT=27631 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts apps/api/test/integration/retention` (disposable PostgreSQL) | exit 0. 4 files, 128 tests passed (contract, plus retention classes, runs and backups). I touched no integration test; this is a regression run against the API the screens use. | `integration-contract-retention.log` |
| 15 | `node tools/gates/validate.mjs --historical --stage DG6` | exit 0 (`PASS gate DG6 (historical)`) | `validate-historical-DG6.log` |
| 16 | `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` | **exit 1**: 466 tests, 462 pass, 2 fail, 2 skipped. (a) **T-A5** `build-from-archive.test.mjs`: `pnpm install` in the unpacked archive fails with `EROFS` creating a symlink in the pnpm store under `/root/.local/share/pnpm/store`, because HOME is read-only in this agent sandbox (agent-protocol). This is environmental and unrelated to this change, so T-A5 is **BLOCKED** here, not passed. (b) `check-handover.test.mjs` "--write on a fixture copy …": **caused by this change**. The test hard-codes the list of provisional-Arabic files it copies into its fixture (`KL_PROVISIONAL_SOURCES`), and my new file was missing, so the fixture's total was 299 instead of 445. Fixed by adding the one path to that list. | `release-tool-tests.log` |
| 17 | `node --test tools/release/tests/check-handover.test.mjs` after the fix | exit 0: 51 tests, 51 pass | `release-check-handover-rerun.log` |
| 18 | Repo-wide prettier check and `pnpm lint` again on the final tree (after rows 16–17 and this handback) | both exit 0 | `prettier-check.log`, `pnpm-lint.log` (overwritten with the final runs) |

I did not re-run the whole release-tool suite (row 16) after the one-line fix; about 15 minutes of it is the archive build. Only `check-handover.test.mjs` was re-run (row 17). `eslint` ignores `tools/release/tests/**` by configuration, so `pnpm lint` does not cover that file; prettier does.

## 4. Known gaps

1. **No dry run or run is queued on the real stack.** `with-stack.sh` starts no worker (readiness shows `"worker":"unknown"`). A queued run would stay queued, and every later class change would be refused with `retention.run_in_progress`, including by the other locale's project. On the real stack the run form is checked only up to the client refusal. The POSTs, Idempotency-Key and the 422 are covered by component tests and BE-G's `runs.test.ts`. A run's detail screen is checked in the real stack in its 404 state only. Its populated state is covered by component tests.
2. The 409 conflict path is covered by component tests only, not in the real stack.
3. The Arabic texts are provisional (146 entries labelled). 122 of them were written by me and have not been checked by a qualified Arabic reviewer (D-243 Q7).
4. A22 (REQ-S20-022) as a whole is not run here. That is qa-verifier's acceptance test.
5. **T-A5 is BLOCKED in this sandbox:** the release-tool test that builds from the archive fails on the read-only HOME (pnpm store). See §3 row 16a. It needs a host where HOME is writable.
6. **Real-stack check of the inbox effect:** the `inbox_read_item` class shows `effect.inbox` only because its table list includes `inbox_notification`. This depends on the migration 0143 mapping. It is covered by a component test and was not opened in the e2e run.

## 5. Open questions and merge instructions

- **F-DG7-913:** the screens now exist. The register row REQ-S16-024 ("Administration > Retention by FE-C", evidence citing the FE-C log) is the analyst's (AN-P7E). It should now cite this handback's evidence (`retention-screens.test.tsx`, `e2e-p7-retention.log`). I did not edit `requirements.csv`.
- The admin guide paragraph was DOC-A's text. I corrected it because it would otherwise be false. The orchestrator may want DOC-A to confirm the wording.
- **Merge:** no migration and no API change. After a merge that changes the register, the provisional files or the protocol-audit report, regenerate `release-notes.md` and `known-limitations.md` with `--write`.
- **Superseded content:** the FE-D handback's statement that "T-E25 is not satisfied" is superseded by row 8. The domain reviewer's placeholder screenshots in `test-evidence/DG7/domain/round-1/` describe the earlier candidate.
