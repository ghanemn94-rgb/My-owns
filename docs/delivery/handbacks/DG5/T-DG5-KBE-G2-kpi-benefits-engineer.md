# Handback T-DG5-KBE-G2 (kpi-benefits-engineer): health-check assessments, the S16-021 group test, and `0088`

- **Stage:** P5, gate DG5 (BUILDING). **Section:** `docs/architecture/p5-work-split.md` §H.4.
- **Invocation:** run `DG5-T-DG5-KBE-G2-kpi-benefits-engineer-20261016T070311Z-fa7851bd`, session `fa7851bd-0628-43de-b15f-3ed4512101ce`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-G2.md`, sha256 `6f9667af…290177` (verified at start).
- **Base:** branch `dg5/kbe-g2`, `HEAD` `b2d030f3e82c9b0c61b5f0d8256f575371446d3f`. The changes are left **uncommitted**.
- **Time:** start `2026-10-16T07:03:24Z`; end: see §3.7.
- **Two gate systems.** A health-check score is an assessment. It is not a G1–G6 business approval, and nothing here reads or writes DG0–DG7. All test data is synthetic. The one Sponsor decision in a test is the synthetic decision of a methodology-migration fixture, and it approves nothing real.

## 1. Files changed

| File                                                                      | Change   | Purpose                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/health/assessments.ts`                              | new      | The seven operations: create under the pinned scheme (`ConfigResolver`; else v1 of `health-check`), linked to the previous submitted assessment; update; answers and actions with `If-Match` of the assessment; submit under lock class `healthAssessmentSubmit` with the score and band from `@mth/shared/calc`. Also the §9 `health_check.*` refusals and the presenter (incomplete → `null`). |
| `apps/api/src/modules/health/routes.ts`                                   | modified | Its registration line, appended after KBE-G's.                                                                                                                                                                                                                                                                                                                                            |
| `packages/shared/src/schemas/health.ts` (+ barrel line in `schemas/index.ts`) | new      | The zod mirrors of `HealthCheckAnswer`, `HealthCheckAction`, `HealthCheckSummary`, `HealthCheckPage`, `HealthCheck`, `HealthCheckCreate`, `HealthCheckUpdate`, `HealthCheckAnswerPut` and `HealthCheckActionsPut`. It also re-exports KBE-G's three read mirrors.                                                                                                                            |
| `apps/api/src/modules/platform/db-errors.ts`                              | modified | `mapP5HealthCheckError`: the `health_assessment*` guard and constraint names mapped to the same §9 codes (unreachable ones → 500). Wired into `mapDatabaseGuardError` after KBE-G's line.                                                                                                                                                                                                 |
| `packages/db/migrations/0088_p5_launch_health_source_working.sql`         | new      | Rule A-7: the 3 `launch_window` and 25 `health_question` `source_element` rows move to `feature_status = 'working'`. It asserts exactly 28 rows moved. Forward-only.                                                                                                                                                                                                                       |
| `apps/api/src/modules/health/assessments.test.ts`                         | new      | Unit tests: the route list, every §9 code and exact text (API and database mapping), the request-body mirrors, and the worked scoring fixtures.                                                                                                                                                                                                                                         |
| `apps/api/src/modules/health/health.test.ts`                              | modified | KBE-G's route assertion pinned the full list with `toEqual`. It now asserts KBE-G's three reads come first, and my test pins the full ten. This is a one-line edit of KBE-G's test, needed because the routes were appended.                                                                                                                                                           |
| `apps/api/test/integration/health/assessments.test.ts`                    | new      | The literal §H.4 tests (§2 below), against PostgreSQL.                                                                                                                                                                                                                                                                                                                                 |
| `apps/api/test/integration/health/s16-021-group.test.ts`                  | new      | The REQ-S16-021 group test.                                                                                                                                                                                                                                                                                                                                                            |
| `apps/api/test/integration/contract/p5-exercises-kbe-g2.ts`               | new      | All 7 operations through the validating client (`ctx.mirrored`), each with its success and every declared refusal it can reach.                                                                                                                                                                                                                                                        |
| `apps/api/test/support/p5-pending-kbe-g2.ts`                              | modified | Emptied (7 → 0).                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/api/test/integration/contract/contract.test.ts`                     | modified | Append-only: the import, the `...P5_MIRRORS_KBE_G2` line, the `it("P5 KBE-G2 operations …")` block, and the media-type pin (§4).                                                                                                                                                                                                                                                       |

Evidence logs are in `docs/delivery/handbacks/DG5/T-DG5-KBE-G2-evidence/`.

## 2. Behaviour delivered, per requirement row (acceptance quoted from `requirements.csv`)

**REQ-PB-091**: "A16: all 25 questions render verbatim; an assessment with an unanswered question is labelled incomplete and shows no band; submission without three actions is rejected"

- **Verbatim questions.** The 25 questions equal the B0150 cells of `docs/source/playbook.md`, in order. They include "Are 3-5 business outcomes measurable?" with the source's hyphen, and each has a provisional Arabic text.
- **Incomplete.** An assessment with an unanswered question returns `completion {answered, total: 25, complete: false}`, `score: null`, `scoreMax: null` and `band: null`, in the read and in the list. It is never 0 and never a band. Submitting it gives 422 `health_check.incomplete` with the exact §9 text.
- **Three actions.** Submitting a complete assessment with 0 or 2 actions gives 422 `health_check.actions_required`, "Submit the health check with its top 3 actions.". With three it submits.
- **Reassessments.** Each new assessment has the next `sequenceNo` and names the previous submitted one (`previousAssessmentId`). At most one draft exists per transformation (409 `health_check.draft_exists`).
- **Answers.** Each answer carries M0262's response, evidence (`evidenceNote`, `evidenceId`), owner and action (`actionNote`). The assessment carries the assessment date and owner.
- Tests: `assessments.test.ts` "the 25 questions render verbatim", "REQ-S14-002: 24 answers…", "submitting a complete assessment without three actions…" and "reassessments are tracked in sequence…".

**REQ-PB-092**: "A16: scores 21, 16, 10 and 9 map to the four band texts verbatim"

- Four submitted assessments with 21, 16, 10 and 9 Yes give bands `21-25`, `16-20`, `10-15` and `0-9`. Their `textEn` equals the B0152 rows of the playbook (read from `docs/source/playbook.md`, not restated).
- The band of a submitted assessment is the stored `band_key`, resolved against **its own** scheme version.
- Test: "scores 21, 16, 10 and 9 map to the four B0152 texts verbatim". Unit fixtures also cover 25 → `21-25` and 0 → `0-9`.

**REQ-S14-001**: "A16: 25 answers with 17 Yes give a score of 17 and the band '16-20'; the scoring method is shown as an implementation assumption in the UI"

- **API side.** 17 Yes of 25 gives `score: "17"`, `scoreMax: "25"`, band `16-20` (`b0152_16_20`) and `scoringAssumption: true`. The database stores 17.00/25.00. Scores are decimal strings computed with decimal.js through the shared `healthAssessmentResult`, never a binary float.
- **Database backstop.** Writing any other score is refused by `health_assessment_score_matches`, mapped to 500. This is tested by a direct write.
- **Not done here.** The UI notice is FE-F's (`healthCheck.scoringAssumption`, p5-work-split §H.6).

**REQ-S14-002**: "A16: an assessment with 24 answers shows 'Incomplete (24/25)' and no band; the API returns band=null"

- **API side.** 24 answers give `completion {answered: 24, total: 25, complete: false}`, `band: null` and `score: null`. This holds even when all 24 are Yes, and in both `getHealthCheck` and `listHealthChecks`.
- **Not done here.** The label "Incomplete (24/25)" is FE-F's.

**REQ-S14-003**, A07 part: "existing assessments keep their original scheme version and band"

- **Setup.** A transformation is pinned to v1 of a fresh synthetic key (a copy of the seeded v1). An assessment with 17 Yes is submitted (v1, "17", `16-20`).
- **Migration.** v2 of the key is published, with N/A, `percent_of_applicable` and its own four bands. The pin is migrated **through the methodology-migration API**: ADM_METHOD creates and submits, the Sponsor decides (synthetic), and ADM_METHOD executes.
- **Result.** The submitted assessment still reads v1, version 1 of the scheme, "17"/"25" and the same band object, and its row version is unchanged. The next assessment is created under v2, accepts N/A, and scores 15/20 applicable = `"75"` of `"100"`, band `solid`.
- **Refusals.** A v1 draft refuses N/A with 422 `health_check.response_not_allowed`. An all-N/A assessment under a percent scheme is not computable: `score`/`band` stay null and submit gives 422 `health_check.not_computable`.
- The publish-rule part ("publishing a scheme that adds N/A without new bands is rejected") is KBE-G's and already shipped.

**REQ-S16-021**: "the ERD and migrations contain every entity listed … with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced"

- **The test.** `s16-021-group.test.ts` creates through the API and reads back through the API: BAUHandover (WL creates; AUD reads by id), Control (TO creates; AUD reads the list), ImprovementItem (TO), Lesson (TO) and HealthAssessment (TL creates; AUD reads by id and in the list).
- **Refusals.** FIN, which holds none of the six write rights, and AUD each get 403 on each create. An outsider gets 404 on the handover and the health-check create.
- **ControlCheck.** It has **no create operation** by design (ADR-0034 §6): checks are created by the worker's control-check scan. The test runs the scan in-process (the contract-test precedent `p4-exercises-be-i.ts`, ADR-0002), then reads the check through the API and records it through the API. FIN and AUD get 403 on `recordControlCheck`. This is disclosed so the reviewer can judge it against the literal "creates … through the API".
- **Columns.** The test also checks that each table has `id`, its owner column (ADR-0048 §11) and `status`.

**Mutation invariants (shared rule 4)**, for every one of the five writes:

- **Commit-time authorization.** `health_check.assess` is re-checked at commit on reloaded grants. AUD, SP and WL get 403 on create, update, answer, actions and submit, and nothing is written. A grant revoked while the request waits gives 403 and writes nothing (`afterIdentity`/`revokeAll`).
- **Validation.** Strict zod via `parseBody`, and free text through `freeText`.
- **If-Match.** 428 when missing and 409 when stale. Create returns version 1 with ETag and Location. Two leaders answering at once get exactly one 409.
- **Audit.** Each mutated row has one audit event in the same transaction: `health_assessment.create`, `.update`, `.answer`, `.actions` and `.submit`; `health_assessment_answer.create`/`.update`; `health_assessment_action.create`/`.update`. An identical re-put writes nothing.
- **No remote I/O** happens inside any transaction.

**Design choices the contract leaves open:**

- **Partial action sets.** `putHealthCheckActions` accepts one to three actions (OpenAPI `minItems: 1`). Each rank sent is created or replaced, and a rank not sent keeps its stored action. `health_assessment_action` has no DELETE grant, so nothing is ever deleted.
- **Owner default.** A create without `ownerUserId` makes the caller the owner. The column is NOT NULL and the contract makes the field optional.

## 3. Checks (real exit codes; logs in the evidence folder)

Environment: Node 24.21.0, offline, ports 23050–23099.

**During the run, three other W14 tasks were running on the same machine, and the load average was 15–19 from 08:00Z onward.**

| #   | Command                                                                                                          | Exit                 | Result                                                                                                                         | Log                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `node tools/gates/validate.mjs --historical --stage DG4` (start)                                                  | 0                    | `PASS gate DG4 (historical)`                                                                                                   | `validate-historical-DG4.start.log`                                                                                                                       |
| 2   | `pnpm -r typecheck`                                                                                              | 0                    |                                                                                                                                | `typecheck.log`                                                                                                                                           |
| 3   | `pnpm -r build`                                                                                                  | 0                    |                                                                                                                                | `build.log`                                                                                                                                               |
| 4   | `pnpm lint`                                                                                                      | 0                    |                                                                                                                                | `lint.log`                                                                                                                                                |
| 5   | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown`                       | 0                    |                                                                                                                                | `prettier.log`                                                                                                                                            |
| 6   | `pnpm openapi:lint`                                                                                              | 0                    |                                                                                                                                | `openapi-lint.log`                                                                                                                                        |
| 7   | `pnpm test`, locale unset                                                                                        | see 3.1              |                                                                                                                                | `unit-locale-unset.run1-failed.log`, `unit-locale-unset.run2-load-timeouts.log`, `unit-locale-unset.rerun-failed-files-{node,web}.log`                     |
| 8   | `LANG=LC_ALL=C.UTF-8 pnpm test`                                                                                  | see 3.2              |                                                                                                                                | `unit-c-utf8.log`                                                                                                                                         |
| 9   | `QA_PG_PORT=23060 MTH_PORT_POOL=23061-23099 tests/qa/support/with-pg.sh pnpm test:integration`                   | 0                    |                                                                                                                                | `integration.log`                                                                                                                                         |
| 10  | `node tools/gates/validate.mjs --historical --stage DG4` (end)                                                   | see 3.7              |                                                                                                                                | `validate-historical-DG4.end.log`                                                                                                                         |

Checks 2–6 ran on the final source. After them, the only source edits were the two fixes in 3.1 (assessments.ts and a db-errors.ts comment). Both files were re-checked with `tsc --noEmit` (apps/api), `eslint` and prettier, each exit 0. The repository-wide prettier check (5) ran before those two edits, and both files were re-formatted with prettier afterwards.

### 3.1 `pnpm test`, locale unset

**Run 1: exit 1, 3 failures, all caused by me and fixed.**

- `architecture.test.ts` "has only mapped module directories": an empty `apps/api/src/modules/.claude/` directory (the write guard's `.cc-writes` marker parent) was taken for a module.
- `architecture.test.ts` "every import respects …": two computed-member assignments (`changes[k] = …`) in `assessments.ts`. They are now built through a `diffOf` helper.
- `advisory-locks.test.ts` "no module source … spells a class number": my comments in `assessments.ts` and `db-errors.ts` wrote the number of lock class `healthAssessmentSubmit`. The comments now name the class.

After the fixes, these files pass: `architecture.test.ts`, `advisory-locks.test.ts` and `health/**`, 165/165.

**Run 2 (final source): exit 1.**

- unit-node: 4 failed / 2135 passed (2139). Every failure is a timeout under load: `architecture.test.ts` "every import respects …" (30 s timeout; it lints every module file) and three `packages/reporting/src/pdf/pdf.test.ts` Arabic tests (5 s timeout).
- unit-web: 1 failed / 1428 passed (1429). `src/pages/raid/raid.test.tsx` "action register: source, follow-up date…" failed at `findByRole("link", { name: "Synthetic call the vendor" })`, the 1 s default `findBy`.
- unit-formula-nocodegen: 259 passed, 2 skipped (by design).
- **Re-running the three failing files alone passes:** node 152/152, exit 0; web 18/18, exit 0.
- I changed none of these files or their code (`architecture.test.ts` scans my module, and passes in isolation and in run 1's targeted rerun).

**This acceptance item is not met as written.** I report it as load-induced flakiness in files owned by others (F-DG4-143 to F-DG4-148 class). I did not raise any timeout to hide it.

### 3.2 `pnpm test`, `C.UTF-8` (final source): exit 1

- unit-node: 5 failed / 2134 passed (2139). Ten "Test timed out" errors in total, all in `architecture.test.ts` (30 s) and four `pdf.test.ts` Arabic tests (5 s).
- unit-web: 1 failed / 1428 passed (1429), the same `raid.test.tsx` `findByRole` failure.
- unit-formula-nocodegen: 259 passed, 2 skipped.
- These are the same files as 3.1 and the same cause; none is in my scope. **This acceptance item is not met as written.**

### 3.3 Integration: exit 0

`QA_PG_PORT=23060 MTH_PORT_POOL=23061-23099 tests/qa/support/with-pg.sh pnpm test:integration` ran on a fresh disposable PostgreSQL 16.13, from 08:29Z to about 09:11Z, under load average 15–19. Log: `integration.log`.

- **Result: exit 0.** Test files 268/268 passed; tests 2553 passed and 1 skipped (2554).
- **Passed among them:**
  - `contract/contract.test.ts`: 81, including "P5 KBE-G2 operations" and the media-type pin `[390, 389, 1]`;
  - `health/assessments.test.ts`: 15;
  - `health/s16-021-group.test.ts`: 1;
  - `health/health-schemes.test.ts`: 7;
  - `procedures/coverage.test.ts`: 4 (unchanged by `0088`; see §5);
  - `methodology/source-coverage.test.ts`: 8 (with `0088`).
- **Count deltas from me:** +16 integration tests (assessments 15, s16-021-group 1) and +1 `it` in the contract test.
- **Timing note:** the 08:59Z snapshot cited in my first summary was taken while the run was in progress. The final result supersedes it.

### 3.4 Targeted integration (before the final suite)

`tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/health/` gave 24/25 on its first run. The one failure was my own test asserting a wrong list index for the hyphen question; it now looks the question up by text. KBE-G's `health-schemes.test.ts` (7) and `health-scoring-db.test.ts` (2) passed in the same run. Log: `integration-health-dir.run1-failed.log`.

### 3.5 Unit counts of my own suites

`apps/api/src/modules/health/` 23/23: `assessments.test.ts` 19 and `health.test.ts` 4.

### 3.6 Write-guard artifacts

Each Write/Edit creates an empty `.claude/.cc-writes` directory next to the written file. Under `apps/api/src/modules/` this breaks `architecture.test.ts`. Before every suite run I removed the empty `.cc-writes` and `.claude` directories under `apps/` and `packages/` (`find … -empty -delete`).

### 3.7 End

- `node tools/gates/validate.mjs --historical --stage DG4` at the end: exit 0, `PASS gate DG4 (historical)` (`validate-historical-DG4.end.log`).
- End time: `2026-10-16T08:59Z`, about 116 minutes after the start.

## 4. Operations routed (delta to `p5-pending-kbe-g2.ts`) and pinned counts

- **Pending list:** 7 → 0. Removed: `listHealthChecks`, `createHealthCheck`, `getHealthCheck`, `updateHealthCheck`, `putHealthCheckAnswer`, `putHealthCheckActions`, `submitHealthCheck`. All seven are exercised in `p5-exercises-kbe-g2.ts`.
- **Media-type pin** (`contract.test.ts`): **+4 JSON bodies** (`createHealthCheck`, `updateHealthCheck`, `putHealthCheckAnswer`, `putHealthCheckActions`). `submitHealthCheck` is bodiless and declares no `consumes`; the other two are GETs. In my tree the pin is `[386, 385, 1]` → `[390, 389, 1]`, with a comment. **The orchestrator reconciles it with the other W14 handbacks.**
- **Rate-limit floor:** no change from me.
- **Merge conflicts to expect:** the `contract.test.ts` import, mirror and `it` lines (append-only unions); `db-errors.ts` (one new mapper block before slice J's, and one line in `mapDatabaseGuardError` after KBE-G's); `schemas/index.ts` (one export line at the end).

## 5. Contract, schema and dependency needs (for the orchestrator)

- **No new dependency.** No OpenAPI change: the implementation follows the contract as written.
- **No new problem code.** Only the §9 `health_check.*` codes and ADR-0007/ADR-0043 generic codes are used: `validation.user_invalid`, `validation.reference`, `version_conflict`.
- **Procedures coverage, `form_record_type` (outside my files).** The procedures coverage view (`procedures/coverage.ts`) reads `form_record_type.feature_status`, not `source_element`. `0068` seeds `form_record_type` rows `launch_plan` and `health_assessment` as `planned` with no `table_name`. So after `0088`, the methodology **source-coverage** report shows `launch_window` and `health_question` as working (`pass`), but the **procedures coverage** view still shows those 28 elements as "Planned". `apps/api/test/integration/procedures/coverage.test.ts` pins `planned: 28` and "launch windows and health questions show Planned (never covered) until slice H ships their forms".
  - Moving those two rows to `working` needs a `table_name`, and it makes them form-framework targets (`forms/record-types.ts`, `forms/provider.ts`). That is a slice B/C decision outside §H.4.
  - **Decision needed:** either a repair-range migration (`0094`+) by the forms owner, or the coverage test's wording stays as the true statement "until slice H ships their forms".
- **`docs/architecture/data-dictionary.md`** lists migrations; `0088` is not added there (architect-owned).

## 6. User-facing texts made untrue by this work

- **Fixed: the source-coverage report.** It said "planned" for the 28 launch-window and health-question elements while BE-P, BE-P2, KBE-G and this task have shipped them. `0088` makes it true (rule A-7, F-DG4-160).
- **Unchanged, still true:** the web `nav.json` (en/ar) "Health check" entries are marked through `apps/web/src/app/nav.ts` (`p5Feature: "healthCheck"`, owner FE-F). They show "Planned" until FE-F builds `pages/health-check/**`. That page does not exist yet, so the texts stay true. No en/ar string was changed.
- **For FE-F, when it ships:** the "Planned" state of `healthCheck`/`healthSchemes` in `nav.ts`, and the procedures-coverage "Planned" (§5).

## 7. What remains

1. **Acceptance 2 (`pnpm test` exit 0 in both locales) is not met** on this machine under concurrent load. The failures are timeouts in `architecture.test.ts` and `pdf.test.ts`, and a 1 s `findByRole` in `raid.test.tsx`. None is in my files, and all pass in isolation. A quiet-machine rerun by the orchestrator is needed, and possibly a determinism fix by the owners of those tests.
2. **FE-F parts** of REQ-PB-091, REQ-S14-001, REQ-S14-002 and REQ-S14-003: the screens, "Incomplete (24/25)" and the scoring-assumption notice.
3. **QA-D (A16) and QA-B (A07)** acceptance tests.
4. **The `form_record_type` decision** in §5.

## 8. Merge instructions

- **Migration `0088`** is forward-only and applies after `0087`. On a fresh database it runs in lexical order (`0087` → `0088` → `0089`). The P5 id rule in `seed.test.ts` holds (≤ 0099, strictly increasing), and `0088` is the number §H.5 reserves.
- **Databases that already applied `0089`+** (shared dev databases) need the orchestrator's usual handling for a reserved gap number.
- **No seed or configuration change.**
