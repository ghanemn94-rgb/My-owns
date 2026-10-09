# Handback T-DG4-ARCH-01: P4 architecture, slices I + C (solution-architect)

- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-ARCH-01-solution-architect-20261009T010400Z-715f87a6","session_id":"715f87a6-977e-4cb1-8f2a-9691ee2c4793"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-ARCH-01.md` (sha256 `71d5dc43…174748c`, verified with `sha256sum` at the start).
- **Base:** branch `claude/mobily-transformation-platform-regate`, `HEAD` `ce424ef1c5ec31d40230b7f8ddfdf71606fdb996`. The working tree had only untracked top-level dotfiles (`.bashrc`, `.gitconfig`, `.mcp.json`, …), `CLAUDE.local.md` and this run's `docs/delivery/runs/DG4/…` directory. I did not create them, and I left them untouched.
- **Time:** start `Fri Oct  9 01:04:11 UTC 2026`; end `Fri Oct  9 01:53:54 UTC 2026` (§9).
- **Two gate systems.** Every approval designed here is a G1–G6-style *business* approval inside the product, decided by a named person. Nothing here reads or writes DG0–DG7, and no seed, job or trigger grants an approval.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, exit 0 (run first, before any write).

## 2. Deliverables

| # | Deliverable | Files | Status |
|---|---|---|---|
| 1 | ADRs | `docs/architecture/adr/ADR-0025-p4-calendar-time-jobs-work-items.md`, `ADR-0026-p4-groups-delegation-approvals-t11-t12.md`; index rows in `docs/architecture/README.md`; lock rows 730224–730227 in `ADR-0016` §6 | Done |
| 2 | Migrations and schema types | `packages/db/migrations/0028_p4_calendar_jobs_work_items.sql`, `0029_p4_groups_role_mapping_delegation.sql`, `0030_p4_decision_rights_raci.sql`, `0031_p4_approvals_permissions.sql`; `packages/db/src/schema.ts`; `packages/db/test/integration/catalogue.test.ts`; `packages/db/src/seed.test.ts`; `packages/shared/src/permissions.ts`; `apps/api/src/modules/platform/advisory-locks.ts` (+ test) | Done; probe 81 PASS / 0 FAIL |
| 3 | Probe | `T-DG4-ARCH-01-evidence/probe.ts`, `probe-output.txt` | Done (§4) |
| 4 | ERD and data dictionary | `docs/architecture/erd.md` §1d (+ the §2.1 Group/Delegation rows), `docs/architecture/data-dictionary.md` "P4 tables, slices I and C" (per-table sections generated from the migrated catalogue by `gen-dictionary.ts`) | Done |
| 5 | Contract | `docs/api/openapi.yaml` 1.3.0-p4, +51 operations; `apps/api/test/support/p4-pending{,-arch-01,-be-a,-be-b,-be-c}.ts`, `p4-operations.ts`; `p2-pending.ts`, `contract.test.ts` (count pin) | Done; lint PASS (321 operations) |
| 6 | Permissions matrix and work split | `docs/analysis/permissions-matrix.md` §10; `docs/architecture/p4-work-split.md` (new: shared rules §1 and section §I+C) | Done |

Nothing is left for a continuation task. The open items for the orchestrator are in §7.

## 3. Changed files, one line each

- `packages/db/migrations/0028_p4_calendar_jobs_work_items.sql`: business calendar and holidays (Asia/Riyadh, Sun–Thu, no holiday seeded, default backfilled per organization), `p4_business_date`, job schedules (3 seeded), work-item kinds, work items, inbox; all guarded and audited.
- `packages/db/migrations/0029_p4_groups_role_mapping_delegation.sql`: governed groups and members, 18 governance parties (seed), role mapping (one active per party, no fallback), delegation columns, loop guard (lock 730224) and row guard.
- `packages/db/migrations/0030_p4_decision_rights_raci.sql`: T11 template (B0099 verbatim), T12 template (B0101 verbatim, 36 cells), governance-matrix headers, per-transformation copies, one-accountable deferred guard (lock 730225), rows frozen in approval, `p4_instantiate_transformation` and backfill.
- `packages/db/migrations/0031_p4_approvals_permissions.sql`: approval types, the canonical approval record, append-only decisions and escalations, the guards (state machine, current version under lock 730226, SoD, rationale, defer date, outcome needs a user's decision, escalation once and only when overdue), the `approval_decision_record` view, and 11 P4 permissions with role defaults.
- `packages/db/src/schema.ts`: 21 tables, 1 view, 5 delegation columns; row types.
- `packages/db/test/integration/catalogue.test.ts`: versioned-table and grant pins for the P4 tables; a P4 trigger-attachment pin.
- `packages/db/src/seed.test.ts`: the 0031 permission and role-link comparison; P4 codes excluded from the P1 comparison.
- `packages/shared/src/permissions.ts`: `P4_PERMISSIONS`, `P4_ROLE_PERMISSIONS`, merged into `PERMISSIONS` and `ROLES`.
- `apps/api/src/modules/platform/advisory-locks.ts` (+ `.test.ts`): classes 730224–730226 (730227 reserved); the test pins them, maps the three migration constants and scans 730219–730249 in module sources.
- `docs/api/openapi.yaml`: 1.3.0-p4; 9 tags, 51 operations, their parameters and schemas; 11 values appended to the response-only `PermissionCode` enum.
- `apps/api/test/support/p4-pending.ts`, `p4-pending-arch-01.ts`, `p4-pending-be-a.ts` (15), `p4-pending-be-b.ts` (23), `p4-pending-be-c.ts` (13): the contract-first seams.
- `apps/api/test/support/p4-operations.ts`: the 51 P4 operation ids (the `p3-operations.ts` precedent).
- `apps/api/test/support/p2-pending.ts`: includes `P4_PENDING_OPERATIONS` (the P3 precedent).
- `apps/api/test/integration/contract/contract.test.ts`: the operation-count pin 270 → 321, with its comment.
- `apps/api/test/integration/aud-write-deny.test.ts`: the P2-scoped AUD sweep also skips P4 operations (as it skips P3).
- `apps/api/test/integration/identity.test.ts`: the `GET /me` pin of TO's permissions gains TO's six P4 grants.
- `docs/architecture/adr/ADR-0025-…`, `ADR-0026-…`, `docs/architecture/README.md`, `ADR-0016-…` §6, `erd.md`, `data-dictionary.md`, `p4-work-split.md`, `docs/analysis/permissions-matrix.md`: as in §2.
- `docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/*`: the probe, the contract generator (`openapi-p4-arch01.py`, provenance), the contract diff check, the dictionary generator, migration hashes and every command log.

## 4. Migration apply and guard probe (real output)

Command (disposable cluster, my port range):

```text
QA_PG_PORT=23700 MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh \
  node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/probe.ts
```

Result: `probe-output.txt`: **81 PASS, 0 FAIL**, `PROBE RESULT: PASS`, exit 0, on PostgreSQL 16.13 (UTF8, C). Migration hashes in `migration-sha256.txt`. In summary:

- **Fresh database:** 0001→0031 apply (31 files).
- **P3-populated database:** 0001–0027, two synthetic transformations with the P3 starter structure, and a DG3-fixture-style delegation row (no audit event); then 0028–0031 apply.
  - Backfill: one default calendar per organization (Asia/Riyadh, `{7,1,2,3,4}`, no holiday); per transformation 2 matrices, 4 T11 rows, 6 T12 deliverables and 36 cells; 98 audit events, all `system`/`migration`.
  - The DG3 delegation row survives unchanged; `p4_instantiate_transformation` and `p4_ensure_default_calendar` are idempotent.
- **Seeds verbatim:** S01 (T11 = B0099), S02 (copy; Business scope change → SP), S03 (T12 = B0101, BAU Handover BO = `A/R`).
- **Each new guard fires:**
  - Missing audit fails at COMMIT: G01 (`business_calendar`), G10 (`work_item`), A26 (`approval`).
  - Non-stepping version: G03, G29 (`delegation`), J02.
  - UPDATE/DELETE on history: A21 (`approval_escalation` UPDATE), A24/A25 (`approval_decision` UPDATE/DELETE).
  - Invariants: G04–G08 (calendar); G12–G17 (dedupe, relative link, closed item, read once); G19–G23 (groups, mappings); G25, G27, C01 (loop refused, also concurrently under lock 730224); G30; R02–R07 (RACI value, one accountable, exception, copy independence); A01–A20, A22–A23 (approval state machine, stale, SoD, rationale, defer, outcome needs a decision, escalation once and only when overdue); A28–A29 (no technical admin holds `approval.decide`).

## 5. Checks actually run (environment: Node 24.21.0, `/opt/nvm/versions/node/v24.21.0/bin`, offline)

| Check | Command | Result |
|---|---|---|
| Historical gate | `node tools/gates/validate.mjs --historical --stage DG3` | PASS, exit 0 |
| Typecheck | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` | exit 0 (`lint.log`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`format.log`) |
| OpenAPI lint | `pnpm openapi:lint` | `PASS … 321 operations`, exit 0 (`openapi-lint.log`) |
| Contract additive | `python3 …/openapi-diff-check.py <HEAD openapi> docs/api/openapi.yaml` | PASS: P1–P3 paths and components unchanged; 270 → 321; 11 enum values appended (`openapi-diff-check.txt`) |
| Probe | see §4 | 81 PASS / 0 FAIL |
| Unit tests, locale unset | `env -u LANG -u LC_ALL pnpm test` | `Test Files 81 passed (81)`, `Tests 1657 passed (1657)`; `unit-formula-nocodegen`: 3 files, 259 passed, 2 skipped; exit 0 (`unit-locale-unset.log`) |
| Unit tests, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | the same counts, exit 0 (`unit-c-utf8.log`) |
| Integration | `env -u LANG -u LC_ALL QA_PG_PORT=23740 MTH_PORT_POOL=23741-23749 tests/qa/support/with-pg.sh pnpm test:integration` | `Test Files 56 passed (56)`, `Tests 794 passed (794)`, exit 0, PostgreSQL 16.13 disposable (`integration.log`) |

**Pinned counts changed:** `contract.test.ts` total operations 270 → 321. Unchanged: the media-type triple `[150, 149, 1]` and the rate-limit floor `≥ 270` (both count live operations only, and the 51 new ones are pending). The P2 AUD sweep still covers its 128 P2 operations. `catalogue.test.ts` has one new test (P4 trigger attachment), and `seed.test.ts` three (the 0031 comparison).

**Non-zero exits during the run, disclosed:**

1. **First integration run: 273 failed / 362 passed / 210 skipped** (`integration-first-run.log`). Cause: my first permission design granted `approval.decide` (`business_approval`) to TL, TO, WL and CM. Two DG1/DG2 rules key on "a role holding an approval permission": the creator-derived assignment (F-DG1-106) and the team view (ADR-0020 §3). TL creators lost their derived assignment, and almost every suite that creates a transformation as a BU-scoped TL failed. **Fix:** `approval.decide` goes only to SP, BO and FIN, which already held approval permissions (ADR-0026 §8), plus the routing rule `routing.assignee_not_approver`.
2. **Second integration run:** started with `&` instead of as a background task. Its log is empty (0 lines): the shell ended the detached process before it ran anything. No result is claimed from it.
3. **Third integration run: 57 failed / 788 passed** (`$TMPDIR`, summarized here). The failures were:
   - 54 from the P2-scoped generated AUD sweep (`aud-write-deny.test.ts`), which now saw the 51 pending P4 operations. Fixed with `p4-operations.ts`, the `p3-operations.ts` precedent.
   - 1 from the `GET /me` pin of TO's exact permission list. Updated with the six P4 grants, the P3 precedent.
   - 2 in `request-io.test.ts` (F-DG2-411: `/readyz` answered 503). I had edited `0031` (the `party_not_approver` routing error) while that run was in progress, so `/readyz` saw an applied-migration checksum that no longer matched the file. The final run is on the final files.
4. **Probe and dictionary generator:** two script errors of my own (a wrong parameter count, and a PL/pgSQL record-field reference in the 0030 trigger that only fired on the backfill path), both fixed before the recorded runs. The first failed migration run of 0030 is why the trigger reads `deliverable_id` through `to_jsonb(NEW)`.

## 6. Behaviour delivered per requirement (design + database; the API routes are the implementers' work)

- **REQ-S10-006:** calendar entity with configurable timezone, workweek and holidays. No holiday until configured. Working-day rule and worked examples are in ADR-0025 §1, Unknown when not computable (probe G01–G08).
- **REQ-S12-005:** `work_item` + `inbox_notification` with dedupe keys, `createWorkItemOnce`, the `kpi.reporting_period_open` schedule, KBE-C's handler rule (probe G10–G17, J01).
- **REQ-S15-008:** three time attributes and their column shapes; `p4_business_date` (probe G09); currency copied per row at creation.
- **REQ-S16-005:** pg-boss only; `job_schedule`; the `runOnce` and ledger rules; unique effect keys (probe G12, A19).
- **REQ-PB-008:** Transform readiness checks (ADR-0026 §9), new path `getTransformReadiness`; the DG3 operation is unchanged.
- **REQ-PB-065:** T11 seeded verbatim, copied per transformation; `routeByDecisionRight`; Business scope change → SP (probe S01–S02).
- **REQ-PB-066:** the three SLA types (D-089 Q6), working days via the calendar, Unknown with reasons.
- **REQ-PB-067:** T12 seeded verbatim; values A, R, C, I, A/R; 'X' refused (probe S03, R02).
- **REQ-S10-003:** no technical-admin role holds `approval.decide` (probe A28–A29); ADM-only → 403.
- **REQ-S10-007:** per-transformation copies; edits change neither the template nor another transformation (probe R06); versioned matrix approval by SP.
- **REQ-S10-008:** role mapping to a person or a governed group; no fallback; `routing.role_unmapped`.
- **REQ-S10-009:** exactly one A or A/R per deliverable at COMMIT unless a documented exception (probe R01–R05, R07).
- **REQ-S10-010:** delegation columns, loop guard incl. concurrency (probe G24–G30, C01); capability at use time; "B on behalf of A".
- **REQ-S10-014 / -016 / -017 / -018 / -019:** the approval record, SoD, stale 409, four outcomes and escalation-never-approves (probe A01–A27).
- **REQ-S16-011:** the eight entities mapped with PK, owner and status (ADR-0026 §10); Group and Delegation get APIs (BE-B).

## 7. For the orchestrator (decisions and risks)

1. **Migration contiguity (blocking for ARCH-02).** `seed.test.ts` requires migration ids `1..n` with no gap. `0032` (left free for slice I+C implementers) must exist before ARCH-02's `0033` merges. The work split assigns `0032` to BE-A: its own follow-up, or a documented no-op. The same applies to every ARCH range whose numbers are not all used (p4-work-split S-12, §I+C.4).
2. **`approval.decide` scope.** Only SP, BO and FIN hold it (ADR-0026 §8). As a consequence, a SteerCo group used as an approver must contain members holding one of those roles in the transformation; otherwise routing is refused visibly (`routing.assignee_not_approver`). Committee members (CM) do not decide P4 approvals unless they also hold SP, BO or FIN. Granting CM the right would change the DG2 team view; that would be a reopen.
3. **Escalation past SP.** For Business scope change the D-089 Q7 default chain is `SP` alone, so its first escalation is recorded as `no_next_authority`: visible, exactly once, never an outcome. A transformation can configure a longer chain (e.g. `SP, STEERCO`).
4. **REQ-PB-008 path.** The requirement's `screen_api` hint reads `GET …/readiness?phase=transform`. To keep the DG3 operation byte-stable (D-089), Transform readiness is a new path `GET …/readiness/transform`. This is the architect's choice; change it only with a reopen of the DG3 operation.
5. **REQ-PB-065 literal acceptance** ("a change request of type Business scope change") completes when slice H's BE-L calls `routeByDecisionRight` (ARCH-07). BE-C proves the routing earlier with a `decision_request`.
6. **Size risk.** BE-A (15 operations + registry + worker split) and BE-B (23 operations + two jobs) are at the top of the 60–75 minute band. Each has a named separable second half for D-059/D-070 salvage.
7. **`delegation` audit trigger not attached** (DG3 fixtures insert rows directly). API audit coverage for delegation writes is a test obligation of BE-B.

## 8. DG1–DG3 artifacts changed, and why (D-089)

- `docs/api/openapi.yaml`: additive only (D-089 "P1–P3 paths byte-stable"; the diff check proves it). `info.version` 1.3.0-p4 as assigned; `PermissionCode` values appended (response-only enum, the P2/P3 precedent).
- `docs/architecture/erd.md` §2.1: Group now `access_group` in P4 (was "P6 `app_group`") and the Delegation stage text, because the D-089-adopted plan builds Group in P4 (seam 10). Group-to-assignment mapping stays P6.
- `docs/architecture/adr/ADR-0016` §6: rows 730224–730227 and the block rule. The assignment requires this registry entry.
- `docs/architecture/README.md`: two index rows.
- `packages/db/src/schema.ts`, `catalogue.test.ts`, `seed.test.ts`, `packages/shared/src/permissions.ts`, `advisory-locks.ts`/`.test.ts`: append-only P4 entries (p4-plan §5.3); the lock test now scans 730219–730249 so later P4 classes are also caught.
- `apps/api/test/support/p2-pending.ts`, `apps/api/test/integration/contract/contract.test.ts` (count pin only), `aud-write-deny.test.ts` (skip P4, as for P3), `identity.test.ts` (TO's permission list): the P3 seam precedents for a contract-first stage. No DG1–DG3 assertion about P1–P3 behaviour changed.
- `delegation` (DG1 table): additive columns, a CHECK every existing row satisfies, the row guard and the loop guard (seam 9, additive per D-089 Q3).

## 9. End

- **End time:** `Fri Oct  9 01:53:54 UTC 2026` (about 50 minutes after the start). `validate --historical --stage DG3` was run again at the end: PASS, exit 0 (`validate-dg3-historical.log`).
- **What the implementers of slices I and C must know:** `docs/architecture/p4-work-split.md` §I+C.8 (ten points) and the shared rules S-1…S-14. The most important are:
  - groups grant nothing;
  - `approval.decide` is SP, BO and FIN only;
  - there is no routing fallback;
  - the stale check is on the subject;
  - a timer never decides;
  - due dates are Unknown, never guessed.
