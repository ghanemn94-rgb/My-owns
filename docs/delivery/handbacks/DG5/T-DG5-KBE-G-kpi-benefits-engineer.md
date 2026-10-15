# Handback T-DG5-KBE-G (kpi-benefits-engineer): health-check scoring functions, the scheme kind provider, questions and schemes

- **Stage:** DG5 (P5 "Configuration automation and outputs"), BUILDING. **Task:** T-DG5-KBE-G, p5-work-split §H.3.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-G.md` (sha256 `8b808bd1…7da9f`, checked at start).
- **Invocation:** `DG5-T-DG5-KBE-G-kpi-benefits-engineer-20261015T210600Z-b4a6f9be`, session `b4a6f9be-8d22-4328-bfed-258d6f4d7d5b`.
- **Base:** branch `dg5/kbe-g` at `278cd1d` (the W12 assignments commit). The changes are left **uncommitted**, as asked.
- **Time:** `date -u` at start: `Thu Oct 15 21:06:14 UTC 2026`; at end: `Thu Oct 15 23:07 UTC 2026` (about 2 h 01 min).
- **Gates.** Nothing here reads or writes DG0–DG7. A health-check score or scheme is an assessment or configuration, never a business approval; no G1–G6 approval was granted. All test data is synthetic.

## 1. Files changed

| File | Purpose |
|---|---|
| `packages/shared/src/health/scoring.ts` (new) | Pure, decimal.js score, band, completion and scheme publish rule. `healthSchemeProblem` mirrors `p5_health_scheme_problem` (same order, same constraint names). `healthAssessmentResult` mirrors `p5_health_assessment_result`: null while incomplete or not computable, never 0. |
| `packages/shared/src/health/contract.ts` (new) | Zod mirrors `healthCheckQuestionList`, `healthCheckScheme`, `healthCheckSchemeList` of the three read bodies (see §5.2). |
| `packages/shared/src/health/index.ts` (new) | Barrel of the two files. |
| `packages/shared/src/health/scoring.test.ts` (new) | 29 unit tests: worked fixtures for every acceptance text, plus seeded property tests (2,000 sets per scheme, 500 monotonicity cases, 1,000 generated schemes). |
| `packages/shared/src/calc.ts` | One appended export line after KBE-F's (§H.6). |
| `apps/api/src/modules/health/routes.ts` | Fills BE-A's stub: the questions and scheme reads. KBE-G2 appends after them. |
| `apps/api/src/modules/health/questions.ts` (new) | `listHealthCheckQuestions`: the 25 `source_element` rows of set `health_question`, verbatim. |
| `apps/api/src/modules/health/schemes.ts` (new) | `listHealthCheckSchemes` and `getHealthCheckScheme` (published only), plus `loadHealthScheme`/`schemeInputOf` for KBE-G2, and the §9 refusal table `HEALTH_SCHEME_REFUSALS`. |
| `apps/api/src/modules/health/provider.ts` (new) | `registerHealthCheckSchemeProvider()`: `defaultKey: "health-check"`, with `validateElement`, `validateRemove`, `preview`, `compatibility`, `affectedRecords` and `migrationItems`. |
| `apps/api/src/modules/health/index.ts` | Re-exports `registerHealthCheckSchemeProvider` for `server.ts`. |
| `apps/api/src/modules/health/health.test.ts` | +2 tests: route registration; every §9 scheme code and exact English text, from the provider and from the database mapping. |
| `apps/api/src/server.ts` | One registration line after BE-P's `registerLaunchPlanPort` line. The existing health import line now also names `registerHealthCheckSchemeProvider` (see §6). |
| `apps/api/src/modules/platform/db-errors.ts` | New `mapP5HealthSchemeError`, with its one call line after KBE-F's financial-metric mapper. |
| `apps/api/test/support/p5-pending-kbe-g.ts` | Now empty (all three operations routed). |
| `apps/api/test/integration/contract/p5-exercises-kbe-g.ts` | Exercises the three operations (200/400/401/404) through `ctx.mirrored`, and lists their zod mirrors. |
| `apps/api/test/integration/health/health-schemes.test.ts` (new) | 7 integration tests: questions and schemes verbatim against `docs/source/playbook.md`; the REQ-S14-003 literal test end to end through Studio; element refusals; the database backstop; affected records and migration items. |
| `apps/api/test/integration/health/health-scoring-db.test.ts` (new) | 2 integration tests: 1,000 generated answer sets against `p5_health_assessment_result`, and 300 generated schemes against `p5_health_scheme_problem`, all in one rolled-back owner transaction. |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-G-*` | This handback and its logs. |

Untracked files at the worktree root that are **not mine** and that I did not touch: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`. They come from the environment.

## 2. Behaviour delivered, per requirement row

My section owns only part of each row (§H.7). KBE-G2 (assessments), FE-F (pages) and QA-D/QA-B complete them.

### REQ-S14-003 (KBE-G part: provider, schemes)

Acceptance: "A16;A07: publishing a scheme that adds N/A without new bands is rejected; existing assessments keep their original scheme version and band".

- **Publishing a scheme that adds N/A without new bands is rejected**, in three layers (`health-schemes.test.ts` › "N/A with the source bands fails its preview…"):
  1. **Preview.** The provider runs the publish rule over the whole draft first. A draft with `na`, `percent_of_applicable` and the four source bands answers **422 `health_scheme.own_bands_required`** with the exact §9 text. No passing preview is recorded, so publish answers 422 `config_version.preview_required`.
  2. **Compatibility.** The sandbox calls a preview hook only when samples are given (`methodology/preview.ts`, not my file). So a preview with no samples passes, but the compatibility run then reports a `fail` finding `health_scheme.own_bands_required`, and publish is still refused.
  3. **Database.** Forcing `status = 'published'` as the owner role is refused by `health_scheme_publish_guard` with constraint `health_scheme_own_bands_required`. `mapDatabaseGuardError` maps it to the same 422 code.
- **"With its own bands and `percent_of_applicable` it publishes"** (the §H.3 literal test). The same draft, with `partial` 0.5, the four source bands removed and four admin bands added, passes:
  - preview, whose samples are scored: 83.33 of 100, band `strong`; 24 answers incomplete with `score: null` and `band: null`; all-N/A not computable; an unknown response fails;
  - compatibility;
  - the TO review (the seeded policy);
  - publish (200).
  `getHealthCheckScheme` then returns its responses and bands, and the base it was drafted from is unchanged.
- **Element-level refusals**, before the database:
  - Yes ≠ "1", No ≠ "0", or removing Yes/No → 422 `health_scheme.yes_no_required`;
  - partial "1" or "0", or N/A with a credit → 422 `health_scheme.credit_invalid`;
  - an unknown response key, or a source band outside B0152 → 422 `config_version.unknown_element`;
  - N/A on `points` → 422 `health_scheme.na_needs_percent` at preview;
  - AUD and a user without `methodology.configure` → 403.
- **"Existing assessments keep their original scheme version and band"** is KBE-G2's part (assessments; A07 with the pin migration). For it, KBE-G provides:
  - `affectedRecords`: per pinned transformation, the count of its **draft** assessments;
  - `migrationItems`: one `invalidated_calculation` item (`resolution: "acknowledged"`, `detail.keepsScheme: true`) per draft assessment, as ADR-0048 §6 / ADR-0040 §2 describe.

  Both are tested against a real draft assessment. Before this task, the kind had no provider, so a `health_check_scheme` migration plan carried the `provider_not_registered` unknown item and could never be `ready`. It now can.
- **Reads:**
  - `listHealthCheckSchemes` lists the published versions of the kind. `getHealthCheckScheme` returns one; a draft, a version of another kind or an unknown id gives 404, and a malformed id 400. Both are for any signed-in user (REQ-S14-003 "view: all signed-in users").
  - **Scheme v1 returns `implementationAssumption: true`.** Its responses are yes "1" and no "0", `points`, `questionCount` 25, and its four bands are equal to the B0152 rows parsed from `docs/source/playbook.md`.

### REQ-S14-001 (KBE-G part: scoring)

Acceptance: "A16: 25 answers with 17 Yes give a score of 17 and the band '16-20'; the scoring method is shown as an implementation assumption in the UI".

- `healthAssessmentResult(v1, 17 Yes + 8 No)` = `{score: "17", scoreMax: "25", bandKey: "b0152_16_20", completion: {answered: 25, total: 25, complete: true}}` (unit test).
- Every split 0…25 gives the count of Yes.
- The 1,000-set database test shows that the database computes the same.
- Scheme v1's `implementationAssumption: true` is the API flag behind the UI notice. The notice itself is FE-F's, and the assessment's `scoringAssumption` is KBE-G2's.

### REQ-S14-002 (KBE-G part: completion)

Acceptance: "A16: an assessment with 24 answers shows 'Incomplete (24/25)' and no band; the API returns band=null".

- 24 answers → `completion {answered: 24, total: 25, complete: false}`, with `score`, `scoreMax` and `bandKey` all `null` (unit test).
- No answers → incomplete, never 0. All N/A → `computable: false`, with no score and no band (ADR-0048 §10 `not_computable`).
- The same holds in the Studio preview samples and against the database (incomplete sets are about 15 % of the 1,000).
- The assessment API's `band: null` is KBE-G2's.

### REQ-PB-092 (KBE-G part: bands)

Acceptance: "A16: scores 21, 16, 10 and 9 map to the four band texts verbatim".

- Scores 21, 16, 10 and 9 map to `b0152_21_25`, `b0152_16_20`, `b0152_10_15` and `b0152_0_9`; the boundaries 25, 20, 15 and 0 stay in their bands (unit tests).
- The band texts served by `getHealthCheckScheme` are byte-equal to B0152 (integration test). The texts on an assessment are KBE-G2's.

### REQ-PB-091 (supporting part only; the row is KBE-G2's)

- "all 25 questions render verbatim": `listHealthCheckQuestions` returns q01–q25 in order. Their `textEn` equals the 25 B0150 cells parsed from `docs/source/playbook.md` (numbers and checkboxes stripped), e.g. "Are 3-5 business outcomes measurable?" with the source hyphen. `sourceRef` is `B0150`, and the Arabic is the provisional translation.

### The §H.3 literal tests

| §H.3 test | Where |
|---|---|
| A draft with `na` that keeps the source bands fails its preview with 422 `health_scheme.own_bands_required` and cannot be published; with its own bands and `percent_of_applicable` it publishes | `health-schemes.test.ts`, describe "REQ-S14-003" (tests 1–2) |
| The 25 questions are returned verbatim; scheme v1 returns `implementationAssumption: true` | `health-schemes.test.ts` (questions and schemes describes); contract exercise |
| The shared functions agree with the database function on 1,000 generated answer sets | `health-scoring-db.test.ts` test 1: 1,000 sets over v1, a partial-credit points scheme and a partial + N/A percent scheme; complete, incomplete and all-N/A sets. Test 2 compares the publish rule on 300 generated schemes, and every one of the 7 outcomes occurs. |

**Negative control.** I temporarily changed the percent rounding in `scoring.ts` to `ROUND_DOWN` and ran the agreement test: it failed at set 20 with "63.23 vs 63.24" (`T-DG5-KBE-G-evidence/negative-control-round-down.log`, exit 1). The file was then restored from a copy, and `grep -c ROUND_DOWN` gave 0.

### Shared rules (§2) as they apply

- **Decimal only.** Credits, `minScore` and scores are decimal strings computed with decimal.js. The band ordering in the read uses Decimal too. The integer-hundredths re-derivation inside the property test is test-only.
- **Unknown is never 0.** Incomplete or not computable gives null.
- **Exact refusals.** §9 codes and texts, with one proposed addition (§5.1).
- **Formula engine unchanged.**
- **No new dependency.**
- **Mutations.** My three operations are reads, so rule 4 applies to no new route of mine. The scheme writes are the existing Studio mutations; my hooks only add refusals inside them, and AUD and non-ADM_METHOD 403 were checked on an element PUT.
- **Deterministic tests.** Seeded generators. The database tests run in a transaction that is rolled back, and the Studio tests use unique keys. No delivery folder is read: the tests read only `docs/source/playbook.md`.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, worktree `/home/user/wt/dg5-kbe-g`. Harness ports: `QA_PG_PORT=24400`, `MTH_PORT_POOL=24401-24449`. Disposable PostgreSQL 16.13 started by `tests/qa/support/with-pg.sh`. Logs are in `docs/delivery/handbacks/DG5/T-DG5-KBE-G-evidence/`; `exit-codes.txt` collects the exit codes.

**Before implementation:**

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` | **0** | `PASS gate DG4 (historical)` | `validate-historical-DG4-start.log` |

**First full pass (21:2x–22:32Z).** These ran on the tree *before* the module-boundary fix described below.

| Command | Exit | Result | Log |
|---|---|---|---|
| `pnpm -r typecheck` | 0 | — | `typecheck.log` |
| `pnpm -r build` | 0 | — | `build.log` |
| `pnpm lint` | 0 | — | `lint.log` |
| `pnpm openapi:lint` | 0 | — | `openapi-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | — | `prettier-check.log` |
| `pnpm test`, locale unset | **1** | unit-node 2039/2040, unit-web 1429/1429, formula-nocodegen 259 + 2 skipped | `first-unit-locale-unset.log` |
| `pnpm test`, `C.UTF-8` | **1** | the same counts and the same one failure | `first-unit-locale-c-utf8.log` |
| `QA_PG_PORT=24400 MTH_PORT_POOL=24401-24449 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | **2443/2444**, 254 files, 2652 s | `integration.log` |

What the three non-zero exits were:

- **Both unit runs:** `apps/api/src/architecture.test.ts` › "every import respects dependsOn, public surfaces…" found **three ADR-0002 violations in my code**:
  - `health.test.ts` imported `../platform/db-errors.ts` instead of `platform/index.ts`;
  - `provider.ts` and `schemes.ts` used a computed member with a non-literal key (`HEALTH_SCHEME_REFUSALS[problem]`).

  **Fixed:** the table is now a `ReadonlyMap` read through `healthSchemeRefusal`, and both test files import `platform/index.ts`. After the fix, `architecture.test.ts` plus the health suite pass, 143/143.
- **Integration:** `methodology/studio-drafts.test.ts` › "an unpinned kind resolves to version 1 of its default key…" failed, with an expected list of 3 pins and 4 received. **This is a consequence of my change, and it is intended by the design.** Registering the provider with `defaultKey: "health-check"` makes an unpinned transformation resolve `health_check_scheme` to v1 (ADR-0048 §5 "else v1 of key `health-check`"; ADR-0039 §3). `getTransformationPins` therefore lists a fourth, unpinned entry. The file is BE-A/BE-D's, not mine, so I did **not** keep an edit to it. See §5.4 for the patch and its verification.

**The full integration run is from the pre-fix tree.** The fix changed only `health/schemes.ts` (Record → Map), `health/provider.ts` (the finding code through `healthSchemeRefusal`), `health/health.test.ts` and `test/integration/health/health-schemes.test.ts` (import paths). It changed no behaviour and no code outside `health/`. I did not repeat the 44-minute full run, because I had reached the time bound. The targeted run below covers every file that changed after it.

**Final tree (after the fix):**

| Command | Exit | Result | Log |
|---|---|---|---|
| `tests/qa/support/with-pg.sh npx vitest run --project integration` on `test/integration/health`, `contract/contract.test.ts`, `methodology/studio-checks`, `studio-review-publish`, `methodology-migrations` | **0** | **126/126**, 6 files | `final-integration-targeted.log` |
| `studio-drafts.test.ts` with the §5.4 patch applied temporarily, then restored (sha256 checked, empty `git diff`) | 0 | 18/18 | `proposed-patch-studio-drafts-verify.log`, `proposed-patch-studio-drafts.diff` |
| `npx vitest run --project unit-node apps/api/src/architecture.test.ts apps/api/src/modules/health` | 0 | 143/143 | (console; re-run inside the full unit runs below) |
| `pnpm test`, locale unset (run while the full integration run was going) | **1** | unit-node 2039/2040: `architecture.test.ts` **timed out at 30 s** (35.3 s, load average 12–17); unit-web 1429/1429; formula 259 + 2 skipped | `final-unit-locale-unset.log` |
| `pnpm test`, `C.UTF-8` (same load) | **1** | unit-node 2039/2040 (the same 30 s timeout); unit-web 1427/1429: `p2-blank-forms.test.tsx` (ar) and `p2.test.tsx` › Design, both **20 s timeouts** in files I did not touch; formula 259 + 2 skipped | `final-unit-locale-c-utf8.log` |
| Re-runs: typecheck, lint, `pnpm test` in both locale settings | see the table below | — | `rerun.txt`, `final-typecheck.log`, `final-lint.log`, `rerun-unit-*.log` |

**Final re-runs on the final tree (22:40–23:06Z, load average about 10–15; `rerun.txt`):**

| Command | Exit | Result | Log |
|---|---|---|---|
| `pnpm -r typecheck` | **0** | — | `final-typecheck.log` |
| `pnpm lint` | **0** | — | `final-lint.log` |
| `pnpm test`, locale unset | **0** | unit-node **2040/2040** (121 files); unit-web **1429/1429** (74 files); unit-formula-nocodegen **259 passed + 2 skipped** (by design) | `rerun-unit-locale-unset.log` |
| `pnpm test`, `LANG=LC_ALL=C.UTF-8` | **0** | the same: **2040/2040**, **1429/1429**, **259 + 2 skipped** | `rerun-unit-locale-c-utf8.log` |
| `npx prettier --check --ignore-unknown` on this handback and its evidence | 0 | "All matched files use Prettier code style!" | (console) |

The unit-node count of 2040 includes my **31 new unit tests**, so the base tree had 2009: 29 in `scoring.test.ts` and 2 in `health.test.ts`. The two timeouts in the earlier `C.UTF-8` run (web tests I did not touch) and the architecture timeout did not recur here. I count them as load-related flakes; they are disclosed above and not hidden. The new integration tests are **9**: 7 in `health-schemes.test.ts` and 2 in `health-scoring-db.test.ts`. With the §5.4 patch, the full integration count is expected to be 2444/2444. That figure is from the pre-fix tree plus the patch verification, not a single run.

**Not re-run on the final tree:** `pnpm -r build`, `pnpm openapi:lint` and the repository-wide prettier check. Their first runs exited 0. The later changes are TypeScript-only, inside `health/` and two test files, and the final typecheck, the final lint and the formatter cover them. They are not reported as passing on the final tree.

**Negative control:** the agreement test fails when the shared percent rounding is `ROUND_DOWN` (exit 1, "63.23 vs 63.24"), in `negative-control-round-down.log`.

**At the end:** `node tools/gates/validate.mjs --historical --stage DG4`: exit **0**, `PASS gate DG4 (historical)` (`validate-historical-DG4-end.log`).

## 4. Operations routed (delta to `p5-pending-kbe-g.ts`)

| Operation | Before | After |
|---|---|---|
| `listHealthCheckQuestions` | pending | routed `GET /api/v1/health-check-questions`; exercised (200, 401); mirror `healthCheckQuestionList` |
| `listHealthCheckSchemes` | pending | routed `GET /api/v1/admin/health-check-schemes`; exercised (200, 401); mirror `healthCheckSchemeList` |
| `getHealthCheckScheme` | pending | routed `GET /api/v1/admin/health-check-schemes/{schemeVersionId}`; exercised (200, 400, 401, 404); mirror `healthCheckScheme` |

`P5_PENDING_KBE_G` is now `[]`.

- `config.consumes`: none on any of the three. They are bodiless GETs, as the contract declares no request body.
- **Pinned counts.** The media-type triple `[380, 379, 1]` counts body operations, so its delta is **0**. The rate-limit floor (≥ 285) is a floor, so its delta is **0**.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **One problem code that ADR-0048 §9 lacks (shared rule 15).** `p5_health_scheme_problem` can return `health_scheme_definition` (a definition without `scoreBasis` points | percent_of_applicable, or without `questionCount` 25), but §9 has no row for it. I use the proposed **422 `health_scheme.definition_invalid`**, "A scheme's definition needs a score basis (points or percent of the applicable questions) and 25 questions.", in both the provider (preview, compatibility) and `db-errors.ts`. Please adopt it into ADR-0048 §9, with the i18n key for FE-F, or name another code.
2. **Where the zod mirrors live.** The `HealthCheckQuestionList`/`HealthCheckScheme`/`HealthCheckSchemeList` mirrors are in `packages/shared/src/health/contract.ts`, exported through `@mth/shared/calc`. They are not under `@mth/shared/schemas`, because `packages/shared/src/schemas/health.ts` belongs to KBE-G2 (§H.4). KBE-G2, or the orchestrator, may re-export or move them into `schemas/health.ts`. The contract test currently imports them from `@mth/shared/calc` in `p5-exercises-kbe-g.ts`.
3. **The preview hook is called only with samples** (`methodology/preview.ts`, BE-B's file). A health-check draft previewed with `samples: []` therefore records a passing preview even when the scheme is invalid; compatibility then fails it, and the database guard is the backstop. If the orchestrator wants the preview to fail in that case too, the sandbox would need to call a kind hook unconditionally, which is a change to BE-B's file. I did not make it.
4. **The pinned list in `apps/api/test/integration/methodology/studio-drafts.test.ts` needs a fourth entry** (BE-A/BE-D's file; the D-148 precedent of an orchestrator test-only edit). BE-D added the `form_schema` entry the same way when its kind gained a default key. The patch is `T-DG5-KBE-G-evidence/proposed-patch-studio-drafts.diff`: it adds `{kind: "health_check_scheme", versionId: "01920005-0860-7000-8000-000000000001", key: "health-check", versionNo: 1, pinned: false, lastMigrationId: null, pinnedAt: null, version: null}` after the `form_schema` entry. I verified it: 18/18 with the patch applied, and the file was then restored byte for byte. No other test changed, and the assertion keeps its intent: an unpinned kind resolves to v1 of its default key.
5. **No dependency** needed. **No migration** needed. **No contract change** needed: the three bodies match `openapi.yaml` as they are, and `pnpm openapi:lint` passes.

## 6. Merge instructions

- `calc.ts` gets one appended export line after KBE-F's (§H.6).
- `server.ts`:
  - one appended line after BE-P's `registerLaunchPlanPort(...)` line;
  - the existing `import { registerHealthModule } from "./modules/health/index.ts";` line becomes `import { registerHealthCheckSchemeProvider, registerHealthModule } …` (a one-line change, not an append; a conflict is possible only if another W12 task edits the same import line).
- `db-errors.ts`:
  - a new function before `mapDatabaseGuardError`;
  - two lines after the `p5FinancialMetric` call. BE-S, BE-N or KBE-E2 may append their own mappers at the same places: keep both, order irrelevant (disjoint constraint names).
- `health/routes.ts`: KBE-G2 appends its registration lines after mine.
- **The worker does not register the provider.** It does not run the Studio pipeline. If a worker job later resolves `health_check_scheme` through `ConfigResolver`, its default key comes from this provider, and the worker would need the same one line.

## 7. User-facing texts made untrue

None found in my scope. The web texts that mention the health check (`nav.json` `healthCheck`/`healthSchemes` summaries, studio kind and element labels) describe the feature and do not call it planned. The pages are FE-F's.

The `source_element` rows of set `health_question` still carry `feature_status = 'planned'`. They move to `working` in migration `0088`, which is KBE-G2's, once KBE-G2 and BE-P have shipped (§H.4, F-DG4-160). I did not write it, because `0088` is not my number. **For KBE-G2/orchestrator:** the questions and scheme part of the health check now works, so `0088` is due once the assessments ship.

## 8. What remains

- Nothing of §H.3 remains. KBE-G2 (§H.4) builds on it: the assessments, the assessment-level `band: null`, the `scoringAssumption` flag, A07's "keeps v1 after v2", the S16-021 group test and `0088`.
- The §5.1 code decision and the §5.2 mirror location are the orchestrator's, and so is applying the §5.4 test patch (the full integration suite fails 1/2444 until it is applied).
