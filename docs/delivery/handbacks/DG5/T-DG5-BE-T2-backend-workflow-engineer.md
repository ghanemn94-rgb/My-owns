# T-DG5-BE-T2 handback: the guided walkthrough (backend-workflow-engineer)

- **Stage:** P5, gate DG5 (BUILDING). Task T-DG5-BE-T2, p5-work-split §J.4. Wave W16 (D-161).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-T2-backend-workflow-engineer-20261016T162435Z-cd19e2a3","session_id":"cd19e2a3-767c-4dc5-a67c-c084ad60de29"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-T2.md`, sha256 `66b5f52ef36dc0f620b9cbbfe05ab4c1d9338db9b4dcd38c090d4e8bc3b6464f` (checked with `sha256sum` before reading).
- **Base:** branch `dg5/be-t2` at `f534d20` ("DG5 W16 assignments: BE-T2, BE-G2 (D-160 c), FE-E, FE-F (D-161)"). Changes are **uncommitted**, as asked.
- **Time:** start `2026-10-16T16:24:50Z`, end `2026-10-16T18:05:53Z`. That is about 1 h 42 min; I stopped at the ~100-minute mark, as the assignment asks (`date -u` at both).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)`, exit 0, before any edit, and again at the end (§3).
- **Engineering agent only.** The walkthrough reads records; it grants nothing. In a demo database every "approved G4 decision" or "Finance-validated measurement" a step reads is a synthetic demonstration decision by a demo user. It approves nothing real (M0412). Product gates G1–G6 are business approvals inside the product. Product G6 never implies DG7, and nothing here reads or writes DG0–DG7.

## 1. Files changed

| File | Status | Purpose |
|---|---|---|
| `apps/api/src/modules/admin/walkthrough.ts` | new | `getDemoWalkthrough` (`GET /api/v1/demo/walkthrough?transformationId=`). It holds the twelve ADR-0050 §7 completion rules as read-only SQL predicates, the per-step web routes, and the contract mirrors `demoWalkthrough`/`demoWalkthroughStep`. All twelve reads run in one read-only, repeatable-read snapshot. |
| `apps/api/src/modules/admin/environment.ts` | edited (my call line, after BE-S) | Adds one import line and appends `...registerWalkthroughRoutes(app, deps)` to the return line of `registerEnvironmentRoutes`. This is §J.4's "one call line"; the import is the minimum it needs. |
| `apps/api/test/integration/environment/walkthrough.test.ts` | new | Integration tests against a real PostgreSQL (scratch demo and production databases in the disposable cluster): 16 tests (§2). |
| `apps/api/test/integration/contract/p5-exercises-be-t2.ts` | new | Contract exercise of `getDemoWalkthrough`: the 409, 400 and 401 in the shared (production) database through `mirrored`; the 200 (with and without a transformation) and the 404 in a scratch demo database through `call`. |
| `apps/api/test/integration/contract/contract.test.ts` | edited (+5 lines, my seam) | Imports and runs `exerciseP5BeT2Operations` and spreads `P5_MIRRORS_BE_T2`, which is empty, for the reason given in the exercise header. This follows the BE-I2/BE-F2/BE-L2/BE-Q2 precedent of wiring one's own seam (D-155 (2)). |
| `apps/api/test/support/p5-pending-be-t2.ts` | edited | `getDemoWalkthrough` routed, so the list is now `[]`. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-T2-*` | new | This handback and its evidence logs. |

No migration, no contract change, no zod mirror in `@mth/shared`, no dependency and no web file.

## 2. Behaviour delivered

### REQ-S18-004: the backend part, met; the row completes with FE-G and QA-E (§J.7)

Acceptance (requirements.csv): "An in-app guide leads demo users through the twelve steps, each performed with native workflows on the demo data". A-test: "A02: an e2e test performs all twelve walkthrough steps with the demo role users and verifies the resulting records". The in-app guide screen (`pages/walkthrough/**`) is FE-G's, and A02 is QA-E's (§J.6). This task delivers the API that the guide reads. §J.4's two literal tests are below.

**`GET /api/v1/demo/walkthrough`** (session; ADR-0050 §7–§9):

- **Response.** It returns the twelve `walkthrough_step` rows (`0090`) in ordinal order: `code`, `ordinal`, `titleEn` (the M0349 text, verbatim), `titleAr` (provisional), `areaCode` (ADR-0049 §9), `route` and `completed`. It also returns `completedCount` and `total: 12`. The body is parsed through the contract mirror before it is sent.
- **`completed`.** It is evaluated on every read from the transformation's persisted records. The guide stores nothing and writes nothing: there is no audit event, no outbox event and no row, and the test asserts that the audit count is unchanged.
- **Refusals, in this order:**
  - 400 (strict query: unknown parameter or malformed uuid);
  - 401;
  - **409 `environment.not_demo`** "This is available only in the demo environment." (ADR-0050 §9, exact). This is checked before the transformation, so a production database discloses nothing about its records.
  - 404 when the caller lacks `transformation.read` on the transformation (`requireTransformationRead`). An unknown id gets the same 404, so existence is never disclosed.
- **Without `transformationId`.** Every step is `completed: false`, as the contract's parameter text says ("only step 1 is evaluated (not completed)"). Step 1 routes to `/transformations/new`, and every other step to its area's landing page.
- **With a transformation.** Each route is the transformation's own screen, for example `/transformations/{id}/finance-validations`.

**The twelve completion rules.** The column "Reading" states my interpretation of each ADR-0050 §7 text, for reviewers.

| # | ADR-0050 §7 "done when the transformation has …" | Reading (SQL over this transformation only) |
|---|---|---|
| 1 | "the transformation exists and was created in this demo database (not a seeded record)" | It exists, and no `demo_seed_record` row of type `transformation` registers it. |
| 2 | "a baseline in the DG2 agreed state" | An active `baseline` with `validation_status = 'validated'` **and a current validation** (`validated_record_version = version`). `validateBaseline` says a later edit makes the validation stale; tested. |
| 3 | "an outcome with a linked KPI definition" | A non-archived `outcome` with an active `outcome_kpi`. Outcomes are created `draft`, and requiring `active` would miss a newly defined outcome; found by the test. |
| 4 | "a target-state canvas cell and a TOM gap" | A `tom_canvas_cell` with `target_design`, **and** a non-archived `tom_gap`. Either alone is not enough; tested. |
| 5 | "a scored initiative and an approved G4 decision (synthetic)" | An `initiative_score` with a score, **and** a `gate_decision` with `gate_code = 'G4'` and `outcome = 'approved'`. |
| 6 | "an owner update and an adoption measurement" | A `submitted` `owner_update`, **and** an adoption measurement per ADR-0033: a submitted/accepted KPI actual of a KPI that an active `adoption_metric_link` measures, or a `completed` training record, or a non-withdrawn proficiency observation. |
| 7 | "a submitted KPI actual" | A `kpi_actual` in `submitted` or `accepted` with `submitted_at`. A draft or a rejected actual does not count. |
| 8 | "a Finance-validated benefit measurement (synthetic)" | A `validated` `benefit_measurement` with an `approved` `finance_validation` of it. A submitted measurement is not enough; tested. |
| 9 | "a resolved executive decision" | `decision.kind = 'executive'` with `status = 'decided'`. An open ask does not count; tested. Deferred and cancelled are not resolutions. |
| 10 | "a generated report snapshot" | A `report_snapshot` in `generated`, `issued` or `superseded`. A discarded one does not count; tested. |
| 11 | "an accepted BAU handover" | `bau_handover.status = 'accepted'`. A submitted handover does not count; tested. |
| 12 | "a KPI actual or control check dated after the handover's acceptance" | A submitted KPI actual whose `submitted_at`, or a performed (`passed`/`failed`) control check whose `performed_at`, is later than an accepted handover's `accepted_at`. A check performed before the acceptance does not count; tested. |

An unknown `completion_rule` in the catalogue fails loudly (500). It is never shown as done or not done.

**§J.4's literal tests** (`walkthrough.test.ts`):

- **"On a fresh demo database the twelve steps are incomplete for a new transformation."** The demo database is migrated and seeded through `seedDemo` with the synthetic test dataset, which holds no transformation. A transformation is then created **through the API** (`POST /transformations`, the P2 world). Step 1 is complete, because the transformation itself is step 1's record, and steps 2–12 are all `false` (`completedCount` 1). A final test repeats this after every other workflow in the file has run in the same database. It shows that each rule reads only the given transformation.
- **"Each step's rule becomes true after the native workflow writes its record."** For each of steps 2–12, the step is read `false`, its workflow is performed through the product API by the role that performs it, and the step is read `true`:
  - 2: TL creates a baseline, still false, then FIN validates it. A later PATCH makes it false again.
  - 3: TL creates an outcome, a KPI definition and the T02 link.
  - 4: TL sets a canvas cell's target design, still false, then creates a TOM gap.
  - 5: WL scores an initiative, still false, then the Sponsor records the G4 decision.
  - 6: WL submits an owner update, still false. BO creates a training record, still false, then completes it.
  - 7: the KPI owner submits the period's actual.
  - 8: BO submits a measurement, still false, then FIN approves the validation.
  - 9: TL raises an executive ask, still false, then its owner records `decided`.
  - 10: a generated snapshot is true; once it is discarded the step is false; a new generation makes it true again.
  - 11: WL submits the handover, still false, then the receiving owner (BO) accepts it.
  - 12: a control check is performed *before* the acceptance and does not count. After the acceptance, TO creates a control, the worker's scan creates its check, and BO records it as passed.
- **Two prerequisites are staged by existing shared test fixtures**, exactly as `gates/g4.test.ts` and `portfolio/*` stage them:
  - for step 5, the G1–G3 statuses, the `mobilize` phase and the G4 *submission*, with their audit events;
  - for steps 8, 11 and 12, the `seedBenefitWorld`/`seedSustainmentWorld` transformations, written with `createTransformationRow`, plus the ownerless control of `draftHandover`.

  The **step's own record** is in each case written by the native API workflow: the Sponsor's G4 decision, FIN's validation decision, and the receiving owner's acceptance. The full twelve-step journey with the demo role users is A02 (QA-E).
- **"Production gives 409 `environment.not_demo`."** This is tested in an unmarked database (production, fail-safe) for TO, TL, AUD and ADM_TECH, with no transformation, a real one and an unknown one: 409 with the exact text, and the audit count unchanged. The contract exercise repeats it.
- **Also tested:**
  - the twelve verbatim M0349 titles, the codes, the ordinals, the areas and both route sets;
  - a seeded transformation, registered in `demo_seed_record` the way `seed-demo` registers it, does not complete step 1;
  - 404 for an outsider (TO of org B), for a user with no grant, and for an unknown id;
  - 400 for a malformed id and for an unknown parameter; 401;
  - AUD reads the walkthrough (session) and nothing is written.

**Shared rules (§2) that apply to a read-only GET:**

- (2) The query goes through `parseQuery` (strict, BE13).
- (3) `config.consumes` is not declared, because the operation has no request body.
- (4) It has no mutation, so `If-Match`, the audit event and the commit-time re-check do not apply. The ADR states that "the guide only explains and links; it writes nothing".
- (6) Titles come from the catalogue in both languages. The problem `code` is the existing i18n key `environment.not_demo`.
- (7) AUD: the operation is a session read and AUD gets 200. It has no write to refuse.
- (13) Tests use only scratch databases of the run's disposable cluster, on harness ports 23401–23449.
- (14) The seam is moved and exercised.
- (15) The refusal uses BE-S's `environmentRefusals.notDemo()`, the exact ADR-0050 §9 code and text.

## 3. Checks actually run

Environment: Node 24.21.0, offline, worktree `/home/user/wt/dg5-be-t2`. PostgreSQL is a disposable cluster from `tests/qa/support/with-pg.sh` on ports 23401–23449. Four W16 tasks were running concurrently, so the machine was loaded. Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-T2-evidence/`.

**Final code** (after the §3 D refactor). Every row below ran on the tree as handed back.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start, and end) | exit 0, `PASS gate DG4 (historical)`, both times | `00-validate-dg4-start.log`, `09-final_validate_dg4.log` |
| 2 | `pnpm -r typecheck` | exit 0 | `09-final_pnpm_-r_typecheck.log` |
| 3 | `pnpm -r build` | exit 0 | `09-final_pnpm_-r_build.log` |
| 4 | `pnpm lint` | exit 0 | `09-final_pnpm_lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" | `09-final_prettier.log` |
| 6 | `pnpm openapi:lint` | exit 0 | `09-final_pnpm_openapi_lint.log` |
| 7 | `QA_PG_PORT=23420 MTH_PORT_POOL=23421-23449 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/environment/ apps/api/test/integration/contract/contract.test.ts apps/api/test/integration/navigation/` | exit 0. **4 files, 121/121**: contract 83, walkthrough 16, environment (BE-S) 14, navigation 8 | `09-final_integration_targeted.log` |
| 8 | `npx vitest run --project unit-node apps/api/src/architecture.test.ts` (the test my first version broke; see D) | exit 0, 139/139 | `08-architecture-test-after-fix.log` |
| 9 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE npx vitest run --project unit-node` | **exit 1: 2250 passed, 2 failed, both timeouts** (see C) | `09-final_unit_node_unset.log` |
| 10 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-node` | **exit 0, 136 files, 2252/2252** | `09-final_unit_node_cutf8.log` |

**Earlier runs, kept as disclosed evidence.**

| Command | Result | Log |
|---|---|---|
| walkthrough integration test, first run | exit 1, 12/15. Three were real defects of my own, fixed: (a) sign-ins write audit events, so the count is now taken after them; (b) `leadA1` (TL at BU, no inheritance) cannot read a directly inserted transformation, so TO is used; (c) rule 3 required an `active` outcome, but outcomes are created `draft`, so it now requires "not archived". | `01-walkthrough-first-run-3-failures.log` |
| same, after the fixes | exit 0, 15/15 | `02-walkthrough-after-fixes.log` |
| environment/ + contract.test.ts | exit 0, 3 files, 113/113 | `03-environment-and-contract.log` |
| `pnpm test`, locale unset, before the refactor | exit 1: unit-node 2251/2252, with **1 real failure from my code**, `architecture.test.ts` (see D); unit-web 1470/1470; unit-formula-nocodegen 259 + 2 skipped | `05-pnpm-test-locale-unset-prefix.log` |
| `pnpm test`, `C.UTF-8` (the refactor landed while this run was in progress) | exit 1: unit-node 2250/2252, 2 **timeouts** (`architecture.test.ts` 30 s, `pdf.test.ts` 5 s); unit-web 1470/1470; unit-formula-nocodegen 259 + 2 skipped | `06-pnpm-test-c-utf8.log` |
| full `pnpm test:integration` (`QA_PG_PORT=23410`) | **aborted, exit 1**, about 8 min in: Vitest worker `Error: Channel closed` / `ERR_IPC_CHANNEL_CLOSED` (an unhandled rejection in tinypool). No test assertion failed before the abort. | `07-integration-full-aborted-ipc.log` |

**A. Acceptance 1 (static checks):** met. Every command exits 0 on the final code.

**B. Acceptance 2 (`pnpm test` in both locales):** met for every assertion; one locale run carries two load timeouts.
- unit-node on the final code:
  - `C.UTF-8`: **exit 0, 2252/2252** (row 10).
  - Locale unset: 2250/2252. The 2 are the timeouts in C, not assertion failures (row 9).
- unit-web (1470/1470) and unit-formula-nocodegen (259 + 2 skipped) passed in both locales. My change touches neither project.
- So I have no clean `exit 0` for the locale-unset unit-node run under the W16 load. The orchestrator's verification should confirm it.

**C. The timeouts:**
- `apps/api/src/architecture.test.ts` › "every import respects dependsOn…": 30 s test timeout. It is an AST scan of every module.
- `packages/reporting/src/pdf/pdf.test.ts` › "renderPdf: Arabic … right-to-left": 5 s timeout.

Both are the load-timeout files D-160 (d) records ("`architecture.test.ts`, `pdf.test.ts` … load-timeout disclosures"; F-DG4-143 to F-DG4-148). Four tasks were running at once, and the full builds of the other trees were concurrent. The architecture test passes when run alone on the final code (row 8, 139/139). I did not touch `pdf.test.ts` or its module.

**D. My one real unit failure, fixed.** The first version of `walkthrough.ts` broke the ADR-0002 boundary test, for two reasons:
- it imported `../identity/navigation.ts`, which is not identity's public surface;
- it indexed records with non-literal computed keys.

The fix drops the import, which leads to handback §5 Note 1, and uses `Map` lookups. Afterwards: architecture 139/139 (row 8), typecheck, lint and build exit 0, and walkthrough 16/16 (row 7).

**E. Acceptance 3 (the full integration suite):** **not met. The full suite did not complete.** The one full run aborted on a Vitest worker IPC failure under load, which is an infrastructure abort and not a test result. There was no time left in the window for a second full run (about 30+ min under this load). In its place I ran the suites my change can affect, on the final code: contract (the operation seam and pins), environment (mine and BE-S's, which share `environment.ts`) and navigation. That gave 121/121 (row 7).

My change is additive: a new GET route, two new test files, an empty pending list and three seam lines. No other suite imports `admin/walkthrough.ts`. The orchestrator's merged-tree verification has to run the full suite.

**Pinned counts:** none changed (§4).

## 4. Operations routed (delta to my pending list)

- `apps/api/test/support/p5-pending-be-t2.ts`: `["getDemoWalkthrough"]` → `[]` (−1). It is exercised in `p5-exercises-be-t2.ts`:
  - 200 without a transformation, and 200 with one;
  - 404 (outsider);
  - 409 `environment.not_demo`;
  - 400 (×2), 401.
  - Declared but unreachable: 403 (session-only operation; an unreadable transformation answers 404) and 429 (the platform sweep).
- **Pinned counts in `contract.test.ts`:** no change. The operation is a GET with no request body, so the media-type triple stays `[391, 390, 1]`, and the rate-limit floor is unchanged. The contract test passed with the pins as they are (§3).

## 5. Contract, schema or dependency needs (for the orchestrator)

- None blocking. No migration, no new problem code, no dependency.
- **Note 1 (Low).** `identity/navigation.ts` `NAVIGATION_AREAS` (the ADR-0049 §9 area paths) is not on `identity/index.ts`'s public surface, and the architecture test forbids importing it from `admin`. The eleven "no transformation yet" landing paths are therefore stated in `walkthrough.ts` and pinned literally by the integration test. If the orchestrator wants one source, BE-R2's owner could export `NAVIGATION_AREAS` from `identity/index.ts`, and `walkthrough.ts` could derive them. It is not needed for correctness.
- **Note 2 (for FE-G).** `getDemoWalkthrough` has no zod mirror in `@mth/shared`, because slice J has none yet (BE-S's handback says the same). The API's mirrors are exported from `apps/api/src/modules/admin/walkthrough.ts` (`demoWalkthrough`, `demoWalkthroughStep`) and match `docs/api/openapi.yaml` `DemoWalkthrough`/`DemoWalkthroughStep`. FE-G will need a web mirror.
- **Note 3 (for FE-G).** Some step routes point at P5 screens that FE-E is building in this wave: `/transformations/{id}/reports`, which is FE-E's `reports` route. Until that merges, the route opens its "not available yet" placeholder. The route string itself is correct.

## 6. User-facing texts made untrue

None. The only walkthrough texts are FE-G's placeholder entries (`apps/web/src/i18n/{en,ar}/nav.json` `walkthrough`, and the `walkthrough` route in `router.tsx` owned by FE-G). The user-facing guide screen is not delivered by this task; it is FE-G's `pages/walkthrough/**`. So "not available yet" stays true until FE-G ships it. `DELIVERED_P5_SCREENS` (`demo` screen) is also FE-G's to flip. No API text says the walkthrough is planned.

## 7. What remains

- Nothing in §J.4's scope.
- REQ-S18-004 completes with FE-G (`pages/walkthrough/**`, Help > Guided walkthrough, en/ar) and QA-E (A02, the twelve steps end to end with the demo role users), as §J.6/§J.7 plan.

## 8. Merge instructions

- No migration and no ordering constraint. `environment.ts` changes in two lines only: the import, and the return line of `registerEnvironmentRoutes`.
- `contract.test.ts` gains three additive lines next to BE-S's: the import, the mirror spread and the `it`. A union resolves a conflict with another W16 seam.
