# Handback T-DG4-BE-E (backend-workflow-engineer): budget lines, execution tracking, durations and the critical path

- **Stage:** DG4 (P4 "Execution value and sustainment"), slice E, p4-work-split §E.3.
- **Invocation:** `DG4-T-DG4-BE-E-backend-workflow-engineer-20261009T082554Z-59a48e65` (session `59a48e65-d490-456f-9ff4-4fbbe36b7792`).
- **Base:** branch `dg4/be-e` at `56c85b687f0238b2353cfaeb48fdc88eb053eb6e` (verified with `git rev-parse HEAD` before writing). The changes are **uncommitted**, as the assignment asks.
- **Time:** started `Fri Oct 9 08:26:12 UTC 2026`; ended Fri Oct  9 09:14:52 UTC 2026 (see §7).
- **Requirement rows:** REQ-S09-007, REQ-S09-009.
- **Migrations:** none. BE-E has no migration number (§E.4). It uses `0042` and `0043` (architect, frozen) as they are.
- **Approvals:** nothing here is a business approval. No G1–G6 or Finance decision is recorded, and nothing reads or writes DG0–DG7. All test data is synthetic.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, **exit 0**. It ran at the start ([`validate-dg3-start.log`](T-DG4-BE-E-evidence/validate-dg3-start.log)) and again at the end ([`validate-dg3-end.log`](T-DG4-BE-E-evidence/validate-dg3-end.log)).

## 2. Changed files

**Modified:**

| File | Purpose |
|---|---|
| `apps/api/src/modules/portfolio/budget.ts` | Replaces the BE-A stub. It holds `listBudgetLines`, `createBudgetLine`, `getBudgetLine`, `updateBudgetLine`, `archiveBudgetLine` and `getInitiativeExecution`, plus the decimal.js totals per currency (`budgetTotals`), the amount and month refusals, and the execution view: milestones with the working-day slip, deliverables, demand vs capacity, dependencies, decisions and `onCriticalPath`. |
| `apps/api/src/modules/portfolio/schedule-network.ts` | Replaces the BE-A stub. It holds `getScheduleNetwork`, `createInitiativeSchedule` and `updateInitiativeSchedule`. `loadScheduleNetwork` reads the canonical `dependency` edges read-only. |
| `apps/api/src/modules/platform/db-errors.ts` | Adds the BE-E lines of the slice E block in `mapP4RaidError` (ADR-0031 §11). The only diff is +23 lines before `default:`. |
| `packages/shared/src/calc.ts` | Adds the `schedule/**` export line after KBE-A's lines. |
| `packages/shared/src/schemas/index.ts` | Adds the `execution.ts` export line. |
| `apps/api/test/support/p4-pending-be-e.ts` | Pending list emptied: 9 → 0. |
| `apps/api/test/integration/contract/p4-exercises-be-e.ts` | Exercises all 9 operations through `ctx.mirrored`, with the `P4_MIRRORS_BE_E` zod mirrors. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[210, 209, 1]` → `[215, 214, 1]`, with its comment line. Nothing else changed. |

**New:**

| File | Purpose |
|---|---|
| `packages/shared/src/schedule/working-day-slip.ts` | Pure `computeWorkingDaySlip(approved, forecast, calendar)` (ADR-0031 §7). |
| `packages/shared/src/schedule/critical-path.ts` | Pure `computeCriticalPath(nodes, edges)`, algorithm `cpm-fs/1` (ADR-0031 §8). |
| `packages/shared/src/schedule/index.ts` | The `schedule/**` barrel that `calc.ts` re-exports. |
| `packages/shared/src/schedule/working-day-slip.test.ts` | 11 unit tests: the §7 examples +5 / +4 / −5 / 0, plus edges and the Unknown reasons. |
| `packages/shared/src/schedule/critical-path.test.ts` | 13 unit tests: the §8 fixture, the missing-duration refusal, cycle, truncation and shapes. |
| `packages/shared/src/schemas/execution.ts` | Zod mirrors of `BudgetLine*`, `Execution*`, `InitiativeExecution`, `WorkingDaySlip`, `Schedule*` and `InitiativeSchedule*`, plus the §11 refusal texts (`BUDGET_LINE_REFUSALS`). |
| `apps/api/src/modules/portfolio/budget.test.ts` | 13 unit tests: `100000 × 0.02 × 50 = 100000.00`, `0.1 + 0.2 = 0.3`, totals and Unknown, the amount and month refusals, and the db-error last lines. |
| `apps/api/test/integration/portfolio/budget.test.ts` | 13 integration tests (budget lines). |
| `apps/api/test/integration/portfolio/execution.test.ts` | 10 integration tests (the execution view). |
| `apps/api/test/integration/portfolio/schedule-network.test.ts` | 10 integration tests (network and durations). |
| `apps/api/test/integration/portfolio/execution-fixtures.ts` | Test fixtures shared by the three files above and the contract exercises. See §6, item 1. |

## 3. Operations routed (delta to `p4-pending-be-e.ts`)

All **9 → 0**. Each one is exercised in `p4-exercises-be-e.ts`.

| Operation | Route | Permission | Request media type (`config.consumes`) |
|---|---|---|---|
| `listBudgetLines` | `GET /api/v1/initiatives/{initiativeId}/budget-lines` | `transformation.read` | – |
| `createBudgetLine` | `POST /api/v1/initiatives/{initiativeId}/budget-lines` | `budget.edit` (TL, FIN) | `application/json` |
| `getBudgetLine` | `GET /api/v1/budget-lines/{budgetLineId}` | `transformation.read` | – |
| `updateBudgetLine` | `PATCH /api/v1/budget-lines/{budgetLineId}` | `budget.edit` | `application/json` |
| `archiveBudgetLine` | `POST /api/v1/budget-lines/{budgetLineId}/archive` | `budget.edit` | `application/json` |
| `getInitiativeExecution` | `GET /api/v1/initiatives/{initiativeId}/execution` | `transformation.read` | – |
| `getScheduleNetwork` | `GET /api/v1/transformations/{transformationId}/schedule-network` | `transformation.read` | – |
| `createInitiativeSchedule` | `POST /api/v1/initiatives/{initiativeId}/schedule` | `roadmap.edit` (TL, WL, TO) | `application/json` |
| `updateInitiativeSchedule` | `PATCH /api/v1/initiatives/{initiativeId}/schedule` | `roadmap.edit` | `application/json` |

**Media-type pin delta:** +5 operations with a body, all `application/json`. The pin goes from `[210, 209, 1]` to `[215, 214, 1]`.

## 4. Behaviour delivered, per requirement row

### REQ-S09-007

Acceptance (quoted): **"A05: budget/actual/forecast use decimal SAR; forecast slip vs approved date is shown in working days"**. Row output: "Execution tracking fields per initiative with variance display".

**Decimal SAR**
- Amounts are `numeric(20,4)` in the database, `DecimalString` on the wire and decimal.js (`Money` clone) in code. No float is used.
- An amount that is negative, or has more than 16 integer or 4 fraction digits, gets 422 `budget_line.amount_invalid` with the exact §11 text, at its field. A JSON number gets 400.
- The line's currency is `organization.default_currency` at creation (SAR by default) and is never a request field. Changing the default later never rewrites a line (S-5).
- Proofs:
  - `budget.test.ts` (integration): the round-trip `"0.1"` → `"0.1000"`, `"100000.25"` → `"100000.2500"`; the currency test, with SAR, then USD after a default change, and the old line still SAR.
  - `budget.test.ts` (unit): `100000 × 0.02 × 50 = 100000.00`.
  - `execution.test.ts`: `0.1 + 0.2` gives the total `"0.3000"`.

**Unknown, never 0**
- A NULL amount is Unknown. A total is `known` only when every active line of that currency has the operand(s). Otherwise it is `{status: "unknown", amount: null, knownAmount, missingCount, reason: "missing_amounts"}`, and `knownAmount` is null when no line has the operand.
- An initiative without active lines gets `budgetLineCount: 0`, `budgetUnknownReason: "no_budget_lines"` and `budgetTotals: []`.
- Totals are per currency and never converted. Archived lines are excluded.
- Variances: `forecastVariance = forecast − budget` and `actualVariance = actual − budget`. A negative value stays exact, e.g. `-9999.5000`.

**Slip in working days**
- `slipWorkingDays` is computed by `computeWorkingDaySlip` over the organization's active default business calendar: its workweek plus its administered holidays (ADR-0025 §1). Nothing is hard-coded.
- The four ADR-0031 §7 examples, on Sunday–Thursday:
  - approved 2026-10-08, forecast 2026-10-15 → **+5**;
  - the same with an administered holiday on Sun 2026-10-11 → **+4**;
  - approved 2026-10-15, forecast 2026-10-08 → **−5**;
  - approved = forecast → **0**.
- These are proven in the unit test and, through the API, in `execution.test.ts`. The holiday is added through the calendar API, so it is recomputed on read.
- The DG3 calendar-day variance is unchanged and shown beside the slip as `calendarVarianceDays` (7 / −7 / 0).
- Unknown, with a reason, never a calendar-day value: `approved_date_missing`, `forecast_date_missing`, `calendar_not_configured` (proven before the calendar exists) and `range_too_long` (more than 3,660 calendar days; unit test).

**The other M0184 fields, read from their canonical records**
- deliverable acceptance (active deliverables);
- FTE demand against capacity: `availableFte` from the active capacity row of the role and month, otherwise `capacityStatus: "unknown"` and `availableFte: null`;
- incoming and outgoing non-archived T08 dependencies, with `impact` from the `0041` column;
- active `initiative_decision_link` → `decision`;
- `onCriticalPath`: `true` or `false` only when the network is computed, otherwise `null`.

**Authorization**
- AUD reads every operation. AUD, WL, TO and BO get 403 on every budget write.
- ADM-only users and outsiders get 404 on every operation, reads included.
- Every mutation:
  - re-checks `budget.edit` at commit time (`afterIdentity` test → 403, nothing written);
  - needs `If-Match` (428 when missing, 409 with `currentVersion` when stale; creates are version 1);
  - writes one audit event in the same transaction (`budget_line.create`, `.update`, `.archive`, with the field diff);
  - does no remote I/O in the transaction.

**Refusals (§11, exact texts)**
- `budget_line.amount_invalid` and `budget_line.period_invalid` (at `/periodMonth`): 422.
- `budget_line.duplicate`: 409, `urn:mth:problem:duplicate`. The label is compared case-insensitively. An archived line frees its label.
- `budget_line.archived`: 422 on update and on a second archive.
- The database last lines map the same codes (unit-tested).

### REQ-S09-009

Acceptance (quoted): **"A05: for a fixture network the computed critical path matches the expected chain; with missing durations no critical path is claimed"**. Row output: "Critical path is computed by a documented algorithm (zero total float) and only shown when inputs are complete".

**The algorithm**
- `computeCriticalPath`, version `cpm-fs/1`, is pure. It follows ADR-0031 §8:
  1. Kahn's topological order, with ties broken by code;
  2. a forward pass and a backward pass;
  3. `TF = LS − ES`; a node is critical if and only if `TF = 0`; an edge is critical if and only if both ends are critical and `EF(p) = ES(s)`;
  4. the paths are enumerated depth-first in code order, at most 20, then `truncated`.
- The network is computed on every read. Nodes are the initiatives that are not cancelled. Edges are non-archived canonical `dependency` rows with both initiative ends in the network. Nothing is stored.

**Fixture**
- The §8 network built through the API gives `criticalPaths = [[INI-01, INI-02, INI-04]]` and `P = 18`, with INI-03 at total float 6 (`schedule-network.test.ts`, and the unit test).

**Missing durations**
- Setting INI-03's duration to `null` through `updateInitiativeSchedule` gives:
  - `status: "not_computable"`, `reason: "missing_durations"`;
  - `missingDurations: [INI-03]`;
  - every node with `critical: null` and null offsets, every edge with `critical: null`;
  - `criticalPaths: []`;
  - the execution view's `onCriticalPath: null`.
- The same holds for an initiative without any `initiative_schedule` row (`execution.test.ts`, the contract exercise).

**Recompute**
- Changing INI-03 to 11 moves the path through INI-03 on the next read, with `P = 19`.
- Also covered: `no_initiatives` (empty transformation), `cycle` (unit), a cancelled initiative excluded, an external predecessor adding no edge.

**Durations**
- `createInitiativeSchedule` twice gives 409 `initiative_schedule.exists` with the exact text.
- `updateInitiativeSchedule` with no row gives 404.
- 0–2600 or null is accepted. Anything else gives 400.
- `If-Match` 428/409, and audit events `initiative_schedule.create` and `.update`.
- TL, WL and TO may write. AUD, FIN and BO get 403. ADM-only users and outsiders get 404.
- `roadmap.edit` is re-checked at commit time (403, nothing written).

### Shared rules (§1)

| Rule | How it is met |
|---|---|
| S-1 | `label` and `note` use `freeText`. The reason uses the shared `reasonRequest`. A blank label is 400 (tested). |
| S-2 | The platform parser is used; there is no route-local parser. |
| S-3 | `config.consumes = ["application/json"]` on all 5 body routes. This is checked by the contract media-type suite. |
| S-4 | See the authorization proofs above. |
| S-5 | Decimal only, with a per-row `currency` copied at creation. |
| S-6 | Problem `code`s are i18n keys. No sentence is stored. |
| S-9 | The formula engine is untouched. |
| S-10 | The pending list is empty, and every operation is exercised. |
| S-11 | The texts are exactly as in §11. |
| S-12 | No migration. |
| S-13 / S-14 | Not applicable: no job and no approval. |

## 5. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, in the worktree `/home/user/wt/dg4-be-e`. PostgreSQL 16.13 is the disposable cluster from `tests/qa/support/with-pg.sh` (UTF8, C locale), on ports 23650–23699.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` | `validate-dg3-start.log` |
| 2 | `pnpm -r typecheck` | 0 | – | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | – | `build.log` |
| 4 | `pnpm lint` | 0 | `eslint . --max-warnings=0` | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 570 operations`. The contract file is unchanged by this task. | `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | Invocation 1: 109 files, **2125 passed**. Invocation 2 (no-codegen): 3 files, **259 passed, 2 skipped**. | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | Same counts: **2125** and **259 + 2 skipped**. | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=23655 MTH_PORT_POOL=23656-23699 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **95 files, 1128/1128 passed** on the first run, with no failure, flake or timeout | `integration.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | – | `validate-dg3-end.log` |

The unit count went from 2088 (D-099 baseline) to 2125, i.e. +37: 11 slip, 13 critical-path and 13 budget unit tests.

The integration delta is 1095 (D-099) → 1128, i.e. +33, all from the 3 new files: budget 13, execution 10, schedule-network 10. The contract test count is unchanged (45). Its media-type pin moved by +5 / +5 / 0.

**Non-zero exits during the work, disclosed:**
- **Typecheck, first run: exit 2.** `execution.test.ts` read keys of an `Object.fromEntries` result with dot access (TS4111). I fixed it with a typed record, and the rerun is #2 above. That first log was overwritten by the rerun.
- **Unit tests, first run: exit 1 in both locale settings.** One failure each: `apps/api/src/architecture.test.ts` ("API module boundaries"). It flagged:
  - computed member keys in `budget.ts` and `budget.test.ts`;
  - an import of `../platform/db-errors.ts`, which is not public.

  The fix: the amount checks now name each field explicitly, the refusal texts use literal keys, and the unit test uses the public `mapDatabaseGuardError` from `platform/index.ts`. Both failing logs are kept as `unit-locale-unset.run1-FAILED.log` and `unit-c-utf8.run1-FAILED.log` (each: 1 failed, 2124 passed). The reruns are #7 and #8.
- **Targeted runs during development, all green on their first run:** the 3 new integration files (33/33), the contract suite alone (45/45) and the new unit files (37/37). Kysely printed one deprecation warning (`orderBy(expr, modifier)`), and I removed it.

## 6. Notes, decisions and contract or schema needs for the orchestrator

1. **A new file outside the listed set: `apps/api/test/integration/portfolio/execution-fixtures.ts`.** It is a fixture helper used by my three test files and my contract seam. No other task owns it and it conflicts with nothing. Its alternative was to duplicate the helpers four times. Please confirm or reassign it.
2. **The unit test `apps/api/src/modules/portfolio/budget.test.ts`** sits next to my own module and holds the "`100000 × 0.02 × 50 = 100000.00` in a unit test" proof that §E.3 asks for.
3. **Merge conflict to expect in `platform/db-errors.ts`.** BE-D2 also appends its corrective lines to `mapP4RaidError`, at the same place (before `default:`). Resolve by keeping both blocks: §E.3 says the corrective lines come first, then BE-E's.
4. **Interpretations that the ADR leaves open:**
   - the `reason` string of an unknown `ExecutionAmount` is `"missing_amounts"`;
   - a known amount reports `knownAmount = amount` and `missingCount = 0`;
   - `listBudgetLines` without `status` lists both active and archived lines;
   - the execution view lists non-archived resource demand only;
   - critical paths are taken *maximal* (from a node with no incoming critical edge to one with no outgoing critical edge). This matters only for zero-duration nodes, which would otherwise yield prefix paths.
5. **No `initiative.read_only` refusal on budget or duration writes for cancelled or completed initiatives.** ADR-0031 §11 lists no such refusal (S-11 exact refusals), so none was added. If the orchestrator wants the DG3 read-only rule here, it is an ADR amendment.
6. **No contract or schema change is needed.**

## 7. What remains

Nothing in §E.3 remains. Downstream consumers are listed in §E.5: FE-D renders the panels and never styles "critical" when `status` is `not_computable`, and QA slice L covers A05.

End time: Fri Oct  9 09:14:52 UTC 2026.
