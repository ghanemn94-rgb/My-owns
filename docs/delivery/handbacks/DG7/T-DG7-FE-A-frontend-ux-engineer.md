# T-DG7-FE-A handback: the web shell with every P7 route (frontend-ux-engineer)

- **Stage:** P7 / DG7 (BUILDING). Engineering work only: no business, Finance or IT approval was granted, and product gate G6 does not imply DG7.
- **Run:** `DG7-T-DG7-FE-A-frontend-ux-engineer-20261113T003744Z-8b97931f` (session `8b97931f-9036-492e-9dce-1140dc9af67c`).
- **Base:** `7ef6d40fc6ead35bbedf03e429dcc478fd8f9479` on branch `claude/mobily-transformation-platform-dg6-regate`. The working tree was clean except for this run's own `docs/delivery/runs/` folder.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-FE-A.md` (sha256 `cf83e552…94f7`, checked).
- **Time:** started `date -u` 00:41:38, finished about 01:12 UTC.
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-FE-A-evidence/`.

**What was in scope.** p7-plan §5.1 row FE-A and §5.3 cover the router and nav P7 entries, the P7 API clients, the P7 keys in `nav.json` and `problems.json`, and the page stubs. In `p7-work-split.md` I collected:

- every "Problem codes" table (§C.5, §D.2, §E.5);
- the §I.3 "Problem text" row;
- the §I.1 "Requests to FE-A" list (D-252 O6).

No other section lists requests to FE-A. §M did not exist at this revision.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/web/src/api/p7.ts` (new) | The P7 web seam. `p7Keys` gives query keys per Administration area. `isP7AdminKeyOf` and `useP7AdminRefresh` handle area-scoped refresh. `p7Paths` holds all 33 P7 request paths (operationId in a comment). `P7_OPERATIONS` lists (operationId, method, template) for the parity test. There are read hooks for every GET, and the closed value sets (statuses, actions, kinds, enums) are copied from the contract. No path starts an import or a rebind. |
| `apps/web/src/app/nav.ts` | Adds `P7_ADMIN_READ_PERMISSIONS` and the `P7SubPageId` type. Adds `P7_SUBPAGES` with six Administration entries: Data export, Migration status, Configuration transfer, Retention, Requirement register, About this release. They are appended to `NAV_SUBPAGES`, and the Administration area hint includes the P7 read permissions. Adds the `p7Feature` field and a header comment. |
| `apps/web/src/app/router.tsx` | Adds `P7_SCREEN_ROUTES`, the stable list of the 17 P7 paths (screens and detail paths, with feature and owner FE-B or FE-C). Adds `P7_PLANNED_ROUTES`, which shows placeholders and currently equals the screen list; FE-B and FE-C shrink it. Registers both before the catch-all, and adds the lazy `P7NotAvailablePage`. |
| `apps/web/src/components/P7NotAvailablePage.tsx` (new) | The honest "not available yet" page (`nav.p7.<feature>.title/summary`, `nav.p7.notAvailable*`). It has no data, form or request, following the P6 pattern. |
| `apps/web/src/i18n/{en,ar}/nav.json` | Adds `nav.sub.<id>` and `nav.contents.admin.<id>` for the six entries. Adds the `nav.p7` block: the placeholder title and body, plus a title and summary for each of the 17 features. Titles and intros are the work split's exact texts where it gives them. |
| `apps/web/src/i18n/{en,ar}/problems.json` | Adds `release__register_snapshot_unavailable` (§I.3, EN and AR exact). The other 21 P7 codes (§C.5, §D.2, §E.5) were already present from BE-C, BE-F and BE-G and are now bound by a test (below). |
| `apps/web/src/i18n/provisional-ar-p7.ts` (new) | The provisional-Arabic label (D-243 Q7) for every P7 problem key and every P7 nav text. Each entry gives the Arabic's source: `work-split`, `fe-a` or `be-f`. |
| `apps/web/src/i18n/problems-p7.test.ts` (new) | 8 tests, described in §3 below. |
| `apps/web/src/app/p7-shell.test.tsx` (new) | 11 tests, described in §3 below. |
| `apps/web/src/app/axe-scope.test.ts` | The P6 axe-scope test counted every post-DG5 route as a P6 route, so the new routes failed "lists every route … in p6-axe-screens.ts". P7 routes (`P7_SCREEN_ROUTES`) are now excluded from the P6 scope, because their accessibility scope is FE-D's (`apps/web/e2e/p7-*.spec.ts`, p7-plan row FE-D). A new test checks that every excluded path is registered and is not a DG5 path. |
| `docs/delivery/handbacks/DG7/T-DG7-FE-A-evidence/**` | Logs, screenshots, the screenshot script `p7-shots.mjs` and its summaries. |

**Contents of the two new test files:**

- `problems-p7.test.ts` reads every problem table of `p7-work-split.md` from the file: 22 codes, as 3 + 13 + 5 + 1. It checks:
  - every code has the exact EN and AR text (`{x}` becomes `{{x}}`);
  - the renderer never shows a raw code or placeholder;
  - every provisional entry exists and is Arabic;
  - an entry marked `work-split` is a whole cell of the work split, in both languages;
  - no text names DG0–DG7 or G1–G6, and none claims approval or conformity.
- `p7-shell.test.tsx` checks:
  - the six entries: ids, paths, owners and permission hints, and that labels are unique and match `nav.contents.admin`;
  - all 17 routes are registered before `*`, with EN and AR texts;
  - the placeholders render in EN LTR and AR RTL with no form controls and no P7 request;
  - nav visibility for three permission sets;
  - the 33 operations against the contract (method and path) and against `apps/api/test/support/p7-operations.ts`;
  - the write operations are exactly the 8 non-import ones;
  - path encoding;
  - 17 enum sets against the contract;
  - query-key isolation per area.

Not changed:

- No API, database or migration file.
- No `p7-pending*.ts` file. FE-A owns no pending list, and every entry in those lists belongs to a BE task: only `p7-pending-be-h.ts` still holds `listRequirements`, `getRequirement` and `getReleaseAbout`, which are BE-H's to route.
- `auth.json` `errors.identity_unbound` was already added by BE-D with the §C.5 text in EN and AR, so it was left unchanged.

## 2. Behaviour per requirement

FE-A delivers the shell seams the FE-B, FE-C and FE-D screens build on. It does not complete any register row by itself.

| Requirement / clause | What this run delivers |
| --- | --- |
| REQ-S19-014, REQ-S19-016 (slice C screens, §C.7/C.8) | **Routes:** Data export (`/admin/migration/exports` and detail) and Migration status (`/admin/migration/imports`, import detail, and reconciliation report `…/reconciliations/:id`), both FE-B. Identity rebind is a route only (`/admin/migration/identity-rebinds`), with no nav entry, because §C.7 places the rebind list inside Migration status.<br>**Clients and texts:** the 10 slice C clients and the three `migration.*` problem texts.<br>**Read-only:** the import and rebind side is read-only. No client or route starts an import or a rebind (§C.11, enforced by a test). |
| REQ-S19-008 (slice D, §D.2/D.4) | **Route:** Configuration transfer (`/admin/config-transfer`, export and import detail; FE-B).<br>**Clients:** the 9 slice D clients. Upload uses `X-File-Name`, and validate and commit use If-Match.<br>**Texts:** the 13 `config_bundle.*` problem texts, bound to §D.2. |
| Slice E retention and backup (§E.5/E.6; REQ-S19-0xx rows of slice E) | **Routes:** Retention (`/admin/retention`, class, run, archived records, backup sets; FE-C).<br>**Clients:** the 10 slice E clients. Runs and dry runs use Idempotency-Key, and the class update uses If-Match.<br>**Texts:** the five `retention.*` problem texts, bound to §E.5. |
| REQ-S02-003, REQ-S02-005 (slice I, §I.1 "Requests to FE-A", D-252 O6) | **Nav:** Administration > Requirement register (`/admin/requirements` and `/:reqId`) and Administration > About (`/admin/about`), each visible with `operations.read`. This is tested: `operations.read` alone shows exactly these two P7 entries.<br>**Problem text:** `release.register_snapshot_unavailable` in EN and AR, exact. It says "not available", never empty or 0 (tested).<br>**Clients:** the three slice I clients. |
| Slice B (`getDeploymentStatus`) | Client and key only (`useDeploymentStatus`). No P7 screen is assigned to it in the plan or the work split (§6 Q2). |
| Bilingual / RTL (CLAUDE.md, D-243 Q7) | Every new text exists in EN and AR. Every Arabic text is labelled provisional in `provisional-ar-p7.ts` and checked by a test. Placeholders are rendered and asserted in both directions (unit tests and the real-stack screenshots). |
| Unknown / Stale never 0 or green | The placeholders show no data. `api/p7.ts` passes `null` through unchanged and documents it as Unknown or Unavailable. The enum sets keep `unknown` (storage, worker) and `unmarked` (environment) as their own values. |
| "Every mutation …" (assignment deliverables) | Not applicable to this run, which made no server-side change. The P7 mutations and their authorization, validation, If-Match/Idempotency and audit events are BE-C, BE-F and BE-G's, with their tests. The web clients only document which header each mutation needs. |

## 3. Checks run (exact commands, real exit codes)

**Environment:**

- Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, in the agent sandbox with no Docker;
- PostgreSQL from `/usr/lib/postgresql/*/bin`, run through the repository harnesses;
- Chromium from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (nothing was downloaded).

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 1 | `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| 2 | `pnpm lint` (before the evidence script existed) | exit 0 | `lint.log` |
| 2b | `pnpm lint` (final tree, including the evidence `.mjs`) | exit 0 | `lint-final.log` |
| 3 | `pnpm openapi:lint` | exit 0: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `openapi-lint.log` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG6` | exit 0: `PASS gate DG6 (historical)` | `validate-historical-DG6.log` |
| 5 | `pnpm test` (all three unit projects) | exit 0 | `pnpm-test.log` |
| 6 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` (disposable PostgreSQL) | exit 0: 110/110 | `contract-test-pg.log` |
| 7 | `pnpm -r build` | exit 0 | `build.log` |
| 8 | `REPO_ROOT=$PWD OUT=… apps/web/e2e/support/with-stack.sh node p7-shots.mjs` (real stack, see below) | exit 0: `20 checks, 0 failed` | `screenshots-run.log`, `screenshots/summary.json` |
| 8a | The first run of the same script | exit 1: 2 of 20 failed, because of a defect in my script | `screenshots-run-1-script-defect.log`, `screenshots-run-1-summary.json` |
| 9 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0: "All matched files use Prettier code style!" | `prettier-check.log` |

**Details for some rows:**

- **Row 5 (`pnpm test`):**
  - `unit-node`: 201 files, 2965 tests passed;
  - `unit-web`: 127 files, 2133 tests passed, including the new `p7-shell.test.tsx` (11) and `problems-p7.test.ts` (8);
  - `unit-formula-nocodegen`: 259 passed, 2 skipped. The skips are by design and predate this run.
- **Row 8 (real stack):** the stack was a disposable PostgreSQL migrated with 131 migrations and seeded with the SYNTHETIC dev users. The API served `apps/web/dist` at `http://localhost:3000`, and `/readyz` reported `worker: unknown`.
- **Row 8a (failed first run):**
  - What happened: the keyboard check read the `<h1>` right after the URL changed, before the lazily loaded page rendered.
  - What was not affected: focus had reached the entry with a visible 3 px solid outline, and every per-screen check passed.
  - The fix: wait for the target heading. Row 8 is the re-run.
- **During development:** a mutation check confirmed that the work-split binding test fails when an Arabic label is changed. It failed with `ar nav.sub.requirements: سجل`, and the file was restored afterwards.

**Interaction checks in the real-stack run (`p7-shots.mjs`).** These ran with the SYNTHETIC user `dev.admin` (ADM_ACCESS + ADM_TECH), in `en` and in `ar`. For each of the 8 screens (`/admin` plus 7 P7 paths, including a reconciliation detail path):

- the `<h1>` equals the catalogue title;
- `html[dir]` is `ltr` or `rtl` and `html[lang]` matches the language;
- the `data-p7-feature` placeholder is present;
- axe (WCAG 2.0/2.1 A and AA) reports no violations of any impact on these screens.

Also:

- **Keyboard:** Tab from the top of `/admin` reaches the Retention entry, its focus has a visible outline (`solid 3px`), and Enter opens the Retention placeholder.
- **Same origin:** no request left the application origin.

**Screenshots** (full page unless noted):

- English LTR, in `docs/delivery/handbacks/DG7/T-DG7-FE-A-evidence/screenshots/en/`: `admin.png`, `data-export.png`, `migration-status.png`, `reconciliation.png`, `config-transfer.png`, `retention.png`, `requirements.png`, `about.png`, and `keyboard-focus-retention.png` (viewport).
- Arabic RTL, in `docs/delivery/handbacks/DG7/T-DG7-FE-A-evidence/screenshots/ar/`: the same nine files.

**Not run:**

- The Playwright e2e suite (`npx playwright test apps/web/e2e`). It is not in this assignment's acceptance list, and P7's e2e specs are FE-D's.
- No integration test other than the contract test was touched or run.

## 4. Known gaps

1. **The server navigation catalogue has no P7 items.**
   - `apps/api/src/modules/identity/navigation.ts` (ADR-0049 §9; not FE-A's file) lists no P7 Administration item.
   - Effect: the Administration home's "Configuration" card, which is driven by `GET /me/navigation`, does not link the P7 screens (`screenshots/en/admin.png`). The sidebar entries do show, because `NAV_SUBPAGES` hints at them.
   - Area visibility is unaffected at the seeded role defaults: every role holding a P7 permission (ADM_TECH, ADM_ACCESS, ADM_METHOD, AUD, TO, KDS, TD) already holds a P6 or earlier Administration item.
   - Labels are ready: `nav.contents.admin.{dataExport, migrationStatus, configTransfer, retention, requirements, releaseAbout}` exist in EN and AR, so a server item code can use them unchanged.
2. **The placeholders are not screens.** All 17 P7 routes show "Not available yet" until FE-B (slices C and D) and FE-C (slices E and I) replace them and remove their entries from `P7_PLANNED_ROUTES`.
3. **Axe scope for P7 routes is FE-D's.** These routes were taken out of the P6 axe list. Until FE-D's `apps/web/e2e/p7-*.spec.ts` exists, the only axe evidence for them is this run's 16 screen checks.
4. **The deployment status has no screen** (see §5 Q2).
5. **The Arabic is provisional** and has not been checked by a qualified reviewer (D-243 Q7). Of the Arabic I wrote myself, the sources are as follows:
   - the placeholder detail summaries (`migrationExport`, `migrationImport`, `migrationReconciliation`, `identityRebinds`, `configBundleExport`, `configBundleImport`, `retentionClass`, `retentionRun`, `retentionArchived`, `requirement`, `releaseAbout`) and the `notAvailable*` texts are mine;
   - the `nav.p7.<feature>.title` keys of `migrationExport`, `migrationImport`, `migrationReconciliation`, `configBundleExport`, `configBundleImport`, `retentionClass`, `retentionRun` and `requirement` are mine;
   - every title and intro the work split gives is used verbatim. Each source is recorded in `provisional-ar-p7.ts`.

## 5. Open questions

1. **Server navigation items (gap 1).** Should the orchestrator, or a BE task that owns `identity/navigation.ts`, add six P7 items to the `administration` area? The proposed codes are the nav ids above. The `access` values would mirror `P7_SUBPAGES.requiresAny`:
   - `migration.export`;
   - `migration_import.read`;
   - `config_bundle.export` or `config_bundle.import`;
   - `retention.read` or `backup.read`;
   - `operations.read` (twice).

   The web's `test/navigation-fixture.ts` mirror would follow in the same change.
2. **Deployment status screen.** `getDeploymentStatus` (slice B) has a client but no screen, nav entry or owner in the p7-plan or work split. Is that intended (operator use through the API and `/readyz` only), or should FE-C add it under Administration > Operations or About? If a screen is wanted, it must show `storage: unknown` and `worker: unknown|stale` as such, never as ok.
3. **Path choices.** The work split names the screens but not their URLs except `/admin/requirements` and `/admin/about`. The chosen paths are `/admin/migration/{exports,imports,identity-rebinds}`, `/admin/config-transfer[/exports|/imports/:id]` and `/admin/retention[/classes|/runs|/archived|/backups]`. They match FE-B's and FE-C's directory names (`pages/admin/{migration,config-transfer,retention,…}`). Should FE-B or FE-C need different ones, they change them together with `P7_SCREEN_ROUTES` and the test's expected list.
4. **Label of the About entry.** It is "About this release" / "حول هذا الإصدار" (the §I.3 `about.title`) rather than the bare "About" of §I.1. The shell already has an "About this product" link, so a bare "About" would make two near-identical link names.

**Merge notes:**

- No migration, and no ordering constraint.
- `nav.ts`, `router.tsx` and the four i18n files are FE-A-owned shared files (p7-plan §5.3). Later FE tasks append to them.
- FE-B and FE-C replace their placeholder routes and filter their entries out of `P7_PLANNED_ROUTES`. `P7_SCREEN_ROUTES` stays.
