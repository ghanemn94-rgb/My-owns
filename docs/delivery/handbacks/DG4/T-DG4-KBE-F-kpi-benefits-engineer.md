# Handback T-DG4-KBE-F (salvage run T-DG4-KBE-FB): kpi-benefits-engineer

- **Stage:** DG4 (BUILDING). **Section:** `docs/architecture/p4-work-split.md` §F+G FG.3.
- **Invocation:** `DG4-T-DG4-KBE-FB-kpi-benefits-engineer-20261009T133114Z-7d654621` (session `7d654621-4490-4f22-a865-903374284392`).
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-FB.md`, SHA-256 `21d39f88…6e6d7f` (verified).
- **Tree:** `/home/user/wt/dg4-kbe-f`, branch `dg4/kbe-f`, `HEAD` `6a07de4` (the orchestrator's WIP commit on top of `489712f`). My changes are uncommitted: only this handback and its evidence folder.
- **Time:** start `2026-10-09T13:31:36Z` (`date -u`). End time: section "End of run".

## STATUS: COMPLETE. Every acceptance check exits 0 on the final tree (after a disk-full interruption)

**The interruption.** The shared volume behind the worktree and my `$TMPDIR` (`/dev/vda`, mounted at `/`) went from 47 MB free at 13:35Z to 0 bytes free at about 13:51Z. The evidence is in `T-DG4-KBE-F-evidence/disk-full.log`, `focused-ENOSPC.log` and `unit-locale-unset-ENOSPC.log`.

- **What failed then:**
  - PostgreSQL `initdb` failed with `No space left on device`;
  - the first `pnpm test` aborted with 77 `ENOSPC` errors from Vitest's cache writes.
  
  Those two runs are environment failures and **are not counted**.
- **What I did:** I deleted only my own scratch: the Vitest temp directory, the node compile cache and my log copies. The old worktrees and the other agents' scratch on that volume are not mine. `/dev/shm` was writable, but it is outside the areas this run was given, so I did not use it.
- **Recovery.** A background poll saw 7.9 GB free at 14:25:07Z (`disk-after.log` records the space at the end). I then re-ran every acceptance check from scratch on the final tree (section "Checks"). All exited 0.

## Salvage

**Kept from the WIP:** everything, unchanged. I reviewed it file by file against FG.3, ADR-0033 §2–§4, §6, §8–§12, migration `0047`, `openapi.yaml` 1.3.0-p4, D-102 and S-1…S-14, as if someone else had written it. I found no defect that needed a code change:

- **Contract.** The zod mirrors in `schemas/adoption-indicators.ts` match the OpenAPI schemas field by field: `AdoptionIndicatorTemplate`, `AdoptionMetricLink`, `AdoptionMetricLinkCreate` (with the documented cross-field rules), `AdoptionMeasureValue` and `AdoptionIndicatorReport`.
- **Database error mapping.** Every constraint name mapped in the `db-errors.ts` KBE-F block exists in `0047`. The unique-index backstop of the KPI name, `kpi_definition_name_key`, is `lower(name) WHERE status <> 'archived'`, exactly the WIP's pre-check.
- **Worker twin.** The worker's `createBelowTrajectoryIntervention` is line-for-line BE-H's API service, except for:
  - the id source (`mth_uuid_v7()` instead of the `uuid` package);
  - the code counter (an inlined copy of `nextAdoptionCode`);
  - the calendar read (an inlined copy of `computeWorkingDayDueDate`, which reads a holiday superset and gives the same result).
  
  The parity test (`indicators.test.ts`, "D-102 parity") compares the intervention, work item, audit and outbox rows of both paths.
- **Below-trajectory rule.** It matches ADR-0033 §4 step 2 exactly: `deviation = adverse` and RAG `amber` or `red`. Green, Unknown, Stale and Not computable never create an intervention.
- **Relay.** Every single-queue event keeps job id = event id, so it is byte-stable. A fanned-out event gets one deterministic, distinct UUIDv8 per (event, queue), and every send happens in the one transaction before the mark.

**Changed:** nothing in the code. **Added:** this handback and fresh evidence logs. The killed run's evidence folder was empty, so there were no stale logs to delete.

**Verified by this run:** the WIP's tests, which had never run, pass on their first run here: 74/74 in the four focused files, then inside the full suites below.

## Changed files (relative to `489712f`; all from the WIP commit `6a07de4`)

| File | Purpose |
|---|---|
| `apps/api/src/modules/adoption/indicators.ts` | The 5 operations: templates, list, create (incl. `createKpi`) and remove links, and the indicator report |
| `apps/api/src/modules/platform/db-errors.ts` | The metric-link lines of the slices F/G block |
| `packages/shared/src/adoption/measures.ts` (+ `.test.ts`, 24 tests) | Pure measures: training completion, observed proficiency, latest observation per subject, the weighted ratio, `isBelowTrajectory` |
| `packages/shared/src/calc.ts` | One export line (after BE-F's) |
| `packages/shared/src/schemas/adoption-indicators.ts`, `schemas/index.ts` | The zod mirrors and their export line |
| `apps/worker/src/handlers/adoption.ts` | The `adoption.indicator_evaluated` consumer and the worker twin of `createBelowTrajectoryIntervention` (D-102 item 2) |
| `apps/worker/src/queues/adoption.ts` | The queue and the `kpi.deviation_evaluated` → `adoption.indicator_evaluated` entry |
| `apps/worker/src/queues/index.ts` | `QUEUES_FOR_EVENT` (event → list of queues). `QUEUE_FOR_EVENT` is kept as a first-queue view (D-102 item 1) |
| `apps/worker/src/queues/raid.ts` | Comment only (the D-102 fan-out note) |
| `apps/worker/src/relay.ts` | All-or-none fan-out in one transaction, `fanOutJobId` and `jobsForEvent` |
| `apps/api/test/integration/adoption/indicators.test.ts` | API proofs: REQ-PB-071, REQ-PB-072, REQ-S11-002, REQ-PB-069 and the parity test |
| `apps/api/test/integration/adoption/entity-group-metric-link.test.ts` | REQ-S16-020: the AdoptionMetricLink case (D-102 item 3) |
| `apps/worker/test/integration/adoption-below-trajectory.test.ts` | Registry, relay fan-out, retry, all-or-none, no-queue failure, and the consumer cases |
| `apps/api/test/support/p4-pending-kbe-f.ts` | Emptied |
| `apps/api/test/integration/contract/p4-exercises-kbe-f.ts` | The 5 operations through the validating client |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[257, 256, 1]` → `[258, 257, 1]` |

## Behaviour delivered, per requirement row (each proof passes in the integration run below)

- **REQ-PB-071**, acceptance: *"A11: all seven indicators are available by name; an actual below trajectory creates a corrective intervention"*.
  - `listAdoptionIndicatorTemplates` (any signed-in user) returns the eight `0047` measure rows of the seven B0109–B0115 indicators verbatim. Indicator 4 has two measures.
  - A below-trajectory evaluation creates one `corrective` intervention through the consumer.
- **REQ-PB-069**, acceptance: *"A11: an initiative with delivery Complete and adoption below trajectory shows adoption at risk and triggers an intervention; an adoption actual below trajectory creates exactly one intervention"*.
  - **My half.** One intervention per (link, scope, period), with one work item and one `adoption.check_failed`. A redelivery, or a second evaluation of the same KPI, scope and period, returns `existing` or `duplicate` and writes nothing. Green, Unknown, Stale and Not computable evaluations create none.
  - **Not mine.** The "adoption at risk" status read belongs to BE-J (FG.6).
- **REQ-PB-072**, acceptance: *"A11: 100% training completion with no proficiency observations shows proficiency Unknown, not adopted"*.
  - `getAdoptionIndicators` returns `training_completion` `"1.000000"` (2/2) and `observed_proficiency` `{value: null, valueStatus: "unknown", valueReason: "adoption.no_proficiency_observations"}`.
  - Completion is never an input to proficiency (seeded property test).
- **REQ-S11-002**, acceptance: *"A11: a proficiency observation submitted via the form links to the stakeholder group and counts in the proficiency indicator"*.
  - **The count half (mine).** Observations of the group count by the latest observation per subject (`0.500000`, 1/2). Withdrawn observations do not count.
  - **Limitation.** The test writes the `assessment_record` rows directly with their audit events, because BE-H2's `createAssessmentRecord` route is not merged. The route half is BE-H2's (FG.2).
- **REQ-S16-020** (AdoptionMetricLink), acceptance: *"…an integration test creates and reads each one through the API with authorization enforced"*.
  - `entity-group-metric-link.test.ts` covers create and read through the API, with key, owner (`created_by`) and status.
  - It covers AUD 403 on the write, and 404 on write and read for an ADM-only caller and for an outsider.

## Checks (real exit codes; logs in `T-DG4-KBE-F-evidence/`)

| # | Command | Exit | Result |
|---|---|---|---|
| 4 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` |
| 1 | `pnpm -r typecheck` | 0 | all packages Done |
| 1 | `pnpm -r build` | 0 | |
| 1 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" |
| 1 | `pnpm openapi:lint` | 0 | 607 operations |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | 0 | Run 1 (unit-node + unit-web): 119 files, **2282 passed**. Run 2 (unit-formula-nocodegen): 3 files, **259 passed, 2 skipped**. `unit-locale-unset.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | The same: **2282**, and **259 + 2 skipped**. `unit-c-utf8.log` |
| 3 | `QA_PG_PORT=24300 MTH_PORT_POOL=24301-24349 tests/qa/support/with-pg.sh npx vitest run --project integration` on my 3 test files + `contract.test.ts` | 0 | 4 files, 74/74. `focused.log` |
| 3 | `QA_PG_PORT=24300 MTH_PORT_POOL=24301-24349 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 119 files, **1312/1312**. No port retry, no flaky or retried test. `integration.log` |

**Disclosed non-zero exits (environment, not counted):** before the volume was freed, an earlier `pnpm test` (locale unset) aborted with `ENOSPC` (`unit-locale-unset-ENOSPC.log`), and an earlier focused `with-pg.sh` run exited 1 because `initdb` hit `No space left on device` (`focused-ENOSPC.log`). The static checks first ran at 13:35–13:38Z, then again on the final tree at about 14:55Z. The logs are from the second run.

**Counts against the D-102 baseline** (unit 2258, integration 1283):
- unit +24, from `measures.test.ts`;
- integration +29: `indicators.test.ts` 14, `adoption-below-trajectory.test.ts` 14, `entity-group-metric-link.test.ts` 1;
- the `contract.test.ts` test count is unchanged (45).

**Pinned-count change:** media-type pin +1 JSON body (`createAdoptionMetricLink`; `removeAdoptionMetricLink` has no body): `[257, 256, 1]` → `[258, 257, 1]`. It passes in `contract.test.ts`.

## Operations routed (delta to `p4-pending-kbe-f.ts`)

The list goes from 5 entries to 0: `listAdoptionIndicatorTemplates`, `listAdoptionMetricLinks`, `createAdoptionMetricLink`, `removeAdoptionMetricLink` and `getAdoptionIndicators`. Each is exercised in `p4-exercises-kbe-f.ts`.

## Contract or schema needs for the orchestrator

1. **No migration needed.**
2. **Slice A exposes no KPI create service.** `kpi/index.ts` exports none; the insert is inline in the `createKpiDefinition` route. So `createKpi` inserts the `kpi_definition` row in `indicators.ts` with the same columns, the same `kpi_definition.create` audit event, the same audit field list (copied from the private `repository.ts` list) and the same 409 `duplicate.name`. Proposal: KBE (slice A owner) exports a `createKpiDefinitionRow(tx, …)` from `kpi/index.ts`, and `indicators.ts` then calls it. This is a reviewer point on FG.3's "slice A's KPI create service" wording.
3. **Refusals outside ADR-0033 §10, for architect acceptance and FE-E translation:**
   - removing an already-removed link → 422 `invalid_transition` "This metric link is already removed.";
   - a target or KPI outside the transformation → 422 `validation.reference`;
   - `getAdoptionIndicators` without a reporting period when the organization has no open or closed period → 422 `validation.required` at `/reportingPeriodId`.
4. **Location header.** `createAdoptionMetricLink`'s 201 `Location` is `…/adoption-metric-links/{id}`, but the contract has no single-link GET. Either add `getAdoptionMetricLink` or accept the header as is.

## What remains

1. Nothing in FG.3's own scope.
2. Outside my scope:
   - BE-H2's route-based half of REQ-S11-002 (FG.2: an observation submitted through `createAssessmentRecord`). My count test writes the record rows directly.
   - BE-J's "adoption at risk" read for REQ-PB-069 (FG.6).
3. The reviewer and orchestrator points under "Contract or schema needs" (2–4).

## End of run

- **Start:** `2026-10-09T13:31:36Z`. **End:** `2026-10-09T14:57:38Z` (`date -u`), about 86 minutes.
- **Pause:** from 13:51Z to 14:25Z the volume was full and nothing could run. I waited for space and did not use any area outside my sandbox.

## Merge instructions

- No migration.
- **Expected conflicts:**
  - `platform/db-errors.ts` (the slices F/G block: BE-H2, BE-I2 and BE-G edit nearby lines; keep every case once and keep the explicit `return problems.internal()` boundaries);
  - `schemas/index.ts` and `calc.ts` export lines (union);
  - the media-type pin (add +1 to the other tasks' deltas).
- `relay.ts` and `queues/index.ts` are mine under D-102.
