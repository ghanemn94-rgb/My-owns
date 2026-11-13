# T-DG7-FE-B handback: the migration and configuration-transfer admin screens (frontend-ux-engineer)

- **Stage:** P7 / DG7 (BUILDING). Engineering work only. No business, Finance or IT approval was granted, and product gate G6 does not imply DG7.
- **Run:** `DG7-T-DG7-FE-B-frontend-ux-engineer-20261113T063732Z-3085f4a8` (session `3085f4a8-f26a-497e-afef-bf5ca8946f34`).
- **Base:** `HEAD` `d75d7b279` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from this run's own `docs/delivery/runs/` folder.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-FE-B.md`, sha256 `ce69f747…c0fc` (checked, it matches).
- **Time:** `date -u` start 06:37:40, end about 07:15 UTC.
- **Order:** the `--historical` DG6 validator ran **first**, before any implementation (`validate-historical-DG6-start.log`, exit 0). It ran again at the end.
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-FE-B-evidence/`.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/web/src/pages/admin/migration/MigrationPages.tsx` (new) | Six screens:<br>• **Data export**: list, the "Request export" form and polling while an export is queued or running.<br>• **Migration export detail**: facts and the two manifest downloads.<br>• **Migration status**: imports plus the identity rebind list, read-only.<br>• **Migration import detail**: facts plus the reconciliation reports.<br>• **Reconciliation report**: per-table counts and digests, with differences first, plus the attachment differences.<br>• **Identity rebind**: list with a state filter kept in the URL. |
| `apps/web/src/pages/admin/migration/ui.tsx` (new) | Shared UI:<br>• status chip tables (each chip has a label and an icon; blue never means favourable);<br>• `UnknownChip`, `Count` (BigInt over the contract's decimal strings, never a float), `Mono` (LTR identifiers and hashes that wrap) and `When` ("Not yet");<br>• `usePollWhile`;<br>• `headerSafeFileName`. |
| `apps/web/src/pages/admin/config-transfer/ConfigTransferPages.tsx` (new) | Three screens:<br>• **Configuration transfer**: export with kinds and a reason; the exports list with download; upload; the imports list.<br>• **Bundle export detail**.<br>• **Bundle import detail**: facts, planned-action counts, the items table with each problem translated, Validate and "Commit as drafts" (both If-Match). |
| `apps/web/src/pages/admin/migration/transfer-screens.test.tsx` (new) | 24 unit tests, EN and AR (described in §3). |
| `apps/web/src/i18n/{en,ar}/transfer.json` (new) | The `transfer` namespace: the §C.8 and §D.2 texts verbatim, plus FE-B's own texts for columns, hints and states. 180 keys in each language. |
| `apps/web/src/i18n/provisional-ar-p7-transfer.ts` (new) | The provisional-Arabic label (D-243 Q7) for every Arabic leaf of `transfer`. Each leaf is marked `work-split` (35 keys, checked against the work split) or `fe-b`. This follows the pattern that §I.2 gives FE-C. |
| `apps/web/src/i18n/index.ts` | Registers the `transfer` namespace: 2 imports and 2 resource lines. **This is a shared file outside my directory list** (see §5 Q1). |
| `apps/web/src/app/router.tsx` | Adds 9 lazy pages and `P7_FE_B_ROUTES`, which gives one element for each FE-B path of `P7_SCREEN_ROUTES`. `P7_PLANNED_ROUTES` is now `P7_SCREEN_ROUTES.filter(owner !== "FE-B")`. `P7_SCREEN_ROUTES` itself is unchanged. This follows FE-A's merge note ("FE-B and FE-C replace their placeholder routes and filter their entries out"). It is FE-A's file. |
| `apps/web/src/app/p7-shell.test.tsx` | FE-A's test, two lines changed:<br>• the planned list is now expected to equal "FE-C's routes only";<br>• the placeholder sample uses four FE-C paths (indices 9, 10, 15, 16) instead of two FE-B ones. |
| `docs/delivery/handbacks/DG7/T-DG7-FE-B-evidence/**` | Logs, the real-stack script `fe-b-shots.mjs`, screenshots and summaries. |

**Not changed:**

- No API, database, migration, `api/**`, `nav.json` or `problems.json` file.
- `apps/api/test/support/p7-pending-be-{c,d,f}.ts` were already empty at base (BE-C, BE-D and BE-F routed all 19 operations), so FE-B had no pending entry to remove.

## 2. Behaviour per requirement

**Common to every screen:**

- Every screen reads, and where allowed writes, the **real API** through FE-A's `api/p7.ts` hooks and `p7Paths`.
- The server decides every permission. The UI's `useCan` checks are hints only.

### REQ-S19-014 / REQ-S19-016: Data export and Migration status (§C.7, §C.8)

**Data export** (`migration.export`):

- **Request.** "Request export" takes a reason that must pass the shared `reason` rule. An invalid reason shows an inline error and sends nothing.
- **Idempotency.** The POST carries an `Idempotency-Key`. A retry of the same submission reuses the key; a new submission gets a new one.
- **Errors.** A 422 `migration.export_in_progress` (or any other problem) appears translated in one form-level alert, and the typed reason is kept.
- **Status.** Each status chip has a label and an icon. A queued or running export is neutral, not green, and the list polls every 5 s until nothing is in progress.
- **Unknown values.** A `null` count, size, checksum, level or environment shows the "Unknown" chip, never 0 (unit-tested; also visible in `screenshots/en/data-export-after-request.png`, which shows 4 Unknown chips).
- **Downloads.**
  - The two manifests are offered only after `succeeded`.
  - They are plain same-origin `<a download>` links, so the browser saves the server's exact bytes.
  - Before success the screen says when they become available. After `failed` it gives the C.5 text and the failure reason.
- **Demo marking.** A demo source is labelled "Synthetic demo data".

**Migration status** (`migration_import.read`):

- **Read-only.** The page carries the `import.cliOnly` note. It has no form and no import or rebind control (unit-tested, and real-stack check `forms: 0`). No POST is ever sent from these screens (§C.11).
- **Imports list.** Each import shows its environment, its latest reconciliation result (matched or mismatched, with label and icon) and its identity counts.
- **Reconciliation report.**
  - Differing tables sort first.
  - Every attachment difference is listed.
  - A missing object's size and SHA show "Not found", never 0.
- **Identity rebind list.** It has a state filter (unbound, rebound or retained) with the C.8 labels, and is also available as its own route.

### REQ-S19-008: Configuration transfer (§D.2, §D.4)

**Export** (`config_bundle.export`):

- **Kinds.** The kinds are checkboxes in a labelled fieldset. They are sent in ADR-0065 order; none ticked means every kind with a published version.
- **Request.** The request carries a reason and `?organizationId=` set to the home organization.
- **List.** Each bundle shows its kinds, item count, environment and a download link.

**Upload** (`config_bundle.import`):

- **Local checks.** A file larger than 5 MiB, a missing file, or a file that is not JSON is refused locally, and nothing is sent. The 5 MiB refusal uses the §D.2 `too_large` text.
- **Request.** Otherwise the file's own bytes go out unchanged (`rawBody`, `application/json`), with `X-File-Name` reduced to printable ASCII, because a header cannot carry other bytes. The import detail then opens.

**Validate and commit:**

- Both send `If-Match` with the import's version.
- A 409 or 422 reloads the import, and its translated text is shown (unit-tested with `plan_changed`).
- "Commit as drafts" is offered only for a `validated` import whose counts show no conflict and no refused item.
- The server makes any conflict or refused item `invalid`, which is terminal. The screen then explains this and offers neither Validate nor Commit.
- Each item's problem code is shown with the §D.2 text.

**Notes always shown:**

- the §D.2 `nonDraftNote`: non-draft kinds are applied as a change, and job schedules arrive disabled;
- "never publishes anything".

**No transfer right:** a caller without either right (for example the auditor) sees the no-permission state, and no `/config-bundles` request is made.

### Bilingual, accessibility and honesty

- **Languages.** All texts are in EN and AR, and RTL and LTR are checked in unit tests and on the real stack. The Arabic is **provisional** and labelled per key.
- **Accessibility.**
  - Every control is labelled, and the tables are captioned with sort, filter, column selection and pagination (RegisterTable).
  - Identifiers are shown left to right inside RTL text.
  - Focus is visible: the keyboard check found a `solid 3px` outline on "Request export".
- **Honesty.**
  - No text names DG0–DG7 or G1–G6, or claims approval or conformity (tested).
  - A "transfer never grants a business, Finance or IT approval" note is shown on the screens.

### Assignment item: "every mutation has a server-side authorization check, validation, optimistic concurrency, audit event"

The mutations these screens call are BE-C's and BE-F's, with their own tests (T-C6, T-D1…T-D5). This run made no server-side change. The client sends what each operation needs: `Idempotency-Key` for an export, `If-Match` for validate and commit, `X-File-Name` for an upload.

## 3. Checks run (real exit codes)

**Environment:**

- Node 24.21.0, `MTH_PNPM_OFFLINE=1`, in the agent sandbox with no Docker;
- PostgreSQL from `/usr/lib/postgresql/*/bin` through the repository harnesses;
- Chromium from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.

Logs are in the evidence folder.

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 0 | `node tools/gates/validate.mjs --historical --stage DG6` (at start) | exit 0, `PASS gate DG6 (historical)` | `validate-historical-DG6-start.log` |
| 1 | `pnpm -r typecheck` (final tree) | exit 0 | `typecheck.log` |
| 2 | `pnpm lint` (final tree) | exit 0 | `lint.log` |
| 3 | `pnpm openapi:lint` | exit 0, `965 operations` | `openapi-lint.log` |
| 4 | `pnpm test` | exit 0: unit-node 202 files, 2992 tests; unit-web 128 files, 2157 tests; formula 259 passed, 2 skipped (by design, pre-existing) | `pnpm-test.log` |
| 5 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | exit 0, 111/111 on a disposable PostgreSQL | `contract-test-pg.log` |
| 6 | `pnpm -r build` | exit 0 | `build.log` |
| 7 | `REPO_ROOT=$PWD OUT=… apps/web/e2e/support/with-stack.sh node fe-b-shots.mjs` (final) | exit 0, `30 checks, 0 failed` | `screenshots-run.log`, `screenshots/summary.json` |
| 7a | the same script, run 1 | exit 1, 2 of 30 failed | `screenshots-run-1-script-defect.log`, `screenshots-run-1-summary.json` |
| 7b | the same script, run 2 | exit 0, 30/30 | `screenshots-run-2-before-text-fix.log`, `screenshots-run-2-summary.json` |
| 8 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" | `prettier-check.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG6` (at end) | exit 0, `PASS gate DG6 (historical)` | `validate-historical-DG6.log` |

**Why runs 7a and 7b are not the evidence:**

- **Run 7a (script defect).** The script evaluated the "downloads not ready" condition of the export detail before that page had rendered. The screenshot shows the correct state. The fix evaluates checks after the heading renders.
- **Run 7b (stale text).** Run 2 was built before I corrected `bundle.invalidNote`, so run 3 (row 7) is the evidence.

**Unit tests:** `transfer-screens.test.tsx` has 24 tests, and all pass (they are also counted in row 4). They cover:

- request export with a reason and an Idempotency-Key;
- an invalid reason sends nothing;
- 422 `export_in_progress`;
- Unknown, never 0;
- manifests offered only after success, with failed and running states;
- Migration status read-only, with the rebind filter in the URL;
- reconciliation differences and "Not found";
- the auditor's no-permission state;
- kinds in contract order with the organization;
- a 5 MiB + 1 file refused with no request;
- upload headers;
- `invalid` blocks Validate and Commit;
- Validate and Commit with If-Match `"3"` then `"4"`;
- `plan_changed` reload;
- the helpers;
- key-set parity, provisional labels, exact work-split texts, and no gate or claim words.

**Real-stack interaction checks (`fe-b-shots.mjs`, run 3).** These ran with the SYNTHETIC user `dev.admin` (ADM_ACCESS + ADM_TECH), in `en` and in `ar`:

- **Data export.**
  - The keyboard path to "Request export" works: focus is `solid 3px`, and Enter submits.
  - A real export was requested. In the ar pass, a 422 `export_in_progress` was accepted as the expected answer, because the en export is still queued.
  - The harness runs no worker, so the export stays **Queued** with 4 **Unknown** chips.
  - Its detail shows "downloads not ready", and no download link.
- **Migration status and Identity rebind.** No form is present, and no write ever went to `migration-imports` or `identity-rebinds`.
- **Configuration transfer, a real round trip in the UI.** Export every kind, download the bundle, upload the same file, then validate.
  - Server result: `invalid`, with 12 refused items, for example `config_review_policy` (ADR-0065 Residual 4) and kinds that dev.admin may not write by hand, such as methodology (T-D5).
  - The other items are `new_draft`, with one `identical`.
  - Commit was correctly not offered.
- **Every screen:**
  - the `<h1>` matches;
  - `html[dir]` and `html[lang]` are right;
  - axe (WCAG 2.0/2.1 A and AA) reports **no violations of any impact** on these screens.
- **Narrow viewport:** at 360 px the Configuration transfer page has 0 px horizontal overflow.
- **Same origin:** no request left the application origin.

**Screenshots** (full page unless noted; English in `screenshots/en/`, Arabic in `screenshots/ar/`, the same file names in both):

- `data-export-before.png`
- `keyboard-focus-request-export.png` (viewport)
- `data-export-after-request.png`
- `migration-export-detail.png`
- `migration-status.png`
- `identity-rebinds.png`
- `config-transfer-before.png`
- `config-transfer-after-export.png`
- `config-bundle-import-uploaded.png`
- `config-bundle-import-validated.png`
- `config-bundle-export-detail.png`
- `config-transfer-360.png`

**Not run:**

- **The Playwright e2e suite.** P7 e2e specs are FE-D's (`apps/web/e2e/p7-*.spec.ts`).
- **Integration tests other than the contract test.** This run touched no integration test.

## 4. Known gaps

1. **Not shown on the real stack** (no worker runs in the harness, and a fresh installation has no import):
   - a *succeeded* migration export, with its download links;
   - an import with its reconciliation report;
   - a committable bundle import.

   Those states are covered only by unit tests against the contract shapes. A screenshot of them needs DO-D's drill environment.
2. **Downloads use plain links.** If the session ends exactly between page load and the click, the browser saves the 401 problem JSON as the file instead of showing the sign-in page.
3. **The Arabic is provisional.** No qualified reviewer has checked it (D-243 Q7). Every leaf is labelled in `provisional-ar-p7-transfer.ts`, and 35 keys are the work split's exact text.
4. **`LoginPage.tsx` `KNOWN_LOGIN_ERRORS` still lacks `identity_unbound`** (BE-D handback gap 4, a request to FE-A or FE-B). The file is outside my directory list, so I did not change it. As a result, an unbound user's sign-in shows the generic error text, not the §C.5 sentence.
5. **The Administration home cards still do not link the P7 screens.** This is FE-A's gap 1 (server `navigation.ts`), unchanged. The sidebar entries do link them.
6. **One dead branch.** The import detail's "validated but not committable" banner cannot occur with the current server, which makes such an import `invalid`. It is kept as a defensive branch.

## 5. Open questions

1. **Shared files edited outside `pages/admin/{migration,config-transfer}/**`:**
   - `i18n/index.ts`: namespace registration is required for the §C.8 `transfer.json` the work split assigns to me.
   - `app/router.tsx` and `app/p7-shell.test.tsx`: the route swap that FE-A's merge note hands to FE-B.
   - `i18n/provisional-ar-p7-transfer.ts`: the per-namespace label file, following the pattern §I.2 gives FE-C.

   I ran alone, so no edit collided with another task's. Please confirm these, or move them to the orchestrator's merge.
2. **Should the `identity_unbound` login text (gap 4) be assigned to FE-A, or merged by the orchestrator?** The change is one array entry in `LoginPage.tsx`.
3. **`createdBy` is not shown.** Both the migration export and the bundle carry it only as a uuid, and no display name is in the contract. Is a name needed on these screens? Adding one would be a contract change.

**Merge notes:**

- No migration, and no ordering constraint.
- FE-C will change the `P7_PLANNED_ROUTES` filter line in `router.tsx`, and the p7-shell placeholder test again, when its screens land.
