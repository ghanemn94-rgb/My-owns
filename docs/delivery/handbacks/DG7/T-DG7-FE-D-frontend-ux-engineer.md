# T-DG7-FE-D handback (frontend-ux-engineer)

- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-FE-D.md` (sha256 `398350148e2c1ba5d1b2bf4a7208f85fc806bbc15b70c80fcd0a2e839fa95370`).
- **Invocation:** run `DG7-T-DG7-FE-D-frontend-ux-engineer-20261113T115912Z-a54ff2db`, session `a54ff2db-7f6a-45f7-83eb-c2f7378bd1d9`.
- **Base:** `b9e5a862dc227264c065345111b0dc2e22ae5720`, on branch `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from this run's record directory.
- **Time:** started 12:03 UTC and finished about 12:30 UTC (`date -u`).
- **Pre-implementation validator:** `node tools/gates/validate.mjs --historical --stage DG6` exited 0 with `PASS gate DG6 (historical)`. Log: `T-DG7-FE-D-evidence/validate-historical-DG6-start.log`.

All data in these checks is SYNTHETIC: the seeded dev users, plus the exports and bundle imports the specs create on a disposable stack. Nothing here is a business, Finance or IT approval. These are engineering measurements on these screens. They are not a claim of conformity to any accessibility standard.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/web/e2e/p7-admin-screens.spec.ts` (new) | T-I17 and the same checks over every screen FE-B and FE-C built. Each screen is checked for axe at 1280 px and at 360 px, for RTL/LTR, for no page-level horizontal scroll at 360 px, and with keyboard paths. The no-permission state is also covered. |
| `apps/web/e2e/p7-retention.spec.ts` (new) | Checks the five Retention routes, which are still **placeholders**. It does **not** satisfy T-E25; see §4. |
| `docs/delivery/handbacks/DG7/T-DG7-FE-D-frontend-ux-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-FE-D-evidence/**` | Logs, 37 screenshots per language, and the axe summaries. |

No screen file was changed. The checks found no defect in the screens, so there was nothing to fix. No shared file, `p7-pending*.ts` entry, API, migration or i18n key was touched. The `p7-pending*.ts` files have no entry for FE-D (`grep` for `FE-D`, `T-I17` and `T-E25` finds nothing).

## 2. Behaviour per requirement / test id

No register row is assigned to FE-D in `p7-work-split.md`. My test ids are T-I17 (§I.5) and T-E25 (§E.4).

### T-I17 (`p7-*.spec.ts`: "axe, RTL/LTR, 360 px and keyboard over both screens"): delivered for the register and About

T-I17 is delivered, and the same checks are extended to all nine FE-B screens. The real stack is `apps/web/e2e/support/with-stack.sh`: disposable PostgreSQL, the real API and the built SPA, with no mocks. Each test runs in both `chromium-en` and `chromium-ar`.

**What `checkScreen` asserts for every screen state listed below:**

- the screen's own `data-p7-screen` root is shown, with no placeholder and no loading spinner;
- `<html dir>` and the computed `direction` of `main` are `rtl` in Arabic and `ltr` in English;
- axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) finds no serious or critical violation at 1280 × 900 and again at 360 × 800;
- at 360 px, `scrollWidth <= clientWidth` holds (no page-level horizontal scroll);
- a full-page screenshot is saved at both widths.

**Screen states checked:**

1. **Data export** (`/admin/migration/exports`).
   - Keyboard path: skip link → Tab to "Request export" → Enter with no reason. The inline error shows, the textarea is `aria-invalid="true"` and focus moves to it (focus is visible). I ran axe and took a screenshot of this error state.
   - Typing a reason → Tab → Enter gets one of two server answers. The English project got "requested". The Arabic project, running on the same stack while the English export was still queued (no worker runs), got the 422 `migration.export_in_progress` text in the form. Both outcomes are read back from the page and logged.
   - Tab to the newest export's link → Enter opens the detail.
2. **Migration export detail.** The export stays queued, and the downloads area is not the "ready" one.
3. **Migration status** (`/admin/migration/imports`). It is read-only: no form and no non-GET admin request (asserted). Every focusable control inside `main` was Tab-walked with a visible focus at each stop.
4. **Identity rebinds** (`/admin/migration/identity-rebinds`).
5. **Migration import detail** and 6. **Migration reconciliation report:** checked only in their 404 "Not found" state (see §4).
7. **Configuration transfer** (`/admin/config-transfer`).
   - Keyboard path: skip link → Tab to the first kind checkbox → Space toggles it on, and Space again toggles it off → Tab to the reason → type → Tab to "Export bundle" → Enter. The "exported" banner appears; I ran axe and took a screenshot.
   - Enter on "Open the export" leads to the detail. That link was focused programmatically, then activated with Enter.
8. **Config bundle export detail.**
9. **Config bundle import detail.** The exported bundle was downloaded with the session's own request and set on the file control. Then Tab to "Upload" → Enter led to the import detail, which is uploaded and not validated. Nothing was committed.
10. **Requirement register** (`/admin/requirements`). Keyboard path: skip link → Tab to the first requirement link → Enter opens `/admin/requirements/<id>`, with focus on `#requirement-detail-title` (visible).
11. **Requirement detail.**
12. **About this release** (`/admin/about`). All 39 focusable controls inside `main` were Tab-walked, each with a visible focus indicator.
13. **No permission** (`dev.nobody`) on Data export, Configuration transfer and the register. The no-permission state shows with no form, axe passes, there is no horizontal scroll at 360 px, and both languages were checked.

**Across every test:**

- every Tab stop on a keyboard path shows a computed outline or box-shadow;
- every request stayed on the application origin, with no CSP error (`trackRequests`).

**axe at any impact:** the axe summaries `screenshots/{en,ar}/p7-axe-summary.json` list **zero violations of any impact**, including moderate and minor. That covers 30 axe runs per language.

### T-E25 (`p7-retention.spec.ts`: "axe, keyboard, 360 px" over the Retention screens): NOT satisfied

The §E.6 Retention screens are not built (FE-C handback, Known gaps 1). Their five routes show the "not available yet" placeholder. `p7-retention.spec.ts` checks only what exists, on each route:

- the placeholder is shown with no form;
- its direction follows the language;
- axe passes at 1280 px and 360 px (zero violations of any impact, per `p7-retention-axe-summary.json`);
- there is no horizontal scroll at 360 px.

It is not T-E25, and the file header says so.

## 3. Checks run (real exit codes)

**Environment:**

- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, in the agent sandbox with no Docker;
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (chromium-1194);
- the existing `apps/web/dist` and `apps/api/dist` builds, both newer than every `apps/web/src` and `apps/api/src` file (checked with `find -newer`).

Logs are in `docs/delivery/handbacks/DG7/T-DG7-FE-D-evidence/`.

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 0 | `node tools/gates/validate.mjs --historical --stage DG6` (before implementing) | exit 0, `PASS gate DG6 (historical)` | `validate-historical-DG6-start.log` |
| 1a | `E2E_PG_PORT=27611 E2E_API_PORT=27612 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p7-admin-screens.spec.ts apps/web/e2e/p7-retention.spec.ts --workers=1` (first run) | **exit 1**: 2 failed, 10 did not run. The Arabic export request was refused with 422 "in progress", which is the real server guard, and my spec expected only "requested". My row selector `#p7-…` was also wrong (`RegisterTable` puts its id in `data-register`). Both were spec defects and are fixed. | not kept (console) |
| 1b | same (second run) | **exit 1**: 12 passed and 2 failed. I expected `data-state='error'` for an unknown import id, but the screen correctly shows the 404 "Not found" state (`data-state='no-permission'`, which never discloses existence). This was a spec defect and is fixed. | not kept (console) |
| 1c | same (final, after adding the axe summary output) | **exit 0, 14 passed (1.7 min)**. The slowest test took 10.5 s on an unloaded host, against the 90 s budget. | `e2e-p7.log`, `screenshots/{en,ar}/` |
| 2 | `npx tsc -p apps/web/tsconfig.e2e.json`; `npx eslint apps/web/e2e/p7-*.spec.ts` | exit 0; exit 0 | console |
| 3 | `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| 4 | `pnpm lint` | exit 0 | `lint.log` |
| 5 | `pnpm openapi:lint` | exit 0 | `openapi-lint.log` |
| 6 | `pnpm test` | exit 0. unit-node: 202 files, 2992 tests passed. unit-web: 130 files, 2175 passed. nocodegen: 3 files, 259 passed and 2 skipped (pre-existing skips). | `pnpm-test.log` |
| 7 | `QA_PG_PORT=27583 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` (disposable PostgreSQL) | exit 0, 111/111 | `contract-test-pg.log` |
| 8 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!"; after the last one-line edit of this handback, `npx prettier --check` on this file alone: exit 0 | `prettier-check.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG6` (end) | exit 0, `PASS gate DG6 (historical)` | `validate-historical-DG6-end.log` |

I touched no integration test, so the contract test (row 7) is the only PostgreSQL integration run. No mutation testing was run on the new specs.

**Screenshots** in `T-DG7-FE-D-evidence/screenshots/{en,ar}/` (37 per language). Each screen is captured at 1280 px as `p7-<screen>.png` and at 360 px as `p7-<screen>-360.png`, plus these states:

- `p7-data-export-reason-error`;
- `p7-data-export-requested` (en) and `p7-data-export-refused-in-progress` (ar);
- `p7-config-transfer-exported`;
- `p7-no-permission-*-360`;
- `p7-placeholder-*-360`.

## 4. Known gaps

1. **T-E25 is not satisfied:** the Retention screens of §E.6 do not exist (FE-C gap 1). `p7-retention.spec.ts` checks the placeholders only. T-E25 needs the screens to be built first, by an owner the orchestrator assigns, and then this spec extended.
2. **States not reachable on a fresh stack were not checked in the browser:**
   - a migration import and its reconciliation report with data (imports are made by IT with the CLI; checked only in their 404 state);
   - a *succeeded* migration export with download links (no worker runs in the harness);
   - a *validated* or committable bundle import, and the validate and commit buttons' keyboard path. The import detail was checked as uploaded but not validated, and I did not press Validate.

   These need DO-D's drill environment or a running worker. FE-B gap 1 says the same.
3. **Keyboard depth differs per screen.**
   - A full Tab walk with a visible-focus check at every stop inside `main` ran on Migration status and About.
   - Targeted Tab paths, with every stop checked on the way, ran on Data export, Configuration transfer and the register.
   - The detail screens (export, bundle export, bundle import, requirement detail), identity rebinds and the no-permission states had axe, RTL/LTR and 360 px checks but no separate keyboard walk.
   - "Open the export" in the bundle banner was focused programmatically before Enter. I did not reach it by Tab.
4. **Not measured:** 200 % text zoom (the P6 upload policy spec measures that pattern), screen-reader output beyond axe's accessible-name rules, and contrast beyond axe's `color-contrast` rule.
5. **Budget evidence** is from one unloaded run (worst test 10.5 s against 90 s). No measurement under load was taken.
6. **All P7 Arabic is provisional** (D-243 Q7). These checks prove direction and layout, not the quality of the translation.

## 5. Open questions

1. **Who owns the §E.6 Retention screens?** They are listed under FE-C in `P7_SCREEN_ROUTES`, but FE-C's assignment covered §I.2 only. T-E25 depends on the answer.
2. **Should this spec be added to a CI job?** `apps/web/package.json` `e2e` runs `apps/web/e2e` as a whole, so the new files are picked up by it. I did not edit any CI file (§2 rule 9).

**Merge instructions:** two new spec files and the handback with its evidence. There is no migration, no shared-file edit and no expected conflict.
