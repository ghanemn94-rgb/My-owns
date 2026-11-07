# Handback T-DG6-BE-Z11 (backend-workflow-engineer): DG6 V9 failure, list registry vs contract for `workstream_outputs`

- **Stage / gate:** P6, DG6 (FIXING after review round 6). This is an engineering repair. It grants no business approval (G1–G6), and it is not evidence that DG6 or DG7 passed.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-Z11-backend-workflow-engineer-20261107T220255Z-1eed3723","session_id":"1eed3723-6725-41d2-92e9-605ea005afec"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z11.md` (sha256 `f75695d3…6ddef`, verified).
- **Starting revision:** branch `dg6/be-z11` at `195a62d1fb6e82e6aef63670ffc2330a3f9a31bb` (the brief commit on top of `87ca8cf13`). The tree was clean apart from an empty `apps/api/.claude/.cc-writes` directory, which I removed as the brief instructs.
- **Time:** started `2026-11-07T22:03:08Z`, ended `2026-11-07T22:33:44Z` (about 31 minutes).
- **Changes are uncommitted**, as instructed.

## Contradiction in the assignment: the handback path

The brief's "Handback" section names `docs/delivery/handbacks/DG6/T-DG6-BE-Z8-backend-workflow-engineer.md` and `T-DG6-BE-Z8-evidence/`. Both already exist and belong to task T-DG6-BE-Z8. Writing there would overwrite another task's record. The protocol says to report a contradictory assignment instead of guessing, so I used the protocol's default path for this task:

- `docs/delivery/handbacks/DG6/T-DG6-BE-Z11-backend-workflow-engineer.md` (this file)
- `docs/delivery/handbacks/DG6/T-DG6-BE-Z11-evidence/`

I did not touch the BE-Z8 handback or its evidence.

## Decision: `includesRestrictedRecords` is a list column, not response metadata

**Rule (ADR-0057 §4):** the registry "declares, per `list_key`, the column keys". The registry's own header says the columns are "exactly the properties of the list operation's item schema". Response-level metadata would sit on the page object, next to `items` and `nextCursor`. `WorkstreamOutputPage` has no such member, and its `additionalProperties` is `false`. On `WorkstreamOutput`, `includesRestrictedRecords` is a property of each row: it says whether *that* output's `recordId` or `evidenceId` was withheld from the reader.

**Precedent:** the registry already lists derived, read-time item properties as columns:

- initiatives: `displayStatus`, `warnings` and `flags`
- search: `isArchived`

So excluding this flag would need a new exception to the rule. It would also make the registry stop matching the contract.

**How it was added:**

- **Column:** `includesRestrictedRecords`, after the register tail.
- **Type:** boolean, present only as `true`. This comes from the contract (`{ type: boolean, const: true }`) and its zod mirror (`z.literal(true).optional()` in `packages/shared/src/schemas/diagnose.ts`).
- **Label:** the existing `access.includesRestrictedRecords` key.
  - en: "Includes restricted records"
  - ar: "يشمل سجلات مقيدة"
  - The registry has no type or label fields for any column, so I added none. The type and label are recorded in a comment beside the column.
- **No filter:** ADR-0057 §5 gives `listWorkstreamOutputs` only `includeArchived`, `q` and `sort`, and the registry's filters must equal those parameters. A "restricted only" filter would be a contract change. It would also give readers a way to probe for restricted links, so it isn't meaningful here.
- **No sort:** the value is computed at read time, so it is not a `RegisterSpec.sortColumns` column. The contract's `RegisterSort` pattern leaves sorts to those columns.

### What I found for every list in the registry test

I compared the contract and the registry for all 12 lists with a throwaway script that does the same dereferencing as the test. The script lived in `$TMPDIR` and was not committed.

| list key | operation | item properties | registry columns | difference |
|---|---|---|---|---|
| transformations | listTransformations | 22 | 22 | none |
| initiatives | listInitiatives | 32 | 32 | none |
| strategic_guardrails | listStrategicGuardrails | 16 | 16 | none |
| outcomes | listOutcomes | 23 | 23 | none |
| diagnostic_items | listDiagnosticItems | 24 | 24 | none |
| diagnostic_findings | listDiagnosticFindings | 19 | 19 | none |
| **workstream_outputs** | listWorkstreamOutputs | **20** | **19 → 20** | `includesRestrictedRecords` was in the contract only; fixed |
| tom_gaps | listTomGaps | 18 | 18 | none |
| capability_heatmap | listCapabilityHeatmapEntries | 20 | 20 | none |
| journeys | listJourneies | 22 | 22 | none |
| journey_pain_points | listJourneyPainPoints | 16 | 16 | none |
| search | searchRecords | 11 | 11 | none |

None of the other 11 item schemas got `includesRestrictedRecords` from BE-Z9, BE-Z10 or BE-Z10B. The other schemas that carry the flag in `docs/api/openapi.yaml` are not saved-view lists, so the registry rule does not apply to them. They include dispensations, benefit groups, measurements, KPI overrides, portfolio, reports, dashboards and the evidence register. The 5 dashboard response-level flags are response metadata on non-list responses, and none of them is in `SavedViewListKey`.

## Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/saved-views.ts` | Adds `includesRestrictedRecords` to the `workstream_outputs` columns (no filter or sort), with a comment giving the rule, type and label. |
| `apps/api/test/integration/search/saved-views.test.ts` | Adds assertions to the existing "the helpers" test that pin the decision: a `workstream_outputs` view may name the column (`null`), while naming it as a sort is refused at `/sort/0/key` and as a filter at `/filters/includesRestrictedRecords`. The registry-equals-contract assertion is unchanged. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Z11-*` | This handback and its logs. |

No migration, no API endpoint change, no contract change and no new dependency.

## Behaviour delivered, per requirement row

- **REQ-S15-013:** acceptance text "A20: on a register with 1,000 initiatives, sorting, filtering, paging and hiding a column all work, and the API returns paginated results". The procedure text is "persist column choices in saved views". A saved view on `workstream_outputs` can now persist the `includesRestrictedRecords` column choice: the API accepts it instead of returning 422 `saved_view.unknown_key`. The registry again equals the contract for all 12 lists. The A20 initiative behaviour is not changed by this repair.
- **REQ-S15-010:** acceptance text "A12;A14: search as a user scoped to transformation X returns no Y records; a bulk update touching a stale record reports a conflict for that record only; a draft survives a browser reload". The procedure text is "lists support saved views and chips". The saved-view registry for `workstream_outputs` is consistent with its operation again. A view grants no data (ADR-0057 §4): the flag is still computed by the list's own read rules (BE-Z10B, D-218). The search, bulk and draft behaviour is not changed, and the `search/` and `access/` folders pass (see below).

## Checks actually run

Environment for all runs:

- Node 24.21.0, offline, harness ports 31050–31099.
- Integration runs use `tests/qa/support/with-pg.sh`: a disposable PostgreSQL cluster, UTF8 with the C locale.
- Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Z11-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` | `validate-dg5.log` |
| 1 | **Before the fix:** `QA_PG_PORT=31050 MTH_PORT_POOL=31050-31099 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/search/saved-views.test.ts` | **1** | **1 failed, 29 passed (30)**. The failing test was `workstream_outputs: columns, filters and sorts equal its operation's contract`: `expected [ Array(19) ] to deeply equal [ Array(20) ]`, `- "includesRestrictedRecords"`. This reproduces V9. | `01-before-saved-views.log` |
| 2 | **After the fix:** the same command | 0 | 30 passed (30) | `02-after-saved-views.log` |
| 3 | `… with-pg.sh npx vitest run --project integration apps/api/test/integration/search apps/api/test/integration/access` | 0 | 22 files, **207 passed (207)** | `03-search-access-folders.log` |
| 4 | `pnpm -r typecheck` | 0 | all packages done | `04-typecheck.log` |
| 5 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | no findings | `05-lint.log` |
| 6 | `pnpm -r build` | 0 | built | `06-build.log` |
| 7 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `07-prettier.log` |
| 8 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `08-openapi-lint.log` |
| 9 | `env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE pnpm test` | 0 | unit-node 190 files / **2899 passed**; unit-web 123 files / **2077 passed**; unit-formula-nocodegen 3 files / **259 passed, 2 skipped** | `09-test-locale-unset.log` |
| 10 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 2899; 2077; 259 passed + 2 skipped | `10-test-c-utf8.log` |
| 11 | `… with-pg.sh npx vitest run --project integration apps/api/test/integration/jobs apps/api/test/integration/operations apps/api/test/integration/launch/worker-parity.test.ts apps/api/test/integration/automation/automation-failures.test.ts` | 0 | 11 files, **70 passed (70)** | `11-jobs-operations-automation.log` |
| 12 | `E2E_PG_PORT=31070 E2E_API_PORT=31080 MTH_PORT_POOL=31050-31099 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --project=chromium-en --project=chromium-ar` (real stack) | 0 | **4 passed** (a13: en 11.3 s, ar 11.0 s; a22: en 1.8 m, ar 1.8 m) | `12-e2e-a22-a13.log` |

Notes on the checks:

- **Run 1** is the only non-zero exit, and it was intended: it shows the failure before the fix.
- **The 2 skipped tests in runs 9 and 10** are in `packages/shared/src/formula/fuzz.test.ts`. They were already skipped before this change, and I did not touch that file.
- **What run 11 covers from acceptance item 3:**
  - worker jobs: `jobs/job-operations`, `jobs/job-schedules`, `launch/worker-parity`
  - failure queue and automation recovery: `automation/automation-failures`
  - operations and operational exceptions: all of `operations/`, including `exceptions`, `exception-last-known-value`, `concurrent-exception-recurrence` and `service-identity-scope`
  - the BE-Z6 race test: `operations/exception-recurrence-race.test.ts`
- **No flaky tests and no timeouts** occurred in any run.
- **Not run (not required):** the full `pnpm test:integration`. The brief leaves it to the orchestrator on the merged tree.

## Operations routed (pending-list delta)

None. This repair adds or routes no operation, so the `p6-pending-*.ts` and `p6-exercises-*.ts` lists are unchanged.

## Contract, schema or dependency needs (for the orchestrator)

None. The contract is unchanged, and the registry now follows it.

## User-facing texts made untrue

None. No feature that a string calls "planned" or "later" shipped. The column's label `access.includesRestrictedRecords` already exists in en and ar. No web list currently offers `workstream_outputs` saved views (only `SearchPage` and `InitiativeRegister` use `useListView`), so no screen text changes.

## Merge instructions

- Two source files, no migration, no ordering constraints.
- `packages/shared` must be rebuilt (`pnpm -r build`) before the API integration tests, because they resolve `@mth/shared` from its build. Run 6 did this.

## What remains

Nothing in this task's scope is left. The orchestrator still has to re-run V9 (the full integration suite) on the merged tree. I did not run it, as the brief allows.
