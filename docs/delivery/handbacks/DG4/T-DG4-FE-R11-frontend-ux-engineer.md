# Handback T-DG4-FE-R11 (frontend-ux-engineer): repair of F-DG4-160 and the 'later release' sweep (D-137)

- **Stage / gate:** DG4 (FIXING after the round-9 audit). Task T-DG4-FE-R11.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-R11-frontend-ux-engineer-20261013T105255Z-53ae7043","session_id":"53ae7043-b2f1-4379-88d9-67a215908e2e"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-R11.md`, sha256 `1653609f25d036692a936f2f22d07622a4978bcac708efcf7c32039007d882cd` (verified).
- **Starting revision:** branch `dg4/fe-r11`, `HEAD` = `e3ab1372eeb7953e0d6ca66ff1039858fa3a8462`. The tree was clean apart from untracked sandbox dotfiles (see "Notes").
- **Time:** started `Tue Oct 13 10:53:07 UTC 2026`, finished `Tue Oct 13 11:28:50 UTC 2026` (about 36 min).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` gave exit 0 (`PASS gate DG3 (historical)`) at the start and again at the end. Logs: `00-…start.log` and `09-…end.log`.
- **Changes are uncommitted**, as the assignment requires.

Product gates G1–G6 are business approvals inside the product. Nothing here grants or implies any business, Finance or IT approval, and a product G6 never implies DG7. All screenshot data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/i18n/en/transformations.json` | `form.statusHint` (line 88) reworded: closure happens on the Closure page once G6 (Sustain) is approved and the closure conditions are met. |
| `apps/web/src/i18n/ar/transformations.json` | The same change in Modern Standard Arabic (line 88). |
| `apps/web/src/i18n/en/nav.json` | `plannedBody` (6), `willContain` (7) and `entry.portfolioPlanned` (83) reworded (sweep, item 2). |
| `apps/web/src/i18n/ar/nav.json` | The same three keys in Arabic. |
| `apps/web/src/pages/transformations/transformations.test.tsx` | Adds a `STATUS_HINT` constant with literal EN and AR text. The catalogue test pins both with `toBe` and adds negative checks (no 'later release' / 'إصدار لاحق'). It checks for the Closure tab label and the G6 wording of `closureP4.json`. The rendered edit-page tests (en LTR, ar RTL) assert the literal hint on screen. A stale comment ("G6 arrives in P2+") is corrected. |
| `apps/web/src/app/app.test.tsx` | New pins for `nav.plannedBody`, `nav.entry.portfolioPlanned` and `nav.willContain` in EN and AR. For each of the 4 planned areas × 2 locales, the page is rendered and checked for the literal text, the "What this area covers" heading, the area's sub-entries listed under it in the navigation (what the text claims), and the Dashboards link. One partial area (`/benefits-finance`) is checked the same way × 2 locales. |
| `apps/web/e2e/journeys.spec.ts` | Edit test: the Status hint is visible, contains "Closure page" / «الإغلاق» and G6 (Sustain) / G6 (الاستدامة), and does not contain 'later release' / 'إصدار لاحق'. Adds screenshot `08a-edit-status-hint` and an axe check. Planned-area step: asserts the "What this area covers" heading and the RAID sub-entry in the navigation, and adds an axe check. |
| `apps/web/e2e/p3-seams.spec.ts` | The area-entry step asserts the `portfolioPlanned` paragraph and the `willContain` heading. |
| `docs/delivery/handbacks/DG4/T-DG4-FE-R11-*` | This handback and its evidence. |

No product code, API, contract, schema, migration or OpenAPI file changed. Only `apps/web/src/i18n/**`, web unit tests and `apps/web/e2e/**` were touched. No test was skipped and no assertion was weakened. Existing assertions were kept and made stricter.

### Final strings

| Key | EN | AR |
|---|---|---|
| `transformations.form.statusHint` | Only the allowed next statuses are offered: draft → active; active → on hold; on hold → active. A transformation is closed from its Closure page, once the G6 (Sustain) business approval and the closure conditions are met. | لا تُعرض إلا الحالات التالية المسموح بها: مسودة ← نشط؛ نشط ← معلّق؛ معلّق ← نشط. يُغلَق التحوّل من صفحة «الإغلاق» الخاصة به، بعد اعتماد الأعمال للبوابة G6 (الاستدامة) واستيفاء شروط الإغلاق. |
| `nav.plannedBody` | A cross-portfolio view of this area, with its records across all transformations, is planned for a later release, so this page shows no data. The screens this area already has are listed under it in the navigation. The dashboards under the Executive Overview summarize the transformations you can read. | عرض هذا القسم على مستوى المحفظة كاملة، بسجلاته في جميع التحوّلات، مخطط لإصدار لاحق، لذا لا تُعرض في هذه الصفحة أي بيانات. أما الشاشات المتاحة حاليًا لهذا القسم فمدرجة تحته في قائمة التنقل. وتلخّص لوحات المؤشرات ضمن النظرة التنفيذية التحوّلات التي يحق لك قراءتها. |
| `nav.entry.portfolioPlanned` | A cross-portfolio view of this area, with its records across all transformations, is planned for a later release. The dashboards under the Executive Overview summarize the transformations you can read. | عرض هذا المجال على مستوى المحفظة كاملة، بسجلاته في جميع التحوّلات، مخطط لإصدار لاحق. وتلخّص لوحات المؤشرات ضمن النظرة التنفيذية التحوّلات التي يحق لك قراءتها. |
| `nav.willContain` | What this area covers | ما يغطيه هذا القسم |

**Wording sources.**
- The Closure page tab is `closureP4.tab` ("Closure" / «الإغلاق»).
- The G6 wording follows `closureP4.transformation.closeDescription`: "the G6 (Sustain) business approval" / «اعتماد الأعمال للبوابة G6 (الاستدامة)».
- "closure conditions" sums up that dialog's conditions without restating them.
- The glossary (`docs/analysis/glossary.md:51`) names G6 "G6 - Sustain / البوابة 6 - الاستدامة". The new AR text uses the Closure page's own form, «البوابة G6 (الاستدامة)», as the assignment asks ("match the closure page's own wording").
- "Executive Overview" / «النظرة التنفيذية» and "Dashboards" / «لوحات المؤشرات» are the existing nav labels.

**Provisional-Arabic convention.** It does not apply. The edit page and the area pages carry no `arProvisional` marker. In this codebase the marker is used only for status labels (closure) and source-text labels (decision rights), and none of the changed strings is one of those.

## 2. Behaviour delivered, per requirement row

**REQ-S04-008** (DG4, IMPLEMENTED) "Run the Realize phase procedure and G6 Sustain decision". Acceptance: *"A02;A11: G6 submission without an accepted BAU handover is rejected; product G6 approval changes no engineering DG record"*.
- F-DG4-160 is raised against this row. The behaviour is unchanged. The edit page's Status hint no longer says that G6 is 'available in a later release'. It now says closure is done from the Closure page (`transformations/:id/closure`, `router.tsx:402`) once the G6 (Sustain) business approval and the closure conditions are met.
- The status select still offers no `closed` (`offeredStatusOptions`, unchanged and still tested).
- Related rows whose delivery the old text misstated: REQ-PB-021 ("G6 Sustain …", DG4 IMPLEMENTED) and REQ-S03-003 (closure as a separate status, DG4 IMPLEMENTED). Their behaviour is unchanged.

**REQ-S03-007** (final gate DG5, SPECIFIED; P4 increment) "Provide the fourteen primary navigation areas …". Acceptance: *"A01;A12;A20: an ADM sees 14 areas in en and ar; a Workstream Lead does not see Administration; each area's landing page lists the contents named in §3"*.
- Sweep. The landing pages of the planned areas (Playbook and Procedures, Risks and Actions, Change and Adoption, BAU and Improvement) and the partial areas no longer say an area "is not available yet". DG4 delivers screens in each of these areas (sub-entries in `app/nav.ts` NAV_SUBPAGES), and the dashboards (REQ-S13-001, DG4 IMPLEMENTED; its screen_api names Benefits and Finance and Change and Adoption).
- The cross-portfolio area view itself remains genuinely later: REQ-S03-007 has increments P1–P5 and final gate DG5.
- Each landing page still lists the §3 contents (`nav.areas.<id>.contents`). Only the heading changes, from "What this area will contain" to "What this area covers", because several of those contents are already delivered.

## 3. Sweep table (item 2)

The search ran over `apps/web/src`, case-insensitive: 'later release', 'later stage', 'not available yet', 'coming soon', 'إصدار لاحق', 'غير متاح بعد'. I also searched these variants: 'not yet available', 'not available', 'planned for', 'being built', 'not enabled', 'سيتاح', 'لاحقة', 'غير متاح', 'قيد البناء'. The 'coming soon' search found 0 hits.

| # | Key (EN and AR) | Render site and condition | Reachable for a DG4-delivered feature? | Decision |
|---|---|---|---|---|
| 1 | `transformations.form.statusHint` (`{en,ar}/transformations.json:88`) | `pages/transformations/TransformationEditPage.tsx:274`, the Status field hint. Always shown on `/transformations/:id/edit`. | **Yes.** G6 and closure are delivered in DG4. | **Corrected** (F-DG4-160). Pinned in `transformations.test.tsx` (catalogue `toBe` EN+AR, rendered en/ar) and in e2e `journeys.spec.ts`. |
| 2 | `nav.plannedBody` (`{en,ar}/nav.json:6`) | `pages/AreaPages.tsx:29` (`AreaPlaceholderPage`), routed for every area with `availability === "planned"` (`app/router.tsx:264`): `/playbook`, `/risks-actions`, `/change-adoption`, `/bau-improvement` (`app/nav.ts:78,103,111,113`). | **Yes.** It said "It is not available yet". In DG4 each of these areas has delivered screens under it: Phase steps; RAID (T15), Action register, Corrective actions; Adoption plan (T13); Performance areas, Improvement backlog, Lessons, Lesson search (`nav.ts` NAV_SUBPAGES). The adoption dashboard also belongs to Change and Adoption (REQ-S13-001). | **Corrected.** Now: only the cross-portfolio view is planned (REQ-S03-007, DG5), the existing screens are under the area in the navigation, and the dashboards summarize. Pinned in `app.test.tsx` (literal EN+AR; 4 areas × 2 locales rendered, checking the sub-entries the text refers to) and e2e `journeys.spec.ts` (Risks and Actions). |
| 3 | `nav.entry.portfolioPlanned` (`{en,ar}/nav.json:83`) | `pages/AreaPages.tsx:106` (`AreaEntryPage`, "Planned" card), on the partial areas `/strategy-kpis`, `/target-operating-model`, `/initiatives-roadmaps`, `/governance`, `/benefits-finance`, `/evidence-reports`. | **Partly.** The cross-portfolio *register* of each area is still later (REQ-S03-007, DG5). But the bare sentence implied that no cross-portfolio view exists, while DG4 delivers the executive and Finance dashboards over all readable transformations (REQ-S13-001; the Finance one is named for Benefits and Finance). | **Corrected.** It says what is planned (records across all transformations) and points to the delivered dashboards. Pinned in `app.test.tsx` (literal EN+AR; `/benefits-finance` rendered en/ar) and e2e `p3-seams.spec.ts`. |
| 3b | `nav.willContain` (`{en,ar}/nav.json:7`) | `pages/AreaPages.tsx:30,107`, the heading over `nav.areas.<id>.contents` on both cards above. | **Yes**, the same defect class. "What this area *will* contain" sat over contents that DG4 already delivers (for example "Integrated RAID, corrective actions …"). | **Corrected** to "What this area covers" / «ما يغطيه هذا القسم». Pinned in `app.test.tsx` and both e2e specs. |
| 4 | `gates.notEnabledBody` (`{en,ar}/gates.json:45`) | `pages/gates/GateDetailPage.tsx:220-224`, shown only when `!view.submissionEnabled`. | **No (unreachable in DG4).** `submissionEnabled` is `gate_definition.submission_enabled`, which migrations set true for G1–G3 (0011/0024), G4 (`0026_p3_enable_g4.sql`) and G5/G6 (`0059_p4_enable_g5_g6.sql:14-19`, which also aborts unless both are enabled). No API code writes `gate_definition` (grep of `apps/api/src`: no INSERT or UPDATE). `packages/db/test/integration/catalogue.test.ts:36-47` pins all six as true. | **Kept.** No delivered gate can show it. Configurable gate enabling belongs to Playbook Studio (REQ-S06-004, DG5), which owns this text. |
| 5 | `gates.notEnabled` (`{en,ar}/gates.json:44`, "Not available in this release") | `pages/gates/GatesPage.tsx:122,130-133`, only when `!g.submissionEnabled`. | **No**, for the same reason as #4. | **Kept** (unreachable). |
| 6 | `problems.gate_not_enabled` (`{en,ar}/problems.json:84`, "… cannot be submitted in this release") | Localized problem for API `gate_not_enabled`, thrown only when `!def.submissionEnabled` (`apps/api/src/modules/workflows/gates.ts:687-688`). | **No**, for the same reason as #4. | **Kept** (unreachable). |
| 7 | `transformations.workspace.laterStage` (`{en,ar}/transformations.json:102`) | **No render site.** Grep for `laterStage` across `apps/web/src` and `apps/web/e2e` finds only the two catalogue entries, and nothing builds the key dynamically (no `` `transformations.workspace.${…}` `` lookup). | **No (unreachable).** | **Kept.** Dead text, never shown. Removing it is a separate clean-up outside this text-correction scope. |
| 8 | `admin.plannedSections` (`{en,ar}/admin.json:9`, "Methodology, forms, workflows, automation and branding settings are planned for later releases.") | `pages/admin/AdminHomePage.tsx:36-43`, always shown on `/admin` under a "Planned" chip. | **No: true for DG4.** Every section it names is DG5 scope: Playbook Studio for methodology and forms (REQ-S06-004, REQ-S05-002), workflows (REQ-S10-015), automation (REQ-S12-001/002), branding (REQ-S15-004, REQ-S01-002), all final gate DG5 and SPECIFIED. The DG4 admin additions (Calendar, Jobs) are not named in it. | **Kept** (true). |
| 9 | `problems.access__scope_type_reserved` (`{en,ar}/problems.json:41`, "This scope type is not available yet.") | Localized problem for API `access.scope_type_reserved` (`apps/api/src/modules/access/assignments.ts:84-88`), raised when a role assignment's scope type is not organization, business unit or transformation (`packages/shared/src/constants.ts:50-54` `P1_SCOPE_TYPES`). | **No: true for DG4.** The other scope types (portfolio, workstream, initiative, performance area, forum, record) are reserved. Finer scoping is REQ-S10-002 (increments P1;P6, final gate DG6, SPECIFIED). | **Kept** (true). |
| 10 | `nav.p4.beingBuiltBody` (`{en,ar}/nav.json:113`) | `pages/AreaPages.tsx:119-129` (`P4BeingBuiltPage`), routed only for entries of `P4_PLANNED_ROUTES` (`app/router.tsx:288-302`). | **No (unreachable).** `P4_PLANNED_ROUTES` is empty in DG4: every FE-B…FE-G route was replaced by its real page (the comments at `router.tsx:289-297` say so). The text also does not claim a later release. | **Kept** (unreachable). |
| 11 | `decisionRights.arProvisional` (EN only: "… an Arabic translation of these labels is provisional and not yet available") | Decision-rights screen, the provisional-Arabic notice. | Not a feature-availability claim. It describes the source-text labels (B0099), which is the provisional-Arabic convention. | **Kept** (true). |
| 12 | Data-state 'not available' strings: `kpiP4.notAvailable` / `value_not_available` / `missingReason`, `benefitsP4.missingReason` / `notDelivered` / `not_enabled`, `dashboards.*Unavailable`, `define.previousMissing`, `auth.dev.warning`, the `*_on_behalf_not_supported` problems, `problems.5xx` / `unavailable` (AR «حاول لاحقًا») | Various | Not feature-availability claims. They describe a missing value, a hidden filter, a refused on-behalf decision or a transient outage. | **Kept** (out of the defect class). |
| 13 | AR matches of «لاحق» / «لاحقة» in another sense ('later/downstream'): `traceability.json` (downstream, the Modular "later phase"), `define.json`, `kpi.json`, `businessCases.json`, `benefitFormulas.json`, `dependencies.json`, `capacity.json`, `sustainP4.json` | Various | Not availability claims. | **Kept**. |
| 14 | Code comments: `app/app.test.tsx:206` ("Unknown for data from later stages"), `app/nav.ts:6` ("planned for a later stage") | Not user-facing. | n/a | Not changed. The `nav.ts` file is outside my write scope. The comment describes the planned areas' landing pages, which is still accurate. |

All corrections are text-only. **No string was found that misstates a delivered feature but cannot be fixed by text alone.** One possible exception: the nav tag "Planned" (`nav.planned`, `Shell.tsx:103`) beside the four planned area names. It is true of each area's landing page, and the corrected body text explains it, so I kept it. That is the D-137 trigger condition, and it is not met.

## 4. Checks actually run (final tree)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. Chromium from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Harness ports 26201 (PG) and 26202 (API), pool 26203–26249. Empty `.claude/.cc-writes` dirs in source folders were removed before each test run. Logs are under `docs/delivery/handbacks/DG4/T-DG4-FE-R11-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` | `00-validate-historical-DG3-start.log` (the trailing `exit=0` line was appended from the recorded exit status) |
| 1 | `pnpm -r typecheck` | 0 | clean | `01-typecheck.log` |
| 2 | `pnpm -r build` | 0 | clean | `02-build.log` |
| 3 | `pnpm lint` | 0 | clean | `03-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `04-prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | clean | `05-openapi-lint.log` |
| 6 | `env -u LANG -u LANGUAGE -u LC_ALL -u LC_CTYPE pnpm test` | 0 | unit-node 84 files / **1589 passed**; unit-web 69 files / **1358 passed**; unit-formula-nocodegen 3 files / **259 passed, 2 skipped** (261) | `06-test-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | identical counts: 1589 / 1358 / 259 + 2 skipped | `07-test-C.UTF-8.log` |
| 8 | `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p3-seams.spec.ts --workers=1` (real PostgreSQL + API) | 0 | **24 passed**: chromium-en journeys 9/9, p3-seams 3/3; chromium-ar journeys 9/9, p3-seams 3/3. 0 failed, 0 flaky. axe: 0 serious/critical on every audited page (en 19 + 11, ar 19 + 11), including the new `edit-status-hint`, `planned-area` and `p3-area-benefits`, each with 0 violations of any impact | `08-e2e-journeys-p3-seams.log`, `screenshots/{en,ar}/axe-summary*.json` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` | `09-validate-historical-DG3-end.log` |
| 10 | `npx vitest run src/app/app.test.tsx src/pages/transformations/transformations.test.tsx --reporter=verbose` (apps/web) | 0 | 49 passed. Lists each new or updated test by name | `10-targeted-unit-verbose.log` |

**Disclosures**
- `pnpm test` runs **three** Vitest invocations (unit-node, unit-web, unit-formula-nocodegen), not two. I report all three.
- The 2 skipped tests are pre-existing `it.skipIf(NOCODEGEN)` cases in `packages/shared/src/formula/fuzz.test.ts:600,833`. That project deliberately sets NOCODEGEN, and this change does not touch them.
- An earlier full pass of checks 1–8 ran on a near-final text that included the clause "and open one transformation at a time" in `plannedBody`. All checks passed, with the same counts. I then removed that clause, because Lesson search (`/lessons`, under BAU) works across transformations, so the clause was not true for every sub-entry. Every check in the table was **re-run on the final tree**, and the logs are from that re-run.
- Playwright's list reporter shows line numbers of the transpiled spec, not of the source file.

**Integration suite (acceptance 3).** Not run, and not required. The change is web text and web tests only. It touches no API, contract, OpenAPI, zod schema, migration or database code (`git diff --stat` lists only `apps/web/src/i18n/**`, two `*.test.tsx` files and two e2e specs).

**Why these e2e specs (acceptance 4).**
- `journeys.spec.ts` is the only product spec that drives the transformation edit page (`/transformations/:id/edit`, the 409 test), where `statusHint` renders. It also visits a planned area (`/risks-actions`, `nav.plannedBody` and `nav.willContain`).
- `p3-seams.spec.ts` is the spec that renders the partial-area entry pages (`/initiatives-roadmaps`, `/benefits-finance`), where `nav.entry.portfolioPlanned` and `nav.willContain` render.
- No other e2e spec references these keys or visits these routes. I checked by grep over `apps/web/e2e` for the keys and the area paths. `p4-governance.spec.ts` only visits `/governance/groups`, which is not an area entry page.

**Visual evidence (both languages)**
- `screenshots/en/08a-edit-status-hint.png` and `screenshots/ar/08a-edit-status-hint.png`: the edit page with the new hint, in LTR and RTL.
- `screenshots/{en,ar}/03-planned-area.png`: Risks and Actions, with the new body and the "What this area covers" heading, and the sub-entries visible in the navigation.
- `screenshots/{en,ar}/p3-area-benefits.png` and `p3-area-initiatives.png`: the partial-area entry pages with the new `portfolioPlanned` text.
- I viewed the 08a and 03 screenshots in both languages. The text renders fully and in the right direction, with nothing clipped.
- The other journey screenshots from the run were deleted to keep the evidence small. They do not show changed text.

**Interaction checks actually run.**
- Unit, rendered: the edit page in en (`dir=ltr`) and ar (`dir=rtl`). The select offers only `active, on_hold`, and the literal hint is on screen.
- Unit, rendered: the 4 planned areas × 2 locales. Literal body text; heading level 3; each delivered sub-entry under the area has the expected href; the Dashboards link is present.
- Unit, rendered: `/benefits-finance` × 2 locales.
- e2e, real stack: the edit page hint (visible, contains/does-not-contain checks, axe). Keyboard navigation to Risks and Actions through the skip link and nav link, the planned text, the RAID sub-entry, axe. The partial-area entry text, the heading, axe, and following the link into the workspace tab.

## 5. Contract or schema needs (for the orchestrator)

None.
- Optional, out of my scope: the API's English developer messages still say "… cannot be submitted in this release." (`apps/api/src/modules/workflows/gates.ts:688`, unreachable in DG4) and "Scope type … is reserved for a later stage." (`assignments.ts:87`, true). The web localizes both by problem code, so users never see these English `detail` texts in place of the catalogue.
- Optional, out of my scope: the comment at `apps/web/src/app/nav.ts:6` could mention that planned areas now have sub-entries.

## 6. What remains

- Nothing in this assignment.
- Per D-137, round 10 re-freezes. The reviewers verify the repair, and the release-auditor, who reported F-DG4-160, verifies its closure. I do not close my own finding.

## 7. Merge instructions

- No migrations and no ordering constraints. Integrate the 8 modified files and the handback directory.
- Conflicts are possible only with concurrent edits to `apps/web/src/i18n/{en,ar}/nav.json`, `apps/web/src/app/app.test.tsx` or the two e2e specs. D-004 says I ran alone, so none are expected.

## Notes

- The worktree had untracked files I did not create and did not touch: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`. They look like sandbox or home artifacts. Do not integrate them.
- No business, Finance or IT approval was granted or simulated. "Provisional" brand marks and synthetic data are unchanged.
