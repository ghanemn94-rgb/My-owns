# Handback T-DG2-KBE2: kpi-benefits-engineer (DG2 round-1 repairs: F-DG2-141, F-DG2-201)

- **Stage / gate:** P2 / DG2 (FIXING). Branch `claude/mobily-transformation-platform-regate`.
- **Assignment:** `docs/delivery/assignments/DG2/round-2/T-DG2-KBE2.md`. I checked its sha256 (`313c2089…6d006fa`) before starting, and it matched.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-KBE2-kpi-benefits-engineer-20261002T105230Z-6ae76169","session_id":"6ae76169-3d7e-4ab4-8f00-3fbbc1eddb3e"}`.
- **Base revision:** `HEAD = 96f736c` ("DG2 round-2 repair assignments (BE3, KBE2, AN-P2)").
- **Scope kept:** I wrote only to KBE-column files (`apps/api/src/modules/kpi/**`, `apps/api/test/integration/kpi/**`, `apps/api/test/integration/contract/kpi-exercises.ts`) and this handback. I did not touch any of these:
  - `modules.ts`, `server.ts`, `contract.test.ts`, `p2-pending.ts`;
  - migrations, `schema.ts`, `docs/api/openapi.yaml`;
  - BE's modules or `apps/web/**`.

  `packages/shared/src/schemas/kpi.ts`, `value.ts` and `p2-pending-kpi.ts` needed no change (see F-DG2-201).
- **No business approval was granted.** Trajectory approval (SP/BO) and KPI activation are user actions inside the product. Product gates G1–G6 are separate from the DG0–DG7 delivery gates.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/kpi/rules.ts` | New pure rules. **`TRAJECTORY_CONTENT_FIELDS`** and **`trajectoryAuthors(events, createdBy)`** work out who authored the current trajectory (F-DG2-141). **`kpiDefinitionActivationRule`** holds the activation preconditions (F-DG2-201). |
| `apps/api/src/modules/kpi/repository.ts` | New `outcomeKpiChangeEvents(db, id)`: the outcome_kpi row's audit events that carry a diff, newest first, read from the append-only `audit_event` table. |
| `apps/api/src/modules/kpi/outcome-kpis.ts` | `trajectory-approval` now refuses with **403 `kpi.target_author_cannot_approve`** (an audited `authorization.denied`) any approver who authored part of the current trajectory. The existing creator rule is kept. |
| `apps/api/src/modules/kpi/kpi-definitions.ts` | New route **`POST …/kpi-definitions/{kpiDefinitionId}/activate`** (`activateKpiDefinition`, permission `kpi_definition.edit`). |
| `apps/api/src/modules/kpi/routes.ts`, `index.ts` | Comments only: 24 kpi operations instead of 23. |
| `apps/api/src/modules/kpi/kpi.test.ts` | `activateKpiDefinition` added to the expected operation set (24 routes, each matched against `openapi.yaml`, and its permission against the contract summary). |
| `apps/api/src/modules/kpi/rules.test.ts` | +13 unit tests: trajectory authorship (worked event fixtures) and the activation rule, field by field. |
| `apps/api/test/integration/kpi/kpi-dg2-repairs.test.ts` (new) | 11 integration tests: the F-DG2-141 repro and its regressions, and the F-DG2-201 activate cases, including the live G2 criterion. |
| `apps/api/test/integration/kpi/kpi-aud-write-deny.test.ts` | The AUD sweep (generated from `openapi.yaml`) now covers **16** kpi mutations, `activateKpiDefinition` included. |
| `apps/api/test/integration/contract/kpi-exercises.ts` | Exercises `activateKpiDefinition` through `ctx.mirrored`: 428, 409, 403 (auditor), a 200 parsed with the `kpiDefinition` zod mirror, then 422 for an already-active definition. |

## 2. Behaviour delivered

### F-DG2-141 (High, REQ-S10-001): separation of duties on trajectory approval

- **Rule:** a person may not approve a T02 target trajectory if they **set or last changed any part of the current trajectory**. This is checked in addition to the existing rule that the row's creator cannot approve (`kpi.creator_cannot_approve`).
- **The trajectory content** is `kpi_definition_id`, `baseline_id`, `baseline_value`, `target_value`, `target_date` and `trajectory_points`. Changing any of these changes what gets approved.
- **How authorship is derived:**
  - For each content field, the author is the actor of the **newest** audit event whose diff touched that field. A user acting on behalf of someone counts both people as authors.
  - A field that no event touched still holds its creation value, so its author is the creator.
  - The `audit_event` table is append-only and is written in the same transaction as every outcome_kpi mutation. The approval reads it while holding the row lock (`FOR UPDATE`), so the trail matches the row.
  - Edits to other columns (owner, ordinal, leading indicator text) and to the approval fields never make someone an author.
- **Refusal:** 403 with code `kpi.target_author_cannot_approve`. It goes through the existing `creatorDenied` path, so the request writes exactly one `authorization.denied` audit row (actor BO, record = the T02 row) and the row's version does not change.
- **Legitimate approvers:**
  - SP approves a row that BO changed.
  - BO can approve once someone else has replaced every trajectory part BO had set.
  - BO can approve after editing only non-trajectory columns.
- **Repro test** (the finding's scenario): TL creates the row with target `100` (v1). BO PATCHes target `5` (200, v2). BO approves → **403** `kpi.target_author_cannot_approve`. The version stays 2, the request's only audit row is the denial, and the row is still `draft` in both the API and `loadKpiGateFacts`. SP then approves → 200 `approved`.
- **Negative control:** I put the HEAD (`96f736c`) `outcome-kpis.ts` back into the disposable clone and ran the new suite. The 3 refusal tests **failed**: the BO approval returned 200. This confirms the bypass and that the tests catch it. Then I restored the fixed file.
- **No database CHECK (request to BE):** the finding suggests the database should also enforce this rule. That needs a schema change (for example a `target_set_by` column and a CHECK or trigger `trajectory_approved_by <> target_set_by`). Migrations are outside my scope, so the rule is enforced in the API only. **I ask BE to add it, if wanted, in a new migration.** The current API rule stays correct either way.

### F-DG2-201 (High, REQ-PB-017): KPI definitions can reach `active`

- **Route:** `POST /api/v1/transformations/{transformationId}/kpi-definitions/{kpiDefinitionId}/activate` (`activateKpiDefinition`, `kpi_definition.edit`, no request body, as the contract specifies). It uses the shared mutation order:
  1. read gate (404);
  2. action gate (403, audited; AUD, FIN, SP and BO are all denied);
  3. transformation not archived (422);
  4. If-Match (428 if missing, 400 if malformed);
  5. row lock, then version check (409 with `currentVersion`);
  6. archived definition → 422 `kpi_definition.archived`;
  7. `kpiDefinitionActivationRule`;
  8. `UPDATE … status='active', version+1 … WHERE version = :v AND status = 'draft'`;
  9. **exactly one** `kpi_definition.activate` audit event, diff `{status: {from: "draft", to: "active"}}`.
- **Activation rule (422):**
  - already active → `kpi_definition.already_active`;
  - any other non-draft status → `kpi_definition.not_draft`;
  - missing unit kind or polarity, or a currency unit without a currency → `kpi_definition.not_measurable`. The database already forbids all three; the rule checks them anyway as a defensive step.
  - unit kind `other` without a unit label → `kpi_definition.not_measurable` with pointer `/unitLabel`. This is the same rule that makes gate facts report `hasUnit`.
- **After activation:** an active definition can still be edited and stays `active`. Archiving works as before.
- **Zod mirror:** none was needed. The success body is the existing `KpiDefinition`, whose mirror `kpiDefinition` already allows `status: "active"`, and the operation has no request body. `packages/shared/src/schemas/kpi.ts` is unchanged.
- **`p2-pending-kpi.ts`:** `P2_PENDING_KPI_OPERATIONS` is **empty** (`[]`). The orchestrator's contract commit `65ed206` never added `activateKpiDefinition` to it, so there was nothing to remove. It is now routed (`kpi-definitions.ts`) **and** exercised (`kpi-exercises.ts`, success plus zod mirror), so the list stays empty.
- **Gate facts:**
  - After activation, `loadKpiGateFacts` reports the definition as `{status: "active", hasUnit: true, polarity: "lower_is_better"}` (integration-tested).
  - In the live `GET /gates/G2`, the `g2.kpi_definitions` criterion lists `g2.kpi_definitions.not_active` for a T02-used draft definition (with an owner). After activation, **no** missing reason is left for it (integration-tested through BE's evaluator).

### Unchanged conventions

- There is still a single policy path for authorization.
- AUD gets 403 on all 16 kpi mutations (the generated sweep).
- Every mutation uses If-Match / 409, writes one audit event and increases the version by 1.
- There is no float anywhere: the ADR-0019 §4 source scan in `kpi.test.ts` still passes over the module.

## 3. Checks actually run

**Environment:** offline. Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`) and Node 22.22.2 (`/opt/node22/bin`), pnpm 10.33.0, PostgreSQL 16.13 disposable clusters via `tests/qa/support/with-pg.sh`.

**Where the checks ran:** the shared working tree contains other agents' concurrent, uncommitted edits (BE3: `platform/db-errors.ts`, `register-kit.ts`, `schema.ts`, migration `0019_…`; AN-P2: `requirements.csv`). So I ran every check in a **disposable clone** (`git clone` of `96f736c` into `$TMPDIR/kbe2`) with only my files copied in, plus the workspace's `node_modules`. A `diff -r` against the working tree reported "same" for every KBE path: `modules/kpi`, `integration/kpi`, `kpi-exercises.ts`, `p2-pending-kpi.ts`, `schemas/kpi.ts`, `value.ts`.

| # | Command (in the clone) | Result |
|---|---|---|
| 1 | `pnpm -r typecheck` (Node 24) | **exit 0**, all projects `Done` |
| 2 | `pnpm -r build` (Node 24) | **exit 0**: api/worker/db/shared/config/design-tokens `Done`, `apps/web ✓ built in 3.20s` |
| 3 | `pnpm lint` (`eslint . --max-warnings=0`) | **exit 0** |
| 4 | `pnpm format:check` | **exit 0**: "All matched files use Prettier code style!" |
| 5 | `pnpm test` (Node 24) | **exit 0: Test Files 29 passed (29), Tests 478 passed (478)**: `kpi/kpi.test.ts (18)`, `value.test.ts (29)`, `kpi/rules.test.ts (30)` |
| 6 | `npx vitest run --project unit-node --project unit-web` (Node 22.22.2) | **exit 0: 29 files, 478 tests passed**, same kpi/value suites |
| 7 | `QA_PG_PORT=55862 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/kpi` (Node 24) | **exit 0: 3 files, 52 tests passed**: `kpi-dg2-repairs (11)`, `kpi-resources (23)`, `kpi-aud-write-deny (18)` |
| 8 | Negative control: #7's repairs file against HEAD's `outcome-kpis.ts` (`QA_PG_PORT=55863`) | **3 failed / 8 passed**, as expected: the three F-141 refusal tests fail without the fix |
| 9 | `QA_PG_PORT=55864 tests/qa/support/with-pg.sh pnpm test:integration` (Node 24, full suite) | **exit 1: Test Files 2 failed / 25 passed; Tests 2 failed / 425 passed (427).** Both failures are hard-coded operation counts in **BE-owned** files that predate the orchestrator's contract change (see below). Every kpi suite passes. |
| 10 | `QA_PG_PORT=55865 … npx vitest run --project integration apps/api/test/integration/kpi apps/api/test/integration/contract` (Node 22) | **exit 1: 62 passed / 1 failed (63)**. The one failure is the same `contract.test.ts:480` count. |
| 11 | Baseline: the same contract + `aud-write-deny` tests at **HEAD without my change** (`QA_PG_PORT=55866`) | **4 failed**: the 2 counts, plus "maps every governed Fastify route to an OpenAPI operation" and `aud-write-deny` › `activateKpiDefinition … AUD gets 403`. **My change fixes the latter two** (the route now exists and the auditor gets 403). |
| 12 | `node tools/gates/validate.mjs --historical --stage DG1` (working tree) | **exit 0**: `PASS gate DG1 (historical)` |

**The two remaining failures (not KBE-owned):**
- `apps/api/test/integration/contract/contract.test.ts:480`: `expect(operations).toHaveLength(160)`, but the contract now has **161** operations (D-061 added `activateKpiDefinition`).
- `apps/api/test/integration/aud-write-deny.test.ts:199`: `expect(P2_OPERATIONS).toHaveLength(127)`, but there are now **128**.

Both need a one-line change to the count in their owner's file (backend-workflow-engineer). I did not edit them because they are outside my write scope.

Output tail of run 7:
```
[integration] PostgreSQL 16.13 …; applied 18 migrations to a fresh database
 ✓ |integration| apps/api/test/integration/kpi/kpi-dg2-repairs.test.ts (11 tests) 1204ms
 ✓ |integration| apps/api/test/integration/kpi/kpi-resources.test.ts (23 tests) 1225ms
 ✓ |integration| apps/api/test/integration/kpi/kpi-aud-write-deny.test.ts (18 tests) 683ms
 Test Files  3 passed (3)
      Tests  52 passed (52)
```
Output tail of run 9:
```
 FAIL  |integration| apps/api/test/integration/aud-write-deny.test.ts > … the generated list covers the P2 mutations (127 P2 operations in the contract)
 FAIL  |integration| apps/api/test/integration/contract/contract.test.ts > … covers every operation with at least one success and every successful body with its zod mirror
   ❯ aud-write-deny.test.ts:199  expect(P2_OPERATIONS).toHaveLength(127);
   ❯ contract/contract.test.ts:480  expect(operations).toHaveLength(160);
 Test Files  2 failed | 25 passed (27)
      Tests  2 failed | 425 passed (427)
```

**Not run:** the full integration suite in the shared working tree, because BE3's in-progress migration and schema edits are there. The clone run (#9) is the reproducible result.

**SHA-256 of the changed and new files at handback:**

| File | SHA-256 |
|---|---|
| `kpi/index.ts` | `6f0755a0d117978264af28fe039d5eeaf0d46b1dbd2816799c56b8fc679a3b85` |
| `kpi/kpi-definitions.ts` | `fdc0e91c211debbd7862cff6743de1972333f302941b8948f39137d380cfa4f1` |
| `kpi/kpi.test.ts` | `190dc023e219993106891d6f9577d45d03ba5060f0d5474cbc570ed9caa83aa0` |
| `kpi/outcome-kpis.ts` | `c14ccd60d033307b1e4a4f9139b9e0ffc7ca03ec448bc8bc405df19d146b2927` |
| `kpi/repository.ts` | `2051e4037099eb994697c42800b2b60682dc76f06461514232f37f1983e728d2` |
| `kpi/routes.ts` | `ac3a136f413130d156c3f40dd98a2a2c03d437e3920e062910a94eb3a623f22a` |
| `kpi/rules.test.ts` | `f8fce2bb016ba439ed8b4757ca51449f07224aeed90894a4e61f2215df40f1ae` |
| `kpi/rules.ts` | `d238683248dcfcc662b20a421daf6ad1b5bc9dd91bb9d677fbd4f9ca4d712a27` |
| `integration/kpi/kpi-aud-write-deny.test.ts` | `05ead495aa1db76087257fb9354205491a1cf2dd0b4e0e0cfe47144c196a5b79` |
| `integration/kpi/kpi-dg2-repairs.test.ts` | `b5c66577f60a744eabce308b50e1dae7d9e646aa4335d2484a311882df4a4ff8` |
| `integration/contract/kpi-exercises.ts` | `3acf4e63de67739e0507df9639cb564218b79f95cc0238677bf8bcfdcc878fd2` |

## 4. Known gaps / not done

1. **No database rule for F-141 (needs BE).** The trajectory-author rule is enforced in the API only. A database CHECK or trigger needs a migration, which is BE's scope; see the request in §2.
2. **Two count assertions in BE's files are stale (needs BE):** `contract.test.ts` 160→161 and `aud-write-deny.test.ts` 127→128. Until BE updates them, the full integration suite fails on exactly those two tests. Neither is a kpi behaviour failure.
3. **The live-G2 test depends on the platform's instantiation function.** It runs `p2_instantiate_transformation` (migration 0018) on its fixture transformation through the owner connection, because the kpi fixture inserts the transformation row directly. If BE changes that function's signature, this test needs a matching change.
4. I found no contradictions in the assignment. Its instruction to "remove `activateKpiDefinition` from `p2-pending-kpi.ts`" did not apply, because the entry had never been added; the list is empty as required.

## 5. Merge instructions

- No migrations. No changes to shared schemas, `value.ts`, the contract or the composition root.
- The changes stay inside the KBE files listed above. BE3 is editing other files concurrently (`platform/**`, `register-kit.ts`, `schema.ts`, migration 0019), so I expect no conflicts.
- After BE applies the two count updates (§4.2), re-run `pnpm test:integration`. Every kpi suite and the contract route-coverage test already pass.
- FE: the activate affordance can call `POST …/kpi-definitions/{id}/activate` with `If-Match` and no body. Error codes: `kpi_definition.already_active`, `kpi_definition.not_measurable` (with a pointer), `kpi_definition.archived`. A trajectory-approval refusal for an author is 403 `kpi.target_author_cannot_approve`.
