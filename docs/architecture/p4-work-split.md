# P4 work split: shared rules, file ownership, contracts and integration order

- **Plan:** `docs/architecture/p4-plan.md` (T-DG4-ARCH-00), adopted by D-089. This file holds one section per architecture task (p4-plan §4); each ARCH task writes only its own section. Section §I+C is written by T-DG4-ARCH-01 and section §A by T-DG4-ARCH-02 (solution-architect), 2026-10-09.
- **Stage:** P4 "Execution value and sustainment" (DG4).
- **Rule:** two tasks never edit the same file (REQ-DLV-008). Anything not listed under an owner is **frozen**; changes go through the orchestrator (p4-plan §5.3).
- **Off-limits to every implementer** (the write guard enforces it): `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, `docs/delivery/reviews/**`, `docs/delivery/gates/**`, `docs/delivery/stages.json`, `docs/delivery/findings.json`, `docs/delivery/candidates/**`, `docs/delivery/runs/**`, `docs/delivery/test-evidence/**`, `CLAUDE.md`, `trading_agent/**`.
- **Product gates G1–G6 are business approvals inside the product.** Nothing in P4 reads or writes the engineering gate records DG0–DG7. Product G6 never implies DG7, and no agent, seed or job grants a real business, Finance or IT approval. Seed and demo approvals are synthetic.

## 1. Shared rules for every P4 implementer task (the DG2 and DG3 lessons; reviewers check them)

- **S-1 Free text.** Every free-text field goes through the shared `freeText`/`hasText`/`hasInvalidCharacter` rules; truncation only through `truncateText`.
- **S-2 Strict UTF-8.** JSON and query parsing is strict UTF-8 on every route (the BE13 parser); no route-local parser.
- **S-3 `config.consumes`.** Every new route's `config.consumes` equals its operation's request media type in `docs/api/openapi.yaml` (all slice I+C bodies are `application/json`; the bodiless action POSTs `completeWorkItem` and `markInboxNotificationRead` declare none, the `activateKpiDefinition` precedent).
- **S-4 Every mutation** has: authorization re-checked at commit time; validation; `If-Match` (428 when missing, 409 when stale; creates are version 1); an audit event in the same transaction; no remote or client I/O inside the transaction; and a test of each of these.
- **S-5 Decimal only, and per-row currency.** Money, rates, FTE and KPI values are decimal strings and `numeric` columns, never floats. Unknown, Stale and Not computable are never shown as 0 or green. A table that stores money also stores its own `currency` (`char(3)`), copied from the organization default when the row is created; changing the default never rewrites rows (ADR-0025 §2).
- **S-6 Bilingual.** Arabic RTL and English LTR, translated at render time; problem `code`s are i18n keys and are translated too. Work items and reminders store `messageKey` + `messageParams`, never sentences.
- **S-7 Web forms.** One form-level alert per form; actions are session-bound (`auth/sessionBound.ts`); the AUD user sees read-only views; the label is "business approval", never DG0–DG7.
- **S-8 Ports and locale.** Harness ports stay below 32768; verification runs with the locale unset and with `C.UTF-8`.
- **S-9 Formula engine unchanged.** `packages/shared/src/formula/**` is reused as it is. Any change there is a reopen candidate (p4-plan seam 5).
- **S-10 Contract seams.** Each task removes its operations from its own `apps/api/test/support/p4-pending-<task>.ts` in the same change that routes them, and exercises each through the validating client in its own `apps/api/test/integration/contract/p4-exercises-<task>.ts` (BE-A creates the stubs and the `contract.test.ts` calls). All P4 pending lists are empty when the DG4 candidate freezes.
- **S-11 Exact refusals.** Problem codes and English `detail` texts are exactly those in the slice ADRs (for slices I and C: ADR-0025 §1, §3, §4; ADR-0026 §2–§7).
- **S-12 Migrations.** Forward-only; a merged migration is never edited. Migration numbers must stay **contiguous** (`packages/db/src/seed.test.ts` checks `ids == 1..n`), so a number left free in an ARCH range must be written before the next range's first file merges (§I+C.4).
- **S-13 Jobs and tasks.** Every job handler uses the kit's `runOnce(consumer, key, fn)` and every task or reminder is created with `createWorkItemOnce` (ADR-0025 §3–§4). A job's audit actor is `service`; a service actor never decides an approval.
- **S-14 Approvals.** A module that needs a business approval adds its `approval_type` row by migration and requests it through the approval service (`workflows/approvals.ts`) and, where T11 applies, `routeByDecisionRight`. No module writes `approval`, `approval_decision` or `approval_escalation` directly.

## §I+C. Slices I (foundation) and C (decision rights, RACI, approvals, delegation, groups) — T-DG4-ARCH-01

### I+C.0 Already delivered by the architect (do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADRs | `docs/architecture/adr/ADR-0025-p4-calendar-time-jobs-work-items.md`, `ADR-0026-p4-groups-delegation-approvals-t11-t12.md` | Binding design, with the refusal codes and English texts |
| Migrations | `packages/db/migrations/0028_p4_calendar_jobs_work_items.sql`, `0029_p4_groups_role_mapping_delegation.sql`, `0030_p4_decision_rights_raci.sql`, `0031_p4_approvals_permissions.sql` | Applied on a fresh PostgreSQL 16.13 and over a P3-populated database; every guard probed (`docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/probe-output.txt`). **Frozen.** |
| Kysely types, catalogue pins, seed pins | `packages/db/src/schema.ts` (21 tables, 1 view, 5 delegation columns), `packages/db/test/integration/catalogue.test.ts`, `packages/db/src/seed.test.ts` | Pinned |
| Permissions | `packages/shared/src/permissions.ts` (`P4_PERMISSIONS`, `P4_ROLE_PERMISSIONS`; 11 codes) | Equals `0031` |
| Lock classes | `apps/api/src/modules/platform/advisory-locks.ts` (`delegationGraph` 730224, `raciDeliverable` 730225, `approvalSubject` 730226; 730227 reserved), ADR-0016 §6 | Registry test green |
| Contract | `docs/api/openapi.yaml` 1.3.0-p4: 51 operations (tags `calendar`, `jobs`, `tasks`, `groups`, `role-mappings`, `delegations`, `approvals`, `decision-rights`, `raci`) | `pnpm openapi:lint` PASS (321 operations); P1–P3 unchanged |
| Contract-test seams | `apps/api/test/support/p4-pending.ts` (P4 aggregate; frozen after ARCH-08), `p4-pending-arch-01.ts` (slice aggregate; frozen), `p4-pending-be-a.ts` (15), `p4-pending-be-b.ts` (23), `p4-pending-be-c.ts` (13); `p2-pending.ts` includes the P4 set | §S-10 |
| ERD §1d, data dictionary "P4 tables, slices I and C", permissions matrix §10 | `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | Dictionary generated from the catalogue |

### I+C.1 BE-A — foundation: module registry, calendar, time, job kit, tasks and inbox (backend-workflow-engineer; lands first, wave W2)

**Owns** (paths under `apps/api/src/modules/` unless they start with `apps/`, `packages/` or `tests/`):

- The p4-plan §5.1 BE-A boundary: `modules.ts`, `server.ts`, `architecture.test.ts`/`.testkit.ts` (every P4 module registered, every route file named in p4-plan §5.1 created as a stub with its registration line), `platform/db-errors.ts` (P4 mappings below), `apps/api/test/integration/contract/contract.test.ts` (calls every `p4-exercises-<task>.ts`, created as stubs), `apps/api/test/support/harness.ts`, `contract.ts`, `test/integration/contract/malformed-input.ts` (`wellFormed` for the new path parameters: `jobCode` → `approval.escalation_scan`, `matrixKind` → `raci`), `media-types.ts`, `platform-statuses.ts`.
- `organization/calendar.ts` (calendar and holiday routes, `computeWorkingDayDueDate`), the call to `p4_ensure_default_calendar` in the organization-create transaction (`organization/routes.ts`, that one line).
- `packages/shared/src/time/**` (`businessDateOf`, `addWorkingDays`, `isWorkingDay`; pure, with the three ADR-0025 §1 worked examples as unit tests), its `@mth/shared/time` export (orchestrator merges the `package.json` `exports` line on BE-A's request; p4-plan §5.3).
- `tasks/**` (`tasks/service.ts` `createWorkItemOnce`, `tasks/routes.ts` for the five task and inbox operations), `jobs/schedules.ts` (the two job-schedule operations; `job_schedule.updated` outbox event on change).
- `apps/worker/src/{queues.ts,handlers.ts}` split into `apps/worker/src/{queues,handlers}/index.ts` + one stub `<domain>.ts` per domain; `apps/worker/src/kit.ts` (`runOnce`); `apps/worker/src/schedules.ts` (registers enabled `job_schedule` rows with pg-boss, re-syncs on `job_schedule.updated`).
- `packages/shared/src/schemas/{calendar,tasks,jobs}.ts` (zod mirrors) and their `schemas/index.ts` lines; `test/support/p4-pending-be-a.ts`; `test/integration/contract/p4-exercises-be-a.ts`; `test/integration/{calendar,tasks,jobs}/*.test.ts`; the worker kill-and-restart test `apps/worker/test/integration/restart.test.ts`.
- Migration **`0032`** (§I+C.4).

**Consumes:** ADR-0025 in full; `0028`; the contract operations listed in `p4-pending-be-a.ts`.

**`db-errors.ts` P4 mappings (slices I and C):** `*_version_step` → 409; `*_audit_required` → 500; `business_calendar_workweek_valid` → 422 `calendar.workweek_invalid`; `business_calendar_timezone_known`, `job_schedule_timezone_known` → 422 `calendar.timezone_unknown` / `job.timezone_unknown`; `business_calendar_org_code_key` → 409 `calendar.code_taken`; `business_calendar_holiday_range` → 422 `calendar.holiday_range_invalid`; `work_item_closed` → 422 `work_item.closed`; `inbox_notification_read_once` → 422 `inbox.already_read`; `delegation_no_loop` → 422 `delegation.loop`; `role_mapping_active_key` → 409 `role_mapping.already_mapped`; `transformation_raci_assignment_value` → 422 `raci.invalid_value`; `transformation_raci_one_accountable` → 422 `raci.accountable_count`; `*_matrix_in_approval` → 422 `governance_matrix.in_approval`; `approval_one_open_per_subject` → 409 `approval.already_open`; `approval_decision_stale`, `approval_subject_version_current` → 409 `approval.stale_version`; `approval_decision_sod` → 403 `approval.sod_requester`; `approval_decision_rationale_required` → 422 `approval.rationale_required`; `approval_decision_defer_date` → 422 `approval.defer_date_required`; `approval_decision_open`, `approval_final_immutable` → 422 `approval.not_open`. (The services check first; these are the database's last line.)

**Requirement rows:** REQ-S10-006, REQ-S15-008, REQ-S16-005 (kit and restart test), REQ-S12-005 (kit and `createWorkItemOnce`; the period-open handler is KBE-C's).

**Size note:** 15 operations plus the registry and worker split. If BE-A reaches its time bound, the worker split and kit (`apps/worker/**`) are the separable second half (D-059/D-070 salvage).

### I+C.2 BE-B — groups, role mappings, delegations, approvals and the escalation timer (backend-workflow-engineer; wave W3)

**Owns:** `access/groups.ts`, `access/role-mappings.ts` (`resolveParty`), `access/delegations.ts` (create, revoke, list, the loop and requester checks, the shared `actsFor(principal, userId, recordType, target)` helper that replaces the one-hop check for P4 approvals and keeps `actsOnBehalfOf`'s existing callers working), `workflows/approvals.ts` (request, decide, resubmit, withdraw, list, `approval_decision_record` read; the subject-provider registry `registerApprovalSubject(type, { currentVersion, onOutcome })`), `apps/worker/src/handlers/approvals.ts` (`approval.escalation_scan`), `apps/worker/src/handlers/access.ts` (`delegation.expiry_sweep`); `packages/shared/src/schemas/{groups,delegations,approvals}.ts`; `test/support/p4-pending-be-b.ts`; `test/integration/contract/p4-exercises-be-b.ts`; `test/integration/{groups,delegations,approvals}/*.test.ts`, including the REQ-S16-011 entity-group test (ADR-0026 §10) and the REQ-S10-003 test (an ADM-only user gets 403 on `decideApproval`, on `decideGate` and on the Finance validation endpoints).

**Consumes:** ADR-0026 §1–§4, §6, §8, §10; `0029`, `0031`; BE-A's `createWorkItemOnce`, `runOnce`, `addWorkingDays`; the operations in `p4-pending-be-b.ts`.

**Requirement rows:** REQ-S16-011, REQ-S10-008, REQ-S10-010, REQ-S10-014, REQ-S10-016, REQ-S10-017, REQ-S10-018, REQ-S10-019, REQ-S10-003.

**Size note:** 23 operations. If BE-B reaches its time bound, approvals and the escalation timer (`workflows/approvals.ts`, `handlers/approvals.ts`) are the separable second half.

### I+C.3 BE-C — T11, T12, governance matrices and Transform readiness (backend-workflow-engineer; wave W3, after BE-B's approval service merges)

**Owns:** `governance/decision-rights.ts` (T11 routes, `routeByDecisionRight`, SLA computation with the `NextForumDateProvider` interface, whose default implementation returns "none" until BE-F implements it), `governance/raci.ts` (T12 routes, cells saved as one change under lock 730225), `governance/matrices.ts` (list, submit; the `governance_matrix_change` subject provider registered with BE-B's registry), the PB-008 lines in `portfolio/readiness.ts` (the new `GET …/readiness/transform` route and its pure check function; the DG3 `getTransformationReadiness` stays byte-identical), the one-line switch of `POST /transformations` to `p4_instantiate_transformation()` in `transformations/routes.ts` (before BE-J edits that file, p4-plan §5.1); `packages/shared/src/schemas/governance.ts`; `test/support/p4-pending-be-c.ts`; `test/integration/contract/p4-exercises-be-c.ts`; `test/integration/governance/*.test.ts`.

**Consumes:** ADR-0026 §5, §7, §9; `0030`; BE-B's `resolveParty`, approval service and subject registry; BE-A's calendar functions; the operations in `p4-pending-be-c.ts`.

**Requirement rows:** REQ-PB-008, REQ-PB-065, REQ-PB-066, REQ-PB-067, REQ-S10-007, REQ-S10-009.

### I+C.4 Migrations of slices I and C

- `0028`–`0031`: architect, frozen.
- **`0032`: landed by the orchestrator as the documented no-op `0032_p4_slice_i_c_reserved.sql` (D-090), so ARCH-02 can write `0033` in parallel with BE-A. BE-A therefore writes no `0032`; any slice I/C schema need takes a repair-range number. The original text follows.** BE-A. Because migration numbers must be contiguous (S-12), `0032` must merge **before** ARCH-02's `0033`. BE-A writes it in its first merge: its own slice I follow-up if it has one, otherwise a documented no-op `0032_p4_slice_i_c_reserved.sql` (a header comment and `SELECT 1;`). BE-B and BE-C have no migration number; a schema need goes in their handback, and the orchestrator assigns a number from the repair range `0058`–`0069`.
- **Orchestrator note (applies to every ARCH range):** an ARCH range whose numbers are not all used leaves a gap that breaks `seed.test.ts`. Each range's unused numbers must be filled (or the ranges renumbered) before the next range lands.

### I+C.5 Frontend (FE-A, wave W4) and KPI (KBE-C, wave W5) parts of these slices

- **FE-A** (frontend-ux-engineer) owns, for slices I and C: `apps/web/src/pages/{calendar,groups,delegations,approvals,decision-rights,raci,my-work}/**`, the nav entries and API client calls for the 51 operations, and the `i18n/{en,ar}/{nav,problems}.json` keys for every problem code in ADR-0025 and ADR-0026. Screens: Administration > Calendar (ADM_TECH edit, others read), Administration > Jobs, My Work (items and inbox), My Work > Delegations, My Work > Approvals (four outcome buttons; `defer` asks for a date; the stale 409 shows "the record changed" with a link to its history), Governance > Decision rights, Governance > RACI (cell editor accepting exactly A, R, C, I, A/R or empty), Transformations > Team (role mappings; an unmapped party shows the visible routing error), Governance > Readiness (Transform). "B on behalf of A" renders in the audit view. Labels say "business approval", never DG0–DG7 (S-7).
- **KBE-C** (kpi-benefits-engineer) owns `apps/worker/src/handlers/kpi.ts`, including the `kpi.reporting_period_open` handler of REQ-S12-005: for each KPI definition in an opening period, `createWorkItemOnce` for the KPI owner with kind `kpi_update_due` and dedupe key `kpi.period_open:<kpiDefinitionId>:<periodLabel>:<ownerUserId>` (ADR-0025 §4).

### I+C.6 Integration order

1. **BE-A** (W2): registry, stubs, worker split, kit, `0032`, calendar, tasks, jobs. Must merge before any other implementer of P4 integrates (p4-plan §5.2).
2. **BE-B** (W3): groups, mappings, delegations, then approvals and the escalation timer.
3. **BE-C** (W3, integrates after BE-B): T11, T12, matrices, readiness, the instantiation switch.
4. **FE-A** (W4): screens for slices I and C (and the P4 shell for every area).
5. **KBE-C** (W5): the S12-005 period-open handler.
6. Slice H's BE-L (W9) adds the `change_request` approval type and calls `routeByDecisionRight(…, 'business_scope_change')`. This is the literal REQ-PB-065 acceptance "a change request of type Business scope change routes approval to the Sponsor"; BE-C proves the same routing earlier with a `decision_request`.

### I+C.7 Requirement → owner (the 19 rows of slices I and C)

| Requirement | Owner task(s) | Where it is proven |
|---|---|---|
| REQ-S10-006 | BE-A | `addWorkingDays` unit tests (the three ADR-0025 §1 examples); calendar API tests; probe G01–G08 |
| REQ-S12-005 | BE-A (kit, `createWorkItemOnce`), KBE-C (period-open handler) | KBE-C handler test (one task and reminder per KPI owner; replay creates none); probe G10–G12 |
| REQ-S15-008 | BE-A | `businessDateOf` unit tests; probe G09; slice A's KPI-actual test (ADR-0027) |
| REQ-S16-005 | BE-A | worker kill-and-restart integration test; QA A13 |
| REQ-PB-008 | BE-C | readiness/transform tests (not ready → ready) |
| REQ-PB-065 | BE-C (routing), BE-L (change request) | seeded rows verbatim (probe S01–S02); routing to the SP-mapped person |
| REQ-PB-066 | BE-C | due-date tests per SLA type (Thursday + 5 working days) |
| REQ-PB-067 | BE-C | seeded RACI equals B0101 (probe S03); 'X' 422; 'A/R' accepted |
| REQ-S10-003 | BE-B | ADM-only 403 on `decideApproval`, gate and Finance decisions; probe A28–A29 |
| REQ-S10-007 | BE-C | edits change neither the template nor another transformation (probe R06); matrix approval tests |
| REQ-S10-008 | BE-B | mapped person receives the approval; unmapped party → 422 `routing.role_unmapped` |
| REQ-S10-009 | BE-C | two A → 422; A/R counts as one (probe R01–R05, R07) |
| REQ-S10-010 | BE-B | loop refused (probe G25, G27, C01); "B on behalf of A" audit; capability lost after expiry |
| REQ-S10-014 | BE-B | decision without rationale → 422; stored request version (probe A07, A27) |
| REQ-S10-016 | BE-B | requester → 403 under the default policy (probe A05–A06) |
| REQ-S10-017 | BE-B | version 3 after the record moved to 4 → 409 (probe A08, A15) |
| REQ-S10-018 | BE-B | four distinct outcomes; request changes stays open; defer needs a date (probe A09, A11–A14) |
| REQ-S10-019 | BE-B | escalated exactly once after the due date and retries, still undecided (probe A16–A20) |
| REQ-S16-011 | BE-B | the entity-group API test (ADR-0026 §10) |

### I+C.8 What the implementers of slices I and C must know

1. **Group membership grants nothing.** Access comes only from `scoped_assignment`. Routing to a group requires at least one current member holding `approval.decide` (`routing.assignee_not_approver`).
2. **`approval.decide` is SP, BO and FIN only** (ADR-0026 §8). Do not grant it to TL, TO, WL or CM: that changes the DG1 creator-derived assignment and the DG2 team view.
3. **No fallback when a party is unmapped**: 422 `routing.role_unmapped`, nothing written.
4. **The stale check is on the subject**, not only the approval's ETag: compare the body's `subjectVersion` with `approval.subject_version` and with the subject's current version (the trigger does the same under lock 730226). A module whose record is the subject of an open approval takes lock 730226 on that record id before updating it.
5. **A timer never decides.** The escalation job inserts `approval_escalation`, updates only the escalation fields, and creates a work item and reminders. The database refuses anything else.
6. **Delegation capability is evaluated at use time** against `effective_from <= now() < effective_to`; the expiry sweep only updates the displayed status.
7. **The `delegation` table has no audit-required trigger** (DG3 fixtures insert rows directly). Every API write must still write its audit event, and the tests must assert it.
8. **Due dates are Unknown, never guessed**: `due_date = NULL` with `due_unknown_reason`. Never compute elapsed calendar days where working days are specified.
9. **The DG3 readiness operation is unchanged**; Transform readiness is the new `GET …/readiness/transform`.
10. **P3 approvals keep their DG3 in-person rule** (D-089 Q3): selection, funding, weight sets, overrides and dispensations still answer 422 `*.on_behalf_not_supported`.

## §A. Slice A (KPI engine) — T-DG4-ARCH-02

Written by T-DG4-ARCH-02 (solution-architect), 2026-10-09. Binding design: ADR-0027 (data model and pipeline) and ADR-0028 (calculation semantics). Shared rules S-1…S-14 (§1) apply to every task below.

### A.0 Already delivered by the architect (do not re-create)

| Artifact | Path | Status |
|---|---|---|
| ADRs | `docs/architecture/adr/ADR-0027-p4-kpi-data-model-and-pipeline.md`, `ADR-0028-p4-kpi-calculation-semantics.md` | Binding design, with the refusal codes and English texts (ADR-0027 §13) |
| Migrations | `packages/db/migrations/0033_p4_kpi_dictionary_versions.sql`, `0034_p4_kpi_trajectories_actuals.sql`, `0035_p4_kpi_calculation_runs_quality.sql`, `0036_p4_kpi_permissions_backfill.sql` | Applied on a fresh PostgreSQL 16.13 and over a P3-populated database; every guard probed (`docs/delivery/handbacks/DG4/T-DG4-ARCH-02-evidence/probe-output.txt`). **Frozen.** |
| Kysely types, catalogue pins, seed pins | `packages/db/src/schema.ts` (14 tables), `packages/db/test/integration/catalogue.test.ts`, `packages/db/src/seed.test.ts` | Pinned |
| Permissions | `packages/shared/src/permissions.ts` (`P4_KPI_PERMISSIONS`, `P4_KPI_ROLE_PERMISSIONS`; 9 codes) | Equals `0036` |
| Lock classes | `apps/api/src/modules/platform/advisory-locks.ts` (`kpiFormulaGraph` 730228, `kpiActualSlot` 730229, `reportingPeriod` 730230; 730231 reserved), ADR-0016 §6 | Registry test green |
| Contract | `docs/api/openapi.yaml` 1.3.0-p4: 39 operations (tags `kpi-versions`, `reporting-periods`, `target-trajectories`, `kpi-actuals`, `calculation-runs`, `kpi-status`, `rag-overrides`, `data-quality`); 9 `PermissionCode` values appended | `pnpm openapi:lint` PASS (360 operations); P1–P3 unchanged |
| Contract-test seams | `apps/api/test/support/p4-pending-arch-02.ts` (slice aggregate; frozen), `p4-pending-kbe-b.ts` (19), `p4-pending-kbe-c.ts` (20); `p4-pending.ts` imports the slice; `p4-operations.ts` lists the 39 | §S-10 |
| ERD §1e, data dictionary "P4 tables, slice A", permissions matrix §11 | `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | Dictionary generated from the catalogue |

### A.1 KBE-A — the pure KPI library (kpi-benefits-engineer; wave W3)

**Owns:** `packages/shared/src/kpi/**` — `measures.ts` (shortfall and deviation per measure type, ADR-0028 §1), `periods.ts` (comparability of two reporting periods, YTD windows, cumulative per value nature, §2, §6), `change.ts` (pp vs %, zero base, negative baseline flag, §3), `trajectory.ts` (expected-to-date, linear and step, baseline point, Unknown before the first point, §4), `rag.ts` (thresholds, defaults 0.05/0.10, explanation key and params naming the threshold, §5), `status.ts` (value statuses, staleness against a business date, override in force, displayed vs calculated RAG, §6), `aggregate.ts` (roll-up rules, expected scopes, unit/currency refusal, §7), `formula-binding.ts` (KPI unit → engine variable kind/currency/period, result-type match, §8), `index.ts` with `KPI_RULES_VERSION = "mth-kpi/1.0.0"`; their unit and property tests; the `export * from "./kpi/index.ts"` line in `packages/shared/src/calc.ts` (p4-plan §5.3).

**Consumes:** ADR-0028 in full; `@mth/shared/calc` (`FORMULA_DECIMAL`, `validateFormula`, `evaluateFormula`; unchanged, S-9).

**Rules:** pure functions only (no I/O, no clock: the business date is a parameter); decimal.js only, never `Number` for a KPI value; results are `{ status, value | null, reason }`, never a bare 0 for Unknown. The A05 list in ADR-0028 "Verification" is the minimum test set.

**Requirement rows:** REQ-S07-002, REQ-S07-004, REQ-S07-005, REQ-S07-010 (library half), REQ-S07-011 (unit half).

### A.2 KBE-B — dictionary v2, versions, formulas, thresholds, trajectories, data quality (kpi-benefits-engineer; wave W4)

**Owns** (paths under `apps/api/src/modules/`): `kpi/kpi-versions.ts` (`listKpiDictionary`, `getKpiDictionaryEntry`, `listKpiVersions`, `createKpiVersion`, `getKpiVersion`, `updateKpiVersion`, `activateKpiVersion`, `withdrawKpiVersion`, `requestKpiVersionApproval`; the `kpi_version_activation` subject provider registered with BE-B's `registerApprovalSubject`, whose `onOutcome('approved')` does not activate — activation stays an explicit call), `kpi/kpi-formulas.ts` (formula validation through KBE-A's `formula-binding.ts`; the graph walk under lock 730228 that names the cycle path; engine untouched), `kpi/rag-thresholds.ts` (`listKpiRagThresholds`, `createKpiRagThreshold`), `kpi/trajectories.ts` (`listTargetTrajectories`, `createTargetTrajectory` incl. `sourceOutcomeKpiId` import, `getTargetTrajectory`, `approveTargetTrajectory`, `withdrawTargetTrajectory`), `kpi/data-quality.ts` (`listDataQualityFindings`, `getDataQualityFinding`, `resolveDataQualityFinding`); the outbox events `kpi.threshold_changed`, `kpi.trajectory_approved`, `kpi.version_activated` (idempotency keys `<event>:<recordId>:<versionNo>`) written in the same transaction as their change; the slice A block of `platform/db-errors.ts` (ADR-0027 §13 mappings, appended after BE-A's P4 block merges); the registration lines in `kpi/routes.ts` and `kpi/index.ts` (**first**; KBE-C's lines come after); `packages/shared/src/schemas/kpi-versions.ts` (zod mirrors of the KBE-B request bodies) and its `schemas/index.ts` line; `test/support/p4-pending-kbe-b.ts`; `test/integration/contract/p4-exercises-kbe-b.ts`; `test/integration/kpi-p4/{versions,formulas,thresholds,trajectories,data-quality}.test.ts`, each with its AUD-403 and ADM-only-403 cases.

**Consumes:** ADR-0027 §1–§5, §9, §11–§13; ADR-0028 §5, §8; `0033`, `0034` (trajectories), `0035` (findings), `0036`; KBE-A's library; BE-B's approval service; the 19 operations in `p4-pending-kbe-b.ts`.

**Requirement rows:** REQ-S07-001, REQ-S07-007 (threshold and trajectory half), REQ-S07-011.

**Size note:** 19 operations. If KBE-B reaches its time bound, `kpi/trajectories.ts` and `kpi/data-quality.ts` (8 operations) are the separable second half (D-059/D-070 salvage).

### A.3 KBE-C — reporting periods, actuals, the accept pipeline, runs, status, overrides (kpi-benefits-engineer; wave W5)

**Owns:** `kpi/reporting-periods.ts` (5 operations), `kpi/actuals.ts` (`listKpiActuals`, `submitKpiActual`, `getKpiActual`, `addKpiActualValue`, `submitKpiActualDraft`, `acceptKpiActual`, `rejectKpiActual`, `listKpiActualReviewQueue`; review work items `kpi_actual_review` and correction items `kpi_actual_rejected` through `createWorkItemOnce`), `kpi/accept-pipeline.ts` (the accept transaction: one review row, one slot update, **one** audit event, **one** `kpi.actual_accepted` outbox event), `kpi/downstream.ts` (the `DownstreamImpactProvider` interface and the slice A part of the downstream list; `financeReview` is `unknown` until slice B registers a provider), `kpi/calculation-runs.ts` (2), `kpi/kpi-status.ts` (2; the read-time staleness and override rules), `kpi/rag-overrides.ts` (3), `apps/worker/src/handlers/kpi.ts` (consumer `kpi.recalculate` for the four triggers; the `kpi.reporting_period_open` job of REQ-S12-005, ADR-0025 §4), the registration lines in `kpi/routes.ts` and `kpi/index.ts` (**after** KBE-B), `packages/shared/src/schemas/kpi-actuals.ts` and its `schemas/index.ts` line, `test/support/p4-pending-kbe-c.ts`, `test/integration/contract/p4-exercises-kbe-c.ts`, `test/integration/kpi-p4/{periods,actuals,pipeline,status,overrides,entity-group}.test.ts` (the REQ-S16-014 entity-group test, ADR-0027 §14), `apps/worker/test/integration/kpi-recalculate.test.ts` (redelivery and restart: still one run).

**Consumes:** ADR-0027 §3, §6–§8, §10–§14; ADR-0028 §2, §4–§7; `0033`–`0035`; KBE-A's library; KBE-B's versions, trajectories, thresholds and formula inputs; BE-A's `createWorkItemOnce`, `runOnce`, `businessDateOf`; BE-B's `resolveParty`; the 20 operations in `p4-pending-kbe-c.ts`.

**Requirement rows:** REQ-S07-003, REQ-S07-006, REQ-S07-008, REQ-S07-009, REQ-S07-012, REQ-S07-013, REQ-S07-017, REQ-S12-006, REQ-S16-014; with KBE-A: REQ-S07-010 (roll-up in the run).

**Size note:** 20 operations plus the worker handler. If KBE-C reaches its time bound, `apps/worker/src/handlers/kpi.ts`, `kpi/calculation-runs.ts` and `kpi/kpi-status.ts` are the separable second half.

### A.4 Migrations of slice A

- `0033`–`0036`: architect, all four numbers used, **frozen**. No number of the range is left free, so ARCH-03's `0037` can merge directly after them (S-12 contiguity).
- KBE-A, KBE-B and KBE-C have no migration number. A schema need goes in their handback, and the orchestrator assigns a number from the repair range `0058`–`0069`.

### A.5 Other slices that consume slice A

- **FE-B** (frontend-ux-engineer, wave W6) owns `apps/web/src/pages/kpi/**`: dictionary, versions, trajectory, the four-step update (open KPI → select period → enter value or "not available" and attach evidence → submit; the confirmation lists `downstream` and shows "review pending" and the Finance review state), review queue, the RAG panel with the seven elements in en and ar, overrides and data quality. Unknown, Stale and Not computable render grey with their label, never 0 or green; "business approval" labels, never DG0–DG7 (S-7). Keys go to FE-A's `i18n/{en,ar}/{nav,problems}.json` blocks for every ADR-0027 §13 code.
- **KBE-E** (slice B) consumes `kpi.values_recalculated` (one validation flag per benefit and run; S07-014, S12-006 "flag benefit validation") and registers the `DownstreamImpactProvider` that fills `financeReview`.
- **BE-D** (slice E) consumes `kpi.deviation_evaluated` (corrective-action case per its severity and persistence rule, M0227).
- **KBE-F** (slice F) creates the seven adoption indicators as KPI definitions with versions.
- **BE-L** (slice H) builds the M0163 change request around new KPI versions and trajectory versions (REQ-S07-015).
- **KBE-G** (slice J) reads `kpi_evaluation` (latest run per slot) and `getKpiStatus` for the T10 Outcomes area and the Executive Overview.

### A.6 Integration order

1. **ARCH-02** (this task) merges after `0032` (D-090), so `0033`–`0036` are contiguous.
2. **KBE-A** (W3): the pure library and its barrel line.
3. **KBE-B** (W4): versions, formulas, thresholds, trajectories, data quality; its `kpi/routes.ts` lines first.
4. **KBE-C** (W5): periods, actuals, pipeline, runs, status, overrides, worker handler.
5. **FE-B** (W6), then the consumers in A.5, then **QA-A** (A04, A05).

### A.7 Requirement → owner (the 16 rows of slice A)

| Requirement | Owner task(s) | Where it is proven |
|---|---|---|
| REQ-S07-001 | KBE-B | dictionary entry holds every field; version activation without an aggregation rule → 422 `kpi_version.aggregation_rule_required`; DG2 create without polarity/unit → 400 (unchanged); probe V03 |
| REQ-S07-002 | KBE-A | the four measure-type unit tests (ADR-0028 §1); probes V05, V09, V16 |
| REQ-S07-003 | KBE-C | second actual for the same slot = value version 2, one row (probes A02, A03) |
| REQ-S07-004 | KBE-A | +2.0 pp and +20 %; YTD = Σ period flows |
| REQ-S07-005 | KBE-A | zero denominator → Not computable; negative baseline flagged; 4-week vs 5-week → Not comparable (probe RP06 stores the week counts) |
| REQ-S07-006 | KBE-C (with KBE-A) | no actual for the current period → Unknown (grey, labelled), no zero in roll-ups; probes R03–R06 |
| REQ-S07-007 | KBE-B (thresholds, trajectories), KBE-C (run), KBE-A (RAG) | all tasks complete + actual below red → Red; a new threshold version → one run, new RAG |
| REQ-S07-008 | KBE-C (FE-B renders) | `getKpiStatus` returns the seven elements; the explanation names the threshold version; en and ar |
| REQ-S07-009 | KBE-C | override without evidence or expiry → 422; non-holder → 403; after expiry the calculated RAG displays; probes O01–O08 |
| REQ-S07-010 | KBE-A, KBE-C | 1/10 and 9/10 → 0.50; SAR + USD refused (probe A09); no averaging rule (probe V02) |
| REQ-S07-011 | KBE-B, KBE-A | A = B + 1 and B = A * 2 → 422 `kpi_formula.circular` (probes F02–F04, C01); SAR + count → 422 `formula.kind_mismatch` |
| REQ-S07-012 | KBE-C | review route: submitted value not used until accepted; direct-accept: used at once (probes A01, A03, A08) |
| REQ-S07-013 | KBE-C | one accept → exactly one calculation run and one audit event (probes A01, R01); live views show the new value once |
| REQ-S07-017 | KBE-C (FE-B) | `submitKpiActual` in one request; response lists `downstream`, `reviewPending`, `financeReview` |
| REQ-S12-006 | KBE-C (KBE-E flag) | one accepted actual → one recalculation and one `kpi.values_recalculated`; slice B writes one flag |
| REQ-S16-014 | KBE-C (with KBE-B) | the entity-group API test (ADR-0027 §14); ERD §1e and migrations `0033`–`0035` |

### A.8 What the implementers of slice A must know

1. **The DG2 KPI-definition operations are unchanged.** P4 fields live on `kpi_version`. Only a KPI that has a version gets the new 422 `kpi_definition.measure_locked` on `updateKpiDefinition`.
2. **Every P4 use reads the active version.** No active version → `kpi_actual.no_active_version` on entry and Unknown (`kpi.no_active_version`) on reads. Never fall back to the DG2 fields for measurement.
3. **Activation order:** supersede the old active version, then activate the new one, in one transaction (the partial unique index is immediate).
4. **Only the slot is audited.** Write the value, review and evidence rows in the slot's transaction and exactly one audit event on `kpi_actual` per user action. The worker's runs, evaluations and finding inserts write no audit event; a person's resolve of a finding does.
5. **One run per trigger.** Insert `calculation_run` with the trigger key inside `runOnce`; a unique violation on `calculation_run_trigger_key` means the run already exists: do nothing.
6. **Unknown is NULL with a reason.** Never write 0 for a missing value; the database refuses a non-NULL Unknown/Not computable value and a green/amber/red without a known deviation.
7. **RAG never reads task completion.** The evaluator takes values, the active version, the approved trajectory, the threshold version and the business date, nothing else.
8. **Currencies are never converted.** A value in another currency than the KPI's is refused (`kpi_actual.currency_mismatch`).
9. **Trajectory points are fixed at creation** (append-only). Different points = withdraw the draft and create the next version.
10. **The override changes the display only.** `calculatedRag` is always returned; `displayedRag` is the override while `status = 'active'` and `now() < expiresAt`.
11. **Percentages are fractions** (0.12 = 12 %). The pp/% labels come from KBE-A's `change.ts`.
12. **The formula engine is unchanged** (S-9). KPI formulas bind variables through `formula-binding.ts`; cycle detection is the graph walk, not the engine.
