# Handback T-DG5-FE-D5 (continued by T-DG5-FE-D5B): the demo record badge in form and dialog headers (frontend-ux-engineer)

- **Stage:** DG5 (P5), W22 continuation. **Task:** T-DG5-FE-D5B, the repair task D-167 / D-168. **Requirement:** REQ-S18-001 (ADR-0050 §2 b). **Defect:** QA-E2 D-QA-E2-1 (Medium).
- **Run:** `DG5-T-DG5-FE-D5B-frontend-ux-engineer-20261017T175315Z-f36514b3`, session `f36514b3-0ff3-446f-afbb-098bd48d169e`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-D5B.md`, SHA-256 `428dfc74…5c40` (verified with `sha256sum`).
- **Starting revision:** `HEAD` = `d138d08` (the interrupted run's WIP) on branch `dg5/fe-d5`, parent `f78afff`.
- **Time:** started 2026-10-17T17:53:30Z, ended 18:31:31Z (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0 (`validate-historical-DG4-B.log`).

## Continuation run (T-DG5-FE-D5B)

**Interrupted run.** `DG5-T-DG5-FE-D5-frontend-ux-engineer-20261017T170011Z-06c45b47` was stopped by the session restart at about 17:50Z (exit 143). Its WIP is commit `d138d08`. Its provenance is kept in `docs/delivery/test-evidence/DG5/FE-D5-orphaned/`.

**What I found in `d138d08`:**

- The shared dialog header was done:
  - `Dialog` in `components/Form.tsx` has a new `.dialog__header` row with the title plus `DemoFormBadge`.
  - Every create or edit dialog built on `Dialog` inherits it: `RecordDialog`, `P4FormDialog`, `StudioFormDialog`, `ReasonDialog` and the page-specific dialogs.
- `PageHeader` has a new `demoBadge` prop, and `DemoFormBadge` was added in `components/demo-label/DemoLabels.tsx`.
- 12 page headers had the prop.
- The unit test `components/demo-label/FormHeaders.test.tsx` (40 tests) was written.
- The production-side e2e spec `apps/web/e2e/fed5-demo-form-badge.spec.ts` was written.
- The run had **not** written a handback.
- Logs in the evidence folder:
  - Its last top-level `unit-web-locale-unset.log` holds only the Vitest `RUN` header. That run was cut off by the restart.
  - Its `superseded/` logs are from earlier, pre-final trees.
  - None of these is evidence for the final tree. I moved them unchanged to `T-DG5-FE-D5-evidence/interrupted-run/`, for provenance only.

**What I finished:**

- **Sweep.** I swept every `PageHeader` page with a form or record view and added `demoBadge` to 12 more form or record page headers (listed below).
- **Comment fix.** I fixed a stale doc comment in `DemoLabels.tsx`: it said "`PageHeader form`" but the prop is `demoBadge`.

**What I re-ran.** I re-ran every acceptance check on the final tree, one at a time (D-164). Each log has the `-B` suffix and is listed in the Checks section.

## Changed files (uncommitted, relative to `d138d08`; the WIP commit's own files are listed after)

These are new in this continuation (`demoBadge` on the record or form page header):

| File | Header |
|---|---|
| `apps/web/src/pages/admin/UsersPage.tsx` | user detail and edit (`UserEdit`) |
| `apps/web/src/pages/automation/RulePage.tsx` | automation rule record and edit |
| `apps/web/src/pages/approval-routes/ApprovalRoutesPage.tsx` | one approval route (`ApprovalRoutePage`), not the list |
| `apps/web/src/pages/approval-routes/GateConditionsPage.tsx` | gate conditions (close-condition form) |
| `apps/web/src/pages/cutoff-pack/CutoffPackPage.tsx` | meeting cut-off pack record |
| `apps/web/src/pages/reports/SnapshotPage.tsx` | report snapshot record |
| `apps/web/src/pages/procedure-builder/DefinitionPage.tsx` | procedure definition edit form |
| `apps/web/src/pages/studio/VersionPage.tsx` | Studio configuration version record |
| `apps/web/src/pages/studio/ScoringDefaultsPage.tsx` | scoring defaults form |
| `apps/web/src/pages/branding/BrandingPage.tsx` | branding settings form |
| `apps/web/src/pages/dashboards/RagPolicyPage.tsx` | RAG policy form |
| `apps/web/src/pages/notification-preferences/NotificationPreferencesPage.tsx` | notification preferences form (not the digest view) |

Also changed:

- `apps/web/src/components/demo-label/DemoLabels.tsx`: the doc-comment correction.
- `docs/delivery/handbacks/DG5/T-DG5-FE-D5-evidence/**`:
  - the `-B` logs;
  - the screenshots, re-captured by this run;
  - the interrupted run's logs, moved to `interrupted-run/`.
- This handback.

From the WIP commit `d138d08` (confirmed and kept as is):

- `apps/web/src/components/Form.tsx`: the shared `Dialog` header row (`.dialog__header chip-row`) with the title and `DemoFormBadge`.
- `apps/web/src/components/Page.tsx`: the `PageHeader` prop `demoBadge`. The badge renders in the h1's own block, under the title.
- `apps/web/src/components/demo-label/DemoLabels.tsx`: `DemoFormBadge`, which is `DemoRecordBadge` guarded by the query-client context.
  - Outside the query provider the environment is unknown, so nothing renders (ADR-0050 §1).
- `apps/web/src/components/demo-label/FormHeaders.test.tsx`: unit tests, en and ar.
  - Demo, production, unknown (503) and no provider.
  - For `Dialog`, `RecordDialog`, `P4FormDialog`, `StudioFormDialog`, `ReasonDialog`, `PageHeader demoBadge`, and a list `PageHeader` without the prop.
- `apps/web/e2e/fed5-demo-form-badge.spec.ts`: the production refusal path.
  - No badge or banner in the edit page header, the create page header, or the Diagnose › "Add baseline" dialog header.
  - Escape closes the dialog and focus returns to its opener.
  - axe checks run on both screens.
- `demoBadge` page headers:
  - `admin/OrganizationsPage.tsx` (organization edit, business unit edit);
  - `transformations/TransformationCreatePage.tsx` and `TransformationEditPage.tsx`;
  - `financial-metrics/FinancialMetricsPage.tsx`;
  - `health-check/HealthCheckPage.tsx`;
  - `kpi-restatement/KpiRestatementPages.tsx` (both pages);
  - `launch-plan/LaunchPlanPage.tsx`;
  - `procedures/InstancePage.tsx`;
  - `updates/OwnerUpdatesPage.tsx`.

**Page headers deliberately left without the badge:**

- List, hub and picker pages, such as `RulesPage`, the `ApprovalRoutesPage` list, `ProceduresAdminPage`, `MyProceduresPage`, `UsersPage` list, `AssignmentsPage`, `LessonSearchPage`, `ReportsPage` and `Presentation*`.
  - Their create and edit dialogs still carry the badge through the shared `Dialog`.
- `DigestPage`, which is a read-only digest view.
- `Workspace` and `TransformationDetailPage`, which already render the badge themselves.

## Behaviour delivered

**REQ-S18-001.**

- **Acceptance text:** "Demo data lives only in a separately initialized demo environment that never shares a database with production; every demo record carries a synthetic flag shown on screen and in exports; an admin resets the demo environment to the seeded state". A-test: "every demo screen, record and export shows the synthetic label in en and ar".
- **Binding here:** ADR-0050 §2 (b), "every record view **and form header** shows the badge 'Illustrative example — synthetic' / 'مثال توضيحي — اصطناعي'".
- **Demo database.** While `GET /api/v1/environment` answers `synthetic: true`, these show `[data-state='demo-record']` with the catalogue text in en and ar:
  - every dialog header built on the shared `Dialog`, which covers all create and edit dialogs;
  - the 24 form or record page headers listed above.
- **Production database.** On `synthetic: false`, an unknown or failed read, or outside the provider, nothing renders.
- **Status cues.** The badge is text, never colour alone. It uses the existing `badge--provisional` token and conveys no favourable status.
- **Not in this task.** Export labels, the banner, approval labels and the reset are not touched here.

## Checks actually run (final tree, one at a time; logs under `docs/delivery/handbacks/DG5/T-DG5-FE-D5-evidence/`)

Before the tests I removed an empty `apps/web/src/.claude/.cc-writes` directory and its empty parent.

| # | Command | Result | Log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` | exit 0, `PASS gate DG4 (historical)` | `validate-historical-DG4-B.log` |
| 1 | `pnpm -r typecheck` | exit 0 | `typecheck-B.log` |
| 1 | `pnpm -r build` | exit 0 | `build-B.log` |
| 1 | `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 | `lint-B.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" | `prettier-B.log` |
| 1 | `pnpm openapi:lint` | exit 0, "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations" | `openapi-lint-B.log` |
| 2 | `npx vitest run --project unit-web` (`LANG`/`LC_ALL`/`LC_CTYPE`/`LANGUAGE` unset) | exit 0, 88 files, 1689 tests passed | `unit-web-locale-unset-B.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-web` | exit 0, 88 files, 1689 tests passed. Includes `FormHeaders.test.tsx` (40 tests) | `unit-web-C.UTF-8-B.log` |
| 3 | `e2e/support/with-demo-stack.sh npx playwright test e2e/a02-demo-labels.spec.ts --workers=1 --project=chromium-en --project=chromium-ar` | exit 0, **6 passed** (1.3m), including "the record badge in FORM headers" in en and ar | `e2e-a02-demo-labels-B.log` |
| 3 | `apps/web/e2e/support/with-stack.sh npx playwright test` on the 10 specs below (en and ar) | exit 0, **80 passed** (11.2m) | `e2e-web-touched-pages-B.log` |

**Ports and environment for the e2e runs:**

- Demo run: `E2E_PG_PORT=QA_PG_PORT=23851`, `E2E_API_PORT=23860`.
- Production run: `E2E_PG_PORT=QA_PG_PORT=23852`, `E2E_API_PORT=23861`.
- Both: `MTH_PORT_POOL=23870-23899` and `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.

**Specs in the production-stack run (tests per spec, en + ar):**

| Spec | Tests |
|---|---|
| `fed5-demo-form-badge` | 2 |
| `journeys` | 18 |
| `p5-launch-health-kpi` | 6 |
| `p5-procedures-automation` | 12 |
| `p5-reports-exports` | 10 |
| `fed3-automation` | 4 |
| `p5-snapshot-page` | 2 |
| `p5-studio` | 4 |
| `p5-reader-branding-demo` | 8 |
| `p4-dashboards` | 14 |

No test failed, retried or was flaky in any run above.

**Observation, not a failure.** Playwright reports the a02 tests at lines 34/104/148. The file has them at 36/115/149. The interrupted run's log showed 36/115/149.

- I checked that `e2e/a02-demo-labels.spec.ts` is byte-identical to `HEAD`. SHA-256 is `8f4c86b2…accc3` for both the worktree and `git show HEAD:`.
- `--list` shows the same 34/104/148, so the offset comes from Playwright's transform and source mapping, not from an edited spec.
- I did not edit root `e2e/**` or `tests/qa/**`.

**Not run (D-164):** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. These are for the orchestrator's merged-tree verification.

### Visual evidence (D-162: my own specs only)

- **Demo stack**, written by the a02 spec through `QA_EVIDENCE_DIR`, in `a02-demo-labels/{en,ar}/`:
  - `labels-edit-form-header.png`: the badge under "Edit transformation" / its ar title;
  - `labels-create-dialog-header.png`: the badge beside the "Add baseline" dialog title, RTL in ar;
  - the spec's other screenshots: `labels-record-header`, `labels-gate-approval`, `labels-finance-queue`.
- **Production stack**, in `fed5-production/{en,ar}/`:
  - `fed5-production-edit-form-header.png`, no badge;
  - `fed5-production-create-dialog-header.png`, no badge.
- **Interaction checks run** (in `fed5-demo-form-badge.spec.ts` and a02):
  - Clicking "Add baseline" opens the dialog, with the right accessible name.
  - Escape closes it and returns focus to the opener.
  - axe passes on the edit page and on the open dialog, in en and ar.
  - No foreign (CDN) requests.

## Operations routed (pending-list delta)

None. This task adds no API operation and reads only the existing `GET /api/v1/environment` (getEnvironment). No `p5-pending-*.ts` or `p5-exercises-*.ts` file changed.

## Contract, schema or dependency needs

None. No new dependency, no schema change and no new i18n key: it reuses `playbookP5.demo.recordBadge` in en and ar. No problem code is added.

## User-facing texts made untrue

None found. No en or ar string says the form badge is planned or unavailable. I searched for `recordBadge`, "form header" and planned or later wording in the demo namespaces.

## What remains / known gaps

- **The `interrupted-run/` folder.** It holds logs of the interrupted run. They are provenance only, not evidence. The orchestrator may drop the folder if D-162 sizing prefers it.
- **The WIP commit.** `d138d08` is a commit made for the interrupted run (D-158 procedure). My own changes are on top of it and **uncommitted**, as the assignment asks. I did not rewrite the WIP commit; the orchestrator integrates both.
- **The scope of the badge on dialogs.** Every dialog built on `Dialog` shows the badge in a demo database. That includes confirm-style dialogs (`ReasonDialog`), because the shared header is the single place (the assignment's preference). If ADR-0050's owner wants the badge on create and edit dialogs only, `Dialog` would need an opt-out prop. I have not done that.
- **Untracked files I did not create or touch.** The worktree root holds `.bashrc`, `.profile`, `.idea`, `.vscode`, `.mcp.json`, `CLAUDE.local.md` and similar files. They are not part of this change.

## Merge instructions

- No migrations.
- The page edits are single appended `demoBadge` lines in `PageHeader` props.
- Conflicts are unlikely, because BE-T5 owns `packages/shared`, `apps/api`, `apps/worker` and `packages/db/src/demo`. I did not touch them.
