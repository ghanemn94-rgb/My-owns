# Handback T-DG5-FE-A (frontend-ux-engineer)

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-A.md` (sha256 `a22eaf63fd1616974ff7ce3950680ccffa98be190b669877a82233e9eb83b5e7`, verified at start); scope D-144 items 1–4.
- **Invocation:** run `DG5-T-DG5-FE-A-frontend-ux-engineer-20261014T022855Z-769413c7`, session `769413c7-0e86-4bb9-b5f0-c9512c6120e1`.
- **Base:** worktree `/home/user/wt/dg5-fe-a`, branch `dg5/fe-a`, `HEAD` `a818587` (D-144). Changes are **uncommitted**, as asked.
- **Time:** start `2026-10-14T02:29:09Z`, end `2026-10-14T03:55:02Z` (`date -u`), about 86 minutes; nothing had to be cut.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0, at the start and at the end (§4).

An engineering agent grants no business approval. No product gate G1–G6 and no engineering gate DG0–DG7 is touched. All test and screenshot data is synthetic (seeded dev users and synthetic transformations).

## 1. Changed files

| File | Purpose |
| --- | --- |
| `apps/web/src/app/nav.ts` | P5 navigation. Playbook and Procedures, Risks and Actions, Change and Adoption and BAU and Improvement go from `planned` to `partial`, because their DG4 screens exist. `P5_SUBPAGES` adds 17 P5 sub-entries, each with its owner FE task. `AREA_CONTENTS` holds the master prompt §3 contents of the 10 landing areas, with where each one lives. Administration is also shown to the methodology administrator (`methodology.configure`/`methodology.publish`). |
| `apps/web/src/app/router.tsx` | `landingRoutes` (one landing page per non-working area) replaces `placeholderRoutes`/`entryRoutes`. `P5_PLANNED_ROUTES` has 43 routes: the 17 sub-entries plus 26 record and transformation-scoped P5 routes, each rendering `P5NotAvailablePage`. |
| `apps/web/src/pages/AreaPages.tsx` | `AreaLandingPage` shows the §3 contents with an Available or Not available yet chip (icon plus text, neutral colours), the workspace tabs, delivered screens and P5 screens, then the transformation picker and the cross-portfolio note. `P5NotAvailablePage` is the honest placeholder. `AreaEntryPage` was refactored onto the shared picker and note; its behaviour is unchanged. `AreaPlaceholderPage` was removed, since no area is planned now. |
| `apps/web/src/api/p5.ts` (new) | `p5Keys`, `isP5KeyOf`, `useP5Refresh`, `useStudioRefresh`, `p5Paths` (all 72 slice A–C operations, with the operationId in a comment), and 37 read hooks. |
| `apps/web/src/i18n/{en,ar}/nav.json` | Adds the P5 blocks `landing`, `contents`, `sub.<17 P5 ids>` and `p5` (two placeholder texts plus 39 feature titles and summaries). Removes `plannedBody`, which no area renders any more (see §6). |
| `apps/web/src/i18n/{en,ar}/problems.json` | 73 problem keys, covering every refusal code of ADR-0039 §13, ADR-0040 §8, ADR-0041 and ADR-0042. The English text is the ADR's English `detail` exactly. Existing keys are unchanged. |
| `apps/web/src/app/p5-shell.test.tsx` (new) | 30 tests: the §3 content lists and their order (en and ar), every landing page in en and ar, the 43 placeholders in en and ar, nav permission hints, the 72 paths checked against `openapi.yaml`, and the P5 query keys. |
| `apps/web/src/i18n/problems-p5.test.ts` (new) | 5 tests: an ADR table scan, en equal to the ADR detail, ar is Arabic and differs from en, the three codes BE-A named rendered through `problemText`, and no `DG0–DG7` in the texts. |
| `apps/web/src/app/app.test.tsx` | The planned-area tests are replaced. Risks and Actions now shows its §3 contents and no area has a "Planned" tag. The pins on `portfolioPlanned`/`willContain` are kept, `plannedBody` is pinned as gone, and the planned-card heading level changes from 3 to 2. |
| `apps/web/e2e/journeys.spec.ts` | The shell journey's "planned area" step becomes an area-landing step (the §3 contents of Risks and Actions, three Available chips, no "Planned" tag in the nav). Screenshot `03-area-landing`, axe `area-landing`. |
| `apps/web/e2e/p3-seams.spec.ts` | "What this area covers" is now a level-2 heading on the landing page. |
| `apps/web/e2e/p5-shell.spec.ts` (new) | Real-API e2e: all 10 landing pages (axe and screenshot each), a placeholder opened from a landing page, the P5 nav entries, and the Administration P5 entries with the Branding placeholder. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-A-*` | This handback and its evidence. |

No other file is changed: no API, database, contract, schema, `Shell.tsx`, admin page or style file.

## 2. Behaviour delivered, per requirement row

### REQ-S03-007 (the 14 areas)

The acceptance texts this row is tested against:

- Row text: "The shell shows the fourteen areas with their source-defined contents; areas and items the user cannot access are hidden server-side."
- Acceptance: "A01;A12;A20: an ADM sees 14 areas in en and ar; a Workstream Lead does not see Administration; each area's landing page lists the contents named in §3."

**What is delivered:**

- **The 14 areas, in en and ar.** An administrator still sees 14 areas (`app.test.tsx` "shows all fourteen areas"; e2e `journeys` "administration screens", 14 `a[data-area]`). The Transformation Office sees 13 (e2e and `p5-shell.test.tsx`).
- **No Administration for a Workstream Lead.** Unchanged (`app.test.tsx` "hides Administration from a Workstream Lead"). WL holds neither `methodology.configure` nor `methodology.publish`.
- **"Each area's landing page lists the contents named in §3."**
  - Each of the 10 areas that is not itself a working screen opens `AreaLandingPage`. Its card "What this area covers" lists every §3 item (M0103–M0112) in §3's order.
  - Each item states where it lives: a tab in each transformation's workspace, a screen of the product (Portfolios, Approvals, Finance validation, Lesson search, shown with their permission hint), or a P5 screen marked "Not available yet" with a link to its placeholder.
  - `p5-shell.test.tsx` "lists exactly the contents §3 names for each area, in its order, in en and ar" splits the English §3 sentence of each area and requires the labels to equal its parts. The Arabic labels must be the parts of the Arabic §3 sentence, in order.
  - Each area is rendered in en and ar (20 tests), and the real-API e2e checks all 10 pages in chromium-en and chromium-ar.
  - The other four areas (My Work, Executive Overview, Transformations, Administration) are working screens whose own pages show their contents. Their pages are not mine, except that I added the Administration P5 sub-entries.
- **"Hidden server-side": not delivered by this task.** The navigation filter here is a UI hint, as before. `GET /api/v1/me/navigation` is slice I's backend (p5-plan §1.2: "hidden server-side (`GET /me/navigation`)"), and it is not in the contract yet: `openapi.yaml` has 724 operations covering slices A–C only. See §7.
- **Planned texts corrected (p5-plan §3 row 18; F-DG4-160).**
  - The four areas that were labelled "Planned" have delivered DG4 screens, so the tag and the old `nav.plannedBody` claim ("this page shows no data") were untrue for them. The areas are now `partial`, with real landing contents.
  - The remaining "Planned" card says only that the cross-portfolio view is for a later release (`nav.entry.portfolioPlanned`, unchanged and pinned). That is still true at this merge.

### REQ-S03-010, the shell part

p5-plan §1.2 maps the row to slice I (the reader is FE-G's, and launch is slice C's service). The shell part delivered here:

- the nav entry "Playbook reader" (`/playbook/reader`) and the record route `/playbook/reader/:blockRef`, both honest placeholders owned by FE-G;
- the Playbook and Procedures landing item "Searchable source", shown as Not available yet with a link to the reader;
- "My procedures" (`/playbook/procedures`, FE-D) and the procedure instance route `/playbook/procedures/:instanceId`;
- the client for `launchProcedureInstance` and the procedure instance reads (`p5Paths.procedureInstances` and others).

Not delivered by this task, and judged later: "searching 'value pools' returns the Diagnose blocks; the 'Launch' action … creates a procedure instance" (FE-G, BE-Q and BE-R, plus slice C's BE-F2).

### D-144 item 1: nav entries and honest placeholders for every P5 area and screen

- **Each assignment item is reachable from the navigation:**
  - Administration: Studio, methodology migrations, source coverage, form builder, procedures (procedure builder), automation, approval routes, branding, demo.
  - My Work: notification preferences.
  - Evidence and Reports: reports and exports, presentation.
  - Playbook and Procedures: launch plan, health check, reader, and procedures (my procedures).
- **Records and transformation-scoped screens are registered as routes.** That covers a configuration version and its review, scoring defaults, review policies, revision proposals, a transformation's migrations, migration and pins, a form schema, a procedure definition, methodology coverage, a procedure instance, an automation rule and the failure queue, a transformation's reports, snapshot, exports, presentation, owner updates, launch plan, Day-90 test and health check, health schemes, KPI restatement, formula preview, financial metrics, a reader block and the walkthrough. A work-item link or a link from a later screen therefore never lands on "page not found".
- **Each placeholder is honest, in en and ar.**
  - Its title and summary say what the screen is for. A `role="note"` block (`data-state="being-built"`) says "Not available yet: This screen is part of the current release and is being built. It is not available yet: it shows no data, and nothing here can be used." The Arabic is "غير متاح بعد: هذه الشاشة جزء من الإصدار الحالي وهي قيد البناء…".
  - It renders no form, table or input, and makes no request beyond the session.
  - All 43 placeholders are tested in both languages (`p5-shell.test.tsx`), and `/playbook/reader` and `/admin/branding` in the real-API e2e.
- **Replacing a placeholder.** The owning FE task replaces the element and removes its row from `P5_PLANNED_ROUTES`; owners are recorded per row. Its landing-page `p5` reference in `AREA_CONTENTS` should then move to `tabs`/`links`.

### D-144 item 2: API client functions and query keys for the slice A–C operations

- **Coverage.** `p5Paths` covers all 72 operations. `p5-shell.test.tsx` reads the slice A–C operation list from `apps/api/test/support/p5-operations.ts` (72) and requires a test case for each. Each path must equal the `openapi.yaml` template with the parameters filled. Code and key segments are URI-encoded.
- **Read hooks.** There are 37 read hooks for the GET operations. Writes are sent by the screens through `api.send` inside `auth/sessionBound.ts`, as with `api/p4.ts`.
- **Typing.** Bodies mirrored in `@mth/shared/schemas` today (`studio.ts`: `ConfigVersion`, `ConfigElement`, `ConfigPin`, `ConfigPinHistoryEntry`) are typed. The other mirrors (`studio-checks.ts`, `studio-coverage.ts`, `studio-review.ts`, `methodology-migrations.ts`, `scoring-defaults.ts`, forms, procedures) are `export {}` stubs or do not exist yet. Their hooks take the body type as a parameter (default `unknown`), so a screen cannot assume a shape the contract has not fixed.
- **Keys.**
  - Transformation keys are `["p5", area, tid, …]`, refreshed for that transformation only (`isP5KeyOf`).
  - Studio keys are `["p5","studio",…]`, refreshed by `useStudioRefresh`.
  - Procedures keys are `["p5","procedures",…]`; personal keys are `["p5","me",…]`.

### D-144 item 3: the 14 area landing pages

See REQ-S03-007 above.

### D-144 item 4: en/ar `problems.json` keys

- **Coverage.** There are 73 keys, one per refusal code of ADR-0039 to ADR-0042 (`config_version.weights_total` appears in two ADRs with the same text). That includes BE-A's three: `config_version.draft_exists`, `config_version.not_editable` and `config_version.unknown_element`.
- **The guard.** It scans the ADR files themselves, in both row formats, so a new row without a key fails. The English text must equal the ADR detail exactly (shared rule 15).
- **One Arabic wording to note.** The `config_version.weights_total` Arabic avoids the dual "معيارين", because the glossary guard refuses any "معياري" substring.

## 3. Interaction checks run (UI)

- **Unit, scripted API.**
  - Each landing page in en (LTR) and ar (RTL): h1, `dir`, the "What this area covers" h2, the order and labels of items, the chip text and `data-availability` per item, the P5 links' `href`, the transformation link into the area's workspace tab, and the cross-portfolio note.
  - Each of the 43 placeholders in en and ar.
  - ADM_METHOD sees Administration and the Studio entries, and the entry is `aria-current="page"` on `/admin/studio`. An organization admin without `methodology.read` sees no Studio entries. The Transformation Office sees 13 areas plus the Playbook P5 entries, in ar.
- **e2e, real API and PostgreSQL, chromium-en and chromium-ar.**
  - The Transformation Office walks all 10 landing pages, with axe and a screenshot each.
  - It clicks "Playbook reader" from the "Searchable source" item, reaches the placeholder, and checks the note text and that there is no form or table.
  - The administrator opens Branding from Administration and gets the placeholder.
  - Requests stay on the app origin, and no `DG0–DG7` string appears.
- **Accessibility.**
  - Chips carry text plus an icon, never colour alone, and use the neutral `lifecycle-chip` styles, never a status colour.
  - Every link has its visible name. Headings go h1 → h2 → h3 (h3 only on the sub-entry pages).
  - axe ran on every page in both languages: 0 serious or critical. The `journeys` and `p3-seams` axe summaries record 0 violations of any impact (19 + 11 pages per language). `p5-shell.spec.ts` asserts 0 serious or critical but does not persist its minor-impact list (disclosed here).
- **Screenshots** (`docs/delivery/handbacks/DG5/T-DG5-FE-A-evidence/screenshots/{en,ar}/`):
  - `p5-area-{playbook,strategy,tom,initiatives,governance,risks,benefits,change,evidence,bau}.png`
  - `p5-placeholder-reader.png`, `p5-placeholder-branding.png`
  - `03-area-landing.png`, `02-my-work.png` (nav with the P5 entries), `11-admin.png`
  - `p3-area-{initiatives,benefits}.png`
  - `axe-summary*.json`

  I inspected `en/p5-area-playbook.png`, `ar/p5-area-evidence.png` and `ar/p5-placeholder-branding.png` myself; layout and mirroring are correct. The other journey screenshots were deleted after the run to keep the evidence small (D-138); the run regenerates them.

## 4. Checks, with exit codes and counts

Environment: Node 24.21.0 offline; `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; ports 23900–23949. Empty `.claude/.cc-writes` folders inside source folders were removed before the tests (`packages/shared/src/schemas`, `apps/web`, `apps/web/src/i18n`, `apps/web/src/i18n/en`; the harness created them during writes, and all were untracked and empty). The logs are in `docs/delivery/handbacks/DG5/T-DG5-FE-A-evidence/`.

| # | Command | Exit | Result / log |
| --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)`, `validate-dg4-historical-start.log` |
| 2 | `pnpm -r typecheck` | 0 | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | `build.log` |
| 4 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` (re-run at the end: §8) |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 724 operations`, `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` (locale unset) | 0 | unit-node 91 files / **1618** passed; unit-web 71 files / **1385** passed; formula 3 files / **259** passed + 2 skipped by design. `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 1618; 1385; 259 + 2 skipped. `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=23900 MTH_PORT_POOL=23901-23919 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 210 files / **2031** passed, equal to the W2 baseline (D-144). No pinned-count change. `integration.log` |
| 10 | `E2E_SCREENSHOT_DIR=… E2E_PG_PORT=23920 E2E_API_PORT=23921 MTH_PORT_POOL=23922-23949 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p3-seams.spec.ts apps/web/e2e/p5-shell.spec.ts --workers=1` | 0 | **28/28** passed (14 chromium-en, 14 chromium-ar): journeys 9 + 9, p3-seams 3 + 3, p5-shell 2 + 2. axe 0 serious or critical. `e2e.log` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | §8 |

**Unit-web count change.** It went from 1358 (D-144 baseline) to 1385, a net +27:

- +30 `p5-shell.test.tsx`;
- +5 `problems-p5.test.ts`;
- −8 in `app.test.tsx`: the per-planned-area loop of 4 areas × 2 locales has no planned area left, and the per-area landing checks moved to `p5-shell.test.tsx`.

**Failing intermediate runs, disclosed.**

- While developing, the first `pnpm typecheck` failed on `app.test.tsx`, which still read `nav.plannedBody`. A second failure came from `p5-shell.test.tsx` index-signature access (TS4111). Both were fixed before the recorded runs.
- One run of `src/i18n` failed `glossary.test.ts` on the Arabic `config_version.weights_total` ("معيارين" contains "معياري"). The text was reworded, and the recorded runs above are green.
- No recorded run failed, flaked or timed out.

Some of my long waits were moved to the background by the tool's 10-minute command limit. These were only `until grep exit=` polling loops; the test commands themselves were not interrupted.

**Load.** The 1-minute load average was 10 to 17 during the unit runs, from other agents, and about 2.6 during the e2e run.

## 5. Operations routed: delta to the pending list

None. This is a web-only task. FE-A routes no API operation and has no `p5-pending-*.ts` or `p5-exercises-*.ts` file, so `contract.test.ts` and the pending lists are unchanged (integration 2031/2031).

## 6. User-facing texts this work made untrue, and what I did

| Text | Why untrue after this change | Action |
| --- | --- | --- |
| The `nav.areas.*` "Planned" tag (`nav.planned` rendered by `Shell.tsx` for `availability: "planned"`) on Playbook and Procedures, Risks and Actions, Change and Adoption, BAU and Improvement | These areas have delivered DG4 screens. | The areas are now `partial`, so the tag is no longer shown (pinned in unit and e2e tests). `nav.planned` itself stays: it is used for the cross-portfolio card and by `AdminHomePage`. |
| `nav.plannedBody` (en, ar): "…so this page shows no data…" | No area renders the planned page any more, and every landing page now shows data. | Removed from both catalogues; `app.test.tsx` pins its absence. |
| `nav.entry.portfolioPlanned` | Still true: no cross-portfolio view ships in this merge. | Kept and pinned. |
| `admin.plannedSections` (en, ar): "Methodology, forms, workflows, automation and branding settings are planned for later releases." | These are P5 screens of this release (Studio, form builder, procedures and approval routes, automation, branding), so "later releases" is already inexact. They stay "not available yet" until FE-B…FE-G merge. | **Not my file** (`apps/web/src/i18n/*/admin.json`, `pages/admin/AdminHomePage.tsx`). **For the owner (FE-B, or the orchestrator):** reword it now, e.g. "Methodology, forms, workflows, automation and branding settings are being built in this release; they are listed under Administration in the navigation." Then remove it as the screens ship. BE-A's note said it stays until FE-B. |
| `gates.notEnabledBody`, `transformations.laterStage` | Not changed by this work. FE-R11 justified them as unreachable or true in DG4, and nothing here changes that. | None. |

## 7. Needs for the orchestrator, and what remains

1. **Server-side hiding (REQ-S03-007 "hidden server-side").** `GET /api/v1/me/navigation` is not in the contract. It belongs to slice I's architecture (ARCH-06) and backend (BE-R per p5-plan §5.2 W11), with FE-G or an FE-A follow-up wiring the shell to it. Until then the nav filter is a UI hint, as in DG1–DG4. The row cannot be judged complete before that.
2. **`AdminHomePage` for ADM_METHOD.** Administration is now shown to ADM_METHOD, so that the Studio entries are reachable. `pages/admin/AdminHomePage.tsx` still renders the no-permission state for a user without `ADMIN_PERMISSIONS`. The sub-entries work, but `/admin` itself shows "no permission" to ADM_METHOD. **For FE-B (owner of the Studio screens) or the orchestrator:** show the methodology section there for `methodology.read`/`methodology.configure`. I did not edit it, because it is outside my ownership.
3. **Shell tag for placeholder sub-entries.** `Shell.tsx` is not in my ownership. The P5 sub-entries carry no "not available yet" tag in the navigation; their pages say so. If the orchestrator wants a tag in the nav, `NavSubPage.p5Feature` is there for `Shell.tsx` to read: one line, owner to be decided.
4. **Work-item link paths for the backend.** BE-B3 (`config_review`) can link to `/admin/studio/versions/:versionId/reviews/:reviewId` or `/admin/studio/versions/:versionId`. BE-C (`gate_reapproval`) links to the existing `/transformations/:id/gates/:gateCode`. Slice C step work items can link to `/playbook/procedures/:instanceId`. All are registered now.
5. **Contract, schema or dependency needs:** none. No new dependency was used.
6. **Later FE tasks.** FE-B…FE-G replace their `P5_PLANNED_ROUTES` rows and move their `AREA_CONTENTS` `p5` entries to delivered (`tabs`/`links`). They add clients for slices D–K in their own `pages/<feature>/api.ts` (D-144). Missing keys go through their handbacks.
7. **Merge notes.** These are web-only files and need no migration. The expected overlap is none: BE-B and KBE-B touch no web file, and ARCH-03 writes architecture documents. `p5-shell.test.tsx` reads `apps/api/test/support/p5-operations.ts` but does not edit it. It takes the ARCH-01 and ARCH-02 blocks, ending at the next `// T-DG5-` block marker or at the end of the set. When ARCH-03 appends its block, the slice A–C count therefore stays 72.

## 8. End of run

From `end-of-run.log` and the re-run logs, after the last edits:

- **A test-only edit after the full unit runs.** `p5-shell.test.tsx`'s operation-list parser was hardened (§7 item 7) after runs 7 and 8 of §4. The `unit-web` project was then re-run in both locale settings: `unit-web-rerun-locale-unset.log` and `unit-web-rerun-c-utf8.log`, **1385/1385**, exit 0 each. No product file changed after the e2e and integration runs. Only this test file, the handback and the evidence changed, and `prettier --write` formatted the two `axe-summary*.json` files.
- `pnpm -r typecheck` exit 0; `pnpm lint` exit 0.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`: "All matched files use Prettier code style!", exit 0.
- `pnpm openapi:lint`: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 724 operations`.
- `node tools/gates/validate.mjs --historical --stage DG4`: `PASS gate DG4 (historical)`, exit 0.
- `date -u`: `Wed Oct 14 03:53:05 UTC 2026` (end of the checks); handback finished at 03:55:02Z.
