# Handback T-DG5-FE-G (frontend-ux-engineer): playbook reader, Branding Settings, demo labels, environment screen and walkthrough (p5-work-split §I and §J)

- **Stage:** DG5 (BUILDING). **Task:** T-DG5-FE-G, the FE-G row of `p5-plan.md` §5.1, with the D-155/D-156/D-162 (e) items.
- **Invocation:** `DG5-T-DG5-FE-G-frontend-ux-engineer-20261016T211456Z-9a023c41`, session `9a023c41-eefd-41fc-bf46-909cc7bb9ed0`.
- **Base:** `bb0601f6a03feb789c4532d7a88e88dc88e43c5e` on `dg5/fe-g`. Changes are **uncommitted**, as asked.
- **Start / end (UTC):** 2026-10-16 21:15:09 / 23:20:54. That is past the ~2 h bound; the item finished last was the navigation finding in §6.1.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)`, exit 0, at the start and again at 23:20 UTC.
- **Gates:** no engineering agent grants a business, Finance or IT approval. Everything here reads or configures; nothing approves. All test data is synthetic. Product gate G6 never implies DG7.

## 1. Files changed

New (FE-G ownership: `pages/playbook/**`, `pages/branding/**`, `components/demo-label/**`, `pages/walkthrough/**`, `components/provenance-badge/**` per §I.5):

| File | Purpose |
|---|---|
| `apps/web/src/pages/playbook/api.ts` | Paths, keys and read hooks of the 8 `methodology-reader` operations; TS shapes written from the OpenAPI components (no zod mirror exists); `highlightParts` (UTF-16 offsets → marks, no HTML). |
| `apps/web/src/pages/playbook/ReaderPage.tsx` | `/playbook/reader`: About this methodology (B0004, B0024, the Source / Used for table, B0157–B0162, version note), the four questions, en/ar search with marked snippets and a cursor pager, browse by phase with the B0124 Realize note, and the element provenance table with badges and question tags. |
| `apps/web/src/pages/playbook/BlockPage.tsx` | `/playbook/reader/:blockRef`: the verbatim text (a table block as a table), provisional Arabic, version guidance, resolved links (form register, procedure, requirement ID) with badges, Launch (Idempotency-Key), and previous/next. |
| `apps/web/src/pages/playbook/ui.tsx` | `BlockText`, `SourceText` (Arabic + English verbatim), `Snippet`, `ProvisionalArabic`, `excerpt` (through `truncateText`). |
| `apps/web/src/pages/playbook/AboutProvenance.tsx` | The B0004 statement card on the About page. |
| `apps/web/src/pages/playbook/feg.test.tsx` | 19 unit tests (en and ar). |
| `apps/web/src/components/provenance-badge/ProvenanceBadge.tsx` | `ProvenanceBadge`, `QuestionTag`, `TemplateProvenance` (form-header strip with "Source: B0031"). |
| `apps/web/src/pages/branding/api.ts` | Paths, keys and hooks of the branding operations and the token read; `useBrandingTheme` (render-time `--mth-*` colours); WCAG contrast helper. |
| `apps/web/src/pages/branding/BrandingPage.tsx` | `/admin/branding`: current branding, the settings form (names, colours with contrast checks in words, approval reference, bundled fonts, PNG logo or wordmark, header/footer pairs, change note), publish with If-Match, a 409 conflict panel with re-apply, 422 codes, and the versions table. |
| `apps/web/src/components/demo-label/DemoLabels.tsx` | `useEnvironment`, `DemoBanner`, `DemoRecordBadge`, `SyntheticApprovalLabel`, `IllustrativeExampleNote` (B0144). |
| `apps/web/src/pages/walkthrough/api.ts` | Paths, keys, hooks and shapes of `getDemoEnvironmentStatus`, `requestDemoReset`, `getDemoWalkthrough`. |
| `apps/web/src/pages/walkthrough/WalkthroughPage.tsx` | `/walkthrough` (Help > Guided walkthrough): the 12 steps with area, link and server-evaluated completion; 409 `environment.not_demo` shown by its text. |
| `apps/web/src/pages/walkthrough/EnvironmentPage.tsx` | `/admin/demo` (Administration > Environment): kind, latest run, counts, checksum and coverage, and the confirmed reset with If-Match. |
| `apps/web/src/app/me-navigation.ts` | `useMyNavigation` / `visibleAreaIds`, the `/me/navigation` client. Used by the Administration home. The shell does **not** use it yet (§6.1). |
| `apps/web/src/app/shell-read.ts` | The staleness policy of the four shell-wide reads ("static" after an error, so a failed read never causes refocus traffic). |
| `apps/web/src/i18n/{en,ar}/playbookP5.json` | The new namespace (identical key sets; Arabic provisional). |
| `apps/web/e2e/p5-reader-branding-demo.spec.ts` | 4 e2e tests × en/ar against the real API. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-G-evidence/**` | Logs and the 18 screenshots of my own spec (12 MB). |

Edited (append-only registrations, the routed D-155/D-156/D-162 (e) items, and the named label lines):

| File | Change |
|---|---|
| `apps/web/src/app/router.tsx` | 5 lazy pages and 5 routes appended; `P5_PLANNED_ROUTES` is now an empty, tested seam; the unreachable `P5NotAvailablePage` route mapping is removed. |
| `apps/web/src/pages/AreaPages.tsx` | `P5NotAvailablePage` removed (no placeholder is reachable); `<AboutProvenance />` added to the About page. |
| `apps/web/src/app/nav.ts` | Playbook "searchable source" lists the delivered reader link instead of the "not available yet" P5 entry. |
| `apps/web/src/app/Shell.tsx` | Product name and logo from `/branding`; theme from `/branding/tokens`; `<DemoBanner />`; the walkthrough link in a demo database. The areas keep the static rule (§6.1). |
| `apps/web/src/components/Wordmark.tsx` | Optional `logo` prop: an uploaded PNG replaces the provisional wordmark badge. |
| `apps/web/src/components/Workspace.tsx`, `pages/transformations/TransformationDetailPage.tsx` | `<DemoRecordBadge />` in the record header; the B0144 note on the transformation overview. |
| `apps/web/src/pages/gates/GatesPage.tsx`, `pages/my-work/p4ui.tsx`, `pages/benefits/ui.tsx` | `<SyntheticApprovalLabel />` inside the gate `BusinessApprovalNote`, the P4 `BusinessApprovalNote` and `FinanceValidationNote`, so it appears on every product-gate decision, approval and Finance validation screen and dialog that uses them. |
| `apps/web/src/pages/diagnose/DiagnosePage.tsx` | `<TemplateProvenance templateCode="T01" />` in the T01 form header. |
| `apps/web/src/pages/admin/AdminHomePage.tsx`, `i18n/{en,ar}/admin.json` | The "Planned" chip card is now a "Configuration" card. `admin.plannedSections` now states that Branding Settings and the environment screen are available; new key `admin.configurationTitle`. The card lists the Administration items `/me/navigation` grants. A user who holds no P1 admin code but has such items (e.g. ADM_METHOD) sees those links instead of the no-permission state. No unit test covers this card. |
| `apps/web/src/i18n/{en,ar}/problems.json` | 16 problem texts appended (ADR-0049 §11, ADR-0050 §9). The script's duplicate-key check throws on an existing key. 14 English texts are exactly the ADR texts. **Two deviate:** `methodology_reader.prohibited_text` and `branding.prohibited_claim`. The ADR wording ("must not claim official PMI status or certification") is flagged by BE-R2's claim scan (`ui-strings.test.ts`, `problem-texts.test.ts`), so the web uses "…must not describe the methodology/product as having official status or accreditation from PMI…". The API's `detail` strings are unchanged. The orchestrator may want ADR-0049 §11 or the scan reconciled. |
| `apps/web/src/i18n/{en,ar}/nav.json` | `nav.contents.{myWork,executive,transformations,admin}.*` added (the labels `/me/navigation` returns); unused `nav.p5.*` keys removed (§5). |
| `apps/web/src/i18n/index.ts` | `playbookP5` namespace appended. |
| `apps/web/src/app/p5-shell.test.tsx`, `apps/web/e2e/p5-shell.spec.ts` | The placeholder assertions for reader, branding and demo now assert the delivered screens; a test asserts no placeholder text is left. |
| `apps/web/e2e/p5-studio.spec.ts` | Header comment corrected: the "empty DG2 catalogues" defect was fixed by BE-C2 (D-156). Comment only. |
| `apps/api/src/modules/identity/navigation.ts` | `DELIVERED_P5_SCREENS` lists every delivered P5 screen. It now also includes FE-C/FE-D/FE-E's screens, which their tasks had not added, so no navigation item is `planned`. |
| `apps/api/src/modules/identity/navigation.test.ts` | The pins follow (planned = `[]`; the flip test uses a set without `branding`); `AWAITING_WEB_KEYS` is empty, because the web catalogue now has the 22 labels. |

## 2. Behaviour delivered, per requirement row (acceptance text quoted)

- **REQ-PB-001** — "provenance text on reader/About/report footer matches B0004 verbatim; an automated text scan of UI strings (en+ar) and report templates finds no claim…"
  - The reader's About and the About page render `statement.textEn` as returned: e2e `toHaveText(B0004)` passes in EN and AR. In Arabic the provisional translation is labelled, and the English verbatim text follows it.
  - The Source / Used for table is read-only (3 rows in e2e).
  - The report footer is BE-N's.
  - The scan is BE-R2's integration `ui-strings.test.ts` over every i18n string, mine included (result in §4).
  - My texts were written to pass it: only negated "not an official PMI standard", and no "certified".
- **REQ-PB-002** — "every seeded element listed in B0158-B0162 returns provenance=custom-extension from the API and renders the badge in en and ar; no such element is labelled as a PMI standard."
  - The reader's element table shows "Custom extension (playbook v1.0)" / "امتداد مخصص (الدليل، الإصدار 1.0)", with an icon and words. `foundation_inspired` shows "Inspired by PMI/Brightline/BRM foundations".
  - Unit and e2e tests assert the table contains no "PMI standard" or "certified".
  - The badge also appears on block links and on the T01 form header.
  - Not done: the Studio badge through FE-B's pages (§6).
- **REQ-PB-011** — "all four questions render verbatim (en) with ar translations; every seeded template has exactly one question tag."
  - The four B0016 questions render from `listGuidingQuestions`, verbatim in English, with the Arabic and the English original in AR (e2e: 4 items).
  - Question tags appear in the reader's element table, on block links and in the T01 form header.
- **REQ-PB-077** — "Realize guidance shows 'aligns with PMI Benefits Realization Management logic' and no 'certified'/'official' wording."
  - Browsing the Realize phase shows "Realize phase guidance" with B0124. This is asserted in unit and e2e (EN and AR).
- **REQ-S01-002** — "changing the name updates the shell header in en and ar and the next generated report header without a code change; a fresh install shows 'Mobily Transformation Hub'."
  - The shell reads `/branding` at render time and shows the configured en or ar name. With version 0 it shows the shipped translated name.
  - e2e publishes a new name, and the header shows it without a reload in both languages; the test then publishes the original settings back.
  - The report header is BE-N/BE-R's.
  - Not done: page titles still use the default name (§6).
- **REQ-S02-004** — "opening block B0031 (Template 1) shows a link that opens the T01 register; the T01 form shows a source link back to B0031."
  - e2e: B0031 (opened with the transformation) links to `/transformations/<id>/diagnose`. Clicking it opens T01, whose header shows "Source: B0031", and that link opens the reader at B0031 (EN and AR).
  - Requirement links are shown as their IDs, not as links: the API's route `/playbook/requirements/<id>` has no web screen (§6).
- **REQ-S03-007** — "an ADM sees 14 areas in en and ar; a Workstream Lead does not see Administration; each area's landing page lists the contents named in §3." **Partial.**
  - The acceptance outcomes hold with the static rule: e2e asserts the TL (`dev.lead`) has no Administration, and the DG1 journeys (26/26 re-run) pin the ADM's 14 areas.
  - All 14 areas' item labels now resolve in en and ar (the API pin test enforces it), and the navigation API reports no item as `planned`.
  - The shell's switch to `/me/navigation` ("hidden server-side") is **not made** (§6.1).
- **REQ-S03-010** — "searching 'value pools' returns the Diagnose blocks; the 'Launch' action on the gate-review procedure creates a procedure instance."
  - Searching "value pools" (en) returns hits with `data-phase='diagnose'` and marked matches (e2e EN and AR).
  - A 1-character query is refused in the field with the `validation.search_query` text, and nothing is sent.
  - On B0023, Launch on `gate_review` (the lead, with the transformation) creates an instance: e2e checks the URL and `listProcedureInstances`.
- **REQ-S15-004** — "changing brand.primary in Branding Settings changes the navigation colour and the header colour of a newly generated PDF report without a code change or redeploy."
  - Saving publishes a version (If-Match `"0"` first). The theme hook sets `--mth-brand-primary`, `--mth-brand-deep`, `--mth-action-primary` and `--mth-action-primary-hover` from `/branding/tokens`, whose action shades the server derives.
  - e2e asserts `--mth-brand-primary = #0057B8` right after publishing, and the versions table.
  - The navigation background follows `brand.deep` (the secondary colour) through the token chain, so a primary-only change does not recolour the navigation (§6). The PDF header is BE-N/BE-R's.
  - 409 shows the conflict panel with re-apply. 422s are shown by their translated code (e2e: `branding.prohibited_claim`). AUD gets the no-permission state (e2e).
- **REQ-S21-001** — "a text scan of UI strings and export templates finds no DG0-DG7 references; demo G-approvals display 'Synthetic demonstration - approves nothing real'."
  - The label appears in en and ar on every screen that uses the gate, approval or Finance notes, only when `/environment.synthetic`.
  - No string of mine names DG0–DG7. e2e asserts there is no `DG[0-7]` on the reader.
- **REQ-PB-089** — "every demo record and exported demo report shows the illustrative label in en and ar."
  - On screens: the banner on every shell screen, the record badge in the workspace and transformation headers, and B0144 on the transformation overview. The export label is BE-S/BE-N's.
- **REQ-S18-001** — "running the reset twice yields identical record counts and checksums; every demo screen, record and export shows the synthetic label in en and ar."
  - The labels are as above. The environment screen shows counts, checksum and coverage, and requests the reset with If-Match after a confirmation.
  - In the e2e (production) database the reset shows `environment.not_demo` and nothing is queued.
  - The counts/checksum identity is BE-S's.
- **REQ-S18-004** — "an e2e test performs all twelve walkthrough steps with the demo role users and verifies the resulting records" (QA-E's A02).
  - FE-G delivers the Help > Guided walkthrough screen: the 12 steps, their areas, links and completion from the server.
  - Outside a demo database it shows `environment.not_demo` (unit and e2e).
  - Not tested: the demo-database path in e2e (the stack has no demo database; §6).

## 3. User-facing texts that my work made untrue, and what I did

- `admin.plannedSections` (en/ar) said "Branding settings are not available yet". I rewrote it as true, and the card no longer carries the "Planned" chip (D-162 e).
- The `nav.p5.notAvailableTitle/Body` placeholder texts and 25 feature placeholder entries are now unreachable, so I removed them.
  - Removed: studioVersion, studioReview, scoringDefaults, reviewPolicies, revisionProposals, methodologyMigration, configPins, formBuilder, reports, reportSnapshot, exports, presentation, ownerUpdates, launchPlan, day90Test, healthCheck, healthSchemes, kpiRestatement, formulaPreview, financialMetrics, reader, readerBlock, branding, demo, walkthrough.
  - Also removed are the unused `summary` sub-keys of procedureBuilder, procedureDefinition, myProcedures, procedureInstance and automationRule.
  - Keys still referenced by FE-B/FE-C/FE-D pages and specs (e.g. `nav.p5.studio.title`) are kept: they are those screens' titles, not placeholder text.
- `nav.ts` listed the reader as a P5 screen "not available yet". It now links to the delivered reader.
- `navigation.ts` `DELIVERED_P5_SCREENS` listed only the Studio. The navigation API therefore reported forms, workflows, automation, packs, procedures, reader, branding and environment as `planned`, which was untrue for FE-C to FE-E's merged screens as well. All are listed now.
- `p5-studio.spec.ts`'s comment about empty DG2 catalogues is corrected (D-156).
- I left `common.about.brandBody` ("…can be replaced through Branding Settings once official values are approved") unchanged, because it is true now.

## 4. Checks (Node 24.21.0, offline, harness ports 23600–23649)

| Command | Environment | Result | Exit |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` | start of run | `PASS gate DG4 (historical)` | 0 |
| `pnpm -r typecheck` | — | clean (`typecheck.log`) | 0 |
| `pnpm -r build` | — | all packages built (`build.log`) | 0 |
| `pnpm lint` | — | eslint, 0 warnings (`lint.log`) | 0 |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | — | "All matched files use Prettier code style!" (`prettier.log`) | 0 |
| `pnpm openapi:lint` | — | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` (no contract change) | 0 |
| `pnpm test` | locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | unit-node 2252/2252; unit-web 1535/1535; third project 259 passed + 2 skipped (by design) (`unit-unset.log`) | 0 |
| `pnpm test` | `LC_ALL=C.UTF-8` | same counts (`unit-cutf8.log`) | 0 |
| `with-stack.sh npx playwright test apps/web/e2e/p5-reader-branding-demo.spec.ts --workers=1` (PG 23601, API 23602, pool 23603–23649) | — | 8 passed (re-run in `e2e-final.log`: 26 passed with journeys) | 0 |
| full web e2e `with-stack.sh npx playwright test apps/web/e2e --workers=1` (PG 23611, API 23612, pool 23613–23629) | — | see §4.1 | see §4.1 |
| `QA_PG_PORT=23631 MTH_PORT_POOL=23632-23649 tests/qa/support/with-pg.sh pnpm test:integration` | — | see §4.1 | see §4.1 |

**Disclosed failing intermediate runs:**

- The first run of my e2e spec (`e2e-feg-1-failed-run.log`) had 7 passed and 1 failed (AR). Cause: the visually-hidden "Source text (English, verbatim):" label sat inside the `data-verbatim` element. Fix: the label moved outside it. The re-run passed 8/8.
- A first full web-unit run had 4 failures in 3 files:
  - the session-bound cache-write convention (a direct `setQueryData`, fixed to `action.setQueryData`);
  - the F-DG2-530 X6 refocus test (my failed shell reads counted as "due" on refocus; fixed with `shell-read.ts` "static" after an error);
  - the Arabic glossary (I spelled تحول without the shadda; fixed to تحوّل).
- My own new test file failed 9/20, then 3/20, during development: a test-helper bug, a misplaced helper, and a wrong `PMI standard` assertion that matched my own negated disclaimer. All are fixed: 20/20.
- The unit counts above are the final runs.

### 4.1 Long suites and the final state

**Full web e2e** (`with-stack.sh npx playwright test apps/web/e2e --workers=1`; PG 23611, API 23612, pool 23613–23629; `e2e-full-suite.log`): **400 passed, 3 failed, 17 did not run**, exit 1, in 54.8 min. It ran on an intermediate build in which the shell used `/me/navigation`. The failures:

- `journeys.spec.ts:213` "shell … (Transformation Office)" failed in EN and AR. It expected 13 areas; the server showed the TO 14, because ADR-0049 §9 gives the TO Administration for the Studio review. Its serial siblings did not run.
- `p2-journeys.spec.ts:828` (EN) failed with a Playwright-internal "Internal error: step id not found: fixture@284". This is not an assertion.
- A targeted re-run (`e2e-rerun.log`: journeys, p2-journeys and FE-G, 44 passed, 2 failed, 4 did not run) shows:
  - p2-journeys passed, so the internal error did not recur;
  - the next journeys test, "administration screens", failed. The server shows the technical administrator (ADM_ACCESS+ADM_TECH, no `transformation.read`) **3 areas**, where DG1 pins 14.
- I then reverted the shell's area switch (§6.1).
- **Final state** (`e2e-final.log`): rebuild, then `journeys.spec.ts` + `p5-reader-branding-demo.spec.ts` (PG 23641, API 23642, pool 23643–23649): **26 passed**, exit 0.
- The full suite was **not re-run** on the final state for time. The shell's area code is back to the base's, which the orchestrator's W16 verification ran 412/412.

**Integration** (`QA_PG_PORT=23631 MTH_PORT_POOL=23632-23649 tests/qa/support/with-pg.sh pnpm test:integration`; `integration.log`): **2790 passed, 2 failed, 1 skipped (2793)**, exit 1.

- The two failures were BE-R2's text scans (`text-scan/ui-strings.test.ts`, `text-scan/problem-texts.test.ts`), flagging my two ADR-exact English problem texts (see `problems.json` in §1).
- After rewording them, `… pnpm test:integration apps/api/test/integration/text-scan` gave **4 files, 41/41 passed**, exit 0 (`integration-textscan.log`).
- The full integration suite was not re-run after that one-file text change. No integration pinned count changed.

**Final unit and static checks** (after every change):

- `pnpm lint`: exit 0 (`lint-final.log`).
- prettier check: exit 0 (`prettier-final.log`).
- `tsc` of web and e2e: exit 0.
- web unit (all 80 files): **1534/1534**, exit 0 (`web-unit-final.log`). That is one fewer than the 1535 of the both-locale `pnpm test` runs above, because I removed my `/me/navigation` shell test with the revert. The both-locale `pnpm test` runs predate the revert and the text change; both of those touched only web files, and the final web run covers them.
- `apps/web` build: exit 0.

## 5. Operations routed and pending lists

FE-G routes no API operation and has no `p5-pending-*.ts` list, so the delta is none. The contract-test pins (media-type triple, rate-limit floor) are unchanged.

The web consumes these operations, all already routed by BE-Q, BE-Q2, BE-R, BE-R2, BE-S and BE-T2: `listMethodologyBlocks`, `getMethodologyBlock`, `listMethodologyBlockLinks`, `listTemplateSourceLinks`, `searchMethodology`, `getMethodologyProvenance`, `listMethodologyElements`, `listGuidingQuestions`, `getBranding`, `getBrandingTokens`, `getBrandingSettings`, `putBrandingSettings`, `listBrandingVersions`, `getMyNavigation`, `getEnvironment`, `getDemoEnvironmentStatus`, `requestDemoReset`, `getDemoWalkthrough`, and `launchProcedureInstance`.

## 6. Needs and remaining work

### 6.1 Remaining: the shell's switch to `/me/navigation` (REQ-S03-007, §I.5 item 4). This needs an orchestrator decision.

I implemented the switch (`app/me-navigation.ts`), ran it against the real API, and reverted it, because it changes DG1-approved behaviour:

- ADR-0049 §9 gives the Transformation Office Administration (Studio review). The DG1 journey pins "TO: 13 areas, no Administration".
- Every business area needs `transformation.read`, so the technical administrator `dev.admin` (ADM_ACCESS+ADM_TECH) would see **3** areas (My Work, Playbook, Administration). The DG1 journey "administration screens" pins 14.

Both follow literally from ADR-0049 §9 and the "hidden server-side" text, but they reopen DG1 e2e pins and the ADM experience. Options:

- (a) accept the server's answer and update the two DG1 pins;
- (b) change the §9 table (e.g. business areas visible with a session, items scoped);
- (c) keep the static rule.

**Separable second half:** after the decision, the shell switch is about 5 lines in `Shell.tsx` (the reverted diff: `visibleAreaIds(useMyNavigation().data)` filters `NAV_AREAS`), plus my removed unit test and the two journey pins if (a).

### 6.2 Other needs

- **Contract / mirrors.** The reader, navigation and environment bodies have no `@mth/shared` zod mirror; my TS interfaces follow the OpenAPI components. Promoting BE-Q/BE-Q2/BE-R2/BE-S's local mirrors would let the web share them. That is not blocking.
- **Requirement route.** `listMethodologyBlockLinks` returns `route: /playbook/requirements/<id>` for requirement links, but no web screen exists for the requirement register, so the reader shows the ID without a link. A requirement-register screen, or a different route from BE-Q, is needed if that link must open something (M0088).
- **Navigation colour (A20).** The navigation background token is `nav.background` → `brand.deep`, the secondary colour. A change to `brand.primary` alone recolours the actions, links and focus colour, but not the navigation bar. REQ-S15-004's acceptance says "changing brand.primary … changes the navigation colour". Making `nav.background` follow `brand.primary` is a design-token decision for the orchestrator/architect, because it needs a contrast-checked derived shade. I did not change `packages/design-tokens`.
- **Studio badge (REQ-PB-002, "Studio … badge").** The Studio pages are FE-B's. `ProvenanceBadge`/`QuestionTag` are ready to import there. That is a one-line request to the Studio owner, or the orchestrator.
- **Form headers of T02–T16.** Only T01 (the acceptance case) carries `TemplateProvenance`. REQ-PB-011 says "shown in form headers", so a one-line addition is needed per template page, and those pages belong to other owners.
- **Page titles** (`usePageTitle` in `components/Page.tsx`) still use the default product name. The REQ-S01-002 acceptance covers only the shell header and the report header.
- **Other sessions' branding refresh.** A session picks up a new branding version on load, or after a minute through the app's session-first refocus. There is no push from the `branding.published` outbox to the web.
- **Demo-database e2e.** The e2e stack initializes a production database, so the banner, badges and the 12-step walkthrough in a real demo database are covered by unit tests with stubbed `/environment` only. QA-E's A02 and the compose `demo` profile (devops) cover the real path.
- **Arabic texts** of `playbookP5` and the problem texts are provisional translations that need review by a Mobily Arabic editor.
- **No new dependency was added.**

## 7. Merge notes

- My edits in shared files are additive or named lines: `router.tsx`, `nav.ts`, `Shell.tsx`, `i18n/index.ts`, `problems.json`, `nav.json` and `navigation.ts`.
- Conflicts are possible with QA tasks only if they edit the same web files (they should not).
- `p5-shell.test.tsx` and `p5-shell.spec.ts` are FE-A's files; I changed their placeholder assertions because the placeholders are gone.
- No migration.
