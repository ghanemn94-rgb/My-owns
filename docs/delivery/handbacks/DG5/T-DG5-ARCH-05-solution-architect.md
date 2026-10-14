# Handback: T-DG5-ARCH-05, P5 architecture for slices G and H (solution-architect)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-05-solution-architect-20261014T085005Z-5a6d20ef","session_id":"5a6d20ef-2321-489e-ba85-857572624308"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-ARCH-05.md` (sha256 `ea7f0849…6ecb`, verified at the start).
- **Base:** `f591b7c0981242d246816a3868fe8e36660d181c` on `claude/mobily-transformation-platform-regate` (DG4 APPROVED; DG5 BUILDING).
- **Start:** `date -u` = Wed Oct 14 08:50:17 UTC 2026. **End:** see §3.8.
- **Ports used:** 23701–23702 (quick apply and catalogue pins), 23710 (probe), 23715 (dictionary generator), 23720 (integration); all inside 23700–23749.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. `kpi_restatement.approve` is a business approval *inside the product*, decided by a person; no agent, seed or job approves anything, and all probe data is synthetic.

## 1. Deliverables

| # | Deliverable | Where | State |
|---|---|---|---|
| 1 | ADR-0047 (KPI prospective change and restatement, formula preview, optional NPV/ROI/payback) | `docs/architecture/adr/ADR-0047-p5-kpi-restatement-formula-preview-financial-metrics.md` | done |
| 1 | ADR-0048 (launch plan, Day-90 test, health check, versioned scoring schemes, HealthAssessment) | `docs/architecture/adr/ADR-0048-p5-launch-plan-day-90-test-health-check-scoring-schemes.md` | done |
| 1 | Dated notes (D-146): ADR-0039 §9 (revision proposals listed only with `transformation.read`), ADR-0043 (BE-H's action parameter schemas, three codes, idempotent enable/disable) | appended "Amendment (2026-10-14, T-DG5-ARCH-05; D-146)" to both | done |
| 2 | Migrations `0085`–`0087` (forward-only; P2 guards on every new mutable table) | `packages/db/migrations/0085_p5_kpi_restatements_financial_metrics.sql`, `0086_p5_launch_plans_health_checks.sql`, `0087_p5_kpi_launch_health_permissions.sql` | done; `0088` left free for KBE-G2 |
| 2 | Kysely types (18 tables), catalogue and seed pins, `P5_KPI_LAUNCH_HEALTH_PERMISSIONS`, lock classes 730266–730268 (730269 reserved) | `packages/db/src/schema.ts`, `packages/db/test/integration/catalogue.test.ts`, `packages/db/src/seed.test.ts`, `packages/shared/src/permissions.ts`, `apps/api/src/modules/platform/advisory-locks.ts` (+ test), ADR-0016 §6 | done |
| 2 | Studio element types `health_response`, `health_band` | `packages/shared/src/schemas/studio.ts` (`CONFIG_ELEMENT_TYPES`, `ELEMENT_TYPES_BY_KIND`, `CONFIG_ELEMENT_ATTRIBUTES`), contract `ConfigElementType` | done |
| 2 | Work-item kinds wired into My Work (`kpi_restatement_to_decide` → approvals; `report_reissue_offer`, `day_ninety_test_due` → assigned actions) with en/ar labels | `apps/api/src/modules/reporting/my-work.ts`, `apps/web/src/i18n/{en,ar}/myWork.json` | done |
| 3 | Probe: fresh DB and P4-populated DB; guards | `docs/delivery/handbacks/DG5/T-DG5-ARCH-05-evidence/probe.ts`, `probe-output.txt` | **157/157 PASS** |
| 4 | ERD §1p, data dictionary "P5 tables, slices G and H" (generated from the catalogue) | `docs/architecture/erd.md`, `docs/architecture/data-dictionary.md`, generator `…/gen-dictionary.ts` | done |
| 5 | Contract: 38 operations, `info.version` 1.4.0-p5 (unchanged), `PermissionCode` +7, `ConfigElementType` +2, 6 tags | `docs/api/openapi.yaml` (generator `…/openapi-p5-arch05.py`) | `pnpm openapi:lint` PASS, 827 operations |
| 5 | Contract-test seams | `apps/api/test/support/p5-pending-arch-05.ts` (aggregate) + `p5-pending-{kbe-e,kbe-e2,kbe-f,be-p,be-p2,kbe-g,kbe-g2}.ts`; `p5-pending.ts` import; `p5-operations.ts` block; `contract.test.ts` count 789 → 827 | done |
| 6 | Permissions matrix §22; p5-work-split §G and §H (7 implementer tasks, file ownership, contracts, integration order, requirement → owner, 12 rules) | `docs/analysis/permissions-matrix.md`, `docs/architecture/p5-work-split.md` | done |

Nothing in the assignment's deliverables list is left for a continuation task. Open decisions for the orchestrator are in §4.

## 2. Behaviour designed, per requirement

| Requirement | Design (ADR) | Database (migration, probe) | Owner tasks |
|---|---|---|---|
| REQ-S07-016 | ADR-0047 §1 (prospective = open periods only; closed only by restatement), §2 (selected closed periods, authority SP/BO/FIN, never the requester, retained reconciliation written at submission), §3 (one restatement run; reissue offers; issued snapshots unchanged; reissue → v2 through ADR-0045 §4) | `kpi_restatement` (+ periods, reconciliation, offers), the widened `calculation_run` closed sets with `calculation_run_restatement_guard`, `kpi_evaluation_restatement_guard`; probes KR, KP, KC, CR, EV, KO | KBE-E, KBE-E2 |
| REQ-S08-005 | ADR-0047 §4: `previewFormula` (examples, unit, zero/missing/negative edge cases; `not_computable`, never 0; engine unchanged) | none (writes nothing) | KBE-F |
| REQ-S08-019 | ADR-0047 §5: off by default; explicit methodology, timing, period basis, discount rate; Finance-entered cash flows; NPV only with a discount rate; fixture NPV −21.04 (beginning) / −19.12 (end) at 10% | `financial_metric_setting`, `financial_cash_flow_set`, `financial_cash_flow`; probes FS, CF (CF03 cross-checks NPV −21.04 in SQL) | KBE-F |
| REQ-PB-086 | ADR-0048 §1: B0134 template verbatim (17 actions, 15 outputs, the Day-90 test); day *d* = start + *d* calendar days | `launch_window`, `launch_template_item`, `launch_plan`, `launch_task`; probes S01, S02, LP (LP03: Days 31-60 = 2026-11-01…2026-11-30) | BE-P |
| REQ-PB-087 | ADR-0048 §4: six questions verbatim; incomplete while unanswered; evidence suggestions; day-90 task job | `day_ninety_question`, `day_ninety_test`, `day_ninety_response`, job `launch.day_ninety_tests`; probes S03, DT, DR | BE-P2 |
| REQ-PB-091 | ADR-0048 §5: 25 questions (`source_element`, verbatim), answers with evidence/owner/action, top 3 actions required, reassessments | `health_assessment` (+ answers, actions); probes HA, HN, HX | KBE-G2 |
| REQ-PB-092 | ADR-0048 §5: the four B0152 bands verbatim in scheme v1 | seed in `0086`; probe S05, HA16 (21/16/10/9 → the four texts) | KBE-G, KBE-G2 |
| REQ-S14-001 | ADR-0048 §5: Yes = 1, No = 0, out of 25, shown as an implementation assumption | scheme v1 seed; `p5_health_assessment_result`; probe HN04 (17 → 17, band 16-20) | KBE-G, KBE-G2 |
| REQ-S14-002 | ADR-0048 §5: incomplete → `score: null`, `band: null`, "Incomplete (24/25)" | `health_assessment_incomplete`; probes HN03, HA07 | KBE-G, KBE-G2 |
| REQ-S14-003 | ADR-0048 §6: schemes are Studio versions of kind `health_check_scheme`; N/A or partial only with own bands; assessments keep their scheme | element types, `health_scheme_publish_guard`, `p5_health_scheme_problem`; probes HS01–HS11, HA14 | KBE-G, KBE-G2 |
| REQ-S14-004 | ADR-0048 §2–§3: editable tasks, owners, predecessors (no cycles; stamped removal), "blocked by" derived, +Δ re-dates not-started tasks only | `launch_task_guard`, `launch_task_predecessor_guard`; probes LT02 (+7 moves 31 not-started tasks; completed and in-progress keep dates), LD01–LD10 | BE-P |
| REQ-S16-021 | ADR-0048 §11: the six entities with PK, owner and status columns read from `0048`/`0086`; HealthAssessment new | `health_assessment` | KBE-G2 (group test) |

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), pnpm workspace, offline; PostgreSQL 16.13 disposable clusters via `tests/qa/support/with-pg.sh` (UTF8, C collation). Logs are under `docs/delivery/handbacks/DG5/T-DG5-ARCH-05-evidence/`.

### 3.1 Historical validator (start)

`node tools/gates/validate.mjs --historical --stage DG4` → exit **0**, `PASS gate DG4 (historical)` (08:50 UTC, before any change). The end-of-task run is in §3.8.

### 3.2 Migration apply and guard probe

Command: `QA_PG_PORT=23710 MTH_PORT_POOL=23711-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-05-evidence/probe.ts` → exit **0**, **157/157 PASS** (`probe-output.txt`). It covers:
- **G00–G05:** `0085`–`0087` present and `0088` free; 0001→0087 apply to an empty database (77 files); 0001–0061 with a DG3-instantiated transformation plus a DG4 `version_activated` run, then 0062→0087 on top (16 files); the DG4 rows unchanged; a DG4-kind calculation run still accepted after the widened CHECKs.
- **Seeds S01–S07:** windows and objectives verbatim; 17/15/1 template items, with the Days 31-60 actions rejoining to the B0134 cell; six Day-90 questions verbatim; scheme v1 (points; bands 21/16/10/0; yes = 1, no = 0; publish rule holds); the 0-9 band text verbatim; the seven permissions (one business approval, held by SP, BO and FIN; none for AUD or technical admins except the extension switch); work-item kinds and the audited job schedule.
- **Missing audit fails at COMMIT:** KR01, FS01, CF09, LP01, LT12, HA01.
- **Non-stepping version fails:** KR07, FS08, LP07, HA15.
- **UPDATE/DELETE on history fails:** KP04, EV04, KO04 and CF08 (no grant for mth_app); AO03–AO10 (the append-only trigger fires for the owner on UPDATE and DELETE of all four append-only tables); KC06; LD06 (no DELETE grant on the link table).
- **Every ADR database invariant:** KR (state machine, SoD, recorded authority, decision frozen, applied needs the run, one in progress per KPI); KP (closed periods of the frequency only, draft only); KC (difference, Unknown has no number, written only at submission, counts at COMMIT); CR (restatement runs only for approved restatements, exactly once); EV (selected periods and the restated version only; DG4 runs unaffected); KO; FS; CF; LP; LT; LD; DT/DR; HS (publish rule: own bands with N/A, N/A needs percent, element attribute checks); HA/HN/HX (the database recomputes score and band; three actions; incomplete; final after submission); AO (no DELETE or TRUNCATE grants; catalogues read-only).

**Disclosed failing intermediate runs:**
- **Quick apply** (`$TMPDIR/apply.ts`, port 23701): three attempts failed inside the migration transaction, each rolled back, on code-format CHECKs. `work_item_kind_code_check`, `job_schedule_code_format` and `permission_code_check` refuse digits, so `day_90_test_due`, `launch.day_90_tests` and `day_90_test.respond` became `day_ninety_*`. The fourth attempt applied.
- **Probe run 1** (`probe-run1-30-fail-digit-names-revision-step.txt`): 70 PASS, 30 FAIL, then it stopped. Causes:
  - (a) the `audit_event.action` CHECK `^[a-z_]+\.[a-z_.]+$` refuses digits, so the API could never audit a `day_90_*` table. I renamed the three tables to `day_ninety_question`/`_test`/`_response` (this was a real migration defect, fixed);
  - (b) `financial_cash_flow_set_guard` required a revision step on every update, which was wrong for a basis-note edit; it now allows 0 or +1 (a real defect, fixed);
  - (c) a fixture clock-skew on `calculation_run_times`, and probes that expected the trigger message where the grant already refused mth_app (probe defects).
- **Probe run 2** (`probe-run2-stopped-probe-fixture-draft-key.txt`): stopped on a probe fixture that created a second open draft of key `health-check`, which `methodology_version_one_open_draft_key` correctly refused. The fixture now uses another key.
- **Probe run 3** (`probe-run3-1-fail-HS06-null-attribute.txt`): 156/157. HS06 found that a band without `textAr` committed, because a missing JSON key made the guard's condition NULL. The health attribute checks in `methodology_element_guard()` and `p5_health_scheme_problem` now use `coalesce(…, false)` (a real defect, fixed).

Run 4 is the 157/157 above. The migrations were last modified before it started (`0086` at 09:24:55, output at 09:25:08); checksums in `migration-sha256.txt`.

### 3.3 Data dictionary generator

`QA_PG_PORT=23715 MTH_PORT_POOL=23716-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source …/gen-dictionary.ts > dictionary-section.md` → exit 0. It was inserted verbatim, minus the harness banner line, into `data-dictionary.md`.

### 3.4 Typecheck, build, lint, format, OpenAPI

| Command | Result | Log |
|---|---|---|
| `pnpm -r typecheck` | exit 0 | `typecheck.log` |
| `pnpm -r build` | exit 0 | `build.log` |
| `pnpm lint` | exit 0 | `lint.log` |
| `pnpm openapi:lint` | exit 0, `PASS … OpenAPI 3.1.1, 827 operations` | `openapi-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see §3.8 | `format.log` |

Disclosed: the first `pnpm openapi:lint` failed (YAML parse error at 20942:68) because three generated summaries contained an unescaped `"0"`. I escaped them in the contract and the generator, and the rerun passed. My first prettier check flagged `seed.test.ts` and `p5-pending-kbe-e2.ts`; both were reformatted with prettier.

### 3.5 Unit tests

- Locale unset (`unset LANG LC_ALL LC_CTYPE LANGUAGE; pnpm test`): exit **0**. 1827 passed (unit-node; +3 vs 1824: the new `0087` seed block), 1385 passed (unit-web), 259 passed + 2 skipped by design. Log: `unit-locale-unset.log`. The three `grep` hits for "×" are characters in passing test names.
- `C.UTF-8` (`LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`): see §3.8 (`unit-c-utf8.log`).

### 3.6 Integration tests

`QA_PG_PORT=23720 MTH_PORT_POOL=23721-23749 tests/qa/support/with-pg.sh pnpm test:integration`.
- **Run 1** (`integration-run1-7-fail-pins.log`): exit 1, 2089/2096 passed, with 7 failures in 4 files. Every failure was a pin that my additions changed; none was a behaviour regression:
  - `identity.test.ts`: TO's effective permissions now include `health_check.assess` and `launch_plan.edit`;
  - worker `schedules.test.ts` (2 tests): the new `launch.day_ninety_tests` schedule is reported as unhandled until BE-P2 fills the launch worker stub;
  - `kpi/kpi-aud-write-deny.test.ts` (2 tests): `createKpiRestatement` lies under the P2 `kpi-definitions` path, and the P2 AUD sweep excluded only P4 operations;
  - `reporting/my-work.test.ts` (2 tests): 39 → 42 kinds, and the section sizes.
  I updated the four pins (§5), and a targeted rerun of the four files passed 42/42 (`integration-rerun-failed-files.log`).
- **Run 2** (`integration.log`, the full suite after the fixes): see §3.8.

### 3.7 Pinned-count changes (for the orchestrator's reconciliation, D-079)

- `contract.test.ts` operation count **789 → 827** (+38, all pending).
- The media-type triple `[334, 333, 1]` is **unchanged**: no slice G/H operation is routed yet. When the implementers route them, the JSON-body operations are 16: `createKpiRestatement`, `decideKpiRestatement`, `previewFormula`, `putFinancialMetricEnablement`, `putFinancialMetricAssumptions`, `putBusinessCaseCashFlows`, `generateLaunchPlan`, `updateLaunchPlan`, `createLaunchTask`, `updateLaunchTask`, `putLaunchTaskPredecessors`, `putDayNinetyResponse`, `createHealthCheck`, `updateHealthCheck`, `putHealthCheckAnswer`, `putHealthCheckActions`. The bodiless POSTs are `submitKpiRestatement`, `withdrawKpiRestatement`, `completeDayNinetyTest` and `submitHealthCheck`.
- Lock registry: 34 → 37 classes.
- `seed.test.ts`: +1 describe block (3 tests).
- `catalogue.test.ts`: +1 trigger block (57 rows), +11 mutable `version` tables, +18 grant entries, and **three rows added to earlier blocks** (§5).

### 3.8 End-of-task checks

(Filled in at the end of the run; see the lines below.)

## 4. Decisions needed from the orchestrator

1. **Reopen candidate (ADR-0047 §1).** DG4's `apps/worker/src/handlers/kpi.ts` (lines 862–866) recalculates, for `version_activated`, `threshold_changed` and `trajectory_approved`, "the latest open or closed period". A version activated before the next period opens is therefore evaluated against last quarter, and last quarter's RAG as read changes. That breaks REQ-S07-016's "a prospective target change leaves last quarter's RAG unchanged". p5-plan §3 row 19 called prospective application "the DG4 behaviour", which is not exactly true. The proposal is that the three triggers recalculate the latest **open** period only. The alternative is `version_activated` only. KBE-E implements the decision.
2. **DG4 text change (ADR-0047 §3; F-DG4-160).** The `change_request.retrospective_not_supported` English text "A retrospective restatement is not supported; changes take effect from now on." becomes untrue once restatements ship. The proposed new text is "A change request takes effect from now on; restate closed periods through a KPI restatement."; the code and status are unchanged. KBE-E2 owns it; the en/ar `problems.json` keys need your append-only merge.
3. **Interpretation of "Default effective date is the next period"** (REQ-S07-016 procedure). ADR-0047 reads it as "the first open period". The acceptance text does not depend on it.
4. **Restatement authority roles (D-142 Q10).** I granted `kpi_restatement.approve` to SP, BO and FIN, the holders of `approval.decide`, among them BO, the ADR-0036 default KPI change approver. TL is excluded under the ADR-0039 §9 rule. Please confirm, or narrow it to BO.
5. **Splits** (p5-plan R6 / the `-2` precedent): KBE-E → KBE-E/KBE-E2, BE-P → BE-P/BE-P2, KBE-G → KBE-G/KBE-G2. Please place them in the waves (p5-work-split §G.5, §H.6).
6. **`financial_metrics.enable` to ADM_METHOD.** REQ-S08-019 says "enable: ADM" without naming which admin. I chose ADM_METHOD, the calculation-configuration admin, as a configure code that is not an approval.

## 5. DG1–DG4 (and earlier-P5) artifacts changed, and why (D-142)

| Artifact | Change | Reason |
|---|---|---|
| `calculation_run` (DG4, `0035`) via `0085` | the three trigger CHECKs gain `restatement_approved`/`kpi_restatement`; new trigger `calculation_run_restatement_guard` | additive (the p5-plan §3 row 2 CHECK-widening precedent); every DG4 value keeps its meaning (probe G05, EV05) |
| `kpi_evaluation` (DG4) via `0085` | new trigger `kpi_evaluation_restatement_guard` | constrains only restatement runs (EV05) |
| `packages/db/test/integration/catalogue.test.ts` (DG4 block "0033-0035") | +2 rows: the two triggers above | pins must list every trigger |
| same file (slice A block "0062-0063") | +1 row: `health_scheme_publish_guard` on `methodology_version` | the REQ-S14-003 publish rule |
| `methodology_element` CHECK and `methodology_element_guard()` (slice A, DG5 code) via `0086` | widened and redefined with every 0062/0068 rule kept | health-check scheme element types (the 0068 precedent; D-144 (b)) |
| `apps/api/src/modules/reporting/my-work.ts`, `apps/web/src/i18n/{en,ar}/myWork.json` | three kinds mapped and labelled | the completeness tests require every `work_item_kind` row mapped (the ARCH-04 precedent) |
| `apps/api/src/modules/platform/advisory-locks.ts` (+ test), ADR-0016 §6 | 730266–730268 registered | assignment deliverable 2 |
| `packages/shared/src/schemas/studio.ts`, contract `ConfigElementType` | +2 element types | the DB element-type list must equal `ELEMENT_TYPES_BY_KIND` |
| `apps/api/test/integration/contract/contract.test.ts` | count 789 → 827 | the P3/P4 pending pattern |
| `apps/api/test/integration/identity.test.ts` (DG1 test) | TO's pinned effective permissions +2 (`health_check.assess`, `launch_plan.edit`) | the 0087 role defaults (REQ-PB-091, REQ-PB-086 "TL, TO") |
| `apps/worker/test/integration/schedules.test.ts` (DG4 test) | `P5_LAUNCH_JOBS` added to the expected unhandled list | the 0086 job schedule; handled once BE-P2 ships |
| `apps/api/test/integration/kpi/kpi-aud-write-deny.test.ts` (DG2 test) | the P2 sweep also excludes `P5_OPERATION_IDS` (it already excluded P4) | `createKpiRestatement` shares the P2 path; KBE-E tests its own AUD 403 (shared rule 7) |
| `apps/api/test/integration/reporting/my-work.test.ts` (DG4 test) | 39 → 42 kinds; assigned actions 13 → 15, approvals 9 → 10 | the three new kinds |
| ADR-0039, ADR-0043 | dated amendments | D-146 |

No DG1–DG4 request, response, route, row or text was changed by this task. The DG4 text change in §4.2 is proposed, not made.

## 6. What the implementers of slices G and H must know

See p5-work-split §G.0–§G.6, §H.0–§H.8 (the twelve rules in §H.8). In short:
1. Prospective means open periods only; never touch a closed period's evaluations except through an approved restatement's new run.
2. `kpi_restatement.approve` is a business approval decided by a person, never the requester; the database checks SoD and records the authority.
3. The reconciliation is written once, at submission, in the same transaction.
4. Issued snapshots never change; restatements only offer a reissue.
5. The formula engine is unchanged.
6. NPV, ROI and payback are an extension: off by default, assumptions always shown, NPV only with a discount rate, never 0 for "not computed".
7. B0134, B0136–B0141, B0150 and B0152 texts are rendered verbatim from the seeds; the Arabic texts are provisional.
8. Day *d* = start + *d* calendar days, with a warning (never a shift) on non-working days.
9. Incomplete is `null`, never 0.
10. The database recomputes the health score and band at submission.
11. Schemes change only through Studio and a pin migration; existing assessments keep their scheme.
12. No digits in any code the database checks (`day_ninety_*`).

## 7. Merge instructions

- Migrations `0085`, `0086`, `0087` (in order; forward-only; never edit once merged). `0088` is reserved for KBE-G2 (H.4).
- The new files have no conflicts expected. The shared files I edited append blocks only: `permissions.ts`, `schema.ts`, `seed.test.ts`, `catalogue.test.ts`, `advisory-locks.ts`, `p5-operations.ts`, `p5-pending.ts`, `contract.test.ts`, `studio.ts`, `my-work.ts`, `myWork.json`, `openapi.yaml`, `erd.md`, `data-dictionary.md`, `permissions-matrix.md`, `p5-work-split.md`, ADR-0016/0039/0043. BE-B3, BE-E and BE-H2 (W5) may also touch `contract.test.ts` (the media-type pin), `studio.ts` or `my-work.ts`; resolve by keeping both sides (the D-146 precedent).
- No new dependency.
