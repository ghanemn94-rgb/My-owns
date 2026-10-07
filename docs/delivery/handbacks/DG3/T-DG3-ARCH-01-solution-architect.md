# Handback T-DG3-ARCH-01 — solution-architect — P3 architecture foundation (DG3)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-ARCH-01-solution-architect-20261007T210654Z-1a48d702","session_id":"1a48d702-ba67-4dc9-9ab8-a81e71fde192"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-ARCH-01.md` (sha256 `1cc685ff…ddb997ca`, verified at start).
- **Base:** `HEAD` = `2376ca4db7b4e998c8d5b337928041363d3e96a4` on `claude/mobily-transformation-platform-regate`. Nothing committed by this task.
- **`date -u` at start:** `Wed Oct 7 21:07:01 UTC 2026`. **At end:** `Wed Oct 7 21:55 UTC 2026` (last checkpoint `21:54:27`).
- **Environment:** Node v24.21.0, pnpm 10.33.0, offline. Disposable PostgreSQL 16.13 through `tests/qa/support/with-pg.sh` (UTF8, C locale). Ports 24617, 24619, 24621, 24633 and 24641, all below 32768.
- **Engineering vs product gates:** nothing here grants a business, Finance or IT approval. G1–G6 are product gates; this task touches no DG0–DG7 record.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG2` → `PASS gate DG2 (historical)`, **exit 0**. It was run before any write, and again at the end (`T-DG3-ARCH-01-evidence/validate-dg2-historical.log`, exit 0).

## 2. Deliverables (all six complete)

| # | Deliverable | Files | State |
|---|---|---|---|
| 1 | ADRs | `docs/architecture/adr/ADR-0021-p3-portfolio-initiative-lifecycle-g4.md` (a, g), `ADR-0022-p3-prioritization-scoring-ranking.md` (b), `ADR-0023-p3-roadmap-dependencies-capacity-funding.md` (c, d), `ADR-0024-p3-business-case-and-formula-foundation.md` (e, f) | Done |
| 2 | Migrations, schema types, permissions | `packages/db/migrations/0020_p3_portfolio_roadmap.sql`, `0021_p3_prioritization.sql`, `0022_p3_dependency_capacity_funding.sql`, `0023_p3_business_case_formula.sql`, `0024_p3_gates_access_instantiation.sql`; `packages/db/src/schema.ts`; `packages/shared/src/permissions.ts` | Done; probe PASS |
| 3 | Probe | `T-DG3-ARCH-01-evidence/probe.ts`, `probe-output.txt` | 42 PASS, 0 FAIL |
| 4 | ERD + data dictionary | `docs/architecture/erd.md` §1c; `docs/architecture/data-dictionary.md` "P3 tables" (generated from the migrated catalogue) | Done |
| 5 | API contract | `docs/api/openapi.yaml` (1.2.0-p3): 109 P3 operations on 76 new paths; G1 extension | `openapi:lint` PASS, 270 operations |
| 6 | Permissions + work split | `docs/analysis/permissions-matrix.md` §9; `docs/architecture/p3-work-split.md`; `docs/architecture/README.md` index | Done |

Nothing is left for a continuation task.

## 3. Changed files (purpose)

**New**

- `docs/architecture/adr/ADR-0021…0024-*.md`: the P3 design decisions (see §2).
- `docs/architecture/p3-work-split.md`: eleven tasks, file ownership, seams, integration order, the 32-row owner table, and the P3 increments of later-gate rows.
- `packages/db/migrations/0020`–`0024`:
  - 30 new tables, all guarded;
  - the compatible extension of `dependency`;
  - the cycle guard;
  - seeds: dependency types, the two T09 examples, the G4 criteria and the P3 permissions;
  - `p3_instantiate_transformation()` with a backfill.
- `apps/api/test/support/p3-pending.ts` (frozen aggregate) and `p3-pending-{be-a,be-b,be-c,be-d,be-e,kbe-b,kbe-c}.ts`: one pending list per task, 109 operations in total.
- `apps/api/test/support/p3-operations.ts`: the frozen list of the 109 P3 operationIds.
- `docs/delivery/handbacks/DG3/T-DG3-ARCH-01-evidence/*`: the probe, the OpenAPI path generator (provenance), the contract diff check and all command logs.

**Modified**

- `packages/db/src/schema.ts`: Kysely types for the 30 tables, plus `dependency.from_initiative_id` and `to_initiative_id`.
- `packages/shared/src/permissions.ts`: `P3_PERMISSIONS` (15 codes) and `P3_ROLE_PERMISSIONS`, merged into `PERMISSIONS`/`ROLES`.
- `packages/db/src/seed.test.ts`: the 0005 check excludes P2 and P3 codes; a new "0024 seed equals the P3 part" block.
- `packages/db/test/integration/catalogue.test.ts`: P3 tables in the versioned-table list and the exact grant map.
- `docs/api/openapi.yaml`:
  - P3 paths, parameters and schemas;
  - `PermissionCode` gains the 15 P3 codes (response-only);
  - `GateDecisionCreate.agreements` and `GateDecision.agreements` (optional).
- `docs/architecture/erd.md`, `data-dictionary.md`, `README.md`; `docs/analysis/permissions-matrix.md`.
- Test seams, needed so the existing suites stay green with contract-first P3 operations:
  - `apps/api/test/support/p2-pending.ts` includes the P3 set;
  - `test/integration/contract/malformed-input.ts` sweeps routed operations only;
  - `contract.test.ts`: the operation count is 270, and the media-type and rate-limit sweeps exclude pending operations;
  - `test/integration/aud-write-deny.test.ts` keeps to P2 scope (it excludes `P3_OPERATION_IDS`);
  - `test/integration/identity.test.ts`: TO's effective permissions now include its seven P3 codes.

## 4. Behaviour delivered per requirement (architecture and database level)

- **REQ-S16-016**
  - The eight entities have tables with PK, owner and status columns: `initiative`, `deliverable`, `milestone`, `roadmap_wave`, `dependency` (canonical, extended), `resource_demand`, `capacity`, `funding_decision`.
  - ERD §1c.5 maps each one to its module and owner.
  - The API create+read with authorization belongs to BE-B, BE-C and BE-E.
- **REQ-PB-004, -006, -007, -022, S09-003**
  - The ADR-0021 §3 transition table gives every precondition with its exact 422 code and text.
  - The DB edge guard is `initiative_status_step`.
  - Waivers and inherited approvals live in `gate_dispensation`. The probe showed that an inherited approval without evidence is refused.
- **REQ-PB-007:** readiness contract and the B0012→T01 mapping: economics=financial, customer=customer, operations=process, capability=people_org, technology=technology+data.
- **REQ-PB-022:** the `agreements` contract, the `gate_decision_agreement` table and its guard. The deferred "three rows" guard ships with the API change (BE-A `0025`). See §8.
- **REQ-PB-032, -040, -045, -046**
  - The outcome contribution requires an outcome (NOT NULL), and its KPI must belong to that outcome (trigger).
  - Gap links are 1..n, to `tom_gap` or `diagnostic_finding` only.
  - A TOM record type gives 422 `initiative.not_tom_evidence`.
  - The 14 T05 fields are mapped in ADR-0021 §2.
- **REQ-PB-047, -048, -049, S09-001, S09-005**
  - Weight sets are versioned and immutable (freeze trigger, append-only weights).
  - The total is exactly 100. The probe showed 95% refused at COMMIT and the v2 set with risk_compliance 10 accepted.
  - Score 1–5: the probe showed 6 refused.
  - Results are pinned to their weight-set version, using `numeric(7,4)`.
  - Ranking entries carry causes. Overrides need a reason and an approver who is not the proposer.
  - v1 25/25/20/15/15 is seeded per transformation and backfilled (probe).
- **REQ-PB-050:** the four B0079 waves are seeded verbatim, with provisional Arabic and overlapping horizons. The probe confirmed 'Wave 0 — Mobilize', '0-6 weeks', 'Sponsor + charter', and that the source text is immutable.
- **REQ-PB-051, -052, S09-008**
  - T08 runs on the canonical `dependency`.
  - The five system types cannot be deleted or retired (probe), and an unknown type is refused (probe).
  - The cycle guard is race-free. The probe showed A→B→C→A refused naming `INI-03 -> INI-01 -> INI-02 -> INI-03`, A→B→A refused the same way, and of two concurrent connections exactly one commits.
- **REQ-PB-053, -054, -055, S05-005**
  - Business cases have ten typed sections and exactly one class per line (probe: two classes refused).
  - The value basis is bound to the class.
  - One active transformation case; each initiative case's parent is the transformation case (probe).
  - One formula backs at most one line.
  - Finance validation applies to the baseline (hash, so it can go Stale) and to formula versions (validator ≠ author; probe).
- **REQ-PB-056, -057, S08-007**
  - T09 has six columns; confidence H/M/L (probe: X refused).
  - Versions are immutable (probe), and the lineage tables are append-only (probe).
  - Both examples are seeded with expressions and typed variables (0.10→0.12 × 100000 × 50 SAR = 100000; 200000 × 2.50 = 500000).
  - The restricted grammar, type and period rules are specified in ADR-0024 §6. The engine is KBE-A's task.
- **REQ-PB-059, S09-004:** capacity and demand are decimal FTE per role and month, and `committed` is the G4 commitment. The conflict rule and the schedule flags are specified; computing them is the API's job.
- **REQ-PB-019, S04-006:** the eight `g4.*` criteria are seeded with their missing-item labels ('Owners', 'Finance validation', initiative names). The 403/409 contracts are reused. G4 stays `submission_enabled = false` until BE-E (§8).
- **REQ-DLV-035:** the architecture, seeds and guards are in place. The 3.30, 95% and G4 end-to-end tests are assigned (work split §7).

## 5. Checks actually run (real exit codes)

All logs are in `docs/delivery/handbacks/DG3/T-DG3-ARCH-01-evidence/`.

| Check | Command | Result |
|---|---|---|
| DG2 historical | `node tools/gates/validate.mjs --historical --stage DG2` | `PASS gate DG2 (historical)`, exit 0 (start and end) |
| Install | `pnpm install --frozen-lockfile --offline` | "Already up to date", exit 0 |
| Typecheck | `pnpm -r typecheck` | all 7 projects Done, exit 0 |
| Build | `pnpm -r build` | Done, exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format:check` | **exit 2, environment:** prettier cannot read 12 untracked root files that the sandbox denies (`.bashrc`, `.zshrc`, `CLAUDE.local.md`, `.idea`, …; `format.log`). Every readable file: "All matched files use Prettier code style!" |
| Format (tracked + new files) | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | "All matched files use Prettier code style!", exit 0 (`format-tracked.log`) |
| OpenAPI | `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 270 operations`, exit 0 |
| Contract stability | `openapi-diff-check.txt` (YAML deep compare against `HEAD`) | 106 P1/P2 paths, **0 changed**; components changed: only `PermissionCode`, `GateDecision`, `GateDecisionCreate` (additive); 129 schemas and 17 parameters added; 76 new paths |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 50 files, **929 passed**, exit 0 |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 50 files, **929 passed**, exit 0 |
| Integration | `QA_PG_PORT=24641 tests/qa/support/with-pg.sh pnpm test:integration` | 39 files, **612 tests passed**, exit 0 (`integration.log`) |
| Migration + guard probe | `QA_PG_PORT=24617 tests/qa/support/with-pg.sh node --conditions=@mth/source …/probe.ts` | 42 PASS, 0 FAIL, `PROBE RESULT: PASS`, exit 0 |

**About the integration run.** The first run (port 24633) failed 111 tests, in 2 files, for two reasons:

- `aud-write-deny.test.ts` swept every contract operation, including the unrouted P3 ones (404s);
- `identity.test.ts` pinned TO's effective permissions, which the 0024 seed extends.

Both are fixed as described in §3, and the re-run is fully green.

### Probe output (tail; full file `probe-output.txt`)

```
PASS  fresh database: all migrations apply  -- applied 24: 0020…, 0021…, 0022…, 0023…, 0024…
PASS  P2 database populated (0001-0019 + synthetic transformation, P2 starter rows, DG2 dependency)  -- applied 19, p2 starter rows 23
PASS  P3 over P2 database: 0020+ apply
PASS  backfill: four source waves verbatim  -- "Wave 0 — Mobilize","0-6 weeks","Sponsor + charter" …
PASS  backfill: weight set v1 = 25/25/20/15/15, active, source_default
PASS  backfill audited as migration/system  -- audit rows 5
PASS  DG2 dependency row survives (type 'other' now an FK to a system type)
PASS  p3_instantiate_transformation is idempotent  -- second run created 0
PASS  P01 initiative insert WITHOUT its audit event fails at COMMIT  -- 23000 initiative_audit_required
PASS  P03 initiative version must step by exactly 1  -- 23514 initiative_version_step
PASS  P04 initiative illegal status edge draft -> launched  -- initiative_status_transition
PASS  P06 weight set totalling 95% fails at COMMIT  -- scoring_weight_set_total (got 95.00 over 5)
PASS  P08/P09 scoring_weight is append-only (UPDATE/DELETE)
PASS  P12 cycle-closing INI-03 -> INI-01 refused by the database, naming the cycle  -- dependency cycle: INI-03 -> INI-01 -> INI-02 -> INI-03
PASS  P13 two-node cycle  -- dependency cycle: INI-02 -> INI-01 -> INI-02
PASS  P14 concurrent A->B / B->A: exactly one commits (advisory lock + guard)
PASS  P15/P16 system dependency type cannot be deleted / retired
PASS  P19 business case line with two classes refused
PASS  P23 formula version expression is immutable
PASS  P24 the author cannot Finance-validate their own formula version
PASS  P25/P26/P27 benefit_calculation, ranking_entry, funding_decision append-only
PASS  P27b funding decision without its audit event fails at COMMIT
PASS  P31 mth_app cannot DELETE an initiative (no DELETE grant)
PROBE RESULT: PASS (all guards fired as specified)
```

**Probe note.** In the first probe run, P26 and P27 reported FAIL: they ran UPDATE/DELETE against *empty* tables, so no row trigger could fire. That was a probe defect. I fixed it by inserting real rows first, and the re-run passes. The migrations did not change between the two runs.

## 6. Dependency request

None. The formula engine is designed as hand-written code on decimal.js 10.6.0, which `@mth/shared`, `apps/api` and `apps/web` already pin (ADR-0024 §6). No lockfile change.

## 7. DG2 artifacts changed, and why

| Artifact | Change | Compatibility |
|---|---|---|
| `record_code_counter` CHECK (`0017`) | Widened by `0020` to add `INI`, `BC`, `BF` | Additive; existing rows unaffected |
| `dependency` (`0017`) | `0022` drops the closed type CHECK, adds an FK to `dependency_type` (the five DG2 codes are system rows), two nullable initiative columns, CHECKs and the cycle guard | Existing rows and every DG2 operation keep working (probe: DG2 row survives). The DG2 paths stay byte-stable. A custom type is projected as `other` on the DG2 operations, per ADR-0023 §4 (BE-C implements this) |
| `decideGate` / `GateDecisionCreate` / `GateDecision` | Optional `agreements` (request); optional `agreements` list (response) | Schema-compatible. **Behaviour change (assignment-allowed REQ-PB-022 extension):** a G1 `approved` decision without the three confirmations becomes 422 `gate.g1_agreements_required`. G1 reject/changes/defer and all G2/G3 decisions are unchanged. DG2 tests that approve G1 must send `agreements` (BE-A) |
| `PermissionCode` enum | +15 P3 codes | Response-only enum; additive |
| Readiness | New path `GET /transformations/{id}/readiness` | Additive (assignment-allowed REQ-PB-007 extension) |
| Data dictionary entries `record_code_counter`, `dependency` | Regenerated to match `0020`/`0022` | Documentation |
| DG2 tests (`aud-write-deny`, `identity`, contract seams) | Scope and pinned-list updates (§3) | No assertion was weakened for P1/P2 operations |

**Reopen candidates:** none. Two later DG2-visible changes are scheduled rather than made silently: G4 `submission_enabled` → true (BE-E, `0026`, with the one DG2 assertion updated) and the G1 three-agreement DB guard (BE-A, `0025`).

## 8. Known gaps / not done (stated plainly)

1. **No API, web or engine code is implemented by this task**, by design. Routes, evaluators, `packages/shared/src/formula/**`, `scoring.ts` and the screens belong to the eleven implementation tasks. All 109 P3 operations are contract-only and listed as pending, so the DG3 candidate cannot freeze until those lists are empty.
2. **G1 agreement DB guard not in `0024`.** Adding it would break the DG2 G1 approval before the API sends confirmations. It is specified for BE-A `0025`. Until then the API is the only enforcement.
3. **G4 is seeded but not submittable** (`submission_enabled = false`). The G4 view shows eight `incomplete` criteria with `gate.criterion_not_evaluable` (the DG2 fail-closed rule) until BE-E ships the evaluators and `0026`.
4. **`p3_instantiate_transformation()` is not yet called by `POST /transformations`.** The API still calls `p2_instantiate_transformation()`. BE-A switches it (one line). Existing transformations are already backfilled by `0024`.
5. **Moving pinned counts.** As operations get routed, the contract test's media-type triple `[87, 86, 1]` and the rate-limit floor move. BE-A owns `contract.test.ts` and updates them.
6. **Arabic text** in the seeds (waves, dependency types, G4 criteria, examples, permissions) is a provisional translation that needs linguistic review. All illustrative values are synthetic.
7. **`format:check` is environment-blocked** at the repository root by sandbox-unreadable untracked files (§5). Tracked and new files pass.

## 9. Merge instructions

- Apply migrations `0020`→`0024` in order (forward-only). They apply on a fresh database and over a P2-populated one, and backfill waves and weight set v1 for existing transformations, audited as `system`/`migration`.
- New migration numbers are reserved: `0025` (BE-A, G1 agreement guard) and `0026` (BE-E, enable G4).
- No lockfile or dependency change.
- Integration order and file ownership: `docs/architecture/p3-work-split.md` §6. BE-A first change and KBE-A run in parallel. Then BE-B/C/D, KBE-B and FE-A/B/C. Then KBE-C, then BE-E, then FE wiring.
- Expected conflicts: none by construction (one pending file per task; sequenced shared touch points).

## 10. P3 work-split summary

- **BE-A** (lands first; 6 operations):
  - registry, stubs, problem mapping, instantiation switch;
  - G1 agreements + `0025`;
  - readiness, outcome hierarchy, gate dispensations, `sequencing.ts`;
  - wires every `p3-exercises-<task>.ts`.
- **BE-B** (20 operations): initiatives, links, lifecycle transitions with exact 422 texts, selection.
- **BE-C** (25 operations): waves, deliverables, milestones, roadmap read model, `schedule.ts`, T08 on `/dependencies` with the advisory lock, dependency types, the DG2 projection rule.
- **BE-D** (17 operations): weight sets, scores, rankings with causes, overrides, prioritization view (uses `scoring.ts`).
- **BE-E** (17 operations, lands last on the backend): capacity, demand commitments, funding (canonical executive decision), the G4 evaluators and snapshot, `0026`.
- **KBE-A:** `packages/shared/src/scoring.ts` and `packages/shared/src/formula/**` (hand-written restricted language, decimal.js only, ESLint no-eval override).
- **KBE-B** (11 operations): business cases, lines, totals/roll-up, baseline validation.
- **KBE-C** (13 operations): benefit formulas, versions, calculations, examples, Finance validation, kpi G4 facts.
- **FE-A:** portfolio, readiness, dispensations, G1 agreements dialog, G4 view; owns router, nav and api.
- **FE-B:** prioritization, roadmap (timeline, table and board on one cache entry), dependencies, capacity.
- **FE-C:** business cases, T09 formula builder.
- All 32 DG3 rows have owners (work split §7). Later-gate P3 increments are listed in §8 of the work split. Critical path is explicitly out of P3 scope.
