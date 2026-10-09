# Handback T-DG4-ARCH-02: P4 architecture, slice A — KPI engine (solution-architect)

- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-ARCH-02-solution-architect-20261009T015833Z-8ea4ac44","session_id":"8ea4ac44-8cbc-46dc-8b31-66b92c892ecd"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-ARCH-02.md` (sha256 `0b120d0e…0fd51f`, verified with `sha256sum` at the start).
- **Base:** branch `claude/mobily-transformation-platform-regate`, `HEAD` `735fbc76e51059f95136db071577ff7c579ab48c`. The working tree had only untracked top-level dotfiles (`.bashrc`, `.gitconfig`, `.mcp.json`, …), `CLAUDE.local.md` and the two `docs/delivery/runs/DG4/…` run directories (mine and BE-A's). I did not create or touch them.
- **Time:** start `Fri Oct  9 01:58:44 UTC 2026`; end in §9.
- **Two gate systems.** Trajectory approval and KPI-version approval are **business** approvals inside the product, decided by named people. No seed, job or trigger decides one; the `0036` backfill copies approvals that people already gave on DG2 T02 rows (approver and time preserved). Nothing here reads or writes DG0–DG7.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, exit 0, run first, before any write (`T-DG4-ARCH-02-evidence/validate-historical-DG3.log`), and again at the end (`validate-dg3-historical-end.log`, exit 0).

## 2. Deliverables

| # | Deliverable | Files | Status |
|---|---|---|---|
| 1 | ADRs | `docs/architecture/adr/ADR-0027-p4-kpi-data-model-and-pipeline.md`, `ADR-0028-p4-kpi-calculation-semantics.md`; index rows in `docs/architecture/README.md`; lock rows 730228–730231 in ADR-0016 §6 | Done |
| 2 | Migrations and schema types | `packages/db/migrations/0033_p4_kpi_dictionary_versions.sql`, `0034_p4_kpi_trajectories_actuals.sql`, `0035_p4_kpi_calculation_runs_quality.sql`, `0036_p4_kpi_permissions_backfill.sql`; `packages/db/src/schema.ts`; `catalogue.test.ts`; `seed.test.ts`; `packages/shared/src/permissions.ts`; `advisory-locks.ts` (+ test) | Done; probe 92 PASS / 0 FAIL |
| 3 | Probe | `T-DG4-ARCH-02-evidence/probe.ts`, `probe-output.txt` | Done (§4) |
| 4 | ERD and data dictionary | `docs/architecture/erd.md` §1e (+ §2.4 aligned), `data-dictionary.md` "P4 tables, slice A" (generated from the migrated catalogue by `gen-dictionary.ts`) | Done |
| 5 | Contract | `docs/api/openapi.yaml` 1.3.0-p4, +39 operations, 9 `PermissionCode` values appended; `apps/api/test/support/p4-pending-arch-02.ts`, `p4-pending-kbe-b.ts` (19), `p4-pending-kbe-c.ts` (20); `p4-pending.ts`, `p4-operations.ts`, `contract.test.ts` (count pin) | Done; lint PASS (360 operations) |
| 6 | Permissions matrix and work split | `docs/analysis/permissions-matrix.md` §11; `docs/architecture/p4-work-split.md` §A (A.0–A.8) | Done |

Nothing is left for a continuation task. Open items for the orchestrator are in §7.

## 3. Changed files, one line each

- `packages/db/migrations/0033_p4_kpi_dictionary_versions.sql`: `reporting_period` (no overlap, lock 730230; week-based periods), `kpi_version` (dictionary v2, status machine, activation preconditions incl. the aggregation rule), `kpi_formula_input` + cycle guard (lock 730228), `kpi_rag_threshold` (versioned), and the additive DG2 trigger `kpi_definition_measure_lock`.
- `packages/db/migrations/0034_p4_kpi_trajectories_actuals.sql`: `p4_kpi_scope_valid`, `target_trajectory` + append-only points, `kpi_actual` slot (status machine, lock 730229, deferred consistency), append-only `kpi_actual_value`, `kpi_actual_review`, `kpi_actual_evidence`.
- `packages/db/migrations/0035_p4_kpi_calculation_runs_quality.sql`: append-only `calculation_run` (one per trigger) and `kpi_evaluation` (Unknown never 0 or green), `data_quality_finding` (audited on UPDATE), `rag_override` (reason/evidence/expiry NOT NULL, one in force, lock 730229).
- `packages/db/migrations/0036_p4_kpi_permissions_backfill.sql`: approval type `kpi_version_activation`, two work-item kinds, 9 permissions + 18 role links, one-time trajectory backfill from approved DG2 T02 rows.
- `packages/db/src/schema.ts`: 14 tables (generated from the catalogue by `gen-schema.ts`), Database entries, Row types, `SCHEMA_COLUMNS`.
- `packages/db/test/integration/catalogue.test.ts`: versioned-table and grant pins for the 14 tables; a slice A trigger-attachment test.
- `packages/db/src/seed.test.ts`: the 0036 permission and role-link comparison (3 tests).
- `packages/shared/src/permissions.ts`: `P4_KPI_PERMISSIONS`, `P4_KPI_ROLE_PERMISSIONS`, merged into `PERMISSIONS` and `ROLES`.
- `apps/api/src/modules/platform/advisory-locks.ts` (+ `.test.ts`): `kpiFormulaGraph` 730228, `kpiActualSlot` 730229, `reportingPeriod` 730230 (730231 reserved); the three migration constants mapped.
- `docs/api/openapi.yaml`: 8 tags, 39 operations, 15 parameters, 46 schemas (incl. 10 page schemas), 9 appended `PermissionCode` values.
- `apps/api/test/support/p4-pending-arch-02.ts`, `p4-pending-kbe-b.ts`, `p4-pending-kbe-c.ts`; `p4-pending.ts` (one import); `p4-operations.ts` (39 ids).
- `apps/api/test/integration/contract/contract.test.ts`: operation-count pin 321 → 360.
- `apps/api/test/integration/identity.test.ts`: TO's `GET /me` permission list gains `reporting_period.manage`.
- `apps/api/test/integration/kpi/kpi-aud-write-deny.test.ts`: the DG2 KPI AUD sweep skips P4 operations (§5 item 1).
- ADRs, README, ADR-0016 §6, ERD, data dictionary, permissions matrix, work split: as in §2.
- `docs/delivery/handbacks/DG4/T-DG4-ARCH-02-evidence/*`: the probe, `gen-schema.ts`, `gen-dictionary.ts`, `openapi-p4-arch02.py` (contract generator, provenance), migration hashes and every command log.

## 4. Migration apply and guard probe (real output)

```text
QA_PG_PORT=23700 MTH_PORT_POOL=23701-23709 tests/qa/support/with-pg.sh \
  node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-02-evidence/probe.ts
```

Result (`probe-output.txt`): **92 PASS, 0 FAIL**, `PROBE RESULT: PASS (all guards fired as specified)`, exit 0, on PostgreSQL 16.13 (UTF8, C). Hashes: `migration-sha256.txt`. In summary:

- **Fresh database:** 0001→0036 apply (36 files).
- **P3-populated database:** 0001–0027, a synthetic transformation with its P3 starter structure, a KPI with two approved DG2 T02 rows; then 0028–0036 apply. Backfill: exactly one approved `target_trajectory` from the more recently approved row, approver and time preserved, points copied as `numeric(24,6)`, two `system`/`migration` audit events, `outcome_kpi` rows unchanged (B01–B04).
- **Seeds:** 9 permissions, each `write`/`configure`; no technical admin or AUD holds one; the approval type and two work-item kinds (S01–S03).
- **Each new guard fires:**
  - Missing audit fails at COMMIT: RP01 (`reporting_period`), V01 (`kpi_version`), A04 (`kpi_actual`), D02 (`data_quality_finding` UPDATE), O04 (`rag_override`).
  - Non-stepping version: RP05, V13, D06.
  - UPDATE/DELETE on history: F06 (`kpi_formula_input`), TJ04/TJ04b (`target_trajectory_point` UPDATE/DELETE), A14 (`kpi_actual_value`), A15 (`kpi_actual_review` DELETE), R02 (`calculation_run`), R07 (`kpi_evaluation`).
  - Invariants: RP02–RP04, RP06 (periods); V02–V12, V14–V16 (versions, D-089 Q1 aggregation rule at activation, DG2 lock and DG2 behaviour without a version); F01–F05, C01 (cycles, also concurrent under lock 730228); T01–T04 (thresholds); TJ01–TJ07 (trajectories); A01–A03, A05–A13, A16–A20 (slots, value versions, one audit event per action, review SoD, currency, shape, period open/frequency, active version, scope); R01, R03–R06 (one run per trigger; Unknown never 0 or green; Stale never green); D01, D03–D05 (findings); O01–O03, O05–O08 (overrides).

## 5. Checks actually run (Node 24.21.0, `/opt/nvm/versions/node/v24.21.0/bin`, offline)

| Check | Command | Result |
|---|---|---|
| Historical gate | `node tools/gates/validate.mjs --historical --stage DG3` | PASS, exit 0 (start and end) |
| Typecheck | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` | exit 0 (`lint.log`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`format.log`) |
| OpenAPI lint | `pnpm openapi:lint` | `PASS … 360 operations`, exit 0 (`openapi-lint.log`) |
| Contract additive | `python3 docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/openapi-diff-check.py <HEAD openapi> docs/api/openapi.yaml` | PASS: P1–P3 paths and components unchanged; 321 → 360; 9 enum values appended (`openapi-diff-check.txt`) |
| Probe | §4 | 92 PASS / 0 FAIL |
| Unit, locale unset | `env -u LANG -u LC_ALL pnpm test` | `Test Files 81 passed (81)`, `Tests 1660 passed (1660)`; formula no-codegen: 3 files, 259 passed, 2 skipped; exit 0 (`unit-locale-unset.log`) |
| Unit, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | the same counts, exit 0 (`unit-c-utf8.log`) |
| Integration | `env -u LANG -u LC_ALL QA_PG_PORT=23710 MTH_PORT_POOL=23711-23749 tests/qa/support/with-pg.sh pnpm test:integration` | `Test Files 56 passed (56)`, `Tests 795 passed (795)`, exit 0, PostgreSQL 16.13 disposable (`integration.log`) |

**Pinned counts changed:** `contract.test.ts` operations 270+51 = 321 → 360. Unchanged: the media-type triple and the rate-limit floor (they count routed operations; the 39 are pending). Unit 1657 → 1660 (+3 `seed.test.ts` tests for 0036). Integration 794 → 795 (+1 catalogue trigger-attachment test). The DG2 KPI AUD sweep still covers its 16 DG2 mutations.

**Non-zero exits during the run, disclosed:**

1. **First integration run: 6 failed / 794 passed** (`integration-first-run.log`). All six in `apps/api/test/integration/kpi/kpi-aud-write-deny.test.ts`: that DG2 sweep generates its list from every non-GET operation under `/kpi-definitions/…`, so it picked up my five new POSTs there and its "covers the 16 kpi mutations" assertion. **Fix:** the sweep now skips `P4_OPERATION_IDS`, the same precedent ARCH-01 applied to the P2 sweep (`aud-write-deny.test.ts`); KBE-B/KBE-C test AUD-403 on their own operations (S-4). The final run is on the final files.
2. **Probe, first three runs (not recorded as evidence):** run 1 exited 2 — my setup inserted audited rows outside a transaction, so the deferred audit check fired per statement (fixed by wrapping setup in transactions); run 2 had 4 FAILs — two guards (`kpi_version`, `target_trajectory`) refused a same-status content change through the status rule instead of the freeze rule (I let same-status updates reach the freeze check; both still refuse), one probe reused a period that already had a slot, and one regex accepted only one of the two constraints that refuse a green Stale evaluation; run 3: 91 PASS / 0 FAIL. I then made trajectory points append-only (the catalogue rule "no DELETE anywhere") and re-ran: the recorded run is 92 PASS / 0 FAIL.
3. **Contract generator, first two attempts:** an assertion stopped the first (the components `parameters:` anchor had moved since ARCH-01), and the second produced a duplicate schema key (`TrajectoryPoint` already exists in DG2; mine is `KpiTrajectoryPoint`). Both were caught before any lint pass was claimed; the contract was restored from the pre-change copy and regenerated.

## 6. Behaviour delivered per requirement (design + database; the API routes are the implementers' work)

- **REQ-S07-001:** dictionary v2 = DG2 definition + `kpi_version` (every M0158 field mapped, ADR-0027 §1); aggregation rule required to activate a version (probe V03) and so before any P4 use (D-089 Q1).
- **REQ-S07-002:** four measure types with their parameters (CHECKs, probes V05, V09, V16); deviation rules and worked examples (ADR-0028 §1).
- **REQ-S07-003:** one slot per KPI, scope, period; a second actual = value version 2 (probes A02, A03).
- **REQ-S07-004:** period and cumulative bases; pp vs % (ADR-0028 §2–§3).
- **REQ-S07-005:** missing (`missing_reason`, probe A11), zero denominator, negative baseline, week-count comparability (ADR-0028 §3, §6; probe RP06).
- **REQ-S07-006:** Unknown/Stale/Not computable stored as statuses with reasons; database refuses non-NULL Unknown and green without data (probes R03–R06); no partial roll-ups.
- **REQ-S07-007:** RAG from the approved trajectory and the threshold version in force; never from task completion (ADR-0028 §4); a new threshold version triggers a run.
- **REQ-S07-008:** the seven-element panel with the explanation naming the threshold (ADR-0028 §6; `KpiStatus`).
- **REQ-S07-009:** override with reason, evidence, expiry; calculated RAG preserved; display rule after expiry; `rag.override` only (probes O01–O08).
- **REQ-S07-010:** explicit rules, no averaging rule exists (probe V02), weighted ratios, no currency mixing (probe A09).
- **REQ-S07-011:** cycle guard incl. concurrency (probes F02–F04, C01); units via the unchanged DG3 engine.
- **REQ-S07-012:** review vs direct-accept routes; review SoD (probes A01, A06–A08).
- **REQ-S07-013 / REQ-S12-006:** one audit event per accept (probe A01), one run per accepted value (probe R01), the pipeline and its outbox events (ADR-0027 §8).
- **REQ-S07-017:** the one-request submission with `downstream`, `reviewPending`, `financeReview` (ADR-0027 §6).
- **REQ-S16-014:** the six entities mapped with PK, owner and status (ADR-0027 §14, ERD §1e).

## 7. For the orchestrator (decisions and risks)

1. **D-089 Q1 reading.** I read "required on activation" as activation of a **KPI version** (the P4 dictionary entry). The DG2 `activateKpiDefinition` is unchanged (it would otherwise refuse DG2-valid KPIs). Every P4 use needs an active version, which needs an aggregation rule. Please confirm.
2. **One new refusal on a DG2 operation, for P4 data only.** `updateKpiDefinition` gets 422 `kpi_definition.measure_locked` when the KPI has a P4 version and the request changes its unit, currency, polarity or frequency (probe V14). No KPI created before P4 has a version, so no DG2 behaviour on existing data changes (probe V15). The DG2 operation already declares 422. I classify it as additive; please confirm it is not a reopen.
3. **Parallel merge with BE-A.** BE-A owns `contract.test.ts` and `platform/db-errors.ts`. I changed only the count pin and its comment in `contract.test.ts` (321 → 360), and `p4-pending.ts` (one import). Expect a trivial conflict on those lines if BE-A also touched them. The slice A `db-errors.ts` mappings are KBE-B's (p4-work-split A.2), appended after BE-A's block.
4. **Migration contiguity.** `0033`–`0036` are all used; ARCH-03's `0037` can follow directly. KBE-A/B/C schema needs go to the repair range.
5. **Percentages are fractions** (ADR-0028 §3). DG2 had no convention, and `0036` copies T02 trajectory values verbatim; a DG2 percentage KPI whose T02 points were entered as 0–100 must have a new trajectory version approved.
6. **Trajectory approval reuses `kpi_target.approve`** (DG2 business approval, SP and BO), not a new code.
7. **Size risk.** KBE-B (19 operations) and KBE-C (20 operations + worker handler) are at the top of the band; each has a named separable second half (A.2, A.3).

## 8. DG1–DG3 artifacts changed, and why (D-089)

- `kpi_definition` (DG2 table): one additive trigger (`kpi_definition_measure_lock`), no column change (§7 item 2; p4-plan seam 6, additive per D-089).
- `docs/api/openapi.yaml`: additive only (diff check PASS); 9 values appended to the response-only `PermissionCode` enum (the P2/P3/ARCH-01 precedent; without them `GET /me` responses of roles with the new codes would not validate).
- `apps/api/test/integration/kpi/kpi-aud-write-deny.test.ts`: a DG2 test now excludes P4 operations from its generated list (§5 item 1). Its DG2 assertions and its 16 DG2 operations are unchanged.
- `apps/api/test/integration/identity.test.ts`: TO's permission list gains `reporting_period.manage` (the ARCH-01 precedent).
- `docs/architecture/erd.md` §2.4: the KPI group's table column and relationships now match the physical model (slot + value versions; trajectory per KPI and scope; run + evaluations). Stage stays P4.
- `docs/architecture/adr/ADR-0016` §6: rows 730228–730231 (the assignment requires the registry entry).
- `packages/db/src/schema.ts`, `catalogue.test.ts`, `seed.test.ts`, `packages/shared/src/permissions.ts`, `advisory-locks.ts`/`.test.ts`, `contract.test.ts` (count pin), `p4-pending.ts`, `p4-operations.ts`: append-only P4 entries (p4-plan §5.3).

## 9. End

- **End time:** recorded in `T-DG4-ARCH-02-evidence/end-time.txt` (written by `date -u` after this file).
- **What the implementers of slice A must know:** `docs/architecture/p4-work-split.md` §A.8 (twelve points) and the shared rules S-1…S-14. The most important are:
  - the DG2 KPI-definition operations are unchanged and every P4 use reads the active version;
  - only the slot is audited (one audit event per user action), and the worker writes exactly one run per trigger;
  - Unknown is NULL with a reason, never 0 or green, and RAG never reads task completion;
  - currencies are never converted, percentages are fractions, and the formula engine stays unchanged.
